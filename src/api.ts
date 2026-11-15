import type {
  AlignPreset,
  DetectResult,
  DirPreview,
  DirRule,
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
  ReadingDirection,
  CacheStats,
  StorageConfig,
  StorageStatus,
} from './types';
import { t } from './i18n';

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

/* ---- 工程文件 .mnproj ---- */
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
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(t('api.nonJson', { text: text.slice(0, 120) }));
  }
  if (!res.ok) {
    // Server-provided messages stay as-is; only our own fallback is localized.
    const message = (data as { error?: string } | null)?.error ?? t('api.requestFailed', { status: res.status });
    throw new Error(message);
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  library: () => request<{ library: Library; root: string }>('/api/library'),

  addVolume: (input: { sourcePath?: string; name?: string }) =>
    request<{ added: string[]; warnings: string[]; library: Library }>('/api/library/add-volume', json(input)),

  removeVolume: (volume: string) =>
    request<{ removed: boolean; warnings: string[]; library: Library }>('/api/library/remove-volume', json({ volume })),

  saveVolumeDirs: (volume: string, dirs: Partial<Record<Lang, string | null>>) =>
    request<{ library: Library }>('/api/library/volume-config', json({ volume, dirs })),

  /* ---- 目录识别规则 ---- */
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

  /* ---- 备份 / 恢复 ---- */
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

  /* ---- 存储提供者：本机 / 网络盘 / WebDAV ---- */
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

  backupToStorage: (targetId?: string) =>
    request<{ file: string; target?: string; url?: string; size: number; entries: number }>(
      '/api/storage/backup',
      json({ targetId }),
    ),

  /* ---- 工程文件 .mnproj ---- */
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

  page: (volume: string, chapter: string, index: number) =>
    request<PageResponse>(
      `/api/page?volume=${encodeURIComponent(volume)}&chapter=${encodeURIComponent(chapter)}&index=${index}`,
    ),

  savePage: (doc: PageDoc) =>
    request<{ doc: PageDoc }>('/api/page', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    }),

  detect: (volume: string, chapter: string, pageIndex: number, lang?: string) =>
    request<DetectResult & { lang?: string }>('/api/detect', json({ volume, chapter, pageIndex, lang })),

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

  /* ---- 分格模板 ---- */
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
    request<{ applied: number; droppedNotes: number }>(
      '/api/panel-templates/apply',
      json({ templateId, volume, chapter, pageIndices }),
    ),

  /* ---- 对齐预设 ---- */
  alignPresets: () => request<{ presets: AlignPreset[] }>('/api/align-presets'),

  saveAlignPreset: (preset: Partial<AlignPreset> & { name: string; volume: string; chapter: string }) =>
    request<{ preset: AlignPreset }>('/api/align-presets', json(preset)),

  deleteAlignPreset: (id: string) =>
    request<{ removed: boolean }>(`/api/align-presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  applyAlignPreset: (presetId: string, volume: string, chapter: string, pageIndices?: number[]) =>
    request<{ applied: number }>('/api/align-presets/apply', json({ presetId, volume, chapter, pageIndices })),

  /* ---- 声明式版式模板 ---- */
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

  /* ---- 统一交换格式 .mntpl / .mnexp / .mnpage.json ---- */
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

  plugins: () => request<{ plugins: { file: string; name: string; error?: string }[] }>('/api/plugins'),

  /* ---- 导出模板 ---- */
  exportTemplates: () => request<{ templates: ExportTemplate[] }>('/api/export-templates'),

  saveExportTemplate: (name: string, config: Partial<ExportConfig>) =>
    request<{ template: ExportTemplate }>('/api/export-templates', json({ name, config })),

  deleteExportTemplate: (id: string) =>
    request<{ removed: boolean }>(`/api/export-templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** 缩略图地址（服务端磁盘缓存，避免侧栏直接加载整页大图） */
export function thumbUrl(rawUrl: string, width = 200): string {
  return `/thumb?src=${encodeURIComponent(rawUrl)}&w=${width}`;
}
