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
// resource timing also reports) does not trigger another load. A URL whose
// load failed is not tried again either, for the same reason: the failed
// fetch itself shows up in resource timing, so retrying it would fetch it
// again, fail again, and loop forever. A failed URL stays failed until the
// page reloads (a new content script, a new store).
export function createPageStore({ loadPage, loadAll }) {
  const pages = new Map();
  const inflight = new Map();
  const failed = new Set();
  const load = (key) => (key === ALL ? loadAll() : loadPage(key));

  function seenKey(key) {
    // The full load already covers every page; do not load them one by one too.
    if (key !== ALL && (pages.has(ALL) || inflight.has(ALL) || failed.has(ALL))) return Promise.resolve(false);
    if (pages.has(key)) return Promise.resolve(false);
    if (failed.has(key)) return Promise.resolve(false);
    if (inflight.has(key)) return inflight.get(key).then(() => false);
    const promise = load(key)
      .then((data) => {
        pages.set(key, data);
        return true;
      })
      .catch((err) => {
        failed.add(key);
        throw err;
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
