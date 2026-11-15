import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Synthetic, tiny fixtures.
 *
 * The repository never ships real manga pages (they are copyrighted and large), so
 * tests draw their own pages in memory: white paper, black gutters, grey panel fills.
 * Every buffer here is a few KB and is written to a temp directory by the caller.
 */

export type Rect = { x: number; y: number; w: number; h: number };

const WHITE = 255;

export function createCanvas(width: number, height: number, fill = WHITE): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = fill;
    png.data[i + 1] = fill;
    png.data[i + 2] = fill;
    png.data[i + 3] = 255;
  }
  return png;
}

export function paintRect(png: PNG, rect: Rect, gray: number): void {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(png.width, Math.round(rect.x + rect.w));
  const y1 = Math.min(png.height, Math.round(rect.y + rect.h));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * png.width + x) * 4;
      png.data[p] = gray;
      png.data[p + 1] = gray;
      png.data[p + 2] = gray;
      png.data[p + 3] = 255;
    }
  }
}

/** A panel with a dark border and a lighter interior, like an inked manga cell. */
export function fillPanel(png: PNG, rect: Rect, interior = 210, thickness = 4): void {
  paintRect(png, rect, 0);
  paintRect(
    png,
    { x: rect.x + thickness, y: rect.y + thickness, w: rect.w - thickness * 2, h: rect.h - thickness * 2 },
    interior,
  );
}

export function encodePng(png: PNG): Buffer {
  return PNG.sync.write(png);
}

export function solidPng(width: number, height: number, gray = WHITE): Buffer {
  return encodePng(createCanvas(width, height, gray));
}

/**
 * 600×840 page with two panels on top and one wide panel below.
 * Reading order for RTL should be: top-right, top-left, bottom.
 */
export function threePanelPage(): Buffer {
  const png = createCanvas(600, 840);
  fillPanel(png, { x: 20, y: 20, w: 270, h: 390 }, 215);
  fillPanel(png, { x: 310, y: 20, w: 270, h: 390 }, 205);
  fillPanel(png, { x: 20, y: 430, w: 560, h: 390 }, 195);
  return encodePng(png);
}

/**
 * Page with a normal panel plus a narrow, tall note strip glued to the left edge —
 * the `あらすじ` pattern that must not be detected as a manga panel.
 */
export function sidebarNotePage(): Buffer {
  const png = createCanvas(600, 840);
  paintRect(png, { x: 0, y: 100, w: 30, h: 640 }, 30);
  fillPanel(png, { x: 60, y: 60, w: 500, h: 740 }, 220);
  return encodePng(png);
}

/** Minimal valid JPEG, used for format sniffing and dimension parsing. */
export function solidJpeg(width: number, height: number, gray = 200): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 80).data;
}
