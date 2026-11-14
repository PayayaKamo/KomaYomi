import { useMemo, useState } from 'react';
import type { ChapterEntry, Lang, Library, PageEntry, VolumeEntry } from '../types';
import { LANGUAGES, LANG_SHORT, SINGLE_CHAPTER } from '../types';
import type { Selection } from '../hooks/usePage';
import { thumbUrl } from '../api';
import { useI18n } from '../i18n';
import { AddVolumeDialog, VolumeSettingsDialog } from './LibraryDialogs';
import { DataToolsDialog } from './DataToolsDialog';
import { ProjectDialog } from './ProjectDialog';
import { ExchangeDialog } from './ExchangeDialog';
import { DirRulesDialog } from './DirRulesDialog';

type Props = {
  library: Library | null;
  rootPath: string;
  selection: Selection | null;
  onOpen: (sel: Selection) => void;
  onReload: (library?: Library) => void;
  /** 当前页面是否有未保存修改，工程导出/导入前提示 */
  dirty: boolean;
};

function pickFile(page: PageEntry): { url: string; lang: Lang } | null {
  for (const lang of LANGUAGES) {
    const url = page.files[lang];
    if (url) return { url, lang };
  }
  return null;
}

export function Sidebar({ library, rootPath, selection, onOpen, onReload, dirty }: Props) {
  const { t, formatNumber } = useI18n();
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({}));
  const [addOpen, setAddOpen] = useState(false);
  const [settings, setSettings] = useState<VolumeEntry | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [dirRulesOpen, setDirRulesOpen] = useState(false);

  const activeChapterKey = selection ? `${selection.volume}/${selection.chapter}` : '';

  // 当前话自动展开
  const expanded = useMemo(() => {
    const base = { ...open };
    if (activeChapterKey) base[activeChapterKey] = base[activeChapterKey] ?? true;
    return base;
  }, [open, activeChapterKey]);

  if (!library) {
    return (
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">KomaYomi</div>
          <div className="root-path">{t('sidebar.loadingLibrary')}</div>
        </div>
      </aside>
    );
  }

  if (!library.volumes.length) {
    return (
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">KomaYomi</div>
        </div>
        <div className="sidebar-empty">
          {t('sidebar.emptyNoVolumesBefore')}
          <code>{rootPath || 'raw'}</code>
          {t('sidebar.emptyNoVolumesAfter')}
          <br />
          {t('sidebar.emptyHintBefore')}
          <code>{t('sidebar.emptyHintExample')}</code>
          {t('sidebar.emptyHintAfter')}
          <button type="button" className="btn primary block" onClick={() => setAddOpen(true)}>
            {t('sidebar.addManga')}
          </button>
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

  const renderChapter = (volumeId: string, chapter: ChapterEntry) => {
    const key = `${volumeId}/${chapter.chapter}`;
    const isOpen = expanded[key];
    const pageWarnings = chapter.pages.reduce((n, p) => n + p.warnings.length, 0);
    const annotated = chapter.pages.filter((p) => p.annotated).length;

    return (
      <div className="chapter" key={key}>
        <button
          type="button"
          className={`chapter-row ${selection?.volume === volumeId && selection.chapter === chapter.chapter ? 'active' : ''}`}
          onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
        >
          <span className={`chev ${isOpen ? 'open' : ''}`}>▸</span>
          <span className="ch-name">
            {chapter.chapter === SINGLE_CHAPTER
              ? t('sidebar.singleChapter')
              : t('format.chapter', { chapter: chapter.chapter })}
          </span>
          <span className="ch-meta">
            {annotated > 0 && <span className="chip-mini ok">{formatNumber(annotated)}</span>}
            {pageWarnings > 0 && (
              <span className="chip-mini warn" title={chapter.pages.flatMap((p) => p.warnings).join('\n')}>
                !
              </span>
            )}
            <span className="ch-count">{chapter.pages.length}p</span>
          </span>
        </button>

        {isOpen && (
          <>
            {chapter.warnings.map((w) => (
              <div className="warn-line" key={w}>
                {w}
              </div>
            ))}
            <div className="page-grid">
              {chapter.pages.map((page) => {
                const file = pickFile(page);
                const active =
                  selection?.volume === volumeId &&
                  selection.chapter === chapter.chapter &&
                  selection.pageIndex === page.index;
                return (
                  <button
                    type="button"
                    key={page.index}
                    className={`thumb ${active ? 'active' : ''} ${file ? '' : 'missing'}`}
                    title={`${t('format.page', { page: formatNumber(page.index + 1) })}${
                      page.warnings.length ? '\n' + page.warnings.join('\n') : ''
                    }`}
                    onClick={() => onOpen({ volume: volumeId, chapter: chapter.chapter, pageIndex: page.index })}
                  >
                    {file ? (
                      <img
                        src={thumbUrl(file.url, 200)}
                        alt={t('format.page', { page: formatNumber(page.index + 1) })}
                        loading="lazy"
                      />
                    ) : (
                      <span>{t('sidebar.missingImage')}</span>
                    )}
                    <em>{formatNumber(page.index + 1)}</em>
                    {page.warnings.length > 0 && <i className="thumb-warn">!</i>}
                    {page.annotated && <i className="thumb-dot" />}
                    {file && <b className="thumb-lang">{LANG_SHORT[file.lang]}</b>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          KomaYomi
          <span className="brand-sub">Manga Learner</span>
        </div>
        <div className="root-path" title={rootPath}>
          {t('format.volumesChapters', {
            volumes: formatNumber(library.volumes.length),
            chapters: formatNumber(library.volumes.reduce((n, v) => n + v.chapters.length, 0)),
          })}
          <button
            type="button"
            className="btn tiny add-volume-btn"
            onClick={() => setAddOpen(true)}
            title={t('sidebar.addMangaTitle')}
          >
            {t('sidebar.addMangaShort')}
          </button>
        </div>
      </div>
      <div className="sidebar-scroll">
        {library.volumes.map((volume) => (
          <div className="volume" key={volume.id}>
            <div className="volume-title">
              <span>{volume.title}</span>
              <span className="volume-langs">
                {volume.languages.map((l) => LANG_SHORT[l]).join(' · ') || t('sidebar.langsUnconfigured')}
              </span>
              <button
                type="button"
                className="icon-btn volume-gear"
                title={t('sidebar.volumeSettingsTitle')}
                onClick={() => setSettings(volume)}
              >
                ⚙
              </button>
              {volume.warnings.map((w) => (
                <em key={w}>{w}</em>
              ))}
            </div>
            {volume.chapters.map((chapter) => renderChapter(volume.id, chapter))}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <span>{t('sidebar.rawReadOnly')}</span>
        <span className="sidebar-foot-actions">
          <button
            type="button"
            className="btn tiny"
            onClick={() => setProjectOpen(true)}
            title={t('sidebar.projectFileTitle')}
          >
            {t('sidebar.projectFile')}
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() => setExchangeOpen(true)}
            title={t('sidebar.exchangeTitle')}
          >
            {t('sidebar.exchange')}
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() => setDirRulesOpen(true)}
            title={t('sidebar.dirRulesTitle')}
          >
            {t('sidebar.dirRules')}
          </button>
          <button type="button" className="btn tiny" onClick={() => setDataOpen(true)} title={t('sidebar.backupTitle')}>
            {t('sidebar.backup')}
          </button>
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
          onClose={() => setSettings(null)}
          onDone={(lib) => {
            onReload(lib);
            setSettings(null);
          }}
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
    </aside>
  );
}
