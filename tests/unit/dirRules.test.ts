import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, ROOT_VOLUME, parsePattern, resolveFiles, validateRules } from '../../server/dirRules.ts';
import type { DirRule } from '../../server/dirRules.ts';
import { AppError } from '../../server/errors.ts';
import { SINGLE_CHAPTER } from '../../shared/types.ts';
import { makeTempDir, removeDir, writeFiles } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempRoot(files: string[]): string {
  const root = makeTempDir('dir-rules');
  dirs.push(root);
  writeFiles(root, files);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.code : 'not-an-app-error';
  }
  return 'no-error';
}

const pageRule = (over: Partial<DirRule> = {}): DirRule => ({
  id: 'test',
  pattern: '{volume}/{language}/{chapter}/{page}',
  ...over,
});

describe('parsePattern', () => {
  it('maps aliases and optional markers to typed segments', () => {
    expect(parsePattern('/{vol}/{lang}/{ch}?/{file}/')).toEqual([
      { kind: 'placeholder', name: 'volume', optional: false },
      { kind: 'placeholder', name: 'language', optional: false },
      { kind: 'placeholder', name: 'chapter', optional: true },
      { kind: 'placeholder', name: 'page', optional: false },
    ]);
    expect(parsePattern('{series}/*/{img}')).toEqual([
      { kind: 'placeholder', name: 'series', optional: false },
      { kind: 'wildcard' },
      { kind: 'placeholder', name: 'page', optional: false },
    ]);
    expect(parsePattern('raw/{language}/{page}')[0]).toEqual({ kind: 'literal', value: 'raw' });
  });

  it('rejects empty patterns and unknown placeholders', () => {
    expect(codeOf(() => parsePattern('   '))).toBe('ERR_RULE_EMPTY');
    expect(codeOf(() => parsePattern('{unknown}/{page}'))).toBe('ERR_RULE_UNKNOWN_PLACEHOLDER');
  });
});

describe('validateRules', () => {
  it('fills defaults and normalizes ids/extensions', () => {
    const [rule] = validateRules([
      { pattern: '{volume}/{language}/{page}', extensions: ['PNG', '.Jpg', '  '], ignore: ['_extras', ''] },
    ]);
    expect(rule.id).toBe('rule-1');
    expect(rule.enabled).toBe(true);
    expect(rule.extensions).toEqual(['.png', '.jpg']);
    expect(rule.ignore).toEqual(['_extras']);
  });

  it('requires a page placeholder', () => {
    expect(codeOf(() => validateRules([{ pattern: '{volume}/{language}' }]))).toBe('ERR_RULE_PAGE_MISSING');
  });

  it('rejects absolute and parent-traversing patterns', () => {
    expect(codeOf(() => validateRules([{ pattern: '/abs/{language}/{page}' }]))).toBe('ERR_RULE_PATTERN_ABSOLUTE');
    expect(codeOf(() => validateRules([{ pattern: '../{language}/{page}' }]))).toBe('ERR_RULE_PATTERN_ABSOLUTE');
  });

  it('requires a language placeholder or an explicit fallback', () => {
    expect(codeOf(() => validateRules([{ pattern: '{volume}/{page}' }]))).toBe('ERR_RULE_LANGUAGE_MISSING');
    const [withFallback] = validateRules([{ pattern: '{volume}/{page}', language: 'zh' }]);
    expect(withFallback.language).toBe('zh');
    // Any language id is valid now; only ids that would escape the folder are rejected.
    const [unknown] = validateRules([{ pattern: '{volume}/{page}', language: 'fr' }]);
    expect(unknown.language).toBe('fr');
    expect(codeOf(() => validateRules([{ pattern: '{volume}/{page}', language: 'a/b' }]))).toBe(
      'ERR_RULE_LANGUAGE_INVALID',
    );
  });

  it('rejects duplicate ids and non-array input', () => {
    expect(
      codeOf(() =>
        validateRules([
          { id: 'dup', pattern: '{volume}/{language}/{page}' },
          { id: 'dup', pattern: '{volume}/{language}/{page}' },
        ]),
      ),
    ).toBe('ERR_RULE_DUPLICATE_ID');
    expect(codeOf(() => validateRules([]))).toBe('ERR_RULES_NOT_ARRAY');
    expect(codeOf(() => validateRules([null]))).toBe('ERR_RULE_NOT_OBJECT');
  });
});

