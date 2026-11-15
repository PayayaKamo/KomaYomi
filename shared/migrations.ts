import type { Lang } from './types.ts';
import { LANGUAGES } from './types.ts';

/**
 * 交换文件 / 工程清单的版本迁移链。
 *
 * 每个迁移函数只负责「把上一版内容改成下一版内容」，不写磁盘、不校验；
 * 版本号与 `$schema` 由 shared/format.ts 统一补齐。这样迁移可以单独测试，
 * 也方便以后追加 v1 → v2。
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const APP_FALLBACK_VERSION = '0.1.0';

/** v0（早期试验版 manifest）：images 在顶层、字段叫 file、语言目录叫 langDirs */
export function migrateManifestV0(raw: Record<string, unknown>): Record<string, unknown> {
  const topImages = Array.isArray(raw.images) ? raw.images : [];
  const inventoryImages = isRecord(raw.inventory) && Array.isArray(raw.inventory.images) ? raw.inventory.images : [];
  const images = (topImages.length ? topImages : inventoryImages).filter(isRecord).map((img) => {
    const file = typeof img.path === 'string' ? img.path : typeof img.file === 'string' ? img.file : undefined;
    const pathValue = file ? file.replace(/\\/g, '/').replace(/^\/+/, '') : undefined;
    return {
      volume: String(img.volume ?? ''),
      chapter: String(img.chapter ?? ''),
      pageIndex: Number(img.pageIndex) || 0,
      lang: LANGUAGES.includes(img.lang as Lang) ? (img.lang as Lang) : 'ja',
      name: typeof img.name === 'string' && img.name ? img.name : pathValue ? (pathValue.split('/').pop() ?? '') : '',
      sha1: typeof img.sha1 === 'string' ? img.sha1 : '',
      size: Number(img.size) || 0,
      path: pathValue,
      asset: typeof img.asset === 'string' ? img.asset : undefined,
    };
  });

  const langDirs = isRecord(raw.langDirs) ? raw.langDirs : {};
  const volumes = new Map<string, { volume: string; chapters: Map<string, number> }>();
  for (const img of images) {
    if (!img.volume || !img.chapter) continue;
    const vol = volumes.get(img.volume) ?? { volume: img.volume, chapters: new Map<string, number>() };
    vol.chapters.set(img.chapter, Math.max(vol.chapters.get(img.chapter) ?? 0, img.pageIndex + 1));
    volumes.set(img.volume, vol);
  }

  const migrated: Record<string, unknown> = {
    // Unknown top-level fields survive a v0 → v1 round trip.
    ...raw,
    schemaVersion: 1,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : APP_FALLBACK_VERSION,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    storageMode: raw.storageMode === 'packaged' ? 'packaged' : 'reference',
    name: typeof raw.name === 'string' ? raw.name : undefined,
    language: { volumes: langDirs, resolved: langDirs },
    inventory: {
      volumes: [...volumes.values()].map((vol) => ({
        volume: vol.volume,
        languages: [...LANGUAGES],
        langDirs: (langDirs as Record<string, Record<string, string>>)[vol.volume] ?? {},
        chapters: [...vol.chapters.entries()].map(([chapter, pages]) => ({ chapter, pages, images: pages })),
      })),
      pageCount: Number(raw.pageCount) || 0,
      images,
    },
  };
  // Known v0 spellings are folded into `inventory`; anything else is kept as unknown.
  delete migrated.images;
  delete migrated.langDirs;
  delete migrated.pageCount;
  return migrated;
}

/** v0 版式模板：裸 LayoutTemplate（可能带 volume/chapter/pageIndex 绑定） */
export function migrateLayoutTemplateV0(raw: Record<string, unknown>): Record<string, unknown> {
  const layout = isRecord(raw.layout) ? raw.layout : raw;
  const grid = isRecord(layout.grid) ? layout.grid : undefined;
  if (!grid) throw new Error('版式模板缺少 grid，无法迁移');
  return {
    ...layout,
    id: typeof layout.id === 'string' && layout.id ? layout.id : `tpl${Date.now().toString(36)}`,
    name: typeof layout.name === 'string' && layout.name.trim() ? layout.name : '导入的版式模板',
    scope: 'template',
    readingDirection: layout.readingDirection,
    margin: layout.margin,
    gap: layout.gap,
    colWeights: layout.colWeights,
    grid,
    pageOverrides: layout.pageOverrides,
    createdAt: typeof layout.createdAt === 'string' ? layout.createdAt : new Date().toISOString(),
    notes: typeof layout.notes === 'string' ? layout.notes : undefined,
  };
}

/** v0 导出模板：裸 ExportTemplate、data/templates/export.json 的数组项，或裸 ExportConfig */
export function migrateExportTemplateV0(raw: Record<string, unknown>): Record<string, unknown> {
  const source = isRecord(raw.template) ? raw.template : raw;
  const config = isRecord(source.config)
    ? source.config
    : isRecord(source) && ('template' in source || 'pageWidthRatio' in source)
      ? source
      : {};
  return {
    ...source,
    id: typeof source.id === 'string' && source.id ? source.id : `ext${Date.now().toString(36)}`,
    name: typeof source.name === 'string' && source.name.trim() ? source.name : '导入的导出模板',
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    config,
  };
}

/** v0 页面 JSON：旧 data/pages 里的裸 PageDoc，只缺 envelope 字段 */
export function migratePageV0(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated: Record<string, unknown> = { ...raw, schemaVersion: 1 };
  // `version` was the pre-1.0 spelling; `schemaVersion` is now the single source.
  delete migrated.version;
  return migrated;
}
