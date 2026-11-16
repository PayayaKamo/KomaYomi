import type { MessageKey } from '../i18n';

/**
 * Output sizes for the PNG export.
 *
 * Social platforms crop or letterbox anything that is not their native aspect ratio,
 * so the export fits the composed image inside the target canvas (white margins) instead
 * of cropping artwork or text. `auto` keeps the original pixel size.
 */
export type ShareSizeId =
  | 'auto'
  | 'xhs-3x4'
  | 'xhs-1x1'
  | 'xhs-4x3'
  | 'xhs-long'
  | 'ig-4x5'
  | 'ig-story'
  | 'pin-2x3'
  | 'webtoon-800'
  | 'print-b5'
  | 'print-a4'
  | 'print-a5';

export type ShareSizeGroup = 'xhs' | 'social' | 'print';

export type ShareSizePreset = {
  id: ShareSizeId;
  /** Target width in px; 0 keeps the source width (`auto`). */
  width: number;
  /** Target height in px; 0 derives it from the source aspect ratio. */
  height: number;
  group: ShareSizeGroup;
  label: MessageKey;
};

export const SHARE_SIZE_PRESETS: ShareSizePreset[] = [
  { id: 'auto', width: 0, height: 0, group: 'xhs', label: 'size.auto' },
  // Xiaohongshu / RED: 3:4 portrait fills the discovery feed without cropping.
  { id: 'xhs-3x4', width: 1080, height: 1440, group: 'xhs', label: 'size.xhsPortrait' },
  { id: 'xhs-1x1', width: 1080, height: 1080, group: 'xhs', label: 'size.xhsSquare' },
  { id: 'xhs-4x3', width: 1440, height: 1080, group: 'xhs', label: 'size.xhsLandscape' },
  // Long note/comic strip: fixed 1080 width, height follows the artwork.
  { id: 'xhs-long', width: 1080, height: 0, group: 'xhs', label: 'size.xhsLong' },
  { id: 'ig-4x5', width: 1080, height: 1350, group: 'social', label: 'size.igPortrait' },
  { id: 'ig-story', width: 1080, height: 1920, group: 'social', label: 'size.igStory' },
  { id: 'pin-2x3', width: 1000, height: 1500, group: 'social', label: 'size.pinterest' },
  // Vertical-scroll comics (Webtoon/条漫) are 800px wide per slice.
  { id: 'webtoon-800', width: 800, height: 0, group: 'social', label: 'size.webtoon' },
  // 300 dpi print sizes; B5 is the common Japanese manga trim.
  { id: 'print-b5', width: 2150, height: 3035, group: 'print', label: 'size.printB5' },
  { id: 'print-a4', width: 2480, height: 3508, group: 'print', label: 'size.printA4' },
  { id: 'print-a5', width: 1748, height: 2480, group: 'print', label: 'size.printA5' },
];

export const SHARE_SIZE_GROUPS: { id: ShareSizeGroup; label: MessageKey }[] = [
  { id: 'xhs', label: 'size.groupXhs' },
  { id: 'social', label: 'size.groupSocial' },
  { id: 'print', label: 'size.groupPrint' },
];

export const DEFAULT_SHARE_SIZE: ShareSizeId = 'auto';

/** Canvas edge limit shared by desktop browsers; longer strips are scaled down. */
const MAX_CANVAS_EDGE = 16384;

export function findShareSize(id: string | null | undefined): ShareSizePreset | null {
  if (!id) return null;
  return SHARE_SIZE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Whether a preset actually changes the output size. */
export function isResized(preset: ShareSizePreset | null): boolean {
  return Boolean(preset && preset.width > 0);
}

export type Size = { width: number; height: number };

/**
 * Final canvas size for a source image. Presets with a fixed height ignore the source
 * aspect; width-only presets derive the height and shrink both axes when the result
 * would exceed the browser canvas limit.
 */
export function resolveShareSize(preset: ShareSizePreset, srcW: number, srcH: number): Size {
  const width = Math.max(1, Math.round(preset.width));
  if (preset.height > 0) {
    return { width, height: Math.max(1, Math.round(preset.height)) };
  }
  const ratio = srcW > 0 && srcH > 0 ? srcH / srcW : 1;
  const height = Math.max(1, Math.round(width * ratio));
  // An extremely tall strip would exceed the browser canvas limit; shrink both axes
  // proportionally instead of letterboxing most of the artwork away.
  if (height > MAX_CANVAS_EDGE) {
    return { width: Math.max(1, Math.round(MAX_CANVAS_EDGE / ratio)), height: MAX_CANVAS_EDGE };
  }
  return { width, height };
}

export type FitRect = { x: number; y: number; w: number; h: number };

/** Largest contain-fit rect of the source inside the target, centered with margins. */
export function fitWithin(srcW: number, srcH: number, targetW: number, targetH: number): FitRect {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (targetW - w) / 2, y: (targetH - h) / 2, w, h };
}
