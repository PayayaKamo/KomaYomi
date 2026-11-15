import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PageDoc, PanelRect } from '../shared/types.ts';
import type { HistorySource } from '../shared/format.ts';
import { assertWritableFile, readStoredFile, writeStoredFile } from './schemaStore.ts';
import { assertSafeSegment, resolveWithin } from './pathSafety.ts';
import { AppError } from './errors.ts';
import { readLibraryConfig } from './library.ts';

/**
 * Cross-session page version history.
 *
 * Every write to a page appends a snapshot here. Unlike the in-session undo stack, these
 * versions survive reloads, restarts and project packaging, and each one records why it
 * was created plus a structured diff against the previous version.
 *
 * The files live under `data/history/<volume>/<chapter>/<page>.json`, so backups (which
 * archive all of `data/`) and project packaging pick them up automatically.
 */

export const HISTORY_KIND = 'mnhistory';
export const DEFAULT_HISTORY_LIMIT = 50;
export const MIN_HISTORY_LIMIT = 5;
export const MAX_HISTORY_LIMIT = 200;
/** Consecutive auto-save snapshots inside this window collapse into one version. */
export const AUTO_MERGE_MS = 45_000;

export type HistoryDiff = {
  panels: number;
  panelsDelta: number;
  added: number;
  removed: number;
  moved: number;
  resized: number;
  annotations: number;
  annotationsDelta: number;
  notes: number;
  notesDelta: number;
};

export type HistoryEntry = {
  id: string;
  at: string;
  source: HistorySource;
  summary: string;
  diff: HistoryDiff;
  editCount: number;
  doc: PageDoc;
};

export type HistoryFile = {
  volume: string;
  chapter: string;
  pageIndex: number;
  entries: HistoryEntry[];
};

export type VersionSummary = Omit<HistoryEntry, 'doc'> & {
  panelCount: number;
  annotationCount: number;
  noteCount: number;
  panels: { id: string; rect: PanelRect }[];
};

export type RecordOptions = {
  source: HistorySource;
  summary?: string;
  /** Override the timestamp (tests). */
  at?: string;
};

export function historyFilePath(dataRoot: string, volume: string, chapter: string, pageIndex: number): string {
  const safeVolume = assertSafeSegment(volume, 'volume');
  const safeChapter = assertSafeSegment(chapter, 'chapter');
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new AppError('ERR_PAGE_INDEX_INVALID', {}, 400);
  }
  return resolveWithin(dataRoot, 'history', safeVolume, safeChapter, `${pageIndex}.json`);
}

/** Effective retention for every page; configured through `data/library.json`. */
export function readHistoryLimit(dataRoot: string): number {
  try {
    const raw = Number(readLibraryConfig(dataRoot).historyLimit);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HISTORY_LIMIT;
    return Math.min(MAX_HISTORY_LIMIT, Math.max(MIN_HISTORY_LIMIT, Math.round(raw)));
  } catch {
    return DEFAULT_HISTORY_LIMIT;
  }
}

const isPanel = (value: unknown): value is { id: string; rect: PanelRect } => {
  if (!value || typeof value !== 'object') return false;
  const panel = value as { id?: unknown; rect?: unknown };
  if (typeof panel.id !== 'string' || !panel.rect || typeof panel.rect !== 'object') return false;
  const rect = panel.rect as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(rect[key] as number));
};

const isEntry = (value: unknown): value is HistoryEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HistoryEntry>;
  return typeof entry.id === 'string' && typeof entry.at === 'string' && Boolean(entry.doc);
};

