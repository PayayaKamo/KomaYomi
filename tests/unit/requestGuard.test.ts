import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { assertTrustedRequest } from '../../server/requestGuard.ts';
import { startMangaServer } from '../../server/app.ts';
import { readZip } from '../../server/zip.ts';
import { AppError } from '../../server/errors.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const req = (method: string, headers: Record<string, string>): IncomingMessage =>
  ({ method, headers }) as IncomingMessage;

const expectCode = (fn: () => void, code: string, status: number) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    expect((err as AppError).status).toBe(status);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe('assertTrustedRequest', () => {
  it('allows same-origin JSON writes and bodyless writes from a browser', () => {
    expect(() =>
      assertTrustedRequest(
        req('PUT', {
          host: '127.0.0.1:3921',
          origin: 'http://127.0.0.1:3921',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'content-length': '12',
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertTrustedRequest(req('POST', { host: 'localhost:5173', 'sec-fetch-site': 'same-origin' })),
    ).not.toThrow();
  });

  it('allows non-browser clients that send no Origin or Sec-Fetch-Site', () => {
    expect(() =>
      assertTrustedRequest(req('POST', { host: '127.0.0.1:3921', 'content-type': 'application/json' })),
    ).not.toThrow();
  });

  it('allows binary uploads and rejects other body types', () => {
    expect(() =>
      assertTrustedRequest(
        req('POST', { host: '127.0.0.1:3921', 'content-type': 'application/octet-stream', 'content-length': '10' }),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        assertTrustedRequest(
          req('POST', {
            host: '127.0.0.1:3921',
            origin: 'http://127.0.0.1:3921',
            'content-type': 'text/plain',
            'content-length': '5',
          }),
        ),
      'ERR_UNSUPPORTED_CONTENT_TYPE',
      415,
    );
  });

  it('rejects non-loopback hosts to stop DNS rebinding', () => {
    expectCode(() => assertTrustedRequest(req('GET', { host: 'evil.example' })), 'ERR_UNTRUSTED_HOST', 403);
    expectCode(() => assertTrustedRequest(req('GET', {})), 'ERR_UNTRUSTED_HOST', 403);
  });

  it('rejects cross-site origins and fetch metadata', () => {
    expectCode(
      () =>
        assertTrustedRequest(
          req('POST', {
            host: '127.0.0.1:3921',
            origin: 'https://evil.example',
            'content-type': 'application/json',
          }),
        ),
      'ERR_UNTRUSTED_ORIGIN',
      403,
    );
    expectCode(
      () =>
        assertTrustedRequest(
          req('POST', { host: '127.0.0.1:3921', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }),
        ),
      'ERR_UNTRUSTED_ORIGIN',
      403,
    );
    expectCode(
      () => assertTrustedRequest(req('POST', { host: '127.0.0.1:3921', origin: 'null' })),
      'ERR_UNTRUSTED_ORIGIN',
      403,
    );
  });

  it('accepts non-loopback hosts only when LAN access was enabled', () => {
    expect(() => assertTrustedRequest(req('GET', { host: '192.168.1.20:3921' }), { allowLan: true })).not.toThrow();
    expectCode(() => assertTrustedRequest(req('GET', { host: '192.168.1.20:3921' })), 'ERR_UNTRUSTED_HOST', 403);
  });
});

describe('live HTTP guard', () => {
  const root = makeTempDir('httpguard');
  writeFile(path.join(root, 'raw', 'Vol1', 'ja', 'ch1', '001.jpg'), 'not-an-image');
  let server: http.Server | undefined;
  let port = 0;

  const rawRequest = (headers: Record<string, string>, body: string) =>
    new Promise<number>((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, path: '/api/page', method: 'PUT', headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      request.on('error', reject);
      request.end(body);
    });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    removeDir(root);
  });

  it('serves same-origin requests but blocks rebound hosts and cross-site posts', async () => {
    ({ server, port } = await startMangaServer(root, 0));
    const payload = JSON.stringify({ volume: 'Vol1', chapter: 'ch1', pageIndex: 0, panels: [], notes: [] });

    const ok = await fetch(`http://127.0.0.1:${port}/api/page`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(ok.status).toBe(200);

    const rebound = await rawRequest(
      {
        host: 'evil.example',
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      },
      payload,
    );
    expect(rebound).toBe(403);

    const crossSite = await fetch(`http://127.0.0.1:${port}/api/page`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: payload,
    });
    expect(crossSite.status).toBe(403);
    expect(fs.existsSync(path.join(root, 'data', 'pages', 'Vol1', 'ch1', '0.json'))).toBe(true);
  });

  it('serves backup zips only to local/same-origin callers', async () => {
    writeFile(path.join(root, 'exports', 'backup.zip'), 'PK-not-a-real-zip');

    const local = await fetch(`http://127.0.0.1:${port}/exports/backup.zip`);
    expect(local.status).toBe(200);

    const crossSite = await fetch(`http://127.0.0.1:${port}/exports/backup.zip`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(crossSite.status).toBe(403);

    const metadata = await fetch(`http://127.0.0.1:${port}/exports/backup.zip`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(metadata.status).toBe(403);
  });

  it('leaves storage credentials out of a real backup archive', async () => {
    writeFile(path.join(root, 'data', 'pages', 'Vol1', 'ch1', '0.json'), '{"panels":[]}');
    writeFile(path.join(root, 'data', 'secrets.json.enc'), '{"v":1,"iv":"a","tag":"b","data":"c"}');
    writeFile(path.join(root, 'data', '.secret.key'), Buffer.alloc(32, 3));

    const resp = await fetch(`http://127.0.0.1:${port}/api/backup`, { method: 'POST' });
    expect(resp.status).toBe(200);
    const { url } = (await resp.json()) as { url: string };
    const zip = await fetch(`http://127.0.0.1:${port}${url}`);
    expect(zip.status).toBe(200);
    const names = readZip(Buffer.from(await zip.arrayBuffer())).map((entry) => entry.name);
    expect(names.some((name) => name.endsWith('secrets.json.enc'))).toBe(false);
    expect(names.some((name) => name.endsWith('.secret.key'))).toBe(false);
    expect(names.some((name) => name.includes('pages/Vol1/ch1/0.json'))).toBe(true);
  });
});
