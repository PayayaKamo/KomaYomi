import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { exportChapter } from '../../server/export.ts';
import { exportChapterDocx } from '../../server/exportDocx.ts';
import { createLibrary, writeLibraryConfig } from '../../server/library.ts';
import { runWithLang } from '../../server/messages/index.ts';
import { createEmptyDoc, writePageDoc } from '../../server/storage.ts';
import { DEFAULT_EXPORT_CONFIG } from '../../shared/types.ts';
import type { Annotation, ExportConfig, PageDoc } from '../../shared/types.ts';
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

const arrow: Annotation = {
  id: 'a1',
  kind: 'arrow',
  scope: 'page',
  points: [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.6 },
  ],
  color: '#e0453a',
  width: 0.006,
  anchor: { x: 0.7, y: 0.3, w: 0.1, h: 0.1 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function annotatedDoc(pageIndex: number, over: Partial<PageDoc> = {}): PageDoc {
  const doc = createEmptyDoc('Vol1', '172', pageIndex);
  return {
    ...doc,
    panels: [
      { id: 'p1', rect: { x: 0.05, y: 0.05, w: 0.4, h: 0.4 }, source: 'auto' },
      { id: 'p2', rect: { x: 0.55, y: 0.05, w: 0.4, h: 0.4 }, source: 'auto' },
    ],
    annotations: [arrow],
    annotationsVisible: true,
    ...over,
  };
}

function seed(pages = 2): {
  root: string;
  dataRoot: string;
  exportRoot: string;
  library: ReturnType<typeof createLibrary>;
} {
  const root = tempDir('export-annotations');
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'), solidPng(60, 90, 200));
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '02.png'), solidPng(60, 90, 210));
  writeFile(path.join(root, 'raw', 'Vol1', 'en', '172', '01.png'), solidPng(60, 90, 100));
  writeFile(path.join(root, 'raw', 'Vol1', 'en', '172', '02.png'), solidPng(60, 90, 110));
  const dataRoot = path.join(root, 'data');
  for (let index = 0; index < pages; index++) writePageDoc(dataRoot, annotatedDoc(index));
  const library = createLibrary(path.join(root, 'raw'), dataRoot);
  return { root, dataRoot, exportRoot: path.join(root, 'exports'), library };
}

function config(over: Partial<ExportConfig> = {}): ExportConfig {
  return {
    ...DEFAULT_EXPORT_CONFIG,
    title: 'Annotated book',
    volume: 'Vol1',
    chapter: '172',
    pageIndices: [0],
    languages: ['ja'],
    offsets: {},
    ...over,
  };
}

/** Reads one file out of a .docx (a zip) so tests can inspect the generated XML. */
function readZipEntry(file: string, entry: string): string {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if (name === entry) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compSize);
      return method === 0 ? data.toString('utf8') : zlib.inflateRawSync(data).toString('utf8');
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: ${entry} not found`);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('HTML export with annotation layers', () => {
  it('draws the vector layer on every page of a whole-chapter export', async () => {
    const { root, dataRoot, exportRoot, library } = seed();

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [] }),
        library,
      }),
    );

    expect(result.pages).toBe(2);
    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(count(html, '<svg class="ann-overlay"')).toBe(2);
    expect(html).toContain('<polygon');
  });

  it('drops the layer when annotationsVisible is off but keeps the pages', async () => {
    const { root, dataRoot, exportRoot } = seed();
    writePageDoc(dataRoot, annotatedDoc(0, { annotationsVisible: false }));
    writePageDoc(dataRoot, annotatedDoc(1, { annotationsVisible: false }));
    const hidden = createLibrary(path.join(root, 'raw'), dataRoot);

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [] }),
        library: hidden,
      }),
    );

    expect(result.pages).toBe(2);
    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(html).not.toContain('<svg class="ann-overlay"');
    expect(html).not.toContain('<polygon');
  });

  it('keeps annotations in the print view', async () => {
    const { root, dataRoot, exportRoot, library } = seed();

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ print: true }),
        library,
      }),
    );

    expect(result.file.endsWith('-print.html')).toBe(true);
    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(html).toContain('window.print()');
    expect(html).toContain('<svg class="ann-overlay"');
  });

  it('repeats the page layer inside every compare-wide panel crop', async () => {
    const { root, dataRoot, exportRoot, library } = seed();

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
    expect(html).toContain('class="crop lang-ja"');
    expect(count(html, '<svg class="ann-overlay"')).toBe(2);
  });
});

describe('Word export with annotation images', () => {
  it('embeds staged annotation images for a whole chapter and consumes them', async () => {
    const { root, dataRoot, exportRoot, library } = seed();
    const staging = path.join(exportRoot, '.staging', 'job1');
    fs.mkdirSync(staging, { recursive: true });
    writeFile(path.join(staging, 'p0-ja.png'), solidPng(40, 60, 120));
    writeFile(path.join(staging, 'p1-ja.png'), solidPng(40, 60, 130));

    const result = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [], annotationImages: 'job1' }),
        library,
      }),
    );

    expect(result.pages).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(path.join(staging, 'p0-ja.png'))).toBe(false);
    expect(fs.existsSync(path.join(staging, 'p1-ja.png'))).toBe(false);

    const xml = readZipEntry(path.join(exportRoot, result.file), 'word/document.xml');
    expect(xml).toContain('P1 ·');
    expect(xml).toContain('P2 ·');
    expect(count(xml, '<w:drawing>')).toBe(2);
  });

  it('warns when annotations exist but no composited image was uploaded', async () => {
    const { root, dataRoot, exportRoot, library } = seed();

    const result = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot,
        config: config(),
        library,
      }),
    );

    expect(result.pages).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/exported without annotations/);
  });

  it('leaves staged images alone when the annotation switch is off', async () => {
    const { root, dataRoot, exportRoot, library } = seed();
    const staging = path.join(exportRoot, '.staging', 'job2');
    fs.mkdirSync(staging, { recursive: true });
    const staged = path.join(staging, 'p0-ja.png');
    writeFile(staged, solidPng(40, 60, 120));

    const result = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot,
        config: config({ includeAnnotations: false, annotationImages: 'job2' }),
        library,
      }),
    );

    expect(result.pages).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(staged)).toBe(true);
    const xml = readZipEntry(path.join(exportRoot, result.file), 'word/document.xml');
    expect(count(xml, '<w:drawing>')).toBe(1);
  });

  it('honours excluded pages in a whole-chapter Word export', async () => {
    const { root, dataRoot, exportRoot } = seed();
    writeLibraryConfig(dataRoot, { volumes: { Vol1: { chapters: { 172: { excluded: [0] } } } } });
    const library = createLibrary(path.join(root, 'raw'), dataRoot);

    const result = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [], includeAnnotations: false }),
        library,
      }),
    );

    expect(result.pages).toBe(1);
    const xml = readZipEntry(path.join(exportRoot, result.file), 'word/document.xml');
    expect(xml).not.toContain('P1 ·');
    expect(xml).toContain('P2 ·');
  });

  it('skips pages without a page document when only annotated pages are requested', async () => {
    const { root, dataRoot, exportRoot } = seed(1);
    writePageDoc(dataRoot, {
      ...annotatedDoc(0),
      notes: [
        {
          id: 'n1',
          scope: 'page',
          panelId: null,
          text: 'page note',
          tags: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const library = createLibrary(path.join(root, 'raw'), dataRoot);

    const result = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [0, 1], onlyWithNotes: true, includeAnnotations: false }),
        library,
      }),
    );

    expect(result.pages).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/Page 2 has no panel data yet/);
  });
});
