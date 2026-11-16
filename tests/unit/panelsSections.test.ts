import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokenStorage, MemoryStorage, installStorage, uninstallStorage } from '../helpers/memoryStorage.ts';

const KEY = 'komayomi.panels-sections';
const MODULE = '../../src/lib/panelsSections.ts';

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

describe('panel section folds', () => {
  it('starts with low-frequency sections folded and notes/groups open', async () => {
    const mod = await load();
    expect(mod.getPanelSections()).toEqual({
      grid: false,
      template: false,
      path: false,
      ann: true,
      groups: true,
    });
  });

  it('restores persisted booleans and fills the rest with defaults', async () => {
    store.setItem(KEY, JSON.stringify({ grid: true, ann: false }));
    const mod = await load();
    expect(mod.getPanelSections()).toEqual({
      grid: true,
      template: false,
      path: false,
      ann: false,
      groups: true,
    });
  });

  it('ignores corrupt JSON and non-boolean values', async () => {
    store.setItem(KEY, '{not json');
    let mod = await load();
    expect(mod.getPanelSections().grid).toBe(false);

    vi.resetModules();
    store.setItem(KEY, JSON.stringify({ grid: 'yes', ann: 0, groups: true }));
    mod = await load();
    expect(mod.getPanelSections()).toEqual({
      grid: false,
      template: false,
      path: false,
      ann: true,
      groups: true,
    });
  });

  it('persists a section change without mutating previous snapshots', async () => {
    const mod = await load();
    const before = mod.getPanelSections();

    mod.setPanelSection('grid', true);

    expect(before.grid).toBe(false);
    expect(mod.getPanelSections().grid).toBe(true);
    expect(JSON.parse(store.getItem(KEY)!)).toEqual({
      grid: true,
      template: false,
      path: false,
      ann: true,
      groups: true,
    });
  });

  it('toggles sections and ignores unknown ids', async () => {
    const mod = await load();

    mod.togglePanelSection('path');
    expect(mod.getPanelSections().path).toBe(true);

    store.clear();
    mod.setPanelSection('bogus' as never, true);
    mod.togglePanelSection('bogus' as never);
    expect(mod.getPanelSections().path).toBe(true);
    expect(store.getItem(KEY)).toBeNull();
  });

  it('keeps the in-memory state when storage throws', async () => {
    installStorage('localStorage', new BrokenStorage());
    const mod = await load();

    expect(() => mod.setPanelSection('grid', true)).not.toThrow();
    expect(mod.getPanelSections().grid).toBe(true);
  });
});
