import type { Note, NoteSource, Panel, PanelRect, ReadingDirection } from '../types';

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function normalizeRect(rect: PanelRect): PanelRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const w = Math.min(1 - x, Math.max(0.02, rect.w));
  const h = Math.min(1 - y, Math.max(0.02, rect.h));
  return { x, y, w, h };
}

/** 鼠标位置换算成页面归一化坐标 */
export function pointToNorm(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return {
    x: clamp01((clientX - r.left) / r.width),
    y: clamp01((clientY - r.top) / r.height),
  };
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

export function applyDrag(
  start: PanelRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  minSize = 0.02,
): PanelRect {
  let { x, y, w, h } = start;
  if (handle === 'move') {
    x = Math.min(1 - w, Math.max(0, x + dx));
    y = Math.min(1 - h, Math.max(0, y + dy));
    return { x, y, w, h };
  }
  if (handle.includes('w')) {
    const nx = Math.min(x + w - minSize, Math.max(0, x + dx));
    w += x - nx;
    x = nx;
  }
  if (handle.includes('e')) {
    w = Math.min(1 - x, Math.max(minSize, w + dx));
  }
  if (handle.includes('n')) {
    const ny = Math.min(y + h - minSize, Math.max(0, y + dy));
    h += y - ny;
    y = ny;
  }
  if (handle.includes('s')) {
    h = Math.min(1 - y, Math.max(minSize, h + dy));
  }
  return { x, y, w, h };
}

export function unionRects(rects: PanelRect[]): PanelRect {
  if (!rects.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 与服务器端一致的阅读顺序：rtl 行内右→左；ltr 行内左→右；ttb 列从右→左、列内上→下 */
export function sortPanels(panels: Panel[], dir: ReadingDirection): Panel[] {
  if (panels.length < 2) return panels;
  if (dir === 'ttb') {
    const mw = median(panels.map((p) => p.rect.w)) || 0.2;
    const cols: Panel[][] = [];
    for (const p of [...panels].sort((a, b) => b.rect.x + b.rect.w / 2 - (a.rect.x + a.rect.w / 2))) {
      const cx = p.rect.x + p.rect.w / 2;
      const group = cols.find((g) => Math.abs(g[0].rect.x + g[0].rect.w / 2 - cx) < mw * 0.6);
      if (group) group.push(p);
      else cols.push([p]);
    }
    return cols.flatMap((g) => [...g].sort((a, b) => a.rect.y - b.rect.y));
  }
  const mh = median(panels.map((p) => p.rect.h)) || 0.2;
  const rows: Panel[][] = [];
  for (const p of [...panels].sort((a, b) => a.rect.y + a.rect.h / 2 - (b.rect.y + b.rect.h / 2))) {
    const cy = p.rect.y + p.rect.h / 2;
    const group = rows.find((g) => Math.abs(g[0].rect.y + g[0].rect.h / 2 - cy) < mh * 0.6);
    if (group) group.push(p);
    else rows.push([p]);
  }
  return rows.flatMap((g) =>
    [...g].sort((a, b) => (dir === 'rtl' ? b.rect.x - a.rect.x : a.rect.x - b.rect.x)),
  );
}

export const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newNote(
  scope: 'page' | 'panel',
  panelId: string | null,
  text: string,
  tags: string[],
  source?: NoteSource,
): Note {
  const now = new Date().toISOString();
  return { id: uid('n'), scope, panelId, text, tags, source, createdAt: now, updatedAt: now };
}

/** 从链接中取域名，用于快速区分资料来源 */
export function sourceDomain(source?: NoteSource): string {
  if (!source?.url) return source?.text?.slice(0, 24) ?? '';
  try {
    return new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    return source.url.slice(0, 24);
  }
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
