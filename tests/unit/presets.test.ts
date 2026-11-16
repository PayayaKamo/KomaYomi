import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyPanelTemplate,
  deleteAlignPreset,
  deleteExportTemplate,
  deletePanelTemplate,
  listAlignPresets,
  listExportTemplates,
  listPanelTemplates,
  readPanelTemplate,
  saveAlignPreset,
  saveExportTemplate,
  savePanelTemplate,
} from '../../server/presets.ts';
import { createEmptyDoc } from '../../server/storage.ts';
import { AppError } from '../../server/errors.ts';
import { runWithLang } from '../../server/messages/index.ts';
import { SCHEMA_URLS } from '../../shared/format.ts';
import type { Note, PageDoc, PanelRect } from '../../shared/types.ts';
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

const RECT: PanelRect = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 };

function note(over: Partial<Note>): Note {
  return {
    id: 'n1',
    scope: 'page',
    panelId: null,
    text: 'text',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('panel templates', () => {
  it('saves defaults, normalizes rects and reads back', () => {
    const dataRoot = tempData('panel-save');
    const saved = runWithLang('en', () =>
      savePanelTemplate(dataRoot, {
        panels: [
          { x: -1, y: 0, w: 2, h: 0 },
          { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
        ],
        readingDirection: 'ltr',
      }),
    );

    expect(saved.name).toBe('Untitled panel template');
    expect(saved.id).toMatch(/^tpl/);
    expect(saved.volume).toBe('');
    expect(saved.chapter).toBe('');
    expect(saved.readingDirection).toBe('ltr');
    expect(saved.panels[0]).toEqual({ x: 0, y: 0, w: 1, h: 0.005 });
    expect(saved.panels[1]).toEqual({ x: 0.5, y: 0.5, w: 0.2, h: 0.2 });

    expect(readPanelTemplate(dataRoot, saved.id)).toMatchObject({ id: saved.id, panels: saved.panels });
  });

  it('lists templates newest first, skipping broken files', () => {
    const dataRoot = tempData('panel-list');
    expect(listPanelTemplates(dataRoot)).toEqual([]);

    const write = (id: string, createdAt: string) =>
      writeFile(
        path.join(dataRoot, 'templates', 'panels', `${id}.json`),
        JSON.stringify({
          $schema: SCHEMA_URLS.mntp,
          schemaVersion: 1,
          kind: 'mntp',
          id,
          name: id,
          panels: [RECT],
          readingDirection: 'rtl',
          createdAt,
        }),
      );
    write('old', '2025-01-01T00:00:00.000Z');
    write('new', '2026-01-01T00:00:00.000Z');
    writeFile(path.join(dataRoot, 'templates', 'panels', 'broken.json'), '{not json');
    writeFile(path.join(dataRoot, 'templates', 'panels', 'skip.txt'), 'ignored');

    expect(listPanelTemplates(dataRoot).map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('returns null for missing or unreadable templates and deletes existing ones', () => {
    const dataRoot = tempData('panel-read-delete');
    expect(readPanelTemplate(dataRoot, 'missing')).toBeNull();
    writeFile(path.join(dataRoot, 'templates', 'panels', 'broken.json'), '{not json');
    expect(readPanelTemplate(dataRoot, 'broken')).toBeNull();

    const saved = savePanelTemplate(dataRoot, { panels: [RECT] });
    expect(deletePanelTemplate(dataRoot, saved.id)).toBe(true);
    expect(deletePanelTemplate(dataRoot, saved.id)).toBe(false);
  });

  it('keeps panel notes on the same artwork when the panel count matches', () => {
    const dataRoot = tempData('panel-apply-same');
    const doc: PageDoc = {
      ...createEmptyDoc('Vol1', '172', 0),
      panels: [
        { id: 'left', rect: { x: 0.05, y: 0.05, w: 0.45, h: 0.4 }, source: 'manual' },
        { id: 'right', rect: { x: 0.5, y: 0.05, w: 0.45, h: 0.4 }, source: 'manual' },
      ],
      notes: [
        note({ id: 'page', scope: 'page' }),
        note({ id: 'nl', scope: 'panel', panelId: 'left' }),
        note({ id: 'nr', scope: 'panel', panelId: 'right' }),
      ],
    };
    const template = savePanelTemplate(dataRoot, {
      panels: [
        { x: 0.05, y: 0.05, w: 0.45, h: 0.4 },
        { x: 0.5, y: 0.05, w: 0.45, h: 0.4 },
      ],
      readingDirection: 'ltr',
    });

    const result = applyPanelTemplate(dataRoot, doc, template.id);
    expect(result).not.toBeNull();
    expect(result!.movedNotes).toBe(0);
    expect(result!.doc.panels.map((panel) => panel.id)).toEqual(['p1', 'p2']);
    expect(result!.doc.readingDirection).toBe('ltr');

    // Notes follow the rectangle, not the reading rank: the left drawing keeps its note.
    const byId = new Map(result!.doc.notes.map((item) => [item.id, item]));
    expect(byId.get('page')!.panelId).toBeNull();
    expect(byId.get('nl')!.panelId).toBe('p1');
    expect(byId.get('nr')!.panelId).toBe('p2');
  });

  it('keeps panel notes when the panel count differs', () => {
    const dataRoot = tempData('panel-apply-drop');
    const doc: PageDoc = {
      ...createEmptyDoc('Vol1', '172', 0),
      panels: [
        { id: 'a', rect: { x: 0.05, y: 0.05, w: 0.4, h: 0.4 }, source: 'manual' },
        { id: 'b', rect: { x: 0.5, y: 0.05, w: 0.4, h: 0.4 }, source: 'manual' },
      ],
      notes: [
        note({ id: 'page', scope: 'page' }),
        note({ id: 'na', scope: 'panel', panelId: 'a' }),
        note({ id: 'nb', scope: 'panel', panelId: 'b' }),
      ],
    };
    const template = savePanelTemplate(dataRoot, {
      panels: [RECT, { x: 0.5, y: 0.1, w: 0.4, h: 0.4 }, { x: 0.1, y: 0.6, w: 0.8, h: 0.3 }],
    });

    const result = applyPanelTemplate(dataRoot, doc, template.id)!;
    expect(result.movedNotes).toBe(0);
    expect(result.doc.notes.map((item) => item.id)).toEqual(['page', 'na', 'nb']);
    expect(result.doc.notes.find((item) => item.id === 'na')!.panelId).toBe('p1');
    expect(result.doc.notes.find((item) => item.id === 'nb')!.panelId).toBe('p2');
    expect(result.doc.panels).toHaveLength(3);
  });

  it('returns null for an unknown template', () => {
    const dataRoot = tempData('panel-apply-missing');
    expect(applyPanelTemplate(dataRoot, createEmptyDoc('Vol1', '172', 0), 'nope')).toBeNull();
  });
});

describe('alignment presets', () => {
  it('normalizes offsets, panel offsets and scalars when saving', () => {
    const dataRoot = tempData('align-save');
    const saved = runWithLang('en', () =>
      saveAlignPreset(dataRoot, {
        name: '  ',
        volume: 'Vol1',
        chapter: '172',
        scope: 'chapter',
        mode: 'nope' as never,
        gridStep: 99,
        offsets: {
          ja: { x: '0.1' as unknown as number, y: 'bad' as unknown as number, scale: 99 },
          zh: { scale: 0.01 },
        },
        panelOffsets: {
          p1: { ja: { x: 1, y: 2, scale: 2 } },
          p2: { ja: null as never },
        },
      }),
    );

    expect(saved.name).toBe('Untitled alignment preset');
    expect(saved.mode).toBe('page');
    expect(saved.scope).toBe('chapter');
    expect(saved.gridStep).toBe(10);
    expect(saved.offsets).toEqual({
      ja: { x: 0.1, y: 0, scale: 4 },
      zh: { x: 0, y: 0, scale: 0.2 },
    });
    expect(saved.panelOffsets).toEqual({ p1: { ja: { x: 1, y: 2, scale: 2 } } });
    expect(fs.existsSync(path.join(dataRoot, 'presets', 'align', `${saved.id}.json`))).toBe(true);
  });

  it('keeps a valid mode, defaults scope to page and clamps the grid step', () => {
    const dataRoot = tempData('align-save-2');
    const saved = saveAlignPreset(dataRoot, {
      id: 'al_fixed',
      name: 'Grid',
      volume: 'Vol1',
      chapter: '172',
      mode: 'grid',
      scope: 'other' as never,
      gridStep: -5,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(saved.id).toBe('al_fixed');
    expect(saved.mode).toBe('grid');
    expect(saved.scope).toBe('page');
    expect(saved.gridStep).toBe(0.1);
  });

  it('lists presets newest first and deletes existing ones only', () => {
    const dataRoot = tempData('align-list');
    expect(listAlignPresets(dataRoot)).toEqual([]);

    saveAlignPreset(dataRoot, {
      id: 'al_old',
      name: 'Old',
      volume: 'Vol1',
      chapter: '172',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    saveAlignPreset(dataRoot, {
      id: 'al_new',
      name: 'New',
      volume: 'Vol1',
      chapter: '172',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(listAlignPresets(dataRoot).map((item) => item.id)).toEqual(['al_new', 'al_old']);
    expect(deleteAlignPreset(dataRoot, 'al_new')).toBe(true);
    expect(deleteAlignPreset(dataRoot, 'al_new')).toBe(false);
  });

  it('migrates legacy data/presets/align.json once and renames the old file', () => {
    const dataRoot = tempData('align-legacy');
    writeFile(
      path.join(dataRoot, 'presets', 'align.json'),
      JSON.stringify([
        {
          id: 'legacy1',
          name: 'Legacy',
          scope: 'page',
          volume: 'Vol1',
          chapter: '172',
          mode: 'panel',
          offsets: { ja: { x: 0.1, y: 0.2, scale: 9 } },
          panelOffsets: { p1: { ja: { x: 0.3, y: 0, scale: 2 } } },
          gridStep: 2,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
    );

    const first = listAlignPresets(dataRoot);
    expect(first.map((item) => item.id)).toEqual(['legacy1']);
    expect(first[0].offsets.ja).toEqual({ x: 0.1, y: 0.2, scale: 4 });

    const migrated = path.join(dataRoot, 'presets', 'align', 'legacy1.json');
    expect(fs.existsSync(migrated)).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'presets', 'align.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataRoot, 'presets', 'align.legacy.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(migrated, 'utf8'))).toMatchObject({
      $schema: SCHEMA_URLS.mnalign,
      schemaVersion: 1,
      kind: 'mnalign',
    });

    // A second read must not import it twice.
    expect(listAlignPresets(dataRoot).map((item) => item.id)).toEqual(['legacy1']);
  });

  it('skips legacy entries whose id already exists', () => {
    const dataRoot = tempData('align-legacy-dup');
    saveAlignPreset(dataRoot, {
      id: 'dup',
      name: 'Existing',
      volume: 'Vol1',
      chapter: '172',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    writeFile(
      path.join(dataRoot, 'presets', 'align.json'),
      JSON.stringify([{ id: 'dup', name: 'Legacy', offsets: {}, createdAt: '2024-01-01T00:00:00.000Z' }]),
    );

    const list = listAlignPresets(dataRoot);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Existing');
    expect(fs.existsSync(path.join(dataRoot, 'presets', 'align.legacy.json'))).toBe(true);
  });
});

describe('export templates', () => {
  it('saves a template with a default name and lists it', () => {
    const dataRoot = tempData('export-save');
    expect(listExportTemplates(dataRoot)).toEqual([]);

    const saved = runWithLang('en', () =>
      saveExportTemplate(dataRoot, { config: { template: 'stack', pageWidthRatio: 50 } }),
    );
    expect(saved.name).toBe('Untitled export template');
    expect(saved.id).toMatch(/^ext/);
    expect(saved.config).toEqual({ template: 'stack', pageWidthRatio: 50 });

    const list = listExportTemplates(dataRoot);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: saved.id, name: saved.name, config: saved.config });
    expect(fs.existsSync(path.join(dataRoot, 'templates', 'export.json'))).toBe(true);
  });

  it('overwrites the template with the same id instead of duplicating it', () => {
    const dataRoot = tempData('export-overwrite');
    saveExportTemplate(dataRoot, { id: 'same', name: 'First', config: {} });
    saveExportTemplate(dataRoot, { id: 'same', name: 'Second', config: { template: 'compare-wide' } });

    const list = listExportTemplates(dataRoot);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'same', name: 'Second', config: { template: 'compare-wide' } });
  });

  it('migrates legacy items in data/templates/export.json and keeps a version backup', () => {
    const dataRoot = tempData('export-legacy');
    const file = path.join(dataRoot, 'templates', 'export.json');
    writeFile(
      file,
      JSON.stringify([
        { id: 'old1', name: 'Old', createdAt: '2024-01-01T00:00:00.000Z', config: { template: 'stack' } },
        { id: 'skip', createdAt: '2023-01-01T00:00:00.000Z', schemaVersion: 99, name: 'Future', config: {} },
      ]),
    );

    const list = listExportTemplates(dataRoot);
    expect(list).toHaveLength(2);
    const migrated = list.find((item) => item.id === 'old1') as unknown as Record<string, unknown>;
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.kind).toBe('mnexp');
    expect(migrated.$schema).toBe(SCHEMA_URLS.mnexp);
    expect(list.some((item) => item.id === 'skip')).toBe(true);

    expect(fs.existsSync(`${file}.v0.bak`)).toBe(true);
    const rewritten = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>[];
    expect(rewritten.find((item) => item.id === 'old1')?.schemaVersion).toBe(1);
  });

  it('deletes existing templates and reports unknown ids', () => {
    const dataRoot = tempData('export-delete');
    saveExportTemplate(dataRoot, { id: 'gone', name: 'Gone', config: {} });
    expect(deleteExportTemplate(dataRoot, 'missing')).toBe(false);
    expect(deleteExportTemplate(dataRoot, 'gone')).toBe(true);
    expect(listExportTemplates(dataRoot)).toEqual([]);
  });

  it('refuses to rewrite a list produced by a newer schema', () => {
    const dataRoot = tempData('export-too-new');
    writeFile(
      path.join(dataRoot, 'templates', 'export.json'),
      JSON.stringify([
        {
          $schema: SCHEMA_URLS.mnexp,
          schemaVersion: 99,
          kind: 'mnexp',
          id: 'future',
          name: 'Future',
          createdAt: '2026-01-01T00:00:00.000Z',
          config: {},
        },
      ]),
    );

    try {
      saveExportTemplate(dataRoot, { name: 'Mine', config: {} });
      throw new Error('expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ERR_SCHEMA_TOO_NEW');
      expect((err as AppError).status).toBe(409);
    }
  });
});
