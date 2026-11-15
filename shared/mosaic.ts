/**
 * Mosaic (redaction) block size in source pixels.
 * All four render paths — editor, compare read-only layer, HTML/print and PNG/Word —
 * use this so the same annotation looks identical everywhere.
 */
export function mosaicBlockSize(width: number, height: number): number {
  return Math.max(6, Math.round(Math.min(Math.max(1, width), Math.max(1, height)) / 14));
}
