import fs from 'node:fs';
import path from 'node:path';
import { guessLang, naturalCompare } from './library.ts';
import { SINGLE_CHAPTER } from '../shared/types.ts';
import type { Lang } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';

/**
 * Declarative directory rules for library scanning.
 *
 * Every user organises manga differently: language may sit first, last or in the
 * middle, volumes may be nested under a series, and chapters may be optional.
 * Instead of hardcoding one layout we describe a page path with placeholders and
 * let the rules engine try each rule in priority order.
 *
 * Why a separate module: `library.ts` owns config/persistence and the HTTP layer
 * owns transport, while this module stays a pure "path segments in, page records
 * out" function that is easy to unit test and to call from the CLI.
 */

export type Placeholder = 'series' | 'volume' | 'chapter' | 'language' | 'page';

export type DirRule = {
  id: string;
  name?: string;
  /** Page path pattern, e.g. `{volume}/{language}/{chapter}/{page}` */
  pattern: string;
  /** Directory names that are never descended into, e.g. `_extras` */
  ignore?: string[];
  /** Accepted file extensions (with dot). Defaults to common image formats. */
  extensions?: string[];
  /**
   * Fallback language for structures without a `{language}` segment
   * (flat single-language folders). Ignored when the pattern has `{language}`.
   */
  language?: Lang;
  enabled?: boolean;
};

export const DEFAULT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'];

/**
 * Default rule reproduces the historical layout `raw/<volume>/<language>/<chapter>/<page>`.
 * Keeping it first means existing libraries (including 点兔第14卷) need no configuration.
 */
export const DEFAULT_RULES: DirRule[] = [
  {
    id: 'volume-language-chapter-page',
    name: '{volume}/{language}/{chapter}/{page}',
    pattern: '{volume}/{language}/{chapter}/{page}',
  },
];

const PLACEHOLDER_ALIASES: Record<string, Placeholder> = {
  series: 'series',
  seriesname: 'series',
  work: 'series',
  volume: 'volume',
  vol: 'volume',
  book: 'volume',
  chapter: 'chapter',
  chap: 'chapter',
  ch: 'chapter',
  episode: 'chapter',
  language: 'language',
  lang: 'language',
  locale: 'language',
  page: 'page',
  file: 'page',
  image: 'page',
  img: 'page',
};

type PatternSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'wildcard' }
  | { kind: 'placeholder'; name: Placeholder; optional: boolean };

type Match = {
  values: Partial<Record<Placeholder, string>>;
  /** Segment index (relative to the scanned root) where each placeholder matched. */
  positions: Partial<Record<Placeholder, number>>;
};

export function parsePattern(pattern: string): PatternSegment[] {
  const trimmed = pattern.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) throw new AppError('ERR_RULE_EMPTY', {}, 400);
  return trimmed.split('/').map((raw) => {
    let seg = raw.trim();
    let optional = false;
    if (seg.endsWith('?')) {
      optional = true;
      seg = seg.slice(0, -1);
    }
    const ph = seg.match(/^\{([a-zA-Z_-]+)\}$/);
    if (ph) {
      const name = PLACEHOLDER_ALIASES[ph[1].toLowerCase()];
      if (!name) throw new AppError('ERR_RULE_UNKNOWN_PLACEHOLDER', { name: ph[1] }, 400);
      return { kind: 'placeholder', name, optional };
    }
    if (seg === '*' || seg === '**') return { kind: 'wildcard' };
    return { kind: 'literal', value: seg };
  });
}

