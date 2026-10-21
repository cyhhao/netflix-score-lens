// Score Lens popup. Talks to the background worker via runtime messages and to
// the active tab's content script via tabs messages; see CONTRACT.md.
//
// UI text is written as canonical Chinese catalog keys (i18n-popup.js) and
// rendered through t(); backend/cache messages go through localizeMessage().
// Titles, IDs and provider identities are passed as params, never as keys.

import { formatDate, getLanguage, getLocale, localizeDOM, localizeMessage, setLanguage, t } from "./i18n.js";
import "./i18n-popup.js";
import {diagnosticLines} from './i18n-content.js';
import {netflixTitleUrl} from './core.js';

// A lazily rendered message, so status lines can be redrawn after a language switch.
const msg = (key, params) => () => t(key, params);

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests/popup.test.mjs)
// ---------------------------------------------------------------------------

export const SOURCES = {
  auto: { label: "自动", scale: 10 },
  imdb: { label: "IMDb", scale: 10 },
  tvmaze: { label: "TVmaze", scale: 10 },
  rt: { label: "烂番茄", scale: 100 },
  metacritic: { label: "Metacritic", scale: 100 }
};

const RATING_INFO = {
  imdb: { label: "IMDb", short: "IMDb", note: "经 Cinemeta 镜像" },
  tvmaze: { label: "TVmaze", short: "TVmaze", note: "TVmaze 用户评分 · CC BY-SA" },
  rt: { label: "烂番茄", short: "烂番茄", note: "来自 OMDb" },
  metacritic: { label: "Metacritic", short: "MC", note: "来自 OMDb" }
};

const TYPE_LABEL = { movie: "电影", series: "剧集" };
const ATTENTION = new Set(["ambiguous", "not_found", "error"]);
const NETFLIX_HOME = "https://www.netflix.com/browse";

export function scaleOf(source) {
  return SOURCES[source]?.scale ?? 10;
}

export function stepOf(source) {
  return scaleOf(source) === 100 ? 1 : 0.1;
}

function roundToStep(value, step) {
  return step >= 1 ? Math.round(value) : Math.round(value * 10) / 10;
}

// Keeps the same relative threshold when switching between 0..10 and 0..100 sources.
export function convertThreshold(value, from, to) {
  const target = scaleOf(to);
  const number = Number(value);
  const scaled = Number.isFinite(number) ? (number * target) / scaleOf(from) : target * 0.7;
  return roundToStep(Math.min(target, Math.max(0, scaled)), stepOf(to));
}

export function formatThreshold(value, source) {
  const scale = scaleOf(source);
  const number = Number(value) || 0;
  return {
    value: scale === 100 ? String(Math.round(number)) : number.toFixed(1),
    unit: source === "rt" ? "%" : `/ ${scale}`
  };
}

export function canonicalRatingKey(key) {
  const k = String(key).toLowerCase().replace(/[^a-z]/g, "");
  if (k === "rt" || k === "rottentomatoes" || k === "tomatometer") return "rt";
  if (k === "mc" || k === "metacritic" || k === "metascore") return "metacritic";
  return k;
}

export function normalizeRatings(ratings) {
  const out = {};
  if (!ratings || typeof ratings !== "object") return out;
  for (const [key, rating] of Object.entries(ratings)) {
    if (rating && ratingValue(rating) !== null) out[canonicalRatingKey(key)] = rating;
  }
  return out;
}

export function ratingValue(rating) {
  const value = Number(rating?.value);
  return rating?.value !== null && rating?.value !== "" && Number.isFinite(value) ? value : null;
}

function ratingScale(rating, key) {
  const scale = Number(rating?.scale);
  if (scale === 10 || scale === 100) return scale;
  return key === "rt" || key === "metacritic" ? 100 : 10;
}

// Same order as core.js ratingChoice: "auto" takes the first available source.
const AUTO_ORDER = ["imdb", "tvmaze", "rt", "metacritic"];

export function pickRating(ratings, source) {
  const normalized = normalizeRatings(ratings);
  const keys = source === "auto" ? AUTO_ORDER : [source];
  for (const key of keys) if (normalized[key]) return { key, rating: normalized[key] };
  return null;
}

export function formatRating(rating, key) {
  const value = ratingValue(rating);
  if (value === null) return null;
  const scale = ratingScale(rating, key);
  return {
    text: scale === 100 ? String(Math.round(value)) : value.toFixed(1),
    unit: key === "rt" ? "%" : `/${scale}`
  };
}

export function isBelowThreshold(rating, key, settings) {
  const value = ratingValue(rating);
  if (value === null || !settings) return false;
  const sourceScale = scaleOf(settings.scoreSource);
  const comparable = (value * sourceScale) / ratingScale(rating, key);
  return comparable < Number(settings.minScore);
}

export function classifyUrl(url) {
  if (!url) return "unknown";
  let parsed;
  try { parsed = new URL(url); } catch { return "unknown"; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "restricted";
  const host = parsed.hostname;
  if (host === "chromewebstore.google.com" || (host === "chrome.google.com" && parsed.pathname.startsWith("/webstore"))) return "restricted";
  if (host === "netflix.com" || host.endsWith(".netflix.com")) return "netflix";
  return "other";
}

export function extractImdbId(text) {
  return String(text || "").match(/\b(tt\d{7,10})\b/)?.[1] || null;
}

export function parseYearInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: true, year: undefined };
  if (!/^(18|19|20)\d{2}$/.test(raw)) return { ok: false };
  return { ok: true, year: Number(raw) };
}

// content.js only queries cards near the viewport; the rest are "waiting" and
// are counted in `discovered` but in none of the result buckets.
// Providers return their own order; when the user gave a year, closest years
// come first (stable, unknown years last). Long lists are cut to `limit`.
export const SEARCH_LIMIT = 8;
export function rankCandidates(candidates, year, limit = SEARCH_LIMIT) {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c?.id) : [];
  if (Number.isInteger(year)) {
    const distance = (c) => (Number.isInteger(c.year) ? Math.abs(c.year - year) : Infinity);
    list.sort((a, b) => distance(a) - distance(b));
  }
  return { shown: list.slice(0, limit), total: list.length };
}

export function pageProgress(summary = {}) {
  const n = (key) => Math.max(0, Number(summary[key]) || 0);
  const total = n("discovered");
  const pending = Math.min(total, n("pending"));
  const done = Math.min(total - pending, n("matched") + n("ambiguous") + n("unmatched") + n("errors"));
  return { total, pending, done, waiting: total - pending - done, ratio: total ? done / total : 0 };
}

export function entryStatus(entry) {
  return entry?.result?.status || "pending";
}

export function isManualResult(result) {
  if (!result) return false;
  if (result.confidence === "manual" || result.manual === true) return true;
  return /manual|override|手动/i.test(String(result.matchReason || ""));
}

