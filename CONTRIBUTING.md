# Contributing

1. Open an Issue for substantial behavior or data-source changes. Never attach credentials or personal browser captures.
2. Fork/branch, then run `npm ci`, `npm test`, `npx playwright install chromium`, and `npm run test:browser`.
3. Use a disposable browser profile. Live-provider tests (`npm run test:live`) are optional and network-dependent; no real API key is required by the default suites.
4. Keep sources and scales distinct. Missing/unconfirmed ratings must not dim, source failures must not masquerade as “no rating,” and localized matching must remain conservative.
5. Preserve MV3 CSP, narrow permissions, trusted-only credentials and per-title stale-response isolation. Provider adapters must not execute downloaded code.
6. Add a regression test, update relevant docs and create a PR describing behavior, tests, risks and screenshots if appropriate. Screenshot data must be synthetic or explicitly cleared for publication.
7. `npm run package` must remain a runtime-only allowlist. Do not include `node_modules`, tests, artifacts, browser profiles, `.env` files, keys or personal paths.

Changes to permissions, data collection/transmission, retention or credential handling need matching updates to privacy disclosures and store materials. Adding a public endpoint is not sufficient evidence of data-use rights.

Code contributed here is licensed under MIT; do not copy code/assets/data that cannot be distributed under their applicable terms.
