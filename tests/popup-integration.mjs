// Popup ↔ real background ↔ real content integration.
// Run: node tests/popup-integration.mjs   (writes artifacts/popup-integration/)
//
// Loads this directory as an unpacked extension into Chrome for Testing with a
// throwaway profile. chrome.* is never stubbed: popup.html runs at its real
// chrome-extension:// origin and talks to the real service worker and the real
// content script. Fixtures are limited to (1) the Netflix DOM, served for
// https://www.netflix.com/* by request interception, and (2) seeded
// chrome.storage (settings + a few cache entries) so the first screen is
// deterministic. Search, bind, provider checks and at least one lookup hit the
// real rating services. Offline/outage checks run in a second launch whose DNS
// resolves nothing.
//
// The popup is opened as a background tab in the Netflix tab's window, so its
// chrome.tabs.query({active, currentWindow}) finds the Netflix tab exactly as
// the toolbar popup does. CfT does not expose the toolbar bubble to Playwright.
import { chromium } from "playwright";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {MATCHING_VERSION} from '../matching.js';

const root = resolve(import.meta.dirname, "..");
const out = resolve(process.env.POPUP_IT_OUT || join(root, "artifacts/popup-integration"));
import {executablePath} from './browser.mjs';
const NET_TIMEOUT = 60_000;
const UI_TIMEOUT = 8_000;
// Obviously fake; sent to OMDb only to observe its real rejection path.
const FAKE_KEY = "scorelens-it-invalid-key";

// ---------------------------------------------------------------------------
// Fixture: Netflix DOM. Titles are real; ids only need to be unique digits.
// ---------------------------------------------------------------------------
const CARDS = {
  breakingBad: { id: "70143836", title: "絕命毒師", kind: "Show", year: 2008 },
  bright: { id: "80119234", title: "Bright", kind: "Movie", year: 2017 },
  rebecca: { id: "81002196", title: "Rebecca", kind: "Movie", year: 2020 },
  unknown: { id: "81517168", title: "某部地区限定纪录片" },
  stranger: { id: "80057281", title: "Stranger Things", kind: "Show", year: 2016 },
  crown: { id: "80025678", title: "The Crown", kind: "Show", year: 2016, below: true }
};
const svg = (fill) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="135"><rect width="240" height="135" fill="${fill}"/></svg>`)}`;
const fills = ["#3d5566", "#5a4136", "#3f3a58", "#2f4a3e", "#57324a", "#4a4a2c"];
function fixtureHtml() {
  const graphql = {};
  for (const c of Object.values(CARDS)) if (c.kind) graphql[`${c.kind}:{"videoId":${c.id}}`] = { releaseYear: c.year };
  const card = (c, i) => `<a data-uia="standard-card" aria-label="${c.title}" href="/browse?jbv=${c.id}"><img alt="" src="${svg(fills[i])}"><span>${c.title}</span></a>`;
  const list = Object.values(CARDS);
  return `<!doctype html><html><head><meta charset="UTF-8"><title>Netflix fixture</title>
<style>body{margin:40px;background:#141414;color:#fff;font:14px system-ui}#row{display:flex;flex-wrap:wrap;gap:16px}a{display:block;width:240px;color:#ddd;text-decoration:none}img{display:block;width:240px;height:135px;border-radius:6px}#below{margin-top:2400px}</style>
<script>window.netflix={reactContext:{models:{graphql:{data:${JSON.stringify(graphql)}}}}};</script></head>
<body><h1>Netflix DOM fixture · Score Lens popup integration</h1>
<div id="row">${list.filter((c) => !c.below).map(card).join("")}</div>
<div id="below">${list.filter((c) => c.below).map((c) => card(c, 5)).join("")}</div></body></html>`;
}

