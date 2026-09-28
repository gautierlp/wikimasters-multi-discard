# WikiMasters Multi-Discard Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that adds checkboxes to the WikiMasters My Collection page and discards the ticked cards one at a time through the game's own API.

**Architecture:** Pure logic lives in small ES modules (`api.js`, `select.js`, `queue.js`, `ui.js`) that are unit-tested with vitest (jsdom for the DOM parts). `content.js` is the thin entry point that wires them to the live page (MutationObserver, action bar, confirm modal). esbuild bundles `content.js` into `extension/dist/content.js`, which the manifest loads.

**Tech Stack:** Node 23, npm, vitest 4, jsdom, esbuild 0.28, Chrome MV3 content script, plain JavaScript (no framework, no TypeScript).

**Global Constraints:**
- Only same-origin calls: `GET /api/my-collection?sort=rarity&page=<N>&stats=0` and `POST /api/user-cards/<userCardId>/discard`, both with `credentials: 'include'`. No other endpoint, no `supabase.co`, no auth token handling, no `host_permissions`.
- `PAGE_SIZE = 50`, `DELAY_MS = 400`, `MAX_PAGES = 200`.
- Discards run strictly one at a time, with `DELAY_MS` between calls, and stop on the first non-ok response or thrown error.
- A starred card, or a card whose `card_id` or `id` is in `pendingTradeCardIds`, never gets a checkbox.
- A card element that binds to no row gets no checkbox. There is no positional (index) fallback.
- Each data row binds to at most one card element at a time.
- No em dashes in code, comments, UI copy, or commit messages.
- Conventional-commit messages, no Claude co-author trailer.

**User decisions (already made):**
- "Scope is the account owner's own player actions only." (spec, Purpose)
- "Automating a game action may violate the WikiMasters terms of service ... This is the account owner's decision." (spec, Risk note)
- Version 1 is loaded unpacked for personal use; no options page, no popup, no Web Store packaging. (spec, Out of scope)

**Deviations from the spec (decided while planning, reasons inline):**
1. **No positional fallback in `bindCardElement`.** The spec lists `map.ordered[index]` as step 3, but its own Error handling section says an unbound card "is skipped, not guessed". For a non-reversible discard, a wrong guess deletes the wrong card, so the skip rule wins.
2. **Rows are claimed.** `buildCardMap` indexes `Map<key, row[]>` (all rows per key, in order) and `bindCardElement(cardEl, map, claimed)` returns the first unclaimed row and adds its id to `claimed`. Without this, two copies of the same card would both bind to the first row and the second discard would target an already-discarded id.
3. **`runDiscardQueue` lives in `src/queue.js`**, not `content.js`, so tests can import it without DOM side effects. DOM helpers that can be tested (`findGrid`, `scanGrid`, `selectedForDiscard`, `markDiscarded`) live in `src/ui.js`.
4. **Discarded cards are hidden (`display: none`), not removed.** The grid is React-managed; removing a node React owns can crash the page on its next re-render.
5. **Bindings are re-verified.** React can reuse a card element for a different card (sort or filter change). Each scan checks that a bound element still shows its row's image or title, and rebinds if not. `selectedForDiscard` repeats the check just before the queue runs.
6. **Page guard.** The content script only acts when `location.pathname` matches `/collection/i`, so it does not fetch the collection on every WikiMasters page. Task 6 confirms the real path.
7. **Pagination guard.** `fetchAllCollection` throws after `MAX_PAGES` pages, so a server that ignores `page` cannot cause an endless loop.

---

## File structure

```
.gitignore                 # node_modules/, extension/dist/
package.json               # "type": "module"; scripts build, test
extension/
  manifest.json            # MV3; content script dist/content.js + src/styles.css
  README.md                # how to build and load unpacked
  src/
    api.js                 # URLs, fetchAllCollection, buildCardMap, discardCard
    select.js              # isProtected, normalizeImgSrc, bindCardElement
    queue.js               # DELAY_MS, runDiscardQueue
    ui.js                  # findGrid, cardWrappers, stillMatches, createState, scanGrid, selectedForDiscard, markDiscarded
    content.js             # entry: observer, action bar, confirm modal, wiring
    styles.css             # checkbox, lock, bar, modal
  dist/content.js          # build output (git-ignored)
tests/
  helpers.js               # row() fixture, fakeFetch(), cardEl()
  api.test.js
  select.test.js
  queue.test.js
  ui.test.js
```

---

### Task 1: Project scaffold and API module

**Goal:** A runnable npm project with vitest, plus `extension/src/api.js` (collection fetch, card map, discard call) fully unit-tested.

**Files:**
- Create: `.gitignore`, `package.json`, `tests/helpers.js`, `extension/src/api.js`
- Test: `tests/api.test.js`

**Acceptance Criteria:**
- [ ] `npm test` runs vitest and all `tests/api.test.js` cases pass.
- [ ] `fetchAllCollection` requests `/api/my-collection?sort=rarity&page=0&stats=0`, then page 1, 2, ... with `credentials: 'include'`, and stops after the first page with fewer than 50 rows.
- [ ] `fetchAllCollection` throws `HTTP <status>` on a non-ok page and throws after 200 full pages.
- [ ] `buildCardMap` skips null or empty `image_url`, keeps every row per key in input order.
- [ ] `discardCard` sends `POST /api/user-cards/<id>/discard` with `credentials: 'include'` and returns `res.ok`.

