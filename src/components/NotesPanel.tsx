import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent } from 'react';
import type { Note, NoteImage, NoteSource, PageDoc, Panel } from '../types';
import type { Library } from '../types';
import { newNote, sourceDomain, uid } from '../lib/geometry';
import { renderMarkdown } from '../../shared/markdown';
import { api } from '../api';
import type { NotesIndex } from '../api';
import type { Selection } from '../hooks/usePage';
import { useI18n } from '../i18n';

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

/* ---------------- 笔记贴图：粘贴/拖入的截图 ---------------- */

/** Longest edge kept; bigger screenshots are downscaled so page JSON stays small. */
const NOTE_IMAGE_MAX_EDGE = 1600;
/** Small PNG/JPEG files are stored untouched; re-encoding them would only lose quality. */
const NOTE_IMAGE_RAW_LIMIT = 400 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function decodeImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/** Convert a clipboard/dropped file into a self-contained data URL. */
async function fileToNoteImage(file: File): Promise<NoteImage | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    if (file.size <= NOTE_IMAGE_RAW_LIMIT) {
      return { id: uid('img'), name: file.name, dataUrl: await readAsDataUrl(file) };
    }
    const img = await decodeImage(file);
    const scale = Math.min(1, NOTE_IMAGE_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // WebP keeps screenshots sharp with far smaller data URLs than PNG.
    return { id: uid('img'), name: file.name, dataUrl: canvas.toDataURL('image/webp', 0.85) };
  } catch {
    return null;
  }
}

function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => f.type.startsWith('image/'));
}

/* ---------------- Markdown 编辑器：编辑 / 实时预览 ---------------- */

type EditorProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  rows?: number;
};

