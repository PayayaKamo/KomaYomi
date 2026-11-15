import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, checkSchemaVersion, prepareExchange, preserveUnknown } from '../../shared/format.ts';
import { migrateManifestV0, migratePageV0 } from '../../shared/migrations.ts';
import { pageFilePath, readPageDoc, writePageDoc } from '../../server/storage.ts';
import type { PageDoc } from '../../shared/types.ts';
import { AppError } from '../../server/errors.ts';
import { makeTempDir, removeDir } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempDataRoot(): string {
  const root = makeTempDir('formats');
  dirs.push(root);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function legacyPage(): Record<string, unknown> {
  return {
    // v0 spelling: no `schemaVersion`, no envelope.
    version: 1,
    volume: 'v1',
    chapter: 'c1',
    pageIndex: 0,
    panels: [{ id: 'p1', rect: { x: 0, y: 0, w: 1, h: 1 }, source: 'auto' }],
    notes: [],
    offsets: {},
    panelOffsets: {},
    alignMode: 'page',
    readingDirection: 'rtl',
    updatedAt: '2025-01-01T00:00:00.000Z',
    // Unknown field written by a future build.
    experimentFlag: { enabled: true },
  };
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.code : 'not-an-app-error';
  }
  return 'no-error';
}

describe('schema versioning', () => {
  it('migrates a v0 page to the current schema and drops the legacy version field', () => {
    const prepared = prepareExchange('page', legacyPage());
    expect(prepared.migratedFrom).toBe(0);
    expect(prepared.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION.page);
    expect('version' in prepared.value).toBe(false);
    expect(prepared.value.kind).toBe('page');
    expect(prepared.value.experimentFlag).toEqual({ enabled: true });
  });

  it('is idempotent for already-versioned input', () => {
    const prepared = prepareExchange('page', { ...legacyPage(), schemaVersion: 1 });
    expect(prepared.migratedFrom).toBeUndefined();
    expect(prepared.value.schemaVersion).toBe(1);
  });

  it('keeps unknown fields on a read/write round trip, including panel extras', () => {
    const previous = {
      panels: [{ id: 'p1', rect: { x: 0, y: 0, w: 1, h: 1 }, futurePanelField: 'keep-me' }],
      futureTopLevel: 42,
    };
    const next = { panels: [{ id: 'p1', rect: { x: 0, y: 0, w: 1, h: 1 } }] };
    const merged = preserveUnknown(previous, next) as Record<string, unknown> & { panels: Record<string, unknown>[] };
    expect(merged.futureTopLevel).toBe(42);
    expect(merged.panels[0].futurePanelField).toBe('keep-me');
  });

  it('folds legacy manifest keys into inventory and keeps unknown fields', () => {
    const migrated = migrateManifestV0({
      schemaVersion: 0,
      images: 3,
      langDirs: { v1: { ja: 'raw/v1/ja', zh: 'raw/v1/zh' } },
      pageCount: 3,
      futureField: 'survives',
    });
    expect(migrated.schemaVersion).toBe(1);
    expect('images' in migrated).toBe(false);
    expect('langDirs' in migrated).toBe(false);
    expect('pageCount' in migrated).toBe(false);
    expect(migrated.futureField).toBe('survives');
    expect(migrated.inventory).toBeTruthy();
  });

  it('rejects files from a newer schema instead of silently downgrading', () => {
    expect(() => checkSchemaVersion('page', CURRENT_SCHEMA_VERSION.page + 1)).toThrow();
    expect(() => prepareExchange('page', { ...legacyPage(), schemaVersion: 99 })).toThrow();
  });

  it('adds an envelope to a v0 export template', () => {
    const prepared = prepareExchange('mnexp', {
      id: 'e1',
      name: 'x',
      createdAt: '2025-01-01T00:00:00.000Z',
      config: {},
    });
    expect(prepared.value.schemaVersion).toBe(1);
    expect(prepared.value.kind).toBe('mnexp');
  });

  it('keeps the pre-migration bytes and writes unknown fields back', () => {
    const dataRoot = tempDataRoot();
    const file = pageFilePath(dataRoot, 'v1', 'c1', 0);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(legacyPage(), null, 2), 'utf8');

    const doc = readPageDoc(dataRoot, 'v1', 'c1', 0);
    expect(doc).toBeTruthy();
    expect(doc!.schemaVersion).toBe(1);
    expect((doc as unknown as Record<string, unknown>).experimentFlag).toEqual({ enabled: true });
    expect(fs.existsSync(`${file}.v0.bak`)).toBe(true);

    const saved = writePageDoc(dataRoot, { ...(doc as PageDoc), readingDirection: 'ltr' });
    expect(saved.readingDirection).toBe('ltr');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.experimentFlag).toEqual({ enabled: true });
    expect('version' in onDisk).toBe(false);
  });

  it('opens a file from a future build read-only and refuses writes with 409', () => {
    const dataRoot = tempDataRoot();
    const file = pageFilePath(dataRoot, 'v2', 'c1', 0);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ ...legacyPage(), volume: 'v2', schemaVersion: 99, futureOnly: true }, null, 2),
      'utf8',
    );

    const doc = readPageDoc(dataRoot, 'v2', 'c1', 0);
    expect(doc).toBeTruthy();
    expect((doc as unknown as Record<string, unknown>).futureOnly).toBe(true);

    expect(errorCode(() => writePageDoc(dataRoot, doc as PageDoc))).toBe('ERR_SCHEMA_TOO_NEW');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(onDisk.schemaVersion).toBe(99);
  });

  it('keeps unknown nested fields when migrating a v0 page', () => {
    const migrated = migratePageV0({ ...legacyPage(), nested: { a: 1 } });
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.nested).toEqual({ a: 1 });
  });
});
