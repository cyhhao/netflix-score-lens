# Private reviewer instructions — draft, not submitted

Paste the final reviewed text into the Developer Dashboard's **Test instructions** field, not the public store description. Do not include an owner's personal account, API key or browser profile in this repository or in the handoff ZIP.

## Access prerequisite

Card and hover-preview features need a signed-in Netflix website with access to browseable title cards. The publisher must arrange a legitimate reviewer-accessible account/environment if requested, and provide any approved credentials only through the private dashboard field. **No reviewer account has been arranged in this kit.** Never claim that synthetic screenshots replace reviewer access. OMDb is optional; reviewers do not need to buy a key to test free-mode features.

## Core flow (English UI)

1. Install the submitted candidate. Open the popup and choose English if necessary. Keep the extension enabled and choose the free rating mode without an OMDb key.
2. In the authorized Netflix account, open a browse or search page with movie/show cards and scroll. Only cards near the viewport should start rating work. Source outages, missing scores and uncertain matches are possible; unconfirmed titles must not be dimmed.
3. Open the popup, select a rating source and adjust the minimum score and dim strength. A confidently matched title below the threshold should dim; hovering may restore brightness if hover reveal is enabled.
4. Wait for Netflix's separate expanded hover preview. It should share the original title's score; changing titles must not retain another title's score. Click the rating badge: extension source details should open without starting playback.
5. Review an uncertain match through the popup's title list, search for a candidate, explicitly bind it, and then restore automatic matching. Do not assume the first search result is correct.
6. Open Library. Check search, type/status filters, score/title/year sorting, grouping, and source details. Close the Netflix tab: existing cached entries should remain available. Library Refresh list rereads local cache; it is not a force-refresh-all network command.
7. Switch the interface between English and Simplified Chinese. It must not change Netflix's language or translate work titles.
8. Disable the extension and confirm overlays disappear and new automatic lookups stop. Re-enable and confirm normal operation. Reload the extension and refresh the Netflix tab when testing an unpacked candidate.
9. If an episode recommendation row is available, identified episodes should reuse their parent show's identity; an episode without explicit parent metadata stays unscored rather than searching its episode label as a movie.

## Optional OMDb / deletion checks

- Only if the publisher has separately provided an authorized test key: enable OMDb supplementation. Successful responses may add IMDb/RT/Metacritic, subject to coverage and quota. Free mode must not automatically send OMDb rating requests. Explicit provider-health testing can test a stored key even in free mode.
- Missing OMDb data is informational; transient failures show a source/stage diagnostic and use backoff. Usable free ratings remain available.
- Remove the test key with the explicit remove-key action. Clear cache removes scores and public-title aliases but preserves settings and manual bindings. While enabled on Netflix, encountered titles can repopulate the cache.

## Evidence boundary

The kit's bilingual images show the actual extension renderer with synthetic titles, ratings and original placeholder artwork. Card pages and the expanded-preview shell are illustrative fixtures, not captured Netflix accounts. Local test reports do not assert catalog-wide coverage, production acceptance, store approval or authority to use every upstream data source. Complete the pending release gates in START-HERE.zh-CN.md before submission.
