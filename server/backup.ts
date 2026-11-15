import fs from 'node:fs';
import path from 'node:path';
import { createZip, readZip } from './zip.ts';
import type { ZipEntryInput } from './zip.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';

/** Backup layout: every entry is prefixed with `data/` so the archive is self-describing. */
const SKIP_DIRS = new Set(['cache']);
const SKIP_EXT = /\.(tmp|log)$/i;

function walk(dir: string, rel: string, out: ZipEntryInput[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_EXT.test(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(abs, relPath, out);
    } else if (entry.isFile()) {
      out.push({
        name: `data/${relPath}`,
        data: fs.readFileSync(abs),
        mtime: fs.statSync(abs).mtime,
      });
    }
  }
}

export function createBackupBuffer(dataRoot: string): { buffer: Buffer; entries: number } {
  const files: ZipEntryInput[] = [];
  if (fs.existsSync(dataRoot)) walk(dataRoot, '', files);
  files.push({
    name: 'data/.backup-meta.json',
    data: Buffer.from(JSON.stringify({ app: 'manga-memo', version: 1, createdAt: new Date().toISOString() }, null, 2)),
  });
  return { buffer: createZip(files), entries: files.length };
}

export function inspectBackup(dataRoot: string, buffer: Buffer) {
  const entries = readZip(buffer);
  const dataEntries = entries.filter((e) => e.name.startsWith('data/') && !e.name.endsWith('/'));
  if (!dataEntries.length) throw new AppError('ERR_BACKUP_NOT_KOMAYOMI', {}, 400);

  let pages = 0;
  let notes = 0;
  const volumes = new Set<string>();
  let templates = 0;
  let presets = 0;
  let overwrite = 0;

  for (const entry of dataEntries) {
    const rel = entry.name.slice('data/'.length);
    if (rel.startsWith('pages/')) {
      const parts = rel.split('/');
      if (parts.length >= 4) {
        pages++;
        volumes.add(parts[1]);
        try {
          const doc = JSON.parse(entry.data.toString('utf8')) as { notes?: unknown[] };
          notes += Array.isArray(doc.notes) ? doc.notes.length : 0;
        } catch {
          /* 坏 JSON 不计批注数 */
        }
      }
    } else if (rel.startsWith('templates/')) {
      templates++;
    } else if (rel.startsWith('presets/')) {
      presets++;
    }
    if (fs.existsSync(path.join(dataRoot, rel))) overwrite++;
  }

  return {
    files: dataEntries.length,
    pages,
    notes,
    volumes: [...volumes],
    templates,
    presets,
    overwrite,
    size: buffer.length,
  };
}

export type RestoreResult = {
  restored: number;
  snapshot: string | null;
  warnings: string[];
};

/**
 * Restore a backup by overwriting files under data/.
 * A snapshot of the current data is written first, so a mis-click is always reversible.
 */
export function restoreBackup(
  dataRoot: string,
  exportRoot: string,
  buffer: Buffer,
  opts: { snapshot?: boolean } = {},
): RestoreResult {
  const entries = readZip(buffer);
  const warnings: string[] = [];
  let snapshot: string | null = null;

  if (opts.snapshot !== false) {
    try {
      fs.mkdirSync(exportRoot, { recursive: true });
      const name = `backup-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
      const { buffer: snap } = createBackupBuffer(dataRoot);
      snapshot = path.join(exportRoot, name);
      fs.writeFileSync(snapshot, snap);
    } catch (err) {
      warnings.push(t('WARN_SNAPSHOT_FAILED', { detail: err instanceof Error ? err.message : String(err) }));
    }
  }

  let restored = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith('data/') || entry.name.endsWith('/')) continue;
    const rel = entry.name.slice('data/'.length);
    const target = path.resolve(dataRoot, rel);
    if (!target.startsWith(path.resolve(dataRoot) + path.sep)) {
      warnings.push(t('WARN_SUSPICIOUS_PATH', { name: entry.name }));
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
    restored++;
  }

  return { restored, snapshot, warnings };
}
