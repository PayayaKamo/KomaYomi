import fs from 'node:fs';
import path from 'node:path';
import type { AnnotationAnchor, PageDoc } from '../shared/types.ts';
import { readPageDoc, writePageDoc } from './storage.ts';
import { cacheStats } from './storageProviders.ts';
import { t } from './messages/index.ts';
import { assertSafeSegment } from './pathSafety.ts';

export type CacheSize = { bytes: number; files: number };

export type DetectStats = {
  /** Pages that still hold auto-detected panels. */
  pages: number;
  /** Auto-detected panels across those pages. */
  panels: number;
  notes: number;
  annotations: number;
};

export type CacheOverview = {
  /** Thumbnails under data/cache/thumbs (derived from raw images). */
  thumbs: CacheSize;
  /** Remote page images under data/cache/files (re-fetched on demand). */
  remote: CacheSize & { limitMb: number };
  /** Temporary annotation images written during export under exports/.staging. */
  staging: CacheSize;
  /** Auto panel-detection results stored in data/pages (kept apart: clearing needs a re-detect). */
  detect: DetectStats;
};

/** Recursive size of files below `dir`; symlinks are skipped so caches cannot point elsewhere. */
function sizeOf(dir: string): CacheSize {
  let bytes = 0;
  let files = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = sizeOf(target);
      bytes += sub.bytes;
      files += sub.files;
    } else if (entry.isFile()) {
      try {
        bytes += fs.statSync(target).size;
        files++;
      } catch {
        /* file vanished while scanning */
      }
    }
  }
  return { bytes, files };
}

function removeEntries(dir: string): { removed: number; freed: number } {
  let removed = 0;
  let freed = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { removed, freed };
  }
  for (const name of entries) {
    const target = path.join(dir, name);
    let size: CacheSize;
    try {
      const stat = fs.lstatSync(target);
      size = stat.isDirectory()
        ? sizeOf(target)
        : stat.isFile()
          ? { bytes: stat.size, files: 1 }
          : { bytes: 0, files: 0 };
    } catch {
      size = { bytes: 0, files: 0 };
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
      removed += size.files;
      freed += size.bytes;
    } catch {
      /* locked file: keep what is left and report the rest */
    }
  }
  return { removed, freed };
}

function walkPages(dataRoot: string, volume: string | undefined): PageDoc[] {
  const pagesRoot = path.join(dataRoot, 'pages');
  const volumes = volume ? [assertSafeSegment(volume, 'volume')] : listDirNames(pagesRoot);
  const docs: PageDoc[] = [];
  for (const vol of volumes) {
    for (const chapter of listDirNames(path.join(pagesRoot, vol))) {
      for (const file of listJsonFiles(path.join(pagesRoot, vol, chapter))) {
        const pageIndex = Number(file.slice(0, -'.json'.length));
        if (!Number.isInteger(pageIndex) || pageIndex < 0) continue;
        try {
          const doc = readPageDoc(dataRoot, vol, chapter, pageIndex);
          if (doc) docs.push(doc);
        } catch {
          /* A corrupt page is reported by the notes scan; skip it here instead of overwriting. */
        }
      }
    }
  }
  return docs;
}

function listDirNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listJsonFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function cacheOverview(dataRoot: string, exportRoot: string): CacheOverview {
  const remote = cacheStats(dataRoot);
  let pages = 0;
  let panels = 0;
  let notes = 0;
  let annotations = 0;
  for (const doc of walkPages(dataRoot, undefined)) {
    const auto = doc.panels.filter((panel) => panel.source === 'auto');
    if (!auto.length) continue;
    pages++;
    panels += auto.length;
    notes += doc.notes.length;
    annotations += doc.annotations?.length ?? 0;
  }
  return {
    thumbs: sizeOf(path.join(dataRoot, 'cache', 'thumbs')),
    remote: { bytes: remote.bytes, files: remote.files, limitMb: remote.limitMb },
    staging: sizeOf(path.join(exportRoot, '.staging')),
    detect: { pages, panels, notes, annotations },
  };
}

export function clearThumbCache(dataRoot: string): { removed: number; freed: number } {
  return removeEntries(path.join(dataRoot, 'cache', 'thumbs'));
}

export function clearExportStaging(exportRoot: string): { removed: number; freed: number } {
  return removeEntries(path.join(exportRoot, '.staging'));
}

function toPagePoint(point: { x: number; y: number }, rect: { x: number; y: number; w: number; h: number }) {
  return { x: rect.x + point.x * rect.w, y: rect.y + point.y * rect.h };
}

function toPageAnchor(
  anchor: AnnotationAnchor,
  rect: { x: number; y: number; w: number; h: number },
): AnnotationAnchor {
  return {
    x: rect.x + anchor.x * rect.w,
    y: rect.y + anchor.y * rect.h,
    ...(anchor.w !== undefined ? { w: anchor.w * rect.w } : {}),
    ...(anchor.h !== undefined ? { h: anchor.h * rect.h } : {}),
  };
}

export type ResetDetectResult = {
  pages: number;
  panels: number;
  notes: number;
  annotations: number;
  skipped: number;
};

/**
 * Remove auto-detected panels while keeping everything the user made:
 * hand-drawn/merged panels stay, page and panel notes/annotations stay (panel-scoped
 * ones are re-anchored to the page so their text and position survive), and the
 * detection metadata is cleared so the page can be detected again from scratch.
 */
export function resetAutoPanels(dataRoot: string, volume?: string): ResetDetectResult {
  const result: ResetDetectResult = { pages: 0, panels: 0, notes: 0, annotations: 0, skipped: 0 };
  for (const doc of walkPages(dataRoot, volume)) {
    const removed = doc.panels.filter((panel) => panel.source === 'auto');
    if (!removed.length) continue;
    const rects = new Map(removed.map((panel) => [panel.id, panel.rect] as const));

    const notes = doc.notes.map((note) => {
      if (note.scope !== 'panel' || !note.panelId || !rects.has(note.panelId)) return note;
      result.notes++;
      return { ...note, scope: 'page' as const, panelId: null };
    });

    const annotations = (doc.annotations ?? []).map((annotation) => {
      const rect = annotation.scope === 'panel' && annotation.panelId ? rects.get(annotation.panelId) : undefined;
      if (!rect) return annotation;
      result.annotations++;
      return {
        ...annotation,
        scope: 'page' as const,
        panelId: null,
        points: annotation.points.map((point) => toPagePoint(point, rect)),
        ...(annotation.anchor ? { anchor: toPageAnchor(annotation.anchor, rect) } : {}),
        updatedAt: new Date().toISOString(),
      };
    });

    const groups = (doc.groups ?? [])
      .map((group) => ({ ...group, panelIds: group.panelIds.filter((id) => !rects.has(id)) }))
      .filter((group) => group.panelIds.length > 0);

    const panelOffsets = Object.fromEntries(
      Object.entries(doc.panelOffsets).filter(([panelId]) => !rects.has(panelId)),
    );

    try {
      writePageDoc(
        dataRoot,
        {
          ...doc,
          panels: doc.panels.filter((panel) => panel.source !== 'auto'),
          notes,
          annotations,
          groups,
          panelOffsets,
        },
        {
          source: 'batch',
          clearDetect: true,
          summary: t('HISTORY_DETECT_RESET', { count: removed.length }),
        },
      );
      result.pages++;
      result.panels += removed.length;
    } catch {
      result.skipped++;
    }
  }
  return result;
}
