# Testing and evidence boundaries

## Deterministic default suites

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run package
node tests/package-smoke.mjs
```

- Pure tests cover matching confidence, English Netflix-title parsing/enrichment boundaries, source scales/thresholds, provider parsing/retry/rate limits, popup state and the library model.
- `e2e.mjs` loads the real extension into a disposable browser, serves controlled Netflix-shaped HTML and seeds synthetic results to exercise badges/dimming/recycling.
- `background-e2e.mjs` replaces provider responses in a real service worker to test cache, sources, binding and credentials boundaries.
- `network-reliability.mjs` uses a real worker with synthetic provider replies: OMDb absence/auth/quota/transient/protocol classifications, structured diagnostics without secrets, deferred-barrier proof of free/OMDb concurrency, deduplication, and clear/pause generation guards.
- `matching-integration.mjs` runs synthetic Netflix HTML/provider fixtures through the real MV3 worker: alias rescue, old-cache upgrades, same-ID request deduplication, positive/negative/error cache reuse, cache clearing, pause/resume and binding races, 600-entry eviction, credential omission and bilingual provenance/search UI. These fixtures are not evidence of current Netflix availability.
- `bridge.test.mjs` uses synthetic GraphQL/Falcor objects to check requested-ID bounds, typed episode/season/show relationships, partial hydration, conflicting/missing parents, and public-field-only responses. These fixtures do not prove the live logged-in cache shape.
- `content-episodes.mjs` runs the real extension with synthetic episode cards and providers: same episode names across different shows, canonical query/cache/manual-binding reuse, poisoned old episode cache bypass, no lookup for unresolved parents, late metadata, recycled/new slots, viewport work, localization and pause/playback cleanup. It also covers unresolved hover previews (including a movie with an exact episode-name match), popup/progress exclusion, virtualized stale-preview results, and ordinary watch links to GraphQL/Falcor episodes.
- `content-edge.mjs` checks real isolated-world storage/message restrictions, safe public-metadata bridging, async metadata, retries and playback cleanup.
- `content-visibility.mjs` reproduces hidden notification thumbnails with positive viewport rectangles. It verifies no discovery/metadata/provider traffic for hidden/non-card UI, hide/show and cached recovery for real cards, and lazy lookup of offscreen cards.
- `content-preview.mjs` uses synthetic portal-shaped mini-modal markup modeled on observed DOM structure, not an owner's captured page. It verifies shared cached scores, media badge hit-testing, native controls, title/poster recycling, rejecting trailer IDs and conflicting links, language/visibility/pause/playback cleanup.
- `content-retries.mjs` uses real isolated content execution with controlled message replies and clock offsets to verify exponential retry, server hints, manual/online reset, bilingual diagnostics and recovery without false disconnection warnings.
- `content-lifecycle.mjs` performs a real extension reload in a disposable browser with two old Netflix-shaped browse tabs (one with a delayed lookup reply) and one playback tab. It verifies that the invalidated content contexts stop timers, observers, message listeners and late renders without uncaught exceptions, show a localized refresh notice only outside playback, preserve extension storage, and work again after a page refresh.
- `library-integration.mjs` seeds synthetic local cache entries and uses the real trusted library page. It checks search/filter/sort/group/detail/state restoration, failure/retry, responsive layout and the popup entry. A narrow `tabs.create` call spy verifies the Netflix destination without depending on an external Netflix redirect; the source links are inspected, not followed. It also temporarily injects a message error to test failure UI.
- `manifest-locales.test.mjs` checks native English/Simplified Chinese manifest messages, summary/name limits and unchanged permission/update metadata.
- `package-smoke.mjs` extracts the actual store ZIP into a new temporary folder and boots that packaged extension. It checks manifest-at-root, excluded private/development files, packaged locale catalogs, resolved native metadata, empty library and popup entry.
- `npm run store:assets` explicitly regenerates eight localized screenshots plus a shared promo in disposable browsers, and records zero-network rendering evidence with input/image hashes in `store/assets/provenance.json`. Review and commit the images and provenance together; cross-platform rendering is not promised to be byte-identical.
- `npm run store:kit` packages those reviewed images unchanged and checks their provenance, strict runtime allowlist, native metadata, PNG dimensions/color types, relative links and preparation-only gates. The manual `Store preparation (manual)` workflow runs this strict packaging/validation without re-rendering artwork. It is deliberately separate from ordinary CI: routine runtime changes must not require a new store-artwork review. It builds a publisher handoff, makes no provider/dashboard calls, and does not claim store approval.

The default browser tests do not use a personal browser profile, Netflix account or real API key. All temporary profiles are removed on completion. `tests/browser.mjs` resolves Playwright's installed browser portably; `CHROME_PATH` / `CFT_PATH` optionally override it.

## Optional real-network suites

`npm run test:live` uses public provider queries in the real popup/background/content runtime, controlled Netflix HTML and obviously invalid test credentials for error handling. It depends on third-party coverage, network conditions and quotas. `PROVIDERS_LIVE=1 node --test tests/providers.test.mjs` directly checks live provider adapters. Neither suite proves an actual logged-in Netflix UI works after a DOM change.

## Production acceptance

Before a release, check the final packaged build in an authorized logged-in Netflix browser: browse/movie/series/search, scrolling, SPA navigation, title corrections, masking/hover, sources, no-Key/optional-Key behavior and independent library. Record results privately when they contain account or browsing information; public bug reports should use sanitized repros. Never commit private screenshots, Key values, browser profiles or captured title histories.

Passing deterministic tests is not a guarantee of provider uptime, correct cross-language matches, permission to reuse external data or Chrome Web Store approval. Public store screenshots generated by `scripts/store-assets.mjs` are the actual extension UI with conspicuously labelled synthetic demonstration entries, not a capture of a user's account.

## Reading results

CI is the authoritative reproducible result for each public commit. Check each suite's result and exit status; do not copy old success counts after changing tests without rerunning them. Browser reports in `artifacts/` are ignored and never included in the runtime ZIP.
