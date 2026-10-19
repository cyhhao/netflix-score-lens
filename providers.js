// Key-free rating providers: Cinemeta (IMDb ratings mirror), IMDb title
// suggestions (id lookup, incl. CJK titles) and TVmaze (its own user rating).
//
// This module only produces candidates and resolves ratings for a candidate
// the caller has already chosen. It never decides which candidate matches a
// title. See docs/providers.md for endpoints, measured behaviour and limits.

export const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
export const IMDB_SUGGEST_BASE = "https://v3.sg.media-imdb.com/suggestion/titles/x";
export const TVMAZE_BASE = "https://api.tvmaze.com";

const PROVIDERS = {
  // Uncached Cinemeta searches were measured at 2–16 s, and Cloudflare
  // sometimes answers 504 after ~6.7 s before a retry succeeds.
  Cinemeta: { concurrency: 4, minIntervalMs: 0, timeoutMs: 20000 },
  // Unofficial endpoint backing imdb.com's search box; keep it gentle.
  IMDb: { concurrency: 2, minIntervalMs: 250, timeoutMs: 8000 },
  // TVmaze docs: "at least 20 calls every 10 seconds per IP address".
  TVmaze: { concurrency: 2, minIntervalMs: 500, timeoutMs: 8000 }
};

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;
const RATE_LIMIT_DELAY_MS = 2000;
const MAX_RETRY_AFTER_MS = 10000;
const MAX_QUERY_LENGTH = 200;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const IMDB_ID_PATTERN = /^tt\d{7,10}$/;
const TYPES = ["movie", "series"];

// IMDb suggestion `qid` -> Cinemeta type. Verified against Cinemeta meta:
// tvMovie and tvSpecial titles (e.g. stand-up specials) live under "movie".
const IMDB_KIND_TO_TYPE = {
  movie: "movie",
  tvMovie: "movie",
  tvSpecial: "movie",
  tvSeries: "series",
  tvMiniSeries: "series"
};

export class ProviderError extends Error {
  constructor(message, { provider, url, status = null, kind, transient = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProviderError";
    this.provider = provider;
    this.url = url;
    this.status = status;
    this.kind = kind;
    this.transient = transient;
  }
}

// Thrown when no search step completed, so an empty or short candidate list
// would be indistinguishable from "not found". Partial results are attached.
export class SearchIncompleteError extends Error {
  constructor(failures, candidates) {
    super(`Search incomplete: ${failures.map((failure) => failure.message).join("; ")}`);
    this.name = "SearchIncompleteError";
    this.failures = failures;
    this.candidates = candidates;
  }
}

function createLimiter({ concurrency, minIntervalMs }) {
  const queue = [];
  let active = 0;
  let nextStartAt = 0;
  let timer = null;

  function pump() {
    while (active < concurrency && queue.length > 0) {
      const wait = nextStartAt - Date.now();
      if (wait > 0) {
        if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            pump();
          }, wait);
        }
        return;
      }
      nextStartAt = Date.now() + minIntervalMs;
      active += 1;
      const { task, resolve, reject } = queue.shift();
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
      });
    },
    // Hold every queued request for this host, e.g. after a 429.
    pause(ms) {
      nextStartAt = Math.max(nextStartAt, Date.now() + ms);
    }
  };
}

