/**
 * Storage providers: one interface over local folders, UNC/network shares and WebDAV.
 *
 * Why this module exists: the app must work with a local library, a NAS share and a
 * WebDAV box without three code paths in the HTTP layer. Providers only expose the
 * operations the app really uses (list/read/write/status); anything richer would leak
 * into callers that only care about "give me this page".
 *
 * Credentials never live in `storage.json`. Passwords are encrypted with AES-256-GCM
 * using a per-install key file (mode 0600) so a synced/copied data folder does not
 * leak a NAS password; this is the portable fallback for machines without a native
 * keychain (the Electron build could later swap in safeStorage).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type StorageKind = 'local' | 'network' | 'webdav';

export type StorageTarget = {
  id: string;
  name: string;
  kind: StorageKind;
  /** Absolute folder for local/network targets. */
  path?: string;
  /** Base URL for WebDAV targets, e.g. https://nas.local/dav/manga */
  url?: string;
  username?: string;
  /** Set by the server when a password is stored; the password itself is never returned. */
  hasSecret?: boolean;
  enabled?: boolean;
  /** Read-only targets still work as a source but refuse uploads. */
  readOnly?: boolean;
};

export type StorageConfig = {
  version: 1;
  /** Optional remote library root. When set, pages are fetched on demand and cached. */
  rawSource?: StorageTarget;
  /** Backup destinations shown in the UI. */
  backups: StorageTarget[];
  /** Remote cache cap in megabytes. */
  cacheLimitMb: number;
};

export type RemoteEntry = { name: string; rel: string; dir: boolean; size: number; mtime: number };

export type StorageStatus = {
  id: string;
  kind: StorageKind;
  online: boolean;
  readOnly: boolean;
  message: string;
  checkedAt: string;
};

export interface StorageProvider {
  id: string;
  kind: StorageKind;
  list(rel: string): Promise<RemoteEntry[]>;
  read(rel: string): Promise<Buffer>;
  write(rel: string, data: Buffer): Promise<void>;
  status(): Promise<StorageStatus>;
}

const CONFIG_FILE = 'storage.json';
const SECRET_FILE = 'secrets.json.enc';
const KEY_FILE = '.secret.key';

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  version: 1,
  backups: [],
  cacheLimitMb: 512,
};

export function readStorageConfig(dataRoot: string): StorageConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataRoot, CONFIG_FILE), 'utf8')) as Partial<StorageConfig>;
    return {
      version: 1,
      rawSource: parsed.rawSource,
      backups: Array.isArray(parsed.backups) ? parsed.backups : [],
      cacheLimitMb: clampLimit(parsed.cacheLimitMb),
    };
  } catch {
    return { ...DEFAULT_STORAGE_CONFIG };
  }
}

export function writeStorageConfig(dataRoot: string, cfg: StorageConfig): StorageConfig {
  const clean: StorageConfig = {
    version: 1,
    rawSource: cfg.rawSource ? sanitizeTarget(cfg.rawSource) : undefined,
    backups: (cfg.backups ?? []).map(sanitizeTarget),
    cacheLimitMb: clampLimit(cfg.cacheLimitMb),
  };
  fs.mkdirSync(dataRoot, { recursive: true });
  atomicWrite(path.join(dataRoot, CONFIG_FILE), Buffer.from(JSON.stringify(clean, null, 2)));
  return clean;
}

const clampLimit = (n: unknown) => {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? Math.min(100_000, Math.round(value)) : 512;
};

const sanitizeTarget = (t: StorageTarget): StorageTarget => ({
  id: String(t.id ?? '').trim() || `target-${Date.now()}`,
  name: String(t.name ?? '').trim() || 'Untitled',
  kind: t.kind === 'webdav' ? 'webdav' : t.kind === 'network' ? 'network' : 'local',
  path: t.path ? path.resolve(String(t.path)) : undefined,
  url: t.url ? String(t.url).replace(/\/+$/, '') : undefined,
  username: t.username ? String(t.username) : undefined,
  hasSecret: undefined,
  enabled: t.enabled !== false,
  readOnly: Boolean(t.readOnly),
});

/* ---------------- credentials ---------------- */

