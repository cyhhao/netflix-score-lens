// Run: node --test tests/popup.test.mjs
// Pure popup logic only; DOM behaviour is exercised in a real browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { localizeMessage, setLanguage, t } from "../i18n.js";
import { POPUP_MESSAGES } from "../i18n-popup.js";
import {
  canonicalRatingKey,
  classifyUrl,
  confidenceLabel,
  convertThreshold,
  describeHealth,
  entryStatus,
  extractImdbId,
  filterEntries,
  formatRating,
  formatThreshold,
  isBelowThreshold,
  isManualResult,
  normalizeRatings,
  pageProgress,
  parseYearInput,
  pickRating,
  rankCandidates,
  providerInfo,
  relativeTime,
  scaleOf,
  stepOf
} from "../popup.js";

// Legacy expectations are Chinese; pin the locale instead of inheriting the machine's.
before(() => setLanguage("zh-CN"));

describe("threshold scales", () => {
  it("uses 0..10 for auto/imdb/tvmaze and 0..100 for rt/metacritic", () => {
    for (const source of ["auto", "imdb", "tvmaze"]) {
      assert.equal(scaleOf(source), 10);
      assert.equal(stepOf(source), 0.1);
    }
    for (const source of ["rt", "metacritic"]) {
      assert.equal(scaleOf(source), 100);
      assert.equal(stepOf(source), 1);
    }
  });

  it("converts thresholds between scales without drift", () => {
    assert.equal(convertThreshold(7, "imdb", "rt"), 70);
    assert.equal(convertThreshold(7.3, "auto", "metacritic"), 73);
    assert.equal(convertThreshold(65, "rt", "imdb"), 6.5);
    assert.equal(convertThreshold(66, "metacritic", "tvmaze"), 6.6);
    assert.equal(convertThreshold(7.5, "imdb", "tvmaze"), 7.5);
    assert.equal(convertThreshold(80, "rt", "metacritic"), 80);
    // A round trip lands back on the same value.
    assert.equal(convertThreshold(convertThreshold(6.8, "imdb", "rt"), "rt", "imdb"), 6.8);
  });

  it("clamps and recovers from invalid values", () => {
    assert.equal(convertThreshold(12, "imdb", "imdb"), 10);
    assert.equal(convertThreshold(-3, "rt", "rt"), 0);
    assert.equal(convertThreshold("abc", "imdb", "rt"), 70);
    assert.equal(convertThreshold(undefined, "rt", "imdb"), 7);
  });

  it("formats thresholds on the selected native scale", () => {
    assert.deepEqual(formatThreshold(7, "imdb"), { value: "7.0", unit: "/ 10" });
    assert.deepEqual(formatThreshold(70, "rt"), { value: "70", unit: "%" });
    assert.deepEqual(formatThreshold(64.6, "metacritic"), { value: "65", unit: "/ 100" });
  });
});

