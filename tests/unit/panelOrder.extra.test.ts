import { describe, expect, it } from 'vitest';
import { applyGroupOrder, normalizeGroupOrder, sortReadingOrder } from '../../shared/panelOrder.ts';
import type { PanelGroup } from '../../shared/types.ts';

type TestPanel = { id: string; rect: { x: number; y: number; w: number; h: number }; number?: number };

const panel = (id: string, x: number, y: number, number?: number): TestPanel => ({
  id,
  rect: { x, y, w: 0.4, h: 0.4 },
  ...(number === undefined ? {} : { number }),
});

const ids = (items: TestPanel[]) => items.map((item) => item.id);
const order = (panels: TestPanel[], dir: Parameters<typeof sortReadingOrder>[1]) =>
  ids(sortReadingOrder(panels, dir, (p) => p.rect));

const group = (id: string, panelIds: string[]): PanelGroup => ({ id, name: id, panelIds });

describe('sortReadingOrder explicit numbers', () => {
  it('orders by explicit numbers instead of geometry', () => {
    const panels = [panel('a', 0.8, 0, 3), panel('b', 0, 0, 1), panel('c', 0, 0.5, 2)];
    expect(order(panels, 'rtl')).toEqual(['b', 'c', 'a']);
  });

  it('puts unnumbered panels after numbered ones in their original order', () => {
    const panels = [panel('x', 0.8, 0), panel('a', 0, 0, 2), panel('y', 0, 0.5), panel('b', 0.4, 0.4, 1)];
    expect(order(panels, 'rtl')).toEqual(['b', 'a', 'x', 'y']);
  });

  it('treats number 0 as an explicit number', () => {
    const panels = [panel('a', 0, 0, 1), panel('z', 0.8, 0.8, 0)];
    expect(order(panels, 'rtl')).toEqual(['z', 'a']);
  });
});

describe('sortReadingOrder vertical reading', () => {
  it('groups columns right-to-left and sorts each column by y for ttb', () => {
    const panels = [panel('a', 0.05, 0.05), panel('b', 0.55, 0.05), panel('c', 0.05, 0.55), panel('d', 0.55, 0.55)];
    expect(order(panels, 'ttb')).toEqual(['b', 'd', 'a', 'c']);
  });

  it('reads columns left-to-right for vertical-lr', () => {
    const panels = [panel('a', 0.05, 0.55), panel('b', 0.55, 0.05), panel('c', 0.05, 0.05), panel('d', 0.55, 0.55)];
    expect(order(panels, 'vertical-lr')).toEqual(['c', 'a', 'b', 'd']);
  });

  it('treats nearby x positions as one column', () => {
    const panels = [panel('near', 0.08, 0.55), panel('left', 0.05, 0.05), panel('right', 0.55, 0.05)];
    expect(order(panels, 'vertical-lr')).toEqual(['left', 'near', 'right']);
  });
});

describe('sortReadingOrder horizontal reading', () => {
  it('groups nearby y positions into one row and orders by x', () => {
    const panels = [panel('right', 0.55, 0.08), panel('left', 0.05, 0.05), panel('low', 0.05, 0.55)];
    expect(order(panels, 'ltr')).toEqual(['left', 'right', 'low']);
  });

  it('uses the item itself as rect when no accessor is given', () => {
    const items = [
      { id: 'a', x: 0.05, y: 0.05, w: 0.4, h: 0.4 },
      { id: 'b', x: 0.55, y: 0.05, w: 0.4, h: 0.4 },
    ];
    expect(sortReadingOrder(items, 'rtl').map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('returns short input as-is and does not mutate the original array', () => {
    const one = [panel('a', 0.5, 0.5)];
    expect(sortReadingOrder(one, 'rtl', (p) => p.rect)).toEqual(one);
    const panels = [panel('a', 0.8, 0), panel('b', 0, 0)];
    sortReadingOrder(panels, 'rtl', (p) => p.rect);
    expect(ids(panels)).toEqual(['a', 'b']);
  });

  it('returns an empty array for empty input', () => {
    expect(sortReadingOrder<TestPanel>([], 'rtl')).toEqual([]);
  });
});

describe('applyGroupOrder', () => {
  const ordered = () => ['a', 'b', 'c', 'd'].map((id) => ({ id }));

  it('returns the input unchanged without usable groups', () => {
    const list = ordered();
    expect(applyGroupOrder(list, undefined)).toBe(list);
    expect(applyGroupOrder(list, [])).toBe(list);
    expect(applyGroupOrder(list, [group('empty', [])])).toBe(list);
    expect(applyGroupOrder(list, [{ id: 'g', name: 'g' } as PanelGroup])).toBe(list);
  });

  it('moves group members to the anchor position in stored group order', () => {
    expect(applyGroupOrder(ordered(), [group('g', ['b', 'a'])]).map((p) => p.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('ignores group ids that are not on the page', () => {
    expect(applyGroupOrder(ordered(), [group('g', ['zzz', 'b'])]).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lets the first group that claims a panel win', () => {
    const groups = [group('one', ['c', 'a']), group('two', ['a', 'b'])];
    expect(applyGroupOrder(ordered(), groups).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('keeps ungrouped panels at their natural reading positions', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    expect(applyGroupOrder(list, [group('g', ['d', 'b'])]).map((p) => p.id)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
});

describe('normalizeGroupOrder', () => {
  it('sorts members and groups by reading order', () => {
    const groups = [group('second', ['d', 'b']), group('first', ['c', 'a'])];
    const out = normalizeGroupOrder(groups, ['a', 'b', 'c', 'd']);
    expect(out.map((g) => g.id)).toEqual(['first', 'second']);
    expect(out.map((g) => g.panelIds)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('puts ids missing from the reading order last', () => {
    const out = normalizeGroupOrder([group('g', ['zzz', 'b', 'a'])], ['a', 'b']);
    expect(out[0].panelIds).toEqual(['a', 'b', 'zzz']);
  });

  it('puts groups without known members last', () => {
    const out = normalizeGroupOrder([group('unknown', ['zzz']), group('empty', []), group('known', ['a'])], ['a']);
    expect(out.map((g) => g.id)).toEqual(['known', 'unknown', 'empty']);
  });

  it('keeps other group fields and does not mutate the input', () => {
    const groups: PanelGroup[] = [{ id: 'g', name: 'G', panelIds: ['b', 'a'], number: 2, color: '#fff' }];
    const out = normalizeGroupOrder(groups, ['a', 'b']);
    expect(out[0]).toMatchObject({ id: 'g', name: 'G', number: 2, color: '#fff' });
    expect(out[0].panelIds).toEqual(['a', 'b']);
    expect(groups[0].panelIds).toEqual(['b', 'a']);
  });
});
