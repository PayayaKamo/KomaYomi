import fs from 'node:fs';
import path from 'node:path';
import type { AlignMode, AlignOffset, Lang, Note, PageDoc, Panel, ReadingDirection } from '../shared/types.ts';
import { DEFAULT_OFFSET } from '../shared/types.ts';
import { preserveUnknown } from '../shared/format.ts';
import { assertWritableFile, readRawRecord, readStoredFile, writeStoredFile } from './schemaStore.ts';
import { t } from './messages/index.ts';

export function pageFilePath(dataRoot: string, volume: string, chapter: string, pageIndex: number): string {
  return path.join(dataRoot, 'pages', volume, chapter, `${pageIndex}.json`);
}

export function createEmptyDoc(volume: string, chapter: string, pageIndex: number): PageDoc {
  return {
    schemaVersion: 1,
    volume,
    chapter,
    pageIndex,
    panels: [],
    notes: [],
    offsets: {},
    alignMode: 'page',
    panelOffsets: {},
    gridStep: 1,
    readingDirection: 'rtl',
    updatedAt: new Date().toISOString(),
  };
}

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));

function normalizeDoc(input: PageDoc): PageDoc {
  const panels: Panel[] = (Array.isArray(input.panels) ? input.panels : [])
    .filter((p) => p && p.rect)
    .map((p, i) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `p${i + 1}`,
      source: p.source === 'auto' || p.source === 'merged' ? p.source : ('manual' as const),
      number: Number.isFinite(p.number) ? Math.max(1, Math.round(Number(p.number))) : undefined,
      rect: {
        x: clamp(p.rect.x),
        y: clamp(p.rect.y),
        w: clamp(p.rect.w, 0.005, 1),
        h: clamp(p.rect.h, 0.005, 1),
      },
    }))
    .map((p) => ({
      ...p,
      rect: {
        x: p.rect.x,
        y: p.rect.y,
        w: Math.min(p.rect.w, 1 - p.rect.x),
        h: Math.min(p.rect.h, 1 - p.rect.y),
      },
    }));

  const notes: Note[] = (Array.isArray(input.notes) ? input.notes : [])
    .filter((n) => n && typeof n.text === 'string')
    .map((n, i) => ({
      id: typeof n.id === 'string' && n.id ? n.id : `n${Date.now()}${i}`,
      scope: n.scope === 'panel' ? 'panel' : 'page',
      panelId: n.scope === 'panel' && typeof n.panelId === 'string' ? n.panelId : null,
      text: n.text,
      tags: Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string') : [],
      source:
        n.source && typeof n.source === 'object'
          ? {
              title: typeof n.source.title === 'string' ? n.source.title : undefined,
              url: typeof n.source.url === 'string' ? n.source.url : undefined,
              text: typeof n.source.text === 'string' ? n.source.text : undefined,
            }
          : undefined,
      images: Array.isArray(n.images)
        ? n.images
            .filter((img) => img && typeof img.dataUrl === 'string')
            .map((img, k) => ({
              id: typeof img.id === 'string' && img.id ? img.id : `img${Date.now()}${k}`,
              name: typeof img.name === 'string' ? img.name : '',
              dataUrl: img.dataUrl,
            }))
        : undefined,
      createdAt: typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString(),
      updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : new Date().toISOString(),
    }));

  const offsets: Partial<Record<Lang, AlignOffset>> = {};
  for (const [lang, off] of Object.entries(input.offsets ?? {})) {
    if (!off) continue;
    offsets[lang as Lang] = {
      x: Number(off.x) || 0,
      y: Number(off.y) || 0,
      scale: Math.min(4, Math.max(0.2, Number(off.scale) || 1)),
    };
  }

  const dir: ReadingDirection =
    input.readingDirection === 'ltr' || input.readingDirection === 'ttb' ? input.readingDirection : 'rtl';

  const mode: AlignMode =
    input.alignMode === 'panel' || input.alignMode === 'anchors' || input.alignMode === 'grid'
      ? input.alignMode
      : 'page';

  const panelOffsets: Record<string, Partial<Record<Lang, AlignOffset>>> = {};
  for (const [panelId, byLang] of Object.entries(input.panelOffsets ?? {})) {
    if (!byLang || typeof byLang !== 'object') continue;
    const clean: Partial<Record<Lang, AlignOffset>> = {};
    for (const [lang, off] of Object.entries(byLang)) {
      if (!off) continue;
      clean[lang as Lang] = {
        x: Number(off.x) || 0,
        y: Number(off.y) || 0,
        scale: Math.min(4, Math.max(0.2, Number(off.scale) || 1)),
      };
    }
    if (Object.keys(clean).length) panelOffsets[panelId] = clean;
  }

  const gridStep = Math.min(10, Math.max(0.1, Number(input.gridStep) || 1));

  const detectSource =
    input.detectSource === 'auto' ||
    input.detectSource === 'template' ||
    input.detectSource === 'plugin' ||
    input.detectSource === 'manual'
      ? input.detectSource
      : undefined;

  // Groups reference panel ids; drop dangling ids so old data stays consistent.
  const panelIds = new Set(panels.map((p) => p.id));
  const groups = (Array.isArray(input.groups) ? input.groups : [])
    .filter((g) => g && typeof g.id === 'string')
    .map((g) => ({
      id: g.id,
      name: typeof g.name === 'string' ? g.name : '',
      panelIds: Array.isArray(g.panelIds) ? g.panelIds.filter((id) => typeof id === 'string' && panelIds.has(id)) : [],
      number: Number.isFinite(g.number) ? Number(g.number) : undefined,
    }))
    .filter((g) => g.panelIds.length > 0);

  const annotations = (Array.isArray(input.annotations) ? input.annotations : [])
    .filter((a) => a && typeof a.id === 'string' && Array.isArray(a.points) && a.points.length)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      scope: a.scope === 'panel' ? ('panel' as const) : ('page' as const),
      panelId: a.scope === 'panel' && typeof a.panelId === 'string' ? a.panelId : null,
      points: a.points
        .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ x: clamp(p.x), y: clamp(p.y) })),
      color: typeof a.color === 'string' ? a.color : undefined,
      width: Number.isFinite(a.width) ? Number(a.width) : undefined,
      opacity: Number.isFinite(a.opacity) ? clamp(Number(a.opacity)) : undefined,
      text: typeof a.text === 'string' ? a.text : undefined,
      fontSize: Number.isFinite(a.fontSize) ? Number(a.fontSize) : undefined,
      createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date().toISOString(),
      updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : new Date().toISOString(),
    }))
    .filter((a) => a.points.length > 0);

  return {
    schemaVersion: 1,
    volume: String(input.volume ?? ''),
    chapter: String(input.chapter ?? ''),
    pageIndex: Number(input.pageIndex) || 0,
    panels,
    notes,
    offsets,
    alignMode: mode,
    panelOffsets,
    gridStep,
    readingDirection: dir,
    updatedAt: new Date().toISOString(),
    detectorVersion: typeof input.detectorVersion === 'string' ? input.detectorVersion : undefined,
    detectedAt: typeof input.detectedAt === 'string' ? input.detectedAt : undefined,
    detectSource,
    editCount: Number.isFinite(input.editCount) ? Math.max(0, Math.round(Number(input.editCount))) : 0,
    lastEditedAt: typeof input.lastEditedAt === 'string' ? input.lastEditedAt : undefined,
    lastEditSummary: typeof input.lastEditSummary === 'string' ? input.lastEditSummary : undefined,
    groups: groups.length ? groups : undefined,
    annotations: annotations.length ? annotations : undefined,
    annotationsVisible: input.annotationsVisible === false ? false : undefined,
  };
}

