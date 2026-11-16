import type { AlignOffset, Lang, PageDoc, PageEntry, PanelRect } from '../types';
import { DEFAULT_OFFSET } from '../types';
import { api } from '../api';
import { langLabel, t } from '../i18n';
import type { MessageKey } from '../i18n';
import { applyGroupOrder, sortPanels } from './geometry';
import { composeAnnotatedPage } from './pngExport';

/**
 * Share images for feed platforms (Xiaohongshu / RED and friends).
 *
 * The platform shows 3:4 artwork without cropping, so fixed presets use a 3:4 canvas and
 * fill it with the artwork instead of adding white frames: close aspect ratios are
 * center-cropped, very different ones (a spread, a wide panel) keep every pixel and get a
 * blurred copy of themselves as the backdrop. Every canvas is sRGB, and the optional info
 * bar stays inside the bottom safe area.
 */
export type SharePresetId = 'cover' | 'cover-hd' | 'panel' | 'compare' | 'long';

export type SharePreset = {
  id: SharePresetId;
  width: number;
  /** Canvas height; for the long preset this is the maximum height of one slice. */
  height: number;
  format: 'jpeg' | 'png';
  /** JPEG quality (0–1); ignored for PNG. */
  quality?: number;
  label: MessageKey;
  desc: MessageKey;
};

export const SHARE_PRESETS: SharePreset[] = [
  {
    id: 'cover',
    width: 1080,
    height: 1440,
    format: 'jpeg',
    quality: 0.88,
    label: 'share.presetCover',
    desc: 'share.presetCoverDesc',
  },
  {
    id: 'cover-hd',
    width: 1242,
    height: 1656,
    format: 'jpeg',
    quality: 0.9,
    label: 'share.presetCoverHd',
    desc: 'share.presetCoverHdDesc',
  },
  {
    id: 'panel',
    width: 1080,
    height: 1440,
    format: 'jpeg',
    quality: 0.85,
    label: 'share.presetPanel',
    desc: 'share.presetPanelDesc',
  },
  {
    id: 'compare',
    width: 1080,
    height: 1440,
    format: 'png',
    label: 'share.presetCompare',
    desc: 'share.presetCompareDesc',
  },
  {
    id: 'long',
    width: 1080,
    height: 3240,
    format: 'jpeg',
    quality: 0.86,
    label: 'share.presetLong',
    desc: 'share.presetLongDesc',
  },
];

export const DEFAULT_SHARE_PRESET: SharePresetId = 'cover';

/** Height of the cover cut from the top of a long page; matches the 3:4 feed canvas. */
export const LONG_COVER_HEIGHT = 1440;

/** Keep text out of the top/bottom tenth the feed and the profile grid crop away. */
export const SHARE_SAFE_MARGIN = 0.12;

/** Hard limits advertised by Xiaohongshu: 18 images per post, 20 MB per image. */
export const SHARE_MAX_FILES = 18;
export const SHARE_MAX_BYTES = 20 * 1024 * 1024;

export function findSharePreset(id: string | null | undefined): SharePreset | null {
  if (!id) return null;
  return SHARE_PRESETS.find((preset) => preset.id === id) ?? null;
}

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Largest rect that covers the target, keeping the source aspect ratio (overflow is cropped). */
export function coverWithin(srcW: number, srcH: number, targetW: number, targetH: number, anchorTop = false): Rect {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.max(targetW / srcW, targetH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (targetW - w) / 2, y: anchorTop ? 0 : (targetH - h) / 2, w, h };
}

/** Largest rect that contains the whole source inside the target. */
export function containWithin(srcW: number, srcH: number, targetW: number, targetH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (targetW - w) / 2, y: (targetH - h) / 2, w, h };
}

/**
 * Crop when the source is within ~15% of the target ratio, otherwise keep the whole
 * artwork and fill the leftover area with a blurred backdrop. Avoids white frames while
 * never cutting half of a page spread away.
 */
