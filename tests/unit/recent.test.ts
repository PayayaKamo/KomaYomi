import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokenStorage, MemoryStorage, installStorage, uninstallStorage } from '../helpers/memoryStorage.ts';

const KEY = 'komayomi.recent-pages';
const MODULE = '../../src/lib/recent.ts';

let store: MemoryStorage;

beforeEach(() => {
  vi.resetModules();
  store = new MemoryStorage();
  installStorage('localStorage', store);
});

afterEach(() => {
  uninstallStorage('localStorage');
});

async function load() {
  return import(MODULE);
}

function entry(volume: string, chapter: string, pageIndex = 0) {
  return { volume, chapter, pageIndex, at: '2026-01-01T00:00:00.000Z' };
}

describe('recent pages', () => {
  it('returns an empty list when nothing is stored', async () => {
    const mod = await load();
    expect(mod.readRecent()).toEqual([]);
  });

  it('filters malformed entries and caps the list at 50', async () => {
    const stored = [
      entry('Vol1', '1'),
      { volume: 'Vol1', chapter: 2, pageIndex: 0, at: 'x' },
      null,
      ...Array.from({ length: 60 }, (_, i) => entry(`Vol${i + 2}`, '1')),
    ];
    store.setItem(KEY, JSON.stringify(stored));

    const mod = await load();
    const list = mod.readRecent();
    expect(list).toHaveLength(50);
    expect(list[0]).toEqual(entry('Vol1', '1'));
    expect(list.every((item) => typeof item.chapter === 'string')).toBe(true);
  });

  it('treats corrupt JSON as an empty history', async () => {
    store.setItem(KEY, '{oops');
    const mod = await load();
    expect(mod.readRecent()).toEqual([]);
  });

  it('prepends visits and keeps one row per volume/chapter', async () => {
    store.setItem(KEY, JSON.stringify([entry('Vol1', '1', 3), entry('Vol2', '4', 0)]));

    const mod = await load();
    const next = mod.pushRecent({ volume: 'Vol1', chapter: '1', pageIndex: 7 });

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ volume: 'Vol1', chapter: '1', pageIndex: 7 });
    expect(next[1]).toEqual(entry('Vol2', '4', 0));
    expect(Number.isNaN(Date.parse(next[0].at))).toBe(false);
    expect(JSON.parse(store.getItem(KEY)!)).toEqual(next);
  });

  it('caps pushed history at 50 entries', async () => {
    store.setItem(KEY, JSON.stringify(Array.from({ length: 50 }, (_, i) => entry(`Vol${i}`, '1'))));

    const mod = await load();
    const next = mod.pushRecent({ volume: 'New', chapter: '1', pageIndex: 0 });

    expect(next).toHaveLength(50);
    expect(next[0].volume).toBe('New');
    expect(next.some((item) => item.volume === 'Vol49')).toBe(false);
  });

  it('removes only the matching volume/chapter and clears on request', async () => {
    store.setItem(KEY, JSON.stringify([entry('Vol1', '1'), entry('Vol1', '2'), entry('Vol2', '1')]));

    const mod = await load();
    expect(mod.removeRecent('Vol1', '1').map((item) => `${item.volume}/${item.chapter}`)).toEqual(['Vol1/2', 'Vol2/1']);
    expect(mod.clearRecent()).toEqual([]);
    expect(store.getItem(KEY)).toBe('[]');
  });

  it('degrades to an in-memory list when storage throws', async () => {
    installStorage('localStorage', new BrokenStorage());
    const mod = await load();

    expect(mod.readRecent()).toEqual([]);
    expect(() => mod.pushRecent({ volume: 'Vol1', chapter: '1', pageIndex: 0 })).not.toThrow();
    expect(mod.readRecent()).toEqual([]);
  });
});