function keyFor(dataRoot: string): Buffer {
  const file = path.join(dataRoot, KEY_FILE);
  try {
    const raw = fs.readFileSync(file);
    if (raw.length === 32) return raw;
  } catch {
    /* create below */
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function readSecrets(dataRoot: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataRoot, SECRET_FILE), 'utf8')) as {
      iv: string;
      tag: string;
      data: string;
    };
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(dataRoot), Buffer.from(raw.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(raw.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSecrets(dataRoot: string, secrets: Record<string, string>): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(dataRoot), iv);
  const payload = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(secrets), 'utf8')), cipher.final()]);
  atomicWrite(
    path.join(dataRoot, SECRET_FILE),
    Buffer.from(
      JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: payload.toString('base64'),
      }),
      'utf8',
    ),
  );
}

/** Store (or, with an empty value, forget) a password for a target id. */
export function setSecret(dataRoot: string, id: string, secret: string | null): void {
  const secrets = readSecrets(dataRoot);
  if (secret) secrets[id] = secret;
  else delete secrets[id];
  writeSecrets(dataRoot, secrets);
}

function getSecret(dataRoot: string, id: string): string | undefined {
  return readSecrets(dataRoot)[id];
}

/** Report which targets have a stored password without exposing any secret. */
export function markSecrets(dataRoot: string, cfg: StorageConfig): StorageConfig {
  const ids = new Set(Object.keys(readSecrets(dataRoot)));
  const mark = (t: StorageTarget): StorageTarget => ({ ...t, hasSecret: ids.has(t.id) });
  return {
    ...cfg,
    rawSource: cfg.rawSource ? mark(cfg.rawSource) : undefined,
    backups: cfg.backups.map(mark),
  };
}

function atomicWrite(file: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/* ---------------- path safety ---------------- */

/**
 * Resolve a provider-relative path and reject escapes. Remote listings come from the
 * network, so `..` or absolute segments must never reach the filesystem or a URL.
 */
export function safeRel(rel: string): string {
  const cleaned = String(rel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '';
  const parts = cleaned.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) throw new Error('非法路径');
  return parts.join('/');
}

function within(root: string, rel: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, safeRel(rel));
  const guard = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(guard)) throw new Error('路径越界');
  return target;
}

/* ---------------- local / network provider ---------------- */

function localProvider(rootDir: string, target: StorageTarget, mustExist = false): StorageProvider {
  const base = target.path ?? '';
  return {
    id: target.id,
    kind: target.kind,
    async list(rel) {
      const dir = within(base, rel);
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries.map((entry) => {
        const stat = fs.statSync(path.join(dir, entry.name));
        const childRel = safeRel(`${rel}/${entry.name}`);
        return {
          name: entry.name,
          rel: childRel,
          dir: entry.isDirectory() || (entry.isSymbolicLink() && stat.isDirectory()),
          size: entry.isFile() ? stat.size : 0,
          mtime: stat.mtimeMs,
        };
      });
    },
    async read(rel) {
      return fs.promises.readFile(within(base, rel));
    },
    async write(rel, data) {
      if (target.readOnly) throw new Error('该存储为只读');
      const file = within(base, rel);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      atomicWrite(file, data);
    },
    async status() {
      const checkedAt = new Date().toISOString();
      try {
        const stat = await fs.promises.stat(base);
        if (!stat.isDirectory()) throw new Error('不是目录');
        return {
          id: target.id,
          kind: target.kind,
          online: true,
          readOnly: Boolean(target.readOnly),
          message: target.kind === 'network' ? '网络共享可访问' : '本地目录可访问',
          checkedAt,
        };
      } catch (err) {
        // A backup destination is often created on first write; report it as usable
        // when the parent folder exists instead of a scary "offline". A raw *source*
        // must exist, otherwise the library would silently look empty.
        if (!mustExist) {
          try {
            const parent = await fs.promises.stat(path.dirname(base));
            if (parent.isDirectory()) {
              return {
                id: target.id,
                kind: target.kind,
                online: true,
                readOnly: Boolean(target.readOnly),
                message: '目标目录尚未创建，首次写入时自动建立',
                checkedAt,
              };
            }
          } catch {
            /* fall through */
          }
        }
        return {
          id: target.id,
          kind: target.kind,
          online: false,
          readOnly: Boolean(target.readOnly),
          message: err instanceof Error ? err.message : '无法访问',
          checkedAt,
        };
      }
    },
  };
}

