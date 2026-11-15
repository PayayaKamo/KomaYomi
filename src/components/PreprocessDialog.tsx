import { useEffect, useMemo, useState } from 'react';
import type { Library, PageEntry, PageKind, VolumeEntry } from '../types';
import { PAGE_KINDS, SINGLE_CHAPTER } from '../types';
import { langLabel, useI18n } from '../i18n';
import { api, thumbUrl } from '../api';

type Props = {
  library: Library;
  /** Volume selected in the sidebar; the wizard opens on it. */
  initialVolume?: string;
  onClose: () => void;
  onDone: (library: Library) => void;
};

const firstFile = (volume: VolumeEntry, files: Partial<Record<string, string>>) => {
  for (const lang of volume.languages) {
    if (files[lang]) return files[lang];
  }
  return Object.values(files)[0];
};

type ChapterDraft = {
  title: string;
  /** Page document indices in reading order (only reordered by the page-order step). */
  order: number[];
  excluded: number[];
  kinds: Record<string, PageKind>;
};

const KIND_KEYS = {
  cover: 'preprocess.kindCover',
  toc: 'preprocess.kindToc',
  author: 'preprocess.kindAuthor',
  ad: 'preprocess.kindAd',
  recruit: 'preprocess.kindRecruit',
} as const;

