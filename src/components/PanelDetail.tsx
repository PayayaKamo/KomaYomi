import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Annotation, AlignOffset, Lang, NoteAnchor, NoteTypeDef, PageDoc, PageEntry, Panel } from '../types';
import { langShort, DEFAULT_OFFSET } from '../types';
import { langLabel, useI18n } from '../i18n';
import { ANNOTATION_TOOLS } from './AnnotationLayer';
import { AnnotationOverlay } from './AnnotationOverlay';
import { CropLayer } from './CropLayer';
import { NoteAnchorLayer } from './NoteAnchorLayer';
import { NotesPanel } from './NotesPanel';
import type { NoteEditSession, NotesPanelHandle } from './NotesPanel';
import type { ZoomImageItem } from './ImageLightbox';
import { isNativeTextTarget, useContextMenu } from './ContextMenu';
import { applyGroupOrder, sortPanels } from '../lib/geometry';
import { isModalOpen } from '../lib/modalOpen';
import { clampAnchorPoint, panePointToPage } from '../../shared/noteAnchors';
import { pickNoteAnchor, useAnchorPicking } from '../lib/noteAnchorPick';
import { useCompareLayout } from '../hooks/useCompareLayout';

type MaskStyle = 'blur' | 'solid';

type Props = {
  doc: PageDoc;
  page: PageEntry;
  panel: Panel;
  /** Zero-based position in reading order, and the number of panels on this page. */
  index: number;
  total: number;
  /** Enabled languages in the configured order; masking follows the compare view. */
  langs: Lang[];
  maskStyle: MaskStyle;
  isMasked: (panelId: string, lang: Lang) => boolean;
  reveal: (panelId: string, lang: Lang) => void;
  annotations: Annotation[];
  annotationsVisible: boolean;
  /** Panel crop width/height ratio for one language. */
  aspectOf: (lang: Lang) => number;
  /** Stored alignment offset for one language on this panel. */
  offsetOf: (lang: Lang) => AlignOffset;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Page turns that keep the detail open; undefined at the first/last page. */
  onPrevPage?: () => void;
  onNextPage?: () => void;
  /** Note authoring uses the same document mutation path as the sidebar panel. */
  mutate: (fn: (doc: PageDoc) => PageDoc) => void;
  /** Save the page immediately after the composer flushes, before panel/page navigation. */
  onFlush?: () => void | Promise<void>;
  noteTypes?: NoteTypeDef[];
  onNoteTypesChange?: (types: NoteTypeDef[]) => void;
  /** Category preselected by a compare-view marker. */
  focusNoteType?: string | null;
  /** Read-only viewer: notes are visible but authoring stays disabled. */
  readOnly?: boolean;
  /** Single-editor session owned by the app shell, shared with the sidebar and inline editors. */
  noteEdit?: NoteEditSession | null;
  onNoteEditChange?: (next: NoteEditSession | null) => void;
  /** Open the full-screen viewer on this panel, in page reading order. */
  onZoomImage?: (items: ZoomImageItem[], index: number) => void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

/** Artwork / notes split, remembered across panels, pages and reloads. */
const SPLIT_KEY = 'manga-memo.detail-split';
const DEFAULT_SPLIT = 0.62;
const MIN_SPLIT = 0.3;
const MAX_SPLIT = 0.78;
/** Below this the two columns get too narrow to read, so the view stacks instead. */
const STACK_WIDTH = 900;
/** Even a manual "side by side" choice gives way below this, with a visible reason. */
const FORCE_STACK_WIDTH = 720;

/**
 * Artwork / notes arrangement. "auto" follows the responsive rules; a manual choice wins
 * (except for the hard narrow limit above) and is remembered.
 */
const LAYOUT_KEY = 'manga-memo.detail-layout';
type DetailLayout = 'auto' | 'split' | 'stacked';

function loadDetailLayout(): DetailLayout {
  try {
    const value = localStorage.getItem(LAYOUT_KEY);
    return value === 'split' || value === 'stacked' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

/** Language columns: side by side (default) or stacked full-width. */
const PANE_LAYOUT_KEY = 'manga-memo.detail-panes';
type PaneLayout = 'row' | 'column';

function loadPaneLayout(): PaneLayout {
  try {
    return localStorage.getItem(PANE_LAYOUT_KEY) === 'column' ? 'column' : 'row';
  } catch {
    return 'row';
  }
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

function loadSplit(): number {
  try {
    const n = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(n) && n >= MIN_SPLIT && n <= MAX_SPLIT ? n : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

/** Per-language zoom, remembered across panels, pages and reloads. */
const ZOOM_KEY = 'manga-memo.detail-zoom';

function loadZoom(): Partial<Record<Lang, number>> {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<Lang, number>> = {};
    for (const [lang, value] of Object.entries(parsed)) {
      const n = Number(value);
      if (Number.isFinite(n)) out[lang as Lang] = clampZoom(n);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Enlarged comparison for one panel: every enabled language side by side (stacked on
 * phones and tablets), followed by this panel's notes and annotations.
 *
 * Keyboard handling lives here while the view is open so arrow keys switch panels
 * instead of turning pages; Esc and the browser Back button both leave.
 */
export function PanelDetail({
  doc,
  page,
  panel,
  index,
  total,
  langs,
  maskStyle,
  isMasked,
  reveal,
  annotations,
  annotationsVisible,
  aspectOf,
  offsetOf,
  onClose,
  onPrev,
  onNext,
  onPrevPage,
  onNextPage,
  mutate,
  onFlush,
  noteTypes,
  onNoteTypesChange,
  focusNoteType = null,
  readOnly = false,
  noteEdit = null,
  onNoteEditChange,
  onZoomImage,
}: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const { openMenu } = useContextMenu();
  const layout = useCompareLayout();
  const [narrow, setNarrow] = useState(() => window.innerWidth < STACK_WIDTH);
  const [veryNarrow, setVeryNarrow] = useState(() => window.innerWidth < FORCE_STACK_WIDTH);
  const [layoutPref, setLayoutPref] = useState<DetailLayout>(loadDetailLayout);
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(loadPaneLayout);
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** Manual choice wins over responsive rules unless the window is genuinely too narrow. */
  const autoStacked = layout.mode !== 'desktop' || narrow;
  const stacked = veryNarrow || (layoutPref === 'auto' ? autoStacked : layoutPref === 'stacked');
  /** Very narrow windows always stack the languages; otherwise the choice is honoured. */
  const effectivePaneLayout = veryNarrow ? 'column' : paneLayout;
  const [zoomByLang, setZoomByLang] = useState<Partial<Record<Lang, number>>>(loadZoom);
  /** Lane the header zoom controls act on while "sync move" is off. */
  const [lastLang, setLastLang] = useState<Lang>(langs[0] ?? 'ja');
  const zoomOf = (lang: Lang) => zoomByLang[lang] ?? 1;
  const zoomByLangRef = useRef(zoomByLang);
  zoomByLangRef.current = zoomByLang;
  const syncAllRef = useRef(false);
  const langsRef = useRef(langs);
  langsRef.current = langs;
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Notes column, scrolled independently so the artwork stays in view. */
  const sideRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<NotesPanelHandle>(null);
  const [split, setSplit] = useState(loadSplit);
  const [splitting, setSplitting] = useState(false);
  /** Language whose fine-tune controls are open (one at a time) and the "move all" toggle. */
  const [tuneLang, setTuneLang] = useState<Lang | null>(null);
  const [syncAll, setSyncAll] = useState(false);
  syncAllRef.current = syncAll;
  /**
   * Session-only alignment overrides, one per language. Empty means "show whatever the
   * compare view has saved"; nothing here is written back to the project.
   */
  const [sessionAlign, setSessionAlign] = useState<Partial<Record<Lang, AlignOffset>>>({});
  const [alignOpen, setAlignOpen] = useState(false);
  /** Short-lived status under the header when a reset finds nothing to reset. */
  const [resetHint, setResetHint] = useState(false);
  const resetHintTimer = useRef<number | undefined>(undefined);
  const flashResetHint = () => {
    setResetHint(true);
    window.clearTimeout(resetHintTimer.current);
    resetHintTimer.current = window.setTimeout(() => setResetHint(false), 1600);
  };
  useEffect(() => () => window.clearTimeout(resetHintTimer.current), []);

  const notes = doc.notes.filter((n) => n.scope === 'panel' && n.panelId === panel.id);
  const panelAnnotations = annotations.filter((a) => a.scope === 'panel' && a.panelId === panel.id);

  const alignOf = (lang: Lang): AlignOffset => sessionAlign[lang] ?? offsetOf(lang);

  /** Whether this language carries a session override that a reset would actually clear. */
  const hasAlignOverride = (lang: Lang): boolean => {
    const a = sessionAlign[lang];
    if (!a) return false;
    return a.x !== DEFAULT_OFFSET.x || a.y !== DEFAULT_OFFSET.y || a.scale !== DEFAULT_OFFSET.scale;
  };

  /** The embedded composer is placing a note pin: the next click on a pane becomes the anchor. */
  const anchorPicking = useAnchorPicking();

  const placeNoteAnchor = (e: ReactPointerEvent<HTMLDivElement>, lang: Lang, offset: AlignOffset) => {
    if (!anchorPicking) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const u = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const v = r.height ? (e.clientY - r.top) / r.height : 0.5;
    // The .detail-zoom layer scales the artwork around the centre, so undo that zoom too.
    const point = clampAnchorPoint(panePointToPage(u, v, panel.rect, offset, zoomOf(lang)), panel.rect);
    pickNoteAnchor({ x: point.x, y: point.y, lang });
  };

  const moveNoteAnchors = (ids: string[], anchor: NoteAnchor) => {
    const updatedAt = new Date().toISOString();
    mutate((d) => ({
      ...d,
      notes: d.notes.map((n) => (ids.includes(n.id) ? { ...n, anchor, updatedAt } : n)),
    }));
  };

  const scaleLang = (lang: Lang, factor: number) =>
    setSessionAlign((prev) => {
      const targets = syncAll ? langs : [lang];
      const next: Partial<Record<Lang, AlignOffset>> = { ...prev };
      for (const target of targets) {
        const base = prev[target] ?? offsetOf(target);
        next[target] = {
          ...base,
          scale: Math.min(3, Math.max(0.2, Number((base.scale * factor).toFixed(3)))),
        };
      }
      return next;
    });

  /** Pointer drag on the artwork nudges Δ offsets; "sync move" drags every language together. */
  const alignDrag = useRef<{
    lang: Lang;
    startX: number;
    startY: number;
    w: number;
    h: number;
    base: Partial<Record<Lang, AlignOffset>>;
  } | null>(null);
  const [dragLang, setDragLang] = useState<Lang | null>(null);

  const startAlignDrag = (e: ReactPointerEvent<HTMLDivElement>, lang: Lang) => {
    // Anchor picking owns the click; touch keeps scrolling the page instead of nudging.
    if (anchorPicking || e.button !== 0 || e.pointerType !== 'mouse' || isModalOpen()) return;
    const r = e.currentTarget.getBoundingClientRect();
    alignDrag.current = {
      lang,
      startX: e.clientX,
      startY: e.clientY,
      w: r.width || 1,
      h: r.height || 1,
      base: Object.fromEntries(langs.map((l) => [l, { ...alignOf(l) }])),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragLang(lang);
    setLastLang(lang);
  };
  const moveAlignDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = alignDrag.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / drag.w;
    const dy = (e.clientY - drag.startY) / drag.h;
    const moving = syncAll ? langs : [drag.lang];
    setSessionAlign((prev) => {
      const next: Partial<Record<Lang, AlignOffset>> = { ...prev };
      for (const lang of moving) {
        const base = drag.base[lang] ?? DEFAULT_OFFSET;
        next[lang] = {
          ...base,
          x: Math.min(1, Math.max(-1, base.x + dx)),
          y: Math.min(1, Math.max(-1, base.y + dy)),
        };
      }
      return next;
    });
  };
  const endAlignDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!alignDrag.current) return;
    alignDrag.current = null;
    setDragLang(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  /** Drag the divider between artwork and notes; the ratio is remembered in localStorage. */
  const startSplitDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body) return;
    e.preventDefault();
    const rect = body.getBoundingClientRect();
    setSplitting(true);
    const move = (ev: PointerEvent) => {
      if (!rect.width) return;
      const ratio = (ev.clientX - rect.left) / rect.width;
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio)));
    };
    const end = () => {
      setSplitting(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const resetLang = (lang: Lang) => {
    if (!hasAlignOverride(lang)) {
      flashResetHint();
      return;
    }
    setSessionAlign((prev) => ({ ...prev, [lang]: { ...DEFAULT_OFFSET } }));
  };
  /** Alignment reset that covers every language, whether nudged singly or with "sync move". */
  const resetAll = () => {
    if (!langs.some(hasAlignOverride)) {
      flashResetHint();
      return;
    }
    setSessionAlign(
      Object.fromEntries(langs.map((lang) => [lang, { ...DEFAULT_OFFSET }])) as Record<Lang, AlignOffset>,
    );
  };
  /**
   * Header reset: one click puts the current panel back to fit-to-width *and* clears every
   * Δ offset, so it is never a no-op that looks broken.
   */
  const resetView = () => {
    const anyAlign = langs.some(hasAlignOverride);
    const anyZoom = langs.some((lang) => zoomOf(lang) !== 1);
    if (!anyAlign && !anyZoom) {
      flashResetHint();
      return;
    }
    setZoomByLang({});
    setSessionAlign(
      Object.fromEntries(langs.map((lang) => [lang, { ...DEFAULT_OFFSET }])) as Record<Lang, AlignOffset>,
    );
  };

  const formatAlign = (offset: AlignOffset) =>
    `Δ${Math.round(offset.x * 100)},${Math.round(offset.y * 100)} ×${offset.scale.toFixed(2)}`;

  /** Right-click on the artwork opens the shared full-screen viewer on this panel. */
  const openPaneImageMenu = (e: ReactMouseEvent, lang: Lang) => {
    if (isNativeTextTarget(e.target)) return;
    const url = page.files[lang];
    if (!url || !onZoomImage) return;
    e.preventDefault();
    e.stopPropagation();
    // Previous/next follows the page reading order, not the order of enabled languages.
    const order = applyGroupOrder(sortPanels(doc.panels, doc.readingDirection), doc.groups);
    const items: ZoomImageItem[] = [];
    let target = 0;
    for (const p of order) {
      for (const l of langs) {
        const src = page.files[l];
        if (!src) continue;
        if (p.id === panel.id && l === lang) target = items.length;
        items.push({ src, lang: l, panelId: p.id, crop: p.rect });
      }
    }
    openMenu(e, [
      {
        id: 'zoom',
        label: t('ctx.zoomImage'),
        onSelect: () => onZoomImage(items, target),
      },
    ]);
  };

  /** Persist whatever the embedded composer holds before leaving this panel or page. */
  const flushThen = useCallback(
    (action?: () => void) => {
      notesRef.current?.flush();
      // The mutation above is synchronous; writing now keeps the note even if the user
      // turns the page before the autosave debounce fires.
      void onFlush?.();
      action?.();
    },
    [onFlush],
  );

  // Focus moves into the view and returns to whatever had it before, so the reading
  // shortcuts below cannot act while focus is still on a toolbar underneath.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // A new panel or page keeps the zoom and split the reader chose, resets alignment and
  // returns the notes column to its top; only leaving the view restores the defaults.
  useEffect(() => {
    setSessionAlign({});
    scrollRef.current?.scrollTo({ top: 0 });
    sideRef.current?.scrollTo({ top: 0 });
  }, [panel.id]);

  // Narrow windows fall back to the stacked layout even with a mouse attached.
  useEffect(() => {
    const onResize = () => {
      setNarrow(window.innerWidth < STACK_WIDTH);
      setVeryNarrow(window.innerWidth < FORCE_STACK_WIDTH);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Both layout choices outlive the view, next to the split and zoom preferences.
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layoutPref);
    } catch {
      /* private mode: keep the session value only */
    }
  }, [layoutPref]);

  useEffect(() => {
    try {
      localStorage.setItem(PANE_LAYOUT_KEY, paneLayout);
    } catch {
      /* private mode: keep the session value only */
    }
  }, [paneLayout]);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, split.toFixed(3));
    } catch {
      /* private mode: keep the session value only */
    }
  }, [split]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Another dialog (volume settings, export…) owns the keyboard while it is open.
      if (isModalOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        // A popover swallows the first Escape; the second one leaves the view.
        if (layoutOpen) {
          setLayoutOpen(false);
          return;
        }
        flushThen(onClose);
        return;
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const items = Array.from(
          root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      const prev = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === '[';
      const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ']';
      if (prev && onPrev) {
        e.preventDefault();
        flushThen(onPrev);
      } else if (next && onNext) {
        e.preventDefault();
        flushThen(onNext);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flushThen, onClose, onPrev, onNext, layoutOpen]);

  // Wheel and pinch zoom the artwork only. "Sync move" decides whether the gesture
  // applies to the lane under the cursor or to every language at once.
  useEffect(() => {
    const el = panesRef.current;
    if (!el) return;
    const laneOf = (target: EventTarget | null): Lang | null => {
      const pane = (target as HTMLElement | null)?.closest?.('.detail-pane') as HTMLElement | null;
      return (pane?.dataset.lang as Lang | undefined) ?? null;
    };
    const applyZoom = (lang: Lang | null, next: (current: number) => number) => {
      if (!lang) return;
      const targets = syncAllRef.current ? langsRef.current : [lang];
      setZoomByLang((prev) => {
        const out: Partial<Record<Lang, number>> = { ...prev };
        for (const target of targets) out[target] = clampZoom(next(prev[target] ?? 1));
        return out;
      });
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY || isModalOpen()) return;
      const lang = laneOf(e.target);
      if (!lang) return;
      e.preventDefault();
      applyZoom(lang, (z) => z * (e.deltaY < 0 ? 1.08 : 0.92));
    };
    const distance = (list: TouchList) =>
      Math.hypot(list[0].clientX - list[1].clientX, list[0].clientY - list[1].clientY);
    let startDistance = 0;
    let startZoom = 1;
    let pinchLang: Lang | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinchLang = laneOf(e.target);
      if (!pinchLang) return;
      startDistance = distance(e.touches);
      startZoom = zoomByLangRef.current[pinchLang] ?? 1;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDistance || !pinchLang) return;
      e.preventDefault();
      const ratio = distance(e.touches) / startDistance;
      applyZoom(pinchLang, () => clampZoom(startZoom * ratio));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        startDistance = 0;
        pinchLang = null;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, JSON.stringify(zoomByLang));
    } catch {
      /* private mode: keep the session value only */
    }
  }, [zoomByLang]);

  /** Header zoom: the lane in focus, or every lane when "sync move" is on. */
  const zoomBy = (factor: number) => {
    const targets = syncAll ? langs : [lastLang];
    setZoomByLang((prev) => {
      const out: Partial<Record<Lang, number>> = { ...prev };
      for (const lang of targets) out[lang] = clampZoom((prev[lang] ?? 1) * factor);
      return out;
    });
  };

  /** Fit the focused lane (or every lane in sync mode) back to its column width. */
  const fitWidth = () => {
    const targets = syncAll ? langs : [lastLang];
    setZoomByLang((prev) => {
      const out = { ...prev };
      for (const lang of targets) delete out[lang];
      return out;
    });
  };

  return (
    <div
      className={`panel-detail layout-${layout.mode}`}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('detail.title')}
      tabIndex={-1}
    >
      <header className="pd-head">
        <button type="button" className="btn pd-back" onClick={() => flushThen(onClose)} title={t('detail.backTitle')}>
          ← <span>{t('detail.back')}</span>
        </button>
        <div className="pd-title">
          <b>{t('format.panel', { number: formatNumber(index + 1) })}</b>
          <span className="muted tiny">
            {t('detail.position', { number: formatNumber(index + 1), total: formatNumber(total) })}
          </span>
        </div>
        <div className="pd-nav">
          <div className="pd-pop-wrap">
            <button
              type="button"
              className={`btn tiny ${layoutOpen ? 'on' : ''}`}
              onClick={() => setLayoutOpen((v) => !v)}
              aria-expanded={layoutOpen}
              aria-haspopup="dialog"
              title={t('detail.layoutTitle')}
            >
              ▦ <span className="pd-foot-label">{t('detail.layout')}</span>
            </button>
            {layoutOpen && (
              <div className="pd-pop pd-layout-pop" role="dialog" aria-label={t('detail.layoutTitle')}>
                <div className="pd-pop-group">
                  <span className="tb-label">{t('detail.layoutOverall')}</span>
                  <div className="seg" role="group" aria-label={t('detail.layoutOverall')}>
                    <button
                      type="button"
                      className={layoutPref === 'auto' ? 'on' : ''}
                      aria-pressed={layoutPref === 'auto'}
                      onClick={() => setLayoutPref('auto')}
                      title={t('detail.layoutAutoHint')}
                    >
                      {t('detail.layoutAuto')}
                    </button>
                    <button
                      type="button"
                      className={layoutPref === 'split' ? 'on' : ''}
                      aria-pressed={layoutPref === 'split'}
                      onClick={() => setLayoutPref('split')}
                      title={t('detail.layoutSplitHint')}
                    >
                      {t('detail.layoutSplit')}
                    </button>
                    <button
                      type="button"
                      className={layoutPref === 'stacked' ? 'on' : ''}
                      aria-pressed={layoutPref === 'stacked'}
                      onClick={() => setLayoutPref('stacked')}
                      title={t('detail.layoutStackedHint')}
                    >
                      {t('detail.layoutStacked')}
                    </button>
                  </div>
                </div>
                <div className="pd-pop-group">
                  <span className="tb-label">{t('detail.paneLayout')}</span>
                  <div className="seg" role="group" aria-label={t('detail.paneLayout')}>
                    <button
                      type="button"
                      className={paneLayout === 'row' ? 'on' : ''}
                      aria-pressed={paneLayout === 'row'}
                      onClick={() => setPaneLayout('row')}
                      title={t('detail.paneRowHint')}
                    >
                      {t('detail.paneRow')}
                    </button>
                    <button
                      type="button"
                      className={paneLayout === 'column' ? 'on' : ''}
                      aria-pressed={paneLayout === 'column'}
                      onClick={() => setPaneLayout('column')}
                      title={t('detail.paneColumnHint')}
                    >
                      {t('detail.paneColumn')}
                    </button>
                  </div>
                </div>
                {veryNarrow && <p className="pd-pop-note">{t('detail.layoutForced')}</p>}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`btn tiny ${alignOpen ? 'on' : ''}`}
            onClick={() => setAlignOpen((v) => !v)}
            aria-expanded={alignOpen}
            title={t('detail.alignTitle')}
          >
            ⇔ <span className="pd-foot-label">{t('detail.align')}</span>
          </button>
          <div className="seg pd-zoom" role="group" aria-label={t('detail.zoomHint')}>
            <button
              type="button"
              onClick={() => zoomBy(0.85)}
              title={t('detail.zoomOut')}
              aria-label={t('detail.zoomOut')}
            >
              −
            </button>
            <span className="pd-zoom-value">{Math.round(zoomOf(lastLang) * 100)}%</span>
            <button
              type="button"
              onClick={() => zoomBy(1.18)}
              title={t('detail.zoomIn')}
              aria-label={t('detail.zoomIn')}
            >
              +
            </button>
            <button type="button" onClick={fitWidth} title={t('detail.fitWidthHint')} aria-label={t('detail.fitWidth')}>
              ⤢
            </button>
          </div>
          <button type="button" className="btn tiny pd-reset" onClick={resetView} title={t('detail.resetViewHint')}>
            ⟲ <span className="pd-foot-label">{t('detail.resetView')}</span>
          </button>
          <button
            type="button"
            className="btn icon"
            onClick={() => flushThen(onClose)}
            title={t('detail.close')}
            aria-label={t('detail.close')}
          >
            ✕
          </button>
        </div>
      </header>
      {resetHint && (
        <div className="pd-reset-hint" role="status">
          {t('detail.resetNothing')}
        </div>
      )}

      {alignOpen && (
        <div className="pd-align" role="group" aria-label={t('detail.alignTitle')}>
          <div className="pd-align-block">
            <button
              type="button"
              className={`btn tiny ${syncAll ? 'on' : ''}`}
              onClick={() => setSyncAll((v) => !v)}
              aria-pressed={syncAll}
              title={t('detail.syncMoveHint')}
            >
              {t('detail.syncMove')}
            </button>
            <button type="button" className="btn tiny" onClick={resetAll} title={t('detail.alignResetAll')}>
              ⟲ {t('detail.alignResetAll')}
            </button>
          </div>
          <div className="pd-align-list">
            {langs.map((lang) => {
              const a = alignOf(lang);
              const open = tuneLang === lang;
              return (
                <div className={`pd-align-row ${open ? 'open' : ''}`} key={lang} data-lang={lang}>
                  <span className="pd-align-lang">{langShort(lang)}</span>
                  <span className="pd-align-readout">{formatAlign(a)}</span>
                  <button
                    type="button"
                    className={`btn tiny pd-align-toggle ${open ? 'on' : ''}`}
                    onClick={() => setTuneLang(open ? null : lang)}
                    aria-expanded={open}
                    title={t('detail.tune')}
                  >
                    {t('detail.tune')}
                  </button>
                  {open && (
                    <span className="pd-align-tools">
                      <button
                        type="button"
                        onClick={() => scaleLang(lang, 0.94)}
                        title={t('detail.zoomOut')}
                        aria-label={`${langShort(lang)} ${t('detail.zoomOut')}`}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => scaleLang(lang, 1.06)}
                        title={t('detail.zoomIn')}
                        aria-label={`${langShort(lang)} ${t('detail.zoomIn')}`}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="pd-align-reset"
                        onClick={() => resetLang(lang)}
                        title={t('detail.alignReset')}
                        aria-label={`${langShort(lang)} ${t('detail.alignReset')}`}
                      >
                        ⟲
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {anchorPicking && <div className="anchor-pick-hint">{t('notes.anchorPicking')}</div>}

      <div className={stacked ? 'pd-scroll' : 'pd-scroll pd-split-scroll'} ref={scrollRef}>
        <div className={`pd-body ${stacked ? 'stacked' : 'split'} ${splitting ? 'resizing' : ''}`} ref={bodyRef}>
          <div className="pd-visual" style={stacked ? undefined : { flexBasis: `${split * 100}%` }}>
            <div className={`pd-panes ${effectivePaneLayout}`} ref={panesRef} data-pane-layout={effectivePaneLayout}>
              {langs.map((lang) => {
                const url = page.files[lang];
                const offset = alignOf(lang);
                const masked = Boolean(url) && isMasked(panel.id, lang);
                return (
                  <div
                    key={lang}
                    data-lang={lang}
                    className={`detail-pane ${url ? '' : 'empty'} ${anchorPicking ? 'anchor-pick' : ''} ${dragLang === lang ? 'align-dragging' : ''}`}
                    style={{ aspectRatio: aspectOf(lang) }}
                    onContextMenu={(e) => openPaneImageMenu(e, lang)}
                    onPointerDown={(e) => {
                      // Anchor picking owns the press; otherwise dragging the artwork nudges Δ.
                      if (anchorPicking) placeNoteAnchor(e, lang, offset);
                      else startAlignDrag(e, lang);
                    }}
                    onPointerMove={moveAlignDrag}
                    onPointerUp={endAlignDrag}
                    onPointerCancel={endAlignDrag}
                  >
                    {url ? (
                      <div className="detail-zoom" style={{ transform: `scale(${zoomOf(lang)})` }}>
                        <CropLayer url={url} rect={panel.rect} offset={offset} opacity={1} blend={false} />
                        <div
                          className="ann-crop-layer"
                          style={{
                            transform: `translate(${offset.x * 100}%, ${offset.y * 100}%) scale(${offset.scale})`,
                          }}
                        >
                          <AnnotationOverlay
                            annotations={annotations}
                            panels={doc.panels}
                            rect={panel.rect}
                            visible={annotationsVisible}
                            imageUrl={url}
                            lang={lang}
                          />
                        </div>
                        <NoteAnchorLayer
                          notes={doc.notes}
                          panel={panel}
                          lang={lang}
                          offset={offset}
                          noteTypes={noteTypes}
                          langs={langs}
                          readOnly={readOnly}
                          hidden={anchorPicking}
                          onMove={readOnly ? undefined : moveNoteAnchors}
                        />
                      </div>
                    ) : (
                      <div className="pane-missing">{t('compare.missingLangImage', { lang: langLabel(lang) })}</div>
                    )}
                    {masked && (
                      <div
                        className={`lang-mask detail-mask ${maskStyle}`}
                        title={t('compare.maskTitle', { lang: langLabel(lang) })}
                        onClick={() => {
                          if (!anchorPicking) reveal(panel.id, lang);
                        }}
                      >
                        <span>
                          {langShort(lang)} {t('compare.maskedBadge')}
                          <em>{t('compare.clickReveal')}</em>
                        </span>
                      </div>
                    )}
                    <span className="lang-tag">{langShort(lang)}</span>
                    {dragLang === lang && <span className="pd-drag-readout">{formatAlign(offset)}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {!stacked && (
            <div
              className="pd-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('detail.splitter')}
              title={t('detail.splitter')}
              tabIndex={0}
              onPointerDown={startSplitDrag}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setSplit((s) => Math.max(MIN_SPLIT, s - 0.02));
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setSplit((s) => Math.min(MAX_SPLIT, s + 0.02));
                }
              }}
            />
          )}

          <div className="pd-side" ref={sideRef}>
            <section className="pd-notes">
              <h3 className="pd-section">
                {t('detail.notes')}
                <span className="muted tiny">{t('detail.notesCount', { count: formatNumber(notes.length) })}</span>
              </h3>
              <NotesPanel
                ref={notesRef}
                embedded
                doc={doc}
                panel={panel}
                panelLabel={t('format.panel', { number: formatNumber(index + 1) })}
                mutate={mutate}
                tagStats={[]}
                library={null}
                onJump={() => undefined}
                readOnly={readOnly}
                langs={langs}
                noteTypes={noteTypes}
                onNoteTypesChange={onNoteTypesChange}
                focusType={focusNoteType}
                surface="detail"
                noteEdit={noteEdit}
                onNoteEditChange={onNoteEditChange}
              />

              <h3 className="pd-section">
                {t('detail.annotations')}
                <span className="muted tiny">{formatNumber(panelAnnotations.length)}</span>
              </h3>
              {panelAnnotations.length ? (
                <ul className="pd-ann-list">
                  {panelAnnotations.map((a) => (
                    <li className="pd-ann" key={a.id}>
                      <span className="pd-ann-swatch" style={{ background: a.color || '#e0453a' }} />
                      <span className="pd-ann-kind">{t(ANNOTATION_TOOLS[a.kind].labelKey)}</span>
                      {/* Lane badge: the list also mentions marks that are hidden in some columns. */}
                      {a.lang && !a.allLangs ? <span className="note-time">{langShort(a.lang)}</span> : null}
                      {a.text ? <span className="pd-ann-text">{a.text}</span> : null}
                      <span className="note-time">{formatDate(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pd-empty">{t('detail.annotationsEmpty')}</p>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Navigation sits in its own bar below the scroll area: always reachable and
          never covering the panel image or the notes. */}
      <footer className="pd-foot">
        <div className="pd-foot-group">
          <button
            type="button"
            className="btn tiny pd-page"
            onClick={() => flushThen(onPrevPage)}
            disabled={!onPrevPage}
            title={t('app.prevPage')}
            aria-label={t('app.prevPage')}
          >
            « <span className="pd-foot-label">{t('app.prevPage')}</span>
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() => flushThen(onPrev)}
            disabled={!onPrev}
            title={t('detail.prev')}
            aria-label={t('detail.prev')}
          >
            ‹ <span className="pd-foot-label">{t('detail.prev')}</span>
          </button>
        </div>
        <div className="pd-foot-group pd-foot-right">
          <button
            type="button"
            className="btn tiny"
            onClick={() => flushThen(onNext)}
            disabled={!onNext}
            title={t('detail.next')}
            aria-label={t('detail.next')}
          >
            <span className="pd-foot-label">{t('detail.next')}</span> ›
          </button>
          <button
            type="button"
            className="btn tiny pd-page"
            onClick={() => flushThen(onNextPage)}
            disabled={!onNextPage}
            title={t('app.nextPage')}
            aria-label={t('app.nextPage')}
          >
            <span className="pd-foot-label">{t('app.nextPage')}</span> »
          </button>
        </div>
      </footer>
    </div>
  );
}