/* ---------------- WebDAV provider ---------------- */

const DAV_TIMEOUT = 10_000;

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parsePropfind(xml: string, base: string): RemoteEntry[] {
  const out: RemoteEntry[] = [];
  const blocks = xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
  for (const block of blocks) {
    const href = block.match(/<(?:[\w-]+:)?href[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i)?.[1];
    if (!href) continue;
    const isDir = /<(?:[\w-]+:)?collection\s*\/?>/i.test(block);
    const size = Number(block.match(/<(?:[\w-]+:)?getcontentlength[^>]*>(\d+)</i)?.[1] ?? 0);
    const mtime = Date.parse(block.match(/<(?:[\w-]+:)?getlastmodified[^>]*>([^<]+)</i)?.[1] ?? '') || 0;
    let rel = decodeXml(href);
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* keep raw */
    }
    rel = rel.replace(/^https?:\/\/[^/]+/i, '');
    const basePath = base.replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '');
    if (basePath && rel.startsWith(basePath)) rel = rel.slice(basePath.length);
    rel = safeRel(rel);
    if (!rel) continue; // the collection itself
    out.push({
      name: rel.split('/').pop() ?? rel,
      rel,
      dir: isDir,
      size,
      mtime,
    });
  }
  return out;
}

function webdavProvider(target: StorageTarget, password?: string): StorageProvider {
  const base = (target.url ?? '').replace(/\/+$/, '');
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'user-agent': 'KomaYomi/0.1' };
    if (target.username || password) {
      h.authorization = `Basic ${Buffer.from(`${target.username ?? ''}:${password ?? ''}`).toString('base64')}`;
    }
    return h;
  };
  const urlFor = (rel: string) =>
    `${base}/${safeRel(rel).split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;

  const request = async (method: string, rel: string, body?: Buffer, depth?: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DAV_TIMEOUT);
    try {
      return await fetch(urlFor(rel), {
        method,
        // Buffer is accepted by Node's fetch at runtime; the DOM BodyInit type is stricter.
        body: body ? (body as unknown as BodyInit) : undefined,
        signal: controller.signal,
        headers: { ...headers(), ...(depth ? { depth } : {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    id: target.id,
    kind: 'webdav',
    async list(rel) {
      const resp = await request('PROPFIND', rel, undefined, '1');
      if (!resp.ok) throw new Error(`WebDAV ${resp.status}`);
      return parsePropfind(await resp.text(), `${base}/${safeRel(rel)}`);
    },
    async read(rel) {
      const resp = await request('GET', rel);
      if (!resp.ok) throw new Error(`WebDAV ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    },
    async write(rel, data) {
      if (target.readOnly) throw new Error('该存储为只读');
      const resp = await request('PUT', rel, data);
      if (!resp.ok) throw new Error(`WebDAV ${resp.status}`);
    },
    async status() {
      const checkedAt = new Date().toISOString();
      try {
        const resp = await request('PROPFIND', '', undefined, '0');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return {
          id: target.id,
          kind: 'webdav',
          online: true,
          readOnly: Boolean(target.readOnly),
          message: 'WebDAV 可访问',
          checkedAt,
        };
      } catch (err) {
        return {
          id: target.id,
          kind: 'webdav',
          online: false,
          readOnly: true,
          message: err instanceof Error ? (err.name === 'AbortError' ? '连接超时' : err.message) : '无法连接',
          checkedAt,
        };
      }
    },
  };
}

export function createProvider(
  dataRoot: string,
  target: StorageTarget,
  opts: { mustExist?: boolean } = {},
): StorageProvider {
  if (target.kind === 'webdav') return webdavProvider(target, getSecret(dataRoot, target.id));
  return localProvider(target.path ?? '', target, opts.mustExist);
}

/* ---------------- remote cache ---------------- */

export type CacheStats = { bytes: number; files: number; limitMb: number };

function cacheRoot(dataRoot: string) {
  return path.join(dataRoot, 'cache', 'remote');
}

