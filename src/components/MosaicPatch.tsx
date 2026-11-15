import { useEffect, useState } from 'react';
import type { PanelRect } from '../types';
import { mosaicPatchUrl } from '../lib/mosaicPatch';

type Props = {
  /** Page image the mosaic samples from; without it we fall back to a flat block. */
  imageUrl?: string;
  /** Region in whole-page normalized coordinates. */
  region: PanelRect;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Real pixelation for mosaic annotations inside SVG overlays.
 * Until the patch is ready (or when the image is unknown) it paints a flat block,
 * never the old checkerboard, so every surface keeps the same look.
 */
export function MosaicPatch({ imageUrl, region, x, y, width, height }: Props) {
  const [href, setHref] = useState<string | null>(null);
  const { x: regionX, y: regionY, w: regionW, h: regionH } = region;

  useEffect(() => {
    if (!imageUrl) {
      setHref(null);
      return;
    }
    let alive = true;
    mosaicPatchUrl(imageUrl, { x: regionX, y: regionY, w: regionW, h: regionH })
      .then((url) => {
        if (alive) setHref(url);
      })
      .catch(() => {
        if (alive) setHref(null);
      });
    return () => {
      alive = false;
    };
  }, [imageUrl, regionX, regionY, regionW, regionH]);

  if (!href) return <rect x={x} y={y} width={width} height={height} fill="#6b7280" />;
  return <image href={href} x={x} y={y} width={width} height={height} preserveAspectRatio="none" />;
}
