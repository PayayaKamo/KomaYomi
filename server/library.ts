import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, LANG_LABEL } from '../shared/types.ts';
import type { Lang, Library, PageEntry, ChapterEntry, VolumeEntry } from '../shared/types.ts';

export { LANGUAGES, LANG_LABEL };
export type { Lang, Library, PageEntry, ChapterEntry, VolumeEntry };

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** 常见语言目录命名变体（统一小写、空格/下划线转连字符后比较） */
const LANG_ALIASES: Record<Lang, string[]> = {
  ja: ['ja', 'jp', 'jpn', 'japanese', 'ja-jp', '日', '日本語', '日文'],
  zh: ['zh', 'zh-cn', 'zh-hans', 'zh-sg', 'cn', 'chs', 'zh-tw', 'zh-hk', 'zh-hant', 'cht', 'tw', 'hk', '中', '中文', '繁中', '简中'],
  en: ['en', 'en-us', 'en-gb', 'us', 'uk', 'eng', 'english', '英', '英文'],
};

const normalizeDir = (name: string) => name.trim().toLowerCase().replace(/[\s_]+/g, '-');

/** data/library.json：记录用户为每卷手动指定的语言目录 */
export type LibraryConfig = {
  volumes?: Record<string, { dirs?: Partial<Record<Lang, string>> }>;
};

export function readLibraryConfig(dataRoot: string): LibraryConfig {
  try {
    const raw = fs.readFileSync(path.join(dataRoot, 'library.json'), 'utf8');
    const parsed = JSON.parse(raw) as LibraryConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLibraryConfig(dataRoot: string, cfg: LibraryConfig): void {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'library.json'), JSON.stringify(cfg, null, 2), 'utf8');
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

function listImageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXT.test(d.name))
    .map((d) => d.name)
    .sort(naturalCompare);
}

export function createLibrary(rawRoot: string, dataRoot: string): Library {
  const volumes: VolumeEntry[] = [];
  if (!fs.existsSync(rawRoot)) {
    return { root: rawRoot, languages: [...LANGUAGES], volumes };
  }

  const config = readLibraryConfig(dataRoot);
  const volumeDirs = listDirs(rawRoot);

  for (const volume of volumeDirs) {
    const volumePath = path.join(rawRoot, volume);
    const dirs = listDirs(volumePath);

    // 先按用户在 data/library.json 里的指定，再按目录名变体自动猜测
    const pinned = config.volumes?.[volume]?.dirs ?? {};
    const langDirs: Partial<Record<Lang, string>> = {};
    const usedDirs = new Set<string>();
    for (const lang of LANGUAGES) {
      const wanted = pinned[lang];
      let dir: string | undefined;
      if (wanted && dirs.includes(wanted)) dir = wanted;
      else dir = dirs.find((d) => !usedDirs.has(d) && guessLang(d) === lang);
      if (dir && !usedDirs.has(dir)) {
        langDirs[lang] = dir;
        usedDirs.add(dir);
      }
    }
    const langsInVolume = LANGUAGES.filter((l) => langDirs[l]);

    const chapterSet = new Set<string>();
    for (const lang of langsInVolume) {
      for (const name of listDirs(path.join(volumePath, langDirs[lang]!))) chapterSet.add(name);
    }
    const chapterNames = [...chapterSet].sort(naturalCompare);
    const chapters: ChapterEntry[] = [];
    const volumeWarnings: string[] = [];

    if (!langsInVolume.length) {
      volumeWarnings.push('未识别到语言目录（支持 ja/jp/日、zh/zh-cn/tw、en/us 等），可在「卷设置」里手动指定');
    }
    const leftover = dirs.filter((d) => !usedDirs.has(d));
    if (langsInVolume.length && leftover.length) {
      volumeWarnings.push(`未识别的目录：${leftover.join('、')}（可在「卷设置」里指定语言）`);
    }

    for (const chapter of chapterNames) {
      const filesByLang: Partial<Record<Lang, string[]>> = {};
      for (const lang of langsInVolume) {
        filesByLang[lang] = listImageFiles(path.join(volumePath, langDirs[lang]!, chapter));
      }
      const counts = langsInVolume.map((l) => ({ lang: l, count: filesByLang[l]?.length ?? 0 }));
      const maxPages = Math.max(...counts.map((c) => c.count), 0);
      const chapterWarnings: string[] = [];

      const nonEmpty = counts.filter((c) => c.count > 0);
      if (nonEmpty.length > 1) {
        const uniq = new Set(nonEmpty.map((c) => c.count));
        if (uniq.size > 1) {
          chapterWarnings.push(
            `各语言页数不一致：${nonEmpty.map((c) => `${LANG_LABEL[c.lang]} ${c.count} 页`).join(' / ')}（按序号配对，缺页会在页面上标注）`,
          );
        }
      }

      // 同一语言内扩展名混用（例如 jpeg 与 png 交替）值得提示
      for (const lang of langsInVolume) {
        const exts = new Set((filesByLang[lang] ?? []).map((n) => path.extname(n).toLowerCase()));
        if (exts.size > 1) {
          chapterWarnings.push(`${LANG_LABEL[lang]} 本话内扩展名不统一：${[...exts].join(' / ')}`);
        }
      }

      const pages: PageEntry[] = [];
      for (let i = 0; i < maxPages; i++) {
        const warnings: string[] = [];
        const files: Partial<Record<Lang, string>> = {};
        const filenames: Partial<Record<Lang, string>> = {};

        for (const lang of langsInVolume) {
          const list = filesByLang[lang] ?? [];
          const name = list[i];
          if (!name) {
            warnings.push(`${LANG_LABEL[lang]} 缺第 ${i + 1} 页`);
            continue;
          }
          filenames[lang] = name;
          files[lang] = encodePath('raw', volume, langDirs[lang]!, chapter, name);
        }

        // 命名异常提示：页码前缀与序号不一致
        for (const lang of langsInVolume) {
          const name = filenames[lang];
          if (!name) continue;
          const m = name.match(/^0*(\d+)/);
          if (m && parseInt(m[1], 10) !== i + 1) {
            warnings.push(`${LANG_LABEL[lang]} 文件名 ${name} 与第 ${i + 1} 页序号不符`);
          }
        }

        pages.push({
          index: i,
          files,
          filenames,
          warnings,
          annotated: fs.existsSync(path.join(dataRoot, 'pages', volume, chapter, `${i}.json`)),
        });
      }

      chapters.push({ id: `${volume}/${chapter}`, volume, chapter, pages, warnings: chapterWarnings });
    }

    volumes.push({
      id: volume,
      title: volume,
      chapters,
      warnings: volumeWarnings,
      langDirs,
      languages: langsInVolume,
      dirs,
    });
  }

  return { root: rawRoot, languages: [...LANGUAGES], volumes };
}