export function chooseFit(srcW: number, srcH: number, targetW: number, targetH: number): 'cover' | 'contain' {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) return 'cover';
  const deviation = Math.abs(Math.log(srcW / srcH / (targetW / targetH)));
  return deviation <= 0.15 ? 'cover' : 'contain';
}

/** 3:4 tiles for the compare preset, packed as 1 column / 2 columns and centered. */
export function compareTiles(count: number, width: number, height: number, gap: number): Rect[] {
  const total = Math.max(0, Math.floor(count));
  if (!total) return [];
  const cols = Math.min(2, total);
  const rows = Math.ceil(total / cols);
  const availW = width - gap * (cols + 1);
  const availH = height - gap * (rows + 1);
  const tileW = Math.max(1, Math.min(availW / cols, (availH / rows) * 0.75));
  const tileH = tileW * (4 / 3);
  const blockH = rows * tileH + (rows - 1) * gap;
  const startY = (height - blockH) / 2;

  const tiles: Rect[] = [];
  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(cols, total - row * cols);
    const rowW = inRow * tileW + (inRow - 1) * gap;
    const startX = (width - rowW) / 2;
    for (let col = 0; col < inRow; col++) {
      tiles.push({ x: startX + col * (tileW + gap), y: startY + row * (tileH + gap), w: tileW, h: tileH });
    }
  }
  return tiles;
}

/** Slice a width-scaled page into top-to-bottom strips no taller than `maxSlice`. */
export function longLayout(
  srcW: number,
  srcH: number,
  width: number,
  maxSlice: number,
): { scaledHeight: number; slices: { top: number; height: number }[] } {
  if (srcW <= 0 || srcH <= 0 || width <= 0 || maxSlice <= 0) return { scaledHeight: 0, slices: [] };
  const scaledHeight = Math.max(1, Math.round((srcH / srcW) * width));
  const slices: { top: number; height: number }[] = [];
  for (let top = 0; top < scaledHeight; top += maxSlice) {
    slices.push({ top, height: Math.min(maxSlice, scaledHeight - top) });
  }
  return { scaledHeight, slices };
}

/** Caption background inside the bottom safe area (bottom edge at 88% of the canvas). */
export function infoBarRect(width: number, height: number): Rect {
  const margin = Math.round(width * 0.06);
  const barH = Math.max(18, Math.round(height * 0.052));
  const bottom = Math.round(height * (1 - SHARE_SAFE_MARGIN));
  return { x: margin, y: bottom - barH, w: Math.max(1, width - margin * 2), h: barH };
}

/** Panel rect after the page and per-panel alignment offsets, matching the compare view. */
export function effectivePanelRect(rect: PanelRect, pageOffset?: AlignOffset, panelOffset?: AlignOffset): PanelRect {
  const base = pageOffset ?? DEFAULT_OFFSET;
  const x = base.x + (panelOffset?.x ?? 0);
  const y = base.y + (panelOffset?.y ?? 0);
  const scale = (base.scale || 1) * (panelOffset?.scale ?? 1);
  const w = Math.min(1, rect.w / (scale > 0 ? scale : 1));
  const h = Math.min(1, rect.h / (scale > 0 ? scale : 1));
  let px = rect.x + x * rect.w + (rect.w - w) / 2;
  let py = rect.y + y * rect.h + (rect.h - h) / 2;
  px = Math.min(1 - w, Math.max(0, px));
  py = Math.min(1 - h, Math.max(0, py));
  return { x: px, y: py, w, h };
}

export type SharePageInput = { page: PageEntry; doc: PageDoc | null };

export type ShareExportInput = {
  preset: SharePreset;
  /** `compare` packs every selected language into one canvas; `single` uses `lang`. */
  mode: 'single' | 'compare';
  lang: Lang;
  languages: Lang[];
  pages: SharePageInput[];
  infoBar: boolean;
  includeAnnotations: boolean;
  /** Folder under the project exports directory, for example `share-vol14-172-20261116-1530`. */
  dir: string;
  onProgress?: (done: number, total: number) => void;
};