const limiters = Object.fromEntries(
  Object.entries(PROVIDERS).map(([name, limits]) => [name, createLimiter(limits)])
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response) {
  const header = response.headers?.get?.("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return RATE_LIMIT_DELAY_MS;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

async function attemptJson(provider, url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, { credentials: "omit", signal: controller.signal, headers: { Accept: "application/json" } });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new ProviderError(`${provider} ${timedOut ? `timed out after ${timeoutMs} ms` : `network error: ${error.message}`}`, {
        provider, url, kind: timedOut ? "timeout" : "network", transient: true, cause: error
      });
    }
    // A missing title is an answer, not a failure.
    if (response.status === 404) return { status: 404, data: null };
    if (!response.ok) {
      const error = new ProviderError(`${provider} HTTP ${response.status}`, {
        provider, url, status: response.status, kind: "http", transient: TRANSIENT_STATUSES.has(response.status)
      });
      if (response.status === 429) error.retryAfterMs = retryAfterMs(response);
      throw error;
    }
    try {
      return { status: response.status, data: await response.json() };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new ProviderError(`${provider} ${timedOut ? `timed out after ${timeoutMs} ms` : "returned invalid JSON"}`, {
        provider, url, status: response.status, kind: timedOut ? "timeout" : "parse", transient: timedOut, cause: error
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(provider, url, { fetchImpl, timeoutMs }) {
  const limiter = limiters[provider];
  const timeout = timeoutMs ?? PROVIDERS[provider].timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await limiter.run(() => attemptJson(provider, url, fetchImpl, timeout));
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.transient || attempt >= MAX_ATTEMPTS) throw error;
      if (error.status === 429) {
        limiter.pause(error.retryAfterMs);
        continue;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

function parseYear(value) {
  const match = String(value ?? "").match(/\b(18[89]\d|19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function parseRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(number) && number > 0 && number <= 10 ? number : null;
}

function cleanTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  // IMDb keeps "#DUPE#" placeholders for merged duplicates; Cinemeta lists them.
  return title && title !== "#DUPE#" ? title : null;
}

export function imdbTitleUrl(id) {
  return `https://www.imdb.com/title/${id}/`;
}

function makeCandidate({ id, title, year, type, provider, rank }) {
  return { id, title, year, type, provider, url: imdbTitleUrl(id), rank };
}

async function searchCinemeta(query, types, options) {
  const lists = await Promise.all(types.map(async (type) => {
    const url = `${CINEMETA_BASE}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
    const { data } = await fetchJson("Cinemeta", url, options);
    const metas = Array.isArray(data?.metas) ? data.metas : [];
    return metas.flatMap((meta, rank) => {
      const id = meta?.imdb_id || meta?.id;
      const title = cleanTitle(meta?.name);
      if (!IMDB_ID_PATTERN.test(id ?? "") || !title || meta.type !== type) return [];
      return [makeCandidate({ id, title, year: parseYear(meta.year ?? meta.releaseInfo), type, provider: "Cinemeta", rank })];
    });
  }));
  return lists.flat();
}

async function searchImdb(query, types, options) {
  const url = `${IMDB_SUGGEST_BASE}/${encodeURIComponent(query)}.json`;
  const { data } = await fetchJson("IMDb", url, options);
  const items = Array.isArray(data?.d) ? data.d : [];
  return items.flatMap((item, rank) => {
    const type = IMDB_KIND_TO_TYPE[item?.qid];
    const title = cleanTitle(item?.l);
    if (!type || !types.includes(type) || !IMDB_ID_PATTERN.test(item.id ?? "") || !title) return [];
    return [makeCandidate({ id: item.id, title, year: Number.isInteger(item.y) ? item.y : null, type, provider: "IMDb", rank })];
  });
}

/**
 * Collect IMDb-id candidates for a title. Order is provider order, then each
 * provider's own ranking; `rank` is the 0-based position in that provider's
 * response. No candidate is preferred or dropped for looking like a better
 * match: choosing one is the caller's job.
 *
 * Steps: Cinemeta search first for Latin-script queries, IMDb suggestions
 * first for CJK queries (Cinemeta's movie search returns unrelated titles for
 * them). The other step runs only when the first failed, returned nothing,
 * or — when `year` is given — returned nothing within ±1 year.
 *
 * Throws SearchIncompleteError (with partial `.candidates`) when no step
 * completed, so an empty array always means "searched and found nothing".
 */
export async function searchCandidates(query, { type, year, fetchImpl = fetch, timeoutMs } = {}) {
  if (typeof query !== "string") throw new TypeError("query must be a string");
  if (type !== undefined && !TYPES.includes(type)) throw new TypeError(`type must be one of ${TYPES.join(", ")}`);
  if (year !== undefined && year !== null && !Number.isInteger(year)) throw new TypeError("year must be an integer");
  const text = query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (!text) return [];

  const types = type ? [type] : TYPES;
  const options = { fetchImpl, timeoutMs };
  const steps = CJK_PATTERN.test(text) ? [searchImdb, searchCinemeta] : [searchCinemeta, searchImdb];
  const candidates = [];
  const seen = new Set();
  const failures = [];
  let completed = false;

  for (const step of steps) {
    try {
      for (const candidate of await step(text, types, options)) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        candidates.push(candidate);
      }
      completed = true;
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      failures.push(error);
      continue;
    }
    const yearCovered = !year || candidates.some((candidate) => candidate.year && Math.abs(candidate.year - year) <= 1);
    if (candidates.length > 0 && yearCovered) break;
  }

  if (!completed) throw new SearchIncompleteError(failures, candidates);
  return candidates;
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") throw new TypeError("candidate must be an object");
  if (!IMDB_ID_PATTERN.test(candidate.id ?? "")) throw new TypeError("candidate.id must be an IMDb title id (tt…)");
  if (!TYPES.includes(candidate.type)) throw new TypeError(`candidate.type must be one of ${TYPES.join(", ")}`);
  return candidate;
}

function failedSource(provider, url, error) {
  if (!(error instanceof ProviderError)) throw error;
  return { provider, url, status: "error", error: error.message };
}

async function lookupCinemeta(id, type, options) {
  const url = `${CINEMETA_BASE}/meta/${type}/${id}.json`;
  try {
    const { data } = await fetchJson("Cinemeta", url, options);
    const meta = data?.meta;
    // A wrong type redirects to cinemeta-live and answers `{}`.
    if (!meta || (meta.imdb_id ?? meta.id) !== id) return { source: { provider: "Cinemeta", url, status: "not_found" } };
    const value = parseRating(meta.imdbRating);
    const info = { title: cleanTitle(meta.name), year: parseYear(meta.year ?? meta.releaseInfo) };
    if (value === null) return { info, source: { provider: "Cinemeta", url, status: "no_rating" } };
    return {
      info,
      rating: { value, scale: 10, provider: "Cinemeta", url: imdbTitleUrl(id) },
      source: { provider: "Cinemeta", url, status: "ok" }
    };
  } catch (error) {
    return { source: failedSource("Cinemeta", url, error) };
  }
}

async function lookupTvmaze(id, options) {
  const url = `${TVMAZE_BASE}/lookup/shows?imdb=${id}`;
  try {
    const { data: show } = await fetchJson("TVmaze", url, options);
    if (!show || show.externals?.imdb !== id) return { source: { provider: "TVmaze", url, status: "not_found" } };
    const value = parseRating(show.rating?.average);
    const info = { title: cleanTitle(show.name), year: parseYear(show.premiered) };
    if (value === null) return { info, source: { provider: "TVmaze", url, status: "no_rating" } };
    const page = typeof show.url === "string" && show.url.startsWith("https://www.tvmaze.com/")
      ? show.url
      : `https://www.tvmaze.com/shows/${show.id}`;
    return {
      info,
      rating: { value, scale: 10, provider: "TVmaze", url: page },
      source: { provider: "TVmaze", url, status: "ok" }
    };
  } catch (error) {
    return { source: failedSource("TVmaze", url, error) };
  }
}

/**
 * Fetch ratings for one caller-chosen candidate.
 *
 * - ratings.imdb: IMDb's rating as mirrored by Cinemeta (may lag imdb.com).
 * - ratings.tvmaze: TVmaze's own user rating, NOT an IMDb rating. Series only;
 *   TVmaze has no movies.
 *
 * Never throws for provider failures: each request is reported in `sources`
 * with status "ok" | "no_rating" | "not_found" | "error". Treat a result
 * containing an "error" source as retryable rather than as "no rating".
 */
export async function resolveCandidate(candidate, { fetchImpl = fetch, timeoutMs } = {}) {
  const { id, type } = validateCandidate(candidate);
  const options = { fetchImpl, timeoutMs };
  const lookups = await Promise.all([
    lookupCinemeta(id, type, options),
    ...(type === "series" ? [lookupTvmaze(id, options)] : [])
  ]);
  const [cinemeta, tvmaze] = lookups;
  const info = cinemeta.info ?? tvmaze?.info ?? {};

  const ratings = {};
  if (cinemeta.rating) ratings.imdb = cinemeta.rating;
  if (tvmaze?.rating) ratings.tvmaze = tvmaze.rating;

  return {
    id,
    title: info.title ?? candidate.title ?? null,
    year: info.year ?? candidate.year ?? null,
    type,
    ratings,
    sources: lookups.map((lookup) => lookup.source)
  };
}
