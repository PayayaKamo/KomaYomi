import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportChapter } from '../../server/export.ts';
import { createLibrary } from '../../server/library.ts';
import { runWithLang } from '../../server/messages/index.ts';
import { createEmptyDoc, pageFilePath, readPageDoc, writePageDoc } from '../../server/storage.ts';
import {
  annotationsForLang,
  clearAnnotationsForLang,
  recolorAnnotation,
  removeAnnotation,
} from '../../shared/annotations.ts';
import { migratePageV2 } from '../../shared/migrations.ts';
import { CURRENT_SCHEMA_VERSION } from '../../shared/format.ts';
import { DEFAULT_EXPORT_CONFIG } from '../../shared/types.ts';
import type { Annotation, ExportConfig, Lang, PageDoc } from '../../shared/types.ts';
import { solidPng } from '../helpers/fixtures.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function note() {
  return {
    id: 'n1',
    scope: 'page' as const,
    panelId: null,
    text: 'page note',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function mark(id: string, color: string, lang?: Lang, allLangs?: boolean): Annotation {
  return {
    id,
    kind: 'arrow',
    scope: 'page',
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.6 },
    ],
    color,
    width: 0.006,
    ...(lang ? { lang } : {}),
    ...(allLangs ? { allLangs } : {}),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function page(over: Partial<PageDoc> = {}): PageDoc {
  return {
    ...createEmptyDoc('Vol1', '172', 0),
    panels: [{ id: 'p1', rect: { x: 0, y: 0, w: 1, h: 1 }, source: 'manual' }],
    notes: [note()],
    annotationsVisible: true,
    ...over,
  };
}

describe('language scoping of annotations', () => {
  it('hides marks drawn in another lane and keeps shared and legacy marks visible', () => {
    const list = [mark('ja', '#aa0001', 'ja'), mark('en', '#0000aa', 'en'), mark('old', '#00aa00')];

    expect(annotationsForLang(list, 'ja').map((a) => a.id)).toEqual(['ja', 'old']);
    expect(annotationsForLang(list, 'en').map((a) => a.id)).toEqual(['en', 'old']);
    // No lane context (panel workspace) keeps everything.
    expect(annotationsForLang(list, null).map((a) => a.id)).toEqual(['ja', 'en', 'old']);
  });

  it('treats the explicit all-languages flag as shared even when a lane is recorded', () => {
    const shared = mark('shared', '#aa0001', 'ja', true);
    expect(annotationsForLang([shared], 'zh').map((a) => a.id)).toEqual(['shared']);
  });

  it('clears only the current lane', () => {
    const list = [mark('ja', '#aa0001', 'ja'), mark('en', '#0000aa', 'en'), mark('old', '#00aa00')];

    expect(clearAnnotationsForLang(list, 'ja').map((a) => a.id)).toEqual(['en']);
    // Clearing zh drops the shared mark it shows, but keeps marks owned by ja and en.
    expect(clearAnnotationsForLang(list, 'zh').map((a) => a.id)).toEqual(['ja', 'en']);
    // A mark owned by another lane is never touched; the shared one is visible here, so it goes.
    expect(clearAnnotationsForLang(list, 'en').map((a) => a.id)).toEqual(['ja']);
  });

  it('removes and recolours a single mark without touching the rest', () => {
    const list = [mark('a', '#aa0001', 'ja'), mark('b', '#0000aa', 'en')];

    expect(removeAnnotation(list, 'a').map((a) => a.id)).toEqual(['b']);
    expect(recolorAnnotation(list, 'b', '#00ff00')[1]).toMatchObject({ id: 'b', color: '#00ff00' });
    expect(recolorAnnotation(list, 'b', '#00ff00')[0]).toMatchObject({ id: 'a', color: '#aa0001' });
  });
});

describe('page schema v3 migration', () => {
  it('marks pre-v3 annotations as shared instead of assigning a lane', () => {
    const migrated = migratePageV2({
      volume: 'Vol1',
      chapter: '172',
      pageIndex: 0,
      annotations: [mark('old', '#aa0001'), mark('ja', '#0000aa', 'ja')],
      notes: [],
    });

    expect(migrated.schemaVersion).toBe(3);
    const annotations = migrated.annotations as Annotation[];
    expect(annotations[0]).toMatchObject({ id: 'old', allLangs: true });
    expect(annotations[0].lang).toBeUndefined();
    expect(annotations[1]).toMatchObject({ id: 'ja', lang: 'ja' });
    expect(annotations[1].allLangs).toBeUndefined();
  });

  it('keeps the pre-migration bytes when reading a v2 page from disk', () => {
    const dataRoot = tempDir('annotation-langs');
    const file = pageFilePath(dataRoot, 'Vol1', '172', 0);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        volume: 'Vol1',
        chapter: '172',
        pageIndex: 0,
        schemaVersion: 2,
        annotations: [mark('old', '#aa0001')],
      }),
      'utf8',
    );

    const doc = readPageDoc(dataRoot, 'Vol1', '172', 0);
    expect(doc?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION.page);
    expect(doc?.annotations?.[0]).toMatchObject({ id: 'old', allLangs: true });
    expect(doc?.annotations?.[0].lang).toBeUndefined();
    expect(fs.existsSync(`${file}.v2.bak`)).toBe(true);
  });

  it('round-trips a lane-tagged mark without sharing it', () => {
    const dataRoot = tempDir('annotation-langs-roundtrip');
    const doc = { ...createEmptyDoc('Vol1', '172', 0), annotations: [mark('ja', '#aa0001', 'ja')] };

    writePageDoc(dataRoot, doc);
    const saved = readPageDoc(dataRoot, 'Vol1', '172', 0);
    expect(saved?.annotations?.[0]).toMatchObject({ id: 'ja', lang: 'ja' });
    expect(saved?.annotations?.[0].allLangs).toBeUndefined();
  });
});

