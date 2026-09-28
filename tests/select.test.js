// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isProtected, normalizeImgSrc, bindCardElement, filterStillDiscardable } from '../extension/src/select.js';
import { buildCardMap } from '../extension/src/api.js';
import { row, cardEl, framedCardEl } from './helpers.js';

describe('isProtected', () => {
  const pending = new Set(['c-2', 'uc-3']);
  it('protects starred rows', () => expect(isProtected(row(1, { starred: true }), pending)).toBe(true));
  it('protects rows whose card_id is pending', () => expect(isProtected(row(2), pending)).toBe(true));
  it('protects rows whose id is pending', () => expect(isProtected(row(3), pending)).toBe(true));
  it('leaves other rows unprotected', () => expect(isProtected(row(4), pending)).toBe(false));
});

describe('normalizeImgSrc', () => {
  const original = 'https://cdn.test/cards/a b.png';
  const enc = encodeURIComponent(original);
  it('decodes a relative Next.js image URL', () => {
    expect(normalizeImgSrc(`/_next/image?url=${enc}&w=384&q=75`)).toBe(original);
  });
  it('decodes an absolute Next.js image URL', () => {
    expect(normalizeImgSrc(`https://www.wiki-masters.com/_next/image?url=${enc}&w=384&q=75`)).toBe(original);
  });
  it('returns a plain URL unchanged', () => {
    expect(normalizeImgSrc('https://img.test/1.png')).toBe('https://img.test/1.png');
  });
  it('returns an empty string for a missing src', () => {
    expect(normalizeImgSrc(null)).toBe('');
    expect(normalizeImgSrc(undefined)).toBe('');
  });
});

describe('bindCardElement', () => {
  const map = buildCardMap([row(1), row(2), row(3, { card: { id: 'c-3', image_url: null, wikipedia_title: 'Only Title' } })]);

  it('binds when both the image and the title match', () => {
    const el = cardEl('https://img.test/1.png', 'Title 1');
    expect(bindCardElement(el, map, new Set()).id).toBe('uc-1');
  });

  it('an image match needs the same title', () => {
    const el = cardEl('https://img.test/1.png', 'Title 2');
    expect(bindCardElement(el, map, new Set())).toBeNull();
  });

  it('does not bind a row that has an image through the title path', () => {
    const el = cardEl('https://img.test/999.png', 'Title 2');
    expect(bindCardElement(el, map, new Set())).toBeNull();
    expect(bindCardElement(cardEl(null, 'Title 2'), map, new Set())).toBeNull();
  });

  it('matches a Next.js-optimized image', () => {
    const el = cardEl(`/_next/image?url=${encodeURIComponent('https://img.test/2.png')}&w=256&q=75`, 'Title 2');
    expect(bindCardElement(el, map, new Set()).id).toBe('uc-2');
  });

  it('falls back to the title', () => {
    const el = cardEl(null, 'Only Title');
    expect(bindCardElement(el, map, new Set()).id).toBe('uc-3');
  });

  it('returns null when nothing matches, with no positional guess', () => {
    const el = cardEl('https://img.test/999.png', 'Unknown');
    expect(bindCardElement(el, map, new Set())).toBeNull();
  });

  it('binds copies of one card to different rows and claims them', () => {
    const copies = buildCardMap([row(1), row(5, { card: { ...row(1).card } })]);
    const claimed = new Set();
    const first = bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, claimed);
    const second = bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, claimed);
    const third = bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, claimed);
    expect([first.id, second.id, third]).toEqual(['uc-1', 'uc-5', null]);
    expect([...claimed]).toEqual(['uc-1', 'uc-5']);
  });
  it('returns null when unclaimed copies differ in is_shiny', () => {
    const copies = buildCardMap([row(1), row(5, { card: { ...row(1).card }, is_shiny: true })]);
    expect(bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, new Set())).toBeNull();
  });

  it('returns null when one unclaimed copy is starred', () => {
    const copies = buildCardMap([row(1), row(5, { card: { ...row(1).card }, starred: true })]);
    expect(bindCardElement(cardEl('https://img.test/1.png', 'Title 1'), copies, new Set())).toBeNull();
  });

  it('returns null when one unclaimed copy is in a pending trade', () => {
    const copies = buildCardMap([row(1), row(5, { card: { ...row(1).card } })]);
    const el = cardEl('https://img.test/1.png', 'Title 1');
    expect(bindCardElement(el, copies, new Set(), new Set(['uc-5']))).toBeNull();
  });

  it('applies the ambiguity guard to the title path too', () => {
    const noImg = { id: 'c-7', image_url: '', wikipedia_title: 'Bare' };
    const copies = buildCardMap([row(7, { card: noImg }), row(8, { card: { ...noImg }, is_shiny: true })]);
    expect(bindCardElement(cardEl(null, 'Bare'), copies, new Set())).toBeNull();
  });
});

describe('filterStillDiscardable', () => {
  const fresh = [row(1), row(2, { starred: true }), row(3), row(4)];
  it('keeps an unprotected id that still exists', () => {
    expect(filterStillDiscardable(['uc-1'], fresh, [])).toEqual({ keep: ['uc-1'], skipped: [] });
  });
  it('skips an id that is now starred', () => {
    expect(filterStillDiscardable(['uc-2'], fresh, [])).toEqual({ keep: [], skipped: ['uc-2'] });
  });
  it('skips an id whose card_id is in a pending trade', () => {
    expect(filterStillDiscardable(['uc-3'], fresh, ['c-3'])).toEqual({ keep: [], skipped: ['uc-3'] });
  });
  it('skips an id missing from the rows', () => {
    expect(filterStillDiscardable(['uc-9'], fresh, [])).toEqual({ keep: [], skipped: ['uc-9'] });
  });
  it('preserves the order of ids', () => {
    expect(filterStillDiscardable(['uc-4', 'uc-2', 'uc-1', 'uc-3'], fresh, ['uc-3'])).toEqual({
      keep: ['uc-4', 'uc-1'],
      skipped: ['uc-2', 'uc-3'],
    });
  });
});

describe('bindCardElement on live card markup', () => {
  it('binds by the portrait when the rarity frame image comes first', () => {
    const map = buildCardMap([row(1)]);
    expect(bindCardElement(framedCardEl('https://img.test/1.png', 'Title 1'), map, new Set()).id).toBe('uc-1');
  });

  it('binds an image-less card shown with the placeholder logo', () => {
    const map = buildCardMap([row(3, { card: { id: 'c-3', image_url: null, wikipedia_title: 'Only Title' } })]);
    expect(bindCardElement(framedCardEl('/logo.png', 'Only Title'), map, new Set()).id).toBe('uc-3');
  });
});