function MarkdownEditor({ value, placeholder, onChange, onSubmit, rows = 4 }: EditorProps) {
  const { t } = useI18n();
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
        (sel || t('notes.listItem'))
          .split('\n')
          .map((line) => `${prefix}${line}`)
          .join('\n'),
      `${prefix}${t('notes.listItem')}`,
    );

  const keydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**', t('notes.boldText'));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('*', t('notes.italicText'));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      apply(
        (sel) => `[${sel || t('notes.linkText')}](https://)`,
        `[${t('notes.linkText')}](https://)`,
      );
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
        <button type="button" title={t('notes.boldTitle')} onClick={() => wrap('**', t('notes.boldText'))}>
          <b>B</b>
        </button>
        <button type="button" title={t('notes.italicTitle')} onClick={() => wrap('*', t('notes.italicText'))}>
          <i>I</i>
        </button>
        <button type="button" title={t('notes.bulletTitle')} onClick={() => prefixLines('- ')}>
          {t('notes.bulletLabel')}
        </button>
        <button type="button" title={t('notes.quoteTitle')} onClick={() => prefixLines('> ')}>
          {t('notes.quoteLabel')}
        </button>
        <button type="button" title={t('notes.codeTitle')} onClick={() => wrap('`', 'code')}>
          {'</>'}
        </button>
        <button
          type="button"
          title={t('notes.linkTitle')}
          onClick={() =>
            apply(
              (sel) => `[${sel || t('notes.linkText')}](https://)`,
              `[${t('notes.linkText')}](https://)`,
            )
          }
        >
          {t('notes.linkLabel')}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className={preview ? 'on' : ''}
          onClick={() => setPreview((v) => !v)}
          title={t('notes.togglePreviewTitle')}
        >
          {preview ? t('notes.edit') : t('notes.preview')}
        </button>
      </div>
      {preview ? (
        value.trim() ? (
          <div className="md-body md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
        ) : (
          <div className="md-preview muted tiny">{t('notes.emptyPreview')}</div>
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
      <div className="md-hint muted tiny">{t('notes.markdownHint')}</div>
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

function loadTemplate(fallback: string): string {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || fallback;
  } catch {
    return fallback;
  }
}

/* ---------------- 笔记面板 ---------------- */

const ROW_H = 96;

type FlatHeader =
  | { kind: 'header'; key: string; count: number; group: 'chapter'; volume: string; chapter: string }
  | { kind: 'header'; key: string; count: number; group: 'tag'; tag: string | null }
  | { kind: 'header'; key: string; count: number; group: 'source'; domain: string };

type FlatRow = FlatHeader | { kind: 'note'; note: NotesIndex['notes'][number] };

export function NotesPanel({ doc, panel, panelLabel, mutate, tagStats, library, onJump, onClose }: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const [tab, setTab] = useState<'page' | 'all'>('page');
  const [scope, setScope] = useState<'page' | 'panel'>('page');
  const [text, setText] = useState('');
  const [images, setImages] = useState<NoteImage[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; images: NoteImage[] } | null>(null);
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
  const [template, setTemplate] = useState(() => loadTemplate(t('notes.contextTemplateDefault')));
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
    setImages([]);
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
    for (const tag of tagStats) m.set(tag.tag, tag.count);
    for (const n of doc?.notes ?? []) for (const tag of n.tags) m.set(tag, (m.get(tag) ?? 0) + 1);
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
    const next = tag.trim();
    if (!next) return;
    setTags((prev) => (prev.includes(next) ? prev : [...prev, next]));
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

  const appendComposerImages = async (files: File[]) => {
    const converted = await Promise.all(files.map(fileToNoteImage));
    const usable = converted.filter((img): img is NoteImage => img !== null);
    if (usable.length) setImages((prev) => [...prev, ...usable]);
  };

  const appendEditingImages = async (files: File[]) => {
    const converted = await Promise.all(files.map(fileToNoteImage));
    const usable = converted.filter((img): img is NoteImage => img !== null);
    if (usable.length) setEditing((prev) => (prev ? { ...prev, images: [...prev.images, ...usable] } : prev));
  };

  const handlePasteImages = (e: ClipboardEvent, append: (files: File[]) => Promise<void>) => {
    const files = clipboardImageFiles(e.clipboardData);
    if (!files.length) return;
    // Only swallow the paste when it actually carried images, so text still pastes normally.
    e.preventDefault();
    void append(files);
  };

  const handleDropImages = (e: DragEvent, append: (files: File[]) => Promise<void>) => {
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    void append(files);
  };

  const submit = () => {
    if (!doc) return;
    if (!text.trim() && !images.length) return;
    if (scope === 'panel' && !panel) return;
    const note = newNote(scope, scope === 'panel' && panel ? panel.id : null, text.trim(), tags, currentSource(), images);
    mutate((d) => ({ ...d, notes: [...d.notes, note] }));
    setText('');
    setImages([]);
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
        n.id === editing.id
          ? { ...n, text: editing.text, images: editing.images.length ? editing.images : undefined, updatedAt: new Date().toISOString() }
          : n,
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
      setTitleMsg(res.title ? t('notes.titleFetched') : res.warning ?? t('notes.titleNotFound'));
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
              ? `\n  ${t('notes.sourceInline')}${[n.source.title, n.source.url, n.source.text].filter(Boolean).join(' · ')}`
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

  /** Thumbnails for a note. `onRemove` turns the strip into the editor variant. */
  const imageStrip = (list: NoteImage[], onRemove?: (id: string) => void) => (
    <div className={`note-images ${onRemove ? 'editable' : ''}`}>
      {list.map((img) => (
        <figure key={img.id}>
          {onRemove ? (
            <img src={img.dataUrl} alt={img.name} />
          ) : (
            <a href={img.dataUrl} target="_blank" rel="noreferrer noopener" title={img.name}>
              <img src={img.dataUrl} alt={img.name} loading="lazy" />
            </a>
          )}
          {onRemove && (
            <button type="button" title={t('notes.removeImage')} onClick={() => onRemove(img.id)}>
              ×
            </button>
          )}
        </figure>
      ))}
    </div>
  );

  const renderNote = (note: Note) => (
    <div className="note" key={note.id}>
      <div className="note-top">
        <div className="note-tags">
          {note.tags.map((tag) => (
            <button
              type="button"
              key={tag}
              className={`tag ${filterTag === tag ? 'on' : ''}`}
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              title={t('notes.filterByTag')}
            >
              {tag}
            </button>
          ))}
        </div>
        <span className="note-time">{formatDate(note.createdAt)}</span>
      </div>
      {editing?.id === note.id ? (
        <div
          className="note-edit"
          onPaste={(e) => handlePasteImages(e, appendEditingImages)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => handleDropImages(e, appendEditingImages)}
        >
          <MarkdownEditor
            value={editing.text}
            onChange={(v) => setEditing({ ...editing, text: v })}
            onSubmit={saveEdit}
            placeholder={t('notes.markdownPlaceholder')}
          />
          {editing.images.length > 0 &&
            imageStrip(editing.images, (id) =>
              setEditing((prev) => (prev ? { ...prev, images: prev.images.filter((i) => i.id !== id) } : prev)),
            )}
          <div className="row-actions">
            <button type="button" className="btn tiny primary" onClick={saveEdit}>
              {t('common.save')}
            </button>
            <button type="button" className="btn tiny" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : sourceIds[note.id] ? (
        <pre className="note-source">{note.text}</pre>
      ) : (
        <div className="note-text md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.text) }} />
      )}
      {note.images?.length ? imageStrip(note.images) : null}
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
          <button type="button" onClick={() => setEditing({ id: note.id, text: note.text, images: note.images ?? [] })}>
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={() => setSourceIds((s) => ({ ...s, [note.id]: !s[note.id] }))}
            title={t('notes.toggleSource')}
          >
            {sourceIds[note.id] ? t('notes.rendered') : t('notes.source')}
          </button>
          <button
            type="button"
            onClick={() => setContextNotes({ notes: [note], single: note })}
            title={t('notes.copyContextTitle')}
          >
            {t('notes.copyContext')}
          </button>
          <button type="button" onClick={() => removeNote(note.id)}>
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );

  /* ---- 随手记面板（有页/无页都可用） ---- */
  const scratchPanel = (
    <div className="scratch">
      <button type="button" className={`scratch-toggle ${scratchOpen ? 'on' : ''}`} onClick={() => setScratchOpen((v) => !v)}>
        {t('notes.scratchTitle')} <em>{formatNumber(scratch.length)}</em>
      </button>
      {scratchOpen && (
        <div className="scratch-body">
          <textarea
            rows={2}
            value={scratchDraft}
            placeholder={t('notes.scratchPlaceholder')}
            onChange={(e) => setScratchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                addScratch();
              }
            }}
          />
          <button type="button" className="btn tiny" onClick={addScratch} disabled={!scratchDraft.trim()}>
            {t('notes.scratchSave')}
          </button>
          {scratch.map((item) => (
            <div className="scratch-item" key={item.id}>
              <div className="scratch-text">{item.text}</div>
              <div className="scratch-actions">
                <span className="muted tiny">{formatDate(item.createdAt)}</span>
                <button type="button" className="btn tiny" onClick={() => placeScratch(item, 'page')} disabled={!doc}>
                  {t('notes.scratchToPage')}
                </button>
                <button type="button" className="btn tiny" onClick={() => placeScratch(item, 'panel')} disabled={!panel}>
                  {t('notes.scratchToPanel')}
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
  // Keep localized labels out of the memo so a locale switch re-renders them,
  // while grouping itself only depends on the search result.
  const flat = useMemo<FlatRow[]>(() => {
    if (!result) return [];
    const headers = new Map<string, FlatHeader>();
    const rows: FlatRow[] = [];
    for (const note of result.notes) {
      const key =
        groupBy === 'chapter' ? `${note.volume}/${note.chapter}` : groupBy === 'tag' ? note.tags[0] ?? '' : note.domain || '';
      let header = headers.get(key);
      if (!header) {
        header =
          groupBy === 'chapter'
            ? { kind: 'header', key, count: 0, group: 'chapter', volume: note.volume, chapter: note.chapter }
            : groupBy === 'tag'
              ? { kind: 'header', key, count: 0, group: 'tag', tag: note.tags[0] ?? null }
              : { kind: 'header', key, count: 0, group: 'source', domain: note.domain || '' };
        headers.set(key, header);
        rows.push(header);
      }
      header.count++;
      rows.push({ kind: 'note', note });
    }
    return rows;
  }, [result, groupBy]);

  const headerLabel = (row: FlatHeader): string => {
    if (row.group === 'chapter') return `${row.volume} · ${t('format.chapter', { chapter: row.chapter })}`;
    if (row.group === 'tag') return row.tag ? `# ${row.tag}` : t('notes.untagged');
    return row.domain || t('notes.noSource');
  };

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
          <div className="notes-title">{t('notes.title')}</div>
        </div>
        <div className="notes-empty">{t('notes.emptyNoDoc')}</div>
        {scratchPanel}
        {contextNotes && <ContextDialog notes={contextNotes} build={buildContext} onClose={() => setContextNotes(null)} template={template} setTemplate={setTemplate} copied={copied} onCopy={copyContext} />}
      </aside>
    );
  }

  return (
    <aside className="notes-col">
      <div className="notes-head">
        <div>
          <div className="notes-title">{t('notes.title')}</div>
          <div className="notes-sub">
            {t('notes.pageSummary', {
              page: formatNumber(doc.pageIndex + 1),
              count: formatNumber(notes.length),
            })}
          </div>
        </div>
        <div className="notes-tabs">
          <button type="button" className={tab === 'page' ? 'on' : ''} onClick={() => setTab('page')}>
            {t('notes.tabPage')}
          </button>
          <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            {t('notes.tabAll')}
          </button>
        </div>
        {onClose && (
          <button type="button" className="btn tiny notes-close" onClick={onClose} title={t('notes.closeTitle')}>
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
              placeholder={t('notes.searchPlaceholder')}
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
                <option value="">{t('notes.allVolumes')}</option>
                {library?.volumes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
              <select value={fChapter} onChange={(e) => setFChapter(e.target.value)} disabled={!fVolume}>
                <option value="">{t('notes.allChapters')}</option>
                {chaptersForVolume.map((c) => (
                  <option key={c} value={c}>
                    {t('format.chapter', { chapter: c })}
                  </option>
                ))}
              </select>
              <input
                className="page-input"
                type="number"
                min={1}
                value={fPage}
                placeholder={t('notes.pageNumberPlaceholder')}
                onChange={(e) => setFPage(e.target.value)}
              />
              <select value={filterTag ?? ''} onChange={(e) => setFilterTag(e.target.value || null)}>
                <option value="">{t('notes.allTags')}</option>
                {(result?.tags.length ? result.tags.map((tag) => tag.tag) : allTags.map((tag) => tag.tag)).map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              <select value={filterSource ?? ''} onChange={(e) => setFilterSource(e.target.value || null)}>
                <option value="">{t('notes.allSources')}</option>
                {(result?.sources ?? []).map((s) => (
                  <option key={s.domain} value={s.domain}>
                    {s.domain} ({formatNumber(s.count)})
                  </option>
                ))}
              </select>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value === 'tag' ? 'tag' : e.target.value === 'source' ? 'source' : 'chapter')}>
                <option value="chapter">{t('notes.groupByChapter')}</option>
                <option value="tag">{t('notes.groupByTag')}</option>
                <option value="source">{t('notes.groupBySource')}</option>
              </select>
            </div>
            <div className="muted tiny">
              {loading
                ? t('notes.searching')
                : result
                  ? t('notes.searchResult', {
                      count: formatNumber(result.total),
                      pages: formatNumber(result.pages),
                    })
                  : t('notes.searchIdle')}
              {(filterTag || filterSource) && (
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => {
                    setFilterTag(null);
                    setFilterSource(null);
                  }}
                >
                  {t('notes.clearFilters')}
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
                    <div className="note-group-head" key={`h-${row.key}-${index}`} style={{ top: index * ROW_H }}>
                      {headerLabel(row)}
                      <span>{formatNumber(row.count)}</span>
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
                      title={t('notes.jumpTitle')}
                    >
                      {n.panelNo
                        ? t('notes.jumpWithPanel', {
                            page: formatNumber(n.pageIndex + 1),
                            panel: formatNumber(n.panelNo),
                          })
                        : t('notes.jumpWholePage', { page: formatNumber(n.pageIndex + 1) })}
                    </button>
                    <div className="note-hit-text">{n.excerpt}</div>
                    <div className="note-hit-tags">
                      {n.domain && <span className="src-badge">{n.domain}</span>}
                      {n.tags.map((tag) => (
                        <button
                          type="button"
                          key={tag}
                          className="tag ghost"
                          onClick={() => {
                            setFilterTag(tag);
                            setTab('all');
                          }}
                        >
                          {tag}
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
          <div
            className="notes-compose"
            onPaste={(e) => handlePasteImages(e, appendComposerImages)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault();
            }}
            onDrop={(e) => handleDropImages(e, appendComposerImages)}
          >
            <div className="scope-toggle">
              <button type="button" className={scope === 'page' ? 'on' : ''} onClick={() => setScope('page')}>
                {t('notes.wholePage')}
              </button>
              <button
                type="button"
                className={scope === 'panel' ? 'on' : ''}
                onClick={() => setScope('panel')}
                disabled={!panel}
                title={panel ? '' : t('notes.selectPanelHint')}
              >
                {panel ? panelLabel : t('notes.thisPanel')}
              </button>
              <span className="spacer" />
              <button type="button" className="btn tiny" onClick={() => setContextNotes({ notes: [panelNoteSource(panelNotes, pageNotes)] })} disabled={!notes.length}>
                {t('notes.copyPageContext')}
              </button>
            </div>
            <MarkdownEditor
              value={text}
              onChange={setText}
              onSubmit={submit}
              placeholder={
                scope === 'panel' ? t('notes.placeholderPanel') : t('notes.placeholderPage')
              }
            />
            {images.length > 0 && imageStrip(images, (id) => setImages((prev) => prev.filter((i) => i.id !== id)))}
            <div className="note-image-row">
              <span className="muted tiny note-image-hint">{t('notes.imageHint')}</span>
              <label className="btn tiny note-image-pick">
                {t('notes.addImages')}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    void appendComposerImages(files);
                  }}
                />
              </label>
            </div>
            <div className="source-editor">
              <button type="button" className={`link-btn ${sourceOpen ? 'on' : ''}`} onClick={() => setSourceOpen((v) => !v)}>
                {sourceOpen
                  ? t('notes.hideSource')
                  : currentSource()
                    ? t('notes.sourceWith', { domain: sourceDomain(currentSource()) })
                    : t('notes.addSource')}
              </button>
              {sourceOpen && (
                <>
                  <div className="row-inline">
                    <input value={srcUrl} placeholder={t('notes.urlPlaceholder')} onChange={(e) => setSrcUrl(e.target.value)} />
                    <button type="button" className="btn tiny" disabled={!srcUrl.trim() || titleBusy} onClick={() => void grabTitle()}>
                      {titleBusy ? t('notes.grabbingTitle') : t('notes.grabTitle')}
                    </button>
                  </div>
                  <input value={srcTitle} placeholder={t('notes.titlePlaceholder')} onChange={(e) => setSrcTitle(e.target.value)} />
                  <input value={srcText} placeholder={t('notes.sourceTextPlaceholder')} onChange={(e) => setSrcText(e.target.value)} />
                  {titleMsg && <span className="muted tiny">{titleMsg}</span>}
                </>
              )}
            </div>
            <div className="tag-editor">
              {tags.map((tag) => (
                <span className="tag on" key={tag}>
                  {tag}
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== tag))}>
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                placeholder={t('notes.tagPlaceholder')}
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
                {allTags.map((tag) => (
                  <option value={tag.tag} key={tag.tag} />
                ))}
              </datalist>
            </div>
            {suggestions.length > 0 && (
              <div className="tag-suggest">
                {suggestions.map((tag) => (
                  <button type="button" key={tag.tag} className="tag ghost" onClick={() => addTag(tag.tag)}>
                    {tag.tag}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn primary block"
              onClick={submit}
              disabled={!text.trim() && !images.length}
            >
              {t('notes.addNote')}
            </button>
            {scratchPanel}
          </div>

          <div className="notes-scroll">
            {(filterTag || filterSource) && (
              <div className="banner info">
                {t('notes.filterLabel')}
                {filterTag ? `#${filterTag} ` : ''}
                {filterSource}
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => {
                    setFilterTag(null);
                    setFilterSource(null);
                  }}
                >
                  {t('notes.clear')}
                </button>
              </div>
            )}
            {panel && (
              <section className="notes-section">
                <h4>
                  {panelLabel}
                  <span>{formatNumber(panelNotes.length)}</span>
                </h4>
                {shown(panelNotes).length ? shown(panelNotes).map(renderNote) : <div className="notes-hint">{t('notes.noPanelNotes')}</div>}
              </section>
            )}
            <section className="notes-section">
              <h4>
                {t('notes.pageNotes')}
                <span>{formatNumber(pageNotes.length)}</span>
              </h4>
              {shown(pageNotes).length ? shown(pageNotes).map(renderNote) : <div className="notes-hint">{t('notes.noPageNotes')}</div>}
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
  const { t } = useI18n();
  const preview = build(notes);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>{t('notes.contextTitle')}</h2>
            <p>{t('notes.contextTemplateHint')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>{t('notes.templateLabel')}</span>
            <textarea rows={4} value={template} onChange={(e) => setTemplate(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('notes.preview')}</span>
            <textarea rows={8} readOnly value={preview} />
          </label>
          <p className="muted tiny">{t('notes.contextDesc')}</p>
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="btn primary" onClick={onCopy}>
            {copied ? t('notes.copied') : t('notes.copy')}
          </button>
        </footer>
      </div>
    </div>
  );
}
