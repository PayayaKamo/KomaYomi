import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Lang, Note, PageDoc } from '../shared/types.ts';
import { createLibrary, readLibraryConfig } from './library.ts';
import { createBackupBuffer } from './backup.ts';
import { createZip, readZip } from './zip.ts';
import type { ZipEntryInput } from './zip.ts';
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_URLS,
  checkSchemaVersion,
  prepareExchange,
  validateExchange,
} from '../shared/format.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';

/**
 * Project file .mnproj = zip container + plain-text JSON.
 * - Reference mode: stores only image paths and sha1, keeping files small; images can be relinked after moving machines.
 * - Packaged mode: images are deduplicated by content hash into assets/ and can be distributed standalone.
 */

export const PROJECT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION.mnproj;
export type ProjectStorageMode = 'reference' | 'packaged';
export type ProjectConflictMode = 'overwrite' | 'merge' | 'skip';
export type ProjectFileKind = 'page' | 'template' | 'preset' | 'config' | 'history';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const APP_FALLBACK_VERSION = '0.1.0';

export type ProjectImage = {
  volume: string;
  chapter: string;
  /** Zero-based page index. */
  pageIndex: number;
  lang: Lang;
  /** Original file name. */
  name: string;
  sha1: string;
  size: number;
  /** Reference mode: path relative to the project root, e.g. raw/<volume>/ja/172/01.jpg */
  path?: string;
  /** Packaged mode: assets/<sha1>.<ext> */
  asset?: string;
};

export type ProjectLangDirs = Partial<Record<Lang, string>>;

export type ProjectManifest = {
  $schema?: string;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  storageMode: ProjectStorageMode;
  name?: string;
  language: {
    /** Mapping explicitly set by the user in data/library.json */
    volumes: Record<string, ProjectLangDirs>;
    /** Directories actually used by the library scan */
    resolved: Record<string, ProjectLangDirs>;
  };
  inventory: {
    volumes: {
      volume: string;
      languages: Lang[];
      langDirs: ProjectLangDirs;
      chapters: { chapter: string; pages: number; images: number }[];
    }[];
    pageCount: number;
    images: ProjectImage[];
  };
  notes?: {
    /** Number of page JSON files under data/pages */
    pages: number;
    noteCount: number;
    annotationCount: number;
    /** Free-form note written by the user */
    text?: string;
  };
};

export type MissingAsset = ProjectImage & { reason: 'missing' | 'hash-mismatch' | 'asset-missing' };

export type ProjectConflict = { name: string; kind: ProjectFileKind };

export type ProjectInspectResult = {
  name?: string;
  schemaVersion: number;
  migratedFrom?: number;
  appVersion: string;
  storageMode: ProjectStorageMode;
  createdAt: string;
  updatedAt: string;
  size: number;
  pages: number;
  notes: number;
  annotations: number;
  /** Free-form note stored in the manifest (kept when the file is written back). */
  notesText?: string;
  volumes: string[];
  chapters: number;
  images: number;
  templates: number;
  presets: number;
  conflicts: ProjectConflict[];
  conflictCount: number;
  missingAssets: MissingAsset[];
  warnings: string[];
};

export type ProjectImportResult = {
  storageMode: ProjectStorageMode;
  restored: number;
  merged: number;
  skipped: number;
  conflicts: number;
  imagesWritten: number;
  imagesPresent: number;
  relinked: number;
  missing: MissingAsset[];
  snapshot: string | null;
  projectBackup: string;
  migratedFrom?: number;
  warnings: string[];
};

type ProjectFile = {
  name: string;
  relDir: string;
  rel: string;
  kind: ProjectFileKind;
  data: Buffer;
};

type ParsedProject = {
  manifest: ProjectManifest;
  migratedFrom?: number;
  files: ProjectFile[];
  assets: Map<string, Buffer>;
  warnings: string[];
};

/* ---------------- Shared utilities ---------------- */

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const sha1Hex = (buf: Buffer) => createHash('sha1').update(buf).digest('hex');

function resolveInside(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const guard = base.endsWith(path.sep) ? base : base + path.sep;
  return target === base || target.startsWith(guard) ? target : null;
}

