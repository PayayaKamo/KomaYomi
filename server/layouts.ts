import fs from 'node:fs';
import path from 'node:path';
import type { LayoutTemplate, PanelRect } from '../shared/types.ts';
import { preserveUnknown } from '../shared/format.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';
import { assertWritableFile, readRawRecord, readStoredFile, writeStoredFile } from './schemaStore.ts';

/**
 * Declarative layout templates live in `data/layouts/*.json`.
 * A template is bound to a volume / chapter / single page and has higher
 * priority than automatic detection. Keeping them as readable JSON files lets
 * users version-control their layouts or hand-edit them.
 */

const DEFAULT_MARGIN = { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 };
const DEFAULT_GAP = 0.012;

const layoutDir = (dataRoot: string) => path.join(dataRoot, 'layouts');

const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

const uid = () => `lay${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function normalizeLayout(input: Partial<LayoutTemplate>): LayoutTemplate | null {
  if (!input || typeof input !== 'object') return null;
  const grid = input.grid;
  if (!grid || !Array.isArray(grid.rows) || !grid.rows.length) return null;
  const cols = Math.max(1, Math.min(12, Number(grid.cols) || 1));
  return {
    id: input.id || uid(),
    name: (input.name ?? '').trim() || t('DEFAULT_NAME_LAYOUT'),
    scope: input.scope === 'chapter' || input.scope === 'page' ? input.scope : 'volume',
    volume: String(input.volume ?? ''),
    chapter: input.chapter ? String(input.chapter) : undefined,
    pageIndex: Number.isInteger(input.pageIndex) ? Number(input.pageIndex) : undefined,
    readingDirection:
      input.readingDirection === 'ltr' || input.readingDirection === 'ttb' ? input.readingDirection : 'rtl',
    margin: { ...DEFAULT_MARGIN, ...(input.margin ?? {}) },
    gap: Math.min(0.08, Math.max(0, Number(input.gap ?? DEFAULT_GAP))),
    colWeights: Array.isArray(input.colWeights)
      ? input.colWeights.map((n) => Math.max(0.01, Number(n) || 1))
      : undefined,
    grid: {
      cols,
      rows: grid.rows.map((r) => ({
        height: Math.max(0.01, Number(r?.height) || 1),
        cells:
          Array.isArray(r?.cells) && r.cells.length
            ? r.cells.map((c) => ({ span: Math.max(1, Number(c?.span) || 1) }))
            : [{ span: cols }],
      })),
    },
    pageOverrides: input.pageOverrides ?? undefined,
    createdAt: input.createdAt ?? new Date().toISOString(),
    notes: input.notes ? String(input.notes) : undefined,
  };
}

export function listLayouts(dataRoot: string): LayoutTemplate[] {
  const dir = layoutDir(dataRoot);
  if (!fs.existsSync(dir)) return [];
  const out: LayoutTemplate[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const stored = readStoredFile<Partial<LayoutTemplate>>(path.join(dir, file), 'mnlayout');
      if (!stored) continue;
      const layout = normalizeLayout(stored.data);
      if (layout) out.push(layout);
    } catch {
      /* Ignore a single broken file so the rest of the library keeps working. */
    }
  }
  return out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export function readLayout(dataRoot: string, id: string): LayoutTemplate | null {
  const file = path.join(layoutDir(dataRoot), `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const stored = readStoredFile<Partial<LayoutTemplate>>(file, 'mnlayout');
    return stored ? normalizeLayout(stored.data) : null;
  } catch {
    return null;
  }
}

export function saveLayout(dataRoot: string, input: Partial<LayoutTemplate>): LayoutTemplate {
  const layout = normalizeLayout(input);
  if (!layout) throw new AppError('ERR_LAYOUT_SAVE_INVALID', {}, 400);
  const file = path.join(layoutDir(dataRoot), `${path.basename(layout.id)}.json`);
  assertWritableFile(file, 'mnlayout');
  // Unknown keys written by a newer build survive this save.
  writeStoredFile(file, 'mnlayout', preserveUnknown(readRawRecord(file), layout));
  return layout;
}