// The pinned key (the open correction panel) stays listed so it cannot vanish mid-edit.
export function filterEntries(entries, filter, query, pinned = null) {
  const needle = String(query || "").trim().toLowerCase();
  return entries.filter((entry) => {
    if (pinned && entry.item?.key === pinned) return true;
    const status = entryStatus(entry);
    if (filter === "attention" && !ATTENTION.has(status)) return false;
    if (filter === "ok" && status !== "ok") return false;
    if (!needle) return true;
    const haystack = `${entry.item?.title || ""} ${entry.result?.title || ""} ${entry.result?.netflixTitle?.title || ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function confidenceLabel(confidence) {
  if (confidence === undefined || confidence === null || confidence === "") return "";
  const number = Number(confidence);
  if (Number.isFinite(number)) return number > 0 ? t("置信度 {percent}%", { percent: Math.round(number <= 1 ? number * 100 : number) }) : "";
  const label = { high: "高置信度", localized: "别名匹配，建议核对", manual: "手动指定", low: "低置信度" }[confidence];
  return label ? t(label) : String(confidence);
}

export function relativeTime(at, now = Date.now()) {
  const time = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return t("刚刚");
  if (seconds < 3600) return t("{count} 分钟前", { count: Math.round(seconds / 60) });
  if (seconds < 86400) return t("{count} 小时前", { count: Math.round(seconds / 3600) });
  return formatDate(time, { month: "short", day: "numeric" });
}

// Maps a provider check/health status to a display tone and localized label.
// An error while the device reports offline is shown as offline, not as a provider fault.
export function describeHealth(status, online = true) {
  if (status === "ok") return { tone: "ok", label: t("正常") };
  if (status === "not_configured") return { tone: "not_configured", label: t("未配置 Key") };
  if (status === "error") return online ? { tone: "error", label: t("请求失败") } : { tone: "offline", label: t("设备离线") };
  // Per-request outcomes: the service answered, this title just had no data.
  if (status === "no_rating" || status === "not_found") return { tone: "ok", label: t("可用") };
  if (status === "checking") return { tone: "checking", label: t("验证中…") };
  return { tone: "warn", label: status ? String(status) : t("未知") };
}

const PROVIDERS = {
  cinemeta: { label: "IMDb", note: "经 Cinemeta 镜像" },
  imdb: { label: "IMDb", note: "评分与搜索" },
  imdbsuggest: { label: "IMDb 搜索", note: "中日韩片名" },
  imdbsearch: { label: "IMDb 搜索", note: "中日韩片名" },
  tvmaze: { label: "TVmaze", note: "剧集 · CC BY-SA" },
  search: { label: "标题检索", note: "Cinemeta / IMDb" },
  omdb: { label: "OMDb", note: "烂番茄 / Metacritic" },
  rt: { label: "烂番茄", note: "OMDb" },
  metacritic: { label: "Metacritic", note: "OMDb" }
};

// Unknown provider names are identities and are shown as-is.
export function providerInfo(name) {
  const known = PROVIDERS[String(name || "").toLowerCase().replace(/[^a-z]/g, "")];
  if (known) return { label: t(known.label), note: t(known.note) };
  return { label: name ? String(name) : t("未知来源"), note: "" };
}

// Returns a canonical (Chinese) message; display it with localizeMessage().
export function friendlyError(message) {
  const text = String(message || "");
  if (/Receiving end does not exist|Could not establish connection/i.test(text)) return "扩展后台暂时无法连接，请重新打开面板";
  if (/context invalidated/i.test(text)) return "扩展已更新，请关闭并重新打开面板";
  if (/Failed to fetch|NetworkError|network/i.test(text) && !navigator?.onLine) return "设备离线，请检查网络";
  return text || "操作失败";
}

const errorText = (error) => localizeMessage(error?.message || "操作失败");

function typeLabel(type) {
  return TYPE_LABEL[type] ? t(TYPE_LABEL[type]) : "";
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const $ = (selector, root = document) => root.querySelector(selector);
const SETTING_INPUTS = ["enabled", "scoreSource", "minScore", "dimLowScores", "dimOpacity", "revealOnHover", "useOmdb", "language"];
const POLL_MS = 1500;
const UI_POLL_MS = 5000;

const state = {
  settings: null,
  hasApiKey: false,
  cacheEntries: null,
  providerHealth: {},
  checks: null,
  checksAt: 0,
  testing: false,
  page: { kind: "loading" },
  tab: null,
  entries: new Map(),
  order: [],
  filter: "all",
  query: "",
  expanded: null,
  manualKeys: new Set(),
  removedManual: new Set()
};

const save = { pending: null, sending: null, inFlight: false, failed: null, timer: null, clearTimer: null, view: { tone: "", text: null } };
const timers = [];
const rows = new Map();
// Status lines currently showing a message; redrawn on a language switch.
const liveStatus = new Set();
let ui;

async function callBackground(message) {
  let response;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw new Error(friendlyError(error?.message));
  }
  if (!response) throw new Error("扩展后台没有响应，请稍后重试");
  if (!response.ok) throw new Error(friendlyError(response.error));
  return response;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function callTab(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("没有找到当前标签页");
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    throw new Error("当前页没有运行评分镜片，请刷新 Netflix 页面");
  }
  if (!response) throw new Error("页面没有响应，请刷新 Netflix 页面");
  if (!response.ok) throw new Error(friendlyError(response.error));
  return response;
}

// ----- operation feedback -------------------------------------------------

// `text` is a render function (see msg) or empty to clear the line.
function setStatus(node, tone, text) {
  if (!node) return;
  clearTimeout(node._clear);
  node._text = text || null;
  if (text) liveStatus.add(node);
  else liveStatus.delete(node);
  node.textContent = text ? text() : "";
  node.className = node.className.replace(/\bis-(pending|success|error)\b/g, "").trim();
  if (tone && text) node.classList.add(`is-${tone}`);
}

function clearStatusLater(node, ms = 4000) {
  clearTimeout(node._clear);
  node._clear = setTimeout(() => setStatus(node, "", null), ms);
}

function buttonLabel(button) {
  return $(".btn-label", button) || button;
}

// Button labels carry their catalog key in data-i18n, so localizeDOM keeps
// busy and confirm labels in the current language.
function setLabel(button, key) {
  const node = buttonLabel(button);
  node.dataset.i18n = key;
  node.textContent = t(key);
}

function labelSpan(key) {
  const span = el("span", "btn-label", t(key));
  span.dataset.i18n = key;
  return span;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button._idleKey = buttonLabel(button).dataset.i18n;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
    if (label) setLabel(button, label);
  } else {
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-disabled");
    if (button._idleKey) setLabel(button, button._idleKey);
  }
}

const isBusy = (button) => button?.getAttribute("aria-busy") === "true";

// `pending` is a render function; `success(result)` returns one (or nothing).
async function runOp({ button, status, busyLabel, pending, task, success, clearAfter }) {
  if (isBusy(button)) return null;
  setBusy(button, true, busyLabel);
  setStatus(status, "pending", pending);
  try {
    const result = await task();
    setStatus(status, "success", success?.(result));
    if (clearAfter) clearStatusLater(status, clearAfter);
    return result;
  } catch (error) {
    setStatus(status, "error", () => errorText(error));
    return null;
  } finally {
    setBusy(button, false);
  }
}

// Two-step confirmation for destructive buttons: first press arms, second runs.
function confirmable(button, confirmLabel, action) {
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    button.classList.remove("is-confirm");
    if (button._armedFrom) setLabel(button, button._armedFrom);
  };
  button.addEventListener("click", () => {
    if (isBusy(button)) return;
    if (!armed) {
      button._armedFrom = buttonLabel(button).dataset.i18n;
      setLabel(button, confirmLabel);
      button.classList.add("is-confirm");
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    action();
  });
  button.addEventListener("blur", () => { if (armed) disarm(); });
}

// ----- settings -----------------------------------------------------------

function setSaveState(tone, text) {
  clearTimeout(save.clearTimer);
  save.view = { tone, text: text || null };
  renderSaveState();
  if (tone === "saved") save.clearTimer = setTimeout(() => setSaveState("", null), 2200);
}

function renderSaveState() {
  const { tone, text } = save.view;
  const shown = text ? text() : "";
  ui.saveState.textContent = shown;
  ui.saveState.title = tone === "error" ? shown : "";
  ui.saveState.className = `save-state${tone ? ` is-${tone}` : ""}`;
  ui.saveRetry.hidden = tone !== "error";
  ui.tagline.hidden = Boolean(shown);
}

function queueSave(patch, { delay = 0 } = {}) {
  save.pending = { ...save.pending, ...patch };
  state.settings = { ...state.settings, ...patch };
  clearTimeout(save.timer);
  setSaveState("saving", msg("保存中…"));
  if (delay) save.timer = setTimeout(flushSave, delay);
  else flushSave();
}

async function flushSave() {
  clearTimeout(save.timer);
  if (save.inFlight || !save.pending) return;
  const patch = save.pending;
  save.pending = null;
  save.sending = patch;
  save.inFlight = true;
  try {
    const response = await callBackground({ type: "SAVE_SETTINGS", settings: patch });
    save.failed = null;
    state.hasApiKey = Boolean(response.hasApiKey);
    if (!save.pending) {
      // The worker may normalize values; reflect what was actually stored.
      state.settings = { ...state.settings, ...response.settings };
      applySettings(state.settings);
      setSaveState("saved", msg("已保存"));
    }
    renderKeyState();
    renderPage();
    renderTitles();
  } catch (error) {
    save.failed = { ...patch, ...save.failed };
    setSaveState("error", () => t("保存失败：{error}", { error: errorText(error) }));
  } finally {
    save.inFlight = false;
    save.sending = null;
    if (save.pending) flushSave();
  }
}

function retrySave() {
  if (!state.settings) return loadUi();
  if (save.failed) queueSave(save.failed);
}

function setRangeFill(range) {
  const min = Number(range.min), max = Number(range.max);
  const pct = max > min ? ((Number(range.value) - min) / (max - min)) * 100 : 0;
  range.style.setProperty("--fill", `${pct}%`);
}

function configureThresholdRange(source, value) {
  const range = ui.minScore;
  range.min = "0";
  range.max = String(scaleOf(source));
  range.step = String(stepOf(source));
  range.value = String(value);
  renderThreshold();
}

function renderThreshold() {
  const source = ui.scoreSource.value;
  const { value, unit } = formatThreshold(ui.minScore.value, source);
  ui.minScoreValue.textContent = value;
  ui.minScoreUnit.textContent = unit;
  ui.minScoreMin.textContent = "0";
  ui.minScoreMax.textContent = String(scaleOf(source));
  ui.minScore.setAttribute("aria-valuetext", source === "rt" ? `${value}%` : t("{value} 分，满分 {scale}", { value, scale: scaleOf(source) }));
  setRangeFill(ui.minScore);
  renderPreview();
}

function renderOpacity() {
  const pct = Math.round(Number(ui.dimOpacity.value) * 100);
  ui.dimOpacityOut.textContent = `${pct}%`;
  ui.dimOpacity.setAttribute("aria-valuetext", t("遮罩 {percent}%", { percent: pct }));
  setRangeFill(ui.dimOpacity);
  renderPreview();
}

function renderPreview() {
  const source = ui.scoreSource.value;
  const scale = scaleOf(source);
  const step = stepOf(source);
  const threshold = Number(ui.minScore.value);
  const high = roundToStep(Math.min(scale, threshold + scale * 0.14), step);
  const low = roundToStep(Math.max(0, threshold - scale * 0.13), step);
  const hasLow = low < threshold;
  ui.previewHigh.textContent = formatThreshold(high, source).value + (source === "rt" ? "%" : "");
  ui.previewLow.textContent = formatThreshold(low, source).value + (source === "rt" ? "%" : "");
  const dimOn = ui.dimLowScores.checked && hasLow;
  ui.preview.style.setProperty("--dim", ui.dimOpacity.value);
  ui.preview.classList.toggle("is-dim-off", !dimOn);
  ui.preview.classList.toggle("is-reveal", ui.revealOnHover.checked);
  ui.previewCaption.textContent = t(!ui.dimLowScores.checked ? "已关闭弱化，低分卡片保持原样"
    : !hasLow ? "阈值为 0，不会弱化任何作品"
      : ui.revealOnHover.checked ? "预览 · 把鼠标移到右侧低分卡片上试试"
        : "预览 · 右侧为低于阈值的卡片");
}

function renderDimOptions() {
  const on = ui.dimLowScores.checked;
  ui.dimOptions.classList.toggle("is-off", !on);
  ui.dimOpacity.disabled = !on;
  ui.revealOnHover.disabled = !on;
}

function renderSourceHint() {
  const source = state.settings?.scoreSource;
  const needsOmdb = source === "rt" || source === "metacritic";
  let text = "";
  if (needsOmdb && !state.hasApiKey) text = t("烂番茄 / Metacritic 评分需要 OMDb Key，未配置时不会弱化任何作品。");
  else if (needsOmdb && state.settings.providerMode === "free") text = t("已关闭 OMDb 补充，烂番茄 / Metacritic 不会获取。");
  ui.sourceHint.hidden = !text;
  ui.sourceHintText.textContent = text;
}

function applySettings(settings) {
  applyLanguage(settings.language);
  ui.enabled.checked = settings.enabled !== false;
  ui.scoreSource.value = SOURCES[settings.scoreSource] ? settings.scoreSource : "auto";
  configureThresholdRange(ui.scoreSource.value, settings.minScore ?? convertThreshold(7, "auto", ui.scoreSource.value));
  ui.dimLowScores.checked = settings.dimLowScores !== false;
  ui.dimOpacity.value = String(settings.dimOpacity ?? 0.62);
  ui.revealOnHover.checked = settings.revealOnHover !== false;
  ui.useOmdb.checked = settings.providerMode !== "free";
  renderOpacity();
  renderDimOptions();
  renderSourceHint();
}

function setSettingsDisabled(disabled) {
  for (const id of SETTING_INPUTS) ui[id].disabled = disabled;
  if (!disabled) renderDimOptions();
}

function bindSettings() {
  ui.enabled.addEventListener("change", () => queueSave({ enabled: ui.enabled.checked }));
  ui.scoreSource.addEventListener("change", () => {
    const from = state.settings.scoreSource;
    const to = ui.scoreSource.value;
    const minScore = convertThreshold(ui.minScore.value, from, to);
    configureThresholdRange(to, minScore);
    queueSave({ scoreSource: to, minScore });
    renderSourceHint();
  });
  ui.minScore.addEventListener("input", () => {
    renderThreshold();
    queueSave({ minScore: Number(ui.minScore.value) }, { delay: 300 });
  });
  ui.minScore.addEventListener("change", flushSave);
  ui.dimLowScores.addEventListener("change", () => {
    renderDimOptions();
    renderPreview();
    queueSave({ dimLowScores: ui.dimLowScores.checked });
  });
  ui.dimOpacity.addEventListener("input", () => {
    renderOpacity();
    queueSave({ dimOpacity: Number(ui.dimOpacity.value) }, { delay: 300 });
  });
  ui.dimOpacity.addEventListener("change", flushSave);
  ui.revealOnHover.addEventListener("change", () => {
    renderPreview();
    queueSave({ revealOnHover: ui.revealOnHover.checked });
  });
  ui.useOmdb.addEventListener("change", () => {
    queueSave({ providerMode: ui.useOmdb.checked ? "auto" : "free" });
    renderSourceHint();
  });
  // Language is an ordinary setting: it is saved, but never clears the cache or looks anything up.
  ui.language.addEventListener("change", () => {
    applyLanguage(ui.language.value);
    queueSave({ language: getLanguage() });
  });
  ui.saveRetry.addEventListener("click", retrySave);
  ui.sourceHintGo.addEventListener("click", () => {
    selectTab("sources");
    ui.omdb.open = true;
    (state.hasApiKey ? ui.useOmdb : ui.apiKey).focus();
  });
}

// ----- language -------------------------------------------------------------

function applyLanguage(preference) {
  const before = getLocale();
  setLanguage(preference || "auto");
  ui.language.value = getLanguage();
  if (getLocale() !== before) relocalize();
}

// Settings written by another extension page (e.g. the library's language
// picker). Values this popup has not finished saving keep precedence.
function onStoredSettings(stored) {
  if (!state.settings || !stored || typeof stored !== "object") return;
  const next = { ...state.settings, ...stored, ...save.sending, ...save.pending };
  const changed = Object.keys(next).filter((key) => next[key] !== state.settings[key]);
  if (!changed.length) return;
  state.settings = next;
  if (changed.every((key) => key === "language")) {
    applyLanguage(next.language);
    return;
  }
  applySettings(next);
  renderPage();
  renderTitles();
}

const focusables = (root) => [...root.querySelectorAll("a[href], button, input, select")];

// Redraws all text in the current locale in place: inputs, the open detail,
// search results, filters, the active tab and focus are kept.
function relocalize() {
  if (!ui) return;
  const active = document.activeElement;
  const openRow = [...rows.values()].find((row) => row.detail.contains(active));
  const focusIndex = openRow ? focusables(openRow.detail).indexOf(active) : -1;

  localizeDOM(document);
  for (const row of rows.values()) localizeDOM(row.li);
  for (const node of liveStatus) node.textContent = node._text();
  renderSaveState();
  renderThreshold();
  renderOpacity();
  renderSourceHint();
  renderKeyState();
  renderCache();
  renderHealth();
  renderPage();
  renderTitles();
  for (const row of rows.values()) if (row.found) renderFound(row);

  if (openRow && !openRow.detail.contains(document.activeElement)) focusables(openRow.detail)[focusIndex]?.focus();
}

// ----- UI data (GET_UI) ---------------------------------------------------

async function loadUi() {
  setSaveState("saving", msg("读取设置…"));
  try {
    const response = await callBackground({ type: "GET_UI" });
    state.settings = { ...response.settings };
    applyUiMeta(response);
    applySettings(state.settings);
    setSettingsDisabled(false);
    setSaveState("", null);
    renderPage();
    renderTitles();
  } catch (error) {
    setSaveState("error", () => t("读取设置失败：{error}", { error: errorText(error) }));
  }
}

function applyUiMeta(response) {
  state.hasApiKey = Boolean(response.hasApiKey);
  state.cacheEntries = Number.isFinite(Number(response.cacheEntries)) ? Number(response.cacheEntries) : null;
  state.providerHealth = response.providerHealth && typeof response.providerHealth === "object" ? response.providerHealth : {};
  renderKeyState();
  renderCache();
  renderHealth();
  renderSourceHint();
}

async function refreshUiMeta() {
  if (!state.settings) return;
  try {
    applyUiMeta(await callBackground({ type: "GET_UI" }));
  } catch {
    // The next poll retries; the visible state stays as last known.
  }
}

// ----- page status (GET_PAGE) ---------------------------------------------

let pollBusy = false;

async function pollPage() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const tab = await activeTab();
    state.tab = tab;
    // The manifest's host permission always exposes Netflix tab URLs, so a
    // tab without a readable URL cannot be Netflix.
    const kind = tab && !("url" in tab) ? "other" : classifyUrl(tab?.url);
    if (!tab?.id) state.page = { kind: "no_tab" };
    else if (kind === "restricted") state.page = { kind: "restricted" };
    else {
      let response = null;
      try { response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE" }); } catch { response = null; }
      if (!response) state.page = { kind: kind === "netflix" ? "not_loaded" : kind === "other" ? "not_netflix" : "unknown" };
      else if (!response.ok) state.page = { kind: "page_error", message: friendlyError(response.error) };
      else state.page = { kind: "ready", data: response, netflix: kind === "netflix" };
      ingestItems(state.page.kind === "ready" ? response.items : []);
    }
  } catch (error) {
    state.page = { kind: "page_error", message: friendlyError(error?.message) };
  } finally {
    pollBusy = false;
  }
  renderPage();
  renderTitles();
}

function ingestItems(items) {
  const order = [];
  const next = new Map();
  for (const entry of Array.isArray(items) ? items : []) {
    const key = entry?.item?.key;
    if (!key || next.has(key)) continue;
    order.push(key);
    next.set(key, entry);
  }
  state.order = order;
  state.entries = next;
}

function pageView() {
  const page = state.page;
  const enabled = state.settings?.enabled !== false;
  switch (page.kind) {
    case "loading": return { kind: "loading", title: t("正在连接当前标签页…") };
    case "no_tab": return { kind: "warn", title: t("没有找到当前标签页"), hint: t("切换到 Netflix 标签页后再打开此面板。") };
    case "restricted": return { kind: "warn", title: t("此页面不支持扩展"), hint: t("浏览器内置页面无法运行扩展。设置仍会自动保存。"), action: "open" };
    case "not_netflix": return { kind: "warn", title: t("当前不是 Netflix 页面"), hint: t("设置会自动保存，打开 Netflix 后立即生效。"), action: "open" };
    case "not_loaded": return { kind: "warn", title: t("评分镜片尚未在此页运行"), hint: t("安装或更新扩展后，需要刷新一次 Netflix 页面。"), action: "reload" };
    case "unknown": return { kind: "warn", title: t("当前页没有运行评分镜片"), hint: t("如果这是 Netflix 页面，刷新后再试。"), action: "reload" };
    case "page_error": return { kind: "error", title: t("读取页面状态失败"), hint: localizeMessage(page.message), rescan: true };
    default: break;
  }
  const { summary = {}, version } = page.data;
  const progress = pageProgress(summary);
  const manifestVersion = chrome.runtime.getManifest().version;
  const stale = version && version !== manifestVersion ? t("页面脚本为 v{page}，刷新页面以使用 v{current}。", { page: version, current: manifestVersion }) : "";
  const where = page.netflix ? "" : t("测试页面") + " · ";
  const unresolved = Math.max(0, Number(summary.unresolved) || 0);
  const unresolvedHint = unresolved ? t("{count} 张卡片尚未取得所属剧集信息，暂不纳入作品查询或纠错。", { count: unresolved }) : "";
  if (!enabled) return { kind: "paused", title: t("已暂停"), hint: stale || t("页面上的评分和遮罩已隐藏，打开右上角开关即可恢复。"), action: stale ? "reload" : "" };
  if (!progress.total && unresolved) return { kind: "idle", title: t("正在识别所属剧集"), hint: stale || unresolvedHint, rescan: true, action: stale ? "reload" : "" };
  if (!progress.total) return { kind: "idle", title: t("还没识别到作品卡片"), hint: stale || where + t("在 Netflix 首页、浏览或搜索页会自动识别；播放页没有卡片。"), rescan: true, action: stale ? "reload" : "" };
  const matched = Number(summary.matched) || 0;
  const counts = { done: progress.done, total: progress.total, matched };
  const title = progress.pending
    ? t("正在获取评分 · {done}/{total}", counts)
    : progress.waiting ? t("已查询 {done}/{total} 部 · {matched} 部已匹配", counts)
      : t("已完成 · {matched}/{total} 部已匹配", counts);
  const waitingHint = progress.waiting ? t("其余 {count} 部滚动到附近时自动查询。", { count: progress.waiting }) : "";
  return { kind: progress.pending ? "working" : "done", title, hint: stale || [waitingHint, unresolvedHint, where ? t("测试页面") : ""].filter(Boolean).join(" "), rescan: true, progress, summary, action: stale ? "reload" : "" };
}

function renderPage() {
  if (!ui) return;
  const view = pageView();
  ui.page.dataset.kind = view.kind;
  ui.pageTitle.textContent = view.title;
  ui.pageHint.textContent = view.hint || "";
  ui.rescan.hidden = !view.rescan;
  ui.pageAction.hidden = !view.action;
  ui.pageAction.dataset.action = view.action || "";
  if (!isBusy(ui.pageAction)) setLabel(ui.pageAction, view.action === "open" ? "打开 Netflix" : "刷新页面");
  ui.progress.hidden = !view.progress;
  if (view.progress) {
    ui.progressBar.style.width = `${Math.round(view.progress.ratio * 100)}%`;
    renderStats(view.summary);
  }
}

function renderStats(summary) {
  const n = (key) => Math.max(0, Number(summary[key]) || 0);
  const stats = [
    ["已匹配", n("matched"), "is-ok"],
    ["待确认", n("ambiguous"), n("ambiguous") ? "is-warn" : ""],
    ["未找到", n("unmatched"), ""],
    ["失败", n("errors"), n("errors") ? "is-error" : ""],
    ["可见", n("visible"), ""],
    ["待识别剧集", n("unresolved"), n("unresolved") ? "is-warn" : ""]
  ];
  const signature = `${getLocale()}|${stats.map((s) => s[1]).join(",")}`;
  if (ui.stats.dataset.sig === signature) return;
  ui.stats.dataset.sig = signature;
  ui.stats.replaceChildren(...stats.map(([label, value, tone]) => {
    const wrap = el("div", tone);
    wrap.append(el("dt", "", t(label)), el("dd", "", String(value)));
    return wrap;
  }));
}

async function onPageAction() {
  const action = ui.pageAction.dataset.action;
  if (action === "open") {
    await chrome.tabs.create({ url: NETFLIX_HOME });
    return;
  }
  if (action === "reload") {
    await runOp({
      button: ui.pageAction,
      status: ui.rescanStatus,
      busyLabel: "刷新中…",
      pending: msg("正在刷新页面…"),
      task: async () => {
        const tab = state.tab || await activeTab();
        if (!tab?.id) throw new Error("没有找到当前标签页");
        await chrome.tabs.reload(tab.id);
      },
      success: () => msg("页面已刷新，正在重新识别作品。"),
      clearAfter: 4000
    });
    pollPage();
  }
}

async function onRescan() {
  await runOp({
    button: ui.rescan,
    status: ui.rescanStatus,
    busyLabel: "扫描中…",
    pending: msg("正在重新扫描当前页…"),
    task: () => callTab({ type: "RESCAN" }),
    success: () => msg("已重新扫描，正在获取评分。"),
    clearAfter: 4000
  });
  pollPage();
}

// ----- titles list ----------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href, text, className) {
  const a = el("a", className, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function imdbUrl(result) {
  const fromRating = normalizeRatings(result?.ratings).imdb?.url;
  if (fromRating) return fromRating;
  return /^tt\d+$/.test(result?.id || "") ? `https://www.imdb.com/title/${result.id}/` : "";
}

function metaLine(year, type, extra) {
  return [year, typeLabel(type), extra].filter(Boolean).join(" · ");
}

// Match reasons are canonical backend messages; trailing punctuation is
// dropped so the localized sentence templates can add their own.
function reasonText(result) {
  const reason = String(result?.matchReason || "").replace(/[。.]$/, "");
  return reason ? String(localizeMessage(reason)).replace(/[。.]$/, "") : "";
}

function isManual(key, result) {
  if (state.removedManual.has(key)) return false;
  return state.manualKeys.has(key) || isManualResult(result);
}

function renderTitles() {
  if (!ui) return;
  const entries = state.order.map((key) => state.entries.get(key));
  const counts = { all: entries.length, attention: 0, ok: 0 };
  for (const entry of entries) {
    const status = entryStatus(entry);
    if (ATTENTION.has(status)) counts.attention += 1;
    if (status === "ok") counts.ok += 1;
  }
  for (const [name, value] of Object.entries(counts)) $(`[data-count="${name}"]`).textContent = String(value);
  ui.titlesBadge.hidden = !entries.length;
  ui.titlesBadge.textContent = String(counts.attention || entries.length);
  ui.titlesBadge.classList.toggle("is-warn", counts.attention > 0);
  ui.titlesBadge.title = counts.attention
    ? t(counts.attention === 1 ? "1 部需要处理" : "{count} 部需要处理", { count: counts.attention })
    : t(entries.length === 1 ? "1 部作品" : "{count} 部作品", { count: entries.length });

  const visible = filterEntries(entries, state.filter, state.query, state.expanded);
  const settingsSig = `${state.settings?.scoreSource}|${state.settings?.minScore}|${getLocale()}`;
  const keep = new Set();
  visible.forEach((entry, index) => {
    const key = entry.item.key;
    keep.add(key);
    let row = rows.get(key);
    if (!row) {
      row = createRow(key);
      rows.set(key, row);
    }
    updateRow(row, entry, settingsSig);
    if (ui.titleList.children[index] !== row.li) ui.titleList.insertBefore(row.li, ui.titleList.children[index] || null);
  });
  // Rows stay cached while detached so an open correction panel survives the
  // brief empty list a RESET/RESCAN produces on the page.
  for (const [key, row] of rows) if (!keep.has(key)) row.li.remove();

  let empty = "";
  if (state.page.kind !== "ready") empty = "打开 Netflix 页面后，这里会列出识别到的作品，匹配错了可以逐个纠正。";
  else if (!entries.length) empty = "当前页面还没有识别到作品卡片。";
  else if (!visible.length) empty = state.query ? "没有标题符合筛选。" : state.filter === "attention" ? "没有需要处理的作品。" : "还没有获取到评分的作品。";
  ui.titlesEmpty.hidden = !empty;
  ui.titlesEmpty.textContent = empty ? t(empty) : "";
}

function createRow(key) {
  const li = ui.rowTpl.content.firstElementChild.cloneNode(true);
  localizeDOM(li);
  const row = {
    key,
    li,
    button: $(".title-row", li),
    name: $(".title-name", li),
    sub: $(".title-sub", li),
    score: $(".title-score", li),
    detail: $(".detail", li),
    match: $(".detail-match", li),
    actionStatus: $(".detail-status", li),
    form: $(".fix-form", li),
    query: $(".fix-query", li),
    year: $(".fix-year", li),
    type: $(".fix-type", li),
    submit: $(".fix-submit", li),
    status: $(".fix-status", li),
    candidates: $(".candidates", li),
    found: null,
    rowSig: "",
    matchSig: "",
    prefilled: false
  };
  const detailId = `detail-${rows.size}-${Math.random().toString(36).slice(2, 8)}`;
  row.detail.id = detailId;
  row.button.setAttribute("aria-controls", detailId);
  row.button.addEventListener("click", () => toggleRow(row));
  row.detail.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      toggleRow(row, false);
      row.button.focus();
    }
  });
  row.form.addEventListener("submit", (event) => {
    event.preventDefault();
    searchFor(row);
  });
  return row;
}

