import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../server/errors.ts';
import { createProjectBuffer, importProject } from '../../server/project.ts';
import {
  clearProjectLink,
  createProjectSync,
  linkProject,
  readProjectLink,
  resolveProjectSavePath,
  writeBackProject,
  writeProjectCopy,
} from '../../server/projectWriteBack.ts';
import { createEmptyDoc, writePageDoc } from '../../server/storage.ts';
import { readZip } from '../../server/zip.ts';
import type { PageDoc } from '../../shared/types.ts';
import { solidPng } from '../helpers/fixtures.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

const PNG = solidPng(60, 90, 200);

function pageDoc(volume: string, chapter: string, note: string): PageDoc {
  const doc = createEmptyDoc(volume, chapter, 0);
  return {
    ...doc,
    panels: [{ id: 'p1', rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, source: 'auto' }],
    notes: [
      {
        id: 'n1',
        scope: 'page',
        panelId: null,
        text: note,
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

/** A working copy (data/ + raw/) plus a .mnproj exported from it, as the user would have. */
function seedWithProjectFile(storageMode: 'reference' | 'packaged' = 'packaged') {
  const root = tempDir('writeback-root');
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'), PNG);
  writePageDoc(path.join(root, 'data'), pageDoc('Vol1', '172', 'first'));

  const target = path.join(tempDir('writeback-target'), 'demo.mnproj');
  const { buffer, manifest } = createProjectBuffer({ rootDir: root, storageMode, name: 'demo' });
  fs.writeFileSync(target, buffer);
  linkProject(path.join(root, 'data'), {
    path: target,
    storageMode,
    name: manifest.name,
    createdAt: manifest.createdAt,
  });
  return { root, target };
}

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof AppError ? err.code : String(err);
  }
}

describe('project write-back', () => {
  it('writes an edited page back into the opened .mnproj', () => {
    const { root, target } = seedWithProjectFile('packaged');
    const dataRoot = path.join(root, 'data');

    writePageDoc(dataRoot, pageDoc('Vol1', '172', 'edited after opening'));
    const result = writeBackProject({ rootDir: root, dataRoot });

    expect(result.path).toBe(target);
    expect(fs.statSync(target).size).toBe(result.size);

    // Reopening the same file must show the edit, not the state it had when opened.
    const reopenRoot = tempDir('writeback-reopen');
    importProject({ rootDir: reopenRoot, buffer: fs.readFileSync(target), snapshot: false });
    const doc = JSON.parse(
      fs.readFileSync(path.join(reopenRoot, 'data', 'pages', 'Vol1', '172', '0.json'), 'utf8'),
    ) as PageDoc;
    expect(doc.notes[0].text).toBe('edited after opening');
  });

  it('keeps the manifest creation time and leaves a .bak of the previous file', () => {
    const { root, target } = seedWithProjectFile();
    const dataRoot = path.join(root, 'data');
    const before = readProjectLink(dataRoot);
    expect(before?.createdAt).toBeTruthy();

    writePageDoc(dataRoot, pageDoc('Vol1', '172', 'second'));
    const result = writeBackProject({ rootDir: root, dataRoot });

    expect(result.backup).toBe(`${target}.bak`);
    expect(fs.existsSync(`${target}.bak`)).toBe(true);
    expect(readProjectLink(dataRoot)?.createdAt).toBe(before?.createdAt);
    expect(readProjectLink(dataRoot)?.lastWriteAt).toBe(result.at);
    expect(readProjectLink(dataRoot)?.paused).toBeUndefined();
  });

  it('writes back reference-mode projects without touching the source images', () => {
    const { root, target } = seedWithProjectFile('reference');
    const dataRoot = path.join(root, 'data');

    writePageDoc(dataRoot, pageDoc('Vol1', '172', 'ref edit'));
    writeBackProject({ rootDir: root, dataRoot });

    const buffer = fs.readFileSync(target);
    const reopened = importProject({ rootDir: tempDir('writeback-ref'), buffer, snapshot: false });
    expect(reopened.storageMode).toBe('reference');
    expect(reopened.imagesWritten).toBe(0);
    expect(fs.existsSync(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'))).toBe(true);
  });

  it('refuses to write when nothing is linked', () => {
    const root = tempDir('writeback-unlinked');
    writePageDoc(path.join(root, 'data'), pageDoc('Vol1', '172', 'x'));
    expect(errorCode(() => writeBackProject({ rootDir: root, dataRoot: path.join(root, 'data') }))).toBe(
      'ERR_PROJECT_NOT_LINKED',
    );
  });

  it('fails safely when the project file was moved away, keeping the working copy', () => {
    const { root, target } = seedWithProjectFile();
    const dataRoot = path.join(root, 'data');
    fs.rmSync(target);

    writePageDoc(dataRoot, pageDoc('Vol1', '172', 'after delete'));
    expect(errorCode(() => writeBackProject({ rootDir: root, dataRoot }))).toBe('ERR_PROJECT_FILE_MISSING');
    expect(fs.existsSync(path.join(dataRoot, 'pages', 'Vol1', '172', '0.json'))).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('pauses automatic write-back after a failure until a manual save', () => {
    const { root, target } = seedWithProjectFile();
    const dataRoot = path.join(root, 'data');
    fs.rmSync(target);

    const sync = createProjectSync({ rootDir: root, dataRoot });
    expect(errorCode(() => sync.flush())).toBe('ERR_PROJECT_FILE_MISSING');
    expect(sync.status().paused).toBe(true);
    expect(sync.status().lastError).toBeTruthy();

    // The file comes back (restored by the user): a manual save resumes write-back.
    const rebuilt = createProjectBuffer({ rootDir: root, storageMode: 'packaged', name: 'demo' });
    fs.writeFileSync(target, rebuilt.buffer);
    expect(sync.flush()?.path).toBe(target);
    expect(sync.status().paused).toBe(false);
    expect(sync.status().lastError).toBeUndefined();
  });

  it('forgets the link when another project is imported or unlinked', () => {
    const { root, target } = seedWithProjectFile();
    const dataRoot = path.join(root, 'data');
    expect(readProjectLink(dataRoot)?.path).toBe(target);

    expect(clearProjectLink(dataRoot)).toBe(true);
    expect(readProjectLink(dataRoot)).toBeNull();
    expect(fs.existsSync(target)).toBe(true);
  });

  it('writes back every page the app is showing, not just the edited one', () => {
    const { root, target } = seedWithProjectFile();
    const dataRoot = path.join(root, 'data');
    writePageDoc(dataRoot, pageDoc('Vol2', '01', 'new volume'));
    writeBackProject({ rootDir: root, dataRoot });

    const names = readZip(fs.readFileSync(target)).map((entry) => entry.name);
    expect(names).toContain('pages/Vol1/172/0.json');
    expect(names).toContain('pages/Vol2/01/0.json');
  });

  it('saves a copy elsewhere without touching or relinking the opened file', () => {
    const { root, target } = seedWithProjectFile();
    const dataRoot = path.join(root, 'data');
    const before = fs.statSync(target).mtimeMs;

    const dest = path.join(tempDir('writeback-copy'), 'copy.mnproj');
    const packed = createProjectBuffer({ rootDir: root, storageMode: 'packaged', name: 'copy' });
    const result = writeProjectCopy(dest, packed.buffer);

    expect(result.path).toBe(dest);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(target).mtimeMs).toBe(before);
    expect(readProjectLink(dataRoot)?.path).toBe(target);
  });

  it('refuses to save as over the opened project file', () => {
    const { root, target } = seedWithProjectFile();
    const dataRoot = path.join(root, 'data');
    expect(errorCode(() => resolveProjectSavePath(target, dataRoot))).toBe('ERR_PROJECT_SAVE_AS_LINKED');

    const dest = path.join(tempDir('writeback-copy2'), 'copy.mnproj');
    expect(resolveProjectSavePath(dest, dataRoot)).toBe(dest);
  });
});