export type ShareFile = {
  name: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
  kind: 'cover' | 'panel' | 'compare' | 'long' | 'long-cover';
};

export type ShareExportResult = { dir: string; files: ShareFile[]; warnings: string[] };

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** 2D context pinned to sRGB, which is what JPEG viewers and the platform assume. */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const settings = { colorSpace: 'srgb' } as CanvasRenderingContext2DSettings;
  const ctx = canvas.getContext('2d', settings) ?? canvas.getContext('2d');
  if (!ctx) throw new Error(t('share.canvasFailed'));
  return ctx;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawInfoBar(ctx: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  if (!text) return;
  const bar = infoBarRect(width, height);
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = '#000';
  roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, bar.h / 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(bar.h * 0.44)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(text, bar.x + bar.w / 2, bar.y + bar.h / 2, bar.w - bar.h);
  ctx.restore();
}

/**
 * Draw the artwork into `target`. `cover` crops the overflow; `contain` keeps the whole
 * artwork and fills the remaining area with a blurred, darkened copy of itself.
 */
function drawArtwork(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  target: Rect,
  anchorTop = false,
  forceCover = false,
): void {
  const fit = forceCover ? 'cover' : chooseFit(srcW, srcH, target.w, target.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(target.x, target.y, target.w, target.h);
  ctx.clip();

  if (fit === 'cover') {
    const rect = coverWithin(srcW, srcH, target.w, target.h, anchorTop);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, target.x + rect.x, target.y + rect.y, rect.w, rect.h);
  } else {
    const back = coverWithin(srcW, srcH, target.w, target.h);
    ctx.save();
    ctx.filter = 'blur(24px) brightness(0.62)';
    ctx.drawImage(source, target.x + back.x - 12, target.y + back.y - 12, back.w + 24, back.h + 24);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(target.x, target.y, target.w, target.h);
    const front = containWithin(srcW, srcH, target.w, target.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, target.x + front.x, target.y + front.y, front.w, front.h);
  }
  ctx.restore();
}

/** Compose one language version of a page (annotations baked in unless disabled). */
async function composeArt(
  page: PageEntry,
  lang: Lang,
  doc: PageDoc | null,
  includeAnnotations: boolean,
): Promise<HTMLCanvasElement | null> {
  const annotations = includeAnnotations && doc && doc.annotationsVisible !== false ? (doc.annotations ?? []) : [];
  return composeAnnotatedPage(page, lang, annotations, doc?.panels ?? []);
}

function renderFixed(
  art: HTMLCanvasElement,
  preset: SharePreset,
  info: string,
  anchorTop = false,
  forceCover = false,
): HTMLCanvasElement {
  const canvas = createCanvas(preset.width, preset.height);
  const ctx = context2d(canvas);
  // Only visible through transparent artwork; never used to pad a mismatched ratio.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawArtwork(
    ctx,
    art,
    art.width,
    art.height,
    { x: 0, y: 0, w: canvas.width, h: canvas.height },
    anchorTop,
    forceCover,
  );
  if (info) drawInfoBar(ctx, canvas.width, canvas.height, info);
  return canvas;
}

