import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { AppError, errorBody, toErrorResponse } from '../../server/errors.ts';
import {
  DEFAULT_LANG,
  MESSAGE_LANGS,
  MESSAGES,
  currentLang,
  formatMessage,
  langFromEnv,
  langName,
  normalizeLang,
  parseAcceptLanguage,
  resolveRequestLang,
  runWithLang,
  t,
} from '../../server/messages/index.ts';

describe('message catalog', () => {
  it('has a non-empty translation for every code in every language', () => {
    for (const [code, entry] of Object.entries(MESSAGES)) {
      for (const lang of MESSAGE_LANGS) {
        expect(entry[lang], `${code}.${lang}`).toBeTypeOf('string');
        expect(entry[lang].trim().length, `${code}.${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it('interpolates named parameters and blanks missing ones', () => {
    expect(formatMessage('Hi {name}, {count} pages', { name: 'A', count: 3 })).toBe('Hi A, 3 pages');
    expect(formatMessage('missing {value}')).toBe('missing ');
    expect(formatMessage('no params')).toBe('no params');
  });
});

describe('language negotiation', () => {
  it('normalizes locale tags to supported base languages', () => {
    expect(normalizeLang('zh-CN')).toBe('zh');
    expect(normalizeLang('ja_JP')).toBe('ja');
    expect(normalizeLang('EN')).toBe('en');
    expect(normalizeLang('fr')).toBeNull();
    expect(normalizeLang('')).toBeNull();
    expect(normalizeLang(null)).toBeNull();
  });

  it('picks the highest weighted Accept-Language entry it supports', () => {
    expect(parseAcceptLanguage('fr-FR,ja;q=0.9,en;q=0.8')).toBe('ja');
    expect(parseAcceptLanguage('en-US,en;q=0.9,zh;q=0.8')).toBe('en');
    expect(parseAcceptLanguage('*;q=1,zh;q=0.5')).toBe('zh');
    expect(parseAcceptLanguage('fr')).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
  });

  it('reads environment fallbacks in priority order', () => {
    expect(langFromEnv({ KOMAYOMI_LANG: 'ja', LANG: 'zh_CN.UTF-8' })).toBe('ja');
    expect(langFromEnv({ MANGA_LOCALE: 'zh', LANG: 'en' })).toBe('zh');
    expect(langFromEnv({ LANG: 'ja_JP.UTF-8' })).toBe('ja');
    expect(langFromEnv({ LANG: 'fr_FR' })).toBeNull();
    expect(langFromEnv({})).toBeNull();
  });

  it('prioritizes ?lang= over Accept-Language', () => {
    const req = { headers: { 'accept-language': 'ja-JP,ja;q=0.9' } } as unknown as IncomingMessage;
    expect(resolveRequestLang(req, new URL('http://localhost/api?lang=zh'))).toBe('zh');
    expect(resolveRequestLang(req, new URL('http://localhost/api'))).toBe('ja');
  });

  it('scopes the active language with AsyncLocalStorage', () => {
    const outer = currentLang();
    expect(runWithLang('ja', () => currentLang())).toBe('ja');
    expect(currentLang()).toBe(outer);
    expect(runWithLang('zh', () => t('ERR_INTERNAL', { detail: 'x' }))).toContain('服务器内部错误');
    expect(t('LANG_NAME_ZH', {}, 'ja')).toBe('中国語');
  });

  it('returns the localized display name for content languages', () => {
    expect(langName('ja', 'en')).toBe('Japanese');
    expect(langName('zh', 'zh')).toBe('中文');
    expect(langName('en', 'ja')).toBe('英語');
  });

  it('defaults to English when nothing matches', () => {
    expect(DEFAULT_LANG).toBe('en');
  });
});

describe('structured errors', () => {
  it('renders a localized body and keeps the legacy error field', () => {
    const body = errorBody('ERR_FILE_NOT_FOUND', { path: 'a.txt' }, 'zh');
    expect(body.code).toBe('ERR_FILE_NOT_FOUND');
    expect(body.lang).toBe('zh');
    expect(body.error).toBe(body.message);
    expect(body.message).toContain('a.txt');
    expect(body.message).toContain('文件不存在');
  });

  it('maps AppError, SyntaxError and unknown errors to status codes', () => {
    const app = toErrorResponse(new AppError('ERR_CHAPTER_NOT_FOUND', { volume: 'V', chapter: '1' }, 404), 'ja');
    expect(app.status).toBe(404);
    expect(app.body.code).toBe('ERR_CHAPTER_NOT_FOUND');
    expect(app.body.message).toContain('話が見つかりません');

    const syntax = toErrorResponse(new SyntaxError('bad token'), 'en');
    expect(syntax.status).toBe(400);
    expect(syntax.body.code).toBe('ERR_INVALID_JSON');
    expect(syntax.body.message).toContain('bad token');

    const internal = toErrorResponse(new Error('boom'), 'en');
    expect(internal.status).toBe(500);
    expect(internal.body.code).toBe('ERR_INTERNAL');
    expect(internal.body.message).toContain('boom');
  });

  it('keeps AppError messages language-neutral (English) by default', () => {
    const err = new AppError('ERR_FILE_NOT_FOUND', { path: 'x' });
    expect(err.message).toContain('File not found');
    expect(err.code).toBe('ERR_FILE_NOT_FOUND');
    expect(err.status).toBe(400);
  });
});
