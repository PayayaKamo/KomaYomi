import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeBuiltInDemo, demoStatus, openBuiltInDemo } from '../../server/demoProject.ts';
import { createProjectBuffer } from '../../server/project.ts';
import { readAppMeta } from '../../server/appMeta.ts';
import { createEmptyDoc, writePageDoc } from '../../server/storage.ts';
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

function makeDemoSource(): string {
  const src = tempDir('demo-src');
  writeFile(path.join(src, 'raw', 'Vol1', 'ja', '172', '01.png'), solidPng(60, 90, 200));
  writePageDoc(path.join(src, 'data'), createEmptyDoc('Vol1', '172', 0));
  const { buffer } = createProjectBuffer({ rootDir: src, storageMode: 'packaged', name: 'Demo' });
  const file = path.join(tempDir('demo-file'), 'demo-project.mnproj');
  writeFile(file, buffer);
  return file;
}

describe('built-in demo with split roots (Docker / standalone)', () => {
  it('unpacks into the mounted dirs and close removes exactly what it added', () => {
    const source = makeDemoSource();
    const work = tempDir('demo-cwd');
    const dataRoot = tempDir('demo-data');
    const rawRoot = tempDir('demo-raw');
    // A pre-existing config must survive open + close.
    writeFile(path.join(dataRoot, 'library.json'), JSON.stringify({ volumes: {}, languages: ['ja'] }));

    const { library, status } = openBuiltInDemo({ rootDir: work, dataRoot, rawRoot, source });
    expect(status.active).toBe(true);
    expect(library.volumes.map((vol) => vol.id)).toEqual(['Vol1']);
    expect(fs.existsSync(path.join(rawRoot, 'Vol1', 'ja', '172', '01.png'))).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'pages', 'Vol1', '172', '0.json'))).toBe(true);
    // The demo copy lives in the data dir, not in the shipped resources.
    expect(status.copy?.startsWith(dataRoot)).toBe(true);
    // Nothing leaks into the process working directory.
    expect(fs.readdirSync(work)).toEqual([]);

    const closed = closeBuiltInDemo({ rootDir: work, dataRoot, rawRoot });
    expect(closed.closed).toBe(true);
    expect(closed.library.volumes).toEqual([]);
    expect(fs.existsSync(path.join(rawRoot, 'Vol1'))).toBe(false);
    expect(fs.existsSync(path.join(dataRoot, 'pages', 'Vol1'))).toBe(false);
    // The user's own config is restored, and the demo flag is cleared.
    expect(JSON.parse(fs.readFileSync(path.join(dataRoot, 'library.json'), 'utf8'))).toMatchObject({
      volumes: {},
      languages: ['ja'],
    });
    expect(demoStatus(dataRoot).active).toBe(false);
  });
});

describe('readAppMeta', () => {
  it('falls back to the package.json next to the bundle when the cwd has none', () => {
    const empty = tempDir('meta-cwd');
    const expected = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version: string };
    const meta = readAppMeta(empty);
    expect(meta.version).toBe(expected.version);
    expect(meta.version).not.toBe('0.0.0');
  });
});
