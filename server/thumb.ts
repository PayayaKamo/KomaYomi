import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sniffFormat } from './detect.ts';
import { AppError } from './errors.ts';

type Decoded = { width: number; height: number; rgba: Uint8Array | Buffer };

function decode(buf: Buffer): Decoded {
  const fmt = sniffFormat(buf);
  if (fmt === 'png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, rgba: png.data };
  }
  if (fmt === 'jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, rgba: img.data as Uint8Array };
  }
  throw new AppError('ERR_THUMB_UNSUPPORTED', {}, 415);
}

/** 面积平均的降采样，保证缩略图不出现锯齿 */
function resize(img: Decoded, targetW: number): Decoded {
  const scale = targetW / img.width;
  const w = Math.max(1, Math.round(targetW));
  const h = Math.max(1, Math.round(img.height * scale));
  if (w >= img.width) return img;
  const out = new Uint8Array(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * img.width + xx) * 4;
          r += img.rgba[p];
          g += img.rgba[p + 1];
          b += img.rgba[p + 2];
          a += img.rgba[p + 3];
          n++;
        }
      }
      const q = (y * w + x) * 4;
      out[q] = r / n;
      out[q + 1] = g / n;
      out[q + 2] = b / n;
      out[q + 3] = a / n;
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * 生成（或读取缓存）缩略图。缓存键包含源文件路径、mtime 与目标宽度，
 * 原图更新后会自动失效，不需要手动清理。
 */
export function thumbnailFile(rawRoot: string, cacheRoot: string, rawRelPath: string, width: number): string | null {
  const rel = decodeURIComponent(rawRelPath.replace(/^\/raw\//, ''));
  const src = path.resolve(rawRoot, rel);
  const guard = rawRoot.endsWith(path.sep) ? rawRoot : rawRoot + path.sep;
  if (!src.startsWith(guard) || !fs.existsSync(src)) return null;

  const stat = fs.statSync(src);
  const key = crypto
    .createHash('sha1')
    .update(`${src.toLowerCase()}|${stat.mtimeMs}|${width}`) // 兼容大小写不敏感文件系统
    .digest('hex');
  const file = path.join(cacheRoot, `${key}.jpg`);
  if (fs.existsSync(file)) return file;

  const img = decode(fs.readFileSync(src));
  const small = resize(img, Math.min(600, Math.max(80, width)));
  const encoded = jpeg.encode({ data: Buffer.from(small.rgba), width: small.width, height: small.height }, 74);
  fs.mkdirSync(cacheRoot, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, encoded.data);
  fs.renameSync(tmp, file);
  return file;
}
