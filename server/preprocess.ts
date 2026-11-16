import fs from 'node:fs';
import path from 'node:path';
import { PAGE_KINDS, type ChapterOverride, type Lang, type PageKind, type VolumeOverride } from '../shared/types.ts';
import { preserveUnknown } from '../shared/format.ts';
import { assertWritableFile, readRawRecord, writeStoredFile } from './schemaStore.ts';
import { listDirs, normalizeLang, readLibraryConfig, resolveVolumeDir, type LibraryConfig } from './library.ts';
import { AppError } from './errors.ts';

/** data/preprocess-backup.json: one-shot snapshot of the volume config before the last apply. */
type PreprocessBackup = {
  schemaVersion: 1;
  at: string;
  volume: string;
  entry: VolumeOverride | null;
};

export type PreprocessInput = {
  volume: string;
  title?: string;
  chapters?: Record<string, unknown>;
  /** Language -> directory mapping; null clears a mapping. Absent leaves it untouched. */
  dirs?: Partial<Record<Lang, string | null>>;
};

const backupFile = (dataRoot: string) => path.join(dataRoot, 'preprocess-backup.json');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const VOLUME_KEYS = ['title', 'dirs', 'chapters'];
const CHAPTER_KEYS = ['title', 'order', 'excluded', 'kinds'];

/** Drops the keys preprocessing owns from the stored config, keeping unknown fields intact. */
function stripOwned(prev: Record<string, unknown>): Record<string, unknown> {
  const volumes = prev.volumes;
  if (!isRecord(volumes)) return prev;
  const nextVolumes: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(volumes)) {
    if (!isRecord(entry)) {
      nextVolumes[id] = entry;
      continue;
    }
    const volume = { ...entry };
    for (const key of VOLUME_KEYS) delete volume[key];
    if (isRecord(volume.chapters)) {
      const chapters: Record<string, unknown> = {};
      for (const [name, chapter] of Object.entries(volume.chapters)) {
        if (!isRecord(chapter)) {
          chapters[name] = chapter;
          continue;
        }
        const cleaned = { ...chapter };
        for (const key of CHAPTER_KEYS) delete cleaned[key];
        chapters[name] = cleaned;
      }
      volume.chapters = chapters;
    }
    // A volume entry that only held preprocessing config must disappear, not come back empty.
    if (Object.keys(volume).length) nextVolumes[id] = volume;
  }
  return { ...prev, volumes: nextVolumes };
}

/**
 * Writes the library config without resurrecting preprocessing fields that were just cleared.
 * The generic writer restores missing keys from the previous file (to protect unknown fields),
 * which would otherwise bring back removed exclusions, page order or folder mappings.
 */
function writePreprocessConfig(dataRoot: string, cfg: LibraryConfig): void {
  const file = path.join(dataRoot, 'library.json');
  assertWritableFile(file, 'mnconfig');
  const prev = readRawRecord(file);
  const base = prev ? stripOwned(prev) : null;
  writeStoredFile(file, 'mnconfig', preserveUnknown(base, { ...cfg, volumes: cfg.volumes ?? {} }));
}

/**
 * Rewrite page indices in the saved chapter overrides after files moved on disk.
 * `mapIndex` returns the new index, or `null` when the old page no longer exists.
 * Returns true when the config changed.
 */
export function remapChapterPages(
  dataRoot: string,
  volume: string,
  chapter: string,
  mapIndex: (index: number) => number | null,
): boolean {
  const cfg = readLibraryConfig(dataRoot);
  const current = cfg.volumes?.[volume]?.chapters?.[chapter];
  if (!current) return false;
  const next: ChapterOverride = { ...current };

  if (current.order) {
    const order = current.order
      .map(mapIndex)
      .filter((index): index is number => index !== null)
      .filter((index, position, list) => list.indexOf(index) === position);
    if (order.length) next.order = order;
    else delete next.order;
  }
  if (current.excluded) {
    const excluded = current.excluded
      .map(mapIndex)
      .filter((index): index is number => index !== null)
      .filter((index, position, list) => list.indexOf(index) === position);
    if (excluded.length) next.excluded = excluded;
    else delete next.excluded;
  }
  if (current.kinds) {
    const kinds: Record<string, PageKind> = {};
    for (const [key, kind] of Object.entries(current.kinds)) {
      const mapped = mapIndex(Number(key));
      if (mapped !== null) kinds[String(mapped)] = kind;
    }
    if (Object.keys(kinds).length) next.kinds = kinds;
    else delete next.kinds;
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return false;

  const volumes = { ...(cfg.volumes ?? {}) };
  const volumeCfg = { ...volumes[volume] };
  const chapters = { ...(volumeCfg.chapters ?? {}) };
  if (Object.keys(next).length) chapters[chapter] = next;
  else delete chapters[chapter];
  if (Object.keys(chapters).length) volumeCfg.chapters = chapters;
  else delete volumeCfg.chapters;
  volumes[volume] = volumeCfg;
  writePreprocessConfig(dataRoot, { ...cfg, volumes });
  return true;
}

const cleanText = (value: unknown, max = 200): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
};

