import type {
  AlignPreset,
  DetectResult,
  DirPreview,
  DirRule,
  ChapterOverride,
  ExportConfig,
  ExportTemplate,
  Lang,
  LayoutScope,
  LayoutTemplate,
  Library,
  PageDoc,
  PageResponse,
  PanelTemplate,
  PanelRect,
  NoteTypeDef,
  ReadingDirection,
  CacheStats,
  CacheOverview,
  DetectResetResult,
  StorageConfig,
  StorageStatus,
} from './types';
import { getLocale, t } from './i18n';
import { isReadOnly } from './lib/appMode';

/* ---- page version history (cross-session) ---- */
export type HistorySource =
  'auto' | 'manual' | 'batch' | 'template' | 'align' | 'annotation' | 'import' | 'restore' | 'detect';

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

export type PageVersion = {
  id: string;
  at: string;
  source: HistorySource;
  summary: string;
  diff: HistoryDiff;
  editCount: number;
  panelCount: number;
  annotationCount: number;
  noteCount: number;
  panels: { id: string; rect: PanelRect }[];
};

export type PageVersionList = { entries: PageVersion[]; limit: number };

export type NotesIndex = {
  total: number;
  notes: {
    volume: string;
    chapter: string;
    pageIndex: number;
    id: string;
    scope: 'page' | 'panel';
    panelId: string | null;
    panelNo: number | null;
    text: string;
    excerpt: string;
    tags: string[];
    source?: { title?: string; url?: string; text?: string };
    domain: string;
    createdAt: string;
    updatedAt: string;
  }[];
  chapters: { volume: string; chapter: string; count: number }[];
  tags: { tag: string; count: number }[];
  sources: { domain: string; count: number }[];
  pages: number;
};

/* ---- Project file .mnproj ---- */
export type ProjectMode = 'reference' | 'packaged';
export type ProjectConflict = 'overwrite' | 'merge' | 'skip';

export type ProjectInspect = {
  name?: string;
  schemaVersion: number;
  migratedFrom?: number;
  appVersion: string;
  storageMode: ProjectMode;
  createdAt: string;
  updatedAt: string;
  size: number;
  pages: number;
  notes: number;
  annotations: number;
  /** Free-form note stored in the manifest. */
  notesText?: string;
  volumes: string[];
  chapters: number;
  images: number;
  templates: number;
  presets: number;
  conflicts: { name: string; kind: 'page' | 'template' | 'preset' | 'config' }[];
  conflictCount: number;
  missingAssets: { volume: string; chapter: string; pageIndex: number; lang: Lang; name: string }[];
  warnings: string[];
};

export type ProjectImport = {
  storageMode: ProjectMode;
  restored: number;
  merged: number;
  skipped: number;
  conflicts: number;
  imagesWritten: number;
  imagesPresent: number;
  relinked: number;
  missing: { volume: string; chapter: string; pageIndex: number; lang: Lang; name: string; reason: string }[];
  snapshot: string | null;
  projectBackup: string;
  migratedFrom?: number;
  warnings: string[];
  library: Library;
  /** Present on import/open responses: whether saves now write back to a file. */
  link?: ProjectLinkStatus;
};

/** The .mnproj the user opened; while linked, every save is written back into it. */
export type ProjectLinkStatus = {
  linked: boolean;
  path?: string;
  storageMode?: ProjectMode;
  name?: string;
  notes?: string;
  createdAt?: string;
  linkedAt?: string;
  lastWriteAt?: string;
  lastWriteSize?: number;
  /** An edit has not been written back yet. */
  pending: boolean;
  /** Automatic write-back stopped after a failure; save manually to resume. */
  paused: boolean;
  lastError?: string;
};

export type ProjectWriteBack = {
  path: string;
  size: number;
  sha1: string;
  at: string;
  backup: string | null;
};

/* ---- Scheduled local backups ---- */

export type AutoBackupConfig = { enabled: boolean; intervalHours: number; keep: number };

export type AutoBackupState = { lastRunAt?: string; lastFile?: string; lastSize?: number; lastError?: string };

export type AutoBackupFile = { name: string; size: number; at: string };

export type BackupSchedule = { config: AutoBackupConfig; state: AutoBackupState; files: AutoBackupFile[] };

