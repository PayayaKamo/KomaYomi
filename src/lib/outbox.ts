/**
 * Offline write queue for every write the UI expects the server to persist.
 *
 * It started as a page-document-only queue; it now carries several kinds of operation
 * (page docs, volume language-directory mapping, compare language order, panel templates,
 * alignment presets). Each operation declares a dedupe key, so queueing the same target
 * again replaces the earlier payload (last write wins). Replaying is therefore safe to
 * repeat: it can never create duplicate entries, and a stale replay cannot drop a newer
 * queued write.
 */
import type { HistorySource } from '../api';
import type { AlignPreset, Lang, PageDoc, PanelRect, ReadingDirection } from '../types';

const LEGACY_STORAGE_KEY = 'manga-memo.outbox.v1';
const STORAGE_KEY = 'manga-memo.outbox.v2';
/** Bumped when the stored envelope changes; v1 was a bare array of page documents. */
export const OUTBOX_SCHEMA_VERSION = 2;
/** Hard cap so a long offline session cannot grow the queue without bound. */
const MAX_ENTRIES = 100;

export type PanelTemplateInput = {
  name: string;
  volume: string;
  chapter: string;
  panels: PanelRect[];
  readingDirection: ReadingDirection;
};

export type AlignPresetInput = Partial<AlignPreset> & { name: string; volume: string; chapter: string };

/** A single write waiting for the server. The kind decides how it is replayed. */
export type OutboxOp =
  | { kind: 'page'; doc: PageDoc; source: HistorySource }
  | { kind: 'volumeDirs'; volume: string; dirs: Partial<Record<Lang, string | null>> }
  | { kind: 'langOrder'; order: Lang[] }
  | { kind: 'panelTemplate'; input: PanelTemplateInput }
  | { kind: 'alignPreset'; preset: AlignPresetInput };

type OutboxMeta = {
  /** Dedupe key: one entry per target, latest write wins. */
  key: string;
  at: string;
  attempts: number;
};

export type OutboxEntry = OutboxOp & OutboxMeta;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to queue changes (enqueue / drop / clear) for the pending-count chip. */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function outboxKeyOf(doc: Pick<PageDoc, 'volume' | 'chapter' | 'pageIndex'>): string {
  return `page|${doc.volume}|${doc.chapter}|${doc.pageIndex}`;
}

/**
 * Merge key per operation kind. Operations that create a new server-side record use the
 * user-visible identity (name + volume + chapter) so repeated offline saves collapse into
 * one replay instead of producing duplicates.
 */
export function outboxOpKey(op: OutboxOp): string {
  switch (op.kind) {
    case 'page':
      return outboxKeyOf(op.doc);
    case 'volumeDirs':
      return `volumeDirs|${op.volume}`;
    case 'langOrder':
      return 'langOrder';
    case 'panelTemplate':
      return `panelTemplate|${op.input.volume}|${op.input.chapter}|${op.input.name}`;
    case 'alignPreset':
      return `alignPreset|${op.preset.volume}|${op.preset.chapter}|${op.preset.name}`;
  }
}

function storage(): Storage | null {
  // Node (unit tests) has a stub `localStorage` that warns when touched; the queue is
  // browser-only, so bail out before looking at it.
  if (typeof window === 'undefined') return null;
  try {
    return localStorage;
  } catch {
    // Accessing localStorage throws when storage is disabled by policy.
    return null;
  }
}

