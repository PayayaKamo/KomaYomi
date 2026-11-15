import fs from 'node:fs';
import path from 'node:path';
import { listDirs, normalizeLang, readLibraryConfig, writeLibraryConfig } from './library.ts';
import type { Lang } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';

const BAD_NAME = /[\\/:*?"<>|]/;

function assertName(name: string): string {
  const clean = name.trim();
  if (!clean) throw new AppError('ERR_DIR_NAME_EMPTY', {}, 400);
  if (BAD_NAME.test(clean) || clean === '.' || clean === '..') {
    throw new AppError('ERR_DIR_NAME_INVALID', { name: clean }, 400);
  }
  return clean;
}

/** Whether a directory looks like a volume (it contains language folders, or its language folders contain chapter folders). */
function looksLikeVolume(dir: string): boolean {
  const subs = listDirs(dir);
  if (subs.some((d) => normalizeLang(d))) return true;
  return subs.some((sub) => listDirs(path.join(dir, sub)).some((d) => normalizeLang(d)));
}

export type AddVolumeResult = { added: string[]; warnings: string[] };

/**
 * Add manga:
 * - name only: create an empty directory under raw and ask the user to drop images in
 * - sourcePath: create a junction under raw pointing at an external directory (no copying, no extra disk usage)
 *   - the selection is a single volume -> link that one volume
 *   - the selection is a parent directory holding several volumes -> link each volume
 */
export function addVolume(rawRoot: string, sourcePath?: string, rawName?: string): AddVolumeResult {
  fs.mkdirSync(rawRoot, { recursive: true });
  const warnings: string[] = [];
  const added: string[] = [];

  if (!sourcePath) {
    const name = assertName(rawName ?? '');
    const target = path.join(rawRoot, name);
    if (fs.existsSync(target)) return { added: [name], warnings: [t('WARN_SAME_NAME_VOLUME')] };
    fs.mkdirSync(target, { recursive: true });
    warnings.push(t('WARN_EMPTY_VOLUME_CREATED'));
    return { added: [name], warnings };
  }

  const source = path.resolve(sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new AppError('ERR_DIR_NOT_FOUND', { path: source }, 400);
  }

  // When a parent directory is selected, link each volume inside it into raw separately
  let candidates: { name: string; dir: string }[] = [];
  if (looksLikeVolume(source) || !listDirs(source).length) {
    const name = assertName(rawName ?? path.basename(source));
    candidates = [{ name, dir: source }];
  } else {
    candidates = listDirs(source)
      .map((d) => path.join(source, d))
      .filter((d) => looksLikeVolume(d))
      .map((d) => ({ name: path.basename(d), dir: d }));
    if (!candidates.length) {
      const name = assertName(rawName ?? path.basename(source));
      candidates = [{ name, dir: source }];
      warnings.push(t('WARN_NO_LANGUAGE_DIR_DETECTED'));
    }
  }

  for (const candidate of candidates) {
    const target = path.join(rawRoot, candidate.name);
    if (fs.existsSync(target)) {
      let same = false;
      try {
        same = fs.realpathSync(target) === fs.realpathSync(candidate.dir);
      } catch {
        same = false;
      }
      if (same) {
        added.push(candidate.name);
        warnings.push(t('WARN_VOLUME_ALREADY_IN_LIBRARY', { name: candidate.name }));
        continue;
      }
      throw new AppError('ERR_VOLUME_EXISTS', { name: candidate.name }, 409);
    }
    try {
      fs.symlinkSync(candidate.dir, target, 'junction');
      added.push(candidate.name);
    } catch (err) {
      throw new AppError('ERR_LINK_CREATE_FAILED', { detail: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return { added, warnings };
}

/** Remove from the library: delete only the junction, never the images in the real directory. */
export function removeVolume(
  rawRoot: string,
  dataRoot: string,
  volume: string,
): { removed: boolean; warnings: string[] } {
  const target = path.join(rawRoot, volume);
  const warnings: string[] = [];
  if (!fs.existsSync(target)) {
    warnings.push(t('WARN_VOLUME_DIR_REMOVED'));
  } else {
    const stat = fs.lstatSync(target);
    if (!stat.isSymbolicLink()) {
      throw new AppError('ERR_REAL_DIRECTORY', {}, 409);
    }
    try {
      fs.unlinkSync(target);
    } catch {
      fs.rmdirSync(target);
    }
  }

  const cfg = readLibraryConfig(dataRoot);
  if (cfg.volumes?.[volume]) {
    delete cfg.volumes[volume];
    writeLibraryConfig(dataRoot, cfg);
  }
  return { removed: true, warnings };
}

/** Set the language -> directory mapping for a volume; pass null to restore automatic detection. */
export function setVolumeDirs(
  rawRoot: string,
  dataRoot: string,
  volume: string,
  dirs: Partial<Record<Lang, string | null>>,
): void {
  const volumePath = path.join(rawRoot, volume);
  if (!fs.existsSync(volumePath)) throw new AppError('ERR_VOLUME_NOT_FOUND', { volume }, 404);
  const existing = new Set(listDirs(volumePath));
  const clean: Partial<Record<Lang, string>> = {};
  for (const [rawLang, dir] of Object.entries(dirs)) {
    if (!dir) continue;
    const lang = normalizeLang(rawLang);
    if (!lang) continue;
    if (!existing.has(dir)) throw new AppError('ERR_DIR_NOT_IN_VOLUME', { dir, volume }, 400);
    clean[lang] = dir;
  }
  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  const next = { ...(volumes[volume] ?? {}) };
  if (Object.keys(clean).length) next.dirs = clean;
  else delete next.dirs;
  if (Object.keys(next).length) volumes[volume] = next;
  else delete volumes[volume];
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
}
