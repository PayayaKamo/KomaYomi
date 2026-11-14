import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note, NoteSource, PageDoc, Panel } from '../types';
import type { Library } from '../types';
import { formatTime, newNote, sourceDomain } from '../lib/geometry';
import { renderMarkdown } from '../../shared/markdown';
import { api } from '../api';
import type { NotesIndex } from '../api';
import type { Selection } from '../hooks/usePage';

type Props = {
  doc: PageDoc | null;
  panel: Panel | null;
  panelLabel: string;
  mutate: (fn: (doc: PageDoc) => PageDoc) => void;
  tagStats: { tag: string; count: number }[];
  library: Library | null;
  /** 跳到某页的某格（总览/搜索命中后使用） */
  onJump: (sel: Selection, panelId: string | null) => void;
  onClose?: () => void;
};

/* ---------------- Markdown 编辑器：编辑 / 实时预览 ---------------- */

type EditorProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  rows?: number;
};

function MarkdownEditor({ value, placeholder, onChange, onSubmit, rows = 4 }: EditorProps) {
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const apply = (transform: (sel: string) => string, fallback: string) => {
    const el = ref.current;
    if (!el) {
      onChange(value + fallback);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const inserted = transform(selected);
    onChange(value.slice(0, start) + inserted + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + inserted.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const wrap = (mark: string, placeholderText: string) =>
    apply((sel) => `${mark}${sel || placeholderText}${mark}`, `${mark}${placeholderText}${mark}`);

  const prefixLines = (prefix: string) =>
    apply(
      (sel) =>
        (sel || '列表项')
          .split('\n')
          .map((line) => `${prefix}${line}`)
          .join('\n'),
      `${prefix}列表项`,
    );

  const keydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**', '加粗');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('*', '斜体');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      apply((sel) => `[${sel || '链接文字'}](https://)`, '[链接文字](https://)');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      apply((sel) => sel || '  ', '  ');
    }
  };

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        <button type="button" title="加粗（Ctrl+B）" onClick={() => wrap('**', '加粗')}>
          <b>B</b>
        </button>
        <button type="button" title="斜体（Ctrl+I）" onClick={() => wrap('*', '斜体')}>
          <i>I</i>
        </button>
        <button type="button" title="无序列表" onClick={() => prefixLines('- ')}>
          • 列表
        </button>
        <button type="button" title="引用" onClick={() => prefixLines('> ')}>
          ❝ 引用
        </button>
        <button type="button" title="行内代码" onClick={() => wrap('`', 'code')}>
          {'</>'}
        </button>
        <button type="button" title="链接（Ctrl+K）" onClick={() => apply((sel) => `[${sel || '链接文字'}](https://)`, '[链接文字](https://)')}>
          ↗ 链接
        </button>
        <span className="spacer" />
        <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview((v) => !v)} title="切换编辑 / 预览">
          {preview ? '编辑' : '预览'}
        </button>
      </div>
      {preview ? (
        value.trim() ? (
          <div className="md-body md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
        ) : (
          <div className="md-preview muted tiny">（空）</div>
        )
      ) : (
        <textarea
          ref={ref}
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={keydown}
        />
      )}
      <div className="md-hint muted tiny">
        Markdown：**加粗**、*斜体*、- 列表、&gt; 引用、``` 代码块 ```、| 表格 |；Ctrl+Enter 保存
      </div>
    </div>
  );
}

/* ---------------- 随手记暂存 ---------------- */

type ScratchItem = { id: string; text: string; createdAt: string };
const SCRATCH_KEY = 'manga-memo.scratchpad';

function loadScratch(): ScratchItem[] {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY);
    const list = raw ? (JSON.parse(raw) as ScratchItem[]) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.text === 'string') : [];
  } catch {
    return [];
  }
}

/* ---------------- 复制给大模型的上下文 ---------------- */

