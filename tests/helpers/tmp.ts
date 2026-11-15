import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Create a throwaway directory under the OS temp dir (never touches `raw/` or `data/`). */
export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `koma-yomi-${prefix}-`));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFile(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

/** Write many relative paths at once; contents default to a tiny placeholder. */
export function writeFiles(root: string, files: string[], data: string | Buffer = ''): void {
  for (const rel of files) writeFile(path.join(root, rel), data);
}
