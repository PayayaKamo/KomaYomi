/**
 * Built-in demo project.
 *
 * The installer ships one .mnproj as an extra resource. Opening the demo never writes
 * that file: it is copied into the user's data directory and the copy is linked for
 * write-back, so notes and annotations made while exploring survive and the shipped
 * resource stays pristine.
 *
 * Opening a demo also unpacks its pages/images into the working copy, so this module
 * records exactly what the import added (data files, raw volume directories, config and
 * link backups). Closing the demo removes those additions again, which restores the
 * state the user had before they tried the demo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLibrary } from './library.ts';
import { importProject } from './project.ts';
import { clearProjectLink, linkProject, readProjectLink, PROJECT_LINK_FILE } from './projectWriteBack.ts';
import { AppError } from './errors.ts';

export const DEMO_STATE_FILE = 'demo-state.json';
const DEMO_BACKUP_DIR = 'demo-state';

export type DemoStatus = {
  active: boolean;
  name?: string;
  copy?: string;
  volumes?: string[];
  openedAt?: string;
};

type DemoState = {
  schemaVersion: number;
  kind: 'demo-state';
  copy: string;
  volumes: string[];
  /** Files added under data/ by the demo import (paths relative to data/). */
  addedData: string[];
  /** Top-level raw/ directories the demo created (kept when a same-named one already existed). */
  createdRawDirs: string[];
  hadConfig: boolean;
  hadLink: boolean;
  openedAt: string;
};

const statePath = (dataRoot: string) => path.join(dataRoot, DEMO_STATE_FILE);
const backupDir = (dataRoot: string) => path.join(dataRoot, DEMO_BACKUP_DIR);

function readState(dataRoot: string): DemoState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(dataRoot), 'utf8')) as Partial<DemoState>;
    if (!raw || typeof raw !== 'object' || raw.kind !== 'demo-state' || typeof raw.copy !== 'string') return null;
    return {
      schemaVersion: 1,
      kind: 'demo-state',
      copy: raw.copy,
      volumes: Array.isArray(raw.volumes) ? raw.volumes.filter((v): v is string => typeof v === 'string') : [],
      addedData: Array.isArray(raw.addedData) ? raw.addedData.filter((v): v is string => typeof v === 'string') : [],
      createdRawDirs: Array.isArray(raw.createdRawDirs)
        ? raw.createdRawDirs.filter((v): v is string => typeof v === 'string')
        : [],
      hadConfig: raw.hadConfig === true,
      hadLink: raw.hadLink === true,
      openedAt: typeof raw.openedAt === 'string' ? raw.openedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeState(dataRoot: string, state: DemoState): void {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(statePath(dataRoot), JSON.stringify(state, null, 2));
}

/** Relative posix paths of every file below `root` (empty when the directory is missing). */
function listFiles(root: string): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile()) out.add(childRel);
    }
  };
  walk(root, '');
  return out;
}

function dataSnapshot(dataRoot: string): Set<string> {
  return listFiles(dataRoot);
}

/** Files the demo import must never delete on exit (they are restored or belong to us). */
function isProtectedDataPath(rel: string): boolean {
  const top = rel.split('/')[0];
  return (
    rel === 'library.json' ||
    rel === PROJECT_LINK_FILE ||
    rel === DEMO_STATE_FILE ||
    top === DEMO_BACKUP_DIR ||
    top === 'backups' ||
    top === 'cache'
  );
}

