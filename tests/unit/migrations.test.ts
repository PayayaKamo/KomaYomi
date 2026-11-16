import { describe, expect, it } from 'vitest';
import {
  migrateExportTemplateV0,
  migrateLayoutTemplateV0,
  migrateManifestV0,
  migratePageV0,
} from '../../shared/migrations.ts';

type MigratedImage = {
  volume: string;
  chapter: string;
  pageIndex: number;
  lang: string;
  name: string;
  sha1: string;
  size: number;
  path?: string;
  asset?: string;
};

type MigratedInventory = {
  volumes: {
    volume: string;
    languages: string[];
    langDirs: Record<string, string>;
    chapters: { chapter: string; pages: number; images: number }[];
  }[];
  pageCount: number;
  images: MigratedImage[];
};

const inventoryOf = (out: Record<string, unknown>) => out.inventory as MigratedInventory;

describe('migrateManifestV0 image sources', () => {
  it('reads top-level images, normalizes backslashes and fills defaults', () => {
    const out = migrateManifestV0({
      images: [
        { path: '\\manga\\vol1\\001.png', volume: 'v1', chapter: 'c1', pageIndex: 1, size: '2048', sha1: 'abc' },
      ],
    });
    const image = inventoryOf(out).images[0];
    expect(image).toMatchObject({
      volume: 'v1',
      chapter: 'c1',
      pageIndex: 1,
      lang: 'ja',
      name: '001.png',
      path: 'manga/vol1/001.png',
      sha1: 'abc',
      size: 2048,
    });
    expect(image.asset).toBeUndefined();
  });

  it('strips leading slashes from image paths', () => {
    const out = migrateManifestV0({ images: [{ path: '/abs/dir/002.png' }] });
    expect(inventoryOf(out).images[0].path).toBe('abs/dir/002.png');
    expect(inventoryOf(out).images[0].name).toBe('002.png');
  });

  it('falls back to inventory.images and the legacy file field', () => {
    const out = migrateManifestV0({
      inventory: { images: [{ file: 'raw/ja/002.png', volume: 2, chapter: 3 }] },
    });
    expect(inventoryOf(out).images[0]).toMatchObject({
      volume: '2',
      chapter: '3',
      path: 'raw/ja/002.png',
      name: '002.png',
      pageIndex: 0,
    });
  });

  it('prefers top-level images over inventory images', () => {
    const out = migrateManifestV0({
      images: [{ path: 'top/001.png' }],
      inventory: { images: [{ path: 'nested/001.png' }] },
    });
    expect(inventoryOf(out).images.map((image) => image.path)).toEqual(['top/001.png']);
  });

  it('falls back to inventory when top-level images is empty', () => {
    const out = migrateManifestV0({ images: [], inventory: { images: [{ path: 'n/001.png' }] } });
    expect(inventoryOf(out).images.map((image) => image.path)).toEqual(['n/001.png']);
  });

  it('skips non-object image entries', () => {
    const out = migrateManifestV0({ images: [null, 'x', 3, { path: 'ok.png' }] });
    expect(inventoryOf(out).images.map((image) => image.path)).toEqual(['ok.png']);
  });

  it('prefers path over file and accepts a bare file', () => {
    const out = migrateManifestV0({
      images: [{ path: 'p.png', file: 'f.png', name: 'custom' }, { file: 'only-file.png' }],
    });
    const images = inventoryOf(out).images;
    expect(images[0]).toMatchObject({ path: 'p.png', name: 'custom' });
    expect(images[1]).toMatchObject({ path: 'only-file.png', name: 'only-file.png' });
  });

  it('leaves path undefined and name empty without a string file field', () => {
    const image = inventoryOf(migrateManifestV0({ images: [{ path: 12 }] })).images[0];
    expect(image.path).toBeUndefined();
    expect(image.name).toBe('');
  });

  it('defaults lang to ja and trims provided values', () => {
    const out = migrateManifestV0({
      images: [{ path: 'a.png', lang: '  zh ' }, { path: 'b.png' }, { path: 'c.png', lang: '   ' }],
    });
    expect(inventoryOf(out).images.map((image) => image.lang)).toEqual(['zh', 'ja', 'ja']);
  });

  it('falls back to the filename when name is empty', () => {
    const image = inventoryOf(migrateManifestV0({ images: [{ path: 'dir/009.png', name: '' }] })).images[0];
    expect(image.name).toBe('009.png');
  });

  it('coerces numeric fields and drops non-string extras', () => {
    const image = inventoryOf(
      migrateManifestV0({ images: [{ path: 'a.png', pageIndex: 'abc', size: 'abc', sha1: 42, asset: 5 }] }),
    ).images[0];
    expect(image.pageIndex).toBe(0);
    expect(image.size).toBe(0);
    expect(image.sha1).toBe('');
    expect(image.asset).toBeUndefined();
  });
});

