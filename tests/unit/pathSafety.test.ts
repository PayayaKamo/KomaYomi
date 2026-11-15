import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeSegment, resolveWithin, safeSegment } from '../../server/pathSafety.ts';
import { pageFilePath, readPageDoc, writePageDoc } from '../../server/storage.ts';
import { historyFilePath, readHistory, recordVersion } from '../../server/pageHistory.ts';
import { requireChapter, requirePage, requireVolume } from '../../server/pageTargets.ts';
import { AppError } from '../../server/errors.ts';
import type { Library, PageDoc } from '../../shared/types.ts';
import { makeTempDir, removeDir } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempRoot(): string {
  const root = makeTempDir('paths');
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

const expectAppError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

const library: Library = {
  root: '/raw',
  languages: ['ja', 'zh', 'en'],
  langOrder: ['ja', 'zh', 'en'],
  volumes: [
    {
      id: 'vol1',
      title: 'vol1',
      chapters: [
        {
          id: 'vol1/ch1',
          volume: 'vol1',
          chapter: 'ch1',
          pages: [{ index: 0, files: {}, filenames: {}, warnings: [] }],
          warnings: [],
        },
      ],
      warnings: [],
      langDirs: {},
      languages: ['ja'],
      dirs: [],
    },
  ],
};

describe('segment validation', () => {
  it('accepts plain directory names and rejects traversal or separators', () => {
    expect(safeSegment('vol1')).toBe('vol1');
    expect(safeSegment('第14巻')).toBe('第14巻');
    expect(safeSegment('..')).toBeNull();
    expect(safeSegment('.')).toBeNull();
    expect(safeSegment('')).toBeNull();
    expect(safeSegment('..\\escape')).toBeNull();
    expect(safeSegment('../escape')).toBeNull();
    expect(safeSegment('a/b')).toBeNull();
    expect(safeSegment('a\\b')).toBeNull();
    expect(safeSegment('C:evil')).toBeNull();
    expect(safeSegment('in|valid')).toBeNull();
  });

  it('throws the structured error for unsafe segments', () => {
    expectAppError(() => assertSafeSegment('../x', 'volume'), 'ERR_UNSAFE_SEGMENT');
  });

  it('refuses to resolve a path outside the root', () => {
    const root = tempRoot();
    expectAppError(() => resolveWithin(root, '..', 'outside'), 'ERR_PATH_ESCAPE');
    expect(resolveWithin(root, 'pages', 'vol1')).toBe(path.join(root, 'pages', 'vol1'));
  });
});

describe('page and history file paths', () => {
  it('builds paths below the data root for valid targets', () => {
    const root = tempRoot();
    expect(pageFilePath(root, 'vol1', 'ch1', 3)).toBe(path.join(root, 'pages', 'vol1', 'ch1', '3.json'));
    expect(historyFilePath(root, 'vol1', 'ch1', 3)).toBe(path.join(root, 'history', 'vol1', 'ch1', '3.json'));
  });

  it.each([
    ['..', 'ch1'],
    ['../../escape', 'ch1'],
    ['/etc', 'ch1'],
    ['C:\\Windows', 'ch1'],
    ['vol1', '..'],
    ['vol1', 'a/b'],
    ['', 'ch1'],
    ['vol1', ''],
  ])('rejects page paths for volume=%j chapter=%j', (volume, chapter) => {
    const root = tempRoot();
    expectAppError(() => pageFilePath(root, volume, chapter, 0), 'ERR_UNSAFE_SEGMENT');
    expectAppError(() => historyFilePath(root, volume, chapter, 0), 'ERR_UNSAFE_SEGMENT');
  });

  it('rejects a negative or fractional page index', () => {
    const root = tempRoot();
    expectAppError(() => pageFilePath(root, 'vol1', 'ch1', -1), 'ERR_PAGE_INDEX_INVALID');
    expectAppError(() => pageFilePath(root, 'vol1', 'ch1', 1.5), 'ERR_PAGE_INDEX_INVALID');
  });

  it('never writes outside the data root for a traversal target', () => {
    const root = tempRoot();
    const dataRoot = path.join(root, 'data');
    fs.mkdirSync(dataRoot, { recursive: true });
    expectAppError(() => writePageDoc(dataRoot, page('..', 'pwned')), 'ERR_UNSAFE_SEGMENT');
    expect(fs.existsSync(path.join(root, 'pwned', '0.json'))).toBe(false);
  });

  it('rejects history reads and writes for traversal targets', () => {
    const root = tempRoot();
    expectAppError(() => readHistory(root, '..', 'pwned', 0), 'ERR_UNSAFE_SEGMENT');
    expectAppError(() => recordVersion(root, page('..', 'pwned'), null, { source: 'auto' }), 'ERR_UNSAFE_SEGMENT');
  });

  it('keeps ordinary reads and writes working', () => {
    const root = tempRoot();
    const saved = writePageDoc(root, page('vol1', 'ch1'), { source: 'manual' });
    expect(saved.volume).toBe('vol1');
    expect(readPageDoc(root, 'vol1', 'ch1', 0)?.volume).toBe('vol1');
    expect(readHistory(root, 'vol1', 'ch1', 0)).toHaveLength(1);
  });
});

describe('library membership', () => {
  it('accepts volumes, chapters and pages that exist', () => {
    expect(requireVolume(library, 'vol1').id).toBe('vol1');
    expect(requireChapter(library, 'vol1', 'ch1').chapter).toBe('ch1');
    expect(requirePage(library, 'vol1', 'ch1', 0).page.index).toBe(0);
  });

  it('rejects unknown and traversal targets', () => {
    expectAppError(() => requireVolume(library, 'nope'), 'ERR_VOLUME_NOT_FOUND');
    expectAppError(() => requireChapter(library, 'vol1', 'nope'), 'ERR_CHAPTER_NOT_FOUND');
    expectAppError(() => requirePage(library, 'vol1', 'ch1', 9), 'ERR_PAGE_NOT_FOUND');
    expectAppError(() => requireChapter(library, '..', 'ch1'), 'ERR_VOLUME_NOT_FOUND');
    expectAppError(() => requireChapter(library, 'vol1', '../ch1'), 'ERR_CHAPTER_NOT_FOUND');
  });
});
