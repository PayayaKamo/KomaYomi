import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLibrary,
  encodePath,
  guessLang,
  naturalCompare,
  normalizeLangOrder,
  writeLibraryConfig,
} from '../../server/library.ts';
import { makeTempDir, removeDir, writeFile, writeFiles } from '../helpers/tmp.ts';
import { runWithLang } from '../../server/messages/index.ts';

const dirs: string[] = [];

function tempRoot(files: string[]): string {
  const root = makeTempDir('library');
  dirs.push(root);
  writeFiles(root, files);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

describe('guessLang', () => {
  it('matches common spellings for Japanese, Chinese and English', () => {
    expect(guessLang('JP')).toBe('ja');
    expect(guessLang('日本語')).toBe('ja');
    expect(guessLang('ZH_CN')).toBe('zh');
    expect(guessLang('chs')).toBe('zh');
    expect(guessLang('English')).toBe('en');
    expect(guessLang(' en-GB ')).toBe('en');
  });

  it('returns null for unknown or empty directory names', () => {
    expect(guessLang('fr')).toBeNull();
    expect(guessLang('')).toBeNull();
    expect(guessLang('Chinese-ish')).toBeNull();
  });
});

describe('naturalCompare', () => {
  it('compares digit runs numerically', () => {
    expect(['10.png', '2.png', '1.png'].sort(naturalCompare)).toEqual(['1.png', '2.png', '10.png']);
    expect(['第10话', '第2话'].sort(naturalCompare)).toEqual(['第2话', '第10话']);
  });

  it('returns 0 for equal tokens', () => {
    expect(naturalCompare('01.jpg', '01.jpg')).toBe(0);
  });
});

describe('normalizeLangOrder', () => {
  it('drops unknown and duplicate entries, then appends the rest', () => {
    expect(normalizeLangOrder(['zh', 'zh', 'xx' as never])).toEqual(['zh', 'ja', 'en']);
    expect(normalizeLangOrder(undefined)).toEqual(['ja', 'zh', 'en']);
  });
});

describe('encodePath', () => {
  it('percent-encodes every segment', () => {
    expect(encodePath('raw', '点兔 14', '01.png')).toBe('/raw/%E7%82%B9%E5%85%94%2014/01.png');
  });
});

describe('createLibrary', () => {
  it('applies titles, page order, exclusions and page roles from the config', () => {
    const root = tempRoot([
      'raw/Vol1/ja/172/01.png',
      'raw/Vol1/ja/172/02.png',
      'raw/Vol1/ja/172/03.png',
      'raw/Vol1/en/172/01.png',
      'raw/Vol1/en/172/02.png',
      'raw/Vol1/en/172/03.png',
    ]);
    const dataRoot = path.join(root, 'data');
    writeLibraryConfig(dataRoot, {
      volumes: {
        Vol1: {
          title: 'Renamed',
          chapters: { 172: { title: 'Intro', order: [2, 0, 1], excluded: [1], kinds: { 2: 'cover' } } },
        },
      },
    });
    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), dataRoot));
    const volume = library.volumes[0];
    expect(volume.title).toBe('Renamed');
    expect(volume.chapters[0].title).toBe('Intro');
    expect(volume.chapters[0].pages.map((p) => p.index)).toEqual([2, 0, 1]);
    expect(volume.chapters[0].pages.map((p) => p.excluded ?? false)).toEqual([false, false, true]);
    expect(volume.chapters[0].pages[0].kind).toBe('cover');
  });

  it('pairs pages across languages and reports a missing translation', () => {
    const root = tempRoot([
      'raw/Vol1/ja/172/01.png',
      'raw/Vol1/ja/172/02.png',
      'raw/Vol1/zh/172/01.png',
      'raw/Vol1/zh/172/02.png',
      'raw/Vol1/en/172/01.png',
    ]);
    const dataRoot = path.join(root, 'data');
    writeFile(path.join(dataRoot, 'pages', 'Vol1', '172', '0.json'), '{}');

    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), dataRoot));
    expect(library.volumes).toHaveLength(1);
    const volume = library.volumes[0];
    expect(volume.id).toBe('Vol1');
    expect(volume.languages).toEqual(['ja', 'zh', 'en']);
    expect(volume.langDirs).toEqual({ ja: 'ja', zh: 'zh', en: 'en' });
    expect(volume.chapters).toHaveLength(1);

    const chapter = volume.chapters[0];
    expect(chapter.chapter).toBe('172');
    expect(chapter.pages).toHaveLength(2);
    expect(chapter.pages[0].files.en).toBe('/raw/Vol1/en/172/01.png');
    expect(chapter.pages[0].annotated).toBe(true);
    expect(chapter.pages[1].annotated).toBe(false);
    expect(chapter.pages[1].warnings.join(' ')).toContain('English');
    expect(chapter.warnings.join(' ')).toContain('Japanese');
  });

  it('aligns languages by page number and keeps extra Japanese pages readable', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const files: string[] = [];
    for (let i = 1; i <= 14; i++) files.push(`raw/Vol1/ja/199/${pad(i)}.jpg`);
    for (let i = 1; i <= 12; i++) files.push(`raw/Vol1/en/199/${pad(i)}.png`);
    for (let i = 1; i <= 12; i++) files.push(`raw/Vol1/zh/199/${pad(i)}.webp`);

    const root = tempRoot(files);
    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), path.join(root, 'data')));
    const chapter = library.volumes[0].chapters[0];

    // 14 slots, not max(14,12) flat pages: the two Japanese-only pages stay at the end.
    expect(chapter.pages).toHaveLength(14);
    expect(chapter.pages[12].files.ja).toContain('/ja/199/13.jpg');
    expect(chapter.pages[12].files.en).toBeUndefined();
    expect(chapter.pages[12].files.zh).toBeUndefined();
    expect(chapter.pages[12].missing).toEqual(['zh', 'en']);
    expect(chapter.pages[13].files.ja).toContain('/ja/199/14.jpg');
    // The other languages keep their last page aligned to page 12.
    expect(chapter.pages[11].files.zh).toContain('/zh/199/12.webp');
    // Missing pages are reported, but never hide the page itself.
    expect(chapter.pages[12].warnings).toHaveLength(2);
  });

  it('keeps later pages aligned when a middle page is missing', () => {
    const root = tempRoot([
      'raw/Vol1/ja/1/01.jpg',
      'raw/Vol1/ja/1/02.jpg',
      'raw/Vol1/ja/1/03.jpg',
      'raw/Vol1/ja/1/04.jpg',
      'raw/Vol1/ja/1/05.jpg',
      'raw/Vol1/zh/1/01.jpg',
      'raw/Vol1/zh/1/02.jpg',
      'raw/Vol1/zh/1/04.jpg',
      'raw/Vol1/zh/1/05.jpg',
    ]);
    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), path.join(root, 'data')));
    const chapter = library.volumes[0].chapters[0];

    expect(chapter.pages).toHaveLength(5);
    expect(chapter.pages[2].files.ja).toContain('/ja/1/03.jpg');
    expect(chapter.pages[2].missing).toEqual(['zh']);
    // Page 04 must not slide into slot 3.
    expect(chapter.pages[3].files.zh).toContain('/zh/1/04.jpg');
  });

  it('applies a per-language page offset so inserted pages can be re-aligned', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const files: string[] = [];
    for (let i = 1; i <= 14; i++) files.push(`raw/Vol1/ja/199/${pad(i)}.jpg`);
    for (let i = 1; i <= 12; i++) files.push(`raw/Vol1/en/199/${pad(i)}.png`);

    const root = tempRoot(files);
    const dataRoot = path.join(root, 'data');
    // English pages 11 and 12 belong to Japanese pages 13 and 14: a Japanese-only spread
    // was inserted after page 10.
    writeLibraryConfig(dataRoot, {
      volumes: { Vol1: { chapters: { 199: { pageOffsets: { en: { from: 11, to: 13 } } } } } },
    });

    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), dataRoot));
    const chapter = library.volumes[0].chapters[0];

    expect(chapter.pages).toHaveLength(14);
    expect(chapter.pages[10].missing).toEqual(['en']);
    expect(chapter.pages[12].files.en).toContain('/en/199/11.png');
    expect(chapter.pages[13].files.en).toContain('/en/199/12.png');
    expect(chapter.pageOffsets).toEqual({ en: { from: 11, to: 13 } });
  });

  it('recognises several works under one raw root', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const files: string[] = [];
    for (const lang of ['en', 'ja', 'zh']) {
      for (let i = 1; i <= 8; i++) files.push(`raw/gochiusa/gochiusa-14/${lang}/172/${pad(i)}.png`);
    }
    for (const lang of ['en', 'ja']) {
      for (let i = 1; i <= 8; i++) files.push(`raw/oomuroke/oomuroke-08/${lang}/106/${pad(i)}.png`);
    }
    for (let i = 1; i <= 8; i++) files.push(`raw/oomuroke/oomuroke-08/zh-hk/106/${pad(i)}.webp`);
    for (let i = 1; i <= 12; i++) files.push(`raw/yuruyuri/yuruyuri-24/en/199/${pad(i)}.png`);
    for (let i = 1; i <= 14; i++) files.push(`raw/yuruyuri/yuruyuri-24/ja/199/${pad(i)}.jpg`);
    for (let i = 1; i <= 12; i++) files.push(`raw/yuruyuri/yuruyuri-24/zh/199/${pad(i)}.webp`);

    const root = tempRoot(files);
    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), path.join(root, 'data')));

    expect(library.scan.unmatchedCount).toBe(0);
    expect(library.volumes.map((v) => v.id)).toEqual(['gochiusa-14', 'oomuroke-08', 'yuruyuri-24']);
    expect(library.volumes.map((v) => v.series)).toEqual(['gochiusa', 'oomuroke', 'yuruyuri']);

    const gochiusa = library.volumes[0];
    expect(gochiusa.languages).toEqual(['ja', 'zh', 'en']);
    expect(gochiusa.langDirs).toEqual({ ja: 'ja', zh: 'zh', en: 'en' });
    expect(gochiusa.chapters[0].pages).toHaveLength(8);
    expect(gochiusa.chapters[0].pages[0].files.ja).toBe('/raw/gochiusa/gochiusa-14/ja/172/01.png');

    const oomuroke = library.volumes[1];
    expect(oomuroke.langDirs).toEqual({ ja: 'ja', zh: 'zh-hk', en: 'en' });
    // Mixed extensions and a zh-hk column still line up page by page.
    expect(oomuroke.chapters[0].pages[0].files.zh).toBe('/raw/oomuroke/oomuroke-08/zh-hk/106/01.webp');

    const yuruyuri = library.volumes[2];
    expect(yuruyuri.langDirs).toEqual({ ja: 'ja', zh: 'zh', en: 'en' });
    // Japanese has two extra pages; the other languages stay aligned and report the gap.
    expect(yuruyuri.chapters[0].pages).toHaveLength(14);
    expect(yuruyuri.chapters[0].pages[13].files.ja).toBe('/raw/yuruyuri/yuruyuri-24/ja/199/14.jpg');
    expect(yuruyuri.chapters[0].pages[13].missing).toEqual(['zh', 'en']);
  });

  it('keeps a configured language order', () => {
    const root = tempRoot(['raw/Vol1/ja/01.png', 'raw/Vol1/en/01.png']);
    const dataRoot = path.join(root, 'data');
    writeFile(path.join(dataRoot, 'library.json'), JSON.stringify({ langOrder: ['en', 'ja'] }));

    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), dataRoot));
    expect(library.langOrder).toEqual(['en', 'ja', 'zh']);
  });

  it('falls back to the default rules when the configured rules are invalid', () => {
    const root = tempRoot(['raw/Vol1/ja/172/01.png']);
    const dataRoot = path.join(root, 'data');
    writeFile(path.join(dataRoot, 'library.json'), JSON.stringify({ rules: [{ id: 'broken', pattern: '{volume}' }] }));

    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), dataRoot));
    expect(library.scan.warning).toBeTruthy();
    expect(library.volumes).toHaveLength(1);
    expect(library.volumes[0].chapters[0].pages).toHaveLength(1);
  });

  it('accepts an unknown language folder as a runtime language', () => {
    const root = tempRoot(['raw/Mystery/fr/172/01.png']);
    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), path.join(root, 'data')));

    expect(library.volumes).toHaveLength(1);
    expect(library.volumes[0].id).toBe('Mystery');
    expect(library.volumes[0].languages).toEqual(['fr']);
    expect(library.volumes[0].langDirs).toEqual({ fr: 'fr' });
    expect(library.volumes[0].chapters).toHaveLength(1);
    expect(library.volumes[0].chapters[0].pages[0].files).toHaveProperty('fr');
  });

  it('returns an empty library when raw/ does not exist', () => {
    const root = makeTempDir('library-missing');
    dirs.push(root);
    const library = runWithLang('en', () => createLibrary(path.join(root, 'raw'), path.join(root, 'data')));
    expect(library.volumes).toEqual([]);
    expect(library.languages).toEqual(['ja', 'zh', 'en']);
  });
});