function toggleRow(row, force) {
  const open = force ?? row.detail.hidden;
  if (open && state.expanded && state.expanded !== row.key) {
    const previous = rows.get(state.expanded);
    if (previous) toggleRow(previous, false);
  }
  row.detail.hidden = !open;
  row.button.setAttribute("aria-expanded", String(open));
  state.expanded = open ? row.key : state.expanded === row.key ? null : state.expanded;
  if (open) {
    const entry = state.entries.get(row.key);
    if (!row.prefilled && entry) {
      row.query.value = entry.item.title || "";
      row.year.value = entry.item.year ? String(entry.item.year) : "";
      row.type.value = TYPE_LABEL[entry.item.type] ? entry.item.type : "";
      row.prefilled = true;
    }
    if (entry) renderMatch(row, entry, true);
    row.li.scrollIntoView({ block: "nearest" });
  }
}

function rowSubParts(key, entry) {
  const { item, result } = entry;
  const status = entryStatus(entry);
  const manual = isManual(key, result) ? [["s-manual", t("手动绑定")]] : [];
  switch (status) {
    case "pending": return [["", t("获取评分中…")]];
    case "waiting": return [["", t("滚动到附近时查询")]];
    case "disabled": return [["", t("已暂停，未获取评分")]];
    case "ambiguous": {
      const count = result.candidates?.length;
      return [["s-warn", count ? t("有 {count} 个可能的匹配，点击确认", { count }) : t("有多个可能的匹配，点击确认")]];
    }
    case "not_found": return [["", t("没有找到匹配，点击手动搜索")]];
    case "error": return [["s-error", t("获取失败，点击查看")]];
    case "no_rating": return [...manual, ["", result.title ? t("已匹配 {title}，暂无评分", { title: result.title }) : t("已匹配作品，暂无评分")]];
    default: break;
  }
  const differs = result.title && result.title.trim().toLowerCase() !== String(item.title || "").trim().toLowerCase();
  const desc = differs ? `→ ${result.title}${result.year ? ` (${result.year})` : ""}` : metaLine(result.year || item.year, result.type || item.type);
  return [...manual, ["", desc]];
}

