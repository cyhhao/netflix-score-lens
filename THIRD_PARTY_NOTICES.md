# Third-party notices and data rights

The MIT license in `LICENSE` covers this repository's original code and its original lens artwork. It does **not** grant rights to external databases, API responses, trademarks, movie/show artwork, or third-party services. No movie posters, Netflix account data, service credentials or downloaded rating databases are bundled.

## TVmaze

TVmaze is the source of its own independent show rating, not an IMDb rating. Its API documentation states that use is subject to Creative Commons Attribution-ShareAlike (CC BY-SA). Preserve attribution and a link to the corresponding TVmaze show page wherever these ratings are presented. Derivative datasets, if any, need separate attention to the applicable share-alike terms; the code license does not override them.

- API and licensing: https://www.tvmaze.com/api
- Source links are retained with each score. Popup/source details and the library identify TVmaze.

## Cinemeta / Stremio and IMDb

Cinemeta supplies a mirrored IMDb score and title metadata. This is not an official IMDb rating API. The IMDb suggestion endpoint is an undocumented search endpoint used for candidate titles/IDs, not a licensed bulk database distribution mechanism. Public accessibility is **not proof of permission for every use**. The maintainer has not obtained a blanket commercial redistribution license or a service-level commitment. Confirm applicable service/data terms before broad store distribution or commercialization; use an authorized alternative if required.

- Cinemeta source project: https://github.com/Stremio/stremio-cinemeta
- IMDb conditions: https://www.imdb.com/conditions

## OMDb, Rotten Tomatoes and Metacritic

OMDb access is optional and uses the installing user's own API key. The project supplies no shared key and does not resell access. Ratings and coverage are subject to OMDb's own terms and the rights of the underlying sources. Availability through an API is not a blanket license to redistribute the underlying data. The maintainers make no claim that code being MIT-licensed settles these rights.

- OMDb: https://www.omdbapi.com/
- Rotten Tomatoes and Metacritic source links are human-facing search links where an exact provider permalink is unavailable; they are not guaranteed exact-work permalinks.

## Netflix public display titles

For weak automatic matches, the extension may request a public Netflix title page anonymously for an encountered Netflix ID and retain only the verified English display name, ID, source URL and cache metadata. It does not bundle pages, posters or a catalog database. Public availability does not establish unrestricted scraping or redistribution rights; applicable Netflix terms and the suitability of this optional enrichment require review before store distribution. The code license does not grant Netflix metadata or trademark rights.

## Development dependencies

Playwright is used only for development/testing and is not packaged into the extension. Its own package includes the Apache-2.0 license and notices. Node.js, Chromium, Python and GitHub Actions are development tools/services with their own terms; they are not part of the runtime ZIP.

## Names and screenshots

Netflix, IMDb, Rotten Tomatoes, Metacritic, TVmaze and Stremio names belong to their owners. This is an independent project, not an official or endorsed product. Store screenshot drafts generated in this repository use explicitly labelled demonstration data and original placeholder artwork, not personal browser captures or third-party movie posters. Replace/review them for accuracy and policy compliance before submission.
