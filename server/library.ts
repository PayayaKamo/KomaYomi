import fs from 'node:fs';
import path from 'node:path';
import {
  BUILTIN_NOTE_TYPES,
  LANGUAGES,
  LANG_LABEL,
  LANGUAGE_NOTE_TYPE_PREFIX,
  PAGE_KINDS,
  SINGLE_CHAPTER,
} from '../shared/types.ts';
import { preserveUnknown, readReadingDirection } from '../shared/format.ts';
import {
  assertWritableFile,
  backupUnreadableFile,
  readRawRecord,
  readStoredFile,
  writeStoredFile,
} from './schemaStore.ts';
import type {
  Lang,
  Library,
  NoteTypeDef,
  PageEntry,
  PageKind,
  ChapterEntry,
  VolumeEntry,
  VolumeOverride,
} from '../shared/types.ts';
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

/** data/library.json: language directory mapping and directory recognition rules. */
export type LibraryConfig = {
  $schema?: string;
  schemaVersion?: number;
  kind?: 'mnconfig';
  volumes?: Record<string, VolumeOverride>;
  /** Declarative scan rules, tried in order. Empty/absent means DEFAULT_RULES. */
  rules?: DirRule[];
  /** Preferred language order for the compare view and exports. */
  langOrder?: Lang[];
  /** User-defined note categories (built-in and language categories are derived in the UI). */
  noteTypes?: NoteTypeDef[];
  /** How many page-history snapshots to keep per page (default 50, clamped 5..200). */
  historyLimit?: number;
  /** Automatic local backups into exports/ (see server/autoBackup.ts). */
  autoBackup?: { enabled?: boolean; intervalHours?: number; keep?: number };
};

/**
 * Merge a stored order with the languages discovered on disk: configured entries
 * come first (unknown ids are dropped), then any newly found language is appended.
 */
export function normalizeLangOrder(value: Lang[] | undefined, discovered: readonly Lang[] = LANGUAGES): Lang[] {
  const known = new Set(discovered);
  const out: Lang[] = [];
  for (const lang of value ?? []) {
    if (typeof lang === 'string' && known.has(lang) && !out.includes(lang)) out.push(lang);
  }
  for (const lang of discovered) {
    if (!out.includes(lang)) out.push(lang);
  }
  return out;
}

const NOTE_TYPE_ID = /^[a-zA-Z0-9_-]{1,40}$/;
const NOTE_TYPE_COLOR = /^#[0-9a-f]{6}$/i;
const RESERVED_NOTE_TYPE = new Set<string>([...BUILTIN_NOTE_TYPES]);

/** Keep custom categories safe and stable: unique ids, valid colours, no built-in collisions. */
export function normalizeNoteTypes(value: unknown): NoteTypeDef[] {
  if (!Array.isArray(value)) return [];
  const out: NoteTypeDef[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const color = typeof raw.color === 'string' ? raw.color.trim().toLowerCase() : '';
    if (!NOTE_TYPE_ID.test(id) || !name || name.length > 40 || !NOTE_TYPE_COLOR.test(color)) continue;
    if (RESERVED_NOTE_TYPE.has(id) || id.startsWith(LANGUAGE_NOTE_TYPE_PREFIX) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, color });
  }
  return out;
}

export function readLibraryConfig(dataRoot: string): LibraryConfig {
  const file = path.join(dataRoot, 'library.json');
  if (!fs.existsSync(file)) return {};
  const stored = readStoredFile<LibraryConfig>(file, 'mnconfig');
  // A damaged config is an explicit error: treating it as `{}` makes the next save
  // silently reset every volume, chapter and backup setting.
  if (!stored?.data || typeof stored.data !== 'object') {
    throw new AppError('ERR_LIBRARY_CONFIG_CORRUPT', {}, 500);
  }
  return stored.data;
}

export function writeLibraryConfig(dataRoot: string, cfg: LibraryConfig): void {
  const file = path.join(dataRoot, 'library.json');
  backupUnreadableFile(file);
  assertWritableFile(file, 'mnconfig');
  // Unknown keys from a newer build survive this save.
  const merged = preserveUnknown(readRawRecord(file), cfg);
  // Volume entries are deletion-sensitive, like page offsets in storage.ts: merging
  // would resurrect a volume removed from raw/ or a cleared language-dir mapping.
  if (cfg.volumes !== undefined) merged.volumes = cfg.volumes;
  // Same for custom note categories: deleting the last one must survive the save.
  if (cfg.noteTypes !== undefined) merged.noteTypes = cfg.noteTypes;
  else delete merged.noteTypes;
  writeStoredFile(file, 'mnconfig', merged);
}