/** Cached remote files are content-addressed by provider id + path. */
export function remoteCachePath(dataRoot: string, targetId: string, rel: string, ext: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${targetId}|${safeRel(rel)}`)
    .digest('hex');
  return path.join(cacheRoot(dataRoot), 'files', `${hash}${ext.toLowerCase()}`);
}

/** Read a cached remote file, refreshing its access time so pruning is LRU-ish. */
export function readRemoteCache(dataRoot: string, targetId: string, rel: string, ext: string): Buffer | null {
  const file = remoteCachePath(dataRoot, targetId, rel, ext);
  try {
    const buf = fs.readFileSync(file);
    const now = new Date();
    fs.utimesSync(file, now, now);
    return buf;
  } catch {
    return null;
  }
}

export function writeRemoteCache(dataRoot: string, targetId: string, rel: string, ext: string, data: Buffer): void {
  atomicWrite(remoteCachePath(dataRoot, targetId, rel, ext), data);
  pruneRemoteCache(dataRoot, readStorageConfig(dataRoot).cacheLimitMb);
}

export function cacheStats(dataRoot: string): CacheStats {
  const cfg = readStorageConfig(dataRoot);
  const dir = path.join(cacheRoot(dataRoot), 'files');
  let bytes = 0;
  let files = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      bytes += fs.statSync(path.join(dir, entry.name)).size;
      files++;
    }
  } catch {
    /* empty cache */
  }
  return { bytes, files, limitMb: cfg.cacheLimitMb };
}

export function clearRemoteCache(dataRoot: string): number {
  const dir = path.join(cacheRoot(dataRoot), 'files');
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { force: true });
      removed++;
    }
  } catch {
    /* nothing to clear */
  }
  return removed;
}

/** Evict least-recently-used cache files until usage is below 90% of the cap. */
export function pruneRemoteCache(dataRoot: string, limitMb: number): number {
  const limit = limitMb * 1024 * 1024;
  const dir = path.join(cacheRoot(dataRoot), 'files');
  let entries: { file: string; size: number; at: number }[] = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(dir, e.name);
        const stat = fs.statSync(file);
        return { file, size: stat.size, at: stat.atimeMs };
      });
  } catch {
    return 0;
  }
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total <= limit) return 0;
  entries.sort((a, b) => a.at - b.at);
  let removed = 0;
  for (const entry of entries) {
    if (total <= limit * 0.9) break;
    fs.rmSync(entry.file, { force: true });
    total -= entry.size;
    removed++;
  }
  return removed;
}

/* ---------------- remote library mirror ---------------- */

/** Local mirror of the remote directory tree (empty placeholder files, no images). */
export function remoteTreeRoot(dataRoot: string): string {
  return path.join(cacheRoot(dataRoot), 'tree');
}

export type RemoteSyncResult = {
  files: number;
  dirs: number;
  skipped: number;
  truncated: boolean;
  syncedAt: string;
};

const MAX_REMOTE_FILES = 20_000;

/**
 * Walk the remote source and materialise zero-byte placeholders for image files.
 *
 * Why placeholders: the existing library scanner and directory rules already work on
 * a folder tree, so mirroring the *structure* lets remote volumes reuse all of that
 * logic. Actual bytes are fetched on demand when a page is opened.
 */
export async function syncRemoteTree(
  dataRoot: string,
  provider: StorageProvider,
  extensions: string[] = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'],
): Promise<RemoteSyncResult> {
  const root = remoteTreeRoot(dataRoot);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const exts = new Set(extensions.map((e) => e.toLowerCase()));
  let files = 0;
  let dirs = 0;
  let skipped = 0;
  let truncated = false;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 10 || truncated) return;
    let entries: RemoteEntry[];
    try {
      entries = await provider.list(rel);
    } catch {
      skipped++;
      return;
    }
    for (const entry of entries) {
      if (files >= MAX_REMOTE_FILES) {
        truncated = true;
        return;
      }
      const local = within(root, entry.rel);
      if (entry.dir) {
        fs.mkdirSync(local, { recursive: true });
        dirs++;
        await walk(entry.rel, depth + 1);
        continue;
      }
      if (!exts.has(path.extname(entry.name).toLowerCase())) continue;
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, Buffer.alloc(0));
      files++;
    }
  };

  await walk('', 0);
  return { files, dirs, skipped, truncated, syncedAt: new Date().toISOString() };
}
