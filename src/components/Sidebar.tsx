import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChapterEntry, Lang, Library, PageEntry, VolumeEntry } from '../types';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { langShort, SINGLE_CHAPTER } from '../types';
import type { Selection } from '../hooks/usePage';
import { api, thumbUrl } from '../api';
import { copyText } from '../lib/clipboard';
import { volumeLabel } from '../lib/volumeLabel';
import { isNativeTextTarget, useContextMenu } from './ContextMenu';
import { useI18n } from '../i18n';
import { AddVolumeDialog, VolumeSettingsDialog } from './LibraryDialogs';
import { DataToolsDialog } from './DataToolsDialog';
import { ProjectDialog } from './ProjectDialog';
import { ExchangeDialog } from './ExchangeDialog';
import { DirRulesDialog } from './DirRulesDialog';
import { PreprocessDialog } from './PreprocessDialog';
import { PluginsDialog } from './PluginsDialog';

type Props = {
  library: Library | null;
  rootPath: string;
  /** Folder that actually holds the volume folders (copy path / reveal target). */
  rawPath: string;
  selection: Selection | null;
  onOpen: (sel: Selection) => void;
  onReload: (library?: Library) => void;
  /** Whether the current page has unsaved edits; warned before project export/import. */
  dirty: boolean;
  /** Read-only viewer: library management is hidden, browsing and opening stay available. */
  readOnly?: boolean;
};

function pickFile(page: PageEntry, volume?: VolumeEntry): { url: string; lang: Lang } | null {
  const order = [
    ...(volume?.languages ?? []),
    ...Object.keys(page.files).filter((l) => !volume?.languages.includes(l)),
  ];
  for (const lang of order) {
    const url = page.files[lang];
    if (url) return { url, lang };
  }
  return null;
}

type FootIconName = 'project' | 'exchange' | 'rules' | 'backup' | 'preprocess' | 'plugins';

/** How chapter pages are listed in the sidebar; persisted locally per browser. */
type PageListLayout = 'grid' | 'single' | 'list';

const PAGE_LIST_KEY = 'manga-memo.page-list-layout';

function readPageListLayout(): PageListLayout {
  try {
    const saved = localStorage.getItem(PAGE_LIST_KEY);
    return saved === 'single' || saved === 'list' ? saved : 'grid';
  } catch {
    return 'grid';
  }
}