/** Editor for one volume; remounted with `key` so switching volumes resets the local drafts. */
function PreprocessEditor({
  volume,
  backup,
  onBackupChange,
  onRestored,
  onDone,
  onFilesChanged,
}: {
  volume: VolumeEntry;
  backup: { at: string; volume: string } | null;
  onBackupChange: (backup: { at: string; volume: string } | null) => void;
  onRestored: () => void;
  onDone: (library: Library) => void;
  onFilesChanged: (library: Library, notice: string) => void;
}) {
  const { t, formatNumber } = useI18n();
  const [title, setTitle] = useState(() => (volume.title === volume.id ? '' : volume.title));
  const [chapters, setChapters] = useState<Record<string, ChapterDraft>>(() => {
    const draft: Record<string, ChapterDraft> = {};
    for (const chapter of volume.chapters) {
      const kinds: Record<string, PageKind> = {};
      for (const page of chapter.pages) if (page.kind) kinds[String(page.index)] = page.kind;
      draft[chapter.chapter] = {
        title: chapter.title ?? '',
        order: chapter.pages.map((page) => page.index),
        excluded: chapter.pages.filter((page) => page.excluded).map((page) => page.index),
        kinds,
      };
    }
    return draft;
  });
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  // File operations (rename/split) run outside the apply flow and report through the parent.
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [renamePrefix, setRenamePrefix] = useState('');
  const [renameStart, setRenameStart] = useState('1');
  const [renamePadding, setRenamePadding] = useState('3');
  // `${chapter}:${pageIndex}` of the page whose split form is open.
  const [splitTarget, setSplitTarget] = useState<string | null>(null);
  const [splitAxis, setSplitAxis] = useState<'vertical' | 'horizontal'>('vertical');
  const [splitRatio, setSplitRatio] = useState('50');
  // Folder name -> language id; an empty value means "detect from the folder name".
  const [dirLangs, setDirLangs] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const dir of volume.dirs) {
      out[dir] = Object.entries(volume.langDirs).find(([, value]) => value === dir)?.[0] ?? '';
    }
    return out;
  });

  const langOptions = useMemo(() => {
    const set = new Set<string>(volume.languages);
    for (const lang of Object.values(dirLangs)) if (lang.trim()) set.add(lang.trim());
    return [...set].sort();
  }, [volume.languages, dirLangs]);

  const duplicateLang = useMemo(() => {
    const seen = new Set<string>();
    for (const dir of volume.dirs) {
      const lang = dirLangs[dir]?.trim();
      if (!lang) continue;
      if (seen.has(lang)) return lang;
      seen.add(lang);
    }
    return '';
  }, [volume.dirs, dirLangs]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      const dirs: Partial<Record<string, string>> = {};
      for (const dir of volume.dirs) {
        const lang = dirLangs[dir]?.trim();
        if (lang) dirs[lang] = dir;
      }
      const res = await api.applyPreprocess({
        volume: volume.id,
        title,
        dirs,
        chapters: Object.fromEntries(
          Object.entries(chapters).map(([chapter, draft]) => [
            chapter,
            { title: draft.title, order: draft.order, excluded: draft.excluded, kinds: draft.kinds },
          ]),
        ),
      });
      onDone(res.library);
      onBackupChange({ at: res.backupAt, volume: volume.id });
      setStatus(t('preprocess.applied'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** One-shot undo of the last apply for this volume. */
  const restore = async () => {
    setRestoring(true);
    setError(null);
    setStatus('');
    try {
      const res = await api.restorePreprocess(volume.id);
      onBackupChange(null);
      onDone(res.library);
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  };

  const chapterName = (chapter: string) =>
    chapter === SINGLE_CHAPTER ? t('sidebar.singleChapter') : t('format.chapter', { chapter });

  /** Renames the chapter's image files in the current draft order (all complete languages). */
  const renameFiles = async (chapter: string) => {
    setFileBusy('rename');
    setError(null);
    setStatus('');
    try {
      const draft = chapters[chapter];
      const res = await api.renameChapterFiles({
        volume: volume.id,
        chapter,
        prefix: renamePrefix.trim(),
        start: Number(renameStart),
        padding: Number(renamePadding),
        order: draft?.order,
      });
      let message = t('preprocess.renamed', {
        files: formatNumber(res.files),
        docs: formatNumber(res.docs),
      });
      if (res.skipped.length) {
        message += ` ${t('preprocess.renameSkipped', { langs: res.skipped.map((lang) => langLabel(lang)).join(', ') })}`;
      }
      onFilesChanged(res.library, message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileBusy(null);
    }
  };

  /** Splits one page at a normalized position and inserts the second half as the next page. */
  const splitPage = async (chapter: string, pageIndex: number) => {
    setFileBusy('split');
    setError(null);
    setStatus('');
    try {
      const ratio = Math.min(90, Math.max(10, Number(splitRatio))) / 100;
      const res = await api.splitPage({ volume: volume.id, chapter, pageIndex, axis: splitAxis, ratio });
      onFilesChanged(
        res.library,
        t('preprocess.splitDone', {
          page: formatNumber(pageIndex + 1),
          next: formatNumber(pageIndex + 2),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileBusy(null);
    }
  };

  /** Swaps a page with its neighbour in the draft order. */
  const movePage = (chapter: string, from: number, delta: number) => {
    setChapters((prev) => {
      const draft = prev[chapter];
      if (!draft) return prev;
      const to = from + delta;
      if (to < 0 || to >= draft.order.length) return prev;
      const order = [...draft.order];
      [order[from], order[to]] = [order[to], order[from]];
      return { ...prev, [chapter]: { ...draft, order } };
    });
  };

  return (
    <>
      <div className="modal-body preprocess-body">
        {backup?.volume === volume.id && (
          <div className="banner info preprocess-backup">
            <span>{t('preprocess.backupAvailable')}</span>
            <button type="button" className="btn" disabled={restoring || busy} onClick={() => void restore()}>
              {restoring ? t('preprocess.restoring') : t('preprocess.restore')}
            </button>
          </div>
        )}
        <div className="preprocess-grid">
          <label className="field">
            <span>{t('preprocess.volumeTitle')}</span>
            <input
              value={title}
              placeholder={t('preprocess.volumeTitlePlaceholder')}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>

        <section className="preprocess-section">
          <h3>{t('preprocess.languageDirs')}</h3>
          <p className="preprocess-hint">{t('preprocess.dirsHint')}</p>
          <div className="preprocess-dirs">
            <datalist id="preprocess-lang-options">
              {langOptions.map((lang) => (
                <option key={lang} value={lang}>
                  {langLabel(lang)}
                </option>
              ))}
            </datalist>
            {volume.dirs.map((dir) => (
              <label className="preprocess-dir" key={dir} title={dir}>
                <code>{dir}</code>
                <input
                  value={dirLangs[dir] ?? ''}
                  list="preprocess-lang-options"
                  placeholder={t('preprocess.languagePlaceholder')}
                  aria-label={t('preprocess.languageForDir', { dir })}
                  maxLength={40}
                  onChange={(e) => setDirLangs((prev) => ({ ...prev, [dir]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {duplicateLang && (
            <div className="banner error">{t('preprocess.duplicateLanguage', { lang: duplicateLang })}</div>
          )}
        </section>

        {volume.chapters.map((chapter) => {
          const draft: ChapterDraft = chapters[chapter.chapter] ?? {
            title: '',
            order: chapter.pages.map((page) => page.index),
            excluded: [],
            kinds: {},
          };
          const byIndex = new Map(chapter.pages.map((page) => [page.index, page]));
          const orderedPages = draft.order
            .map((index) => byIndex.get(index))
            .filter((page): page is PageEntry => Boolean(page));
          return (
            <section className="preprocess-section" key={chapter.id}>
              <h3>
                {draft.title.trim() || chapterName(chapter.chapter)}
                <em>
                  {t('preprocess.pages')} · {formatNumber(orderedPages.length)}
                </em>
              </h3>
              <p className="preprocess-hint">{t('preprocess.orderHint')}</p>
              <label className="field preprocess-chapter-title">
                <span>{t('preprocess.chapterTitle')}</span>
                <input
                  value={draft.title}
                  placeholder={t('preprocess.chapterTitlePlaceholder')}
                  maxLength={200}
                  onChange={(e) =>
                    setChapters((prev) => ({ ...prev, [chapter.chapter]: { ...draft, title: e.target.value } }))
                  }
                />
              </label>
              <details className="preprocess-file-tools">
                <summary>{t('preprocess.filesTitle')}</summary>
                <p className="preprocess-hint">{t('preprocess.renameHint')}</p>
                <div className="preprocess-grid">
                  <label className="field">
                    <span>{t('preprocess.renamePrefix')}</span>
                    <input
                      value={renamePrefix}
                      maxLength={40}
                      placeholder={t('preprocess.renamePrefixPlaceholder')}
                      onChange={(e) => setRenamePrefix(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t('preprocess.renameStart')}</span>
                    <input
                      type="number"
                      min={1}
                      max={999999}
                      value={renameStart}
                      onChange={(e) => setRenameStart(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t('preprocess.renamePadding')}</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={renamePadding}
                      onChange={(e) => setRenamePadding(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={fileBusy !== null || busy}
                  onClick={() => void renameFiles(chapter.chapter)}
                >
                  {fileBusy === 'rename' ? t('preprocess.renaming') : t('preprocess.renameAction')}
                </button>
              </details>
              <div className="preprocess-pages">
                {orderedPages.map((page, position) => {
                  const file = firstFile(volume, page.files);
                  const key = String(page.index);
                  const kind = draft.kinds[key];
                  const excluded = draft.excluded.includes(page.index);
                  const splitKey = `${chapter.chapter}:${page.index}`;
                  const splitting = splitTarget === splitKey;
                  return (
                    <figure className={`preprocess-page ${excluded ? 'excluded' : ''}`} key={page.index}>
                      {file ? (
                        <img src={thumbUrl(file, 160)} alt="" loading="lazy" />
                      ) : (
                        <div className="preprocess-thumb-missing">{t('sidebar.missingImage')}</div>
                      )}
                      <figcaption>
                        <span>{formatNumber(position + 1)}</span>
                        {kind && <b className="preprocess-kind">{t(KIND_KEYS[kind])}</b>}
                        {excluded && <em>{t('preprocess.excluded')}</em>}
                      </figcaption>
                      <div className="preprocess-page-actions">
                        <div className="preprocess-order">
                          <button
                            type="button"
                            className="preprocess-move"
                            disabled={position === 0}
                            title={t('preprocess.moveEarlier')}
                            aria-label={t('preprocess.moveEarlier')}
                            onClick={() => movePage(chapter.chapter, position, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="preprocess-move"
                            disabled={position === orderedPages.length - 1}
                            title={t('preprocess.moveLater')}
                            aria-label={t('preprocess.moveLater')}
                            onClick={() => movePage(chapter.chapter, position, 1)}
                          >
                            ↓
                          </button>
                        </div>
                        <label title={t('preprocess.exclude')}>
                          <input
                            type="checkbox"
                            checked={excluded}
                            onChange={(e) =>
                              setChapters((prev) => ({
                                ...prev,
                                [chapter.chapter]: {
                                  ...draft,
                                  excluded: e.target.checked
                                    ? [...draft.excluded, page.index]
                                    : draft.excluded.filter((index) => index !== page.index),
                                },
                              }))
                            }
                          />
                          {t('preprocess.exclude')}
                        </label>
                        <select
                          value={kind ?? ''}
                          aria-label={t('preprocess.pageKind')}
                          onChange={(e) => {
                            const value = e.target.value as PageKind | '';
                            const kinds = { ...draft.kinds };
                            if (value) kinds[key] = value;
                            else delete kinds[key];
                            setChapters((prev) => ({ ...prev, [chapter.chapter]: { ...draft, kinds } }));
                          }}
                        >
                          <option value="">{t('preprocess.kindNone')}</option>
                          {PAGE_KINDS.map((value) => (
                            <option key={value} value={value}>
                              {t(KIND_KEYS[value])}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="preprocess-split-toggle"
                          disabled={!file || fileBusy !== null}
                          aria-expanded={splitting}
                          onClick={() => setSplitTarget(splitting ? null : splitKey)}
                        >
                          {t('preprocess.splitAction')}
                        </button>
                      </div>
                      {splitting && (
                        <div className="preprocess-split">
                          <label className="field">
                            <span>{t('preprocess.splitAxis')}</span>
                            <select
                              value={splitAxis}
                              onChange={(e) => setSplitAxis(e.target.value as 'vertical' | 'horizontal')}
                            >
                              <option value="vertical">{t('preprocess.splitVertical')}</option>
                              <option value="horizontal">{t('preprocess.splitHorizontal')}</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>{t('preprocess.splitPosition')}</span>
                            <input
                              type="number"
                              min={10}
                              max={90}
                              step={1}
                              value={splitRatio}
                              onChange={(e) => setSplitRatio(e.target.value)}
                            />
                          </label>
                          <div className="preprocess-split-actions">
                            <button
                              type="button"
                              className="btn primary"
                              disabled={fileBusy !== null}
                              onClick={() => void splitPage(chapter.chapter, page.index)}
                            >
                              {fileBusy === 'split' ? t('preprocess.splitting') : t('preprocess.splitConfirm')}
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={fileBusy !== null}
                              onClick={() => setSplitTarget(null)}
                            >
                              {t('preprocess.splitCancel')}
                            </button>
                          </div>
                          <p className="preprocess-hint">{t('preprocess.splitHint')}</p>
                        </div>
                      )}
                    </figure>
                  );
                })}
              </div>
            </section>
          );
        })}

        {error && <div className="banner error">{error}</div>}
        {status && <div className="banner info">{status}</div>}
      </div>
      <footer className="modal-foot">
        <span className="spacer" />
        <button
          type="button"
          className="btn primary"
          disabled={busy || Boolean(duplicateLang)}
          onClick={() => void apply()}
        >
          {busy ? t('preprocess.applying') : t('preprocess.apply')}
        </button>
      </footer>
    </>
  );
}

/**
 * Preprocessing wizard: pick a volume, then edit its titles, page order, exclusions and folders.
 */
export function PreprocessDialog({ library, initialVolume, onClose, onDone }: Props) {
  const { t } = useI18n();
  const [volumeId, setVolumeId] = useState(() => initialVolume ?? library.volumes[0]?.id ?? '');
  const [backup, setBackup] = useState<{ at: string; volume: string } | null>(null);
  const [notice, setNotice] = useState('');
  // Latest library returned by apply/restore, so the editor sees it before the parent reload lands.
  const [localLibrary, setLocalLibrary] = useState<Library | null>(null);
  // Bumped after a restore so the editor remounts with the rolled-back config.
  const [revision, setRevision] = useState(0);
  const source = localLibrary ?? library;
  const volume = useMemo(() => source.volumes.find((v) => v.id === volumeId) ?? null, [source, volumeId]);

  useEffect(() => {
    let alive = true;
    api
      .preprocessBackup()
      .then((res) => {
        if (alive) setBackup(res.backup);
      })
      .catch(() => {
        /* the wizard still works without the backup hint */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header className="modal-head">
          <div>
            <h2>{t('preprocess.title')}</h2>
            <p>{t('preprocess.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        {!source.volumes.length ? (
          <div className="modal-body">
            <div className="banner info">{t('preprocess.noVolumes')}</div>
          </div>
        ) : (
          <>
            <div className="preprocess-toolbar">
              <label className="field">
                <span>{t('preprocess.volume')}</span>
                <select
                  value={volumeId}
                  onChange={(e) => {
                    setVolumeId(e.target.value);
                    setNotice('');
                  }}
                >
                  {source.volumes.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {notice && <div className="banner info preprocess-notice">{notice}</div>}
            {volume && (
              <PreprocessEditor
                key={`${volume.id}:${revision}`}
                volume={volume}
                backup={backup}
                onBackupChange={setBackup}
                onRestored={() => {
                  setRevision((n) => n + 1);
                  setNotice(t('preprocess.restored'));
                }}
                onDone={(lib) => {
                  setLocalLibrary(lib);
                  onDone(lib);
                }}
                onFilesChanged={(lib, message) => {
                  setLocalLibrary(lib);
                  onDone(lib);
                  setRevision((n) => n + 1);
                  setNotice(message);
                }}
              />
            )}
          </>
        )}
        <footer className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('preprocess.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