describe("ratings", () => {
  const ratings = {
    imdb: { value: 8.8, scale: 10, provider: "Cinemeta", url: "https://www.imdb.com/title/tt1375666/" },
    tvmaze: { value: 7.9, scale: 10, provider: "TVmaze", url: "https://www.tvmaze.com/shows/1" },
    rt: { value: 87, scale: 100, provider: "OMDb", url: "" },
    metacritic: { value: 74, scale: 100, provider: "OMDb", url: "" }
  };

  it("follows core.js order for auto: IMDb, TVmaze, RT, Metacritic", () => {
    assert.equal(pickRating(ratings, "auto").key, "imdb");
    assert.equal(pickRating({ tvmaze: ratings.tvmaze, rt: ratings.rt }, "auto").key, "tvmaze");
    assert.equal(pickRating({ metacritic: ratings.metacritic, rt: ratings.rt }, "auto").key, "rt");
    assert.equal(pickRating({}, "auto"), null);
  });

  it("never substitutes another source for an explicit one", () => {
    assert.equal(pickRating({ imdb: ratings.imdb }, "rt"), null);
    assert.equal(pickRating({ imdb: ratings.imdb }, "tvmaze"), null);
    assert.equal(pickRating(ratings, "metacritic").rating.value, 74);
  });

  it("ignores missing or non-numeric values", () => {
    assert.deepEqual(normalizeRatings({ imdb: { value: null, scale: 10 }, tvmaze: { value: "", scale: 10 } }), {});
    assert.equal(pickRating({ imdb: { value: "n/a" } }, "imdb"), null);
    assert.equal(pickRating(null, "auto"), null);
  });

  it("accepts common aliases for OMDb keys", () => {
    assert.equal(canonicalRatingKey("mc"), "metacritic");
    assert.equal(canonicalRatingKey("rottenTomatoes"), "rt");
    assert.equal(pickRating({ mc: { value: 61, scale: 100 } }, "metacritic").rating.value, 61);
  });

  it("formats each rating on its own scale", () => {
    assert.deepEqual(formatRating(ratings.imdb, "imdb"), { text: "8.8", unit: "/10" });
    assert.deepEqual(formatRating(ratings.rt, "rt"), { text: "87", unit: "%" });
    assert.deepEqual(formatRating(ratings.metacritic, "metacritic"), { text: "74", unit: "/100" });
    assert.deepEqual(formatRating({ value: 61 }, "metacritic"), { text: "61", unit: "/100" });
  });

  it("compares against the threshold on the selected scale", () => {
    assert.equal(isBelowThreshold(ratings.imdb, "imdb", { scoreSource: "imdb", minScore: 9 }), true);
    assert.equal(isBelowThreshold(ratings.imdb, "imdb", { scoreSource: "auto", minScore: 8.8 }), false);
    assert.equal(isBelowThreshold(ratings.rt, "rt", { scoreSource: "rt", minScore: 90 }), true);
    assert.equal(isBelowThreshold(ratings.rt, "rt", { scoreSource: "rt", minScore: 87 }), false);
    // auto compares a 0..100 fallback on the 0..10 scale, like core.js isLow.
    assert.equal(isBelowThreshold(ratings.rt, "rt", { scoreSource: "auto", minScore: 9 }), true);
    assert.equal(isBelowThreshold(ratings.rt, "rt", { scoreSource: "auto", minScore: 8.5 }), false);
    assert.equal(isBelowThreshold({ value: null }, "imdb", { scoreSource: "imdb", minScore: 5 }), false);
  });
});

describe("active tab classification", () => {
  it("separates Netflix, other sites, restricted pages and unknown urls", () => {
    assert.equal(classifyUrl("https://www.netflix.com/browse"), "netflix");
    assert.equal(classifyUrl("https://netflix.com/title/80057281"), "netflix");
    assert.equal(classifyUrl("https://www.netflix.com.evil.example/"), "other");
    assert.equal(classifyUrl("https://example.com/"), "other");
    assert.equal(classifyUrl("http://localhost:8765/test-page.html"), "other");
    assert.equal(classifyUrl("chrome://extensions/"), "restricted");
    assert.equal(classifyUrl("chrome-extension://abc/popup.html"), "restricted");
    assert.equal(classifyUrl("about:blank"), "restricted");
    assert.equal(classifyUrl("https://chromewebstore.google.com/detail/x"), "restricted");
    assert.equal(classifyUrl("https://chrome.google.com/webstore/detail/x"), "restricted");
    assert.equal(classifyUrl(undefined), "unknown");
    assert.equal(classifyUrl("not a url"), "unknown");
  });
});

describe("correction input", () => {
  it("extracts IMDb ids from ids and links", () => {
    assert.equal(extractImdbId("tt1375666"), "tt1375666");
    assert.equal(extractImdbId(" https://www.imdb.com/title/tt10919420/?ref_=nv "), "tt10919420");
    assert.equal(extractImdbId("m.imdb.com/title/tt0245429"), "tt0245429");
    assert.equal(extractImdbId("Inception"), null);
    assert.equal(extractImdbId("tt12"), null);
  });

  it("accepts an empty or four-digit year only", () => {
    assert.deepEqual(parseYearInput(""), { ok: true, year: undefined });
    assert.deepEqual(parseYearInput(" 2021 "), { ok: true, year: 2021 });
    assert.equal(parseYearInput("21").ok, false);
    assert.equal(parseYearInput("3021").ok, false);
  });
});

