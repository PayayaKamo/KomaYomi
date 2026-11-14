import { useMemo, useState } from 'react';
import type { Lang, Library, VolumeEntry } from '../types';
import { LANGUAGES } from '../types';
import { api } from '../api';
import { langLabel, useI18n } from '../i18n';

type AddProps = {
  onClose: () => void;
  onDone: (library: Library) => void;
};

/** 添加漫画：选择本地文件夹（桌面端）或手动填路径；也可以只在 raw 下建一个空目录 */
export function AddVolumeDialog({ onClose, onDone }: AddProps) {
  const { t } = useI18n();
  const [pathValue, setPathValue] = useState('');
  const [name, setName] = useState('');
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
          <p className="muted tiny">{t('addVolume.hint')}</p>
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

/** 卷设置：把卷下的实际目录指定给某门语言；语言不齐也可以只配 1–2 种 */
export function VolumeSettingsDialog({ volume, onClose, onDone }: SettingsProps) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<Record<Lang, string>>({
    ja: volume.langDirs.ja ?? '',
    zh: volume.langDirs.zh ?? '',
    en: volume.langDirs.en ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = useMemo(() => new Set(Object.values(choice).filter(Boolean)), [choice]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const dirs: Partial<Record<Lang, string | null>> = {};
      for (const lang of LANGUAGES) dirs[lang] = choice[lang] || null;
      const res = await api.saveVolumeDirs(volume.id, dirs);
      onDone(res.library);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          {LANGUAGES.map((lang) => {
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
