import fs from 'node:fs';
import path from 'node:path';
import {
  guessLang,
  hasImages,
  listDirs,
  normalizeLang,
  readLibraryConfig,
  resolveVolumeDir,
  writeLibraryConfig,
} from './library.ts';
import type { Lang, PageOffset, ReadingDirection } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';
import { assertSafeSegment } from './pathSafety.ts';

const BAD_NAME = /[\\/:*?"<>|]/;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

function assertName(name: string): string {
  const clean = name.trim();
  if (!clean) throw new AppError('ERR_DIR_NAME_EMPTY', {}, 400);
  if (BAD_NAME.test(clean) || clean === '.' || clean === '..') {
    throw new AppError('ERR_DIR_NAME_INVALID', { name: clean }, 400);
  }
  return clean;
}

type VolumeCandidate = { name: string; dir: string; series?: string };

/** Whether a directory directly contains language folders that hold images. */
function hasLanguageDirs(dir: string): boolean {
  return listDirs(dir).some((sub) => guessLang(sub) !== null && hasImages(path.join(dir, sub)));
}

const MAX_LAYOUT_DEPTH = 4;

/**
 * Walk down until a directory exposes language folders. That directory is a volume; its
 * ancestors (below the selected root) form the series name. This accepts all three layouts:
 * `volume/language/chapter`, `series/volume/language/chapter` and a parent holding several volumes.
 */
function collectVolumes(
  dir: string,
  rootName: string,
  ancestors: string[],
  depth: number,
  out: VolumeCandidate[],
): void {
  if (depth > MAX_LAYOUT_DEPTH) return;
  if (hasLanguageDirs(dir)) {
    // depth 0: the selection itself is a volume; depth 1: its parent is the series;
    // depth >= 2: everything between the selection and the volume is the series path.
    const series =
      ancestors.length === 0 ? undefined : ancestors.length === 1 ? rootName : ancestors.slice(0, -1).join(' / ');
    out.push({ name: ancestors[ancestors.length - 1] ?? rootName, dir, series });
    return;
  }
  for (const sub of listDirs(dir)) {
    collectVolumes(path.join(dir, sub), rootName, [...ancestors, sub], depth + 1, out);
  }
}

function realpathOrNull(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

export type AddVolumeResult = { added: string[]; warnings: string[] };

/**
 * Add manga:
 * - name only: create an empty directory under raw and ask the user to drop images in
 * - sourcePath: create a junction under raw pointing at an external directory (no copying, no extra disk usage)
 *   - the selection is a single volume -> link that one volume
 *   - the selection is a parent directory holding several volumes -> link each volume
 *   - the selection is a series holding volumes -> link each volume and remember the series name
 */
export function addVolume(rawRoot: string, sourcePath?: string, rawName?: string, dataRoot?: string): AddVolumeResult {
  fs.mkdirSync(rawRoot, { recursive: true });
  const warnings: string[] = [];
  const added: string[] = [];
  const seriesByName = new Map<string, string>();

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

  let candidates: VolumeCandidate[] = [];
  if (!listDirs(source).length) {
    const name = assertName(rawName ?? path.basename(source));
    candidates = [{ name, dir: source }];
  } else {
    collectVolumes(source, path.basename(source), [], 0, candidates);
    if (rawName && candidates.length === 1 && candidates[0].dir === source) {
      candidates[0] = { ...candidates[0], name: rawName };
    }
    if (!candidates.length) {
      // A flat single volume (images directly under the selected folder) can still be linked
      // and mapped by hand. Anything nested without a language folder needs a clearer error.
      const directImages = fs
        .readdirSync(source, { withFileTypes: true })
        .some((entry) => entry.isFile() && IMAGE_EXT.test(entry.name));
      // Several sibling folders with images but no language level look like a multi-volume
      // selection whose language folders are missing; ask for one concrete volume instead.
      const siblingVolumes = listDirs(source).filter((sub) => hasImages(path.join(source, sub))).length;
      if (!directImages && siblingVolumes > 1) {
        throw new AppError('ERR_VOLUME_LAYOUT_UNRECOGNIZED', {}, 400);
      }
      const name = assertName(rawName ?? path.basename(source));
      candidates = [{ name, dir: source }];
      warnings.push(t('WARN_NO_LANGUAGE_DIR_DETECTED'));
    }
  }

  for (const candidate of candidates) {
    const base = assertName(candidate.name);
    const series = candidate.series;
    const seriesTail = series?.split(' / ').filter(Boolean).pop();
    const names = [base];
    if (seriesTail) names.push(assertName(`${seriesTail}-${base}`));

    let linked = false;
    for (const name of names) {
      const target = path.join(rawRoot, name);
      if (fs.existsSync(target)) {
        if (realpathOrNull(target) === realpathOrNull(candidate.dir)) {
          added.push(name);
          if (series) seriesByName.set(name, series);
          warnings.push(t('WARN_VOLUME_ALREADY_IN_LIBRARY', { name }));
          linked = true;
          break;
        }
        continue;
      }
      try {
        fs.symlinkSync(candidate.dir, target, 'junction');
        added.push(name);
        if (series) seriesByName.set(name, series);
        linked = true;
        break;
      } catch (err) {
        throw new AppError('ERR_LINK_CREATE_FAILED', { detail: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!linked) throw new AppError('ERR_VOLUME_EXISTS', { name: base }, 409);
  }

  if (dataRoot && seriesByName.size) {
    const config = readLibraryConfig(dataRoot);
    const volumes = { ...(config.volumes ?? {}) };
    for (const [name, series] of seriesByName) {
      volumes[name] = { ...(volumes[name] ?? {}), series };
    }
    writeLibraryConfig(dataRoot, { ...config, volumes });
  }

  return { added, warnings };
}

export type RemoveVolumeOptions = {
  /**
   * Explicit opt-in: remove the images on disk as well. Off by default so "remove from
   * library" can never destroy originals; the caller must spell this out in the UI.
   */
  deleteFiles?: boolean;
};

/**
 * Remove from the library. The library entry is dropped either way; the images never are.
 *
 * - A link (junction/symlink) is unlinked, because that link is the library membership.
 *   The folder it points at is user data and is never touched.
 * - A real directory under raw/ stays exactly where it is. `deleteFiles` cannot delete it
 *   either: the removal still succeeds and a warning asks the user to delete it by hand.
 */
export function removeVolume(
  rawRoot: string,
  dataRoot: string,
  volume: string,
  options: RemoveVolumeOptions = {},
): { removed: boolean; warnings: string[]; deletedPath?: string } {
  const name = assertSafeSegment(volume, 'volume');
  const target = path.join(rawRoot, name);
  const warnings: string[] = [];
  let deletedPath: string | undefined;
  let exists = true;
  try {
    fs.lstatSync(target);
  } catch {
    exists = false;
  }

  if (!exists) {
    warnings.push(t('WARN_VOLUME_DIR_REMOVED'));
  } else {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      // Never resolve the link: the originals outside raw/ must survive the removal.
      try {
        fs.unlinkSync(target);
      } catch {
        fs.rmdirSync(target);
      }
      deletedPath = target;
    } else if (stat.isDirectory() && options.deleteFiles) {
      // Real folders are user data: unlink them from the library, never delete them here.
      warnings.push(t('WARN_REAL_DIRECTORY_KEPT', { path: target }));
    }
  }

  const cfg = readLibraryConfig(dataRoot);
  if (cfg.volumes?.[name]) {
    delete cfg.volumes[name];
    writeLibraryConfig(dataRoot, cfg);
  }
  return { removed: true, warnings, ...(deletedPath ? { deletedPath } : {}) };
}

/**
 * Unlink a single chapter from the library without touching its folder or page data.
 * The config keeps `hidden: true`, so the chapter can be restored from volume settings.
 */
export function setChapterHidden(
  rawRoot: string,
  dataRoot: string,
  volume: string,
  chapter: string,
  hidden: boolean,
): void {
  const safeVolume = assertSafeSegment(volume, 'volume');
  const safeChapter = assertSafeSegment(chapter, 'chapter');
  if (!resolveVolumeDir(rawRoot, dataRoot, safeVolume)) {
    throw new AppError('ERR_VOLUME_NOT_FOUND', { volume: safeVolume }, 404);
  }
  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  const next = { ...(volumes[safeVolume] ?? {}) };
  const chapters = { ...(next.chapters ?? {}) };
  const chapterCfg = { ...(chapters[safeChapter] ?? {}) };
  if (hidden) chapterCfg.hidden = true;
  else delete chapterCfg.hidden;
  if (Object.keys(chapterCfg).length) chapters[safeChapter] = chapterCfg;
  else delete chapters[safeChapter];
  if (Object.keys(chapters).length) next.chapters = chapters;
  else delete next.chapters;
  if (Object.keys(next).length) volumes[safeVolume] = next;
  else delete volumes[safeVolume];
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
}

/**
 * Persist per-language page offsets for one chapter. `from` is the first page number in that
 * language's own files; `to` is the page number it should align to. Pass null to clear.
 */
export function setChapterPageOffsets(
  rawRoot: string,
  dataRoot: string,
  volume: string,
  chapter: string,
  offsets: Partial<Record<Lang, PageOffset | null>>,
): void {
  const safeVolume = assertSafeSegment(volume, 'volume');
  const safeChapter = assertSafeSegment(chapter, 'chapter');
  if (!resolveVolumeDir(rawRoot, dataRoot, safeVolume)) {
    throw new AppError('ERR_VOLUME_NOT_FOUND', { volume: safeVolume }, 404);
  }
  const clean: Partial<Record<Lang, PageOffset>> = {};
  for (const [rawLang, offset] of Object.entries(offsets)) {
    if (!offset) continue;
    const lang = normalizeLang(rawLang);
    if (!lang) continue;
    const from = Number(offset.from);
    const to = Number(offset.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      throw new AppError('ERR_PAGE_OFFSET_INVALID', { lang: rawLang, from, to }, 400);
    }
    clean[lang] = { from, to };
  }
  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  const next = { ...(volumes[safeVolume] ?? {}) };
  const chapters = { ...(next.chapters ?? {}) };
  const chapterCfg = { ...(chapters[safeChapter] ?? {}) };
  if (Object.keys(clean).length) chapterCfg.pageOffsets = clean;
  else delete chapterCfg.pageOffsets;
  if (Object.keys(chapterCfg).length) chapters[safeChapter] = chapterCfg;
  else delete chapters[safeChapter];
  if (Object.keys(chapters).length) next.chapters = chapters;
  else delete next.chapters;
  if (Object.keys(next).length) volumes[safeVolume] = next;
  else delete volumes[safeVolume];
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
}

/** Set the language -> directory mapping for a volume; pass null to restore automatic detection. */
export function setVolumeDirs(
  rawRoot: string,
  dataRoot: string,
  volume: string,
  dirs: Partial<Record<Lang, string | null>>,
): void {
  const volumePath = resolveVolumeDir(rawRoot, dataRoot, volume);
  if (!volumePath) throw new AppError('ERR_VOLUME_NOT_FOUND', { volume }, 404);
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

/**
 * Persist the volume-level default reading direction that pages inherit until edited.
 * `null` resets it to `rtl`; the key is kept so the config file cannot silently fall back
 * through `preserveUnknown()` (which would restore a deleted nested key).
 */
export function setVolumeDefaultDirection(
  rawRoot: string,
  dataRoot: string,
  volume: string,
  direction: ReadingDirection | null,
): void {
  if (!resolveVolumeDir(rawRoot, dataRoot, volume)) {
    throw new AppError('ERR_VOLUME_NOT_FOUND', { volume }, 404);
  }
  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  const next = { ...(volumes[volume] ?? {}), defaultDirection: direction ?? 'rtl' };
  if (Object.keys(next).length) volumes[volume] = next;
  else delete volumes[volume];
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
}
