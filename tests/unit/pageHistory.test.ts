import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_MERGE_MS,
  diffDocs,
  listVersions,
  readHistory,
  readHistoryLimit,
  recordVersion,
} from '../../server/pageHistory.ts';
import { readPageDoc, writePageDoc } from '../../server/storage.ts';
import { readLibraryConfig, writeLibraryConfig } from '../../server/library.ts';
import { makeTempDir, removeDir } from '../helpers/tmp.ts';
import type { PageDoc } from '../../shared/types.ts';

const dirs: string[] = [];

function tempDataRoot(): string {
  const root = makeTempDir('history');
  dirs.push(root);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

function page(panels: { id: string; rect: ReturnType<typeof rect> }[], extra: Partial<PageDoc> = {}): PageDoc {
  return {
    volume: 'v1',
    chapter: 'c1',
    pageIndex: 0,
    panels: panels.map((panel) => ({ ...panel, source: 'manual' as const })),
    notes: [],
    offsets: {},
    panelOffsets: {},
    alignMode: 'page',
    readingDirection: 'rtl',
    annotations: [],
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...extra,
  } as PageDoc;
}

describe('page history diff', () => {
  it('counts added, removed, moved, resized panels and annotation changes', () => {
    const before = page(
      [
        { id: 'a', rect: rect(0, 0, 0.5, 0.5) },
        { id: 'b', rect: rect(0.5, 0, 0.5, 0.5) },
        { id: 'c', rect: rect(0, 0.5, 0.5, 0.5) },
      ],
      { annotations: [{ id: 'n1' } as never] },
    );
    const after = page(
      [
        // moved
        { id: 'a', rect: rect(0.02, 0, 0.5, 0.5) },
        // resized
        { id: 'b', rect: rect(0.5, 0, 0.4, 0.5) },
        // c removed, d added
        { id: 'd', rect: rect(0, 0.5, 1, 0.5) },
      ],
      { annotations: [{ id: 'n1' } as never, { id: 'n2' } as never] },
    );
    const diff = diffDocs(before, after);
    expect(diff.panels).toBe(3);
    expect(diff.panelsDelta).toBe(0);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.moved).toBe(1);
    expect(diff.resized).toBe(1);
    expect(diff.annotations).toBe(2);
    expect(diff.annotationsDelta).toBe(1);
  });
});

describe('page history storage', () => {
  it('records a version on every page write with its source', () => {
    const root = tempDataRoot();
    writePageDoc(root, page([{ id: 'a', rect: rect(0, 0, 1, 1) }]), { source: 'manual' });
    writePageDoc(
      root,
      page([
        { id: 'a', rect: rect(0, 0, 1, 1) },
        { id: 'b', rect: rect(0.5, 0, 0.5, 0.5) },
      ]),
      { source: 'annotation' },
    );

    const entries = readHistory(root, 'v1', 'c1', 0);
    expect(entries).toHaveLength(2);
    expect(entries[0].source).toBe('manual');
    expect(entries[1].source).toBe('annotation');
    expect(entries[1].diff.added).toBe(1);
    expect(entries[1].diff.panels).toBe(2);
  });

  it('returns newest first without leaking full documents', () => {
    const root = tempDataRoot();
    writePageDoc(root, page([{ id: 'a', rect: rect(0, 0, 1, 1) }]), { source: 'manual' });
    writePageDoc(
      root,
      page([
        { id: 'a', rect: rect(0, 0, 1, 1) },
        { id: 'b', rect: rect(0, 0, 1, 1) },
      ]),
      { source: 'manual' },
    );

    const listed = listVersions(root, 'v1', 'c1', 0);
    expect(listed.entries).toHaveLength(2);
    expect(listed.entries[0].panels).toHaveLength(2);
    expect(listed.entries[0]).not.toHaveProperty('doc');
    expect(listed.entries[1].panels).toHaveLength(1);
  });

  it('prunes older versions down to the configured limit', () => {
    const root = tempDataRoot();
    const cfg = readLibraryConfig(root);
    writeLibraryConfig(root, { ...cfg, historyLimit: 5 });
    expect(readHistoryLimit(root)).toBe(5);

    for (let i = 0; i < 7; i++) {
      const panels = Array.from({ length: i + 1 }, (_, index) => ({
        id: `p${index}`,
        rect: rect(0, 0, 0.1, 0.1),
      }));
      recordVersion(root, page(panels), null, {
        source: 'manual',
        at: new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString(),
      });
    }

    const entries = readHistory(root, 'v1', 'c1', 0);
    expect(entries).toHaveLength(5);
    // The five newest survive; the oldest kept version has six panels.
    expect(entries[0].doc.panels).toHaveLength(3);
    expect(entries[4].doc.panels).toHaveLength(7);
  });

  it('merges consecutive auto-saves inside the coalesce window', () => {
    const root = tempDataRoot();
    const at = (seconds: number) => new Date(Date.UTC(2025, 0, 1, 0, 0, seconds)).toISOString();

    recordVersion(root, page([{ id: 'a', rect: rect(0, 0, 1, 1) }]), null, { source: 'auto', at: at(0) });
    recordVersion(
      root,
      page([
        { id: 'a', rect: rect(0, 0, 1, 1) },
        { id: 'b', rect: rect(0.5, 0.5, 0.5, 0.5) },
      ]),
      null,
      { source: 'auto', at: at(10) },
    );

    let entries = readHistory(root, 'v1', 'c1', 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].doc.panels).toHaveLength(2);
    // Diff is still measured against the state before the burst.
    expect(entries[0].diff.added).toBe(2);

    recordVersion(
      root,
      page([
        { id: 'a', rect: rect(0, 0, 1, 1) },
        { id: 'b', rect: rect(0.5, 0.5, 0.5, 0.5) },
        { id: 'c', rect: rect(0, 0.5, 0.5, 0.5) },
      ]),
      null,
      { source: 'auto', at: at(AUTO_MERGE_MS / 1000 + 30) },
    );

    entries = readHistory(root, 'v1', 'c1', 0);
    expect(entries).toHaveLength(2);
    expect(entries[1].doc.panels).toHaveLength(3);
  });

  it('keeps the pre-restore state as a version and allows undoing by id', () => {
    const root = tempDataRoot();
    writePageDoc(root, page([{ id: 'a', rect: rect(0, 0, 1, 1) }]), { source: 'manual' });
    const before = readPageDoc(root, 'v1', 'c1', 0)!;

    writePageDoc(
      root,
      page([
        { id: 'a', rect: rect(0, 0, 1, 1) },
        { id: 'b', rect: rect(0.5, 0.5, 0.5, 0.5) },
      ]),
      { source: 'manual' },
    );

    const snapshot = recordVersion(root, before, before, { source: 'restore', summary: 'state before restore' })!;
    expect(snapshot.id).toBeTruthy();

    // Restoring that snapshot writes the old layout and records the restore itself.
    const restored = writePageDoc(root, before, { source: 'restore' });
    expect(restored.panels).toHaveLength(1);

    const entries = readHistory(root, 'v1', 'c1', 0);
    expect(entries.map((entry) => entry.source)).toEqual(['manual', 'manual', 'restore', 'restore']);
    expect(entries[entries.length - 1].doc.panels).toHaveLength(1);
    expect(entries.some((entry) => entry.id === snapshot.id)).toBe(true);
  });
});
