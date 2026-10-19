# README screenshots

Generated with `node scripts/readme-screenshots.mjs` using the real MV3 extension in a disposable headless browser.

- `library.png`: actual independent library UI, seeded with visibly labelled synthetic entries.
- `settings.png`: actual popup document at 400×600, showing the controlled demo tab's state. It is opened as an extension tab, not a native toolbar-bubble capture.
- `ratings-overlay.png`: actual content-script badges and dimming on an explicitly labelled, locally intercepted card fixture; **not a capture of Netflix's live website**. All placeholder artwork is original SVG, and all titles/ratings are demonstration values.

The generator asserts one real low-score overlay, four library entries and zero provider fetches. It uses no normal browser profile, Netflix account, private browsing information or API key. No runtime HTML, JS or CSS is altered to make the screenshots, and these images/test values are not included in either extension ZIP.

The current extension UI is Simplified Chinese; the English README is documentation, not an English localization of the app.
