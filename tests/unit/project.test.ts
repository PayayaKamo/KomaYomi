import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLibrary } from '../../server/library.ts';
import {
  createProjectBuffer,
  importProject,
  inspectProject,
  mergePageDocs,
  projectFileName,
} from '../../server/project.ts';
import { createEmptyDoc, writePageDoc } from '../../server/storage.ts';
import { createZip, readZip } from '../../server/zip.ts';
import type { PageDoc } from '../../shared/types.ts';
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

const PNG_JA = solidPng(60, 90, 200);
const PNG_ZH = solidPng(60, 90, 120);

function pageDoc(volume: string, chapter: string, pageIndex = 0): PageDoc {
  const doc = createEmptyDoc(volume, chapter, pageIndex);
  return {
    ...doc,
    panels: [{ id: 'p1', rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, source: 'auto' }],
    notes: [
      {
        id: 'n1',
        scope: 'page',
        panelId: null,
        text: 'hello',
        tags: ['vocab'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

function seedProject(): string {
  const root = tempDir('project-src');
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'), PNG_JA);
  writeFile(path.join(root, 'raw', 'Vol1', 'zh', '172', '01.png'), PNG_ZH);
  writePageDoc(path.join(root, 'data'), pageDoc('Vol1', '172'));
  return root;
}

describe('projectFileName', () => {
  it('strips characters that are illegal on Windows', () => {
    expect(projectFileName('a/b:c*?"<>|d')).toBe('a-b-c-d');
    expect(projectFileName('  ')).toBe('project');
    expect(projectFileName('..hidden')).toBe('hidden');
  });
});

describe('mergePageDocs', () => {
  it('keeps local layout data and unions notes by id', () => {
    const existing: PageDoc = {
      ...pageDoc('Vol1', '172'),
      groups: [{ id: 'g1', name: 'group', panelIds: ['p1'] }],
      annotations: [
        {
          id: 'a1',
          kind: 'rect',
          scope: 'page',
          points: [{ x: 0.1, y: 0.1 }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      offsets: { ja: { x: 0.01, y: 0, scale: 1 } },
      panelOffsets: { p1: { ja: { x: 0, y: 0.02, scale: 1 } } },
    };
    const incoming: PageDoc = {
      ...pageDoc('Vol1', '172'),
      panels: [],
      notes: [
        {
          id: 'n1',
          scope: 'page',
          panelId: null,
          text: 'updated',
          tags: [],
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'n2',
          scope: 'panel',
          panelId: 'p1',
          text: 'second',
          tags: [],
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      readingDirection: 'ltr',
    };

    const merged = mergePageDocs(existing, incoming);
    expect(merged.panels).toEqual(existing.panels);
    expect(merged.annotations).toEqual(existing.annotations);
    expect(merged.groups).toEqual(existing.groups);
    expect(merged.offsets).toEqual(existing.offsets);
    expect(merged.panelOffsets).toEqual(existing.panelOffsets);
    expect(merged.readingDirection).toBe('ltr');
    expect(merged.notes.map((n) => [n.id, n.text])).toEqual([
      ['n1', 'updated'],
      ['n2', 'second'],
    ]);
  });
});

describe('project packaging', () => {
  it('packs pages, notes and de-duplicated image assets', () => {
    const root = seedProject();
    const { buffer, manifest, entries, warnings } = createProjectBuffer({
      rootDir: root,
      storageMode: 'packaged',
      name: '演示 工程',
    });

    expect(warnings).toEqual([]);
    // manifest + page + history + two de-duplicated images
    expect(entries).toBe(5);
    expect(manifest.storageMode).toBe('packaged');
    expect(manifest.name).toBe('演示 工程');
    expect(manifest.inventory.pageCount).toBe(1);
    expect(manifest.inventory.images).toHaveLength(2);
    expect(manifest.inventory.images.every((img) => img.asset?.startsWith('assets/'))).toBe(true);
    expect(manifest.notes).toMatchObject({ pages: 1, noteCount: 1 });
    expect(manifest.language.resolved.Vol1).toEqual({ ja: 'ja', zh: 'zh' });

    const names = readZip(buffer).map((e) => e.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('pages/Vol1/172/0.json');
    expect(names).toContain('history/Vol1/172/0.json');
    expect(names.filter((n) => n.startsWith('assets/'))).toHaveLength(2);
  });

  it('unpacks a packaged project into a fresh workspace', () => {
    const source = seedProject();
    const { buffer } = createProjectBuffer({ rootDir: source, storageMode: 'packaged' });
    const dest = tempDir('project-dest');

    const result = importProject({ rootDir: dest, buffer, snapshot: false });
    expect(result.storageMode).toBe('packaged');
    // page document + its version history file
    expect(result.restored).toBe(2);
    expect(result.imagesWritten).toBe(2);
    expect(result.missing).toEqual([]);
    expect(fs.existsSync(path.join(dest, 'raw', 'Vol1', 'ja', '172', '01.png'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'data', 'pages', 'Vol1', '172', '0.json'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'data', 'history', 'Vol1', '172', '0.json'))).toBe(true);

    const library = createLibrary(path.join(dest, 'raw'), path.join(dest, 'data'));
    expect(library.volumes[0].languages).toEqual(['ja', 'zh']);
    expect(library.volumes[0].chapters[0].pages).toHaveLength(1);

    const inspected = inspectProject({ rootDir: dest, buffer });
    expect(inspected).toMatchObject({
      storageMode: 'packaged',
      pages: 1,
      notes: 1,
      images: 2,
      volumes: ['Vol1'],
      chapters: 1,
      conflicts: [],
      conflictCount: 0,
      missingAssets: [],
    });
  });

  it('reports reference-mode images that are no longer in place, then relinks them', () => {
    const source = seedProject();
    const { buffer } = createProjectBuffer({ rootDir: source, storageMode: 'reference' });
    expect(readZip(buffer).some((e) => e.name.startsWith('assets/'))).toBe(false);

    const dest = tempDir('project-ref');
    const result = importProject({ rootDir: dest, buffer, snapshot: false });
    expect(result.storageMode).toBe('reference');
    expect(result.imagesPresent).toBe(0);
    expect(result.missing.map((m) => m.reason)).toEqual(['missing', 'missing']);
    expect(inspectProject({ rootDir: dest, buffer }).missingAssets).toHaveLength(2);

    const relinkSource = tempDir('project-relink');
    writeFile(path.join(relinkSource, 'ja', 'page.png'), PNG_JA);
    writeFile(path.join(relinkSource, 'zh', 'page.png'), PNG_ZH);

    const relinked = importProject({
      rootDir: tempDir('project-relinked'),
      buffer,
      snapshot: false,
      relinkDir: relinkSource,
    });
    expect(relinked.relinked).toBe(2);
    expect(relinked.imagesWritten).toBe(2);
    expect(relinked.missing).toEqual([]);
  });

  it('rejects archives without a manifest', () => {
    const root = tempDir('project-nomanifest');
    const buffer = createZip([{ name: 'pages/Vol1/172/0.json', data: Buffer.from('{}') }]);
    expect(() => inspectProject({ rootDir: root, buffer })).toThrow(/manifest/i);
  });
});