**Verify:** `npm test -- tests/api.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Scaffold the project**

`.gitignore`:
```
node_modules/
extension/dist/
```

`package.json`:
```json
{
  "name": "wikimasters-multi-discard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild extension/src/content.js --bundle --format=iife --target=chrome120 --outfile=extension/dist/content.js",
    "test": "vitest run"
  }
}
```

Run: `npm install --save-dev vitest@4 jsdom@30 esbuild@0.28`
Expected: `package-lock.json` created, `devDependencies` added to `package.json`.

- [ ] **Step 2: Write the shared test helpers**

`tests/helpers.js`:
```js
// A collection row shaped like the real /api/my-collection items.
export function row(i, over = {}) {
  return {
    id: `uc-${i}`,
    card_id: `c-${i}`,
    starred: false,
    count: 1,
    card: { id: `c-${i}`, image_url: `https://img.test/${i}.png`, wikipedia_title: `Title ${i}` },
    ...over,
  };
}

export function rows(from, n) {
  return Array.from({ length: n }, (_, k) => row(from + k));
}

// pages: { [pageNumber]: responseBody }. A missing page answers HTTP 500.
export function fakeFetch(pages) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const page = Number(new URL(url, 'https://x.test').searchParams.get('page'));
    const body = typeof pages === 'function' ? pages(page) : pages[page];
    if (body === undefined) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

// A card wrapper as rendered on My Collection.
export function cardEl(src, title) {
  const el = document.createElement('div');
  el.className = 'relative isolate group';
  const img = document.createElement('img');
  if (src !== null) img.setAttribute('src', src);
  const h3 = document.createElement('h3');
  h3.textContent = title;
  el.append(img, h3);
  return el;
}
```

- [ ] **Step 3: Write the failing tests**

`tests/api.test.js`:
```js
import { describe, it, expect } from 'vitest';
import {
  PAGE_SIZE, MAX_PAGES, COLLECTION_URL, DISCARD_URL,
  fetchAllCollection, buildCardMap, discardCard,
} from '../extension/src/api.js';
import { row, rows, fakeFetch } from './helpers.js';

describe('URLs and constants', () => {
  it('match the recorded endpoints', () => {
    expect(PAGE_SIZE).toBe(50);
    expect(MAX_PAGES).toBe(200);
    expect(COLLECTION_URL(3)).toBe('/api/my-collection?sort=rarity&page=3&stats=0');
    expect(DISCARD_URL('abc-1')).toBe('/api/user-cards/abc-1/discard');
  });
});

describe('fetchAllCollection', () => {
  it('loops pages until a short page and flattens rows', async () => {
    const f = fakeFetch({
      0: { collection: rows(0, 50), pendingTradeCardIds: [] },
      1: { collection: rows(50, 50), pendingTradeCardIds: [] },
      2: { collection: rows(100, 3), pendingTradeCardIds: [] },
    });
    const { rows: out } = await fetchAllCollection(f);
    expect(out).toHaveLength(103);
    expect(out[102].id).toBe('uc-102');
    expect(f.calls.map((c) => c.url)).toEqual([
      '/api/my-collection?sort=rarity&page=0&stats=0',
      '/api/my-collection?sort=rarity&page=1&stats=0',
      '/api/my-collection?sort=rarity&page=2&stats=0',
    ]);
    expect(f.calls.every((c) => c.opts.credentials === 'include')).toBe(true);
  });

  it('returns an empty list for an empty collection', async () => {
    const f = fakeFetch({ 0: { collection: [], pendingTradeCardIds: [] } });
    const out = await fetchAllCollection(f);
    expect(out).toEqual({ rows: [], pendingTradeCardIds: [] });
    expect(f.calls).toHaveLength(1);
  });

  it('unions pendingTradeCardIds across pages without duplicates', async () => {
    const f = fakeFetch({
      0: { collection: rows(0, 50), pendingTradeCardIds: ['c-1', 'c-2'] },
      1: { collection: rows(50, 1), pendingTradeCardIds: ['c-2', 'uc-7'] },
    });
    const { pendingTradeCardIds } = await fetchAllCollection(f);
    expect(pendingTradeCardIds.sort()).toEqual(['c-1', 'c-2', 'uc-7']);
  });

  it('throws on a failed page', async () => {
    const f = fakeFetch({ 0: { collection: rows(0, 50), pendingTradeCardIds: [] } });
    await expect(fetchAllCollection(f)).rejects.toThrow('HTTP 500');
  });

  it('throws when the server never returns a short page', async () => {
    const f = fakeFetch(() => ({ collection: rows(0, 50), pendingTradeCardIds: [] }));
    await expect(fetchAllCollection(f)).rejects.toThrow('more than 200 pages');
    expect(f.calls).toHaveLength(200);
  });
});

describe('buildCardMap', () => {
  it('indexes by image and title, keeps duplicates in order, skips empty images', () => {
    const a = row(1);
    const b = row(2, { card: { ...row(1).card } }); // second copy of card 1
    const c = row(3, { card: { id: 'c-3', image_url: null, wikipedia_title: 'No Image' } });
    const d = row(4, { card: { id: 'c-4', image_url: '', wikipedia_title: 'Empty Image' } });
    const map = buildCardMap([a, b, c, d]);
    expect(map.byImage.get('https://img.test/1.png')).toEqual([a, b]);
    expect(map.byTitle.get('Title 1')).toEqual([a, b]);
    expect(map.byTitle.get('No Image')).toEqual([c]);
    expect([...map.byImage.keys()]).toEqual(['https://img.test/1.png']);
    expect(map.ordered).toEqual([a, b, c, d]);
  });
});

