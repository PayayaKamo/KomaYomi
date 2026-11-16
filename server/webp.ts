import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.ts';

export type WebpImage = { width: number; height: number; data: Uint8Array };

type DecoderImage = { data: Uint8ClampedArray; width: number; height: number };
type WebpDecoder = { decode(buffer: ArrayBuffer): DecoderImage };
type DecoderFactory = (options: { wasmBinary: Buffer }) => Promise<WebpDecoder>;

const nodeRequire = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

// libwebp's embind bindings resolve `ImageData` from the global scope when decoding.
const globalScope = globalThis as unknown as {
  ImageData?: new (data: Uint8ClampedArray, width: number, height: number) => unknown;
};
if (!globalScope.ImageData) {
  globalScope.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

let decoder: WebpDecoder | null = null;
let failure = '';

/**
 * Compile the libwebp decoder once at startup and keep the module in memory, so the
 * `decodeWebpRgba()` helper stays synchronous for thumbnails, panel detection and exports.
 *
 * The package's `index.js` promisifies `load`/`decode`, which makes its callback API
 * unusable, so the raw Emscripten factory is required directly. `scripts/build-server.mjs`
 * copies that factory (as `.cjs`) and its `.wasm` next to the bundled server, which keeps
 * the Docker/Electron outputs free of `node_modules`.
 */
try {
  const bundledJs = path.join(here, 'webp_node_dec.cjs');
  const bundledWasm = path.join(here, 'webp_node_dec.wasm');
  const jsFile = fs.existsSync(bundledJs) ? bundledJs : nodeRequire.resolve('webp-wasm/webp_node_dec.js');
  const wasmFile = fs.existsSync(bundledWasm) ? bundledWasm : nodeRequire.resolve('webp-wasm/webp_node_dec.wasm');
  decoder = await (nodeRequire(jsFile) as DecoderFactory)({ wasmBinary: fs.readFileSync(wasmFile) });
} catch (err) {
  failure = err instanceof Error ? err.message : String(err);
}

/** Decode a WebP buffer to RGBA. Throws a structured 415 error when WebP is unavailable or the data is invalid. */
export function decodeWebpRgba(buf: Buffer): WebpImage {
  const unsupported = () =>
    new AppError('ERR_UNSUPPORTED_IMAGE_FORMAT', { format: failure ? `webp (${failure})` : 'webp', ext: '.webp' }, 415);
  if (!decoder) throw unsupported();
  try {
    const image = decoder.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  } catch {
    throw unsupported();
  }
}
