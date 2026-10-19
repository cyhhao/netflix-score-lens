# Rating providers (`providers.js`)

Key-free lookups for IMDb ids and ratings. The module produces **candidates**
and resolves ratings for a candidate the caller picked. It never decides which
candidate matches a Netflix title.

## API

```js
import { searchCandidates, resolveCandidate, ProviderError, SearchIncompleteError } from "./providers.js";

const candidates = await searchCandidates("The Queen's Gambit", { type: "series", year: 2020 });
// [{ id: "tt10048342", title: "The Queen's Gambit", year: 2020, type: "series",
//    provider: "Cinemeta", url: "https://www.imdb.com/title/tt10048342/", rank: 0 }, ...]

const resolved = await resolveCandidate(chosen);
// { id, title, year, type,
//   ratings: { imdb?:   { value, scale: 10, provider: "Cinemeta", url: <imdb.com title page> },
//              tvmaze?: { value, scale: 10, provider: "TVmaze",   url: <tvmaze.com show page> } },
//   sources: [{ provider, url: <API URL requested>, status: "ok"|"no_rating"|"not_found"|"error", error? }] }
```

Options for both: `fetchImpl` (default global `fetch`) and `timeoutMs`
(overrides the per-provider default below). `searchCandidates` also takes
`type` (`"movie"`/`"series"`; omitted = both) and `year` (integer).

### Candidate semantics

- Order is provider order, then the provider's own ranking. `rank` is the
  0-based position in that provider's response (an extra field beyond the
  requested shape, so the caller can weigh it — e.g. live `三体` with
  `year: 2023` returns Netflix's *3 Body Problem* at rank 0 and the 2023
  *Three-Body* at rank 1).
- For CJK queries the candidate titles are often English (IMDb matched an AKA).
  Baseline localized inference uses IMDb rank 0, exact year and type; optional
  same-ID Netflix English-title enrichment can independently confirm the name.
- Years can differ by one between providers (Cinemeta lists *Amélie* as 2002,
  IMDb as 2001). The baseline exact-name matcher allows ±1; English enrichment
  deliberately requires the exact year and type, with no rank-based tie-break.

### Search steps

1. Latin-script query → Cinemeta catalog search (one request per type).
   CJK query (Han/Kana/Hangul) → IMDb suggestions first, because Cinemeta's
   movie search returns unrelated titles for CJK text.
2. The other provider runs only if step 1 failed, returned nothing, or — when
   `year` is given — returned nothing within ±1 year.
3. If no step completed, `SearchIncompleteError` is thrown with `.failures`
   and partial `.candidates`. So `[]` always means "searched, nothing found"
   and is safe to cache; an exception is not.

### Resolve semantics

- `ratings.imdb` is IMDb's rating **as mirrored by Cinemeta**; `provider`
  says so and `url` points at the IMDb page where a human can check it.
- `ratings.tvmaze` is **TVmaze's own user rating**, never an IMDb rating.
  Fetched for series only (TVmaze has no movies). Kept even when Cinemeta
  fails, but never moved into `ratings.imdb`.
- Responses describing a different IMDb id are discarded (`not_found`).
- Provider failures do not throw; they appear as `status: "error"`. Do not
  cache a result containing an error source as "no rating".

## Endpoints (measured 2026-10-19)

| Provider | Request | Notes |
| --- | --- | --- |
| Cinemeta | `GET https://v3-cinemeta.strem.io/catalog/{movie\|series}/top/search={encodeURIComponent(q)}.json` → `{ metas: [{ id, imdb_id, type, name, releaseInfo, year? }] }` | No ratings in search results. `releaseInfo` is `"2010"`, `"2017-2020"`, `"2009–2010"`, `"2024-"` or absent. Contains `#DUPE#` placeholders (dropped). |
| Cinemeta | `GET https://v3-cinemeta.strem.io/meta/{type}/{tt}.json` → `{ meta: { imdbRating: "8.8", name, year, releaseInfo, ... } }` | Some ids 307-redirect to `cinemeta-live.strem.io`. Wrong type answers `{}` (after redirect) or 504. `imdbRating` may be missing. |
| IMDb | `GET https://v3.sg.media-imdb.com/suggestion/titles/x/{encodeURIComponent(q)}.json` → `{ d: [{ id, qid, l, y }] }` | Undocumented endpoint behind imdb.com's search box. Handles Chinese/Korean/Japanese titles and AKAs. The first-letter path variant (`/suggestion/鱿/…`) 404s for CJK; `x` works for all. `qid` mapping: `movie`, `tvMovie`, `tvSpecial` → movie; `tvSeries`, `tvMiniSeries` → series; shorts, videos, episodes, games dropped. No CORS header. |
| TVmaze | `GET https://api.tvmaze.com/lookup/shows?imdb={tt}` → 301 → show `{ rating: { average }, url, externals: { imdb } }` | Official API. 404 when unknown. `rating.average` can be `null`. CORS `*`. |

