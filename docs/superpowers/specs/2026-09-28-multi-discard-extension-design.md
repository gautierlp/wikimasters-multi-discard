# WikiMasters multi-discard extension: design

Date: 2026-09-28
Status: approved (design), pending implementation plan

## Purpose

Discarding cards on WikiMasters is one card at a time, which is tedious. This
Chrome extension adds bulk discard to the player's own My Collection page:
tick many cards, confirm once, and the extension discards them for you through
the same API the game itself uses.

Scope is the account owner's own player actions only. It uses the player's own
login session and only endpoints the player is already allowed to call. It is
not a map or a probe of the WikiMasters backend.

## Risk note (account owner accepts)

Automating a game action may violate the WikiMasters terms of service and could
put the account at risk. This is the account owner's decision, not a claim that
it is safe or allowed.

## Known facts from reconnaissance (2026-09-28)

Captured from the owner's own session on the live site.

**List collection (paginated):**
`GET /api/my-collection?sort=rarity&page=<N>&stats=0` (same-origin, cookie auth).
Response shape:
```json
{
  "collection": [
    {
      "id": "<user-card-uuid>",              // userCardId: the value discard needs
      "card": {
        "id": "<card-uuid>",            // catalog card id (== card_id)
        "rarity": "L",
        "image_url": "https://... or null",
        "wikipedia_title": "Pierre-Édouard Stérin",
        "atk": 10000, "def": 8714, "q_score": 79.51
      },
      "card_id": "<card-uuid>",
      "count": 1,
      "starred": true,
      "is_shiny": false,
      "tags": [],
      "user_id": "<user-uuid>",
      "obtained_at": "2026-09-27T15:01:04Z"
    }
  ],
  "total": null,
  "rarityCounts": {},
  "tagOptions": [],
  "pendingTradeCardIds": []
}
```
Page size is 50 (the grid renders 50 children per page; pages 0, 1, 2 were seen).
Pagination has no total when `stats=0`; loop pages until a page returns fewer
than 50 rows.

**Discard one card:**
`POST /api/user-cards/<userCardId>/discard` (same-origin, cookie auth, empty
body). Success is an HTTP 2xx (`res.ok`). This is a destructive, non-reversible
action.

**DOM of the collection page:**
- Card grid: a `div` whose class begins `flex flex-wrap justify-center gap-3 ...`.
  Its direct children (about 50) are the cards.
- Each card wrapper: `div.relative.isolate.group`, containing one `<img>` (the
  card image, `src` == `card.image_url`) and one `<h3>` (the `wikipedia_title`).
- No card element carries the `userCardId` in its markup. The extension must
  match each card to a data row by image URL, then by title.
- Cards append to the grid as the user scrolls (infinite scroll, not
  virtualized), so injected checkboxes must also be added to cards added later.

## Architecture

A Manifest V3 Chrome extension. All logic runs in a content script on
`https://www.wiki-masters.com/*`. Because `/api/*` is same-origin, the content
script's `fetch` sends the session cookie automatically. No `host_permissions`
for Supabase are needed; the extension never calls `supabase.co` directly and
never handles the auth token.

Source is written as small ES modules and bundled to one content script with
esbuild, so the logic modules can be unit-tested with vitest.

### Files

```
extension/
  manifest.json          # MV3, content script on the collection page
  src/
    api.js               # fetch all pages, build card map, discard call
    select.js            # protection rules and card-to-row binding
    content.js           # DOM: checkboxes, action bar, confirm box, queue
    styles.css           # checkbox and bar styling (injected)
  dist/
    content.js           # bundled output referenced by manifest
tests/
  api.test.js
  select.test.js
  queue.test.js
package.json             # scripts: build (esbuild), test (vitest)
```

### Module interfaces

`src/api.js`
- `COLLECTION_URL(page)` returns the paginated collection URL.
- `DISCARD_URL(userCardId)` returns the discard URL.
- `async fetchAllCollection(fetchFn = fetch)` -> `{ rows, pendingTradeCardIds }`.
  Loops page 0..N, stops when a page returns fewer than `PAGE_SIZE` rows.
  `rows` are the flattened `collection` items.