export function deleteLayout(dataRoot: string, id: string): boolean {
  const file = path.join(layoutDir(dataRoot), `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/** Pick the most specific template: page > chapter > volume. */
export function resolveLayout(
  dataRoot: string,
  volume: string,
  chapter: string,
  pageIndex: number,
): LayoutTemplate | null {
  const all = listLayouts(dataRoot).filter((l) => l.volume === volume);
  const page = all.find((l) => l.scope === 'page' && l.chapter === chapter && l.pageIndex === pageIndex);
  if (page) return page;
  const chapterLayout = all.find((l) => l.scope === 'chapter' && l.chapter === chapter);
  if (chapterLayout) return chapterLayout;
  return all.find((l) => l.scope === 'volume') ?? null;
}

/** Apply per-page overrides (1-based page keys) before expanding. */
function withPageOverride(layout: LayoutTemplate, pageIndex: number): LayoutTemplate {
  const override = layout.pageOverrides?.[String(pageIndex + 1)];
  if (!override) return layout;
  return {
    ...layout,
    grid: override.grid ?? layout.grid,
    margin: { ...DEFAULT_MARGIN, ...(layout.margin ?? {}), ...(override.margin ?? {}) },
    gap: override.gap ?? layout.gap,
    colWeights: override.colWeights ?? layout.colWeights,
  };
}

/**
 * Turn a row/column description into normalized panel rectangles.
 * Rows are laid out top-to-bottom; cells follow the reading order inside a row.
 */
export function expandLayout(layout: LayoutTemplate, pageIndex: number): PanelRect[] {
  const l = withPageOverride(layout, pageIndex);
  const margin = { ...DEFAULT_MARGIN, ...(l.margin ?? {}) };
  const gap = l.gap ?? DEFAULT_GAP;
  const cols = l.grid.cols;
  const rows = l.grid.rows;

  const weights = l.colWeights && l.colWeights.length === cols ? l.colWeights : Array.from({ length: cols }, () => 1);
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  const contentW = Math.max(0.01, 1 - margin.left - margin.right);
  const contentH = Math.max(0.01, 1 - margin.top - margin.bottom);
  const availW = Math.max(0.01, contentW - gap * (cols - 1));
  const availH = Math.max(0.01, contentH - gap * (rows.length - 1));

  const rowWeightTotal = rows.reduce((a, r) => a + Math.max(0.01, r.height ?? 1), 0);
  const out: PanelRect[] = [];
  let y = margin.top;

  for (const row of rows) {
    const rowH = (Math.max(0.01, row.height ?? 1) / rowWeightTotal) * availH;
    let col = 0;
    let x = margin.left;
    for (let i = 0; i < row.cells.length && col < cols; i++) {
      const cell = row.cells[i];
      // The last cell absorbs any leftover columns so rounding never leaves blank space.
      const span = i === row.cells.length - 1 ? cols - col : Math.max(1, Math.min(cols - col, cell.span ?? 1));
      const widthWeight = weights.slice(col, col + span).reduce((a, b) => a + b, 0);
      const w = (widthWeight / weightTotal) * availW + gap * (span - 1);
      out.push({
        x: round4(clamp01(x)),
        y: round4(clamp01(y)),
        w: round4(Math.min(1 - x, Math.max(0.005, w))),
        h: round4(Math.min(1 - y, Math.max(0.005, rowH))),
      });
      x += w + gap;
      col += span;
    }
    y += rowH + gap;
  }

  return out.sort((a, b) => a.y - b.y || b.x - a.x);
}

/** Infer a layout from existing panels so users can "capture" a page into a template. */
export function captureLayout(panels: PanelRect[], cols = 2): LayoutTemplate['grid'] {
  const sorted = [...panels].sort((a, b) => a.y - b.y);
  const rows: { cy: number; height: number; cells: { span: number }[] }[] = [];
  for (const panel of sorted) {
    const cy = panel.y + panel.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) < Math.max(0.03, r.height * 0.5));
    if (row) {
      row.cells.push({ span: Math.max(1, Math.round(panel.w * cols)) });
    } else {
      rows.push({ cy, height: panel.h, cells: [{ span: Math.max(1, Math.round(panel.w * cols)) }] });
    }
  }
  return {
    cols,
    rows: rows.map((r) => ({ height: Math.round(r.height * 1000) / 1000, cells: r.cells })),
  };
}
