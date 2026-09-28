# Per-Page Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load only the collection pages that the site itself shows, instead of the full collection, so the extension works the same for 7 pages or 1000.

**Architecture:** A new pure module `pages.js` keeps one entry per collection page URL and loads each URL at most once. `content.js` watches the site's own `/api/my-collection` requests through `PerformanceObserver`, loads the same URL, rebuilds the card map, and re-checks only the pages concerned before a discard. If no site request is seen within 3 s, it falls back to the version 1 full load.

**Tech Stack:** Plain JavaScript ES modules, vitest 3 + jsdom 27, esbuild, Chrome MV3 content script.

**Global Constraints:**
- Only same-origin `GET /api/my-collection?...` and `POST /api/user-cards/<id>/discard`, both with `credentials: 'include'`. The extension fetches a collection URL only when `isCollectionPageUrl(url, location.origin)` is true.
- One discard at a time, `DELAY_MS = 400` apart, stop at the first failure.
- Starred and pending-trade cards never get a checkbox; no positional guess. Binding, protection, and signature rules in `select.js` and `ui.js` do not change.
- `FALLBACK_MS = 3000`. Fallback key is `ALL = '*'`.
- No em dashes in code, comments, UI copy, or commit messages. Conventional commits, no co-author trailer.

**User decisions (already made):**
- "Why would we need to load all pages. Imagine a collection with 1000 pages" (owner, 2026-09-28): load per page, not everything.
- The grid is paginated, one page of 50 at a time (owner, 2026-09-28).
- Owner approved the design in chat and said "please proceed".

Spec: `docs/superpowers/specs/2026-09-28-per-page-loading-design.md`

---

### Task 1: Page store and single-page fetch

**Goal:** `extension/src/pages.js` (URL filter and page store) and `fetchCollectionPage` in `extension/src/api.js`, fully unit-tested.

**Files:**
- Create: `extension/src/pages.js`, `tests/pages.test.js`
- Modify: `extension/src/api.js` (add one function), `tests/api.test.js` (add one describe block)

**Acceptance Criteria:**
- [ ] `isCollectionPageUrl` is true only for a same-origin URL whose path is exactly `/api/my-collection`, with any query; false for other origins, other paths, and unparsable input.
- [ ] `store.seen(url)` loads a URL once for repeated and concurrent calls; resolves `true` only for the call that loaded it.
- [ ] A failed load rejects, leaves nothing stored, and a later `seen` retries.
- [ ] `rows()` and `pendingTradeCardIds()` merge every loaded page.
- [ ] `recheck(ids)` reloads only the keys that hold one of the ids, once each, stores the fresh data, and returns only that fresh data; ids on no page cause no load.
- [ ] `useFallback()` loads through `loadAll` under key `'*'`, and `recheck` of such an id reloads through `loadAll`.
- [ ] `fetchCollectionPage(url)` fetches the exact URL with `credentials: 'include'` and throws `HTTP <status>` on non-ok.

**Verify:** `npm test` → 67 tests pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/api.test.js` (and add `fetchCollectionPage` to its import from `../extension/src/api.js`):
```js
describe('fetchCollectionPage', () => {
  it('fetches the exact URL with credentials', async () => {
    const calls = [];
    const url = 'https://www.wiki-masters.com/api/my-collection?sort=rarity&page=2&stats=0';
    const out = await fetchCollectionPage(url, async (u, opts) => {
      calls.push({ url: u, opts });
      return { ok: true, json: async () => ({ collection: [row(1)], pendingTradeCardIds: ['c-1'] }) };
    });
    expect(calls).toEqual([{ url, opts: { credentials: 'include' } }]);
    expect(out).toEqual({ rows: [row(1)], pendingTradeCardIds: ['c-1'] });
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchCollectionPage('/api/my-collection?page=0', async () => ({ ok: false, status: 403 }))).rejects.toThrow('HTTP 403');
  });
});
```

Create `tests/pages.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { isCollectionPageUrl, createPageStore, ALL } from '../extension/src/pages.js';
import { row } from './helpers.js';

const ORIGIN = 'https://www.wiki-masters.com';
const P0 = `${ORIGIN}/api/my-collection?sort=rarity&page=0&stats=0`;
const P1 = `${ORIGIN}/api/my-collection?sort=rarity&page=1&stats=0`;

