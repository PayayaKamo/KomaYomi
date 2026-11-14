import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PanelRect } from '../shared/types.ts';

/**
 * Plugin based panel splitting.
 *
 * Users drop a `.mjs` / `.js` / `.cjs` file into `plugins/` (next to the project
 * or inside the data directory). Each plugin is a plain function or an object
 * with `name`, optional `match` and a `panels(info)` function returning
 * normalized rects. Failures and timeouts fall back to the built-in detector so
 * a broken plugin never leaves the page blank.
 */

export type PluginMatch = {
  volume?: string | RegExp;
  chapter?: string | RegExp;
  file?: string | RegExp;
};

export type PluginPanelInfo = {
  width: number;
  height: number;
  volume: string;
  chapter: string;
  pageIndex: number;
  filename: string;
};

export type PanelPlugin = {
  name?: string;
  match?: PluginMatch;
  panels: (info: PluginPanelInfo) => PanelRect[] | { panels: PanelRect[]; warnings?: string[] } | Promise<PanelRect[] | { panels: PanelRect[]; warnings?: string[] }>;
};

export type PluginSummary = {
  file: string;
  name: string;
  match?: PluginMatch;
  error?: string;
};

const PLUGIN_TIMEOUT = 2500;

const pluginDirs = (rootDir: string, dataRoot: string) => [path.join(rootDir, 'plugins'), path.join(dataRoot, 'plugins')];

function listPluginFiles(rootDir: string, dataRoot: string): string[] {
  const files: string[] = [];
  for (const dir of pluginDirs(rootDir, dataRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(mjs|cjs|js)$/i.test(name) || name.startsWith('.')) continue;
      files.push(path.join(dir, name));
    }
  }
  return files;
}

function matches(value: string, pattern?: string | RegExp): boolean {
  if (!pattern) return true;
  if (pattern instanceof RegExp) return pattern.test(value);
  return value.toLowerCase().includes(String(pattern).toLowerCase());
}

function matchPlugin(plugin: PanelPlugin, info: PluginPanelInfo): boolean {
  const m = plugin.match;
  if (!m) return true;
  return matches(info.volume, m.volume) && matches(info.chapter, m.chapter) && matches(info.filename, m.file);
}

const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));

function normalizeRects(input: unknown): PanelRect[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((r): r is PanelRect => Boolean(r) && typeof r === 'object')
    .map((r) => {
      const x = clamp01(r.x);
      const y = clamp01(r.y);
      return {
        x,
        y,
        w: Math.min(1 - x, Math.max(0.005, Number(r.w) || 0)),
        h: Math.min(1 - y, Math.max(0.005, Number(r.h) || 0)),
      };
    });
}

async function importPlugin(file: string): Promise<PanelPlugin | null> {
  // Cache-bust on mtime so editing a plugin does not require restarting the app.
  const mtime = fs.statSync(file).mtimeMs;
  const url = `${pathToFileURL(file).href}?v=${mtime}`;
  const mod = (await import(url)) as { default?: unknown; panels?: unknown; name?: unknown; match?: unknown };
  const candidate = mod.default ?? mod;
  if (typeof candidate === 'function') {
    return { name: path.basename(file), panels: candidate as PanelPlugin['panels'] };
  }
  if (candidate && typeof (candidate as PanelPlugin).panels === 'function') {
    return candidate as PanelPlugin;
  }
  return null;
}

export async function listPlugins(rootDir: string, dataRoot: string): Promise<PluginSummary[]> {
  const out: PluginSummary[] = [];
  for (const file of listPluginFiles(rootDir, dataRoot)) {
    try {
      const plugin = await importPlugin(file);
      if (!plugin) {
        out.push({ file: path.basename(file), name: path.basename(file), error: '没有导出 panels 函数' });
        continue;
      }
      out.push({ file: path.basename(file), name: plugin.name ?? path.basename(file), match: plugin.match });
    } catch (err) {
      out.push({
        file: path.basename(file),
        name: path.basename(file),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

export type PluginRunResult =
  | { ok: true; panels: PanelRect[]; plugin: string; warnings: string[] }
  | { ok: false; plugin?: string; error: string };

/** Run the first matching plugin. Returns `ok:false` so callers can fall back. */
export async function runPlugin(
  rootDir: string,
  dataRoot: string,
  info: PluginPanelInfo,
  only?: string,
): Promise<PluginRunResult> {
  for (const file of listPluginFiles(rootDir, dataRoot)) {
    let plugin: PanelPlugin | null = null;
    try {
      plugin = await importPlugin(file);
    } catch (err) {
      if (only && !file.toLowerCase().includes(only.toLowerCase())) continue;
      return { ok: false, plugin: path.basename(file), error: err instanceof Error ? err.message : String(err) };
    }
    if (!plugin) continue;
    const name = plugin.name ?? path.basename(file);
    if (only && name !== only && !path.basename(file).includes(only)) continue;
    if (!matchPlugin(plugin, info)) continue;

    try {
      const result = await Promise.race([
        Promise.resolve(plugin.panels(info)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('插件执行超时（2500ms）')), PLUGIN_TIMEOUT)),
      ]);
      const panels = normalizeRects(Array.isArray(result) ? result : result.panels);
      const warnings = Array.isArray(result) ? [] : result.warnings ?? [];
      if (!panels.length) return { ok: false, plugin: name, error: '插件没有返回任何格子' };
      return { ok: true, panels, plugin: name, warnings };
    } catch (err) {
      return { ok: false, plugin: name, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: '没有匹配的插件' };
}