function isInside(root: string, target: string): boolean {
  const base = path.resolve(root);
  const abs = path.resolve(target);
  const guard = base.endsWith(path.sep) ? base : base + path.sep;
  return abs === base || abs.startsWith(guard);
}

/** Directory/file path segment: rejects empty, dot, path separators and control characters so writes cannot escape root. */
function safeSegment(input: string): string | null {
  const clean = String(input ?? '').trim();
  if (!clean || clean === '.' || clean === '..') return null;
  if (/[\\/:*?"<>|\0]/.test(clean)) return null;
  return clean;
}

function writeFileAtomic(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Download name for a project file: strips characters that are invalid on Windows. */
export function projectFileName(name: string): string {
  const clean = name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  return clean || 'project';
}

function readAppVersion(rootDir: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof raw.version === 'string' && raw.version ? raw.version : APP_FALLBACK_VERSION;
  } catch {
    return APP_FALLBACK_VERSION;
  }
}

function walkDataFiles(dir: string, rel = ''): { rel: string; data: Buffer }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { rel: string; data: Buffer }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.tmp')) continue;
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkDataFiles(abs, relPath));
    else if (entry.isFile()) out.push({ rel: relPath, data: fs.readFileSync(abs) });
  }
  return out;
}

const sameContent = (file: string, data: Buffer): boolean => {
  try {
    return fs.readFileSync(file).equals(data);
  } catch {
    return false;
  }
};

/**
 * sha1 keyed by path + size + mtime. Write-back re-packs the whole project after every
 * edit, so without this every save would re-read and re-hash every image.
 */
const imageHashCache = new Map<string, { size: number; mtimeMs: number; sha1: string }>();

/** Read an image once and reuse its hash while the file is unchanged. */
function readImageWithHash(file: string): { data: Buffer; sha1: string } {
  const stat = fs.statSync(file);
  const data = fs.readFileSync(file);
  const cached = imageHashCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return { data, sha1: cached.sha1 };
  const sha1 = sha1Hex(data);
  if (imageHashCache.size > 100_000) imageHashCache.clear();
  imageHashCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, sha1 });
  return { data, sha1 };
}

function hashFileCached(file: string, cache: Map<string, string>): string | null {
  const cached = cache.get(file);
  if (cached) return cached;
  try {
    const hash = sha1Hex(fs.readFileSync(file));
    cache.set(file, hash);
    return hash;
  } catch {
    return null;
  }
}

function listImageFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || out.length >= 50000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && IMAGE_EXT.test(entry.name)) out.push(full);
      else if (entry.isSymbolicLink()) {
        try {
          if (fs.statSync(full).isDirectory()) walk(full, depth + 1);
          else if (IMAGE_EXT.test(entry.name)) out.push(full);
        } catch {
          /* Broken links are ignored */
        }
      }
    }
  };
  walk(root, 0);
  return out;
}

/* ---------------- Manifest migration and validation ---------------- */

function normalizeImage(input: Record<string, unknown>): ProjectImage {
  const volume = String(input.volume ?? '').trim();
  const chapter = String(input.chapter ?? '').trim();
  const name = String(input.name ?? '').trim();
  if (!volume || !chapter || !name) {
    throw new AppError('ERR_PROJECT_IMAGE_ENTRY', {}, 400);
  }
  const lang = typeof input.lang === 'string' && input.lang.trim() ? input.lang.trim() : 'ja';
  return {
    volume,
    chapter,
    pageIndex: Math.max(0, Math.trunc(Number(input.pageIndex) || 0)),
    lang,
    name,
    sha1: typeof input.sha1 === 'string' ? input.sha1 : '',
    size: Math.max(0, Math.trunc(Number(input.size) || 0)),
    path: typeof input.path === 'string' && input.path ? input.path.replace(/\\/g, '/').replace(/^\/+/, '') : undefined,
    asset: typeof input.asset === 'string' && input.asset ? input.asset.replace(/\\/g, '/') : undefined,
  };
}

