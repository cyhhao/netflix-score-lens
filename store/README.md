# Store preparation materials

**Not uploaded, submitted or approved.** Start with [START-HERE.zh-CN.md](START-HERE.zh-CN.md). Machine-readable gates are in [readiness.json](readiness.json); a valid package or complete artwork does not close them.

## Generate and validate

```sh
npm run store:assets
npm run package
node tests/package-smoke.mjs
npm run store:kit
```

`store:kit` validates and packages the **already reviewed, committed** images without regenerating them. It checks image/input hashes against `assets/provenance.json`, the runtime-only candidate, native locale strings, description lengths, PNG dimensions/color type, required materials and handoff-relative links. It writes `dist/netflix-score-lens-<version>-store-preparation.zip`, a **publisher handoff**, not an installable extension. Only its inner `upload/*-chrome-web-store.zip` is a future upload candidate. It contains no credentials and performs no dashboard actions.

## Artwork

- `assets/en/` and `assets/zh-CN/`: four localized 1280×800 screenshots each: cards, expanded preview, library, source details.
- `assets/promo-440x280.png`: one shared, language-neutral small promotional tile. Current CWS documentation does not allow localized promotional images.
- `assets/icon-128.png`: original 96px lens artwork centered in 128px with 16px transparent padding, matching the runtime's icon128.png.

Generated in disposable browsers using the actual content renderer and library UI. All shown titles/ratings are fictional and clearly labelled. The card page and portal-shaped hover preview are controlled fixtures, **not actual Netflix-account screenshots**. The library's demo annotation is editorial; it is not a production UI feature. No personal profiles, account names, third-party posters, API credentials or live provider calls are used. Screenshots prove rendering of the illustrated UI, not matching accuracy, live Netflix acceptance or store approval.

Source is `scripts/store-assets.mjs`; explicitly run `store:assets` when artwork needs regeneration, inspect the result, and commit images with `assets/provenance.json`. Rendering can vary with fonts, time and platform; CI must not silently replace the reviewed images. The generator records zero-provider-request render evidence and hashes the renderer inputs and output images. Neither demo data nor artwork enters the runtime ZIP. No runtime styles are changed for screenshots; library views are scrolled to keep details visible. Listing copy must be revisited if sources, storage, permissions or branding change before submission.