/** Keep only integer page document indices that actually exist in the chapter. */
function cleanIndices(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const index = Number(item);
    if (!Number.isInteger(index) || index < 0 || out.includes(index)) continue;
    out.push(index);
  }
  return out;
}

function cleanChapter(value: unknown): ChapterOverride {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const out: ChapterOverride = {};
  const title = cleanText(raw.title);
  if (title) out.title = title;
  const order = cleanIndices(raw.order);
  if (order.length) out.order = order;
  const excluded = cleanIndices(raw.excluded);
  if (excluded.length) out.excluded = excluded;
  if (raw.kinds && typeof raw.kinds === 'object') {
    const kinds: Record<string, PageKind> = {};
    for (const [key, kind] of Object.entries(raw.kinds as Record<string, unknown>)) {
      if (!/^\d+$/.test(key)) continue;
      if (!PAGE_KINDS.includes(kind as PageKind)) continue;
      kinds[key] = kind as PageKind;
    }
    if (Object.keys(kinds).length) out.kinds = kinds;
  }
  return out;
}

function readBackup(dataRoot: string): PreprocessBackup | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(backupFile(dataRoot), 'utf8')) as PreprocessBackup;
    return parsed && parsed.schemaVersion === 1 && parsed.volume ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the preprocessing wizard result into data/library.json. The previous volume entry is
 * copied to data/preprocess-backup.json first, so the whole step can be undone once.
 */
export function applyPreprocess(rawRoot: string, dataRoot: string, input: PreprocessInput): { backupAt: string } {
  if (!input.volume) throw new AppError('ERR_MISSING_VOLUME_DIRS', {}, 400);
  const volumePath = resolveVolumeDir(rawRoot, dataRoot, input.volume);
  if (!volumePath) {
    throw new AppError('ERR_VOLUME_NOT_FOUND', { volume: input.volume }, 404);
  }

  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  const previous = volumes[input.volume] ?? null;

  const next: VolumeOverride = { ...(previous ?? {}) };
  const title = cleanText(input.title);
  if (title) next.title = title;
  else delete next.title;

  if (input.chapters && typeof input.chapters === 'object') {
    const chapters: Record<string, ChapterOverride> = {};
    for (const [chapter, value] of Object.entries(input.chapters)) {
      if (!chapter.trim()) continue;
      chapters[chapter.trim()] = cleanChapter(value);
    }
    if (Object.keys(chapters).length) next.chapters = chapters;
    else delete next.chapters;
  }

  if (input.dirs) {
    const existing = new Set(listDirs(volumePath));
    const dirs: Partial<Record<Lang, string>> = {};
    for (const [rawLang, dir] of Object.entries(input.dirs)) {
      if (!dir) continue;
      const lang = normalizeLang(rawLang);
      if (!lang || !existing.has(dir)) continue;
      dirs[lang] = dir;
    }
    if (Object.keys(dirs).length) next.dirs = dirs;
    else delete next.dirs;
  }

  const at = new Date().toISOString();
  fs.mkdirSync(dataRoot, { recursive: true });
  const backup: PreprocessBackup = { schemaVersion: 1, at, volume: input.volume, entry: previous };
  fs.writeFileSync(backupFile(dataRoot), JSON.stringify(backup, null, 2), 'utf8');

  if (Object.keys(next).length) volumes[input.volume] = next;
  else delete volumes[input.volume];
  writePreprocessConfig(dataRoot, { ...cfg, volumes });
  return { backupAt: at };
}

/** Restore the volume entry saved by the last apply and drop the backup (one-shot undo). */
export function restorePreprocess(dataRoot: string, volume: string): { at: string } {
  const backup = readBackup(dataRoot);
  if (!backup || backup.volume !== volume) throw new AppError('ERR_PREPROCESS_NO_BACKUP', {}, 404);
  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  if (backup.entry && Object.keys(backup.entry).length) volumes[volume] = backup.entry;
  else delete volumes[volume];
  writePreprocessConfig(dataRoot, { ...cfg, volumes });
  fs.rmSync(backupFile(dataRoot), { force: true });
  return { at: backup.at };
}

export function readPreprocessBackup(dataRoot: string): { at: string; volume: string } | null {
  const backup = readBackup(dataRoot);
  return backup ? { at: backup.at, volume: backup.volume } : null;
}
