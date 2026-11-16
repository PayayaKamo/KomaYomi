import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureLayout,
  deleteLayout,
  expandLayout,
  listLayouts,
  readLayout,
  resolveLayout,
  saveLayout,
} from '../../server/layouts.ts';
import { AppError } from '../../server/errors.ts';
import { runWithLang } from '../../server/messages/index.ts';
import type { LayoutTemplate } from '../../shared/types.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempData(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return path.join(dir, 'data');
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function template(over: Partial<LayoutTemplate> = {}): LayoutTemplate {
  return {
    id: 'base',
    name: 'Base',
    scope: 'volume',
    volume: 'Vol1',
    grid: { cols: 2, rows: [{ cells: [{}, {}] }] },
    ...over,
  };
}

describe('saveLayout / readLayout / deleteLayout', () => {
  it('normalizes a template and writes readable JSON', () => {
    const dataRoot = tempData('layout-save');
    const saved = runWithLang('en', () =>
      saveLayout(dataRoot, {
        scope: 'chapter',
        chapter: '172',
        readingDirection: 'ltr',
        margin: { top: 0.05 },
        gap: 0.02,
        grid: {
          cols: 2,
          rows: [
            { height: 1, cells: [{}, {}] },
            { height: 2, cells: [{ span: 2 }] },
          ],
        },
      }),
    );

    expect(saved.id).toMatch(/^lay/);
    expect(saved.scope).toBe('chapter');
    expect(saved.chapter).toBe('172');
    expect(saved.pageIndex).toBeUndefined();
    expect(saved.readingDirection).toBe('ltr');
    expect(saved.margin).toEqual({ top: 0.05, right: 0.02, bottom: 0.02, left: 0.02 });
    expect(saved.gap).toBe(0.02);
    expect(saved.createdAt).toBeTruthy();

    const file = path.join(dataRoot, 'layouts', `${saved.id}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(onDisk.$schema).toContain('mnlayout');
    expect(onDisk.schemaVersion).toBe(1);

    expect(readLayout(dataRoot, saved.id)).toMatchObject({ id: saved.id, scope: 'chapter', chapter: '172' });
  });

  it('falls back to defaults and clamps out-of-range values', () => {
    const dataRoot = tempData('layout-clamp');
    const saved = runWithLang('en', () =>
      saveLayout(dataRoot, {
        scope: 'page',
        chapter: '172',
        pageIndex: 1,
        gap: 0.5,
        colWeights: [-5, 2],
        notes: 42 as unknown as string,
        grid: {
          cols: 99,
          rows: [
            { height: 0, cells: [] },
            { height: 2, cells: [{ span: 0 }, { span: 99 }] },
          ],
        },
      }),
    );

    expect(saved.name).toBe('Untitled layout');
    expect(saved.volume).toBe('');
    expect(saved.readingDirection).toBe('rtl');
    expect(saved.grid.cols).toBe(12);
    expect(saved.grid.rows[0].height).toBe(1);
    expect(saved.grid.rows[0].cells).toEqual([{ span: 12 }]);
    expect(saved.grid.rows[1].height).toBe(2);
    expect(saved.grid.rows[1].cells).toEqual([{ span: 1 }, { span: 99 }]);
    expect(saved.gap).toBe(0.08);
    expect(saved.colWeights).toEqual([0.01, 2]);
    expect(saved.notes).toBe('42');
    expect(saved.margin).toEqual({ top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 });
  });

  it('rejects input without grid rows', () => {
    const dataRoot = tempData('layout-invalid');
    for (const input of [{ grid: { cols: 2, rows: [] } }, { grid: undefined }, {}] as Partial<LayoutTemplate>[]) {
      expect(() => saveLayout(dataRoot, input)).toThrow(AppError);
      try {
        saveLayout(dataRoot, input);
      } catch (err) {
        expect((err as AppError).code).toBe('ERR_LAYOUT_SAVE_INVALID');
      }
    }
  });

  it('ignores broken and non-JSON files when listing, and sorts newest first', () => {
    const dataRoot = tempData('layout-list');
    expect(listLayouts(dataRoot)).toEqual([]);

    const older = saveLayout(dataRoot, {
      name: 'Older',
      createdAt: '2025-01-01T00:00:00.000Z',
      grid: { cols: 1, rows: [{ cells: [{}] }] },
    });
    const newer = saveLayout(dataRoot, {
      name: 'Newer',
      createdAt: '2026-01-01T00:00:00.000Z',
      grid: { cols: 1, rows: [{ cells: [{}] }] },
    });
    writeFile(path.join(dataRoot, 'layouts', 'broken.json'), '{not json');
    writeFile(path.join(dataRoot, 'layouts', 'notes.txt'), 'ignored');
    writeFile(path.join(dataRoot, 'layouts', 'array.json'), '[]');

    const ids = listLayouts(dataRoot).map((layout) => layout.id);
    expect(ids).toEqual([newer.id, older.id]);
  });

  it('returns null for a missing or unreadable template and deletes existing ones only', () => {
    const dataRoot = tempData('layout-read-delete');
    expect(readLayout(dataRoot, 'missing')).toBeNull();

    writeFile(path.join(dataRoot, 'layouts', 'broken.json'), '{not json');
    expect(readLayout(dataRoot, 'broken')).toBeNull();

    const saved = saveLayout(dataRoot, { grid: { cols: 1, rows: [{ cells: [{}] }] } });
    expect(deleteLayout(dataRoot, saved.id)).toBe(true);
    expect(deleteLayout(dataRoot, saved.id)).toBe(false);
  });
});

describe('resolveLayout', () => {
  it('prefers the page template, then the chapter, then the volume', () => {
    const dataRoot = tempData('layout-resolve');
    const volume = saveLayout(dataRoot, {
      name: 'Volume',
      scope: 'volume',
      volume: 'Vol1',
      createdAt: '2024-01-01T00:00:00.000Z',
      grid: { cols: 1, rows: [{ cells: [{}] }] },
    });
    const chapter = saveLayout(dataRoot, {
      name: 'Chapter',
      scope: 'chapter',
      volume: 'Vol1',
      chapter: '172',
      createdAt: '2025-01-01T00:00:00.000Z',
      grid: { cols: 1, rows: [{ cells: [{}] }] },
    });
    const page = saveLayout(dataRoot, {
      name: 'Page',
      scope: 'page',
      volume: 'Vol1',
      chapter: '172',
      pageIndex: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      grid: { cols: 1, rows: [{ cells: [{}] }] },
    });
    saveLayout(dataRoot, {
      name: 'Other volume',
      scope: 'volume',
      volume: 'Vol2',
      grid: { cols: 1, rows: [{ cells: [{}] }] },
    });

    expect(resolveLayout(dataRoot, 'Vol1', '172', 1)?.id).toBe(page.id);
    expect(resolveLayout(dataRoot, 'Vol1', '172', 2)?.id).toBe(chapter.id);
    expect(resolveLayout(dataRoot, 'Vol1', '173', 0)?.id).toBe(volume.id);
    expect(resolveLayout(dataRoot, 'Vol3', '172', 0)).toBeNull();
  });
});

describe('expandLayout', () => {
  it('splits equal columns and returns panels right-to-left within a row', () => {
    const rects = expandLayout(template(), 0);
    expect(rects).toHaveLength(2);
    expect(rects.map((r) => r.x)).toEqual([expect.closeTo(0.506), expect.closeTo(0.02)]);
    for (const rect of rects) {
      expect(rect.y).toBeCloseTo(0.02);
      expect(rect.w).toBeCloseTo(0.474);
      expect(rect.h).toBeCloseTo(0.96);
    }
  });

  it('honours column weights and falls back when their length does not match', () => {
    const weighted = expandLayout(template({ grid: { cols: 2, rows: [{ cells: [{}, {}] }] }, colWeights: [2, 1] }), 0);
    // Panels are returned right-to-left, so the narrower weighted column comes first.
    expect(weighted[0].w).toBeCloseTo(0.316);
    expect(weighted[1].w).toBeCloseTo(0.632);

    const fallback = expandLayout(template({ grid: { cols: 2, rows: [{ cells: [{}, {}] }] }, colWeights: [1] }), 0);
    expect(fallback[0].w).toBeCloseTo(0.474);
    expect(fallback[1].w).toBeCloseTo(0.474);
  });

  it('divides row height by weight and stacks rows with the gap', () => {
    const rects = expandLayout(
      template({
        grid: {
          cols: 1,
          rows: [
            { height: 1, cells: [{}] },
            { height: 3, cells: [{}] },
          ],
        },
      }),
      0,
    );
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: expect.closeTo(0.02), y: expect.closeTo(0.02) });
    expect(rects[0].h).toBeCloseTo(0.237);
    expect(rects[1].y).toBeCloseTo(0.269);
    expect(rects[1].h).toBeCloseTo(0.711);
  });

  it('lets the last cell absorb the remaining columns', () => {
    const rects = expandLayout(template({ grid: { cols: 3, rows: [{ cells: [{ span: 1 }, { span: 1 }] }] } }), 0);
    expect(rects).toHaveLength(2);
    // Right-most cell (spanning two columns) comes first in reading order.
    expect(rects[0].x).toBeCloseTo(0.344);
    expect(rects[0].w).toBeCloseTo(0.636);
    expect(rects[1].x).toBeCloseTo(0.02);
    expect(rects[1].w).toBeCloseTo(0.312);
  });

  it('applies page overrides for the requested page only', () => {
    const layout = template({
      pageOverrides: {
        '2': { grid: { cols: 1, rows: [{ cells: [{}] }] }, margin: { top: 0.1 }, gap: 0.05 },
      },
    });
    expect(expandLayout(layout, 0)).toHaveLength(2);

    const overridden = expandLayout(layout, 1);
    expect(overridden).toHaveLength(1);
    expect(overridden[0]).toMatchObject({
      x: expect.closeTo(0.02),
      y: expect.closeTo(0.1),
      w: expect.closeTo(0.96),
      h: expect.closeTo(0.88),
    });
  });

  it('keeps panels inside the page when margins and gap exceed the content area', () => {
    const rects = expandLayout(
      template({
        margin: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 },
        gap: 0.08,
        grid: { cols: 2, rows: [{ cells: [{}, {}] }, { cells: [{}, {}] }] },
      }),
      0,
    );
    expect(rects).toHaveLength(4);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.w).toBeGreaterThanOrEqual(0.005);
      expect(rect.h).toBeGreaterThanOrEqual(0.005);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1);
      expect(rect.y + rect.h).toBeLessThanOrEqual(1);
    }
  });
});

describe('captureLayout', () => {
  it('merges panels sharing a row and starts a new row for a lower panel', () => {
    const grid = captureLayout([
      { x: 0, y: 0.1, w: 0.5, h: 0.2 },
      { x: 0.5, y: 0.11, w: 0.5, h: 0.2 },
      { x: 0.05, y: 0.6, w: 0.9, h: 0.3 },
    ]);
    expect(grid).toEqual({
      cols: 2,
      rows: [
        { height: 0.2, cells: [{ span: 1 }, { span: 1 }] },
        { height: 0.3, cells: [{ span: 2 }] },
      ],
    });
  });

  it('uses the requested column count for spans', () => {
    const grid = captureLayout([{ x: 0, y: 0.1, w: 0.5, h: 0.2 }], 4);
    expect(grid.cols).toBe(4);
    expect(grid.rows[0].cells).toEqual([{ span: 2 }]);
  });
});
