// Bundle the local backend (server/*.ts) into ESM files that Node/Electron can import.
// Two entries share the same output folder:
//   app.mjs        loaded by electron/main.cjs
//   standalone.mjs used by Docker and `npm start`
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const serverDir = path.join(root, 'server');

await build({
  entryPoints: [path.join(serverDir, 'app.ts'), path.join(serverDir, 'standalone.ts')],
  outdir: path.join(root, 'dist-server'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'info',
  // Bundled CJS dependencies (pngjs / jpeg-js) may still call require.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
