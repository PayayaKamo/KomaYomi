import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../server/errors.ts';
import { exportChapter } from '../../server/export.ts';
import { exportChapterDocx } from '../../server/exportDocx.ts';
import { createLibrary, writeLibraryConfig } from '../../server/library.ts';
import { runWithLang } from '../../server/messages/index.ts';
import { createEmptyDoc, readPageDoc, writePageDoc } from '../../server/storage.ts';
import { DEFAULT_EXPORT_CONFIG } from '../../shared/types.ts';
import type { ExportConfig, PageDoc } from '../../shared/types.ts';
import { solidPng, threePanelPage } from '../helpers/fixtures.ts';
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

function noteDoc(): PageDoc {
  const doc = createEmptyDoc('Vol1', '172', 0);
  return {
    ...doc,
    panels: [
      { id: 'p1', rect: { x: 0.05, y: 0.05, w: 0.4, h: 0.4 }, source: 'auto' },
      { id: 'p2', rect: { x: 0.55, y: 0.05, w: 0.4, h: 0.4 }, source: 'auto' },
    ],
    notes: [
      {
        id: 'n1',
        scope: 'page',
        panelId: null,
        text: '**bold** page note',
        tags: ['vocab'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'n2',
        scope: 'panel',
        panelId: 'p1',
        text: 'panel note',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

function seedExportRoot(): { root: string; dataRoot: string; library: ReturnType<typeof createLibrary> } {
  const root = tempDir('export');
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'), solidPng(60, 90, 200));
  writeFile(path.join(root, 'raw', 'Vol1', 'en', '172', '01.png'), solidPng(60, 90, 100));
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '02.png'), solidPng(60, 90, 210));
  writeFile(path.join(root, 'raw', 'Vol1', 'en', '172', '02.png'), solidPng(60, 90, 110));
  const dataRoot = path.join(root, 'data');
  writePageDoc(dataRoot, noteDoc());
  const library = createLibrary(path.join(root, 'raw'), dataRoot);
  return { root, dataRoot, library };
}

function config(over: Partial<ExportConfig> = {}): ExportConfig {
  return {
    ...DEFAULT_EXPORT_CONFIG,
    title: 'Test <Book>',
    volume: 'Vol1',
    chapter: '172',
    pageIndices: [0],
    languages: ['ja', 'zh', 'en'],
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

describe('exportChapter', () => {
  it('writes a portable HTML file plus a sibling .files image directory', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const exportRoot = path.join(root, 'exports');

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ showPanelBoxes: true }),
        library,
      }),
    );

    expect(result.pages).toBe(1);
    expect(result.imageMode).toBe('files');
    expect(result.assetDir).toBeTruthy();
    expect(result.warnings).toEqual([]);

    const assets = fs.readdirSync(path.join(exportRoot, result.assetDir!)).sort();
    expect(assets).toEqual(['p001-en.png', 'p001-ja.png']);

    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Test &lt;Book&gt;');
    expect(html).toContain('./' + result.assetDir);
    expect(html).toContain('class="box"');
    expect(html).toContain('Page notes');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('panel note');
    expect(html).toContain('Panel 1');
    expect(html).toContain('Exported by KomaYomi · 1 page(s)');
  });

  it('skips pages excluded by the preprocessing wizard', async () => {
    const { root, dataRoot } = seedExportRoot();
    // The second page has notes, so exporting it does not trip the empty-export guard.
    writePageDoc(dataRoot, { ...noteDoc(), pageIndex: 1 });
    writeLibraryConfig(dataRoot, { volumes: { Vol1: { chapters: { 172: { excluded: [0] } } } } });
    const library = createLibrary(path.join(root, 'raw'), dataRoot);
    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot: path.join(root, 'exports'),
        config: config({ pageIndices: [] }),
        library,
      }),
    );
    expect(result.pages).toBe(1);
  });

  it('detects pages that were never opened instead of dropping them', async () => {
    const root = tempDir('export-detect');
    writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'), threePanelPage());
    writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '02.png'), threePanelPage());
    const dataRoot = path.join(root, 'data');
    const library = createLibrary(path.join(root, 'raw'), dataRoot);

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot: path.join(root, 'exports'),
        config: config({ pageIndices: [] }),
        library,
      }),
    );

    expect(result.pages).toBe(2);
    expect(result.warnings).toEqual(['Detected panels on 2 pages that had no layout yet']);
    // The detected layout is written once, so a second export no longer reports it.
    expect(readPageDoc(dataRoot, 'Vol1', '172', 1)?.panels.length).toBeGreaterThan(0);
    // The Word export shares the same preflight, so both exits include the pages.
    const docx = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot: path.join(root, 'exports'),
        config: config({ pageIndices: [] }),
        library,
      }),
    );
    expect(docx.pages).toBe(2);
    expect(docx.warnings).toEqual([]);
    const again = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot: path.join(root, 'exports'),
        config: config({ pageIndices: [] }),
        library,
      }),
    );
    expect(again.pages).toBe(2);
    expect(again.warnings).toEqual([]);
  });

  it('inlines images as data URLs when embedImages is on', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const exportRoot = path.join(root, 'exports');

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ embedImages: true }),
        library,
      }),
    );

    expect(result.imageMode).toBe('embed');
    expect(result.assetDir).toBeUndefined();
    expect(fs.readdirSync(exportRoot)).toEqual([result.file]);
    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('.files/');
  });

  it('renders the compare-wide template with per-panel crops', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const exportRoot = path.join(root, 'exports');

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
    expect(html).toContain('class="compare"');
    expect(html).toContain('class="crop lang-ja"');
    expect(html).toContain('class="crop lang-en"');
    expect(html).toContain('background-size:');
    expect(html).toContain('Japanese');
    expect(html).toContain('English');
  });

  it('renders the stacked template', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const exportRoot = path.join(root, 'exports');

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ template: 'stack' }),
        library,
      }),
    );

    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(html).toContain('class="page-body stack"');
    expect(html).toContain('alt="Page 1"');
  });

  it('skips pages without a page document and only exports pages with notes on request', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const exportRoot = path.join(root, 'exports');

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [0, 1], onlyWithNotes: true }),
        library,
      }),
    );

    expect(result.pages).toBe(1);
    expect(result.warnings.join(' ')).toContain('2');
  });
  it('writes an editable Word document with page images and notes', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const exportRoot = path.join(root, 'exports');

    const result = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [0], languages: ['ja', 'en'] }),
        library,
      }),
    );

    expect(result.pages).toBe(1);
    expect(result.file.endsWith('.docx')).toBe(true);
    const buffer = fs.readFileSync(path.join(exportRoot, result.file));
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('renders underline and alignment in Word instead of leaking the tags', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const doc = noteDoc();
    doc.notes = [{ ...doc.notes[0], text: '<u>underlined</u> text\n\n<div align="center">centered</div>' }];
    writePageDoc(dataRoot, doc);
    const exportRoot = path.join(root, 'exports');

    const result = await runWithLang('en', () =>
      exportChapterDocx({
        rootDir: root,
        dataRoot,
        exportRoot,
        config: config({ pageIndices: [0] }),
        library,
      }),
    );

    const xml = readZipEntry(path.join(exportRoot, result.file), 'word/document.xml');
    expect(xml).toContain('<w:u ');
    expect(xml).toContain('w:val="center"');
    expect(xml).not.toContain('&lt;u&gt;');
    expect(xml).not.toContain('&lt;div');
  });

  it('writes a print view that opens the print dialog', async () => {
    const { root, dataRoot, library } = seedExportRoot();

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot: path.join(root, 'exports'),
        config: config({ print: true }),
        library,
      }),
    );

    expect(result.file.endsWith('-print.html')).toBe(true);
    const html = fs.readFileSync(path.join(root, 'exports', result.file), 'utf8');
    expect(html).toContain('window.print()');
    expect(html).toContain('@page{size:A4');
    expect(html).toContain('break-inside:avoid');
    expect(html).toContain('max-height:150mm');
  });

  it('exports pages and asset files in the chapter reading order', async () => {
    const { root, dataRoot } = seedExportRoot();
    writePageDoc(dataRoot, { ...noteDoc(), pageIndex: 1 });
    // The preprocessing order puts the second file first; the export must follow it.
    writeLibraryConfig(dataRoot, { volumes: { Vol1: { chapters: { 172: { order: [1, 0] } } } } });
    const library = createLibrary(path.join(root, 'raw'), dataRoot);
    const exportRoot = path.join(root, 'exports');

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot,
        // Deliberately unsorted: the chapter order wins.
        config: config({ pageIndices: [0, 1], languages: ['ja'] }),
        library,
      }),
    );

    expect(result.pages).toBe(2);
    const html = fs.readFileSync(path.join(exportRoot, result.file), 'utf8');
    expect(html.indexOf('<span class="idx">P2</span>')).toBeLessThan(html.indexOf('<span class="idx">P1</span>'));

    const assets = fs.readdirSync(path.join(exportRoot, result.assetDir!)).sort();
    expect(assets).toEqual(['p001-ja.png', 'p002-ja.png']);
    const first = fs.readFileSync(path.join(exportRoot, result.assetDir!, 'p001-ja.png'));
    expect(first.equals(solidPng(60, 90, 210))).toBe(true);
  });

  it('labels the extended reading directions in the header', async () => {
    const { root, dataRoot } = seedExportRoot();
    writePageDoc(dataRoot, { ...noteDoc(), readingDirection: 'vertical-lr' });
    const library = createLibrary(path.join(root, 'raw'), dataRoot);

    const result = await runWithLang('en', () =>
      exportChapter({
        rootDir: root,
        rawRoot: path.join(root, 'raw'),
        dataRoot,
        exportRoot: path.join(root, 'exports'),
        config: config(),
        library,
      }),
    );

    const html = fs.readFileSync(path.join(root, 'exports', result.file), 'utf8');
    expect(html).toContain('Reading direction: left to right · vertical');
  });

  it('fails loudly for a missing chapter and for an empty export', async () => {
    const { root, dataRoot, library } = seedExportRoot();
    const exportRoot = path.join(root, 'exports');

    await expect(
      runWithLang('en', () =>
        exportChapter({
          rootDir: root,
          rawRoot: path.join(root, 'raw'),
          dataRoot,
          exportRoot,
          config: config({ chapter: 'missing' }),
          library,
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);

    let code = '';
    try {
      await runWithLang('en', () =>
        exportChapter({
          rootDir: root,
          rawRoot: path.join(root, 'raw'),
          dataRoot,
          exportRoot,
          config: config({ pageIndices: [1] }),
          library,
        }),
      );
    } catch (err) {
      code = err instanceof AppError ? err.code : 'unknown';
    }
    expect(code).toBe('ERR_EXPORT_EMPTY');
  });
});
