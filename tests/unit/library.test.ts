import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLibrary, encodePath, guessLang, naturalCompare, normalizeLangOrder } from '../../server/library.ts';
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
