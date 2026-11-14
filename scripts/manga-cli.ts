/**
 * 本地批处理 CLI（无需启动浏览器）：
 *   node scripts/manga-cli.ts report [--narrow]
 *   node scripts/manga-cli.ts regress [--update]
 *   node scripts/manga-cli.ts detect --volume 点兔第14卷 [--chapter 172] [--pages 1,2] [--lang ja] [--apply] [--overwrite]
 *   node scripts/manga-cli.ts apply-template --template <id> --volume 点兔第14卷 --chapter 172 [--pages 1,2]
 *   node scripts/manga-cli.ts apply-align --preset <id> --volume 点兔第14卷 --chapter 172 [--pages 1,2]
 *   node scripts/manga-cli.ts templates
 *   node scripts/manga-cli.ts align-presets
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLibrary } from '../server/library.ts';
import { detectPanels, imageSize, sortReadingOrder } from '../server/detect.ts';
import { createEmptyDoc, readPageDoc, writePageDoc } from '../server/storage.ts';
import { listAlignPresets, listPanelTemplates, applyPanelTemplate } from '../server/presets.ts';
import { expandLayout, listLayouts, resolveLayout } from '../server/layouts.ts';
import { listPlugins, runPlugin } from '../server/plugins.ts';
import type { PageDoc, Panel, PanelRect } from '../shared/types.ts';

const root = process.cwd();
const rawRoot = path.join(root, 'raw');
const dataRoot = path.join(root, 'data');

function args(): { cmd: string; flags: Record<string, string | boolean> } {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};
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

function findLangFile(page: { files: Partial<Record<string, string>> }, lang?: string): string | undefined {
  const order = [lang, 'ja', 'zh', 'en'].filter(Boolean) as string[];
  for (const l of order) if (page.files[l]) return page.files[l];
  return undefined;
}

function loadDoc(volume: string, chapter: string, index: number): PageDoc {
  return readPageDoc(dataRoot, volume, chapter, index) ?? createEmptyDoc(volume, chapter, index);
}

function pageIndices(chapterPages: number, flag?: string): number[] {
  if (!flag || flag === true) return Array.from({ length: chapterPages }, (_, i) => i);
  return String(flag)
    .split(',')
    .map((s) => Number(s.trim()) - 1)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < chapterPages);
}

/** 用稳定排序把旧批注按阅读顺序映射到新格子（数量一致时才保留） */
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

