# WikiMasters multi-discard: per-page loading

Date: 2026-09-28
Status: approved in chat (design), pending implementation plan
Builds on: `2026-09-28-multi-discard-extension-design.md` (version 1, merged)

## Problem

Version 1 loads every page of the collection before any checkbox appears, and
loads every page again before each discard. The owner's collection has 7 pages,
so this costs 14 requests and a few seconds. It does not scale: a collection of
1000 pages would never finish (the loader stops at `MAX_PAGES = 200`), and 200
pages already take about 40 seconds.

The card grid shows no card id, so the extension still needs the API data to
find the `userCardId` of a ticked card. The fix is to load only the data for the
cards on the screen.

## Facts from the live site (2026-09-28)

- The collection page is `https://www.wiki-masters.com/collection`.
- The grid shows one page of 50 cards at a time. It is paginated, not infinite
  scroll.
- To show a page, the site itself calls
  `GET /api/my-collection?sort=rarity&page=<N>&stats=0` with zero-based `N`
  (grid page 2 loads `page=1`). This is the same endpoint version 1 uses.
- Each card shows a rarity frame image first, then the portrait (or `/logo.png`
  when the card has no image), then the `<h3>` title. Version 1 already matches
  on any of the card's images.

## Design

The extension follows the site's own requests instead of loading everything.

1. **Watch the site's requests.** The content script reads the page's resource
   timing entries (`performance.getEntriesByType('resource')` for entries that
   already exist, plus a `PerformanceObserver` with `buffered: true` for new
   ones). This needs no extra permission and no script in the page's own world.
2. **Load the same address once.** For each entry whose URL is same-origin and
   whose path is exactly `/api/my-collection`, the extension fetches that exact
   URL (with `credentials: 'include'`) one time and keeps its rows. It never
   fetches any other URL. The extension's own fetch also creates a resource
   entry for the same URL; the store ignores a URL that it has already loaded
   or is loading, so there is no loop.
3. **Bind as before.** After each load, the card map is rebuilt from the rows of
   every page loaded so far, and the grid is scanned again. Binding rules,
   protection rules, and signatures do not change.
4. **Re-check only the pages concerned.** Before a discard, the extension
   fetches again only the page URLs that hold the ticked ids, one request each,
   and runs the existing `filterStillDiscardable` on the fresh rows. An id that
   moved to another page (after earlier discards shift the pages) counts as
   missing and is skipped. That is the safe side.
5. **Fallback.** If the grid is present but no `/api/my-collection` request is
   seen within `FALLBACK_MS = 3000`, the extension falls back to the version 1
   behavior (`fetchAllCollection`) and uses a full reload for the re-check.
   This covers a site change that serves the first page without a client fetch.

Cost: one extra request for each page the owner views, plus one request per
page concerned before a discard. The size of the collection has no effect.

## Components

`extension/src/api.js` (add)
- `async fetchCollectionPage(url, fetchFn = fetch)` -> `{ rows, pendingTradeCardIds }`.
  Throws `HTTP <status>` on a non-ok response.

`extension/src/pages.js` (new, pure, unit-tested)
- `isCollectionPageUrl(url, origin)` -> boolean. True only when `url` parses to
  the same origin and the path is exactly `/api/my-collection`.
- `createPageStore({ loadPage, loadAll })` -> store:
  - `seen(url)` -> promise of `true` when this call loaded new rows, else
    `false`. Loads a URL at most once; concurrent calls share one load. A
    failed load is remembered and not retried until the page reloads: the
    extension's own failed fetch shows up in resource timing too, so retrying
    it would just fail and retry again, forever. The error propagates to the
    caller of the call that triggered the load.
  - `useFallback()` -> loads everything once through `loadAll`, under the key
    `'*'`.
  - `rows()` -> the rows of every loaded page, one entry per row id.
  - `pendingTradeCardIds()` -> the union over every loaded page.
  - `size()` -> the number of loaded keys.
  - `recheck(ids)` -> reloads each key that holds at least one of `ids` (one
    call per key; `'*'` reloads through `loadAll`), replaces that key's data,
    and returns `{ rows, pendingTradeCardIds }` built from the reloaded keys
    only.

`extension/src/content.js` (change)
- Replace the startup `fetchAllCollection` with the store and the request
  watcher, the rebuild of `state.map` and `state.pendingSet` after each load,
  the fallback timer, and `store.recheck` in the discard path.
- A failed page load shows a non-sticky message and leaves that page without
  checkboxes; it does not stop the extension.

## Constraints kept from version 1

- Only same-origin `GET /api/my-collection?...` and
  `POST /api/user-cards/<id>/discard`, with `credentials: 'include'`.
- One discard at a time, 400 ms apart, stop at the first failure.
- Starred and pending-trade cards never get a checkbox; no positional guess.
- No em dashes in code, UI copy, or commits.

## Testing

- `tests/pages.test.js`: URL filter (same origin, exact path, any query;
  rejects other origins, other paths, `/api/my-collection-x`); `seen` loads once
  for repeated and concurrent calls; a failed load is not retried; `rows` and
  `pendingTradeCardIds` merge pages; `recheck` reloads only the keys that hold
  the ids, once each, and returns only their fresh data; fallback key `'*'`.
- `tests/api.test.js`: `fetchCollectionPage` sends the URL with credentials and
  throws on non-ok.
- Manual check on the live site: checkboxes appear on page 1; go to page 2 and
  back and confirm checkboxes each time; the Network tab shows one extension
  request per new page (not 7); a discard shows one re-check request, then the
  discard call.

## Out of scope

- Selection across pages (a page change already clears the selection, because
  the grid replaces its cards).
- Reading ids from the site's React state.
