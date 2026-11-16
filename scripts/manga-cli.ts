/**
 * Local batch CLI (no browser needed):
 *   node scripts/manga-cli.ts report [--narrow]
 *   node scripts/manga-cli.ts regress [--update]
 *   node scripts/manga-cli.ts detect --volume V [--chapter C] [--pages 1,2] [--content-lang ja] [--apply] [--overwrite]
 *   node scripts/manga-cli.ts apply-layout --layout ID --volume V [--chapter C] [--pages 1,2]
 *   node scripts/manga-cli.ts apply-template --template <id> --volume V --chapter C [--pages 1,2]
 *   node scripts/manga-cli.ts apply-align --preset <id> --volume V --chapter C [--pages 1,2]
 *   node scripts/manga-cli.ts templates | layouts | plugins | align-presets
 *
 * Output language: `--lang en|zh|ja`, then `$KOMAYOMI_LANG`, `$MANGA_LOCALE`,
 * `$LC_ALL` / `$LANG`, then English. `--content-lang` picks which image files to read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary } from '../server/library.ts';
import { detectPanels, imageSize, sortReadingOrder } from '../server/detect.ts';
import { createEmptyDoc, readPageDoc, writePageDoc } from '../server/storage.ts';
import { listAlignPresets, listPanelTemplates, applyPanelTemplate } from '../server/presets.ts';
import { expandLayout, listLayouts, resolveLayout } from '../server/layouts.ts';
import { listPlugins, runPlugin } from '../server/plugins.ts';
import { AppError } from '../server/errors.ts';
import { langFromEnv, normalizeLang, runWithLang, t } from '../server/messages/index.ts';
import type { MessageLang } from '../server/messages/index.ts';
import type { PageDoc, Panel, PanelRect, ReadingDirection } from '../shared/types.ts';

type Flags = Record<string, string | boolean>;

function rootsFor(root: string): { root: string; rawRoot: string; dataRoot: string } {
  return { root, rawRoot: path.join(root, 'raw'), dataRoot: path.join(root, 'data') };
}

// Resolved once for the direct CLI run; tests point this at a throwaway project root.
let { root, rawRoot, dataRoot } = rootsFor(process.cwd());

/** Point the CLI at another project root (unit tests use temporary directories). */
export function setCliRoot(nextRoot: string): void {
  ({ root, rawRoot, dataRoot } = rootsFor(nextRoot));
  baselineFile = path.join(root, 'scripts', 'detect-baseline.json');
}