describe('resolveFiles', () => {
  const tree = [
    'Vol1/ja/172/01.png',
    'Vol1/ja/172/02.png',
    'Vol1/ja/173/10.png',
    'Vol1/zh/172/01.png',
    'Vol1/zh/172/02.png',
    'Vol1/en/172/01.png',
    'Vol1/fr/172/01.png',
    'Vol1/ja/notes.txt',
  ];

  it('resolves the default volume/language/chapter/page layout', () => {
    const root = tempRoot(tree);
    const result = resolveFiles(root, DEFAULT_RULES);

    expect(result.truncated).toBe(false);
    // Unknown language folders are accepted as languages instead of being skipped.
    expect(result.files).toHaveLength(7);
    expect(result.unmatched).toHaveLength(0);
    expect(result.hits[DEFAULT_RULES[0].id]).toBe(7);

    const fr = result.files.find((f) => f.file === 'Vol1/fr/172/01.png');
    expect(fr).toMatchObject({ lang: 'fr', langDir: 'fr' });

    const ja = result.files.find((f) => f.file === 'Vol1/ja/172/02.png');
    expect(ja).toMatchObject({
      volumeId: 'Vol1',
      volumeRoot: 'Vol1',
      chapter: '172',
      lang: 'ja',
      langDir: 'ja',
      filename: '02.png',
      rule: DEFAULT_RULES[0].id,
    });
    expect(new Set(result.files.map((f) => f.chapter))).toEqual(new Set(['172', '173']));
  });

  it('honours ignore directories and custom extensions', () => {
    const root = tempRoot(['Vol1/ja/172/01.webp', 'Vol1/ja/172/02.png', 'Vol1/ja/_extras/03.webp']);
    const rules = [pageRule({ ignore: ['_extras'], extensions: ['.webp'] })];
    const result = resolveFiles(root, rules);
    expect(result.files.map((f) => f.file)).toEqual(['Vol1/ja/172/01.webp']);
  });

  it('supports an optional chapter segment', () => {
    const root = tempRoot(['Vol2/ja/01.png', 'Vol2/ja/172/02.png']);
    const rules = [pageRule({ pattern: '{volume}/{language}/{chapter}?/{page}' })];
    const result = resolveFiles(root, rules);
    const byFile = new Map(result.files.map((f) => [f.file, f]));

    expect(result.files).toHaveLength(2);
    expect(byFile.get('Vol2/ja/01.png')?.chapter).toBe(SINGLE_CHAPTER);
    expect(byFile.get('Vol2/ja/172/02.png')?.chapter).toBe('172');
  });

  it('uses an unknown language folder name as the language unless pinned', () => {
    const root = tempRoot(['Vol3/日语版/172/01.png']);
    const withoutPinned = resolveFiles(root, DEFAULT_RULES);
    expect(withoutPinned.files).toHaveLength(1);
    expect(withoutPinned.files[0]).toMatchObject({ lang: '日语版', langDir: '日语版' });

    const withPinned = resolveFiles(root, DEFAULT_RULES, '', { Vol3: { ja: '日语版' } });
    expect(withPinned.files).toHaveLength(1);
    expect(withPinned.files[0]).toMatchObject({ lang: 'ja', langDir: '日语版', volumeId: 'Vol3' });
  });

  it('treats a wildcard segment as one nested language directory', () => {
    const root = tempRoot(['Vol4/ignored/ja/01.png']);
    const result = resolveFiles(root, [pageRule({ pattern: '{volume}/*/{language}/{page}' })]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      volumeId: 'Vol4',
      lang: 'ja',
      langDir: 'ignored/ja',
      chapter: SINGLE_CHAPTER,
    });
  });

  it('falls back to a root volume label for layouts without a volume segment', () => {
    const root = tempRoot(['ja/01.png', 'ja/02.png']);
    const result = resolveFiles(root, [pageRule({ pattern: '{language}/{page}' })]);
    expect(result.files).toHaveLength(2);
    expect(result.files.every((f) => f.volumeId === ROOT_VOLUME && f.volumeRoot === '')).toBe(true);
    expect(result.files.every((f) => f.langDir === 'ja')).toBe(true);
  });
});

describe('resolveFiles with several works in one root', () => {
  it('recognises series/volume/language/chapter with the default rules', () => {
    const root = tempRoot([
      'gochiusa/gochiusa-14/en/172/01.png',
      'gochiusa/gochiusa-14/ja/172/01.jpg',
      'oomuroke/oomuroke-08/zh-hk/106/01.webp',
    ]);
    const result = resolveFiles(root, DEFAULT_RULES);

    expect(result.unmatched).toHaveLength(0);
    const en = result.files.find((f) => f.file === 'gochiusa/gochiusa-14/en/172/01.png');
    expect(en).toMatchObject({
      volumeId: 'gochiusa-14',
      series: 'gochiusa',
      volumeRoot: 'gochiusa/gochiusa-14',
      chapter: '172',
      lang: 'en',
      langDir: 'en',
      rule: 'series-volume-language-chapter-page',
    });
    const zhHk = result.files.find((f) => f.file.endsWith('01.webp'));
    expect(zhHk).toMatchObject({ volumeId: 'oomuroke-08', series: 'oomuroke', lang: 'zh', langDir: 'zh-hk' });
  });

  it('folds an extra collection folder into the series path', () => {
    const root = tempRoot(['test-manga-raw/yuruyuri/yuruyuri-24/ja/199/01.jpg']);
    const result = resolveFiles(root, DEFAULT_RULES);

    expect(result.unmatched).toHaveLength(0);
    expect(result.files[0]).toMatchObject({
      volumeId: 'yuruyuri-24',
      series: 'test-manga-raw/yuruyuri',
      volumeRoot: 'test-manga-raw/yuruyuri/yuruyuri-24',
      langDir: 'ja',
    });
  });

  it('keeps volumes from different series apart when their folders share a name', () => {
    const root = tempRoot(['alpha/vol-01/ja/1/01.png', 'beta/vol-01/ja/1/01.png']);
    const result = resolveFiles(root, DEFAULT_RULES);

    expect(result.files.map((f) => f.volumeId).sort()).toEqual(['alpha-vol-01', 'beta-vol-01']);
    expect(result.files.every((f) => f.volumeRoot.endsWith('/vol-01'))).toBe(true);
  });

  it('still prefers the flat volume/language/chapter layout', () => {
    const root = tempRoot(['Vol1/ja/172/01.png']);
    const result = resolveFiles(root, DEFAULT_RULES);
    expect(result.files[0]).toMatchObject({
      volumeId: 'Vol1',
      volumeRoot: 'Vol1',
      rule: 'volume-language-chapter-page',
    });
    expect(result.files[0].series).toBeUndefined();
  });
});
