// Shared, dependency-free localization state for extension pages and content scripts.
// Catalogs register Chinese canonical keys and English translations. The Chinese
// key remains the source of truth so cached messages can be translated later.
const registry = new Map();
const SUPPORTED = new Set(["en", "zh-CN"]);
let preference = "auto";
let locale = "en";

function languageTag(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "auto") return "auto";
  if (raw === "zh" || raw.startsWith("zh-") || raw.startsWith("zh_")) return "zh-CN";
  if (raw === "en" || raw.startsWith("en-") || raw.startsWith("en_")) return "en";
  return null;
}

function browserLanguageList(explicit) {
  if (Array.isArray(explicit)) return explicit.filter(Boolean).map(String);
  if (typeof explicit === "string" && explicit.trim()) return [explicit];
  if (typeof navigator !== "undefined") {
    const list = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : navigator.language ? [navigator.language] : [];
    if (list.length) return list;
  }
  try {
    const ui = globalThis.chrome?.i18n?.getUILanguage?.();
    if (ui) return [ui];
  } catch { /* Chrome i18n is unavailable in unit tests. */ }
  return [];
}

export function normalizeLanguage(value) {
  return languageTag(value) || "auto";
}

export function resolveLocale(preferred = "auto", browserLanguages) {
  const explicit = languageTag(preferred);
  if (explicit && explicit !== "auto") return explicit;
  const languages=browserLanguageList(browserLanguages);
  const first=languageTag(languages[0]);
  return SUPPORTED.has(first) ? first : "en";
}

export function registerMessages(messages = {}) {
  for (const [key, value] of Object.entries(messages)) registry.set(String(key), value);
  return messages;
}

export function setLanguage(value = "auto", browserLanguages) {
  preference = normalizeLanguage(value);
  locale = resolveLocale(preference, browserLanguages);
  // Locale state must not mutate a host page (e.g. Netflix). Extension pages
  // opt in to their document language through localizeDOM(document).
  return locale;
}

export function getLocale() { return locale; }
export function getLanguage() { return preference; }

function translationFor(key) {
  const raw = registry.get(String(key));
  if (raw && typeof raw === "object") return raw[locale] || raw.en || String(key);
  return locale === "en" && typeof raw === "string" ? raw : String(key);
}

export function t(key, params = {}) {
  let text = translationFor(key);
  return text.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

function annotatedElements(root, attribute) {
  if (!root) return [];
  const found = [];
  if (root.nodeType === 1 && root.hasAttribute(attribute)) found.push(root);
  if (root.querySelectorAll) found.push(...root.querySelectorAll(`[${attribute}]`));
  return found;
}

export function localizeDOM(root = typeof document !== "undefined" ? document : null) {
  for (const element of annotatedElements(root, "data-i18n")) element.textContent = t(element.getAttribute("data-i18n"));
  for (const element of annotatedElements(root, "data-i18n-title")) element.setAttribute("title", t(element.getAttribute("data-i18n-title")));
  for (const element of annotatedElements(root, "data-i18n-placeholder")) element.setAttribute("placeholder", t(element.getAttribute("data-i18n-placeholder")));
  for (const element of annotatedElements(root, "data-i18n-aria-label")) element.setAttribute("aria-label", t(element.getAttribute("data-i18n-aria-label")));
  if (root?.nodeType === 9 && root.documentElement) root.documentElement.lang = locale;
  return root;
}

// Translate only exact known app messages, including semicolon/newline-composed
// warnings. Unknown text is returned unchanged so titles and provider identities
// are never accidentally translated.
export function localizeMessage(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (registry.has(text)) return t(text);
  const http = text.match(/^服务返回 HTTP (\d+)$/);
  if (http) return t("服务返回 HTTP {status}", { status: http[1] });
  if (locale === "zh-CN") {
    let match = text.match(/^(Cinemeta|IMDb|TVmaze) HTTP (\d+)$/);
    if (match) return `${match[1]} 返回 HTTP ${match[2]}`;
    match = text.match(/^(Cinemeta|IMDb|TVmaze) timed out after (\d+) ms$/);
    if (match) return `${match[1]} 请求超时（${match[2]} ms）`;
    match = text.match(/^(Cinemeta|IMDb|TVmaze) returned invalid JSON$/);
    if (match) return `${match[1]} 返回了无法解析的数据`;
    match = text.match(/^(Cinemeta|IMDb|TVmaze) network error: (.+)$/);
    if (match) return `${match[1]} 网络错误：${match[2]}`;
  }
  const parts = text.split(/([;；\n])/);
  let changed = false;
  const translated = parts.map((part) => {
    if (/^[;；\n]$/.test(part) || !registry.has(part)) return part;
    changed = true;
    return t(part);
  }).join("");
  return changed ? translated : text;
}

export function formatDate(value, options) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", options || {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(date);
}

setLanguage("auto");