function topLevelDirs(root: string): Set<string> {
  try {
    return new Set(
      fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
  } catch {
    return new Set();
  }
}

function removeEmptyDirs(root: string, rel: string): void {
  let dir = path.join(root, rel);
  while (dir.startsWith(root) && dir !== root) {
    try {
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
      else return;
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/** Copy the shipped demo once, or again when a newer build carries a different file. */
function ensureWorkingCopy(source: string, copy: string): void {
  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(source);
  } catch {
    throw new AppError('ERR_PROJECT_FILE_MISSING', { path: source }, 404);
  }
  if (!sourceStat.isFile()) throw new AppError('ERR_PROJECT_FILE_MISSING', { path: source }, 404);

  const stampFile = `${copy}.source`;
  const stamp = `${sourceStat.size}:${Math.trunc(sourceStat.mtimeMs)}`;
  let copied = false;
  try {
    copied = fs.statSync(copy).isFile();
  } catch {
    copied = false;
  }
  let stampMatches = false;
  try {
    stampMatches = fs.readFileSync(stampFile, 'utf8').trim() === stamp;
  } catch {
    stampMatches = false;
  }
  if (copied && stampMatches) return;

  fs.mkdirSync(path.dirname(copy), { recursive: true });
  const tmp = `${copy}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(source, tmp);
  fs.renameSync(tmp, copy);
  fs.writeFileSync(stampFile, stamp);
}

function demoSourcePath(explicit?: string): string {
  const chosen =
    explicit?.trim() ||
    process.env.KOMAYOMI_DEMO_PROJECT?.trim() ||
    // Source checkout (vite/electron dev): the packaged resource lives in resources/.
    path.join(process.cwd(), 'resources', 'demo-project.mnproj');
  return path.resolve(chosen);
}

function demoCopyPath(dataRoot: string, explicit?: string): string {
  const chosen =
    explicit?.trim() || process.env.KOMAYOMI_DEMO_COPY?.trim() || path.join(dataRoot, 'demo', 'demo-project.mnproj');
  return path.resolve(chosen);
}

export function demoStatus(dataRoot: string): DemoStatus {
  const state = readState(dataRoot);
  if (!state) return { active: false };
  return {
    active: true,
    name: path.basename(state.copy, path.extname(state.copy)),
    copy: state.copy,
    volumes: state.volumes,
    openedAt: state.openedAt,
  };
}

/**
 * Unpack the bundled demo into the working copy and link its user-directory copy.
 * The returned status is merged into the normal open response by the caller.
 */
export function openBuiltInDemo(opts: {
  rootDir: string;
  dataRoot: string;
  rawRoot: string;
  source?: string;
  copyPath?: string;
}): { library: ReturnType<typeof createLibrary>; status: DemoStatus } {
  const { rootDir, dataRoot, rawRoot } = opts;
  // A previous demo must be unwound first so its files do not get recorded as user data.
  if (readState(dataRoot)) closeBuiltInDemo({ rootDir, dataRoot, rawRoot });

  const source = demoSourcePath(opts.source);
  const copy = demoCopyPath(dataRoot, opts.copyPath);
  ensureWorkingCopy(source, copy);

  const beforeData = dataSnapshot(dataRoot);
  const beforeRawDirs = topLevelDirs(rawRoot);

  const backup = backupDir(dataRoot);
  fs.mkdirSync(backup, { recursive: true });
  const configPath = path.join(dataRoot, 'library.json');
  const linkPath = path.join(dataRoot, PROJECT_LINK_FILE);
  const hadConfig = fs.existsSync(configPath);
  if (hadConfig) fs.copyFileSync(configPath, path.join(backup, 'library.json'));
  const hadLink = fs.existsSync(linkPath);
  if (hadLink) fs.copyFileSync(linkPath, path.join(backup, PROJECT_LINK_FILE));

  const buffer = fs.readFileSync(copy);
  // Forward the configured roots: deriving them from rootDir again would unpack the
  // demo into the process working directory in Docker/standalone mode.
  importProject({
    rootDir,
    dataRoot,
    rawRoot,
    buffer,
    conflict: 'overwrite',
    snapshot: false,
    keepProjectBackup: false,
  });

  // Write-backs go to the user-directory copy, never to the installed resource.
  linkProject(dataRoot, {
    path: copy,
    storageMode: 'packaged',
    name: 'KomaYomi Demo',
  });

  const afterData = dataSnapshot(dataRoot);
  const addedData = [...afterData].filter((rel) => !beforeData.has(rel) && !isProtectedDataPath(rel));
  const createdRawDirs = [...topLevelDirs(rawRoot)].filter((dir) => !beforeRawDirs.has(dir));

  const library = createLibrary(rawRoot, dataRoot);
  writeState(dataRoot, {
    schemaVersion: 1,
    kind: 'demo-state',
    copy,
    volumes: library.volumes.map((volume) => volume.id),
    addedData,
    createdRawDirs,
    hadConfig,
    hadLink,
    openedAt: new Date().toISOString(),
  });

  return { library, status: demoStatus(dataRoot) };
}

/** Remove everything the demo import added and restore the config/link that existed before. */
export function closeBuiltInDemo(opts: { rootDir: string; dataRoot: string; rawRoot: string }): {
  closed: boolean;
  library: ReturnType<typeof createLibrary>;
  status: DemoStatus;
} {
  const { dataRoot, rawRoot } = opts;
  const state = readState(dataRoot);
  if (!state) {
    return { closed: false, library: createLibrary(rawRoot, dataRoot), status: { active: false } };
  }

  const link = readProjectLink(dataRoot);
  if (link && link.path.toLowerCase() === state.copy.toLowerCase()) clearProjectLink(dataRoot);

  for (const rel of state.addedData) {
    if (isProtectedDataPath(rel)) continue;
    const target = path.resolve(dataRoot, rel);
    if (!target.startsWith(path.resolve(dataRoot) + path.sep)) continue;
    try {
      fs.rmSync(target, { force: true });
    } catch {
      /* best effort: a locked file must not block leaving the demo */
    }
    removeEmptyDirs(dataRoot, path.dirname(rel));
  }

  for (const dir of state.createdRawDirs) {
    const target = path.resolve(rawRoot, dir);
    if (!target.startsWith(path.resolve(rawRoot) + path.sep)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  const backup = backupDir(dataRoot);
  const configTarget = path.join(dataRoot, 'library.json');
  if (state.hadConfig && fs.existsSync(path.join(backup, 'library.json'))) {
    try {
      fs.copyFileSync(path.join(backup, 'library.json'), configTarget);
    } catch {
      /* keep the imported config rather than deleting the user's settings */
    }
  } else if (!state.hadConfig) {
    try {
      fs.rmSync(configTarget, { force: true });
    } catch {
      /* best effort */
    }
  }

  const linkTarget = path.join(dataRoot, PROJECT_LINK_FILE);
  if (state.hadLink && fs.existsSync(path.join(backup, PROJECT_LINK_FILE))) {
    try {
      fs.copyFileSync(path.join(backup, PROJECT_LINK_FILE), linkTarget);
    } catch {
      /* best effort */
    }
  } else if (!state.hadLink) {
    try {
      fs.rmSync(linkTarget, { force: true });
    } catch {
      /* best effort */
    }
  }

  try {
    fs.rmSync(statePath(dataRoot), { force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  } catch {
    /* the next open would simply unwind again */
  }

  return {
    closed: true,
    library: createLibrary(rawRoot, dataRoot),
    status: { active: false },
  };
}

/** Close an active demo before another project replaces the working copy. */
export function closeDemoIfActive(opts: { rootDir: string; dataRoot: string; rawRoot: string }): void {
  if (readState(opts.dataRoot)) closeBuiltInDemo(opts);
}
