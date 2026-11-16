import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addVolume, removeVolume, setVolumeDefaultDirection, setVolumeDirs } from '../../server/libraryAdmin.ts';
import { readLibraryConfig, writeLibraryConfig } from '../../server/library.ts';
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

  it('links a parent directory as one volume (multi-volume branch is unreachable)', () => {
    const { rawRoot, external } = tempRoot();
    const parent = path.join(external, 'Parent');
    writeFile(path.join(parent, 'VolA', 'ja', '1', '01.jpg'), 'a');
    writeFile(path.join(parent, 'VolB', 'en', '1', '01.jpg'), 'b');

    const res = inEn(() => addVolume(rawRoot, parent));

    // Every subdirectory is treated as a language folder, so the parent itself is linked once.
    expect(res.added).toEqual(['Parent']);
    expect(fs.existsSync(path.join(rawRoot, 'Parent', 'VolA', 'ja', '1', '01.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(rawRoot, 'VolA'))).toBe(false);
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

    expect(res).toEqual({ removed: true, warnings: [] });
    expect(fs.existsSync(path.join(rawRoot, 'KeepMe'))).toBe(false);
    expect(fs.readFileSync(path.join(source, 'ja', '1', '01.jpg'), 'utf8')).toBe('image');

    // writeLibraryConfig merges with the previous file through preserveUnknown, which
    // restores the deleted nested key, so the override survives the cleanup attempt.
    const cfg = readLibraryConfig(dataRoot);
    expect(cfg.volumes?.KeepMe?.title).toBe('Kept');
  });

  it('refuses to remove a real directory', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'RealVol'));

    expectAppError(() => inEn(() => removeVolume(rawRoot, dataRoot, 'RealVol')), 'ERR_REAL_DIRECTORY', 409);
    expect(fs.statSync(path.join(rawRoot, 'RealVol')).isDirectory()).toBe(true);
  });

  it('warns and cleans the config when the directory already disappeared', () => {
    const { rawRoot, dataRoot } = tempRoot();
    writeLibraryConfig(dataRoot, { volumes: { Gone: { title: 'Gone' } } });

    const res = inEn(() => removeVolume(rawRoot, dataRoot, 'Gone'));

    expect(res.removed).toBe(true);
    expect(res.warnings).toEqual([inEn(() => t('WARN_VOLUME_DIR_REMOVED'))]);
    expect(readLibraryConfig(dataRoot).volumes?.Gone?.title).toBe('Gone');
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
    expect(cfg.volumes?.Drop?.title).toBe('Drop');
  });
});

describe('setVolumeDirs', () => {
  it('persists the language to directory mapping', () => {
    const { rawRoot, dataRoot } = tempRoot();
    for (const dir of ['ja', 'zh', 'en']) fs.mkdirSync(path.join(rawRoot, 'Vol1', dir), { recursive: true });

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'ja', zh: 'zh' }));

    expect(readLibraryConfig(dataRoot).volumes?.Vol1?.dirs).toEqual({ ja: 'ja', zh: 'zh' });
  });

  it('does not persist a null reset: the previous mapping comes back', () => {
    const { rawRoot, dataRoot } = tempRoot();
    for (const dir of ['ja', 'zh']) fs.mkdirSync(path.join(rawRoot, 'Vol1', dir), { recursive: true });
    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'ja', zh: 'zh' }));

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: null }));

    // The deleted `dirs` key is restored by preserveUnknown in writeLibraryConfig.
    const cfg = readLibraryConfig(dataRoot);
    expect(cfg.volumes?.Vol1?.dirs).toEqual({ ja: 'ja', zh: 'zh' });
  });

  it('keeps the direction while the clear attempt does not remove the mapping', () => {
    const { rawRoot, dataRoot } = tempRoot();
    fs.mkdirSync(path.join(rawRoot, 'Vol1', 'ja'), { recursive: true });
    inEn(() => setVolumeDefaultDirection(rawRoot, dataRoot, 'Vol1', 'ltr'));
    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: 'ja' }));

    inEn(() => setVolumeDirs(rawRoot, dataRoot, 'Vol1', { ja: null }));

    const entry = readLibraryConfig(dataRoot).volumes?.Vol1;
    expect(entry?.dirs).toEqual({ ja: 'ja' });
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
