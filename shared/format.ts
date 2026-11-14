import type { ExportTemplate, LayoutTemplate, PageDoc } from './types.ts';
import { LANGUAGES } from './types.ts';
import {
  migrateExportTemplateV0,
  migrateLayoutTemplateV0,
  migrateManifestV0,
  migratePageV0,
} from './migrations.ts';

/**
 * 统一交换格式：`$schema` + `schemaVersion` envelope，见 shared/schemas/*.json。
 * 这里的小校验器不依赖任何 npm 包，只校验「运行时必须存在的字段」，
 * 错误会带精确路径，例如 `manifest.volumes[2].chapters: required`。
 */

export const SCHEMA_BASE = 'https://manga-memo.dev/schemas/';

export const SCHEMA_URLS = {
  mnproj: `${SCHEMA_BASE}mnproj.schema.json`,
  mntpl: `${SCHEMA_BASE}mntpl.schema.json`,
  mnexp: `${SCHEMA_BASE}mnexp.schema.json`,
  page: `${SCHEMA_BASE}page.schema.json`,
} as const;

export type ExchangeKind = keyof typeof SCHEMA_URLS;

export const FORMAT_LABEL: Record<ExchangeKind, string> = {
  mnproj: '工程文件',
  mntpl: '版式模板',
  mnexp: '导出模板',
  page: '页面 JSON',
};

export const CURRENT_SCHEMA_VERSION: Record<ExchangeKind, number> = {
  mnproj: 1,
  mntpl: 1,
  mnexp: 1,
  page: 1,
};

export const FORMAT_EXTENSION: Record<ExchangeKind, string> = {
  mnproj: '.mnproj',
  mntpl: '.mntpl',
  mnexp: '.mnexp',
  page: '.mnpage.json',
};

export type LayoutTemplateExchange = Omit<LayoutTemplate, 'scope' | 'volume' | 'chapter' | 'pageIndex'> & {
  scope: 'template';
};

export type ExportTemplateExchange = ExportTemplate & {
  $schema: string;
  schemaVersion: number;
  kind: 'mnexp';
};

export type PageExchange = PageDoc & {
  $schema: string;
  schemaVersion: number;
  kind: 'page';
};

export type ValidationResult = { ok: boolean; errors: string[] };

export type PreparedExchange = {
  kind: ExchangeKind;
  value: Record<string, unknown>;
  version: number;
  migratedFrom?: number;
  warnings: string[];
};

type Spec =
  | { kind: 'object'; fields: Record<string, Spec>; required: readonly string[]; allowUnknown: boolean }
  | { kind: 'array'; items: Spec; minItems?: number }
  | { kind: 'record'; values: Spec }
  | { kind: 'string'; enum?: readonly string[]; minLength?: number }
  | { kind: 'number'; integer?: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'nullable'; inner: Spec }
  | { kind: 'any' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const object = (
  fields: Record<string, Spec>,
  required: readonly string[] = Object.keys(fields),
  allowUnknown = true,
): Spec => ({ kind: 'object', fields, required, allowUnknown });

const array = (items: Spec, minItems?: number): Spec => ({ kind: 'array', items, minItems });
const record = (values: Spec): Spec => ({ kind: 'record', values });
const str = (opts: { enum?: readonly string[]; minLength?: number } = {}): Spec => ({
  kind: 'string',
  ...opts,
});
const num = (opts: { min?: number; max?: number } = {}): Spec => ({ kind: 'number', ...opts });
const int = (opts: { min?: number; max?: number } = {}): Spec => ({
  kind: 'number',
  integer: true,
  ...opts,
});
const bool = (): Spec => ({ kind: 'boolean' });
const nullable = (inner: Spec): Spec => ({ kind: 'nullable', inner });

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);
const where = (path: string) => path || '(root)';

