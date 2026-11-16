import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addVolume,
  removeVolume,
  setChapterHidden,
  setChapterPageOffsets,
  setVolumeDefaultDirection,
  setVolumeDirs,
} from '../../server/libraryAdmin.ts';
import { createLibrary, readLibraryConfig, writeLibraryConfig } from '../../server/library.ts';
import { AppError } from '../../server/errors.ts';
import { runWithLang, t } from '../../server/messages/index.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempRoot(): { root: string; rawRoot: string; dataRoot: string; external: string } {
  const root = makeTempDir('library-admin');
  dirs.push(root);
  const rawRoot = path.join(root, 'raw');
  const dataRoot = path.join(root, 'data');
  const external = path.join(root, 'external');
  fs.mkdirSync(rawRoot, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(external, { recursive: true });
  return { root, rawRoot, dataRoot, external };
}

const inEn = <T>(fn: () => T): T => runWithLang('en', fn);

function expectAppError(fn: () => unknown, code: string, status: number): void {
  try {
    fn();
    throw new Error(`expected ${code} to be thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const appErr = err as AppError;
    expect(appErr.code).toBe(code);
    expect(appErr.status).toBe(status);
  }
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

describe('addVolume', () => {
  it('creates an empty directory for a name-only volume and warns', () => {
    const { rawRoot } = tempRoot();
    const res = inEn(() => addVolume(rawRoot, undefined, '  New Volume  '));

    expect(res.added).toEqual(['New Volume']);
    expect(res.warnings).toEqual([inEn(() => t('WARN_EMPTY_VOLUME_CREATED'))]);
    expect(fs.statSync(path.join(rawRoot, 'New Volume')).isDirectory()).toBe(true);
  });

  it('reports an existing same-name directory instead of failing', () => {
    const { rawRoot } = tempRoot();
    inEn(() => addVolume(rawRoot, undefined, 'Vol1'));
    const res = inEn(() => addVolume(rawRoot, undefined, 'Vol1'));

    expect(res.added).toEqual(['Vol1']);
    expect(res.warnings).toEqual([inEn(() => t('WARN_SAME_NAME_VOLUME'))]);
  });

  it('rejects empty and illegal directory names', () => {
    const { rawRoot } = tempRoot();
    expectAppError(() => inEn(() => addVolume(rawRoot, undefined, '   ')), 'ERR_DIR_NAME_EMPTY', 400);
    expectAppError(() => inEn(() => addVolume(rawRoot, undefined, 'bad/name')), 'ERR_DIR_NAME_INVALID', 400);
    expectAppError(() => inEn(() => addVolume(rawRoot, undefined, '..')), 'ERR_DIR_NAME_INVALID', 400);
    expectAppError(() => inEn(() => addVolume(rawRoot, undefined, 'bad*name')), 'ERR_DIR_NAME_INVALID', 400);
  });

  it('links a single source volume without copying it', () => {
    const { rawRoot, external } = tempRoot();
    const source = path.join(external, 'MyVol');
    writeFile(path.join(source, 'ja', '1', '01.jpg'), 'page');

    const res = inEn(() => addVolume(rawRoot, source));
    const link = path.join(rawRoot, 'MyVol');

    expect(res.added).toEqual(['MyVol']);
    expect(res.warnings).toEqual([]);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(source));
    expect(fs.readFileSync(path.join(link, 'ja', '1', '01.jpg'), 'utf8')).toBe('page');
  });

  it('honours an explicit library name when linking a source', () => {
    const { rawRoot, external } = tempRoot();
    const source = path.join(external, 'FolderName');
    writeFile(path.join(source, 'en', '1', '01.jpg'), 'page');

    const res = inEn(() => addVolume(rawRoot, source, 'Display Name'));
    expect(res.added).toEqual(['Display Name']);
    expect(fs.existsSync(path.join(rawRoot, 'Display Name', 'en', '1', '01.jpg'))).toBe(true);
  });

  it('links each volume when the selection is a parent of several volumes', () => {
    const { rawRoot, external } = tempRoot();
    const parent = path.join(external, 'Parent');
    writeFile(path.join(parent, 'VolA', 'ja', '1', '01.jpg'), 'a');
    writeFile(path.join(parent, 'VolB', 'en', '1', '01.jpg'), 'b');

    const res = inEn(() => addVolume(rawRoot, parent));

    expect(res.added.sort()).toEqual(['VolA', 'VolB']);
    expect(res.warnings).toEqual([]);
    expect(fs.readFileSync(path.join(rawRoot, 'VolA', 'ja', '1', '01.jpg'), 'utf8')).toBe('a');
    expect(fs.readFileSync(path.join(rawRoot, 'VolB', 'en', '1', '01.jpg'), 'utf8')).toBe('b');
    expect(fs.existsSync(path.join(rawRoot, 'Parent'))).toBe(false);
  });

  it('links volumes nested in a series and stores the series name', () => {
    const { rawRoot, external, dataRoot } = tempRoot();
    const series = path.join(external, 'Series');
    writeFile(path.join(series, 'Vol1', 'ja', '1', '01.jpg'), 'v1');
    writeFile(path.join(series, 'Vol2', 'zh-hk', '1', '01.webp'), 'v2');

    const res = inEn(() => addVolume(rawRoot, series, undefined, dataRoot));

    expect(res.added.sort()).toEqual(['Vol1', 'Vol2']);
    const config = JSON.parse(fs.readFileSync(path.join(dataRoot, 'library.json'), 'utf8'));
    expect(config.volumes.Vol1.series).toBe('Series');
    expect(config.volumes.Vol2.series).toBe('Series');
  });

  it('suggests pointing at one volume when the layout has no language level', () => {
    const { rawRoot, external } = tempRoot();
    const parent = path.join(external, 'Series');
    writeFile(path.join(parent, 'VolA', '1', '01.jpg'), 'a');
    writeFile(path.join(parent, 'VolB', '1', '01.jpg'), 'b');

    expectAppError(() => inEn(() => addVolume(rawRoot, parent)), 'ERR_VOLUME_LAYOUT_UNRECOGNIZED', 400);
  });

  it('adds an empty external directory as a single volume without the fallback warning', () => {
    const { rawRoot, external } = tempRoot();
    const source = path.join(external, 'EmptyVol');
    fs.mkdirSync(source);

    const res = inEn(() => addVolume(rawRoot, source, 'EmptyVol'));

    expect(res.added).toEqual(['EmptyVol']);
    // `looksLikeVolume` is false only when there are no subdirectories, which takes the
    // first branch; `WARN_NO_LANGUAGE_DIR_DETECTED` is therefore never reached.
    expect(res.warnings).toEqual([]);
    expect(fs.lstatSync(path.join(rawRoot, 'EmptyVol')).isSymbolicLink()).toBe(true);
  });

  it('throws when the source is missing or is a file', () => {
    const { rawRoot, external } = tempRoot();
    expectAppError(() => inEn(() => addVolume(rawRoot, path.join(external, 'nope'))), 'ERR_DIR_NOT_FOUND', 400);

    const file = path.join(external, 'file.txt');
    writeFile(file, 'x');
    expectAppError(() => inEn(() => addVolume(rawRoot, file)), 'ERR_DIR_NOT_FOUND', 400);
  });

  it('refuses to replace a different directory that already uses the name', () => {
    const { rawRoot, external } = tempRoot();
    const source = path.join(external, 'Clash');
    writeFile(path.join(source, 'ja', '1', '01.jpg'), 'new');
    fs.mkdirSync(path.join(rawRoot, 'Clash'));
    writeFile(path.join(rawRoot, 'Clash', 'ja', '1', '01.jpg'), 'old');

    expectAppError(() => inEn(() => addVolume(rawRoot, source)), 'ERR_VOLUME_EXISTS', 409);
    expect(fs.readFileSync(path.join(rawRoot, 'Clash', 'ja', '1', '01.jpg'), 'utf8')).toBe('old');
  });

  it('reports a source that is already linked instead of linking twice', () => {
    const { rawRoot, external } = tempRoot();
    const source = path.join(external, 'Again');
    writeFile(path.join(source, 'zh', '1', '01.jpg'), 'x');

    inEn(() => addVolume(rawRoot, source));
    const res = inEn(() => addVolume(rawRoot, source));

    expect(res.added).toEqual(['Again']);
    expect(res.warnings).toEqual([inEn(() => t('WARN_VOLUME_ALREADY_IN_LIBRARY', { name: 'Again' }))]);
  });
});

describe('removeVolume', () => {
  it('deletes only the junction and keeps the original images', () => {
    const { rawRoot, dataRoot, external } = tempRoot();
    const source = path.join(external, 'KeepMe');
    writeFile(path.join(source, 'ja', '1', '01.jpg'), 'image');
    inEn(() => addVolume(rawRoot, source));
    writeLibraryConfig(dataRoot, { volumes: { KeepMe: { title: 'Kept' } } });

    const res = inEn(() => removeVolume(rawRoot, dataRoot, 'KeepMe'));

    expect(res.removed).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.deletedPath).toBe(path.join(rawRoot, 'KeepMe'));
    expect(fs.existsSync(path.join(rawRoot, 'KeepMe'))).toBe(false);
    expect(fs.readFileSync(path.join(source, 'ja', '1', '01.jpg'), 'utf8')).toBe('image');

    // Volume overrides are deletion-sensitive: removing the volume must not be undone
    // by the config merge.
    const cfg = readLibraryConfig(dataRoot);
    expect(cfg.volumes?.KeepMe).toBeUndefined();
  });

  it('removes a real directory from the library without deleting it', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'RealVol'));
    writeLibraryConfig(dataRoot, { volumes: { RealVol: { title: 'Real' } } });

    const res = inEn(() => removeVolume(rawRoot, dataRoot, 'RealVol'));

    expect(res.removed).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(fs.statSync(path.join(rawRoot, 'RealVol')).isDirectory()).toBe(true);
    expect(readLibraryConfig(dataRoot).volumes?.RealVol).toBeUndefined();
  });

  it('warns and cleans the config when the directory already disappeared', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeLibraryConfig(dataRoot, { volumes: { Gone: { title: 'Gone' } } });

    const res = inEn(() => removeVolume(rawRoot, dataRoot, 'Gone'));

    expect(res.removed).toBe(true);
    expect(res.warnings).toEqual([inEn(() => t('WARN_VOLUME_DIR_REMOVED'))]);
    expect(readLibraryConfig(dataRoot).volumes?.Gone).toBeUndefined();
  });

  it('keeps the other volume overrides intact', () => {
    const { rawRoot, dataRoot, external } = tempRoot();
    const source = path.join(external, 'Drop');
    writeFile(path.join(source, 'ja', '1', '01.jpg'), 'x');
    inEn(() => addVolume(rawRoot, source));
    writeLibraryConfig(dataRoot, {
      volumes: { Drop: { title: 'Drop' }, Stay: { title: 'Stay' } },
    });

    inEn(() => removeVolume(rawRoot, dataRoot, 'Drop'));

    const cfg = readLibraryConfig(dataRoot);
    expect(cfg.volumes?.Stay?.title).toBe('Stay');
    expect(cfg.volumes?.Drop).toBeUndefined();
  });

  it('keeps the linked originals unless deleteFiles is explicitly set', () => {
    const { rawRoot, dataRoot, external } = tempRoot();
    const source = path.join(external, 'Drop');
    writeFile(path.join(source, 'ja', '1', '01.jpg'), 'x');
    inEn(() => addVolume(rawRoot, source));

    inEn(() => removeVolume(rawRoot, dataRoot, 'Drop'));

    expect(fs.existsSync(path.join(source, 'ja', '1', '01.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(rawRoot, 'Drop'))).toBe(false);
  });

  it('never deletes the originals behind a link, even with deleteFiles', () => {
    const { rawRoot, dataRoot, external } = tempRoot();
    const source = path.join(external, 'Drop');
    writeFile(path.join(source, 'ja', '1', '01.jpg'), 'x');
    inEn(() => addVolume(rawRoot, source));

    const res = inEn(() => removeVolume(rawRoot, dataRoot, 'Drop', { deleteFiles: true }));

    expect(res.deletedPath).toBe(path.join(rawRoot, 'Drop'));
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(path.join(rawRoot, 'Drop'))).toBe(false);
  });

  it('keeps a real directory with a warning when deleteFiles is set', () => {
    const { rawRoot, dataRoot } = tempRoot();
    inEn(() => addVolume(rawRoot, undefined, 'Real'));

    const res = inEn(() => removeVolume(rawRoot, dataRoot, 'Real', { deleteFiles: true }));

    expect(res.removed).toBe(true);
    expect(res.warnings).toEqual([inEn(() => t('WARN_REAL_DIRECTORY_KEPT', { path: path.join(rawRoot, 'Real') }))]);
    expect(fs.existsSync(path.join(rawRoot, 'Real'))).toBe(true);
  });

  it('rejects volume ids that could escape the raw root', () => {
    const { rawRoot, dataRoot } = tempRoot();
    expectAppError(() => inEn(() => removeVolume(rawRoot, dataRoot, '../outside')), 'ERR_UNSAFE_SEGMENT', 400);
    expectAppError(() => inEn(() => removeVolume(rawRoot, dataRoot, '..')), 'ERR_UNSAFE_SEGMENT', 400);
  });
});

describe('setChapterHidden', () => {
  it('hides a chapter from the library without touching its files and restores it', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'Vol1', 'ja', 'ch1', '01.jpg'), 'x');
    writeFile(path.join(rawRoot, 'Vol1', 'ja', 'ch2', '01.jpg'), 'x');

    inEn(() => setChapterHidden(rawRoot, dataRoot, 'Vol1', 'ch1', true));

    let volume = createLibrary(rawRoot, dataRoot).volumes.find((v) => v.id === 'Vol1');
    expect(volume?.chapters.map((c) => c.chapter)).toEqual(['ch2']);
    expect(volume?.hiddenChapters).toEqual(['ch1']);
    expect(fs.existsSync(path.join(rawRoot, 'Vol1', 'ja', 'ch1', '01.jpg'))).toBe(true);

    inEn(() => setChapterHidden(rawRoot, dataRoot, 'Vol1', 'ch1', false));

    volume = createLibrary(rawRoot, dataRoot).volumes.find((v) => v.id === 'Vol1');
    expect(volume?.chapters.map((c) => c.chapter)).toEqual(['ch1', 'ch2']);
    expect(volume?.hiddenChapters).toEqual([]);
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.chapters).toBeUndefined();
  });

  it('rejects an unknown volume', () => {
    const { rawRoot, dataRoot } = tempRoot();
    expectAppError(
      () => inEn(() => setChapterHidden(rawRoot, dataRoot, 'Missing', 'ch1', true)),
      'ERR_VOLUME_NOT_FOUND',
      404,
    );
  });
});

describe('setVolumeDirs', () => {
  it('persists the language to directory mapping', () => {
    const { rawRoot, dataRoot } = tempRoot();
    for (const dir of ['ja', 'zh', 'en']) fs.mkdirSync(path.join(rawRoot, 'Vol1', dir), { recursive: true });

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'ja', zh: 'zh' }));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toEqual({ ja: 'ja', zh: 'zh' });
  });

  it('persists a null reset by clearing the previous mapping', () => {
    const { rawRoot, dataRoot } = tempRoot();
    for (const dir of ['ja', 'zh']) fs.mkdirSync(path.join(rawRoot, 'Vol1', dir), { recursive: true });
    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'ja', zh: 'zh' }));

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: null }));

    const cfg = readLibraryConfig(dataRoot);
    expect(cfg.volumes?.Vol1?.dirs).toBeUndefined();
  });

  it('keeps the direction while the clear removes the mapping', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'Vol1', 'ja'), { recursive: true });
    inEn(() => setVolumeDefaultDirection(rawRoot, dataRoot, 'Vol1', 'ltr'));
    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'ja' }));

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: null }));

    const entry = readLibraryConfig(dataRoot).volumes?.Vol1;
    expect(entry?.dirs).toBeUndefined();
    expect(entry?.defaultDirection).toBe('ltr');
  });

  it('rejects an unknown volume', () => {
    const { rawRoot, dataRoot } = tempRoot();
    expectAppError(
      () => inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Missing', { ja: 'ja' })),
      'ERR_VOLUME_NOT_FOUND',
      404,
    );
  });

  it('rejects a directory that is not inside the volume', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'Vol1', 'ja'), { recursive: true });

    expectAppError(
      () => inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'nope' })),
      'ERR_DIR_NOT_IN_VOLUME',
      400,
    );
  });

  it('ignores blank language keys and null directories', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'Vol1', 'ja'), { recursive: true });

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { '   ': 'ja', ja: null }));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1).toBeUndefined();
  });
});

describe('setChapterPageOffsets', () => {
  it('persists offsets per language and exposes them on the chapter', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'Vol1', 'ja', '199', '01.jpg'), 'x');
    writeFile(path.join(rawRoot, 'Vol1', 'en', '199', '01.jpg'), 'x');

    inEn(() => setChapterPageOffsets(rawRoot, dataRoot, 'Vol1', '199', { en: { from: 11, to: 13 } }));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.chapters?.['199']?.pageOffsets).toEqual({
      en: { from: 11, to: 13 },
    });
    const chapter = createLibrary(rawRoot, dataRoot).volumes[0].chapters[0];
    expect(chapter.pageOffsets).toEqual({ en: { from: 11, to: 13 } });
  });

  it('clears the offsets when an empty object is saved', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'Vol1', 'ja', '199', '01.jpg'), 'x');
    inEn(() => setChapterPageOffsets(rawRoot, dataRoot, 'Vol1', '199', { en: { from: 2, to: 3 } }));

    inEn(() => setChapterPageOffsets(rawRoot, dataRoot, 'Vol1', '199', {}));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1).toBeUndefined();
  });

  it('rejects a start page below 1 or a target before the start', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'Vol1'), { recursive: true });

    expectAppError(
      () => inEn(() => setChapterPageOffsets(rawRoot, dataRoot, 'Vol1', '199', { en: { from: 0, to: 2 } })),
      'ERR_PAGE_OFFSET_INVALID',
      400,
    );
    expectAppError(
      () => inEn(() => setChapterPageOffsets(rawRoot, dataRoot, 'Vol1', '199', { en: { from: 5, to: 3 } })),
      'ERR_PAGE_OFFSET_INVALID',
      400,
    );
  });
});

describe('volume operations on a volume nested under a series', () => {
  const nested = (rawRoot: string, ...parts: string[]) => path.join(rawRoot, 'Series', 'Vol1', ...parts);

  it('saves the language mapping and applies it to the scanned volume', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeFile(nested(rawRoot, 'ja', '199', '01.jpg'), 'x');
    writeFile(nested(rawRoot, 'zh-hk', '199', '01.webp'), 'x');

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'ja', zh: 'zh-hk' }));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toEqual({ ja: 'ja', zh: 'zh-hk' });
    const volume = createLibrary(rawRoot, dataRoot).volumes.find((v) => v.id === 'Vol1');
    expect(volume?.langDirs).toEqual({ ja: 'ja', zh: 'zh-hk' });
    expect(volume?.series).toBe('Series');
  });

  it('saves the default direction and hidden chapters', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeFile(nested(rawRoot, 'ja', 'ch1', '01.jpg'), 'x');
    writeFile(nested(rawRoot, 'ja', 'ch2', '01.jpg'), 'x');

    inEn(() => setVolumeDefaultDirection(rawRoot, dataRoot, 'Vol1', 'ltr'));
    inEn(() => setChapterHidden(rawRoot, dataRoot, 'Vol1', 'ch1', true));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.defaultDirection).toBe('ltr');
    const volume = createLibrary(rawRoot, dataRoot).volumes.find((v) => v.id === 'Vol1');
    expect(volume?.defaultDirection).toBe('ltr');
    expect(volume?.chapters.map((c) => c.chapter)).toEqual(['ch2']);
    expect(volume?.hiddenChapters).toEqual(['ch1']);
  });

  it('saves page offsets', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeFile(nested(rawRoot, 'ja', '199', '01.jpg'), 'x');
    writeFile(nested(rawRoot, 'en', '199', '01.png'), 'x');

    inEn(() => setChapterPageOffsets(rawRoot, dataRoot, 'Vol1', '199', { en: { from: 11, to: 13 } }));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.chapters?.['199']?.pageOffsets).toEqual({
      en: { from: 11, to: 13 },
    });
  });

  it('still validates directory names against the nested volume', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeFile(nested(rawRoot, 'ja', '199', '01.jpg'), 'x');

    expectAppError(
      () => inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'nope' })),
      'ERR_DIR_NOT_IN_VOLUME',
      400,
    );
  });

  it('still rejects an unknown volume', () => {
    const { rawRoot, dataRoot } = tempRoot();
    expectAppError(
      () => inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Missing', { ja: 'ja' })),
      'ERR_VOLUME_NOT_FOUND',
      404,
    );
  });
});

describe('setVolumeDefaultDirection', () => {
  it('writes ltr and resets it to rtl with null', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'Vol1'), { recursive: true });

    inEn(() => setVolumeDefaultDirection(rawRoot, dataRoot, 'Vol1', 'ltr'));
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.defaultDirection).toBe('ltr');

    inEn(() => setVolumeDefaultDirection(rawRoot, dataRoot, 'Vol1', null));
    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.defaultDirection).toBe('rtl');
  });

  it('rejects an unknown volume', () => {
    const { rawRoot, dataRoot } = tempRoot();
    expectAppError(
      () => inEn(() => setVolumeDefaultDirection(rawRoot, dataRoot, 'Missing', 'ltr')),
      'ERR_VOLUME_NOT_FOUND',
      404,
    );
  });
});