function renderCompare(
  arts: { lang: Lang; canvas: HTMLCanvasElement }[],
  preset: SharePreset,
  info: string,
): HTMLCanvasElement {
  const canvas = createCanvas(preset.width, preset.height);
  const ctx = context2d(canvas);
  const first = arts[0];
  if (first) {
    // The artwork itself becomes the backdrop, so a 1–2 tile grid never shows white bars.
    ctx.save();
    ctx.filter = 'blur(32px) brightness(0.45)';
    const back = coverWithin(first.canvas.width, first.canvas.height, canvas.width, canvas.height);
    ctx.drawImage(first.canvas, back.x - 24, back.y - 24, back.w + 48, back.h + 48);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const gap = Math.round(preset.width * 0.012);
  const tiles = compareTiles(arts.length, preset.width, preset.height, gap);
  arts.forEach((art, i) => {
    const tile = tiles[i];
    if (!tile) return;
    drawArtwork(ctx, art.canvas, art.canvas.width, art.canvas.height, tile);
  });
  if (info) drawInfoBar(ctx, canvas.width, canvas.height, info);
  return canvas;
}

function renderPanel(
  art: HTMLCanvasElement,
  rect: PanelRect,
  preset: SharePreset,
  info: string,
): HTMLCanvasElement | null {
  const W = art.width;
  const H = art.height;
  const sx = Math.max(0, Math.min(W - 1, Math.round(rect.x * W)));
  const sy = Math.max(0, Math.min(H - 1, Math.round(rect.y * H)));
  const sw = Math.max(1, Math.min(W - sx, Math.round(rect.w * W)));
  const sh = Math.max(1, Math.min(H - sy, Math.round(rect.h * H)));
  const region = createCanvas(sw, sh);
  context2d(region).drawImage(art, sx, sy, sw, sh, 0, 0, sw, sh);
  const canvas = renderFixed(region, preset, info);
  region.width = 0;
  region.height = 0;
  return canvas;
}

function renderLong(
  art: HTMLCanvasElement,
  preset: SharePreset,
  info: string,
): { canvas: HTMLCanvasElement; kind: ShareFile['kind'] }[] {
  const layout = longLayout(art.width, art.height, preset.width, preset.height);
  if (!layout.slices.length) return [];
  const scale = preset.width / art.width;
  const outputs: { canvas: HTMLCanvasElement; kind: ShareFile['kind'] }[] = [];

  // A genuinely long page gets a separate 1080×1440 top cover; a normal page needs none.
  if (layout.scaledHeight > LONG_COVER_HEIGHT) {
    outputs.push({
      canvas: renderFixed(art, { ...preset, height: LONG_COVER_HEIGHT, format: 'jpeg' }, info, true, true),
      kind: 'long-cover',
    });
  }

  layout.slices.forEach((slice, index) => {
    const canvas = createCanvas(preset.width, slice.height);
    const ctx = context2d(canvas);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sy = Math.min(art.height - 1, slice.top / scale);
    const sh = Math.min(art.height - sy, slice.height / scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art, 0, sy, art.width, sh, 0, 0, canvas.width, canvas.height);
    if (info) drawInfoBar(ctx, canvas.width, canvas.height, `${info} · ${index + 1}/${layout.slices.length}`);
    outputs.push({ canvas, kind: 'long' });
  });
  return outputs;
}

function canvasToBlob(canvas: HTMLCanvasElement, format: SharePreset['format'], quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(t('share.encodeFailed')));
      },
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'png' ? undefined : (quality ?? 0.88),
    );
  });
}

const pad = (n: number, size: number) => String(n).padStart(size, '0');

/** Filename-safe language tag (custom language folders may contain any characters). */
const slug = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_') || 'lang';

function infoFor(parts: (string | number)[]): string {
  return parts.filter((part) => String(part).length > 0).join(' · ');
}

type Output = { name: string; canvas: HTMLCanvasElement; kind: ShareFile['kind'] };