function validateSpec(value: unknown, spec: Spec, path: string, errors: string[]): void {
  if (spec.kind === 'any') return;
  if (spec.kind === 'nullable') {
    if (value === null) return;
    validateSpec(value, spec.inner, path, errors);
    return;
  }
  if (path && value === undefined) {
    errors.push(`${path}: required`);
    return;
  }

  if (spec.kind === 'object') {
    if (!isRecord(value)) {
      errors.push(`${where(path)}: expected object`);
      return;
    }
    for (const key of spec.required) {
      if (!(key in value) || value[key] === undefined) errors.push(`${join(path, key)}: required`);
    }
    for (const [key, child] of Object.entries(spec.fields)) {
      if (!(key in value) || value[key] === undefined) continue;
      validateSpec(value[key], child, join(path, key), errors);
    }
    if (!spec.allowUnknown) {
      for (const key of Object.keys(value)) {
        if (!(key in spec.fields)) errors.push(`${join(path, key)}: unknown field`);
      }
    }
    return;
  }

  if (spec.kind === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${where(path)}: expected array`);
      return;
    }
    if (spec.minItems !== undefined && value.length < spec.minItems) {
      errors.push(`${where(path)}: expected at least ${spec.minItems} item(s)`);
    }
    value.forEach((item, index) => validateSpec(item, spec.items, `${path}[${index}]`, errors));
    return;
  }

  if (spec.kind === 'record') {
    if (!isRecord(value)) {
      errors.push(`${where(path)}: expected object`);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      validateSpec(child, spec.values, join(path, key), errors);
    }
    return;
  }

  if (spec.kind === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${where(path)}: expected string`);
      return;
    }
    if (spec.minLength !== undefined && value.length < spec.minLength) {
      errors.push(`${where(path)}: must not be empty`);
    }
    if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`${where(path)}: expected one of ${spec.enum.join(', ')}`);
    }
    return;
  }

  if (spec.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${where(path)}: expected number`);
      return;
    }
    if (spec.integer && !Number.isInteger(value)) {
      errors.push(`${where(path)}: expected integer`);
      return;
    }
    if (spec.min !== undefined && value < spec.min) errors.push(`${where(path)}: must be >= ${spec.min}`);
    if (spec.max !== undefined && value > spec.max) errors.push(`${where(path)}: must be <= ${spec.max}`);
    return;
  }

  if (spec.kind === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${where(path)}: expected boolean`);
  }
}

/* ---------------- 各格式的字段表 ---------------- */

const offsetSpec = object({ x: num(), y: num(), scale: num() });
const rectSpec = object({ x: num(), y: num(), w: num(), h: num() });
const marginSpec = object({ top: num(), right: num(), bottom: num(), left: num() }, []);

const layoutCellSpec = object({ span: int({ min: 1 }) }, []);
const layoutRowSpec = object({ height: num(), cells: array(layoutCellSpec, 1) }, ['cells']);
const gridSpec = object({ cols: int({ min: 1, max: 12 }), rows: array(layoutRowSpec, 1) }, ['cols', 'rows']);
const pageOverrideSpec = object(
  { grid: gridSpec, margin: marginSpec, gap: num(), colWeights: array(num()) },
  [],
);

const panelSpec = object(
  {
    id: str({ minLength: 1 }),
    rect: rectSpec,
    source: str({ enum: ['auto', 'manual', 'merged'] }),
    number: int({ min: 1 }),
  },
  ['id', 'rect'],
);

const noteSourceSpec = object({ title: str(), url: str(), text: str() }, []);
const noteImageSpec = object({ id: str({ minLength: 1 }), name: str(), dataUrl: str() });
const noteSpec = object(
  {
    id: str({ minLength: 1 }),
    scope: str({ enum: ['page', 'panel'] }),
    panelId: nullable(str()),
    text: str(),
    tags: array(str()),
    source: noteSourceSpec,
    images: array(noteImageSpec),
    createdAt: str(),
    updatedAt: str(),
  },
  ['id', 'scope', 'text', 'createdAt', 'updatedAt'],
);

const groupSpec = object(
  {
    id: str({ minLength: 1 }),
    name: str(),
    panelIds: array(str()),
    number: int({ min: 1 }),
  },
  ['id', 'panelIds'],
);

const annotationSpec = object(
  {
    id: str({ minLength: 1 }),
    kind: str({ enum: ['arrow', 'rect', 'ellipse', 'highlight', 'text', 'badge', 'mosaic', 'pen'] }),
    scope: str({ enum: ['page', 'panel'] }),
    panelId: nullable(str()),
    points: array(object({ x: num(), y: num() }), 1),
    color: str(),
    width: num(),
    opacity: num(),
    text: str(),
    fontSize: num(),
    createdAt: str(),
    updatedAt: str(),
  },
  ['id', 'kind', 'scope', 'points', 'createdAt', 'updatedAt'],
);

