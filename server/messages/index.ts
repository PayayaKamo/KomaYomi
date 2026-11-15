/**
 * Language negotiation for server-side messages.
 *
 * Priority for HTTP responses: `?lang=` query parameter > `Accept-Language` header >
 * `KOMAYOMI_LANG` / `MANGA_LOCALE` / `LANG` environment > English.
 *
 * Domain modules never receive a language argument: the HTTP handler and the CLI wrap
 * their work in `runWithLang()`, so `t()` renders warnings and history summaries in the
 * same language as the surrounding response.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import { MESSAGE_LANGS, MESSAGES, formatMessage } from './catalog.ts';
import type { MessageCode, MessageLang, MessageParams } from './catalog.ts';

export { MESSAGE_LANGS, MESSAGES, formatMessage };
export type { MessageCode, MessageLang, MessageParams };

const storage = new AsyncLocalStorage<MessageLang>();

export const DEFAULT_LANG: MessageLang = 'en';

/** Accepts `zh`, `zh-CN`, `ja_JP`, `en-US`, … and returns a supported language or null. */
export function normalizeLang(input: string | null | undefined): MessageLang | null {
  if (!input) return null;
  const base = input.trim().toLowerCase().split(/[-_]/)[0];
  return (MESSAGE_LANGS as readonly string[]).includes(base) ? (base as MessageLang) : null;
}

/** Parse the q-weighted `Accept-Language` header, returning the best supported match. */
export function parseAcceptLanguage(header: string | null | undefined): MessageLang | null {
  if (!header) return null;
  const entries = header
    .split(',')
    .map((part) => {
      const [tag, ...rest] = part.trim().split(';');
      const q = rest.map((s) => s.trim()).find((s) => s.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag && entry.tag !== '*')
    .sort((a, b) => b.weight - a.weight);
  for (const entry of entries) {
    const lang = normalizeLang(entry.tag);
    if (lang) return lang;
  }
  return null;
}

/** Environment fallbacks shared by the HTTP server and the CLI. */
export function langFromEnv(env: NodeJS.ProcessEnv = process.env): MessageLang | null {
  return (
    normalizeLang(env.KOMAYOMI_LANG) ??
    normalizeLang(env.MANGA_LOCALE) ??
    normalizeLang(env.LC_ALL) ??
    normalizeLang(env.LANG) ??
    null
  );
}

/** Resolve the language for an HTTP request, including `?lang=` and `Accept-Language`. */
export function resolveRequestLang(req: IncomingMessage, url: URL): MessageLang {
  return (
    normalizeLang(url.searchParams.get('lang')) ??
    parseAcceptLanguage(req.headers['accept-language']) ??
    langFromEnv() ??
    DEFAULT_LANG
  );
}

export function currentLang(): MessageLang {
  return storage.getStore() ?? langFromEnv() ?? DEFAULT_LANG;
}

export function runWithLang<T>(lang: MessageLang, fn: () => T): T {
  return storage.run(lang, fn);
}

/** Render a catalog message in the given language (defaults to the active context). */
export function t(code: MessageCode, params: MessageParams = {}, lang?: MessageLang): string {
  const entry = MESSAGES[code];
  return formatMessage(entry[lang ?? currentLang()] ?? entry[DEFAULT_LANG], params);
}

/** Localized display name for a content language ("ja" → Japanese / 日文 / 日本語). */
export function langName(lang: string, language?: MessageLang): string {
  const code = lang === 'ja' ? 'LANG_NAME_JA' : lang === 'zh' ? 'LANG_NAME_ZH' : 'LANG_NAME_EN';
  return t(code, {}, language);
}