export function parseArgs(argv: string[]): { cmd: string; flags: Flags } {
  const [cmd = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { cmd, flags };
}

/** `--lang` wins, then the environment, then English. */
function resolveCliLang(flags: Flags): MessageLang {
  const explicit = typeof flags.lang === 'string' ? normalizeLang(flags.lang) : null;
  return explicit ?? langFromEnv() ?? 'en';
}

function contentLang(flags: Flags): string | undefined {
  for (const key of ['content-lang', 'image-lang']) {
    const value = flags[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function findLangFile(page: { files: Partial<Record<string, string>> }, lang?: string): string | undefined {
  const order = [lang, 'ja', 'zh', 'en'].filter(Boolean) as string[];
  for (const l of order) if (page.files[l]) return page.files[l];
  return undefined;
}

function loadDoc(volume: string, chapter: string, index: number): PageDoc {
  return readPageDoc(dataRoot, volume, chapter, index) ?? createEmptyDoc(volume, chapter, index);
}

function pageIndices(chapterPages: number, flag?: string | boolean): number[] {
  if (!flag || flag === true) return Array.from({ length: chapterPages }, (_, i) => i);
  return String(flag)
    .split(',')
    .map((s) => Number(s.trim()) - 1)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < chapterPages);
}

/** Map old notes onto the new panels by reading order (kept only when counts match). */
function remapNotes(oldPanels: Panel[], newPanels: Panel[], doc: PageDoc): PageDoc {
  if (oldPanels.length !== newPanels.length) {
    return { ...doc, panels: newPanels, notes: doc.notes.filter((n) => n.scope !== 'panel') };
  }
  const oldOrder = new Map(oldPanels.map((p, i) => [p.id, i]));
  const newIds = newPanels.map((p) => p.id);
  return {
    ...doc,
    panels: newPanels,
    notes: doc.notes.map((n) => {
      if (n.scope !== 'panel' || !n.panelId) return n;
      const pos = oldOrder.get(n.panelId);
      return pos === undefined ? n : { ...n, panelId: newIds[pos] };
    }),
  };
}

function cmdReport(flags: Flags) {
  const library = createLibrary(rawRoot, dataRoot);
  let pages = 0;
  let panelsTotal = 0;
  const histogram = new Map<number, number>();
  const narrow: string[] = [];

  for (const vol of library.volumes) {
    for (const ch of vol.chapters) {
      for (const page of ch.pages) {
        const rel = findLangFile(page);
        if (!rel) continue;
        const file = path.join(root, decodeURIComponent(rel));
        const result = detectPanels(fs.readFileSync(file), file);
        pages++;
        panelsTotal += result.panels.length;
        histogram.set(result.panels.length, (histogram.get(result.panels.length) ?? 0) + 1);
        for (const [i, p] of result.panels.entries()) {
          const edge = p.x < 0.03 || p.x + p.w > 0.97;
          if (flags.narrow && p.w < 0.1 && p.h > 0.2 && edge) {
            narrow.push(
              `${vol.id}/${ch.chapter}/p${page.index + 1} #${i + 1} x=${p.x.toFixed(3)} y=${p.y.toFixed(3)} w=${p.w.toFixed(3)} h=${p.h.toFixed(3)}`,
            );
          }
        }
      }
    }
  }

  console.log(
    t('CLI_REPORT_SUMMARY', {
      pages,
      panels: panelsTotal,
      avg: (panelsTotal / Math.max(1, pages)).toFixed(2),
    }),
  );
  console.log(
    t('CLI_REPORT_HISTOGRAM', {
      dist: [...histogram.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => t('CLI_REPORT_HISTOGRAM_ITEM', { panels: k, pages: v }))
        .join('  '),
    }),
  );
  if (flags.narrow) {
    console.log(t('CLI_REPORT_NARROW', { count: narrow.length }));
    for (const line of narrow) console.log('  ' + line);
  }
}

let baselineFile = path.join(root, 'scripts', 'detect-baseline.json');

function cmdRegress(flags: Flags) {
  const library = createLibrary(rawRoot, dataRoot);
  const current: Record<string, number> = {};
  for (const vol of library.volumes) {
    for (const ch of vol.chapters) {
      for (const page of ch.pages) {
        const rel = findLangFile(page);
        if (!rel) continue;
        const file = path.join(root, decodeURIComponent(rel));
        const result = detectPanels(fs.readFileSync(file), file);
        current[`${vol.id}/${ch.chapter}/${page.index + 1}`] = result.panels.length;
      }
    }
  }

  if (flags.update || !fs.existsSync(baselineFile)) {
    fs.writeFileSync(baselineFile, JSON.stringify(current, null, 2) + '\n', 'utf8');
    console.log(
      t('CLI_REGRESS_BASELINE', { file: path.relative(root, baselineFile), pages: Object.keys(current).length }),
    );
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, number>;
  const diffs: string[] = [];
  for (const [key, count] of Object.entries(current)) {
    const before = baseline[key];
    if (before !== undefined && before !== count) diffs.push(`${key}: ${before} → ${count}`);
  }
  console.log(t('CLI_REGRESS_RESULT', { pages: Object.keys(current).length, diffs: diffs.length }));
  for (const d of diffs) console.log('  ' + d);
}

/** Same priority as the web app: layout template > plugin > automatic detection (`--auto` forces auto). */
async function detectPage(
  volume: string,
  chapter: string,
  index: number,
  file: string,
  flags: Flags,
  direction: ReadingDirection,
): Promise<{ rects: PanelRect[]; source: 'auto' | 'template' | 'plugin'; label: string; warnings: string[] }> {
  const buf = fs.readFileSync(file);
  if (!flags.auto) {
    const layout = resolveLayout(dataRoot, volume, chapter, index);
    if (layout) {
      return {
        rects: expandLayout(layout, index),
        source: 'template',
        label: `layout:${layout.id}`,
        warnings: [],
      };
    }
    const size = imageSize(buf, file);
    const plugin = await runPlugin(
      root,
      dataRoot,
      { ...size, volume, chapter, pageIndex: index, filename: path.basename(file) },
      flags.plugin ? String(flags.plugin) : undefined,
    );
    if (plugin.ok) {
      return {
        rects: sortReadingOrder(plugin.panels, direction, (rect) => rect),
        source: 'plugin',
        label: `plugin:${plugin.plugin}`,
        warnings: plugin.warnings,
      };
    }
    if (plugin.plugin)
      return {
        rects: [],
        source: 'auto',
        label: 'auto',
        warnings: [t('CLI_PLUGIN_FAILED', { plugin: plugin.plugin, detail: plugin.error })],
      };
  }
  const result = detectPanels(buf, file, direction);
  return { rects: result.panels, source: 'auto', label: 'auto', warnings: [] };
}

async function cmdDetect(flags: Flags) {
  const volume = String(flags.volume ?? '');
  const chapter = flags.chapter ? String(flags.chapter) : '';
  const library = createLibrary(rawRoot, dataRoot);
  const vol = library.volumes.find((v) => v.id === volume);
  if (!vol) throw new AppError('ERR_VOLUME_NOT_FOUND', { volume }, 404);
  const chapters = chapter ? vol.chapters.filter((c) => c.chapter === chapter) : vol.chapters;
  if (!chapters.length) throw new AppError('ERR_CHAPTER_NOT_FOUND', { volume, chapter }, 404);
  let changed = 0;

  for (const ch of chapters) {
    const targets = pageIndices(ch.pages.length, flags.pages);
    for (const index of targets) {
      const page = ch.pages[index];
      const rel = findLangFile(page, contentLang(flags));
      if (!rel) continue;
      const file = path.join(root, decodeURIComponent(rel));
      // Prefer the saved page direction, then the volume default; only then the legacy rtl.
      const savedDoc = readPageDoc(dataRoot, volume, ch.chapter, index);
      const direction = savedDoc?.readingDirection ?? vol.defaultDirection ?? 'rtl';
      const detected = await detectPage(volume, ch.chapter, index, file, flags, direction);
      const label = `${ch.chapter}/p${index + 1}`;
      if (!detected.rects.length) {
        console.log(
          t('CLI_DETECT_SKIPPED', {
            page: label,
            reason: detected.warnings.join('; ') || t('CLI_NO_RESULT'),
          }),
        );
        continue;
      }
      const doc = savedDoc ?? { ...createEmptyDoc(volume, ch.chapter, index), readingDirection: direction };
      if (doc.panels.length && !flags.overwrite) {
        console.log(t('CLI_DETECT_SKIPPED_EXISTING', { page: label, panels: doc.panels.length }));
        continue;
      }
      const nextPanels: Panel[] = detected.rects.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' }));
      const next = {
        ...remapNotes(doc.panels, nextPanels, doc),
        detectorVersion: detected.label,
        detectedAt: new Date().toISOString(),
        detectSource: detected.source,
      };
      if (flags.apply) writePageDoc(dataRoot, next);
      changed++;
      const warn = detected.warnings.length
        ? t('CLI_DETECT_WARNING_SUFFIX', { warnings: detected.warnings.join('; ') })
        : '';
      console.log(
        t('CLI_DETECT_PAGE', {
          page: label,
          panels: detected.rects.length,
          source: detected.label,
          state: flags.apply ? t('CLI_DETECT_WRITTEN') : t('CLI_DETECT_PREVIEW'),
          warn,
        }),
      );
    }
  }
  console.log(t('CLI_DETECT_DONE', { pages: changed }));
}

async function cmdApplyLayout(flags: Flags) {
  const layoutId = String(flags.layout ?? '');
  const layout = listLayouts(dataRoot).find((l) => l.id === layoutId || l.name === layoutId);
  if (!layout) throw new AppError('ERR_LAYOUT_NOT_FOUND', { layoutId }, 404);
  const volume = String(flags.volume ?? layout.volume);
  const library = createLibrary(rawRoot, dataRoot);
  const vol = library.volumes.find((v) => v.id === volume);
  if (!vol) throw new AppError('ERR_VOLUME_NOT_FOUND', { volume }, 404);
  const chapters = flags.chapter ? vol.chapters.filter((c) => c.chapter === String(flags.chapter)) : vol.chapters;
  let applied = 0;
  for (const ch of chapters) {
    for (const index of pageIndices(ch.pages.length, flags.pages)) {
      const doc = loadDoc(volume, ch.chapter, index);
      const rects = expandLayout(layout, index);
      const nextPanels: Panel[] = rects.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' }));
      writePageDoc(dataRoot, {
        ...remapNotes(doc.panels, nextPanels, doc),
        detectorVersion: `layout:${layout.id}`,
        detectedAt: new Date().toISOString(),
        detectSource: 'template',
      });
      applied++;
    }
  }
  console.log(t('CLI_LAYOUT_APPLIED', { name: layout.name, pages: applied }));
}

function cmdLayouts() {
  const list = listLayouts(dataRoot);
  if (!list.length) return console.log(t('CLI_LAYOUT_NONE'));
  for (const l of list) {
    console.log(
      t('CLI_LAYOUT_ROW', {
        id: l.id,
        name: l.name,
        scope: l.scope,
        volume: `${l.volume}${l.chapter ? '/' + l.chapter : ''}`,
        rows: l.grid.rows.length,
        cols: l.grid.cols,
      }),
    );
  }
}

async function cmdPlugins() {
  const list = await listPlugins(root, dataRoot);
  if (!list.length) return console.log(t('CLI_PLUGIN_NONE'));
  for (const p of list) {
    console.log(
      p.error
        ? t('CLI_PLUGIN_ROW_ERROR', { file: p.file, name: p.name, error: p.error })
        : t('CLI_PLUGIN_ROW', { file: p.file, name: p.name }),
    );
  }
}

function cmdApplyTemplate(flags: Flags) {
  const templateId = String(flags.template ?? '');
  const volume = String(flags.volume ?? '');
  const chapter = String(flags.chapter ?? '');
  if (!templateId || !volume || !chapter) throw new AppError('CLI_TEMPLATE_ARGS_REQUIRED', {}, 400);
  const library = createLibrary(rawRoot, dataRoot);
  const ch = library.volumes.find((v) => v.id === volume)?.chapters.find((c) => c.chapter === chapter);
  if (!ch) throw new AppError('ERR_CHAPTER_NOT_FOUND', { volume, chapter }, 404);
  const indices = pageIndices(ch.pages.length, flags.pages);
  let applied = 0;
  for (const index of indices) {
    const doc = loadDoc(volume, chapter, index);
    if (applyPanelTemplate(dataRoot, doc, templateId)) applied++;
  }
  console.log(t('CLI_TEMPLATE_APPLIED', { id: templateId, pages: applied }));
}

function cmdApplyAlign(flags: Flags) {
  const presetId = String(flags.preset ?? '');
  const preset = listAlignPresets(dataRoot).find((p) => p.id === presetId);
  if (!preset) throw new AppError('ERR_ALIGN_PRESET_NOT_FOUND', { presetId }, 404);
  const library = createLibrary(rawRoot, dataRoot);
  const vol = library.volumes.find((v) => v.id === String(flags.volume ?? preset.volume));
  const chapters = flags.chapter ? vol?.chapters.filter((c) => c.chapter === String(flags.chapter)) : vol?.chapters;
  if (!vol || !chapters?.length) throw new AppError('CLI_TARGET_CHAPTER_MISSING', {}, 404);
  let applied = 0;
  for (const ch of chapters) {
    for (const index of pageIndices(ch.pages.length, flags.pages)) {
      const doc = loadDoc(vol.id, ch.chapter, index);
      writePageDoc(dataRoot, {
        ...doc,
        alignMode: preset.mode,
        offsets: preset.offsets,
        gridStep: preset.gridStep,
        panelOffsets: preset.panelOffsets,
      });
      applied++;
    }
  }
  console.log(t('CLI_ALIGN_APPLIED', { name: preset.name, pages: applied }));
}

function cmdTemplates() {
  const list = listPanelTemplates(dataRoot);
  if (!list.length) return console.log(t('CLI_TEMPLATE_NONE'));
  for (const tpl of list) {
    console.log(
      t('CLI_TEMPLATE_ROW', {
        id: tpl.id,
        name: tpl.name,
        panels: tpl.panels.length,
        volume: tpl.volume,
        chapter: tpl.chapter,
      }),
    );
  }
}

function cmdAlignPresets() {
  const list = listAlignPresets(dataRoot);
  if (!list.length) return console.log(t('CLI_ALIGN_NONE'));
  for (const p of list) {
    console.log(
      t('CLI_ALIGN_ROW', {
        id: p.id,
        name: p.name,
        mode: p.mode,
        scope: p.scope,
        volume: p.volume,
        chapter: p.chapter,
      }),
    );
  }
}

async function main(cmd: string, flags: Flags) {
  if (cmd === 'report') cmdReport(flags);
  else if (cmd === 'regress') cmdRegress(flags);
  else if (cmd === 'detect') await cmdDetect(flags);
  else if (cmd === 'apply-layout') await cmdApplyLayout(flags);
  else if (cmd === 'apply-template') cmdApplyTemplate(flags);
  else if (cmd === 'apply-align') cmdApplyAlign(flags);
  else if (cmd === 'templates') cmdTemplates();
  else if (cmd === 'layouts') cmdLayouts();
  else if (cmd === 'plugins') await cmdPlugins();
  else if (cmd === 'align-presets') cmdAlignPresets();
  else console.log(t('CLI_USAGE'));
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const invoked = path.resolve(entry);
  const current = path.resolve(fileURLToPath(import.meta.url));
  return process.platform === 'win32' ? invoked.toLowerCase() === current.toLowerCase() : invoked === current;
}

/** Run one CLI invocation and return the exit code (0 success, 1 failure). */
export async function runCli(argv: string[], options: { root?: string } = {}): Promise<number> {
  setCliRoot(options.root ?? process.cwd());
  const { cmd, flags } = parseArgs(argv);
  const lang = resolveCliLang(flags);
  try {
    await runWithLang(lang, () => main(cmd, flags));
    return 0;
  } catch (err) {
    const detail =
      err instanceof AppError
        ? t(err.code, err.params, lang)
        : err instanceof SyntaxError
          ? t('ERR_INVALID_JSON', { detail: err.message }, lang)
          : err instanceof Error
            ? err.message
            : String(err);
    console.error(t('CLI_ERROR', { detail }, lang));
    return 1;
  }
}

if (isDirectRun()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
