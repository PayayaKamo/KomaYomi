import { describe, expect, it } from 'vitest';
import { sortPanels, splitRect } from '../../src/lib/geometry';
import type { Panel } from '../../src/types';

const panel = (id: string, x: number, y: number, number?: number): Panel => ({
  id,
  rect: { x, y, w: 0.2, h: 0.2 },
  ...(number === undefined ? {} : { number }),
});

describe('sortPanels', () => {
  it('sorts detected panels right-to-left on a row by default', () => {
    const panels = [panel('a', 0, 0), panel('b', 0.8, 0), panel('c', 0, 0.5)];
    expect(sortPanels(panels, 'rtl').map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('honours explicit numbers, which is how a hand-saved order is stored', () => {
    const panels = [panel('a', 0.8, 0, 3), panel('b', 0, 0, 1), panel('c', 0, 0.5, 2)];
    expect(sortPanels(panels, 'rtl').map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps unnumbered panels after numbered ones in their stored order', () => {
    const panels = [panel('x', 0, 0), panel('a', 0.5, 0, 1), panel('y', 0, 0.5)];
    expect(sortPanels(panels, 'rtl').map((p) => p.id)).toEqual(['a', 'x', 'y']);
  });
});

describe('splitRect', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.6, h: 0.4 };

  it('splits vertically into touching pieces that cover the parent exactly', () => {
    const pieces = splitRect(rect, 'v', [0.5]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].x).toBeCloseTo(0.1, 6);
    expect(pieces[0].w).toBeCloseTo(0.3, 6);
    expect(pieces[1].x).toBeCloseTo(0.4, 6);
    expect(pieces[1].w).toBeCloseTo(0.3, 6);
    expect(pieces[0].x + pieces[0].w).toBeCloseTo(pieces[1].x, 6);
    expect(pieces[1].x + pieces[1].w).toBeCloseTo(0.7, 6);
  });

  it('honours uneven cuts and horizontal orientation', () => {
    const pieces = splitRect(rect, 'h', [0.25, 0.6]);
    expect(pieces).toHaveLength(3);
    [0.1, 0.14, 0.16].forEach((h, i) => expect(pieces[i].h).toBeCloseTo(h, 6));
    [0.2, 0.3, 0.44].forEach((y, i) => expect(pieces[i].y).toBeCloseTo(y, 6));
    expect(pieces.every((p) => p.x === 0.1 && p.w === 0.6)).toBe(true);
  });
});