describe('discardCard', () => {
  it('POSTs to the discard URL and returns res.ok', async () => {
    const calls = [];
    const ok = await discardCard('uc-9', async (url, opts) => { calls.push({ url, opts }); return { ok: true }; });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ url: '/api/user-cards/uc-9/discard', opts: { method: 'POST', credentials: 'include' } }]);
  });

  it('returns false on a non-ok response', async () => {
    expect(await discardCard('uc-9', async () => ({ ok: false, status: 403 }))).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npm test -- tests/api.test.js`
Expected: FAIL, cannot resolve `../extension/src/api.js`.

- [ ] **Step 5: Implement `extension/src/api.js`**

```js
export const PAGE_SIZE = 50;
export const MAX_PAGES = 200;

export const COLLECTION_URL = (page) => `/api/my-collection?sort=rarity&page=${page}&stats=0`;
export const DISCARD_URL = (userCardId) => `/api/user-cards/${encodeURIComponent(userCardId)}/discard`;

// Loads every page of the player's collection. The API returns no total when
// stats=0, so we stop at the first page that has fewer than PAGE_SIZE rows.
export async function fetchAllCollection(fetchFn = fetch) {
  const rows = [];
  const pending = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchFn(COLLECTION_URL(page), { credentials: 'include' });
    if (!res.ok) throw new Error(`Collection page ${page} failed: HTTP ${res.status}`);
    const data = await res.json();
    const items = data.collection ?? [];
    rows.push(...items);
    for (const id of data.pendingTradeCardIds ?? []) pending.add(id);
    if (items.length < PAGE_SIZE) return { rows, pendingTradeCardIds: [...pending] };
  }
  throw new Error(`Collection has more than ${MAX_PAGES} pages; stopped to avoid an endless loop`);
}

function addTo(index, key, row) {
  if (!key) return;
  const list = index.get(key);
  if (list) list.push(row);
  else index.set(key, [row]);
}

// Every row is kept under its key, in input order, so copies of the same card
// can each bind to their own card element (see bindCardElement).
export function buildCardMap(rows) {
  const byImage = new Map();
  const byTitle = new Map();
  for (const row of rows) {
    addTo(byImage, row.card?.image_url, row);
    addTo(byTitle, row.card?.wikipedia_title, row);
  }
  return { byImage, byTitle, ordered: rows };
}

export async function discardCard(userCardId, fetchFn = fetch) {
  const res = await fetchFn(DISCARD_URL(userCardId), { method: 'POST', credentials: 'include' });
  return res.ok;
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npm test -- tests/api.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json tests/helpers.js tests/api.test.js extension/src/api.js
git commit -m "feat(api): fetch the full collection and discard one card"
```

---

### Task 2: Protection rules and card binding

**Goal:** `extension/src/select.js` decides which rows are protected and binds a card element to exactly one unclaimed row, by image then title, never by position.

**Files:**
- Create: `extension/src/select.js`
- Test: `tests/select.test.js`

**Acceptance Criteria:**
- [ ] `isProtected` is true for a starred row, and for a row whose `card_id` or `id` is in the pending set; false otherwise.
- [ ] `normalizeImgSrc` returns the decoded `url` param for relative and absolute `/_next/image` URLs, the input unchanged otherwise, and `''` for null.
- [ ] `bindCardElement` prefers the image match over the title match, falls back to title, and returns null when neither matches.
- [ ] Two elements showing the same card bind to two different rows; a third element gets null; `claimed` holds both row ids.

**Verify:** `npm test -- tests/select.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

`tests/select.test.js`:
```js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isProtected, normalizeImgSrc, bindCardElement } from '../extension/src/select.js';
import { buildCardMap } from '../extension/src/api.js';
import { row, cardEl } from './helpers.js';

describe('isProtected', () => {
  const pending = new Set(['c-2', 'uc-3']);
  it('protects starred rows', () => expect(isProtected(row(1, { starred: true }), pending)).toBe(true));
  it('protects rows whose card_id is pending', () => expect(isProtected(row(2), pending)).toBe(true));
  it('protects rows whose id is pending', () => expect(isProtected(row(3), pending)).toBe(true));
  it('leaves other rows unprotected', () => expect(isProtected(row(4), pending)).toBe(false));
});

describe('normalizeImgSrc', () => {
  const original = 'https://cdn.test/cards/a b.png';
  const enc = encodeURIComponent(original);
  it('decodes a relative Next.js image URL', () => {
    expect(normalizeImgSrc(`/_next/image?url=${enc}&w=384&q=75`)).toBe(original);
  });
  it('decodes an absolute Next.js image URL', () => {
    expect(normalizeImgSrc(`https://www.wiki-masters.com/_next/image?url=${enc}&w=384&q=75`)).toBe(original);
  });
  it('returns a plain URL unchanged', () => {
    expect(normalizeImgSrc('https://img.test/1.png')).toBe('https://img.test/1.png');
  });
  it('returns an empty string for a missing src', () => {
    expect(normalizeImgSrc(null)).toBe('');
    expect(normalizeImgSrc(undefined)).toBe('');
  });
});

