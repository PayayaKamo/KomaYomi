import { useRef, useState } from 'react';
import type { Library } from '../types';
import { api } from '../api';

type Props = {
  onClose: () => void;
  onRestored: (library: Library) => void;
};

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 一键备份 / 恢复：恢复前先展示将覆盖什么，并自动留下恢复前快照 */
export function DataToolsDialog({ onClose, onRestored }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ url: string; size: number } | null>(null);
  const [pending, setPending] = useState<{
    data: string;
    name: string;
    info: { pages: number; notes: number; volumes: string[]; templates: number; presets: number; overwrite: number };
  } | null>(null);
  const [restored, setRestored] = useState<{ restored: number; snapshot: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createBackup();
      setExported({ url: res.url, size: res.size });
      const a = document.createElement('a');
      a.href = res.url;
      a.download = res.file;
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setRestored(null);
    try {
      const data = await readFileBase64(file);
      const info = await api.inspectBackup(data);
      setPending({ data, name: file.name, info });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.restoreBackup(pending.data);
      setRestored({ restored: res.restored, snapshot: res.snapshot });
      setPending(null);
      onRestored(res.library);
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
            <h2>备份与恢复</h2>
            <p>把 data/ 里的标注、模板、预设打包；缩略图缓存不包含在内</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <section className="backup-section">
            <h3>导出备份</h3>
            <p className="muted tiny">生成 .zip 下载，可用于换电脑或防误操作。</p>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runExport()}>
              {busy ? '处理中…' : '生成并下载备份'}
            </button>
            {exported && (
              <p className="muted tiny">
                已生成 <a href={exported.url} download>备份文件</a>（{kb(exported.size)}）
              </p>
            )}
          </section>

          <section className="backup-section">
            <h3>从备份恢复</h3>
            <p className="muted tiny">
              恢复会覆盖 data/ 下同名文件，但不会删除备份中没有的页面；开始前会自动保存一份当前数据的快照。
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
              选择备份文件…
            </button>

            {pending && (
              <div className="banner warn">
                <b>确认覆盖？</b> {pending.name}
                <ul>
                  <li>
                    包含 {pending.info.pages} 页数据、{pending.info.notes} 条笔记、{pending.info.templates} 个模板、
                    {pending.info.presets} 个预设
                  </li>
                  <li>涉及卷：{pending.info.volumes.join('、') || '（无）'}</li>
                  <li>
                    将覆盖 <b>{pending.info.overwrite}</b> 个现有文件；未在备份中的文件会保留
                  </li>
                </ul>
                <div className="row-inline">
                  <button type="button" className="btn" onClick={() => setPending(null)} disabled={busy}>
                    取消
                  </button>
                  <button type="button" className="btn danger" onClick={() => void confirmRestore()} disabled={busy}>
                    确认恢复
                  </button>
                </div>
              </div>
            )}

            {restored && (
              <div className="banner info">
                已恢复 {restored.restored} 个文件。
                {restored.snapshot && <>恢复前快照：<code>{restored.snapshot}</code></>}
              </div>
            )}
          </section>
          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