const pageSpec = object(
  {
    version: int({ min: 1 }),
    $schema: str(),
    schemaVersion: int({ min: 0 }),
    kind: str({ enum: ['page'] }),
    volume: str({ minLength: 1 }),
    chapter: str({ minLength: 1 }),
    pageIndex: int({ min: 0 }),
    panels: array(panelSpec),
    notes: array(noteSpec),
    offsets: record(offsetSpec),
    alignMode: str({ enum: ['page', 'panel', 'anchors', 'grid'] }),
    panelOffsets: record(record(offsetSpec)),
    gridStep: num(),
    readingDirection: str({ enum: ['rtl', 'ltr', 'ttb'] }),
    updatedAt: str({ minLength: 1 }),
    detectorVersion: str(),
    detectedAt: str(),
    detectSource: str({ enum: ['auto', 'template', 'plugin', 'manual'] }),
    editCount: int({ min: 0 }),
    lastEditedAt: str(),
    lastEditSummary: str(),
    groups: array(groupSpec),
    annotations: array(annotationSpec),
    annotationsVisible: bool(),
  },
  [
    '$schema',
    'schemaVersion',
    'kind',
    'volume',
    'chapter',
    'pageIndex',
    'panels',
    'notes',
    'offsets',
    'alignMode',
    'panelOffsets',
    'readingDirection',
    'updatedAt',
  ],
);

const layoutSpec = object(
  {
    $schema: str(),
    schemaVersion: int({ min: 0 }),
    kind: str({ enum: ['mntpl'] }),
    id: str({ minLength: 1 }),
    name: str({ minLength: 1 }),
    scope: str({ enum: ['template'] }),
    readingDirection: str({ enum: ['rtl', 'ltr', 'ttb'] }),
    margin: marginSpec,
    gap: num(),
    colWeights: array(num()),
    grid: gridSpec,
    pageOverrides: record(pageOverrideSpec),
    createdAt: str(),
    notes: str(),
  },
  ['$schema', 'schemaVersion', 'kind', 'id', 'name', 'scope', 'grid'],
  false,
);

const exportConfigSpec = object(
  {
    template: str({ enum: ['two-column', 'stack', 'compare-wide'] }),
    title: str(),
    volume: str(),
    chapter: str(),
    pageIndices: array(int({ min: 0 })),
    languages: array(str({ enum: LANGUAGES })),
    embedImages: bool(),
    offsets: record(offsetSpec),
    showPanelBoxes: bool(),
    includeNotes: bool(),
    onlyWithNotes: bool(),
    noteFilterTags: array(str()),
    pageWidthRatio: num(),
    columnGap: num(),
    fontScale: num(),
    columns: num(),
  },
  [],
);

const exportTemplateSpec = object(
  {
    $schema: str(),
    schemaVersion: int({ min: 0 }),
    kind: str({ enum: ['mnexp'] }),
    id: str({ minLength: 1 }),
    name: str({ minLength: 1 }),
    createdAt: str(),
    config: exportConfigSpec,
  },
  ['$schema', 'schemaVersion', 'kind', 'id', 'name', 'createdAt', 'config'],
  false,
);

const langDirsSpec = record(str());
const inventoryChapterSpec = object(
  { chapter: str(), pages: int({ min: 0 }), images: int({ min: 0 }) },
  ['chapter'],
);
const inventoryVolumeSpec = object(
  {
    volume: str({ minLength: 1 }),
    languages: array(str({ enum: LANGUAGES })),
    langDirs: langDirsSpec,
    chapters: array(inventoryChapterSpec),
  },
  ['volume', 'chapters'],
);
const inventoryImageSpec = object(
  {
    volume: str({ minLength: 1 }),
    chapter: str({ minLength: 1 }),
    pageIndex: int({ min: 0 }),
    lang: str({ enum: LANGUAGES }),
    name: str({ minLength: 1 }),
    sha1: str(),
    size: int({ min: 0 }),
    path: str(),
    asset: str(),
  },
  ['volume', 'chapter', 'pageIndex', 'lang', 'name'],
);
const inventorySpec = object(
  { volumes: array(inventoryVolumeSpec), pageCount: int({ min: 0 }), images: array(inventoryImageSpec) },
  ['volumes', 'images'],
);
const manifestNotesSpec = object(
  { pages: int({ min: 0 }), noteCount: int({ min: 0 }), annotationCount: int({ min: 0 }), text: str() },
  [],
);

const manifestSpec = object(
  {
    $schema: str(),
    schemaVersion: int({ min: 0 }),
    appVersion: str(),
    createdAt: str(),
    updatedAt: str(),
    storageMode: str({ enum: ['reference', 'packaged'] }),
    name: str(),
    language: object({ volumes: record(langDirsSpec), resolved: record(langDirsSpec) }, ['volumes', 'resolved']),
    inventory: inventorySpec,
    notes: manifestNotesSpec,
  },
  ['schemaVersion', 'storageMode', 'language', 'inventory'],
);

const SPECS: Record<ExchangeKind, Spec> = {
  mnproj: manifestSpec,
  mntpl: layoutSpec,
  mnexp: exportTemplateSpec,
  page: pageSpec,
};