- `buildCardMap(rows)` -> `{ byImage: Map, byTitle: Map, ordered: rows }`.
  Keys: `card.image_url` and `card.wikipedia_title`. A null or empty `image_url`
  is not added to `byImage` (many cards have no image). Later duplicate keys do
  not overwrite earlier ones; index order is preserved in `ordered`.
- `async discardCard(userCardId, fetchFn = fetch)` -> `boolean` (`res.ok`).

`src/select.js`
- `isProtected(row, pendingSet)` -> `boolean`. True when `row.starred` is true,
  or `row.card_id` is in `pendingSet`, or `row.id` is in `pendingSet`.
  (Both id kinds are checked because the exact meaning of `pendingTradeCardIds`
  is unconfirmed; over-protect rather than under-protect.)
- `normalizeImgSrc(src)` -> the original image URL. WikiMasters renders card
  images through the Next.js image optimizer, so the `<img>` `src` is often
  `/_next/image?url=<encoded original>&w=...`. This helper returns the decoded
  `url` parameter when the src is a `/_next/image` URL, otherwise the src
  unchanged. Binding compares the normalized src, not the raw src.
- `bindCardElement(cardEl, map, index)` -> `row | null`. Match precedence:
  1. `normalizeImgSrc(<img>.src)` equals a `byImage` key.
  2. `<h3>` text equals a `byTitle` key.
  3. `map.ordered[index]` as a last-resort positional fallback.

`src/content.js`
- `findGrid()` -> the grid element (by the `flex flex-wrap justify-center`
  class signature, chosen as the child-heavy container of card wrappers).
- `injectAll(map, pendingSet)` adds a checkbox to each unprotected, bound card;
  protected cards get a small lock marker and no checkbox.
- A `MutationObserver` on the grid re-runs injection for cards added on scroll.
- Action bar: shows the selected count and a Discard button; hidden at count 0.
- `confirmDiscard(count)` -> a modal returning a boolean.
- `async runDiscardQueue(userCardIds, { delayMs, onProgress, discardFn })`.
  Discards one at a time, waits `delayMs` between calls, calls `onProgress`
  after each, and stops on the first failure, returning
  `{ done: [...], failedAt: userCardId | null }`.

### Constants

- `PAGE_SIZE = 50`
- `DELAY_MS = 400` (pause between discards)

## Data flow

1. Content script loads on the My Collection page and waits for the grid.
2. `fetchAllCollection` loads every page; `buildCardMap` indexes the rows.
3. `injectAll` binds each card element to a row and adds a checkbox, except for
   starred and pending-trade cards.
4. The user ticks cards; the action bar shows the count.
5. The user clicks Discard; `confirmDiscard` asks to confirm the count.
6. `runDiscardQueue` sends the discard calls one at a time with a 400 ms pause.
   Each success removes that card element and its checkbox.
7. On completion or first error, a short summary reports how many were discarded
   and which card failed, if any.

## Error handling

- A failed page fetch aborts the load and shows a message; no checkboxes appear.
- A card element that binds to no row gets no checkbox (it is skipped, not
  guessed).
- The discard queue stops on the first non-`ok` response and reports the failing
  `userCardId`. It does not continue blindly.
- All `fetch` calls use `credentials: 'include'` and are same-origin.

## Testing

Unit tests (vitest), on the pure logic with injected fakes:
- `api.test.js`: `fetchAllCollection` stops at a short page; `buildCardMap`
  key precedence; `discardCard` returns `res.ok`.
- `select.test.js`: `isProtected` for starred and pending ids; `bindCardElement`
  precedence (image, then title, then index).
- `queue.test.js`: `runDiscardQueue` calls in order, waits between calls, stops
  on first failure, reports the failing id.

Manual browser check: load the unpacked extension, open My Collection, tick one
unwanted card, discard it, confirm it is gone and the count updates. Confirm a
starred card shows the lock and no checkbox.

## Out of scope for version 1

- Filters, search, and a one-click "discard duplicates" button.
- Discarding starred or pending-trade cards.
- An options page or popup (delay and protection are constants).
- Chrome Web Store packaging (version 1 is loaded unpacked for personal use).