export function validateRules(rules: unknown): DirRule[] {
  if (!Array.isArray(rules) || !rules.length) throw new AppError('ERR_RULES_NOT_ARRAY', {}, 400);
  const seen = new Set<string>();
  return rules.map((entry, i) => {
    if (!entry || typeof entry !== 'object') throw new AppError('ERR_RULE_NOT_OBJECT', { index: i + 1 }, 400);
    const rule = entry as DirRule;
    const pattern = String(rule.pattern ?? '').trim();
    if (!pattern) throw new AppError('ERR_RULE_PATTERN_MISSING', { index: i + 1 }, 400);
    if (path.isAbsolute(pattern) || pattern.split('/').includes('..')) {
      throw new AppError('ERR_RULE_PATTERN_ABSOLUTE', { index: i + 1 }, 400);
    }
    const segments = parsePattern(pattern);
    const names = new Set(segments.filter((s) => s.kind === 'placeholder').map((s) => s.name));
    if (!names.has('page')) throw new AppError('ERR_RULE_PAGE_MISSING', { index: i + 1 }, 400);
    const fallback = rule.language ? String(rule.language).toLowerCase() : undefined;
    if (fallback && !['ja', 'zh', 'en'].includes(fallback)) {
      throw new AppError('ERR_RULE_LANGUAGE_INVALID', { index: i + 1, value: rule.language ?? '' }, 400);
    }
    if (!names.has('language') && !fallback) {
      throw new AppError('ERR_RULE_LANGUAGE_MISSING', { index: i + 1 }, 400);
    }
    const id = String(rule.id ?? '').trim() || `rule-${i + 1}`;
    if (seen.has(id)) throw new AppError('ERR_RULE_DUPLICATE_ID', { id }, 409);
    seen.add(id);
    const extensions = (rule.extensions ?? [])
      .map((e) => {
        const clean = String(e).trim().toLowerCase();
        if (!clean) return '';
        return clean.startsWith('.') ? clean : `.${clean}`;
      })
      .filter(Boolean);
    return {
      id,
      name: rule.name ? String(rule.name) : undefined,
      pattern,
      ignore: (rule.ignore ?? []).map((s) => String(s)).filter(Boolean),
      extensions: extensions.length ? extensions : undefined,
      language: fallback as Lang | undefined,
      enabled: rule.enabled !== false,
    };
  });
}

function matchPattern(segments: string[], pattern: PatternSegment[], pi: number, si: number, acc: Match): Match | null {
  if (pi === pattern.length) {
    // A page placeholder is mandatory, so a full-length match is required.
    return si === segments.length ? acc : null;
  }
  const seg = pattern[pi];

  if (seg.kind === 'placeholder' && seg.optional) {
    // Prefer consuming the segment; fall back to skipping it so that optional
    // chapters still match single-chapter folders.
    if (si < segments.length) {
      const consumed = matchPattern(segments, pattern, pi + 1, si + 1, {
        values: { ...acc.values, [seg.name]: segments[si] },
        positions: { ...acc.positions, [seg.name]: si },
      });
      if (consumed) return consumed;
    }
    return matchPattern(segments, pattern, pi + 1, si, acc);
  }

  if (si >= segments.length) return null;
  const value = segments[si];

  if (seg.kind === 'wildcard') {
    return matchPattern(segments, pattern, pi + 1, si + 1, acc);
  }
  if (seg.kind === 'literal') {
    // Windows paths are case-insensitive; compare lowercased for both platforms so
    // a rule copied from another machine still matches.
    return value.toLowerCase() === seg.value.toLowerCase()
      ? matchPattern(segments, pattern, pi + 1, si + 1, acc)
      : null;
  }
  return matchPattern(segments, pattern, pi + 1, si + 1, {
    values: { ...acc.values, [seg.name]: value },
    positions: { ...acc.positions, [seg.name]: si },
  });
}

export type ResolvedFile = {
  /** Path relative to the raw root, using "/" separators. */
  file: string;
  volumeId: string;
  /** Directory of the volume relative to the raw root; '' when the volume is the root. */
  volumeRoot: string;
  chapter: string;
  lang: Lang;
  /** Language directory relative to the volume root (used by the volume settings UI). */
  langDir: string;
  filename: string;
  rule: string;
};

export type UnmatchedFile = { file: string; reason: string };

export type ResolveResult = {
  files: ResolvedFile[];
  unmatched: UnmatchedFile[];
  /** rule id -> number of files it claimed */
  hits: Record<string, number>;
  truncated: boolean;
};

const MAX_FILES = 50_000;

/** Fallback volume label when a rule has neither {volume} nor {series}. */
export const ROOT_VOLUME = '默认卷';

function walk(root: string, rel: string, ignore: Set<string>, extensions: Set<string>, out: string[], depth = 0): void {
  if (depth > 10 || out.length >= MAX_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(root, childRel)).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDir) {
      if (ignore.has(entry.name.toLowerCase())) continue;
      walk(root, childRel, ignore, extensions, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (extensions.has(ext)) out.push(childRel);
  }
}

/**
 * Resolve every image below `subdir` into a page record using the first rule that
 * matches. Unmatched images carry a human-readable reason so the UI can explain
 * why a folder did not show up instead of silently dropping it.
 */