/**
 * Server messages (warnings, history summaries, errors) follow the interface language.
 * `?lang=` wins over `Accept-Language` on the server; both are sent so plain `<img>`/download
 * style URLs and fetch calls behave the same.
 */
function withLang(url: string): string {
  const lang = getLocale();
  if (/([?&])lang=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}lang=${lang}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept-Language', getLocale());
  // Read mode asks the server to reject anything that would write project data, so a
  // missed control in the UI can never modify someone else's project.
  if (isReadOnly()) headers.set('X-KomaYomi-Mode', 'read');
  const target = withLang(url);
  let res: Response;
  try {
    res = await fetch(target, { ...init, headers });
  } catch (err) {
    // A dead server, a restarting dev plugin or an offline browser all surface as
    // "Failed to fetch" with no status. Name the request so it can be diagnosed.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(t('api.networkError', { path: target, detail }));
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(t('api.nonJson', { text: text.slice(0, 120) }));
  }
  if (!res.ok) {
    // Server-provided messages stay as-is; the code and status make the failure traceable.
    const body = data as { error?: string; message?: string; code?: string } | null;
    const message = body?.error ?? body?.message ?? t('api.requestFailed', { status: res.status });
    throw new Error(`${message} [${body?.code ?? `HTTP ${res.status}`}]`);
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  library: () => request<{ library: Library; root: string; raw: string }>('/api/library'),

  /** Open the configured raw library folder in the host file manager. */
  revealRoot: () => request<{ ok: boolean; path: string }>('/api/reveal', json({})),

  /** App metadata for the About dialog; the version comes from package.json on the server. */
  health: () => request<{ ok: boolean; app: string; version: string; author: string; license: string }>('/api/health'),

  addVolume: (input: { sourcePath?: string; name?: string }) =>
    request<{ added: string[]; warnings: string[]; library: Library }>('/api/library/add-volume', json(input)),

  removeVolume: (volume: string, options?: { deleteFiles?: boolean }) =>
    request<{ removed: boolean; warnings: string[]; deletedPath?: string; library: Library }>(
      '/api/library/remove-volume',
      json({ volume, deleteFiles: options?.deleteFiles === true }),
    ),

  /** Unlink a chapter from the library; `hidden` false restores it. */
  removeChapter: (volume: string, chapter: string, hidden = true) =>
    request<{ library: Library }>('/api/library/remove-chapter', json({ volume, chapter, hidden })),

  saveVolumeDirs: (volume: string, dirs: Partial<Record<Lang, string | null>>) =>
    request<{ library: Library }>('/api/library/volume-config', json({ volume, dirs })),

  /** Align one language's page numbers when extra pages are inserted mid-chapter; null clears. */
  saveChapterPageOffsets: (
    volume: string,
    chapter: string,
    pageOffsets: Partial<Record<Lang, { from: number; to: number } | null>>,
  ) => request<{ library: Library }>('/api/library/volume-config', json({ volume, chapter, pageOffsets })),

  /** Persist the compare/export language order; null restores the default. */
  saveLangOrder: (order: Lang[] | null) => request<{ langOrder: Lang[] }>('/api/lang-order', json({ order })),

  /** Persist user-defined note categories (built-in and language categories are derived in the UI). */
  saveNoteTypes: (noteTypes: NoteTypeDef[]) =>
    request<{ noteTypes: NoteTypeDef[] }>('/api/note-types', json({ noteTypes })),

  /* ---- Preprocessing wizard ---- */

  preprocessBackup: () => request<{ backup: { at: string; volume: string } | null }>('/api/preprocess/backup'),

  applyPreprocess: (input: {
    volume: string;
    title?: string;
    chapters?: Record<string, ChapterOverride>;
    dirs?: Partial<Record<Lang, string | null>>;
  }) => request<{ backupAt: string; library: Library }>('/api/preprocess/apply', json(input)),

  restorePreprocess: (volume: string) =>
    request<{ at: string; library: Library }>('/api/preprocess/restore', json({ volume })),

  renameChapterFiles: (input: {
    volume: string;
    chapter: string;
    prefix?: string;
    start?: number;
    padding?: number;
    order?: number[];
  }) =>
    request<{ at: string; manifest: string; files: number; docs: number; skipped: Lang[]; library: Library }>(
      '/api/preprocess/rename',
      json(input),
    ),

  splitPage: (input: {
    volume: string;
    chapter: string;
    pageIndex: number;
    axis?: 'vertical' | 'horizontal';
    ratio?: number;
  }) =>
    request<{ at: string; manifest: string; pageIndex: number; languages: Lang[]; library: Library }>(
      '/api/preprocess/split',
      json(input),
    ),

  /* ---- Directory recognition rules ---- */
  dirRules: () =>
    request<{ rules: DirRule[]; defaults: DirRule[]; customized: boolean; warning?: string }>('/api/dir-rules'),

  saveDirRules: (rules: DirRule[]) =>
    request<{ rules: DirRule[]; library: Library }>('/api/dir-rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
    }),

  previewLibrary: (input: { dir?: string; rules?: DirRule[] }) =>
    request<DirPreview>('/api/library/preview', json(input)),

  fetchLinkTitle: (url: string) => request<{ title: string; warning?: string }>('/api/link-title', json({ url })),

  /* ---- Backup / restore ---- */
  createBackup: () =>
    request<{ file: string; url: string; size: number; entries: number }>('/api/backup', { method: 'POST' }),

  inspectBackup: (data: string) =>
    request<{
      files: number;
      pages: number;
      notes: number;
      volumes: string[];
      templates: number;
      presets: number;
      overwrite: number;
      size: number;
    }>('/api/backup/inspect', json({ data })),

  restoreBackup: (data: string) =>
    request<{ restored: number; snapshot: string | null; warnings: string[]; library: Library }>(
      '/api/backup/restore',
      json({ data }),
    ),

  /* ---- Scheduled local backups ---- */
  backupSchedule: () => request<BackupSchedule>('/api/backup/schedule'),

  saveBackupSchedule: (config: AutoBackupConfig) =>
    request<BackupSchedule>('/api/backup/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }),

  runBackupSchedule: () =>
    request<BackupSchedule & { file: string; size: number; entries: number; at: string; pruned: number }>(
      '/api/backup/schedule/run',
      json({}),
    ),

  /* ---- Storage providers: local / network drive / WebDAV ---- */
  storage: () => request<{ config: StorageConfig; cache: CacheStats }>('/api/storage'),

  saveStorage: (config: StorageConfig, secrets?: Record<string, string | null>) =>
    request<{ config: StorageConfig }>('/api/storage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, secrets }),
    }),

  testStorage: (id?: string) => request<{ statuses: StorageStatus[] }>('/api/storage/test', json({ id })),

  syncStorage: () =>
    request<{ files: number; dirs: number; skipped: number; truncated: boolean; syncedAt: string; library: Library }>(
      '/api/storage/sync',
      json({}),
    ),

  clearStorageCache: () => request<{ removed: number; cache: CacheStats }>('/api/storage/cache/clear', json({})),

  /* ---- Cache overview / cleanup (settings) ---- */
  cacheOverview: () => request<CacheOverview>('/api/cache'),

  clearCache: (target: 'thumbs' | 'remote' | 'staging') =>
    request<{ removed: number; freed: number; cache: CacheOverview }>('/api/cache/clear', json({ target })),

  /** Remove auto-detected panels; notes/annotations and hand-drawn panels are kept. */
  resetDetect: (volume?: string) =>
    request<DetectResetResult & { cache: CacheOverview }>('/api/cache/reset-detect', json({ volume })),

  backupToStorage: (targetId?: string) =>
    request<{ file: string; target?: string; url?: string; size: number; entries: number }>(
      '/api/storage/backup',
      json({ targetId }),
    ),

  /* ---- Project file .mnproj ---- */
  exportProject: (input: { mode: ProjectMode; name?: string; notes?: string }) =>
    request<{
      file: string;
      url: string;
      size: number;
      entries: number;
      storageMode: ProjectMode;
      name?: string;
      manifest: {
        schemaVersion: number;
        appVersion: string;
        storageMode: ProjectMode;
        pageCount: number;
        images: number;
        volumes: string[];
        notes?: { pages: number; noteCount: number; annotationCount: number; text?: string };
      };
      warnings: string[];
    }>('/api/project/export', json(input)),

  inspectProject: (data: ArrayBuffer) =>
    request<ProjectInspect>('/api/project/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    }),

  importProject: (input: { data: ArrayBuffer; conflict: ProjectConflict; relinkDir?: string }) => {
    const query = new URLSearchParams({ conflict: input.conflict });
    if (input.relinkDir) query.set('relinkDir', input.relinkDir);
    return request<ProjectImport>(`/api/project/import?${query.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: input.data,
    });
  },

  /** Which .mnproj (if any) receives write-backs, plus pending/error state. */
  projectLink: () => request<ProjectLinkStatus>('/api/project/link'),

  /** Inspect a project file by absolute path (desktop picker) without importing it. */
  inspectProjectPath: (path: string) =>
    request<{ path: string; info: ProjectInspect }>('/api/project/open/inspect', json({ path })),

  /** Open a project file by path; afterwards every save is written back into it. */
  openProjectPath: (input: { path: string; conflict: ProjectConflict; relinkDir?: string }) =>
    request<ProjectImport & { info: ProjectInspect }>('/api/project/open', json(input)),

  /** Force a write-back now (also resumes automatic write-back after a failure). */
  saveProjectFile: () =>
    request<{ result: ProjectWriteBack | null; link: ProjectLinkStatus }>('/api/project/save', json({})),

  /** Stop writing back to the opened file (the working copy in data/ is kept). */
  unlinkProject: () => request<{ removed: boolean; link: ProjectLinkStatus }>('/api/project/unlink', json({})),

  page: (volume: string, chapter: string, index: number) =>
    request<PageResponse>(
      `/api/page?volume=${encodeURIComponent(volume)}&chapter=${encodeURIComponent(chapter)}&index=${index}`,
    ),

  savePage: (doc: PageDoc, source: HistorySource = 'auto') =>
    request<{ doc: PageDoc }>(`/api/page?source=${encodeURIComponent(source)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    }),

  pageHistory: (volume: string, chapter: string, pageIndex: number) =>
    request<PageVersionList>(
      `/api/page-history?volume=${encodeURIComponent(volume)}&chapter=${encodeURIComponent(chapter)}&index=${pageIndex}`,
    ),

  restorePageVersion: (input: { volume: string; chapter: string; pageIndex: number; id: string }) =>
    request<{ doc: PageDoc; previousId: string | null; targetId: string }>('/api/page-history/restore', json(input)),

  setHistoryLimit: (limit: number) => request<{ limit: number }>('/api/history-limit', json({ limit })),

  detect: (volume: string, chapter: string, pageIndex: number, lang?: string, readingDirection?: ReadingDirection) =>
    request<DetectResult & { lang?: string }>(
      '/api/detect',
      json({ volume, chapter, pageIndex, lang, readingDirection }),
    ),

  tags: () => request<{ tags: { tag: string; count: number }[] }>('/api/tags'),

  notes: (filter: {
    q?: string;
    tag?: string;
    source?: string;
    volume?: string;
    chapter?: string;
    pageIndex?: number;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return request<NotesIndex>(`/api/notes?${params.toString()}`);
  },

  exportHtml: (config: ExportConfig) =>
    request<{
      file: string;
      url: string;
      pages: number;
      warnings: string[];
      imageMode: 'files' | 'embed';
      assetDir?: string;
    }>('/api/export', json(config)),

  exportDocx: (config: ExportConfig) =>
    request<{
      file: string;
      url: string;
      pages: number;
      warnings: string[];
      imageMode: 'embed';
    }>('/api/export/docx', json(config)),

  /** Stage one browser-composited page PNG for the Word export. */
  stageExportImage: (input: { id: string; key: string; dataUrl: string }) =>
    request<{ ok: true; bytes: number }>('/api/export/annotation-image', json(input)),

  /** Write one browser-rendered share image into `<exports>/<dir>/<name>`. */
  saveShareImage: (input: { dir: string; name: string; data: Blob }) => {
    const query = new URLSearchParams({ dir: input.dir, name: input.name });
    return request<{ file: string; url: string; bytes: number }>(`/api/export/share-image?${query.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: input.data,
    });
  },

  /* ---- Panel templates ---- */
  panelTemplates: () => request<{ templates: PanelTemplate[] }>('/api/panel-templates'),

  savePanelTemplate: (input: {
    name: string;
    volume: string;
    chapter: string;
    panels: PanelRect[];
    readingDirection: ReadingDirection;
  }) => request<{ template: PanelTemplate }>('/api/panel-templates', json(input)),

  deletePanelTemplate: (id: string) =>
    request<{ removed: boolean }>(`/api/panel-templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  applyPanelTemplate: (templateId: string, volume: string, chapter: string, pageIndices?: number[]) =>
    request<{ applied: number; movedNotes: number; movedAnnotations: number }>(
      '/api/panel-templates/apply',
      json({ templateId, volume, chapter, pageIndices }),
    ),

  /* ---- Alignment presets ---- */
  alignPresets: () => request<{ presets: AlignPreset[] }>('/api/align-presets'),

  saveAlignPreset: (preset: Partial<AlignPreset> & { name: string; volume: string; chapter: string }) =>
    request<{ preset: AlignPreset }>('/api/align-presets', json(preset)),

  deleteAlignPreset: (id: string) =>
    request<{ removed: boolean }>(`/api/align-presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  applyAlignPreset: (presetId: string, volume: string, chapter: string, pageIndices?: number[]) =>
    request<{ applied: number }>('/api/align-presets/apply', json({ presetId, volume, chapter, pageIndices })),

  /* ---- Declarative layout templates ---- */
  layouts: () => request<{ layouts: LayoutTemplate[] }>('/api/layouts'),

  saveLayout: (layout: Partial<LayoutTemplate>) => request<{ layout: LayoutTemplate }>('/api/layouts', json(layout)),

  deleteLayout: (id: string) =>
    request<{ removed: boolean }>(`/api/layouts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  captureLayout: (input: {
    volume: string;
    chapter: string;
    pageIndex: number;
    name?: string;
    scope?: 'volume' | 'chapter' | 'page';
    cols?: number;
  }) => request<{ layout: LayoutTemplate }>('/api/layouts/capture', json(input)),

  applyLayout: (layoutId: string, volume: string, chapter?: string, pageIndices?: number[]) =>
    request<{ applied: number }>('/api/layouts/apply', json({ layoutId, volume, chapter, pageIndices })),

  /* ---- Unified exchange formats .mntpl / .mnexp / .mnpage.json ---- */
  exportLayoutFile: (layoutId: string) =>
    request<{
      file: string;
      url: string;
      size: number;
      warnings: string[];
      layout: Record<string, unknown>;
    }>('/api/exchange/layout/export', json({ layoutId })),

  importLayoutFile: (input: {
    data: string;
    volume: string;
    chapter?: string;
    pageIndex?: number;
    scope?: LayoutScope;
    name?: string;
  }) =>
    request<{ layout: LayoutTemplate; migratedFrom?: number; backup: string; warnings: string[] }>(
      '/api/exchange/layout/import',
      json(input),
    ),

  exportExportTemplateFile: (templateId: string) =>
    request<{
      file: string;
      url: string;
      size: number;
      warnings: string[];
      template: Record<string, unknown>;
    }>('/api/exchange/export-template/export', json({ templateId })),

  importExportTemplateFile: (data: string) =>
    request<{ template: ExportTemplate; migratedFrom?: number; backup: string; warnings: string[] }>(
      '/api/exchange/export-template/import',
      json({ data }),
    ),

  exportPageFile: (input: { volume: string; chapter: string; pageIndex: number }) =>
    request<{
      file: string;
      url: string;
      size: number;
      warnings: string[];
      page: Record<string, unknown>;
    }>('/api/exchange/page/export', json(input)),

  importPageFile: (input: { data: string; volume?: string; chapter?: string; pageIndex?: number }) =>
    request<{
      doc: PageDoc;
      migratedFrom?: number;
      backup: string;
      targetBackup: string | null;
      warnings: string[];
    }>('/api/exchange/page/import', json(input)),

  plugins: () =>
    request<{
      plugins: { file: string; name: string; match?: Record<string, string>; error?: string; errorCode?: string }[];
    }>('/api/plugins'),

  /* ---- Export templates ---- */
  exportTemplates: () => request<{ templates: ExportTemplate[] }>('/api/export-templates'),

  saveExportTemplate: (name: string, config: Partial<ExportConfig>) =>
    request<{ template: ExportTemplate }>('/api/export-templates', json({ name, config })),

  deleteExportTemplate: (id: string) =>
    request<{ removed: boolean }>(`/api/export-templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** Thumbnail URL (cached on the server disk, so the sidebar never loads full-size pages). */
export function thumbUrl(rawUrl: string, width = 200): string {
  return `/thumb?src=${encodeURIComponent(rawUrl)}&w=${width}`;
}
