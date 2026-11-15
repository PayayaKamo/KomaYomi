import { mosaicBlockSize } from '../../shared/mosaic';
import type { PanelRect } from '../types';

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const patchCache = new Map<string, string>();
const PATCH_CACHE_LIMIT = 80;

function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(src);
  if (hit) return hit;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed to load: ${src}`));
    img.src = src;
  });
  imageCache.set(src, pending);
  return pending;
}

/** Page-space region covered by a mosaic drag (two corners inside the owning scope). */
export function mosaicRegion(scope: PanelRect, points: { x: number; y: number }[]): PanelRect {
  if (!points.length) return { x: scope.x, y: scope.y, w: 0, h: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return {
    x: scope.x + x0 * scope.w,
    y: scope.y + y0 * scope.h,
    w: (Math.max(...xs) - x0) * scope.w,
    h: (Math.max(...ys) - y0) * scope.h,
  };
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

/**
 * Real pixelation of a page region, as a data URL.
 * The editor and the read-only compare layer reuse the same sampling as the PNG export,
 * instead of the old frosted-glass CSS backdrop.
 */
export async function mosaicPatchUrl(src: string, region: PanelRect): Promise<string | null> {
  const key = `${src}|${region.x.toFixed(4)},${region.y.toFixed(4)},${region.w.toFixed(4)},${region.h.toFixed(4)}`;
  const cached = patchCache.get(key);
  if (cached) return cached;

  const img = await loadImage(src);
  const pageW = img.naturalWidth || img.width;
  const pageH = img.naturalHeight || img.height;
  if (!pageW || !pageH) return null;
  const sx = Math.min(pageW, Math.max(0, region.x * pageW));
  const sy = Math.min(pageH, Math.max(0, region.y * pageH));
  const sw = Math.min(pageW - sx, region.w * pageW);
  const sh = Math.min(pageH - sy, region.h * pageH);
  if (sw < 1 || sh < 1) return null;

  const block = mosaicBlockSize(sw, sh);
  const small = canvasOf(Math.floor(sw / block), Math.floor(sh / block));
  small.getContext('2d')?.drawImage(img, sx, sy, sw, sh, 0, 0, small.width, small.height);
  const out = canvasOf(small.width * block, small.height * block);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, out.width, out.height);

  const url = out.toDataURL('image/png');
  if (patchCache.size >= PATCH_CACHE_LIMIT) {
    const oldest = patchCache.keys().next().value;
    if (oldest) patchCache.delete(oldest);
  }
  patchCache.set(key, url);
  return url;
}