function updateRow(row, entry, settingsSig) {
  const status = entryStatus(entry);
  const result = entry.result;
  const picked = status === "ok" || status === "no_rating" ? pickRating(result?.ratings, state.settings?.scoreSource || "auto") : null;
  const sig = JSON.stringify([status, entry.item.title, result?.title, result?.netflixTitle?.title, result?.year, result?.id, result?.ratings, result?.candidates?.length, isManual(row.key, result), settingsSig]);
  if (sig !== row.rowSig) {
    row.rowSig = sig;
    row.li.dataset.status = status;
    const title = entry.item.title || t("（无标题）");
    row.name.textContent = title;
    row.sub.replaceChildren();
    rowSubParts(row.key, entry).forEach(([cls, text], i) => {
      if (i) row.sub.append(" · ");
      row.sub.append(cls ? el("span", cls, text) : text);
    });
    row.score.replaceChildren();
    row.score.className = "title-score";
    if (picked) {
      const formatted = formatRating(picked.rating, picked.key);
      row.score.append(el("b", "", formatted.text + (picked.key === "rt" ? "%" : "")), el("small", "", ratingShort(picked.key)));
      if (isBelowThreshold(picked.rating, picked.key, state.settings)) {
        row.score.classList.add("is-low");
        row.score.title = t("低于设定的最低评分");
      } else row.score.title = "";
    } else if (status === "ok" || status === "no_rating") {
      const source = state.settings?.scoreSource || "auto";
      row.score.classList.add("is-none");
      row.score.append(el("b", "", "—"), el("small", "", sourceShort()));
      row.score.title = SOURCES[source] && source !== "auto" ? t("没有{source}评分", { source: t(SOURCES[source].label) }) : t("没有评分");
    }
    row.button.setAttribute("aria-label", picked
      ? t("{title}，{status}，{source} {score}", { title, status: statusLabel(status), source: ratingLabel(picked.key), score: formatRating(picked.rating, picked.key).text })
      : t("{title}，{status}", { title, status: statusLabel(status) }));
  }
  if (!row.detail.hidden) renderMatch(row, entry);
}