// Seeded cache entries use background.js requestCacheKey():
// `${item.key}|${title}|${year}|${type}|${providerMode}|${hasKey}`.
const imdbRating = (id, value) => ({ value, scale: 10, provider: "Cinemeta", url: `https://www.imdb.com/title/${id}/` });
function seededCache(now) {
  const entry = (c, type, result) => [`nf:${c.id}|${c.title}|${c.year || ""}|${type || ""}|auto|false`, { at: now, ttl: 3_600_000, matchingVersion: MATCHING_VERSION, result: { fetchedAt: now, candidates: [], ...result } }];
  return Object.fromEntries([
    entry(CARDS.breakingBad, "series", { status: "ok", id: "tt0903747", title: "Breaking Bad", year: 2008, type: "series", ratings: { imdb: imdbRating("tt0903747", 9.5) }, confidence: "localized", matchReason: "IMDb 别名检索 + Netflix 年份/类型；可点击纠错" }),
    entry(CARDS.bright, "movie", { status: "ok", id: "tt5519340", title: "Bright", year: 2017, type: "movie", ratings: { imdb: imdbRating("tt5519340", 6.3) }, confidence: "high", matchReason: "标题一致，年份已核对" }),
    entry(CARDS.rebecca, "movie", {
      status: "ambiguous", ratings: {}, matchReason: "同名或跨语言结果需要确认",
      candidates: [
        { id: "tt2235695", title: "Rebecca", year: 2020, type: "movie", provider: "Cinemeta", url: "https://www.imdb.com/title/tt2235695/", rank: 0 },
        { id: "tt0032976", title: "Rebecca", year: 1940, type: "movie", provider: "Cinemeta", url: "https://www.imdb.com/title/tt0032976/", rank: 1 }
      ]
    }),
    entry(CARDS.unknown, "", { status: "not_found", ratings: {}, matchReason: "未找到对应作品" })
  ]);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const report = { startedAt: new Date().toISOString(), environment: {}, checks: [], evidence: {}, pageErrors: [], boundaries: [] };
let shotIndex = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = UI_TIMEOUT, interval = 150, message = "condition" } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  throw new Error(`timed out after ${timeout}ms waiting for ${message}${last instanceof Error ? ` (${last.message})` : ""}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launch({ offline = false } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "scorelens-popup-it-"));
  const args = [`--disable-extensions-except=${root}`, `--load-extension=${root}`];
  if (offline) args.push("--host-resolver-rules=MAP * ~NOTFOUND");
  const context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: { width: 1280, height: 720 }, args });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = worker.url().split("/")[2];
  await context.route("https://www.netflix.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml() }));
  await context.route("https://example.org/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Example</title><h1>Not Netflix</h1>" }));

  const env = {
    context, worker, extensionId, profile,
    storage: (keys) => worker.evaluate((k) => chrome.storage.local.get(k), keys),
    // Real content-script answer, asked from the real service worker.
    getPage: () => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "https://www.netflix.com/*" });
      return tab ? chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE" }) : null;
    }),
    async seed({ cache = true } = {}) {
      // GET_UI awaits the worker's startup migration (`ready`), which would
      // otherwise rewrite settings after we seed them.
      const probe = await context.newPage();
      const ui = await probe.goto(`chrome-extension://${extensionId}/popup.html`)
        .then(() => probe.evaluate(() => chrome.runtime.sendMessage({ type: "GET_UI" })));
      await probe.close();
      if (!ui?.ok) throw new Error(`worker not ready: ${JSON.stringify(ui)}`);
      const now = Date.now();
      await worker.evaluate(async ({ cacheV3 }) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set({
          configVersion: 3,
          settings: { enabled: true, dimLowScores: true, scoreSource: "auto", minScore: 7, dimOpacity: 0.62, revealOnHover: true, providerMode: "auto" },
          credentials: { omdb: "" },
          ...(cacheV3 ? { cacheV3 } : {})
        });
      }, { cacheV3: cache ? seededCache(now) : null });
    },
    async open() {
      env.netflix = context.pages()[0] || await context.newPage();
      env.netflix.on("pageerror", (e) => report.pageErrors.push(`netflix: ${e.message}`));
      await env.netflix.goto("https://www.netflix.com/browse", { waitUntil: "domcontentloaded" });
      env.popup = await context.newPage();
      env.popup.on("pageerror", (e) => report.pageErrors.push(`popup: ${e.message}`));
      env.popup.on("console", (m) => { if (m.type() === "error") report.pageErrors.push(`popup console: ${m.text()}`); });
      await env.popup.setViewportSize({ width: 400, height: 600 });
      await env.netflix.bringToFront();
      await env.popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await env.popup.waitForFunction(() => !document.getElementById("enabled").disabled, null, { timeout: UI_TIMEOUT });
    },
    async close() {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  };
  return env;
}

async function shot(page, name) {
  const file = `${String(++shotIndex).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(out, file) });
  return file;
}

let currentPopup = null;
async function check(name, fn) {
  const start = Date.now();
  const entry = { name, passed: false, ms: 0 };
  try {
    const detail = await fn();
    entry.passed = true;
    if (detail !== undefined) entry.detail = detail;
  } catch (error) {
    entry.error = error.message;
    if (currentPopup) entry.screenshot = await shot(currentPopup, `FAIL-${name.replace(/[^\w]+/g, "-").slice(0, 40)}`).catch(() => undefined);
  }
  entry.ms = Date.now() - start;
  report.checks.push(entry);
  console.log(`${entry.passed ? "PASS" : "FAIL"} ${name} (${entry.ms}ms)${entry.passed ? "" : `\n     ${entry.error}`}`);
  return entry.passed;
}

// ---------------------------------------------------------------------------
// Popup/page helpers
// ---------------------------------------------------------------------------
const row = (popup, title) => popup.locator(".title-item", { has: popup.locator(`.title-name:text-is("${title}")`) });
const text = async (locator) => ((await locator.textContent()) || "").replace(/\s+/g, " ").trim();
const lowCount = (netflix) => netflix.locator("a.nsl-low").count();
const layerCount = (netflix) => netflix.locator(".nsl-layer").count();
const itemByTitle = (page, title) => page?.items?.find((e) => e.item.title === title);

async function selectPanel(popup, name) {
  await popup.click(`#tab-${name}`);
  await popup.waitForSelector(`#panel-${name}:not([hidden])`);
}