// data: { [key]: value | () => value }. A function may throw to fail the load.
function fakeLoader(data) {
  const calls = [];
  const get = async (key) => {
    calls.push(key);
    const d = data[key];
    return typeof d === 'function' ? d() : d;
  };
  return { calls, loadPage: (url) => get(url), loadAll: () => get(ALL) };
}

describe('isCollectionPageUrl', () => {
  it('accepts the same-origin collection endpoint with any query', () => {
    expect(isCollectionPageUrl(P1, ORIGIN)).toBe(true);
    expect(isCollectionPageUrl('/api/my-collection?page=3', ORIGIN)).toBe(true);
  });

  it('rejects other origins, other paths, and bad input', () => {
    expect(isCollectionPageUrl('https://evil.test/api/my-collection?page=0', ORIGIN)).toBe(false);
    expect(isCollectionPageUrl(`${ORIGIN}/api/my-collection-x`, ORIGIN)).toBe(false);
    expect(isCollectionPageUrl(`${ORIGIN}/api/user-cards/1/discard`, ORIGIN)).toBe(false);
    expect(isCollectionPageUrl('http://[bad', ORIGIN)).toBe(false);
  });
});

describe('createPageStore', () => {
  it('loads a URL once for repeated and concurrent calls', async () => {
    const f = fakeLoader({ [P0]: { rows: [row(1)], pendingTradeCardIds: [] } });
    const store = createPageStore(f);
    const [a, b] = await Promise.all([store.seen(P0), store.seen(P0)]);
    const c = await store.seen(P0);
    expect([a, b, c]).toEqual([true, false, false]);
    expect(f.calls).toEqual([P0]);
  });

  it('forgets a failed load so a later call retries', async () => {
    let n = 0;
    const f = fakeLoader({
      [P0]: () => {
        n += 1;
        if (n === 1) throw new Error('HTTP 500');
        return { rows: [row(1)], pendingTradeCardIds: [] };
      },
    });
    const store = createPageStore(f);
    await expect(store.seen(P0)).rejects.toThrow('HTTP 500');
    expect(store.size()).toBe(0);
    expect(await store.seen(P0)).toBe(true);
    expect(store.rows().map((r) => r.id)).toEqual(['uc-1']);
  });

  it('merges rows and pending ids across pages', async () => {
    const f = fakeLoader({
      [P0]: { rows: [row(1), row(2)], pendingTradeCardIds: ['c-9'] },
      [P1]: { rows: [row(3)], pendingTradeCardIds: ['c-9', 'uc-8'] },
    });
    const store = createPageStore(f);
    await store.seen(P0);
    await store.seen(P1);
    expect(store.size()).toBe(2);
    expect(store.rows().map((r) => r.id)).toEqual(['uc-1', 'uc-2', 'uc-3']);
    expect(store.pendingTradeCardIds().sort()).toEqual(['c-9', 'uc-8']);
  });

  it('rechecks only the pages that hold the ids and returns their fresh data', async () => {
    let starred = false;
    const f = fakeLoader({
      [P0]: () => ({ rows: [row(1), row(2, { starred })], pendingTradeCardIds: [] }),
      [P1]: { rows: [row(3)], pendingTradeCardIds: [] },
    });
    const store = createPageStore(f);
    await store.seen(P0);
    await store.seen(P1);
    starred = true;
    const fresh = await store.recheck(['uc-1', 'uc-2']);
    expect(f.calls).toEqual([P0, P1, P0]);
    expect(fresh.rows.map((r) => r.id)).toEqual(['uc-1', 'uc-2']);
    expect(fresh.rows[1].starred).toBe(true);
    expect(store.rows().find((r) => r.id === 'uc-2').starred).toBe(true);
  });

  it('loads nothing when no page holds the ids', async () => {
    const f = fakeLoader({ [P0]: { rows: [row(1)], pendingTradeCardIds: [] } });
    const store = createPageStore(f);
    await store.seen(P0);
    expect(await store.recheck(['uc-99'])).toEqual({ rows: [], pendingTradeCardIds: [] });
    expect(f.calls).toEqual([P0]);
  });

  it('uses loadAll for the fallback and for its recheck', async () => {
    const f = fakeLoader({ [ALL]: { rows: [row(1)], pendingTradeCardIds: ['c-5'] } });
    const store = createPageStore(f);
    expect(await store.useFallback()).toBe(true);
    await store.recheck(['uc-1']);
    expect(f.calls).toEqual([ALL, ALL]);
    expect(store.pendingTradeCardIds()).toEqual(['c-5']);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL, `fetchCollectionPage` is not exported and `../extension/src/pages.js` cannot be resolved.

- [ ] **Step 3: Implement**

Append to `extension/src/api.js`:
```js
// Loads one page of the collection by its exact URL (the URL the site itself
// requested). The caller must check the URL with isCollectionPageUrl first.
export async function fetchCollectionPage(url, fetchFn = fetch) {
  const res = await fetchFn(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { rows: data.collection ?? [], pendingTradeCardIds: data.pendingTradeCardIds ?? [] };
}
```

Create `extension/src/pages.js`:
```js
export const ALL = '*';

// Only the site's own collection endpoint, on the same origin.
export function isCollectionPageUrl(url, origin) {
  let parsed;
  try {
    parsed = new URL(url, origin);
  } catch {
    return false;
  }
  return parsed.origin === origin && parsed.pathname === '/api/my-collection';
}

function merge(datas) {
  const byId = new Map();
  const pending = new Set();
  for (const data of datas) {
    for (const row of data.rows) byId.set(row.id, row);
    for (const id of data.pendingTradeCardIds ?? []) pending.add(id);
  }
  return { rows: [...byId.values()], pendingTradeCardIds: [...pending] };
}

// Keeps the collection pages loaded so far, one entry per URL. Each URL loads
// at most once, so the extension's own fetch of a URL (which the page's
// resource timing also reports) does not trigger another load.
export function createPageStore({ loadPage, loadAll }) {
  const pages = new Map();
  const inflight = new Map();
  const load = (key) => (key === ALL ? loadAll() : loadPage(key));

  function seenKey(key) {
    if (pages.has(key)) return Promise.resolve(false);
    if (inflight.has(key)) return inflight.get(key).then(() => false);
    const promise = load(key)
      .then((data) => {
        pages.set(key, data);
        return true;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  // Reloads only the pages that hold one of the ids, one after the other.
  async function recheck(ids) {
    const wanted = new Set(ids);
    const keys = [...pages].filter(([, data]) => data.rows.some((r) => wanted.has(r.id))).map(([key]) => key);
    const fresh = [];
    for (const key of keys) {
      const data = await load(key);
      pages.set(key, data);
      fresh.push(data);
    }
    return merge(fresh);
  }

  return {
    seen: (url) => seenKey(url),
    useFallback: () => seenKey(ALL),
    rows: () => merge(pages.values()).rows,
    pendingTradeCardIds: () => merge(pages.values()).pendingTradeCardIds,
    size: () => pages.size,
    recheck,
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: PASS, 67 tests (57 before, 2 new in api, 8 new in pages).

- [ ] **Step 5: Commit**

```bash
git add extension/src/api.js extension/src/pages.js tests/api.test.js tests/pages.test.js
git commit -m "feat(pages): load collection pages one URL at a time"
```

---

### Task 2: Follow the site's requests in the content script

**Goal:** `content.js` loads only the pages the site requests, rebuilds the card map after each load, re-checks only the pages concerned before a discard, and falls back to the full load after 3 s with no site request.

**Files:**
- Modify: `extension/src/content.js`, `extension/README.md`

**Acceptance Criteria:**
- [ ] Startup no longer calls `fetchAllCollection` unless the fallback fires.
- [ ] A `PerformanceObserver` (`type: 'resource', buffered: true`) passes each entry URL to the store only when `isCollectionPageUrl(url, location.origin)` is true and the path check passes.
- [ ] After each new page load, `state.map` and `state.pendingSet` are rebuilt from the store and the grid is scanned.
- [ ] The discard re-check calls `store.recheck(ids)`, not `fetchAllCollection`.
- [ ] With no site request seen within `FALLBACK_MS = 3000` after the grid appears, the store loads everything once through `fetchAllCollection`.
- [ ] `npm test` passes (67), `npm run build` succeeds, `node --check extension/dist/content.js` exits 0.

**Verify:** `npm test && npm run build && node --check extension/dist/content.js && echo ok`

**Steps:**

- [ ] **Step 1: Change the imports and state in `extension/src/content.js`**

Replace line 1 with:
```js
import { fetchAllCollection, fetchCollectionPage, buildCardMap, discardCard } from './api.js';
import { createPageStore, isCollectionPageUrl } from './pages.js';
```
Replace `const MESSAGE_MS = 8000;` with:
```js
const MESSAGE_MS = 8000;
// If the site shows the grid without a collection request we can see, fall
// back to the version 1 full load after this delay.
const FALLBACK_MS = 3000;
```
Replace `let loading = false;` with:
```js
let sawSiteRequest = false;
let fallbackTimer = null;
const store = createPageStore({
  loadPage: (url) => fetchCollectionPage(url),
  loadAll: () => fetchAllCollection(),
});
```

- [ ] **Step 2: Re-check through the store**

In `discardAfterRecheck`, replace `fresh = await fetchAllCollection();` with `fresh = await store.recheck(ids);`. Replace the comment above the function with:
```js
// Starred or trade status may have changed since the page loaded: load again
// only the pages that hold these ids, and discard only what is still
// unprotected there.
```

- [ ] **Step 3: Replace `init` and `tick` with the store wiring**

Replace the whole `async function init(grid) { ... }` and `function tick() { ... }` with:
```js
function onCollectionPage() {
  return COLLECTION_PATH.test(location.pathname);
}

// Rebuild the card map from every page loaded so far, then bind the grid.
function applyStore() {
  const map = buildCardMap(store.rows());
  const pendingSet = new Set(store.pendingTradeCardIds());
  if (state) {
    state.map = map;
    state.pendingSet = pendingSet;
  } else {
    state = createState({ map, pendingSet, onChange: render });
  }
  const grid = onCollectionPage() ? findGrid() : null;
  if (grid) scanGrid(grid, state);
}

function onResource(url) {
  if (!onCollectionPage() || !isCollectionPageUrl(url, location.origin)) return;
  sawSiteRequest = true;
  store
    .seen(url)
    .then((loadedNew) => {
      if (loadedNew) applyStore();
    })
    .catch((err) => showMessage(`Multi-discard could not load this page of your collection (${err.message}).`));
}

async function startFallback() {
  if (sawSiteRequest || store.size() > 0) return;
  try {
    await store.useFallback();
    applyStore();
  } catch (err) {
    failed = true;
    showMessage(`Multi-discard could not load your collection (${err.message}). Reload the page to try again.`, true);
  }
}

function tick() {
  if (!onCollectionPage()) return;
  const grid = findGrid();
  if (!grid) return;
  if (state) scanGrid(grid, state);
  else if (!sawSiteRequest && !fallbackTimer && !failed) fallbackTimer = setTimeout(startFallback, FALLBACK_MS);
}

// The site loads each grid page from /api/my-collection. Resource timing
// reports those requests to the content script (buffered: true replays the
// ones made before this script ran), so the extension loads the same pages.
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) onResource(entry.name);
}).observe({ type: 'resource', buffered: true });
```

Replace the comment above the `MutationObserver` with:
```js
// Rescan when the grid appears (client-side navigation) or changes page.
```

Remove every remaining use of `loading` (there should be none left after Step 3; `grep -n "loading" extension/src/content.js` must print nothing).

- [ ] **Step 4: Update `extension/README.md`**

Replace its last paragraph with:
```markdown
Discarding is permanent. The extension asks once before it starts, then
discards one card every 400 ms and stops at the first error.

The extension loads the same collection pages the site shows, one request per
page you view. Before a discard it loads that page again to make sure no
selected card was starred or put in a trade in the meantime.
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run build && node --check extension/dist/content.js && echo ok && grep -c "fetchAllCollection" extension/src/content.js`
Expected: 67 tests pass, build prints the bundle size, `ok`, and `2` (the import and the `loadAll` line).

- [ ] **Step 6: Commit**

```bash
git add extension/src/content.js extension/README.md
git commit -m "feat(content): load only the collection pages the site shows"
```

---

### Task 3: Live check on the site (owner)

**Goal:** The owner confirms per-page loading on the live site.

> **USER-ORDERED GATE: NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- None (unless the check finds a defect)

**Acceptance Criteria:**
- [ ] On `/collection` page 1, checkboxes and locks appear, and the Network tab shows one `my-collection` request from `content.js`, not 7.
- [ ] After a move to page 2 and back, checkboxes appear each time, with one new `content.js` request for page 2 and none for the return to page 1.
- [ ] A discard of one card shows one `content.js` re-check request, then one `discard` call with status 200, and the card is gone after a reload.

**Verify:** Owner reports each criterion with the Network tab filtered on `my-collection|discard`.

**Steps:**

- [ ] **Step 1:** Run `npm run build`; the owner reloads the unpacked extension.
- [ ] **Step 2:** The owner does the three checks above and reports.