function normalizeManifest(raw: unknown): { manifest: ProjectManifest; migratedFrom?: number } {
  if (!isRecord(raw)) throw new AppError('ERR_MANIFEST_NOT_OBJECT', {}, 400);
  const version = checkSchemaVersion('mnproj', raw.schemaVersion);
  const migrated = version < PROJECT_SCHEMA_VERSION;
  // Run the shared migration chain, so v1 note categories and future steps stay in one place.
  const base = migrated ? prepareExchange('mnproj', raw, { strict: false }).value : { ...raw };
  const manifest = base as unknown as ProjectManifest;

  if (manifest.storageMode !== 'reference' && manifest.storageMode !== 'packaged') {
    manifest.storageMode = 'reference';
  }
  if (!isRecord(manifest.inventory)) throw new AppError('ERR_MANIFEST_NO_INVENTORY', {}, 400);
  if (!Array.isArray(manifest.inventory.volumes)) manifest.inventory.volumes = [];
  if (!Array.isArray(manifest.inventory.images)) manifest.inventory.images = [];
  manifest.inventory.images = manifest.inventory.images.filter(isRecord).map((img) => normalizeImage(img));

  if (!isRecord(manifest.language)) manifest.language = { volumes: {}, resolved: {} };
  if (!isRecord(manifest.language.volumes)) manifest.language.volumes = {};
  if (!isRecord(manifest.language.resolved)) manifest.language.resolved = {};

  manifest.$schema = typeof manifest.$schema === 'string' && manifest.$schema ? manifest.$schema : SCHEMA_URLS.mnproj;
  manifest.schemaVersion = PROJECT_SCHEMA_VERSION;
  manifest.appVersion = typeof manifest.appVersion === 'string' ? manifest.appVersion : APP_FALLBACK_VERSION;
  manifest.createdAt = typeof manifest.createdAt === 'string' ? manifest.createdAt : new Date().toISOString();
  manifest.updatedAt = typeof manifest.updatedAt === 'string' ? manifest.updatedAt : manifest.createdAt;
  manifest.name = typeof manifest.name === 'string' ? manifest.name : undefined;
  manifest.inventory.pageCount = Math.max(0, Math.trunc(Number(manifest.inventory.pageCount) || 0));

  // Validate everything first, then let callers enter the snapshot -> write flow, so nothing is left half-loaded.
  const check = validateExchange('mnproj', manifest);
  if (!check.ok) throw new AppError('ERR_MANIFEST_INCOMPLETE', { errors: check.errors.join('; ') }, 400);

  return { manifest, migratedFrom: migrated ? version : undefined };
}

/* ---------------- Export ---------------- */

export type ProjectExportOptions = {
  rootDir: string;
  /** Overrides for containers that bind-mount raw/ and data/ separately. */
  rawRoot?: string;
  dataRoot?: string;
  storageMode: ProjectStorageMode;
  name?: string;
  notes?: string;
  /** manifest.createdAt of an existing project; write-back keeps the original creation time. */
  createdAt?: string;
};

export type ProjectExportResult = {
  buffer: Buffer;
  manifest: ProjectManifest;
  entries: number;
  warnings: string[];
};

