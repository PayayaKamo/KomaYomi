import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPreprocess } from '../../server/preprocess.ts';
import { readLibraryConfig } from '../../server/library.ts';
import { makeTempDir, removeDir, writeFiles } from '../helpers/tmp.ts';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function seed(): { rawRoot: string; dataRoot: string } {
  const root = makeTempDir('preprocess');
  dirs.push(root);
  writeFiles(root, ['raw/Vol1/ja/01/01.png', 'raw/Vol1/zh/01/01.png', 'raw/Vol1/fr/01/01.png']);
  return { rawRoot: path.join(root, 'raw'), dataRoot: path.join(root, 'data') };
}

describe('applyPreprocess', () => {
  it('maps language folders and clears the mapping when the input is empty', () => {
    const { rawRoot, dataRoot } = seed();

    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', dirs: { ja: 'ja', fr: 'zh' } });
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toEqual({ ja: 'ja', fr: 'zh' });
    expect(fs.existsSync(path.join(dataRoot, 'preprocess-backup.json'))).toBe(true);

    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', dirs: {} });
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toBeUndefined();
  });

  it('drops cleared page order, exclusions and roles instead of restoring them', () => {
    const { rawRoot, dataRoot } = seed();
    const chapter = { title: 'Intro', order: [1, 0], excluded: [0], kinds: { 0: 'cover' } };

    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', chapters: { '01': chapter } });
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.chapters?.['01']).toEqual(chapter);

    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', chapters: { '01': {} } });
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.chapters?.['01']).toEqual({});
  });

  it('rejects a volume that is not on disk', () => {
    const { rawRoot, dataRoot } = seed();
    expect(() => applyPreprocess(rawRoot, dataRoot, { volume: 'Missing' })).toThrow();
  });
});
