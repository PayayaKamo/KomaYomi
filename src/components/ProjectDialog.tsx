import { useRef, useState } from 'react';
import type { Library } from '../types';
import { api } from '../api';
import type { ProjectConflict, ProjectInspect, ProjectMode } from '../api';

type Props = {
  onClose: () => void;
  onImported: (library: Library) => void;
  /** 当前页面是否有未保存修改（confirm 模式下的待保存内容） */
  dirty: boolean;
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

const today = () => new Date().toISOString().slice(0, 10);

/** 工程文件 .mnproj：另存为工程（引用 / 打包）与打开工程（检查 → 导入） */
export function ProjectDialog({ onClose, onImported, dirty }: Props) {
  const [mode, setMode] = useState<ProjectMode>('reference');
  const [name, setName] = useState(`komayomi-${today()}`);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ file: string; url: string; size: number; images: number } | null>(null);
  const [pending, setPending] = useState<{ data: string; fileName: string; info: ProjectInspect } | null>(null);
  const [conflict, setConflict] = useState<ProjectConflict>('overwrite');
  const [relinkDir, setRelinkDir] = useState('');
  const [done, setDone] = useState<{
    restored: number;
    merged: number;
    skipped: number;
    relinked: number;
    missing: { volume: string; chapter: string; name: string }[];
    snapshot: string | null;
    projectBackup: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const confirmDirty = (action: string) => {
    if (!dirty) return true;
    return window.confirm(
      `当前页面还有未保存的修改（顶栏显示「待保存」）。\n\n${action}前建议先点保存，否则这些修改不会写入工程文件，导入时也可能被覆盖。\n\n仍要继续吗？`,
    );
  };

  const runExport = async () => {
    if (!confirmDirty('导出工程')) return;
    setBusy(true);
    setError(null);
    setExported(null);
    try {
      const res = await api.exportProject({ mode, name: name.trim() || undefined, notes: notes.trim() || undefined });
      setExported({ file: res.file, url: res.url, size: res.size, images: res.manifest.images });
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
    setDone(null);
    try {
      const data = await readFileBase64(file);
      const info = await api.inspectProject(data);
      setPending({ data, fileName: file.name, info });
      setConflict(info.conflictCount > 0 ? 'merge' : 'overwrite');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!pending) return;
    if (!confirmDirty('导入工程')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.importProject({
        data: pending.data,
        conflict,
        relinkDir: relinkDir.trim() || undefined,
      });
      setDone({
        restored: res.restored,
        merged: res.merged,
        skipped: res.skipped,
        relinked: res.relinked,
        missing: res.missing,
        snapshot: res.snapshot,
        projectBackup: res.projectBackup,
      });
      setPending(null);
      onImported(res.library);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pickRelink = async () => {
    if (!window.mangaDesktop) {
      setError('浏览器里无法弹出文件夹选择框，请直接填写补链目录路径');
      return;
    }
    const dir = await window.mangaDesktop.pickFolder('选择缺失图片所在的原始文件夹');
    if (dir) setRelinkDir(dir);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>工程文件</h2>
            <p>.mnproj = 压缩包 + 纯文本 JSON，可把图片、批注、模板与语言设置一起带走</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body project-body">
          {dirty && (
            <div className="banner warn">
              当前页面有未保存的修改。导出不会包含这些修改；导入可能覆盖它们。建议先按顶栏「保存」。
            </div>
          )}

          <section className="project-section">
            <h3>另存为工程</h3>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="project-mode"
                  checked={mode === 'reference'}
                  onChange={() => setMode('reference')}
                />
                引用模式（只记路径与哈希，体积小）
              </label>
              <label>
                <input
                  type="radio"
                  name="project-mode"
                  checked={mode === 'packaged'}
                  onChange={() => setMode('packaged')}
                />
                打包模式（内嵌图片，可独立分发）
              </label>
            </div>
            <label className="field">
              <span>工程名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 点兔第14卷-批注" />
            </label>
            <label className="field">
              <span>备注（可选）</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="写进 manifest 的说明" />
            </label>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runExport()}>
              {busy ? '处理中…' : '生成并下载 .mnproj'}
            </button>
            {exported && (
              <p className="muted tiny">
                已生成 <a href={exported.url} download={exported.file}>{exported.file}</a>（{kb(exported.size)}，
                含 {exported.images} 张图片）
              </p>
            )}
          </section>

          <section className="project-section">
            <h3>打开工程</h3>
            <p className="muted tiny">
              导入前会自动把当前 data/ 快照到 exports/，并备份原始工程文件到 data/backups/projects/。
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".mnproj,.zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
              选择工程文件…
            </button>

            {pending && (
              <div className="banner info">
                <b>{pending.fileName}</b>
                <ul className="project-summary">
                  <li>
                    {pending.info.storageMode === 'packaged' ? '打包模式' : '引用模式'} · schema {pending.info.schemaVersion}
                    {pending.info.migratedFrom !== undefined && `（将从 v${pending.info.migratedFrom} 迁移）`}
                  </li>
                  <li>
                    {pending.info.volumes.length} 卷 / {pending.info.chapters} 话 / {pending.info.pages} 页数据 ·{' '}
                    {pending.info.notes} 条笔记 · {pending.info.annotations} 个标注
                  </li>
                  <li>
                    {pending.info.images} 张图片 · {pending.info.templates} 个模板 · {pending.info.presets} 个预设
                  </li>
                  <li>
                    冲突 <b>{pending.info.conflictCount}</b> 个文件
                    {pending.info.missingAssets.length > 0 && (
                      <>
                        {' '}
                        · 缺失图片 <b>{pending.info.missingAssets.length}</b> 张
                      </>
                    )}
                  </li>
                </ul>

                <div className="radio-row">
                  <label>
                    <input
                      type="radio"
                      name="project-conflict"
                      checked={conflict === 'overwrite'}
                      onChange={() => setConflict('overwrite')}
                    />
                    覆盖
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="project-conflict"
                      checked={conflict === 'merge'}
                      onChange={() => setConflict('merge')}
                    />
                    合并（保留现有分格/标注，笔记按 id 合并）
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="project-conflict"
                      checked={conflict === 'skip'}
                      onChange={() => setConflict('skip')}
                    />
                    跳过
                  </label>
                </div>

                <label className="field">
                  <span>补链目录（可选，仅引用模式缺失图片时使用）</span>
                  <div className="row-inline">
                    <input
                      value={relinkDir}
                      placeholder="缺失图片所在的原始文件夹，例如 D:/Comics/点兔第14卷"
                      onChange={(e) => setRelinkDir(e.target.value)}
                    />
                    <button type="button" className="btn" disabled={busy} onClick={() => void pickRelink()}>
                      选择…
                    </button>
                  </div>
                </label>

                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setPending(null)}>
                    取消
                  </button>
                  <button type="button" className="btn danger" disabled={busy} onClick={() => void runImport()}>
                    {busy ? '导入中…' : '确认导入'}
                  </button>
                </div>
              </div>
            )}

            {done && (
              <div className="banner info">
                已导入：恢复 {done.restored} 个文件，合并 {done.merged} 个，跳过 {done.skipped} 个
                {done.relinked > 0 && `，补链 ${done.relinked} 张图片`}。
                {done.missing.length > 0 && (
                  <>
                    <br />
                    仍有 <b>{done.missing.length}</b> 张图片缺失：
                    {done.missing
                      .slice(0, 5)
                      .map((m) => `${m.volume}/${m.chapter}/${m.name}`)
                      .join('、')}
                    {done.missing.length > 5 && ' 等'}
                    <br />
                    把原始图片放到补链目录后，用「合并」再导入一次即可找回。
                  </>
                )}
                {done.snapshot && (
                  <>
                    <br />
                    导入前快照：<code>{done.snapshot}</code>
                  </>
                )}
                {done.projectBackup && (
                  <>
                    <br />
                    原工程备份：<code>{done.projectBackup}</code>
                  </>
                )}
              </div>
            )}
          </section>

          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <span className="muted tiny">引用模式不复制图片，换机器后可用补链目录找回</span>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
