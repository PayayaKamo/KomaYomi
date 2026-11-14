import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLibrary, previewDirs, readLibraryConfig, writeLibraryConfig } from './library.ts';
import { DEFAULT_RULES, validateRules } from './dirRules.ts';
import { addVolume, removeVolume, setVolumeDirs } from './libraryAdmin.ts';
import { detectPanels, sniffFormat, DETECTOR_VERSION, imageSize, sortReadingOrder } from './detect.ts';
import { captureLayout, deleteLayout, expandLayout, listLayouts, resolveLayout, saveLayout } from './layouts.ts';
import { listPlugins, runPlugin } from './plugins.ts';
import { collectTagStats, createEmptyDoc, readPageDoc, writePageDoc } from './storage.ts';
import { exportChapter } from './export.ts';
import { createBackupBuffer, inspectBackup, restoreBackup } from './backup.ts';
import { createProjectBuffer, importProject, inspectProject, projectFileName } from './project.ts';
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
import type { AlignPreset, ExportConfig, ExportTemplate, Library, PageDoc, PageEntry, PanelTemplate } from '../shared/types.ts';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

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
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function safeResolve(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const guard = base.endsWith(path.sep) ? base : base + path.sep;
  return target === base || target.startsWith(guard) ? target : null;
}

function findPage(library: Library, volume: string, chapter: string, index: number) {
  const vol = library.volumes.find((v) => v.id === volume);
  const ch = vol?.chapters.find((c) => c.chapter === chapter);
  const page = ch?.pages[index];
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
};

/**
 * All local endpoints, shared by the Vite middleware, the Electron server and the
 * Docker/standalone entry. Folder overrides let containers bind-mount raw/data/exports
 * separately while the desktop app keeps the `rootDir/{raw,data,exports}` layout.
 */