export function createProjectBuffer(opts: ProjectExportOptions): ProjectExportResult {
  const { rootDir } = opts;
  const storageMode: ProjectStorageMode = opts.storageMode === 'packaged' ? 'packaged' : 'reference';
  const rawRoot = opts.rawRoot ? path.resolve(opts.rawRoot) : path.join(rootDir, 'raw');
  const dataRoot = opts.dataRoot ? path.resolve(opts.dataRoot) : path.join(rootDir, 'data');
  const warnings: string[] = [];
  const library = createLibrary(rawRoot, dataRoot);
  const config = readLibraryConfig(dataRoot);

  const images: ProjectImage[] = [];
  const assets = new Map<string, { name: string; data: Buffer }>();

  for (const vol of library.volumes) {
    for (const chapter of vol.chapters) {
      for (const page of chapter.pages) {
        for (const lang of Object.keys(page.files)) {
          const url = page.files[lang];
          if (!url) continue;
          let rel: string;
          try {
            rel = decodeURIComponent(url).replace(/^\/+/, '').replace(/\\/g, '/');
          } catch {
            warnings.push(t('WARN_IMAGE_PATH_INVALID', { path: url }));
            continue;
          }
          const abs = path.resolve(rootDir, rel);
          if (!isInside(rootDir, abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
            warnings.push(t('WARN_IMAGE_MISSING', { path: rel }));
            continue;
          }
          const { data, sha1 } = readImageWithHash(abs);
          const filename = page.filenames[lang] ?? path.basename(abs);
          const image: ProjectImage = {
            volume: vol.id,
            chapter: chapter.chapter,
            pageIndex: page.index,
            lang,
            name: filename,
            sha1,
            size: data.length,
          };
          if (storageMode === 'reference') {
            image.path = rel;
          } else {
            const ext = path.extname(filename).toLowerCase() || '.jpg';
            const asset = `assets/${image.sha1}${ext}`;
            image.asset = asset;
            if (!assets.has(image.sha1)) assets.set(image.sha1, { name: asset, data });
          }
          images.push(image);
        }
      }
    }
  }

  const pageFiles = walkDataFiles(path.join(dataRoot, 'pages'));
  const templateFiles = walkDataFiles(path.join(dataRoot, 'templates'));
  const presetFiles = walkDataFiles(path.join(dataRoot, 'presets'));
  // Page version history travels with the project so reopening it keeps the audit trail.
  const historyFiles = walkDataFiles(path.join(dataRoot, 'history'));

  let noteCount = 0;
  let annotationCount = 0;
  for (const file of pageFiles) {
    try {
      const doc = JSON.parse(file.data.toString('utf8')) as PageDoc;
      if (Array.isArray(doc.notes)) noteCount += doc.notes.length;
      if (Array.isArray(doc.annotations)) annotationCount += doc.annotations.length;
    } catch {
      warnings.push(t('WARN_PAGE_JSON_INVALID', { path: `pages/${file.rel}` }));
    }
  }

  const configured: Record<string, ProjectLangDirs> = {};
  for (const [volume, entry] of Object.entries(config.volumes ?? {})) {
    configured[volume] = entry?.dirs ?? {};
  }
  const resolved: Record<string, ProjectLangDirs> = {};
  for (const vol of library.volumes) resolved[vol.id] = vol.langDirs;

  const now = new Date().toISOString();
  const manifest: ProjectManifest = {
    $schema: SCHEMA_URLS.mnproj,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: readAppVersion(rootDir),
    createdAt: opts.createdAt?.trim() || now,
    updatedAt: now,
    storageMode,
    name: opts.name?.trim() || undefined,
    language: { volumes: configured, resolved },
    inventory: {
      volumes: library.volumes.map((vol) => ({
        volume: vol.id,
        languages: vol.languages,
        langDirs: vol.langDirs,
        chapters: vol.chapters.map((chapter) => ({
          chapter: chapter.chapter,
          pages: chapter.pages.length,
          images: chapter.pages.reduce((n, page) => n + Object.keys(page.files).length, 0),
        })),
      })),
      pageCount: library.volumes.reduce(
        (n, vol) => n + vol.chapters.reduce((m, chapter) => m + chapter.pages.length, 0),
        0,
      ),
      images,
    },
    notes: {
      pages: pageFiles.length,
      noteCount,
      annotationCount,
      text: opts.notes?.trim() || undefined,
    },
  };

  const entries: ZipEntryInput[] = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    ...pageFiles.map((file) => ({ name: `pages/${file.rel}`, data: file.data })),
    ...templateFiles.map((file) => ({ name: `templates/${file.rel}`, data: file.data })),
    ...presetFiles.map((file) => ({ name: `presets/${file.rel}`, data: file.data })),
    ...historyFiles.map((file) => ({ name: `history/${file.rel}`, data: file.data })),
  ];

  if (fs.existsSync(path.join(dataRoot, 'library.json'))) {
    entries.push({ name: 'config/library.json', data: fs.readFileSync(path.join(dataRoot, 'library.json')) });
  }
  for (const asset of assets.values()) entries.push({ name: asset.name, data: asset.data });

  return { buffer: createZip(entries), manifest, entries: entries.length, warnings };
}

/* ---------------- Read and validation ---------------- */

function hasUnsafeName(name: string): boolean {
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split('/').some((part) => part === '..' || part === '.');
}

function classifyEntry(name: string): { relDir: string; rel: string; kind: ProjectFileKind } | null {
  if (name === 'config/library.json') return { relDir: 'config', rel: 'library.json', kind: 'config' };
  if (name.startsWith('pages/')) return { relDir: 'pages', rel: name.slice('pages/'.length), kind: 'page' };
  if (name.startsWith('templates/'))
    return { relDir: 'templates', rel: name.slice('templates/'.length), kind: 'template' };
  if (name.startsWith('presets/')) return { relDir: 'presets', rel: name.slice('presets/'.length), kind: 'preset' };
  if (name.startsWith('history/')) return { relDir: 'history', rel: name.slice('history/'.length), kind: 'history' };
  return null;
}

