import { useMemo, useState } from 'react';
import type { Library, VolumeEntry } from '../types';
import { SINGLE_CHAPTER } from '../types';
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

type ChapterDraft = { title: string };

/** Editor for one volume; remounted with `key` so switching volumes resets the local drafts. */
function PreprocessEditor({ volume, onDone }: { volume: VolumeEntry; onDone: (library: Library) => void }) {
  const { t, formatNumber } = useI18n();
  const [title, setTitle] = useState(() => (volume.title === volume.id ? '' : volume.title));
  const [chapters, setChapters] = useState<Record<string, ChapterDraft>>(() => {
    const draft: Record<string, ChapterDraft> = {};
    for (const chapter of volume.chapters) draft[chapter.chapter] = { title: chapter.title ?? '' };
    return draft;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const apply = async () => {
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      const res = await api.applyPreprocess({
        volume: volume.id,
        title,
        chapters: Object.fromEntries(
          Object.entries(chapters).map(([chapter, draft]) => [chapter, { title: draft.title }]),
        ),
      });
      onDone(res.library);
      setStatus(t('preprocess.applied'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const chapterName = (chapter: string) =>
    chapter === SINGLE_CHAPTER ? t('sidebar.singleChapter') : t('format.chapter', { chapter });

  return (
    <>
      <div className="modal-body preprocess-body">
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
          <div className="preprocess-dirs">
            {volume.dirs.map((dir) => {
              const lang = Object.entries(volume.langDirs).find(([, value]) => value === dir)?.[0];
              return (
                <span className="preprocess-dir" key={dir}>
                  <code>{dir}</code>
                  <span>{lang ? langLabel(lang) : '—'}</span>
                </span>
              );
            })}
          </div>
        </section>

        {volume.chapters.map((chapter) => {
          const draft = chapters[chapter.chapter] ?? { title: '' };
          return (
            <section className="preprocess-section" key={chapter.id}>
              <h3>
                {draft.title.trim() || chapterName(chapter.chapter)}
                <em>
                  {t('preprocess.pages')} · {formatNumber(chapter.pages.length)}
                </em>
              </h3>
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
              <div className="preprocess-pages">
                {chapter.pages.map((page, position) => {
                  const file = firstFile(volume, page.files);
                  return (
                    <figure className={`preprocess-page ${page.excluded ? 'excluded' : ''}`} key={page.index}>
                      {file ? (
                        <img src={thumbUrl(file, 160)} alt="" loading="lazy" />
                      ) : (
                        <div className="preprocess-thumb-missing">{t('sidebar.missingImage')}</div>
                      )}
                      <figcaption>
                        <span>{formatNumber(position + 1)}</span>
                        {page.excluded && <em>{t('preprocess.excluded')}</em>}
                      </figcaption>
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
        <button type="button" className="btn primary" disabled={busy} onClick={() => void apply()}>
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
  const volume = useMemo(() => library.volumes.find((v) => v.id === volumeId) ?? null, [library, volumeId]);

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
        {!library.volumes.length ? (
          <div className="modal-body">
            <div className="banner info">{t('preprocess.noVolumes')}</div>
          </div>
        ) : (
          <>
            <div className="preprocess-toolbar">
              <label className="field">
                <span>{t('preprocess.volume')}</span>
                <select value={volumeId} onChange={(e) => setVolumeId(e.target.value)}>
                  {library.volumes.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {volume && <PreprocessEditor key={volume.id} volume={volume} onDone={onDone} />}
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