describe("search candidates", () => {
  // Shape and order seen live for "Rebecca" (movie, 2020): the 1940 film came first.
  const live = [
    { id: "tt0032976", title: "Rebecca", year: 1940, type: "movie" },
    { id: "tt2235695", title: "Rebecca", year: 2020, type: "movie" },
    { id: "tt0030657", title: "Rebecca", year: null, type: "movie" },
    { id: "tt10430534", title: "Rebecca", year: 2019, type: "movie" }
  ];

  it("puts the requested year first, keeps provider order otherwise", () => {
    assert.deepEqual(rankCandidates(live, 2020).shown.map((c) => c.id), ["tt2235695", "tt10430534", "tt0032976", "tt0030657"]);
    assert.deepEqual(rankCandidates(live).shown.map((c) => c.id), live.map((c) => c.id));
  });

  it("caps long lists and reports the full count", () => {
    const many = Array.from({ length: 27 }, (_, i) => ({ id: `tt${String(1000000 + i)}`, year: 2000 + i }));
    const { shown, total } = rankCandidates(many, 2020);
    assert.equal(total, 27);
    assert.equal(shown.length, 8);
    assert.equal(shown[0].year, 2020);
    assert.deepEqual(rankCandidates(null), { shown: [], total: 0 });
  });
});

describe("page state", () => {
  it("counts only answered cards as done; off-screen cards are waiting", () => {
    // Shape produced by content.js summary(): waiting cards are in no bucket.
    assert.deepEqual(
      pageProgress({ discovered: 40, pending: 10, matched: 20, ambiguous: 2, unmatched: 3, errors: 1 }),
      { total: 40, pending: 10, done: 26, waiting: 4, ratio: 0.65 }
    );
    assert.deepEqual(pageProgress({ discovered: 1, pending: 0, matched: 0 }), { total: 1, pending: 0, done: 0, waiting: 1, ratio: 0 });
    assert.deepEqual(pageProgress({ discovered: 0 }), { total: 0, pending: 0, done: 0, waiting: 0, ratio: 0 });
    assert.equal(pageProgress({ discovered: 5, pending: 9, matched: 3 }).done, 0);
    assert.equal(pageProgress().total, 0);
  });

  it("treats a missing result as pending", () => {
    assert.equal(entryStatus({ item: { key: "a" } }), "pending");
    assert.equal(entryStatus({ item: { key: "a" }, result: { status: "ambiguous" } }), "ambiguous");
  });

  it("filters by attention, rated and title text", () => {
    const entries = [
      { item: { key: "1", title: "Dark" }, result: { status: "ok", title: "Dark" } },
      { item: { key: "2", title: "黑暗荣耀" }, result: { status: "ok", title: "The Glory" } },
      { item: { key: "3", title: "Rebecca" }, result: { status: "ambiguous" } },
      { item: { key: "4", title: "Unknown" }, result: { status: "not_found" } },
      { item: { key: "5", title: "Broken" }, result: { status: "error" } },
      { item: { key: "6", title: "Loading" } },
      { item: { key: "7", title: "No score" }, result: { status: "no_rating" } }
    ];
    const keys = (list) => list.map((e) => e.item.key);
    assert.deepEqual(keys(filterEntries(entries, "all", "")), ["1", "2", "3", "4", "5", "6", "7"]);
    assert.deepEqual(keys(filterEntries(entries, "attention", "")), ["3", "4", "5"]);
    assert.deepEqual(keys(filterEntries(entries, "ok", "")), ["1", "2"]);
    assert.deepEqual(keys(filterEntries(entries, "all", "glory")), ["2"]);
    assert.deepEqual(keys(filterEntries(entries, "all", "黑暗")), ["2"]);
    // The open row stays visible after it stops matching the filter (e.g. just bound).
    assert.deepEqual(keys(filterEntries(entries, "attention", "", "1")), ["1", "3", "4", "5"]);
  });

  it("labels string and numeric confidence", () => {
    assert.equal(confidenceLabel("high"), "高置信度");
    assert.equal(confidenceLabel("localized"), "别名匹配，建议核对");
    assert.equal(confidenceLabel(0.82), "置信度 82%");
    assert.equal(confidenceLabel(undefined), "");
  });

  it("recognises manual bindings", () => {
    assert.equal(isManualResult({ confidence: "manual", matchReason: "你已确认此匹配" }), true);
    assert.equal(isManualResult({ matchReason: "manual" }), true);
    assert.equal(isManualResult({ confidence: "high", matchReason: "标题一致" }), false);
    assert.equal(isManualResult({ matchReason: "exact title + year" }), false);
    assert.equal(isManualResult(null), false);
  });
});