function ratingLabel(key) {
  return RATING_INFO[key] ? t(RATING_INFO[key].label) : key;
}

function ratingShort(key) {
  return RATING_INFO[key] ? t(RATING_INFO[key].short) : key;
}

function sourceShort() {
  const source = state.settings?.scoreSource || "auto";
  return source === "auto" ? t("评分") : ratingShort(source);
}

function statusLabel(status) {
  const label = { ok: "已匹配", no_rating: "暂无评分", ambiguous: "待确认", not_found: "未找到", error: "获取失败", pending: "获取中", waiting: "等候查询", disabled: "已暂停" }[status];
  return label ? t(label) : status;
}

function renderMatch(row, entry, force = false) {
  const { item, result } = entry;
  const status = entryStatus(entry);
  const manual = isManual(row.key, result);
  const sig = JSON.stringify([status, result, manual, getLocale()]);
  if (!force && sig === row.matchSig) return;
  row.matchSig = sig;
  const box = row.match;
  box.replaceChildren();

  if (status === "pending" || status === "waiting" || status === "disabled") {
    const text = { pending: "正在匹配并获取评分…", waiting: "这张卡片还不在可视区域附近，滚动到它附近时会自动查询。", disabled: "评分镜片已暂停，打开右上角开关后会重新获取。" }[status];
    box.append(el("p", "match-reason", t(text)));
    return;
  }
  if (result?.id) {
    const head = el("div", "match-head");
    const left = el("div");
    left.append(el("div", "match-title", result.title || item.title));
    const meta = el("div", "match-meta", metaLine(result.year, result.type, result.id));
    const url = imdbUrl(result);
    if (url) meta.append(" · ", link(url, "IMDb ↗"));
    left.append(meta);
    head.append(left);
    if (manual) head.append(el("span", "manual-tag", t("手动绑定")));
    box.append(head);
  }
  const alias = result?.netflixTitle?.title;
  if (alias) {
    const provenance = el("p", "match-reason", t("Netflix 英文展示名：{title}", { title: alias }));
    const url = netflixTitleUrl(result.netflixTitle, item.netflixId);
    if (url) provenance.append(" · ", link(url, t("Netflix 标题来源 ↗")));
    box.append(provenance);
  }
  const reason = reasonText(result);
  if (status === "ok" || status === "no_rating") {
    const parts = [];
    if (reason) parts.push(t("依据：{reason}", { reason }));
    const confidence = manual ? "" : confidenceLabel(result?.confidence);
    if (confidence) parts.push(confidence);
    if (parts.length) box.append(el("p", "match-reason", parts.join(" · ")));
  } else if (status === "ambiguous" && reason) box.append(el("p", "match-reason", t("{reason}。", { reason })));
  if (status === "not_found") box.append(el("p", "match-reason", t("{reason}。可以在下方用英文原名或 IMDb 链接手动指定。", { reason: reason || t("没有找到对应作品") })));
  const warning = result?.warning ? localizeMessage(result.warning) : "";
  if (status === "error") {
    box.append(el("p", "match-error", warning
      ? t("获取失败：{warning}。可能是网络或评分源暂时不可用，稍后可点「重新扫描」。", { warning })
      : t("获取失败。可能是网络或评分源暂时不可用，稍后可点「重新扫描」。")));
  } else if (warning) box.append(el("p", "match-warning", warning));
  for (const line of diagnosticLines(result)) box.append(el("p", "match-reason", line));
  if (status === "no_rating") box.append(el("p", "match-reason", t("已找到作品，但评分源暂时没有它的评分。")));

  const ratings = normalizeRatings(result?.ratings);
  const keys = Object.keys(ratings);
  if (keys.length) {
    const list = el("ul", "ratings");
    for (const key of keys) {
      const rating = ratings[key];
      const formatted = formatRating(rating, key);
      const info = RATING_INFO[key];
      const label = info ? t(info.label) : key;
      const li = el("li");
      const name = el("span", "r-name");
      name.append(rating.url ? link(rating.url, `${label} ↗`) : label);
      // Provider names are identities; only the canonical note is translated.
      const baseNote = info ? t(info.note) : "";
      const note = rating.provider && !(info?.note || "").includes(rating.provider) ? [baseNote, rating.provider].filter(Boolean).join(" · ") : baseNote;
      if (note) name.append(el("small", "", note));
      const value = el("span", "r-value", formatted.text);
      value.append(el("small", "", formatted.unit === "%" ? "%" : ` ${formatted.unit}`));
      li.append(name, value);
      list.append(li);
    }
    box.append(list);
  }

  if (manual) {
    const actions = el("div", "match-actions");
    const unbind = el("button", "btn btn-quiet btn-sm");
    unbind.type = "button";
    unbind.append(labelSpan("恢复自动匹配"));
    unbind.addEventListener("click", () => unbindRow(row, unbind));
    actions.append(unbind);
    box.append(actions);
  }

  // Candidates from the original search allow a one-click correction without a new request.
  const candidates = Array.isArray(result?.candidates) ? result.candidates.filter((c) => c?.id) : [];
  if (candidates.length) {
    box.append(el("p", "sub-label", t(status === "ambiguous" ? "可能是以下作品，选择正确的一个：" : "检索到的候选")));
    const list = el("ul", "candidates");
    for (const candidate of candidates.slice(0, 6)) list.append(candidateRow(row, candidate, result));
    box.append(list);
  }
}

