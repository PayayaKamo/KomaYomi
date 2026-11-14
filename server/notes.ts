import fs from 'node:fs';
import path from 'node:path';
import { readPageDoc } from './storage.ts';
import { sortReadingOrder } from './detect.ts';
import type { NoteSource, PageDoc } from '../shared/types.ts';
import { markdownExcerpt } from '../shared/markdown.ts';

function domainOf(source?: NoteSource): string {
  if (source?.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      return source.url.slice(0, 24);
    }
  }
  return source?.text?.slice(0, 24) ?? '';
}

export type NoteHit = {
  volume: string;
  chapter: string;
  pageIndex: number;
  id: string;
  scope: 'page' | 'panel';
  panelId: string | null;
  /** 1-based panel number in reading order; null for page notes */
  panelNo: number | null;
  text: string;
  excerpt: string;
  tags: string[];
  source?: NoteSource;
  /** 域名（有链接时）或自由来源前缀，便于按来源聚合 */
  domain: string;
  createdAt: string;
  updatedAt: string;
};

export type NotesFilter = {
  q?: string;
  tag?: string;
  source?: string;
  volume?: string;
  chapter?: string;
  pageIndex?: number;
  limit?: number;
};

export type NotesIndex = {
  total: number;
  notes: NoteHit[];
  chapters: { volume: string; chapter: string; count: number }[];
  tags: { tag: string; count: number }[];
  sources: { domain: string; count: number }[];
  pages: number;
};

const pageDir = (dataRoot: string) => path.join(dataRoot, 'pages');

function listDirSafe(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Full-text index over every page document.
 * Small local library (hundreds of pages) → a straight scan is fast enough
 * and avoids maintaining a second copy of the data.
 */
export function collectNotes(dataRoot: string, filter: NotesFilter = {}): NotesIndex {
  const q = (filter.q ?? '').trim().toLowerCase();
  const tag = (filter.tag ?? '').trim();
  const limit = Math.min(2000, Math.max(1, filter.limit ?? 500));
  const notes: NoteHit[] = [];
  const chapterCounts = new Map<string, { volume: string; chapter: string; count: number }>();
  const tagCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  let pageCount = 0;
  let total = 0;

  for (const volume of listDirSafe(pageDir(dataRoot))) {
    if (filter.volume && volume !== filter.volume) continue;
    for (const chapter of listDirSafe(path.join(pageDir(dataRoot), volume))) {
      if (filter.chapter && chapter !== filter.chapter) continue;
      const files = fs.readdirSync(path.join(pageDir(dataRoot), volume, chapter)).filter((f) => /^\d+\.json$/.test(f));
      for (const file of files) {
        const pageIndex = Number(file.replace(/\.json$/, ''));
        if (filter.pageIndex != null && pageIndex !== filter.pageIndex) continue;
        const doc: PageDoc | null = readPageDoc(dataRoot, volume, chapter, pageIndex);
        if (!doc || !doc.notes.length) continue;
        pageCount++;
        const order = sortReadingOrder(doc.panels, doc.readingDirection);
        for (const note of doc.notes) {
          const domain = domainOf(note.source);
          if (tag && !note.tags.includes(tag)) continue;
          if (filter.source && domain !== filter.source) continue;
          if (q) {
            const haystack =
              `${note.text}\n${note.tags.join(' ')}\n${note.source?.title ?? ''}\n${note.source?.url ?? ''}\n${note.source?.text ?? ''}`.toLowerCase();
            if (!haystack.includes(q)) continue;
          }
          total++;
          const panelNo = note.panelId ? order.findIndex((p) => p.id === note.panelId) + 1 : 0;
          const hit: NoteHit = {
            volume,
            chapter,
            pageIndex,
            id: note.id,
            scope: note.scope,
            panelId: note.scope === 'panel' ? (note.panelId ?? null) : null,
            panelNo: panelNo > 0 ? panelNo : null,
            text: note.text,
            excerpt: markdownExcerpt(note.text, 140),
            tags: note.tags,
            source: note.source,
            domain,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          };
          notes.push(hit);
          for (const t of note.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
          if (domain) sourceCounts.set(domain, (sourceCounts.get(domain) ?? 0) + 1);
          const key = `${volume}/${chapter}`;
          const entry = chapterCounts.get(key) ?? { volume, chapter, count: 0 };
          entry.count++;
          chapterCounts.set(key, entry);
        }
      }
    }
  }

  // Reading order is more useful for the overview than "recently edited".
  notes.sort(
    (a, b) =>
      a.volume.localeCompare(b.volume, 'zh-Hans-CN') ||
      a.chapter.localeCompare(b.chapter, 'zh-Hans-CN', { numeric: true }) ||
      a.pageIndex - b.pageIndex ||
      (a.panelNo ?? 0) - (b.panelNo ?? 0),
  );

  return {
    total,
    notes: notes.slice(0, limit),
    chapters: [...chapterCounts.values()],
    tags: [...tagCounts.entries()].map(([t, count]) => ({ tag: t, count })).sort((a, b) => b.count - a.count),
    sources: [...sourceCounts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count),
    pages: pageCount,
  };
}