describe("provider health", () => {
  it("distinguishes ok, not configured, failure and offline", () => {
    assert.deepEqual(describeHealth("ok"), { tone: "ok", label: "正常" });
    assert.deepEqual(describeHealth("not_configured"), { tone: "not_configured", label: "未配置 Key" });
    assert.deepEqual(describeHealth("error", true), { tone: "error", label: "请求失败" });
    assert.deepEqual(describeHealth("error", false), { tone: "offline", label: "设备离线" });
    // An unconfigured key is never reported as offline.
    assert.equal(describeHealth("not_configured", false).tone, "not_configured");
    // A title without data is not a provider outage.
    assert.equal(describeHealth("no_rating").tone, "ok");
    assert.equal(describeHealth("not_found").tone, "ok");
  });

  it("labels known providers and keeps unknown names", () => {
    assert.equal(providerInfo("Cinemeta").label, "IMDb");
    assert.equal(providerInfo("TVmaze").label, "TVmaze");
    assert.equal(providerInfo("OMDb").label, "OMDb");
    assert.equal(providerInfo("Search").label, "标题检索");
    assert.equal(providerInfo("Something").label, "Something");
  });

  it("describes times relative to now", () => {
    const now = Date.parse("2026-10-19T05:00:00Z");
    assert.equal(relativeTime(now - 10_000, now), "刚刚");
    assert.equal(relativeTime(now - 5 * 60_000, now), "5 分钟前");
    assert.equal(relativeTime(new Date(now - 3 * 3600_000).toISOString(), now), "3 小时前");
    assert.equal(relativeTime("garbage", now), "");
  });
});

describe("English and browser-language UI", () => {
  after(() => setLanguage("zh-CN"));

  it("follows the browser language in auto mode and falls back to English", () => {
    assert.equal(setLanguage("auto", ["zh-TW", "en-US"]), "zh-CN");
    assert.equal(describeHealth("ok").label, "正常");
    assert.equal(setLanguage("auto", ["fr-FR"]), "en");
    assert.equal(describeHealth("ok").label, "OK");
    assert.equal(setLanguage("auto", ["en-GB"]), "en");
    assert.equal(setLanguage("zh-CN", ["en-US"]), "zh-CN");
  });

  it("renders labels, confidence and health in English", () => {
    setLanguage("en");
    assert.equal(confidenceLabel("high"), "High confidence");
    assert.equal(confidenceLabel("localized"), "Alias match; please verify");
    assert.equal(confidenceLabel(0.82), "Confidence 82%");
    assert.deepEqual(describeHealth("not_configured"), { tone: "not_configured", label: "No key" });
    assert.deepEqual(describeHealth("error", false), { tone: "offline", label: "Offline" });
    assert.equal(describeHealth("mystery").label, "mystery");
  });

  it("translates app labels but keeps provider identities", () => {
    setLanguage("en");
    assert.deepEqual(providerInfo("Search"), { label: "Title search", note: "Cinemeta / IMDb" });
    assert.deepEqual(providerInfo("Cinemeta"), { label: "IMDb", note: "via Cinemeta mirror" });
    assert.equal(providerInfo("rt").label, "Rotten Tomatoes");
    assert.equal(providerInfo("OMDb").note, "Rotten Tomatoes / Metacritic");
    assert.equal(providerInfo("Something").label, "Something");
    assert.equal(providerInfo("").label, "Unknown source");
  });

  it("describes relative times in English", () => {
    setLanguage("en");
    const now = Date.parse("2026-10-19T05:00:00Z");
    assert.equal(relativeTime(now - 10_000, now), "Just now");
    assert.equal(relativeTime(now - 5 * 60_000, now), "5 min ago");
    assert.equal(relativeTime(now - 3 * 3600_000, now), "3 h ago");
    assert.match(relativeTime(now - 3 * 86400_000, now), /^Oct 1[56]$/);
  });

  it("localizes backend messages without touching titles", () => {
    setLanguage("en");
    assert.equal(localizeMessage("你已确认此匹配"), "You confirmed this match");
    assert.equal(localizeMessage("请求成功"), "Request succeeded");
    assert.equal(localizeMessage("扩展后台没有响应，请稍后重试"), "The extension background didn't respond; try again shortly");
    assert.equal(localizeMessage("黑暗荣耀"), "黑暗荣耀");
    assert.equal(t("已绑定为「{title}」，页面评分正在刷新。", { title: "黑暗荣耀 (2022)" }), "Bound to “黑暗荣耀 (2022)”; ratings on the page are refreshing.");
  });
});