function cmdReport(flags: Record<string, string | boolean>) {
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

  console.log(`页面 ${pages} 页，格子合计 ${panelsTotal}，平均 ${(panelsTotal / Math.max(1, pages)).toFixed(2)} 格/页`);
  console.log(
    '格子数分布：',
    [...histogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}格×${v}页`)
      .join('  '),
  );
  if (flags.narrow) {
    console.log(`贴边窄条共 ${narrow.length} 个：`);
    for (const line of narrow) console.log('  ' + line);
  }
}

const baselineFile = path.join(root, 'scripts', 'detect-baseline.json');

function cmdRegress(flags: Record<string, string | boolean>) {
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
    console.log(`已写入基线 ${path.relative(root, baselineFile)}（${Object.keys(current).length} 页）`);
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, number>;
  const diffs: string[] = [];
  for (const [key, count] of Object.entries(current)) {
    const before = baseline[key];
    if (before !== undefined && before !== count) diffs.push(`${key}: ${before} → ${count}`);
  }
  console.log(`回归完成：${Object.keys(current).length} 页，差异 ${diffs.length} 页`);
  for (const d of diffs) console.log('  ' + d);
}

/** 与网页端一致的优先级：版式模板 > 插件 > 自动检测（加 --auto 可强制自动） */
async function detectPage(
  volume: string,
  chapter: string,
  index: number,
  file: string,
  flags: Record<string, string | boolean>,
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
        rects: sortReadingOrder(plugin.panels, 'rtl'),
        source: 'plugin',
        label: `plugin:${plugin.plugin}`,
        warnings: plugin.warnings,
      };
    }
    if (plugin.plugin) return { rects: [], source: 'auto', label: 'auto', warnings: [`插件 ${plugin.plugin} 失败：${plugin.error}`] };
  }
  const result = detectPanels(buf, file);
  return { rects: result.panels, source: 'auto', label: 'auto', warnings: [] };
}

async function cmdDetect(flags: Record<string, string | boolean>) {
  const volume = String(flags.volume ?? '');
  const chapter = flags.chapter ? String(flags.chapter) : '';
  const library = createLibrary(rawRoot, dataRoot);
  const vol = library.volumes.find((v) => v.id === volume);
  if (!vol) throw new Error(`找不到卷：${volume}`);
  const chapters = chapter ? vol.chapters.filter((c) => c.chapter === chapter) : vol.chapters;
  let changed = 0;

  for (const ch of chapters) {
    const targets = pageIndices(ch.pages.length, flags.pages);
    for (const index of targets) {
      const page = ch.pages[index];
      const rel = findLangFile(page, flags.lang ? String(flags.lang) : undefined);
      if (!rel) continue;
      const file = path.join(root, decodeURIComponent(rel));
      const detected = await detectPage(volume, ch.chapter, index, file, flags);
      if (!detected.rects.length) {
        console.log(`跳过 ${ch.chapter}/p${index + 1}：${detected.warnings.join('；') || '没有结果'}`);
        continue;
      }
      const doc = loadDoc(volume, ch.chapter, index);
      if (doc.panels.length && !flags.overwrite) {
        console.log(`跳过 ${ch.chapter}/p${index + 1}（已有 ${doc.panels.length} 格，加 --overwrite 覆盖）`);
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
      const warn = detected.warnings.length ? `  ⚠ ${detected.warnings.join('；')}` : '';
      console.log(
        `${ch.chapter}/p${index + 1}: ${detected.rects.length} 格（${detected.label}）${flags.apply ? '（已写入）' : '（预览，加 --apply 写入）'}${warn}`,
      );
    }
  }
  console.log(`共处理 ${changed} 页`);
}

async function cmdApplyLayout(flags: Record<string, string | boolean>) {
  const layoutId = String(flags.layout ?? '');
  const layout = listLayouts(dataRoot).find((l) => l.id === layoutId || l.name === layoutId);
  if (!layout) throw new Error(`找不到版式模板：${layoutId}`);
  const volume = String(flags.volume ?? layout.volume);
  const library = createLibrary(rawRoot, dataRoot);
  const vol = library.volumes.find((v) => v.id === volume);
  if (!vol) throw new Error(`找不到卷：${volume}`);
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
  console.log(`已把版式「${layout.name}」套用到 ${applied} 页`);
}

function cmdLayouts() {
  const list = listLayouts(dataRoot);
  if (!list.length) return console.log('还没有版式模板（data/layouts/*.json）');
  for (const l of list) {
    console.log(`${l.id}\t${l.name}\t${l.scope}\t${l.volume}${l.chapter ? '/' + l.chapter : ''}\t${l.grid.rows.length} 行 × ${l.grid.cols} 列`);
  }
}

async function cmdPlugins() {
  const list = await listPlugins(root, dataRoot);
  if (!list.length) return console.log('还没有切格插件（plugins/*.mjs）');
  for (const p of list) console.log(`${p.file}\t${p.name}${p.error ? `\t错误：${p.error}` : ''}`);
}

function cmdApplyTemplate(flags: Record<string, string | boolean>) {
  const templateId = String(flags.template ?? '');
  const volume = String(flags.volume ?? '');
  const chapter = String(flags.chapter ?? '');
  if (!templateId || !volume || !chapter) throw new Error('需要 --template、--volume、--chapter');
  const library = createLibrary(rawRoot, dataRoot);
  const ch = library.volumes.find((v) => v.id === volume)?.chapters.find((c) => c.chapter === chapter);
  if (!ch) throw new Error(`找不到章节：${volume}/${chapter}`);
  const indices = pageIndices(ch.pages.length, flags.pages);
  let applied = 0;
  for (const index of indices) {
    const doc = loadDoc(volume, chapter, index);
    if (applyPanelTemplate(dataRoot, doc, templateId)) applied++;
  }
  console.log(`已套用模板 ${templateId} 到 ${applied} 页`);
}

function cmdApplyAlign(flags: Record<string, string | boolean>) {
  const presetId = String(flags.preset ?? '');
  const preset = listAlignPresets(dataRoot).find((p) => p.id === presetId);
  if (!preset) throw new Error(`找不到对齐预设：${presetId}`);
  const library = createLibrary(rawRoot, dataRoot);
  const vol = library.volumes.find((v) => v.id === String(flags.volume ?? preset.volume));
  const chapters = flags.chapter ? vol?.chapters.filter((c) => c.chapter === String(flags.chapter)) : vol?.chapters;
  if (!vol || !chapters?.length) throw new Error('找不到目标章节');
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
  console.log(`已套用对齐预设 ${preset.name} 到 ${applied} 页`);
}

function cmdTemplates() {
  const list = listPanelTemplates(dataRoot);
  if (!list.length) return console.log('还没有分格模板');
  for (const t of list) console.log(`${t.id}\t${t.name}\t${t.panels.length} 格\t${t.volume}/${t.chapter}`);
}

function cmdAlignPresets() {
  const list = listAlignPresets(dataRoot);
  if (!list.length) return console.log('还没有对齐预设');
  for (const p of list) console.log(`${p.id}\t${p.name}\t${p.mode}\t${p.scope}\t${p.volume}/${p.chapter}`);
}

const { cmd, flags } = args();
try {
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
  else {
    console.log(
      [
        '用法：node scripts/manga-cli.ts <命令> [参数]',
        '  report [--narrow]                 扫描全部页面，输出格子数分布（--narrow 列出贴边窄条）',
        '  regress [--update]                与 scripts/detect-baseline.json 对比格子数',
        '  detect --volume V [--chapter C] [--pages 1,2] [--lang ja] [--plugin 名称] [--auto] [--apply] [--overwrite]',
        '  apply-layout --layout ID --volume V [--chapter C] [--pages 1,2]',
        '  apply-template --template ID --volume V --chapter C [--pages 1,2]',
        '  apply-align --preset ID --volume V --chapter C [--pages 1,2]',
        '  templates | layouts | plugins | align-presets',
      ].join('\n'),
    );
  }
} catch (err) {
  console.error('出错了：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