function candidateRow(row, candidate, current) {
  const li = el("li", "candidate");
  const isCurrent = current?.id && candidate.id === current.id && entryStatus(state.entries.get(row.key)) !== "ambiguous";
  li.classList.toggle("is-current", Boolean(isCurrent));
  const main = el("div", "cand-main");
  const title = el("div", "cand-title", candidate.title || candidate.id);
  if (isCurrent) title.append(el("span", "cand-current", t("当前")));
  main.append(title);
  const meta = el("div", "cand-meta", metaLine(candidate.year, candidate.type, candidate.provider));
  const url = candidate.url || (/^tt\d+$/.test(candidate.id || "") ? `https://www.imdb.com/title/${candidate.id}/` : "");
  if (url) meta.append(" · ", link(url, candidate.id || t("查看 ↗")));
  main.append(meta);
  const button = el("button", "btn btn-quiet btn-sm");
  button.type = "button";
  button.append(labelSpan(isCurrent ? "当前匹配" : "绑定"));
  button.disabled = Boolean(isCurrent);
  button.setAttribute("aria-label", t("绑定为 {title}", { title: candidateName(candidate) }));
  button.addEventListener("click", () => bindRow(row, candidate, button));
  li.append(main, button);
  return li;
}

function candidateName(candidate) {
  return `${candidate.title || candidate.id}${candidate.year ? ` (${candidate.year})` : ""}`;
}