function parseProject(buffer: Buffer): ParsedProject {
  if (!buffer.length) throw new AppError('ERR_PROJECT_EMPTY', {}, 400);
  const entries = readZip(buffer);
  const warnings: string[] = [];
  const files: ProjectFile[] = [];
  const assets = new Map<string, Buffer>();
  let manifestRaw: unknown = null;

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    if (hasUnsafeName(entry.name)) {
      warnings.push(t('WARN_SUSPICIOUS_PATH', { name: entry.name }));
      continue;
    }
    if (entry.name === 'manifest.json') {
      try {
        manifestRaw = JSON.parse(entry.data.toString('utf8'));
      } catch {
        throw new AppError('ERR_MANIFEST_INVALID_JSON', {}, 400);
      }
      continue;
    }
    if (entry.name.startsWith('assets/')) {
      assets.set(entry.name, entry.data);
      continue;
    }
    const cls = classifyEntry(entry.name);
    if (!cls) {
      warnings.push(t('WARN_UNKNOWN_ENTRY', { name: entry.name }));
      continue;
    }
    if (cls.kind === 'page' || cls.kind === 'config') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.data.toString('utf8'));
        if (!isRecord(parsed)) throw new Error('not an object');
      } catch {
        warnings.push(t('WARN_ENTRY_JSON_INVALID', { name: entry.name }));
        continue;
      }
      if (cls.kind === 'page') {
        // Pages travel inside the project file: migrate old note categories right away,
        // so an imported project never writes v1 pages back to disk.
        try {
          const prepared = prepareExchange('page', parsed, { strict: false });
          files.push({
            ...cls,
            name: entry.name,
            data: Buffer.from(JSON.stringify(prepared.value, null, 2), 'utf8'),
          });
          continue;
        } catch {
          // A page from a newer build: keep its bytes untouched instead of refusing the import.
          warnings.push(t('WARN_ENTRY_JSON_INVALID', { name: entry.name }));
        }
      }
    }
    files.push({ ...cls, name: entry.name, data: entry.data });
  }

  if (manifestRaw === null) throw new AppError('ERR_MANIFEST_MISSING', {}, 400);
  const { manifest, migratedFrom } = normalizeManifest(manifestRaw);
  return { manifest, migratedFrom, files, assets, warnings };
}

/** Reference mode: check the image is still in place (file size + sha1). */
function verifyReferenceImages(rootDir: string, manifest: ProjectManifest): MissingAsset[] {
  const missing: MissingAsset[] = [];
  if (manifest.storageMode !== 'reference') return missing;
  const cache = new Map<string, string>();
  for (const image of manifest.inventory.images) {
    const abs = image.path ? resolveInside(rootDir, image.path) : null;
    let isFile = false;
    if (abs) {
      try {
        isFile = fs.existsSync(abs) && fs.statSync(abs).isFile();
      } catch {
        isFile = false;
      }
    }
    if (!isFile) {
      missing.push({ ...image, reason: 'missing' });
      continue;
    }
    if (image.sha1) {
      const hash = hashFileCached(abs!, cache);
      if (hash && hash !== image.sha1) missing.push({ ...image, reason: 'hash-mismatch' });
    }
  }
  return missing;
}