/** Read snapshots oldest-first. A corrupt file never blocks editing. */
export function readHistory(dataRoot: string, volume: string, chapter: string, pageIndex: number): HistoryEntry[] {
  const file = historyFilePath(dataRoot, volume, chapter, pageIndex);
  if (!fs.existsSync(file)) return [];
  try {
    const stored = readStoredFile<HistoryFile>(file, HISTORY_KIND);
    const entries = stored?.data?.entries;
    return Array.isArray(entries) ? entries.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeHistory(
  dataRoot: string,
  volume: string,
  chapter: string,
  pageIndex: number,
  entries: HistoryEntry[],
): void {
  const file = historyFilePath(dataRoot, volume, chapter, pageIndex);
  assertWritableFile(file, HISTORY_KIND);
  writeStoredFile(file, HISTORY_KIND, { volume, chapter, pageIndex, entries });
}

const RECT_EPS = 0.0015;

/** Structural comparison used for the panel/annotation counts shown in the history panel. */
export function diffDocs(prev: PageDoc | null, next: PageDoc): HistoryDiff {
  const before = new Map<string, PanelRect>();
  for (const panel of prev?.panels ?? []) before.set(panel.id, panel.rect);
  const after = new Map<string, PanelRect>();
  for (const panel of next.panels ?? []) after.set(panel.id, panel.rect);

  let added = 0;
  let removed = 0;
  let moved = 0;
  let resized = 0;
  for (const [id, rect] of after) {
    const old = before.get(id);
    if (!old) {
      added++;
      continue;
    }
    if (Math.abs(old.x - rect.x) > RECT_EPS || Math.abs(old.y - rect.y) > RECT_EPS) moved++;
    if (Math.abs(old.w - rect.w) > RECT_EPS || Math.abs(old.h - rect.h) > RECT_EPS) resized++;
  }
  for (const id of before.keys()) if (!after.has(id)) removed++;

  const annotations = next.annotations?.length ?? 0;
  const prevAnnotations = prev?.annotations?.length ?? 0;
  const notes = next.notes?.length ?? 0;
  const prevNotes = prev?.notes?.length ?? 0;
  return {
    panels: after.size,
    panelsDelta: after.size - before.size,
    added,
    removed,
    moved,
    resized,
    annotations,
    annotationsDelta: annotations - prevAnnotations,
    notes,
    notesDelta: notes - prevNotes,
  };
}

/**
 * Append (or, for a burst of auto-saves, extend) a snapshot.
 * Returns null when the history file cannot be written; saving the page must still win.
 */
export function recordVersion(
  dataRoot: string,
  next: PageDoc,
  prev: PageDoc | null,
  opts: RecordOptions,
): HistoryEntry | null {
  const entries = readHistory(dataRoot, next.volume, next.chapter, next.pageIndex);
  const at = opts.at ?? new Date().toISOString();
  const last = entries[entries.length - 1];
  const merge =
    opts.source === 'auto' &&
    last?.source === 'auto' &&
    Number.isFinite(Date.parse(last.at)) &&
    Math.abs(Date.parse(at) - Date.parse(last.at)) < AUTO_MERGE_MS;

  let entry: HistoryEntry = {
    id: randomUUID(),
    at,
    source: opts.source,
    summary: opts.summary ?? '',
    diff: diffDocs(prev, next),
    editCount: Math.max(0, Math.round(Number(next.editCount) || 0)),
    doc: next,
  };

  if (merge) {
    // Keep one version for the whole auto-save burst, but diff it against the state
    // before the burst so the summary still describes everything that changed.
    const base = entries[entries.length - 2]?.doc ?? prev ?? null;
    entry = { ...entry, id: last.id, diff: diffDocs(base, next) };
    entries[entries.length - 1] = entry;
  } else {
    entries.push(entry);
  }

  const limit = readHistoryLimit(dataRoot);
  if (entries.length > limit) entries.splice(0, entries.length - limit);

  try {
    writeHistory(dataRoot, next.volume, next.chapter, next.pageIndex, entries);
  } catch {
    return null;
  }
  return entry;
}

/** Lightweight list for the dialog: no notes/images, newest first. */
export function listVersions(
  dataRoot: string,
  volume: string,
  chapter: string,
  pageIndex: number,
): { entries: VersionSummary[]; limit: number } {
  const entries = readHistory(dataRoot, volume, chapter, pageIndex);
  return {
    limit: readHistoryLimit(dataRoot),
    entries: [...entries].reverse().map(({ doc, ...entry }) => ({
      ...entry,
      panelCount: doc?.panels?.length ?? 0,
      annotationCount: doc?.annotations?.length ?? 0,
      noteCount: doc?.notes?.length ?? 0,
      panels: (doc?.panels ?? []).filter(isPanel).map((panel) => ({ id: panel.id, rect: panel.rect })),
    })),
  };
}

export function findVersion(
  dataRoot: string,
  volume: string,
  chapter: string,
  pageIndex: number,
  id: string,
): HistoryEntry | null {
  return readHistory(dataRoot, volume, chapter, pageIndex).find((entry) => entry.id === id) ?? null;
}