// Results of the last manual search for a row; kept so a language switch can redraw them.
function setFound(row, candidates) {
  row.found = candidates?.length ? candidates : null;
  renderFound(row);
}

function renderFound(row) {
  const result = state.entries.get(row.key)?.result;
  row.candidates.replaceChildren(...(row.found || []).map((candidate) => candidateRow(row, candidate, result)));
}

async function searchFor(row) {
  const raw = row.query.value.trim();
  if (!raw) {
    setStatus(row.status, "error", msg("请输入片名或 IMDb 编号"));
    row.query.focus();
    return;
  }
  const id = extractImdbId(raw);
  const year = parseYearInput(row.year.value);
  if (!id && !year.ok) {
    setStatus(row.status, "error", msg("年份需为四位数字，或留空"));
    row.year.focus();
    return;
  }
  const message = { type: "SEARCH", query: id || raw };
  if (!id) {
    if (year.year) message.year = year.year;
    // `type` is the message type; the title type travels as `titleType`.
    if (row.type.value) message.titleType = row.type.value;
  }
  setFound(row, null);
  const response = await runOp({
    button: row.submit,
    status: row.status,
    busyLabel: "搜索中…",
    pending: id ? msg("正在查找 {id}…", { id }) : msg("正在搜索，可能需要几秒…"),
    task: () => callBackground(message),
    success: (res) => {
      const total = rankCandidates(res.candidates).total;
      if (!total) return null;
      if (total <= SEARCH_LIMIT) return msg("找到 {total} 个候选，点「绑定」确认。", { total });
      return msg(year.year ? "找到 {total} 个候选，显示最接近的 {limit} 个。" : "找到 {total} 个候选，显示最接近的 {limit} 个；补充年份可缩小范围。", { total, limit: SEARCH_LIMIT });
    }
  });
  if (!response) return;
  const candidates = rankCandidates(response.candidates, id ? undefined : year.year).shown;
  if (!candidates.length) {
    setStatus(row.status, "error", id ? msg("没有找到 {id}，请检查编号。", { id }) : msg("没有找到候选。试试英文原名，或直接粘贴 IMDb 链接（如 tt1375666）。"));
    return;
  }
  setFound(row, candidates);
}

async function bindRow(row, candidate, button) {
  const entry = state.entries.get(row.key);
  if (!entry) return;
  const response = await runOp({
    button,
    status: row.actionStatus,
    busyLabel: "绑定中…",
    pending: msg("正在绑定为「{title}」…", { title: candidate.title || candidate.id }),
    task: () => callBackground({ type: "BIND", item: entry.item, candidate }),
    success: () => msg("已绑定为「{title}」，页面评分正在刷新。", { title: candidateName(candidate) })
  });
  if (!response) return;
  state.manualKeys.add(row.key);
  state.removedManual.delete(row.key);
  if (response.result) entry.result = response.result;
  setFound(row, null);
  row.rowSig = "";
  updateRow(row, entry, "");
  renderMatch(row, entry, true);
  pollPage();
}

async function unbindRow(row, button) {
  const entry = state.entries.get(row.key);
  if (!entry) return;
  const response = await runOp({
    button,
    status: row.actionStatus,
    busyLabel: "恢复中…",
    pending: msg("正在恢复自动匹配…"),
    task: () => callBackground({ type: "UNBIND", item: entry.item }),
    success: () => msg("已恢复自动匹配，页面正在重新匹配。")
  });
  if (!response) return;
  state.manualKeys.delete(row.key);
  state.removedManual.add(row.key);
  row.rowSig = "";
  updateRow(row, entry, "");
  renderMatch(row, entry, true);
  pollPage();
}

// ----- sources: health, key, cache ------------------------------------------

function healthRows() {
  const online = navigator.onLine !== false;
  if (state.checks) {
    return state.checks.map((check) => ({ name: check.name, status: check.status, message: check.message, at: state.checksAt, online }));
  }
  return Object.entries(state.providerHealth).map(([name, health]) => ({
    name,
    status: health?.status,
    message: health?.message,
    at: health?.at,
    online
  }));
}

function renderHealth() {
  if (!ui) return;
  const list = healthRows();
  if (state.testing) ui.healthMeta.textContent = t("正在实时请求各评分源…");
  else if (state.checks) ui.healthMeta.textContent = t("实时验证结果 · {time}", { time: relativeTime(state.checksAt) });
  else if (list.length) ui.healthMeta.textContent = t("来自最近的实际请求。点「实时验证」重新检查。");
  else ui.healthMeta.textContent = t("还没有请求记录。点「实时验证」检查各评分源是否可用。");
  ui.healthList.style.opacity = state.testing ? ".5" : "";
  ui.healthList.replaceChildren(...list.map((entry) => {
    const info = providerInfo(entry.name);
    const view = describeHealth(entry.status, entry.online);
    const li = el("li", "health");
    li.dataset.status = view.tone;
    const name = el("span", "h-name", info.label);
    if (info.note) name.append(el("small", "", info.note));
    const when = !state.checks && entry.at ? ` · ${relativeTime(entry.at)}` : "";
    li.append(el("span", "status-dot"), name, el("span", "h-state", view.label + when));
    const message = entry.message ? localizeMessage(entry.message) : "";
    if (message && message !== view.label) li.append(el("span", "h-msg", message));
    return li;
  }));
}

async function testProviders() {
  state.testing = true;
  renderHealth();
  const response = await runOp({
    button: ui.testProviders,
    status: ui.testStatus,
    busyLabel: "验证中…",
    pending: msg("正在实时请求各评分源，可能需要十几秒…"),
    task: () => callBackground({ type: "TEST_PROVIDERS" }),
    success: (res) => () => summarizeChecks(res.checks)
  });
  state.testing = false;
  if (response) {
    state.checks = Array.isArray(response.checks) ? response.checks : [];
    state.checksAt = Date.now();
    if (state.checks.some((c) => c.status === "error")) ui.testStatus.className = "op-status is-error";
  }
  renderHealth();
  refreshUiMeta();
  return response;
}

function summarizeChecks(checks = []) {
  const live = checks.filter((c) => c.status !== "not_configured");
  const ok = live.filter((c) => c.status === "ok").length;
  const skipped = checks.length - live.length;
  if (live.length && !ok && navigator.onLine === false) return t("设备似乎离线，所有评分源请求失败。");
  const params = { ok, total: live.length, skipped };
  return skipped ? t("{ok}/{total} 个评分源可用，{skipped} 个未配置 Key（可选）。", params) : t("{ok}/{total} 个评分源可用。", params);
}

