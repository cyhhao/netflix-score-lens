# Security

## Reporting a vulnerability

Use GitHub's private security advisory reporting for this repository. Do not include API keys, Netflix cookies, passwords, browser profile files or personal browsing history in public Issues. If private reporting is temporarily unavailable, open an Issue asking for a private contact without including the vulnerability details or secrets.

## Current model and limits

- MV3 service worker performs provider requests over HTTPS, with `credentials: 'omit'`.
- Settings mutation, credential storage and cached-library enumeration are restricted to trusted extension contexts. The Netflix content script receives only public settings/results.
- The MAIN-world bridge reads only requested title IDs' public title/year/type. For episodes it may follow a typed `parentShow` reference, or one `parentSeason` → `parentShow` hop, to return the show's public identity. It never enumerates the cache or exports account state; unresolved episodes cannot initiate rating lookups.
- No remotely downloaded code, `eval`-based response execution, analytics SDK, server-side account or project-owned collection endpoint is used.
- The optional OMDb API key and title cache are currently stored in Chrome local extension storage **without application-level encryption at rest**. TRUSTED_CONTEXTS is an access restriction, not encryption. This is not a credential vault and does not protect against access to the local browser profile, a compromised extension runtime or a compromised operating system.
- Rating requests and optional anonymous Netflix English-title requests can reveal title interests/IDs and the requesting IP to recipients. Public title parsing is bounded and non-executing; no HTML is retained. The privacy policy describes this transmission; do not advertise this as “no data leaves the device.”
- Ratings are externally supplied, potentially stale data. Matching can be wrong, including for localized titles. The extension is not an authoritative catalog or a security filter.

Before Chrome Web Store submission, review the currently applicable user-data requirements, improve at-rest credential/history handling, validate disclosure/consent and provider permissions, and complete a fresh production-browser acceptance run. A passing test or a valid ZIP is not a policy approval.

## Supported version

Only the latest GitHub release receives fixes. This project is currently distributed for manual unpacked installation and does not silently auto-update itself.