describe('HTML export filters annotations per language', () => {
  function seed(doc: PageDoc): {
    root: string;
    dataRoot: string;
    exportRoot: string;
    library: ReturnType<typeof createLibrary>;
  } {
    const root = tempDir('export-annotation-langs');
    writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'), solidPng(60, 90, 200));
    writeFile(path.join(root, 'raw', 'Vol1', 'en', '172', '01.png'), solidPng(60, 90, 100));
    const dataRoot = path.join(root, 'data');
    writePageDoc(dataRoot, doc);
    return {
      root,
      dataRoot,
      exportRoot: path.join(root, 'exports'),
      library: createLibrary(path.join(root, 'raw'), dataRoot),
    };
  }

  function config(over: Partial<ExportConfig> = {}): ExportConfig {
    return {
      ...DEFAULT_EXPORT_CONFIG,
      title: 'Lane scoped',
      volume: 'Vol1',
      chapter: '172',
      pageIndices: [0],
      languages: ['ja', 'en'],
      offsets: {},
      ...over,
    };
  }

  it('puts each mark in its own compare-wide crop', async () => {
    const doc = page({
      annotations: [mark('ja', '#aa0001', 'ja'), mark('en', '#0000aa', 'en'), mark('old', '#00aa00')],
    });
    const { root, dataRoot, exportRoot, library } = seed(doc);

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ template: 'compare-wide', columns: 2 }),
        library,
      }),
    );

    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    const jaStart = html.indexOf('class="crop lang-ja"');
    const enStart = html.indexOf('class="crop lang-en"');
    expect(jaStart).toBeGreaterThan(-1);
    expect(enStart).toBeGreaterThan(jaStart);
    const jaCrop = html.slice(jaStart, enStart);
    const enCrop = html.slice(enStart);

    expect(jaCrop).toContain('#aa0001');
    expect(jaCrop).not.toContain('#0000aa');
    expect(enCrop).toContain('#0000aa');
    expect(enCrop).not.toContain('#aa0001');
    // Legacy marks have no lane and stay in every crop.
    expect(jaCrop).toContain('#00aa00');
    expect(enCrop).toContain('#00aa00');
  });

  it('leaves a mark out of a single-language stack export when it belongs to another lane', async () => {
    const doc = page({ annotations: [mark('en', '#0000aa', 'en')] });
    const { root, dataRoot, exportRoot, library } = seed(doc);

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ languages: ['ja'] }),
        library,
      }),
    );

    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(html).not.toContain('<svg class="ann-overlay"');
    expect(html).not.toContain('#0000aa');
  });
});
