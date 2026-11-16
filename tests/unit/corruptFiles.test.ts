import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { startMangaServer } from '../../server/app.ts';
import { AppError } from '../../server/errors.ts';
import { readLibraryConfig, writeLibraryConfig } from '../../server/library.ts';
import { listVersions, readHistory, recordVersion } from '../../server/pageHistory.ts';
import { readPageDoc, writePageDoc } from '../../server/storage.ts';
import type { PageDoc } from '../../shared/types.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempRoot(): string {
  const root = makeTempDir('corrupt');
  dirs.push(root);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function page(volume: string, chapter: string, pageIndex = 0): PageDoc {
  return {
    volume,
    chapter,
    pageIndex,
    panels: [],
    notes: [],
    offsets: {},
    panelOffsets: {},
    alignMode: 'page',
    readingDirection: 'rtl',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as PageDoc;
}

const expectCode = (fn: () => unknown, code: string, status?: number) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    if (status) expect((err as AppError).status).toBe(status);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe('damaged page files', () => {
  it('treats a missing page as empty but reports a damaged one', () => {
    const root = tempRoot();
    expect(readPageDoc(root, 'Vol1', 'ch1', 0)).toBeNull();

    const file = path.join(root, 'pages', 'Vol1', 'ch1', '0.json');
    writeFile(file, '{ this is not json');
    expectCode(() => readPageDoc(root, 'Vol1', 'ch1', 0), 'ERR_PAGE_CORRUPT', 422);

    // Damaged bytes are archived automatically instead of waiting for the user to delete them.
    expect(fs.existsSync(file)).toBe(false);
    const archived = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith('0.json.corrupt-'));
    expect(archived).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(file), archived[0]), 'utf8')).toBe('{ this is not json');
  });

  it('keeps a .corrupt.bak copy when a write replaces the damaged file', () => {
    const root = tempRoot();
    const file = path.join(root, 'pages', 'Vol1', 'ch1', '0.json');
    writeFile(file, '{ broken');
    const saved = writePageDoc(root, page('Vol1', 'ch1'), { source: 'manual' });

    expect(saved.volume).toBe('Vol1');
    expect(fs.readFileSync(`${file}.corrupt.bak`, 'utf8')).toBe('{ broken');
    expect(readPageDoc(root, 'Vol1', 'ch1', 0)?.volume).toBe('Vol1');

    // A later save must not replace the first damaged copy.
    writeFile(file, '{ broken again');
    writePageDoc(root, page('Vol1', 'ch1'), { source: 'manual' });
    expect(fs.readFileSync(`${file}.corrupt.bak`, 'utf8')).toBe('{ broken');
  });

  it('reads a page file that an editor saved with a UTF-8 BOM', () => {
    const root = tempRoot();
    const file = path.join(root, 'pages', 'Vol1', 'ch1', '0.json');
    writeFile(file, `\ufeff${JSON.stringify(page('Vol1', 'ch1'))}`);

    expect(readPageDoc(root, 'Vol1', 'ch1', 0)?.volume).toBe('Vol1');
  });
});

describe('damaged history files', () => {
  it('reports damage on read and salvages it before the next snapshot', () => {
    const root = tempRoot();
    recordVersion(root, page('Vol1', 'ch1'), null, { source: 'manual' });
    const file = path.join(root, 'history', 'Vol1', 'ch1', '0.json');
    writeFile(file, '[not-an-object');

    expectCode(() => readHistory(root, 'Vol1', 'ch1', 0), 'ERR_HISTORY_CORRUPT', 422);
    expectCode(() => listVersions(root, 'Vol1', 'ch1', 0), 'ERR_HISTORY_CORRUPT', 422);

    // Saving the page still works, keeps the damaged file, and starts a fresh chain.
    const entry = recordVersion(root, page('Vol1', 'ch1'), null, { source: 'manual' });
    expect(entry).not.toBeNull();
    expect(fs.readFileSync(`${file}.corrupt.bak`, 'utf8')).toBe('[not-an-object');
    expect(readHistory(root, 'Vol1', 'ch1', 0)).toHaveLength(1);
  });
});

describe('damaged library config', () => {
  it('reports damage instead of resetting to defaults', () => {
    const root = tempRoot();
    writeLibraryConfig(root, { historyLimit: 30 });
    expect(readLibraryConfig(root).historyLimit).toBe(30);

    const file = path.join(root, 'library.json');
    writeFile(file, '{ broken config');

    expectCode(() => readLibraryConfig(root), 'ERR_LIBRARY_CONFIG_CORRUPT', 500);
    writeLibraryConfig(root, { historyLimit: 45 });
    expect(fs.readFileSync(`${file}.corrupt.bak`, 'utf8')).toBe('{ broken config');
    expect(readLibraryConfig(root).historyLimit).toBe(45);
  });
});

describe('live HTTP behaviour', () => {
  const root = makeTempDir('corrupt-http');
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', 'ch1', '001.jpg'), 'not-an-image');
  const pageFile = path.join(root, 'data', 'pages', 'Vol1', 'ch1', '0.json');
  writeFile(pageFile, '{ damaged');
  let server: http.Server | undefined;
  let port = 0;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  afterAll(() => removeDir(root));

  it('returns 422 with a recovery hint and still preserves the file on save', async () => {
    ({ server, port } = await startMangaServer(root, 0));

    const resp = await fetch(`http://127.0.0.1:${port}/api/page?volume=Vol1&chapter=ch1&index=0`);
    expect(resp.status).toBe(422);
    const body = (await resp.json()) as { code: string; error: string };
    expect(body.code).toBe('ERR_PAGE_CORRUPT');
    expect(body.error).toMatch(/backup|备份|バックアップ/i);
    // The damaged file was archived automatically and the response named the archive.
    expect(fs.existsSync(pageFile)).toBe(false);
    const archived = fs
      .readdirSync(path.dirname(pageFile))
      .filter((name) => name.startsWith(`${path.basename(pageFile)}.corrupt-`));
    expect(archived).toHaveLength(1);
    expect(body.error).toContain(archived[0]);
    expect(fs.readFileSync(path.join(path.dirname(pageFile), archived[0]), 'utf8')).toBe('{ damaged');

    const save = await fetch(`http://127.0.0.1:${port}/api/page`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ volume: 'Vol1', chapter: 'ch1', pageIndex: 0, panels: [], notes: [] }),
    });
    expect(save.status).toBe(200);
    expect(readPageDoc(path.join(root, 'data'), 'Vol1', 'ch1', 0)?.volume).toBe('Vol1');
    expect(fs.readdirSync(path.dirname(pageFile))).toContain(archived[0]);
  });
});
