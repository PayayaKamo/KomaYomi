import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  exportExportTemplate,
  exportLayoutTemplate,
  exportPage,
  importExportTemplate,
  importLayoutTemplate,
  importPage,
} from '../../server/exchange.ts';
import { AppError } from '../../server/errors.ts';
import { saveLayout } from '../../server/layouts.ts';
import { runWithLang } from '../../server/messages/index.ts';
import { saveExportTemplate } from '../../server/presets.ts';
import { createEmptyDoc, writePageDoc } from '../../server/storage.ts';
import { SCHEMA_URLS } from '../../shared/format.ts';
import type { Library, PageDoc } from '../../shared/types.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

type Roots = { rootDir: string; dataRoot: string; exportRoot: string };

function roots(prefix: string): Roots {
  const rootDir = makeTempDir(prefix);
  dirs.push(rootDir);
  return {
    rootDir,
    dataRoot: path.join(rootDir, 'data'),
    exportRoot: path.join(rootDir, 'exports'),
  };
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function expectAppError(fn: () => unknown, code: string, status?: number): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const appError = err as AppError;
    expect(appError.code).toBe(code);
    if (status !== undefined) expect(appError.status).toBe(status);
    return appError;
  }
  throw new Error(`expected AppError ${code}`);
}

const GRID = { cols: 2, rows: [{ height: 1, cells: [{ span: 1 }, { span: 1 }] }] };

const LAYOUT_PAYLOAD = {
  schemaVersion: 1,
  kind: 'mntpl',
  id: 'imp1',
  name: 'Imported',
  scope: 'template',
  grid: GRID,
};

