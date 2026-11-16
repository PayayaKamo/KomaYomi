import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPreprocess, restorePreprocess } from '../../server/preprocess.ts';
import { createLibrary, readLibraryConfig } from '../../server/library.ts';
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

  it('resolves a volume nested under a series folder', () => {
    const root = makeTempDir('preprocess-nested');
    dirs.push(root);
    writeFiles(root, [
      'raw/Series/Vol1/ja/199/01.png',
      'raw/Series/Vol1/zh-hk/199/01.webp',
      'raw/Series/Vol1/extras/199/01.png',
    ]);
    const rawRoot = path.join(root, 'raw');
    const dataRoot = path.join(root, 'data');

    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', dirs: { ja: 'ja', zh: 'zh-hk' } });
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toEqual({ ja: 'ja', zh: 'zh-hk' });
    const volume = createLibrary(rawRoot, dataRoot).volumes.find((v) => v.id === 'Vol1');
    expect(volume?.langDirs).toMatchObject({ ja: 'ja', zh: 'zh-hk' });

    // Directory names are checked against the nested volume folder.
    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', dirs: { ja: 'extras' } });
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toEqual({ ja: 'extras' });
    expect(() => applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', dirs: { ja: 'nope' } })).not.toThrow();
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toBeUndefined();
  });
});

describe('restorePreprocess', () => {
  it('rolls the volume config back to the state before the last apply', () => {
    const { rawRoot, dataRoot } = seed();
    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', title: 'First' });
    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', title: 'Second', chapters: { '01': { excluded: [0] } } });
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.title).toBe('Second');

    restorePreprocess(dataRoot, 'Vol1');
    const entry = readLibraryConfig(dataRoot).volumes?.Vol1;
    expect(entry?.title).toBe('First');
    expect(entry?.chapters).toBeUndefined();
    expect(fs.existsSync(path.join(dataRoot, 'preprocess-backup.json'))).toBe(false);
    expect(() => restorePreprocess(dataRoot, 'Vol1')).toThrow();
  });

  it('removes a volume entry that had no config before the apply', () => {
    const { rawRoot, dataRoot } = seed();
    applyPreprocess(rawRoot, dataRoot, { volume: 'Vol1', title: 'First' });
    restorePreprocess(dataRoot, 'Vol1');
    expect(readLibraryConfig(dataRoot).volumes?.Vol1).toBeUndefined();
  });
});
