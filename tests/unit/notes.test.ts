import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectNotes } from '../../server/notes.ts';
import { createEmptyDoc, writePageDoc } from '../../server/storage.ts';
import type { Note, Panel } from '../../shared/types.ts';
import { AppError } from '../../server/errors.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempDataRoot(): string {
  const root = makeTempDir('notes');
  dirs.push(root);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

type NoteInput = Partial<Note> & Pick<Note, 'id' | 'text'>;

function makeNote(input: NoteInput): Note {
  return {
    scope: 'page',
    panelId: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...input,
  };
}

function writePage(
  dataRoot: string,
  volume: string,
  chapter: string,
  pageIndex: number,
  panels: Panel[],
  notes: Note[],
): void {
  const doc = createEmptyDoc(volume, chapter, pageIndex);
  doc.panels = panels;
  doc.notes = notes;
  writePageDoc(dataRoot, doc, { skipHistory: true });
}

const RIGHT: Panel = { id: 'right', rect: { x: 0.55, y: 0.05, w: 0.4, h: 0.4 } };
const LEFT: Panel = { id: 'left', rect: { x: 0.05, y: 0.05, w: 0.4, h: 0.4 } };
const BOTTOM: Panel = { id: 'bottom', rect: { x: 0.05, y: 0.55, w: 0.9, h: 0.4 } };

function seedIndexedLibrary(dataRoot: string): void {
  writePage(
    dataRoot,
    'Vol1',
    '1',
    0,
    [LEFT, RIGHT, BOTTOM],
    [
      makeNote({
        id: 'n-page',
        text: '**Bold** and `code` with [link](https://x.test)',
        tags: ['tag1', 'tag2'],
        source: { url: 'https://www.example.com/post', title: 'Example Post' },
      }),
      makeNote({
        id: 'n-right',
        scope: 'panel',
        panelId: 'right',
        text: 'Right panel',
        tags: ['tag1'],
        source: { text: 'LLM chat' },
      }),
      makeNote({
        id: 'n-left',
        scope: 'panel',
        panelId: 'left',
        text: 'Left panel',
        source: { url: 'not a url' },
      }),
      makeNote({
        id: 'n-ghost',
        scope: 'panel',
        panelId: 'ghost',
        text: 'Ghost panel',
        tags: ['tag3'],
        source: { text: 'abcdefghijklmnopqrstuvwxyz1234' },
      }),
    ],
  );
  writePage(dataRoot, 'Vol1', '1', 1, [], [makeNote({ id: 'n-p2', text: 'Second page', tags: ['tag2'] })]);
  writePage(dataRoot, 'Vol1', '10', 0, [], [makeNote({ id: 'n-ten', text: 'Chapter ten' })]);
  writePage(dataRoot, 'Vol2', '1', 0, [], [makeNote({ id: 'n-other', text: 'Other volume' })]);
}

