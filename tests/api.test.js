import { describe, it, expect } from 'vitest';
import {
  PAGE_SIZE, MAX_PAGES, COLLECTION_URL, DISCARD_URL,
  fetchAllCollection, buildCardMap, discardCard, fetchCollectionPage,
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
