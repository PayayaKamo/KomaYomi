import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARE_SIZE,
  SHARE_SIZE_PRESETS,
  findShareSize,
  fitWithin,
  isResized,
  resolveShareSize,
} from '../../src/lib/shareSizes';

const preset = (id: string) => {
  const found = findShareSize(id);
  if (!found) throw new Error(`missing preset: ${id}`);
  return found;
};

describe('share size presets', () => {
  it('keeps ids unique and defaults to the original size', () => {
    const ids = SHARE_SIZE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_SHARE_SIZE).toBe('auto');
    expect(isResized(preset('auto'))).toBe(false);
  });

  it('uses the 3:4 Xiaohongshu feed size as the portrait preset', () => {
    expect(resolveShareSize(preset('xhs-3x4'), 1000, 1500)).toEqual({ width: 1080, height: 1440 });
    expect(resolveShareSize(preset('xhs-1x1'), 1000, 1500)).toEqual({ width: 1080, height: 1080 });
    expect(resolveShareSize(preset('xhs-4x3'), 1000, 1500)).toEqual({ width: 1440, height: 1080 });
  });

  it('derives the height for width-only strip presets', () => {
    expect(resolveShareSize(preset('xhs-long'), 1000, 1500)).toEqual({ width: 1080, height: 1620 });
    expect(resolveShareSize(preset('webtoon-800'), 800, 1280)).toEqual({ width: 800, height: 1280 });
  });

  it('shrinks very tall strips under the canvas edge limit', () => {
    const size = resolveShareSize(preset('webtoon-800'), 100, 100000);
    expect(size.height).toBe(16384);
    expect(size.width).toBe(16);
  });

  it('ignores unknown ids', () => {
    expect(findShareSize('nope')).toBeNull();
    expect(findShareSize(null)).toBeNull();
    expect(findShareSize(undefined)).toBeNull();
  });

  it('includes print presets at 300 dpi', () => {
    expect(resolveShareSize(preset('print-b5'), 1000, 1500)).toEqual({ width: 2150, height: 3035 });
    expect(resolveShareSize(preset('print-a4'), 1000, 1500)).toEqual({ width: 2480, height: 3508 });
  });
});

describe('fitWithin', () => {
  it('centers a portrait image inside a square canvas', () => {
    expect(fitWithin(1000, 1500, 1080, 1080)).toEqual({ x: 180, y: 0, w: 720, h: 1080 });
  });

  it('centers a landscape image inside a portrait canvas', () => {
    expect(fitWithin(2000, 1000, 1080, 1080)).toEqual({ x: 0, y: 270, w: 1080, h: 540 });
  });

  it('leaves matching aspect ratios untouched', () => {
    expect(fitWithin(1080, 1440, 1080, 1440)).toEqual({ x: 0, y: 0, w: 1080, h: 1440 });
  });

  it('returns an empty rect for invalid input', () => {
    expect(fitWithin(0, 100, 1080, 1080)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(fitWithin(100, 100, 0, 1080)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
