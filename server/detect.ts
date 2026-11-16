import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { DetectResult, PanelRect, ReadingDirection } from '../shared/types.ts';
import { sortReadingOrder } from '../shared/panelOrder.ts';
import { AppError } from './errors.ts';
import { decodeWebpRgba } from './webp.ts';

type Gray = { width: number; height: number; data: Uint8Array };
export type RgbaImage = { width: number; height: number; data: Uint8Array | Buffer };

/** Detector version, written into every page JSON so stale results can be recognized after an algorithm upgrade. */
export const DETECTOR_VERSION = 'xycut-1.3';

/** Detect the real format from the file header (some assets named .png are actually JPEG). */
export function sniffFormat(buf: Buffer): 'png' | 'jpeg' | 'webp' | 'unknown' {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'webp';
  return 'unknown';
}

/** Read image dimensions cheaply: plugins only need width/height, so avoid decoding the whole image for it. */
export function imageSize(buf: Buffer, filename: string): { width: number; height: number } {
  const format = sniffFormat(buf);
  if (format === 'png' && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (format === 'webp') {
    const size = webpSize(buf);
    if (size) return size;
  }
  if (format === 'jpeg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15 (excluding DHT/DAC and similar segments).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  const decoded = decodeGray(buf, filename);
  return { width: decoded.width, height: decoded.height };
}

/** Read WebP dimensions from the VP8X/VP8/VP8L chunk header without decoding pixels. */
function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return {
      width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    };
  }
  if (kind === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return {
      width: (buf[26] | (buf[27] << 8)) & 0x3fff,
      height: (buf[28] | (buf[29] << 8)) & 0x3fff,
    };
  }
  if (kind === 'VP8L' && buf[20] === 0x2f) {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    return {
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  return null;
}

/** Decode an image to grayscale (RGBA -> luminance); throws on failure. */
export function decodeGray(buf: Buffer, filename: string): Gray {
  const { width, height, data: rgba } = decodeRgba(buf, filename);
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return { width, height, data: gray };
}

/** Decode an image to RGBA; throws on failure. Used where color sampling is required (mosaic redaction). */
export function decodeRgba(buf: Buffer, filename: string): RgbaImage {
  const ext = path.extname(filename).toLowerCase();
  const format = sniffFormat(buf);
  const effective = format === 'unknown' ? (ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg') : format;

  if (effective === 'webp') {
    const img = decodeWebpRgba(buf);
    return { width: img.width, height: img.height, data: img.data };
  }
  if (effective === 'png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (effective === 'jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: img.data as Uint8Array };
  }
  throw new AppError('ERR_UNSUPPORTED_IMAGE_FORMAT', { format, ext }, 415);
}

/** Downsample by an integer step; returns the reduced grayscale image and the scale factor. */
function downsample(src: Gray, maxDim: number): { gray: Gray; scale: number } {
  const step = Math.max(1, Math.ceil(Math.max(src.width, src.height) / maxDim));
  if (step === 1) return { gray: src, scale: 1 };
  const w = Math.floor(src.width / step);
  const h = Math.floor(src.height / step);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y * step;
    for (let x = 0; x < w; x++) {
      // Average 2x2 blocks to reduce sampling noise.
      const sx = x * step;
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < 2 && sy + dy < src.height; dy++) {
        for (let dx = 0; dx < 2 && sx + dx < src.width; dx++) {
          sum += src.data[(sy + dy) * src.width + sx + dx];
          n++;
        }
      }
      data[y * w + x] = sum / n;
    }
  }
  return { gray: { width: w, height: h, data }, scale: step };
}

/** Sample the luminance distribution to derive a "white paper" threshold adaptively. */
function whiteThreshold(gray: Gray): number {
  const hist = new Uint32Array(256);
  const total = gray.data.length;
  const stride = Math.max(1, Math.floor(total / 40000));
  let n = 0;
  for (let i = 0; i < total; i += stride) {
    hist[gray.data[i]]++;
    n++;
  }
  let acc = 0;
  let p95 = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc / n >= 0.05) {
      p95 = v;
      break;
    }
  }
  return Math.min(250, Math.max(170, p95 - 16));
}

type Region = { x0: number; y0: number; x1: number; y1: number };

