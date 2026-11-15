import { beforeEach, describe, expect, it } from 'vitest';
import {
  OUTBOX_SCHEMA_VERSION,
  clearOutbox,
  dropOutbox,
  enqueueOutbox,
  listOutbox,
  outboxKeyOf,
  pendingOutboxCount,
} from '../../src/lib/outbox';
import type { PageDoc } from '../../src/types';

const STORAGE_KEY = 'manga-memo.outbox.v2';
const LEGACY_STORAGE_KEY = 'manga-memo.outbox.v1';

/** Minimal localStorage stand-in: Node has none, and the quota test needs a size limit. */
class MemoryStorage {
  private data = new Map<string, string>();
  limit = Number.POSITIVE_INFINITY;

  get length(): number {
    return this.data.size;
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (value.length > this.limit) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  clear(): void {
    this.data.clear();
  }
}

let store: MemoryStorage;

function pageDoc(volume: string, chapter: string, pageIndex: number, text: string): PageDoc {
  return {
    volume,
    chapter,
    pageIndex,
    readingDirection: 'rtl',
    panels: [],
    annotations: [],
    notes: [{ id: `n-${pageIndex}`, scope: 'page', text, tags: [], createdAt: '', updatedAt: '' }],
  } as unknown as PageDoc;
}

beforeEach(() => {
  store = new MemoryStorage();
  // The queue is browser-only, so emulate the two globals it reads.
  const globals = globalThis as { localStorage?: Storage; window?: unknown };
  globals.localStorage = store as unknown as Storage;
  globals.window = globalThis;
  clearOutbox();
});

describe('enqueueOutbox', () => {
  it('merges repeated writes for the same page (last write wins)', () => {
    const doc = pageDoc('V', 'C', 0, 'first');
    enqueueOutbox({ kind: 'page', doc, source: 'auto' });
    enqueueOutbox({ kind: 'page', doc: pageDoc('V', 'C', 0, 'second'), source: 'manual' });

    const entries = listOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('page');
    if (entries[0].kind !== 'page') throw new Error('unreachable');
    expect(entries[0].doc.notes[0].text).toBe('second');
    expect(entries[0].source).toBe('manual');
    expect(entries[0].attempts).toBe(2);
  });

  it('keys the same page identically across sources', () => {
    expect(outboxKeyOf(pageDoc('V', 'C', 7, 'x'))).toBe('page|V|C|7');
  });

  it('keeps different operation kinds side by side', () => {
    enqueueOutbox({ kind: 'page', doc: pageDoc('V', 'C', 0, 'a'), source: 'auto' });
    enqueueOutbox({ kind: 'volumeDirs', volume: 'V', dirs: { ja: '日本語' } });
    enqueueOutbox({ kind: 'langOrder', order: ['ja', 'zh'] });
    enqueueOutbox({
      kind: 'panelTemplate',
      input: { name: 'grid', volume: 'V', chapter: 'C', panels: [], readingDirection: 'rtl' },
    });
    enqueueOutbox({ kind: 'alignPreset', preset: { name: 'shift', volume: 'V', chapter: 'C', mode: 'offset' } });

    expect(pendingOutboxCount()).toBe(5);
    expect(listOutbox().map((entry) => entry.kind)).toEqual([
      'page',
      'volumeDirs',
      'langOrder',
      'panelTemplate',
      'alignPreset',
    ]);
  });

  it('merges template and preset saves that share a name', () => {
    enqueueOutbox({
      kind: 'panelTemplate',
      input: { name: 'grid', volume: 'V', chapter: 'C', panels: [], readingDirection: 'rtl' },
    });
    enqueueOutbox({
      kind: 'panelTemplate',
      input: { name: 'grid', volume: 'V', chapter: 'C', panels: [], readingDirection: 'ltr' },
    });
    enqueueOutbox({ kind: 'alignPreset', preset: { name: 'shift', volume: 'V', chapter: 'C' } });
    enqueueOutbox({ kind: 'alignPreset', preset: { name: 'shift', volume: 'V', chapter: 'C', mode: 'grid' } });

    const entries = listOutbox();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'panelTemplate', input: { readingDirection: 'ltr' } });
    expect(entries[1]).toMatchObject({ kind: 'alignPreset', preset: { mode: 'grid' } });
  });

  it('writes a versioned envelope and caps the queue at 100 entries', () => {
    for (let index = 0; index < 105; index += 1) {
      enqueueOutbox({ kind: 'page', doc: pageDoc('V', 'C', index, `p${index}`), source: 'auto' });
    }
    expect(pendingOutboxCount()).toBe(100);

    const stored = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}') as { schemaVersion: number; entries: unknown[] };
    expect(stored.schemaVersion).toBe(OUTBOX_SCHEMA_VERSION);
    const keys = listOutbox().map((entry) => entry.key);
    expect(keys).toContain('page|V|C|104');
    expect(keys).not.toContain('page|V|C|4');
  });

  it('strips note screenshots when storage is full so the text survives', () => {
    const doc = pageDoc('V', 'C', 0, 'keep me');
    doc.notes[0].images = [
      { id: 'img', name: 'shot.png', dataUrl: `data:image/png;base64,${'A'.repeat(4000)}`, createdAt: '' },
    ];
    store.limit = 1500;

    expect(enqueueOutbox({ kind: 'page', doc, source: 'auto' })).toBe(true);
    const [entry] = listOutbox();
    if (entry.kind !== 'page') throw new Error('unreachable');
    expect(entry.doc.notes[0].text).toBe('keep me');
    expect(entry.doc.notes[0].images).toBeUndefined();
  });
});

describe('dropOutbox', () => {
  it('drops the replayed revision only', () => {
    enqueueOutbox({ kind: 'page', doc: pageDoc('V', 'C', 0, 'old'), source: 'auto' });
    const [replayed] = listOutbox();

    enqueueOutbox({ kind: 'page', doc: pageDoc('V', 'C', 0, 'new'), source: 'auto' });
    dropOutbox(replayed.key, replayed.at);

    const entries = listOutbox();
    expect(entries).toHaveLength(1);
    if (entries[0].kind !== 'page') throw new Error('unreachable');
    expect(entries[0].doc.notes[0].text).toBe('new');
  });

  it('removes every revision when no timestamp is given', () => {
    enqueueOutbox({ kind: 'langOrder', order: ['ja'] });
    dropOutbox('langOrder');
    expect(pendingOutboxCount()).toBe(0);
  });
});

describe('legacy queue', () => {
  it('migrates v1 page entries into the current shape', () => {
    const doc = pageDoc('V', 'C', 2, 'offline');
    store.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify([{ key: 'V|C|2', doc, source: 'auto', at: '2026-11-01T00:00:00.000Z', attempts: 3 }]),
    );

    const entries = listOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'page', key: 'page|V|C|2', attempts: 3 });
    expect(store.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(store.getItem(STORAGE_KEY)).toContain('"schemaVersion":2');
  });
});
