import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cacheOverview, clearExportStaging, clearThumbCache, resetAutoPanels } from '../../server/cacheAdmin.ts';
import { readPageDoc, writePageDoc } from '../../server/storage.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';
import type { PageDoc } from '../../shared/types.ts';

const dirs: string[] = [];

function tempRoots(): { dataRoot: string; exportRoot: string } {
  const root = makeTempDir('cache-admin');
  dirs.push(root);
  return { dataRoot: path.join(root, 'data'), exportRoot: path.join(root, 'exports') };
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

const now = '2025-01-01T00:00:00.000Z';

function doc(): PageDoc {
  return {
    schemaVersion: 1,
    volume: 'v1',
    chapter: 'c1',
    pageIndex: 0,
    panels: [
      { id: 'p1', rect: { x: 0.1, y: 0.2, w: 0.4, h: 0.5 }, source: 'auto' },
      { id: 'p2', rect: { x: 0.5, y: 0.2, w: 0.4, h: 0.5 }, source: 'manual' },
    ],
    groups: [{ id: 'g1', name: 'Group', panelIds: ['p1', 'p2'] }],
    notes: [
      { id: 'n1', scope: 'panel', panelId: 'p1', text: 'keep me', tags: [], createdAt: now, updatedAt: now },
      { id: 'n2', scope: 'page', panelId: null, text: 'page note', tags: [], createdAt: now, updatedAt: now },
    ],
    offsets: {},
    panelOffsets: { p1: { ja: { x: 0, y: 0 } } },
    alignMode: 'page',
    readingDirection: 'rtl',
    annotations: [
      {
        id: 'a1',
        kind: 'rect',
        scope: 'panel',
        panelId: 'p1',
        points: [{ x: 0.5, y: 0.5 }],
        anchor: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
        createdAt: now,
        updatedAt: now,
      },
    ],
    updatedAt: now,
  } as PageDoc;
}

describe('cacheAdmin', () => {
  it('reports sizes for thumbnails, remote cache and export staging', () => {
    const { dataRoot, exportRoot } = tempRoots();
    writeFile(path.join(dataRoot, 'cache', 'thumbs', 'a.jpg'), '12345');
    writeFile(path.join(dataRoot, 'cache', 'remote', 'files', 'b.bin'), '123');
    writeFile(path.join(exportRoot, '.staging', 'job', 'c.png'), '1234567');

    const overview = cacheOverview(dataRoot, exportRoot);

    expect(overview.thumbs).toEqual({ bytes: 5, files: 1 });
    expect(overview.remote).toMatchObject({ bytes: 3, files: 1 });
    expect(overview.staging).toEqual({ bytes: 7, files: 1 });
  });

  it('clears thumbnails and staging without touching page data', () => {
    const { dataRoot, exportRoot } = tempRoots();
    writeFile(path.join(dataRoot, 'cache', 'thumbs', 'a.jpg'), '12345');
    writeFile(path.join(exportRoot, '.staging', 'job', 'c.png'), '1234567');
    writePageDoc(dataRoot, doc());
    const before = fs.readFileSync(path.join(dataRoot, 'pages', 'v1', 'c1', '0.json'), 'utf8');

    const thumbs = clearThumbCache(dataRoot);
    const staging = clearExportStaging(exportRoot);

    expect(thumbs).toEqual({ removed: 1, freed: 5 });
    expect(staging).toEqual({ removed: 1, freed: 7 });
    expect(fs.readFileSync(path.join(dataRoot, 'pages', 'v1', 'c1', '0.json'), 'utf8')).toBe(before);
  });

  it('removes auto panels while keeping notes, annotations and hand-drawn panels', () => {
    const { dataRoot, exportRoot } = tempRoots();
    writePageDoc(dataRoot, doc());
    expect(cacheOverview(dataRoot, exportRoot).detect).toMatchObject({ pages: 1, panels: 1, notes: 2, annotations: 1 });

    const result = resetAutoPanels(dataRoot);

    expect(result).toEqual({ pages: 1, panels: 1, notes: 1, annotations: 1, skipped: 0 });
    const next = readPageDoc(dataRoot, 'v1', 'c1', 0)!;
    expect(next.panels.map((panel) => panel.id)).toEqual(['p2']);
    expect(next.notes.find((note) => note.id === 'n1')).toMatchObject({ scope: 'page', panelId: null });
    expect(next.notes.find((note) => note.id === 'n2')).toMatchObject({ scope: 'page', text: 'page note' });
    // Panel-relative coordinates move into page space instead of pointing at a missing panel.
    const annotation = next.annotations?.[0];
    expect(annotation).toMatchObject({ scope: 'page', panelId: null });
    expect(annotation?.points[0].x).toBeCloseTo(0.3);
    expect(annotation?.points[0].y).toBeCloseTo(0.45);
    expect(annotation?.anchor?.x).toBeCloseTo(0.3);
    expect(annotation?.anchor?.y).toBeCloseTo(0.45);
    expect(annotation?.anchor?.w).toBeCloseTo(0.08);
    expect(annotation?.anchor?.h).toBeCloseTo(0.1);
    expect(next.groups).toEqual([{ id: 'g1', name: 'Group', panelIds: ['p2'] }]);
    expect(next.panelOffsets).toEqual({});
    expect(next.detectSource).toBeUndefined();
    expect(cacheOverview(dataRoot, exportRoot).detect.pages).toBe(0);
  });
});