/** Guess which language a directory name refers to. */
export function guessLang(dirName: string): Lang | null {
  const key = normalizeDir(dirName);
  for (const lang of LANGUAGES) {
    if (LANG_ALIASES[lang].includes(key)) return lang;
  }
  return null;
}

/**
 * Language id for a directory: built-in spellings map to ja/zh/en, anything else
 * keeps its folder name so new languages work without a code change.
 */
export function normalizeLang(dirName: string | undefined): Lang | null {
  const raw = String(dirName ?? '').trim();
  if (!raw) return null;
  const known = guessLang(raw);
  if (known) return known;
  const clean = raw
    .replace(/[\\/]+/g, ' ')
    .trim()
    .slice(0, 40);
  return clean || null;
}

/**
 * Built-in languages keep their historical order (ja, zh, en) so existing libraries
 * do not reshuffle; unknown languages found on disk follow in natural order.
 */
function orderDiscovered(discovered: readonly Lang[]): Lang[] {
  const set = new Set(discovered);
  const known = LANGUAGES.filter((lang) => set.has(lang));
  const extra = [...set].filter((lang) => !(LANGUAGES as readonly string[]).includes(lang)).sort(naturalCompare);
  return [...known, ...extra];
}

/** Reorder pages by stored document indices; unknown indices are ignored and the rest keep natural order. */
function reorderPages(pages: PageEntry[], order: number[] | undefined): PageEntry[] {
  if (!order?.length) return pages;
  const byIndex = new Map(pages.map((page) => [page.index, page]));
  const out: PageEntry[] = [];
  for (const index of order) {
    const page = byIndex.get(index);
    if (!page) continue;
    out.push(page);
    byIndex.delete(index);
  }
  out.push(...pages.filter((page) => byIndex.has(page.index)));
  return out;
}

/** Natural sort for page images in a directory: numeric segments compare by value. */
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

/** List directories (junctions and directory symlinks included, so external folders can be mounted when adding manga). */
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
      /* Ignore broken symlinks. */
    }
  }
  return out.sort(naturalCompare);
}

/** Extract the page number from a filename: the last numeric run in the basename. */
function pageNumber(filename: string): number | null {
  const base = filename.replace(/\.[^.]+$/, '');
  const matches = base.match(/\d+/g);
  if (!matches?.length) return null;
  const number = Number.parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(number) ? number : null;
}

