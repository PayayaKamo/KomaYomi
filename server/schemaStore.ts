/**
 * Schema-versioned access to the app's own JSON data files.
 *
 * Exchange files (imports/exports) are validated strictly in `shared/format.ts`. Files we
 * own under `data/` use the same envelope and migration chain, but stay readable if a
 * field is missing: a broken optional field must not lock the user out of a page.
 *
 * When a file is older than the current schema it is migrated in place and the original
 * bytes are kept as `<file>.v<old>.bak`, so an upgrade can always be rolled back by hand.
 * When a file is *newer* (written by a future build) reads still work, but writes are
 * refused with 409 instead of silently dropping the fields we do not understand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CURRENT_SCHEMA_VERSION, checkSchemaVersion, prepareExchange } from '../shared/format.ts';
import type { ExchangeKind } from '../shared/format.ts';
import { AppError } from './errors.ts';

export type StoredRead<T> = {
  data: T;
  /** Set when the file was migrated from an older schema on this read. */
  migratedFrom?: number;
  /** True when the file declares a schema version newer than this build. */
  newer: boolean;
};

/** Editors such as Notepad prefix a UTF-8 BOM; JSON.parse rejects it. */
const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Outcome of reading a JSON data file. `parseRecord` collapses all failures to null,
 * which is useful for callers that just need "is this readable"; the HTTP layer uses
 * this type to tell the user *why* a page refused to load.
 */
export type StoredInspection =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'missing' | 'io' | 'syntax' | 'shape'; detail: string };

export function inspectStoredFile(file: string): StoredInspection {
  let text: string;
  try {
    text = stripBom(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'missing', detail: 'file not found' };
    return { ok: false, reason: 'io', detail: err instanceof Error ? err.message : String(err) };
  }
  if (!text.trim()) {
    // A zero-byte file is the classic signature of an interrupted write.
    return { ok: false, reason: 'syntax', detail: 'file is empty' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, reason: 'syntax', detail: err instanceof Error ? err.message : String(err) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const kind = Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed;
    return { ok: false, reason: 'shape', detail: `top level is ${kind}` };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}

function parseRecord(file: string): Record<string, unknown> | null {
  const inspection = inspectStoredFile(file);
  return inspection.ok ? inspection.data : null;
}

/** Read + migrate a data file. Returns null when the file is absent or not an object. */
export function readStoredFile<T>(file: string, kind: ExchangeKind): StoredRead<T> | null {
  const record = parseRecord(file);
  if (!record) return null;

  let declared: number;
  try {
    declared = checkSchemaVersion(kind, record.schemaVersion);
  } catch {
    // A newer schema is readable, just not writable.
    return { data: record as T, newer: true };
  }
  if (declared >= CURRENT_SCHEMA_VERSION[kind]) return { data: record as T, newer: false };

  let prepared;
  try {
    prepared = prepareExchange(kind, record, { strict: false });
  } catch (err) {
    throw new AppError(
      'ERR_SCHEMA_MIGRATION',
      { file: path.basename(file), from: declared, detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }

  // Keep the pre-migration bytes once; later migrations add their own backup.
  try {
    const backup = `${file}.v${declared}.bak`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    writeStoredFile(file, kind, prepared.value);
  } catch {
    /* Read-only data directory: keep the migrated value in memory. */
  }

  return { data: prepared.value as T, migratedFrom: prepared.migratedFrom, newer: false };
}

/** Throw 409 when the file on disk comes from a newer build. */
export function assertWritableFile(file: string, kind: ExchangeKind): void {
  const record = parseRecord(file);
  if (!record) return;
  try {
    checkSchemaVersion(kind, record.schemaVersion);
  } catch {
    throw new AppError(
      'ERR_SCHEMA_TOO_NEW',
      { found: Number(record.schemaVersion) || 0, supported: CURRENT_SCHEMA_VERSION[kind] },
      409,
    );
  }
}

/**
 * Write a data file atomically: serialize to a sibling temp file, flush it, then rename
 * over the target. A crash or a full disk leaves only the temp file behind, never a
 * half-written document at the real path. The temp file is removed on failure.
 */
export function writeStoredFile(file: string, kind: ExchangeKind, value: unknown): void {
  const prepared = prepareExchange(kind, value, { strict: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(prepared.value, null, 2), 'utf8');
      // Flush before rename so a power cut cannot publish an empty/partial document.
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort: never mask the original failure */
    }
    throw err;
  }
}

/** A writer holding the lock for longer than this is assumed to have died. */
const LOCK_STALE_MS = 10_000;

/**
 * Serialize writes to one data file across processes.
 *
 * Synchronous fs calls already cannot interleave inside one Node process, so this lock
 * targets a second server instance (desktop + dev server, two app windows) sharing the
 * same data directory. A write that finds the lock held is rejected with 409 instead of
 * being merged into the other writer's output.
 */
export function withFileLock<T>(file: string, fn: () => T): T {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const busy = () => new AppError('ERR_PAGE_BUSY', { file: path.basename(file) }, 409);
  const acquire = () => fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    acquire();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    let stale = false;
    try {
      stale = Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS;
    } catch {
      stale = true;
    }
    if (!stale) throw busy();
    try {
      fs.rmSync(lock, { force: true });
      acquire();
    } catch {
      throw busy();
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmSync(lock, { force: true });
    } catch {
      /* a stale lock is reclaimed after LOCK_STALE_MS */
    }
  }
}

/**
 * How many page revisions to keep next to the document (canonical `.bak` included).
 * Set `KOMAYOMI_PAGE_BACKUPS` to change it; 1 keeps only `.bak`.
 */
export function pageBackupLimit(): number {
  const raw = Number(process.env.KOMAYOMI_PAGE_BACKUPS);
  if (!Number.isFinite(raw) || raw < 1) return 3;
  return Math.min(20, Math.trunc(raw));
}

const backupPath = (file: string, n: number) => (n <= 0 ? `${file}.bak` : `${file}.bak.${n}`);

/**
 * Keep the previous valid revision before an overwrite: copy to `<file>.bak`, shifting
 * older copies to `.bak.1`, `.bak.2`, … and dropping anything past the limit.
 * Damaged files are never rotated into a good backup slot.
 */
export function rotatePageBackup(file: string, limit = pageBackupLimit()): boolean {
  if (limit < 1 || !fs.existsSync(file) || !parseRecord(file)) return false;
  try {
    if (limit > 1) {
      fs.rmSync(backupPath(file, limit - 1), { force: true });
      for (let n = limit - 2; n >= 1; n--) {
        if (fs.existsSync(backupPath(file, n))) fs.renameSync(backupPath(file, n), backupPath(file, n + 1));
      }
      if (fs.existsSync(backupPath(file, 0))) fs.renameSync(backupPath(file, 0), backupPath(file, 1));
    }
    fs.copyFileSync(file, backupPath(file, 0));
    return true;
  } catch {
    return false;
  }
}

/** Existing usable backups for a page, newest first (schema and rotation backups). */
export function listBackupCandidates(file: string): string[] {
  const dir = path.dirname(file);
  const base = path.basename(file);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(`${base}.`) && /\.bak(\.\d+)?$/.test(name) && !name.includes('.corrupt'))
    .map((name) => path.join(dir, name))
    .map((candidate) => {
      try {
        return { candidate, mtime: fs.statSync(candidate).mtimeMs };
      } catch {
        return { candidate, mtime: 0 };
      }
    })
    .filter((entry) => entry.mtime > 0)
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.candidate);
}

