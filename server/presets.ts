import fs from 'node:fs';
import path from 'node:path';
import type {
  AlignMode,
  AlignOffset,
  AlignPreset,
  ExportConfig,
  ExportTemplate,
  Lang,
  PageDoc,
  Panel,
  PanelRect,
  PanelTemplate,
  ReadingDirection,
} from '../shared/types.ts';
import { sortReadingOrder } from './detect.ts';
import { writePageDoc } from './storage.ts';

const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

function normalizeOffsets(input: unknown): Partial<Record<Lang, AlignOffset>> {
  const out: Partial<Record<Lang, AlignOffset>> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [lang, off] of Object.entries(input as Record<string, AlignOffset>)) {
    if (!off) continue;
    out[lang as Lang] = {
      x: Number(off.x) || 0,
      y: Number(off.y) || 0,
      scale: Math.min(4, Math.max(0.2, Number(off.scale) || 1)),
    };
  }
  return out;
}

function normalizePanelOffsets(input: unknown): Record<string, Partial<Record<Lang, AlignOffset>>> {
  const out: Record<string, Partial<Record<Lang, AlignOffset>>> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [panelId, byLang] of Object.entries(input as Record<string, unknown>)) {
    const clean = normalizeOffsets(byLang);
    if (Object.keys(clean).length) out[panelId] = clean;
  }
  return out;
}

/* ---------------- 分格模板 ---------------- */

const panelTemplateDir = (dataRoot: string) => path.join(dataRoot, 'templates', 'panels');

export function listPanelTemplates(dataRoot: string): PanelTemplate[] {
  const dir = panelTemplateDir(dataRoot);
  if (!fs.existsSync(dir)) return [];
  const list: PanelTemplate[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as PanelTemplate;
      list.push({ ...t, panels: normalizeRects(t.panels) });
    } catch {
      /* 单个坏文件忽略 */
    }
  }
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function savePanelTemplate(
  dataRoot: string,
  input: {
    name?: string;
    volume?: string;
    chapter?: string;
    panels: PanelRect[];
    readingDirection?: ReadingDirection;
  },
): PanelTemplate {
  const template: PanelTemplate = {
    id: uid('tpl'),
    name: (input.name ?? '').trim() || '未命名分格模板',
    volume: String(input.volume ?? ''),
    chapter: String(input.chapter ?? ''),
    panels: normalizeRects(input.panels),
    readingDirection:
      input.readingDirection === 'ltr' || input.readingDirection === 'ttb' ? input.readingDirection : 'rtl',
    createdAt: new Date().toISOString(),
  };
  const dir = panelTemplateDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${template.id}.json`), JSON.stringify(template, null, 2), 'utf8');
  return template;
}

export function readPanelTemplate(dataRoot: string, id: string): PanelTemplate | null {
  const file = path.join(panelTemplateDir(dataRoot), `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const t = JSON.parse(fs.readFileSync(file, 'utf8')) as PanelTemplate;
    return { ...t, panels: normalizeRects(t.panels) };
  } catch {
    return null;
  }
}

