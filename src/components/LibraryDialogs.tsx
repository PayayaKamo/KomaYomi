import { useMemo, useState } from 'react';
import type { Lang, Library, VolumeEntry } from '../types';
import { DEFAULT_LANGUAGES } from '../types';
import { api } from '../api';
import { langLabel, useI18n } from '../i18n';
import { enqueueOutbox } from '../lib/outbox';

type AddProps = {
  onClose: () => void;
  onDone: (library: Library) => void;
  /** Pre-filled folder path, used by the File → Open library action. */
  initialPath?: string;
};

/** Add manga: pick a local folder (desktop) or type a path; an empty directory under raw works too. */
export function AddVolumeDialog({ onClose, onDone, initialPath = '' }: AddProps) {
  const { t } = useI18n();
  const [pathValue, setPathValue] = useState(initialPath);
  const [name, setName] = useState(() => initialPath.split(/[\\/]/).filter(Boolean).pop() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);

  const pick = async () => {
    if (!window.mangaDesktop) {
      setError(t('addVolume.browserNoPicker'));
      return;
    }
    const dir = await window.mangaDesktop.pickFolder(t('addVolume.pickFolderTitle'));
    if (dir) {
      setPathValue(dir);
      if (!name) setName(dir.split(/[\\/]/).filter(Boolean).pop() ?? '');
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    setAdded([]);
    try {
      const res = await api.addVolume({ sourcePath: pathValue.trim() || undefined, name: name.trim() || undefined });
      setAdded(res.added);
      setWarnings(res.warnings);
      onDone(res.library);
      if (!res.warnings.length) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>{t('addVolume.title')}</h2>
            <p>{t('addVolume.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>{t('addVolume.folderPath')}</span>
            <div className="row-inline">
              <input
                value={pathValue}
                placeholder={t('addVolume.pathPlaceholder')}
                onChange={(e) => setPathValue(e.target.value)}
              />
              <button type="button" className="btn" onClick={() => void pick()}>
                {t('addVolume.chooseFolder')}
              </button>
            </div>
          </label>
          <label className="field">
            <span>{t('addVolume.nameLabel')}</span>
            <input
              value={name}
              placeholder={t('addVolume.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="field-hint">{t('addVolume.hint')}</p>
          {error && <div className="banner error">{error}</div>}
          {added.length > 0 && (
            <div className="banner info">{t('addVolume.added', { names: added.join(t('common.listSeparator')) })}</div>
          )}
          {warnings.map((w) => (
            <div className="banner info" key={w}>
              {w}
            </div>
          ))}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? t('addVolume.processing') : t('addVolume.add')}
          </button>
        </footer>
      </div>
    </div>
  );
}

type SettingsProps = {
  volume: VolumeEntry;
  onClose: () => void;
  /** Refresh the library and close the dialog (used after the series itself is removed). */
  onDone: (library: Library) => void;
  /** Refresh the library without closing the dialog (used for chapter unlinking). */
  onLibrary?: (library: Library) => void;
};

/** Volume settings: map actual directories under the volume to languages; 1–2 languages is fine. */
export function VolumeSettingsDialog({ volume, onClose, onDone, onLibrary }: SettingsProps) {
  const { t } = useI18n();
  // Detected languages first, then the built-in defaults for folders that have no mapping yet.
  const langs = useMemo(() => {
    const out = [...volume.languages];
    for (const lang of [...DEFAULT_LANGUAGES, ...Object.keys(volume.langDirs)]) {
      if (!out.includes(lang)) out.push(lang);
    }
    return out;
  }, [volume]);
  const [choice, setChoice] = useState<Record<Lang, string>>(() => {
    const init: Record<Lang, string> = {};
    for (const [lang, dir] of Object.entries(volume.langDirs)) if (dir) init[lang] = dir;
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [pendingChapter, setPendingChapter] = useState<string | null>(null);
  const [chapterBusy, setChapterBusy] = useState<string | null>(null);
  const [offsetChapter, setOffsetChapter] = useState<string | null>(null);
  const [offsetDraft, setOffsetDraft] = useState<Record<Lang, { from: string; to: string }>>({});
  const [offsetBusy, setOffsetBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = useMemo(() => new Set(Object.values(choice).filter(Boolean)), [choice]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const dirs: Partial<Record<Lang, string | null>> = {};
    for (const lang of langs) dirs[lang] = choice[lang] || null;
    try {
      const res = await api.saveVolumeDirs(volume.id, dirs);
      onDone(res.library);
      onClose();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Keep the mapping instead of losing it: replay applies it once the server is back.
      const queued = enqueueOutbox({ kind: 'volumeDirs', volume: volume.id, dirs });
      setError(queued ? t('outbox.queuedOp', { detail }) : detail);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.removeVolume(volume.id, { deleteFiles });
      onDone(res.library);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Languages present in a chapter, in the configured order, with their page counts. */
  const chapterLangs = (chapter: (typeof volume.chapters)[number]) => {
    const counts = new Map<Lang, number>();
    for (const page of chapter.pages) {
      for (const lang of Object.keys(page.filenames) as Lang[]) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    const ordered = langs.filter((lang) => counts.has(lang));
    for (const lang of counts.keys()) if (!ordered.includes(lang)) ordered.push(lang);
    return ordered.map((lang) => ({ lang, count: counts.get(lang) ?? 0 }));
  };

  const openPageOffsets = (chapter: (typeof volume.chapters)[number]) => {
    if (offsetChapter === chapter.chapter) {
      setOffsetChapter(null);
      return;
    }
    const draft: Record<Lang, { from: string; to: string }> = {};
    for (const { lang } of chapterLangs(chapter)) {
      const offset = chapter.pageOffsets?.[lang];
      draft[lang] = { from: offset ? String(offset.from) : '', to: offset ? String(offset.to) : '' };
    }
    setOffsetDraft(draft);
    setOffsetChapter(chapter.chapter);
    setError(null);
  };

  const savePageOffsets = async () => {
    const chapter = volume.chapters.find((c) => c.chapter === offsetChapter);
    if (!chapter) return;
    const payload: Partial<Record<Lang, { from: number; to: number } | null>> = {};
    for (const { lang } of chapterLangs(chapter)) {
      const from = offsetDraft[lang]?.from.trim() ?? '';
      const to = offsetDraft[lang]?.to.trim() ?? '';
      if (!from && !to) {
        payload[lang] = null;
        continue;
      }
      payload[lang] = { from: Number(from), to: Number(to) };
    }
    setOffsetBusy(true);
    setError(null);
    try {
      const res = await api.saveChapterPageOffsets(volume.id, chapter.chapter, payload);
      (onLibrary ?? onDone)(res.library);
      setOffsetChapter(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOffsetBusy(false);
    }
  };

  const toggleChapter = async (chapter: string, hidden: boolean) => {
    setChapterBusy(chapter);
    setError(null);
    try {
      const res = await api.removeChapter(volume.id, chapter, hidden);
      (onLibrary ?? onDone)(res.library);
      setPendingChapter(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChapterBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>{t('volumeSettings.title', { title: volume.title })}</h2>
            <p>{t('volumeSettings.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          {langs.map((lang) => {
            const candidates = volume.dirs.filter((d) => d === choice[lang] || !used.has(d));
            return (
              <label className="field" key={lang}>
                <span>{langLabel(lang)}</span>
                <select value={choice[lang]} onChange={(e) => setChoice({ ...choice, [lang]: e.target.value })}>
                  <option value="">{t('volumeSettings.autoOption')}</option>
                  {candidates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {!volume.languages.length && <div className="banner info">{t('volumeSettings.noLangs')}</div>}
          {volume.warnings.map((w) => (
            <div className="banner info" key={w}>
              {w}
            </div>
          ))}

          <div className="volume-chapters">
            <strong>{t('volumeSettings.chapters')}</strong>
            <p className="muted tiny">{t('volumeSettings.chaptersHint')}</p>
            <ul className="volume-chapter-list">
              {volume.chapters.map((chapter) => {
                const label = chapter.title || chapter.chapter;
                return (
                  <li key={chapter.id}>
                    <span className="volume-chapter-name" title={label}>
                      {label}
                    </span>
                    <button
                      type="button"
                      className="btn tiny"
                      disabled={chapterBusy !== null}
                      onClick={() => openPageOffsets(chapter)}
                    >
                      {t('volumeSettings.pageOffset')}
                    </button>
                    <button
                      type="button"
                      className="btn tiny"
                      disabled={chapterBusy !== null}
                      onClick={() => setPendingChapter(chapter.chapter)}
                    >
                      {t('volumeSettings.removeChapter')}
                    </button>
                  </li>
                );
              })}
            </ul>
            {offsetChapter &&
              (() => {
                const chapter = volume.chapters.find((c) => c.chapter === offsetChapter);
                if (!chapter) return null;
                return (
                  <div className="page-offset-editor">
                    <strong>
                      {t('volumeSettings.pageOffsetTitle', { chapter: chapter.title || chapter.chapter })}
                    </strong>
                    <p className="muted tiny">{t('volumeSettings.pageOffsetHint')}</p>
                    {chapterLangs(chapter).map(({ lang, count }) => (
                      <div className="page-offset-row" key={lang}>
                        <span className="page-offset-lang">
                          {langLabel(lang)}{' '}
                          <span className="muted tiny">{t('volumeSettings.pageOffsetCount', { count })}</span>
                        </span>
                        <input
                          inputMode="numeric"
                          value={offsetDraft[lang]?.from ?? ''}
                          placeholder={t('volumeSettings.pageOffsetFrom')}
                          onChange={(e) =>
                            setOffsetDraft((d) => ({
                              ...d,
                              [lang]: { from: e.target.value, to: d[lang]?.to ?? '' },
                            }))
                          }
                        />
                        <span className="page-offset-arrow">→</span>
                        <input
                          inputMode="numeric"
                          value={offsetDraft[lang]?.to ?? ''}
                          placeholder={t('volumeSettings.pageOffsetTo')}
                          onChange={(e) =>
                            setOffsetDraft((d) => ({
                              ...d,
                              [lang]: { from: d[lang]?.from ?? '', to: e.target.value },
                            }))
                          }
                        />
                      </div>
                    ))}
                    <div className="volume-confirm-actions">
                      <button
                        type="button"
                        className="btn tiny"
                        disabled={offsetBusy}
                        onClick={() => setOffsetChapter(null)}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn tiny primary"
                        disabled={offsetBusy}
                        onClick={() => void savePageOffsets()}
                      >
                        {offsetBusy ? t('volumeSettings.saving') : t('common.save')}
                      </button>
                    </div>
                  </div>
                );
              })()}
            {!!volume.hiddenChapters?.length && (
              <>
                <strong>{t('volumeSettings.hiddenChapters')}</strong>
                <p className="muted tiny">{t('volumeSettings.hiddenChaptersHint')}</p>
                <ul className="volume-chapter-list">
                  {volume.hiddenChapters.map((chapter) => (
                    <li key={chapter}>
                      <span className="volume-chapter-name" title={chapter}>
                        {chapter}
                      </span>
                      <button
                        type="button"
                        className="btn tiny"
                        disabled={chapterBusy !== null}
                        onClick={() => void toggleChapter(chapter, false)}
                      >
                        {chapterBusy === chapter ? t('volumeSettings.restoring') : t('volumeSettings.restoreChapter')}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {pendingChapter && (
            <div className="banner warn volume-confirm">
              <p>{t('volumeSettings.chapterRemoveConfirm', { chapter: pendingChapter })}</p>
              <div className="volume-confirm-actions">
                <button
                  type="button"
                  className="btn tiny"
                  disabled={chapterBusy !== null}
                  onClick={() => setPendingChapter(null)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn tiny danger"
                  disabled={chapterBusy !== null}
                  onClick={() => void toggleChapter(pendingChapter, true)}
                >
                  {chapterBusy === pendingChapter ? t('volumeSettings.removing') : t('volumeSettings.removeChapter')}
                </button>
              </div>
            </div>
          )}

          {removing && (
            <div className="banner warn volume-confirm">
              <p>{t('volumeSettings.removeConfirm', { title: volume.title })}</p>
              <label className="volume-delete-files">
                <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
                <span>{t('volumeSettings.removeDeleteFiles')}</span>
              </label>
              <p className="muted tiny">{t('volumeSettings.removeDeleteFilesHint')}</p>
              <div className="volume-confirm-actions">
                <button type="button" className="btn tiny" disabled={busy} onClick={() => setRemoving(false)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn tiny danger" disabled={busy} onClick={() => void remove()}>
                  {busy ? t('volumeSettings.removing') : t('volumeSettings.remove')}
                </button>
              </div>
            </div>
          )}

          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn danger" disabled={busy} onClick={() => setRemoving(true)}>
            {t('volumeSettings.remove')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy && !removing ? t('volumeSettings.saving') : t('common.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
