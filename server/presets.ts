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
import { CURRENT_SCHEMA_VERSION, checkSchemaVersion, preserveUnknown, prepareExchange } from '../shared/format.ts';
import { sortReadingOrder } from './detect.ts';
import { writePageDoc } from './storage.ts';
import {
  assertWritableFile,
  readRawRecord,
  readRawValue,
  readStoredFile,
  writeBackupOnce,
  writeJsonFile,
  writeStoredFile,
} from './schemaStore.ts';
import { AppError } from './errors.ts';
import { t as msg } from './messages/index.ts';

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
      const stored = readStoredFile<PanelTemplate>(path.join(dir, file), 'mntp');
      if (!stored) continue;
      list.push({ ...stored.data, panels: normalizeRects(stored.data.panels) });
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
    name: (input.name ?? '').trim() || msg('DEFAULT_NAME_PANEL_TEMPLATE'),
    volume: String(input.volume ?? ''),
    chapter: String(input.chapter ?? ''),
    panels: normalizeRects(input.panels),
    readingDirection:
      input.readingDirection === 'ltr' || input.readingDirection === 'ttb' ? input.readingDirection : 'rtl',
    createdAt: new Date().toISOString(),
  };
  const dir = panelTemplateDir(dataRoot);
  const file = path.join(dir, `${template.id}.json`);
  writeStoredFile(file, 'mntp', template);
  return template;
}

export function readPanelTemplate(dataRoot: string, id: string): PanelTemplate | null {
  const file = path.join(panelTemplateDir(dataRoot), `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const stored = readStoredFile<PanelTemplate>(file, 'mntp');
    return stored ? { ...stored.data, panels: normalizeRects(stored.data.panels) } : null;
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
  return { doc: writePageDoc(dataRoot, next, { source: 'template' }), droppedNotes };
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
  const file = path.join(alignPresetDir(dataRoot), `${path.basename(preset.id)}.json`);
  assertWritableFile(file, 'mnalign');
  // Keep unknown fields written by a newer build when this preset is re-saved.
  writeStoredFile(file, 'mnalign', preserveUnknown(readRawRecord(file), preset));
}

export function listAlignPresets(dataRoot: string): AlignPreset[] {
  const dir = alignPresetDir(dataRoot);
  const out: AlignPreset[] = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const stored = readStoredFile<AlignPreset>(path.join(dir, file), 'mnalign');
        if (stored && typeof stored.data.id === 'string') out.push(normalizePreset(stored.data));
      } catch {
        /* 单个坏文件忽略 */
      }
    }
  }

  const legacy = legacyAlignPresetFile(dataRoot);
  if (fs.existsSync(legacy)) {
    try {
      const raw = readRawValue(legacy);
      const list = Array.isArray(raw) ? raw : [];
      for (const item of list) {
        const prepared = prepareExchange('mnalign', item, { strict: false }).value as unknown as AlignPreset;
        if (typeof prepared.id !== 'string' || out.some((x) => x.id === prepared.id)) continue;
        const preset = normalizePreset(prepared);
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
    name: input.name.trim() || msg('DEFAULT_NAME_ALIGN_PRESET'),
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
  const raw = readRawValue(file);
  if (!Array.isArray(raw)) return [];
  const out: ExportTemplate[] = [];
  let oldest = CURRENT_SCHEMA_VERSION.mnexp;
  let migrated = false;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    try {
      const prepared = prepareExchange('mnexp', item, { strict: false });
      if (prepared.migratedFrom !== undefined) {
        migrated = true;
        oldest = Math.min(oldest, prepared.migratedFrom);
      }
      out.push(prepared.value as unknown as ExportTemplate);
    } catch {
      // Newer or malformed item: still list it, but never rewrite it away.
      out.push(item as ExportTemplate);
    }
  }
  if (migrated) {
    writeBackupOnce(file, oldest);
    try {
      writeJsonFile(file, out);
    } catch {
      /* Read-only data directory: keep the migrated list in memory. */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function writeExportTemplates(dataRoot: string, list: ExportTemplate[]) {
  const file = exportTemplateFile(dataRoot);
  // A newer list is read-only; refuse instead of dropping fields we do not know.
  const current = readRawValue(file);
  if (Array.isArray(current)) {
    for (const item of current) {
      if (!item || typeof item !== 'object') continue;
      try {
        checkSchemaVersion('mnexp', (item as Record<string, unknown>).schemaVersion);
      } catch {
        throw new AppError(
          'ERR_SCHEMA_TOO_NEW',
          {
            found: Number((item as Record<string, unknown>).schemaVersion) || 0,
            supported: CURRENT_SCHEMA_VERSION.mnexp,
          },
          409,
        );
      }
    }
  }
  writeJsonFile(
    file,
    list.map((template) => prepareExchange('mnexp', template, { strict: false }).value),
  );
}

export function saveExportTemplate(
  dataRoot: string,
  input: { id?: string; name?: string; createdAt?: string; config: Partial<ExportConfig> },
): ExportTemplate {
  const template: ExportTemplate = {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : uid('ext'),
    name: (input.name ?? '').trim() || msg('DEFAULT_NAME_EXPORT_TEMPLATE'),
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
