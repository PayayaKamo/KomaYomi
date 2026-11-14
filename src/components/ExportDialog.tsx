import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExportConfig, ExportTemplate, Lang, Library, PageDoc, PageEntry, Panel } from '../types';
import { DEFAULT_EXPORT_CONFIG, LANG_LABEL, LANGUAGES, LANG_SHORT } from '../types';
import { api } from '../api';
import { sortPanels } from '../lib/geometry';
import { exportPng } from '../lib/pngExport';
import type { Selection } from '../hooks/usePage';

type Props = {
  open: boolean;
  onClose: () => void;
  doc: PageDoc | null;
  page: PageEntry | null;
  /** 当前选中的格子，用于「导出当前格」PNG */
  panel: Panel | null;
  library: Library | null;
  sel: Selection | null;
  langs: Lang[];
  tagStats: { tag: string; count: number }[];
  /** 项目根目录，展示导出文件的绝对路径 */
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

const TEMPLATES: { id: ExportConfig['template']; name: string; desc: string }[] = [
  { id: 'two-column', name: '左图右注', desc: '左侧漫画原图，右侧整页与分格批注' },
  { id: 'stack', name: '上图下注', desc: '图片占满宽度，批注在下方展开' },
  { id: 'compare-wide', name: '分格对照', desc: '逐格并排展示多种语言，附该格批注' },
];

const LAYOUT_KEY = 'manga-memo.export-layout';

/** 只把版式相关的字段挑出来，供模板保存与本地记忆使用 */
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
  tagStats,
  rootPath,
}: Props) {
  const [cfg, setCfg] = useState<ExportConfig | null>(null);
  const [scope, setScope] = useState<'page' | 'chapter'>('page');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  // 自定义导出模板
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [tplName, setTplName] = useState('');
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // PNG 导出状态
  const [pngBusy, setPngBusy] = useState<string | null>(null);
  const [pngMsg, setPngMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sel) return;
    setResult(null);
    setError(null);
    setScope('page');
    setPngMsg(null);
    setTplMsg(null);
    setCfg({
      ...DEFAULT_EXPORT_CONFIG,
      ...(readLayout() ?? {}),
      title: `${sel.chapter} 对照批注`,
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
  }, [open, sel, langs, doc?.offsets]);

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
      /* 隐私模式等场景忽略 */
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: ExportConfig = {
        ...cfg,
        pageIndices: scope === 'page' ? [sel.pageIndex] : [],
      };
      const res = await api.exportHtml(payload);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pngBase = page ? `${safeName(sel.volume)}-${safeName(sel.chapter)}-P${sel.pageIndex + 1}` : 'page';

  const runPng = async (mode: 'page' | 'panel' | 'collage') => {
    if (!page) return;
    const label = mode === 'page' ? '整页' : mode === 'panel' ? '单格' : '三语拼图';
    setPngBusy(mode);
    setPngMsg(null);
    try {
      const fileLang = cfg.languages.find((l) => page.files[l]) ?? 'ja';
      await exportPng({
        page,
        lang: fileLang,
        langs: cfg.languages,
        rect: mode === 'collage' ? panel?.rect ?? null : mode === 'panel' ? panel?.rect ?? null : null,
        mode,
        filenameBase: `${pngBase}-${label}`,
      });
      setPngMsg(`已生成 ${label} PNG，请查看浏览器下载目录`);
    } catch (err) {
      setPngMsg(`PNG 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPngBusy(null);
    }
  };

  const saveTemplate = async () => {
    const name = tplName.trim() || `${cfg.template} 模板`;
    try {
      const res = await api.saveExportTemplate(name, layoutOf(cfg));
      setTemplates((prev) => [res.template, ...prev]);
      setTplName('');
      setTplMsg(`已保存模板「${name}」`);
    } catch (err) {
      setTplMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const applyTemplate = (t: ExportTemplate) => {
    patch({ ...t.config });
    setTplMsg(`已套用模板「${t.name}」`);
  };

  const removeTemplate = async (t: ExportTemplate) => {
    try {
      await api.deleteExportTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      setTplMsg(`已删除「${t.name}」`);
    } catch (err) {
      setTplMsg(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const exportTemplateFile = (t: ExportTemplate) => {
    const blob = new Blob([JSON.stringify({ name: t.name, config: t.config }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName(t.name)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importTemplateFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as { name?: string; config?: Partial<ExportConfig> };
      if (!data || typeof data !== 'object' || !data.config) throw new Error('文件里没有 config 字段');
      const res = await api.saveExportTemplate(data.name || file.name.replace(/\.json$/i, ''), data.config);
      setTemplates((prev) => [res.template, ...prev]);
      setTplMsg(`已导入模板「${res.template.name}」`);
    } catch (err) {
      setTplMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const previewUrl = page?.files[cfg.languages.find((l) => page?.files[l]) ?? 'ja'] ?? '';
  const ordered = doc ? sortPanels(doc.panels, doc.readingDirection) : [];
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
            <h2>导出</h2>
            <p>
              {cfg.volume} · 第 {cfg.chapter} 话 · {scope === 'page' ? `第 ${sel.pageIndex + 1} 页` : '整话已标注页'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="export-body">
          <div className="export-form">
            <section>
              <h3>版式模板</h3>
              <div className="template-list">
                {TEMPLATES.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={`template ${cfg.template === t.id ? 'on' : ''}`}
                    onClick={() => patch({ template: t.id })}
                  >
                    <b>{t.name}</b>
                    <span>{t.desc}</span>
                  </button>
                ))}
              </div>

              <div className="tpl-manager">
                <div className="tpl-row">
                  <input
                    className="input"
                    placeholder="自定义模板名"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                  />
                  <button type="button" className="btn tiny" onClick={saveTemplate}>
                    保存当前版式
                  </button>
                </div>
                <div className="tpl-row">
                  <button type="button" className="btn tiny" onClick={() => fileRef.current?.click()}>
                    导入 JSON
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
                  <span className="tiny muted">模板存于 data/templates/export.json</span>
                </div>
                {templates.length > 0 && (
                  <ul className="tpl-list">
                    {templates.map((t) => (
                      <li key={t.id}>
                        <b>{t.name}</b>
                        <button type="button" className="link-btn" onClick={() => applyTemplate(t)}>
                          套用
                        </button>
                        <button type="button" className="link-btn" onClick={() => exportTemplateFile(t)}>
                          导出
                        </button>
                        <button type="button" className="link-btn danger" onClick={() => removeTemplate(t)}>
                          删除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {tplMsg && <div className="tpl-msg">{tplMsg}</div>}
              </div>
            </section>

            <section>
              <h3>标题</h3>
              <input className="input" value={cfg.title} onChange={(e) => patch({ title: e.target.value })} />
            </section>

            <section>
              <h3>范围</h3>
              <div className="seg">
                <button type="button" className={scope === 'page' ? 'on' : ''} onClick={() => setScope('page')}>
                  当前页
                </button>
                <button type="button" className={scope === 'chapter' ? 'on' : ''} onClick={() => setScope('chapter')}>
                  整话（{chapterInfo?.pages.length ?? 0} 页）
                </button>
              </div>
            </section>

            <section>
              <h3>语言</h3>
              <div className="lang-chips">
                {LANGUAGES.map((l) => (
                  <button
                    type="button"
                    key={l}
                    className={`lang-chip ${cfg.languages.includes(l) ? 'on' : ''}`}
                    onClick={() =>
                      patch({
                        languages: cfg.languages.includes(l)
                          ? cfg.languages.filter((x) => x !== l)
                          : LANGUAGES.filter((x) => cfg.languages.includes(x) || x === l),
                      })
                    }
                    disabled={cfg.languages.length === 1 && cfg.languages.includes(l)}
                  >
                    {LANG_SHORT[l]} {LANG_LABEL[l]}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3>图片方式</h3>
              <label className="tb-check">
                <input
                  type="checkbox"
                  checked={!cfg.embedImages}
                  onChange={(e) => patch({ embedImages: !e.target.checked })}
                />
                图片放同名 <code>.files</code> 目录（默认，体积小、加载快）
              </label>
              <label className="tb-check">
                <input
                  type="checkbox"
                  checked={cfg.embedImages}
                  onChange={(e) => patch({ embedImages: e.target.checked })}
                />
                打包成单文件（内嵌图片，外发分享用）
              </label>
              <label className="tb-check">
                <input
                  type="checkbox"
                  checked={cfg.showPanelBoxes}
                  onChange={(e) => patch({ showPanelBoxes: e.target.checked })}
                />
                在原图上标出格子边框
              </label>
              <p className="hint">
                {cfg.embedImages
                  ? '单文件可直接双击打开，但整话可能几十 MB，生成较慢。'
                  : 'HTML 与 .files 目录需一起拷贝；通过本应用或任意静态服务器打开即可看到图。'}
              </p>
            </section>

            <section>
              <h3>导出 PNG</h3>
              <div className="png-row">
                <button type="button" className="btn tiny" onClick={() => runPng('page')} disabled={!page || !!pngBusy}>
                  {pngBusy === 'page' ? '生成中…' : '整页'}
                </button>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => runPng('panel')}
                  disabled={!page || !panel || !!pngBusy}
                  title={panel ? '' : '先在左侧选择一个格子'}
                >
                  {pngBusy === 'panel' ? '生成中…' : '当前格'}
                </button>
                <button type="button" className="btn tiny" onClick={() => runPng('collage')} disabled={!page || !!pngBusy}>
                  {pngBusy === 'collage' ? '生成中…' : '三语拼图'}
                </button>
              </div>
              <p className="hint">
                整页/单格用当前首选语言；拼图按所选语言并排（若选中格子则只拼该格）。PNG 直接插入 PPT / 文档。
              </p>
              {pngMsg && <div className="tpl-msg">{pngMsg}</div>}
            </section>

            <section>
              <h3>导出范围</h3>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={Boolean(cfg.onlyWithNotes)}
                  onChange={(e) => patch({ onlyWithNotes: e.target.checked })}
                />
                只导出有笔记的页
              </label>
              <p className="hint">跳过没有笔记的页，适合整理学习笔记合集。</p>
            </section>

            <section>
              <h3>版式</h3>
              <label className="slider-row">
                <span>图栏宽度</span>
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
                <span>栏目间距</span>
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
                <span>字号</span>
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
                  <span>每行列数</span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    value={cfg.columns}
                    onChange={(e) => patch({ columns: Number(e.target.value) })}
                  />
                  <em>{cfg.columns} 列</em>
                </label>
              )}
              <p className="hint">版式会自动记住；拖动右侧预览里的分隔线也能调图栏宽度。</p>
            </section>

            {tagStats.length > 0 && (
              <section>
                <h3>只导出含这些标签的批注</h3>
                <div className="tag-cloud">
                  {tagStats.map((t) => (
                    <button
                      type="button"
                      key={t.tag}
                      className={`tag ${cfg.noteFilterTags.includes(t.tag) ? 'on' : ''}`}
                      onClick={() =>
                        patch({
                          noteFilterTags: cfg.noteFilterTags.includes(t.tag)
                            ? cfg.noteFilterTags.filter((x) => x !== t.tag)
                            : [...cfg.noteFilterTags, t.tag],
                        })
                      }
                    >
                      {t.tag} <em>{t.count}</em>
                    </button>
                  ))}
                </div>
                {cfg.noteFilterTags.length > 0 && (
                  <button type="button" className="link-btn" onClick={() => patch({ noteFilterTags: [] })}>
                    清除筛选
                  </button>
                )}
              </section>
            )}
          </div>

          <div className="export-preview-wrap">
            <div className="preview-label">版式预览（可拖动分隔线）</div>
            <div className="export-preview" ref={previewRef}>
              <div className="pv-title">{cfg.title}</div>
              {cfg.template === 'compare-wide' ? (
                <div className="pv-compare">
                  {ordered.slice(0, 3).map((p, i) => (
                    <div className="pv-row" key={p.id}>
                      <span>第 {i + 1} 格</span>
                      <div className="pv-crops" style={{ gridTemplateColumns: `repeat(${cfg.languages.length},1fr)` }}>
                        {cfg.languages.map((l) => renderCrop(p, l))}
                      </div>
                    </div>
                  ))}
                  {!ordered.length && <div className="pv-empty">本页还没有分格</div>}
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
                  <div className="pv-page">{previewUrl ? <img src={previewUrl} alt="" /> : <span>无图片</span>}</div>
                  <div className="pv-notes">
                    {pageNotes.length > 0 && (
                      <div className="pv-note-group">
                        <h4>整页批注</h4>
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
                          <h4>第 {i + 1} 格</h4>
                          {notes.map((n) => (
                            <p key={n.id}>{n.text}</p>
                          ))}
                        </div>
                      );
                    })}
                    {!pageNotes.length && !doc?.notes.some((n) => n.scope === 'panel') && (
                      <div className="pv-empty">暂无批注内容</div>
                    )}
                  </div>
                </div>
              )}
              {cfg.template === 'two-column' && (
                <div
                  className="pv-handle"
                  style={{ left: `${cfg.pageWidthRatio}%` }}
                  onPointerDown={() => setResizing(true)}
                  title="拖动调整图栏宽度"
                />
              )}
            </div>

            {result && (
              <div className="export-result">
                <div>
                  已导出 {result.pages} 页 → <code>{result.file}</code>
                </div>
                <div className="tiny muted">
                  {result.imageMode === 'embed'
                    ? '图片已内嵌，单文件即可分享'
                    : `图片目录：${rootPath ? `${rootPath}\\exports\\` : 'exports/'}${result.assetDir ?? ''}`}
                </div>
                <div className="row-actions">
                  <a className="btn primary" href={result.url} target="_blank" rel="noreferrer">
                    打开 HTML
                  </a>
                  <a className="btn" href={`/api/export/download?file=${encodeURIComponent(result.file)}`}>
                    下载 HTML
                  </a>
                  {result.assetDir && (
                    <span className="tiny muted">（.files 目录需一并拷贝）</span>
                  )}
                </div>
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
          <span className="muted tiny">输出到项目 exports/ 目录，HTML 可直接在浏览器打开</span>
          <div className="row-actions">
            <button type="button" className="btn" onClick={onClose}>
              关闭
            </button>
            <button type="button" className="btn primary" onClick={generate} disabled={busy}>
              {busy ? '生成中…' : '生成 HTML'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
