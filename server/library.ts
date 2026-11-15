import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, LANG_LABEL, SINGLE_CHAPTER } from '../shared/types.ts';
import { preserveUnknown } from '../shared/format.ts';
import { assertWritableFile, readRawRecord, readStoredFile, writeStoredFile } from './schemaStore.ts';
import type { Lang, Library, PageEntry, ChapterEntry, VolumeEntry } from '../shared/types.ts';
import { DEFAULT_RULES, resolveFiles, validateRules } from './dirRules.ts';
import type { DirRule, UnmatchedFile } from './dirRules.ts';
import { AppError } from './errors.ts';
import { langName, t } from './messages/index.ts';

export { LANGUAGES, LANG_LABEL, DEFAULT_RULES, SINGLE_CHAPTER };
export type { Lang, Library, PageEntry, ChapterEntry, VolumeEntry, DirRule };

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

/** Common language folder spellings, compared after lowercase + space/underscore → dash. */
const LANG_ALIASES: Record<Lang, string[]> = {
  ja: ['ja', 'jp', 'jpn', 'japanese', 'ja-jp', '日', '日本語', '日文'],
  zh: [
    'zh',
    'zh-cn',
    'zh-hans',
    'zh-sg',
    'cn',
    'chs',
    'zh-tw',
    'zh-hk',
    'zh-hant',
    'cht',
    'tw',
    'hk',
    '中',
    '中文',
    '繁中',
    '简中',
  ],
  en: ['en', 'en-us', 'en-gb', 'us', 'uk', 'eng', 'english', '英', '英文'],
};

const normalizeDir = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

/** data/library.json：语言目录映射与目录识别规则 */
export type LibraryConfig = {
  $schema?: string;
  schemaVersion?: number;
  kind?: 'mnconfig';
  volumes?: Record<string, { dirs?: Partial<Record<Lang, string>> }>;
  /** Declarative scan rules, tried in order. Empty/absent means DEFAULT_RULES. */
  rules?: DirRule[];
  /** Preferred language order for the compare view and exports. */
  langOrder?: Lang[];
};

/** Keep only known languages, drop duplicates, and append anything missing. */
export function normalizeLangOrder(value: Lang[] | undefined): Lang[] {
  const out: Lang[] = [];
  for (const lang of value ?? []) {
    if (LANGUAGES.includes(lang) && !out.includes(lang)) out.push(lang);
  }
  for (const lang of LANGUAGES) {
    if (!out.includes(lang)) out.push(lang);
  }
  return out;
}

export function readLibraryConfig(dataRoot: string): LibraryConfig {
  try {
    const stored = readStoredFile<LibraryConfig>(path.join(dataRoot, 'library.json'), 'mnconfig');
    return stored?.data && typeof stored.data === 'object' ? stored.data : {};
  } catch {
    return {};
  }
}

export function writeLibraryConfig(dataRoot: string, cfg: LibraryConfig): void {
  const file = path.join(dataRoot, 'library.json');
  assertWritableFile(file, 'mnconfig');
  // Unknown keys from a newer build survive this save.
  writeStoredFile(file, 'mnconfig', preserveUnknown(readRawRecord(file), cfg));
}

/** 猜测目录名对应哪门语言 */
export function guessLang(dirName: string): Lang | null {
  const key = normalizeDir(dirName);
  for (const lang of LANGUAGES) {
    if (LANG_ALIASES[lang].includes(key)) return lang;
  }
  return null;
}

/** 目录内图片按文件名自然排序：数字段按数值比较 */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ax = a.match(re) ?? [];
  const bx = b.match(re) ?? [];
  const len = Math.min(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const av = ax[i];
    const bv = bx[i];
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) {
      const d = parseInt(av, 10) - parseInt(bv, 10);
      if (d !== 0) return d;
    } else if (av !== bv) {
      return av.localeCompare(bv, 'zh-Hans-CN');
    }
  }
  return ax.length - bx.length;
}