async function setRange(popup, selector, value) {
  // Same event sequence as a pointer drag: several input events, then change.
  await popup.evaluate(({ selector, value }) => {
    const range = document.querySelector(selector);
    const from = Number(range.value);
    for (let i = 1; i <= 4; i++) {
      range.value = String(from + ((value - from) * i) / 4);
      range.dispatchEvent(new Event("input", { bubbles: true }));
    }
    range.value = String(value);
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector, value });
}

// Expected dimmed-card count derived from the real GET_PAGE answer, using the
// same rule as core.js isLow for the "auto" source (first of imdb/tvmaze/rt/mc).
function expectedLow(page, minScore) {
  let count = 0;
  for (const { result } of page.items) {
    if (result?.status !== "ok") continue;
    const r = ["imdb", "tvmaze", "rt", "metacritic"].map((k) => result.ratings?.[k]).find((x) => x && Number.isFinite(x.value));
    if (r && (r.value * 10) / r.scale < minScore) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Phase 1: online, seeded first screen, real lookups/search/bind/providers
// ---------------------------------------------------------------------------
async function onlinePhase() {
  const env = await launch();
  const { worker, storage } = env;
  report.environment.chrome = env.context.browser()?.version() || (await env.worker.evaluate(() => navigator.userAgent));
  report.environment.extensionId = env.extensionId;
  report.environment.manifestVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
  try {
    await env.seed();
    const t0 = Date.now();
    await env.open();
    const { popup, netflix } = env;
    currentPopup = popup;

    await check("popup loads real settings and manifest version", async () => {
      assert((await popup.textContent("#version")) === `v${report.environment.manifestVersion}`, "version mismatch");
      assert((await popup.inputValue("#scoreSource")) === "auto", "scoreSource not auto");
      assert((await popup.inputValue("#minScore")) === "7", "minScore not 7");
      return `v${report.environment.manifestVersion}`;
    });

    await check("real network lookup resolves the unseeded card (Stranger Things)", async () => {
      const page = await waitFor(async () => {
        const p = await env.getPage();
        const st = itemByTitle(p, CARDS.stranger.title);
        return st && !["pending", "waiting"].includes(st.result.status) ? p : null;
      }, { timeout: NET_TIMEOUT, message: "Stranger Things lookup" });
      const st = itemByTitle(page, CARDS.stranger.title).result;
      report.evidence.realLookup = { ms: Date.now() - t0, status: st.status, id: st.id, title: st.title, ratings: st.ratings, matchReason: st.matchReason };
      assert(st.status === "ok" && st.id === "tt4574334", `unexpected ${st.status} ${st.id}`);
      assert(st.ratings?.imdb?.provider === "Cinemeta", "IMDb rating not from Cinemeta");
      return `${st.id} IMDb ${st.ratings.imdb.value}${st.ratings.tvmaze ? ` / TVmaze ${st.ratings.tvmaze.value}` : ""}`;
    });

    await check("page strip mirrors real summary, off-screen card counted as waiting", async () => {
      const page = await env.getPage();
      const s = page.summary;
      assert(s.discovered === 6, `discovered ${s.discovered}`);
      assert(itemByTitle(page, CARDS.crown.title).result.status === "waiting", "The Crown not waiting");
      const title = await waitFor(async () => {
        const t = await popup.textContent("#pageTitle");
        return t === `已查询 5/6 部 · ${s.matched} 部已匹配` ? t : null;
      }, { message: "page title" });
      const hint = await popup.textContent("#pageHint");
      assert(hint.includes("其余 1 部滚动到附近时自动查询"), `hint: ${hint}`);
      const stats = await text(popup.locator("#stats"));
      // <dt>/<dd> pairs have no whitespace between them in textContent.
      assert(stats.includes(`已匹配${s.matched}`) && stats.includes(`待确认${s.ambiguous}`) && stats.includes(`未找到${s.unmatched}`), stats);
      return `${title} | ${stats}`;
    });

    await check("title list mirrors content items and statuses", async () => {
      await selectPanel(popup, "titles");
      await waitFor(async () => (await popup.locator(".title-item").count()) === 6, { message: "6 rows" });
      const statuses = {};
      for (const c of Object.values(CARDS)) statuses[c.title] = await row(popup, c.title).getAttribute("data-status");
      const expected = { "絕命毒師": "ok", Bright: "ok", Rebecca: "ambiguous", "某部地区限定纪录片": "not_found", "Stranger Things": "ok", "The Crown": "waiting" };
      for (const [t, s] of Object.entries(expected)) assert(statuses[t] === s, `${t}: ${statuses[t]} != ${s}`);
      assert((await text(row(popup, "絕命毒師").locator(".title-score b"))) === "9.5", "BB score");
      assert(/is-low/.test(await row(popup, "Bright").locator(".title-score").getAttribute("class")), "Bright not marked low");
      assert((await popup.textContent("#titlesBadge")) === "2", "attention badge");
      await shot(popup, "titles-list");
      return statuses;
    });

    await shot(netflix, "netflix-fixture-initial");

    // ----- live settings → content ------------------------------------------
    await selectPanel(popup, "filter");
    const page0 = await env.getPage();

    await check("threshold End key → 10 dims every rated card on Netflix without reload", async () => {
      const want = expectedLow(page0, 10);
      const start = Date.now();
      await popup.focus("#minScore");
      await popup.keyboard.press("End");
      await waitFor(async () => (await lowCount(netflix)) === want, { message: `${want} dimmed cards` });
      const ms = Date.now() - start;
      assert((await storage("settings")).settings.minScore === 10, "stored minScore");
      assert((await popup.textContent("#minScoreValue")) === "10.0", "UI value");
      return `${want} cards dimmed in ${ms}ms`;
    });

    await check("threshold Home key → 0 removes all dimming", async () => {
      await popup.keyboard.press("Home");
      await waitFor(async () => (await lowCount(netflix)) === 0, { message: "no dimmed cards" });
      assert((await storage("settings")).settings.minScore === 0, "stored minScore");
    });

    await check("threshold drag to 7 is debounced and lands on 7", async () => {
      await setRange(popup, "#minScore", 7);
      const want = expectedLow(page0, 7);
      await waitFor(async () => (await storage("settings")).settings.minScore === 7 && (await lowCount(netflix)) === want, { message: "minScore 7" });
      return `${want} card(s) below 7`;
    });

    await check("master switch (Space) hides all overlays immediately and back", async () => {
      await popup.focus("#enabled");
      let start = Date.now();
      await popup.keyboard.press("Space");
      await waitFor(async () => (await layerCount(netflix)) === 0, { message: "overlays removed" });
      const offMs = Date.now() - start;
      assert((await storage("settings")).settings.enabled === false, "stored enabled");
      await waitFor(async () => (await popup.textContent("#pageTitle")) === "已暂停", { message: "popup paused" });
      await shot(popup, "paused");
      start = Date.now();
      await popup.keyboard.press("Space");
      await waitFor(async () => (await layerCount(netflix)) >= 5, { message: "overlays back" });
      return `off ${offMs}ms, on ${Date.now() - start}ms`;
    });

    await check("dim switch, opacity and hover-reveal reach the page", async () => {
      const want = expectedLow(await env.getPage(), 7);
      await popup.click("label.switch-row:has(#dimLowScores)");
      await waitFor(async () => (await lowCount(netflix)) === 0, { message: "dim off" });
      assert(await popup.isDisabled("#dimOpacity"), "opacity not disabled while dim off");
      await popup.click("label.switch-row:has(#dimLowScores)");
      await waitFor(async () => (await lowCount(netflix)) === want, { message: "dim on" });
      await setRange(popup, "#dimOpacity", 0.4);
      await waitFor(async () => (await netflix.locator("a.nsl-card").first().evaluate((a) => a.style.getPropertyValue("--nsl-dim"))) === "0.4", { message: "--nsl-dim 0.4" });
      assert((await storage("settings")).settings.dimOpacity === 0.4, "stored opacity");
      await popup.click("label.switch-row:has(#revealOnHover)");
      await waitFor(async () => (await netflix.locator("a.nsl-hover-reveal").count()) === 0, { message: "hover reveal off" });
      await popup.click("label.switch-row:has(#revealOnHover)");
      await waitFor(async () => (await netflix.locator("a.nsl-hover-reveal").count()) > 0, { message: "hover reveal on" });
      await setRange(popup, "#dimOpacity", 0.62);
    });

    await check("RT source converts 7 → 70, warns about missing Key, never dims without RT data", async () => {
      await popup.selectOption("#scoreSource", "rt");
      await waitFor(async () => {
        const s = (await storage("settings")).settings;
        return s.scoreSource === "rt" && s.minScore === 70;
      }, { message: "stored rt/70" });
      assert(await popup.evaluate(() => minScore.max === "100" && minScore.value === "70"), "range not 0..100 / 70");
      assert(await popup.isVisible("#sourceHint"), "missing-key hint hidden");
      await waitFor(async () => (await lowCount(netflix)) === 0, { message: "no dimming on RT" });
      await shot(popup, "filter-rt-no-key");
      await popup.selectOption("#scoreSource", "auto");
      await waitFor(async () => {
        const s = (await storage("settings")).settings;
        return s.scoreSource === "auto" && s.minScore === 7;
      }, { message: "back to auto/7" });
    });

    await check("keyboard: Tab reaches every filter control; arrows switch panels", async () => {
      await popup.focus("#enabled");
      const order = [];
      for (let i = 0; i < 14; i++) {
        await popup.keyboard.press("Tab");
        order.push(await popup.evaluate(() => document.activeElement.id || document.activeElement.className));
      }
      for (const id of ["rescan", "tab-filter", "scoreSource", "minScore", "dimLowScores", "dimOpacity", "revealOnHover"]) assert(order.includes(id), `Tab never reached ${id}: ${order.join(" → ")}`);
      await popup.focus("#tab-filter");
      await popup.keyboard.press("ArrowRight");
      assert(await popup.evaluate(() => document.activeElement.id === "tab-titles" && !document.getElementById("panel-titles").hidden), "ArrowRight did not open 作品");
      return order.join(" → ");
    });

    // ----- list, search, bind -----------------------------------------------
    await check("Enter opens the ambiguous card; candidates shown, nothing bound without a click", async () => {
      await popup.click('[data-filter="attention"]');
      await waitFor(async () => (await popup.locator(".title-item").count()) === 2, { message: "2 attention rows" });
      await row(popup, "Rebecca").locator(".title-row").focus();
      await popup.keyboard.press("Enter");
      await waitFor(() => row(popup, "Rebecca").locator(".detail").isVisible(), { message: "detail open" });
      assert((await row(popup, "Rebecca").locator(".detail-match .candidate").count()) === 2, "candidate count");
      await sleep(1700); // survive a GET_PAGE poll
      assert(await row(popup, "Rebecca").locator(".detail").isVisible(), "detail closed by poll");
      assert(!(await storage("overrides")).overrides, "override written without click");
      await shot(popup, "ambiguous-detail");
      await popup.keyboard.press("Escape");
    });

    const unknownRow = row(popup, "某部地区限定纪录片");
    await check("SEARCH by title + year + type (real network)", async () => {
      await unknownRow.locator(".title-row").click();
      await unknownRow.locator(".fix-query").fill("Rebecca");
      await unknownRow.locator(".fix-year").fill("2020");
      await unknownRow.locator(".fix-type").selectOption("movie");
      const start = Date.now();
      await unknownRow.locator(".fix-query").press("Enter");
      await waitFor(async () => /正在搜索/.test(await unknownRow.locator(".fix-status").textContent()), { timeout: 2000, message: "pending state" });
      await waitFor(async () => !(await unknownRow.locator(".fix-submit").getAttribute("aria-busy")), { timeout: NET_TIMEOUT, message: "search done" });
      const status = await text(unknownRow.locator(".fix-status"));
      const ids = await unknownRow.locator(".candidates .cand-meta a").allTextContents();
      report.evidence.searchTitle = { ms: Date.now() - start, status, ids };
      assert(ids[0] === "tt2235695", `2020 film not ranked first: ${status} ${ids.join(",")}`);
      assert(ids.length <= 8, `${ids.length} candidates rendered`);
      await shot(popup, "search-title");
      return `${ids.length} candidates in ${Date.now() - start}ms`;
    });

    await check("SEARCH by pasted IMDb link (real network)", async () => {
      await unknownRow.locator(".fix-query").fill("https://www.imdb.com/title/tt2235695/?ref_=it");
      await unknownRow.locator(".fix-year").fill("");
      await unknownRow.locator(".fix-type").selectOption("");
      const start = Date.now();
      await unknownRow.locator(".fix-submit").click();
      await waitFor(async () => !(await unknownRow.locator(".fix-submit").getAttribute("aria-busy")), { timeout: NET_TIMEOUT, message: "id search done" });
      const status = await text(unknownRow.locator(".fix-status"));
      const metas = await unknownRow.locator(".candidates .cand-meta").allTextContents();
      report.evidence.searchImdbId = { ms: Date.now() - start, status, candidates: metas };
      assert(metas.length >= 1 && metas.every((m) => m.includes("tt2235695")), `${status} ${metas.join(" | ")}`);
      assert(metas.some((m) => m.includes("电影")), "movie type missing");
      return `${metas.join(" | ")} in ${Date.now() - start}ms`;
    });

    await check("SEARCH with no hits explains next step (real network)", async () => {
      // Real words get fuzzy IMDb hits ("… nothing" returned 19); this string returns [].
      await unknownRow.locator(".fix-query").fill("qzxjvqzxjvkqw");
      const start = Date.now();
      await unknownRow.locator(".fix-submit").click();
      await waitFor(async () => !(await unknownRow.locator(".fix-submit").getAttribute("aria-busy")), { timeout: NET_TIMEOUT, message: "empty search done" });
      const status = await text(unknownRow.locator(".fix-status"));
      report.evidence.searchEmpty = { ms: Date.now() - start, status };
      assert(/没有找到候选/.test(status), status);
      return `${status} (${Date.now() - start}ms)`;
    });

    await check("invalid year is rejected before any request", async () => {
      await unknownRow.locator(".fix-query").fill("Rebecca");
      await unknownRow.locator(".fix-year").fill("19");
      await unknownRow.locator(".fix-submit").click();
      assert(/年份需为四位数字/.test(await unknownRow.locator(".fix-status").textContent()), "no validation message");
      await unknownRow.locator(".fix-year").fill("");
      await unknownRow.locator(".fix-query").press("Escape");
    });

    const rebeccaKey = `nf:${CARDS.rebecca.id}`;
    await check("BIND ambiguous card to tt2235695 (real resolve) updates storage, popup and Netflix badge", async () => {
      const r = row(popup, "Rebecca");
      if (!(await r.locator(".detail").isVisible())) await r.locator(".title-row").click();
      const start = Date.now();
      await r.locator(".detail-match .candidate", { hasText: "tt2235695" }).locator("button").click();
      await waitFor(async () => /正在绑定/.test(await r.locator(".detail-status").textContent()), { timeout: 2000, message: "bind pending" });
      await waitFor(async () => /已绑定为「Rebecca \(2020\)」/.test(await r.locator(".detail-status").textContent()), { timeout: NET_TIMEOUT, message: "bind success" });
      const override = (await storage("overrides")).overrides?.[rebeccaKey];
      assert(override?.id === "tt2235695", `override ${JSON.stringify(override)}`);
      await waitFor(async () => (await r.getAttribute("data-status")) === "ok" && await r.locator(".manual-tag").isVisible(), { timeout: NET_TIMEOUT, message: "row manual+ok" });
      const badge = await waitFor(async () => {
        const t = await netflix.locator(`a[href*="${CARDS.rebecca.id}"] .nsl-badges`).textContent().catch(() => "");
        return /IMDb \d/.test(t) ? t : null;
      }, { timeout: NET_TIMEOUT, message: "Netflix badge with IMDb" });
      const result = itemByTitle(await env.getPage(), "Rebecca").result;
      report.evidence.bind = { ms: Date.now() - start, override, result: { status: result.status, id: result.id, confidence: result.confidence, ratings: result.ratings }, badge };
      assert(result.id === "tt2235695" && result.confidence === "manual", "content result not manual tt2235695");
      await shot(popup, "bound");
      return `${badge} (${Date.now() - start}ms)`;
    });

    await check("binding survives a poll while the 需处理 filter would hide it", async () => {
      await sleep(1700);
      assert(await row(popup, "Rebecca").isVisible(), "bound row vanished");
      await popup.click('[data-filter="all"]');
    });

    // ----- sources: cache, providers, key -----------------------------------
    await selectPanel(popup, "sources");

    await check("CLEAR_CACHE (two-step) empties cache, keeps manual binding, page refetches", async () => {
      await waitFor(async () => /已缓存 \d+ 条/.test(await popup.textContent("#cacheMeta")), { timeout: 12_000, message: "cache count shown" });
      const before = await popup.textContent("#cacheMeta");
      await popup.click("#clearCache");
      assert((await text(popup.locator("#clearCache"))) === "确认清空？", "no confirmation step");
      const cleared = Date.now();
      await popup.click("#clearCache");
      await waitFor(async () => /已清空/.test(await popup.textContent("#cacheStatus")), { message: "clear success" });
      const { cacheV3 = {}, overrides = {} } = await storage(["cacheV3", "overrides"]);
      assert(Object.values(cacheV3).every((e) => e.at >= cleared), "old cache entries survived");
      assert(overrides[rebeccaKey]?.id === "tt2235695", "manual binding lost");
      await waitFor(async () => {
        const p = await env.getPage();
        const reb = itemByTitle(p, "Rebecca");
        return reb?.result?.confidence === "manual" && reb.result.status === "ok";
      }, { timeout: NET_TIMEOUT, message: "rebecca refetched as manual" });
      return `${before} → ${await popup.textContent("#cacheStatus")}`;
    });

    await check("UNBIND restores automatic matching", async () => {
      await selectPanel(popup, "titles");
      const r = row(popup, "Rebecca");
      if (!(await r.locator(".detail").isVisible())) await r.locator(".title-row").click();
      await r.locator("button", { hasText: "恢复自动匹配" }).click();
      await waitFor(async () => /已恢复自动匹配/.test(await r.locator(".detail-status").textContent()), { timeout: NET_TIMEOUT, message: "unbind success" });
      assert(!(await storage("overrides")).overrides?.[rebeccaKey], "override still stored");
      const result = await waitFor(async () => {
        const reb = itemByTitle(await env.getPage(), "Rebecca")?.result;
        return reb && !["pending", "waiting"].includes(reb.status) ? reb : null;
      }, { timeout: NET_TIMEOUT, message: "rebecca re-matched" });
      assert(result.confidence !== "manual", "still manual");
      await waitFor(async () => !(await r.locator(".manual-tag").count()), { message: "manual tag removed" });
      report.evidence.unbind = { status: result.status, id: result.id, confidence: result.confidence, matchReason: result.matchReason };
      return `${result.status} ${result.id || ""} (${result.matchReason})`;
    });

    await selectPanel(popup, "sources");
    await check("source check without Key: real calls, OMDb shown as not configured (not failed)", async () => {
      const start = Date.now();
      await popup.click("#testProviders");
      await waitFor(async () => /正在实时请求/.test(await popup.textContent("#testStatus")), { timeout: 2000, message: "pending state" });
      await waitFor(async () => !(await popup.getAttribute("#testProviders", "aria-busy")), { timeout: NET_TIMEOUT, message: "check done" });
      const rows = await popup.locator(".health").evaluateAll((els) => els.map((e) => ({ name: e.querySelector(".h-name").firstChild.textContent, tone: e.dataset.status, label: e.querySelector(".h-state").textContent, message: e.querySelector(".h-msg")?.textContent || "" })));
      const summary = await popup.textContent("#testStatus");
      report.evidence.providersNoKey = { ms: Date.now() - start, summary, rows };
      const omdb = rows.find((r) => r.name === "OMDb");
      assert(omdb?.tone === "not_configured", `OMDb ${JSON.stringify(omdb)}`);
      const live = rows.filter((r) => r.name !== "OMDb");
      assert(live.length >= 2 && live.every((r) => r.tone === "ok"), `live providers not ok: ${JSON.stringify(live)}`);
      assert(summary.includes(`${live.length}/${live.length} 个评分源可用，1 个未配置 Key`), summary);
      assert((await popup.textContent("#keyState")) === "未配置" && await popup.isHidden("#removeKey"), "key state");
      await shot(popup, "sources-no-key");
      return summary;
    });

    await check("empty / whitespace Key cannot be submitted", async () => {
      await popup.click("#omdb summary");
      await popup.fill("#apiKey", "   ");
      assert(await popup.isDisabled("#saveKey"), "save enabled for whitespace");
      await popup.press("#apiKey", "Enter");
      await sleep(400);
      assert(!(await storage("credentials")).credentials?.omdb, "a key got stored");
      await popup.fill("#apiKey", "");
    });

    await check("invalid Key: saved, then real OMDb call reports failure (distinct from not configured)", async () => {
      await popup.fill("#apiKey", FAKE_KEY);
      await popup.press("#apiKey", "Enter");
      await waitFor(async () => /正在保存 Key|Key 已保存，正在验证/.test(await popup.textContent("#keyStatus")), { timeout: 3000, message: "key pending" });
      await waitFor(async () => !(await popup.getAttribute("#testProviders", "aria-busy")) && /Key 已保存，/.test(await popup.textContent("#keyStatus")) && !/正在验证/.test(await popup.textContent("#keyStatus")), { timeout: NET_TIMEOUT, message: "key verify done" });
      const keyStatus = await popup.textContent("#keyStatus");
      const omdb = await popup.locator(".health", { hasText: "OMDb" }).evaluate((e) => ({ tone: e.dataset.status, label: e.querySelector(".h-state").textContent, message: e.querySelector(".h-msg")?.textContent || "" }));
      report.evidence.invalidKey = { keyStatus, omdb };
      assert(/验证失败/.test(keyStatus), keyStatus);
      assert(omdb.tone === "error", `OMDb tone ${omdb.tone}`);
      assert((await popup.textContent("#keyState")) === "已配置" && (await popup.inputValue("#apiKey")) === "", "key state/input");
      const ui = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "GET_UI" }));
      assert(ui.hasApiKey === true && !JSON.stringify(ui).includes(FAKE_KEY), "GET_UI leaks key or lost it");
      await shot(popup, "sources-invalid-key");
      return `${keyStatus} | OMDb: ${omdb.message}`;
    });

    await check("Enter on empty Key field never removes the stored Key", async () => {
      await popup.fill("#apiKey", "");
      await popup.press("#apiKey", "Enter");
      await sleep(500);
      assert(Boolean((await storage("credentials")).credentials?.omdb), "key removed by empty submit");
    });

    await check("remove Key needs confirmation, then OMDb returns to not configured", async () => {
      await popup.click("#removeKey");
      assert((await text(popup.locator("#removeKey"))) === "确认移除？", "no confirmation");
      assert(Boolean((await storage("credentials")).credentials?.omdb), "removed on first click");
      await popup.click("#removeKey");
      await waitFor(async () => /已移除 Key/.test(await popup.textContent("#keyStatus")), { message: "remove success" });
      assert(!(await storage("credentials")).credentials?.omdb, "key still stored");
      assert((await popup.textContent("#keyState")) === "未配置", "key state");
    });

    await check("popup fits 400×600, scrolls internally, no text under 12px", async () => {
      const layout = await popup.evaluate(() => {
        const small = new Set();
        for (const panel of ["filter", "titles", "sources"]) {
          document.getElementById(`tab-${panel}`).click();
          document.getElementById("omdb").open = true;
          for (const node of document.querySelectorAll("body *")) {
            const hasText = [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
            if (hasText && node.getClientRects().length && parseFloat(getComputedStyle(node).fontSize) < 12) small.add(`${node.tagName}.${node.className}`);
          }
        }
        document.getElementById("tab-filter").click();
        return { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, app: document.querySelector(".app").getBoundingClientRect().height, small: [...small] };
      });
      assert(layout.width === 400 && layout.height <= 600 && layout.app <= 600, JSON.stringify(layout));
      assert(!layout.small.length, `small text: ${layout.small.join(", ")}`);
      return layout;
    });

    await check("non-Netflix active tab gets an actionable message; 打开 Netflix opens a real tab", async () => {
      const other = await env.context.newPage();
      await other.goto("https://example.org/");
      await other.bringToFront();
      await waitFor(async () => (await popup.textContent("#pageTitle")) === "当前不是 Netflix 页面", { message: "not-netflix state" });
      assert((await popup.textContent("#pageAction")) === "打开 Netflix", "action label");
      assert(!(await popup.isDisabled("#scoreSource")), "settings locked");
      await shot(popup, "non-netflix-tab");
      const opened = env.context.waitForEvent("page", { timeout: 5000 });
      await popup.click("#pageAction");
      const tab = await opened;
      await tab.waitForLoadState("domcontentloaded");
      assert(tab.url().startsWith("https://www.netflix.com/"), tab.url());
      await tab.close();
      await other.close();
      await netflix.bringToFront();
    });

    await check("RESCAN from popup clears page state and refetches", async () => {
      await waitFor(async () => /已查询|已完成|正在获取/.test(await popup.textContent("#pageTitle")), { message: "netflix state back" });
      await popup.click("#rescan");
      await waitFor(async () => /已重新扫描/.test(await popup.textContent("#rescanStatus")), { message: "rescan success" });
      await waitFor(async () => {
        const p = await env.getPage();
        return p.summary.matched >= 3 && p.summary.pending === 0;
      }, { timeout: NET_TIMEOUT, message: "page refilled" });
    });

    report.evidence.finalPage = (await env.getPage())?.summary;
    await shot(netflix, "netflix-fixture-final");
  } finally {
    currentPopup = null;
    await env.close();
  }
}

