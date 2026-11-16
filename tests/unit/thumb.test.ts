import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { afterEach, describe, expect, it } from 'vitest';
import { thumbnailFile } from '../../server/thumb.ts';
import { AppError } from '../../server/errors.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';
import { solidJpeg, solidPng } from '../helpers/fixtures.ts';

const dirs: string[] = [];

function tempRoot(): { rawRoot: string; cacheRoot: string; outside: string } {
  const root = makeTempDir('thumb');
  dirs.push(root);
  const rawRoot = path.join(root, 'raw');
  const cacheRoot = path.join(root, 'cache', 'thumbs');
  fs.mkdirSync(rawRoot, { recursive: true });
  return { rawRoot, cacheRoot, outside: root };
}

function dimensions(file: string): { width: number; height: number } {
  const img = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true });
  return { width: img.width, height: img.height };
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

describe('thumbnailFile', () => {
  it('generates a JPEG thumbnail from a PNG source and creates the cache directory', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'Vol1', 'ja', '1', '01.png'), solidPng(1200, 1680, 200));

    const file = thumbnailFile(rawRoot, cacheRoot, '/raw/Vol1/ja/1/01.png', 300);

    expect(file).not.toBeNull();
    expect(fs.existsSync(file!)).toBe(true);
    expect(path.extname(file!)).toBe('.jpg');
    expect(fs.existsSync(cacheRoot)).toBe(true);
    expect(dimensions(file!)).toEqual({ width: 300, height: 420 });
  });

  it('decodes URI-encoded relative paths', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'Vol 1', 'ja', '1', '01.png'), solidPng(600, 840, 180));

    const file = thumbnailFile(rawRoot, cacheRoot, '/raw/Vol%201/ja/1/01.png', 150);
    expect(file).not.toBeNull();
    expect(dimensions(file!)).toEqual({ width: 150, height: 210 });
  });

  it('clamps the thumbnail width to 80..600', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'wide.png'), solidPng(1200, 1680, 200));

    const tiny = thumbnailFile(rawRoot, cacheRoot, '/raw/wide.png', 10);
    expect(dimensions(tiny!)).toEqual({ width: 80, height: 112 });

    const huge = thumbnailFile(rawRoot, cacheRoot, '/raw/wide.png', 5000);
    expect(dimensions(huge!)).toEqual({ width: 600, height: 840 });
  });

  it('never upscales a source that is already narrower than the target', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'small.png'), solidPng(400, 300, 220));

    const file = thumbnailFile(rawRoot, cacheRoot, '/raw/small.png', 600);
    expect(dimensions(file!)).toEqual({ width: 400, height: 300 });
  });

  it('decodes JPEG sources as well', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'page.jpg'), solidJpeg(800, 600, 120));

    const file = thumbnailFile(rawRoot, cacheRoot, '/raw/page.jpg', 200);
    expect(dimensions(file!)).toEqual({ width: 200, height: 150 });
  });

  it('returns the cached file on a second call without touching it', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'cached.png'), solidPng(1200, 1680, 200));

    const first = thumbnailFile(rawRoot, cacheRoot, '/raw/cached.png', 240);
    const mtime = fs.statSync(first!).mtimeMs;
    const second = thumbnailFile(rawRoot, cacheRoot, '/raw/cached.png', 240);

    expect(second).toBe(first);
    expect(fs.statSync(second!).mtimeMs).toBe(mtime);
    expect(fs.readdirSync(cacheRoot).filter((name) => name.endsWith('.jpg'))).toHaveLength(1);
  });

  it('invalidates the cache when the source file changes', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    const source = path.join(rawRoot, 'changing.png');
    writeFile(source, solidPng(1200, 1680, 200));

    const first = thumbnailFile(rawRoot, cacheRoot, '/raw/changing.png', 240);
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(source, future, future);
    const second = thumbnailFile(rawRoot, cacheRoot, '/raw/changing.png', 240);

    expect(second).not.toBe(first);
    expect(fs.existsSync(second!)).toBe(true);
    expect(dimensions(second!)).toEqual({ width: 240, height: 336 });
  });

  it('returns null for missing sources and paths escaping the raw root', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'ok.png'), solidPng(100, 100, 200));
    writeFile(path.join(path.dirname(rawRoot), 'outside.png'), solidPng(100, 100, 200));

    expect(thumbnailFile(rawRoot, cacheRoot, '/raw/missing.png', 200)).toBeNull();
    expect(thumbnailFile(rawRoot, cacheRoot, '/raw/../outside.png', 200)).toBeNull();
    expect(thumbnailFile(rawRoot, cacheRoot, '/raw/../../outside.png', 200)).toBeNull();
  });

  it('rejects unsupported image formats with a 415 error', () => {
    const { rawRoot, cacheRoot } = tempRoot();
    writeFile(path.join(rawRoot, 'notes.txt'), 'plain text');

    try {
      thumbnailFile(rawRoot, cacheRoot, '/raw/notes.txt', 200);
      throw new Error('expected ERR_THUMB_UNSUPPORTED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ERR_THUMB_UNSUPPORTED');
      expect((err as AppError).status).toBe(415);
    }
  });
});
