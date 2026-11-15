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

function parseRecord(file: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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

/** Write a data file with the current envelope, atomically. */
export function writeStoredFile(file: string, kind: ExchangeKind, value: unknown): void {
  const prepared = prepareExchange(kind, value, { strict: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(prepared.value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Read a file purely to keep unknown fields during a rewrite (null when absent). */
export function readRawRecord(file: string): Record<string, unknown> | null {
  return parseRecord(file);
}

/** Raw JSON value (arrays included) for multi-item files such as export templates. */
export function readRawValue(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
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
