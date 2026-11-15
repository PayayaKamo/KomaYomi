import fs from 'node:fs';
import path from 'node:path';
import { detectPanels, DETECTOR_VERSION, imageSize, sortReadingOrder } from './detect.ts';
import { expandLayout, resolveLayout } from './layouts.ts';
import { runPlugin } from './plugins.ts';
import { createEmptyDoc, readPageDoc, writePageDoc } from './storage.ts';
import { t } from './messages/index.ts';
import type { MessageParams } from './messages/index.ts';
import type { Library, PageEntry, PanelRect } from '../shared/types.ts';

export type PageDetectResult = {
  width: number;
  height: number;
  panels: PanelRect[];
  meta: { scale: number; threshold: number; ms: number };
  version: string;
  source: 'template' | 'plugin' | 'auto';
  lang?: string;
  warnings: string[];
  warningCodes: { code: string; params: MessageParams }[];
};

/**
 * Resolve a page's panel layout: page/chapter/volume layout template first, then a plugin,
 * then the built-in XY-Cut detector. Returns null when the page has no usable image.
 */
export async function detectPage(args: {
  rootDir: string;
  dataRoot: string;
  volume: string;
  chapter: string;
  pageIndex: number;
  page: PageEntry;
  lang?: string;
}): Promise<PageDetectResult | null> {
  const { rootDir, dataRoot, volume, chapter, pageIndex, page } = args;
  const order: string[] = [args.lang ?? '', ...Object.keys(page.files)];
  const lang = order.find((l) => page.files[l as keyof PageEntry['files']]);
  const rel = lang ? page.files[lang as keyof PageEntry['files']] : undefined;
  if (!rel) return null;

  const file = path.join(rootDir, decodeURIComponent(rel));
  const buf = fs.readFileSync(file);
  const size = imageSize(buf, file);

  const layout = resolveLayout(dataRoot, volume, chapter, pageIndex);
  if (layout) {
    const panels = expandLayout(layout, pageIndex);
    return {
      ...size,
      panels,
      meta: { scale: 1, threshold: 0, ms: 0 },
      version: `layout:${layout.id}`,
      source: 'template',
      lang,
      warnings: [t('WARN_DETECT_FROM_LAYOUT', { name: layout.name })],
      warningCodes: [{ code: 'WARN_DETECT_FROM_LAYOUT', params: { name: layout.name } }],
    };
  }

  const warnings: string[] = [];
  const warningCodes: { code: string; params: MessageParams }[] = [];
  const plugin = await runPlugin(rootDir, dataRoot, {
    ...size,
    volume,
    chapter,
    pageIndex,
    filename: path.basename(file),
  });
  if (plugin.ok) {
    return {
      ...size,
      panels: sortReadingOrder(plugin.panels, 'rtl'),
      meta: { scale: 1, threshold: 0, ms: 0 },
      version: `plugin:${plugin.plugin}`,
      source: 'plugin',
      lang,
      warnings: [t('WARN_DETECT_FROM_PLUGIN', { plugin: plugin.plugin }), ...plugin.warnings],
      warningCodes: [{ code: 'WARN_DETECT_FROM_PLUGIN', params: { plugin: plugin.plugin } }],
    };
  }
  if (plugin.plugin) {
    const params = { plugin: plugin.plugin, detail: plugin.error };
    warnings.push(t('WARN_PLUGIN_FAILED_FALLBACK', params));
    warningCodes.push({ code: 'WARN_PLUGIN_FAILED_FALLBACK', params });
  }

  return {
    ...detectPanels(buf, file),
    lang,
    version: DETECTOR_VERSION,
    source: 'auto',
    warnings,
    warningCodes,
  };
}

/**
 * Give pages that were never opened a panel document before an export runs, so a fresh
 * chapter does not export as (almost) empty. Only pages without a saved document are
 * touched; existing layouts, notes and annotations are never overwritten.
 * Returns the page indices that were detected.
 */
export async function fillMissingPageDocs(args: {
  rootDir: string;
  dataRoot: string;
  library: Library;
  volume: string;
  chapter: string;
  pageIndices?: number[];
}): Promise<number[]> {
  const { rootDir, dataRoot, library, volume, chapter } = args;
  const volumeEntry = library.volumes.find((v) => v.id === volume);
  const chapterEntry = volumeEntry?.chapters.find((c) => c.chapter === chapter);
  if (!chapterEntry) return [];

  const filled: number[] = [];
  for (const page of chapterEntry.pages) {
    if (page.excluded) continue;
    if (args.pageIndices?.length && !args.pageIndices.includes(page.index)) continue;
    if (readPageDoc(dataRoot, volume, chapter, page.index)) continue;
    let detected: PageDetectResult | null = null;
    try {
      detected = await detectPage({ rootDir, dataRoot, volume, chapter, pageIndex: page.index, page });
    } catch {
      // An unreadable image simply stays out of the export, as before.
      continue;
    }
    if (!detected) continue;
    const doc = createEmptyDoc(volume, chapter, page.index);
    doc.panels = detected.panels.map((rect, i) => ({
      id: `p${i + 1}`,
      rect,
      source: 'auto' as const,
    }));
    writePageDoc(dataRoot, doc, {
      detect: { version: detected.version, source: detected.source, lang: detected.lang },
    });
    filled.push(page.index);
  }
  return filled;
}
