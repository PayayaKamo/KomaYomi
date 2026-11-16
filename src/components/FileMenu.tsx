import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Library } from '../types';
import type { Selection } from '../hooks/usePage';
import { formatBytes, formatDate, useI18n } from '../i18n';
import { api } from '../api';
import type { ProjectLinkStatus } from '../api';
import { clearRecent, pushRecent, readRecent, removeRecent } from '../lib/recent';
import { saveProjectCopy } from '../lib/projectCopy';
import { volumeLabel as volumeLabelOf } from '../lib/volumeLabel';
import type { RecentPage } from '../lib/recent';
import { AddVolumeDialog } from './LibraryDialogs';
import { ProjectDialog } from './ProjectDialog';
import { ExchangeDialog } from './ExchangeDialog';
import { DataToolsDialog } from './DataToolsDialog';

type Props = {
  library: Library | null;
  selection: Selection | null;
  dirty: boolean;
  hasDoc: boolean;
  /** Request from the welcome screen: open one of the file dialogs without opening the menu. */
  intent?: 'library' | 'add' | 'project' | null;
  onIntentHandled?: () => void;
  onOpenSelection: (selection: Selection) => void;
  onReloadLibrary: () => void;
  onExport: () => void;
  onSave: () => void;
  /** Read-only viewer: only open-project, recent and export stay available. */
  readOnly?: boolean;
};

type AddState = { initialPath?: string } | null;

/**
 * Word-style File menu: new/open/recent/templates/import/save-as/export.
 *
 * Dialogs are self-contained, so the menu owns its own instances and asks the app
 * to reload the library after a project/backup/library change.
 */
