// 把本地后端（server/app.ts）打包成 Electron 可直接 import 的 ESM 文件
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');

await build({
  entryPoints: [path.join(root, 'server', 'app.ts')],
  outfile: path.join(root, 'dist-server', 'app.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'info',
  // 打包进来的 CJS 依赖（pngjs / jpeg-js）仍可能调用 require
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
