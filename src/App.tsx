import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { PanelsTab } from './components/PanelsTab';
import { CompareTab } from './components/CompareTab';
import { NotesPanel } from './components/NotesPanel';
import { ExportDialog } from './components/ExportDialog';
import { usePage } from './hooks/usePage';
import type { Selection } from './hooks/usePage';
import { api } from './api';
import { LANG_LABEL, READING_LABEL, LANGUAGES } from './types';
import type { Lang, Library, ReadingDirection } from './types';
import { sortPanels } from './lib/geometry';
import { applyTheme, readThemeMode, saveThemeMode, watchSystemTheme } from './theme';
import type { ThemeMode } from './theme';

export default function App() {
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
  const panelLabel = primaryIndex >= 0 ? `第 ${primaryIndex + 1} 格` : '本格';

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
      ? '保存中…'
      : pageState.dirty
        ? pageState.saveMode === 'confirm'
          ? '未保存改动'
          : '待保存'
        : '已保存';

  return (
    <div className={`app ${notesOpen ? 'show-notes' : ''} ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <header className="topbar">
        <div className="tb-left">
          <button
            type="button"
            className={`btn icon ${sidebarOpen ? 'on' : ''}`}
            onClick={() => setSidebarOpen((v) => !v)}
            title="显示/隐藏图库侧栏（S）"
          >
            ☰
          </button>
          <button
            type="button"
            className="btn icon help-btn"
            onClick={() => setHelpOpen(true)}
            title="快捷键与使用帮助（?）"
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
              <span>第 {sel.chapter} 话</span>
              <i>/</i>
              <b>第 {sel.pageIndex + 1} 页</b>
              <div className="page-nav">
                <button type="button" onClick={() => goPage(-1)} title="上一页（[）">
                  ‹
                </button>
                <button type="button" onClick={() => goPage(1)} title="下一页（]）">
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
              分格
            </button>
            <button type="button" className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>
              对照阅读
            </button>
          </div>
        </div>

        <div className="tb-right">
          {doc && (
            <select
              className="tb-select wide"
              value={doc.readingDirection}
              onChange={(e) => changeDirection(e.target.value as ReadingDirection)}
              title="阅读顺序（影响格子编号与对照排序）"
            >
              {(Object.keys(READING_LABEL) as ReadingDirection[]).map((d) => (
                <option key={d} value={d}>
                  {READING_LABEL[d]}
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
            title="界面主题（跟随系统 / 亮色 / 暗色）"
            aria-label="界面主题"
          >
            <option value="system">跟随系统</option>
            <option value="light">亮色</option>
            <option value="dark">暗色</option>
          </select>
          <button type="button" className={`btn ${notesOpen ? 'on' : ''}`} onClick={() => setNotesOpen((v) => !v)}>
            笔记
          </button>
          <button type="button" className="btn primary" disabled={!doc} onClick={() => setExportOpen(true)}>
            导出<span className="tb-export-extra"> HTML</span>
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
          {libError && <div className="banner error">图库读取失败：{libError}</div>}
          {pageState.error && <div className="banner error">{pageState.error}</div>}

          {!sel ? (
            <Welcome library={library} onOpen={setSel} />
          ) : pageState.loading ? (
            <div className="stage-loading">载入第 {sel.pageIndex + 1} 页…</div>
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
            !pageState.error && <div className="stage-loading">没有可显示的内容</div>
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
        <div className="banner error floating">这一页没有任何语言的图片，无法编辑。请在 raw 目录补齐素材。</div>
      )}

      {availableLangs.length > 0 && availableLangs.length < 3 && sel && (
        <div className="banner info floating">
          {LANGUAGES.filter((l) => !availableLangs.includes(l))
            .map((l) => LANG_LABEL[l])
            .join(' / ')}{' '}
          在本页缺失，对照时会显示占位。
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd>{children}</kbd>;
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help-modal">
        <header className="modal-head">
          <div>
            <h2>快捷键与操作</h2>
            <p>在输入框内不会触发单键快捷键</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="help-body">
          <section>
            <h3>全局</h3>
            <dl>
              <dt>
                <Kbd>[</Kbd> <Kbd>]</Kbd>
              </dt>
              <dd>上一页 / 下一页（可跨话）</dd>
              <dt>
                <Kbd>P</Kbd> <Kbd>C</Kbd>
              </dt>
              <dd>切换到分格编辑 / 对照阅读</dd>
              <dt>
                <Kbd>S</Kbd>
              </dt>
              <dd>显示或收起图库侧栏</dd>
              <dt>
                <Kbd>N</Kbd>
              </dt>
              <dd>显示或收起批注栏</dd>
              <dt>
                <Kbd>E</Kbd>
              </dt>
              <dd>打开导出窗</dd>
              <dt>
                <Kbd>?</Kbd>
              </dt>
              <dd>打开本帮助</dd>
            </dl>
          </section>

          <section>
            <h3>分格</h3>
            <dl>
              <dt>拖拽</dt>
              <dd>移动格子；拖角点做八向缩放</dd>
              <dt>双击空白</dt>
              <dd>快速补一个格子</dd>
              <dt>
                <Kbd>Ctrl</Kbd>/<Kbd>Shift</Kbd> 点选
              </dt>
              <dd>多选后合并；<Kbd>Delete</Kbd> 删除</dd>
              <dt>数值输入</dt>
              <dd>工具栏第二行可直接改 X/Y/宽/高（百分比）</dd>
            </dl>
          </section>

          <section>
            <h3>对照与对齐</h3>
            <dl>
              <dt>拖动画面</dt>
              <dd>平移该语言；滚轮缩放</dd>
              <dt>对齐模式</dt>
              <dd>整页偏移 / 逐格偏移 / 锚点对齐 / 网格吸附</dd>
              <dt>锚点模式</dt>
              <dd>先点参考图的特征点，再点目标图的同一点即可对齐</dd>
            </dl>
          </section>

          <section>
            <h3>导出</h3>
            <dl>
              <dt>默认</dt>
              <dd>HTML + 同名 .files 图片目录，直接双击可看</dd>
              <dt>单文件</dt>
              <dd>内嵌图片，适合外发；整话体积较大</dd>
              <dt>PNG</dt>
              <dd>整页 / 当前格 / 三语拼图，可直接插入 PPT</dd>
            </dl>
          </section>
        </div>
        <footer className="modal-foot">
          <span className="muted tiny">数据保存在项目 data/ 目录，可整体备份</span>
          <button type="button" className="btn primary" onClick={onClose}>
            知道了
          </button>
        </footer>
      </div>
    </div>
  );
}

function Welcome({ library, onOpen }: { library: Library | null; onOpen: (sel: Selection) => void }) {
  const first = library?.volumes[0]?.chapters[0];
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <h1>漫画多语言对照阅读与批注</h1>
        <p>
          逐页自动切格，按格并排对照 日本語 / 中文 / English，记录长期批注，最后导出成可分享的 HTML 对照稿。
        </p>
        {first && (
          <button
            type="button"
            className="btn primary large"
            onClick={() => onOpen({ volume: first.volume, chapter: first.chapter, pageIndex: 0 })}
          >
            从「{first.volume} · 第 {first.chapter} 话」开始
          </button>
        )}
      </div>
      <div className="welcome-steps">
        <div>
          <b>1</b>
          <h3>选页</h3>
          <p>左侧按 卷 → 话 → 页 浏览，三语按序号自动配对，缺页与命名异常会有角标提示。</p>
        </div>
        <div>
          <b>2</b>
          <h3>分格</h3>
          <p>首次打开自动检测格子，可拖拽边框、补框、删框、合并；结果自动保存到 data/pages。</p>
        </div>
        <div>
          <b>3</b>
          <h3>对照</h3>
          <p>1/2/3 语自由切换，同格并排；拖动各自画面即可对齐，偏移量随页面记住；支持半透明叠加。</p>
        </div>
        <div>
          <b>4</b>
          <h3>批注与导出</h3>
          <p>页级/格级批注 + 标签，按标签筛选；一键导出左图右注的 HTML，版式可拖动调整。</p>
        </div>
      </div>
    </div>
  );
}
