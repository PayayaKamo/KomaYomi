import { describe, expect, it } from 'vitest';
import { renumberPanels, sortPanels, splitRect } from '../../src/lib/geometry';
import { sortReadingOrder } from '../../server/detect';
import type { Panel } from '../../src/types';
import type { ReadingDirection } from '../../shared/types';

const panel = (id: string, x: number, y: number, number?: number): Panel => ({
  id,
  rect: { x, y, w: 0.4, h: 0.4 },
  ...(number === undefined ? {} : { number }),
});

/** 2x2 grid: a top-left, b top-right, c bottom-left, d bottom-right. */
const grid = () => [panel('a', 0.05, 0.05), panel('b', 0.55, 0.05), panel('c', 0.05, 0.55), panel('d', 0.55, 0.55)];

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

  it('reads horizontal rows left-to-right for ltr and horizontal-lr', () => {
    expect(sortPanels(grid(), 'ltr').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortPanels(grid(), 'horizontal-lr').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reads horizontal rows right-to-left for rtl and horizontal-rl', () => {
    expect(sortPanels(grid(), 'rtl').map((p) => p.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortPanels(grid(), 'horizontal-rl').map((p) => p.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('reads vertical columns top-to-bottom, right-to-left for ttb and vertical-rl', () => {
    expect(sortPanels(grid(), 'ttb').map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortPanels(grid(), 'vertical-rl').map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('reads vertical columns top-to-bottom, left-to-right for vertical-lr', () => {
    expect(sortPanels(grid(), 'vertical-lr').map((p) => p.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('matches the server order for every direction and alias', () => {
    const directions: ReadingDirection[] = [
      'rtl',
      'ltr',
      'ttb',
      'horizontal-rl',
      'horizontal-lr',
      'vertical-rl',
      'vertical-lr',
    ];
    for (const dir of directions) {
      const panels = grid();
      expect(sortPanels(panels, dir).map((p) => p.id)).toEqual(
        sortReadingOrder(panels, dir, (p) => p.rect).map((p) => p.id),
      );
    }
  });

  it('matches the server order when a hand-saved number order is stored', () => {
    const panels = [panel('a', 0.55, 0.55, 4), panel('b', 0.05, 0.05, 1), panel('c', 0.55, 0.05, 3)];
    for (const dir of ['rtl', 'horizontal-rl', 'vertical-rl', 'vertical-lr'] as ReadingDirection[]) {
      const front = sortPanels(panels, dir).map((p) => p.id);
      const server = sortReadingOrder(panels, dir, (p) => p.rect).map((p) => p.id);
      expect(front).toEqual(['b', 'c', 'a']);
      expect(server).toEqual(front);
    }
  });
});

describe('renumberPanels', () => {
  it('writes consecutive numbers in array order regardless of previous values', () => {
    const panels = [panel('a', 0, 0, 9), panel('b', 0.8, 0), panel('c', 0, 0.5, 2)];
    expect(renumberPanels(panels).map((p) => p.number)).toEqual([1, 2, 3]);
    expect(renumberPanels(panels).map((p) => p.id)).toEqual(['a', 'b', 'c']);
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
