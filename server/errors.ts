/**
 * Structured, language-neutral errors for the HTTP API.
 *
 * Domain modules throw `AppError` with a stable code and interpolation parameters; the
 * HTTP handler renders `error` / `message` in the negotiated language at the boundary.
 * Responses keep the legacy `error` string field so the current client keeps working,
 * and add `code` / `params` / `lang` for programmatic handling.
 */
import { DEFAULT_LANG, t } from './messages/index.ts';
import type { MessageCode, MessageLang, MessageParams } from './messages/index.ts';

export class AppError extends Error {
  readonly code: MessageCode;
  readonly params: MessageParams;
  readonly status: number;

  constructor(code: MessageCode, params: MessageParams = {}, status = 400) {
    super(t(code, params, DEFAULT_LANG));
    this.name = 'AppError';
    this.code = code;
    this.params = params;
    this.status = status;
  }
}

export type ErrorBody = {
  /** Legacy field read by the existing client. */
  error: string;
  /** Same text as `error`, for clients written against the structured contract. */
  message: string;
  code: string;
  params: MessageParams;
  lang: MessageLang;
};

export function errorBody(code: MessageCode, params: MessageParams = {}, lang: MessageLang = DEFAULT_LANG): ErrorBody {
  const message = t(code, params, lang);
  return { error: message, message, code, params, lang };
}

/** Map anything thrown inside a request to a status + structured body. */
export function toErrorResponse(err: unknown, lang: MessageLang): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return { status: err.status, body: errorBody(err.code, err.params, lang) };
  }
  if (err instanceof SyntaxError) {
    return { status: 400, body: errorBody('ERR_INVALID_JSON', { detail: err.message }, lang) };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { status: 500, body: errorBody('ERR_INTERNAL', { detail }, lang) };
}