// ---------------------------------------------------------------------------
// Phase 2: DNS resolves nothing → provider outage vs device offline
// ---------------------------------------------------------------------------
async function offlinePhase() {
  const env = await launch({ offline: true });
  try {
    await env.seed({ cache: false });
    await env.open();
    const { popup } = env;
    currentPopup = popup;

    await check("[no DNS] lookups fail visibly: list shows 获取失败, stats count errors", async () => {
      await waitFor(async () => (await env.getPage())?.summary.errors >= 1, { timeout: NET_TIMEOUT, message: "errors in summary" });
      await selectPanel(popup, "titles");
      await waitFor(async () => (await popup.locator('.title-item[data-status="error"]').count()) >= 1, { message: "error rows" });
      const sub = await text(popup.locator('.title-item[data-status="error"] .title-sub').first());
      const stats = await text(popup.locator("#stats"));
      assert(/获取失败/.test(sub) && /失败[1-9]/.test(stats), `${sub} | ${stats}`);
      await shot(popup, "outage-titles");
      return stats;
    });

    await selectPanel(popup, "sources");
    await check("[no DNS, online] source check shows 请求失败, OMDb stays 未配置 Key", async () => {
      await popup.click("#testProviders");
      await waitFor(async () => !(await popup.getAttribute("#testProviders", "aria-busy")), { timeout: NET_TIMEOUT, message: "check done" });
      const rows = await popup.locator(".health").evaluateAll((els) => els.map((e) => ({ name: e.querySelector(".h-name").firstChild.textContent, tone: e.dataset.status, label: e.querySelector(".h-state").textContent, message: e.querySelector(".h-msg")?.textContent || "" })));
      report.evidence.providersOutage = { summary: await popup.textContent("#testStatus"), rows };
      assert(rows.filter((r) => r.name !== "OMDb").every((r) => r.tone === "error" && r.label === "请求失败"), JSON.stringify(rows));
      assert(rows.find((r) => r.name === "OMDb")?.tone === "not_configured", "OMDb tone");
      await shot(popup, "outage-sources");
      return report.evidence.providersOutage.summary;
    });

    await check("[device offline] the same failure is labelled 设备离线", async () => {
      await env.context.setOffline(true);
      await popup.click("#testProviders");
      await waitFor(async () => !(await popup.getAttribute("#testProviders", "aria-busy")), { timeout: NET_TIMEOUT, message: "check done" });
      const tones = await popup.locator(".health").evaluateAll((els) => els.map((e) => `${e.querySelector(".h-name").firstChild.textContent}:${e.dataset.status}`));
      const summary = await popup.textContent("#testStatus");
      report.evidence.providersOffline = { summary, tones };
      assert(tones.filter((t) => !t.startsWith("OMDb")).every((t) => t.endsWith(":offline")), tones.join(", "));
      assert(tones.includes("OMDb:not_configured"), tones.join(", "));
      assert(/离线/.test(summary), summary);
      await shot(popup, "offline-sources");
      await env.context.setOffline(false);
      return summary;
    });
  } finally {
    currentPopup = null;
    await env.close();
  }
}

