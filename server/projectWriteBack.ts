/**
 * Write-back of the .mnproj the user opened.
 *
 * Opening a project still unpacks it into `data/` (and `raw/` for packaged projects) —
 * that stays the working copy, because editing a zip in place would mean rewriting the
 * whole archive on every keystroke. Instead, the opened file is *linked*: after any
 * successful write to the working copy, the project is re-packed and the linked file is
 * replaced atomically (temp file + fsync + rename), so the user's own .mnproj always
 * holds the latest state and reopening it shows the last edits.
 *
 * Deliberate limits:
 * - Only the exact file the user opened is written; "save as copy"/export never touches it.
 * - A failure never half-writes the file: the temp file is removed, the old bytes stay,
 *   and automatic retries pause until the user saves manually (avoids re-zipping a huge
 *   project on every keystroke while the target is locked or missing).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.ts';
import { createProjectBuffer } from './project.ts';
import type { ProjectStorageMode } from './project.ts';
import { writeJsonFile } from './schemaStore.ts';

export const PROJECT_LINK_VERSION = 1;
export const PROJECT_LINK_FILE = 'project-link.json';

/** One automatic write-back is coalesced into this window after the last edit. */
const WRITEBACK_DELAY_MS = (() => {
  const raw = Number(process.env.KOMAYOMI_PROJECT_WRITEBACK_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 1200;
})();

/** Keep a known-good copy, but do not copy a large archive on every single save. */
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

export type ProjectLink = {
  schemaVersion: number;
  kind: 'project-link';
  /** Absolute path of the .mnproj the user opened. */
  path: string;
  storageMode: ProjectStorageMode;
  name?: string;
  /** manifest.notes.text of the opened file, carried through write-backs. */
  notes?: string;
  /** manifest.createdAt of the opened file, preserved so reopening keeps the original date. */
  createdAt?: string;
  linkedAt: string;
  lastWriteAt?: string;
  lastWriteSize?: number;
  lastWriteSha1?: string;
  /** Automatic write-back stopped after a failure; a manual save resumes it. */
  paused?: boolean;
  lastError?: string;
};

export type ProjectWriteBackResult = {
  path: string;
  size: number;
  sha1: string;
  at: string;
  /** Backup written before the replacement, when one was rotated. */
  backup: string | null;
};

export type ProjectSyncStatus = {
  linked: boolean;
  path?: string;
  storageMode?: ProjectStorageMode;
  name?: string;
  notes?: string;
  createdAt?: string;
  linkedAt?: string;
  lastWriteAt?: string;
  lastWriteSize?: number;
  /** An edit happened and the file has not been rewritten yet. */
  pending: boolean;
  paused: boolean;
  lastError?: string;
};

const linkFile = (dataRoot: string) => path.join(dataRoot, PROJECT_LINK_FILE);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** Read the link record; anything malformed reads as "nothing is linked". */
export function readProjectLink(dataRoot: string): ProjectLink | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(linkFile(dataRoot), 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const target = str(record.path);
  // A relative target cannot be resolved safely later on.
  if (!target || !path.isAbsolute(target)) return null;
  return {
    schemaVersion: PROJECT_LINK_VERSION,
    kind: 'project-link',
    path: path.resolve(target),
    storageMode: record.storageMode === 'packaged' ? 'packaged' : 'reference',
    name: str(record.name),
    notes: str(record.notes),
    createdAt: str(record.createdAt),
    linkedAt: str(record.linkedAt) ?? new Date().toISOString(),
    lastWriteAt: str(record.lastWriteAt),
    lastWriteSize: Number.isFinite(record.lastWriteSize) ? Number(record.lastWriteSize) : undefined,
    lastWriteSha1: str(record.lastWriteSha1),
    paused: record.paused === true ? true : undefined,
    lastError: str(record.lastError),
  };
}

export function saveProjectLink(dataRoot: string, link: ProjectLink): void {
  fs.mkdirSync(dataRoot, { recursive: true });
  writeJsonFile(linkFile(dataRoot), { ...link, schemaVersion: PROJECT_LINK_VERSION, kind: 'project-link' });
}

/** Record that saves must now be written back to this file. */
export function linkProject(
  dataRoot: string,
  input: { path: string; storageMode: ProjectStorageMode; name?: string; notes?: string; createdAt?: string },
): ProjectLink {
  const link: ProjectLink = {
    schemaVersion: PROJECT_LINK_VERSION,
    kind: 'project-link',
    path: path.resolve(input.path),
    storageMode: input.storageMode === 'packaged' ? 'packaged' : 'reference',
    name: str(input.name),
    notes: str(input.notes),
    createdAt: str(input.createdAt),
    linkedAt: new Date().toISOString(),
  };
  saveProjectLink(dataRoot, link);
  return link;
}

/** Forget the link (import of another project, backup restore, or an explicit unlink). */
export function clearProjectLink(dataRoot: string): boolean {
  try {
    fs.rmSync(linkFile(dataRoot), { force: true });
    return true;
  } catch {
    return false;
  }
}

const sha1Hex = (buf: Buffer) => createHash('sha1').update(buf).digest('hex');

/** Validate a path coming from the desktop file picker before reading it. */
export function resolveProjectFilePath(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw || !path.isAbsolute(raw) || !/\.(mnproj|zip)$/i.test(raw)) {
    throw new AppError('ERR_PROJECT_PATH_INVALID', {}, 400);
  }
  const target = path.resolve(raw);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new AppError('ERR_PROJECT_FILE_MISSING', { path: target }, 404);
  }
  if (!stat.isFile()) throw new AppError('ERR_PROJECT_FILE_MISSING', { path: target }, 404);
  return target;
}