export function encodePath(...segments: string[]): string {
  return '/' + segments.map((s) => encodeURIComponent(s)).join('/');
}

/** 列出目录（把 junction / 目录软链也当作目录，方便「添加漫画」时挂载外部文件夹） */
export function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(entry.name);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    try {
      if (fs.statSync(path.join(dir, entry.name)).isDirectory()) out.push(entry.name);
    } catch {
      /* 断链的软链接忽略 */
    }
  }
  return out.sort(naturalCompare);
}

/** 判断目录里（递归）是否有图片，避免把空目录当成待配置的卷 */
function hasImages(dir: string, depth = 0): boolean {
  if (depth > 8) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && IMAGE_EXT.test(entry.name)) return true;
  }
  for (const entry of entries) {
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(dir, entry.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir && hasImages(path.join(dir, entry.name), depth + 1)) return true;
  }
  return false;
}

/** 解析生效的规则；配置损坏时回退默认规则并把原因交给界面展示 */
function activeRules(cfg: LibraryConfig): { rules: DirRule[]; warning?: string } {
  const configured = cfg.rules?.filter((r) => r && r.pattern);
  if (!configured?.length) return { rules: DEFAULT_RULES };
  try {
    return { rules: validateRules(configured) };
  } catch (err) {
    return {
      rules: DEFAULT_RULES,
      warning: t('WARN_DIR_RULES_FALLBACK', {
        detail: err instanceof AppError ? t(err.code, err.params) : err instanceof Error ? err.message : String(err),
      }),
    };
  }
}

export type DirPreview = {
  dir: string;
  rules: DirRule[];
  hits: Record<string, number>;
  matched: number;
  unmatched: UnmatchedFile[];
  unmatchedCount: number;
  truncated: boolean;
  tree: {
    id: string;
    dir: string;
    languages: Lang[];
    chapters: { chapter: string; pages: number; langs: Partial<Record<Lang, number>> }[];
  }[];
};

/**
 * 实时预览目录识别结果：不写库、不做标注检查，供界面在编辑规则时反复调用。
 */
export function previewDirs(rawRoot: string, dataRoot: string, dir = '', rulesOverride?: DirRule[]): DirPreview {
  const config = readLibraryConfig(dataRoot);
  let rules = rulesOverride;
  if (rules?.length) rules = validateRules(rules);
  else {
    const resolved = activeRules(config);
    rules = resolved.rules;
  }
  const pinned: Partial<Record<string, Partial<Record<Lang, string>>>> = {};
  for (const [volume, entry] of Object.entries(config.volumes ?? {})) {
    if (entry?.dirs) pinned[volume] = entry.dirs;
  }
  const safeDir = dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (safeDir.split('/').some((s) => s === '..')) throw new AppError('ERR_DIR_UNSAFE', {}, 400);

  const scan = resolveFiles(rawRoot, rules, safeDir, pinned);
  const byVolume = new Map<string, typeof scan.files>();
  for (const row of scan.files) {
    const list = byVolume.get(row.volumeId);
    if (list) list.push(row);
    else byVolume.set(row.volumeId, [row]);
  }

  const tree = [...byVolume.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([id, rows]) => {
      const languages = LANGUAGES.filter((lang) => rows.some((r) => r.lang === lang));
      const chapters = [...new Set(rows.map((r) => r.chapter))].sort(naturalCompare).map((chapter) => {
        const chapterRows = rows.filter((r) => r.chapter === chapter);
        const langs: Partial<Record<Lang, number>> = {};
        for (const lang of languages) {
          langs[lang] = chapterRows.filter((r) => r.lang === lang).length;
        }
        return { chapter, pages: Math.max(0, ...Object.values(langs).map((n) => n ?? 0)), langs };
      });
      return { id, dir: rows[0].volumeRoot, languages, chapters };
    });

  return {
    dir: safeDir,
    rules,
    hits: scan.hits,
    matched: scan.files.length,
    unmatched: scan.unmatched.slice(0, 200),
    unmatchedCount: scan.unmatched.length,
    truncated: scan.truncated,
    tree,
  };
}