describe('collectNotes', () => {
  it('indexes every page and aggregates chapters, tags, sources and pages', () => {
    const dataRoot = tempDataRoot();
    seedIndexedLibrary(dataRoot);

    const index = collectNotes(dataRoot);

    expect(index.total).toBe(7);
    expect(index.notes).toHaveLength(7);
    expect(index.pages).toBe(4);

    const chapters = index.chapters
      .map((c) => `${c.volume}/${c.chapter}:${c.count}`)
      .sort((a, b) => a.localeCompare(b, 'en'));
    expect(chapters).toEqual(['Vol1/1:5', 'Vol1/10:1', 'Vol2/1:1']);

    const tagCounts = Object.fromEntries(index.tags.map((t) => [t.tag, t.count]));
    expect(tagCounts).toEqual({ tag1: 2, tag2: 2, tag3: 1 });
    expect(index.tags[0].count).toBe(2);

    const sourceCounts = Object.fromEntries(index.sources.map((s) => [s.domain, s.count]));
    expect(sourceCounts).toEqual({
      'example.com': 1,
      'LLM chat': 1,
      'not a url': 1,
      abcdefghijklmnopqrstuvwx: 1,
    });
  });

  it('builds an excerpt and keeps note metadata', () => {
    const dataRoot = tempDataRoot();
    seedIndexedLibrary(dataRoot);

    const hit = collectNotes(dataRoot).notes.find((n) => n.id === 'n-page')!;
    expect(hit.excerpt).toBe('Bold and code with link');
    expect(hit.scope).toBe('page');
    expect(hit.panelId).toBeNull();
    expect(hit.panelNo).toBeNull();
    expect(hit.domain).toBe('example.com');
    expect(hit.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(hit.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('truncates long excerpts with an ellipsis', () => {
    const dataRoot = tempDataRoot();
    writePage(dataRoot, 'Vol1', '1', 0, [], [makeNote({ id: 'long', text: 'x'.repeat(200) })]);

    const excerpt = collectNotes(dataRoot).notes[0].excerpt;
    expect(excerpt).toHaveLength(141);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('numbers panel notes by reading order and leaves page or dangling notes unnumbered', () => {
    const dataRoot = tempDataRoot();
    seedIndexedLibrary(dataRoot);

    const byId = Object.fromEntries(collectNotes(dataRoot).notes.map((n) => [n.id, n]));
    expect(byId['n-right'].panelNo).toBe(1);
    expect(byId['n-left'].panelNo).toBe(2);
    expect(byId['n-ghost'].panelNo).toBeNull();
    expect(byId['n-ghost'].panelId).toBe('ghost');
    expect(byId['n-page'].panelNo).toBeNull();

    const chapterOne = collectNotes(dataRoot)
      .notes.filter((n) => n.volume === 'Vol1' && n.chapter === '1')
      .map((n) => n.id);
    expect(chapterOne).toEqual(['n-page', 'n-ghost', 'n-right', 'n-left', 'n-p2']);
  });

  it('sorts by volume, then numeric chapter, then page', () => {
    const dataRoot = tempDataRoot();
    writePage(dataRoot, 'Vol2', '1', 0, [], [makeNote({ id: 'other', text: 'Other' })]);
    writePage(dataRoot, 'Vol1', '10', 0, [], [makeNote({ id: 'ten', text: 'Ten' })]);
    writePage(dataRoot, 'Vol1', '1', 1, [], [makeNote({ id: 'two', text: 'Two' })]);
    writePage(dataRoot, 'Vol1', '1', 0, [], [makeNote({ id: 'one', text: 'One' })]);

    expect(collectNotes(dataRoot).notes.map((n) => n.text)).toEqual(['One', 'Two', 'Ten', 'Other']);
  });

  it('matches the free-text query against text, tags, title, url and source text', () => {
    const dataRoot = tempDataRoot();
    seedIndexedLibrary(dataRoot);

    const ids = (q: string) => [...new Set(collectNotes(dataRoot, { q }).notes.map((n) => n.id))].sort();
    expect(ids('bold')).toEqual(['n-page']);
    expect(ids('RIGHT PANEL')).toEqual(['n-right']);
    expect(ids('tag2')).toEqual(['n-p2', 'n-page']);
    expect(ids('example post')).toEqual(['n-page']);
    expect(ids('not a url')).toEqual(['n-left']);
    expect(collectNotes(dataRoot, { q: 'nothing-matches' })).toMatchObject({
      total: 0,
      notes: [],
      tags: [],
      sources: [],
    });
  });

  it('filters by tag, source domain, volume, chapter and page index', () => {
    const dataRoot = tempDataRoot();
    seedIndexedLibrary(dataRoot);

    expect(collectNotes(dataRoot, { tag: 'tag2' }).total).toBe(2);
    expect(collectNotes(dataRoot, { tag: 'missing' }).total).toBe(0);

    expect(collectNotes(dataRoot, { source: 'example.com' }).notes.map((n) => n.id)).toEqual(['n-page']);
    expect(collectNotes(dataRoot, { source: 'LLM chat' }).notes.map((n) => n.id)).toEqual(['n-right']);
    expect(collectNotes(dataRoot, { source: 'not a url' }).notes.map((n) => n.id)).toEqual(['n-left']);

    expect(collectNotes(dataRoot, { volume: 'Vol2' }).notes.map((n) => n.text)).toEqual(['Other volume']);
    expect(collectNotes(dataRoot, { chapter: '10' }).notes.map((n) => n.text)).toEqual(['Chapter ten']);
    expect(collectNotes(dataRoot, { pageIndex: 1 }).notes.map((n) => n.text)).toEqual(['Second page']);
    expect(collectNotes(dataRoot, { volume: 'Vol1', chapter: '1', pageIndex: 0 }).total).toBe(4);
  });

  it('slices with the limit but keeps the total and clamps small limits', () => {
    const dataRoot = tempDataRoot();
    seedIndexedLibrary(dataRoot);

    const limited = collectNotes(dataRoot, { limit: 2 });
    expect(limited.total).toBe(7);
    expect(limited.notes).toHaveLength(2);

    const zero = collectNotes(dataRoot, { limit: 0 });
    expect(zero.total).toBe(7);
    expect(zero.notes).toHaveLength(1);

    expect(collectNotes(dataRoot, { limit: 50_000 }).notes).toHaveLength(7);
  });

  it('returns an empty index when the pages directory does not exist', () => {
    const dataRoot = tempDataRoot();
    expect(collectNotes(dataRoot)).toEqual({
      total: 0,
      notes: [],
      chapters: [],
      tags: [],
      sources: [],
      pages: 0,
    });
  });

  it('throws on a corrupt page document instead of silently skipping it', () => {
    const dataRoot = tempDataRoot();
    writePage(dataRoot, 'Vol1', '1', 0, [], [makeNote({ id: 'n1', text: 'ok' })]);
    writeFile(path.join(dataRoot, 'pages', 'Vol1', '1', '0.json'), '{ not json');

    try {
      collectNotes(dataRoot);
      throw new Error('expected a corrupt page error');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ERR_PAGE_CORRUPT');
      expect((err as AppError).status).toBe(422);
    }
  });
});
