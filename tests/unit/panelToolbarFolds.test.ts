import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, installStorage, uninstallStorage } from '../helpers/memoryStorage.ts';

const KEY = 'komayomi.panel-toolbar-folds';
const MODULE = '../../src/lib/panelToolbarFolds.ts';

let session: MemoryStorage;
let local: MemoryStorage;
let win: { innerWidth: number };

beforeEach(() => {
  vi.resetModules();
  session = new MemoryStorage();
  local = new MemoryStorage();
  win = { innerWidth: 1440 };
  installStorage('sessionStorage', session);
  installStorage('localStorage', local);
  (globalThis as unknown as { window?: unknown }).window = win;
});

afterEach(() => {
  uninstallStorage('sessionStorage');
  uninstallStorage('localStorage');
  delete (globalThis as unknown as { window?: unknown }).window;
});

async function load() {
  return import(MODULE);
}

function snapshot(mod: Awaited<ReturnType<typeof load>>): Record<string, boolean> {
  return {
    split: mod.isToolbarFoldOpen('split'),
    save: mod.isToolbarFoldOpen('save'),
    view: mod.isToolbarFoldOpen('view'),
  };
}

describe('panel toolbar folds', () => {
  it('keeps all groups open on a desktop viewport', async () => {
    const mod = await load();
    expect(snapshot(mod)).toEqual({ split: true, save: true, view: true });
  });

  it('folds the secondary view group on narrow screens', async () => {
    win.innerWidth = 800;
    const mod = await load();
    expect(snapshot(mod)).toEqual({ split: true, save: true, view: false });
  });

  it('restores persisted folds on top of the viewport defaults', async () => {
    win.innerWidth = 800;
    session.setItem(KEY, JSON.stringify({ view: true, split: false }));
    const mod = await load();
    expect(snapshot(mod)).toEqual({ split: false, save: true, view: true });
  });

  it('persists toggles in sessionStorage only', async () => {
    const mod = await load();

    mod.toggleToolbarFold('save');

    expect(mod.isToolbarFoldOpen('save')).toBe(false);
    expect(JSON.parse(session.getItem(KEY)!)).toEqual({ split: true, save: false, view: true });
    expect(local.length).toBe(0);
  });

  it('treats unknown group ids as open and ignores toggles for them', async () => {
    const mod = await load();

    expect(mod.isToolbarFoldOpen('bogus' as never)).toBe(true);
    expect(() => mod.toggleToolbarFold('bogus' as never)).not.toThrow();
    expect(session.getItem(KEY)).toBeNull();
  });

  it('ignores corrupt stored state', async () => {
    session.setItem(KEY, 'nope');
    const mod = await load();
    expect(snapshot(mod)).toEqual({ split: true, save: true, view: true });
  });
});