Special characters were verified live with `encodeURIComponent` on both
search endpoints: `'`, `&`, `,`, `:`, `/`, `?`, `#`, `%`, accents, CJK.

## Limits, timeouts, retries

| Provider | Concurrency | Min spacing | Timeout | Why |
| --- | --- | --- | --- | --- |
| Cinemeta | 4 | – | 20 s | Uncached searches took 2–16 s; Cloudflare sometimes returns 504 at ~6.7 s and the retry succeeds. Cached (`cf-cache-status: HIT`) answers take ~0.1–0.5 s. |
| IMDb | 2 | 250 ms | 8 s | Unofficial endpoint; stay gentle. Typical 70–900 ms. |
| TVmaze | 2 | 500 ms | 8 s | Docs: "at least 20 calls every 10 seconds per IP"; 429 means back off. |

Each request gets at most one retry, only for timeouts, network errors and
HTTP 429/500/502/503/504. A 429 pauses that provider's queue for
`Retry-After` (capped at 10 s, default 2 s). Limits are per service-worker
lifetime (module state), which is enough for a single extension instance.

Worst case per search: a Latin query with no hits costs two uncached Cinemeta
searches plus one IMDb request (measured 14.7 s live). Cache results by
normalized title on the caller side.

## Extension integration notes

- `manifest.json` needs `host_permissions` for `https://v3-cinemeta.strem.io/*`,
  `https://cinemeta-live.strem.io/*` (redirect target),
  `https://v3.sg.media-imdb.com/*` (no CORS header, so required) and
  `https://api.tvmaze.com/*`. Not changed by this module.
- Pass `fetchImpl` as a plain function. The module calls it unbound, which is
  safe for the global `fetch`; do not pass a method that relies on `this`.
- TVmaze data is CC BY-SA: show attribution with a link to TVmaze wherever
  its rating is displayed (`ratings.tvmaze.url` is the show page).

## Coverage and known gaps

- Ratings: IMDb (via Cinemeta) and TVmaze only. No Rotten Tomatoes or
  Metacritic: no key-free, first-party source for them was used.
- Cinemeta's `imdbRating` is a mirror and may lag imdb.com. It was not
  cross-checked: imdb.com answered HTTP 202 bot challenges to plain requests.
- The IMDb suggestion endpoint is undocumented and may change or block
  traffic; it is only the first step for CJK queries and a fallback otherwise.
- Titles absent from both Cinemeta and IMDb suggestions (very new or regional
  releases) produce no candidates. TVmaze search is not used for recall.
- Rate limits are not shared across browser profiles or devices behind the
  same IP.

## Optional Netflix English display-title enrichment (`netflix-titles.js`, `matching.js`)

This is not a Netflix-to-IMDb mapping API or a bulk catalog crawler. Only an
encountered Netflix ID with available year/type and a weak automatic result is
eligible. Already high-confidence and manually bound results bypass it.

- Request `/title/{id}` on `https://www.netflix.com` with English Accept-Language,
  `credentials: omit`, no referrer and no HTTP cache. Regional redirects are
  accepted, without hard-coding a country or changing the account language.
- Read at most 2 MiB, with a six-second request/body deadline, two concurrent
  requests and 500 ms minimum spacing. No immediate retry. HTTP 403/429 backs
  off for 60 seconds to one hour, respecting bounded Retry-After. Limits are
  per worker lifetime; cached errors also prevent repeated per-ID requests.