export function resolveFiles(
  rawRoot: string,
  rules: DirRule[],
  subdir = '',
  pinned: Partial<Record<string, Partial<Record<Lang, string>>>> = {},
): ResolveResult {
  const active = rules.filter((r) => r.enabled !== false);
  const ignore = new Set<string>();
  const extensions = new Set<string>();
  for (const rule of active) {
    for (const name of rule.ignore ?? []) ignore.add(name.toLowerCase());
    for (const ext of rule.extensions ?? DEFAULT_IMAGE_EXTENSIONS) extensions.add(ext.toLowerCase());
  }

  const found: string[] = [];
  // Walk relative to the preview subdirectory so that patterns are always evaluated
  // against the subtree the user selected, not against the raw root.
  walk(subdir ? path.join(rawRoot, subdir) : rawRoot, '', ignore, extensions, found);
  found.sort(naturalCompare);

  const files: ResolvedFile[] = [];
  const unmatched: UnmatchedFile[] = [];
  const hits: Record<string, number> = {};
  const truncated = found.length >= MAX_FILES;

  const parsed = active.map((rule) => {
    try {
      return { rule, segments: parsePattern(rule.pattern) };
    } catch (err) {
      throw new AppError(
        'ERR_RULE_PARSE',
        {
          rule: rule.name ?? rule.id,
          detail: err instanceof AppError ? t(err.code, err.params) : err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
  });

  for (const rel of found) {
    const file = subdir ? `${subdir}/${rel}` : rel;
    const segments = rel.split('/');
    let matched: { rule: DirRule; match: Match } | null = null;
    let closestReason = '';

    for (const { rule, segments: pattern } of parsed) {
      const m = matchPattern(segments, pattern, 0, 0, { values: {}, positions: {} });
      if (!m) {
        if (!closestReason) closestReason = t('WARN_RULE_LEVEL_MISMATCH', { rule: rule.name ?? rule.pattern });
        continue;
      }
      // A matched shape is not enough: the language folder must map to a known
      // language, otherwise the page cannot be paired across languages. Rules
      // without a {language} segment may declare a fixed fallback language.
      const langRaw = m.values.language ?? rule.language ?? '';
      if (!langRaw) {
        closestReason = t('WARN_RULE_NO_LANGUAGE', { language: '{language}' });
        continue;
      }
      if (!guessLang(langRaw) && !Object.values(pinned).some((dirs) => Object.values(dirs ?? {}).includes(langRaw))) {
        closestReason = t('WARN_UNKNOWN_LANGUAGE_DIR', { dir: langRaw });
        continue;
      }
      matched = { rule, match: m };
      break;
    }

    if (!matched) {
      unmatched.push({ file, reason: closestReason || t('WARN_NO_RULE_MATCHED') });
      continue;
    }

    const { rule, match } = matched;
    const { values, positions } = match;
    const volumeId = [values.series, values.volume].filter(Boolean).join(' / ') || ROOT_VOLUME;
    const chapter = values.chapter ?? SINGLE_CHAPTER;
    const langSegment = values.language ?? rule.language ?? '';
    const langPos = positions.language ?? -1;
    const volumePos = positions.volume ?? positions.series ?? -1;

    let lang = guessLang(langSegment);
    const override = pinned[volumeId];
    if (override && values.language) {
      const pinnedLang = (Object.keys(override) as Lang[]).find((l) => override[l] === langSegment);
      if (pinnedLang) lang = pinnedLang;
    }
    if (!lang) {
      unmatched.push({ file, reason: t('WARN_UNKNOWN_LANGUAGE_DIR', { dir: langSegment }) });
      continue;
    }

    const volumeRoot = volumePos >= 0 ? segments.slice(0, volumePos + 1).join('/') : '';
    const langStart = volumePos + 1;
    // Flat rules without a language segment have no language directory.
    const langDir =
      langPos < 0 ? '' : langPos > langStart ? segments.slice(langStart, langPos + 1).join('/') : langSegment;

    files.push({
      file,
      volumeId,
      volumeRoot,
      chapter,
      lang,
      langDir,
      filename: segments[segments.length - 1],
      rule: rule.id,
    });
    hits[rule.id] = (hits[rule.id] ?? 0) + 1;
  }

  return { files, unmatched, hits, truncated };
}
