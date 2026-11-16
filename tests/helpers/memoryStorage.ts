/**
 * Storage doubles for tests that run in the node environment: several `src/lib` stores
 * read `localStorage` / `sessionStorage` at import time, so tests install one of these
 * before importing the module under test.
 */

/** Minimal in-memory `Storage`, enough for the preference stores. */
export class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    const value = this.data.get(key);
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

/** Mimics a hardened browser context where every storage access throws. */
export class BrokenStorage implements Storage {
  get length(): number {
    return 0;
  }

  clear(): void {
    throw new Error('storage blocked');
  }

  getItem(): string | null {
    throw new Error('storage blocked');
  }

  key(): string | null {
    throw new Error('storage blocked');
  }

  removeItem(): void {
    throw new Error('storage blocked');
  }

  setItem(): void {
    throw new Error('storage blocked');
  }
}

type StorageName = 'localStorage' | 'sessionStorage';

/** Assigns a browser-style global that node does not provide. */
export function installStorage(name: StorageName, storage: Storage): void {
  (globalThis as unknown as Record<StorageName, Storage>)[name] = storage;
}

export function uninstallStorage(name: StorageName): void {
  delete (globalThis as unknown as Record<StorageName, Storage | undefined>)[name];
}