export function createMangaHandler({ rootDir, rawDir, dataDir, exportDir }: MangaServerOptions) {
  const rawRoot = rawDir ? path.resolve(rawDir) : path.join(rootDir, 'raw');
  const dataRoot = dataDir ? path.resolve(dataDir) : path.join(rootDir, 'data');
  const exportRoot = exportDir ? path.resolve(exportDir) : path.join(rootDir, 'exports');
  const thumbRoot = path.join(dataRoot, 'cache', 'thumbs');

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

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url) return false;
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      // ---- 缩略图（带磁盘缓存；本地缺失时按需拉取远端原图） ----
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
            sendJson(res, 502, { error: `缩略图获取失败：${err instanceof Error ? err.message : String(err)}` });
            return true;
          }
        }
        if (!file) {
          sendJson(res, 404, { error: '缩略图源不存在' });
          return true;
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(file).pipe(res);
        return true;
      }

      // ---- 原始图片（只读；本地优先，其次远端按需缓存） ----
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
          sendJson(res, 503, {
            error: `远端素材暂不可用（${err instanceof Error ? err.message : String(err)}），已缓存的页仍可阅读`,
          });
          return true;
        }
        sendJson(res, 404, { error: '图片不存在' });
        return true;
      }

      // ---- 导出文件（html 与同名 .files 目录） ----
      if (pathname.startsWith('/exports/')) {
        const rel = decodeURIComponent(pathname.slice('/exports/'.length));
        const file = safeResolve(exportRoot, rel);
        if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          sendJson(res, 404, { error: '导出文件不存在' });
          return true;
        }
        serveFile(res, file);
        return true;
      }

      if (!pathname.startsWith('/api/')) return false;

      // Container healthcheck: cheap, no filesystem walk, reports mounted folders
      // so a mis-mounted compose file is visible in `docker ps`/logs.
      if (pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          app: 'KomaYomi',
          version: process.env.npm_package_version ?? '0.1.0',
          dirs: { raw: rawRoot, data: dataRoot, exports: exportRoot },
          uptime: Math.round(process.uptime()),
        });
        return true;
      }

      const library = createLibrary(rawRoot, dataRoot);

      if (pathname === '/api/library' && req.method === 'GET') {
        sendJson(res, 200, { library, root: rootDir });
        return true;
      }

      /* ---------------- 目录识别规则（声明式 / 可预览） ---------------- */
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
          sendJson(res, 404, { error: '页面不存在' });
          return true;
        }
        const saved = readPageDoc(dataRoot, volume, chapter, index);
        const doc = saved ?? createEmptyDoc(volume, chapter, index);
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
          sendJson(res, 400, { error: '缺少卷/话信息' });
          return true;
        }
        const saved = writePageDoc(dataRoot, body);
        sendJson(res, 200, { doc: saved });
        return true;
      }

      if (pathname === '/api/detect' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume: string;
          chapter: string;
          pageIndex: number;
          lang?: string;
        };
        const found = findPage(library, body.volume, body.chapter, body.pageIndex);
        if (!found) {
          sendJson(res, 404, { error: '页面不存在' });
          return true;
        }
        const order: string[] = [body.lang ?? '', 'ja', 'zh', 'en'];
        const lang = order.find((l) => found.page.files[l as keyof PageEntry['files']]);
        const rel = lang ? found.page.files[lang as keyof PageEntry['files']] : undefined;
        if (!rel) {
          sendJson(res, 400, { error: '该页没有任何语言的图片' });
          return true;
        }
        const file = path.join(rootDir, decodeURIComponent(rel));
        const buf = fs.readFileSync(file);

        // 优先级：单页/话/卷版式模板 > 插件 > 自动检测
        const layout = resolveLayout(dataRoot, body.volume, body.chapter, body.pageIndex);
        if (layout) {
          const panels = expandLayout(layout, body.pageIndex);
          sendJson(res, 200, {
            width: imageSize(buf, file).width,
            height: imageSize(buf, file).height,
            panels,
            meta: { scale: 1, threshold: 0, ms: 0 },
            version: `layout:${layout.id}`,
            source: 'template',
            lang,
            warnings: [`按版式模板「${layout.name}」切格`],
          });
          return true;
        }

        const warnings: string[] = [];
        const size = imageSize(buf, file);
        const plugin = await runPlugin(rootDir, dataRoot, {
          ...size,
          volume: body.volume,
          chapter: body.chapter,
          pageIndex: body.pageIndex,
          filename: path.basename(file),
        });
        if (plugin.ok) {
          sendJson(res, 200, {
            ...size,
            panels: sortReadingOrder(plugin.panels, 'rtl'),
            meta: { scale: 1, threshold: 0, ms: 0 },
            version: `plugin:${plugin.plugin}`,
            source: 'plugin',
            lang,
            warnings: [`插件 ${plugin.plugin} 切格`, ...plugin.warnings],
          });
          return true;
        }
        if (plugin.plugin) {
          warnings.push(`插件 ${plugin.plugin} 失败（${plugin.error}），已回退自动检测`);
        }

        const result = detectPanels(buf, file);
        sendJson(res, 200, { ...result, lang, version: DETECTOR_VERSION, source: 'auto', warnings });
        return true;
      }

      /* ---------------- 分格模板 ---------------- */
      if (pathname === '/api/panel-templates' && req.method === 'GET') {
        sendJson(res, 200, { templates: listPanelTemplates(dataRoot) });
        return true;
      }

      if (pathname === '/api/panel-templates' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as Partial<PanelTemplate>;
        if (!Array.isArray(body.panels) || !body.panels.length) {
          sendJson(res, 400, { error: '模板没有格子' });
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
          sendJson(res, 404, { error: '章节不存在' });
          return true;
        }
        const indices = pageRange(body.pageIndices, found.pages.length);
        let applied = 0;
        let droppedNotes = 0;
        for (const index of indices) {
          const doc = readPageDoc(dataRoot, body.volume, body.chapter, index) ?? createEmptyDoc(body.volume, body.chapter, index);
          const result = applyPanelTemplate(dataRoot, doc, body.templateId);
          if (result) {
            applied++;
            droppedNotes += result.droppedNotes;
          }
        }
        sendJson(res, 200, { applied, droppedNotes });
        return true;
      }

      /* ---------------- 声明式版式模板 ---------------- */
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

      // 从某页现有分格「抓取」成版式模板，便于用户快速起步后再手改 JSON
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
          sendJson(res, 400, { error: '缺少卷/话' });
          return true;
        }
        const doc = readPageDoc(dataRoot, body.volume, body.chapter, Number(body.pageIndex) || 0);
        if (!doc?.panels.length) {
          sendJson(res, 400, { error: '这一页还没有分格可抓取' });
          return true;
        }
        const layout = saveLayout(dataRoot, {
          name: body.name || `${body.chapter} 第 ${(body.pageIndex ?? 0) + 1} 页版式`,
          scope: body.scope ?? 'page',
          volume: body.volume,
          chapter: body.chapter,
          pageIndex: Number(body.pageIndex) || 0,
          grid: captureLayout(doc.panels.map((p) => p.rect), Number(body.cols) || 2),
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
          sendJson(res, 404, { error: '版式模板不存在' });
          return true;
        }
        const volume = body.volume ?? layout.volume;
        const chapters = library.volumes
          .find((v) => v.id === volume)
          ?.chapters.filter((c) => !body.chapter || c.chapter === body.chapter);
        if (!chapters?.length) {
          sendJson(res, 404, { error: '章节不存在' });
          return true;
        }
        let applied = 0;
        for (const ch of chapters) {
          for (const index of pageRange(body.pageIndices, ch.pages.length)) {
            const doc = readPageDoc(dataRoot, volume, ch.chapter, index) ?? createEmptyDoc(volume, ch.chapter, index);
            const rects = expandLayout(layout, index);
            const oldOrder = sortReadingOrder(doc.panels, doc.readingDirection);
            const panels = rects.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' as const }));
            // 格数一致时按阅读顺序迁移格级批注，避免套模板丢笔记
            const notes =
              oldOrder.length === panels.length
                ? doc.notes.map((n) => {
                    if (n.scope !== 'panel' || !n.panelId) return n;
                    const pos = oldOrder.findIndex((p) => p.id === n.panelId);
                    return pos < 0 ? n : { ...n, panelId: panels[pos].id };
                  })
                : doc.notes.filter((n) => n.scope !== 'panel');
            writePageDoc(dataRoot, {
              ...doc,
              panels,
              notes,
              readingDirection: layout.readingDirection ?? doc.readingDirection,
              detectorVersion: `layout:${layout.id}`,
              detectedAt: new Date().toISOString(),
              detectSource: 'template',
            });
            applied++;
          }
        }
        sendJson(res, 200, { applied });
        return true;
      }

      /* ---------------- 切格插件列表 ---------------- */
      if (pathname === '/api/plugins' && req.method === 'GET') {
        sendJson(res, 200, { plugins: await listPlugins(rootDir, dataRoot) });
        return true;
      }

      /* ---------------- 对齐预设 ---------------- */
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
          sendJson(res, 400, { error: '预设缺少名称/卷/话' });
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
          sendJson(res, 404, { error: '预设不存在' });
          return true;
        }
        const volume = body.volume ?? preset.volume;
        const chapters = library.volumes
          .find((v) => v.id === volume)
          ?.chapters.filter((c) => !body.chapter || c.chapter === body.chapter);
        if (!chapters?.length) {
          sendJson(res, 404, { error: '章节不存在' });
          return true;
        }
        let applied = 0;
        for (const ch of chapters) {
          for (const index of pageRange(body.pageIndices, ch.pages.length)) {
            const doc = readPageDoc(dataRoot, volume, ch.chapter, index) ?? createEmptyDoc(volume, ch.chapter, index);
            writePageDoc(dataRoot, {
              ...doc,
              alignMode: preset.mode,
              offsets: preset.offsets,
              gridStep: preset.gridStep,
              panelOffsets: preset.panelOffsets,
            });
            applied++;
          }
        }
        sendJson(res, 200, { applied });
        return true;
      }

      /* ---------------- 导出模板 ---------------- */
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

      // 导出文件的默认下载名
      if (pathname === '/api/export/download') {
        const file = url.searchParams.get('file') ?? '';
        const target = safeResolve(exportRoot, file);
        if (!target || !fs.existsSync(target)) {
          sendJson(res, 404, { error: '文件不存在' });
          return true;
        }
        serveFile(res, target, path.basename(target));
        return true;
      }

      /* ---------------- 多漫画管理 ---------------- */
      if (pathname === '/api/library/volume-config' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as {
          volume?: string;
          dirs?: Partial<Record<string, string | null>>;
        };
        if (!body.volume || !body.dirs) {
          sendJson(res, 400, { error: '缺少卷名或语言目录配置' });
          return true;
        }
        setVolumeDirs(rawRoot, dataRoot, body.volume, body.dirs);
        sendJson(res, 200, { library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/library/add-volume' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { sourcePath?: string; name?: string };
        const result = addVolume(rawRoot, body.sourcePath, body.name);
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      if (pathname === '/api/library/remove-volume' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { volume?: string };
        if (!body.volume) {
          sendJson(res, 400, { error: '缺少卷名' });
          return true;
        }
        const result = removeVolume(rawRoot, dataRoot, body.volume);
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      /* ---------------- 笔记索引（全文搜索 / 跨页总览） ---------------- */
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

      /* ---------------- 笔记来源：抓取网页标题（可选） ---------------- */
      if (pathname === '/api/link-title' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { url?: string };
        const target = (body.url ?? '').trim();
        if (!/^https?:\/\//i.test(target)) {
          sendJson(res, 400, { error: '只支持 http(s) 链接' });
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
          sendJson(res, 200, { title: '', warning: '抓取标题失败（可能被网络限制），可以手动填写' });
        }
        return true;
      }

      /* ---------------- 备份 / 恢复 ---------------- */
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
        sendJson(res, 200, {
          ...result,
          library: createLibrary(rawRoot, dataRoot),
        });
        return true;
      }

      /* ---------------- 存储提供者（本机 / 网络盘 / WebDAV） ---------------- */
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
          sendJson(res, 400, { error: '缺少存储配置' });
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
          chosen.map((t) =>
            createProvider(dataRoot, t, { mustExist: cfg.rawSource?.id === t.id }).status(),
          ),
        );
        sendJson(res, 200, { statuses });
        return true;
      }

      if (pathname === '/api/storage/sync' && req.method === 'POST') {
        const source = readStorageConfig(dataRoot).rawSource;
        if (!source?.enabled) {
          sendJson(res, 400, { error: '尚未配置远端素材目录' });
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
          sendJson(res, 404, { error: '存储目标不存在' });
          return true;
        }
        try {
          const entries = await createProvider(dataRoot, target).list(url.searchParams.get('path') ?? '');
          sendJson(res, 200, { entries });
        } catch (err) {
          sendJson(res, 503, { error: `无法列出目录：${err instanceof Error ? err.message : String(err)}` });
        }
        return true;
      }

      if (pathname === '/api/storage/backup' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { targetId?: string };
        const { buffer, entries } = createBackupBuffer(dataRoot);
        const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        const target = body.targetId ? readStorageConfig(dataRoot).backups.find((t) => t.id === body.targetId) : undefined;
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
            sendJson(res, 503, { error: `备份上传失败：${err instanceof Error ? err.message : String(err)}` });
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

      /* ---------------- 工程文件 .mnproj ---------------- */
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
        const body = JSON.parse(await readBody(req, 256 * 1024 * 1024)) as { data?: string };
        const buffer = Buffer.from(body.data ?? '', 'base64');
        sendJson(res, 200, inspectProject({ rootDir, buffer }));
        return true;
      }

      if (pathname === '/api/project/import' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 256 * 1024 * 1024)) as {
          data?: string;
          conflict?: string;
          relinkDir?: string;
        };
        const buffer = Buffer.from(body.data ?? '', 'base64');
        const result = importProject({
          rootDir,
          buffer,
          conflict: body.conflict === 'merge' || body.conflict === 'skip' ? body.conflict : 'overwrite',
          relinkDir: body.relinkDir,
        });
        sendJson(res, 200, { ...result, library: createLibrary(rawRoot, dataRoot) });
        return true;
      }

      /* ---------------- 统一交换格式 .mntpl / .mnexp / .mnpage.json ---------------- */
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
          sendJson(res, 400, { error: '缺少卷/话' });
          return true;
        }
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
          }),
        );
        return true;
      }

      sendJson(res, 404, { error: `未知接口 ${pathname}` });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
      return true;
    }
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

/** 桌面端 / Docker：独立启动一个只提供本地接口的 HTTP 服务；传入 staticDir 时同时托管打包后的前端 */
export function startMangaServer(
  rootDir: string,
  port = 0,
  staticDir?: string,
  overrides: Pick<MangaServerOptions, 'rawDir' | 'dataDir' | 'exportDir'> = {},
  host = '127.0.0.1',
): Promise<{ server: http.Server; port: number }> {
  const handler = createMangaHandler({ rootDir, ...overrides });

  const serveStatic = (res: ServerResponse, pathname: string): boolean => {
    if (!staticDir) return false;
    const rel = decodeURIComponent(pathname);
    const candidate = safeResolve(staticDir, rel === '/' ? 'index.html' : rel.replace(/^\/+/, ''));
    let file: string | null = null;
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      file = candidate;
    } else {
      // 前端是单页应用：没有扩展名的路径回退到 index.html
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