/** Recursive XY-Cut: split on fully white rows/columns to obtain panel candidates. */
function xyCut(
  gray: Gray,
  isWhite: Uint8Array,
  integral: Uint32Array,
  iw: number,
  region: Region,
  out: Region[],
  depth = 0,
): void {
  const W = gray.width;
  const H = gray.height;

  const sum = (x0: number, y0: number, x1: number, y1: number) =>
    integral[y1 * iw + x1] - integral[y0 * iw + x1] - integral[y1 * iw + x0] + integral[y0 * iw + x0];

  // Whether a row/column is entirely white. A few scan specks are tolerated, otherwise one dirty pixel in a thin gutter would make the whole page unsplittable.
  const tolX = Math.max(4, Math.round((region.y1 - region.y0) * 0.03));
  const tolY = Math.max(4, Math.round((region.x1 - region.x0) * 0.03));
  const colWhite = (x: number, y0: number, y1: number) => sum(x, y0, x + 1, y1) >= y1 - y0 - tolX;
  const rowWhite = (y: number, x0: number, x1: number) => sum(x0, y, x1, y + 1) >= x1 - x0 - tolY;

  let { x0, y0, x1, y1 } = region;
  if (x1 - x0 < 8 || y1 - y0 < 8) return;

  // 1. Trim the fully white margin first (cap the trim ratio so the whole page is never eaten).
  const maxTrimX = Math.floor((x1 - x0) * 0.18);
  const maxTrimY = Math.floor((y1 - y0) * 0.18);
  let tx = 0;
  while (tx < maxTrimX && x0 + 1 < x1 && colWhite(x0, y0, y1)) {
    x0++;
    tx++;
  }
  tx = 0;
  while (tx < maxTrimX && x1 - 1 > x0 && colWhite(x1 - 1, y0, y1)) {
    x1--;
    tx++;
  }
  let ty = 0;
  while (ty < maxTrimY && y0 + 1 < y1 && rowWhite(y0, x0, x1)) {
    y0++;
    ty++;
  }
  ty = 0;
  while (ty < maxTrimY && y1 - 1 > y0 && rowWhite(y1 - 1, x0, x1)) {
    y1--;
    ty++;
  }
  if (x1 - x0 < 8 || y1 - y0 < 8) return;

  // 2. Find internal all-white gutters (often only 5-8px in the original, possibly 2px after downsampling).
  const minV = Math.max(3, Math.round(W * 0.004));
  const minH = Math.max(3, Math.round(H * 0.004));

  const vBands: [number, number][] = [];
  let start = -1;
  for (let x = x0; x < x1; x++) {
    const w = colWhite(x, y0, y1);
    if (w && start < 0) start = x;
    if ((!w || x === x1 - 1) && start >= 0) {
      const end = w ? x + 1 : x;
      if (end - start >= minV && start > x0 + 2 && end < x1 - 2) vBands.push([start, end]);
      start = -1;
    }
  }

  if (vBands.length > 0) {
    let cur = x0;
    for (const [s, e] of vBands) {
      xyCut(gray, isWhite, integral, iw, { x0: cur, y0, x1: s, y1 }, out, depth + 1);
      cur = e;
    }
    xyCut(gray, isWhite, integral, iw, { x0: cur, y0, x1, y1 }, out, depth + 1);
    return;
  }

  const hBands: [number, number][] = [];
  start = -1;
  for (let y = y0; y < y1; y++) {
    const w = rowWhite(y, x0, x1);
    if (w && start < 0) start = y;
    if ((!w || y === y1 - 1) && start >= 0) {
      const end = w ? y + 1 : y;
      if (end - start >= minH && start > y0 + 2 && end < y1 - 2) hBands.push([start, end]);
      start = -1;
    }
  }

  if (hBands.length > 0) {
    let cur = y0;
    for (const [s, e] of hBands) {
      xyCut(gray, isWhite, integral, iw, { x0, y0: cur, x1, y1: s }, out, depth + 1);
      cur = e;
    }
    xyCut(gray, isWhite, integral, iw, { x0, y0: cur, x1, y1 }, out, depth + 1);
    return;
  }

  // 3. Fallback: when a gutter is interrupted by a speech bubble spilling over it, cut on the panel's dark border lines instead. Require at least two parallel border lines, otherwise long lines in the artwork would be mistaken for borders.
  if (depth < 12) {
    const minRunX = Math.floor((x1 - x0) * 0.72);
    const minRunY = Math.floor((y1 - y0) * 0.72);
    const maxThickY = Math.max(2, Math.round((y1 - y0) * 0.014));
    const maxThickX = Math.max(2, Math.round((x1 - x0) * 0.014));

    const darkRowCuts = findLineCuts(gray, W, x0, x1, y0, y1, true, minRunX, maxThickY);
    if (darkRowCuts.length >= 2) {
      let cur = y0;
      for (const cut of darkRowCuts) {
        if (cut - cur > 6) xyCut(gray, isWhite, integral, iw, { x0, y0: cur, x1, y1: cut }, out, depth + 1);
        cur = cut;
      }
      if (y1 - cur > 6) xyCut(gray, isWhite, integral, iw, { x0, y0: cur, x1, y1 }, out, depth + 1);
      return;
    }
    const darkColCuts = findLineCuts(gray, W, x0, x1, y0, y1, false, minRunY, maxThickX);
    if (darkColCuts.length >= 2) {
      let cur = x0;
      for (const cut of darkColCuts) {
        if (cut - cur > 6) xyCut(gray, isWhite, integral, iw, { x0: cur, y0, x1: cut, y1 }, out, depth + 1);
        cur = cut;
      }
      if (x1 - cur > 6) xyCut(gray, isWhite, integral, iw, { x0: cur, y0, x1, y1 }, out, depth + 1);
      return;
    }
  }

  out.push({ x0, y0, x1, y1 });
}