// Every Chinese string the popup can show must be a catalog key with an English
// translation, so untranslated text cannot slip in unnoticed.
describe("catalog coverage", () => {
  const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  // Native language names are deliberately shown untranslated.
  const NATIVE = new Set(["简体中文"]);

  after(() => setLanguage("zh-CN"));

  function assertTranslated(key, where) {
    setLanguage("en");
    const english = t(key);
    assert.notEqual(english, key, `${where}: no English for "${key}"`);
    assert.doesNotMatch(english, CJK, `${where}: English for "${key}" still has Chinese`);
    for (const token of key.match(/\{\w+\}/g) || []) assert.ok(english.includes(token), `${where}: "${key}" lost ${token}`);
  }

  it("translates every Chinese string literal in popup.js", () => {
    const source = read("popup.js").replace(/^\s*\/\/.*$/gm, "");
    const literals = [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).filter((text) => CJK.test(text));
    assert.ok(literals.length > 100, "literal scan found too little");
    for (const literal of literals) assertTranslated(literal, "popup.js");
    assert.deepEqual([...source.matchAll(/[`'][^`'\n]*[\u3400-\u9fff][^`'\n]*[`']/g)].map((m) => m[0]), [], "Chinese outside double-quoted catalog keys");
  });

  it("annotates every Chinese text and attribute in popup.html", () => {
    const html = read("popup.html").replace(/<!--[\s\S]*?-->/g, "");
    for (const [, tag, attrs, text] of html.matchAll(/<([a-z][\w-]*)([^>]*)>([^<]*)/gi)) {
      const label = text.trim();
      if (label && CJK.test(label) && !NATIVE.has(label)) {
        assert.equal(attrs.match(/data-i18n="([^"]*)"/)?.[1], label, `<${tag}> text "${label}" is not annotated`);
      }
      for (const [, name, value] of attrs.matchAll(/\s(title|placeholder|aria-label)="([^"]*)"/g)) {
        if (CJK.test(value)) assert.equal(attrs.match(new RegExp(`data-i18n-${name}="([^"]*)"`))?.[1], value, `<${tag} ${name}="${value}"> is not annotated`);
      }
    }
    for (const [, text] of html.matchAll(/<\/[a-z][\w-]*>([^<]*)/gi)) {
      assert.doesNotMatch(text, CJK, `loose text "${text.trim()}" after a closing tag`);
    }
    for (const [, key] of html.matchAll(/data-i18n(?:-title|-placeholder|-aria-label)?="([^"]*)"/g)) assertTranslated(key, "popup.html");
  });

  it("keeps CSS free of generated Chinese text", () => {
    assert.doesNotMatch(read("popup.css"), CJK);
  });

  it("has English for every popup catalog entry", () => {
    for (const key of Object.keys(POPUP_MESSAGES)) assertTranslated(key, "i18n-popup.js");
  });
});
