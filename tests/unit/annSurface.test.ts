import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokenStorage, MemoryStorage, installStorage, uninstallStorage } from '../helpers/memoryStorage.ts';

const KEY = 'komayomi.ann-surface';
const MODULE = '../../src/lib/annotationSurface.ts';

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

describe('annotation surface preference', () => {
  it('defaults to the reading view when nothing is stored', async () => {
    const mod = await load();
    expect(mod.getAnnSurface()).toBe('read');
  });

  it('restores a persisted choice', async () => {
    store.setItem(KEY, 'both');
    const mod = await load();
    expect(mod.getAnnSurface()).toBe('both');
  });

  it('ignores an unknown stored value', async () => {
    store.setItem(KEY, 'sideways');
    const mod = await load();
    expect(mod.getAnnSurface()).toBe('read');
  });

  it('persists updates and skips invalid or repeated writes', async () => {
    const mod = await load();

    mod.setAnnSurface('panels');
    expect(mod.getAnnSurface()).toBe('panels');
    expect(store.getItem(KEY)).toBe('panels');

    // Rewriting the same value is a no-op, so a stale storage value survives.
    store.setItem(KEY, 'read');
    mod.setAnnSurface('panels');
    expect(store.getItem(KEY)).toBe('read');

    mod.setAnnSurface('sideways' as never);
    expect(mod.getAnnSurface()).toBe('panels');
  });

  it('keeps working when storage throws (hardened contexts)', async () => {
    installStorage('localStorage', new BrokenStorage());
    const mod = await load();

    expect(mod.getAnnSurface()).toBe('read');
    expect(() => mod.setAnnSurface('both')).not.toThrow();
    expect(mod.getAnnSurface()).toBe('both');
  });
});
