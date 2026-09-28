import { fetchAllCollection, fetchCollectionPage, buildCardMap, discardCard } from './api.js';
import { createPageStore, isCollectionPageUrl } from './pages.js';
import { runDiscardQueue, DELAY_MS } from './queue.js';
import { findGrid, createState, scanGrid, selectedForDiscard, markDiscarded, deselect } from './ui.js';
import { filterStillDiscardable } from './select.js';

// Only act on the owner's own collection page (confirmed live: /collection).
const COLLECTION_PATH = /^\/collection\/?$/;
const MESSAGE_MS = 8000;
// If the site shows the grid without a collection request we can see, fall
// back to the version 1 full load after this delay.
const FALLBACK_MS = 3000;

let state = null;
let sawSiteRequest = false;
let fallbackTimer = null;
const store = createPageStore({
  loadPage: (url) => fetchCollectionPage(url),
  loadAll: () => fetchAllCollection(),
});
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
  for (const box of document.querySelectorAll('input.wmd-check')) box.disabled = busy;
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
  // Busy before the dialog, so a second click cannot start a second queue.
  busy = true;
  render();
  try {
    if (!(await confirmDiscard(ids.length))) return;
    await discardAfterRecheck(ids);
  } finally {
    busy = false;
    render();
  }
}

// Starred or trade status may have changed since the page loaded: load again
// only the pages that hold these ids, and discard only what is still
// unprotected there.
async function discardAfterRecheck(ids) {
  let fresh;
  try {
    fresh = await store.recheck(ids);
  } catch (err) {
    showMessage(`Could not re-check your collection (${err.message}). Nothing was discarded.`, true);
    return;
  }
  const { keep, skipped } = filterStillDiscardable(ids, fresh.rows, fresh.pendingTradeCardIds);
  for (const id of skipped) deselect(state, id);
  if (keep.length === 0) {
    showMessage(`Nothing to discard: ${skipped.length} card(s) are now starred, in a trade, or gone.`, true);
    return;
  }
  const result = await runDiscardQueue(keep, {
    delayMs: DELAY_MS,
    discardFn: discardCard,
    onProgress: ({ id, done, total }) => {
      markDiscarded(state, id);
      showMessage(`Discarded ${done} of ${total}...`, true);
    },
  });
  const suffix = skipped.length > 0 ? ` Skipped ${skipped.length} protected or missing card(s).` : '';
  if (result.failedAt) {
    showMessage(`Discarded ${result.done.length}. Stopped at card ${result.failedAt}: ${result.error}. Reload the page before you try again.${suffix}`, true);
  } else {
    showMessage(`Discarded ${result.done.length} card${result.done.length === 1 ? '' : 's'}.${suffix}`);
  }
}

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
    .catch((err) => showMessage(`Multi-discard could not load this page of your collection (${err.message}). Reload the page to try again.`, true));
}

async function startFallback() {
  if (sawSiteRequest || store.size() > 0 || !onCollectionPage()) {
    fallbackTimer = null;
    return;
  }
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

// Rescan when the grid appears (client-side navigation) or changes page.
let timer = null;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(tick, 200);
}).observe(document.body, { childList: true, subtree: true });
tick();
