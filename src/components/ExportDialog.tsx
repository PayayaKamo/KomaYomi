import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExportConfig, ExportTemplate, Lang, Library, PageDoc, PageEntry, Panel } from '../types';
import { DEFAULT_EXPORT_CONFIG, langShort } from '../types';
import { api } from '../api';
import { applyGroupOrder, sortPanels } from '../lib/geometry';
import { composeAnnotatedPage, exportPng } from '../lib/pngExport';
import { DEFAULT_SHARE_SIZE, SHARE_SIZE_GROUPS, SHARE_SIZE_PRESETS, findShareSize } from '../lib/shareSizes';
import type { ShareSizeId } from '../lib/shareSizes';
import { DEFAULT_SHARE_PRESET, SHARE_PRESETS, exportShareImages, findSharePreset } from '../lib/shareImageExport';
import type { ShareFile, SharePageInput, SharePresetId } from '../lib/shareImageExport';
import { formatNumber, langLabel, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Selection } from '../hooks/usePage';

type Props = {
  open: boolean;
  onClose: () => void;
  doc: PageDoc | null;
  page: PageEntry | null;
  /** Panel currently selected, used by the "export current panel" PNG action. */
  panel: Panel | null;
  library: Library | null;
  sel: Selection | null;
  langs: Lang[];
  /** Library-wide language order (languages are discovered at runtime). */
  allLangs: Lang[];
  tagStats: { tag: string; count: number }[];
  /** Project root, shown so the exported file's absolute path can be displayed. */
  rootPath: string;
};

type ExportResult = {
  url: string;
  file: string;
  pages: number;
  warnings: string[];
  imageMode?: 'files' | 'embed';
  assetDir?: string;
};

const TEMPLATE_IDS: { id: ExportConfig['template']; name: MessageKey; desc: MessageKey }[] = [
  { id: 'two-column', name: 'export.templateTwoColumn', desc: 'export.templateTwoColumnDesc' },
  { id: 'stack', name: 'export.templateStack', desc: 'export.templateStackDesc' },
  { id: 'compare-wide', name: 'export.templateCompareWide', desc: 'export.templateCompareWideDesc' },
];

const LAYOUT_KEY = 'manga-memo.export-layout';
const PNG_SIZE_KEY = 'komayomi.png-size';
const SHARE_PRESET_KEY = 'komayomi.share-preset';

/** Restore the last share preset; unknown values fall back to the standard cover. */
function readSharePreset(): SharePresetId {
  try {
    return findSharePreset(localStorage.getItem(SHARE_PRESET_KEY))?.id ?? DEFAULT_SHARE_PRESET;
  } catch {
    return DEFAULT_SHARE_PRESET;
  }
}

/** Folder stamp for one share export batch: 20261116-153045. */
function shareStamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Restore the last PNG output size; unknown values fall back to the original pixels. */
function readPngSize(): ShareSizeId {
  try {
    return findShareSize(localStorage.getItem(PNG_SIZE_KEY))?.id ?? DEFAULT_SHARE_SIZE;
  } catch {
    return DEFAULT_SHARE_SIZE;
  }
}

/** Keep only layout-related fields for template saving and local memory. */
function layoutOf(c: ExportConfig): Partial<ExportConfig> {
  return {
    template: c.template,
    pageWidthRatio: c.pageWidthRatio,
    columnGap: c.columnGap,
    fontScale: c.fontScale,
    columns: c.columns,
    embedImages: c.embedImages,
    showPanelBoxes: c.showPanelBoxes,
    languages: c.languages,
    noteFilterTags: c.noteFilterTags,
    onlyWithNotes: c.onlyWithNotes,
    includeAnnotations: c.includeAnnotations !== false,
  };
}

function readLayout(): Partial<ExportConfig> | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as Partial<ExportConfig>) : null;
  } catch {
    return null;
  }
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');

