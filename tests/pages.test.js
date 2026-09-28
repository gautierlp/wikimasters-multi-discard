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

  it('does not load a failed URL again', async () => {
    const f = fakeLoader({
      [P0]: () => {
        throw new Error('HTTP 500');
      },
    });
    const store = createPageStore(f);
    await expect(store.seen(P0)).rejects.toThrow('HTTP 500');
    expect(await store.seen(P0)).toBe(false);
    expect(f.calls).toEqual([P0]);
    expect(store.size()).toBe(0);
  });

  it('ignores single pages after the full load failed', async () => {
    const f = fakeLoader({
      [ALL]: () => {
        throw new Error('HTTP 500');
      },
      [P0]: { rows: [row(1)], pendingTradeCardIds: [] },
    });
    const store = createPageStore(f);
    await expect(store.useFallback()).rejects.toThrow('HTTP 500');
    expect(await store.seen(P0)).toBe(false);
    expect(f.calls).toEqual([ALL]);
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

  it('ignores single pages while and after the full load runs', async () => {
    let release;
    const f = fakeLoader({
      [ALL]: () => new Promise((resolve) => { release = () => resolve({ rows: [row(1)], pendingTradeCardIds: [] }); }),
      [P0]: { rows: [row(1)], pendingTradeCardIds: [] },
    });
    const store = createPageStore(f);
    const full = store.useFallback();
    await Promise.resolve();
    expect(await store.seen(P0)).toBe(false);
    release();
    expect(await full).toBe(true);
    expect(await store.seen(P0)).toBe(false);
    expect(f.calls).toEqual([ALL]);
  });
});