/** Find thin, long dark lines (panel borders) inside a region and return the cut positions. */
function findLineCuts(
  gray: Gray,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  horizontal: boolean,
  minRun: number,
  maxThick: number,
): number[] {
  const dark = (x: number, y: number) => gray.data[y * W + x] < 130;
  const positions: number[] = [];
  const len = horizontal ? y1 - y0 : x1 - x0;
  const span = horizontal ? x1 - x0 : y1 - y0;
  for (let i = 0; i < len; i++) {
    let best = 0;
    let cur = 0;
    for (let j = 0; j < span; j++) {
      const x = horizontal ? x0 + j : x0 + i;
      const y = horizontal ? y0 + i : y0 + j;
      if (dark(x, y)) {
        cur++;
        if (cur > best) best = cur;
      } else cur = 0;
    }
    if (best >= minRun) positions.push(i);
  }
  // Merge consecutive rows into one line and take its centre; overly thick runs are not borders.
  const cuts: number[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0 && end - start + 1 <= maxThick && start > 2 && end < len - 3) {
      cuts.push(horizontal ? y0 + Math.round((start + end) / 2) : x0 + Math.round((start + end) / 2));
    }
    start = -1;
  };
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (start < 0) start = p;
    else if (p !== positions[i - 1] + 1) {
      flush(positions[i - 1]);
      start = p;
    }
  }
  if (start >= 0) flush(positions[positions.length - 1]);
  return cuts;
}

/** Detect the panels of one page and return normalized coordinates (relative to the page). */
export function detectPanels(buf: Buffer, filename: string, direction: ReadingDirection = 'rtl'): DetectResult {
  const t0 = Date.now();
  const full = decodeGray(buf, filename);
  const { gray, scale } = downsample(full, 1000);
  const W = gray.width;
  const H = gray.height;

  const threshold = whiteThreshold(gray);
  const isWhite = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) isWhite[i] = gray.data[i] >= threshold ? 1 : 0;

  // Integral image, sized (W+1)x(H+1).
  const iw = W + 1;
  const integral = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += isWhite[y * W + x];
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
    }
  }

  const regions: Region[] = [];
  xyCut(gray, isWhite, integral, iw, { x0: 0, y0: 0, x1: W, y1: H }, regions);

  // Filter out regions that are too small or contain almost no ink (pure white).
  const pageArea = W * H;
  const inkCount = (r: Region) => {
    let ink = 0;
    for (let y = r.y0; y < r.y1; y += 2) {
      for (let x = r.x0; x < r.x1; x += 2) {
        if (!isWhite[y * W + x]) ink++;
      }
    }
    return ink / Math.max(1, Math.ceil((r.y1 - r.y0) / 2) * Math.ceil((r.x1 - r.x0) / 2));
  };

  const kept = regions.filter((r) => {
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    if (area < pageArea * 0.006) return false;
    if (inkCount(r) < 0.004) return false;
    // Drop thin strips left by scan noise or decorative lines (real manga panels are never extremely flat bars).
    const rw = (r.x1 - r.x0) / W;
    const rh = (r.y1 - r.y0) / H;
    if (Math.min(rw, rh) < 0.035 && Math.max(rw, rh) / Math.min(rw, rh) > 4) return false;
    // Drop border-hugging vertical text strips such as "あらすじ" or author notes: narrow, tall,
    // flush with the left or right page edge and with a very high aspect ratio.
    // They recur across the 118-page sample (e.g. 173/p5, 176/p4, 179/p6, 181/p7, 182/p5) and are not manga panels.
    const edge = r.x0 / W < 0.035 || r.x1 / W > 0.965;
    if (edge && rw < 0.09 && rh > 0.18 && rh / rw >= 3.2) return false;
    return true;
  });

  // Normalize and expand slightly so panel borders are included.
  const pad = 0.002;
  const panels: PanelRect[] = kept.map((r) => {
    const x = Math.max(0, r.x0 / W - pad);
    const y = Math.max(0, r.y0 / H - pad);
    const w = Math.min(1 - x, (r.x1 - r.x0) / W + pad * 2);
    const h = Math.min(1 - y, (r.y1 - r.y0) / H + pad * 2);
    return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
  });

  return {
    width: full.width,
    height: full.height,
    panels: sortReadingOrder(panels, direction, (rect) => rect),
    meta: { scale, threshold, ms: Date.now() - t0 },
  };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Re-exported so existing callers keep importing the shared rule from one place. */
export { sortReadingOrder } from '../shared/panelOrder.ts';
