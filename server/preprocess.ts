import fs from 'node:fs';
import path from 'node:path';
import { PAGE_KINDS, type ChapterOverride, type Lang, type PageKind, type VolumeOverride } from '../shared/types.ts';
import { listDirs, normalizeLang, readLibraryConfig, writeLibraryConfig } from './library.ts';
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
  if (!fs.existsSync(path.join(rawRoot, input.volume))) {
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
    const existing = new Set(listDirs(path.join(rawRoot, input.volume)));
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
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
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
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
  fs.rmSync(backupFile(dataRoot), { force: true });
  return { at: backup.at };
}

export function readPreprocessBackup(dataRoot: string): { at: string; volume: string } | null {
  const backup = readBackup(dataRoot);
  return backup ? { at: backup.at, volume: backup.volume } : null;
}
