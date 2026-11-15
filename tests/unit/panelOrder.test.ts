import { describe, expect, it } from 'vitest';
import { sortPanels } from '../../src/lib/geometry';
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
