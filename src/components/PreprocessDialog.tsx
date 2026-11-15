import { useMemo, useState } from 'react';
import type { Library, VolumeEntry } from '../types';
import { SINGLE_CHAPTER } from '../types';
import { langLabel, useI18n } from '../i18n';
import { thumbUrl } from '../api';

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

/**
 * Preprocessing wizard shell: pick a volume and inspect every page and language folder
 * before the later steps (rename / classify / reorder / map) are enabled.
 */
export function PreprocessDialog({ library, initialVolume, onClose }: Props) {
  const { t, formatNumber } = useI18n();
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
        <div className="modal-body preprocess-body">
          {!library.volumes.length ? (
            <div className="banner info">{t('preprocess.noVolumes')}</div>
          ) : (
            <>
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

              {volume && (
                <>
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

                  {volume.chapters.map((chapter) => (
                    <section className="preprocess-section" key={chapter.id}>
                      <h3>
                        {chapter.title ||
                          (chapter.chapter === SINGLE_CHAPTER
                            ? t('sidebar.singleChapter')
                            : t('format.chapter', { chapter: chapter.chapter }))}
                        <em>
                          {t('preprocess.pages')} · {formatNumber(chapter.pages.length)}
                        </em>
                      </h3>
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
                  ))}
                </>
              )}
            </>
          )}
        </div>
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