export function ExportDialog({
  open,
  onClose,
  doc,
  page,
  panel,
  library,
  sel,
  langs,
  allLangs,
  tagStats,
  rootPath,
}: Props) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<ExportConfig | null>(null);
  const [scope, setScope] = useState<'page' | 'chapter'>('page');
  const [format, setFormat] = useState<'html' | 'docx' | 'pdf'>('html');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [resultFormat, setResultFormat] = useState<'html' | 'docx' | 'pdf'>('html');
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  // Custom export templates
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [tplName, setTplName] = useState('');
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // PNG export state
  const [pngBusy, setPngBusy] = useState<string | null>(null);
  const [pngMsg, setPngMsg] = useState<string | null>(null);
  const [pngIncludeAnn, setPngIncludeAnn] = useState(true);
  const [pngSize, setPngSize] = useState<ShareSizeId>(readPngSize);

  // Share image state
  const [sharePreset, setSharePreset] = useState<SharePresetId>(readSharePreset);
  const [shareLang, setShareLang] = useState<Lang | null>(null);
  const [shareInfoBar, setShareInfoBar] = useState(true);
  const [shareIncludeAnn, setShareIncludeAnn] = useState(true);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareProgress, setShareProgress] = useState<{ done: number; total: number } | null>(null);
  const [shareDir, setShareDir] = useState<string | null>(null);
  const [shareFiles, setShareFiles] = useState<ShareFile[]>([]);
  const [shareWarnings, setShareWarnings] = useState<string[]>([]);
  const [shareErr, setShareErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sel) return;
    setResult(null);
    setError(null);
    setScope('page');
    setFormat('html');
    setPngMsg(null);
    // Respect the page's annotation layer toggle so a hidden layer is not silently baked in.
    setPngIncludeAnn(doc?.annotationsVisible !== false);
    setShareIncludeAnn(doc?.annotationsVisible !== false);
    setShareErr(null);
    setShareDir(null);
    setShareFiles([]);
    setShareWarnings([]);
    setShareProgress(null);
    setTplMsg(null);
    setCfg({
      ...DEFAULT_EXPORT_CONFIG,
      ...(readLayout() ?? {}),
      title: t('export.defaultTitle', { chapter: sel.chapter }),
      volume: sel.volume,
      chapter: sel.chapter,
      pageIndices: [sel.pageIndex],
      languages: langs,
      offsets: doc?.offsets ?? {},
    });
    api
      .exportTemplates()
      .then((res) => setTemplates(res.templates))
      .catch(() => setTemplates([]));
  }, [open, sel, langs, doc?.offsets, doc?.annotationsVisible, t]);

  useEffect(() => {
    if (!resizing) return;
    const move = (e: PointerEvent) => {
      const el = previewRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ratio = Math.min(75, Math.max(28, ((e.clientX - r.left) / r.width) * 100));
      setCfg((c) => (c ? { ...c, pageWidthRatio: Math.round(ratio) } : c));
    };
    const up = () => setResizing(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [resizing]);

  const chapterInfo = useMemo(() => {
    const v = library?.volumes.find((x) => x.id === sel?.volume);
    return v?.chapters.find((c) => c.chapter === sel?.chapter) ?? null;
  }, [library, sel]);

  if (!open || !cfg || !sel) return null;

  const patch = (p: Partial<ExportConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutOf(next)));
    } catch {
      /* Ignored in private mode and similar contexts */
    }
  };

  /**
   * Word has no canvas on the server, so annotated pages are composited here and
   * uploaded one by one. Pages without annotations keep using the original files.
   */
  const stageAnnotatedPages = async (payload: ExportConfig): Promise<string | undefined> => {
    const indices =
      scope === 'page' ? [sel.pageIndex] : (chapterInfo?.pages ?? []).filter((p) => !p.excluded).map((p) => p.index);
    const id = `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let staged = 0;
    for (const index of indices) {
      const entry = index === sel.pageIndex && page ? page : chapterInfo?.pages.find((p) => p.index === index);
      if (!entry) continue;
      let pageDoc: PageDoc | null = index === sel.pageIndex ? doc : null;
      if (!pageDoc) {
        try {
          pageDoc = (await api.page(sel.volume, sel.chapter, index)).doc;
        } catch {
          continue;
        }
      }
      if (pageDoc.annotationsVisible === false || !pageDoc.annotations?.length) continue;
      const annotations = pageDoc.annotations;
      for (const lang of payload.languages) {
        const canvas = await composeAnnotatedPage(entry, lang, annotations, pageDoc.panels);
        if (!canvas) continue;
        try {
          await api.stageExportImage({ id, key: `p${index}-${lang}`, dataUrl: canvas.toDataURL('image/png') });
          staged++;
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    }
    return staged ? id : undefined;
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: ExportConfig = {
        ...cfg,
        pageIndices: scope === 'page' ? [sel.pageIndex] : [],
        print: format === 'pdf',
      };
      if (format === 'docx') {
        payload.includeAnnotations = cfg.includeAnnotations !== false;
        if (payload.includeAnnotations) {
          const staged = await stageAnnotatedPages(payload);
          if (staged) payload.annotationImages = staged;
        }
      }
      const res = format === 'docx' ? await api.exportDocx(payload) : await api.exportHtml(payload);
      setResult(res);
      setResultFormat(format);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pngBase = page ? `${safeName(sel.volume)}-${safeName(sel.chapter)}-P${sel.pageIndex + 1}` : 'page';

  const runPng = async (mode: 'page' | 'panel' | 'collage') => {
    if (!page) return;
    const label =
      mode === 'page'
        ? t('export.pngPageLabel')
        : mode === 'panel'
          ? t('export.pngPanelLabel')
          : t('export.pngCollageLabel');
    setPngBusy(mode);
    setPngMsg(null);
    try {
      const fileLang = cfg.languages.find((l) => page.files[l]) ?? 'ja';
      await exportPng({
        page,
        lang: fileLang,
        langs: cfg.languages,
        rect: mode === 'collage' ? (panel?.rect ?? null) : mode === 'panel' ? (panel?.rect ?? null) : null,
        mode,
        filenameBase: `${pngBase}-${label}`,
        annotations: doc?.annotations ?? [],
        includeAnnotations: pngIncludeAnn,
        panels: doc?.panels ?? [],
        size: pngSize,
      });
      setPngMsg(t('export.pngDone', { label }));
    } catch (err) {
      setPngMsg(t('export.pngFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setPngBusy(null);
    }
  };

  const runShare = async () => {
    const preset = findSharePreset(sharePreset) ?? SHARE_PRESETS[0];
    const lang = cfg.languages.includes(shareLang ?? '') ? (shareLang as Lang) : cfg.languages[0];
    if (!preset || !lang) return;
    setShareBusy(true);
    setShareErr(null);
    setShareDir(null);
    setShareFiles([]);
    setShareWarnings([]);
    setShareProgress(null);
    try {
      const entries =
        scope === 'page' ? (page ? [page] : []) : (chapterInfo?.pages ?? []).filter((entry) => !entry.excluded);
      if (!entries.length) throw new Error(t('share.noPages'));

      // Panels and annotations live in page documents, so fetch the ones not open right now.
      const inputs: SharePageInput[] = [];
      for (const entry of entries) {
        let pageDoc: PageDoc | null = entry.index === sel.pageIndex ? doc : null;
        if (!pageDoc) {
          try {
            pageDoc = (await api.page(sel.volume, sel.chapter, entry.index)).doc;
          } catch {
            pageDoc = null;
          }
        }
        inputs.push({ page: entry, doc: pageDoc });
      }

      const dir = `share-${safeName(sel.volume)}-${safeName(sel.chapter)}-${shareStamp()}`;
      const res = await exportShareImages({
        preset,
        mode: preset.id === 'compare' ? 'compare' : 'single',
        lang,
        languages: cfg.languages,
        pages: inputs,
        infoBar: shareInfoBar,
        includeAnnotations: shareIncludeAnn,
        dir,
        onProgress: (done, total) => setShareProgress({ done, total }),
      });
      setShareDir(res.dir);
      setShareFiles(res.files);
      setShareWarnings(res.warnings);
    } catch (err) {
      setShareErr(t('share.failed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setShareBusy(false);
      setShareProgress(null);
    }
  };

  const saveTemplate = async () => {
    const name = tplName.trim() || t('export.defaultTemplateName', { template: cfg.template });
    try {
      const res = await api.saveExportTemplate(name, layoutOf(cfg));
      setTemplates((prev) => [res.template, ...prev]);
      setTplName('');
      setTplMsg(t('export.templateSaved', { name }));
    } catch (err) {
      setTplMsg(t('export.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const applyTemplate = (tpl: ExportTemplate) => {
    patch({ ...tpl.config });
    setTplMsg(t('export.templateApplied', { name: tpl.name }));
  };

  const removeTemplate = async (tpl: ExportTemplate) => {
    try {
      await api.deleteExportTemplate(tpl.id);
      setTemplates((prev) => prev.filter((x) => x.id !== tpl.id));
      setTplMsg(t('export.templateDeleted', { name: tpl.name }));
    } catch (err) {
      setTplMsg(t('export.deleteFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const exportTemplateFile = (tpl: ExportTemplate) => {
    const blob = new Blob([JSON.stringify({ name: tpl.name, config: tpl.config }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName(tpl.name)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importTemplateFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as { name?: string; config?: Partial<ExportConfig> };
      if (!data || typeof data !== 'object' || !data.config) throw new Error(t('export.noConfigField'));
      const res = await api.saveExportTemplate(data.name || file.name.replace(/\.json$/i, ''), data.config);
      setTemplates((prev) => [res.template, ...prev]);
      setTplMsg(t('export.templateImported', { name: res.template.name }));
    } catch (err) {
      setTplMsg(t('export.importFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const previewUrl = page?.files[cfg.languages.find((l) => page?.files[l]) ?? 'ja'] ?? '';
  const activeShareLang = cfg.languages.includes(shareLang ?? '') ? (shareLang as Lang) : cfg.languages[0];
  const ordered = doc ? applyGroupOrder(sortPanels(doc.panels, doc.readingDirection), doc.groups) : [];
  const pageNotes = doc?.notes.filter((n) => n.scope === 'page') ?? [];

  const renderCrop = (p: Panel, lang: Lang) => {
    const url = page?.files[lang];
    if (!url) return null;
    const off = doc?.offsets[lang];
    const scale = off?.scale && off.scale > 0 ? off.scale : 1;
    const w = p.rect.w / scale;
    const h = p.rect.h / scale;
    const x = p.rect.x + (off?.x ?? 0) * p.rect.w + (p.rect.w - w) / 2;
    const y = p.rect.y + (off?.y ?? 0) * p.rect.h + (p.rect.h - h) / 2;
    return (
      <div className="pv-crop" key={lang} style={{ aspectRatio: `${w}/${h}` }}>
        <img
          src={url}
          alt=""
          style={{ width: `${100 / w}%`, height: `${100 / h}%`, left: `${-(x / w) * 100}%`, top: `${-(y / h) * 100}%` }}
        />
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal export-modal">
        <header className="modal-head">
          <div>
            <h2>{t('export.title')}</h2>
            <p>
              {cfg.volume} · {t('format.chapter', { chapter: cfg.chapter })} ·{' '}
              {scope === 'page'
                ? t('format.page', { page: formatNumber(sel.pageIndex + 1) })
                : t('export.subtitleChapterScope')}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="export-body">
          <div className="export-form">
            <section>
              <h3>{t('export.layoutTemplates')}</h3>
              <div className="template-list">
                {TEMPLATE_IDS.map((tpl) => (
                  <button
                    type="button"
                    key={tpl.id}
                    className={`template ${cfg.template === tpl.id ? 'on' : ''}`}
                    onClick={() => patch({ template: tpl.id })}
                  >
                    <b>{t(tpl.name)}</b>
                    <span>{t(tpl.desc)}</span>
                  </button>
                ))}
              </div>

              <div className="tpl-manager">
                <div className="tpl-row">
                  <input
                    className="input"
                    placeholder={t('export.customTemplatePlaceholder')}
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                  />
                  <button type="button" className="btn tiny" onClick={saveTemplate}>
                    {t('export.saveCurrentLayout')}
                  </button>
                </div>
                <div className="tpl-row">
                  <button type="button" className="btn tiny" onClick={() => fileRef.current?.click()}>
                    {t('export.importJson')}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importTemplateFile(f);
                      e.target.value = '';
                    }}
                  />
                  <span className="tiny muted">{t('export.templateStoreHint')}</span>
                </div>
                {templates.length > 0 && (
                  <ul className="tpl-list">
                    {templates.map((tpl) => (
                      <li key={tpl.id}>
                        <b>{tpl.name}</b>
                        <button type="button" className="link-btn" onClick={() => applyTemplate(tpl)}>
                          {t('export.apply')}
                        </button>
                        <button type="button" className="link-btn" onClick={() => exportTemplateFile(tpl)}>
                          {t('export.export')}
                        </button>
                        <button type="button" className="link-btn danger" onClick={() => removeTemplate(tpl)}>
                          {t('common.delete')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {tplMsg && <div className="tpl-msg">{tplMsg}</div>}
              </div>
            </section>

            <section>
              <h3>{t('export.titleSection')}</h3>
              <input className="input" value={cfg.title} onChange={(e) => patch({ title: e.target.value })} />
            </section>

            <section>
              <h3>{t('export.scopeSection')}</h3>
              <div className="seg">
                <button type="button" className={scope === 'page' ? 'on' : ''} onClick={() => setScope('page')}>
                  {t('export.currentPage')}
                </button>
                <button type="button" className={scope === 'chapter' ? 'on' : ''} onClick={() => setScope('chapter')}>
                  {t('export.wholeChapter', { count: formatNumber(chapterInfo?.pages.length ?? 0) })}
                </button>
              </div>
            </section>

            <section>
              <h3>{t('export.formatSection')}</h3>
              <div className="seg">
                <button type="button" className={format === 'html' ? 'on' : ''} onClick={() => setFormat('html')}>
                  {t('export.formatHtml')}
                </button>
                <button type="button" className={format === 'docx' ? 'on' : ''} onClick={() => setFormat('docx')}>
                  {t('export.formatDocx')}
                </button>
                <button type="button" className={format === 'pdf' ? 'on' : ''} onClick={() => setFormat('pdf')}>
                  {t('export.formatPdf')}
                </button>
              </div>
              {format === 'docx' && <p className="hint">{t('export.wordHint')}</p>}
              {format === 'docx' && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={cfg.includeAnnotations !== false}
                    onChange={(e) => patch({ includeAnnotations: e.target.checked })}
                  />
                  {t('export.wordIncludeAnnotations')}
                </label>
              )}
              {format === 'pdf' && <p className="hint">{t('export.pdfHint')}</p>}
              <p className="hint">{t('export.mosaicHint')}</p>
            </section>

            <section>
              <h3>{t('export.languageSection')}</h3>
              <div className="lang-chips">
                {[
                  ...cfg.languages,
                  ...allLangs.filter((l) => !cfg.languages.includes(l)),
                  ...Object.keys(page?.files ?? {}).filter((l) => !cfg.languages.includes(l) && !allLangs.includes(l)),
                ].map((l) => (
                  <button
                    type="button"
                    key={l}
                    className={`lang-chip ${cfg.languages.includes(l) ? 'on' : ''}`}
                    onClick={() =>
                      patch({
                        // Keep the user's order; newly enabled languages go last.
                        languages: cfg.languages.includes(l)
                          ? cfg.languages.filter((x) => x !== l)
                          : [...cfg.languages, l],
                      })
                    }
                    disabled={cfg.languages.length === 1 && cfg.languages.includes(l)}
                  >
                    {langShort(l)} {langLabel(l)}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3>{t('export.imageMode')}</h3>
              <label className="tb-check">
                <input
                  type="checkbox"
                  checked={!cfg.embedImages}
                  onChange={(e) => patch({ embedImages: !e.target.checked })}
                />
                {t('export.imageFilesBefore')}
                <code>.files</code>
                {t('export.imageFilesAfter')}
              </label>
              <label className="tb-check">
                <input
                  type="checkbox"
                  checked={cfg.embedImages}
                  onChange={(e) => patch({ embedImages: e.target.checked })}
                />
                {t('export.singleFileOption')}
              </label>
              <label className="tb-check">
                <input
                  type="checkbox"
                  checked={cfg.showPanelBoxes}
                  onChange={(e) => patch({ showPanelBoxes: e.target.checked })}
                />
                {t('export.showPanelBoxes')}
              </label>
              <p className="hint">{cfg.embedImages ? t('export.embedHintSingle') : t('export.embedHintFiles')}</p>
            </section>

            <section>
              <h3>{t('export.pngSection')}</h3>
              <div className="png-size-row">
                <span>{t('export.shareSizeLabel')}</span>
                <select
                  className="input"
                  value={pngSize}
                  onChange={(e) => {
                    const next = e.target.value as ShareSizeId;
                    setPngSize(next);
                    try {
                      localStorage.setItem(PNG_SIZE_KEY, next);
                    } catch {
                      /* ignored in private mode */
                    }
                  }}
                >
                  <option value={DEFAULT_SHARE_SIZE}>{t('size.auto')}</option>
                  {SHARE_SIZE_GROUPS.map((group) => (
                    <optgroup key={group.id} label={t(group.label)}>
                      {SHARE_SIZE_PRESETS.filter((p) => p.group === group.id && p.id !== DEFAULT_SHARE_SIZE).map(
                        (preset) => (
                          <option key={preset.id} value={preset.id}>
                            {t(preset.label)}
                          </option>
                        ),
                      )}
                    </optgroup>
                  ))}
                </select>
              </div>
              <p className="hint">{t('export.shareSizeHint')}</p>
              <div className="png-row">
                <button type="button" className="btn tiny" onClick={() => runPng('page')} disabled={!page || !!pngBusy}>
                  {pngBusy === 'page' ? t('export.generating') : t('export.pngPageLabel')}
                </button>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => runPng('panel')}
                  disabled={!page || !panel || !!pngBusy}
                  title={panel ? '' : t('export.panelFirstHint')}
                >
                  {pngBusy === 'panel' ? t('export.generating') : t('export.pngPanelLabel')}
                </button>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => runPng('collage')}
                  disabled={!page || !!pngBusy}
                >
                  {pngBusy === 'collage' ? t('export.generating') : t('export.pngCollageLabel')}
                </button>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={pngIncludeAnn}
                  disabled={!doc?.annotations?.length}
                  onChange={(e) => setPngIncludeAnn(e.target.checked)}
                />
                {t('export.pngIncludeAnnotations', { count: formatNumber(doc?.annotations?.length ?? 0) })}
              </label>
              <p className="hint">{t('export.pngHint')}</p>
              {pngMsg && <div className="tpl-msg">{pngMsg}</div>}
            </section>

            <section>
              <h3>{t('share.section')}</h3>
              <p className="hint">{t('share.hint')}</p>
              <div className="template-list">
                {SHARE_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={`template ${sharePreset === preset.id ? 'on' : ''}`}
                    onClick={() => {
                      setSharePreset(preset.id);
                      setShareErr(null);
                      setShareDir(null);
                      setShareFiles([]);
                      setShareWarnings([]);
                      try {
                        localStorage.setItem(SHARE_PRESET_KEY, preset.id);
                      } catch {
                        /* ignored in private mode */
                      }
                    }}
                    disabled={shareBusy}
                  >
                    <b>{t(preset.label)}</b>
                    <span>{t(preset.desc)}</span>
                  </button>
                ))}
              </div>
              {sharePreset !== 'compare' && (
                <div className="png-size-row">
                  <span>{t('share.languageLabel')}</span>
                  <select
                    className="input"
                    value={activeShareLang ?? ''}
                    onChange={(e) => setShareLang(e.target.value)}
                    disabled={shareBusy}
                  >
                    {cfg.languages.map((l) => (
                      <option key={l} value={l}>
                        {langLabel(l)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="hint">{t('share.scopeHint')}</p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={shareInfoBar}
                  onChange={(e) => setShareInfoBar(e.target.checked)}
                  disabled={shareBusy}
                />
                {t('share.infoBar')}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={shareIncludeAnn}
                  onChange={(e) => setShareIncludeAnn(e.target.checked)}
                  disabled={shareBusy}
                />
                {t('share.includeAnnotations')}
              </label>
              <p className="hint">{t('share.infoBarHint')}</p>
              <div className="png-row">
                <button type="button" className="btn" onClick={runShare} disabled={shareBusy || !page}>
                  {shareBusy ? `${t('share.exporting')}` : t('share.export')}
                </button>
                {shareBusy && shareProgress && (
                  <span className="tiny muted">
                    {t('share.progress', {
                      done: formatNumber(shareProgress.done),
                      total: formatNumber(shareProgress.total),
                    })}
                  </span>
                )}
              </div>
              {shareErr && <div className="tpl-msg">{shareErr}</div>}
              {shareDir && shareFiles.length > 0 && (
                <div className="tpl-msg">
                  <div>{t('share.done', { count: formatNumber(shareFiles.length) })}</div>
                  <div>
                    <code>{`exports\\${shareDir}`}</code>
                  </div>
                  <ul className="share-files">
                    {shareFiles.map((file) => (
                      <li key={file.name}>
                        <span>{file.name}</span>
                        <em>
                          {file.width}×{file.height} · {formatBytes(file.bytes)}
                        </em>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {shareWarnings.map((warning) => (
                <div key={warning} className="tpl-msg">
                  {warning}
                </div>
              ))}
            </section>

            <section>
              <h3>{t('export.scopeHeading')}</h3>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={Boolean(cfg.onlyWithNotes)}
                  onChange={(e) => patch({ onlyWithNotes: e.target.checked })}
                />
                {t('export.onlyWithNotes')}
              </label>
              <p className="hint">{t('export.onlyWithNotesHint')}</p>
            </section>

            <section>
              <h3>{t('export.layoutSection')}</h3>
              <label className="slider-row">
                <span>{t('export.imageWidth')}</span>
                <input
                  type="range"
                  min={28}
                  max={75}
                  value={cfg.pageWidthRatio}
                  onChange={(e) => patch({ pageWidthRatio: Number(e.target.value) })}
                />
                <em>{cfg.pageWidthRatio}%</em>
              </label>
              <label className="slider-row">
                <span>{t('export.columnGap')}</span>
                <input
                  type="range"
                  min={0}
                  max={64}
                  value={cfg.columnGap}
                  onChange={(e) => patch({ columnGap: Number(e.target.value) })}
                />
                <em>{cfg.columnGap}px</em>
              </label>
              <label className="slider-row">
                <span>{t('export.fontSize')}</span>
                <input
                  type="range"
                  min={0.8}
                  max={1.4}
                  step={0.05}
                  value={cfg.fontScale}
                  onChange={(e) => patch({ fontScale: Number(e.target.value) })}
                />
                <em>{Math.round(cfg.fontScale * 100)}%</em>
              </label>
              {cfg.template === 'compare-wide' && (
                <label className="slider-row">
                  <span>{t('export.columnsPerRow')}</span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    value={cfg.columns}
                    onChange={(e) => patch({ columns: Number(e.target.value) })}
                  />
                  <em>{t('export.columnCount', { count: formatNumber(cfg.columns) })}</em>
                </label>
              )}
              <p className="hint">{t('export.layoutHint')}</p>
            </section>

            {tagStats.length > 0 && (
              <section>
                <h3>{t('export.tagFilterHeading')}</h3>
                <div className="tag-cloud">
                  {tagStats.map((tag) => (
                    <button
                      type="button"
                      key={tag.tag}
                      className={`tag ${cfg.noteFilterTags.includes(tag.tag) ? 'on' : ''}`}
                      onClick={() =>
                        patch({
                          noteFilterTags: cfg.noteFilterTags.includes(tag.tag)
                            ? cfg.noteFilterTags.filter((x) => x !== tag.tag)
                            : [...cfg.noteFilterTags, tag.tag],
                        })
                      }
                    >
                      {tag.tag} <em>{formatNumber(tag.count)}</em>
                    </button>
                  ))}
                </div>
                {cfg.noteFilterTags.length > 0 && (
                  <button type="button" className="link-btn" onClick={() => patch({ noteFilterTags: [] })}>
                    {t('export.clearFilters')}
                  </button>
                )}
              </section>
            )}
          </div>

          <div className="export-preview-wrap">
            <div className="preview-label">{t('export.previewLabel')}</div>
            <div className="export-preview" ref={previewRef}>
              <div className="pv-title">{cfg.title}</div>
              {cfg.template === 'compare-wide' ? (
                <div className="pv-compare">
                  {ordered.slice(0, 3).map((p, i) => (
                    <div className="pv-row" key={p.id}>
                      <span>{t('format.panel', { number: formatNumber(i + 1) })}</span>
                      <div className="pv-crops" style={{ gridTemplateColumns: `repeat(${cfg.languages.length},1fr)` }}>
                        {cfg.languages.map((l) => renderCrop(p, l))}
                      </div>
                    </div>
                  ))}
                  {!ordered.length && <div className="pv-empty">{t('export.previewEmptyPanels')}</div>}
                </div>
              ) : (
                <div
                  className={`pv-body ${cfg.template}`}
                  style={
                    cfg.template === 'two-column'
                      ? { gridTemplateColumns: `${cfg.pageWidthRatio}% 1fr`, gap: `${cfg.columnGap / 2}px` }
                      : { gap: `${cfg.columnGap / 2}px` }
                  }
                >
                  <div className="pv-page">
                    {previewUrl ? <img src={previewUrl} alt="" /> : <span>{t('export.noImage')}</span>}
                  </div>
                  <div className="pv-notes">
                    {pageNotes.length > 0 && (
                      <div className="pv-note-group">
                        <h4>{t('export.pageNotes')}</h4>
                        {pageNotes.map((n) => (
                          <p key={n.id}>{n.text}</p>
                        ))}
                      </div>
                    )}
                    {ordered.slice(0, 4).map((p, i) => {
                      const notes = doc?.notes.filter((n) => n.panelId === p.id) ?? [];
                      if (!notes.length) return null;
                      return (
                        <div className="pv-note-group" key={p.id}>
                          <h4>{t('format.panel', { number: formatNumber(i + 1) })}</h4>
                          {notes.map((n) => (
                            <p key={n.id}>{n.text}</p>
                          ))}
                        </div>
                      );
                    })}
                    {!pageNotes.length && !doc?.notes.some((n) => n.scope === 'panel') && (
                      <div className="pv-empty">{t('export.previewEmptyNotes')}</div>
                    )}
                  </div>
                </div>
              )}
              {cfg.template === 'two-column' && (
                <div
                  className="pv-handle"
                  style={{ left: `${cfg.pageWidthRatio}%` }}
                  onPointerDown={() => setResizing(true)}
                  title={t('export.dragHandleTitle')}
                />
              )}
            </div>

            {result && (
              <div className="export-result">
                <div>
                  {t('export.exportedPages', { pages: formatNumber(result.pages) })} <code>{result.file}</code>
                </div>
                {resultFormat !== 'docx' && (
                  <>
                    {resultFormat === 'pdf' && <div className="tiny muted">{t('export.printHint')}</div>}
                    <div className="tiny muted">
                      {result.imageMode === 'embed'
                        ? t('export.imagesEmbedded')
                        : t('export.imageDir', {
                            path: `${rootPath ? `${rootPath}\\exports\\` : 'exports/'}${result.assetDir ?? ''}`,
                          })}
                    </div>
                    <div className="row-actions">
                      <a className="btn primary" href={result.url} target="_blank" rel="noreferrer">
                        {resultFormat === 'pdf' ? t('export.openPrint') : t('export.openHtml')}
                      </a>
                      <a className="btn" href={`/api/export/download?file=${encodeURIComponent(result.file)}`}>
                        {t('export.downloadHtml')}
                      </a>
                      {result.assetDir && <span className="tiny muted">{t('export.filesNote')}</span>}
                    </div>
                  </>
                )}
                {resultFormat === 'docx' && (
                  <div className="row-actions">
                    <a className="btn primary" href={`/api/export/download?file=${encodeURIComponent(result.file)}`}>
                      {t('export.downloadDocx')}
                    </a>
                  </div>
                )}
                {result.warnings.length > 0 && (
                  <ul className="warn-list">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {error && <div className="export-error">{error}</div>}
          </div>
        </div>

        <footer className="modal-foot">
          <span className="muted tiny">{t('export.footerHint')}</span>
          <div className="row-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('common.close')}
            </button>
            <button type="button" className="btn primary" onClick={generate} disabled={busy}>
              {busy
                ? t('export.generating')
                : format === 'docx'
                  ? t('export.generateDocx')
                  : format === 'pdf'
                    ? t('export.generatePdf')
                    : t('export.generateHtml')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
