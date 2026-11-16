/**
 * package.json metadata (About dialog, /api/health, exported manifest appVersion).
 *
 * The process working directory is not necessarily the install root: Docker and
 * `npm start` can run with DATA_DIR/RAW_DIR pointing elsewhere and a cwd that has no
 * package.json at all, which used to surface as version "0.0.0". The bundle always
 * sits in dist-server/ next to the real package.json (and server/*.ts sits one level
 * below it when running from source), so the module-relative path is the fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppMeta = { version: string; author: string; license: string };

const EMPTY_META: AppMeta = { version: '0.0.0', author: '', license: '' };

function readPkg(file: string): AppMeta | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      version?: unknown;
      author?: unknown;
      license?: unknown;
    };
    return {
      version: typeof pkg.version === 'string' && pkg.version ? pkg.version : EMPTY_META.version,
      author: typeof pkg.author === 'string' ? pkg.author : EMPTY_META.author,
      license: typeof pkg.license === 'string' ? pkg.license : EMPTY_META.license,
    };
  } catch {
    return null;
  }
}

export function readAppMeta(rootDir: string): AppMeta {
  const direct = readPkg(path.join(rootDir, 'package.json'));
  if (direct) return direct;
  try {
    const besideBundle = readPkg(fileURLToPath(new URL('../package.json', import.meta.url)));
    if (besideBundle) return besideBundle;
  } catch {
    /* Non-ESM host: fall through to the placeholder. */
  }
  return EMPTY_META;
}
