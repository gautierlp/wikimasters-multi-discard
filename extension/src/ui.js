import { bindCardElement, imageSrcs, isProtected } from './select.js';

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

// Capture what the element shows at bind time (every image and the title must match on later checks).
export function signature(cardEl) {
  const title = cardEl.querySelector('h3')?.textContent.trim() ?? '';
  return `${imageSrcs(cardEl).join('\n')}\n${title}`;
}

// True when the element still shows what it showed when bound (both image and title must be unchanged).
export function stillMatches(cardEl, entry) {
  return signature(cardEl) === entry.sig;
}

export function createState({ map, pendingSet, onChange = () => {} }) {
  return { map, pendingSet, onChange, claimed: new Set(), bound: new Map(), selected: new Map() };
}

function unbind(state, cardEl) {
  const entry = state.bound.get(cardEl);
  cardEl.querySelector('.wmd-ctl')?.remove();
  state.bound.delete(cardEl);
  state.claimed.delete(entry.row.id);
  if (state.selected.delete(entry.row.id)) state.onChange(state.selected.size);
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
  const currentWrappers = new Set(cardWrappers(grid));
  for (const cardEl of [...state.bound.keys()]) {
    const entry = state.bound.get(cardEl);
    if (!cardEl.isConnected || !currentWrappers.has(cardEl) || !stillMatches(cardEl, entry)) {
      unbind(state, cardEl);
    }
  }
  for (const cardEl of currentWrappers) {
    // A card hidden by markDiscarded must not take another row.
    if (state.bound.has(cardEl) || cardEl.style.display === 'none') continue;
    const row = bindCardElement(cardEl, state.map, state.claimed, state.pendingSet);
    if (!row) continue;
    state.bound.set(cardEl, { row, sig: signature(cardEl) });
    cardEl.append(isProtected(row, state.pendingSet) ? makeLock() : makeCheckbox(state, cardEl, row));
  }
}

// Re-checks every selected element right before the discard runs.
export function selectedForDiscard(state) {
  const ids = [];
  for (const [id, cardEl] of state.selected) {
    const entry = state.bound.get(cardEl);
    if (cardEl.isConnected && entry?.row?.id === id && stillMatches(cardEl, entry)) ids.push(id);
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

// Clears one id from the selection without discarding it.
export function deselect(state, id) {
  const cardEl = state.selected.get(id);
  if (!cardEl) return;
  const box = cardEl.querySelector('.wmd-check');
  if (box) box.checked = false;
  state.selected.delete(id);
  state.onChange(state.selected.size);
}
