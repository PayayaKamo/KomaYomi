import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renameChapterFiles, splitPage } from '../../server/fileOps.ts';
import { applyPreprocess } from '../../server/preprocess.ts';
import { createLibrary, readLibraryConfig } from '../../server/library.ts';
import { historyFilePath } from '../../server/pageHistory.ts';
import { createEmptyDoc, pageFilePath, readPageDoc, writePageDoc } from '../../server/storage.ts';
import { makeTempDir, removeDir, writeFile, writeFiles } from '../helpers/tmp.ts';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function seed(files: string[]): { root: string; rawRoot: string; dataRoot: string } {
  const root = makeTempDir('fileops');
  dirs.push(root);
  writeFiles(root, files);
  return { root, rawRoot: path.join(root, 'raw'), dataRoot: path.join(root, 'data') };
}

function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200;
    data[i + 1] = 40;
    data[i + 2] = 40;
    data[i + 3] = 255;
  }
  const png = new PNG({ width, height });
  png.data = data;
  return PNG.sync.write(png);
}

describe('renameChapterFiles', () => {
  it('renames every complete language and moves page data, history and overrides', () => {
    const { rawRoot, dataRoot } = seed([
      'raw/Vol1/ja/01/01.jpg',
      'raw/Vol1/ja/01/02.jpg',
      'raw/Vol1/ja/01/03.jpg',
      'raw/Vol1/zh/01/01.jpg',
      'raw/Vol1/zh/01/02.jpg',
      'raw/Vol1/zh/01/03.jpg',
    ]);
    applyPreprocess(rawRoot, dataRoot, {
      volume: 'Vol1',
      chapters: { '01': { order: [2, 0, 1], excluded: [1], kinds: { 2: 'cover' } } },
    });

    const first = createEmptyDoc('Vol1', '01', 0);
    first.notes.push({
      id: 'n1',
      scope: 'page',
      panelId: null,
      text: 'cover note',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    writePageDoc(dataRoot, first);
    writeFile(
      historyFilePath(dataRoot, 'Vol1', '01', 1),
      JSON.stringify({ pageIndex: 1, entries: [{ doc: { pageIndex: 1 } }] }),
    );

    const result = renameChapterFiles(rawRoot, dataRoot, {
      volume: 'Vol1',
      chapter: '01',
      start: 1,
      padding: 3,
      order: [2, 0, 1],
    });

    expect(result.files).toBe(6);
    // One page document plus the two history files that exist for this chapter.
    expect(result.docs).toBe(3);
    expect(result.skipped).toEqual([]);
    for (const lang of ['ja', 'zh']) {
      const names = fs.readdirSync(path.join(rawRoot, 'Vol1', lang, '01')).sort();
      expect(names).toEqual(['001.jpg', '002.jpg', '003.jpg']);
    }

    // Old page 0 moves to position 1 and keeps its note.
    const moved = readPageDoc(dataRoot, 'Vol1', '01', 1);
    expect(moved?.pageIndex).toBe(1);
    expect(moved?.notes.map((note) => note.text)).toEqual(['cover note']);
    expect(fs.existsSync(pageFilePath(dataRoot, 'Vol1', '01', 0))).toBe(false);

    // History follows its page and is rewritten to the new index.
    const history = JSON.parse(fs.readFileSync(historyFilePath(dataRoot, 'Vol1', '01', 2), 'utf8'));
    expect(history.pageIndex).toBe(2);
    expect(history.entries[0].doc.pageIndex).toBe(2);

    // Overrides are remapped with the same old -> new mapping.
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.chapters?.['01']).toEqual({
      order: [0, 1, 2],
      excluded: [2],
      kinds: { 0: 'cover' },
    });

    const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, result.manifest), 'utf8'));
    expect(manifest.status).toBe('applied');
    expect(manifest.files).toHaveLength(6);
    expect(createLibrary(rawRoot, dataRoot).volumes[0].chapters[0].pages).toHaveLength(3);
  });

  it('leaves incomplete languages alone and reports them', () => {
    const { rawRoot, dataRoot } = seed(['raw/Vol1/ja/01/01.jpg', 'raw/Vol1/ja/01/02.jpg', 'raw/Vol1/zh/01/01.jpg']);

    const result = renameChapterFiles(rawRoot, dataRoot, { volume: 'Vol1', chapter: '01' });

    expect(result.files).toBe(2);
    expect(result.skipped).toEqual(['zh']);
    expect(fs.readdirSync(path.join(rawRoot, 'Vol1', 'ja', '01')).sort()).toEqual(['001.jpg', '002.jpg']);
    expect(fs.readdirSync(path.join(rawRoot, 'Vol1', 'zh', '01')).sort()).toEqual(['01.jpg']);
  });

  it('rejects an order that is not a permutation and changes nothing', () => {
    const { rawRoot, dataRoot } = seed(['raw/Vol1/ja/01/01.jpg', 'raw/Vol1/ja/01/02.jpg']);

    expect(() => renameChapterFiles(rawRoot, dataRoot, { volume: 'Vol1', chapter: '01', order: [0, 0] })).toThrow(
      /every page/,
    );
    expect(fs.readdirSync(path.join(rawRoot, 'Vol1', 'ja', '01')).sort()).toEqual(['01.jpg', '02.jpg']);
    expect(fs.existsSync(path.join(dataRoot, 'file-ops'))).toBe(false);
  });

  it('rolls the disk back when a rename fails midway', () => {
    const { rawRoot, dataRoot } = seed(['raw/Vol1/ja/01/01.jpg', 'raw/Vol1/ja/01/02.jpg', 'raw/Vol1/ja/01/03.jpg']);
    const native = fs.renameSync.bind(fs);
    let failed = false;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (!failed && String(to).endsWith('002.jpg')) {
        failed = true;
        throw new Error('disk full');
      }
      native(from, to);
    });

    try {
      expect(() => renameChapterFiles(rawRoot, dataRoot, { volume: 'Vol1', chapter: '01' })).toThrow();
    } finally {
      spy.mockRestore();
    }

    expect(fs.readdirSync(path.join(rawRoot, 'Vol1', 'ja', '01')).sort()).toEqual(['01.jpg', '02.jpg', '03.jpg']);
    const manifests = fs.readdirSync(path.join(dataRoot, 'file-ops'));
    expect(manifests).toHaveLength(1);
    const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'file-ops', manifests[0]), 'utf8'));
    expect(manifest.status).toBe('rolled-back');
  });
});