describe('migrateManifestV0 inventory', () => {
  it('aggregates volumes and chapters, skipping images without them', () => {
    const out = migrateManifestV0({
      images: [
        { path: 'v1/c1/1.png', volume: 'v1', chapter: 'c1', pageIndex: 0 },
        { path: 'v1/c1/2.png', volume: 'v1', chapter: 'c1', pageIndex: 1 },
        { path: 'v1/c2/1.png', volume: 'v1', chapter: 'c2', pageIndex: 4 },
        { path: 'v2/c1/1.png', volume: 'v2', chapter: 'c1', pageIndex: 0 },
        { path: 'orphan.png' },
      ],
    });
    const inv = inventoryOf(out);
    expect(inv.volumes.map((volume) => volume.volume)).toEqual(['v1', 'v2']);
    expect(inv.volumes[0].chapters).toEqual([
      { chapter: 'c1', pages: 2, images: 2 },
      { chapter: 'c2', pages: 5, images: 5 },
    ]);
    expect(inv.volumes[1].chapters).toEqual([{ chapter: 'c1', pages: 1, images: 1 }]);
    expect(inv.volumes[0].languages).toEqual(['ja', 'zh', 'en']);
    expect(inv.images).toHaveLength(5);
  });

  it('attaches langDirs per volume and keeps them shared under language', () => {
    const langDirs = { v1: { ja: '日本語', zh: '中文' } };
    const out = migrateManifestV0({
      images: [{ path: 'v1/c/1.png', volume: 'v1', chapter: 'c' }],
      langDirs,
      pageCount: 9,
    });
    const inv = inventoryOf(out);
    expect(inv.volumes[0].langDirs).toBe(langDirs.v1);
    expect(inv.volumes[0].languages).toEqual(['ja', 'zh', 'en']);
    expect(inv.pageCount).toBe(9);
    expect((out.language as { volumes: unknown }).volumes).toBe(langDirs);
    expect((out.language as { resolved: unknown }).resolved).toBe(langDirs);
  });

  it('defaults pageCount to zero and coerces a numeric string', () => {
    expect(inventoryOf(migrateManifestV0({})).pageCount).toBe(0);
    expect(inventoryOf(migrateManifestV0({ pageCount: '6' })).pageCount).toBe(6);
  });
});

