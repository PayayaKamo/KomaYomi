/**
 * Request trust checks for the local HTTP API.
 *
 * The server is designed to be reached only from the machine it runs on. Without these
 * checks a web page the user happens to visit could POST to `http://127.0.0.1:<port>`
 * (CSRF) or a malicious DNS name could resolve to 127.0.0.1 (DNS rebinding) and read
 * the library. Every request is therefore checked for:
 *
 *   - a loopback `Host` header (unless LAN access was explicitly enabled),
 *   - a same-origin / local `Origin` and `Sec-Fetch-Site` on non-GET requests,
 *   - `application/json` (or the explicit binary upload type) when a body is sent.
 *
 * Requests without either browser header (curl, scripts, the CLI) are allowed: they are
 * not cross-site browser requests, and form-style cross-site posts always carry Origin.
 */
import type { IncomingMessage } from 'node:http';
import { AppError } from './errors.ts';

export type RequestGuardOptions = {
  /** Accept non-loopback Host headers. Only set when the user explicitly exposes the server. */
  allowLan?: boolean;
  /** Additional origins accepted as same-origin (for example a dev server on another port). */
  allowedOrigins?: string[];
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_SITES = new Set(['same-origin', 'same-site', 'none']);
const ALLOWED_TYPES = ['application/json', 'application/octet-stream'];

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(
    String(host ?? '')
      .trim()
      .toLowerCase(),
  );
}

function hostnameOf(value: string): string {
  if (!value) return '';
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function headerValue(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return String(Array.isArray(value) ? value[0] : (value ?? ''));
}

/** Throw a structured 403/415 error when the request must not be served. */
export function assertTrustedRequest(req: IncomingMessage, opts: RequestGuardOptions = {}): void {
  // ---- Host header: stops DNS rebinding while the server is loopback-only ----
  const hostHeader = headerValue(req, 'host');
  const hostName = hostnameOf(hostHeader);
  if (!hostName) throw new AppError('ERR_UNTRUSTED_HOST', { host: hostHeader || '(missing)' }, 403);
  if (!LOOPBACK_HOSTS.has(hostName) && !opts.allowLan) {
    throw new AppError('ERR_UNTRUSTED_HOST', { host: hostHeader }, 403);
  }

  if (SAFE_METHODS.has(String(req.method ?? 'GET').toUpperCase())) return;

  // ---- Sec-Fetch-Site: browsers label cross-site requests explicitly ----
  const site = headerValue(req, 'sec-fetch-site').toLowerCase();
  if (site && !ALLOWED_SITES.has(site)) {
    throw new AppError('ERR_UNTRUSTED_ORIGIN', { origin: site }, 403);
  }

  // ---- Origin: same host, a loopback origin, or an explicitly allowed one ----
  const origin = headerValue(req, 'origin');
  if (origin) {
    const originName = hostnameOf(origin);
    const local = LOOPBACK_HOSTS.has(originName);
    const sameHost = originName !== '' && originName === hostName;
    const listed = (opts.allowedOrigins ?? []).some((allowed) => {
      try {
        return new URL(allowed).origin === new URL(origin).origin;
      } catch {
        return false;
      }
    });
    if (!local && !sameHost && !listed) {
      throw new AppError('ERR_UNTRUSTED_ORIGIN', { origin }, 403);
    }
  }

  // ---- Content type: JSON only, unless the body is an explicit binary upload ----
  const length = Number(headerValue(req, 'content-length') || 0);
  const hasBody = length > 0 || Boolean(headerValue(req, 'transfer-encoding'));
  if (!hasBody) return;
  const type = headerValue(req, 'content-type').toLowerCase();
  if (!ALLOWED_TYPES.some((allowed) => type.startsWith(allowed))) {
    throw new AppError('ERR_UNSUPPORTED_CONTENT_TYPE', { type: type.split(';')[0] || '(missing)' }, 415);
  }
}
