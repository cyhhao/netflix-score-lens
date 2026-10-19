# README screenshots

Generated with the real MV3 extension in a disposable headless browser. The locale is explicit so each README shows the matching UI language — `*.zh-CN.png` in the default Chinese [README.md](../../README.md), `*.en.png` in [README.en.md](../../README.en.md):

```bash
node scripts/readme-screenshots.mjs en
node scripts/readme-screenshots.mjs zh-CN
```

Each locale produces:

- `library.<locale>.png`: actual independent library UI with visibly labelled synthetic entries.
- `settings.<locale>.png`: actual popup document at 400×600, showing the controlled demo tab's state. It is opened as an extension tab, not a native toolbar-bubble capture.
- `ratings-overlay.<locale>.png`: actual content-script badges and dimming on an explicitly labelled, locally intercepted card fixture; **not a capture of Netflix's live website**. All placeholder artwork is original SVG, and all titles/ratings are demonstration values.

The extension UI language comes from its language setting; the demo page's heading, labels, legend and disclaimer are written in the same locale. Titles stay fixed, fictional English names marked "Demo" in both locales.

The generator asserts one real low-score overlay, four library entries and zero provider fetches; `www.netflix.com` requests are answered with the local fixture, and any other web request is blocked and fails the run. It uses no normal browser profile, Netflix account, private browsing information or API key. No runtime HTML, JS or CSS is altered to make the screenshots, and these images/test values are not included in either extension ZIP.