export function FileMenu({
  library,
  selection,
  dirty,
  hasDoc,
  intent = null,
  onIntentHandled,
  onOpenSelection,
  onReloadLibrary,
  onExport,
  onSave,
  readOnly = false,
}: Props) {
  const { t, formatNumber: fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentPage[]>([]);
  // "Recent" is a flyout submenu so a long list cannot stretch the File menu.
  const [recentOpen, setRecentOpen] = useState(false);
  const [subPos, setSubPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [addState, setAddState] = useState<AddState>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  /** Which .mnproj receives write-backs; needed to enable "Save to project file". */
  const [link, setLink] = useState<ProjectLinkStatus | null>(null);
  const [fileBusy, setFileBusy] = useState<'save' | 'saveAs' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const recentWrapRef = useRef<HTMLDivElement>(null);
  const recentBtnRef = useRef<HTMLButtonElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const recentOpenRef = useRef(false);
  const subItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const setRecentMenu = useCallback((next: boolean) => {
    recentOpenRef.current = next;
    setRecentOpen(next);
  }, []);

  const refreshLink = useCallback(async () => {
    try {
      setLink(await api.projectLink());
    } catch {
      setLink(null);
    }
  }, []);

  /** Write the working copy back into the opened .mnproj right now (skips the debounce). */
  const saveToProject = useCallback(async () => {
    if (readOnly) return;
    if (!link?.linked) {
      // Keep the menu visible: the reason is more useful than a silently disabled item.
      setOpen(true);
      setNotice({ kind: 'error', text: t('file.saveProjectNoLink') });
      return;
    }
    setFileBusy('save');
    setNotice(null);
    try {
      const res = await api.saveProjectFile();
      setLink(res.link);
      setNotice(
        res.result
          ? {
              kind: 'info',
              text: t('file.saveProjectDone', { path: res.result.path, size: formatBytes(res.result.size) }),
            }
          : { kind: 'error', text: t('file.saveProjectNoLink') },
      );
    } catch (err) {
      setNotice({
        kind: 'error',
        text: `${t('file.saveProjectFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      });
      await refreshLink();
    } finally {
      setFileBusy(null);
    }
  }, [link?.linked, readOnly, refreshLink, t]);

  /**
   * Pack the whole library into a new .mnproj — never the opened file.
   * Desktop asks for a path, the browser downloads the packed copy instead.
   */
  const saveAsCopy = useCallback(async () => {
    if (readOnly) return;
    const suggested = link?.name || `komayomi-${new Date().toISOString().slice(0, 10)}`;
    setFileBusy('saveAs');
    setNotice(null);
    const out = await saveProjectCopy({ title: t('file.saveAsTitle'), suggestedName: suggested });
    setFileBusy(null);
    if (out.kind === 'canceled') return;
    if (out.kind === 'saved') {
      setNotice({ kind: 'info', text: t('file.saveAsDone', { path: out.path, size: formatBytes(out.size) }) });
    } else if (out.kind === 'downloaded') {
      setNotice({ kind: 'info', text: t('file.saveAsDownloaded', { file: out.file }) });
    } else {
      setNotice({ kind: 'error', text: `${t('file.saveAsFailed')}: ${out.message}` });
    }
  }, [link?.name, readOnly, t]);

  // Refresh the list every time the menu is opened so external tab changes show up.
  useEffect(() => {
    if (open) {
      setRecent(readRecent());
      setNotice(null);
      void refreshLink();
    } else setRecentMenu(false);
  }, [open, setRecentMenu, refreshLink]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close one layer at a time: the submenu first, then the whole menu.
      if (recentOpenRef.current) setRecentMenu(false);
      else setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setRecentMenu]);

  // File shortcuts work even while typing in an input, matching desktop apps.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'o') {
        e.preventDefault();
        setOpen(false);
        setProjectOpen(true);
      } else if (key === 's') {
        e.preventDefault();
        if (readOnly) return;
        setOpen(false);
        // Ctrl+Shift+S writes the whole library back into the opened .mnproj.
        if (e.shiftKey) void saveToProject();
        else if (hasDoc) onSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasDoc, onSave, readOnly, saveToProject]);

  const openLibrary = useCallback(async () => {
    setOpen(false);
    if (window.mangaDesktop) {
      const dir = await window.mangaDesktop.pickFolder(t('file.openLibraryTitle'));
      if (dir) setAddState({ initialPath: dir });
      return;
    }
    setAddState({});
  }, [t]);

  // The welcome screen can ask for a dialog directly; open it and clear the request.
  useEffect(() => {
    if (!intent) return;
    setOpen(false);
    if (intent === 'project') setProjectOpen(true);
    else if (intent === 'add') setAddState({});
    else void openLibrary();
    onIntentHandled?.();
  }, [intent, onIntentHandled, openLibrary]);

  const resolve = (entry: RecentPage) => {
    const volume = library?.volumes.find((v) => v.id === entry.volume);
    const chapter = volume?.chapters.find((c) => c.chapter === entry.chapter);
    const pageCount = chapter?.pages.length ?? 0;
    return {
      missing: !volume || !chapter || pageCount === 0,
      title: volume ? volumeLabelOf(volume) : entry.volume,
      pageIndex: Math.min(Math.max(0, entry.pageIndex), Math.max(0, pageCount - 1)),
      pageCount,
    };
  };

  const openRecent = (entry: RecentPage) => {
    const info = resolve(entry);
    if (info.missing) return;
    setOpen(false);
    onOpenSelection({ volume: entry.volume, chapter: entry.chapter, pageIndex: info.pageIndex });
    setRecent(pushRecent({ volume: entry.volume, chapter: entry.chapter, pageIndex: info.pageIndex }));
  };

  const dropRecent = (entry: RecentPage) => {
    setRecent(removeRecent(entry.volume, entry.chapter));
  };

  /** Place the flyout next to its row, flipping left when the right edge is too close. */
  const placeSub = () => {
    const wrap = recentWrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const width = Math.min(640, window.innerWidth - 24);
    const flip = r.right + width + 12 > window.innerWidth;
    setSubPos({ top: Math.max(8, r.top - 8), left: flip ? Math.max(8, r.left - width - 6) : r.right + 6 });
  };

  const openSub = (focusFirst = false) => {
    placeSub();
    setRecentMenu(true);
    if (focusFirst) {
      window.requestAnimationFrame(() => {
        for (const el of subItemRefs.current) {
          if (el && !el.disabled) {
            el.focus();
            return;
          }
        }
      });
    }
  };

  // Once the real height is known, nudge the flyout up so its footer stays visible.
  useLayoutEffect(() => {
    if (!recentOpen || !subRef.current) return;
    const maxTop = window.innerHeight - subRef.current.offsetHeight - 8;
    setSubPos((p) => (p.top > maxTop ? { ...p, top: Math.max(8, maxTop) } : p));
  }, [recentOpen, recent.length]);

  const onRecentItemKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    if (!recent.length) return;
    e.preventDefault();
    e.stopPropagation();
    openSub(true);
  };

  const onSubKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      setRecentMenu(false);
      recentBtnRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const items: HTMLButtonElement[] = [];
    for (const el of subItemRefs.current) if (el && !el.disabled) items.push(el);
    const index = items.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, index + 1)]?.focus();
    else if (index <= 0) recentBtnRef.current?.focus();
    else items[index - 1]?.focus();
  };

  return (
    <div className="file-menu" ref={rootRef}>
      <button
        type="button"
        className={`btn file-menu-btn ${open ? 'on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={t('file.menuTitle')}
      >
        <span className="file-btn-icon" aria-hidden="true">
          ▤
        </span>
        <span className="file-btn-label">{t('file.menu')}</span>
        <span className="file-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="file-pop" role="menu">
          {/* Everything stays visible in read-only mode, disabled with a reason, so the
              menu never looks like entries disappeared. */}
          <div className="file-group">{t('file.groupNew')}</div>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => {
              setOpen(false);
              setAddState({});
            }}
          >
            {t('file.newLibrary')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => void openLibrary()}
          >
            {t('file.openLibrary')}
          </button>

          <div className="file-sep" />
          <div className="file-group">{t('file.groupOpen')}</div>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            onClick={() => {
              setOpen(false);
              setProjectOpen(true);
            }}
          >
            {t('file.openProject')}
            <kbd className="file-kbd">Ctrl+O</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => {
              setOpen(false);
              setAddState({});
            }}
          >
            {t('file.addManga')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => {
              setOpen(false);
              setExchangeOpen(true);
            }}
          >
            {t('file.openTemplates')}
          </button>

          <div className="file-sep" />
          <div className="file-sub-wrap" ref={recentWrapRef} onPointerEnter={() => !recentOpen && openSub()}>
            <button
              ref={recentBtnRef}
              type="button"
              role="menuitem"
              className={`file-item has-sub ${recentOpen ? 'open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={recentOpen}
              disabled={recent.length === 0}
              onClick={() => (recentOpen ? setRecentMenu(false) : openSub())}
              onKeyDown={onRecentItemKeyDown}
            >
              <span>{t('file.groupRecent')}</span>
              <span className="file-item-tail">
                {recent.length > 0 && <span className="file-count">{fmt(recent.length)}</span>}
                <span className="file-item-arrow" aria-hidden="true">
                  ›
                </span>
              </span>
            </button>

            {recentOpen && (
              <div
                ref={subRef}
                className="file-sub"
                role="menu"
                aria-label={t('file.groupRecent')}
                style={{ '--sub-top': `${subPos.top}px`, '--sub-left': `${subPos.left}px` } as CSSProperties}
                onKeyDown={onSubKeyDown}
              >
                <div className="file-sub-head">
                  <span>{t('file.groupRecent')}</span>
                  <span className="file-count">{fmt(recent.length)}</span>
                </div>
                <div className="file-sub-list">
                  {recent.length === 0 ? (
                    <div className="file-empty">{t('file.recentEmpty')}</div>
                  ) : (
                    recent.map((entry, i) => {
                      const info = resolve(entry);
                      const path = `raw/${info.title}${entry.chapter ? `/${entry.chapter}` : ''}`;
                      const newGroup = i === 0 || recent[i - 1].volume !== entry.volume;
                      return (
                        <div key={`${entry.volume}/${entry.chapter}`}>
                          {newGroup && <div className="file-sub-group">{info.title}</div>}
                          <div className={`file-recent ${info.missing ? 'missing' : ''}`}>
                            <button
                              ref={(el) => {
                                subItemRefs.current[i] = el;
                              }}
                              type="button"
                              role="menuitem"
                              className="file-recent-main"
                              disabled={info.missing}
                              onClick={() => openRecent(entry)}
                              title={info.missing ? t('file.recentMissing') : t('file.recentOpen')}
                            >
                              <span className="file-recent-name">
                                {info.title} / {entry.chapter || t('sidebar.singleChapter')}
                                {info.missing && <em className="file-badge">{t('file.recentMissing')}</em>}
                              </span>
                              <span className="file-recent-path" title={path}>
                                {path}
                              </span>
                              <span className="file-recent-when">
                                {t('format.page', { page: fmt(info.pageIndex + 1) })} · {formatDate(entry.at)}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="file-recent-remove"
                              onClick={() => dropRecent(entry)}
                              title={t('file.recentRemove')}
                              aria-label={t('file.recentRemove')}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="file-sub-foot">
                  <button
                    type="button"
                    className="file-clear block"
                    disabled={recent.length === 0}
                    onClick={() => setRecent(clearRecent())}
                  >
                    {t('file.recentClear')}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="file-sep" />
          <div className="file-group">{t('file.groupSave')}</div>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly || !hasDoc}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => {
              setOpen(false);
              onSave();
            }}
          >
            {t('file.savePage')}
            <kbd className="file-kbd">Ctrl+S</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly || !link?.linked || fileBusy !== null}
            title={readOnly ? t('file.readOnlyDisabled') : link?.linked ? undefined : t('file.saveProjectNoLink')}
            onClick={() => void saveToProject()}
          >
            {t('file.saveProject')}
            <kbd className="file-kbd">Ctrl+Shift+S</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly || !library || fileBusy !== null}
            title={readOnly ? t('file.readOnlyDisabled') : window.mangaDesktop ? undefined : t('file.saveAsBrowser')}
            onClick={() => void saveAsCopy()}
          >
            {t('file.saveAs')}
          </button>

          <div className="file-sep" />
          <div className="file-group">{t('file.groupImport')}</div>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => {
              setOpen(false);
              setProjectOpen(true);
            }}
          >
            {t('file.importProject')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => {
              setOpen(false);
              setExchangeOpen(true);
            }}
          >
            {t('file.importExchange')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={readOnly}
            title={readOnly ? t('file.readOnlyDisabled') : undefined}
            onClick={() => {
              setOpen(false);
              setBackupOpen(true);
            }}
          >
            {t('file.restoreBackup')}
          </button>

          <div className="file-sep" />
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={!hasDoc}
            onClick={() => {
              setOpen(false);
              onExport();
            }}
          >
            {t('file.export')}
            <kbd className="file-kbd">E</kbd>
          </button>

          {readOnly && <div className="file-empty">{t('file.readOnlyDisabled')}</div>}
          {(fileBusy || notice) && (
            <div className={`banner ${notice?.kind === 'error' ? 'error' : 'info'}`} role="status">
              {fileBusy === 'save'
                ? t('file.saveProjectBusy')
                : fileBusy === 'saveAs'
                  ? t('file.saveAsBusy')
                  : notice?.text}
            </div>
          )}
        </div>
      )}

      {addState && (
        <AddVolumeDialog
          initialPath={addState.initialPath}
          onClose={() => setAddState(null)}
          onDone={() => {
            onReloadLibrary();
          }}
        />
      )}

      {projectOpen && (
        <ProjectDialog
          dirty={dirty}
          onClose={() => setProjectOpen(false)}
          onImported={() => {
            onReloadLibrary();
            setProjectOpen(false);
          }}
        />
      )}

      {exchangeOpen && (
        <ExchangeDialog
          selection={selection}
          dirty={dirty}
          onClose={() => setExchangeOpen(false)}
          onChanged={onReloadLibrary}
        />
      )}

      {backupOpen && (
        <DataToolsDialog
          onClose={() => setBackupOpen(false)}
          onRestored={() => {
            onReloadLibrary();
            setBackupOpen(false);
          }}
        />
      )}
    </div>
  );
}
