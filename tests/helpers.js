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

// The live card markup: a rarity frame image comes first, then the portrait
// (or /logo.png when the card has no image), then the title.
export const FRAME_SRC = '/_next/image?url=%2Fcommun.png&w=3840&q=75';

export function framedCardEl(src, title) {
  const el = cardEl(src, title);
  const frame = document.createElement('img');
  frame.setAttribute('src', FRAME_SRC);
  el.prepend(frame);
  return el;
}
