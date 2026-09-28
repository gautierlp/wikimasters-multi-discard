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

// Loads one page of the collection by its exact URL (the URL the site itself
// requested). The caller must check the URL with isCollectionPageUrl first.
export async function fetchCollectionPage(url, fetchFn = fetch) {
  const res = await fetchFn(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { rows: data.collection ?? [], pendingTradeCardIds: data.pendingTradeCardIds ?? [] };
}
