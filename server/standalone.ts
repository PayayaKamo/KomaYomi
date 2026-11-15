/**
 * Standalone HTTP entry used by Docker and by `npm start`.
 *
 * The desktop build uses Electron's own entry (`electron/main.cjs`); this file keeps
 * the exact same API handler but resolves folders from environment variables so a
 * container can bind-mount raw/data/exports independently.
 *
 * Environment:
 *   HOST            listen address (default 0.0.0.0 so the container is reachable)
 *   PORT            listen port (default 3921)
 *   RAW_DIR         manga images   (default <cwd>/raw)
 *   DATA_DIR        annotations    (default <cwd>/data)
 *   EXPORT_DIR      exported files (default <cwd>/exports)
 *   STATIC_DIR      built frontend (default <cwd>/dist)
 *   MANGA_LOCALE    default UI locale hint: en | zh | ja
 *   LOG_LEVEL       debug | info | warn | error (default info)
 */
import fs from 'node:fs';
import path from 'node:path';
import { startMangaServer } from './app.ts';
import { t } from './messages/index.ts';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LEVELS)[number];

const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
const threshold = Math.max(0, LEVELS.indexOf(level));

function log(scope: LogLevel, ...args: unknown[]) {
  if (LEVELS.indexOf(scope) >= threshold) console[scope === 'debug' ? 'log' : scope](`[komayomi]`, ...args);
}

const rootDir = process.cwd();
const rawDir = path.resolve(process.env.RAW_DIR ?? path.join(rootDir, 'raw'));
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(rootDir, 'data'));
const exportDir = path.resolve(process.env.EXPORT_DIR ?? path.join(rootDir, 'exports'));
const staticDir = path.resolve(process.env.STATIC_DIR ?? path.join(rootDir, 'dist'));

for (const dir of [rawDir, dataDir, exportDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(staticDir)) {
  log('error', t('CLI_MISSING_STATIC_DIR', { dir: staticDir }));
  process.exit(1);
}

const port = Number(process.env.PORT) || 3921;
const host = process.env.HOST || '0.0.0.0';

const { server } = await startMangaServer(rootDir, port, staticDir, { rawDir, dataDir, exportDir }, host);

log('info', `listening on http://${host}:${port}`);
log('info', `raw=${rawDir}`);
log('info', `data=${dataDir}`);
log('info', `exports=${exportDir}`);
log('info', `locale hint=${process.env.MANGA_LOCALE ?? 'auto'}`);

const shutdown = (signal: string) => {
  log('info', `${signal} received, closing`);
  server.close(() => process.exit(0));
  // Force-exit if a keep-alive connection stalls shutdown.
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
