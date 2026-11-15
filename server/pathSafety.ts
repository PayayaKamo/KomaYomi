/**
 * Path safety for files derived from request data.
 *
 * Volume ids and chapter ids arrive in request bodies and query strings, and they are
 * used as directory names under `data/pages` and `data/history`. A single `..` segment
 * would let a request read or overwrite files outside the data root, so every path is
 * built through these helpers: segments are validated, then the resolved path is
 * asserted to stay inside its root.
 */
import path from 'node:path';
import { AppError } from './errors.ts';

/** One directory-name segment taken from a request. Returns null when unsafe. */
export function safeSegment(input: string): string | null {
  const clean = String(input ?? '').trim();
  if (!clean || clean === '.' || clean === '..') return null;
  if (/[\\/:*?"<>|\0]/.test(clean)) return null;
  return clean;
}

/** Validate a volume/chapter id, throwing the shared structured error when unsafe. */
export function assertSafeSegment(input: unknown, label: string): string {
  const clean = safeSegment(String(input ?? ''));
  if (!clean) throw new AppError('ERR_UNSAFE_SEGMENT', { segment: label }, 400);
  return clean;
}

/** Join segments below `root` and refuse anything that resolves outside it. */
export function resolveWithin(root: string, ...segments: string[]): string {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);
  const guard = base.endsWith(path.sep) ? base : base + path.sep;
  if (target === base || !target.startsWith(guard)) {
    throw new AppError('ERR_PATH_ESCAPE', { path: segments.join(path.sep) }, 400);
  }
  return target;
}
