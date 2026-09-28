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

// Every image in the card, normalized. The live card shows a rarity frame
// (for example /commun.png) before the portrait, so the first image is not
// enough.
export function imageSrcs(cardEl) {
  return [...cardEl.querySelectorAll('img')].map((img) => normalizeImgSrc(img.getAttribute('src'))).filter(Boolean);
}

function unclaimed(list, claimed, keep) {
  return (list ?? []).filter((r) => !claimed.has(r.id) && keep(r));
}

function hasNoImage(row) {
  const url = row.card?.image_url;
  return url === null || url === undefined || url === '';
}

// Candidates are interchangeable only if binding any of them gives the same
// outcome: same shiny flag and same protection.
function interchangeable(candidates, pendingSet) {
  const [first] = candidates;
  return candidates.every(
    (r) => r.is_shiny === first.is_shiny && isProtected(r, pendingSet) === isProtected(first, pendingSet),
  );
}

// Binds a card element to one row and claims it. Returns null rather than
// guess: a wrong guess would discard the wrong card.
// 1. Image path: rows with one of the card's images AND this title.
// 2. Title path (only if 1 found none): rows with this title and no image.
// 3. If the candidates are not interchangeable, bind nothing.
export function bindCardElement(cardEl, map, claimed, pendingSet = new Set()) {
  const title = cardEl.querySelector('h3')?.textContent.trim() ?? '';
  let candidates = [];
  for (const src of imageSrcs(cardEl)) {
    candidates = unclaimed(map.byImage.get(src), claimed, (r) => r.card?.wikipedia_title === title);
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0 && title) candidates = unclaimed(map.byTitle.get(title), claimed, hasNoImage);
  if (candidates.length === 0 || !interchangeable(candidates, pendingSet)) return null;
  const row = candidates[0];
  claimed.add(row.id);
  return row;
}

// Right before a discard: keep only ids that still exist in freshly fetched
// rows and are not protected there. Order of keep follows ids.
export function filterStillDiscardable(ids, rows, pendingTradeCardIds) {
  const pendingSet = new Set(pendingTradeCardIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const keep = [];
  const skipped = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row && !isProtected(row, pendingSet)) keep.push(id);
    else skipped.push(id);
  }
  return { keep, skipped };
}
