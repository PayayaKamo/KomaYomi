import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { CrumbNav } from './components/CrumbNav';
import { PanelsTab } from './components/PanelsTab';
import { CompareTab } from './components/CompareTab';
import { NotesPanel } from './components/NotesPanel';
import { ExportDialog } from './components/ExportDialog';
import { FileMenu } from './components/FileMenu';
import { AboutDialog } from './components/AboutDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { PageHistoryDialog } from './components/PageHistoryDialog';
import { PaneSplitter, clampPaneWidth, loadPaneWidth, savePaneWidth } from './components/PaneSplitter';
import { usePage } from './hooks/usePage';
import type { Selection } from './hooks/usePage';
import { useOutbox } from './hooks/useOutbox';
import { usePwaStatus } from './hooks/usePwaStatus';
import { api } from './api';
import { pushRecent } from './lib/recent';
import { DEFAULT_LANGUAGES, READING_DIRECTIONS, isRightToLeft, isVerticalReading } from './types';
import type { Lang, Library, ReadingDirection } from './types';
import { langLabel, readingLabel, useI18n } from './i18n';
import type { Locale } from './i18n';
import type { CSSProperties } from 'react';
import { applyGroupOrder, sortPanels } from './lib/geometry';
import { buildHash, parseDeepLink } from './lib/deepLink';
import type { AppView } from './lib/deepLink';
import { enqueueOutbox } from './lib/outbox';
import { applyTheme, readThemeMode, saveThemeMode, watchSystemTheme } from './theme';
import type { ThemeMode } from './theme';

/** Stable identity of one page, used to tell page switches apart from re-renders. */
function selectionKey(sel: Selection): string {
  return `${sel.volume}\u0000${sel.chapter}\u0000${sel.pageIndex}`;
}

/** Page delta for an arrow key under a reading direction (0 when the key does not apply). */
function arrowPageStep(dir: ReadingDirection, key: string): number {
  if (isVerticalReading(dir)) return key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (isRightToLeft(dir)) return key === 'ArrowLeft' ? 1 : key === 'ArrowRight' ? -1 : 0;
  return key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
}

/** Drag-resizable panes: storage key and the range that keeps both usable. */
const SIDEBAR_PANE = { key: 'manga-memo.sidebar-width', min: 200, max: 420 };
const NOTES_PANE = { key: 'manga-memo.notes-width', min: 260, max: 560 };
/** Reading mode hides the shell chrome; the choice survives reloads. */
const READING_MODE_KEY = 'manga-memo.reading-mode';

