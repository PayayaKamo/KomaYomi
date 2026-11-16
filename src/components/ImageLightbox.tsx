import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Lang } from '../types';
import { langLabel, useI18n } from '../i18n';

/** One inspectable artwork image; `panelId` groups the languages of the same panel. */
export type ZoomImageItem = {
  src: string;
  lang: Lang;
  panelId?: string;
  /** Sub-region of the page image, in 0..1 fractions, when the caller shows a panel crop. */
  crop?: { x: number; y: number; w: number; h: number };
};

type Props = {
  items: ZoomImageItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Full-screen artwork viewer opened from the image context menu.
 *
 * The picture is rendered at its natural resolution and transformed with pan/zoom;
 * panning is clamped to the image edges, so a zoomed page never drifts into the void.
 * Switching language keeps the same panel, arrows walk the reading order (same
 * language), and closing only unmounts this overlay — the view underneath keeps its
 * own position and zoom.
 */
export function ImageLightbox({ items, index, onIndexChange, onClose }: Props) {
  const { t, formatNumber } = useI18n();
  const item = items[index];
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  /** A press that began on blank backdrop and did not turn into a pan still closes. */
  const blankDownRef = useRef(false);
  const movedRef = useRef(false);

  const crop = item?.crop;
  const cropW = crop?.w ?? 1;
  const cropH = crop?.h ?? 1;

  const clampView = useCallback(
    (next: { x: number; y: number; scale: number }) => {
      const stage = stageRef.current;
      const img = imgRef.current;
      if (!stage || !img || !img.naturalWidth) return next;
      const width = img.naturalWidth * cropW * next.scale;
      const height = img.naturalHeight * cropH * next.scale;
      const maxX = Math.max(0, (width - stage.clientWidth) / 2);
      const maxY = Math.max(0, (height - stage.clientHeight) / 2);
      return { ...next, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
    },
    [cropW, cropH],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      setView((prev) => clampView({ ...prev, scale: clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE) }));
    },
    [clampView],
  );

  // A new image starts centred at its natural size.
  useEffect(() => {
    setView({ x: 0, y: 0, scale: 1 });
    setNatural(null);
  }, [index]);

  // Only the images of the current language take part in previous/next, so paging
  // walks the reading order instead of hopping between languages of one panel.
  const sameLang = items.map((entry, i) => (entry.lang === item?.lang ? i : -1)).filter((i) => i >= 0);
  const pos = sameLang.indexOf(index);
  const canPrev = pos > 0;
  const canNext = pos >= 0 && pos < sameLang.length - 1;
  const step = (dir: -1 | 1) => {
    const target = sameLang[pos + dir];
    if (target !== undefined) onIndexChange(target);
  };

  // The viewer owns Escape and the arrow keys while open; capture stops the views below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        const target = canNext ? sameLang[pos + 1] : undefined;
        if (target === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        onIndexChange(target);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        const target = canPrev ? sameLang[pos - 1] : undefined;
        if (target === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        onIndexChange(target);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(1.2);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(1 / 1.2);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canPrev, canNext, pos, sameLang, onClose, onIndexChange, zoomBy]);

  // Keep the page behind from scrolling while the viewer is up.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Wheel zoom needs a non-passive listener; React's synthetic wheel is passive.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    blankDownRef.current = e.target === e.currentTarget;
    movedRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
    setDragging(true);
  };
  const movePan = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) movedRef.current = true;
    setView((prev) => clampView({ ...prev, x: drag.x + (e.clientX - drag.sx), y: drag.y + (e.clientY - drag.sy) }));
  };
  const endPan = () => {
    dragRef.current = null;
    setDragging(false);
  };

  if (!item) return null;

  const langs = [...new Set(items.map((entry) => entry.lang))];
  const activeLang = item.lang;

  /** Same panel in another language when possible, otherwise the first image in that language. */
  const switchLang = (lang: Lang) => {
    const samePanel = items.findIndex((entry) => entry.lang === lang && entry.panelId === item.panelId);
    const any = items.findIndex((entry) => entry.lang === lang);
    const next = samePanel >= 0 ? samePanel : any;
    if (next >= 0 && next !== index) onIndexChange(next);
  };

  // The crop box is expressed in natural pixels, so a panel crop still renders 1:1.
  const box = natural ? { w: natural.w * cropW, h: natural.h * cropH } : null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t('lightbox.title')}
      onClick={(e) => {
        // Only blank backdrop clicks close; buttons and the artwork itself are excluded.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lightbox-bar">
        {langs.length > 1 && (
          <div className="lightbox-langs" role="group" aria-label={t('lightbox.language')}>
            {langs.map((lang) => (
              <button
                type="button"
                key={lang}
                className={`lang-chip ${lang === activeLang ? 'on' : ''}`}
                aria-pressed={lang === activeLang}
                onClick={() => switchLang(lang)}
                title={langLabel(lang)}
              >
                {langLabel(lang)}
              </button>
            ))}
          </div>
        )}
        <span className="lightbox-count">
          {formatNumber(Math.max(0, pos) + 1)} / {formatNumber(sameLang.length)}
        </span>
        <button
          type="button"
          className="btn icon tiny"
          onClick={() => step(-1)}
          disabled={!canPrev}
          title={t('lightbox.prev')}
          aria-label={t('lightbox.prev')}
        >
          ‹
        </button>
        <button
          type="button"
          className="btn icon tiny"
          onClick={() => step(1)}
          disabled={!canNext}
          title={t('lightbox.next')}
          aria-label={t('lightbox.next')}
        >
          ›
        </button>
        <span className="lightbox-zoom">
          <button type="button" className="btn icon tiny" onClick={() => zoomBy(0.85)} title={t('lightbox.zoomOut')}>
            −
          </button>
          <span className="lightbox-zoom-value">{Math.round(view.scale * 100)}%</span>
          <button type="button" className="btn icon tiny" onClick={() => zoomBy(1.18)} title={t('lightbox.zoomIn')}>
            +
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() => setView({ x: 0, y: 0, scale: 1 })}
            title={t('lightbox.actualSize')}
          >
            {t('lightbox.actualSizeShort')}
          </button>
        </span>
        <button
          type="button"
          className="btn icon tiny lightbox-close"
          onClick={onClose}
          title={t('lightbox.close')}
          aria-label={t('lightbox.close')}
        >
          ✕
        </button>
      </div>
      <div
        className={`lightbox-stage ${dragging ? 'dragging' : ''}`}
        ref={stageRef}
        onClick={(e) => {
          // Pointer capture retargets clicks to the stage, so close only presses that
          // started on blank backdrop and did not become a pan.
          if (e.target === e.currentTarget && blankDownRef.current && !movedRef.current) onClose();
        }}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={() => setView((prev) => clampView({ ...prev, scale: prev.scale > 1 ? 1 : 2 }))}
      >
        {box ? (
          <div
            className="lightbox-frame"
            style={{
              width: box.w,
              height: box.h,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          >
            <img
              ref={imgRef}
              src={item.src}
              alt=""
              draggable={false}
              style={
                crop
                  ? {
                      position: 'absolute',
                      left: -crop.x * natural!.w,
                      top: -crop.y * natural!.h,
                      width: natural!.w,
                      height: natural!.h,
                    }
                  : { width: '100%', height: '100%' }
              }
            />
          </div>
        ) : (
          <img
            ref={imgRef}
            className="lightbox-img"
            src={item.src}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
        )}
      </div>
      <div className="lightbox-hint">{t('lightbox.hint')}</div>
    </div>
  );
}