export function inspectProject(opts: { rootDir: string; buffer: Buffer }): ProjectInspectResult {
  const { rootDir, buffer } = opts;
  const dataRoot = path.join(rootDir, 'data');
  const parsed = parseProject(buffer);
  const warnings = [...parsed.warnings];
  const conflicts: ProjectConflict[] = [];
  const volumes = new Set<string>();
  let pages = 0;
  let notes = 0;
  let annotations = 0;
  let templates = 0;
  let presets = 0;
  let chapters = 0;

  for (const file of parsed.files) {
    if (file.kind === 'page') {
      pages++;
      const parts = file.rel.split('/');
      if (parts.length >= 3) volumes.add(parts[0]);
      try {
        const doc = JSON.parse(file.data.toString('utf8')) as PageDoc;
        if (Array.isArray(doc.notes)) notes += doc.notes.length;
        if (Array.isArray(doc.annotations)) annotations += doc.annotations.length;
      } catch {
        warnings.push(t('WARN_PAGE_JSON_INVALID', { path: file.name }));
      }
    } else if (file.kind === 'template') templates++;
    else if (file.kind === 'preset') presets++;

    const target = resolveInside(dataRoot, path.posix.join(file.relDir, file.rel));
    if (!target) {
      warnings.push(t('WARN_SUSPICIOUS_PATH', { name: file.name }));
      continue;
    }
    if (fs.existsSync(target) && !sameContent(target, file.data)) {
      conflicts.push({ name: file.name, kind: file.kind });
    }
  }

  for (const vol of parsed.manifest.inventory.volumes) {
    volumes.add(vol.volume);
    chapters += Array.isArray(vol.chapters) ? vol.chapters.length : 0;
  }

  let missingAssets = verifyReferenceImages(rootDir, parsed.manifest);
  if (parsed.manifest.storageMode === 'packaged') {
    missingAssets = parsed.manifest.inventory.images
      .filter((image) => !image.asset || !parsed.assets.has(image.asset))
      .map((image) => ({ ...image, reason: 'asset-missing' as const }));
  }

  return {
    name: parsed.manifest.name,
    schemaVersion: parsed.manifest.schemaVersion,
    migratedFrom: parsed.migratedFrom,
    appVersion: parsed.manifest.appVersion,
    storageMode: parsed.manifest.storageMode,
    createdAt: parsed.manifest.createdAt,
    updatedAt: parsed.manifest.updatedAt,
    size: buffer.length,
    pages,
    notes,
    annotations,
    notesText: parsed.manifest.notes?.text,
    volumes: [...volumes],
    chapters,
    images: parsed.manifest.inventory.images.length,
    templates,
    presets,
    conflicts,
    conflictCount: conflicts.length,
    missingAssets,
    warnings,
  };
}

/* ---------------- Import ---------------- */

/** Merge: keep existing panels/annotations when the incoming file lacks them, union notes by id, let the incoming copy override the same id, and never delete existing notes. */
export function mergePageDocs(existing: PageDoc, incoming: PageDoc): PageDoc {
  const merged: PageDoc = { ...incoming };

  if (!Array.isArray(incoming.panels) || incoming.panels.length === 0) merged.panels = existing.panels ?? [];
  if (!Array.isArray(incoming.annotations) || incoming.annotations.length === 0) {
    merged.annotations = existing.annotations;
  }
  if (!incoming.groups?.length) merged.groups = existing.groups;
  if (!incoming.offsets || Object.keys(incoming.offsets).length === 0) merged.offsets = existing.offsets;
  if (!incoming.panelOffsets || Object.keys(incoming.panelOffsets).length === 0) {
    merged.panelOffsets = existing.panelOffsets;
  }
  if (incoming.annotationsVisible === undefined) merged.annotationsVisible = existing.annotationsVisible;

  const notes = new Map<string, Note>();
  for (const note of existing.notes ?? []) if (note?.id) notes.set(note.id, note);
  for (const note of incoming.notes ?? []) if (note?.id) notes.set(note.id, note);
  merged.notes = [...notes.values()];

  return merged;
}

function mergeLibraryConfigFile(existingData: Buffer, incomingData: Buffer): Buffer {
  const existing = JSON.parse(existingData.toString('utf8')) as Record<string, unknown>;
  const incoming = JSON.parse(incomingData.toString('utf8')) as Record<string, unknown>;
  if (!isRecord(existing) || !isRecord(incoming)) throw new AppError('ERR_LIBRARY_NOT_OBJECT', {}, 400);
  const existingVolumes = isRecord(existing.volumes) ? existing.volumes : {};
  const incomingVolumes = isRecord(incoming.volumes) ? incoming.volumes : {};
  return Buffer.from(
    JSON.stringify({ ...existing, ...incoming, volumes: { ...existingVolumes, ...incomingVolumes } }, null, 2),
    'utf8',
  );
}

