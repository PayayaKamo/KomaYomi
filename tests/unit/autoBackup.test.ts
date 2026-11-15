import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_BACKUP,
  isAutoBackupDue,
  listAutoBackups,
  normalizeAutoBackupConfig,
  pruneAutoBackups,
  readAutoBackupState,
  runAutoBackup,
} from '../../server/autoBackup.ts';
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
  writeFile(path.join(dataRoot, 'pages', 'Vol1', '1', '0.json'), JSON.stringify({ notes: [{ id: 'n1' }] }));
  writeFile(path.join(dataRoot, 'library.json'), '{"volumes":{}}');
}

describe('auto backup config', () => {
  it('falls back to defaults and clamps out-of-range values', () => {
    expect(normalizeAutoBackupConfig(undefined)).toEqual(DEFAULT_AUTO_BACKUP);
    expect(normalizeAutoBackupConfig({ enabled: true, intervalHours: 0, keep: 0 })).toEqual({
      enabled: true,
      intervalHours: 1,
      keep: 1,
    });
    expect(normalizeAutoBackupConfig({ intervalHours: 999, keep: 999 })).toEqual({
      enabled: false,
      intervalHours: 168,
      keep: 50,
    });
    expect(normalizeAutoBackupConfig({ intervalHours: Number.NaN, keep: 'x' })).toEqual(DEFAULT_AUTO_BACKUP);
  });

  it('is due when enabled and the interval has elapsed', () => {
    const config = { enabled: true, intervalHours: 2, keep: 3 };
    expect(isAutoBackupDue({ ...config, enabled: false }, {})).toBe(false);
    expect(isAutoBackupDue(config, {})).toBe(true);
    const now = Date.parse('2026-11-15T12:00:00.000Z');
    expect(isAutoBackupDue(config, { lastRunAt: '2026-11-15T11:30:00.000Z' }, now)).toBe(false);
    expect(isAutoBackupDue(config, { lastRunAt: '2026-11-15T09:00:00.000Z' }, now)).toBe(true);
    expect(isAutoBackupDue(config, { lastRunAt: 'not-a-date' }, now)).toBe(true);
  });
});

describe('auto backup run', () => {
  it('writes an archive, records the run and keeps only the newest copies', () => {
    const dataRoot = tempDir('auto-data');
    const exportRoot = path.join(tempDir('auto-export'), 'exports');
    seedData(dataRoot);
    fs.mkdirSync(exportRoot, { recursive: true });

    // A manual backup must survive pruning.
    writeFile(path.join(exportRoot, 'backup-manual.zip'), 'manual');

    const config = { enabled: true, intervalHours: 24, keep: 2 };
    for (let i = 0; i < 3; i++) {
      runAutoBackup(dataRoot, exportRoot, config);
    }

    const autos = listAutoBackups(exportRoot);
    expect(autos).toHaveLength(2);
    expect(autos.every((file) => file.name.startsWith('auto-backup-'))).toBe(true);
    expect(autos.every((file) => file.size > 0)).toBe(true);
    expect(fs.existsSync(path.join(exportRoot, 'backup-manual.zip'))).toBe(true);

    const state = readAutoBackupState(dataRoot);
    expect(state.lastFile).toBe(autos[0].name);
    expect(state.lastRunAt).toBeTruthy();
    expect(state.lastError).toBeUndefined();
    // Bookkeeping lives under cache/ so it is not bundled into the next archive.
    expect(fs.existsSync(path.join(dataRoot, 'cache', 'backup-schedule.json'))).toBe(true);
  });

  it('prunes without touching manual backups when only automatic ones exist', () => {
    const exportRoot = tempDir('auto-prune');
    writeFile(path.join(exportRoot, 'auto-backup-2026-01-01T00-00-00-000Z.zip'), 'a');
    writeFile(path.join(exportRoot, 'auto-backup-2026-01-02T00-00-00-000Z.zip'), 'b');
    writeFile(path.join(exportRoot, 'auto-backup-2026-01-03T00-00-00-000Z.zip'), 'c');

    expect(pruneAutoBackups(exportRoot, 1)).toBe(2);
    expect(listAutoBackups(exportRoot).map((file) => file.name)).toEqual(['auto-backup-2026-01-03T00-00-00-000Z.zip']);
  });
});