describe('migrateManifestV0 envelope', () => {
  it('keeps unknown top-level fields and removes known v0 spellings', () => {
    const out = migrateManifestV0({
      images: [{ path: 'a.png' }],
      langDirs: {},
      pageCount: 4,
      name: 'library',
      storageMode: 'packaged',
      appVersion: '9.9.9',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
      custom: { keep: true },
      author: 'someone',
    });
    expect(out.schemaVersion).toBe(1);
    expect(out.name).toBe('library');
    expect(out.appVersion).toBe('9.9.9');
    expect(out.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(out.updatedAt).toBe('2020-01-02T00:00:00.000Z');
    expect(out.storageMode).toBe('packaged');
    expect(out.custom).toEqual({ keep: true });
    expect(out.author).toBe('someone');
    expect(out).not.toHaveProperty('images');
    expect(out).not.toHaveProperty('langDirs');
    expect(out).not.toHaveProperty('pageCount');
    expect(out.language).toEqual({ volumes: {}, resolved: {} });
  });

  it('fills defaults for missing metadata', () => {
    const out = migrateManifestV0({});
    expect(out.appVersion).toBe('0.1.0');
    expect(out.storageMode).toBe('reference');
    expect(String(out.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(out.updatedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.name).toBeUndefined();
  });

  it('treats unknown storage modes as reference', () => {
    expect(migrateManifestV0({ storageMode: 'cloud' }).storageMode).toBe('reference');
  });

  it('drops a non-string name', () => {
    expect(migrateManifestV0({ name: 42 }).name).toBeUndefined();
  });
});

describe('migrateLayoutTemplateV0', () => {
  it('migrates a bare v0 layout', () => {
    const grid = { cols: 2, rows: [{ cells: [{}, {}] }] };
    const out = migrateLayoutTemplateV0({
      id: 't1',
      name: 'Mine',
      grid,
      readingDirection: 'rtl',
      margin: { top: 1 },
      gap: 0.1,
      colWeights: [1, 1],
      pageOverrides: {},
    });
    expect(out).toMatchObject({
      id: 't1',
      name: 'Mine',
      scope: 'template',
      readingDirection: 'rtl',
      margin: { top: 1 },
      gap: 0.1,
      colWeights: [1, 1],
      pageOverrides: {},
    });
    expect(out.grid).toBe(grid);
    expect(String(out.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.notes).toBeUndefined();
  });

  it('unwraps a layout field and regenerates missing defaults', () => {
    const out = migrateLayoutTemplateV0({
      layout: { grid: { cols: 1, rows: [] }, scope: 'volume', volume: 'v1' },
    });
    expect(String(out.id)).toMatch(/^tpl/);
    expect(out.name).toBe('导入的版式模板');
    expect(out.scope).toBe('template');
    expect(out.volume).toBe('v1');
  });

  it('throws when the grid is missing', () => {
    expect(() => migrateLayoutTemplateV0({ name: 'x' })).toThrow('版式模板缺少 grid');
    expect(() => migrateLayoutTemplateV0({ layout: { name: 'x' } })).toThrow('grid');
    expect(() => migrateLayoutTemplateV0({ grid: null })).toThrow('grid');
  });

  it('keeps provided createdAt and notes', () => {
    const out = migrateLayoutTemplateV0({
      grid: {},
      createdAt: '2020-01-01T00:00:00.000Z',
      notes: 'n',
    });
    expect(out.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(out.notes).toBe('n');
  });

  it('falls back on an empty id and a blank name', () => {
    const out = migrateLayoutTemplateV0({ id: '', name: '   ', grid: {} });
    expect(String(out.id)).toMatch(/^tpl/);
    expect(out.name).toBe('导入的版式模板');
  });
});

describe('migrateExportTemplateV0', () => {
  it('unwraps a template field', () => {
    const out = migrateExportTemplateV0({
      template: { id: 'e1', name: 'Sheet', config: { pageWidthRatio: 50 } },
      extra: 1,
    });
    expect(out.id).toBe('e1');
    expect(out.name).toBe('Sheet');
    expect(out.config).toEqual({ pageWidthRatio: 50 });
    expect(out).not.toHaveProperty('extra');
  });

  it('treats a bare config containing template as the config', () => {
    const raw = { template: 'stack', pageWidthRatio: 30 };
    const out = migrateExportTemplateV0(raw);
    expect(out.config).toBe(raw);
    expect(String(out.id)).toMatch(/^ext/);
    expect(out.name).toBe('导入的导出模板');
  });

  it('treats a bare object with pageWidthRatio as the config', () => {
    const raw = { pageWidthRatio: 42, fontScale: 2 };
    expect(migrateExportTemplateV0(raw).config).toBe(raw);
  });

  it('defaults config to an empty object', () => {
    const out = migrateExportTemplateV0({ id: 'x', name: 'n' });
    expect(out.config).toEqual({});
    expect(out.id).toBe('x');
    expect(out.name).toBe('n');
  });

  it('uses defaults for an empty object', () => {
    const out = migrateExportTemplateV0({});
    expect(String(out.id)).toMatch(/^ext/);
    expect(out.name).toBe('导入的导出模板');
    expect(out.config).toEqual({});
    expect(String(out.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps createdAt and falls back for a blank name', () => {
    const out = migrateExportTemplateV0({ name: ' ', createdAt: '2020-01-01T00:00:00.000Z' });
    expect(out.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(out.name).toBe('导入的导出模板');
  });

  it('ignores a non-object config and a wrapped template without config', () => {
    expect(migrateExportTemplateV0({ config: 'x' }).config).toEqual({});
    expect(migrateExportTemplateV0({ template: { name: 'T' } }).config).toEqual({});
  });
});

describe('migratePageV0', () => {
  it('bumps schemaVersion and drops the legacy version', () => {
    const out = migratePageV0({
      version: '0.9',
      volume: 'v1',
      chapter: 'c1',
      pageIndex: 2,
      updatedAt: 't',
      panels: [],
      notes: [],
    });
    expect(out.schemaVersion).toBe(1);
    expect(out).not.toHaveProperty('version');
    expect(out).toMatchObject({ volume: 'v1', chapter: 'c1', pageIndex: 2, updatedAt: 't', panels: [], notes: [] });
  });

  it('adds schemaVersion when the page had none', () => {
    const out = migratePageV0({ volume: 'v' });
    expect(out.schemaVersion).toBe(1);
    expect(out.volume).toBe('v');
  });
});
