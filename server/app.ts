import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createLibrary,
  normalizeLangOrder,
  normalizeNoteTypes,
  previewDirs,
  readLibraryConfig,
  writeLibraryConfig,
} from './library.ts';
import { DEFAULT_RULES, validateRules } from './dirRules.ts';
import {
  addVolume,
  removeVolume,
  setChapterHidden,
  setChapterPageOffsets,
  setVolumeDefaultDirection,
  setVolumeDirs,
} from './libraryAdmin.ts';
import { cacheOverview, clearExportStaging, clearThumbCache, resetAutoPanels } from './cacheAdmin.ts';
import { applyPreprocess, readPreprocessBackup, restorePreprocess } from './preprocess.ts';
import { renameChapterFiles, splitPage } from './fileOps.ts';
import { sniffFormat } from './detect.ts';
import { remapPanelRefs } from '../shared/panelRemap.ts';
import { detectPage } from './pageDetect.ts';
import { captureLayout, deleteLayout, expandLayout, listLayouts, saveLayout } from './layouts.ts';
import { listPlugins } from './plugins.ts';
import { collectTagStats, createEmptyDoc, readPageDoc, writePageDoc } from './storage.ts';
import { findVersion, listVersions, readHistory, readHistoryLimit, recordVersion } from './pageHistory.ts';
import { exportChapter } from './export.ts';
import { exportChapterDocx } from './exportDocx.ts';
import { createBackupBuffer, inspectBackup, restoreBackup } from './backup.ts';
import {
  listAutoBackups,
  normalizeAutoBackupConfig,
  readAutoBackupConfig,
  readAutoBackupState,
  runAutoBackup,
  startAutoBackupScheduler,
} from './autoBackup.ts';
import { createProjectBuffer, importProject, inspectProject, projectFileName } from './project.ts';
import {
  clearProjectLink,
  createProjectSync,
  linkProject,
  readProjectFile,
  resolveProjectFilePath,
  resolveProjectSavePath,
  writeProjectCopy,
} from './projectWriteBack.ts';
import {
  exportExportTemplate,
  exportLayoutTemplate,
  exportPage,
  importExportTemplate,
  importLayoutTemplate,
  importPage,
} from './exchange.ts';
import { collectNotes } from './notes.ts';
import { thumbnailFile } from './thumb.ts';
import {
  cacheStats,
  clearRemoteCache,
  createProvider,
  markSecrets,
  readRemoteCache,
  readStorageConfig,
  remoteCachePath,
  setSecret,
  syncRemoteTree,
  writeRemoteCache,
  writeStorageConfig,
} from './storageProviders.ts';
import type { StorageConfig, StorageTarget } from './storageProviders.ts';
import {
  applyPanelTemplate,
  deleteAlignPreset,
  deleteExportTemplate,
  deletePanelTemplate,
  listAlignPresets,
  listExportTemplates,
  listPanelTemplates,
  saveAlignPreset,
  saveExportTemplate,
  savePanelTemplate,
} from './presets.ts';
import type {
  AlignPreset,
  ExportConfig,
  ExportTemplate,
  Lang,
  Library,
  PageDoc,
  PageEntry,
  PanelTemplate,
} from '../shared/types.ts';
import { LANGUAGES } from '../shared/types.ts';
import { HISTORY_SOURCES, readReadingDirection } from '../shared/format.ts';
import type { HistorySource } from '../shared/format.ts';
import { currentLang, resolveRequestLang, runWithLang, t } from './messages/index.ts';
import type { MessageCode, MessageParams } from './messages/index.ts';
import { AppError, errorBody, toErrorResponse } from './errors.ts';
import { requireChapter, requirePage } from './pageTargets.ts';
import { assertTrustedOrigin, assertTrustedRequest, isLoopbackHost } from './requestGuard.ts';
import type { RequestGuardOptions } from './requestGuard.ts';
import { setFormatAppVersion } from '../shared/format.ts';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * POST endpoints a read-only viewer may still call. They inspect, preview or export,
 * but never write project data. Everything else is rejected before it can touch disk.
 */
const READ_ONLY_SAFE_POSTS = new Set([
  '/api/project/inspect',
  '/api/project/import',
  '/api/library/preview',
  '/api/link-title',
  '/api/storage/test',
  '/api/export',
  '/api/export/docx',
  '/api/export/annotation-image',
  '/api/export/share-image',
]);

