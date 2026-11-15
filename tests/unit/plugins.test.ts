import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listPlugins, runPlugin } from '../../server/plugins.ts';

const info = { width: 100, height: 100, volume: 'v', chapter: 'c', pageIndex: 0, filename: 'p.jpg' };

let scratch = '';
let rootDir = '';
let dataRoot = '';

function writePlugin(dir: string, name: string, source: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), source);
}

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-plugins-'));
  rootDir = path.join(scratch, 'root');
  dataRoot = path.join(scratch, 'data');
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('plugin discovery order', () => {
  it('sorts each directory naturally and loads plugins/ before data/plugins/', async () => {
    const rootPlugins = path.join(rootDir, 'plugins');
    const dataPlugins = path.join(dataRoot, 'plugins');
    writePlugin(rootPlugins, 'page10.mjs', 'export default () => [];\n');
    writePlugin(rootPlugins, 'page2.mjs', 'export default () => [];\n');
    writePlugin(dataPlugins, 'page1.mjs', 'export default () => [];\n');
    writePlugin(dataPlugins, '.hidden.mjs', 'export default () => [];\n');
    writePlugin(dataPlugins, 'notes.txt', 'ignored');

    const plugins = await listPlugins(rootDir, dataRoot);
    expect(plugins.map((p) => p.file)).toEqual(['page2.mjs', 'page10.mjs', 'page1.mjs']);
  });

  it('runs the project-root plugin before a data/plugins/ one that matches the same pages', async () => {
    writePlugin(path.join(rootDir, 'plugins'), 'root.mjs', 'export default () => [{ x: 0, y: 0, w: 1, h: 1 }];\n');
    writePlugin(path.join(dataRoot, 'plugins'), 'data.mjs', 'export default () => [{ x: 0, y: 0, w: 0.5, h: 0.5 }];\n');

    const result = await runPlugin(rootDir, dataRoot, info);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plugin).toBe('root.mjs');
  });
});

describe('plugin failure codes', () => {
  it('reports a module without a panels export', async () => {
    writePlugin(path.join(rootDir, 'plugins'), 'no-export.mjs', 'export default 42;\n');
    const [plugin] = await listPlugins(rootDir, dataRoot);
    expect(plugin.errorCode).toBe('ERR_PLUGIN_NO_EXPORT');
  });

  it('reports a module that cannot be loaded', async () => {
    writePlugin(path.join(rootDir, 'plugins'), 'broken.mjs', 'export const x = ;\n');
    const [plugin] = await listPlugins(rootDir, dataRoot);
    expect(plugin.errorCode).toBe('ERR_PLUGIN_LOAD');
  });

  it('reports an empty panel list', async () => {
    writePlugin(path.join(rootDir, 'plugins'), 'empty.mjs', 'export default () => [];\n');
    const result = await runPlugin(rootDir, dataRoot, info);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('ERR_PLUGIN_NO_PANELS');
  });

  it('reports an unsupported return value', async () => {
    writePlugin(path.join(rootDir, 'plugins'), 'bad.mjs', 'export default () => ({ panels: 3 });\n');
    const result = await runPlugin(rootDir, dataRoot, info);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('ERR_PLUGIN_BAD_RESULT');
  });

  it('reports a thrown error', async () => {
    writePlugin(path.join(rootDir, 'plugins'), 'throws.mjs', "export default () => { throw new Error('boom'); };\n");
    const result = await runPlugin(rootDir, dataRoot, info);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('ERR_PLUGIN_RUN_FAILED');
  });
});