const TEMPLATE_KEY = 'manga-memo.context-template';
const DEFAULT_TEMPLATE =
  '我在精读《{volume}》第 {chapter} 话 第 {page} 页{panel}，下面是我记的笔记：\n\n{notes}\n\n请帮我解释其中的语言点、语气、文化背景，并指出我的理解是否有误。';

function loadTemplate(): string {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE;
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

/* ---------------- 笔记面板 ---------------- */

const ROW_H = 96;

type FlatRow =
  | { kind: 'header'; label: string; count: number }
  | { kind: 'note'; note: NotesIndex['notes'][number] };

export function NotesPanel({ doc, panel, panelLabel, mutate, tagStats, library, onJump, onClose }: Props) {
  const [tab, setTab] = useState<'page' | 'all'>('page');
  const [scope, setScope] = useState<'page' | 'panel'>('page');
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [sourceIds, setSourceIds] = useState<Record<string, boolean>>({});

  // 来源
  const [sourceOpen, setSourceOpen] = useState(false);
  const [srcUrl, setSrcUrl] = useState('');
  const [srcTitle, setSrcTitle] = useState('');
  const [srcText, setSrcText] = useState('');
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleMsg, setTitleMsg] = useState<string | null>(null);

  // 随手记
  const [scratch, setScratch] = useState<ScratchItem[]>(loadScratch);
  const [scratchDraft, setScratchDraft] = useState('');
  const [scratchOpen, setScratchOpen] = useState(false);

  // 复制上下文
  const [contextNotes, setContextNotes] = useState<{ notes: Note[]; single?: Note } | null>(null);
  const [template, setTemplate] = useState(loadTemplate);
  const [copied, setCopied] = useState(false);

  // 总览 / 搜索
  const [query, setQuery] = useState('');
  const [fVolume, setFVolume] = useState('');
  const [fChapter, setFChapter] = useState('');
  const [fPage, setFPage] = useState('');
  const [groupBy, setGroupBy] = useState<'chapter' | 'tag' | 'source'>('chapter');
  const [result, setResult] = useState<NotesIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset the composer when the target panel/page changes. Keying on primitives
  // avoids re-running this whenever an unrelated field of the page doc mutates.
  const currentPanelId = panel?.id ?? null;
  const currentPageKey = `${doc?.chapter ?? ''}|${doc?.pageIndex ?? -1}`;
  useEffect(() => {
    setScope(panel ? 'panel' : 'page');
    setText('');
    setTags([]);
    setTagInput('');
    setSourceOpen(false);
    setSrcUrl('');
    setSrcTitle('');
    setSrcText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPanelId, currentPageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(SCRATCH_KEY, JSON.stringify(scratch));
    } catch {
      /* 忽略隐私模式 */
    }
  }, [scratch]);
  useEffect(() => {
    try {
      localStorage.setItem(TEMPLATE_KEY, template);
    } catch {
      /* ignore */
    }
  }, [template]);

  // 粘贴/输入正文时自动识别第一个 URL（标题抓取仍是可选的按钮）
  useEffect(() => {
    if (srcUrl) return;
    const match = text.match(/https?:\/\/[^\s)>\]]+/);
    if (match) {
      setSrcUrl(match[0]);
      setSourceOpen(true);
    }
  }, [text, srcUrl]);

  // 搜索（300ms 防抖），并随当前文档变化刷新总览
  useEffect(() => {
    if (tab !== 'all') return;
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .notes({
          q: query.trim(),
          tag: filterTag ?? '',
          source: filterSource ?? '',
          volume: fVolume,
          chapter: fChapter,
          pageIndex: fPage ? Number(fPage) : undefined,
          limit: 800,
        })
        .then((res) => {
          if (alive) setResult(res);
        })
        .catch(() => {
          if (alive) setResult(null);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [tab, query, filterTag, filterSource, fVolume, fChapter, fPage, doc?.updatedAt]);

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tagStats) m.set(t.tag, t.count);
    for (const n of doc?.notes ?? []) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }, [doc, tagStats]);

  const suggestions = useMemo(() => {
    const q = tagInput.trim();
    return allTags
      .filter((t) => !tags.includes(t.tag))
      .filter((t) => (q ? t.tag.includes(q) : true))
      .slice(0, 8);
  }, [allTags, tagInput, tags]);

  const notes = doc?.notes ?? [];
  const panelNotes = panel ? notes.filter((n) => n.scope === 'panel' && n.panelId === panel.id) : [];
  const pageNotes = notes.filter((n) => n.scope === 'page');
  const shown = (list: Note[]) =>
    list.filter((n) => (!filterTag || n.tags.includes(filterTag)) && (!filterSource || sourceDomain(n.source) === filterSource));

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput('');
  };

  const currentSource = (): NoteSource | undefined => {
    if (!srcUrl.trim() && !srcTitle.trim() && !srcText.trim()) return undefined;
    return {
      url: srcUrl.trim() || undefined,
      title: srcTitle.trim() || undefined,
      text: srcText.trim() || undefined,
    };
  };

  const submit = () => {
    if (!doc || !text.trim()) return;
    if (scope === 'panel' && !panel) return;
    const note = newNote(scope, scope === 'panel' && panel ? panel.id : null, text.trim(), tags, currentSource());
    mutate((d) => ({ ...d, notes: [...d.notes, note] }));
    setText('');
    setTags([]);
    setTagInput('');
    setSrcUrl('');
    setSrcTitle('');
    setSrcText('');
    setSourceOpen(false);
  };

  const removeNote = (id: string) => {
    mutate((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
  };

  const saveEdit = () => {
    if (!editing) return;
    mutate((d) => ({
      ...d,
      notes: d.notes.map((n) =>
        n.id === editing.id ? { ...n, text: editing.text, updatedAt: new Date().toISOString() } : n,
      ),
    }));
    setEditing(null);
  };

  const grabTitle = async () => {
    if (!srcUrl.trim()) return;
    setTitleBusy(true);
    setTitleMsg(null);
    try {
      const res = await api.fetchLinkTitle(srcUrl.trim());
      if (res.title) setSrcTitle(res.title);
      setTitleMsg(res.title ? '已抓取标题' : res.warning ?? '没有找到标题，可手动填写');
    } catch (err) {
      setTitleMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTitleBusy(false);
    }
  };

  const addScratch = () => {
    if (!scratchDraft.trim()) return;
    setScratch([
      { id: `s${Date.now().toString(36)}`, text: scratchDraft.trim(), createdAt: new Date().toISOString() },
      ...scratch,
    ]);
    setScratchDraft('');
  };

  const placeScratch = (item: ScratchItem, target: 'page' | 'panel') => {
    if (!doc) return;
    if (target === 'panel' && !panel) return;
    const note = newNote(target, target === 'panel' && panel ? panel.id : null, item.text, tags, currentSource());
    mutate((d) => ({ ...d, notes: [...d.notes, note] }));
    setScratch(scratch.filter((s) => s.id !== item.id));
  };

  const buildContext = (data: { notes: Note[]; single?: Note }) => {
    const body = data.single
      ? data.single.text
      : data.notes
          .map((n) => {
            const src = n.source
              ? `\n  来源：${[n.source.title, n.source.url, n.source.text].filter(Boolean).join(' · ')}`
              : '';
            return `- ${n.text}${src}`;
          })
          .join('\n');
    return template
      .replace(/\{volume\}/g, doc?.volume ?? '')
      .replace(/\{chapter\}/g, doc?.chapter ?? '')
      .replace(/\{page\}/g, doc ? String(doc.pageIndex + 1) : '')
      .replace(/\{panel\}/g, scope === 'panel' && panel ? ` ${panelLabel}` : '')
      .replace(/\{notes\}/g, body)
      .replace(/\{text\}/g, data.single?.text ?? body)
      .replace(/\{tags\}/g, (data.single?.tags ?? tags).join(', '));
  };

  const copyContext = async () => {
    if (!contextNotes) return;
    try {
      await navigator.clipboard.writeText(buildContext(contextNotes));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const renderNote = (note: Note) => (
    <div className="note" key={note.id}>
      <div className="note-top">
        <div className="note-tags">
          {note.tags.map((t) => (
            <button
              type="button"
              key={t}
              className={`tag ${filterTag === t ? 'on' : ''}`}
              onClick={() => setFilterTag(filterTag === t ? null : t)}
              title="按标签筛选"
            >
              {t}
            </button>
          ))}
        </div>
        <span className="note-time">{formatTime(note.createdAt)}</span>
      </div>
      {editing?.id === note.id ? (
        <div className="note-edit">
          <MarkdownEditor value={editing.text} onChange={(v) => setEditing({ ...editing, text: v })} onSubmit={saveEdit} placeholder="Markdown 笔记…" />
          <div className="row-actions">
            <button type="button" className="btn tiny primary" onClick={saveEdit}>
              保存
            </button>
            <button type="button" className="btn tiny" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </div>
      ) : sourceIds[note.id] ? (
        <pre className="note-source">{note.text}</pre>
      ) : (
        <div className="note-text md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.text) }} />
      )}
      {note.source && (note.source.url || note.source.title || note.source.text) && (
        <div className="note-src-line" title={note.source.url}>
          {note.source.url ? (
            <a href={note.source.url} target="_blank" rel="noreferrer noopener">
              {note.source.title || sourceDomain(note.source)}
            </a>
          ) : (
            <span>{note.source.title || note.source.text}</span>
          )}
          {note.source.url && <em>{sourceDomain(note.source)}</em>}
          {note.source.text && <em>{note.source.text}</em>}
        </div>
      )}
      {editing?.id !== note.id && (
        <div className="note-actions">
          <button type="button" onClick={() => setEditing({ id: note.id, text: note.text })}>
            编辑
          </button>
          <button
            type="button"
            onClick={() => setSourceIds((s) => ({ ...s, [note.id]: !s[note.id] }))}
            title="在渲染结果与 Markdown 源码之间切换"
          >
            {sourceIds[note.id] ? '渲染' : '源码'}
          </button>
          <button type="button" onClick={() => setContextNotes({ notes: [note], single: note })} title="复制卷/话/页/格与这条笔记">
            复制上下文
          </button>
          <button type="button" onClick={() => removeNote(note.id)}>
            删除
          </button>
        </div>
      )}
    </div>
  );

  /* ---- 随手记面板（有页/无页都可用） ---- */
  const scratchPanel = (
    <div className="scratch">
      <button type="button" className={`scratch-toggle ${scratchOpen ? 'on' : ''}`} onClick={() => setScratchOpen((v) => !v)}>
        随手记暂存 <em>{scratch.length}</em>
      </button>
      {scratchOpen && (
        <div className="scratch-body">
          <textarea
            rows={2}
            value={scratchDraft}
            placeholder="先记下来，稍后归到具体的页/格…（Ctrl+Enter 记下）"
            onChange={(e) => setScratchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                addScratch();
              }
            }}
          />
          <button type="button" className="btn tiny" onClick={addScratch} disabled={!scratchDraft.trim()}>
            记下
          </button>
          {scratch.map((item) => (
            <div className="scratch-item" key={item.id}>
              <div className="scratch-text">{item.text}</div>
              <div className="scratch-actions">
                <span className="muted tiny">{formatTime(item.createdAt)}</span>
                <button type="button" className="btn tiny" onClick={() => placeScratch(item, 'page')} disabled={!doc}>
                  归到本页
                </button>
                <button type="button" className="btn tiny" onClick={() => placeScratch(item, 'panel')} disabled={!panel}>
                  归到本格
                </button>
                <button type="button" className="btn tiny" onClick={() => setScratch(scratch.filter((s) => s.id !== item.id))}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* ---- 总览：按话 / 标签 / 来源聚合 + 虚拟滚动 ---- */
  const flat = useMemo<FlatRow[]>(() => {
    if (!result) return [];
    const headers = new Map<string, FlatRow & { kind: 'header' }>();
    const rows: FlatRow[] = [];
    for (const note of result.notes) {
      const key =
        groupBy === 'chapter'
          ? `${note.volume}/${note.chapter}`
          : groupBy === 'tag'
            ? note.tags[0] ?? '未打标签'
            : note.domain || '无来源';
      const label =
        groupBy === 'chapter'
          ? `${note.volume} · 第 ${note.chapter} 话`
          : groupBy === 'tag'
            ? key === '未打标签'
              ? '未打标签'
              : `# ${key}`
            : key;
      let header = headers.get(key);
      if (!header) {
        header = { kind: 'header', label, count: 0 };
        headers.set(key, header);
        rows.push(header);
      }
      header.count++;
      rows.push({ kind: 'note', note });
    }
    return rows;
  }, [result, groupBy]);

  const totalHeight = flat.length * ROW_H;
  const windowStart = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const windowEnd = Math.min(flat.length, Math.ceil((scrollTop + (listRef.current?.clientHeight ?? 600)) / ROW_H) + 6);

  const chaptersForVolume = useMemo(() => {
    const vol = library?.volumes.find((v) => v.id === fVolume);
    return vol?.chapters.map((c) => c.chapter) ?? [];
  }, [library, fVolume]);

  if (!doc) {
    return (
      <aside className="notes-col">
        <div className="notes-head">
          <div className="notes-title">学习笔记</div>
        </div>
        <div className="notes-empty">选择一页后可以在这里写批注；也可以先记在暂存区。</div>
        {scratchPanel}
        {contextNotes && <ContextDialog notes={contextNotes} build={buildContext} onClose={() => setContextNotes(null)} template={template} setTemplate={setTemplate} copied={copied} onCopy={copyContext} />}
      </aside>
    );
  }

  return (
    <aside className="notes-col">
      <div className="notes-head">
        <div>
          <div className="notes-title">学习笔记</div>
          <div className="notes-sub">
            第 {doc.pageIndex + 1} 页 · {notes.length} 条
          </div>
        </div>
        <div className="notes-tabs">
          <button type="button" className={tab === 'page' ? 'on' : ''} onClick={() => setTab('page')}>
            本页
          </button>
          <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            总览 / 搜索
          </button>
        </div>
        {onClose && (
          <button type="button" className="btn tiny notes-close" onClick={onClose} title="关闭笔记栏（N）">
            ✕
          </button>
        )}
      </div>

      {tab === 'all' ? (
        <>
          <div className="notes-search">
            <input
              className="search-input"
              value={query}
              placeholder="全文搜索笔记、标签、来源…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="search-filters">
              <select
                value={fVolume}
                onChange={(e) => {
                  setFVolume(e.target.value);
                  setFChapter('');
                }}
              >
                <option value="">全部卷</option>
                {library?.volumes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
              <select value={fChapter} onChange={(e) => setFChapter(e.target.value)} disabled={!fVolume}>
                <option value="">全部话</option>
                {chaptersForVolume.map((c) => (
                  <option key={c} value={c}>
                    第 {c} 话
                  </option>
                ))}
              </select>
              <input
                className="page-input"
                type="number"
                min={1}
                value={fPage}
                placeholder="页"
                onChange={(e) => setFPage(e.target.value)}
              />
              <select value={filterTag ?? ''} onChange={(e) => setFilterTag(e.target.value || null)}>
                <option value="">全部标签</option>
                {(result?.tags.length ? result.tags.map((t) => t.tag) : allTags.map((t) => t.tag)).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select value={filterSource ?? ''} onChange={(e) => setFilterSource(e.target.value || null)}>
                <option value="">全部来源</option>
                {(result?.sources ?? []).map((s) => (
                  <option key={s.domain} value={s.domain}>
                    {s.domain} ({s.count})
                  </option>
                ))}
              </select>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value === 'tag' ? 'tag' : e.target.value === 'source' ? 'source' : 'chapter')}>
                <option value="chapter">按话聚合</option>
                <option value="tag">按标签聚合</option>
                <option value="source">按来源聚合</option>
              </select>
            </div>
            <div className="muted tiny">
              {loading ? '搜索中…' : result ? `命中 ${result.total} 条，覆盖 ${result.pages} 页` : '输入关键词开始搜索'}
              {(filterTag || filterSource) && (
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => {
                    setFilterTag(null);
                    setFilterSource(null);
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          </div>

          <div className="notes-list" ref={listRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            <div className="virtual-space" style={{ height: totalHeight }}>
              {flat.slice(windowStart, windowEnd).map((row, i) => {
                const index = windowStart + i;
                if (row.kind === 'header') {
                  return (
                    <div className="note-group-head" key={`h-${row.label}-${index}`} style={{ top: index * ROW_H }}>
                      {row.label}
                      <span>{row.count}</span>
                    </div>
                  );
                }
                const n = row.note;
                return (
                  <div className="note-hit" key={`${n.volume}/${n.chapter}/${n.pageIndex}/${n.id}`} style={{ top: index * ROW_H }}>
                    <button
                      type="button"
                      className="note-hit-jump"
                      onClick={() => onJump({ volume: n.volume, chapter: n.chapter, pageIndex: n.pageIndex }, n.panelId)}
                      title="跳到这一页与对应格子"
                    >
                      第 {n.pageIndex + 1} 页{n.panelNo ? ` · 第 ${n.panelNo} 格` : ' · 整页'}
                    </button>
                    <div className="note-hit-text">{n.excerpt}</div>
                    <div className="note-hit-tags">
                      {n.domain && <span className="src-badge">{n.domain}</span>}
                      {n.tags.map((t) => (
                        <button
                          type="button"
                          key={t}
                          className="tag ghost"
                          onClick={() => {
                            setFilterTag(t);
                            setTab('all');
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="notes-compose">
            <div className="scope-toggle">
              <button type="button" className={scope === 'page' ? 'on' : ''} onClick={() => setScope('page')}>
                整页
              </button>
              <button
                type="button"
                className={scope === 'panel' ? 'on' : ''}
                onClick={() => setScope('panel')}
                disabled={!panel}
                title={panel ? '' : '先在左侧选择一个格子'}
              >
                {panel ? panelLabel : '本格'}
              </button>
              <span className="spacer" />
              <button type="button" className="btn tiny" onClick={() => setContextNotes({ notes: [panelNoteSource(panelNotes, pageNotes)] })} disabled={!notes.length}>
                复制本页上下文
              </button>
            </div>
            <MarkdownEditor
              value={text}
              onChange={setText}
              onSubmit={submit}
              placeholder={
                scope === 'panel'
                  ? '记录这一格的原文、翻译差异、语气……（Markdown，Ctrl+Enter 保存）'
                  : '记录整页的观察、疑问、校对备注……（Markdown，Ctrl+Enter 保存）'
              }
            />
            <div className="source-editor">
              <button type="button" className={`link-btn ${sourceOpen ? 'on' : ''}`} onClick={() => setSourceOpen((v) => !v)}>
                {sourceOpen ? '收起来源' : currentSource() ? `来源：${sourceDomain(currentSource())}` : '＋ 添加来源'}
              </button>
              {sourceOpen && (
                <>
                  <div className="row-inline">
                    <input value={srcUrl} placeholder="https://…（粘贴正文里的链接会自动填入）" onChange={(e) => setSrcUrl(e.target.value)} />
                    <button type="button" className="btn tiny" disabled={!srcUrl.trim() || titleBusy} onClick={() => void grabTitle()}>
                      {titleBusy ? '抓取中…' : '抓标题'}
                    </button>
                  </div>
                  <input value={srcTitle} placeholder="标题（可选）" onChange={(e) => setSrcTitle(e.target.value)} />
                  <input value={srcText} placeholder="自由来源，如「ChatGPT 对话 5/12」" onChange={(e) => setSrcText(e.target.value)} />
                  {titleMsg && <span className="muted tiny">{titleMsg}</span>}
                </>
              )}
            </div>
            <div className="tag-editor">
              {tags.map((t) => (
                <span className="tag on" key={t}>
                  {t}
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))}>
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                placeholder="添加标签后回车"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                  if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
                }}
                list="tag-suggestions"
              />
              <datalist id="tag-suggestions">
                {allTags.map((t) => (
                  <option value={t.tag} key={t.tag} />
                ))}
              </datalist>
            </div>
            {suggestions.length > 0 && (
              <div className="tag-suggest">
                {suggestions.map((t) => (
                  <button type="button" key={t.tag} className="tag ghost" onClick={() => addTag(t.tag)}>
                    {t.tag}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn primary block" onClick={submit} disabled={!text.trim()}>
              添加笔记
            </button>
            {scratchPanel}
          </div>

          <div className="notes-scroll">
            {(filterTag || filterSource) && (
              <div className="banner info">
                筛选：{filterTag ? `#${filterTag} ` : ''}
                {filterSource}
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => {
                    setFilterTag(null);
                    setFilterSource(null);
                  }}
                >
                  清除
                </button>
              </div>
            )}
            {panel && (
              <section className="notes-section">
                <h4>
                  {panelLabel}
                  <span>{panelNotes.length}</span>
                </h4>
                {shown(panelNotes).length ? shown(panelNotes).map(renderNote) : <div className="notes-hint">这一格还没有笔记</div>}
              </section>
            )}
            <section className="notes-section">
              <h4>
                整页笔记<span>{pageNotes.length}</span>
              </h4>
              {shown(pageNotes).length ? shown(pageNotes).map(renderNote) : <div className="notes-hint">还没有整页笔记</div>}
            </section>
          </div>
        </>
      )}

      {contextNotes && (
        <ContextDialog
          notes={contextNotes}
          build={buildContext}
          onClose={() => setContextNotes(null)}
          template={template}
          setTemplate={setTemplate}
          copied={copied}
          onCopy={copyContext}
        />
      )}
    </aside>
  );
}

/** 把本页所有笔记合成一个“上下文”请求；单条笔记时由调用方直接传入 */
function panelNoteSource(_panelNotes: Note[], pageNotes: Note[]): Note {
  return {
    id: 'context-all',
    scope: 'page',
    panelId: null,
    text: pageNotes.map((n) => n.text).join('\n\n'),
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

type ContextProps = {
  notes: { notes: Note[]; single?: Note };
  build: (data: { notes: Note[]; single?: Note }) => string;
  onClose: () => void;
  template: string;
  setTemplate: (value: string) => void;
  copied: boolean;
  onCopy: () => void;
};

function ContextDialog({ notes, build, onClose, template, setTemplate, copied, onCopy }: ContextProps) {
  const preview = build(notes);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>复制给大模型的上下文</h2>
            <p>模板支持 {'{volume} {chapter} {page} {panel} {notes} {text} {tags}'}；修改后自动记住</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>模板前缀</span>
            <textarea rows={4} value={template} onChange={(e) => setTemplate(e.target.value)} />
          </label>
          <label className="field">
            <span>预览</span>
            <textarea rows={8} readOnly value={preview} />
          </label>
          <p className="muted tiny">复制内容包含卷 / 话 / 页 / 格编号、笔记正文、标签与来源，可直接粘贴给大模型。</p>
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn primary" onClick={onCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </footer>
      </div>
    </div>
  );
}