export function readProjectFile(target: string): Buffer {
  try {
    return fs.readFileSync(target);
  } catch {
    throw new AppError('ERR_PROJECT_FILE_MISSING', { path: target }, 404);
  }
}

/**
 * Replace the archive in one step: write a sibling temp file, flush it, then rename.
 * A crash leaves either the old file or the complete new one, never a partial archive.
 */
function replaceFileAtomically(target: string, data: Buffer): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort: never mask the original failure */
    }
    throw err;
  }
}

/**
 * Keep `<file>.bak` as the previous state, refreshed at most every BACKUP_INTERVAL_MS so a
 * burst of saves does not copy a huge archive repeatedly. Atomic rename already protects
 * against a half-written file; this copy protects against a bad re-pack of good data.
 */
function rotateProjectBackup(target: string): string | null {
  const backup = `${target}.bak`;
  try {
    if (!fs.existsSync(target)) return null;
    if (fs.existsSync(backup) && Date.now() - fs.statSync(backup).mtimeMs < BACKUP_INTERVAL_MS) return null;
    fs.copyFileSync(target, backup);
    return backup;
  } catch {
    return null;
  }
}

/** Validate a "save as" destination that usually does not exist yet. */
export function resolveProjectSavePath(input: unknown, dataRoot: string): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw || !path.isAbsolute(raw) || !/\.mnproj$/i.test(raw)) {
    throw new AppError('ERR_PROJECT_PATH_INVALID', {}, 400);
  }
  const target = path.resolve(raw);
  // "Save as" must never overwrite the file the user opened: that is what save does.
  const linked = readProjectLink(dataRoot);
  if (linked && linked.path.toLowerCase() === target.toLowerCase()) {
    throw new AppError('ERR_PROJECT_SAVE_AS_LINKED', { path: target }, 409);
  }
  let dirStat: fs.Stats;
  try {
    dirStat = fs.statSync(path.dirname(target));
  } catch {
    throw new AppError('ERR_PROJECT_PATH_INVALID', {}, 400);
  }
  if (!dirStat.isDirectory()) throw new AppError('ERR_PROJECT_PATH_INVALID', {}, 400);
  return target;
}

/**
 * Write a standalone copy. It is never linked and never touches the opened file, so a
 * "save as" keeps producing copies even while another .mnproj receives write-backs.
 */
export function writeProjectCopy(
  target: string,
  buffer: Buffer,
): { path: string; size: number; sha1: string; at: string } {
  try {
    replaceFileAtomically(target, buffer);
  } catch (err) {
    throw new AppError('ERR_PROJECT_WRITE_FAILED', { detail: err instanceof Error ? err.message : String(err) }, 500);
  }
  return { path: target, size: buffer.length, sha1: sha1Hex(buffer), at: new Date().toISOString() };
}

