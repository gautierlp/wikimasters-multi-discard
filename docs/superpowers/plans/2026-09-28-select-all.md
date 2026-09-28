# Select All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Select all" button in the floating bar that ticks every checkbox on the current grid page, and turns into "Clear all" once every checkbox is ticked.

**Architecture:** Four pure selection helpers in `ui.js` (`selectableCount`, `allSelected`, `selectAll`, `clearAll`) work on the existing `state` object. `content.js` adds a `.wmd-all` button to `#wmd-bar`, keeps the bar visible whenever the grid has a checkbox, and re-renders after each grid scan.

**Tech Stack:** Plain JavaScript ES modules, vitest 3 + jsdom 27, esbuild, Chrome MV3 content script.

**Global Constraints:**
- Only cards with a `.wmd-check` checkbox can be selected. Locked cards (starred or pending trade) never get selected.
- A card is selectable only if its element is connected and `stillMatches(cardEl, entry)` is true.
- `selectAll` and `clearAll` call `state.onChange` exactly once each (`clearAll` not at all when the selection is already empty).
- Button labels are exactly `Select all` and `Clear all`. The button class is `wmd-all`.
- The discard path (`onDiscardClick`, `discardAfterRecheck`, the confirmation dialog, the queue) does not change.
- No em dashes in code, comments, UI copy, or commit messages. Conventional commits, no co-author trailer.

**User decisions (already made):**
- Owner approved the design in chat ("I aprove", 2026-09-28): button in the floating bar, current grid page only, toggles to "Clear all", no guard beyond the existing confirmation dialog.

Spec: `docs/superpowers/specs/2026-09-28-select-all-design.md`

---

### Task 1: Selection helpers in ui.js

**Goal:** `selectableCount`, `allSelected`, `selectAll`, and `clearAll` exported from `extension/src/ui.js`, fully unit-tested.

**Files:**
- Modify: `extension/src/ui.js` (append four exports and one internal helper)
- Test: `tests/ui.test.js` (extend the import, add one describe block)

**Acceptance Criteria:**
- [ ] `selectAll` ticks and selects every free card; locked and unbound cards stay out; `onChange` is called once with the new size.
- [ ] `selectAll` skips a card whose image or title changed since binding.
- [ ] `selectableCount` counts free, still-matching cards; `allSelected` is false with 0 selectable, false with a partial selection, true after `selectAll`.
- [ ] `clearAll` unticks every box, empties the selection, calls `onChange(0)` once, and does nothing on an empty selection.
- [ ] `selectedForDiscard` returns every id after `selectAll`.

**Verify:** `npm test` → 82 tests pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

In `tests/ui.test.js`, change the import line to:
```js
import { findGrid, createState, scanGrid, selectedForDiscard, markDiscarded, deselect, selectableCount, allSelected, selectAll, clearAll } from '../extension/src/ui.js';
```

Append at the end of the file:
```js
describe('selectAll / clearAll', () => {
  // Two free cards, one starred card, one card with no matching row.
  function page() {
    const { state, changes } = setup([row(1), row(2), row(3, { starred: true })]);
    const els = [
      cardEl('https://img.test/1.png', 'Title 1'),
      cardEl('https://img.test/2.png', 'Title 2'),
      cardEl('https://img.test/3.png', 'Title 3'),
      cardEl('https://img.test/9.png', 'Nope'),
    ];
    scanGrid(makeGrid(els), state);
    return { state, changes, els };
  }
  const box = (el) => el.querySelector('input.wmd-check');

  it('ticks every free card and skips locked and unbound cards', () => {
    const { state, changes, els } = page();
    selectAll(state);
    expect([...state.selected.keys()].sort()).toEqual(['uc-1', 'uc-2']);
    expect(box(els[0]).checked).toBe(true);
    expect(box(els[1]).checked).toBe(true);
    expect(changes).toEqual([2]);
    expect(selectedForDiscard(state).sort()).toEqual(['uc-1', 'uc-2']);
  });

  it('skips a card that shows something else since it was bound', () => {
    const { state, els } = page();
    els[1].querySelector('h3').textContent = 'Changed';
    selectAll(state);
    expect([...state.selected.keys()]).toEqual(['uc-1']);
  });

  it('reports whether every selectable card is selected', () => {
    const { state, els } = page();
    expect(selectableCount(state)).toBe(2);
    expect(allSelected(state)).toBe(false);
    box(els[0]).click();
    expect(allSelected(state)).toBe(false);
    selectAll(state);
    expect(allSelected(state)).toBe(true);
  });

  it('is never all selected when no card is selectable', () => {
    const { state } = setup([]);
    expect(selectableCount(state)).toBe(0);
    expect(allSelected(state)).toBe(false);
  });

  it('clearAll unticks every box and reports 0 once', () => {
    const { state, changes, els } = page();
    selectAll(state);
    clearAll(state);
    expect(state.selected.size).toBe(0);
    expect(box(els[0]).checked).toBe(false);
    expect(box(els[1]).checked).toBe(false);
    expect(changes).toEqual([2, 0]);
    clearAll(state);
    expect(changes).toEqual([2, 0]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/ui.test.js`
Expected: FAIL, `selectAll is not a function` (and the same for the other helpers).

- [ ] **Step 3: Write the implementation**