function isPageDoc(doc: unknown): doc is PageDoc {
  const value = doc as PageDoc | null;
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.volume === 'string' &&
    typeof value.chapter === 'string' &&
    Number.isInteger(value.pageIndex),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Rebuild an entry from storage, recomputing its key so old key formats self-heal. */
function coerceEntry(value: unknown): OutboxEntry | null {
  if (!isRecord(value)) return null;
  const at = typeof value.at === 'string' ? value.at : new Date().toISOString();
  const attempts = typeof value.attempts === 'number' ? value.attempts : 0;
  // v1 entries were page documents with no `kind`.
  const kind = value.kind ?? 'page';
  if (kind === 'page') {
    if (!isPageDoc(value.doc)) return null;
    const source = typeof value.source === 'string' ? (value.source as HistorySource) : 'auto';
    return { kind, key: outboxKeyOf(value.doc), at, attempts, doc: value.doc, source };
  }
  if (kind === 'volumeDirs') {
    if (typeof value.volume !== 'string' || !isRecord(value.dirs)) return null;
    return {
      kind,
      key: `volumeDirs|${value.volume}`,
      at,
      attempts,
      volume: value.volume,
      dirs: value.dirs as Partial<Record<Lang, string | null>>,
    };
  }
  if (kind === 'langOrder') {
    if (!Array.isArray(value.order) || !value.order.every((lang) => typeof lang === 'string')) return null;
    return { kind, key: 'langOrder', at, attempts, order: value.order as Lang[] };
  }
  if (kind === 'panelTemplate') {
    const input = value.input;
    if (
      !isRecord(input) ||
      typeof input.name !== 'string' ||
      typeof input.volume !== 'string' ||
      typeof input.chapter !== 'string' ||
      !Array.isArray(input.panels)
    ) {
      return null;
    }
    return {
      kind,
      key: `panelTemplate|${input.volume}|${input.chapter}|${input.name}`,
      at,
      attempts,
      input: input as PanelTemplateInput,
    };
  }
  if (kind === 'alignPreset') {
    const preset = value.preset;
    if (!isRecord(preset) || typeof preset.name !== 'string' || typeof preset.volume !== 'string') return null;
    return {
      kind,
      key: `alignPreset|${preset.volume}|${String(preset.chapter ?? '')}|${preset.name}`,
      at,
      attempts,
      preset: preset as AlignPresetInput,
    };
  }
  return null;
}

function parseEntries(text: string): OutboxEntry[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.entries : null;
  if (!Array.isArray(list)) return [];
  return list.map(coerceEntry).filter((entry): entry is OutboxEntry => entry !== null);
}

/** Fold a v1 queue into the current key so an update never loses pending offline work. */
function migrateLegacy(store: Storage): OutboxEntry[] {
  try {
    const text = store.getItem(LEGACY_STORAGE_KEY);
    if (!text) return [];
    const entries = parseEntries(text);
    if (entries.length) store.setItem(STORAGE_KEY, serialize(entries));
    store.removeItem(LEGACY_STORAGE_KEY);
    return entries;
  } catch {
    return [];
  }
}

function readRaw(): OutboxEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const text = store.getItem(STORAGE_KEY);
    return text ? parseEntries(text) : migrateLegacy(store);
  } catch {
    return [];
  }
}

function serialize(entries: OutboxEntry[]): string {
  return JSON.stringify({ schemaVersion: OUTBOX_SCHEMA_VERSION, entries });
}

/** Drop pasted screenshots (by far the largest field) so the notes text always survives. */
function stripImages(entries: OutboxEntry[]): OutboxEntry[] {
  return entries.map((entry) => {
    if (entry.kind !== 'page' || !Array.isArray(entry.doc.notes)) return entry;
    return {
      ...entry,
      doc: {
        ...entry.doc,
        notes: entry.doc.notes.map((note) => (note.images?.length ? { ...note, images: undefined } : note)),
      },
    };
  });
}

/**
 * Persist the queue. On a quota error, retry once after stripping screenshots from page
 * entries so the text itself is never dropped.
 */
function writeRaw(entries: OutboxEntry[]): boolean {
  const store = storage();
  if (!store) return false;
  const save = (list: OutboxEntry[]): boolean => {
    try {
      store.setItem(STORAGE_KEY, serialize(list));
      return true;
    } catch {
      return false;
    }
  };
  if (save(entries)) return true;
  return save(stripImages(entries));
}

export function listOutbox(): OutboxEntry[] {
  return readRaw();
}

export function pendingOutboxCount(): number {
  return readRaw().length;
}

/** Queue an operation for later replay; an earlier entry for the same key is replaced. */
export function enqueueOutbox(op: OutboxOp): boolean {
  const key = outboxOpKey(op);
  const entries = readRaw();
  const previous = entries.find((entry) => entry.key === key);
  const next = entries.filter((entry) => entry.key !== key);
  // Timestamps identify a revision when replaying, so keep them strictly increasing per
  // key even when two writes land in the same millisecond.
  const now = Date.now();
  const previousAt = previous ? Date.parse(previous.at) : Number.NaN;
  const stamp = Number.isFinite(previousAt) && previousAt >= now ? previousAt + 1 : now;
  const entry = {
    ...op,
    key,
    at: new Date(stamp).toISOString(),
    attempts: (previous?.attempts ?? 0) + 1,
  } as OutboxEntry;
  next.push(entry);
  const ok = writeRaw(next.slice(-MAX_ENTRIES));
  if (ok) emit();
  return ok;
}

/**
 * Remove a replayed entry. Pass the replayed entry's `at` so a newer write queued for the
 * same key while the request was in flight is kept instead of being silently discarded.
 */
export function dropOutbox(key: string, at?: string): void {
  const entries = readRaw();
  const next = entries.filter((entry) => entry.key !== key || (at !== undefined && entry.at !== at));
  if (next.length === entries.length) return;
  writeRaw(next);
  emit();
}

export function clearOutbox(): void {
  const store = storage();
  try {
    store?.removeItem(STORAGE_KEY);
    store?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* Ignored when storage is unavailable. */
  }
  emit();
}