export function deletePanelTemplate(dataRoot: string, id: string): boolean {
  const file = path.join(panelTemplateDir(dataRoot), `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/**
 * 把模板套用到一页并落盘。
 * 格子数量与原页一致时，按阅读顺序把旧批注迁移到新格子；不一致则丢弃格级批注（整页批注保留）。
 */
export function applyPanelTemplate(
  dataRoot: string,
  doc: PageDoc,
  templateId: string,
): { doc: PageDoc; droppedNotes: number } | null {
  const template = readPanelTemplate(dataRoot, templateId);
  if (!template) return null;

  const oldOrder = sortReadingOrder(doc.panels, doc.readingDirection);
  const panels: Panel[] = template.panels.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' }));
  let droppedNotes = 0;
  const notes =
    oldOrder.length === panels.length
      ? doc.notes.map((n) => {
          if (n.scope !== 'panel' || !n.panelId) return n;
          const pos = oldOrder.findIndex((p) => p.id === n.panelId);
          return pos < 0 ? n : { ...n, panelId: panels[pos].id };
        })
      : doc.notes.filter((n) => {
          if (n.scope !== 'panel') return true;
          droppedNotes++;
          return false;
        });

  const next: PageDoc = {
    ...doc,
    panels,
    notes,
    readingDirection: template.readingDirection,
  };
  return { doc: writePageDoc(dataRoot, next), droppedNotes };
}

/* ---------------- 对齐预设 ---------------- */

/** 每个预设一个可读 JSON 文件，便于手动编辑与版本管理 */
const alignPresetDir = (dataRoot: string) => path.join(dataRoot, 'presets', 'align');
/** 旧版本把全部预设堆在一个数组文件里，保留只读兼容并按需迁移 */
const legacyAlignPresetFile = (dataRoot: string) => path.join(dataRoot, 'presets', 'align.json');

function normalizePreset(p: AlignPreset): AlignPreset {
  return {
    ...p,
    offsets: normalizeOffsets(p.offsets),
    panelOffsets: normalizePanelOffsets(p.panelOffsets),
  };
}

function writeAlignPresetFile(dataRoot: string, preset: AlignPreset) {
  const dir = alignPresetDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${path.basename(preset.id)}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(preset, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function listAlignPresets(dataRoot: string): AlignPreset[] {
  const dir = alignPresetDir(dataRoot);
  const out: AlignPreset[] = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as AlignPreset;
        if (p && typeof p.id === 'string') out.push(normalizePreset(p));
      } catch {
        /* 单个坏文件忽略 */
      }
    }
  }

  const legacy = legacyAlignPresetFile(dataRoot);
  if (fs.existsSync(legacy)) {
    try {
      const list = JSON.parse(fs.readFileSync(legacy, 'utf8')) as AlignPreset[];
      for (const p of list) {
        if (!p || typeof p.id !== 'string' || out.some((x) => x.id === p.id)) continue;
        const preset = normalizePreset(p);
        writeAlignPresetFile(dataRoot, preset);
        out.push(preset);
      }
      // 迁移完把旧文件改名留档，避免重复导入
      fs.renameSync(legacy, path.join(dataRoot, 'presets', 'align.legacy.json'));
    } catch {
      /* 旧文件损坏时忽略 */
    }
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveAlignPreset(
  dataRoot: string,
  input: Partial<AlignPreset> & { name: string; volume: string; chapter: string },
): AlignPreset {
  const mode: AlignMode =
    input.mode === 'panel' || input.mode === 'anchors' || input.mode === 'grid' ? input.mode : 'page';
  const preset: AlignPreset = {
    id: input.id && typeof input.id === 'string' ? input.id : uid('al'),
    name: input.name.trim() || '未命名对齐预设',
    scope: input.scope === 'chapter' ? 'chapter' : 'page',
    volume: input.volume,
    chapter: input.chapter,
    mode,
    offsets: normalizeOffsets(input.offsets),
    panelOffsets: normalizePanelOffsets(input.panelOffsets),
    gridStep: Math.min(10, Math.max(0.1, Number(input.gridStep) || 1)),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  writeAlignPresetFile(dataRoot, preset);
  return preset;
}

export function deleteAlignPreset(dataRoot: string, id: string): boolean {
  const file = path.join(alignPresetDir(dataRoot), `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/* ---------------- 导出模板 ---------------- */

const exportTemplateFile = (dataRoot: string) => path.join(dataRoot, 'templates', 'export.json');

export function listExportTemplates(dataRoot: string): ExportTemplate[] {
  const file = exportTemplateFile(dataRoot);
  if (!fs.existsSync(file)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as ExportTemplate[];
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function writeExportTemplates(dataRoot: string, list: ExportTemplate[]) {
  const file = exportTemplateFile(dataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function saveExportTemplate(
  dataRoot: string,
  input: { id?: string; name?: string; createdAt?: string; config: Partial<ExportConfig> },
): ExportTemplate {
  const template: ExportTemplate = {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : uid('ext'),
    name: (input.name ?? '').trim() || '未命名导出模板',
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : new Date().toISOString(),
    config: input.config ?? {},
  };
  writeExportTemplates(dataRoot, [template, ...listExportTemplates(dataRoot).filter((t) => t.id !== template.id)]);
  return template;
}

export function deleteExportTemplate(dataRoot: string, id: string): boolean {
  const list = listExportTemplates(dataRoot);
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  writeExportTemplates(dataRoot, next);
  return true;
}
