import { describe, expect, it } from 'vitest';
import {
  DETECTOR_VERSION,
  decodeGray,
  detectPanels,
  imageSize,
  sniffFormat,
  sortReadingOrder,
} from '../../server/detect.ts';
import { AppError } from '../../server/errors.ts';
import { sidebarNotePage, solidJpeg, solidPng, threePanelPage } from '../helpers/fixtures.ts';

describe('sniffFormat', () => {
  it('detects PNG, JPEG and WebP by magic bytes, not by extension', () => {
    expect(sniffFormat(solidPng(8, 8))).toBe('png');
    expect(sniffFormat(solidJpeg(8, 8))).toBe('jpeg');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
    expect(sniffFormat(webp)).toBe('webp');
    expect(sniffFormat(Buffer.from('GIF89a-not-an-image'))).toBe('unknown');
  });
});

describe('imageSize', () => {
  it('reads PNG dimensions from the IHDR header without decoding pixels', () => {
    expect(imageSize(solidPng(64, 96), 'page.png')).toEqual({ width: 64, height: 96 });
  });

  it('walks JPEG segments to the SOF marker', () => {
    expect(imageSize(solidJpeg(48, 72), 'page.jpg')).toEqual({ width: 48, height: 72 });
  });

  it('reads PNG size from a truncated header-only buffer', () => {
    const headerOnly = solidPng(12, 34).subarray(0, 33);
    expect(imageSize(headerOnly, 'fallback.png')).toEqual({ width: 12, height: 34 });
  });
});

describe('decodeGray', () => {
  it('converts RGBA pixels to luminance', () => {
    const png = solidPng(2, 2, 0);
    const gray = decodeGray(png, 'black.png');
    expect(gray.width).toBe(2);
    expect(gray.height).toBe(2);
    expect([...gray.data]).toEqual([0, 0, 0, 0]);
    const white = decodeGray(solidPng(1, 1, 255), 'white.png');
    expect(white.data[0]).toBe(255);
  });

  it('rejects formats it cannot decode with a structured error', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
    try {
      decodeGray(webp, 'x.webp');
      expect.unreachable('decodeGray should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ERR_UNSUPPORTED_IMAGE_FORMAT');
    }
  });
});

describe('detectPanels', () => {
  it('splits a synthetic 3-panel page and orders panels right-to-left', () => {
    const result = detectPanels(threePanelPage(), 'page.png');
    expect(result.width).toBe(600);
    expect(result.height).toBe(840);
    expect(result.panels).toHaveLength(3);
    expect(result.meta.scale).toBe(1);
    expect(result.meta.threshold).toBeGreaterThan(170);

    const [first, second, third] = result.panels;
    expect(first.x).toBeGreaterThan(second.x);
    expect(first.y).toBeCloseTo(second.y, 1);
    expect(third.y).toBeGreaterThan(0.5);
    expect(result.panels.every((p) => p.w > 0 && p.h > 0 && p.x + p.w <= 1 && p.y + p.h <= 1)).toBe(true);
  });

  it('ignores a narrow vertical note strip glued to the left edge (あらすじ regression)', () => {
    const result = detectPanels(sidebarNotePage(), 'page.png');
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0].x).toBeGreaterThan(0.05);
    expect(result.panels[0].w).toBeGreaterThan(0.5);
  });

  it('exposes a detector version so stale page JSON can be spotted', () => {
    expect(DETECTOR_VERSION).toMatch(/^xycut-/);
  });
});

describe('sortReadingOrder', () => {
  const rects = [
    { id: 'tl', x: 0.05, y: 0.05, w: 0.4, h: 0.4 },
    { id: 'tr', x: 0.55, y: 0.05, w: 0.4, h: 0.4 },
    { id: 'bl', x: 0.05, y: 0.55, w: 0.4, h: 0.4 },
    { id: 'br', x: 0.55, y: 0.55, w: 0.4, h: 0.4 },
  ];
  const ids = (sorted: typeof rects) => sorted.map((r) => r.id);

  it('orders rows top-to-bottom, panels right-to-left for rtl', () => {
    expect(ids(sortReadingOrder(rects, 'rtl'))).toEqual(['tr', 'tl', 'br', 'bl']);
  });

  it('orders panels left-to-right for ltr', () => {
    expect(ids(sortReadingOrder(rects, 'ltr'))).toEqual(['tl', 'tr', 'bl', 'br']);
  });

  it('orders columns right-to-left, panels top-to-bottom for ttb', () => {
    expect(ids(sortReadingOrder(rects, 'ttb'))).toEqual(['tr', 'br', 'tl', 'bl']);
  });

  it('treats explicit horizontal directions like their legacy aliases', () => {
    expect(ids(sortReadingOrder(rects, 'horizontal-rl'))).toEqual(['tr', 'tl', 'br', 'bl']);
    expect(ids(sortReadingOrder(rects, 'horizontal-lr'))).toEqual(['tl', 'tr', 'bl', 'br']);
  });

  it('orders columns for both vertical writing directions', () => {
    expect(ids(sortReadingOrder(rects, 'vertical-rl'))).toEqual(['tr', 'br', 'tl', 'bl']);
    expect(ids(sortReadingOrder(rects, 'vertical-lr'))).toEqual(['tl', 'bl', 'tr', 'br']);
  });

  it('reads a webtoon strip strictly by vertical position', () => {
    const strip = [
      { id: 'c', x: 0.05, y: 0.7, w: 0.9, h: 0.25 },
      { id: 'a', x: 0.05, y: 0.05, w: 0.4, h: 0.3 },
      { id: 'b', x: 0.55, y: 0.1, w: 0.4, h: 0.3 },
    ];
    expect(ids(sortReadingOrder(strip, 'continuous-vertical'))).toEqual(['a', 'b', 'c']);
  });

  it('accepts a custom rect accessor', () => {
    const wrapped = rects.map((rect) => ({ rect, label: rect.id }));
    expect(sortReadingOrder(wrapped, 'ltr', (item) => item.rect).map((item) => item.label)).toEqual([
      'tl',
      'tr',
      'bl',
      'br',
    ]);
  });
});
