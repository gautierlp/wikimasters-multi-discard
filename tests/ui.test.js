// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { findGrid, createState, scanGrid, selectedForDiscard, markDiscarded, deselect } from '../extension/src/ui.js';
import { buildCardMap } from '../extension/src/api.js';
import { row, cardEl, framedCardEl } from './helpers.js';

function makeGrid(cards) {
  const grid = document.createElement('div');
  grid.className = 'flex flex-wrap justify-center gap-3';
  grid.append(...cards);
  document.body.append(grid);
  return grid;
}

function setup(rowsList, pending = []) {
  const changes = [];
  const state = createState({ map: buildCardMap(rowsList), pendingSet: new Set(pending), onChange: (n) => changes.push(n) });
  return { state, changes };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('findGrid', () => {
  it('picks the flex-wrap container that holds card wrappers', () => {
    const decoy = document.createElement('div');
    decoy.className = 'flex flex-wrap justify-center';
    decoy.append(document.createElement('span'));
    document.body.append(decoy);
    const grid = makeGrid([cardEl('https://img.test/1.png', 'Title 1')]);
    expect(findGrid(document)).toBe(grid);
  });

  it('finds wrappers nested one level inside grid children', () => {
    const outer = document.createElement('div');
    outer.append(cardEl('https://img.test/1.png', 'Title 1'));
    const grid = makeGrid([outer]);
    expect(findGrid(document)).toBe(grid);
  });

  it('returns null when no grid has cards', () => {
    expect(findGrid(document)).toBeNull();
  });
});

describe('scanGrid', () => {
  it('adds a checkbox, a lock, or nothing, and is idempotent', () => {
    const { state } = setup([row(1), row(2, { starred: true })]);
    const [free, starred, unknown] = [
      cardEl('https://img.test/1.png', 'Title 1'),
      cardEl('https://img.test/2.png', 'Title 2'),
      cardEl('https://img.test/9.png', 'Nope'),
    ];
    const grid = makeGrid([free, starred, unknown]);
    scanGrid(grid, state);
    scanGrid(grid, state);
    expect(free.querySelectorAll('input.wmd-check')).toHaveLength(1);
    expect(free.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-1');
    expect(starred.querySelectorAll('.wmd-lock')).toHaveLength(1);
    expect(starred.querySelector('input.wmd-check')).toBeNull();
    expect(unknown.querySelector('.wmd-ctl')).toBeNull();
  });

  it('tracks the selection when a checkbox is ticked', () => {
    const { state, changes } = setup([row(1)]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    scanGrid(makeGrid([el]), state);
    el.querySelector('input.wmd-check').click();
    expect([...state.selected.keys()]).toEqual(['uc-1']);
    expect(changes).toEqual([1]);
  });

  it('rebinds an element that now shows another card', () => {
    const { state } = setup([row(1), row(2)]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([el]);
    scanGrid(grid, state);
    el.querySelector('input.wmd-check').click();
    el.querySelector('img').setAttribute('src', 'https://img.test/2.png');
    el.querySelector('h3').textContent = 'Title 2';
    scanGrid(grid, state);
    expect(el.querySelectorAll('.wmd-ctl')).toHaveLength(1);
    expect(el.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-2');
    expect(state.selected.size).toBe(0);
    expect(state.claimed.has('uc-1')).toBe(false);
  });

  it('releases the row of an element removed from the DOM', () => {
    const { state } = setup([row(1)]);
    const first = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([first]);
    scanGrid(grid, state);
    first.remove();
    const second = cardEl('https://img.test/1.png', 'Title 1');
    grid.append(second);
    scanGrid(grid, state);
    expect(second.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-1');
  });

  it('rebinds when only the image changes', () => {
    const { state } = setup([row(1), row(2, { card: { id: 'c-2', image_url: 'https://img.test/2.png', wikipedia_title: 'Title 1' } })]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([el]);
    scanGrid(grid, state);
    el.querySelector('input.wmd-check').click();
    el.querySelector('img').setAttribute('src', 'https://img.test/2.png');
    scanGrid(grid, state);
    expect(el.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-2');
    expect(state.selected.size).toBe(0);
    expect(el.querySelectorAll('.wmd-ctl')).toHaveLength(1);
  });

  it('drops the selection when only the title changes', () => {
    const { state } = setup([row(1), row(2, { card: { id: 'c-2', image_url: null, wikipedia_title: 'Title 2' } })]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([el]);
    scanGrid(grid, state);
    el.querySelector('input.wmd-check').click();
    el.querySelector('h3').textContent = 'Title 2';
    expect(selectedForDiscard(state)).toEqual([]);
    scanGrid(grid, state);
    expect(state.selected.size).toBe(0);
    const box = el.querySelector('input.wmd-check');
    expect(box.dataset.userCardId).toBe('uc-2');
    expect(box.checked).toBe(false);
    expect(el.querySelectorAll('.wmd-ctl')).toHaveLength(1);
  });

  it('releases an element moved out of the grid', () => {
    const { state } = setup([row(1)]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([el]);
    scanGrid(grid, state);
    el.remove();
    document.body.append(el);
    scanGrid(grid, state);
    expect(state.claimed.has('uc-1')).toBe(false);
    expect(el.querySelector('.wmd-ctl')).toBeNull();
  });
});

describe('selectedForDiscard and markDiscarded', () => {
  it('excludes an element whose content changed since the last scan', () => {
    const { state } = setup([row(1), row(2)]);
    const a = cardEl('https://img.test/1.png', 'Title 1');
    const b = cardEl('https://img.test/2.png', 'Title 2');
    scanGrid(makeGrid([a, b]), state);
    a.querySelector('input.wmd-check').click();
    b.querySelector('input.wmd-check').click();
    b.querySelector('img').setAttribute('src', 'https://img.test/7.png');
    b.querySelector('h3').textContent = 'Other';
    expect(selectedForDiscard(state)).toEqual(['uc-1']);
  });

  it('hides a discarded card and clears its selection', () => {
    const { state, changes } = setup([row(1)]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    scanGrid(makeGrid([el]), state);
    el.querySelector('input.wmd-check').click();
    markDiscarded(state, 'uc-1');
    expect(el.style.display).toBe('none');
    expect(el.querySelector('.wmd-ctl')).toBeNull();
    expect(state.selected.size).toBe(0);
    expect(changes).toEqual([1, 0]);
  });
});

describe('scanGrid and hidden cards', () => {
  it('does not bind a card hidden by markDiscarded on a rescan', () => {
    const same = () => ({ card: { ...row(1).card } });
    const { state } = setup([row(1), row(5, same()), row(6, same())]);
    const a = cardEl('https://img.test/1.png', 'Title 1');
    const b = cardEl('https://img.test/1.png', 'Title 1');
    const grid = makeGrid([a, b]);
    scanGrid(grid, state);
    a.querySelector('input.wmd-check').click();
    markDiscarded(state, 'uc-1');
    scanGrid(grid, state);
    expect(a.querySelector('.wmd-ctl')).toBeNull();
    expect(state.bound.has(a)).toBe(false);
    expect(state.claimed.has('uc-6')).toBe(false);
    expect(b.querySelector('input.wmd-check').dataset.userCardId).toBe('uc-5');
  });
});

describe('deselect', () => {
  it('unchecks the box, removes the id from the selection, and reports the new size', () => {
    const { state, changes } = setup([row(1), row(2)]);
    const a = cardEl('https://img.test/1.png', 'Title 1');
    const b = cardEl('https://img.test/2.png', 'Title 2');
    scanGrid(makeGrid([a, b]), state);
    a.querySelector('input.wmd-check').click();
    b.querySelector('input.wmd-check').click();
    deselect(state, 'uc-1');
    expect(a.querySelector('input.wmd-check').checked).toBe(false);
    expect([...state.selected.keys()]).toEqual(['uc-2']);
    expect(changes).toEqual([1, 2, 1]);
  });

  it('does nothing for an id that is not selected', () => {
    const { state, changes } = setup([row(1)]);
    deselect(state, 'uc-1');
    expect(changes).toEqual([]);
  });
});

describe('scanGrid on live card markup', () => {
  it('drops the selection when only the portrait behind the frame changes', () => {
    const { state } = setup([row(1), row(2, { card: { id: 'c-2', image_url: 'https://img.test/2.png', wikipedia_title: 'Title 1' } })]);
    const el = framedCardEl('https://img.test/1.png', 'Title 1');
    scanGrid(makeGrid([el]), state);
    el.querySelector('input.wmd-check').click();
    el.querySelectorAll('img')[1].setAttribute('src', 'https://img.test/2.png');
    expect(selectedForDiscard(state)).toEqual([]);
  });
});
