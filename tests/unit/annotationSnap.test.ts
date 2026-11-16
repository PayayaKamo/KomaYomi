import { describe, expect, it } from 'vitest';
import { snapLineEnd } from '../../src/components/AnnotationLayer.tsx';

const START = { x: 0.5, y: 0.5 };

describe('snapLineEnd', () => {
  it('snaps a near-horizontal drag onto the horizontal axis', () => {
    expect(snapLineEnd(START, { x: 0.6, y: 0.52 }, 1000, 1000)).toEqual({ x: 0.6, y: 0.5 });
  });

  it('snaps a near-vertical drag onto the vertical axis', () => {
    expect(snapLineEnd(START, { x: 0.52, y: 0.6 }, 1000, 1000)).toEqual({ x: 0.5, y: 0.6 });
  });

  it('snaps a diagonal drag onto 45° and keeps the cursor projection', () => {
    const end = snapLineEnd(START, { x: 0.6, y: 0.58 }, 1000, 1000);
    expect(end.x).toBeCloseTo(0.59, 6);
    expect(end.y).toBeCloseTo(0.59, 6);
  });

  it('measures angles in rendered pixels, not normalized units', () => {
    // 100px right and 100px down is 45° on screen even though the fractions differ.
    const end = snapLineEnd(START, { x: 0.55, y: 0.6 }, 2000, 1000);
    expect(end.x).toBeCloseTo(0.55, 6);
    expect(end.y).toBeCloseTo(0.6, 6);
  });

  it('returns the pointer unchanged when the scale is unknown', () => {
    const end = { x: 0.61, y: 0.53 };
    expect(snapLineEnd(START, end, 0, 1000)).toBe(end);
  });
});
