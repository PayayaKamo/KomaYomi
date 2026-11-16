import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../server/errors.ts';
import { readPageDoc, writePageDoc } from '../../server/storage.ts';
import type { PageDoc } from '../../shared/types.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];
const savedLimit = process.env.KOMAYOMI_PAGE_BACKUPS;

function tempRoot(): string {
  const root = makeTempDir('page-safety');
  dirs.push(root);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
  if (savedLimit === undefined) delete process.env.KOMAYOMI_PAGE_BACKUPS;
  else process.env.KOMAYOMI_PAGE_BACKUPS = savedLimit;
});

function page(volume: string, chapter: string, note?: string): PageDoc {
  return {
    volume,
    chapter,
    pageIndex: 0,
    panels: [],
    notes: note
      ? [
          {
            id: 'n1',
            scope: 'page',
            text: note,
            type: 'text',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        ]
      : [],
    offsets: {},
    panelOffsets: {},
    alignMode: 'page',
    readingDirection: 'rtl',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as PageDoc;
}

function expectCode(fn: () => unknown, code: string, status?: number): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const appError = err as AppError;
    expect(appError.code).toBe(code);
    if (status) expect(appError.status).toBe(status);
    return appError;
  }
  throw new Error(`expected ${code}`);
}

const pageFile = (root: string) => path.join(root, 'pages', 'Vol1', 'ch1', '0.json');
const archivedFiles = (file: string) =>
  fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith(`${path.basename(file)}.corrupt-`));
const noteText = (file: string) => (JSON.parse(fs.readFileSync(file, 'utf8')) as PageDoc).notes[0]?.text;

describe('atomic page writes', () => {
  it('keeps the previous document intact and cleans the temp file when the write fails', () => {
    const root = tempRoot();
    const file = pageFile(root);
    writePageDoc(root, page('Vol1', 'ch1', 'first'));

    // A directory squatting on the temp path makes the data write fail (EISDIR on POSIX,
    // EPERM/EISDIR on Windows) without mocking the fs module.
    fs.mkdirSync(`${file}.tmp-${process.pid}`);

    expect(() => writePageDoc(root, page('Vol1', 'ch1', 'second'))).toThrow();

    // The published file still holds the last good revision, byte for byte.
    expect(noteText(file)).toBe('first');
    expect(fs.existsSync(`${file}.tmp-${process.pid}`)).toBe(false);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });
});

describe('schema validation before save', () => {
  it('rejects an invalid document without touching the previous file', () => {
    const root = tempRoot();
    const file = pageFile(root);
    const good = writePageDoc(root, page('Vol1', 'ch1', 'keep'));
    const before = fs.readFileSync(file, 'utf8');

    const bad = {
      ...good,
      annotations: [
        {
          id: 'a1',
          kind: 'not-a-real-kind',
          scope: 'page',
          panelId: null,
          points: [{ x: 0.1, y: 0.1 }],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    } as unknown as PageDoc;

    const error = expectCode(() => writePageDoc(root, bad), 'ERR_PAGE_SAVE_INVALID', 422);
    expect(error.message).toMatch(/kind|annotation/i);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('page backups', () => {
  it('keeps the previous revisions and rotates them within the configured limit', () => {
    process.env.KOMAYOMI_PAGE_BACKUPS = '2';
    const root = tempRoot();
    const file = pageFile(root);

    writePageDoc(root, page('Vol1', 'ch1', 'one'));
    writePageDoc(root, page('Vol1', 'ch1', 'two'));
    writePageDoc(root, page('Vol1', 'ch1', 'three'));

    expect(noteText(file)).toBe('three');
    expect(noteText(`${file}.bak`)).toBe('two');
    expect(noteText(`${file}.bak.1`)).toBe('one');
    expect(fs.existsSync(`${file}.bak.2`)).toBe(false);
  });
});

describe('damaged page recovery', () => {
  it('reports the failed check and backup path, and archives the damaged file', () => {
    const root = tempRoot();
    const file = pageFile(root);
    writePageDoc(root, page('Vol1', 'ch1', 'recover-me'));
    fs.copyFileSync(file, `${file}.bak`);
    writeFile(file, '{ "truncated": ');

    const error = expectCode(() => readPageDoc(root, 'Vol1', 'ch1', 0), 'ERR_PAGE_CORRUPT', 422);
    expect(error.message).toMatch(/JSON (parse failed|解析失败|解析に失敗)/);
    expect(error.message).toContain('0.json.bak');

    // The damaged bytes are archived automatically; the page can now be rebuilt.
    expect(fs.existsSync(file)).toBe(false);
    const archived = archivedFiles(file);
    expect(archived).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(file), archived[0]), 'utf8')).toBe('{ "truncated": ');
    expect(readPageDoc(root, 'Vol1', 'ch1', 0)).toBeNull();
    expect(archivedFiles(file)).toHaveLength(1);
  });

  it('survives a full rebuild after damage without losing the last good backup', () => {
    const root = tempRoot();
    const file = pageFile(root);
    writePageDoc(root, page('Vol1', 'ch1', 'old-note'));
    writePageDoc(root, page('Vol1', 'ch1', 'new-note'));
    expect(noteText(`${file}.bak`)).toBe('old-note');

    writeFile(file, '\u0000\u0000garbage');
    expectCode(() => readPageDoc(root, 'Vol1', 'ch1', 0), 'ERR_PAGE_CORRUPT', 422);

    // Re-import / rebuild writes a fresh page; the pre-damage backup is still there.
    writePageDoc(root, page('Vol1', 'ch1', 'rebuilt'));
    expect(noteText(file)).toBe('rebuilt');
    expect(noteText(`${file}.bak`)).toBe('old-note');
    expect(archivedFiles(file)).toHaveLength(1);
  });
});

describe('concurrent writes', () => {
  it('refuses to write while another process holds the lock', () => {
    const root = tempRoot();
    const file = pageFile(root);
    writePageDoc(root, page('Vol1', 'ch1', 'base'));
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(`${file}.lock`, '99999');

    expectCode(() => writePageDoc(root, page('Vol1', 'ch1', 'blocked')), 'ERR_PAGE_BUSY', 409);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);

    fs.rmSync(`${file}.lock`);
    writePageDoc(root, page('Vol1', 'ch1', 'after'));
    expect(noteText(file)).toBe('after');
  });

  it('reclaims a stale lock left by a crashed writer', () => {
    const root = tempRoot();
    const file = pageFile(root);
    writePageDoc(root, page('Vol1', 'ch1', 'base'));

    fs.writeFileSync(`${file}.lock`, '99999');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(`${file}.lock`, old, old);

    writePageDoc(root, page('Vol1', 'ch1', 'recovered'));
    expect(noteText(file)).toBe('recovered');
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });
});