describe('splitPage', () => {
  it('cuts the image, inserts the next page and clips the page document', () => {
    const { rawRoot, dataRoot } = seed(['raw/Vol1/ja/01/01.png', 'raw/Vol1/ja/01/02.png']);
    writeFile(path.join(rawRoot, 'Vol1', 'ja', '01', '01.png'), png(4, 2));
    writeFile(path.join(rawRoot, 'Vol1', 'ja', '01', '02.png'), png(2, 2));

    const doc = createEmptyDoc('Vol1', '01', 0);
    doc.readingDirection = 'ltr';
    doc.panels = [
      { id: 'p1', rect: { x: 0, y: 0, w: 0.5, h: 1 } },
      { id: 'p2', rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    ];
    doc.notes = [
      {
        id: 'page-note',
        scope: 'page',
        panelId: null,
        text: 'whole spread',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'panel-note',
        scope: 'panel',
        panelId: 'p1',
        text: 'left panel',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    doc.annotations = [
      {
        id: 'a1',
        kind: 'rect',
        scope: 'panel',
        panelId: 'p1',
        points: [{ x: 0.1, y: 0.2 }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    writePageDoc(dataRoot, doc);

    const second = createEmptyDoc('Vol1', '01', 1);
    second.notes.push({
      id: 'second-note',
      scope: 'page',
      panelId: null,
      text: 'second page',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    writePageDoc(dataRoot, second);
    writeFile(
      historyFilePath(dataRoot, 'Vol1', '01', 1),
      JSON.stringify({ pageIndex: 1, entries: [{ doc: { pageIndex: 1 } }] }),
    );

    const result = splitPage(rawRoot, dataRoot, {
      volume: 'Vol1',
      chapter: '01',
      pageIndex: 0,
      axis: 'vertical',
      ratio: 0.5,
    });

    expect(result.pageIndex).toBe(0);
    expect(result.languages).toEqual(['ja']);
    const names = fs.readdirSync(path.join(rawRoot, 'Vol1', 'ja', '01')).sort();
    expect(names).toEqual(['01-a.png', '01-b.png', '02.png']);
    expect(PNG.sync.read(fs.readFileSync(path.join(rawRoot, 'Vol1', 'ja', '01', '01-a.png'))).width).toBe(2);
    expect(PNG.sync.read(fs.readFileSync(path.join(rawRoot, 'Vol1', 'ja', '01', '01-b.png'))).width).toBe(2);

    const left = readPageDoc(dataRoot, 'Vol1', '01', 0);
    expect(left?.readingDirection).toBe('ltr');
    expect(left?.panels.map((panel) => panel.id)).toEqual(['p1']);
    expect(left?.notes.map((note) => note.text).sort()).toEqual(['left panel', 'whole spread']);
    expect(left?.annotations).toHaveLength(1);
    expect(left?.annotations?.[0].points[0]).toEqual({ x: 0.2, y: 0.2 });

    const right = readPageDoc(dataRoot, 'Vol1', '01', 1);
    expect(right?.readingDirection).toBe('ltr');
    expect(right?.panels.map((panel) => panel.id)).toEqual(['p2']);
    expect(right?.notes).toEqual([]);
    expect(right?.annotations ?? []).toEqual([]);

    const shifted = readPageDoc(dataRoot, 'Vol1', '01', 2);
    expect(shifted?.notes.map((note) => note.text)).toEqual(['second page']);
    const history = JSON.parse(fs.readFileSync(historyFilePath(dataRoot, 'Vol1', '01', 2), 'utf8'));
    expect(history.pageIndex).toBe(2);

    const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, result.manifest), 'utf8'));
    expect(manifest.status).toBe('applied');
    expect(manifest.op).toBe('split');
    expect(fs.existsSync(path.join(dataRoot, manifest.backup, 'ja', '01.png'))).toBe(true);
    expect(createLibrary(rawRoot, dataRoot).volumes[0].chapters[0].pages).toHaveLength(3);
  });

  it('refuses a split whose new name already exists', () => {
    const { rawRoot, dataRoot } = seed(['raw/Vol1/ja/01/cover-a.png', 'raw/Vol1/ja/01/cover.png']);
    writeFile(path.join(rawRoot, 'Vol1', 'ja', '01', 'cover-a.png'), png(2, 2));
    writeFile(path.join(rawRoot, 'Vol1', 'ja', '01', 'cover.png'), png(4, 2));
    const index = createLibrary(rawRoot, dataRoot).volumes[0].chapters[0].pages.find((page) => page.index === 1)?.index;
    expect(index).toBe(1);

    expect(() => splitPage(rawRoot, dataRoot, { volume: 'Vol1', chapter: '01', pageIndex: 1, ratio: 0.5 })).toThrow(
      /already exists/,
    );
    expect(fs.readdirSync(path.join(rawRoot, 'Vol1', 'ja', '01')).sort()).toEqual(['cover-a.png', 'cover.png']);
  });
});