Append to `extension/src/ui.js`:
```js
// Bound cards that show a checkbox and still show what they showed when bound.
function selectableEntries(state) {
  const out = [];
  for (const [cardEl, entry] of state.bound) {
    const box = cardEl.querySelector('.wmd-check');
    if (box && cardEl.isConnected && stillMatches(cardEl, entry)) out.push({ cardEl, box, id: entry.row.id });
  }
  return out;
}

export function selectableCount(state) {
  return selectableEntries(state).length;
}

export function allSelected(state) {
  const entries = selectableEntries(state);
  return entries.length > 0 && entries.every((e) => state.selected.has(e.id));
}

// Ticks every selectable card on the current grid page.
export function selectAll(state) {
  for (const { cardEl, box, id } of selectableEntries(state)) {
    box.checked = true;
    state.selected.set(id, cardEl);
  }
  state.onChange(state.selected.size);
}

export function clearAll(state) {
  if (state.selected.size === 0) return;
  for (const cardEl of state.selected.values()) {
    const box = cardEl.querySelector('.wmd-check');
    if (box) box.checked = false;
  }
  state.selected.clear();
  state.onChange(0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: 82 tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/ui.js tests/ui.test.js
git commit -m "feat(ui): add select all and clear all helpers"
```

---

### Task 2: Select all button in the bar

**Goal:** A `.wmd-all` button in `#wmd-bar` that calls `selectAll` or `clearAll`, with its label, visibility, and busy state driven by `render()`, plus the README usage line.

**Files:**
- Modify: `extension/src/content.js` (import, `ensureBar`, `render`, new `onSelectAllClick`, `applyStore`, `tick`)
- Modify: `extension/src/styles.css` (add `.wmd-all` rules)
- Modify: `README.md` (Usage step 3)

**Acceptance Criteria:**
- [ ] The bar contains `<button type="button" class="wmd-all">` before the Discard button.
- [ ] `render()` hides the button when `selectableCount(state) === 0`, disables it when busy, and labels it `Clear all` when `allSelected(state)`, else `Select all`.
- [ ] The bar stays visible when `selectableCount(state) > 0`, even with 0 selected.
- [ ] `render()` runs after the `scanGrid` call in `applyStore` and in `tick`.
- [ ] `npm test` passes (82) and `npm run build` exits 0.

**Verify:** `npm test && npm run build` → 82 tests pass, build writes `extension/dist/content.js`

**Steps:**

- [ ] **Step 1: Import the helpers**

In `extension/src/content.js`, change the `./ui.js` import to:
```js
import { findGrid, createState, scanGrid, selectedForDiscard, markDiscarded, deselect, selectableCount, allSelected, selectAll, clearAll } from './ui.js';
```

- [ ] **Step 2: Add the button to the bar**

Replace the body of `ensureBar` between `bar.id = 'wmd-bar';` and `document.body.append(bar);` with:
```js
  bar.innerHTML = '<span class="wmd-msg"></span><span class="wmd-count"></span><button type="button" class="wmd-all">Select all</button><button type="button" class="wmd-discard">Discard</button>';
  bar.querySelector('.wmd-all').addEventListener('click', onSelectAllClick);
  bar.querySelector('.wmd-discard').addEventListener('click', onDiscardClick);
```

- [ ] **Step 3: Drive the button from render**

Replace `render` with:
```js
function render() {
  const b = ensureBar();
  const count = state ? state.selected.size : 0;
  const selectable = state ? selectableCount(state) : 0;
  const msg = b.querySelector('.wmd-msg').textContent;
  b.querySelector('.wmd-count').textContent = count ? `${count} selected` : '';
  const all = b.querySelector('.wmd-all');
  all.hidden = selectable === 0;
  all.disabled = busy;
  all.textContent = selectable > 0 && allSelected(state) ? 'Clear all' : 'Select all';
  const button = b.querySelector('.wmd-discard');
  button.hidden = count === 0;
  button.disabled = busy;
  for (const box of document.querySelectorAll('input.wmd-check')) box.disabled = busy;
  b.hidden = count === 0 && selectable === 0 && !msg;
}
```

Add after `showMessage`:
```js
function onSelectAllClick() {
  if (!state || busy) return;
  if (allSelected(state)) clearAll(state);
  else selectAll(state);
}
```

- [ ] **Step 4: Render after each scan**

In `applyStore`, replace `if (grid) scanGrid(grid, state);` with:
```js
  if (grid) scanGrid(grid, state);
  render();
```

Replace `tick` with:
```js
function tick() {
  if (!onCollectionPage()) return;
  const grid = findGrid();
  if (!grid) return;
  if (state) {
    scanGrid(grid, state);
    render();
  } else if (!sawSiteRequest && !fallbackTimer && !failed) fallbackTimer = setTimeout(startFallback, FALLBACK_MS);
}
```

- [ ] **Step 5: Style the button**

Append to `extension/src/styles.css`:
```css
.wmd-all {
  background: #374151;
  color: #f9fafb;
}

.wmd-all:disabled {
  opacity: 0.5;
  cursor: wait;
}
```

- [ ] **Step 6: Update the README usage**

In `README.md`, replace Usage step 3:
```markdown
3. Tick the cards you want to discard. A bar at the bottom of the page shows how
   many are selected.
```
with:
```markdown
3. Tick the cards you want to discard, or click **Select all** in the bar at the
   bottom of the page to tick every card on the current page (locked cards stay
   out). The bar shows how many are selected. Once all are ticked, the button
   reads **Clear all**.
```

- [ ] **Step 7: Test and build**

Run: `npm test && npm run build`
Expected: 82 tests pass, esbuild writes `extension/dist/content.js` with exit code 0.

- [ ] **Step 8: Commit**

```bash
git add extension/src/content.js extension/src/styles.css README.md
git commit -m "feat(bar): add a select all button for the current page"
```
