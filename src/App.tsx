import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { PanelsTab } from './components/PanelsTab';
import { CompareTab } from './components/CompareTab';
import { NotesPanel } from './components/NotesPanel';
import { ExportDialog } from './components/ExportDialog';
import { usePage } from './hooks/usePage';
import type { Selection } from './hooks/usePage';
import { api } from './api';
import { LANGUAGES } from './types';
import type { Lang, Library, ReadingDirection } from './types';
import { langLabel, readingLabel, useI18n } from './i18n';
import type { Locale } from './i18n';
import { sortPanels } from './lib/geometry';
import { applyTheme, readThemeMode, saveThemeMode, watchSystemTheme } from './theme';
import type { ThemeMode } from './theme';

/** Order used by the reading-direction selector; the labels come from i18n. */
const READING_DIRECTIONS: ReadingDirection[] = ['rtl', 'ltr', 'ttb'];

export default function App() {
  const { t, locale, setLocale, formatNumber } = useI18n();
  const [library, setLibrary] = useState<Library | null>(null);
  const [rootPath, setRootPath] = useState('');
  const [libError, setLibError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [view, setView] = useState<'panels' | 'compare'>('panels');
  const [langs, setLangs] = useState<Lang[]>(['ja', 'zh', 'en']);
  const [overlay, setOverlay] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [tagStats, setTagStats] = useState<{ tag: string; count: number }[]>([]);
  const [notesOpen, setNotesOpen] = useState(() => window.innerWidth > 1180);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 1024);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingPanel, setPendingPanel] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(readThemeMode);

  // Keep the palette in sync with the stored preference and with OS changes when the
  // user picked "system". index.html already applied it before paint, so this only
  // matters for in-app switches and OS flips.
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(theme);
  }, [theme]);

  const pageState = usePage(sel);
  const { doc, page } = pageState;

  // hash 深链：#/<卷>/<话>/<页(1 起)>，便于直接打开与分享
  useEffect(() => {
    const readHash = () => {
      const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
      if (!raw) return;
      const [volume, chapter, pageNo, mode] = raw.split('/');
      if (!volume || !chapter) return;
      const n = Math.max(1, Number.parseInt(pageNo ?? '1', 10) || 1);
      if (mode === 'compare' || mode === 'panels') setView(mode);
      setSel((prev) =>
        prev && prev.volume === volume && prev.chapter === chapter && prev.pageIndex === n - 1
          ? prev
          : { volume, chapter, pageIndex: n - 1 },
      );
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  useEffect(() => {
    if (!sel) return;
    const next = `#/${encodeURIComponent(sel.volume)}/${encodeURIComponent(sel.chapter)}/${sel.pageIndex + 1}/${view}`;
    if (location.hash !== next) history.replaceState(null, '', next);
  }, [sel, view]);

  const loadLibrary = useCallback(() => {
    api
      .library()
      .then((res) => {
        setLibrary(res.library);
        setRootPath(res.root);
        setLibError(null);
      })
      .catch((err: unknown) => setLibError(err instanceof Error ? err.message : String(err)));
  }, []);

  const loadTags = useCallback(() => {
    api
      .tags()
      .then((res) => setTagStats(res.tags))
      .catch(() => setTagStats([]));
  }, []);

  useEffect(() => {
    loadLibrary();
    loadTags();
  }, [loadLibrary, loadTags]);

  // 页面首次落盘后刷新图库角标
  useEffect(() => {
    if (pageState.exists) loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState.exists]);

  useEffect(() => {
    if (!doc) return;
    setSelected((prev) => prev.filter((id) => doc.panels.some((p) => p.id === id)));
  }, [doc?.panels, doc]);

  // 确认保存模式下还有待保存修改时，离开页面先拦一下；自动保存模式不干预
  useEffect(() => {
    if (!pageState.dirty || pageState.saveMode !== 'confirm') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pageState.dirty, pageState.saveMode]);

  const ordered = useMemo(() => (doc ? sortPanels(doc.panels, doc.readingDirection) : []), [doc]);
  const primaryId = selected[selected.length - 1];
  const primaryPanel = doc?.panels.find((p) => p.id === primaryId) ?? null;
  const primaryIndex = primaryPanel ? ordered.findIndex((p) => p.id === primaryPanel.id) : -1;
  const panelLabel =
    primaryIndex >= 0
      ? t('format.panel', { number: formatNumber(primaryIndex + 1) })
      : t('notes.thisPanel');

  // 笔记总览跳转：先切页，等分格载入后再选中目标格，避免被“清理无效选择”逻辑吞掉
  useEffect(() => {
    if (!doc || !pendingPanel) return;
    if (doc.panels.some((p) => p.id === pendingPanel)) {
      setSelected([pendingPanel]);
      setPendingPanel(null);
    }
  }, [doc, pendingPanel]);

  const jumpTo = useCallback((sel2: Selection, panelId: string | null) => {
    setSel(sel2);
    setPendingPanel(panelId);
    if (panelId) setView('compare');
  }, []);

  const changeDirection = (dir: ReadingDirection) => pageState.mutate((d) => ({ ...d, readingDirection: dir }));

  const goPage = useCallback(
    (delta: number) => {
      if (!library || !sel) return;
      const vol = library.volumes.find((v) => v.id === sel.volume);
      if (!vol) return;
      const ci = vol.chapters.findIndex((c) => c.chapter === sel.chapter);
      const chapter = vol.chapters[ci];
      if (!chapter) return;
      const nextIndex = sel.pageIndex + delta;
      if (nextIndex >= 0 && nextIndex < chapter.pages.length) {
        setSel({ ...sel, pageIndex: nextIndex });
        return;
      }
      const nextChapter = vol.chapters[ci + (delta > 0 ? 1 : -1)];
      if (!nextChapter || !nextChapter.pages.length) return;
      setSel({
        volume: sel.volume,
        chapter: nextChapter.chapter,
        pageIndex: delta > 0 ? 0 : nextChapter.pages.length - 1,
      });
    },
    [library, sel],
  );

  // Destructured so the shortcut effect depends on the callbacks themselves
  // instead of the whole pageState object (which changes on every keystroke of a note).
  const undoPage = pageState.undo;
  const redoPage = pageState.redo;

  // 键盘快捷键（输入框内不触发）：[ ] 翻页，P 分格，C 对照，S 侧栏，N 笔记，E 导出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
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
      else if (key === 'e' && doc) setExportOpen(true);
      else if (e.key === '?') setHelpOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, goPage, undoPage, redoPage]);

  const availableLangs = page ? LANGUAGES.filter((l) => Boolean(page.files[l])) : [];

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
    <div className={`app ${notesOpen ? 'show-notes' : ''} ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <header className="topbar">
        <div className="tb-left">
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
          <div className="logo">
            KomaYomi<span>Manga Learner</span>
          </div>
          {sel && (
            <div className="crumb">
              <span>{sel.volume}</span>
              <i>/</i>
              <span>{t('format.chapter', { chapter: sel.chapter })}</span>
              <i>/</i>
              <b>{t('format.page', { page: formatNumber(sel.pageIndex + 1) })}</b>
              <div className="page-nav">
                <button type="button" onClick={() => goPage(-1)} title={t('app.prevPageTitle')}>
                  ‹
                </button>
                <button type="button" onClick={() => goPage(1)} title={t('app.nextPageTitle')}>
                  ›
                </button>
              </div>
            </div>
          )}
          {doc && <span className={`save-state ${pageState.dirty ? 'dirty' : ''}`}>{saveLabel}</span>}
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
          <button type="button" className={`btn ${notesOpen ? 'on' : ''}`} onClick={() => setNotesOpen((v) => !v)}>
            {t('app.notesButton')}
          </button>
          <button type="button" className="btn primary" disabled={!doc} onClick={() => setExportOpen(true)}>
            {t('app.exportButton')}
            <span className="tb-export-extra"> HTML</span>
          </button>
        </div>
      </header>

      <div className="body-area">
        <Sidebar
          library={library}
          rootPath={rootPath}
          selection={sel}
          onOpen={setSel}
          onReload={loadLibrary}
          dirty={pageState.dirty}
        />

        <main className="stage">
          {libError && <div className="banner error">{t('app.libraryError', { error: libError })}</div>}
          {pageState.error && <div className="banner error">{pageState.error}</div>}

          {!sel ? (
            <Welcome library={library} onOpen={setSel} />
          ) : pageState.loading ? (
            <div className="stage-loading">
              {t('app.loadingPage', { page: formatNumber(sel.pageIndex + 1) })}
            </div>
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
                overlay={overlay}
                setOverlay={setOverlay}
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
        tagStats={tagStats}
        rootPath={rootPath}
      />

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {sel && availableLangs.length === 0 && (
        <div className="banner error floating">{t('app.noImages')}</div>
      )}

      {availableLangs.length > 0 && availableLangs.length < 3 && sel && (
        <div className="banner info floating">
          {t('app.missingLangs', {
            langs: LANGUAGES.filter((l) => !availableLangs.includes(l))
              .map((l) => langLabel(l))
              .join(' / '),
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