export function readPageDoc(dataRoot: string, volume: string, chapter: string, pageIndex: number): PageDoc | null {
  const file = pageFilePath(dataRoot, volume, chapter, pageIndex);
  if (!fs.existsSync(file)) return null;
  try {
    const stored = readStoredFile<PageDoc>(file, 'page');
    if (!stored) return null;
    // Keep fields written by a future build so a save never silently drops them.
    return preserveUnknown(stored.data, normalizeDoc(stored.data));
  } catch {
    return null;
  }
}

export type WriteMeta = {
  /** 覆盖自动计算的变更摘要 */
  summary?: string;
  /** 本次是切格结果：记录算法版本与来源 */
  detect?: { version: string; source: NonNullable<PageDoc['detectSource']>; lang?: string };
};

const rectKey = (p: Panel) =>
  `${p.id}:${p.rect.x.toFixed(4)},${p.rect.y.toFixed(4)},${p.rect.w.toFixed(4)},${p.rect.h.toFixed(4)}`;

/** 轻量变更摘要：只回答「这次改了什么」，不做逐字段审计 */
function summarize(prev: PageDoc | null, next: PageDoc): string {
  if (!prev) return t('HISTORY_CREATED');
  const parts: string[] = [];
  if (prev.panels.length !== next.panels.length) {
    parts.push(t('HISTORY_PANELS', { from: prev.panels.length, to: next.panels.length }));
  } else if (prev.panels.map(rectKey).join('|') !== next.panels.map(rectKey).join('|')) {
    parts.push(t('HISTORY_PANEL_RECTS'));
  }
  if (prev.notes.length !== next.notes.length) {
    parts.push(t('HISTORY_NOTES', { from: prev.notes.length, to: next.notes.length }));
  } else if (JSON.stringify(prev.notes) !== JSON.stringify(next.notes)) {
    parts.push(t('HISTORY_NOTE_EDIT'));
  }
  if (prev.readingDirection !== next.readingDirection) parts.push(t('HISTORY_DIRECTION'));
  if (JSON.stringify(prev.groups ?? []) !== JSON.stringify(next.groups ?? [])) parts.push(t('HISTORY_GROUPS'));
  if (JSON.stringify(prev.annotations ?? []) !== JSON.stringify(next.annotations ?? [])) {
    parts.push(t('HISTORY_ANNOTATIONS'));
  }
  if (prev.alignMode !== next.alignMode) parts.push(t('HISTORY_ALIGN_MODE'));
  else if (
    JSON.stringify(prev.offsets) !== JSON.stringify(next.offsets) ||
    JSON.stringify(prev.panelOffsets) !== JSON.stringify(next.panelOffsets)
  ) {
    parts.push(t('HISTORY_OFFSETS'));
  }
  return parts.join('; ') || t('HISTORY_SAVE');
}