const PAGE_PAYLOAD = {
  volume: 'Vol1',
  chapter: '172',
  pageIndex: 0,
  panels: [{ id: 'p1', rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, source: 'manual' }],
  notes: [],
  offsets: {},
  alignMode: 'page',
  panelOffsets: {},
  readingDirection: 'rtl',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function pageDoc(volume = 'Vol1', chapter = '172', pageIndex = 0): PageDoc {
  return {
    ...createEmptyDoc(volume, chapter, pageIndex),
    notes: [
      {
        id: 'n1',
        scope: 'page',
        panelId: null,
        text: 'hello',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

describe('layout template exchange', () => {
  it('exports a saved layout as .mntpl and reports url/size', () => {
    const { rootDir, dataRoot, exportRoot } = roots('exchange-layout-export');
    const layout = saveLayout(dataRoot, {
      id: 'lay1',
      name: 'Ch1 Layout',
      scope: 'volume',
      grid: GRID,
    });

    const result = exportLayoutTemplate({ rootDir, exportRoot, layoutId: layout.id });
    expect(result.file).toBe('Ch1-Layout.mntpl');
    expect(result.url).toBe('/exports/Ch1-Layout.mntpl');
    expect(result.warnings).toEqual([]);

    const file = path.join(exportRoot, result.file);
    const text = fs.readFileSync(file, 'utf8');
    expect(result.size).toBe(Buffer.byteLength(text, 'utf8'));
    const value = JSON.parse(text) as Record<string, unknown>;
    expect(value).toMatchObject({
      $schema: SCHEMA_URLS.mntpl,
      schemaVersion: 1,
      kind: 'mntpl',
      id: 'lay1',
      scope: 'template',
      readingDirection: 'rtl',
      grid: GRID,
    });
    expect(result.layout).toEqual(value);
  });

  it('rejects exporting an unknown layout', () => {
    const { rootDir, exportRoot } = roots('exchange-layout-export-missing');
    expectAppError(() => exportLayoutTemplate({ rootDir, exportRoot, layoutId: 'nope' }), 'ERR_LAYOUT_NOT_FOUND', 404);
  });

  it('imports a JSON payload to chapter scope with an exchange backup', () => {
    const { rootDir, dataRoot } = roots('exchange-layout-import');
    const payload = JSON.stringify(LAYOUT_PAYLOAD);

    const result = runWithLang('en', () =>
      importLayoutTemplate({ rootDir, data: payload, volume: 'Vol1', scope: 'chapter', chapter: '172' }),
    );

    expect(result.layout).toMatchObject({
      id: 'imp1',
      name: 'Imported',
      scope: 'chapter',
      volume: 'Vol1',
      chapter: '172',
    });
    expect(result.migratedFrom).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(result.backup)).toBe(true);
    expect(result.backup.endsWith('.mntpl')).toBe(true);
    expect(fs.readFileSync(result.backup, 'utf8')).toBe(payload);
    expect(fs.existsSync(path.join(dataRoot, 'layouts', 'imp1.json'))).toBe(true);
  });

  it('accepts a base64-wrapped payload and a page scope', () => {
    const { rootDir } = roots('exchange-layout-base64');
    const data = Buffer.from(JSON.stringify({ ...LAYOUT_PAYLOAD, id: 'imp2' })).toString('base64');

    const result = importLayoutTemplate({
      rootDir,
      data,
      volume: 'Vol1',
      scope: 'page',
      chapter: '172',
      pageIndex: 2,
    });
    expect(result.layout.scope).toBe('page');
    expect(result.layout.pageIndex).toBe(2);
  });

  it('migrates a v0 layout without an envelope and uses the imported name', () => {
    const { rootDir } = roots('exchange-layout-v0');
    const result = importLayoutTemplate({
      rootDir,
      data: JSON.stringify({ name: 'Old Layout', grid: GRID }),
      volume: 'Vol1',
    });
    expect(result.migratedFrom).toBe(0);
    expect(result.layout.name).toBe('Old Layout');
    expect(result.layout.scope).toBe('volume');
    expect(result.layout.chapter).toBeUndefined();
  });

  it('falls back to the default imported name when the payload name is blank', () => {
    const { rootDir } = roots('exchange-layout-name');
    const result = runWithLang('en', () =>
      importLayoutTemplate({
        rootDir,
        data: JSON.stringify({ ...LAYOUT_PAYLOAD, id: 'imp3', name: ' ' }),
        volume: 'Vol1',
      }),
    );
    expect(result.layout.name).toBe('Imported layout template');
  });

  it('rejects empty, invalid JSON, wrong-kind and unknown-field payloads', () => {
    const { rootDir } = roots('exchange-layout-invalid');
    const empty = runWithLang('en', () =>
      expectAppError(
        () => importLayoutTemplate({ rootDir, data: '   ', volume: 'Vol1' }),
        'ERR_EXCHANGE_EMPTY_FILE',
        400,
      ),
    );
    expect(empty.message).toBe('No layout template file content received');

    const invalid = runWithLang('en', () =>
      expectAppError(
        () => importLayoutTemplate({ rootDir, data: '{not json', volume: 'Vol1' }),
        'ERR_EXCHANGE_INVALID_JSON',
        400,
      ),
    );
    expect(invalid.message).toContain('layout template');

    const wrongKind = runWithLang('en', () =>
      expectAppError(
        () =>
          importLayoutTemplate({
            rootDir,
            data: JSON.stringify({
              schemaVersion: 1,
              kind: 'mnexp',
              id: 'x',
              name: 'X',
              createdAt: '2026-01-01T00:00:00.000Z',
              config: {},
            }),
            volume: 'Vol1',
          }),
        'ERR_EXCHANGE_VALIDATION',
        400,
      ),
    );
    expect(wrongKind.message).toContain('layout template');

    expectAppError(
      () =>
        importLayoutTemplate({
          rootDir,
          data: JSON.stringify({ ...LAYOUT_PAYLOAD, id: 'imp4', extra: true }),
          volume: 'Vol1',
        }),
      'ERR_EXCHANGE_VALIDATION',
      400,
    );

    expectAppError(
      () =>
        importLayoutTemplate({
          rootDir,
          data: JSON.stringify({ ...LAYOUT_PAYLOAD, id: undefined }),
          volume: 'Vol1',
        }),
      'ERR_EXCHANGE_VALIDATION',
      400,
    );
  });

  it('requires a safe volume, a chapter for chapter/page scope and a page index', () => {
    const { rootDir } = roots('exchange-layout-target');
    const data = JSON.stringify(LAYOUT_PAYLOAD);

    expectAppError(() => importLayoutTemplate({ rootDir, data, volume: '' }), 'ERR_EXCHANGE_VOLUME_REQUIRED', 400);
    expectAppError(
      () => importLayoutTemplate({ rootDir, data, volume: '../evil' }),
      'ERR_EXCHANGE_VOLUME_REQUIRED',
      400,
    );
    expectAppError(
      () => importLayoutTemplate({ rootDir, data, volume: 'Vol1', scope: 'chapter', chapter: '' }),
      'ERR_EXCHANGE_CHAPTER_REQUIRED',
      400,
    );
    expectAppError(
      () => importLayoutTemplate({ rootDir, data, volume: 'Vol1', scope: 'chapter', chapter: '..' }),
      'ERR_EXCHANGE_CHAPTER_REQUIRED',
      400,
    );
    expectAppError(
      () => importLayoutTemplate({ rootDir, data, volume: 'Vol1', scope: 'page', chapter: '172' }),
      'ERR_EXCHANGE_PAGE_INDEX_REQUIRED',
      400,
    );
  });
});

describe('export template exchange', () => {
  it('exports a saved template and rejects an unknown one', () => {
    const { rootDir, dataRoot, exportRoot } = roots('exchange-export-template');
    const template = saveExportTemplate(dataRoot, {
      id: 'exp1',
      name: 'Stack Export',
      config: { template: 'stack', pageWidthRatio: 50 },
    });

    const result = exportExportTemplate({ rootDir, exportRoot, templateId: template.id });
    expect(result.file).toBe('Stack-Export.mnexp');
    expect(result.url).toBe('/exports/Stack-Export.mnexp');
    const value = JSON.parse(fs.readFileSync(path.join(exportRoot, result.file), 'utf8')) as Record<string, unknown>;
    expect(value).toMatchObject({
      $schema: SCHEMA_URLS.mnexp,
      schemaVersion: 1,
      kind: 'mnexp',
      id: 'exp1',
      name: 'Stack Export',
    });
    expect(value.config).toEqual({ template: 'stack', pageWidthRatio: 50 });
    expect(result.size).toBe(Buffer.byteLength(JSON.stringify(value, null, 2) + '\n', 'utf8'));

    expectAppError(
      () => exportExportTemplate({ rootDir, exportRoot, templateId: 'nope' }),
      'ERR_EXPORT_TEMPLATE_NOT_FOUND',
      404,
    );
  });

  it('imports an object and picks the first object out of an array', () => {
    const { rootDir } = roots('exchange-import-export-template');
    const object = {
      schemaVersion: 1,
      kind: 'mnexp',
      id: 'exp2',
      name: 'Mine',
      createdAt: '2026-01-01T00:00:00.000Z',
      config: { template: 'two-column' },
    };
    const single = importExportTemplate({ rootDir, data: JSON.stringify(object) });
    expect(single.template).toMatchObject({ id: 'exp2', name: 'Mine' });
    expect(fs.existsSync(single.backup)).toBe(true);
    expect(single.backup.endsWith('.mnexp')).toBe(true);

    const fromArray = importExportTemplate({
      rootDir,
      data: JSON.stringify([null, { ...object, id: 'exp3', name: 'From array' }]),
    });
    expect(fromArray.template.id).toBe('exp3');
  });

  it('migrates a v0 export template and defaults a blank name', () => {
    const { rootDir } = roots('exchange-import-export-template-v0');
    const migrated = importExportTemplate({
      rootDir,
      data: JSON.stringify({ id: 'exp4', name: 'Old export', config: { template: 'stack' } }),
    });
    expect(migrated.migratedFrom).toBe(0);
    expect(migrated.template.createdAt).toBeTruthy();

    const blank = runWithLang('en', () =>
      importExportTemplate({
        rootDir,
        data: JSON.stringify({
          schemaVersion: 1,
          kind: 'mnexp',
          id: 'exp5',
          name: ' ',
          createdAt: '2026-01-01T00:00:00.000Z',
          config: {},
        }),
      }),
    );
    expect(blank.template.name).toBe('Imported export template');
  });

  it('rejects empty content, invalid JSON, non-object payloads and bad shapes', () => {
    const { rootDir } = roots('exchange-import-export-template-bad');
    runWithLang('en', () => {
      expectAppError(() => importExportTemplate({ rootDir, data: '' }), 'ERR_EXCHANGE_EMPTY_FILE', 400);
      expectAppError(() => importExportTemplate({ rootDir, data: '{oops' }), 'ERR_EXCHANGE_INVALID_JSON', 400);
    });
    expectAppError(() => importExportTemplate({ rootDir, data: '[]' }), 'ERR_EXPORT_TEMPLATE_SHAPE', 400);
    expectAppError(
      () =>
        importExportTemplate({
          rootDir,
          data: JSON.stringify({ schemaVersion: 1, kind: 'mnexp', id: 'bad', name: 'Bad' }),
        }),
      'ERR_EXCHANGE_VALIDATION',
      400,
    );
  });
});

describe('single page exchange', () => {
  it('exports a saved page and rejects an unsaved one', () => {
    const { rootDir, dataRoot, exportRoot } = roots('exchange-page-export');
    expectAppError(
      () => exportPage({ rootDir, exportRoot, volume: 'Vol1', chapter: '172', pageIndex: 0 }),
      'ERR_PAGE_NOT_SAVED',
      400,
    );

    writePageDoc(dataRoot, pageDoc());
    const result = exportPage({ rootDir, exportRoot, volume: 'Vol1', chapter: '172', pageIndex: 0 });
    expect(result.file).toBe('Vol1-172-P1.mnpage.json');
    expect(result.url).toBe('/exports/Vol1-172-P1.mnpage.json');
    const value = JSON.parse(fs.readFileSync(path.join(exportRoot, result.file), 'utf8')) as Record<string, unknown>;
    expect(value).toMatchObject({ $schema: SCHEMA_URLS.page, schemaVersion: 2, kind: 'page' });
    expect(result.size).toBe(Buffer.byteLength(fs.readFileSync(path.join(exportRoot, result.file), 'utf8'), 'utf8'));
    expect((value.notes as Record<string, unknown>[])[0]).toMatchObject({ id: 'n1', text: 'hello' });
  });

  it('rejects exporting a page whose stored shape is not valid', () => {
    const { rootDir, dataRoot, exportRoot } = roots('exchange-page-export-invalid');
    writeFile(
      path.join(dataRoot, 'pages', 'Vol1', '172', '0.json'),
      JSON.stringify({
        volume: 'Vol1',
        chapter: '',
        pageIndex: 0,
        panels: [],
        notes: [],
        offsets: {},
        alignMode: 'page',
        panelOffsets: {},
        readingDirection: 'rtl',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    expectAppError(
      () => exportPage({ rootDir, exportRoot, volume: 'Vol1', chapter: '172', pageIndex: 0 }),
      'ERR_EXCHANGE_VALIDATION',
      400,
    );
  });

  it('imports a page, writes it and keeps an exchange backup', () => {
    const { rootDir, dataRoot } = roots('exchange-page-import');
    const data = JSON.stringify(PAGE_PAYLOAD);
    const result = runWithLang('en', () => importPage({ rootDir, data }));

    expect(result.migratedFrom).toBe(0);
    expect(result.doc).toMatchObject({ volume: 'Vol1', chapter: '172', pageIndex: 0 });
    expect(result.doc.panels.map((panel) => panel.id)).toEqual(['p1']);
    expect(result.targetBackup).toBeNull();
    expect(fs.existsSync(result.backup)).toBe(true);
    expect(result.backup.endsWith('.mnpage.json')).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'pages', 'Vol1', '172', '0.json'))).toBe(true);
  });

  it('accepts base64 content and backs up the page it overwrites', () => {
    const { rootDir, dataRoot } = roots('exchange-page-overwrite');
    writePageDoc(dataRoot, pageDoc());
    const pagePath = path.join(dataRoot, 'pages', 'Vol1', '172', '0.json');
    const before = fs.readFileSync(pagePath, 'utf8');

    const data = Buffer.from(JSON.stringify({ ...PAGE_PAYLOAD, pageIndex: 1 })).toString('base64');
    const result = importPage({ rootDir, data, volume: 'Vol1', chapter: '172', pageIndex: 0 });

    expect(result.doc.pageIndex).toBe(0);
    expect(result.doc.notes).toEqual([]);
    expect(result.targetBackup).toBeTruthy();
    expect(result.targetBackup!.includes('Vol1-172-P1.json')).toBe(true);
    expect(fs.readFileSync(result.targetBackup!, 'utf8')).toBe(before);
    expect(fs.readFileSync(pagePath, 'utf8')).not.toBe(before);
  });

  it('rejects empty, invalid JSON and non-object page payloads', () => {
    const { rootDir } = roots('exchange-page-bad');
    const empty = runWithLang('en', () =>
      expectAppError(() => importPage({ rootDir, data: ' ' }), 'ERR_EXCHANGE_EMPTY_FILE', 400),
    );
    expect(empty.message).toBe('No page JSON file content received');
    runWithLang('en', () => {
      expectAppError(() => importPage({ rootDir, data: '{oops' }), 'ERR_EXCHANGE_INVALID_JSON', 400);
    });
    expectAppError(() => importPage({ rootDir, data: '[]' }), 'ERR_PAGE_SHAPE', 400);
    expectAppError(
      () => importPage({ rootDir, data: JSON.stringify({ ...PAGE_PAYLOAD, volume: ' ', chapter: ' ' }) }),
      'ERR_PAGE_TARGET_MISSING',
      400,
    );
    expectAppError(
      () => importPage({ rootDir, data: JSON.stringify({ ...PAGE_PAYLOAD, panels: 'nope' }) }),
      'ERR_EXCHANGE_VALIDATION',
      400,
    );
  });

  it('requires a target volume/chapter, safe segments and a valid page index', () => {
    const { rootDir } = roots('exchange-page-target');
    const data = JSON.stringify(PAGE_PAYLOAD);

    expectAppError(() => importPage({ rootDir, data, volume: ' ', chapter: ' ' }), 'ERR_PAGE_TARGET_MISSING', 400);
    expectAppError(() => importPage({ rootDir, data, volume: '../evil' }), 'ERR_UNSAFE_SEGMENT', 400);
    expectAppError(
      () => importPage({ rootDir, data, volume: 'Vol1', chapter: '172', pageIndex: -1 }),
      'ERR_PAGE_INDEX_INVALID',
      400,
    );
  });

  it('refuses a volume/chapter that the current library does not contain', () => {
    const { rootDir } = roots('exchange-page-library');
    const library: Library = {
      root: '',
      languages: ['ja'],
      volumes: [
        {
          id: 'Vol1',
          title: 'Vol1',
          chapters: [],
          warnings: [],
          langDirs: {},
          languages: ['ja'],
          dirs: [],
        },
      ],
    };

    expectAppError(
      () => importPage({ rootDir, data: JSON.stringify(PAGE_PAYLOAD), library }),
      'ERR_CHAPTER_NOT_FOUND',
      404,
    );
  });
});