function readReadingMode(): boolean {
  try {
    return localStorage.getItem(READING_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const { t, locale, setLocale, formatNumber } = useI18n();
  const [library, setLibrary] = useState<Library | null>(null);
  const [rootPath, setRootPath] = useState('');
  const [rawPath, setRawPath] = useState('');
  const [libError, setLibError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [view, setView] = useState<AppView>('panels');
  /** Panel whose detail view is open on top of the compare reading view. */
  const [detailPanel, setDetailPanel] = useState<string | null>(null);
  /** Page the open detail belongs to, so switching pages closes it. */
  const detailPageKey = useRef('');
  /** Whether the current detail view was opened in-app (so Back has an entry to pop). */
  const detailPushed = useRef(false);
  const [langs, setLangsState] = useState<Lang[]>([...DEFAULT_LANGUAGES]);
  const [overlay, setOverlay] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [tagStats, setTagStats] = useState<{ tag: string; count: number }[]>([]);
  const [notesOpen, setNotesOpen] = useState(() => window.innerWidth > 1180);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 1024);
  const [readingMode, setReadingMode] = useState(readReadingMode);
  const [readingHint, setReadingHint] = useState(false);
  const readingHintTimer = useRef<number | undefined>(undefined);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() =>
    loadPaneWidth(SIDEBAR_PANE.key, SIDEBAR_PANE.min, SIDEBAR_PANE.max),
  );
  const [notesWidth, setNotesWidth] = useState<number | null>(() =>
    loadPaneWidth(NOTES_PANE.key, NOTES_PANE.min, NOTES_PANE.max),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingPanel, setPendingPanel] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(readThemeMode);
  /** Latest page state, read by the navigation guards declared below. */
  const pageRef = useRef<ReturnType<typeof usePage> | null>(null);

  /**
   * Confirm mode promises that nothing is written until ✓ is pressed, so leaving a page
   * asks first instead of quietly saving behind the user's back. Resolves true when the
   * caller may navigate.
   */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    const cur = pageRef.current;
    if (!cur || !cur.dirty || cur.saveMode !== 'confirm') return true;
    if (!window.confirm(t('app.leaveUnsaved'))) return false;
    await cur.commit();
    return true;
  }, [t]);
  const confirmLeaveRef = useRef(confirmLeave);
  /** The hash that matches what is on screen, used to undo a refused deep-link jump. */
  const hashRef = useRef(location.hash);

  /** On phones/tablets the library is a drawer: picking a page should reveal the stage. */
  const openSelection = useCallback(
    (next: Selection) => {
      void confirmLeave().then((ok) => {
        if (!ok) return;
        setSel(next);
        if (window.matchMedia('(max-width: 1024px)').matches) setSidebarOpen(false);
      });
    },
    [confirmLeave],
  );

  /** The topbar logo goes back to the library landing view. */
  const goHome = useCallback(() => {
    void confirmLeave().then((ok) => {
      if (!ok) return;
      detailPushed.current = false;
      setDetailPanel(null);
      setSel(null);
      setSelected([]);
      setView('panels');
      setSidebarOpen(true);
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    });
  }, [confirmLeave]);

  /** Flip reading mode and remember it for the next visit. */
  const setReadingModePersisted = useCallback((next: boolean) => {
    setReadingMode(next);
    window.clearTimeout(readingHintTimer.current);
    if (next) {
      // A short-lived tip instead of a permanent floating button.
      setReadingHint(true);
      readingHintTimer.current = window.setTimeout(() => setReadingHint(false), 2800);
    } else {
      setReadingHint(false);
    }
    try {
      localStorage.setItem(READING_MODE_KEY, next ? '1' : '0');
    } catch {
      /* private mode: the choice just lasts for this session */
    }
  }, []);

  useEffect(() => () => window.clearTimeout(readingHintTimer.current), []);

  // No chrome is visible in reading mode, so double-click (or double-tap on touch) on
  // empty stage space also leaves it; R and Esc remain the keyboard paths.
  useEffect(() => {
    if (!readingMode) return;
    const isInteractive = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      if (!el?.closest('.stage')) return true;
      return Boolean(el.closest('button, a, input, textarea, select, .shot, .panel-card, .lang-grid, .panel-detail'));
    };
    let lastTap = 0;
    const onTouchEnd = (e: TouchEvent) => {
      if (isInteractive(e.target)) return;
      const now = Date.now();
      if (now - lastTap < 320) {
        lastTap = 0;
        setReadingModePersisted(false);
      } else {
        lastTap = now;
      }
    };
    const onDoubleClick = (e: MouseEvent) => {
      if (!isInteractive(e.target)) setReadingModePersisted(false);
    };
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('dblclick', onDoubleClick);
    return () => {
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('dblclick', onDoubleClick);
    };
  }, [readingMode, setReadingModePersisted]);

  // Keep the palette in sync with the stored preference and with OS changes when the
  // user picked "system". index.html already applied it before paint, so this only
  // matters for in-app switches and OS flips.
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(theme);
  }, [theme]);

  // Keep customized pane widths usable when the window shrinks; never invent one.
  useEffect(() => {
    const onResize = () => {
      setSidebarWidth((w) => (w === null ? w : clampPaneWidth(w, SIDEBAR_PANE.min, SIDEBAR_PANE.max)));
      setNotesWidth((w) => (w === null ? w : clampPaneWidth(w, NOTES_PANE.min, NOTES_PANE.max)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pageState = usePage(sel);
  const outbox = useOutbox();
  const pwa = usePwaStatus();
  const { doc, page } = pageState;

  // Hash deep link: #/<volume>/<chapter>/<page (1-based)>[/<view>[/panel/<panelId>]],
  // for direct opening and sharing. The panel segment restores the detail view.
  useEffect(() => {
    const readHash = () => {
      const link = parseDeepLink(location.hash);
      if (!link) return;
      const { volume, chapter, pageIndex } = link;
      void confirmLeaveRef.current().then((ok) => {
        if (!ok) {
          // Refused: put the URL back so it keeps matching the page still on screen.
          history.replaceState(null, '', hashRef.current || `${location.pathname}${location.search}`);
          return;
        }
        if (link.view) setView(link.view);
        if (!link.panelId) detailPushed.current = false;
        detailPageKey.current = link.panelId ? selectionKey(link) : '';
        setDetailPanel(link.panelId);
        setSel((prev) =>
          prev && prev.volume === volume && prev.chapter === chapter && prev.pageIndex === pageIndex ? prev : link,
        );
      });
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  useEffect(() => {
    if (!sel) return;
    const next = buildHash(sel.volume, sel.chapter, sel.pageIndex, view, detailPanel);
    hashRef.current = next;
    if (location.hash !== next) history.replaceState(null, '', next);
  }, [sel, view, detailPanel]);

  // Remember the last page of each chapter for File → Recent.
  useEffect(() => {
    if (sel) pushRecent({ volume: sel.volume, chapter: sel.chapter, pageIndex: sel.pageIndex });
  }, [sel]);

  const loadLibrary = useCallback(() => {
    api
      .library()
      .then((res) => {
        setLibrary(res.library);
        setRootPath(res.root);
        setRawPath(res.raw ?? res.root);
        if (res.library.langOrder?.length) setLangsState(res.library.langOrder);
        setLibError(null);
      })
      .catch((err: unknown) => setLibError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Keep the persisted order in sync whenever the compare bar changes it.
  const setLangs = useCallback((next: Lang[]) => {
    setLangsState(next);
    api.saveLangOrder(next).catch((err: unknown) => {
      // Queue it instead of dropping the order silently; the pending chip shows it.
      if (!enqueueOutbox({ kind: 'langOrder', order: next })) {
        setLibError(err instanceof Error ? err.message : String(err));
      }
    });
  }, []);

  const loadTags = useCallback(() => {
    api
      .tags()
      .then((res) => setTagStats(res.tags))
      .catch(() => setTagStats([]));
  }, []);

  // Once the queued writes have all reached the server, refetch the library so offline
  // volume-directory / language-order edits show up without a manual reload.
  const drainedOutbox = useRef(false);
  useEffect(() => {
    if (outbox.count > 0) {
      drainedOutbox.current = true;
      return;
    }
    if (!drainedOutbox.current) return;
    drainedOutbox.current = false;
    loadLibrary();
  }, [outbox.count, loadLibrary]);

  // Library warnings are rendered by the server in the interface language, so a locale
  // switch refetches the library (and its tag counts) instead of keeping stale wording.
  useEffect(() => {
    loadLibrary();
    loadTags();
  }, [loadLibrary, loadTags, locale]);

  // Refresh the gallery badge once the page is first written to disk.
  useEffect(() => {
    if (pageState.exists) loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState.exists]);

  useEffect(() => {
    if (!doc) return;
    setSelected((prev) => prev.filter((id) => doc.panels.some((p) => p.id === id)));
  }, [doc?.panels, doc]);

  // Navigation guards read the freshest page state without re-creating the callbacks.
  useEffect(() => {
    pageRef.current = pageState;
    confirmLeaveRef.current = confirmLeave;
  }, [pageState, confirmLeave]);

  // In confirm mode, warn before leaving with pending edits; autosave mode needs no guard.
  useEffect(() => {
    if (!pageState.dirty || pageState.saveMode !== 'confirm') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pageState.dirty, pageState.saveMode]);

  const ordered = useMemo(
    () => (doc ? applyGroupOrder(sortPanels(doc.panels, doc.readingDirection), doc.groups) : []),
    [doc],
  );
  const primaryId = selected[selected.length - 1];
  const primaryPanel = doc?.panels.find((p) => p.id === primaryId) ?? null;
  const primaryIndex = primaryPanel ? ordered.findIndex((p) => p.id === primaryPanel.id) : -1;
  const panelLabel =
    primaryIndex >= 0 ? t('format.panel', { number: formatNumber(primaryIndex + 1) }) : t('notes.thisPanel');

  // Notes-overview jump: switch page first, then select the target panel once panels load,
  // so the "prune invalid selection" effect cannot swallow the selection.
  useEffect(() => {
    if (!doc || !pendingPanel) return;
    if (doc.panels.some((p) => p.id === pendingPanel)) {
      setSelected([pendingPanel]);
      setPendingPanel(null);
    }
  }, [doc, pendingPanel]);

  const jumpTo = useCallback(
    (sel2: Selection, panelId: string | null) => {
      void confirmLeave().then((ok) => {
        if (!ok) return;
        setSel(sel2);
        setPendingPanel(panelId);
        if (panelId) setView('compare');
      });
    },
    [confirmLeave],
  );

  /** Open the panel detail view; the URL gains a `panel/<id>` segment so it can be shared. */
  const openDetail = useCallback(
    (panelId: string) => {
      if (!sel) return;
      // Switching panels inside the detail replaces the URL of the same history entry,
      // so Back still exits the view instead of walking through the panels.
      if (detailPanel) {
        setDetailPanel(panelId);
        return;
      }
      const next = buildHash(sel.volume, sel.chapter, sel.pageIndex, 'compare', panelId);
      if (location.hash !== next) {
        history.pushState(null, '', next);
        detailPushed.current = true;
      }
      hashRef.current = next;
      detailPageKey.current = selectionKey(sel);
      setView('compare');
      setDetailPanel(panelId);
    },
    [sel, detailPanel],
  );

  /** Leave the detail view; Back pops the entry we pushed, a shared link just rewrites the URL. */
  const closeDetail = useCallback(() => {
    if (detailPushed.current) {
      detailPushed.current = false;
      history.back();
      return;
    }
    setDetailPanel(null);
  }, []);

  // Panel ids only exist on one page: switching pages closes the detail view.
  const pageKey = sel ? selectionKey(sel) : '';
  useEffect(() => {
    if (!detailPanel) return;
    if (detailPageKey.current && detailPageKey.current !== pageKey) {
      detailPushed.current = false;
      setDetailPanel(null);
    }
  }, [pageKey, detailPanel]);

  // A stale link (deleted or re-detected panel) must not leave an empty detail screen open.
  useEffect(() => {
    if (doc && detailPanel && !doc.panels.some((p) => p.id === detailPanel)) setDetailPanel(null);
  }, [doc, detailPanel]);

  // Keep the compare view behind the detail on the same panel, including after a refresh.
  useEffect(() => {
    if (doc && detailPanel && doc.panels.some((p) => p.id === detailPanel)) setSelected([detailPanel]);
  }, [doc, detailPanel]);

  const changeDirection = (dir: ReadingDirection) => pageState.mutate((d) => ({ ...d, readingDirection: dir }));

  const goPage = useCallback(
    (delta: number) => {
      if (!library || !sel) return;
      const vol = library.volumes.find((v) => v.id === sel.volume);
      if (!vol) return;
      const ci = vol.chapters.findIndex((c) => c.chapter === sel.chapter);
      const chapter = vol.chapters[ci];
      if (!chapter) return;
      // Pages excluded by preprocessing are skipped in both directions.
      const body = chapter.pages.filter((p) => !p.excluded);
      const position = body.findIndex((p) => p.index === sel.pageIndex);
      const nextPosition = position + delta;
      if (position >= 0 && nextPosition >= 0 && nextPosition < body.length) {
        const next = { ...sel, pageIndex: body[nextPosition].index };
        void confirmLeave().then((ok) => ok && setSel(next));
        return;
      }
      const nextChapter = vol.chapters[ci + (delta > 0 ? 1 : -1)];
      const nextBody = nextChapter?.pages.filter((p) => !p.excluded) ?? [];
      if (!nextChapter || !nextBody.length) return;
      const next = {
        volume: sel.volume,
        chapter: nextChapter.chapter,
        pageIndex: delta > 0 ? nextBody[0].index : nextBody[nextBody.length - 1].index,
      };
      void confirmLeave().then((ok) => ok && setSel(next));
    },
    [library, sel, confirmLeave],
  );

  // Destructured so the shortcut effect depends on the callbacks themselves
  // instead of the whole pageState object (which changes on every keystroke of a note).
  const undoPage = pageState.undo;
  const redoPage = pageState.redo;

  // Keyboard shortcuts (ignored while an input has focus): [ ] page, P panels, C compare,
  // S sidebar, N notes, R reading mode, E export.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      // The detail view owns keyboard navigation while it is open; page turns stay off.
      if (detailPanel) return;
      // Handled lower in the tree (panel nudging, dialogs) — do not page-turn on top of it.
      if (e.defaultPrevented) return;
      const modalOpen = Boolean(document.querySelector('.modal-backdrop'));
      // Escape leaves reading mode; dialogs and the detail view keep their own Esc.
      if (readingMode && e.key === 'Escape' && !modalOpen) {
        e.preventDefault();
        setReadingModePersisted(false);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const mod = e.key.toLowerCase();
        if (mod === 'z') {
          e.preventDefault();
          if (e.shiftKey) redoPage();
          else undoPage();
        } else if (mod === 'y') {
          e.preventDefault();
          redoPage();
        }
        return;
      }
      if (e.altKey) return;
      // Arrows turn pages along the page's reading direction: RTL reads leftward,
      // TTB reads downward. Modals keep their own keyboard handling.
      if (e.key.startsWith('Arrow') && doc && !modalOpen) {
        const step = arrowPageStep(doc.readingDirection, e.key);
        if (step) {
          e.preventDefault();
          goPage(step);
        }
        return;
      }
      const key = e.key.toLowerCase();
      if (key === '[') {
        e.preventDefault();
        goPage(-1);
      } else if (key === ']') {
        e.preventDefault();
        goPage(1);
      } else if (key === 'p') setView('panels');
      else if (key === 'c') setView('compare');
      else if (key === 's') setSidebarOpen((v) => !v);
      else if (key === 'n') setNotesOpen((v) => !v);
      else if (key === 'r' && !modalOpen) setReadingModePersisted(!readingMode);
      else if (key === 'e' && doc) setExportOpen(true);
      else if (e.key === '?') setHelpOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, goPage, undoPage, redoPage, detailPanel, readingMode, setReadingModePersisted]);

  // Library-wide language order; the runtime list grows with whatever the scan finds.
  const allLangs = useMemo<Lang[]>(
    () => (library?.langOrder?.length ? library.langOrder : [...DEFAULT_LANGUAGES]),
    [library],
  );
  const pageLangs = useMemo(() => (page ? Object.keys(page.files) : []), [page]);
  const availableLangs = useMemo(
    () => [...allLangs.filter((l) => pageLangs.includes(l)), ...pageLangs.filter((l) => !allLangs.includes(l))],
    [allLangs, pageLangs],
  );
  const expectedLangs = useMemo(() => {
    const volume = sel && library ? library.volumes.find((v) => v.id === sel.volume) : null;
    return volume?.languages?.length ? volume.languages : allLangs;
  }, [allLangs, library, sel]);
  const missingLangs = expectedLangs.filter((l) => !pageLangs.includes(l));

  const saveLabel = !doc
    ? ''
    : pageState.saving
      ? t('app.saveSaving')
      : pageState.dirty
        ? pageState.saveMode === 'confirm'
          ? t('app.saveUnsaved')
          : t('app.savePending')
        : t('app.saveSaved');

  return (
    <div
      className={`app ${notesOpen ? 'show-notes' : ''} ${sidebarOpen ? '' : 'sidebar-closed'} ${readingMode ? 'reading-mode' : ''}`}
    >
      <header className="topbar">
        <div className="tb-left">
          <button
            type="button"
            className="brand-mark"
            onClick={goHome}
            title={t('app.brandHome')}
            aria-label={t('app.brandHome')}
          >
            <img src="/icon.svg" alt="" width={22} height={22} />
          </button>
          <FileMenu
            library={library}
            selection={sel}
            dirty={pageState.dirty}
            hasDoc={Boolean(doc)}
            onOpenSelection={openSelection}
            onReloadLibrary={() => {
              loadLibrary();
              loadTags();
            }}
            onExport={() => setExportOpen(true)}
            onSave={() => void pageState.commit()}
          />
          <button
            type="button"
            className={`btn icon ${sidebarOpen ? 'on' : ''}`}
            onClick={() => setSidebarOpen((v) => !v)}
            title={t('app.toggleSidebarTitle')}
          >
            ☰
          </button>
          <button
            type="button"
            className="btn icon help-btn"
            onClick={() => setHelpOpen(true)}
            title={t('app.helpTitle')}
          >
            ?
          </button>
          <button
            type="button"
            className="btn icon settings-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.openTitle')}
            aria-label={t('settings.title')}
          >
            ⚙
          </button>
          <button
            type="button"
            className="btn icon"
            onClick={() => setAboutOpen(true)}
            title={t('about.openTitle')}
            aria-label={t('about.title')}
          >
            ⓘ
          </button>
          {sel && (
            <CrumbNav
              library={library}
              selection={sel}
              direction={doc?.readingDirection}
              onOpen={openSelection}
              onStep={goPage}
            />
          )}
          {doc && <span className={`save-state ${pageState.dirty ? 'dirty' : ''}`}>{saveLabel}</span>}
          {!pwa.online && <span className="pwa-chip">{t('pwa.offline')}</span>}
          {outbox.count > 0 && (
            <button
              type="button"
              className="outbox-chip"
              disabled={outbox.syncing}
              onClick={() => void outbox.replay()}
              title={outbox.error ?? t('outbox.retryTitle')}
            >
              {outbox.syncing ? t('outbox.syncing') : t('outbox.pending', { count: formatNumber(outbox.count) })}
            </button>
          )}
        </div>

        <div className="tb-center">
          <div className="seg big">
            <button type="button" className={view === 'panels' ? 'on' : ''} onClick={() => setView('panels')}>
              {t('app.tabPanels')}
            </button>
            <button type="button" className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>
              {t('app.tabCompare')}
            </button>
          </div>
        </div>

        <div className="tb-right">
          {doc && (
            <select
              className="tb-select wide"
              value={doc.readingDirection}
              onChange={(e) => changeDirection(e.target.value as ReadingDirection)}
              title={t('app.readingOrderTitle')}
            >
              {READING_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {readingLabel(d)}
                </option>
              ))}
            </select>
          )}
          <select
            className="tb-select"
            value={theme}
            onChange={(e) => {
              const next = e.target.value as ThemeMode;
              setTheme(next);
              saveThemeMode(next);
            }}
            title={t('app.themeTitle')}
            aria-label={t('app.themeAria')}
          >
            <option value="system">{t('app.themeSystem')}</option>
            <option value="light">{t('app.themeLight')}</option>
            <option value="dark">{t('app.themeDark')}</option>
          </select>
          <select
            className="tb-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            title={t('app.languageTitle')}
            aria-label={t('app.languageAria')}
          >
            <option value="en">{t('locale.en')}</option>
            <option value="zh">{t('locale.zh')}</option>
            <option value="ja">{t('locale.ja')}</option>
          </select>
          <button
            type="button"
            className="btn icon reading-btn"
            onClick={() => setReadingModePersisted(true)}
            title={t('reading.enterTitle')}
            aria-label={t('reading.enterTitle')}
          >
            ⛶
          </button>
          <button type="button" className={`btn ${notesOpen ? 'on' : ''}`} onClick={() => setNotesOpen((v) => !v)}>
            {t('app.notesButton')}
          </button>
          <button type="button" className="btn primary" disabled={!doc} onClick={() => setExportOpen(true)}>
            {t('app.exportButton')}
            <span className="tb-export-extra"> HTML</span>
          </button>
        </div>
      </header>

      <div
        className="body-area"
        style={
          {
            '--sidebar-w': sidebarWidth === null ? undefined : `${sidebarWidth}px`,
            '--notes-w': notesWidth === null ? undefined : `${notesWidth}px`,
          } as CSSProperties
        }
      >
        <Sidebar
          library={library}
          rootPath={rootPath}
          rawPath={rawPath}
          selection={sel}
          onOpen={openSelection}
          onReload={loadLibrary}
          dirty={pageState.dirty}
        />
        {sidebarOpen && (
          <div
            className="scrim"
            onPointerDown={() => {
              // The scrim only exists below 1024px; tapping it dismisses the drawer.
              if (window.matchMedia('(max-width: 1024px)').matches) setSidebarOpen(false);
            }}
          />
        )}

        <main className="stage">
          {sidebarOpen && (
            <PaneSplitter
              edge="left"
              target=".sidebar"
              cssVar="--sidebar-w"
              min={SIDEBAR_PANE.min}
              max={SIDEBAR_PANE.max}
              label={t('pane.libraryHandle')}
              onCommit={(w) => {
                setSidebarWidth(w);
                savePaneWidth(SIDEBAR_PANE.key, w);
              }}
              onReset={() => {
                setSidebarWidth(null);
                savePaneWidth(SIDEBAR_PANE.key, null);
              }}
            />
          )}
          {notesOpen && (
            <PaneSplitter
              edge="right"
              target=".notes-col"
              cssVar="--notes-w"
              min={NOTES_PANE.min}
              max={NOTES_PANE.max}
              label={t('pane.notesHandle')}
              onCommit={(w) => {
                setNotesWidth(w);
                savePaneWidth(NOTES_PANE.key, w);
              }}
              onReset={() => {
                setNotesWidth(null);
                savePaneWidth(NOTES_PANE.key, null);
              }}
            />
          )}
          {libError && <div className="banner error">{t('app.libraryError', { error: libError })}</div>}
          {pageState.error && <div className="banner error">{pageState.error}</div>}

          {!sel ? (
            <Welcome library={library} onOpen={openSelection} />
          ) : pageState.loading ? (
            <div className="stage-loading">{t('app.loadingPage', { page: formatNumber(sel.pageIndex + 1) })}</div>
          ) : doc && page ? (
            view === 'panels' ? (
              <PanelsTab
                doc={doc}
                page={page}
                mutate={pageState.mutate}
                detecting={pageState.detecting}
                onDetect={(lang) => pageState.detect(lang)}
                selected={selected}
                setSelected={setSelected}
                onReload={pageState.reload}
                saveMode={pageState.saveMode}
                setSaveMode={pageState.setSaveMode}
                dirty={pageState.dirty}
                saving={pageState.saving}
                onCommit={() => void pageState.commit()}
                onDiscard={pageState.discard}
                canUndo={pageState.canUndo}
                canRedo={pageState.canRedo}
                onUndo={pageState.undo}
                onRedo={pageState.redo}
                onHistory={() => setHistoryOpen(true)}
                allLangs={allLangs}
              />
            ) : (
              <CompareTab
                doc={doc}
                page={page}
                mutate={pageState.mutate}
                reload={pageState.reload}
                selected={selected}
                setSelected={setSelected}
                langs={langs}
                setLangs={setLangs}
                allLangs={allLangs}
                overlay={overlay}
                setOverlay={setOverlay}
                canUndo={pageState.canUndo}
                canRedo={pageState.canRedo}
                onUndo={pageState.undo}
                onRedo={pageState.redo}
                detailPanel={detailPanel}
                onOpenDetail={openDetail}
                onCloseDetail={closeDetail}
              />
            )
          ) : (
            !pageState.error && <div className="stage-loading">{t('app.noContent')}</div>
          )}
        </main>

        <NotesPanel
          doc={doc}
          panel={primaryPanel}
          panelLabel={panelLabel}
          mutate={pageState.mutate}
          tagStats={tagStats}
          library={library}
          onJump={jumpTo}
          onClose={() => setNotesOpen(false)}
        />
      </div>

      {readingMode && readingHint && (
        <div className="reading-toast" role="status">
          {t(navigator.maxTouchPoints > 0 ? 'reading.exitHintTouch' : 'reading.exitHint')}
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
          loadTags();
        }}
        doc={doc}
        page={page}
        panel={primaryPanel}
        library={library}
        sel={sel}
        langs={langs}
        allLangs={allLangs}
        tagStats={tagStats}
        rootPath={rootPath}
      />

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <PageHistoryDialog
        open={historyOpen && Boolean(sel)}
        sel={sel}
        onClose={() => setHistoryOpen(false)}
        onBeforeRestore={pageState.flush}
        onRestored={pageState.reload}
      />

      {pwa.updateReady && (
        <div className="banner info floating pwa-update" role="status">
          <span>{t('pwa.updateReady')}</span>
          <button type="button" className="btn tiny" onClick={pwa.applyUpdate}>
            {t('pwa.reload')}
          </button>
        </div>
      )}

      {sel && availableLangs.length === 0 && <div className="banner error floating">{t('app.noImages')}</div>}

      {availableLangs.length > 0 && missingLangs.length > 0 && sel && (
        <div className="banner info floating">
          {t('app.missingLangs', {
            langs: missingLangs.map((l) => langLabel(l)).join(' / '),
          })}
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd>{children}</kbd>;
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help-modal">
        <header className="modal-head">
          <div>
            <h2>{t('app.help.heading')}</h2>
            <p>{t('app.help.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="help-body">
          <section>
            <h3>{t('app.help.global')}</h3>
            <dl>
              <dt>
                <Kbd>[</Kbd> <Kbd>]</Kbd>
              </dt>
              <dd>{t('app.help.prevNext')}</dd>
              <dt>
                <Kbd>←</Kbd> <Kbd>→</Kbd> / <Kbd>↑</Kbd> <Kbd>↓</Kbd>
              </dt>
              <dd>{t('app.help.arrowNav')}</dd>
              <dt>
                <Kbd>P</Kbd> <Kbd>C</Kbd>
              </dt>
              <dd>{t('app.help.switchViews')}</dd>
              <dt>
                <Kbd>S</Kbd>
              </dt>
              <dd>{t('app.help.toggleSidebar')}</dd>
              <dt>
                <Kbd>N</Kbd>
              </dt>
              <dd>{t('app.help.toggleNotes')}</dd>
              <dt>
                <Kbd>R</Kbd>
              </dt>
              <dd>{t('app.help.toggleReading')}</dd>
              <dt>
                <Kbd>E</Kbd>
              </dt>
              <dd>{t('app.help.openExport')}</dd>
              <dt>
                <Kbd>?</Kbd>
              </dt>
              <dd>{t('app.help.openHelp')}</dd>
            </dl>
          </section>

          <section>
            <h3>{t('app.help.panels')}</h3>
            <dl>
              <dt>{t('app.help.dragTitle')}</dt>
              <dd>{t('app.help.dragDesc')}</dd>
              <dt>{t('app.help.dblclickTitle')}</dt>
              <dd>{t('app.help.dblclickDesc')}</dd>
              <dt>
                <Kbd>Ctrl</Kbd>/<Kbd>Shift</Kbd> {t('app.help.multiSelect')}
              </dt>
              <dd>
                {t('app.help.mergePrefix')}
                <Kbd>Delete</Kbd>
                {t('app.help.mergeSuffix')}
              </dd>
              <dt>{t('app.help.numericTitle')}</dt>
              <dd>{t('app.help.numericDesc')}</dd>
            </dl>
          </section>

          <section>
            <h3>{t('app.help.compare')}</h3>
            <dl>
              <dt>{t('app.help.panTitle')}</dt>
              <dd>{t('app.help.panDesc')}</dd>
              <dt>{t('app.help.alignTitle')}</dt>
              <dd>{t('app.help.alignDesc')}</dd>
              <dt>{t('app.help.anchorTitle')}</dt>
              <dd>{t('app.help.anchorDesc')}</dd>
            </dl>
          </section>

          <section>
            <h3>{t('app.help.export')}</h3>
            <dl>
              <dt>{t('app.help.exportDefaultTitle')}</dt>
              <dd>{t('app.help.exportDefaultDesc')}</dd>
              <dt>{t('app.help.exportSingleTitle')}</dt>
              <dd>{t('app.help.exportSingleDesc')}</dd>
              <dt>{t('app.help.exportPngTitle')}</dt>
              <dd>{t('app.help.exportPngDesc')}</dd>
            </dl>
          </section>
        </div>
        <footer className="modal-foot">
          <span className="muted tiny">{t('app.help.footer')}</span>
          <button type="button" className="btn primary" onClick={onClose}>
            {t('app.help.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Welcome({ library, onOpen }: { library: Library | null; onOpen: (sel: Selection) => void }) {
  const { t } = useI18n();
  const first = library?.volumes[0]?.chapters[0];
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <h1>{t('app.welcome.title')}</h1>
        <p>{t('app.welcome.desc')}</p>
        {first && (
          <button
            type="button"
            className="btn primary large"
            onClick={() => onOpen({ volume: first.volume, chapter: first.chapter, pageIndex: 0 })}
          >
            {t('app.welcome.start', {
              volume: first.volume,
              chapter: t('format.chapter', { chapter: first.chapter }),
            })}
          </button>
        )}
      </div>
      <div className="welcome-steps">
        <div>
          <b>1</b>
          <h3>{t('app.welcome.step1Title')}</h3>
          <p>{t('app.welcome.step1Desc')}</p>
        </div>
        <div>
          <b>2</b>
          <h3>{t('app.welcome.step2Title')}</h3>
          <p>{t('app.welcome.step2Desc')}</p>
        </div>
        <div>
          <b>3</b>
          <h3>{t('app.welcome.step3Title')}</h3>
          <p>{t('app.welcome.step3Desc')}</p>
        </div>
        <div>
          <b>4</b>
          <h3>{t('app.welcome.step4Title')}</h3>
          <p>{t('app.welcome.step4Desc')}</p>
        </div>
      </div>
    </div>
  );
}
