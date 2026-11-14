import type { Lang, PageEntry, PanelRect } from '../types';
import { LANG_LABEL } from '../types';

export type PngMode = 'page' | 'panel' | 'collage';

export type PngExportOptions = {
  page: PageEntry;
  /** 单页/单格导出使用的语言 */
  lang: Lang;
  /** 拼图使用的语言列表（按顺序） */
  langs: Lang[];
  /** 格子矩形，传入则裁切该格 */
  rect?: PanelRect | null;
  mode: PngMode;
  /** 文件名前缀，例如 `点兔第14卷-172-P1` */
  filenameBase: string;
};

/** 拼图布局常量（缩放前的逻辑像素） */
const PAD = 32;
const GAP = 32;
const LABEL_H = 48;
const PAGE_HEIGHT = 1600;
const PANEL_HEIGHT = 1200;
const MAX_WIDTH = 4200;

type CropRect = { sx: number; sy: number; sw: number; sh: number };

/** 加载图片（同源地址无需 crossOrigin） */
function loadImage(src: string, lang: Lang): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`加载${LANG_LABEL[lang]}图片失败：${src}`));
    img.src = src;
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 把归一化矩形换算成原图裁切像素，四舍五入并限制在图片范围内 */
function cropRect(img: HTMLImageElement, rect?: PanelRect | null): CropRect {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!rect) return { sx: 0, sy: 0, sw: W, sh: H };
  const sx = clamp(Math.round(rect.x * W), 0, Math.max(0, W - 1));
  const sy = clamp(Math.round(rect.y * H), 0, Math.max(0, H - 1));
  const sw = clamp(Math.round(rect.w * W), 1, W - sx);
  const sh = clamp(Math.round(rect.h * H), 1, H - sy);
  return { sx, sy, sw, sh };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');
  return ctx;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('导出 PNG 失败：canvas.toBlob 返回空'));
    }, 'image/png');
  });
}

/** 通过临时 anchor 触发下载，用完立即移除 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟释放，避免个别浏览器取消下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderPage(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = createCanvas(img.naturalWidth, img.naturalHeight);
  get2d(canvas).drawImage(img, 0, 0);
  return canvas;
}

function renderPanel(img: HTMLImageElement, rect: PanelRect): HTMLCanvasElement {
  const crop = cropRect(img, rect);
  const canvas = createCanvas(crop.sw, crop.sh);
  get2d(canvas).drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
  return canvas;
}

async function renderCollage(
  page: PageEntry,
  langs: Lang[],
  rect?: PanelRect | null,
): Promise<HTMLCanvasElement> {
  const jobs = langs.flatMap((lang) => {
    const src = page.files[lang];
    return src ? [{ lang, src }] : [];
  });
  if (jobs.length === 0) throw new Error('没有可导出的图片');

  const items = await Promise.all(
    jobs.map(async ({ lang, src }) => {
      const img = await loadImage(src, lang);
      return { lang, img, crop: cropRect(img, rect) };
    }),
  );

  const targetH = rect ? PANEL_HEIGHT : PAGE_HEIGHT;
  const widths = items.map((it) =>
    Math.max(1, Math.round((it.crop.sw / it.crop.sh) * targetH)),
  );
  const contentW = widths.reduce((sum, w) => sum + w, 0) + GAP * (items.length - 1);
  const totalW = PAD * 2 + contentW;
  const totalH = PAD * 2 + targetH + LABEL_H;
  // 总宽超限时整体等比缩小
  const scale = totalW > MAX_WIDTH ? MAX_WIDTH / totalW : 1;

  const canvas = createCanvas(Math.round(totalW * scale), Math.round(totalH * scale));
  const ctx = get2d(canvas);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, totalW, totalH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '24px system-ui, sans-serif';

  let x = PAD;
  items.forEach((it, i) => {
    const w = widths[i];
    ctx.drawImage(it.img, it.crop.sx, it.crop.sy, it.crop.sw, it.crop.sh, x, PAD, w, targetH);
    // 底部标签带
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(x, PAD + targetH, w, LABEL_H);
    ctx.fillStyle = '#000';
    ctx.fillText(LANG_LABEL[it.lang], x + w / 2, PAD + targetH + LABEL_H / 2);
    x += w + GAP;
  });

  return canvas;
}

/** 导出并触发浏览器下载，出错时 reject(Error) */
export async function exportPng(opts: PngExportOptions): Promise<void> {
  const { page, lang, langs, rect, mode, filenameBase } = opts;
  let canvas: HTMLCanvasElement;

  if (mode === 'collage') {
    canvas = await renderCollage(page, langs, rect);
  } else {
    const src = page.files[lang];
    if (!src) throw new Error(`缺少${LANG_LABEL[lang]}图片，无法导出`);
    const img = await loadImage(src, lang);
    if (mode === 'panel') {
      if (!rect) throw new Error('格子导出需要提供 rect');
      canvas = renderPanel(img, rect);
    } else {
      canvas = renderPage(img);
    }
  }

  try {
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, `${filenameBase}-${mode}.png`);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
