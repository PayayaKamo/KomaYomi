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
  onDone: (library: Library) => void;
};

/** Volume settings: map actual directories under the volume to languages; 1–2 languages is fine. */
export function VolumeSettingsDialog({ volume, onClose, onDone }: SettingsProps) {
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
    if (!window.confirm(t('volumeSettings.removeConfirm', { title: volume.title }))) return;
    setBusy(true);
    try {
      const res = await api.removeVolume(volume.id);
      onDone(res.library);
      onClose();
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
          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
            {t('volumeSettings.remove')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? t('volumeSettings.saving') : t('common.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