/**
 * Move a damaged document out of the way so the page can be rebuilt, keeping the bytes
 * for inspection as `<file>.corrupt-<timestamp>.bak`. Returns the archive path, or null
 * when the file is merely unreadable (locked/permission) rather than damaged.
 */
export function archiveUnreadableFile(file: string): string | null {
  const inspection = inspectStoredFile(file);
  if (inspection.ok || inspection.reason === 'missing' || inspection.reason === 'io') return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.corrupt-${stamp}.bak`;
  try {
    fs.renameSync(file, target);
    return target;
  } catch {
    try {
      fs.copyFileSync(file, target);
      fs.rmSync(file, { force: true });
      return target;
    } catch {
      return null;
    }
  }
}

/** Read a file purely to keep unknown fields during a rewrite (null when absent). */
export function readRawRecord(file: string): Record<string, unknown> | null {
  return parseRecord(file);
}

/** Raw JSON value (arrays included) for multi-item files such as export templates. */
export function readRawValue(file: string): unknown | null {
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, 'utf8'))) as unknown;
  } catch {
    return null;
  }
}

/**
 * True when the file exists but its JSON cannot be parsed.
 *
 * Missing files are normal (nothing saved yet); a file that is there but unreadable is
 * data loss waiting to happen if the next save overwrites it with defaults.
 */
export function isUnreadableFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  return parseRecord(file) === null;
}

/**
 * Copy an unreadable file to `<file>.corrupt.bak` before a write replaces it.
 * The first damaged copy wins so repeated saves cannot erase the evidence.
 */
export function backupUnreadableFile(file: string): boolean {
  if (!isUnreadableFile(file)) return false;
  try {
    const backup = `${file}.corrupt.bak`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    return true;
  } catch {
    return false;
  }
}

/** Copy the current bytes to `<file>.v<version>.bak` once, before an in-place migration. */
export function writeBackupOnce(file: string, version: number): void {
  try {
    const backup = `${file}.v${version}.bak`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  } catch {
    /* Read-only data directory: skip the backup rather than block the read. */
  }
}

/** Atomic JSON write for arrays of versioned items (each item is prepared by the caller). */
export function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