function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function readBody(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new AppError('ERR_BODY_TOO_LARGE', { limit: Math.round(limit / (1024 * 1024)) }, 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * POST endpoints that inspect, export or talk to a remote and never change project data.
 * Every other write is mirrored into the opened .mnproj.
 */
const NON_MUTATING_POSTS = new Set([
  '/api/library/preview',
  '/api/link-title',
  '/api/storage/test',
  '/api/backup',
  '/api/backup/inspect',
  '/api/export',
  '/api/export/docx',
  '/api/export/annotation-image',
  '/api/export/share-image',
]);

/** Raw uploads skip base64 so multi-hundred-MB packaged projects fit in memory. */
async function readBodyBuffer(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new AppError('ERR_BODY_TOO_LARGE', { limit: Math.round(limit / (1024 * 1024)) }, 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const isBinaryUpload = (req: IncomingMessage) =>
  String(req.headers['content-type'] ?? '').includes('application/octet-stream');

const MAX_PROJECT_BYTES = 2 * 1024 * 1024 * 1024;

function safeResolve(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const guard = base.endsWith(path.sep) ? base : base + path.sep;
  return target === base || target.startsWith(guard) ? target : null;
}

function findPage(library: Library, volume: string, chapter: string, index: number) {
  const vol = library.volumes.find((v) => v.id === volume);
  const ch = vol?.chapters.find((c) => c.chapter === chapter);
  // `index` is the stable document key; the pages array may be reordered by preprocessing overrides.
  const page = ch?.pages.find((p) => p.index === index);
  return page ? { page: page as PageEntry, chapterEntry: ch! } : null;
}

function serveFile(res: ServerResponse, file: string, downloadName?: string) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === 'html') {
    res.setHeader('Content-Type', MIME.html);
  } else {
    const head = fs.readFileSync(file).subarray(0, 16);
    const fmt = sniffFormat(Buffer.from(head));
    res.setHeader('Content-Type', MIME[fmt] ?? MIME[ext] ?? 'application/octet-stream');
  }
  if (downloadName) {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  }
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(file).pipe(res);
}

function pageRange(input: unknown, total: number): number[] {
  const list = Array.isArray(input) ? input.map((n) => Number(n)) : [];
  if (!list.length) return Array.from({ length: total }, (_, i) => i);
  return list.filter((n) => Number.isInteger(n) && n >= 0 && n < total);
}

export type MangaServerOptions = {
  /** Base workspace directory; any of the three data folders may be overridden below. */
  rootDir: string;
  rawDir?: string;
  dataDir?: string;
  exportDir?: string;
  /**
   * Accept non-loopback Host headers. Off by default: the API is for this machine only.
   * Set only when the user deliberately exposes the server to the local network.
   */
  allowLan?: boolean;
};

/**
 * All local endpoints, shared by the Vite middleware, the Electron server and the
 * Docker/standalone entry. Folder overrides let containers bind-mount raw/data/exports
 * separately while the desktop app keeps the `rootDir/{raw,data,exports}` layout.
 */
export function createMangaHandler({ rootDir, rawDir, dataDir, exportDir, allowLan }: MangaServerOptions) {
  const rawRoot = rawDir ? path.resolve(rawDir) : path.join(rootDir, 'raw');
  const dataRoot = dataDir ? path.resolve(dataDir) : path.join(rootDir, 'data');
  const exportRoot = exportDir ? path.resolve(exportDir) : path.join(rootDir, 'exports');
  const thumbRoot = path.join(dataRoot, 'cache', 'thumbs');
  const guard: RequestGuardOptions = {
    allowLan: allowLan ?? /^(1|true|yes)$/i.test(process.env.KOMAYOMI_ALLOW_LAN ?? ''),
    allowedOrigins: (process.env.KOMAYOMI_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  };

  // Scheduled local backups run on their own timer; manual backups keep the `backup-` prefix.
  startAutoBackupScheduler({ dataRoot, exportRoot });

  // Edits always land in data/; when the user opened a .mnproj, they are also written
  // back to that exact file shortly afterwards (never to an exported copy).
  const projectSync = createProjectSync({ rootDir, dataRoot, rawRoot });

  /** package.json is the single source for the metadata shown in the About dialog. */
  const appMeta = (() => {
    const fallback = { version: '0.0.0', author: '', license: '' };
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
        version?: unknown;
        author?: unknown;
        license?: unknown;
      };
      return {
        version: typeof pkg.version === 'string' && pkg.version ? pkg.version : fallback.version,
        author: typeof pkg.author === 'string' ? pkg.author : fallback.author,
        license: typeof pkg.license === 'string' ? pkg.license : fallback.license,
      };
    } catch {
      return fallback;
    }
  })();
  // Every exported/own file records which build produced it.
  setFormatAppVersion(appMeta.version);

  /**
   * Fetch a page image from the configured remote source into the local cache.
   *
   * The remote tree mirror stores zero-byte placeholders, so a page that exists but
   * has no local bytes is treated as "not downloaded yet". Returning null means the
   * page is genuinely absent; throwing means the remote is offline and the caller
   * should surface a clear error instead of hanging.
   */
  const fetchRemote = async (rel: string): Promise<Buffer | null> => {
    const source = readStorageConfig(dataRoot).rawSource;
    if (!source || source.enabled === false) return null;
    const ext = path.extname(rel) || '.jpg';
    const cached = readRemoteCache(dataRoot, source.id, rel, ext);
    if (cached) return cached;
    const buf = await createProvider(dataRoot, source).read(rel);
    writeRemoteCache(dataRoot, source.id, rel, ext, buf);
    return buf;
  };

  const sendImageBuffer = (res: ServerResponse, buf: Buffer, cacheable: boolean) => {
    res.setHeader('Content-Type', MIME[sniffFormat(buf)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', cacheable ? 'public, max-age=86400' : 'no-cache');
    res.end(buf);
  };

  /** Structured error response: legacy `error` plus `message` / `code` / `params` / `lang`. */
  const fail = (res: ServerResponse, status: number, code: MessageCode, params: MessageParams = {}): void => {
    sendJson(res, status, errorBody(code, params, currentLang()));
  };

  const handleRequest = async function handler(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url) return false;
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      // ---- Thumbnails (disk-cached; fetch the remote original on demand when missing locally) ----
      if (pathname === '/thumb') {
        const src = url.searchParams.get('src') ?? '';
        const w = Math.min(600, Math.max(80, Number(url.searchParams.get('w')) || 200));
        let file = thumbnailFile(rawRoot, thumbRoot, src, w);
        if (!file) {
          const rel = decodeURIComponent(src.replace(/^\/raw\//, ''));
          try {
            const buf = await fetchRemote(rel);
            if (buf) {
              const source = readStorageConfig(dataRoot).rawSource!;
              const ext = path.extname(rel) || '.jpg';
              const cached = remoteCachePath(dataRoot, source.id, rel, ext);
              // thumbnailFile needs a real file, so point it at the cached original.
              file = thumbnailFile(path.dirname(cached), thumbRoot, path.basename(cached), w);
            }
          } catch (err) {
            fail(res, 502, 'ERR_THUMB_FETCH_FAILED', { detail: err instanceof Error ? err.message : String(err) });
            return true;
          }
        }
        if (!file) {
          fail(res, 404, 'ERR_THUMB_SOURCE_MISSING', { src });
          return true;
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(file).pipe(res);
        return true;
      }

      // ---- Raw images (read-only; local first, remote cached on demand) ----
      if (pathname.startsWith('/raw/')) {
        const rel = decodeURIComponent(pathname.slice('/raw/'.length));
        const file = safeResolve(rawRoot, rel);
        let local = false;
        try {
          local = Boolean(file && fs.statSync(file).isFile() && fs.statSync(file).size > 0);
        } catch {
          local = false;
        }
        if (local) {
          serveFile(res, file!);
          return true;
        }
        try {
          const buf = await fetchRemote(rel);
          if (buf) {
            sendImageBuffer(res, buf, true);
            return true;
          }
        } catch (err) {
          fail(res, 503, 'ERR_REMOTE_UNAVAILABLE', { detail: err instanceof Error ? err.message : String(err) });
          return true;
        }
        fail(res, 404, 'ERR_IMAGE_NOT_FOUND', { path: rel });
        return true;
      }

      // ---- Exported files (HTML plus the sibling .files directory) ----
      if (pathname.startsWith('/exports/')) {
        const rel = decodeURIComponent(pathname.slice('/exports/'.length));
        // Backups contain the whole library and must not be fetchable by other sites.
        if (/\.zip$/i.test(rel)) assertTrustedOrigin(req, guard);
        const file = safeResolve(exportRoot, rel);
        if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          fail(res, 404, 'ERR_EXPORT_FILE_NOT_FOUND', { path: rel });
          return true;
        }
        serveFile(res, file);
        return true;
      }

      if (!pathname.startsWith('/api/')) return false;

      // Read mode never writes project data. The client sends the mode on every request,
      // so even a control missed by the viewer UI cannot persist a change.
      if (req.headers['x-komayomi-mode'] === 'read' && req.method !== 'GET' && !READ_ONLY_SAFE_POSTS.has(pathname)) {
        fail(res, 403, 'ERR_READ_ONLY');
        return true;
      }

      // Container healthcheck: cheap, no filesystem walk, reports mounted folders
      // so a mis-mounted compose file is visible in `docker ps`/logs.
      if (pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          app: 'KomaYomi',
          version: appMeta.version,
          author: appMeta.author,
          license: appMeta.license,
          dirs: { raw: rawRoot, data: dataRoot, exports: exportRoot },
          uptime: Math.round(process.uptime()),
        });
        return true;
      }

      const library = createLibrary(rawRoot, dataRoot);

      if (pathname === '/api/library' && req.method === 'GET') {
        sendJson(res, 200, { library, root: rootDir, raw: rawRoot });
        return true;
      }

      // Open the raw library folder in the host file manager. The path is fixed by the
      // server configuration, so this cannot be used to launch arbitrary locations.
      if (pathname === '/api/reveal' && req.method === 'POST') {
        const command =
          process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        try {
          const child = spawn(command, [rawRoot], { detached: true, stdio: 'ignore' });
          child.on('error', () => undefined);
          child.unref();
          sendJson(res, 200, { ok: true, path: rawRoot });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
        return true;
      }

      /* ---------------- Directory rules (declarative, previewable) ---------------- */
      if (pathname === '/api/dir-rules' && req.method === 'GET') {
        const cfg = readLibraryConfig(dataRoot);
        sendJson(res, 200, {
          rules: cfg.rules?.length ? cfg.rules : DEFAULT_RULES,
          defaults: DEFAULT_RULES,
          customized: Boolean(cfg.rules?.length),
          warning: library.scan.warning,
        });
        return true;
      }

      if (pathname === '/api/dir-rules' && req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as { rules?: unknown };
        const cfg = readLibraryConfig(dataRoot);
        const input = Array.isArray(body.rules) ? body.rules : [];
        if (!input.length) {
          delete cfg.rules;
          writeLibraryConfig(dataRoot, cfg);
          sendJson(res, 200, { rules: DEFAULT_RULES, library: createLibrary(rawRoot, dataRoot) });
          return true;
        }
        const rules = validateRules(input);
        writeLibraryConfig(dataRoot, { ...cfg, rules });
        sendJson(res, 200, { rules, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      /* ---------------- Language order (shared by compare view and exports) ---------------- */
      if (pathname === '/api/lang-order' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { order?: unknown };
        const cfg = readLibraryConfig(dataRoot);
        if (Array.isArray(body.order)) {
          const current = createLibrary(rawRoot, dataRoot);
          const known = new Set<string>(current.languages.length ? current.languages : LANGUAGES);
          cfg.langOrder = normalizeLangOrder(
            body.order.filter((lang): lang is Lang => typeof lang === 'string' && known.has(lang)),
            [...known],
          );
        } else {
          delete cfg.langOrder;
        }
        writeLibraryConfig(dataRoot, cfg);
        sendJson(res, 200, { langOrder: createLibrary(rawRoot, dataRoot).langOrder });
        return true;
      }

      /* ---------------- Custom note categories (shared with the project file) ---------------- */
      if (pathname === '/api/note-types' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { noteTypes?: unknown };
        const cfg = readLibraryConfig(dataRoot);
        const noteTypes = normalizeNoteTypes(body.noteTypes);
        if (noteTypes.length) cfg.noteTypes = noteTypes;
        else delete cfg.noteTypes;
        writeLibraryConfig(dataRoot, cfg);
        sendJson(res, 200, { noteTypes: createLibrary(rawRoot, dataRoot).noteTypes ?? [] });
        return true;
      }

      if (pathname === '/api/library/preview' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { dir?: string; rules?: unknown };
        const rules = Array.isArray(body.rules) && body.rules.length ? validateRules(body.rules) : undefined;
        sendJson(res, 200, previewDirs(rawRoot, dataRoot, body.dir ?? '', rules));
        return true;
      }

      if (pathname === '/api/tags' && req.method === 'GET') {
        sendJson(res, 200, { tags: collectTagStats(dataRoot) });
        return true;
      }

      if (pathname === '/api/page' && req.method === 'GET') {
        const volume = url.searchParams.get('volume') ?? '';
        const chapter = url.searchParams.get('chapter') ?? '';
        const index = Number(url.searchParams.get('index') ?? 0);
        const found = findPage(library, volume, chapter, index);
        if (!found) {
          fail(res, 404, 'ERR_PAGE_NOT_FOUND', { volume, chapter, page: index + 1 });
          return true;
        }
        const saved = readPageDoc(dataRoot, volume, chapter, index);
        const volumeEntry = library.volumes.find((v) => v.id === volume);
        // A page without a document yet inherits its volume direction, so the first
        // detection already sorts in the direction the reader will use.
        const doc = saved ?? {
          ...createEmptyDoc(volume, chapter, index),
          readingDirection: volumeEntry?.defaultDirection ?? 'rtl',
        };
        sendJson(res, 200, {
          doc,
          exists: saved !== null,
          page: found.page,
          chapterId: found.chapterEntry.id,
          volume,
          chapter,
        });
        return true;
      }

      if (pathname === '/api/page' && req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as PageDoc;
        if (!body?.volume || !body?.chapter) {
          fail(res, 400, 'ERR_MISSING_VOLUME_CHAPTER');
          return true;
        }
        const pageIndex = Number(body.pageIndex);
        if (!Number.isInteger(pageIndex) || pageIndex < 0) {
          fail(res, 400, 'ERR_PAGE_INDEX_INVALID');
          return true;
        }
        // Request targets are checked against the scan before any path is built.
        requirePage(library, body.volume, body.chapter, pageIndex);
        const requested = url.searchParams.get('source') ?? '';
        const source = HISTORY_SOURCES.includes(requested as HistorySource) ? (requested as HistorySource) : 'auto';
        const saved = writePageDoc(dataRoot, body, { source });
        sendJson(res, 200, { doc: saved });
        return true;
      }

      /* ---------------- Page version history (cross-session, independent of the undo stack) ---------------- */
      if (pathname === '/api/page-history' && req.method === 'GET') {
        const volume = url.searchParams.get('volume') ?? '';
        const chapter = url.searchParams.get('chapter') ?? '';
        const index = Number(url.searchParams.get('index') ?? 0);
        requireChapter(library, volume, chapter);
        sendJson(res, 200, listVersions(dataRoot, volume, chapter, index));
        return true;
      }

      if (pathname === '/api/page-history/restore' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          chapter?: string;
          pageIndex?: number;
          id?: string;
        };
        const volume = String(body.volume ?? '');
        const chapter = String(body.chapter ?? '');
        const pageIndex = Math.max(0, Math.trunc(Number(body.pageIndex) || 0));
        requirePage(library, volume, chapter, pageIndex);
        const entry = findVersion(dataRoot, volume, chapter, pageIndex, String(body.id ?? ''));
        if (!entry) {
          fail(res, 404, 'ERR_HISTORY_VERSION_NOT_FOUND', { id: String(body.id ?? '') });
          return true;
        }
        // Snapshot the current state first: restoring must never destroy the latest work.
        const current = readPageDoc(dataRoot, volume, chapter, pageIndex) ?? createEmptyDoc(volume, chapter, pageIndex);
        const prior = readHistory(dataRoot, volume, chapter, pageIndex);
        const snapshot = recordVersion(dataRoot, current, prior[prior.length - 1]?.doc ?? null, {
          source: 'restore',
          summary: t('HISTORY_BEFORE_RESTORE'),
        });
        const saved = writePageDoc(
          dataRoot,
          { ...entry.doc, volume, chapter, pageIndex },
          { source: 'restore', summary: t('HISTORY_RESTORED') },
        );
        sendJson(res, 200, { doc: saved, previousId: snapshot?.id ?? null, targetId: entry.id });
        return true;
      }

      if (pathname === '/api/history-limit' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { limit?: unknown };
        const cfg = readLibraryConfig(dataRoot);
        const raw = Number(body.limit);
        if (!Number.isFinite(raw) || raw <= 0) delete cfg.historyLimit;
        else cfg.historyLimit = Math.min(200, Math.max(5, Math.round(raw)));
        writeLibraryConfig(dataRoot, cfg);
        sendJson(res, 200, { limit: readHistoryLimit(dataRoot) });
        return true;
      }

      if (pathname === '/api/detect' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume: string;
          chapter: string;
          pageIndex: number;
          lang?: string;
          readingDirection?: string;
        };
        const found = findPage(library, body.volume, body.chapter, body.pageIndex);
        if (!found) {
          fail(res, 404, 'ERR_PAGE_NOT_FOUND', {
            volume: body.volume,
            chapter: body.chapter,
            page: Number(body.pageIndex) + 1,
          });
          return true;
        }
        const volumeEntry = library.volumes.find((v) => v.id === body.volume);
        const readingDirection =
          readReadingDirection(body.readingDirection) ??
          readPageDoc(dataRoot, body.volume, body.chapter, body.pageIndex)?.readingDirection ??
          volumeEntry?.defaultDirection ??
          'rtl';
        const detected = await detectPage({
          rootDir,
          dataRoot,
          volume: body.volume,
          chapter: body.chapter,
          pageIndex: body.pageIndex,
          page: found.page,
          lang: body.lang,
          readingDirection,
        });
        if (!detected) {
          fail(res, 400, 'ERR_PAGE_NO_IMAGES', { volume: body.volume, chapter: body.chapter });
          return true;
        }
        sendJson(res, 200, detected);
        return true;
      }

      /* ---------------- Panel templates ---------------- */
      if (pathname === '/api/panel-templates' && req.method === 'GET') {
        sendJson(res, 200, { templates: listPanelTemplates(dataRoot) });
        return true;
      }

      if (pathname === '/api/panel-templates' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as Partial<PanelTemplate>;
        if (!Array.isArray(body.panels) || !body.panels.length) {
          fail(res, 400, 'ERR_PANEL_TEMPLATE_EMPTY');
          return true;
        }
        const template = savePanelTemplate(dataRoot, {
          name: body.name,
          volume: body.volume,
          chapter: body.chapter,
          panels: body.panels,
          readingDirection: body.readingDirection,
        });
        sendJson(res, 200, { template });
        return true;
      }

      if (pathname === '/api/panel-templates' && req.method === 'DELETE') {
        const id = url.searchParams.get('id') ?? '';
        sendJson(res, 200, { removed: deletePanelTemplate(dataRoot, id) });
        return true;
      }

      if (pathname === '/api/panel-templates/apply' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          templateId: string;
          volume: string;
          chapter: string;
          pageIndices?: number[];
        };
        const found = library.volumes
          .find((v) => v.id === body.volume)
          ?.chapters.find((c) => c.chapter === body.chapter);
        if (!found) {
          fail(res, 404, 'ERR_CHAPTER_NOT_FOUND', { volume: body.volume, chapter: body.chapter });
          return true;
        }
        const indices = pageRange(body.pageIndices, found.pages.length);
        let applied = 0;
        let movedNotes = 0;
        let movedAnnotations = 0;
        for (const index of indices) {
          const doc =
            readPageDoc(dataRoot, body.volume, body.chapter, index) ?? createEmptyDoc(body.volume, body.chapter, index);
          const result = applyPanelTemplate(dataRoot, doc, body.templateId);
          if (result) {
            applied++;
            movedNotes += result.movedNotes;
            movedAnnotations += result.movedAnnotations;
          }
        }
        sendJson(res, 200, { applied, movedNotes, movedAnnotations });
        return true;
      }

      /* ---------------- Declarative layout templates ---------------- */
      if (pathname === '/api/layouts' && req.method === 'GET') {
        sendJson(res, 200, { layouts: listLayouts(dataRoot) });
        return true;
      }

      if (pathname === '/api/layouts' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        sendJson(res, 200, { layout: saveLayout(dataRoot, body) });
        return true;
      }

      if (pathname === '/api/layouts' && req.method === 'DELETE') {
        sendJson(res, 200, { removed: deleteLayout(dataRoot, url.searchParams.get('id') ?? '') });
        return true;
      }

      // Capture a page's current panels as a layout template, so users can start from it and edit the JSON afterwards.
      if (pathname === '/api/layouts/capture' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          chapter?: string;
          pageIndex?: number;
          name?: string;
          scope?: 'volume' | 'chapter' | 'page';
          cols?: number;
        };
        if (!body.volume || !body.chapter) {
          fail(res, 400, 'ERR_MISSING_VOLUME_CHAPTER');
          return true;
        }
        requirePage(library, body.volume, body.chapter, Number(body.pageIndex) || 0);
        const doc = readPageDoc(dataRoot, body.volume, body.chapter, Number(body.pageIndex) || 0);
        if (!doc?.panels.length) {
          fail(res, 400, 'ERR_PAGE_NO_PANELS', { volume: body.volume, chapter: body.chapter });
          return true;
        }
        const layout = saveLayout(dataRoot, {
          name: body.name || t('DEFAULT_NAME_LAYOUT_PAGE', { chapter: body.chapter, page: (body.pageIndex ?? 0) + 1 }),
          scope: body.scope ?? 'page',
          volume: body.volume,
          chapter: body.chapter,
          pageIndex: Number(body.pageIndex) || 0,
          grid: captureLayout(
            doc.panels.map((p) => p.rect),
            Number(body.cols) || 2,
          ),
        });
        sendJson(res, 200, { layout });
        return true;
      }

      if (pathname === '/api/layouts/apply' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          layoutId?: string;
          volume?: string;
          chapter?: string;
          pageIndices?: number[];
        };
        const all = listLayouts(dataRoot);
        const layout = all.find((l) => l.id === body.layoutId);
        if (!layout) {
          fail(res, 404, 'ERR_LAYOUT_NOT_FOUND', { layoutId: body.layoutId ?? '' });
          return true;
        }
        const volume = body.volume ?? layout.volume;
        const chapters = library.volumes
          .find((v) => v.id === volume)
          ?.chapters.filter((c) => !body.chapter || c.chapter === body.chapter);
        if (!chapters?.length) {
          fail(res, 404, 'ERR_CHAPTER_NOT_FOUND', { volume, chapter: body.chapter ?? '' });
          return true;
        }
        let applied = 0;
        for (const ch of chapters) {
          for (const index of pageRange(body.pageIndices, ch.pages.length)) {
            const doc = readPageDoc(dataRoot, volume, ch.chapter, index) ?? createEmptyDoc(volume, ch.chapter, index);
            const rects = expandLayout(layout, index);
            const panels = rects.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' as const }));
            // Match old panels to new ones by artwork overlap, so a different panel count keeps
            // panel-level notes and marks instead of dropping or reshuffling them.
            const remap = remapPanelRefs(doc, panels);
            writePageDoc(
              dataRoot,
              {
                ...doc,
                panels,
                notes: remap.notes,
                annotations: remap.annotations,
                groups: remap.groups,
                panelOffsets: remap.panelOffsets,
                readingDirection: layout.readingDirection ?? doc.readingDirection,
                detectorVersion: `layout:${layout.id}`,
                detectedAt: new Date().toISOString(),
                detectSource: 'template',
              },
              { source: 'batch' },
            );
            applied++;
          }
        }
        sendJson(res, 200, { applied });
        return true;
      }

      /* ---------------- Panel detector plugins ---------------- */
      if (pathname === '/api/plugins' && req.method === 'GET') {
        sendJson(res, 200, { plugins: await listPlugins(rootDir, dataRoot) });
        return true;
      }

      /* ---------------- Align presets ---------------- */
      if (pathname === '/api/align-presets' && req.method === 'GET') {
        sendJson(res, 200, { presets: listAlignPresets(dataRoot) });
        return true;
      }

      if (pathname === '/api/align-presets' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as Partial<AlignPreset> & {
          name?: string;
          volume?: string;
          chapter?: string;
        };
        if (!body.name || !body.volume || !body.chapter) {
          fail(res, 400, 'ERR_ALIGN_PRESET_MISSING_FIELDS');
          return true;
        }
        const preset = saveAlignPreset(dataRoot, {
          ...body,
          name: body.name,
          volume: body.volume,
          chapter: body.chapter,
        });
        sendJson(res, 200, { preset });
        return true;
      }

      if (pathname === '/api/align-presets' && req.method === 'DELETE') {
        const id = url.searchParams.get('id') ?? '';
        sendJson(res, 200, { removed: deleteAlignPreset(dataRoot, id) });
        return true;
      }

      if (pathname === '/api/align-presets/apply' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          presetId: string;
          volume?: string;
          chapter?: string;
          pageIndices?: number[];
        };
        const preset = listAlignPresets(dataRoot).find((p) => p.id === body.presetId);
        if (!preset) {
          fail(res, 404, 'ERR_ALIGN_PRESET_NOT_FOUND', { presetId: body.presetId ?? '' });
          return true;
        }
        const volume = body.volume ?? preset.volume;
        const chapters = library.volumes
          .find((v) => v.id === volume)
          ?.chapters.filter((c) => !body.chapter || c.chapter === body.chapter);
        if (!chapters?.length) {
          fail(res, 404, 'ERR_CHAPTER_NOT_FOUND', { volume, chapter: body.chapter ?? '' });
          return true;
        }
        let applied = 0;
        for (const ch of chapters) {
          for (const index of pageRange(body.pageIndices, ch.pages.length)) {
            const doc = readPageDoc(dataRoot, volume, ch.chapter, index) ?? createEmptyDoc(volume, ch.chapter, index);
            writePageDoc(
              dataRoot,
              {
                ...doc,
                alignMode: preset.mode,
                offsets: preset.offsets,
                gridStep: preset.gridStep,
                panelOffsets: preset.panelOffsets,
              },
              { source: 'align' },
            );
            applied++;
          }
        }
        sendJson(res, 200, { applied });
        return true;
      }

      /* ---------------- Export templates ---------------- */
      if (pathname === '/api/export-templates' && req.method === 'GET') {
        sendJson(res, 200, { templates: listExportTemplates(dataRoot) });
        return true;
      }

      if (pathname === '/api/export-templates' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { name?: string; config?: ExportTemplate['config'] };
        const template = saveExportTemplate(dataRoot, { name: body.name, config: body.config ?? {} });
        sendJson(res, 200, { template });
        return true;
      }

      if (pathname === '/api/export-templates' && req.method === 'DELETE') {
        const id = url.searchParams.get('id') ?? '';
        sendJson(res, 200, { removed: deleteExportTemplate(dataRoot, id) });
        return true;
      }

      if (pathname === '/api/export' && req.method === 'POST') {
        const config = JSON.parse(await readBody(req)) as ExportConfig;
        const result = await exportChapter({
          rootDir,
          rawRoot,
          dataRoot,
          exportRoot,
          config,
          library,
        });
        sendJson(res, 200, result);
        return true;
      }

      if (pathname === '/api/export/docx' && req.method === 'POST') {
        const config = JSON.parse(await readBody(req)) as ExportConfig;
        const result = await exportChapterDocx({ rootDir, dataRoot, exportRoot, config, library });
        sendJson(res, 200, result);
        return true;
      }

      // Browser-composited page PNGs (annotations baked in) staged for the Word export.
      // The server has no canvas, so the client renders each annotated page and drops it here.
      if (pathname === '/api/export/annotation-image' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 48 * 1024 * 1024)) as {
          id?: unknown;
          key?: unknown;
          dataUrl?: unknown;
        };
        const id = String(body.id ?? '');
        const key = String(body.key ?? '');
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail(res, 400, 'ERR_ANNOTATION_IMAGE_INVALID', { reason: 'id' });
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) fail(res, 400, 'ERR_ANNOTATION_IMAGE_INVALID', { reason: 'key' });
        const dataUrl = String(body.dataUrl ?? '');
        if (!dataUrl.startsWith('data:image/png;base64,')) {
          fail(res, 400, 'ERR_ANNOTATION_IMAGE_INVALID', { reason: 'dataUrl' });
          return true;
        }
        const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        if (!buffer.length) fail(res, 400, 'ERR_ANNOTATION_IMAGE_INVALID', { reason: 'empty' });
        const dir = path.join(exportRoot, '.staging', id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${key}.png`), buffer);
        sendJson(res, 200, { ok: true, bytes: buffer.length });
        return true;
      }

      // Share images for feed platforms. The client renders the 3:4 canvas (sRGB, JPEG or
      // PNG) and uploads the finished bytes; the server only validates and stores them.
      if (pathname === '/api/export/share-image' && req.method === 'POST') {
        const dir = url.searchParams.get('dir') ?? '';
        const name = url.searchParams.get('name') ?? '';
        const unsafe = (value: string, max: number) => {
          if (!value || value.length > max || value.startsWith('.') || value.includes('..')) return true;
          return Array.from(value).some((ch) => '/\\:*?"<>|'.includes(ch) || ch.charCodeAt(0) < 32);
        };
        if (unsafe(dir, 80)) {
          fail(res, 400, 'ERR_SHARE_IMAGE_INVALID', { reason: 'dir' });
          return true;
        }
        if (unsafe(name, 120)) {
          fail(res, 400, 'ERR_SHARE_IMAGE_INVALID', { reason: 'name' });
          return true;
        }
        const ext = path.extname(name).toLowerCase();
        if (ext !== '.jpg' && ext !== '.png') {
          fail(res, 400, 'ERR_SHARE_IMAGE_INVALID', { reason: 'format' });
          return true;
        }
        const buffer = await readBodyBuffer(req, 32 * 1024 * 1024);
        const jpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        const png =
          buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
        if ((ext === '.jpg' && !jpeg) || (ext === '.png' && !png)) {
          fail(res, 400, 'ERR_SHARE_IMAGE_INVALID', { reason: 'content' });
          return true;
        }
        const folder = path.join(exportRoot, dir);
        const target = safeResolve(exportRoot, path.join(dir, name));
        if (!target) {
          fail(res, 400, 'ERR_SHARE_IMAGE_INVALID', { reason: 'path' });
          return true;
        }
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(target, buffer);
        sendJson(res, 200, {
          file: `${dir}/${name}`,
          url: `/exports/${encodeURIComponent(dir)}/${encodeURIComponent(name)}`,
          bytes: buffer.length,
        });
        return true;
      }

      // Default download name for exported files
      if (pathname === '/api/export/download') {
        const file = url.searchParams.get('file') ?? '';
        const target = safeResolve(exportRoot, file);
        if (!target || !fs.existsSync(target)) {
          fail(res, 404, 'ERR_FILE_NOT_FOUND', { path: file });
          return true;
        }
        serveFile(res, target, path.basename(target));
        return true;
      }

      /* ---------------- Multiple manga management ---------------- */
      if (pathname === '/api/library/volume-config' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          dirs?: Partial<Record<string, string | null>>;
          defaultDirection?: string | null;
          chapter?: string;
          pageOffsets?: Partial<Record<string, { from: number; to: number } | null>>;
        };
        const hasOffsets = Boolean(body.chapter) && body.pageOffsets !== undefined;
        if (!body.volume || (!body.dirs && body.defaultDirection === undefined && !hasOffsets)) {
          fail(res, 400, 'ERR_MISSING_VOLUME_DIRS');
          return true;
        }
        if (body.dirs) setVolumeDirs(rawRoot, dataRoot, body.volume, body.dirs);
        if (hasOffsets) {
          setChapterPageOffsets(rawRoot, dataRoot, body.volume, body.chapter as string, body.pageOffsets ?? {});
        }
        if (body.defaultDirection !== undefined) {
          const direction = body.defaultDirection === null ? null : readReadingDirection(body.defaultDirection);
          if (body.defaultDirection !== null && !direction) {
            fail(res, 400, 'ERR_UNKNOWN_DIRECTION');
            return true;
          }
          setVolumeDefaultDirection(rawRoot, dataRoot, body.volume, direction ?? null);
        }
        sendJson(res, 200, { library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      /* ---------------- Preprocessing wizard ---------------- */
      if (pathname === '/api/preprocess/backup' && req.method === 'GET') {
        sendJson(res, 200, { backup: readPreprocessBackup(dataRoot) });
        return true;
      }

      if (pathname === '/api/preprocess/apply' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          title?: string;
          chapters?: Record<string, unknown>;
          dirs?: Partial<Record<string, string | null>>;
        };
        if (!body.volume) {
          fail(res, 400, 'ERR_MISSING_VOLUME_DIRS');
          return true;
        }
        const result = applyPreprocess(rawRoot, dataRoot, {
          volume: body.volume,
          title: body.title,
          chapters: body.chapters,
          dirs: body.dirs,
        });
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/preprocess/restore' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { volume?: string };
        if (!body.volume) {
          fail(res, 400, 'ERR_MISSING_VOLUME_DIRS');
          return true;
        }
        const result = restorePreprocess(dataRoot, body.volume);
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/preprocess/rename' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          chapter?: string;
          prefix?: string;
          start?: number;
          padding?: number;
          order?: number[];
        };
        const result = renameChapterFiles(rawRoot, dataRoot, {
          volume: String(body.volume ?? ''),
          chapter: String(body.chapter ?? ''),
          prefix: body.prefix,
          start: body.start,
          padding: body.padding,
          order: Array.isArray(body.order) ? body.order.map((index) => Number(index)) : undefined,
        });
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/preprocess/split' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          chapter?: string;
          pageIndex?: number;
          axis?: 'vertical' | 'horizontal';
          ratio?: number;
        };
        const result = splitPage(rawRoot, dataRoot, {
          volume: String(body.volume ?? ''),
          chapter: String(body.chapter ?? ''),
          pageIndex: Number(body.pageIndex),
          axis: body.axis,
          ratio: body.ratio,
        });
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/library/add-volume' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { sourcePath?: string; name?: string };
        const result = addVolume(rawRoot, body.sourcePath, body.name, dataRoot);
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/library/remove-volume' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { volume?: string; deleteFiles?: boolean };
        if (!body.volume) {
          fail(res, 400, 'ERR_MISSING_VOLUME');
          return true;
        }
        const result = removeVolume(rawRoot, dataRoot, body.volume, { deleteFiles: body.deleteFiles === true });
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      /* Unlink a single chapter without touching its folder or page data. */
      if (pathname === '/api/library/remove-chapter' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { volume?: string; chapter?: string; hidden?: boolean };
        if (!body.volume || !body.chapter) {
          fail(res, 400, 'ERR_MISSING_VOLUME_DIRS');
          return true;
        }
        setChapterHidden(rawRoot, dataRoot, body.volume, body.chapter, body.hidden !== false);
        sendJson(res, 200, { library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      /* ---------------- Cache overview and cleanup ---------------- */
      if (pathname === '/api/cache' && req.method === 'GET') {
        sendJson(res, 200, cacheOverview(dataRoot, exportRoot));
        return true;
      }

      if (pathname === '/api/cache/clear' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { target?: string };
        let cleared: { removed: number; freed: number };
        if (body.target === 'thumbs') cleared = clearThumbCache(dataRoot);
        else if (body.target === 'remote') cleared = { removed: clearRemoteCache(dataRoot), freed: 0 };
        else if (body.target === 'staging') cleared = clearExportStaging(exportRoot);
        else {
          fail(res, 400, 'ERR_CACHE_TARGET_INVALID');
          return true;
        }
        sendJson(res, 200, { ...cleared, cache: cacheOverview(dataRoot, exportRoot) });
        return true;
      }

      if (pathname === '/api/cache/reset-detect' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { volume?: string };
        const result = resetAutoPanels(dataRoot, body.volume || undefined);
        sendJson(res, 200, { ...result, cache: cacheOverview(dataRoot, exportRoot) });
        return true;
      }

      /* ---------------- Note index (full-text search / cross-page overview) ---------------- */
      if (pathname === '/api/notes' && req.method === 'GET') {
        const pageIndexRaw = url.searchParams.get('pageIndex');
        sendJson(
          res,
          200,
          collectNotes(dataRoot, {
            q: url.searchParams.get('q') ?? undefined,
            tag: url.searchParams.get('tag') ?? undefined,
            source: url.searchParams.get('source') ?? undefined,
            volume: url.searchParams.get('volume') ?? undefined,
            chapter: url.searchParams.get('chapter') ?? undefined,
            pageIndex: pageIndexRaw ? Number(pageIndexRaw) : undefined,
            limit: Number(url.searchParams.get('limit') ?? 500),
          }),
        );
        return true;
      }

      /* ---------------- Note source: fetch page title (optional) ---------------- */
      if (pathname === '/api/link-title' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { url?: string };
        const target = (body.url ?? '').trim();
        if (!/^https?:\/\//i.test(target)) {
          fail(res, 400, 'ERR_URL_NOT_HTTP');
          return true;
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(target, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'user-agent': 'Mozilla/5.0 KomaYomi/0.1' },
          });
          clearTimeout(timer);
          const text = (await resp.text()).slice(0, 200_000);
          const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = match
            ? match[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\s+/g, ' ')
                .trim()
            : '';
          sendJson(res, 200, { title });
        } catch {
          const warning = t('WARN_TITLE_FETCH_FAILED');
          sendJson(res, 200, { title: '', warning, warningCode: 'WARN_TITLE_FETCH_FAILED' });
        }
        return true;
      }

      /* ---------------- Backup / restore ---------------- */
      if (pathname === '/api/backup' && req.method === 'POST') {
        const { buffer, entries } = createBackupBuffer(dataRoot);
        fs.mkdirSync(exportRoot, { recursive: true });
        const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        fs.writeFileSync(path.join(exportRoot, name), buffer);
        sendJson(res, 200, {
          file: name,
          url: `/exports/${encodeURIComponent(name)}`,
          size: buffer.length,
          entries,
        });
        return true;
      }

      if (pathname === '/api/backup/inspect' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 256 * 1024 * 1024)) as { data?: string };
        const buffer = Buffer.from(body.data ?? '', 'base64');
        sendJson(res, 200, inspectBackup(dataRoot, buffer));
        return true;
      }

      if (pathname === '/api/backup/restore' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 256 * 1024 * 1024)) as { data?: string };
        const buffer = Buffer.from(body.data ?? '', 'base64');
        const result = restoreBackup(dataRoot, exportRoot, buffer);
        // The library now comes from the backup, not from the opened project file.
        clearProjectLink(dataRoot);
        sendJson(res, 200, {
          ...result,
          link: projectSync.status(),
          library: createLibrary(rawRoot, dataRoot),
        });
        return true;
      }

      /* ---------------- Scheduled local backups ---------------- */
      if (pathname === '/api/backup/schedule' && req.method === 'GET') {
        sendJson(res, 200, {
          config: readAutoBackupConfig(readLibraryConfig(dataRoot)),
          state: readAutoBackupState(dataRoot),
          files: listAutoBackups(exportRoot),
        });
        return true;
      }

      if (pathname === '/api/backup/schedule' && req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as { config?: unknown };
        const config = normalizeAutoBackupConfig(body.config);
        writeLibraryConfig(dataRoot, { ...readLibraryConfig(dataRoot), autoBackup: config });
        sendJson(res, 200, { config, state: readAutoBackupState(dataRoot), files: listAutoBackups(exportRoot) });
        return true;
      }

      if (pathname === '/api/backup/schedule/run' && req.method === 'POST') {
        const config = readAutoBackupConfig(readLibraryConfig(dataRoot));
        const result = runAutoBackup(dataRoot, exportRoot, config);
        sendJson(res, 200, {
          ...result,
          config,
          state: readAutoBackupState(dataRoot),
          files: listAutoBackups(exportRoot),
        });
        return true;
      }

      /* ---------------- Storage providers (local / network drive / WebDAV) ---------------- */
      if (pathname === '/api/storage' && req.method === 'GET') {
        sendJson(res, 200, {
          config: markSecrets(dataRoot, readStorageConfig(dataRoot)),
          cache: cacheStats(dataRoot),
        });
        return true;
      }

      if (pathname === '/api/storage' && req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as {
          config?: StorageConfig;
          secrets?: Record<string, string | null>;
        };
        if (!body.config) {
          fail(res, 400, 'ERR_STORAGE_CONFIG_MISSING');
          return true;
        }
        // Passwords arrive separately and are encrypted; storage.json stays shareable.
        for (const [id, secret] of Object.entries(body.secrets ?? {})) {
          setSecret(dataRoot, id, secret || null);
        }
        const saved = writeStorageConfig(dataRoot, body.config);
        sendJson(res, 200, { config: markSecrets(dataRoot, saved) });
        return true;
      }

      if (pathname === '/api/storage/test' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { id?: string };
        const cfg = readStorageConfig(dataRoot);
        const targets = [cfg.rawSource, ...cfg.backups].filter((t): t is StorageTarget => Boolean(t));
        const chosen = body.id ? targets.filter((t) => t.id === body.id) : targets;
        const statuses = await Promise.all(
          chosen.map((t) => createProvider(dataRoot, t, { mustExist: cfg.rawSource?.id === t.id }).status()),
        );
        sendJson(res, 200, { statuses });
        return true;
      }

      if (pathname === '/api/storage/sync' && req.method === 'POST') {
        const source = readStorageConfig(dataRoot).rawSource;
        if (!source?.enabled) {
          fail(res, 400, 'ERR_REMOTE_SOURCE_MISSING');
          return true;
        }
        const result = await syncRemoteTree(dataRoot, createProvider(dataRoot, source));
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/storage/cache/clear' && req.method === 'POST') {
        sendJson(res, 200, { removed: clearRemoteCache(dataRoot), cache: cacheStats(dataRoot) });
        return true;
      }

      if (pathname === '/api/storage/ls' && req.method === 'GET') {
        const id = url.searchParams.get('target') ?? '';
        const cfg = readStorageConfig(dataRoot);
        const target = [cfg.rawSource, ...cfg.backups].find((t) => t?.id === id);
        if (!target) {
          fail(res, 404, 'ERR_STORAGE_TARGET_NOT_FOUND', { targetId: id });
          return true;
        }
        try {
          const entries = await createProvider(dataRoot, target).list(url.searchParams.get('path') ?? '');
          sendJson(res, 200, { entries });
        } catch (err) {
          fail(res, 503, 'ERR_STORAGE_LIST_FAILED', { detail: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (pathname === '/api/storage/backup' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { targetId?: string };
        const { buffer, entries } = createBackupBuffer(dataRoot);
        const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        const target = body.targetId
          ? readStorageConfig(dataRoot).backups.find((t) => t.id === body.targetId)
          : undefined;
        if (target) {
          try {
            await createProvider(dataRoot, target).write(`backups/${name}`, buffer);
            sendJson(res, 200, {
              file: `backups/${name}`,
              target: target.name,
              size: buffer.length,
              entries,
            });
          } catch (err) {
            fail(res, 503, 'ERR_BACKUP_UPLOAD_FAILED', {
              detail: err instanceof Error ? err.message : String(err),
            });
          }
          return true;
        }
        fs.mkdirSync(exportRoot, { recursive: true });
        fs.writeFileSync(path.join(exportRoot, name), buffer);
        sendJson(res, 200, {
          file: name,
          url: `/exports/${encodeURIComponent(name)}`,
          size: buffer.length,
          entries,
        });
        return true;
      }

      /* ---------------- Project files .mnproj ---------------- */
      if (pathname === '/api/project/export' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { mode?: string; name?: string; notes?: string };
        const result = createProjectBuffer({
          rootDir,
          storageMode: body.mode === 'packaged' ? 'packaged' : 'reference',
          name: body.name,
          notes: body.notes,
        });
        fs.mkdirSync(exportRoot, { recursive: true });
        const file = `${projectFileName(body.name || `project-${new Date().toISOString().replace(/[:.]/g, '-')}`)}.mnproj`;
        fs.writeFileSync(path.join(exportRoot, file), result.buffer);
        sendJson(res, 200, {
          file,
          url: `/exports/${encodeURIComponent(file)}`,
          size: result.buffer.length,
          entries: result.entries,
          storageMode: result.manifest.storageMode,
          name: result.manifest.name,
          manifest: {
            schemaVersion: result.manifest.schemaVersion,
            appVersion: result.manifest.appVersion,
            storageMode: result.manifest.storageMode,
            pageCount: result.manifest.inventory.pageCount,
            images: result.manifest.inventory.images.length,
            volumes: result.manifest.inventory.volumes.map((v) => v.volume),
            notes: result.manifest.notes,
          },
          warnings: result.warnings,
        });
        return true;
      }

      if (pathname === '/api/project/inspect' && req.method === 'POST') {
        const buffer = isBinaryUpload(req)
          ? await readBodyBuffer(req, MAX_PROJECT_BYTES)
          : Buffer.from((JSON.parse(await readBody(req, 256 * 1024 * 1024)) as { data?: string }).data ?? '', 'base64');
        sendJson(res, 200, inspectProject({ rootDir, buffer }));
        return true;
      }

      /* ---- Open a project by path (desktop file picker) and write saves back to it ---- */
      if (pathname === '/api/project/link' && req.method === 'GET') {
        sendJson(res, 200, projectSync.status());
        return true;
      }

      if (pathname === '/api/project/open/inspect' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { path?: string };
        const target = resolveProjectFilePath(body.path);
        const buffer = readProjectFile(target);
        if (buffer.length > MAX_PROJECT_BYTES) {
          throw new AppError('ERR_BODY_TOO_LARGE', { limit: Math.round(MAX_PROJECT_BYTES / (1024 * 1024)) }, 413);
        }
        sendJson(res, 200, { path: target, info: inspectProject({ rootDir, buffer }) });
        return true;
      }

      if (pathname === '/api/project/open' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { path?: string; conflict?: string; relinkDir?: string };
        const target = resolveProjectFilePath(body.path);
        const buffer = readProjectFile(target);
        const info = inspectProject({ rootDir, buffer });
        const result = importProject({
          rootDir,
          buffer,
          conflict: body.conflict === 'merge' || body.conflict === 'skip' ? body.conflict : 'overwrite',
          relinkDir: body.relinkDir,
        });
        // From here on, every save is written back into this file.
        const link = linkProject(dataRoot, {
          path: target,
          storageMode: info.storageMode,
          name: info.name ?? path.basename(target, path.extname(target)),
          notes: info.notesText,
          createdAt: info.createdAt,
        });
        sendJson(res, 200, { ...result, info, link, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/project/save' && req.method === 'POST') {
        sendJson(res, 200, { result: projectSync.flush(), link: projectSync.status() });
        return true;
      }

      // "Save as": a standalone copy at a chosen path, never the opened project file.
      if (pathname === '/api/project/save-as' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          path?: string;
          mode?: string;
          name?: string;
          notes?: string;
        };
        const target = resolveProjectSavePath(body.path, dataRoot);
        const packed = createProjectBuffer({
          rootDir,
          dataRoot,
          rawRoot,
          storageMode: body.mode === 'reference' ? 'reference' : 'packaged',
          name: body.name?.trim() || path.basename(target, path.extname(target)),
          notes: body.notes?.trim() || undefined,
        });
        sendJson(res, 200, { ...writeProjectCopy(target, packed.buffer), manifest: packed.manifest });
        return true;
      }

      if (pathname === '/api/project/unlink' && req.method === 'POST') {
        sendJson(res, 200, { removed: clearProjectLink(dataRoot), link: projectSync.status() });
        return true;
      }

      if (pathname === '/api/project/import' && req.method === 'POST') {
        const binary = isBinaryUpload(req);
        let buffer: Buffer;
        let conflictRaw: string | undefined;
        let relinkDir: string | undefined;
        if (binary) {
          buffer = await readBodyBuffer(req, MAX_PROJECT_BYTES);
          conflictRaw = url.searchParams.get('conflict') ?? undefined;
          relinkDir = url.searchParams.get('relinkDir') ?? undefined;
        } else {
          const body = JSON.parse(await readBody(req, 256 * 1024 * 1024)) as {
            data?: string;
            conflict?: string;
            relinkDir?: string;
          };
          buffer = Buffer.from(body.data ?? '', 'base64');
          conflictRaw = body.conflict;
          relinkDir = body.relinkDir;
        }
        const result = importProject({
          rootDir,
          buffer,
          conflict: conflictRaw === 'merge' || conflictRaw === 'skip' ? conflictRaw : 'overwrite',
          relinkDir,
        });
        // An uploaded project has no path on this machine, so the previous link must go:
        // keeping it would write this unrelated data into the file opened earlier.
        clearProjectLink(dataRoot);
        sendJson(res, 200, { ...result, link: projectSync.status(), library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      /* ---------------- Unified exchange format .mntpl / .mnexp / .mnpage.json ---------------- */
      if (pathname === '/api/exchange/layout/export' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { layoutId?: string; id?: string };
        sendJson(
          res,
          200,
          exportLayoutTemplate({
            rootDir,
            exportRoot,
            layoutId: String(body.layoutId ?? body.id ?? ''),
          }),
        );
        return true;
      }

      if (pathname === '/api/exchange/layout/import' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 64 * 1024 * 1024)) as {
          data?: string;
          volume?: string;
          chapter?: string;
          pageIndex?: number;
          scope?: 'volume' | 'chapter' | 'page';
          name?: string;
        };
        sendJson(
          res,
          200,
          importLayoutTemplate({
            rootDir,
            data: body.data,
            volume: body.volume ?? '',
            chapter: body.chapter,
            pageIndex: body.pageIndex,
            scope: body.scope,
            name: body.name,
          }),
        );
        return true;
      }

      if (pathname === '/api/exchange/export-template/export' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { templateId?: string; id?: string };
        sendJson(
          res,
          200,
          exportExportTemplate({
            rootDir,
            exportRoot,
            templateId: String(body.templateId ?? body.id ?? ''),
          }),
        );
        return true;
      }

      if (pathname === '/api/exchange/export-template/import' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 64 * 1024 * 1024)) as { data?: string };
        sendJson(res, 200, importExportTemplate({ rootDir, data: body.data }));
        return true;
      }

      if (pathname === '/api/exchange/page/export' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          chapter?: string;
          pageIndex?: number;
        };
        if (!body.volume || !body.chapter) {
          fail(res, 400, 'ERR_MISSING_VOLUME_CHAPTER');
          return true;
        }
        requirePage(library, body.volume, body.chapter, Number(body.pageIndex) || 0);
        sendJson(
          res,
          200,
          exportPage({
            rootDir,
            exportRoot,
            volume: body.volume,
            chapter: body.chapter,
            pageIndex: Number(body.pageIndex) || 0,
          }),
        );
        return true;
      }

      if (pathname === '/api/exchange/page/import' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 64 * 1024 * 1024)) as {
          data?: string;
          volume?: string;
          chapter?: string;
          pageIndex?: number;
        };
        sendJson(
          res,
          200,
          importPage({
            rootDir,
            data: body.data,
            volume: body.volume,
            chapter: body.chapter,
            pageIndex: body.pageIndex,
            library,
          }),
        );
        return true;
      }

      fail(res, 404, 'ERR_UNKNOWN_ENDPOINT', { path: pathname });
      return true;
    } catch (err) {
      const { status, body } = toErrorResponse(err, currentLang());
      sendJson(res, status, body);
      return true;
    }
  };

  /**
   * Whether this request changed the working copy and must reach the opened .mnproj.
   * Opening/saving projects is excluded (opening must not rewrite the file), and read
   * mode never writes anything.
   */
  const isWorkingCopyWrite = (req: IncomingMessage, pathname: string): boolean => {
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
    if (req.headers['x-komayomi-mode'] === 'read') return false;
    if (pathname.startsWith('/api/project/')) return false;
    return !NON_MUTATING_POSTS.has(pathname);
  };

  /**
   * Negotiate the response language once per request and keep it in an async context so
   * domain modules can render warnings without threading a language argument everywhere.
   */
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (!req.url) return false;
    const lang = resolveRequestLang(req, new URL(req.url, 'http://localhost'));
    res.setHeader('Vary', 'Accept-Language');
    res.setHeader('Content-Language', lang);
    // Refuse cross-site and DNS-rebinding requests before any endpoint runs.
    try {
      assertTrustedRequest(req, guard);
    } catch (err) {
      const { status, body } = toErrorResponse(err, lang);
      sendJson(res, status, body);
      return true;
    }
    const handled = await runWithLang(lang, () => handleRequest(req, res));
    if (handled && req.url) {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (isWorkingCopyWrite(req, pathname)) projectSync.markDirty();
    }
    return handled;
  };
}

const STATIC_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
  woff: 'font/woff',
  txt: 'text/plain; charset=utf-8',
};

/** Desktop / Docker: start a standalone HTTP server exposing only local APIs; when staticDir is given, also serve the built frontend. */
export function startMangaServer(
  rootDir: string,
  port = 0,
  staticDir?: string,
  overrides: Pick<MangaServerOptions, 'rawDir' | 'dataDir' | 'exportDir'> = {},
  host = '127.0.0.1',
): Promise<{ server: http.Server; port: number }> {
  const handler = createMangaHandler({ rootDir, ...overrides, allowLan: !isLoopbackHost(host) });

  const serveStatic = (res: ServerResponse, pathname: string): boolean => {
    if (!staticDir) return false;
    const rel = decodeURIComponent(pathname);
    const candidate = safeResolve(staticDir, rel === '/' ? 'index.html' : rel.replace(/^\/+/, ''));
    let file: string | null = null;
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      file = candidate;
    } else {
      // The frontend is a single-page app: paths without an extension fall back to index.html
      const index = path.join(staticDir, 'index.html');
      if (path.extname(rel) || !fs.existsSync(index)) return false;
      file = index;
    }
    const ext = path.extname(file).slice(1).toLowerCase();
    res.setHeader('Content-Type', STATIC_MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', ext === 'html' ? 'no-cache' : 'public, max-age=3600');
    fs.createReadStream(file).pipe(res);
    return true;
  };

  const server = http.createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (handled) return;
      const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '/';
      if (serveStatic(res, pathname)) return;
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : port });
    });
  });
}

export { pad2, findPage };