function langDirFor(manifest: ProjectManifest, volume: string, lang: Lang): string {
  const resolved = manifest.language?.resolved?.[volume]?.[lang];
  const configured = manifest.language?.volumes?.[volume]?.[lang];
  return safeSegment(resolved ?? '') ?? safeSegment(configured ?? '') ?? lang;
}

function rawImageTarget(rawRoot: string, image: ProjectImage, langDir: string): string | null {
  const volume = safeSegment(image.volume);
  const chapter = safeSegment(image.chapter);
  const name = safeSegment(image.name);
  const dir = safeSegment(langDir);
  if (!volume || !chapter || !name || !dir) return null;
  return resolveInside(rawRoot, path.posix.join(volume, dir, chapter, name));
}

function findRelinkSource(candidates: string[], image: ProjectImage, cache: Map<string, string>): string | null {
  if (image.sha1) {
    for (const file of candidates) {
      if (hashFileCached(file, cache) === image.sha1) return file;
    }
  }
  const wanted = image.name.toLowerCase();
  const byName = candidates.filter((file) => path.basename(file).toLowerCase() === wanted);
  if (!byName.length) return null;
  // When several candidates share a name, prefer the path containing the volume/chapter name.
  const scored = byName
    .map((file) => {
      const normalized = file.replace(/\\/g, '/').toLowerCase();
      let score = 0;
      if (normalized.includes(`/${image.volume.toLowerCase()}/`)) score += 2;
      if (normalized.includes(`/${image.chapter.toLowerCase()}/`)) score += 1;
      return { file, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0].file;
}

export type ProjectImportOptions = {
  rootDir: string;
  buffer: Buffer;
  conflict?: ProjectConflictMode;
  /** Source for relinking missing images in reference mode: match by sha1 / filename and copy them into raw. */
  relinkDir?: string | null;
  /** Whether to snapshot data/ before importing; defaults to true. */
  snapshot?: boolean;
};

export function importProject(opts: ProjectImportOptions): ProjectImportResult {
  const { rootDir, buffer } = opts;
  const conflict: ProjectConflictMode =
    opts.conflict === 'merge' || opts.conflict === 'skip' ? opts.conflict : 'overwrite';
  const dataRoot = path.join(rootDir, 'data');
  const rawRoot = path.join(rootDir, 'raw');
  const exportRoot = path.join(rootDir, 'exports');
  const parsed = parseProject(buffer);
  const manifest = parsed.manifest;
  const warnings = [...parsed.warnings];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  // 1. Snapshot the current data/ first, before any write.
  let snapshot: string | null = null;
  if (opts.snapshot !== false) {
    try {
      fs.mkdirSync(exportRoot, { recursive: true });
      const { buffer: snap } = createBackupBuffer(dataRoot);
      const file = path.join(exportRoot, `backup-before-project-import-${stamp}.zip`);
      fs.writeFileSync(file, snap);
      snapshot = file;
    } catch (err) {
      warnings.push(t('WARN_SNAPSHOT_FAILED', { detail: err instanceof Error ? err.message : String(err) }));
    }
  }

  // 2. Keep the original project file for traceability.
  const backupDir = path.join(dataRoot, 'backups', 'projects');
  let projectBackup = '';
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    projectBackup = path.join(backupDir, `${stamp}-${sha1Hex(buffer).slice(0, 8)}.mnproj`);
    fs.writeFileSync(projectBackup, buffer);
  } catch (err) {
    warnings.push(t('WARN_PROJECT_COPY_FAILED', { detail: err instanceof Error ? err.message : String(err) }));
  }

  // 3. Restore pages / templates / presets / config.
  let restored = 0;
  let merged = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const file of parsed.files) {
    const target = resolveInside(dataRoot, path.posix.join(file.relDir, file.rel));
    if (!target) {
      warnings.push(t('WARN_SUSPICIOUS_PATH', { name: file.name }));
      skipped++;
      continue;
    }
    const exists = fs.existsSync(target);
    if (!exists) {
      writeFileAtomic(target, file.data);
      restored++;
      continue;
    }
    if (sameContent(target, file.data)) {
      skipped++;
      continue;
    }
    conflicts++;
    if (conflict === 'skip') {
      skipped++;
      continue;
    }
    if (conflict === 'overwrite') {
      writeFileAtomic(target, file.data);
      restored++;
      continue;
    }
    // merge
    if (file.kind === 'page') {
      try {
        const existing = JSON.parse(fs.readFileSync(target, 'utf8')) as PageDoc;
        const incoming = JSON.parse(file.data.toString('utf8')) as PageDoc;
        const doc = mergePageDocs(existing, incoming);
        writeFileAtomic(target, Buffer.from(JSON.stringify(doc, null, 2), 'utf8'));
        merged++;
      } catch {
        warnings.push(t('WARN_JSON_MERGE_FALLBACK', { name: file.name }));
        skipped++;
      }
      continue;
    }
    if (file.kind === 'config') {
      try {
        writeFileAtomic(target, mergeLibraryConfigFile(fs.readFileSync(target), file.data));
        merged++;
      } catch {
        warnings.push(t('WARN_LIBRARY_MERGE_FALLBACK'));
        skipped++;
      }
      continue;
    }
    // Templates/presets: merge mode does not overwrite existing files.
    skipped++;
  }

  // 4. Images: packaged mode extracts straight into raw; reference mode checks in place and supports relinking.
  const hashCache = new Map<string, string>();
  const missing: MissingAsset[] = [];
  let imagesWritten = 0;
  let imagesPresent = 0;
  let relinked = 0;
  let relinkCandidates: string[] | null = null;
  let relinkRoot: string | null = null;

  if (opts.relinkDir && opts.relinkDir.trim()) {
    const dir = path.resolve(opts.relinkDir.trim());
    let ok = false;
    try {
      ok = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      ok = false;
    }
    if (ok) relinkRoot = dir;
    else warnings.push(t('WARN_RELINK_DIR_MISSING', { dir }));
  }

  for (const image of manifest.inventory.images) {
    const target = rawImageTarget(rawRoot, image, langDirFor(manifest, image.volume, image.lang));
    if (!target) {
      warnings.push(t('WARN_UNSAFE_IMAGE_PATH', { volume: image.volume, chapter: image.chapter, name: image.name }));
      continue;
    }

    if (manifest.storageMode === 'packaged') {
      const asset = image.asset ? parsed.assets.get(image.asset) : undefined;
      if (!asset) {
        missing.push({ ...image, reason: 'asset-missing' });
        continue;
      }
      if (fs.existsSync(target)) {
        const existing = hashFileCached(target, hashCache);
        if (!image.sha1 || existing === image.sha1) imagesPresent++;
        else
          warnings.push(
            t('WARN_IMAGE_OVERWRITE_SKIPPED', { volume: image.volume, chapter: image.chapter, name: image.name }),
          );
        continue;
      }
      writeFileAtomic(target, asset);
      imagesWritten++;
      continue;
    }

    // Reference mode: leave the file alone when it is still in place with a matching hash.
    const source = image.path ? resolveInside(rootDir, image.path) : null;
    let sourceIsFile = false;
    if (source) {
      try {
        sourceIsFile = fs.existsSync(source) && fs.statSync(source).isFile();
      } catch {
        sourceIsFile = false;
      }
    }
    if (sourceIsFile && (!image.sha1 || hashFileCached(source!, hashCache) === image.sha1)) {
      imagesPresent++;
      continue;
    }
    const reason: MissingAsset['reason'] = sourceIsFile ? 'hash-mismatch' : 'missing';

    if (relinkRoot) {
      relinkCandidates ??= listImageFilesRecursive(relinkRoot);
      const found = findRelinkSource(relinkCandidates, image, hashCache);
      if (found) {
        if (fs.existsSync(target)) {
          const existing = hashFileCached(target, hashCache);
          if (!image.sha1 || existing === image.sha1) imagesPresent++;
          else
            warnings.push(
              t('WARN_IMAGE_OVERWRITE_SKIPPED', { volume: image.volume, chapter: image.chapter, name: image.name }),
            );
          continue;
        }
        writeFileAtomic(target, fs.readFileSync(found));
        imagesWritten++;
        relinked++;
        continue;
      }
    }

    missing.push({ ...image, reason });
  }

  return {
    storageMode: manifest.storageMode,
    restored,
    merged,
    skipped,
    conflicts,
    imagesWritten,
    imagesPresent,
    relinked,
    missing,
    snapshot,
    projectBackup,
    migratedFrom: parsed.migratedFrom,
    warnings,
  };
}
