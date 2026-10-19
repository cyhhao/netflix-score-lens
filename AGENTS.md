# Maintainer index

Chrome MV3 extension. Source: `https://github.com/cyhhao/netflix-score-lens`. Runtime is plain JS/CSS with no build dependencies. See README for installation, `docs/testing.md` for test boundaries, `CONTRACT.md` for messaging, and `docs/chrome-web-store.md` for unresolved store-release gates.

## Architecture
- `core.js`: matching, validation, native scales and thresholds.
- `providers.js`: no-Key candidates and ratings; `docs/providers.md` explains adapters.
- `background.js`: queue/cache, credentials, trusted-page messaging, explicit manual bindings and source health.
- `bridge.js`: requested Netflix ID → public year/type only, never account state.
- `content.*`: current/legacy Netflix cards, viewport work, overlays and HUD.
- `popup.*`: settings, correction and source diagnosis.
- `library.*`: read-only independent local cache browser; not a durable watchlist.

## Invariants
- No credentials, personal browser profiles, captured browsing history or private verification reports in Git, screenshots, logs or packages.
- Sources and rating scales stay distinct; absent/ambiguous results never dim. Localized inference needs verified year/type and IMDb rank 0; manual correction remains possible.
- Netflix IDs are stable binding identities, not an official cross-provider mapping. Reject stale per-title responses.
- Credentials/library enumeration and mutations are trusted-context-only. This restriction is not at-rest encryption; do not claim it is.
- Never execute provider responses as code. Changes to data handling, hosts/permissions or retention require privacy/store-documentation review.
- Do not restart a contributor's normal browser or bypass tooling restrictions. Browser tests must use disposable profiles.
- Fixture tests, live API tests, actual Netflix acceptance and store approval are separate claims.

## Workflow
Use a task branch/worktree and PR; keep the control worktree on main. `npm ci` and `npx playwright install chromium` per environment, then `npm test`, `npm run test:browser`, `npm run package`, `node tests/package-smoke.mjs`. Optional live tests are network-dependent. Generated artifacts/dist are ignored. Package script uses an explicit runtime allowlist; store ZIP must have root manifest.

MIT applies to original code only. Third-party ratings/metadata retain their own terms; see `THIRD_PARTY_NOTICES.md`. No store submission until documented release gates and account-owner approvals are complete.
