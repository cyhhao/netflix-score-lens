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
//   sources: [{ provider, url: <API URL requested>, status: "ok"|"no_rating"|"not_found"|"error", error? }],
//   diagnostics: [{provider, stage:"rating", kind:"timeout"|"network"|"http"|"parse", status?:<HTTP number>}] }
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

## Whole-title pipeline and OMDb outcomes

Across titles, content has at most six in-flight LOOKUP messages per tab; the worker runs four complete lookups at once. Within one title, original search → optional Netflix English name → optional English search are dependent steps, not a bulk-ID API. Once a candidate IMDb ID is confirmed, Cinemeta, TVmaze (series) and optional OMDb rating requests start concurrently. OMDb does not wait for the free sources; its ratings still take precedence for the same source. Free mode or a missing Key makes no automatic OMDb request. Host caps above and the two-request Netflix cap are unchanged.

OMDb has a ten-second request/body deadline and no immediate retry. Known absent-title responses are missing data, not a network error. Invalid Key and exhausted quota are configuration/availability warnings; they do not discard free ratings. Unknown `Response:False`, malformed data and a mismatched returned IMDb ID are protocol failures, not trustworthy absence. No OMDb URL or Key is included in cached source diagnostics.

Rating reuse is determined by structured outcomes, not warning text:
- Good ratings: seven days normally, including an absent OMDb title.
- Good free rating plus an invalid/unactivated Key or another permanent OMDb refusal: one hour, not seven days. This allows external Key activation to recover without repeated five-minute lookups. Saving the same Key or rescanning reuses cache; existing explicit Clear cache recovers immediately, but also removes the local library cache. Changing the Key or provider mode also resets cache.
- Good free rating plus OMDb daily quota exhaustion: at most 24 hours, so RT/MC can be refreshed after the next quota reset.
- Good ratings with transient rating-source failure: five minutes. Optional Netflix title-stage failure does not shorten these windows.
- Settled `no_rating`, `not_found`, `ambiguous`: ten minutes. A source's missing title alone never becomes a 30-second error loop.
- Failed search/rating: 30 seconds for transient failures; ten minutes for permanent/internal failures. Content further backs off repeat failures (30s → 60s → 120s, up to 15 minutes), respects the worker's retry hint, and retries only near-viewport titles. Manual retry/online recovery resets page backoff.

New results retain a bounded local-only diagnostic vocabulary: provider, stage, failure kind and optional numeric HTTP status. Content details, popup and library translate this without exposing URLs or raw exceptions. An absent-source diagnostic is informational. The HUD counts affected titles instead of suggesting that the whole extension is broken. Old cached records may lack these fields; they acquire diagnostics on their next due lookup. This is not server telemetry or a guarantee that every failed intermediate fallback is recorded.

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

## Episode cards and parent-show metadata (`bridge.js`, `content.js`)

Netflix `episodic-card` labels name a single episode (for example “Pilot”), not the series. They are never sent directly to a rating search. The bridge reads the requested `Episode:{"videoId":ID}` from live Apollo/initial GraphQL data and follows only `parentShow.__ref` to a Show, or `parentSeason.__ref` to a Season and its `parentShow.__ref`. These field names and plain `title` are present in Netflix's public anonymous web-client GraphQL fragments; the normalized Episode/Season key layout and whether a logged-in row hydrates those fields still require live-page acceptance.

Only the parent's public ID, bounded title, `releaseYear` and `series` type are returned. At most one Season and one Show are followed; caches are not enumerated and no new network requests or host permissions are added. The episode title/year and Show `latestYear` are not substitutes. Partial live data falls back per absent field to initial data, but an explicit live null does not restore that field's older value. Conflicting direct/season parents remain unresolved. Legacy Falcor episode records have no verified parent relationship here and fail closed.

Resolved cards use `nf:<showId>` and the show's query fields, so multiple episodes and a regular card share a lookup, rating and show-level manual binding. Old episode-title cache entries cannot satisfy the corrected request. The fix does not clear unrelated cache, credentials or overrides. Missing parents remain undimmed and explicitly identified as awaiting show metadata, without sending bogus episode-name searches; near-viewport scans retry when metadata hydrates. Ordinary/legacy cards explicitly identified as episodes follow the same conservative rule, even if their label looks like a show name; normal Show/Movie cards retain their visible query titles. Unresolved identities are excluded from popup correction/progress and counted separately, and cannot supply a hover preview's query title or revive an older cached preview. This safety behavior is not a promise of full catalog coverage.

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