// ---------------------------------------------------------------------------
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
report.boundaries = [
  "popup.html runs as a background tab in the Netflix tab's window, not as the toolbar bubble (CfT does not expose chrome.action.openPopup() pages to Playwright). Same origin, same chrome.* APIs; activeTab is never granted, so non-Netflix tabs have no readable URL.",
  "Netflix DOM is a local fixture served for https://www.netflix.com/browse; the real Netflix site, login and its markup drift are not exercised.",
  "First-screen results for four cards are seeded cache entries; Stranger Things, every search, bind, re-match after unbind/clear-cache and provider checks are real network calls.",
  "OMDb is exercised only with an obviously invalid key (real rejection path); a valid key and real RT/Metacritic data are not covered.",
  "Offline uses DNS that resolves nothing plus Playwright offline emulation for navigator.onLine; real Wi-Fi loss is not simulated."
];
try {
  await onlinePhase();
  await offlinePhase();
} catch (error) {
  report.fatal = error.stack || String(error);
  console.error(error);
}
report.finishedAt = new Date().toISOString();
const passed = report.checks.filter((c) => c.passed).length;
report.summary = { passed, failed: report.checks.length - passed, total: report.checks.length, pageErrors: report.pageErrors.length };
await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nRESULT ${passed}/${report.checks.length} · page errors ${report.pageErrors.length} · ${join(out, "report.json")}`);
if (report.fatal || passed !== report.checks.length || report.pageErrors.length) process.exitCode = 1;
