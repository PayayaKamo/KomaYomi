import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Library } from '../types';
import { SINGLE_CHAPTER } from '../types';
import type { Selection } from '../hooks/usePage';
import { useI18n } from '../i18n';

type Props = {
  library: Library | null;
  selection: Selection;
  /** Open a page (also used by the sidebar, so mobile drawers close consistently). */
  onOpen: (sel: Selection) => void;
  /** Previous/next page, crossing chapter boundaries like the [ / ] shortcuts. */
  onStep: (delta: number) => void;
};

type Picker = 'volume' | 'chapter' | null;

/**
 * Topbar breadcrumb with clickable volume / chapter pickers and a page number box.
 *
 * The pickers are listboxes: ↑/↓ (plus Home/End) move the highlight, Enter picks,
 * Esc closes and returns focus to the trigger.
 */
export function CrumbNav({ library, selection, onOpen, onStep }: Props) {
  const { t, formatNumber } = useI18n();
  const [open, setOpen] = useState<Picker>(null);
  const [active, setActive] = useState(0);
  const [pageDraft, setPageDraft] = useState(() => String(selection.pageIndex + 1));
  // The listbox is viewport-fixed so narrow screens can clamp it inside the screen.
  const [popPos, setPopPos] = useState({ top: 0, left: 0, width: 260, maxHeight: 440 });
  const rootRef = useRef<HTMLDivElement>(null);
  const volumeBtnRef = useRef<HTMLButtonElement>(null);
  const chapterBtnRef = useRef<HTMLButtonElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Mirrors `active` so a fast ↑/↓ followed by Enter reads the new row before React re-renders.
  const activeRef = useRef(0);

  const volume = library?.volumes.find((v) => v.id === selection.volume) ?? null;
  const chapter = volume?.chapters.find((c) => c.chapter === selection.chapter) ?? null;
  const volumeItems = library?.volumes ?? [];
  const chapterItems = volume?.chapters ?? [];
  const pageCount = chapter?.pages.length ?? 0;

  // Follow external navigation (shortcuts, sidebar, deep links) unless the user is typing.
  useEffect(() => {
    if (pageInputRef.current && document.activeElement === pageInputRef.current) return;
    setPageDraft(String(selection.pageIndex + 1));
  }, [selection.pageIndex]);

  // Any outside pointer press or Escape dismisses the listbox, wherever focus sits.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      const which = open;
      setOpen(null);
      if (which === 'volume') volumeBtnRef.current?.focus();
      else if (which === 'chapter') chapterBtnRef.current?.focus();
    };
    const closeOnResize = () => setOpen(null);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', closeOnResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open]);

  const closePicker = (refocus: boolean) => {
    const which = open;
    setOpen(null);
    if (!refocus) return;
    if (which === 'volume') volumeBtnRef.current?.focus();
    else if (which === 'chapter') chapterBtnRef.current?.focus();
  };

  const focusItem = (index: number) => {
    activeRef.current = index;
    setActive(index);
    itemRefs.current[index]?.focus();
    itemRefs.current[index]?.scrollIntoView({ block: 'nearest' });
  };

  const openPicker = (which: Exclude<Picker, null>, startAt: number) => {
    if (open === which) {
      closePicker(true);
      return;
    }
    const trigger = which === 'volume' ? volumeBtnRef.current : chapterBtnRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - 24);
      setPopPos({
        top: rect.bottom + 8,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
        width,
        maxHeight: Math.max(160, Math.min(440, window.innerHeight - rect.bottom - 20)),
      });
    }
    itemRefs.current = [];
    activeRef.current = startAt;
    setActive(startAt);
    setOpen(which);
    // Focus the current row once the listbox exists, unless the user already moved.
    window.requestAnimationFrame(() => {
      if (activeRef.current === startAt) focusItem(startAt);
    });
  };

  const pickVolume = (id: string) => {
    setOpen(null);
    if (!library) return;
    const target = library.volumes.find((v) => v.id === id);
    if (!target) return;
    if (id === selection.volume) {
      volumeBtnRef.current?.focus();
      return;
    }
    // Keep the current chapter/page when the new volume has the same chapter name.
    const next = target.chapters.find((c) => c.chapter === selection.chapter) ?? target.chapters[0];
    if (!next) return;
    const pageIndex =
      next.chapter === selection.chapter ? Math.min(selection.pageIndex, Math.max(0, next.pages.length - 1)) : 0;
    onOpen({ volume: id, chapter: next.chapter, pageIndex });
  };

  const pickChapter = (name: string) => {
    setOpen(null);
    if (name === selection.chapter) {
      chapterBtnRef.current?.focus();
      return;
    }
    const target = chapterItems.find((c) => c.chapter === name);
    if (!target) return;
    onOpen({ volume: selection.volume, chapter: name, pageIndex: 0 });
  };

  const commitPage = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || pageCount === 0) {
      setPageDraft(String(selection.pageIndex + 1));
      return;
    }
    const next = Math.min(Math.max(1, parsed), pageCount);
    setPageDraft(String(next));
    if (next - 1 !== selection.pageIndex) onOpen({ ...selection, pageIndex: next - 1 });
  };

  const onPageKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPage(pageDraft);
      e.currentTarget.select();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPageDraft(String(selection.pageIndex + 1));
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (pageCount === 0) return;
      const delta = e.key === 'ArrowUp' ? 1 : -1;
      const next = Math.min(Math.max(1, selection.pageIndex + 1 + delta), pageCount);
      setPageDraft(String(next));
      if (next - 1 !== selection.pageIndex) onOpen({ ...selection, pageIndex: next - 1 });
    }
  };

  const onPickerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    // The page input keeps its own arrow/Enter handling.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const count = open === 'volume' ? volumeItems.length : chapterItems.length;
    if (!count) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(Math.min(count - 1, activeRef.current + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(Math.max(0, activeRef.current - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(count - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open === 'volume') {
        const item = volumeItems[activeRef.current];
        if (item) pickVolume(item.id);
      } else {
        const item = chapterItems[activeRef.current];
        if (item) pickChapter(item.chapter);
      }
    } else if (e.key === 'Tab') {
      setOpen(null);
    }
  };

  if (!library) return null;

  const volumeLabel = volume?.title ?? selection.volume;
  const chapterLabel =
    selection.chapter === SINGLE_CHAPTER
      ? t('sidebar.singleChapter')
      : t('format.chapter', { chapter: selection.chapter || '—' });
  const volumeIndex = volumeItems.findIndex((v) => v.id === selection.volume);
  const chapterIndex = chapterItems.findIndex((c) => c.chapter === selection.chapter);

  return (
    <div className="crumb" ref={rootRef} onKeyDown={onPickerKeyDown}>
      <div className="crumb-field crumb-vol">
        <button
          ref={volumeBtnRef}
          type="button"
          className={`crumb-btn ${open === 'volume' ? 'on' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open === 'volume'}
          title={`${t('crumb.switchVolume')}: ${volumeLabel}`}
          onClick={() => openPicker('volume', Math.max(0, volumeIndex))}
        >
          <span className="crumb-btn-text">{volumeLabel}</span>
          <span className="crumb-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open === 'volume' && (
          <div
            className="crumb-pop"
            role="listbox"
            aria-label={t('crumb.volume')}
            data-testid="crumb-volume-pop"
            style={popPos}
          >
            <div className="crumb-pop-head">{t('crumb.volume')}</div>
            <div className="crumb-pop-list">
              {volumeItems.map((v, i) => {
                const pages = v.chapters.reduce((n, c) => n + c.pages.length, 0);
                return (
                  <button
                    key={v.id}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={v.id === selection.volume}
                    className={`crumb-item ${i === active ? 'active' : ''} ${v.id === selection.volume ? 'current' : ''}`}
                    title={v.title}
                    onPointerEnter={() => {
                      activeRef.current = i;
                      setActive(i);
                    }}
                    onClick={() => pickVolume(v.id)}
                  >
                    <span className="crumb-item-text">{v.title}</span>
                    <span className="crumb-item-meta">{t('crumb.chapterPages', { count: formatNumber(pages) })}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <i className="crumb-sep crumb-sep-vol">/</i>

      <div className="crumb-field crumb-ch">
        <button
          ref={chapterBtnRef}
          type="button"
          className={`crumb-btn ${open === 'chapter' ? 'on' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open === 'chapter'}
          title={`${t('crumb.switchChapter')}: ${chapterLabel}`}
          onClick={() => openPicker('chapter', Math.max(0, chapterIndex))}
        >
          <span className="crumb-btn-text">{chapterLabel}</span>
          <span className="crumb-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open === 'chapter' && (
          <div
            className="crumb-pop"
            role="listbox"
            aria-label={t('crumb.chapter')}
            data-testid="crumb-chapter-pop"
            style={popPos}
          >
            <div className="crumb-pop-head">{t('crumb.chapter')}</div>
            <div className="crumb-pop-list">
              {chapterItems.map((c, i) => {
                const label =
                  c.chapter === SINGLE_CHAPTER
                    ? t('sidebar.singleChapter')
                    : t('format.chapter', { chapter: c.chapter });
                return (
                  <button
                    key={c.chapter}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={c.chapter === selection.chapter}
                    className={`crumb-item ${i === active ? 'active' : ''} ${c.chapter === selection.chapter ? 'current' : ''}`}
                    title={label}
                    onPointerEnter={() => {
                      activeRef.current = i;
                      setActive(i);
                    }}
                    onClick={() => pickChapter(c.chapter)}
                  >
                    <span className="crumb-item-text">{label}</span>
                    <span className="crumb-item-meta">
                      {t('crumb.chapterPages', { count: formatNumber(c.pages.length) })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <i className="crumb-sep">/</i>

      <div className="crumb-page">
        <input
          ref={pageInputRef}
          className="crumb-page-input"
          type="text"
          inputMode="numeric"
          aria-label={t('crumb.page')}
          title={t('crumb.pageInputTitle')}
          value={pageDraft}
          disabled={pageCount === 0}
          onChange={(e) => setPageDraft(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={onPageKeyDown}
          onBlur={() => commitPage(pageDraft)}
        />
        <span className="crumb-total">/ {formatNumber(pageCount)}</span>
        <div className="page-nav">
          <button type="button" onClick={() => onStep(-1)} title={t('app.prevPageTitle')}>
            ‹
          </button>
          <button type="button" onClick={() => onStep(1)} title={t('app.nextPageTitle')}>
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