/** Whether a directory contains images (recursively), so empty dirs aren't treated as volumes to configure. */
export function hasImages(dir: string, depth = 0): boolean {
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

/** Resolve the effective rules; on a corrupt config fall back to defaults and surface the reason to the UI. */
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

/**
 * On-disk folder of a volume id. Flat layouts live directly under raw, while volumes
 * scanned from a multi-work root sit under their series folders; fall back to the same
 * rule-based scan instead of assuming a top-level directory name.
 */
export function resolveVolumeDir(rawRoot: string, dataRoot: string, volume: string): string | null {
  const direct = path.join(rawRoot, volume);
  try {
    if (fs.statSync(direct).isDirectory()) return direct;
  } catch {
    // No top-level folder with that name; look it up in the scan below.
  }
  const { rules } = activeRules(readLibraryConfig(dataRoot));
  const row = resolveFiles(rawRoot, rules).files.find((entry) => entry.volumeId === volume);
  return row ? path.join(rawRoot, row.volumeRoot) : null;
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
 * Preview directory recognition live: no writes and no annotation checks, so the UI can call it repeatedly while editing rules.
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
  const discovered = orderDiscovered([...new Set(scan.files.map((r) => r.lang))]);
  const order = normalizeLangOrder(config.langOrder, discovered);
  const byVolume = new Map<string, typeof scan.files>();
  for (const row of scan.files) {
    const list = byVolume.get(row.volumeId);
    if (list) list.push(row);
    else byVolume.set(row.volumeId, [row]);
  }

  const tree = [...byVolume.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([id, rows]) => {
      const languages = order.filter((lang) => rows.some((r) => r.lang === lang));
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
 * Build the library: scan raw with the rules from data/library.json, then group files into volume → chapter → page.
 * Language directories use the user's explicit mapping first, then guesses from the directory name.
 */
export function createLibrary(rawRoot: string, dataRoot: string): LibraryResult {
  const config = readLibraryConfig(dataRoot);
  const empty: LibraryResult = {
    root: rawRoot,
    languages: [...LANGUAGES],
    langOrder: normalizeLangOrder(config.langOrder),
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
  // Scanning it with the same rules keeps volume/chapter/page grouping identical for local and
  // remote pages; bytes are fetched lazily later, so this stays cheap.
  const remoteRoot = path.join(dataRoot, 'cache', 'remote', 'tree');
  const remoteScan = fs.existsSync(remoteRoot) ? resolveFiles(remoteRoot, rules, '', pinned) : null;

  const rowsByVolume = new Map<string, typeof scan.files>();
  for (const row of [...scan.files, ...(remoteScan?.files ?? [])]) {
    const list = rowsByVolume.get(row.volumeId);
    if (list) list.push(row);
    else rowsByVolume.set(row.volumeId, [row]);
  }

  // Languages are whatever the scan found, keeping the user's order for the ones they arranged.
  const discovered = orderDiscovered([...new Set([...rowsByVolume.values()].flat().map((r) => r.lang))]);
  const langOrder = normalizeLangOrder(config.langOrder, discovered.length ? discovered : LANGUAGES);

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
    for (const row of rows) {
      if (!langDirs[row.lang]) langDirs[row.lang] = row.langDir;
    }
    const langsInVolume = langOrder.filter((l) => Boolean(langDirs[l]));
    const volumeWarnings: string[] = [];

    const usedTopDirs = new Set(
      Object.values(langDirs)
        .filter((d): d is string => Boolean(d))
        .map((d) => d.split('/')[0]),
    );
    const leftover = dirs.filter((d) => !usedTopDirs.has(d));
    if (leftover.length) {
      // A plain comma keeps the list readable in every message language.
      volumeWarnings.push(t('WARN_UNRECOGNIZED_DIRS', { dirs: leftover.join(', ') }));
    }

    const chapterNames = [...new Set(rows.map((r) => r.chapter))].sort(naturalCompare);
    const chapters: ChapterEntry[] = [];
    const hiddenChapters: string[] = [];

    for (const chapter of chapterNames) {
      // A hidden chapter is unlinked from the library only: its folder and page data stay on disk.
      const chapterCfg = config.volumes?.[volumeId]?.chapters?.[chapter];
      if (chapterCfg?.hidden) {
        hiddenChapters.push(chapter);
        continue;
      }
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

      // Mixed extensions within one language (e.g. jpeg alternating with png) are worth a warning.
      for (const lang of langsInVolume) {
        const exts = new Set((filesByLang.get(lang) ?? []).map((f) => path.extname(f.filename).toLowerCase()));
        if (exts.size > 1) {
          chapterWarnings.push(t('WARN_MIXED_EXTENSIONS', { lang: langName(lang), exts: [...exts].join(' / ') }));
        }
      }

      const pageOffsets = chapterCfg?.pageOffsets ?? {};
      // Align by the page number embedded in filenames when every language exposes a unique
      // number (the normal case). Otherwise fall back to positional alignment.
      let keyed = true;
      const numbered = new Map<Lang, { number: number; entry: { filename: string; file: string } }[]>();
      for (const lang of langsInVolume) {
        const list = filesByLang.get(lang) ?? [];
        const seen = new Set<number>();
        const entries: { number: number; entry: { filename: string; file: string } }[] = [];
        for (const entry of list) {
          const number = pageNumber(entry.filename);
          if (number == null || seen.has(number)) {
            keyed = false;
            break;
          }
          seen.add(number);
          entries.push({ number, entry });
        }
        if (!keyed) break;
        numbered.set(lang, entries);
      }
      if (!keyed) {
        // Positional fallback: treat the sorted position within each language as its page number.
        numbered.clear();
        for (const lang of langsInVolume) {
          numbered.set(
            lang,
            (filesByLang.get(lang) ?? []).map((entry, position) => ({ number: position + 1, entry })),
          );
        }
      }

      const slots = new Map<number, Partial<Record<Lang, { filename: string; file: string }>>>();
      for (const lang of langsInVolume) {
        const entries = numbered.get(lang) ?? [];
        const offset = pageOffsets[lang];
        entries.forEach((item) => {
          const original = item.number;
          let slot = original;
          if (offset && original >= offset.from) slot = original - offset.from + offset.to;
          slot = Math.max(1, Math.round(slot));
          // Malformed legacy offsets may collide; push to the next free slot instead of dropping a page.
          while (slots.get(slot)?.[lang]) slot++;
          const bucket = slots.get(slot) ?? {};
          bucket[lang] = item.entry;
          slots.set(slot, bucket);
        });
      }

      const pages: PageEntry[] = [];
      const orderedSlots = [...slots.keys()].sort((a, b) => a - b);
      for (let i = 0; i < orderedSlots.length; i++) {
        const slot = orderedSlots[i];
        const bucket = slots.get(slot) ?? {};
        const warnings: string[] = [];
        const files: Partial<Record<Lang, string>> = {};
        const filenames: Partial<Record<Lang, string>> = {};
        const missing: Lang[] = [];

        for (const lang of langsInVolume) {
          const entry = bucket[lang];
          if (!entry) {
            missing.push(lang);
            warnings.push(t('WARN_MISSING_PAGE', { lang: langName(lang), page: i + 1 }));
            continue;
          }
          filenames[lang] = entry.filename;
          // `ResolvedFile.file` is relative to the raw root, so the public URL needs the
          // `raw/` prefix that the /raw handler (and remote fallback) expects.
          files[lang] = encodePath('raw', ...entry.file.split('/'));
        }

        // Naming warning only applies to positional alignment: keyed pages are aligned by number.
        if (!keyed) {
          for (const lang of langsInVolume) {
            const name = filenames[lang];
            if (!name || pageOffsets[lang]) continue;
            const m = name.match(/^0*(\d+)/);
            if (m && parseInt(m[1], 10) !== slot) {
              warnings.push(t('WARN_FILENAME_MISMATCH', { lang: langName(lang), name, page: i + 1 }));
            }
          }
        }

        pages.push({
          index: i,
          files,
          filenames,
          missing: missing.length ? missing : undefined,
          warnings,
          annotated: fs.existsSync(path.join(dataRoot, 'pages', volumeId, chapter, `${i}.json`)),
        });
      }

      // Display name, page order, exclusion and roles come from data/library.json, never from disk renames.
      const excluded = new Set(chapterCfg?.excluded ?? []);
      const kinds = chapterCfg?.kinds ?? {};
      const orderedPages = reorderPages(pages, chapterCfg?.order).map((page) => {
        const kind = kinds[String(page.index)];
        return {
          ...page,
          excluded: excluded.has(page.index) || undefined,
          kind: kind && PAGE_KINDS.includes(kind) ? (kind as PageKind) : undefined,
        };
      });

      chapters.push({
        id: `${volumeId}/${chapter}`,
        volume: volumeId,
        chapter,
        title: chapterCfg?.title?.trim() || undefined,
        pages: orderedPages,
        warnings: chapterWarnings,
        pageOffsets: chapterCfg?.pageOffsets,
      });
    }

    volumes.push({
      id: volumeId,
      title: config.volumes?.[volumeId]?.title?.trim() || volumeId,
      // A volume scanned from a multi-work root keeps its series so the sidebar can
      // show "series · volume"; an explicit config value still wins.
      series: config.volumes?.[volumeId]?.series?.trim() || rows[0].series || undefined,
      chapters,
      warnings: volumeWarnings,
      langDirs,
      languages: langsInVolume,
      dirs,
      defaultDirection: readReadingDirection(config.volumes?.[volumeId]?.defaultDirection),
      hiddenChapters,
    });
  }

  // Keep top-level dirs that contain images but matched no rule; otherwise users can't open Volume settings to fix the mapping.
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

  volumes.sort((a, b) => naturalCompare(a.series ?? a.id, b.series ?? b.id) || naturalCompare(a.id, b.id));

  return {
    root: rawRoot,
    languages: langOrder,
    langOrder,
    noteTypes: normalizeNoteTypes(config.noteTypes),
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
