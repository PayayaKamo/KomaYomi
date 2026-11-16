import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, AlignOffset, Lang, NoteTypeDef, PageDoc, PageEntry, Panel } from '../types';
import { langShort, DEFAULT_OFFSET } from '../types';
import { langLabel, useI18n } from '../i18n';
import { ANNOTATION_TOOLS } from './AnnotationLayer';
import { AnnotationOverlay } from './AnnotationOverlay';
import { CropLayer } from './CropLayer';
import { NotesPanel } from './NotesPanel';
import type { NotesPanelHandle } from './NotesPanel';
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
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
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
}: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const layout = useCompareLayout();
  const stacked = layout.mode !== 'desktop';
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<NotesPanelHandle>(null);
  /**
   * Session-only alignment overrides, one per language. Empty means "show whatever the
   * compare view has saved"; nothing here is written back to the project.
   */
  const [sessionAlign, setSessionAlign] = useState<Partial<Record<Lang, AlignOffset>>>({});
  const [alignOpen, setAlignOpen] = useState(false);

  const notes = doc.notes.filter((n) => n.scope === 'panel' && n.panelId === panel.id);
  const panelAnnotations = annotations.filter((a) => a.scope === 'panel' && a.panelId === panel.id);

  const alignOf = (lang: Lang): AlignOffset => sessionAlign[lang] ?? offsetOf(lang);
  const nudgeLang = (lang: Lang, dx: number, dy: number) =>
    setSessionAlign((prev) => {
      const base = prev[lang] ?? offsetOf(lang);
      return {
        ...prev,
        [lang]: { ...base, x: Math.min(1, Math.max(-1, base.x + dx)), y: Math.min(1, Math.max(-1, base.y + dy)) },
      };
    });
  const scaleLang = (lang: Lang, factor: number) =>
    setSessionAlign((prev) => {
      const base = prev[lang] ?? offsetOf(lang);
      const scale = Math.min(3, Math.max(0.2, Number((base.scale * factor).toFixed(3))));
      return { ...prev, [lang]: { ...base, scale } };
    });
  const resetLang = (lang: Lang) => setSessionAlign((prev) => ({ ...prev, [lang]: { ...DEFAULT_OFFSET } }));
  /** Move every language by the same delta so their relative alignment is preserved. */
  const nudgeAll = (dx: number, dy: number) =>
    setSessionAlign((prev) => {
      const next: Partial<Record<Lang, AlignOffset>> = { ...prev };
      for (const lang of langs) {
        const base = prev[lang] ?? offsetOf(lang);
        next[lang] = {
          ...base,
          x: Math.min(1, Math.max(-1, base.x + dx)),
          y: Math.min(1, Math.max(-1, base.y + dy)),
        };
      }
      return next;
    });
  const resetAll = () =>
    setSessionAlign(
      Object.fromEntries(langs.map((lang) => [lang, { ...DEFAULT_OFFSET }])) as Record<Lang, AlignOffset>,
    );

  const formatAlign = (offset: AlignOffset) =>
    `Δ${Math.round(offset.x * 100)},${Math.round(offset.y * 100)} ×${offset.scale.toFixed(2)}`;

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

  // A new panel starts at fit-to-width, with session alignment reset, and at the top of its notes.
  useEffect(() => {
    setZoom(1);
    setSessionAlign({});
    scrollRef.current?.scrollTo({ top: 0 });
  }, [panel.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
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
  }, [flushThen, onClose, onPrev, onNext]);

  // Wheel and pinch zoom the enlarged images only, so the surrounding page keeps scrolling.
  useEffect(() => {
    const el = panesRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY) return;
      if (!(e.target as HTMLElement | null)?.closest('.detail-pane')) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.08 : 0.92)));
    };
    const distance = (list: TouchList) =>
      Math.hypot(list[0].clientX - list[1].clientX, list[0].clientY - list[1].clientY);
    let startDistance = 0;
    let startZoom = 1;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDistance = distance(e.touches);
      startZoom = zoomRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDistance) return;
      if (!(e.target as HTMLElement | null)?.closest('.detail-pane')) return;
      e.preventDefault();
      setZoom(clampZoom(startZoom * (distance(e.touches) / startDistance)));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDistance = 0;
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

  const zoomBy = (factor: number) => setZoom((z) => clampZoom(z * factor));

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
            <span className="pd-zoom-value">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => zoomBy(1.18)}
              title={t('detail.zoomIn')}
              aria-label={t('detail.zoomIn')}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              title={t('detail.zoomReset')}
              aria-label={t('detail.zoomReset')}
            >
              ⟲
            </button>
          </div>
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

      {alignOpen && (
        <div className="pd-align" role="group" aria-label={t('detail.alignTitle')}>
          <div className="pd-align-block">
            <b>{t('detail.alignAll')}</b>
            <div className="pd-align-arrows">
              <button
                type="button"
                onClick={() => nudgeAll(-0.01, 0)}
                title={t('detail.alignLeft')}
                aria-label={t('detail.alignLeft')}
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => nudgeAll(0.01, 0)}
                title={t('detail.alignRight')}
                aria-label={t('detail.alignRight')}
              >
                →
              </button>
              <button
                type="button"
                onClick={() => nudgeAll(0, -0.01)}
                title={t('detail.alignUp')}
                aria-label={t('detail.alignUp')}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => nudgeAll(0, 0.01)}
                title={t('detail.alignDown')}
                aria-label={t('detail.alignDown')}
              >
                ↓
              </button>
            </div>
            <button type="button" className="btn tiny" onClick={resetAll} title={t('detail.alignResetAll')}>
              ⟲ {t('detail.alignResetAll')}
            </button>
          </div>
          <div className="pd-align-list">
            {langs.map((lang) => {
              const a = alignOf(lang);
              return (
                <div className="pd-align-row" key={lang} data-lang={lang}>
                  <span className="pd-align-lang">{langShort(lang)}</span>
                  <span className="pd-align-readout">{formatAlign(a)}</span>
                  <button
                    type="button"
                    onClick={() => nudgeLang(lang, -0.01, 0)}
                    title={t('detail.alignLeft')}
                    aria-label={`${langShort(lang)} ${t('detail.alignLeft')}`}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeLang(lang, 0.01, 0)}
                    title={t('detail.alignRight')}
                    aria-label={`${langShort(lang)} ${t('detail.alignRight')}`}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeLang(lang, 0, -0.01)}
                    title={t('detail.alignUp')}
                    aria-label={`${langShort(lang)} ${t('detail.alignUp')}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeLang(lang, 0, 0.01)}
                    title={t('detail.alignDown')}
                    aria-label={`${langShort(lang)} ${t('detail.alignDown')}`}
                  >
                    ↓
                  </button>
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
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="pd-scroll" ref={scrollRef}>
        <div className={`pd-panes ${stacked ? 'column' : 'row'}`} ref={panesRef}>
          {langs.map((lang) => {
            const url = page.files[lang];
            const offset = alignOf(lang);
            const masked = Boolean(url) && isMasked(panel.id, lang);
            return (
              <div key={lang} className={`detail-pane ${url ? '' : 'empty'}`} style={{ aspectRatio: aspectOf(lang) }}>
                {url ? (
                  <div className="detail-zoom" style={{ transform: `scale(${zoom})` }}>
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
                      />
                    </div>
                  </div>
                ) : (
                  <div className="pane-missing">{t('compare.missingLangImage', { lang: langLabel(lang) })}</div>
                )}
                {masked && (
                  <div
                    className={`lang-mask detail-mask ${maskStyle}`}
                    title={t('compare.maskTitle', { lang: langLabel(lang) })}
                    onClick={() => reveal(panel.id, lang)}
                  >
                    <span>
                      {langShort(lang)} {t('compare.maskedBadge')}
                      <em>{t('compare.clickReveal')}</em>
                    </span>
                  </div>
                )}
                <span className="lang-tag">{langShort(lang)}</span>
              </div>
            );
          })}
        </div>

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