- The final same-ID HTTPS title route, English html.lang, one visible h1 and
  public same-ID deep-link/canonical evidence must agree. HTTP-200 login/error
  pages do not qualify. Embedded scripts/templates are ignored, never executed;
  HTML and application/account state are not stored.
- First verify existing candidates against the English name. Search that name
  only if necessary. Require normalized exact name, exact year/type and one
  unique IMDb ID. A contradictory earlier localized ID remains ambiguous and
  unscored. Failure/unavailability falls back to the original search.
- An English display name is not necessarily the original-language title.
  Do not extract a premiere year from `latestYear` or the latest season.
- `netflixTitlesV1` keeps at most 600 minimal ID/name/language/source-URL/status
  records: success seven days, unavailable ten minutes, request error one minute.
  Alias TTLs never shorten a successful rating's reuse interval: optional title
  failures must not repeatedly spend rating-provider quota. A saved fallback is
  re-enriched when its rating query is next due, or after an explicit cache clear.
  TTL is a reuse boundary, not a deletion timer. Rating cache remains separately
  capped at 600 query variants. Cache clear/key/mode resets remove both caches;
  late responses from old generations cannot recreate them. Manual bindings
  remain authoritative. Old weak rating entries upgrade on their next lookup;
  old high/manual entries remain reusable.
- Popup, page details and library show the English name and same-ID source link;
  both library and popup search include the alias. Opening the library stays
  local-only. No new host permission was added. Public-page availability and
  terms are not guaranteed; see the store release gates and privacy policy.

## Evidence

Offline: `node --test tests/providers.test.mjs` — 23 tests with fake
`fetchImpl` built from captured response shapes (URL encoding, ordering,
filtering, CJK routing, fallback, year widening, 504 retry, 429
`Retry-After`, timeouts, `SearchIncompleteError`, rating separation, id
mismatch, rate limiting). Seven mutations of the module (no retry, empty list
on failure, no year widening, no CJK routing, no TVmaze id check, no TVmaze
spacing, keep `#DUPE#`) each fail at least one test.

Live: `PROVIDERS_LIVE=1 node --test tests/providers.test.mjs` — 4/4 passed.
Live sweep through the module on 2026-10-19 (expected id found in every case):

| Query (options) | Candidates | Expected id | Rank / provider | Resolved |
| --- | --- | --- | --- | --- |
| Stranger Things (series) | 10, Cinemeta | tt4574334 | 0 / Cinemeta | IMDb 8.6, TVmaze 8.4 |
| Rebecca (movie, 2020) | 27, Cinemeta | tt2235695 | 1 / Cinemeta | IMDb 6.1 |
| Money Heist | 7, Cinemeta | tt6468322 | 0 / Cinemeta | IMDb 8.2, TVmaze 8.0 |
| Dave Chappelle: The Closer (movie) | 15, Cinemeta | tt15523010 | 0 / Cinemeta | IMDb 7.9 |
| Amélie (movie, 2001) | 24, Cinemeta | tt0211915 | 0 / Cinemeta (year 2002) | IMDb 8.2 |
| The Glory (series, 2022) | 6, Cinemeta | tt21344706 | 0 / Cinemeta | IMDb 8.2, TVmaze 7.6 |
| 怪奇物语 | 8, IMDb | tt4574334 | 0 / IMDb | IMDb 8.6, TVmaze 8.4 |
| 黑暗荣耀 | 1, IMDb | tt21344706 | 0 / IMDb | IMDb 8.2, TVmaze 7.6 |
| 想见你 (series) | 1, IMDb | tt11262762 | 0 / IMDb | IMDb 8.4, TVmaze no_rating |
| 灵笼 | 1, IMDb | tt10827146 | 0 / IMDb | IMDb 8.1, TVmaze not_found |
| 三体 (series, 2023) | 6, IMDb | tt20242042 | 1 / IMDb | IMDb 7.6, TVmaze 7.5 |
| 오징어 게임 | 1, IMDb | tt10919420 | 0 / IMDb | IMDb 7.9, TVmaze 7.9 |
| 千と千尋の神隠し | 2, IMDb | tt0245429 | 0 / IMDb | IMDb 8.6 |
| qzxjvqzxjv nothing | 0 | – | – | `[]` after both providers, 14.7 s |