function PageListIcon({ name }: { name: PageListLayout }) {
  return (
    <svg
      viewBox="0 0 14 14"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'grid' && (
        <>
          <rect x="1.6" y="1.6" width="4.6" height="4.6" rx="0.8" />
          <rect x="7.8" y="1.6" width="4.6" height="4.6" rx="0.8" />
          <rect x="1.6" y="7.8" width="4.6" height="4.6" rx="0.8" />
          <rect x="7.8" y="7.8" width="4.6" height="4.6" rx="0.8" />
        </>
      )}
      {name === 'single' && (
        <>
          <rect x="1.6" y="1.6" width="10.8" height="4.6" rx="0.8" />
          <rect x="1.6" y="7.8" width="10.8" height="4.6" rx="0.8" />
        </>
      )}
      {name === 'list' && (
        <>
          <path d="M4.4 3h8.2M4.4 7h8.2M4.4 11h8.2" />
          <circle cx="1.9" cy="3" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="1.9" cy="7" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="1.9" cy="11" r="0.7" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

/** Small monochrome icons for the sidebar footer; they inherit the theme colour. */
function FootIcon({ name }: { name: FootIconName }) {
  return (
    <svg
      className="foot-icon"
      viewBox="0 0 14 14"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'project' && (
        <>
          <path d="M3.5 1.8h4l3 3v7.4h-7z" />
          <path d="M7.5 1.8v3h3" />
        </>
      )}
      {name === 'exchange' && (
        <>
          <path d="M2.6 4.6h8.2m0 0-2.1-2.1m2.1 2.1-2.1 2.1" />
          <path d="M11.4 9.4H3.2m0 0 2.1-2.1M3.2 9.4l2.1 2.1" />
        </>
      )}
      {name === 'rules' && (
        <>
          <path d="M2.4 3.6h9.2M2.4 7h9.2M2.4 10.4h9.2" />
          <circle cx="5.4" cy="3.6" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="9" cy="7" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="4.4" cy="10.4" r="1.3" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'preprocess' && (
        <>
          <path d="M2.4 3.4h9.2v3.2H2.4zM2.4 8.8h9.2" />
          <path d="M4.6 11.2h3.2" />
        </>
      )}
      {name === 'backup' && (
        <>
          <path d="M7 1.8v6.4m0 0L4.4 5.6M7 8.2l2.6-2.6" />
          <path d="M2.4 10.2v1.8h9.2v-1.8" />
        </>
      )}
      {name === 'plugins' && (
        <path d="M2.4 2.4h3.6v1.3a1 1 0 1 0 2 0V2.4h3.6v3.6h-1.3a1 1 0 1 0 0 2h1.3v3.6H6.4v-1.3a1 1 0 1 1-2 0v1.3H2.4z" />
      )}
    </svg>
  );
}

export function Sidebar({ library, rootPath, rawPath, selection, onOpen, onReload, dirty, readOnly = false }: Props) {
  const { t, formatNumber } = useI18n();
  const { openMenu } = useContextMenu();
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({}));
  const [addOpen, setAddOpen] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [dirRulesOpen, setDirRulesOpen] = useState(false);
  const [preprocessOpen, setPreprocessOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  /** Last reveal-folder failure, shown inline instead of a blocking native alert. */
  const [revealError, setRevealError] = useState<string | null>(null);
  const [pageLayout, setPageLayout] = useState<PageListLayout>(readPageListLayout);
  /** Notes per chapter/page, loaded only while the list view needs them. */
  const [noteCounts, setNoteCounts] = useState<Record<string, Record<number, number>>>({});
  const notesPending = useRef(new Set<string>());
  const sidebarScroll = useRef<HTMLDivElement>(null);

  /** Keep the scroll offset while the page list changes shape. */
  const choosePageLayout = (next: PageListLayout) => {
    if (next === pageLayout) return;
    const top = sidebarScroll.current?.scrollTop ?? 0;
    setPageLayout(next);
    try {
      localStorage.setItem(PAGE_LIST_KEY, next);
    } catch {
      // Storage can be disabled; the in-memory choice still applies.
    }
    requestAnimationFrame(() => {
      if (sidebarScroll.current) sidebarScroll.current.scrollTop = top;
    });
  };

  const activeChapterKey = selection ? `${selection.volume}/${selection.chapter}` : '';

  // Keep the dialog in sync with the refreshed library (chapter removal) instead of a stale snapshot.
  const settings = settingsId ? (library?.volumes.find((v) => v.id === settingsId) ?? null) : null;

  /** Right-clicking the library offers the actions that otherwise hide in the footer icons. */
  const openSidebarMenu = (e: ReactMouseEvent) => {
    if (isNativeTextTarget(e.target)) return;
    e.preventDefault();
    openMenu(e, [
      ...(readOnly ? [] : [{ id: 'add', label: t('sidebar.addManga'), onSelect: () => setAddOpen(true) }]),
      { id: 'refresh', label: t('sidebar.refreshLibrary'), onSelect: () => onReload() },
      { type: 'separator', id: 'sep' },
      {
        id: 'reveal',
        label: t('sidebar.openFolder'),
        disabled: !rawPath,
        onSelect: () => {
          setRevealError(null);
          void api.revealRoot().catch((err: unknown) => {
            setRevealError(err instanceof Error ? err.message : String(err));
          });
        },
      },
      { id: 'copy', label: t('sidebar.copyPath'), disabled: !rawPath, onSelect: () => void copyText(rawPath) },
    ]);
  };

  // Auto-expand the active chapter.
  const expanded = useMemo(() => {
    const base = { ...open };
    if (activeChapterKey) base[activeChapterKey] = base[activeChapterKey] ?? true;
    return base;
  }, [open, activeChapterKey]);

  // The list view shows a real note count; fetch it once per expanded chapter.
  useEffect(() => {
    if (pageLayout !== 'list' || !library) return;
    let cancelled = false;
    for (const volume of library.volumes) {
      for (const chapter of volume.chapters) {
        const key = `${volume.id}/${chapter.chapter}`;
        if (!expanded[key] || notesPending.current.has(key)) continue;
        notesPending.current.add(key);
        void api
          .notes({ volume: volume.id, chapter: chapter.chapter })
          .then((index) => {
            if (cancelled) {
              notesPending.current.delete(key);
              return;
            }
            const counts: Record<number, number> = {};
            for (const note of index.notes) counts[note.pageIndex] = (counts[note.pageIndex] ?? 0) + 1;
            setNoteCounts((prev) => ({ ...prev, [key]: counts }));
          })
          .catch(() => notesPending.current.delete(key));
      }
    }
    return () => {
      cancelled = true;
    };
  }, [pageLayout, library, expanded]);

  const errorBanner = revealError ? (
    <div className="banner error" role="alert">
      {revealError}
    </div>
  ) : null;

  if (!library) {
    return (
      <aside className="sidebar" onContextMenu={openSidebarMenu}>
        <div className="sidebar-head">
          <div className="root-path">{t('sidebar.loadingLibrary')}</div>
        </div>
        {errorBanner}
      </aside>
    );
  }

  if (!library.volumes.length) {
    return (
      <aside className="sidebar" onContextMenu={openSidebarMenu}>
        {errorBanner}
        <div className="sidebar-empty">
          {t('sidebar.emptyNoVolumesBefore')}
          <code>{rootPath || 'raw'}</code>
          {t('sidebar.emptyNoVolumesAfter')}
          <br />
          {t('sidebar.emptyHintBefore')}
          <code>{t('sidebar.emptyHintExample')}</code>
          {t('sidebar.emptyHintAfter')}
          {!readOnly && (
            <button type="button" className="btn primary block" onClick={() => setAddOpen(true)}>
              {t('sidebar.addManga')}
            </button>
          )}
        </div>
        {addOpen && (
          <AddVolumeDialog
            onClose={() => setAddOpen(false)}
            onDone={(lib) => {
              onReload(lib);
              setAddOpen(false);
            }}
          />
        )}
      </aside>
    );
  }

  const renderChapter = (volume: VolumeEntry, chapter: ChapterEntry) => {
    const volumeId = volume.id;
    const key = `${volumeId}/${chapter.chapter}`;
    const isOpen = expanded[key];
    // Pages excluded by preprocessing are not part of the reading body.
    const bodyPages = chapter.pages.filter((p) => !p.excluded);
    const pageWarnings = bodyPages.reduce((n, p) => n + p.warnings.length, 0);
    const annotated = bodyPages.filter((p) => p.annotated).length;

    return (
      <div className="chapter" key={key}>
        <button
          type="button"
          className={`chapter-row ${selection?.volume === volumeId && selection.chapter === chapter.chapter ? 'active' : ''}`}
          onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
        >
          <span className={`chev ${isOpen ? 'open' : ''}`}>▸</span>
          <span className="ch-name">
            {chapter.title?.trim() ||
              (chapter.chapter === SINGLE_CHAPTER
                ? t('sidebar.singleChapter')
                : t('format.chapter', { chapter: chapter.chapter }))}
          </span>
          <span className="ch-meta">
            {annotated > 0 && <span className="chip-mini ok">{formatNumber(annotated)}</span>}
            {pageWarnings > 0 && (
              <span className="chip-mini warn" title={bodyPages.flatMap((p) => p.warnings).join('\n')}>
                !
              </span>
            )}
            <span className="ch-count">{formatNumber(bodyPages.length)}p</span>
          </span>
        </button>

        {isOpen && (
          <>
            {chapter.warnings.map((w) => (
              <div className="warn-line" key={w}>
                {w}
              </div>
            ))}
            {pageLayout === 'list' ? (
              <div className="page-list">
                {bodyPages.map((page, position) => {
                  const active =
                    selection?.volume === volumeId &&
                    selection.chapter === chapter.chapter &&
                    selection.pageIndex === page.index;
                  const pageNo = formatNumber(position + 1);
                  const langs = [
                    ...volume.languages,
                    ...(Object.keys(page.files) as Lang[]).filter((l) => !volume.languages.includes(l)),
                  ];
                  const notes = noteCounts[key]?.[page.index];
                  return (
                    <button
                      type="button"
                      key={page.index}
                      className={`page-row${active ? ' is-active' : ''}`}
                      title={`${t('format.page', { page: pageNo })}${
                        page.warnings.length ? '\n' + page.warnings.join('\n') : ''
                      }`}
                      onClick={() => onOpen({ volume: volumeId, chapter: chapter.chapter, pageIndex: page.index })}
                    >
                      <span className="page-row-no">{pageNo}</span>
                      <span className="page-row-langs">
                        {langs.length ? (
                          langs.map((lang) =>
                            page.files[lang] ? (
                              <span className="page-row-lang" key={lang}>
                                {langShort(lang)}
                              </span>
                            ) : (
                              <span
                                className="page-row-lang is-missing"
                                key={lang}
                                title={t('sidebar.langMissing', { lang: langShort(lang) })}
                              >
                                {langShort(lang)}
                              </span>
                            ),
                          )
                        ) : (
                          <span className="page-row-missing">{t('sidebar.missingImage')}</span>
                        )}
                        {page.warnings.length > 0 && <i className="page-row-warn">!</i>}
                      </span>
                      <span
                        className="page-row-notes"
                        title={notes ? t('sidebar.pageNotes', { count: formatNumber(notes) }) : undefined}
                      >
                        {notes === undefined
                          ? page.annotated
                            ? '✎'
                            : ''
                          : notes > 0
                            ? `✎ ${formatNumber(notes)}`
                            : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={`page-grid${pageLayout === 'single' ? ' is-single' : ''}`}>
                {bodyPages.map((page, position) => {
                  const file = pickFile(page, volume);
                  const active =
                    selection?.volume === volumeId &&
                    selection.chapter === chapter.chapter &&
                    selection.pageIndex === page.index;
                  const pageNo = formatNumber(position + 1);
                  return (
                    <button
                      type="button"
                      key={page.index}
                      className={`thumb ${active ? 'active' : ''} ${file ? '' : 'missing'}`}
                      title={`${t('format.page', { page: pageNo })}${
                        page.warnings.length ? '\n' + page.warnings.join('\n') : ''
                      }`}
                      onClick={() => onOpen({ volume: volumeId, chapter: chapter.chapter, pageIndex: page.index })}
                    >
                      {file ? (
                        <img src={thumbUrl(file.url, 200)} alt={t('format.page', { page: pageNo })} loading="lazy" />
                      ) : (
                        <span>{t('sidebar.missingImage')}</span>
                      )}
                      <em>{pageNo}</em>
                      {page.warnings.length > 0 && <i className="thumb-warn">!</i>}
                      {page.annotated && <i className="thumb-dot" />}
                      {file && <b className="thumb-lang">{langShort(file.lang)}</b>}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar" onContextMenu={openSidebarMenu}>
      <div className="sidebar-head">
        <div className="root-path" title={rootPath}>
          {t('format.volumesChapters', {
            volumes: formatNumber(library.volumes.length),
            chapters: formatNumber(library.volumes.reduce((n, v) => n + v.chapters.length, 0)),
          })}
          {!readOnly && (
            <button
              type="button"
              className="btn tiny add-volume-btn"
              onClick={() => setAddOpen(true)}
              title={t('sidebar.addMangaTitle')}
            >
              {t('sidebar.addMangaShort')}
            </button>
          )}
        </div>
        <div className="page-list-modes" role="group" aria-label={t('sidebar.pageListLayout')}>
          {(['grid', 'single', 'list'] as const).map((mode) => {
            const label =
              mode === 'grid'
                ? t('sidebar.pageListGrid')
                : mode === 'single'
                  ? t('sidebar.pageListSingle')
                  : t('sidebar.pageListList');
            return (
              <button
                key={mode}
                type="button"
                className={`page-list-mode${pageLayout === mode ? ' is-active' : ''}`}
                title={label}
                aria-label={label}
                aria-pressed={pageLayout === mode}
                onClick={() => choosePageLayout(mode)}
              >
                <PageListIcon name={mode} />
              </button>
            );
          })}
        </div>
      </div>
      {errorBanner}
      <div className="sidebar-scroll" ref={sidebarScroll}>
        {library.volumes.map((volume) => (
          <div className="volume" key={volume.id}>
            <div className="volume-title">
              <span className="volume-name" title={volumeLabel(volume)}>
                {volumeLabel(volume)}
              </span>
              <span
                className="volume-langs"
                title={volume.languages.length ? volume.languages.map((l) => langShort(l)).join(' · ') : undefined}
              >
                {volume.languages.length ? (
                  <>
                    {volume.languages
                      .slice(0, 2)
                      .map((l) => langShort(l))
                      .join(' · ')}
                    {volume.languages.length > 2 && <b className="volume-langs-more">+{volume.languages.length - 2}</b>}
                  </>
                ) : (
                  t('sidebar.langsUnconfigured')
                )}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  className="icon-btn volume-gear"
                  title={t('sidebar.volumeSettingsTitle')}
                  onClick={() => setSettingsId(volume.id)}
                >
                  ⚙
                </button>
              )}
            </div>
            {volume.warnings.map((w) => (
              <em className="volume-warn" key={w}>
                {w}
              </em>
            ))}
            {volume.chapters.map((chapter) => renderChapter(volume, chapter))}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <span className="sidebar-foot-status" title={readOnly ? t('mode.readOnlyHint') : t('sidebar.rawReadOnly')}>
          {readOnly ? t('mode.readBadge') : t('sidebar.rawReadOnly')}
        </span>
        <span className="sidebar-foot-actions">
          <button
            type="button"
            className="btn tiny foot-btn"
            onClick={() => setProjectOpen(true)}
            title={t('sidebar.projectFileTitle')}
            aria-label={t('sidebar.projectFileTitle')}
          >
            <FootIcon name="project" />
            <span className="foot-label">{t('sidebar.projectFile')}</span>
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                className="btn tiny foot-btn"
                onClick={() => setExchangeOpen(true)}
                title={t('sidebar.exchangeTitle')}
                aria-label={t('sidebar.exchangeTitle')}
              >
                <FootIcon name="exchange" />
                <span className="foot-label">{t('sidebar.exchange')}</span>
              </button>
              <button
                type="button"
                className="btn tiny foot-btn"
                onClick={() => setPreprocessOpen(true)}
                title={t('sidebar.preprocessTitle')}
                aria-label={t('sidebar.preprocessTitle')}
              >
                <FootIcon name="preprocess" />
                <span className="foot-label">{t('sidebar.preprocess')}</span>
              </button>
              <button
                type="button"
                className="btn tiny foot-btn"
                onClick={() => setPluginsOpen(true)}
                title={t('sidebar.pluginsTitle')}
                aria-label={t('sidebar.pluginsTitle')}
              >
                <FootIcon name="plugins" />
                <span className="foot-label">{t('sidebar.plugins')}</span>
              </button>
              <button
                type="button"
                className="btn tiny foot-btn"
                onClick={() => setDirRulesOpen(true)}
                title={t('sidebar.dirRulesTitle')}
                aria-label={t('sidebar.dirRulesTitle')}
              >
                <FootIcon name="rules" />
                <span className="foot-label">{t('sidebar.dirRules')}</span>
              </button>
              <button
                type="button"
                className="btn tiny foot-btn"
                onClick={() => setDataOpen(true)}
                title={t('sidebar.backupTitle')}
                aria-label={t('sidebar.backupTitle')}
              >
                <FootIcon name="backup" />
                <span className="foot-label">{t('sidebar.backup')}</span>
              </button>
            </>
          )}
        </span>
      </div>

      {addOpen && (
        <AddVolumeDialog
          onClose={() => setAddOpen(false)}
          onDone={(lib) => {
            onReload(lib);
            setAddOpen(false);
          }}
        />
      )}
      {settings && (
        <VolumeSettingsDialog
          volume={settings}
          onClose={() => setSettingsId(null)}
          onDone={(lib) => {
            onReload(lib);
            setSettingsId(null);
          }}
          onLibrary={(lib) => onReload(lib)}
        />
      )}
      {dataOpen && <DataToolsDialog onClose={() => setDataOpen(false)} onRestored={(lib) => onReload(lib)} />}
      {projectOpen && (
        <ProjectDialog dirty={dirty} onClose={() => setProjectOpen(false)} onImported={(lib) => onReload(lib)} />
      )}
      {exchangeOpen && (
        <ExchangeDialog
          dirty={dirty}
          selection={selection}
          onClose={() => setExchangeOpen(false)}
          onChanged={() => onReload()}
        />
      )}
      {dirRulesOpen && <DirRulesDialog onClose={() => setDirRulesOpen(false)} onSaved={(lib) => onReload(lib)} />}
      {preprocessOpen && (
        <PreprocessDialog
          library={library}
          initialVolume={selection?.volume}
          onClose={() => setPreprocessOpen(false)}
          onDone={(lib) => onReload(lib)}
        />
      )}
      {pluginsOpen && <PluginsDialog onClose={() => setPluginsOpen(false)} />}
    </aside>
  );
}
