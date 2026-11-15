import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackupBuffer, inspectBackup, restoreBackup } from '../../server/backup.ts';
import { AppError } from '../../server/errors.ts';
import { createZip, readZip } from '../../server/zip.ts';
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

function seedData(dataRoot: string): void {
  writeFile(
    path.join(dataRoot, 'pages', 'Vol1', '172', '0.json'),
    JSON.stringify({ notes: [{ id: 'n1' }, { id: 'n2' }], panels: [] }),
  );
  writeFile(path.join(dataRoot, 'templates', 't1.json'), '{"id":"t1"}');
  writeFile(path.join(dataRoot, 'presets', 'p1.json'), '{"id":"p1"}');
  writeFile(path.join(dataRoot, 'library.json'), '{"volumes":{}}');
  writeFile(path.join(dataRoot, 'cache', 'remote', 'big.bin'), Buffer.alloc(64));
  writeFile(path.join(dataRoot, 'scratch.tmp'), 'tmp');
  writeFile(path.join(dataRoot, 'server.log'), 'log');
}

describe('zip container', () => {
  it('round-trips binary data and UTF-8 names', () => {
    const binary = Buffer.from([0, 1, 2, 250, 255, 128]);
    const zip = createZip([
      { name: 'pages/点兔 14/0.json', data: Buffer.from('{"a":1}') },
      { name: 'assets/abc.png', data: binary },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['pages/点兔 14/0.json', 'assets/abc.png']);
    expect(entries[1].data.equals(binary)).toBe(true);
    expect(entries[0].data.toString('utf8')).toBe('{"a":1}');
  });

  it('normalizes Windows separators in entry names', () => {
    const entries = readZip(createZip([{ name: 'data\\pages\\0.json', data: Buffer.from('x') }]));
    expect(entries[0].name).toBe('data/pages/0.json');
  });

  it('supports an empty archive', () => {
    expect(readZip(createZip([]))).toEqual([]);
  });

  it('rejects malformed archives with structured errors', () => {
    expect(() => readZip(Buffer.alloc(10))).toThrow(AppError);
    try {
      readZip(Buffer.alloc(40, 7));
    } catch (err) {
      expect((err as AppError).code).toBe('ERR_ZIP_NO_EOCD');
    }
  });
});

describe('backup', () => {
  it('packs data/, skips caches and scratch files, and describes its content', () => {
    const dataRoot = tempDir('backup-src');
    seedData(dataRoot);

    const { buffer, entries } = createBackupBuffer(dataRoot);
    expect(entries).toBe(5);

    const names = readZip(buffer).map((e) => e.name);
    expect(names).toContain('data/pages/Vol1/172/0.json');
    expect(names).toContain('data/.backup-meta.json');
    expect(names.some((n) => n.includes('cache'))).toBe(false);
    expect(names.some((n) => n.endsWith('.tmp') || n.endsWith('.log'))).toBe(false);

    const info = inspectBackup(dataRoot, buffer);
    expect(info.pages).toBe(1);
    expect(info.notes).toBe(2);
    expect(info.volumes).toEqual(['Vol1']);
    expect(info.templates).toBe(1);
    expect(info.presets).toBe(1);
    expect(info.overwrite).toBe(4);
    expect(info.size).toBe(buffer.length);
  });

  it('rejects archives that do not contain a data/ tree', () => {
    const dataRoot = tempDir('backup-bad');
    const buffer = createZip([{ name: 'other/file.txt', data: Buffer.from('x') }]);
    expect(() => inspectBackup(dataRoot, buffer)).toThrow(AppError);
  });

  it('restores files and writes a reversible snapshot first', () => {
    const source = tempDir('backup-source');
    seedData(source);
    const { buffer } = createBackupBuffer(source);

    const root = tempDir('backup-dest');
    const dataRoot = path.join(root, 'data');
    const exportRoot = path.join(root, 'exports');

    const result = restoreBackup(dataRoot, exportRoot, buffer);
    expect(result.restored).toBe(5);
    expect(result.warnings).toEqual([]);
    expect(result.snapshot).toBeTruthy();
    expect(fs.existsSync(result.snapshot!)).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'pages', 'Vol1', '172', '0.json'))).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'cache', 'remote', 'big.bin'))).toBe(false);
  });

  it('refuses entries that escape the data root', () => {
    const root = tempDir('backup-evil');
    const dataRoot = path.join(root, 'data');
    const buffer = createZip([
      { name: 'data/pages/../../evil.txt', data: Buffer.from('owned') },
      { name: 'data/safe.json', data: Buffer.from('{}') },
    ]);

    const result = restoreBackup(dataRoot, path.join(root, 'exports'), buffer, { snapshot: false });
    expect(result.restored).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(fs.existsSync(path.join(root, 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dataRoot, 'safe.json'))).toBe(true);
  });
});