/** Re-pack the working copy and overwrite the linked .mnproj. */
export function writeBackProject(opts: {
  rootDir: string;
  dataRoot: string;
  rawRoot?: string;
}): ProjectWriteBackResult {
  const link = readProjectLink(opts.dataRoot);
  if (!link) throw new AppError('ERR_PROJECT_NOT_LINKED', {}, 409);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(link.path);
  } catch {
    throw new AppError('ERR_PROJECT_FILE_MISSING', { path: link.path }, 409);
  }
  if (!stat.isFile()) throw new AppError('ERR_PROJECT_FILE_MISSING', { path: link.path }, 409);

  const packed = createProjectBuffer({
    rootDir: opts.rootDir,
    rawRoot: opts.rawRoot,
    dataRoot: opts.dataRoot,
    storageMode: link.storageMode,
    name: link.name,
    notes: link.notes,
    createdAt: link.createdAt,
  });

  const backup = rotateProjectBackup(link.path);
  try {
    replaceFileAtomically(link.path, packed.buffer);
  } catch (err) {
    throw new AppError('ERR_PROJECT_WRITE_FAILED', { detail: err instanceof Error ? err.message : String(err) }, 500);
  }

  const at = new Date().toISOString();
  const sha1 = sha1Hex(packed.buffer);
  saveProjectLink(opts.dataRoot, {
    ...link,
    lastWriteAt: at,
    lastWriteSize: packed.buffer.length,
    lastWriteSha1: sha1,
    paused: undefined,
    lastError: undefined,
  });
  return { path: link.path, size: packed.buffer.length, sha1, at, backup };
}

export type ProjectSync = {
  /** An edit landed in the working copy; write it back soon. */
  markDirty: () => void;
  /** Write back immediately (manual save), or do nothing when nothing is linked. */
  flush: () => ProjectWriteBackResult | null;
  status: () => ProjectSyncStatus;
};

/** Flush on process exit so an edit made right before quitting still reaches the file. */
const activeSyncs = new Set<() => void>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const flush of activeSyncs) {
      try {
        flush();
      } catch {
        /* the app is quitting; nothing left to report to */
      }
    }
  });
}

export function createProjectSync(opts: { rootDir: string; dataRoot: string; rawRoot?: string }): ProjectSync {
  let timer: NodeJS.Timeout | null = null;
  let pending = false;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = (manual: boolean): ProjectWriteBackResult | null => {
    cancel();
    const link = readProjectLink(opts.dataRoot);
    if (!link) {
      pending = false;
      return null;
    }
    // A paused link waits for an explicit save instead of retrying on every edit.
    if (!manual && link.paused) {
      pending = false;
      return null;
    }
    try {
      const result = writeBackProject(opts);
      pending = false;
      return result;
    } catch (err) {
      pending = false;
      try {
        saveProjectLink(opts.dataRoot, {
          ...link,
          paused: true,
          lastError: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* the link file itself is unwritable: the in-memory error is still reported */
      }
      throw err;
    }
  };

  const sync: ProjectSync = {
    markDirty() {
      installExitHook();
      pending = true;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        try {
          run(false);
        } catch {
          // Recorded on the link record (paused + lastError) and shown in the UI.
        }
      }, WRITEBACK_DELAY_MS);
      // Never keep the process alive just for a pending write-back.
      timer.unref?.();
    },
    flush() {
      return run(true);
    },
    status() {
      const link = readProjectLink(opts.dataRoot);
      return {
        linked: Boolean(link),
        path: link?.path,
        storageMode: link?.storageMode,
        name: link?.name,
        notes: link?.notes,
        createdAt: link?.createdAt,
        linkedAt: link?.linkedAt,
        lastWriteAt: link?.lastWriteAt,
        lastWriteSize: link?.lastWriteSize,
        pending,
        paused: link?.paused === true,
        lastError: link?.lastError,
      };
    },
  };

  activeSyncs.add(() => {
    if (pending) sync.flush();
  });
  return sync;
}
