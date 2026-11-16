import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARE_PRESET,
  SHARE_PRESETS,
  chooseFit,
  compareTiles,
  containWithin,
  coverWithin,
  effectivePanelRect,
  findSharePreset,
  infoBarRect,
  longLayout,
  SHARE_SAFE_MARGIN,
} from '../../src/lib/shareImageExport.ts';

describe('share image presets', () => {
  const byId = (id: string) => SHARE_PRESETS.find((preset) => preset.id === id);

  it('matches the platform sizes and encodings', () => {
    expect(byId('cover')).toMatchObject({ width: 1080, height: 1440, format: 'jpeg', quality: 0.88 });
    expect(byId('cover-hd')).toMatchObject({ width: 1242, height: 1656, format: 'jpeg', quality: 0.9 });
    expect(byId('panel')).toMatchObject({ width: 1080, height: 1440, format: 'jpeg', quality: 0.85 });
    expect(byId('compare')).toMatchObject({ width: 1080, height: 1440, format: 'png' });
    expect(byId('long')).toMatchObject({ width: 1080, height: 3240, format: 'jpeg' });
    expect(DEFAULT_SHARE_PRESET).toBe('cover');
    expect(findSharePreset('nope')).toBeNull();
  });

  it('keeps every 3:4 preset at exactly 1080×1440 or 1242×1656', () => {
    for (const id of ['cover', 'panel', 'compare'] as const) {
      const preset = byId(id)!;
      expect(preset.width / preset.height).toBeCloseTo(3 / 4, 5);
    }
    const hd = byId('cover-hd')!;
    expect(hd.width / hd.height).toBeCloseTo(3 / 4, 5);
  });
});

describe('share image fitting', () => {
  it('crops only when the aspect ratio is close, otherwise keeps the whole artwork', () => {
    // A typical manga page (0.7) against 3:4 (0.75) only loses a few percent.
    expect(chooseFit(1400, 2000, 1080, 1440)).toBe('cover');
    // A double-page spread keeps both pages and gets a blurred backdrop.
    expect(chooseFit(2800, 2000, 1080, 1440)).toBe('contain');
  });

  it('cover scales up to fill and overflows the shorter axis', () => {
    const rect = coverWithin(1400, 2000, 1080, 1440);
    expect(rect.w).toBeCloseTo(1080, 5);
    expect(rect.h).toBeGreaterThanOrEqual(1440);
    expect(rect.x).toBeCloseTo(0, 5);
    expect(rect.y).toBeLessThan(0);
  });

  it('top-anchored cover starts at the top so a long page keeps its first strip', () => {
    const rect = coverWithin(1080, 5000, 1080, 1440, true);
    expect(rect.y).toBe(0);
    expect(rect.w).toBeCloseTo(1080, 5);
  });

  it('contain stays fully inside the canvas', () => {
    const rect = containWithin(2800, 2000, 1080, 1440);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(1080 + 1e-6);
    expect(rect.y + rect.h).toBeLessThanOrEqual(1440 + 1e-6);
    expect(rect.w / rect.h).toBeCloseTo(2800 / 2000, 5);
  });
});

describe('long page slicing', () => {
  it('slices top to bottom with no gap and no slice above 3240', () => {
    const layout = longLayout(1080, 5000, 1080, 3240);
    expect(layout.scaledHeight).toBe(5000);
    expect(layout.slices).toHaveLength(2);
    expect(layout.slices[0]).toEqual({ top: 0, height: 3240 });
    expect(layout.slices[1]).toEqual({ top: 3240, height: 1760 });
    let expectedTop = 0;
    for (const slice of layout.slices) {
      expect(slice.top).toBe(expectedTop);
      expect(slice.height).toBeLessThanOrEqual(3240);
      expect(slice.height).toBeGreaterThan(0);
      expectedTop += slice.height;
    }
    expect(expectedTop).toBe(layout.scaledHeight);
  });

  it('scales narrow sources up to the 1080 target width before slicing', () => {
    const layout = longLayout(540, 2000, 1080, 3240);
    expect(layout.scaledHeight).toBe(4000);
    expect(layout.slices.map((slice) => slice.height)).toEqual([3240, 760]);
  });

  it('returns nothing for empty sources', () => {
    expect(longLayout(0, 1000, 1080, 3240).slices).toEqual([]);
  });
});

describe('compare grid', () => {
  it('packs three languages as two top tiles and one centered bottom tile', () => {
    const tiles = compareTiles(3, 1080, 1440, 12);
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile.w / tile.h).toBeCloseTo(3 / 4, 5);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(1080 + 1e-6);
      expect(tile.y + tile.h).toBeLessThanOrEqual(1440 + 1e-6);
    }
    expect(tiles[0].y).toBeCloseTo(tiles[1].y, 5);
    expect(tiles[2].y).toBeGreaterThan(tiles[0].y);
    // The lone bottom tile is centered under the pair.
    expect(tiles[2].x + tiles[2].w / 2).toBeCloseTo(540, 5);
  });

  it('never overlaps tiles', () => {
    const tiles = compareTiles(4, 1080, 1440, 10);
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i];
        const b = tiles[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it('uses one full tile for a single language', () => {
    const [tile] = compareTiles(1, 1080, 1440, 12);
    expect(tile).toBeDefined();
    expect(tile.w / tile.h).toBeCloseTo(3 / 4, 5);
    expect(compareTiles(1, 1080, 1440, 0)[0]).toMatchObject({ x: 0, y: 0, w: 1080, h: 1440 });
  });
});

describe('caption safe area', () => {
  it('keeps the info bar inside the bottom safe area on every canvas', () => {
    for (const [width, height] of [
      [1080, 1440],
      [1242, 1656],
      [1080, 3240],
      [1080, 640],
    ]) {
      const bar = infoBarRect(width, height);
      expect(bar.y).toBeGreaterThanOrEqual(height * SHARE_SAFE_MARGIN);
      expect(bar.y + bar.h).toBeLessThanOrEqual(height * (1 - SHARE_SAFE_MARGIN) + 1e-6);
      expect(bar.x).toBeGreaterThan(0);
      expect(bar.x + bar.w).toBeLessThan(width);
    }
  });
});

describe('panel alignment', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.4, h: 0.3 };

  it('applies page and panel offsets like the compare view', () => {
    const moved = effectivePanelRect(rect, { x: 0.05, y: -0.05, scale: 1 }, { x: 0.05, y: 0.05, scale: 1.1 });
    expect(moved.x).toBeCloseTo(rect.x + 0.1 * rect.w + (rect.w - rect.w / 1.1) / 2, 5);
    expect(moved.w).toBeCloseTo(rect.w / 1.1, 5);
  });

  it('clamps a shifted panel inside the page', () => {
    const moved = effectivePanelRect({ x: 0.8, y: 0.8, w: 0.4, h: 0.4 }, { x: 0.5, y: 0.5, scale: 1 });
    expect(moved.x + moved.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(moved.y + moved.h).toBeLessThanOrEqual(1 + 1e-9);
  });
});
