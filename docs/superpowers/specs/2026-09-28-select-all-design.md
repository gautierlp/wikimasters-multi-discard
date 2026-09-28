# WikiMasters multi-discard: select all on the current page

Date: 2026-09-28
Status: implemented (branch select-all)
Builds on: `2026-09-28-per-page-loading-design.md` (merged)

## Problem

To discard a full grid page of 50 cards, the owner ticks 50 checkboxes one by
one. A "Select all" button ticks every checkbox on the current grid page in one
click.

## Design

1. **Place.** The button goes in the floating bar (`#wmd-bar`), before the
   Discard button. Today the bar hides when nothing is selected. It now also
   shows when the current grid has at least one checkbox, so the button is
   reachable with zero cards selected.
2. **Scope.** "Select all" ticks every card that has a checkbox on the current
   grid page. Locked cards (starred or in a pending trade) have no checkbox and
   stay out. Cards on other grid pages stay out: the grid shows one page at a
   time and a page change already clears the selection.
3. **Toggle.** When every checkbox on the page is ticked, the button reads
   "Clear all" and a click unticks them all. Otherwise it reads "Select all".
4. **Busy.** While a confirmation or a discard runs, the button is disabled,
   like the checkboxes.
5. **Safety.** The discard path does not change: the confirmation dialog with
   the count, the protection re-check, and the queue stay as they are. The
   owner accepted that one click plus one confirmation can discard 50 cards.

## Components

`extension/src/ui.js` (add, unit-tested)
- `selectableEntries(state)` (internal): bound entries whose element is still
  connected, still matches its signature, and holds a `.wmd-check` box.
- `selectableCount(state)` -> number of those entries.
- `allSelected(state)` -> true when `selectableCount(state) > 0` and every
  selectable row id is in `state.selected`.
- `selectAll(state)` -> ticks each selectable box, adds each to
  `state.selected`, then calls `state.onChange(state.selected.size)` once.
- `clearAll(state)` -> unticks every selected box, empties `state.selected`,
  then calls `state.onChange(0)` once. Does nothing when the selection is
  already empty.

`extension/src/content.js` (change)
- The bar gets a `<button class="wmd-all">`. Its click calls `clearAll` when
  `allSelected(state)`, else `selectAll`.
- `render()` sets the label ("Select all" / "Clear all"), hides the button when
  `selectableCount(state) === 0`, disables it when busy, and keeps the bar
  visible when `selectableCount(state) > 0`.
- `render()` runs after each `scanGrid` call, so the bar appears as soon as
  checkboxes appear (today `render` runs only on a selection change).

`extension/src/styles.css` (change)
- `.wmd-all`: a neutral grey button, distinct from the red Discard button.

## Testing

- `tests/ui.test.js`: `selectAll` ticks every free card and skips locked and
  unbound cards; it calls `onChange` once with the new size; it skips an
  element whose signature changed since binding; `allSelected` is false with
  no selectable card, false with a partial selection, true after `selectAll`;
  `clearAll` unticks the boxes, empties the selection, and calls `onChange(0)`
  once; `selectedForDiscard` returns every id after `selectAll`.
- Manual check on the live site: the bar shows "Select all" on page load; a
  click ticks every free card and the count reads 50 (or the number of free
  cards); the label changes to "Clear all"; a second click clears; a page
  change resets the button.

## Out of scope

- Select across several grid pages.
- "Select all duplicates" (a separate roadmap item).
