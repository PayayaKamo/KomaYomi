import { useEffect, useRef, useState } from 'react';
import type { ExportTemplate, LayoutScope, LayoutTemplate } from '../types';
import type { Selection } from '../hooks/usePage';
import { api } from '../api';
import { formatNumber, t, useI18n } from '../i18n';

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
    reader.onerror = () => reject(reader.error ?? new Error(t('common.readFileFailed')));
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
  const { t } = useI18n();
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
    return window.confirm(t('exchange.dirtyConfirm', { action }));
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

  const pickFile = async (file: File | undefined, label: string, set: (value: PendingFile | null) => void) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      set({ data: await readFileBase64(file), fileName: file.name });
      setMessage(t('exchange.pickedFile', { label, file: file.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportLayout = () =>
    void run(async () => {
      if (!layoutId) throw new Error(t('exchange.selectLayoutFirst'));
      if (!confirmDirty(t('exchange.exportLayoutAction'))) throw new Error(t('exchange.cancelled'));
      const res = await api.exportLayoutFile(layoutId);
      download(res.url, res.file);
      return t('exchange.exportedLayout', { file: res.file });
    });

  const importLayout = () =>
    void run(async () => {
      if (!layoutPending) throw new Error(t('exchange.selectMntplFirst'));
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
      return t('exchange.layoutImported', {
        name: res.layout.name,
        applied: applyAfter ? t('exchange.layoutImportedApplied', { count: formatNumber(applied) }) : '',
      });
    });

  const exportTemplate = () =>
    void run(async () => {
      if (!templateId) throw new Error(t('exchange.selectExportTplFirst'));
      const res = await api.exportExportTemplateFile(templateId);
      download(res.url, res.file);
      return t('exchange.exportedFile', { file: res.file });
    });

  const importTemplate = () =>
    void run(async () => {
      if (!exportPending) throw new Error(t('exchange.selectMnexpFirst'));
      const res = await api.importExportTemplateFile(exportPending.data);
      setExportPending(null);
      setExportTemplates((prev) => [res.template, ...prev.filter((item) => item.id !== res.template.id)]);
      setTemplateId(res.template.id);
      return t('exchange.exportTplImported', { name: res.template.name });
    });

  const exportPage = () =>
    void run(async () => {
      if (!selection) throw new Error(t('exchange.pickPageFirst'));
      if (!confirmDirty(t('exchange.exportPageAction'))) throw new Error(t('exchange.cancelled'));
      const res = await api.exportPageFile(selection);
      download(res.url, res.file);
      return t('exchange.exportedFile', { file: res.file });
    });

  const importPageAction = () =>
    void run(async () => {
      if (!selection) throw new Error(t('exchange.selectPageToOverwrite'));
      if (!pagePending) throw new Error(t('exchange.selectMnpageFirst'));
      if (
        !window.confirm(
          t('exchange.overwriteConfirm', {
            file: pagePending.fileName,
            volume: selection.volume,
            chapter: selection.chapter,
            page: formatNumber(selection.pageIndex + 1),
          }),
        )
      ) {
        throw new Error(t('exchange.cancelled'));
      }
      const res = await api.importPageFile({
        data: pagePending.data,
        volume: selection.volume,
        chapter: selection.chapter,
        pageIndex: selection.pageIndex,
      });
      setPagePending(null);
      onChanged();
      return t('exchange.pageImported', {
        migrated:
          res.migratedFrom !== undefined ? t('exchange.pageImportedMigrated', { v: String(res.migratedFrom) }) : '',
      });
    });

  const scopeHint =
    bindScope === 'volume'
      ? t('exchange.scopeVolume')
      : bindScope === 'chapter'
        ? t('exchange.scopeChapter')
        : t('exchange.scopePage');

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>{t('exchange.title')}</h2>
            <p>{t('exchange.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body project-body">
          {dirty && <div className="banner warn">{t('exchange.dirtyBanner')}</div>}

          <section className="project-section">
            <h3>{t('exchange.layoutSection')}</h3>
            <p className="muted tiny">{t('exchange.layoutHint')}</p>
            <label className="field">
              <span>{t('exchange.existingLayouts')}</span>
              <div className="row-inline">
                <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
                  {layouts.length === 0 && <option value="">{t('exchange.noLayouts')}</option>}
                  {layouts.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name} ({layout.volume}/{layout.chapter})
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" disabled={busy || !layoutId} onClick={exportLayout}>
                  {t('exchange.exportMntpl')}
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
                void pickFile(file, t('exchange.labelLayout'), setLayoutPending);
              }}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => layoutInput.current?.click()}>
              {t('exchange.chooseMntpl')}
            </button>

            {layoutPending && (
              <div className="banner info">
                <b>{layoutPending.fileName}</b>
                <div className="radio-row">
                  <label>
                    <input
                      type="radio"
                      name="bind-scope"
                      checked={bindScope === 'volume'}
                      onChange={() => setBindScope('volume')}
                    />
                    {t('exchange.wholeVolume')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="bind-scope"
                      checked={bindScope === 'chapter'}
                      onChange={() => setBindScope('chapter')}
                    />
                    {t('exchange.chapter')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="bind-scope"
                      checked={bindScope === 'page'}
                      onChange={() => setBindScope('page')}
                    />
                    {t('exchange.page')}
                  </label>
                </div>
                <label className="field">
                  <span>{t('exchange.bindVolume')}</span>
                  <input
                    value={bindVolume}
                    onChange={(e) => setBindVolume(e.target.value)}
                    placeholder={t('exchange.bindVolumePlaceholder')}
                  />
                </label>
                <div className="row-inline">
                  <label className="field">
                    <span>{t('exchange.chapterOptional')}</span>
                    <input
                      value={bindChapter}
                      disabled={bindScope === 'volume'}
                      onChange={(e) => setBindChapter(e.target.value)}
                      placeholder={t('exchange.chapterPlaceholder')}
                    />
                  </label>
                  <label className="field">
                    <span>{t('exchange.pageOrder')}</span>
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
                    {t('exchange.applyAfterImport')}
                  </span>
                </label>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setLayoutPending(null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn primary" disabled={busy} onClick={importLayout}>
                    {busy ? t('exchange.importing') : t('exchange.importAndBind')}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="project-section">
            <h3>{t('exchange.exportSection')}</h3>
            <p className="muted tiny">{t('exchange.exportHint')}</p>
            <label className="field">
              <span>{t('exchange.existingExportTemplates')}</span>
              <div className="row-inline">
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {exportTemplates.length === 0 && <option value="">{t('exchange.noExportTemplates')}</option>}
                  {exportTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" disabled={busy || !templateId} onClick={exportTemplate}>
                  {t('exchange.exportMnexp')}
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
                void pickFile(file, t('exchange.labelExport'), setExportPending);
              }}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => exportInput.current?.click()}>
              {t('exchange.chooseMnexp')}
            </button>

            {exportPending && (
              <div className="banner info">
                <b>{exportPending.fileName}</b>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setExportPending(null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn primary" disabled={busy} onClick={importTemplate}>
                    {busy ? t('exchange.importing') : t('exchange.confirmImport')}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="project-section">
            <h3>{t('exchange.pageSection')}</h3>
            <p className="muted tiny">{t('exchange.pageHint')}</p>
            <p className="muted tiny">
              {selection
                ? t('exchange.currentPage', {
                    volume: selection.volume,
                    chapter: selection.chapter,
                    page: formatNumber(selection.pageIndex + 1),
                  })
                : t('exchange.pickPageFirst')}
            </p>
            <div className="row-inline">
              <button type="button" className="btn" disabled={busy || !selection} onClick={exportPage}>
                {t('exchange.exportCurrentPage')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !selection}
                onClick={() => pageInput.current?.click()}
              >
                {t('exchange.choosePageJson')}
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
                void pickFile(file, t('exchange.labelPage'), setPagePending);
              }}
            />
            {pagePending && (
              <div className="banner info">
                <b>{pagePending.fileName}</b>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setPagePending(null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn danger" disabled={busy} onClick={importPageAction}>
                    {busy ? t('exchange.importing') : t('exchange.overwriteCurrentPage')}
                  </button>
                </div>
              </div>
            )}
          </section>

          {message && <div className="banner info">{message}</div>}
          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <span className="muted tiny">{t('exchange.footerHint')}</span>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