export type LibraryScanInfo = {
  rules: DirRule[];
  unmatchedCount: number;
  unmatched: UnmatchedFile[];
  truncated: boolean;
  warning?: string;
};

export type LibraryResult = Library & { scan: LibraryScanInfo };

/**
 * 构建图库：按 data/library.json 的规则扫描 raw，再把文件聚合为 卷 → 话 → 页。
 * 语言目录的映射优先用用户显式指定，其次按目录名自动识别。
 */
export function createLibrary(rawRoot: string, dataRoot: string): LibraryResult {
  const config = readLibraryConfig(dataRoot);
  const langOrder = normalizeLangOrder(config.langOrder);
  const empty: LibraryResult = {
    root: rawRoot,
    languages: [...LANGUAGES],
    langOrder,
    volumes: [],
    scan: { rules: DEFAULT_RULES, unmatchedCount: 0, unmatched: [], truncated: false },
  };
  if (!fs.existsSync(rawRoot)) return empty;

  const { rules, warning } = activeRules(config);
  const pinned: Partial<Record<string, Partial<Record<Lang, string>>>> = {};
  for (const [volume, entry] of Object.entries(config.volumes ?? {})) {
    if (entry?.dirs) pinned[volume] = entry.dirs;
  }

  const scan = resolveFiles(rawRoot, rules, '', pinned);

  // Remote libraries are mirrored as a placeholder tree (see storageProviders.ts).
  // Scanning it with the same rules keeps 卷/话/页 grouping identical for local and
  // remote pages; bytes are fetched lazily later, so this stays cheap.
  const remoteRoot = path.join(dataRoot, 'cache', 'remote', 'tree');
  const remoteScan = fs.existsSync(remoteRoot) ? resolveFiles(remoteRoot, rules, '', pinned) : null;

  const rowsByVolume = new Map<string, typeof scan.files>();
  for (const row of [...scan.files, ...(remoteScan?.files ?? [])]) {
    const list = rowsByVolume.get(row.volumeId);
    if (list) list.push(row);
    else rowsByVolume.set(row.volumeId, [row]);
  }

  const volumes: VolumeEntry[] = [];

  for (const [volumeId, rows] of rowsByVolume) {
    const volumeRoot = rows[0].volumeRoot;
    const volumePath = volumeRoot ? path.join(rawRoot, volumeRoot) : rawRoot;
    // Remote-only volumes have no local folder; derive candidates from resolved rows
    // so the language settings dialog still has something to offer.
    const dirs = fs.existsSync(volumePath)
      ? listDirs(volumePath)
      : [...new Set(rows.map((r) => r.langDir.split('/')[0]).filter(Boolean))].sort(naturalCompare);

    const langDirs: Partial<Record<Lang, string>> = {};
    for (const lang of LANGUAGES) {
      const row = rows.find((r) => r.lang === lang);
      if (row) langDirs[lang] = row.langDir;
    }
    const langsInVolume = LANGUAGES.filter((l) => langDirs[l]);
    const volumeWarnings: string[] = [];

    const usedTopDirs = new Set(
      Object.values(langDirs)
        .filter((d): d is string => Boolean(d))
        .map((d) => d.split('/')[0]),
    );
    const leftover = dirs.filter((d) => !usedTopDirs.has(d));
    if (leftover.length) {
      volumeWarnings.push(t('WARN_UNRECOGNIZED_DIRS', { dirs: leftover.join('、') }));
    }

    const chapterNames = [...new Set(rows.map((r) => r.chapter))].sort(naturalCompare);
    const chapters: ChapterEntry[] = [];

    for (const chapter of chapterNames) {
      const chapterRows = rows.filter((r) => r.chapter === chapter);
      const countByLang = new Map<Lang, number>();
      const filesByLang = new Map<Lang, { filename: string; file: string }[]>();

      for (const lang of langsInVolume) {
        const list = chapterRows
          .filter((r) => r.lang === lang)
          .map((r) => ({ filename: r.filename, file: r.file }))
          .sort((a, b) => naturalCompare(a.filename, b.filename));
        if (list.length) filesByLang.set(lang, list);
        countByLang.set(lang, list.length);
      }

      const maxPages = Math.max(0, ...[...countByLang.values()]);
      const chapterWarnings: string[] = [];
      const nonEmpty = [...countByLang.entries()].filter(([, count]) => count > 0);
      if (nonEmpty.length > 1) {
        const uniq = new Set(nonEmpty.map(([, count]) => count));
        if (uniq.size > 1) {
          chapterWarnings.push(
            t('WARN_LANGUAGE_PAGE_COUNT', {
              counts: nonEmpty.map(([lang, count]) => `${langName(lang)} ${count}`).join(' / '),
            }),
          );
        }
      }

      // 同一语言内扩展名混用（例如 jpeg 与 png 交替）值得提示
      for (const lang of langsInVolume) {
        const exts = new Set((filesByLang.get(lang) ?? []).map((f) => path.extname(f.filename).toLowerCase()));
        if (exts.size > 1) {
          chapterWarnings.push(t('WARN_MIXED_EXTENSIONS', { lang: langName(lang), exts: [...exts].join(' / ') }));
        }
      }

      const pages: PageEntry[] = [];
      for (let i = 0; i < maxPages; i++) {
        const warnings: string[] = [];
        const files: Partial<Record<Lang, string>> = {};
        const filenames: Partial<Record<Lang, string>> = {};

        for (const lang of langsInVolume) {
          const list = filesByLang.get(lang) ?? [];
          const entry = list[i];
          if (!entry) {
            warnings.push(t('WARN_MISSING_PAGE', { lang: langName(lang), page: i + 1 }));
            continue;
          }
          filenames[lang] = entry.filename;
          // `ResolvedFile.file` is relative to the raw root, so the public URL needs the
          // `raw/` prefix that the /raw handler (and remote fallback) expects.
          files[lang] = encodePath('raw', ...entry.file.split('/'));
        }

        // 命名异常提示：页码前缀与序号不一致
        for (const lang of langsInVolume) {
          const name = filenames[lang];
          if (!name) continue;
          const m = name.match(/^0*(\d+)/);
          if (m && parseInt(m[1], 10) !== i + 1) {
            warnings.push(t('WARN_FILENAME_MISMATCH', { lang: langName(lang), name, page: i + 1 }));
          }
        }

        pages.push({
          index: i,
          files,
          filenames,
          warnings,
          annotated: fs.existsSync(path.join(dataRoot, 'pages', volumeId, chapter, `${i}.json`)),
        });
      }

      chapters.push({ id: `${volumeId}/${chapter}`, volume: volumeId, chapter, pages, warnings: chapterWarnings });
    }

    volumes.push({
      id: volumeId,
      title: volumeId,
      chapters,
      warnings: volumeWarnings,
      langDirs,
      languages: langsInVolume,
      dirs,
    });
  }

  // 有图片但一条规则都没识别到的顶层目录仍然列出来，否则用户无法进入「卷设置」修映射。
  if (volumes.length === 0) {
    for (const dir of listDirs(rawRoot)) {
      if (!hasImages(path.join(rawRoot, dir))) continue;
      volumes.push({
        id: dir,
        title: dir,
        chapters: [],
        warnings: [t('WARN_NO_LANGUAGE_DIRS')],
        langDirs: {},
        languages: [],
        dirs: listDirs(path.join(rawRoot, dir)),
      });
    }
  }

  volumes.sort((a, b) => naturalCompare(a.id, b.id));

  return {
    root: rawRoot,
    languages: [...LANGUAGES],
    langOrder,
    volumes,
    scan: {
      rules,
      unmatchedCount: scan.unmatched.length,
      unmatched: scan.unmatched.slice(0, 30),
      truncated: scan.truncated,
      warning,
    },
  };
}
