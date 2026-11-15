/**
 * Automatic local backups.
 *
 * Reuses `createBackupBuffer()` (the same archive as the manual backup button) and writes
 * it to `exports/` with an `auto-backup-` prefix, so pruning can never delete a
 * user-triggered `backup-*.zip`. Configuration lives in `data/library.json`; the last run
 * is recorded under `data/cache/` so it is not bundled into the next archive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createBackupBuffer } from './backup.ts';
import { readLibraryConfig } from './library.ts';
import type { LibraryConfig } from './library.ts';
import { AppError } from './errors.ts';

export type AutoBackupConfig = {
  enabled: boolean;
  /** Hours between runs (clamped 1..168). */
  intervalHours: number;
  /** How many automatic archives to keep (clamped 1..50). */
  keep: number;
};

export type AutoBackupState = {
  lastRunAt?: string;
  lastFile?: string;
  lastSize?: number;
  lastError?: string;
};

export type AutoBackupFile = { name: string; size: number; at: string };

export const DEFAULT_AUTO_BACKUP: AutoBackupConfig = { enabled: false, intervalHours: 24, keep: 7 };

const FILE_PREFIX = 'auto-backup-';
const STATE_FILE = 'backup-schedule.json';

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Normalize the stored config; unknown or out-of-range values fall back to defaults. */
export function normalizeAutoBackupConfig(raw: unknown): AutoBackupConfig {
  const input = (raw ?? {}) as Partial<AutoBackupConfig>;
  return {
    enabled: Boolean(input.enabled),
    intervalHours: clampInt(input.intervalHours, 1, 168, DEFAULT_AUTO_BACKUP.intervalHours),
    keep: clampInt(input.keep, 1, 50, DEFAULT_AUTO_BACKUP.keep),
  };
}

export function readAutoBackupConfig(cfg: LibraryConfig): AutoBackupConfig {
  return normalizeAutoBackupConfig(cfg.autoBackup);
}

/** The state file is disposable cache: a missing or corrupt one just means "never ran". */
function statePath(dataRoot: string): string {
  return path.join(dataRoot, 'cache', STATE_FILE);
}

export function readAutoBackupState(dataRoot: string): AutoBackupState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(dataRoot), 'utf8')) as AutoBackupState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAutoBackupState(dataRoot: string, state: AutoBackupState): void {
  try {
    const file = statePath(dataRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch {
    /* Losing the bookkeeping only means the next start may run one extra backup. */
  }
}

/** Automatic archives only, newest first; manual `backup-*.zip` files are never listed. */
export function listAutoBackups(exportRoot: string): AutoBackupFile[] {
  try {
    return fs
      .readdirSync(exportRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(FILE_PREFIX) && entry.name.endsWith('.zip'))
      .map((entry) => {
        const stat = fs.statSync(path.join(exportRoot, entry.name));
        return { name: entry.name, size: stat.size, at: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/** Delete the oldest automatic archives beyond `keep`; returns how many were removed. */
export function pruneAutoBackups(exportRoot: string, keep: number): number {
  const files = listAutoBackups(exportRoot);
  let removed = 0;
  for (const file of files.slice(Math.max(1, keep))) {
    try {
      fs.unlinkSync(path.join(exportRoot, file.name));
      removed++;
    } catch {
      /* Keep going: one unremovable file must not block the rest. */
    }
  }
  return removed;
}

export function isAutoBackupDue(config: AutoBackupConfig, state: AutoBackupState, now = Date.now()): boolean {
  if (!config.enabled) return false;
  if (!state.lastRunAt) return true;
  const last = new Date(state.lastRunAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now - last >= config.intervalHours * 3_600_000;
}

export type AutoBackupResult = { file: string; size: number; entries: number; at: string; pruned: number };

/** Create one archive, record the run and prune old automatic archives. */
export function runAutoBackup(dataRoot: string, exportRoot: string, config: AutoBackupConfig): AutoBackupResult {
  const at = new Date().toISOString();
  try {
    const { buffer, entries } = createBackupBuffer(dataRoot);
    fs.mkdirSync(exportRoot, { recursive: true });
    const stamp = at.replace(/[:.]/g, '-');
    // A fixed-width suffix keeps runs in the same millisecond from overwriting each other
    // and makes the newest file sort last by name alone.
    let index = 0;
    let name = '';
    do {
      name = `${FILE_PREFIX}${stamp}_${String(index).padStart(3, '0')}.zip`;
      index += 1;
    } while (fs.existsSync(path.join(exportRoot, name)));
    fs.writeFileSync(path.join(exportRoot, name), buffer);
    const pruned = pruneAutoBackups(exportRoot, config.keep);
    writeAutoBackupState(dataRoot, { lastRunAt: at, lastFile: name, lastSize: buffer.length });
    return { file: name, size: buffer.length, entries, at, pruned };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    writeAutoBackupState(dataRoot, { ...readAutoBackupState(dataRoot), lastError: detail });
    throw new AppError('ERR_AUTO_BACKUP_FAILED', { detail }, 500);
  }
}

/**
 * Check once a minute whether a backup is due. The long start delay keeps server boot
 * responsive; both timers are unref'd so they never hold the process or tests open.
 */
export function startAutoBackupScheduler(opts: { dataRoot: string; exportRoot: string; checkMs?: number }): () => void {
  const check = () => {
    try {
      const config = readAutoBackupConfig(readLibraryConfig(opts.dataRoot));
      if (!isAutoBackupDue(config, readAutoBackupState(opts.dataRoot))) return;
      runAutoBackup(opts.dataRoot, opts.exportRoot, config);
    } catch {
      /* runAutoBackup already recorded the error in the state file. */
    }
  };
  const interval = setInterval(check, opts.checkMs ?? 60_000);
  interval.unref?.();
  const boot = setTimeout(check, 5_000);
  boot.unref?.();
  return () => {
    clearInterval(interval);
    clearTimeout(boot);
  };
}