export function writePageDoc(dataRoot: string, doc: PageDoc, meta?: WriteMeta): PageDoc {
  const file = pageFilePath(dataRoot, doc.volume, doc.chapter, doc.pageIndex);
  // A page written by a newer build stays untouched instead of being downgraded.
  assertWritableFile(file, 'page');
  const prevRaw = readRawRecord(file);
  const prev = readPageDoc(dataRoot, doc.volume, doc.chapter, doc.pageIndex);
  const normalized = normalizeDoc(doc);
  const now = new Date().toISOString();

  if (meta?.detect) {
    normalized.detectorVersion = meta.detect.version;
    normalized.detectedAt = now;
    normalized.detectSource = meta.detect.source;
  } else if (prev) {
    // 客户端可能没带元信息：沿用磁盘上的，避免一保存就丢
    normalized.detectorVersion = normalized.detectorVersion ?? prev.detectorVersion;
    normalized.detectedAt = normalized.detectedAt ?? prev.detectedAt;
    normalized.detectSource = normalized.detectSource ?? prev.detectSource;
  }

  normalized.editCount = (prev?.editCount ?? 0) + 1;
  normalized.lastEditedAt = now;
  normalized.lastEditSummary =
    meta?.summary ??
    (meta?.detect ? t('HISTORY_DETECTED', { version: meta.detect.version }) : summarize(prev, normalized));
  normalized.updatedAt = now;

  const merged = preserveUnknown(prevRaw, normalized);
  writeStoredFile(file, 'page', merged);
  return merged;
}

export function ensureOffset(doc: PageDoc, lang: Lang): AlignOffset {
  return doc.offsets[lang] ?? DEFAULT_OFFSET;
}

/** 扫描所有标注文件，统计标签使用情况 */
export function collectTagStats(dataRoot: string): { tag: string; count: number }[] {
  const pagesDir = path.join(dataRoot, 'pages');
  const counts = new Map<string, number>();
  if (!fs.existsSync(pagesDir)) return [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) {
        try {
          const doc = JSON.parse(fs.readFileSync(full, 'utf8')) as PageDoc;
          for (const note of doc.notes ?? []) {
            for (const tag of note.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
          }
        } catch {
          /* 单个损坏文件不影响整体 */
        }
      }
    }
  };
  walk(pagesDir);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
}
