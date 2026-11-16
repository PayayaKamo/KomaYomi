import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import webpWasm from 'webp-wasm';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeGray, decodeRgba, detectPanels, imageSize, sniffFormat } from '../../server/detect.ts';
import { thumbnailFile } from '../../server/thumb.ts';
import { threePanelPage } from '../helpers/fixtures.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

/**
 * WebP is a first-class page format: the bundled libwebp decoder must cover sniffing,
 * dimensions, thumbnails and panel detection without a lossy round-trip through PNG.
 */
const encoder = webpWasm as unknown as {
  load(): Promise<void>;
  encode(image: { data: Uint8ClampedArray; width: number; height: number }, options: object): Promise<Buffer>;
};

await encoder.load();

async function toWebp(png: Buffer): Promise<Buffer> {
  const image = PNG.sync.read(png);
  return encoder.encode(
    { data: image.data as unknown as Uint8ClampedArray, width: image.width, height: image.height },
    { quality: 92 },
  );
}

const page = await toWebp(threePanelPage());
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

describe('WebP decoding', () => {
  it('sniffs the RIFF/WEBP header and reads dimensions without decoding pixels', () => {
    expect(sniffFormat(page)).toBe('webp');
    expect(imageSize(page, 'page.webp')).toEqual({ width: 600, height: 840 });
  });

  it('decodes RGBA and grayscale pixels', () => {
    const rgba = decodeRgba(page, 'page.webp');
    expect(rgba.width).toBe(600);
    expect(rgba.height).toBe(840);
    expect(rgba.data).toHaveLength(600 * 840 * 4);

    const gray = decodeGray(page, 'page.webp');
    expect(gray.width).toBe(600);
    expect(gray.height).toBe(840);
    // White margin at the top-left, and dark panel borders somewhere below.
    expect(gray.data[0]).toBeGreaterThan(200);
    let darkest = 255;
    for (let i = 0; i < gray.data.length; i += 101) darkest = Math.min(darkest, gray.data[i]);
    expect(darkest).toBeLessThan(100);
  });

  it('runs panel detection on a WebP page', () => {
    const result = detectPanels(page, 'page.webp');
    expect(result.width).toBe(600);
    expect(result.height).toBe(840);
    expect(result.panels).toHaveLength(3);
  });

  it('generates a JPEG thumbnail from a WebP source', () => {
    const root = makeTempDir('webp-thumb');
    dirs.push(root);
    const rawRoot = path.join(root, 'raw');
    const cacheRoot = path.join(root, 'cache');
    writeFile(path.join(rawRoot, 'Vol1', 'zh-hk', '199', '01.webp'), page);

    const thumb = thumbnailFile(rawRoot, cacheRoot, '/raw/Vol1/zh-hk/199/01.webp', 240);

    expect(thumb).not.toBeNull();
    const buf = fs.readFileSync(thumb!);
    expect(sniffFormat(buf)).toBe('jpeg');
    expect(buf.length).toBeGreaterThan(0);
  });
});
