import { useEffect, useRef, useState } from 'react';
import type { ExportTemplate, LayoutScope, LayoutTemplate } from '../types';
import type { Selection } from '../hooks/usePage';
import { api } from '../api';

type Props = {
  onClose: () => void;
  selection: Selection | null;
  dirty: boolean;
  onChanged: () => void;
};

type PendingFile = { data: string; fileName: string };

const readFileBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });

const download = (url: string, file: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  a.click();
};

/** 统一交换格式：.mntpl 版式模板 / .mnexp 导出模板 / .mnpage.json 单页数据 */
export function ExchangeDialog({ onClose, selection, dirty, onChanged }: Props) {
  const [layouts, setLayouts] = useState<LayoutTemplate[]>([]);
  const [exportTemplates, setExportTemplates] = useState<ExportTemplate[]>([]);
  const [layoutId, setLayoutId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [layoutPending, setLayoutPending] = useState<PendingFile | null>(null);
  const [exportPending, setExportPending] = useState<PendingFile | null>(null);
  const [pagePending, setPagePending] = useState<PendingFile | null>(null);

  const [bindVolume, setBindVolume] = useState(selection?.volume ?? '');
  const [bindChapter, setBindChapter] = useState(selection?.chapter ?? '');
  const [bindPage, setBindPage] = useState(selection ? selection.pageIndex + 1 : 1);
  const [bindScope, setBindScope] = useState<LayoutScope>('volume');
  const [applyAfter, setApplyAfter] = useState(false);

  const layoutInput = useRef<HTMLInputElement>(null);
  const exportInput = useRef<HTMLInputElement>(null);
  const pageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.layouts(), api.exportTemplates()])
      .then(([layoutRes, exportRes]) => {
        if (cancelled) return;
        setLayouts(layoutRes.layouts);
        setExportTemplates(exportRes.templates);
        setLayoutId((prev) => prev || layoutRes.layouts[0]?.id || '');
        setTemplateId((prev) => prev || exportRes.templates[0]?.id || '');
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmDirty = (action: string) => {
    if (!dirty) return true;
    return window.confirm(
      `当前页面还有未保存的修改。\n\n${action}前建议先点保存，否则导出的不是最新内容，导入也可能覆盖未保存修改。\n\n仍要继续吗？`,
    );
  };

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (
    file: File | undefined,
    label: string,
    set: (value: PendingFile | null) => void,
  ) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      set({ data: await readFileBase64(file), fileName: file.name });
      setMessage(`已选择${label}：${file.name}，确认后才会写入。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportLayout = () =>
    void run(async () => {
      if (!layoutId) throw new Error('请先选择要导出的版式');
      if (!confirmDirty('导出 .mntpl')) throw new Error('已取消');
      const res = await api.exportLayoutFile(layoutId);
      download(res.url, res.file);
      return `已导出 ${res.file}（已移除卷 / 话 / 页绑定，可在其他漫画导入）。`;
    });

  const importLayout = () =>
    void run(async () => {
      if (!layoutPending) throw new Error('请先选择 .mntpl 文件');
      const res = await api.importLayoutFile({
        data: layoutPending.data,
        volume: bindVolume.trim(),
        chapter: bindScope === 'volume' ? undefined : bindChapter.trim(),
        pageIndex: bindScope === 'page' ? Math.max(0, Math.trunc(bindPage) - 1) : undefined,
        scope: bindScope,
      });
      let applied = 0;
      if (applyAfter) {
        const apply = await api.applyLayout(
          res.layout.id,
          bindVolume.trim(),
          bindScope === 'volume' ? undefined : bindChapter.trim(),
          bindScope === 'page' ? [Math.max(0, Math.trunc(bindPage) - 1)] : undefined,
        );
        applied = apply.applied;
      }
      setLayoutPending(null);
      setLayouts((prev) => [res.layout, ...prev.filter((item) => item.id !== res.layout.id)]);
      setLayoutId(res.layout.id);
      if (applied) onChanged();
      return `已导入版式模板「${res.layout.name}」${applyAfter ? `，并套用到 ${applied} 页` : ''}。原始文件已备份。`;
    });

  const exportTemplate = () =>
    void run(async () => {
      if (!templateId) throw new Error('请先选择要导出的导出模板');
      const res = await api.exportExportTemplateFile(templateId);
      download(res.url, res.file);
      return `已导出 ${res.file}。`;
    });

  const importTemplate = () =>
    void run(async () => {
      if (!exportPending) throw new Error('请先选择 .mnexp 文件');
      const res = await api.importExportTemplateFile(exportPending.data);
      setExportPending(null);
      setExportTemplates((prev) => [res.template, ...prev.filter((item) => item.id !== res.template.id)]);
      setTemplateId(res.template.id);
      return `已导入导出模板「${res.template.name}」。原始文件已备份。`;
    });

  const exportPage = () =>
    void run(async () => {
      if (!selection) throw new Error('请先在左侧选择一页');
      if (!confirmDirty('导出当前页')) throw new Error('已取消');
      const res = await api.exportPageFile(selection);
      download(res.url, res.file);
      return `已导出 ${res.file}。`;
    });

  const importPageAction = () =>
    void run(async () => {
      if (!selection) throw new Error('请先在左侧选择要覆盖的页');
      if (!pagePending) throw new Error('请先选择 .mnpage.json 文件');
      if (!window.confirm(`将用 ${pagePending.fileName} 覆盖当前页（${selection.volume}/${selection.chapter} 第 ${selection.pageIndex + 1} 页）的分格、笔记与标注。\n\n原页面会先备份，仍要继续吗？`)) {
        throw new Error('已取消');
      }
      const res = await api.importPageFile({
        data: pagePending.data,
        volume: selection.volume,
        chapter: selection.chapter,
        pageIndex: selection.pageIndex,
      });
      setPagePending(null);
      onChanged();
      return `已导入单页数据${res.migratedFrom !== undefined ? `（从 v${res.migratedFrom} 迁移）` : ''}，原页面已备份。`;
    });

  const scopeHint =
    bindScope === 'volume'
      ? '整卷（不写入 chapter / pageIndex）'
      : bindScope === 'chapter'
        ? '绑定到指定话'
        : '绑定到指定页';

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>交换文件</h2>
            <p>.mntpl 版式模板 · .mnexp 导出模板 · .mnpage.json 单页数据；导入前都会备份并校验</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body project-body">
          {dirty && (
            <div className="banner warn">
              当前页面有未保存的修改。导出不会包含它们；单页导入会覆盖当前页。建议先按顶栏「保存」。
            </div>
          )}

          <section className="project-section">
            <h3>版式模板 .mntpl</h3>
            <p className="muted tiny">导出会自动移除卷 / 话 / 页绑定；导入时再绑定到当前漫画。</p>
            <label className="field">
              <span>现有版式</span>
              <div className="row-inline">
                <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
                  {layouts.length === 0 && <option value="">暂无版式模板</option>}
                  {layouts.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name}（{layout.volume}/{layout.chapter}）
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" disabled={busy || !layoutId} onClick={exportLayout}>
                  导出 .mntpl
                </button>
              </div>
            </label>

            <input
              ref={layoutInput}
              type="file"
              accept=".mntpl,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                void pickFile(file, '版式模板', setLayoutPending);
              }}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => layoutInput.current?.click()}>
              选择 .mntpl 文件…
            </button>

            {layoutPending && (
              <div className="banner info">
                <b>{layoutPending.fileName}</b>
                <div className="radio-row">
                  <label>
                    <input type="radio" name="bind-scope" checked={bindScope === 'volume'} onChange={() => setBindScope('volume')} />
                    整卷
                  </label>
                  <label>
                    <input type="radio" name="bind-scope" checked={bindScope === 'chapter'} onChange={() => setBindScope('chapter')} />
                    话
                  </label>
                  <label>
                    <input type="radio" name="bind-scope" checked={bindScope === 'page'} onChange={() => setBindScope('page')} />
                    页
                  </label>
                </div>
                <label className="field">
                  <span>绑定到卷</span>
                  <input value={bindVolume} onChange={(e) => setBindVolume(e.target.value)} placeholder="例如 点兔第14卷" />
                </label>
                <div className="row-inline">
                  <label className="field">
                    <span>话（可选）</span>
                    <input
                      value={bindChapter}
                      disabled={bindScope === 'volume'}
                      onChange={(e) => setBindChapter(e.target.value)}
                      placeholder="例如 172"
                    />
                  </label>
                  <label className="field">
                    <span>页序（1 起）</span>
                    <input
                      type="number"
                      min={1}
                      value={bindPage}
                      disabled={bindScope !== 'page'}
                      onChange={(e) => setBindPage(Number(e.target.value) || 1)}
                    />
                  </label>
                </div>
                <p className="muted tiny">{scopeHint}</p>
                <label className="field">
                  <span>
                    <input type="checkbox" checked={applyAfter} onChange={(e) => setApplyAfter(e.target.checked)} />{' '}
                    导入后立即套用（会覆盖目标范围的分格，套用前自动保存原页面）
                  </span>
                </label>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setLayoutPending(null)}>
                    取消
                  </button>
                  <button type="button" className="btn primary" disabled={busy} onClick={importLayout}>
                    {busy ? '导入中…' : '导入并绑定'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="project-section">
            <h3>导出模板 .mnexp</h3>
            <p className="muted tiny">包含 HTML / PDF / PNG 的版式与样式配置，可导出后再导入。</p>
            <label className="field">
              <span>现有导出模板</span>
              <div className="row-inline">
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {exportTemplates.length === 0 && <option value="">暂无导出模板</option>}
                  {exportTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" disabled={busy || !templateId} onClick={exportTemplate}>
                  导出 .mnexp
                </button>
              </div>
            </label>

            <input
              ref={exportInput}
              type="file"
              accept=".mnexp,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                void pickFile(file, '导出模板', setExportPending);
              }}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => exportInput.current?.click()}>
              选择 .mnexp 文件…
            </button>

            {exportPending && (
              <div className="banner info">
                <b>{exportPending.fileName}</b>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setExportPending(null)}>
                    取消
                  </button>
                  <button type="button" className="btn primary" disabled={busy} onClick={importTemplate}>
                    {busy ? '导入中…' : '确认导入'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="project-section">
            <h3>单页数据 .mnpage.json</h3>
            <p className="muted tiny">
              可读 JSON，包含分格、笔记、标签、分组、标注与对齐偏移。旧页面 JSON（没有 envelope）也能导入。
            </p>
            <p className="muted tiny">
              {selection
                ? `当前页：${selection.volume} / ${selection.chapter} / 第 ${selection.pageIndex + 1} 页`
                : '请先在左侧选择一页'}
            </p>
            <div className="row-inline">
              <button type="button" className="btn" disabled={busy || !selection} onClick={exportPage}>
                导出当前页
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !selection}
                onClick={() => pageInput.current?.click()}
              >
                选择页面 JSON…
              </button>
            </div>
            <input
              ref={pageInput}
              type="file"
              accept=".json,.mnpage.json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                void pickFile(file, '页面 JSON', setPagePending);
              }}
            />
            {pagePending && (
              <div className="banner info">
                <b>{pagePending.fileName}</b>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setPagePending(null)}>
                    取消
                  </button>
                  <button type="button" className="btn danger" disabled={busy} onClick={importPageAction}>
                    {busy ? '导入中…' : '覆盖当前页'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {message && <div className="banner info">{message}</div>}
          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <span className="muted tiny">校验失败会给出字段路径，不会写入半成品；原始文件备份在 data/backups/exchange/</span>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