/** Render every requested page and write the images into `<exports>/<dir>`. */
export async function exportShareImages(input: ShareExportInput): Promise<ShareExportResult> {
  const { preset, mode, lang, languages, pages, infoBar, includeAnnotations, dir, onProgress } = input;
  const warnings: string[] = [];
  const files: ShareFile[] = [];
  const total = pages.length;
  let done = 0;

  for (const item of pages) {
    const pageNo = item.page.index + 1;
    const wanted = mode === 'compare' ? languages : [lang];
    const available = wanted.filter((tag) => Boolean(item.page.files[tag]));
    if (!available.length) {
      warnings.push(t('share.warnNoImage', { page: pageNo }));
      done++;
      onProgress?.(done, total);
      continue;
    }

    const arts: { lang: Lang; canvas: HTMLCanvasElement }[] = [];
    for (const tag of available) {
      const canvas = await composeArt(item.page, tag, item.doc, includeAnnotations);
      if (canvas) arts.push({ lang: tag, canvas });
    }
    if (!arts.length) {
      warnings.push(t('share.warnNoImage', { page: pageNo }));
      done++;
      onProgress?.(done, total);
      continue;
    }

    const labels = available.map((tag) => langLabel(tag));
    const outputs: Output[] = [];
    const pagePart = `p${pad(pageNo, 3)}`;

    if (preset.id === 'compare') {
      const canvas = renderCompare(arts, preset, infoBar ? infoFor([`P${pageNo}`, labels.join(' / ')]) : '');
      outputs.push({ name: `${pagePart}-compare.png`, canvas, kind: 'compare' });
    } else if (preset.id === 'panel') {
      const panels = item.doc
        ? applyGroupOrder(sortPanels(item.doc.panels, item.doc.readingDirection), item.doc.groups)
        : [];
      if (!panels.length) {
        warnings.push(t('share.warnNoPanels', { page: pageNo }));
      }
      panels.forEach((panel, index) => {
        const art = arts[0];
        if (!art) return;
        const rect = effectivePanelRect(
          panel.rect,
          item.doc?.offsets[art.lang],
          item.doc?.panelOffsets?.[panel.id]?.[art.lang],
        );
        const info = infoBar ? infoFor([`P${pageNo}`, langLabel(art.lang), `#${index + 1}`]) : '';
        const canvas = renderPanel(art.canvas, rect, preset, info);
        if (canvas) {
          outputs.push({ name: `${pagePart}-${slug(art.lang)}-p${pad(index + 1, 2)}.jpg`, canvas, kind: 'panel' });
        }
      });
    } else if (preset.id === 'long') {
      const art = arts[0];
      if (art) {
        const info = infoBar ? infoFor([`P${pageNo}`, langLabel(art.lang)]) : '';
        let sliceNo = 0;
        renderLong(art.canvas, preset, info).forEach(({ canvas, kind }) => {
          if (kind === 'long-cover') {
            outputs.push({ name: `${pagePart}-${slug(art.lang)}-cover.jpg`, canvas, kind });
            return;
          }
          sliceNo += 1;
          outputs.push({ name: `${pagePart}-${slug(art.lang)}-long-${pad(sliceNo, 2)}.jpg`, canvas, kind });
        });
      }
    } else {
      const art = arts[0];
      if (art) {
        const info = infoBar ? infoFor([`P${pageNo}`, langLabel(art.lang)]) : '';
        const suffix = preset.id === 'cover-hd' ? 'cover-hd' : 'cover';
        outputs.push({
          name: `${pagePart}-${slug(art.lang)}-${suffix}.jpg`,
          // Covers always fill the frame; shrinking a long page to fit would be unreadable.
          canvas: renderFixed(art.canvas, preset, info, false, true),
          kind: 'cover',
        });
      }
    }

    for (const output of outputs) {
      try {
        const blob = await canvasToBlob(output.canvas, preset.format, preset.quality);
        if (blob.size > SHARE_MAX_BYTES) {
          warnings.push(t('share.warnFileTooLarge', { name: output.name, size: Math.round(blob.size / 1024 / 1024) }));
        }
        const saved = await api.saveShareImage({ dir, name: output.name, data: blob });
        files.push({
          name: output.name,
          url: saved.url,
          bytes: saved.bytes,
          width: output.canvas.width,
          height: output.canvas.height,
          kind: output.kind,
        });
      } finally {
        output.canvas.width = 0;
        output.canvas.height = 0;
      }
    }

    for (const art of arts) {
      art.canvas.width = 0;
      art.canvas.height = 0;
    }
    done++;
    onProgress?.(done, total);
  }

  if (!files.length) throw new Error(t('share.nothing'));
  if (files.length > SHARE_MAX_FILES) warnings.push(t('share.warnTooMany', { count: files.length }));
  return { dir, files, warnings };
}
