import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ExportConfig, ExportTemplate, LayoutScope, LayoutTemplate, PageDoc } from '../shared/types.ts';
import { CURRENT_SCHEMA_VERSION, SCHEMA_URLS, prepareExchange, validateExchange } from '../shared/format.ts';
import { readLayout, saveLayout } from './layouts.ts';
import { listExportTemplates, saveExportTemplate } from './presets.ts';
import { pageFilePath, readPageDoc, writePageDoc } from './storage.ts';
import { projectFileName } from './project.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';

/**
 * Import/export for .mntpl / .mnexp / .mnpage.json.
 * Order: parse → validate → migrate → back up the original → atomic write; a failure never leaves partial output.
 */

const sha1Hex = (data: Buffer) => createHash('sha1').update(data).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Shared format errors already carry field paths; wrap them so the API can answer with a code. */
function prepare(kind: 'mntpl' | 'mnexp' | 'page', label: string, input: unknown) {
  try {
    return prepareExchange(kind, input);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AppError('ERR_EXCHANGE_VALIDATION', { label, errors: detail }, 400);
  }
}

export type ExchangeExportResult = {
  file: string;
  url: string;
  size: number;
  warnings: string[];
};

function writeTextAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeBufferAtomic(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function parsePayload(data: unknown, label: string): { value: unknown; text: string } {
  if (typeof data !== 'string' || !data.trim()) throw new AppError('ERR_EXCHANGE_EMPTY_FILE', { label }, 400);
  const trimmed = data.trim();
  const text =
    trimmed.startsWith('{') || trimmed.startsWith('[') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  try {
    return { value: JSON.parse(text) as unknown, text };
  } catch {
    throw new AppError('ERR_EXCHANGE_INVALID_JSON', { label }, 400);
  }
}

function safeSegment(input: string): string | null {
  const clean = String(input ?? '').trim();
  if (!clean || clean === '.' || clean === '..') return null;
  if (/[\\/:*?"<>|\0]/.test(clean)) return null;
  return clean;
}

function backupExchangeFile(dataRoot: string, extension: string, text: string): string {
  const dir = path.join(dataRoot, 'backups', 'exchange');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp()}-${sha1Hex(Buffer.from(text)).slice(0, 8)}${extension}`);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

function backupExistingPage(dataRoot: string, volume: string, chapter: string, pageIndex: number): string | null {
  const source = pageFilePath(dataRoot, volume, chapter, pageIndex);
  if (!fs.existsSync(source)) return null;
  const dir = path.join(dataRoot, 'backups', 'pages');
  fs.mkdirSync(dir, { recursive: true });
  const name = projectFileName(`${volume}-${chapter}-P${pageIndex + 1}`);
  const file = path.join(dir, `${stamp()}-${name}.json`);
  writeBufferAtomic(file, fs.readFileSync(source));
  return file;
}

function writeExportFile(exportRoot: string, file: string, value: unknown): ExchangeExportResult {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeTextAtomic(path.join(exportRoot, file), text);
  return {
    file,
    url: `/exports/${encodeURIComponent(file)}`,
    size: Buffer.byteLength(text, 'utf8'),
    warnings: [],
  };
}

/* ---------------- .mntpl ---------------- */

export function exportLayoutTemplate(opts: {
  rootDir: string;
  exportRoot: string;
  layoutId: string;
}): ExchangeExportResult & { layout: Record<string, unknown> } {
  const dataRoot = path.join(opts.rootDir, 'data');
  const layout = readLayout(dataRoot, opts.layoutId);
  if (!layout) throw new AppError('ERR_LAYOUT_NOT_FOUND', { layoutId: opts.layoutId }, 404);

  const value: Record<string, unknown> = {
    $schema: SCHEMA_URLS.mntpl,
    schemaVersion: CURRENT_SCHEMA_VERSION.mntpl,
    kind: 'mntpl',
    id: layout.id,
    name: layout.name,
    scope: 'template',
    readingDirection: layout.readingDirection ?? 'rtl',
    margin: layout.margin,
    gap: layout.gap,
    colWeights: layout.colWeights,
    grid: layout.grid,
    pageOverrides: layout.pageOverrides,
    createdAt: layout.createdAt ?? new Date().toISOString(),
    notes: layout.notes,
  };
  const check = validateExchange('mntpl', value);
  if (!check.ok) {
    throw new AppError(
      'ERR_EXCHANGE_VALIDATION',
      { label: t('LABEL_LAYOUT_TEMPLATE'), errors: check.errors.join('; ') },
      400,
    );
  }

  const file = `${projectFileName(layout.name || 'layout')}.mntpl`;
  return { ...writeExportFile(opts.exportRoot, file, value), layout: value };
}

export function importLayoutTemplate(opts: {
  rootDir: string;
  data: unknown;
  volume: string;
  chapter?: string;
  pageIndex?: number;
  scope?: LayoutScope;
  name?: string;
}): { layout: LayoutTemplate; migratedFrom?: number; backup: string; warnings: string[] } {
  const parsed = parsePayload(opts.data, t('LABEL_LAYOUT_TEMPLATE'));
  const prepared = prepare('mntpl', t('LABEL_LAYOUT_TEMPLATE'), parsed.value);
  const value = prepared.value;
  const dataRoot = path.join(opts.rootDir, 'data');

  const volume = String(opts.volume ?? '').trim();
  if (!volume || !safeSegment(volume)) throw new AppError('ERR_EXCHANGE_VOLUME_REQUIRED', {}, 400);
  const scope: LayoutScope = opts.scope === 'chapter' || opts.scope === 'page' ? opts.scope : 'volume';
  const chapter = String(opts.chapter ?? '').trim();
  if (scope !== 'volume' && (!chapter || !safeSegment(chapter))) {
    throw new AppError('ERR_EXCHANGE_CHAPTER_REQUIRED', {}, 400);
  }
  const pageIndex = Number.isInteger(opts.pageIndex) ? Number(opts.pageIndex) : undefined;
  if (scope === 'page' && (pageIndex === undefined || pageIndex < 0)) {
    throw new AppError('ERR_EXCHANGE_PAGE_INDEX_REQUIRED', {}, 400);
  }

  const backup = backupExchangeFile(dataRoot, '.mntpl', parsed.text);
  const layout = saveLayout(dataRoot, {
    id: typeof value.id === 'string' ? value.id : undefined,
    name: (opts.name ?? '').trim() || String(value.name ?? '').trim() || t('DEFAULT_NAME_IMPORTED_LAYOUT'),
    scope,
    volume,
    chapter: scope === 'volume' ? undefined : chapter,
    pageIndex: scope === 'page' ? pageIndex : undefined,
    readingDirection: value.readingDirection as LayoutTemplate['readingDirection'],
    margin: value.margin as LayoutTemplate['margin'],
    gap: value.gap as number | undefined,
    colWeights: value.colWeights as number[] | undefined,
    grid: value.grid as LayoutTemplate['grid'],
    pageOverrides: value.pageOverrides as LayoutTemplate['pageOverrides'],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  });

  return { layout, migratedFrom: prepared.migratedFrom, backup, warnings: prepared.warnings };
}

/* ---------------- .mnexp ---------------- */

export function exportExportTemplate(opts: {
  rootDir: string;
  exportRoot: string;
  templateId: string;
}): ExchangeExportResult & { template: Record<string, unknown> } {
  const dataRoot = path.join(opts.rootDir, 'data');
  const template = listExportTemplates(dataRoot).find((item) => item.id === opts.templateId);
  if (!template) throw new AppError('ERR_EXPORT_TEMPLATE_NOT_FOUND', { templateId: opts.templateId }, 404);

  const value: Record<string, unknown> = {
    $schema: SCHEMA_URLS.mnexp,
    schemaVersion: CURRENT_SCHEMA_VERSION.mnexp,
    kind: 'mnexp',
    id: template.id,
    name: template.name,
    createdAt: template.createdAt,
    config: template.config,
  };
  const check = validateExchange('mnexp', value);
  if (!check.ok) {
    throw new AppError(
      'ERR_EXCHANGE_VALIDATION',
      { label: t('LABEL_EXPORT_TEMPLATE'), errors: check.errors.join('; ') },
      400,
    );
  }

  const file = `${projectFileName(template.name || 'export-template')}.mnexp`;
  return { ...writeExportFile(opts.exportRoot, file, value), template: value };
}

export function importExportTemplate(opts: { rootDir: string; data: unknown }): {
  template: ExportTemplate;
  migratedFrom?: number;
  backup: string;
  warnings: string[];
} {
  const label = t('LABEL_EXPORT_TEMPLATE');
  const parsed = parsePayload(opts.data, label);
  const source = Array.isArray(parsed.value)
    ? parsed.value.find(isRecord)
    : isRecord(parsed.value)
      ? parsed.value
      : undefined;
  if (!source) throw new AppError('ERR_EXPORT_TEMPLATE_SHAPE', {}, 400);

  const prepared = prepare('mnexp', label, source);
  const value = prepared.value;
  const dataRoot = path.join(opts.rootDir, 'data');
  const backup = backupExchangeFile(dataRoot, '.mnexp', parsed.text);
  const template = saveExportTemplate(dataRoot, {
    id: typeof value.id === 'string' ? value.id : undefined,
    name: String(value.name ?? '').trim() || t('DEFAULT_NAME_IMPORTED_EXPORT_TEMPLATE'),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    config: isRecord(value.config) ? (value.config as Partial<ExportConfig>) : {},
  });

  return { template, migratedFrom: prepared.migratedFrom, backup, warnings: prepared.warnings };
}

/* ---------------- Single page .mnpage.json ---------------- */

export function exportPage(opts: {
  rootDir: string;
  exportRoot: string;
  volume: string;
  chapter: string;
  pageIndex: number;
}): ExchangeExportResult & { page: Record<string, unknown> } {
  const dataRoot = path.join(opts.rootDir, 'data');
  const doc = readPageDoc(dataRoot, opts.volume, opts.chapter, opts.pageIndex);
  if (!doc) throw new AppError('ERR_PAGE_NOT_SAVED', {}, 400);

  const value: Record<string, unknown> = {
    ...doc,
    $schema: SCHEMA_URLS.page,
    kind: 'page',
  };
  const check = validateExchange('page', value);
  if (!check.ok) {
    throw new AppError(
      'ERR_EXCHANGE_VALIDATION',
      { label: t('LABEL_PAGE_JSON'), errors: check.errors.join('; ') },
      400,
    );
  }

  const file = `${projectFileName(`${opts.volume}-${opts.chapter}-P${opts.pageIndex + 1}`)}.mnpage.json`;
  return { ...writeExportFile(opts.exportRoot, file, value), page: value };
}

export function importPage(opts: {
  rootDir: string;
  data: unknown;
  volume?: string;
  chapter?: string;
  pageIndex?: number;
}): {
  doc: PageDoc;
  migratedFrom?: number;
  backup: string;
  targetBackup: string | null;
  warnings: string[];
} {
  const label = t('LABEL_PAGE_JSON');
  const parsed = parsePayload(opts.data, label);
  if (!isRecord(parsed.value)) throw new AppError('ERR_PAGE_SHAPE', {}, 400);
  const prepared = prepare('page', label, parsed.value);
  const value = prepared.value;

  const volume = String(opts.volume ?? value.volume ?? '').trim();
  const chapter = String(opts.chapter ?? value.chapter ?? '').trim();
  if (!volume || !chapter) throw new AppError('ERR_PAGE_TARGET_MISSING', {}, 400);
  if (!safeSegment(volume) || !safeSegment(chapter)) throw new AppError('ERR_UNSAFE_SEGMENT', {}, 400);
  const pageIndex = Number.isInteger(opts.pageIndex) ? Number(opts.pageIndex) : Number(value.pageIndex);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new AppError('ERR_PAGE_INDEX_INVALID', {}, 400);

  const bound: Record<string, unknown> = { ...value, volume, chapter, pageIndex };
  const check = validateExchange('page', bound);
  if (!check.ok) {
    throw new AppError('ERR_EXCHANGE_VALIDATION', { label, errors: check.errors.join('; ') }, 400);
  }

  const dataRoot = path.join(opts.rootDir, 'data');
  const backup = backupExchangeFile(dataRoot, '.mnpage.json', parsed.text);
  const targetBackup = backupExistingPage(dataRoot, volume, chapter, pageIndex);
  const doc = writePageDoc(dataRoot, bound as unknown as PageDoc, { source: 'import' });

  return { doc, migratedFrom: prepared.migratedFrom, backup, targetBackup, warnings: prepared.warnings };
}
