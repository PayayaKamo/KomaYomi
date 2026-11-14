import type {
  AlignPreset,
  DetectResult,
  ExportConfig,
  ExportTemplate,
  Lang,
  LayoutTemplate,
  Library,
  PageDoc,
  PageResponse,
  PanelTemplate,
  PanelRect,
  ReadingDirection,
} from './types';

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`服务返回了非 JSON 内容：${text.slice(0, 120)}`);
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`;
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

  fetchLinkTitle: (url: string) =>
    request<{ title: string; warning?: string }>('/api/link-title', json({ url })),

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

  notes: (filter: { q?: string; tag?: string; source?: string; volume?: string; chapter?: string; pageIndex?: number; limit?: number }) => {
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

  saveLayout: (layout: Partial<LayoutTemplate>) =>
    request<{ layout: LayoutTemplate }>('/api/layouts', json(layout)),

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

  plugins: () =>
    request<{ plugins: { file: string; name: string; error?: string }[] }>('/api/plugins'),

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

