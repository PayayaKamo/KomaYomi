import { useMemo, useState } from 'react';
import type { Lang, Library, VolumeEntry } from '../types';
import { LANGUAGES, LANG_LABEL } from '../types';
import { api } from '../api';

type AddProps = {
  onClose: () => void;
  onDone: (library: Library) => void;
};

/** 添加漫画：选择本地文件夹（桌面端）或手动填路径；也可以只在 raw 下建一个空目录 */
export function AddVolumeDialog({ onClose, onDone }: AddProps) {
  const [pathValue, setPathValue] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);

  const pick = async () => {
    if (!window.mangaDesktop) {
      setError('浏览器里无法弹出文件夹选择框，请直接填写文件夹路径；桌面版可点「选择文件夹」');
      return;
    }
    const dir = await window.mangaDesktop.pickFolder('选择漫画文件夹（里面应有 ja/zh/en 等语言目录）');
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
            <h2>添加漫画</h2>
            <p>选择包含语言目录的文件夹，或用 raw 下的新目录</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>文件夹路径</span>
            <div className="row-inline">
              <input
                value={pathValue}
                placeholder="例如 D:\Comics\点兔第15卷（留空则在 raw 下新建空目录）"
                onChange={(e) => setPathValue(e.target.value)}
              />
              <button type="button" className="btn" onClick={() => void pick()}>
                选择文件夹…
              </button>
            </div>
          </label>
          <label className="field">
            <span>图库里的名称（可选）</span>
            <input value={name} placeholder="默认用文件夹名" onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="muted tiny">
            会在 raw 下创建指向该文件夹的目录链接，不复制图片；之后仍可正常读写标注。目录结构：语言/话号/页码.jpg
          </p>
          {error && <div className="banner error">{error}</div>}
          {added.length > 0 && <div className="banner info">已添加：{added.join('、')}</div>}
          {warnings.map((w) => (
            <div className="banner info" key={w}>
              {w}
            </div>
          ))}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? '处理中…' : '添加'}
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
    if (!window.confirm(`从图库移除「${volume.title}」？\n\n只会删除 raw 下的目录链接，不会删除原文件夹里的图片；已保存的标注会保留。`)) return;
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
            <h2>卷设置 · {volume.title}</h2>
            <p>指定哪个子目录对应哪门语言；留空表示自动识别</p>
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
                <span>{LANG_LABEL[lang]}</span>
                <select value={choice[lang]} onChange={(e) => setChoice({ ...choice, [lang]: e.target.value })}>
                  <option value="">不使用 / 自动</option>
                  {candidates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {!volume.languages.length && <div className="banner info">该卷还没有识别到语言目录，请在上面指定。</div>}
          {volume.warnings.map((w) => (
            <div className="banner info" key={w}>
              {w}
            </div>
          ))}
          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
            从图库移除
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
