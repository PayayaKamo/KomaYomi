import { useCallback, useEffect, useRef, useState } from 'react';
import type { Library } from '../types';
import type { Selection } from '../hooks/usePage';
import { formatDate, useI18n } from '../i18n';
import { clearRecent, pushRecent, readRecent, removeRecent } from '../lib/recent';
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
  onOpenSelection: (selection: Selection) => void;
  onReloadLibrary: () => void;
  onExport: () => void;
  onSave: () => void;
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
  onOpenSelection,
  onReloadLibrary,
  onExport,
  onSave,
}: Props) {
  const { t, formatNumber: fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentPage[]>([]);
  const [addState, setAddState] = useState<AddState>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Refresh the list every time the menu is opened so external tab changes show up.
  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
        setOpen(false);
        if (e.shiftKey) setProjectOpen(true);
        else if (hasDoc) onSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasDoc, onSave]);

  const openLibrary = useCallback(async () => {
    setOpen(false);
    if (window.mangaDesktop) {
      const dir = await window.mangaDesktop.pickFolder(t('file.openLibraryTitle'));
      if (dir) setAddState({ initialPath: dir });
      return;
    }
    setAddState({});
  }, [t]);

  const resolve = (entry: RecentPage) => {
    const volume = library?.volumes.find((v) => v.id === entry.volume);
    const chapter = volume?.chapters.find((c) => c.chapter === entry.chapter);
    const pageCount = chapter?.pages.length ?? 0;
    return {
      missing: !volume || !chapter || pageCount === 0,
      title: volume?.title ?? entry.volume,
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
          <div className="file-group">{t('file.groupNew')}</div>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            onClick={() => {
              setOpen(false);
              setAddState({});
            }}
          >
            {t('file.newLibrary')}
          </button>
          <button type="button" role="menuitem" className="file-item" onClick={() => void openLibrary()}>
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
            onClick={() => {
              setOpen(false);
              setExchangeOpen(true);
            }}
          >
            {t('file.openTemplates')}
          </button>

          <div className="file-sep" />
          <div className="file-group file-group-row">
            <span>{t('file.groupRecent')}</span>
            {recent.length > 0 && (
              <button
                type="button"
                className="file-clear"
                onClick={() => setRecent(clearRecent())}
                title={t('file.recentClear')}
              >
                {t('file.recentClear')}
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="file-empty">{t('file.recentEmpty')}</div>
          ) : (
            <div className="file-recent-list">
              {recent.map((entry) => {
                const info = resolve(entry);
                return (
                  <div
                    className={`file-recent ${info.missing ? 'missing' : ''}`}
                    key={`${entry.volume}/${entry.chapter}`}
                  >
                    <button
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
                      <span className="file-recent-meta">
                        <span className="file-recent-path">
                          {`raw/${info.title}${entry.chapter ? `/${entry.chapter}` : ''}`}
                        </span>
                        <span>
                          {t('format.page', { page: fmt(info.pageIndex + 1) })} · {formatDate(entry.at)}
                        </span>
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
                );
              })}
            </div>
          )}

          <div className="file-sep" />
          <div className="file-group">{t('file.groupSave')}</div>
          <button
            type="button"
            role="menuitem"
            className="file-item"
            disabled={!hasDoc}
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
            onClick={() => {
              setOpen(false);
              setProjectOpen(true);
            }}
          >
            {t('file.saveAsProject')}
            <kbd className="file-kbd">Ctrl+Shift+S</kbd>
          </button>

          <div className="file-sep" />
          <div className="file-group">{t('file.groupImport')}</div>
          <button
            type="button"
            role="menuitem"
            className="file-item"
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
