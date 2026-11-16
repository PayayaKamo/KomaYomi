import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importProject } from '../../server/project.ts';
import { createEmptyDoc, writePageDoc } from '../../server/storage.ts';
import type { PageDoc } from '../../shared/types.ts';
import { solidPng } from '../helpers/fixtures.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

// Write back on the next tick so the test does not wait for the debounce window.
process.env.KOMAYOMI_PROJECT_WRITEBACK_MS = '0';

const { startMangaServer } = await import('../../server/app.ts');
const { createProjectBuffer } = await import('../../server/project.ts');

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return dir;
}

const PNG = solidPng(30, 40, 10);

function pageDoc(note: string): PageDoc {
  return {
    ...createEmptyDoc('Vol1', '172', 0),
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

let base = '';
let server: http.Server;
let root = '';
let target = '';

async function call(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeAll(async () => {
  root = tempDir('api-project');
  const dataRoot = path.join(root, 'data');
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', '172', '01.png'), PNG);
  writePageDoc(dataRoot, pageDoc('opened'));

  target = path.join(tempDir('api-project-file'), 'demo.mnproj');
  fs.writeFileSync(target, createProjectBuffer({ rootDir: root, storageMode: 'packaged' }).buffer);

  const started = await startMangaServer(root, 0, undefined, {}, '127.0.0.1');
  server = started.server;
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())));
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  while (dirs.length) removeDir(dirs.pop()!);
});

describe('project write-back over HTTP', () => {
  it('links the opened file, writes edits back automatically, and refuses writes in read mode', async () => {
    const linked = await call('POST', '/api/project/open', { path: target, conflict: 'overwrite' });
    expect(linked.status).toBe(200);
    expect((linked.json as { link: { path: string } }).link.path).toBe(target);
    expect((await call('GET', '/api/project/link')).json).toMatchObject({ linked: true });

    expect((await call('PUT', '/api/page', pageDoc('edited via api'))).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const reopened = tempDir('api-project-check');
    importProject({ rootDir: reopened, buffer: fs.readFileSync(target), snapshot: false });
    const doc = JSON.parse(
      fs.readFileSync(path.join(reopened, 'data', 'pages', 'Vol1', '172', '0.json'), 'utf8'),
    ) as PageDoc;
    expect(doc.notes[0].text).toBe('edited via api');

    // Read-only mode must never write, not even through the manual save endpoint.
    expect((await call('POST', '/api/project/save', {}, { 'X-KomaYomi-Mode': 'read' })).status).toBe(403);

    const unlinked = await call('POST', '/api/project/unlink', {});
    expect(unlinked.json).toMatchObject({ removed: true, link: { linked: false } });
    // Unlinking keeps the file itself untouched.
    expect(fs.existsSync(target)).toBe(true);
  });
});