describe('bindCardElement', () => {
  const map = buildCardMap([row(1), row(2), row(3, { card: { id: 'c-3', image_url: null, wikipedia_title: 'Only Title' } })]);

  it('prefers the image match over the title match', () => {
    const el = cardEl('https://img.test/1.png', 'Title 2');
    expect(bindCardElement(el, map, new Set()).id).toBe('uc-1');
  });

  it('matches a Next.js-optimized image', () => {
    const el = cardEl(`/_next/image?url=${encodeURIComponent('https://img.test/2.png')}&w=256&q=75`, 'x');
    expect(bindCardElement(el, map, new Set()).id).toBe('uc-2');
  });

  it('falls back to the title', () => {
    const el = cardEl(null, 'Only Title');
    expect(bindCardElement(el, map, new Set()).id).toBe('uc-3');
  });

  it('returns null when nothing matches, with no positional guess', () => {
    const el = cardEl('https://img.test/999.png', 'Unknown');
    expect(bindCardElement(el, map, new Set())).toBeNull();
  });

  it('binds copies of one card to different rows and claims them', () => {
    const copies = buildCardMap([row(1), row(5, { card: { ...row(1).card } })]);
    const claimed = new Set();
    const first = bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, claimed);
    const second = bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, claimed);
    const third = bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, claimed);
    expect([first.id, second.id, third]).toEqual(['uc-1', 'uc-5', null]);
    expect([...claimed]).toEqual(['uc-1', 'uc-5']);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -- tests/select.test.js`
Expected: FAIL, cannot resolve `../extension/src/select.js`.

- [ ] **Step 3: Implement `extension/src/select.js`**

```js
const ORIGIN = 'https://www.wiki-masters.com';

// Over-protect: pendingTradeCardIds may hold catalog ids or user-card ids.
export function isProtected(row, pendingSet) {
  return row.starred === true || pendingSet.has(row.card_id) || pendingSet.has(row.id);
}

// Next.js serves images as /_next/image?url=<original>&w=..; return <original>.
export function normalizeImgSrc(src) {
  if (!src) return '';
  let url;
  try {
    url = new URL(src, ORIGIN);
  } catch {
    return src;
  }
  if (url.pathname === '/_next/image') return url.searchParams.get('url') || src;
  return src;
}

function firstUnclaimed(list, claimed) {
  return list?.find((r) => !claimed.has(r.id)) ?? null;
}

// Binds a card element to one row and claims it. Returns null rather than
// guess: a wrong guess would discard the wrong card.
export function bindCardElement(cardEl, map, claimed) {
  const src = normalizeImgSrc(cardEl.querySelector('img')?.getAttribute('src'));
  const title = cardEl.querySelector('h3')?.textContent.trim();
  const row =
    (src && firstUnclaimed(map.byImage.get(src), claimed)) ||
    (title && firstUnclaimed(map.byTitle.get(title), claimed)) ||
    null;
  if (row) claimed.add(row.id);
  return row;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test -- tests/select.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/select.js tests/select.test.js
git commit -m "feat(select): protection rules and one-row-per-card binding"
```

---

### Task 3: Discard queue

**Goal:** `extension/src/queue.js` runs discards one at a time with a pause between them and stops on the first failure.

**Files:**
- Create: `extension/src/queue.js`
- Test: `tests/queue.test.js`

**Acceptance Criteria:**
- [ ] `DELAY_MS` is 400.
- [ ] Ids are discarded in input order; the sleep runs between calls only (n-1 times, with `delayMs`).
- [ ] A `false` result or a thrown error stops the queue; later ids are not called; the result is `{ done, failedAt }`.
- [ ] `onProgress` is called after each success with `{ id, done, total }`.

**Verify:** `npm test -- tests/queue.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

`tests/queue.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { DELAY_MS, runDiscardQueue } from '../extension/src/queue.js';

function recorder(results = {}) {
  const log = [];
  return {
    log,
    discardFn: async (id) => {
      log.push(`discard:${id}`);
      const r = results[id];
      if (r instanceof Error) throw r;
      return r ?? true;
    },
    sleepFn: async (ms) => { log.push(`sleep:${ms}`); },
  };
}

describe('runDiscardQueue', () => {
  it('uses a 400 ms default delay', () => expect(DELAY_MS).toBe(400));

  it('discards in order and sleeps only between calls', async () => {
    const r = recorder();
    const out = await runDiscardQueue(['a', 'b', 'c'], { delayMs: 400, discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(r.log).toEqual(['discard:a', 'sleep:400', 'discard:b', 'sleep:400', 'discard:c']);
    expect(out).toEqual({ done: ['a', 'b', 'c'], failedAt: null });
  });

  it('stops on the first false result', async () => {
    const r = recorder({ b: false });
    const out = await runDiscardQueue(['a', 'b', 'c'], { delayMs: 1, discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(r.log).toEqual(['discard:a', 'sleep:1', 'discard:b']);
    expect(out).toEqual({ done: ['a'], failedAt: 'b' });
  });

  it('treats a thrown error as a failure', async () => {
    const r = recorder({ a: new Error('network') });
    const out = await runDiscardQueue(['a', 'b'], { delayMs: 1, discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(out).toEqual({ done: [], failedAt: 'a' });
    expect(r.log).toEqual(['discard:a']);
  });

  it('reports progress after each success', async () => {
    const r = recorder();
    const seen = [];
    await runDiscardQueue(['a', 'b'], { delayMs: 1, discardFn: r.discardFn, sleepFn: r.sleepFn, onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([{ id: 'a', done: 1, total: 2 }, { id: 'b', done: 2, total: 2 }]);
  });

  it('does nothing for an empty list', async () => {
    const r = recorder();
    expect(await runDiscardQueue([], { discardFn: r.discardFn, sleepFn: r.sleepFn })).toEqual({ done: [], failedAt: null });
    expect(r.log).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -- tests/queue.test.js`
Expected: FAIL, cannot resolve `../extension/src/queue.js`.

- [ ] **Step 3: Implement `extension/src/queue.js`**

```js
import { discardCard } from './api.js';

export const DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Discards one card at a time. Stops at the first failure instead of
// continuing blindly, and reports which id failed.
export async function runDiscardQueue(
  userCardIds,
  { delayMs = DELAY_MS, onProgress = () => {}, discardFn = discardCard, sleepFn = sleep } = {},
) {
  const done = [];
  for (const [i, id] of userCardIds.entries()) {
    if (i > 0) await sleepFn(delayMs);
    let ok;
    try {
      ok = await discardFn(id);
    } catch {
      ok = false;
    }
    if (!ok) return { done, failedAt: id };
    done.push(id);
    onProgress({ id, done: done.length, total: userCardIds.length });
  }
  return { done, failedAt: null };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test -- tests/queue.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/queue.js tests/queue.test.js
git commit -m "feat(queue): sequential discard queue that stops on first failure"
```

---

### Task 4: Grid scan and selection state

**Goal:** `extension/src/ui.js` finds the card grid, injects a checkbox or a lock per bound card, keeps bindings correct when React reuses or removes elements, and tracks the selection.

**Files:**
- Create: `extension/src/ui.js`
- Test: `tests/ui.test.js`

**Acceptance Criteria:**
- [ ] `findGrid` returns the `div.flex.flex-wrap.justify-center` with the most card wrappers and ignores one with none; returns null when no grid has cards.
- [ ] `scanGrid` adds one `input.wmd-check` (with `data-user-card-id`) to an unprotected bound card, one `.wmd-lock` and no checkbox to a protected card, nothing to an unbound card; a second scan adds nothing.
- [ ] Ticking a checkbox adds its id to `state.selected` and calls `onChange(1)`.
- [ ] When a bound element now shows another card, the next scan rebinds it and drops the old selection.
- [ ] When a bound element leaves the DOM, the next scan releases its row so a new element for that card can bind.
- [ ] `selectedForDiscard` excludes a selected element whose content changed since the last scan.
- [ ] `markDiscarded` hides the element, removes its control and selection, and calls `onChange`.

**Verify:** `npm test -- tests/ui.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

`tests/ui.test.js`:
```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { findGrid, createState, scanGrid, selectedForDiscard, markDiscarded } from '../extension/src/ui.js';
import { buildCardMap } from '../extension/src/api.js';
import { row, cardEl } from './helpers.js';

function makeGrid(cards) {
  const grid = document.createElement('div');
  grid.className = 'flex flex-wrap justify-center gap-3';
  grid.append(...cards);
  document.body.append(grid);
  return grid;
}

function setup(rowsList, pending = []) {
  const changes = [];
  const state = createState({ map: buildCardMap(rowsList), pendingSet: new Set(pending), onChange: (n) => changes.push(n) });
  return { state, changes };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('findGrid', () => {
  it('picks the flex-wrap container that holds card wrappers', () => {
    const decoy = document.createElement('div');
    decoy.className = 'flex flex-wrap justify-center';
    decoy.append(document.createElement('span'));
    document.body.append(decoy);
    const grid = makeGrid([cardEl('https://img.test/1.png', 'Title 1')]);
    expect(findGrid(document)).toBe(grid);
  });

  it('finds wrappers nested one level inside grid children', () => {
    const outer = document.createElement('div');
    outer.append(cardEl('https://img.test/1.png', 'Title 1'));
    const grid = makeGrid([outer]);
    expect(findGrid(document)).toBe(grid);
  });

  it('returns null when no grid has cards', () => {
    expect(findGrid(document)).toBeNull();
  });
});

describe('scanGrid', () => {
  it('adds a checkbox, a lock, or nothing, and is idempotent', () => {
    const { state } = setup([row(1), row(2, { starred: true })]);
    const [free, starred, unknown] = [
      cardEl('https://img.test/1.png', 'Title 1'),
      cardEl('https://img.test/2.png', 'Title 2'),
      cardEl('https://img.test/9.png', 'Nope'),
    ];
    const grid = makeGrid([free, starred, unknown]);
    scanGrid(grid, state);
    scanGrid(grid, state);
    expect(free.querySelectorAll('input.wmd-check')).toHaveLength(1);
    expect(free.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-1');
    expect(starred.querySelectorAll('.wmd-lock')).toHaveLength(1);
    expect(starred.querySelector('input.wmd-check')).toBeNull();
    expect(unknown.querySelector('.wmd-ctl')).toBeNull();
  });

  it('tracks the selection when a checkbox is ticked', () => {
    const { state, changes } = setup([row(1)]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    scanGrid(makeGrid([el]), state);
    el.querySelector('input.wmd-check').click();
    expect([...state.selected.keys()]).toEqual(['uc-1']);
    expect(changes).toEqual([1]);
  });

  it('rebinds an element that now shows another card', () => {
    const { state } = setup([row(1), row(2)]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([el]);
    scanGrid(grid, state);
    el.querySelector('input.wmd-check').click();
    el.querySelector('img').setAttribute('src', 'https://img.test/2.png');
    el.querySelector('h3').textContent = 'Title 2';
    scanGrid(grid, state);
    expect(el.querySelectorAll('.wmd-ctl')).toHaveLength(1);
    expect(el.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-2');
    expect(state.selected.size).toBe(0);
    expect(state.claimed.has('uc-1')).toBe(false);
  });

  it('releases the row of an element removed from the DOM', () => {
    const { state } = setup([row(1)]);
    const first = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([first]);
    scanGrid(grid, state);
    first.remove();
    const second = cardEl('https://img.test/1.png', 'Title 1');
    grid.append(second);
    scanGrid(grid, state);
    expect(second.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-1');
  });
});

describe('selectedForDiscard and markDiscarded', () => {
  it('excludes an element whose content changed since the last scan', () => {
    const { state } = setup([row(1), row(2)]);
    const a = cardEl('https://img.test/1.png', 'Title 1');
    const b = cardEl('https://img.test/2.png', 'Title 2');
    scanGrid(makeGrid([a, b]), state);
    a.querySelector('input.wmd-check').click();
    b.querySelector('input.wmd-check').click();
    b.querySelector('img').setAttribute('src', 'https://img.test/7.png');
    b.querySelector('h3').textContent = 'Other';
    expect(selectedForDiscard(state)).toEqual(['uc-1']);
  });

  it('hides a discarded card and clears its selection', () => {
    const { state, changes } = setup([row(1)]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    scanGrid(makeGrid([el]), state);
    el.querySelector('input.wmd-check').click();
    markDiscarded(state, 'uc-1');
    expect(el.style.display).toBe('none');
    expect(el.querySelector('.wmd-ctl')).toBeNull();
    expect(state.selected.size).toBe(0);
    expect(changes).toEqual([1, 0]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -- tests/ui.test.js`
Expected: FAIL, cannot resolve `../extension/src/ui.js`.

- [ ] **Step 3: Implement `extension/src/ui.js`**

```js
import { bindCardElement, isProtected, normalizeImgSrc } from './select.js';

const WRAPPER = '.relative.isolate.group';

export function cardWrappers(grid) {
  const out = [];
  for (const child of grid.children) {
    const wrapper = child.matches(WRAPPER) ? child : child.querySelector(WRAPPER);
    if (wrapper) out.push(wrapper);
  }
  return out;
}

// The card grid has no id; pick the flex-wrap container with the most cards.
export function findGrid(root = document) {
  let best = null;
  let bestCount = 0;
  for (const el of root.querySelectorAll('div.flex.flex-wrap.justify-center')) {
    const n = cardWrappers(el).length;
    if (n > bestCount) {
      best = el;
      bestCount = n;
    }
  }
  return best;
}

// True when the element still shows the card of its bound row.
export function stillMatches(cardEl, row) {
  const src = normalizeImgSrc(cardEl.querySelector('img')?.getAttribute('src'));
  const title = cardEl.querySelector('h3')?.textContent.trim();
  return (!!src && src === row.card.image_url) || (!!title && title === row.card.wikipedia_title);
}

export function createState({ map, pendingSet, onChange = () => {} }) {
  return { map, pendingSet, onChange, claimed: new Set(), bound: new Map(), selected: new Map() };
}

function unbind(state, cardEl) {
  const row = state.bound.get(cardEl);
  cardEl.querySelector('.wmd-ctl')?.remove();
  state.bound.delete(cardEl);
  state.claimed.delete(row.id);
  if (state.selected.delete(row.id)) state.onChange(state.selected.size);
}

function makeLock() {
  const lock = document.createElement('span');
  lock.className = 'wmd-ctl wmd-lock';
  lock.textContent = '\u{1F512}';
  lock.title = 'Protected: starred or in a pending trade';
  return lock;
}

function makeCheckbox(state, cardEl, row) {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'wmd-ctl wmd-check';
  box.dataset.userCardId = row.id;
  box.title = `Select ${row.card.wikipedia_title} for discard`;
  // Keep the click from opening the card's own detail view.
  for (const type of ['click', 'mousedown', 'pointerdown']) {
    box.addEventListener(type, (e) => e.stopPropagation());
  }
  box.addEventListener('change', () => {
    if (box.checked) state.selected.set(row.id, cardEl);
    else state.selected.delete(row.id);
    state.onChange(state.selected.size);
  });
  return box;
}

// Safe to call on every DOM change: only new, changed, or removed cards do work.
export function scanGrid(grid, state) {
  for (const cardEl of [...state.bound.keys()]) {
    if (!cardEl.isConnected) unbind(state, cardEl);
  }
  for (const cardEl of cardWrappers(grid)) {
    const prev = state.bound.get(cardEl);
    if (prev && stillMatches(cardEl, prev)) continue;
    if (prev) unbind(state, cardEl);
    const row = bindCardElement(cardEl, state.map, state.claimed);
    if (!row) continue;
    state.bound.set(cardEl, row);
    cardEl.append(isProtected(row, state.pendingSet) ? makeLock() : makeCheckbox(state, cardEl, row));
  }
}

// Re-checks every selected element right before the discard runs.
export function selectedForDiscard(state) {
  const ids = [];
  for (const [id, cardEl] of state.selected) {
    const row = state.bound.get(cardEl);
    if (cardEl.isConnected && row?.id === id && stillMatches(cardEl, row)) ids.push(id);
  }
  return ids;
}

// Hide, not remove: the grid belongs to React, which may re-render it.
export function markDiscarded(state, id) {
  const cardEl = state.selected.get(id);
  if (!cardEl) return;
  cardEl.style.display = 'none';
  cardEl.querySelector('.wmd-ctl')?.remove();
  state.bound.delete(cardEl);
  state.selected.delete(id);
  state.onChange(state.selected.size);
}
```

Note: `markDiscarded` keeps the id in `state.claimed` on purpose: the row no longer exists on the server, so no other element may bind to it.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test -- tests/ui.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 4 files, 36 tests.

- [ ] **Step 6: Commit**

```bash
git add extension/src/ui.js tests/ui.test.js
git commit -m "feat(ui): inject checkboxes and keep card bindings in sync with the grid"
```

---

### Task 5: Content script, styles, manifest, build

**Goal:** A loadable unpacked extension: `content.js` wires the modules to the live page (observer, action bar, confirm modal, queue), and `npm run build` produces `extension/dist/content.js`.

**Files:**
- Create: `extension/src/content.js`, `extension/src/styles.css`, `extension/manifest.json`, `extension/README.md`

**Acceptance Criteria:**
- [ ] `npm run build` exits 0 and writes `extension/dist/content.js`.
- [ ] `manifest.json` is valid JSON, `manifest_version` 3, one content script matching `https://www.wiki-masters.com/*` with `js: ["dist/content.js"]` and `css: ["src/styles.css"]`, and no `permissions` or `host_permissions` keys.
- [ ] `grep -c "supabase" extension/dist/content.js` prints `0`.
- [ ] `npm test` still passes (36 tests).

**Verify:** `npm test && npm run build && node -e "const m=require('./extension/manifest.json');if(m.manifest_version!==3||m.permissions||m.host_permissions)process.exit(1);console.log('manifest ok')" && ls extension/dist/content.js`

**Steps:**

- [ ] **Step 1: Write `extension/src/content.js`**

```js
import { fetchAllCollection, buildCardMap, discardCard } from './api.js';
import { runDiscardQueue, DELAY_MS } from './queue.js';
import { findGrid, createState, scanGrid, selectedForDiscard, markDiscarded } from './ui.js';

// Only act on the collection page. Task 6 of the plan confirms the real path.
const COLLECTION_PATH = /collection/i;
const MESSAGE_MS = 8000;

let state = null;
let loading = false;
let failed = false;
let busy = false;
let bar = null;
let messageTimer = null;

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'wmd-bar';
  bar.innerHTML = '<span class="wmd-msg"></span><span class="wmd-count"></span><button type="button" class="wmd-discard">Discard</button>';
  bar.querySelector('.wmd-discard').addEventListener('click', onDiscardClick);
  document.body.append(bar);
  return bar;
}

function render() {
  const b = ensureBar();
  const count = state ? state.selected.size : 0;
  const msg = b.querySelector('.wmd-msg').textContent;
  b.querySelector('.wmd-count').textContent = count ? `${count} selected` : '';
  const button = b.querySelector('.wmd-discard');
  button.hidden = count === 0;
  button.disabled = busy;
  b.hidden = count === 0 && !msg;
}

function showMessage(text, sticky = false) {
  ensureBar().querySelector('.wmd-msg').textContent = text;
  clearTimeout(messageTimer);
  if (text && !sticky) messageTimer = setTimeout(() => showMessage(''), MESSAGE_MS);
  render();
}

function confirmDiscard(count) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'wmd-modal';
    overlay.innerHTML = `
      <div class="wmd-dialog" role="dialog" aria-modal="true">
        <p>Discard ${count} card${count === 1 ? '' : 's'}? This cannot be undone.</p>
        <div class="wmd-actions">
          <button type="button" class="wmd-cancel">Cancel</button>
          <button type="button" class="wmd-confirm">Discard ${count}</button>
        </div>
      </div>`;
    const close = (answer) => {
      overlay.remove();
      resolve(answer);
    };
    overlay.querySelector('.wmd-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.wmd-confirm').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.body.append(overlay);
    overlay.querySelector('.wmd-cancel').focus();
  });
}

async function onDiscardClick() {
  if (!state || busy) return;
  const ids = selectedForDiscard(state);
  if (ids.length === 0) {
    showMessage('The selected cards changed on screen. Tick them again.');
    return;
  }
  if (!(await confirmDiscard(ids.length))) return;
  busy = true;
  render();
  const result = await runDiscardQueue(ids, {
    delayMs: DELAY_MS,
    discardFn: discardCard,
    onProgress: ({ id, done, total }) => {
      markDiscarded(state, id);
      showMessage(`Discarded ${done} of ${total}...`, true);
    },
  });
  busy = false;
  if (result.failedAt) {
    showMessage(`Discarded ${result.done.length}. Stopped: card ${result.failedAt} failed. Reload the page before you try again.`, true);
  } else {
    showMessage(`Discarded ${result.done.length} card${result.done.length === 1 ? '' : 's'}.`);
  }
}

async function init(grid) {
  loading = true;
  try {
    const { rows, pendingTradeCardIds } = await fetchAllCollection();
    state = createState({ map: buildCardMap(rows), pendingSet: new Set(pendingTradeCardIds), onChange: render });
    scanGrid(grid, state);
  } catch (err) {
    failed = true;
    showMessage(`Multi-discard could not load your collection (${err.message}). Reload the page to try again.`, true);
  } finally {
    loading = false;
  }
}

function tick() {
  if (!COLLECTION_PATH.test(location.pathname)) return;
  const grid = findGrid();
  if (!grid) return;
  if (state) scanGrid(grid, state);
  else if (!loading && !failed) init(grid);
}

// One observer covers both cases: the grid appearing late (client-side
// navigation) and new cards appended by infinite scroll.
let timer = null;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(tick, 200);
}).observe(document.body, { childList: true, subtree: true });
tick();
```

- [ ] **Step 2: Write `extension/src/styles.css`**

```css
.wmd-check {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 30;
  width: 22px;
  height: 22px;
  cursor: pointer;
  accent-color: #dc2626;
}

.wmd-lock {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 30;
  font-size: 16px;
  line-height: 1;
  pointer-events: auto;
}

#wmd-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483000;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 16px;
  border-radius: 10px;
  background: #111827;
  color: #f9fafb;
  font: 14px/1.4 system-ui, sans-serif;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  max-width: calc(100vw - 32px);
}

#wmd-bar[hidden],
#wmd-bar button[hidden] {
  display: none;
}

#wmd-bar button,
#wmd-modal button {
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.wmd-discard,
.wmd-confirm {
  background: #dc2626;
  color: #fff;
}

.wmd-discard:disabled {
  opacity: 0.5;
  cursor: wait;
}

#wmd-modal {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.wmd-dialog {
  max-width: 360px;
  margin: 16px;
  padding: 20px;
  border-radius: 12px;
  background: #fff;
  color: #111827;
  font: 15px/1.5 system-ui, sans-serif;
}

.wmd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.wmd-cancel {
  background: #e5e7eb;
  color: #111827;
}
```

- [ ] **Step 3: Write `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "WikiMasters Multi-Discard",
  "version": "0.1.0",
  "description": "Tick many cards on My Collection and discard them with one confirmation.",
  "content_scripts": [
    {
      "matches": ["https://www.wiki-masters.com/*"],
      "js": ["dist/content.js"],
      "css": ["src/styles.css"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 4: Write `extension/README.md`**

```markdown
# WikiMasters Multi-Discard

Adds checkboxes to your My Collection page so you can discard many cards at once.
Starred cards and cards in a pending trade show a lock and cannot be selected.

## Build

    npm install
    npm run build

## Load in Chrome

1. Open `chrome://extensions` and turn on Developer mode.
2. Click "Load unpacked" and pick the `extension/` folder.
3. After each `npm run build`, click the reload icon on the extension card.

Discarding is permanent. The extension asks once before it starts, then
discards one card every 400 ms and stops at the first error.
```

- [ ] **Step 5: Build and verify**

Run: `npm test && npm run build && node -e "const m=require('./extension/manifest.json');if(m.manifest_version!==3||m.permissions||m.host_permissions)process.exit(1);console.log('manifest ok')" && grep -c supabase extension/dist/content.js`
Expected: 36 tests pass, esbuild prints `extension/dist/content.js  <size>`, `manifest ok`, and `0` (grep exits 1 on zero matches; that is expected).

- [ ] **Step 6: Commit**

```bash
git add extension/src/content.js extension/src/styles.css extension/manifest.json extension/README.md
git commit -m "feat(extension): content script, action bar, and confirm modal"
```

---

### Task 6: Manual browser check on the live site

**Goal:** The account owner loads the unpacked extension on their own session and confirms it works end to end with one real discard.

> **USER-ORDERED GATE: NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Modify (only if the path check fails): `extension/src/content.js` (`COLLECTION_PATH`)

**Acceptance Criteria:**
- [ ] On My Collection, unprotected cards show a checkbox and at least one starred card shows the lock and no checkbox.
- [ ] Cards loaded by scrolling down also get a checkbox or a lock.
- [ ] Ticking one card the owner chooses shows "1 selected"; Cancel in the modal discards nothing.
- [ ] Confirming discards that one card: it disappears, the bar reports "Discarded 1 card.", and after a page reload the card is still gone.
- [ ] The DevTools console shows no error from `content.js`.

**Verify:** Owner reports each criterion above, with a screenshot of the checkboxes and lock and of the "Discarded 1 card." bar.

**Steps:**

- [ ] **Step 1:** Run `npm run build`. The owner loads `extension/` unpacked (see `extension/README.md`).
- [ ] **Step 2:** The owner opens My Collection and notes the URL path. If the path does not contain `collection`, change `COLLECTION_PATH` in `extension/src/content.js` to match it, rebuild, reload the extension, commit as `fix(content): match the real collection path`.
- [ ] **Step 3:** The owner checks the checkbox and lock criteria, scrolls to load more cards, and checks them again.
- [ ] **Step 4:** The owner ticks one card they do not want, clicks Discard, clicks Cancel, and confirms nothing changed. Then Discard again and confirm.
- [ ] **Step 5:** The owner reloads the page and confirms the card is gone and the console is clean.