function renderKeyState() {
  if (!ui) return;
  ui.keyState.dataset.i18n = state.hasApiKey ? "已配置" : "未配置";
  ui.keyState.textContent = t(ui.keyState.dataset.i18n);
  ui.keyState.classList.toggle("is-set", state.hasApiKey);
  ui.removeKey.hidden = !state.hasApiKey;
  const placeholder = state.hasApiKey ? "输入新 Key 以替换当前 Key" : "粘贴 OMDb API Key";
  ui.apiKey.dataset.i18nPlaceholder = placeholder;
  ui.apiKey.placeholder = t(placeholder);
}

async function saveKey() {
  const apiKey = ui.apiKey.value.trim();
  if (!apiKey) {
    setStatus(ui.keyStatus, "error", msg("请先输入 Key"));
    return;
  }
  const response = await runOp({
    button: ui.saveKey,
    status: ui.keyStatus,
    busyLabel: "保存中…",
    pending: msg("正在保存 Key…"),
    task: () => callBackground({ type: "SAVE_SETTINGS", settings: {}, apiKey }),
    success: () => msg("Key 已保存，正在验证…")
  });
  if (!response) return;
  ui.apiKey.value = "";
  ui.saveKey.disabled = true;
  state.hasApiKey = Boolean(response.hasApiKey);
  renderKeyState();
  renderSourceHint();
  const tested = await testProviders();
  const omdb = tested?.checks?.find((c) => /omdb/i.test(String(c.name)));
  if (!tested) setStatus(ui.keyStatus, "error", msg("Key 已保存，但验证没有完成，可稍后点「实时验证」。"));
  else if (!omdb) setStatus(ui.keyStatus, "success", msg("Key 已保存。"));
  else if (omdb.status === "ok") setStatus(ui.keyStatus, "success", msg("Key 已保存并验证可用。"));
  else {
    setStatus(ui.keyStatus, "error", () => t("Key 已保存，但验证失败：{reason}", {
      reason: omdb.message ? localizeMessage(omdb.message) : describeHealth(omdb.status, navigator.onLine !== false).label
    }));
  }
}

async function removeKey() {
  const response = await runOp({
    button: ui.removeKey,
    status: ui.keyStatus,
    busyLabel: "移除中…",
    pending: msg("正在移除 Key…"),
    task: () => callBackground({ type: "SAVE_SETTINGS", settings: {}, removeApiKey: true }),
    success: () => msg("已移除 Key，之后不再获取烂番茄与 Metacritic。")
  });
  if (!response) return;
  state.hasApiKey = Boolean(response.hasApiKey);
  if (state.checks) state.checks = null;
  renderKeyState();
  renderSourceHint();
  refreshUiMeta();
}

function renderCache() {
  if (!ui) return;
  ui.cacheMeta.textContent = state.cacheEntries === null ? "—" : state.cacheEntries ? t("已缓存 {count} 条评分", { count: state.cacheEntries }) : t("暂无缓存");
}

async function clearCache() {
  const before = state.cacheEntries;
  const response = await runOp({
    button: ui.clearCache,
    status: ui.cacheStatus,
    busyLabel: "清空中…",
    pending: msg("正在清空缓存…"),
    task: () => callBackground({ type: "CLEAR_CACHE" }),
    success: (res) => {
      const count = Number.isFinite(res?.cleared) ? res.cleared : before;
      return count ? msg("已清空 {count} 条缓存，当前页正在重新获取评分。", { count }) : msg("已清空缓存，当前页正在重新获取评分。");
    }
  });
  if (!response) return;
  await refreshUiMeta();
  pollPage();
}

// ----- tabs & keyboard ------------------------------------------------------

const TABS = ["filter", "titles", "sources"];

function selectTab(name, focus = false) {
  for (const tab of TABS) {
    const button = $(`#tab-${tab}`);
    const selected = tab === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab}`).hidden = !selected;
    if (selected && focus) button.focus();
  }
  ui.scroll.scrollTop = 0;
  try { localStorage.setItem("scoreLens.tab", name); } catch { /* storage unavailable */ }
}

// Arrow-key roving focus for a tablist or radiogroup.
function roving(container, items, onSelect) {
  container.addEventListener("keydown", (event) => {
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    onSelect(items[next]);
    items[next].focus();
  });
}

function selectFilter(chip) {
  state.filter = chip.dataset.filter;
  for (const other of ui.chips) {
    const on = other === chip;
    other.setAttribute("aria-checked", String(on));
    other.tabIndex = on ? 0 : -1;
  }
  renderTitles();
}

// ----- boot -----------------------------------------------------------------

function collectUi() {
  const ids = [
    "version", "tagline", "saveState", "saveRetry", "openLibrary", "enabled", "page", "pageTitle", "pageHint", "pageAction", "rescan", "progress",
    "progressBar", "stats", "rescanStatus", "titlesBadge", "scoreSource", "sourceHint", "sourceHintText", "sourceHintGo",
    "minScore", "minScoreValue", "minScoreUnit", "minScoreMin", "minScoreMax", "dimLowScores", "dimOptions", "dimOpacity",
    "dimOpacityOut", "revealOnHover", "previewHigh", "previewLow", "previewCaption", "titleFilter", "titleList",
    "titlesEmpty", "testProviders", "healthMeta", "healthList", "testStatus", "omdb", "keyState", "keyForm", "apiKey",
    "saveKey", "removeKey", "keyStatus", "useOmdb", "cacheMeta", "clearCache", "cacheStatus", "language"
  ];
  const refs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  refs.preview = $(".preview");
  refs.scroll = $(".scroll");
  refs.rowTpl = $("#titleRowTpl");
  refs.chips = [...document.querySelectorAll(".chip")];
  return refs;
}

function boot() {
  // Browser language until GET_UI returns the saved preference.
  setLanguage("auto");
  localizeDOM(document);
  ui = collectUi();
  ui.language.value = getLanguage();
  ui.version.textContent = `v${chrome.runtime.getManifest().version}`;
  setSettingsDisabled(true);
  bindSettings();

  const tabButtons = TABS.map((tab) => $(`#tab-${tab}`));
  tabButtons.forEach((button, i) => button.addEventListener("click", () => selectTab(TABS[i])));
  roving($(".tabs"), tabButtons, (button) => selectTab(button.id.replace("tab-", "")));
  let initialTab = "filter";
  try { initialTab = localStorage.getItem("scoreLens.tab") || "filter"; } catch { /* storage unavailable */ }
  selectTab(TABS.includes(initialTab) ? initialTab : "filter");

  ui.chips.forEach((chip) => chip.addEventListener("click", () => selectFilter(chip)));
  roving($(".chips"), ui.chips, selectFilter);
  ui.titleFilter.addEventListener("input", () => {
    state.query = ui.titleFilter.value;
    renderTitles();
  });

  ui.openLibrary.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("library.html") }));
  ui.rescan.addEventListener("click", onRescan);
  ui.pageAction.addEventListener("click", onPageAction);
  ui.testProviders.addEventListener("click", testProviders);
  ui.keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveKey();
  });
  ui.apiKey.addEventListener("input", () => {
    ui.saveKey.disabled = !ui.apiKey.value.trim();
  });
  confirmable(ui.removeKey, "确认移除？", removeKey);
  confirmable(ui.clearCache, "确认清空？", clearCache);
  window.addEventListener("online", renderHealth);
  window.addEventListener("offline", renderHealth);
  // Only the public settings object is read; credentials changes are ignored.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.settings) onStoredSettings(changes.settings.newValue);
  });

  loadUi();
  pollPage();
  timers.push(setInterval(pollPage, POLL_MS), setInterval(refreshUiMeta, UI_POLL_MS));
  window.addEventListener("pagehide", () => {
    timers.forEach(clearInterval);
    if (save.pending) flushSave();
  });
}

if (typeof document !== "undefined" && globalThis.chrome?.runtime?.id) boot();