/** 只做校验，不迁移。返回的 errors 直接带字段路径。 */
export function validateExchange(kind: ExchangeKind, value: unknown): ValidationResult {
  const errors: string[] = [];
  validateSpec(value, SPECS[kind], kind === 'mnproj' ? 'manifest' : '', errors);
  return { ok: errors.length === 0, errors };
}

export function assertExchange(kind: ExchangeKind, value: unknown, label = FORMAT_LABEL[kind]): void {
  const result = validateExchange(kind, value);
  if (!result.ok) throw new Error(`${label}格式不正确：${result.errors.join('；')}`);
}

/** 未来版本直接拒绝；缺省 version 视为 v0（旧文件）。 */
export function checkSchemaVersion(kind: ExchangeKind, declared: unknown): number {
  if (declared === undefined || declared === null) return 0;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 0) {
    throw new Error(`${FORMAT_LABEL[kind]}：schemaVersion: expected non-negative integer`);
  }
  if (declared > CURRENT_SCHEMA_VERSION[kind]) {
    throw new Error(
      `${FORMAT_LABEL[kind]}版本过高（schemaVersion ${declared}，当前支持 ${CURRENT_SCHEMA_VERSION[kind]}），请升级应用后再打开`,
    );
  }
  return declared;
}

const MIGRATIONS: Record<ExchangeKind, Record<number, (value: Record<string, unknown>) => Record<string, unknown>>> = {
  mnproj: { 0: migrateManifestV0 },
  mntpl: { 0: migrateLayoutTemplateV0 },
  mnexp: { 0: migrateExportTemplateV0 },
  page: { 0: migratePageV0 },
};

function finalizeEnvelope(kind: ExchangeKind, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  out.$schema = SCHEMA_URLS[kind];
  out.schemaVersion = CURRENT_SCHEMA_VERSION[kind];
  if (kind !== 'mnproj') out.kind = kind;
  if (kind === 'mntpl') {
    delete out.volume;
    delete out.chapter;
    delete out.pageIndex;
    out.scope = 'template';
  }
  return out;
}

/**
 * 解析 → 版本检查 → 迁移链 → 补齐 envelope → 全量校验。
 * 任何一步失败都会抛错，不会返回半成品，调用方因此可以「先校验再写盘」。
 */
export function prepareExchange(kind: ExchangeKind, input: unknown): PreparedExchange {
  if (!isRecord(input)) throw new Error(`${FORMAT_LABEL[kind]}不是 JSON 对象`);
  const declared = checkSchemaVersion(kind, input.schemaVersion);
  let value: Record<string, unknown> = input;
  let version = declared;
  while (version < CURRENT_SCHEMA_VERSION[kind]) {
    const migrate = MIGRATIONS[kind][version];
    if (!migrate) {
      throw new Error(`${FORMAT_LABEL[kind]}缺少 v${version}→v${version + 1} 的迁移规则`);
    }
    value = migrate(value);
    version++;
  }
  value = finalizeEnvelope(kind, value);
  const result = validateExchange(kind, value);
  if (!result.ok) throw new Error(`${FORMAT_LABEL[kind]}格式不正确：${result.errors.join('；')}`);
  return {
    kind,
    value,
    version,
    migratedFrom: declared < CURRENT_SCHEMA_VERSION[kind] ? declared : undefined,
    warnings: [],
  };
}

/** 通过 `$schema` / `kind` / 关键字段猜测格式，供导入时给出更友好的提示。 */
export function detectExchangeKind(value: unknown): ExchangeKind | null {
  if (!isRecord(value)) return null;
  const schema = typeof value.$schema === 'string' ? value.$schema : '';
  for (const kind of Object.keys(SCHEMA_URLS) as ExchangeKind[]) {
    if (schema === SCHEMA_URLS[kind] || schema.endsWith(`/${kind}.schema.json`)) return kind;
  }
  if (value.kind === 'mntpl' || value.kind === 'mnexp' || value.kind === 'page') return value.kind;
  if (isRecord(value.inventory) && typeof value.storageMode === 'string') return 'mnproj';
  if (isRecord(value.grid) && Array.isArray((value.grid as Record<string, unknown>).rows)) return 'mntpl';
  if (isRecord(value.config)) return 'mnexp';
  if (Array.isArray(value.panels) && Array.isArray(value.notes)) return 'page';
  return null;
}

/** 把校验失败信息压缩成一行，便于 UI 直接展示。 */
export function formatErrors(errors: string[], limit = 8): string {
  if (!errors.length) return '';
  const head = errors.slice(0, limit).join('；');
  return errors.length > limit ? `${head}；…共 ${errors.length} 处` : head;
}
