import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Lang, PageDoc, PageEntry, Panel, PanelRect, PanelTemplate } from '../types';
import { LANG_LABEL, LANGUAGES } from '../types';
import { applyDrag, clamp01, normalizeRect, sortPanels, uid, unionRects } from '../lib/geometry';
import type { ResizeHandle } from '../lib/geometry';
import { api } from '../api';

type Props = {
  doc: PageDoc;
  page: PageEntry;
  mutate: (fn: (doc: PageDoc) => PageDoc) => void;
  detecting: boolean;
  onDetect: (lang?: string) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  onReload: () => void;
  /** auto = 防抖自动保存；confirm = 需要 ✓ 或 Enter 才落盘 */
  saveMode: 'auto' | 'confirm';
  setSaveMode: (mode: 'auto' | 'confirm') => void;
  dirty: boolean;
  saving: boolean;
  onCommit: () => void;
  onDiscard: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Snapping distance in screen pixels while drawing a new panel. */
const SNAP_PX = 6;
/** Pointer travel below this is treated as a click, so double-click still works. */
const CLICK_SLOP_PX = 3;
/** A marquee must be at least this large in both screen pixels and normalized size. */
const MIN_MARQUEE_PX = 8;
const MIN_MARQUEE_NORM = 0.01;

type Marquee = { rect: PanelRect; wPx: number; hPx: number };

/** Snap a normalized value to the nearest candidate that is within SNAP_PX screen pixels. */
function snapValue(value: number, candidates: number[], pxPerUnit: number): number {
  let best = value;
  let bestDist = SNAP_PX + 1;
  for (const c of candidates) {
    const dist = Math.abs(c - value) * pxPerUnit;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return bestDist <= SNAP_PX ? best : value;
}

/** Candidate lines: page edges/center plus every existing panel edge/center on one axis. */
function snapCandidates(panels: Panel[], axis: 'x' | 'y'): number[] {
  const values = [0, 0.5, 1];
  for (const p of panels) {
    const start = axis === 'x' ? p.rect.x : p.rect.y;
    const size = axis === 'x' ? p.rect.w : p.rect.h;
    values.push(start, start + size / 2, start + size);
  }
  return values;
}

/** Build a clamped marquee from the fixed anchor and the moving pointer (normalized coords). */
function buildMarquee(
  anchor: { x: number; y: number },
  point: { x: number; y: number },
  box: DOMRect,
  panels: Panel[],
  shift: boolean,
  disableSnap: boolean,
): Marquee {
  let ax = anchor.x;
  let ay = anchor.y;
  let px = point.x;
  let py = point.y;
  if (!disableSnap) {
    const xs = snapCandidates(panels, 'x');
    const ys = snapCandidates(panels, 'y');
    ax = snapValue(ax, xs, box.width);
    ay = snapValue(ay, ys, box.height);
    px = snapValue(px, xs, box.width);
    py = snapValue(py, ys, box.height);
  }
  if (shift) {
    // Keep the marquee square on screen (equal pixel sides) while preserving drag direction.
    const dx = (px - ax) * box.width;
    const dy = (py - ay) * box.height;
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    px = ax + ((Math.sign(dx) || 1) * size) / box.width;
    py = ay + ((Math.sign(dy) || 1) * size) / box.height;
  }
  px = clamp01(px);
  py = clamp01(py);
  const x = Math.min(ax, px);
  const y = Math.min(ay, py);
  const w = Math.abs(px - ax);
  const h = Math.abs(py - ay);
  return { rect: { x, y, w, h }, wPx: w * box.width, hPx: h * box.height };
}

export function PanelsTab({
  doc,
  page,
  mutate,
  detecting,
  onDetect,
  selected,
  setSelected,
  onReload,
  saveMode,
  setSaveMode,
  dirty,
  saving,
  onCommit,
  onDiscard,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: Props) {
  const availableLangs = useMemo(
    () => LANGUAGES.filter((l) => Boolean(page.files[l])),
    [page],
  );
  const [refLang, setRefLang] = useState<Lang>(availableLangs[0] ?? 'ja');
  const [zoom, setZoom] = useState(1);
  const [showNumbers, setShowNumbers] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [templates, setTemplates] = useState<PanelTemplate[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [selectedTpl, setSelectedTpl] = useState('');
  const [tplBusy, setTplBusy] = useState(false);
  const [tplMsg, setTplMsg] = useState('');
  const [gridRows, setGridRows] = useState(2);
  const [gridCols, setGridCols] = useState(2);
  const [gridGap, setGridGap] = useState(1.2);
  const [copied, setCopied] = useState(false);

  const loadTemplates = () => {
    api
      .panelTemplates()
      .then((res) => setTemplates(res.templates))
      .catch(() => setTemplates([]));
  };
  useEffect(loadTemplates, []);

  const shotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    handle: ResizeHandle;
    start: PanelRect;
    sx: number;
    sy: number;
    rect: DOMRect;
  } | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [marqueeActive, setMarqueeActive] = useState(false);
  const marqueeStartRef = useRef<{
    anchor: { x: number; y: number };
    from: { x: number; y: number };
    box: DOMRect;
    moved: boolean;
  } | null>(null);
  const marqueeRectRef = useRef<Marquee | null>(null);

  useEffect(() => {
    setImgLoaded(false);
  }, [refLang, page.index]);

  useEffect(() => {
    if (!availableLangs.includes(refLang)) setRefLang(availableLangs[0] ?? 'ja');
  }, [availableLangs, refLang]);

  const ordered = useMemo(() => sortPanels(doc.panels, doc.readingDirection), [doc.panels, doc.readingDirection]);
  const numberMap = useMemo(() => {
    const m = new Map<string, number>();
    ordered.forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [ordered]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.sx) / d.rect.width;
      const dy = (e.clientY - d.sy) / d.rect.height;
      const rect = applyDrag(d.start, d.handle, dx, dy);
      mutate((doc2) => ({
        ...doc2,
        panels: doc2.panels.map((p) => (p.id === d.id ? { ...p, rect, source: 'manual' as const } : p)),
      }));
    };
    const up = () => {
      setDragging(false);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, mutate]);

  useEffect(() => {
    if (!marqueeActive) return;
    const move = (e: PointerEvent) => {
      const d = marqueeStartRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) < CLICK_SLOP_PX) return;
      d.moved = true;
      const point = {
        x: clamp01((e.clientX - d.box.left) / d.box.width),
        y: clamp01((e.clientY - d.box.top) / d.box.height),
      };
      const next = buildMarquee(d.anchor, point, d.box, doc.panels, e.shiftKey, e.altKey);
      marqueeRectRef.current = next;
      setMarquee(next);
    };
    const end = (commit: boolean) => {
      const d = marqueeStartRef.current;
      const m = marqueeRectRef.current;
      marqueeStartRef.current = null;
      marqueeRectRef.current = null;
      setMarqueeActive(false);
      setMarquee(null);
      // A click without travel must not create anything, so double-click keeps working.
      if (!commit || !d || !d.moved || !m) return;
      if (m.rect.w < MIN_MARQUEE_NORM || m.rect.h < MIN_MARQUEE_NORM) return;
      if (m.wPx < MIN_MARQUEE_PX || m.hPx < MIN_MARQUEE_PX) return;
      const id = uid('p');
      // One mutate call keeps undo/redo and confirm-save mode working like other edits.
      mutate((doc2) => ({ ...doc2, panels: [...doc2.panels, { id, rect: m.rect, source: 'manual' }] }));
      setSelected([id]);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [marqueeActive, doc.panels, mutate, setSelected]);

  const startDrag = (e: ReactPointerEvent, panel: Panel, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    const el = shotRef.current;
    if (!el) return;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (additive) {
      setSelected(selected.includes(panel.id) ? selected.filter((id) => id !== panel.id) : [...selected, panel.id]);
    } else if (!selected.includes(panel.id)) {
      setSelected([panel.id]);
    }
    dragRef.current = { id: panel.id, handle, start: panel.rect, sx: e.clientX, sy: e.clientY, rect: el.getBoundingClientRect() };
    setDragging(true);
  };

  /** Pointer down on empty page area: clear selection and arm a drag-to-draw marquee. */
  const startMarquee = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    // Panels and handles stop propagation themselves; this guard keeps nested markers safe.
    if ((e.target as HTMLElement).closest('.pbox')) return;
    setSelected([]);
    const el = shotRef.current;
    if (!el || !imgLoaded) return;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    marqueeStartRef.current = {
      anchor: {
        x: clamp01((e.clientX - box.left) / box.width),
        y: clamp01((e.clientY - box.top) / box.height),
      },
      from: { x: e.clientX, y: e.clientY },
      box,
      moved: false,
    };
    marqueeRectRef.current = null;
    setMarqueeActive(true);
  };

  const addPanel = (center?: { x: number; y: number }) => {
    const rect: PanelRect = center
      ? { x: Math.max(0, Math.min(0.75, center.x - 0.125)), y: Math.max(0, Math.min(0.8, center.y - 0.075)), w: 0.25, h: 0.15 }
      : { x: 0.3, y: 0.4, w: 0.4, h: 0.2 };
    const id = uid('p');
    mutate((d) => ({ ...d, panels: [...d.panels, { id, rect, source: 'manual' }] }));
    setSelected([id]);
  };

  const deleteSelected = () => {
    if (!selected.length) return;
    mutate((d) => ({
      ...d,
      panels: d.panels.filter((p) => !selected.includes(p.id)),
      notes: d.notes.filter((n) => !(n.scope === 'panel' && n.panelId && selected.includes(n.panelId))),
    }));
    setSelected([]);
  };

  const mergeSelected = () => {
    if (selected.length < 2) return;
    const chosen = doc.panels.filter((p) => selected.includes(p.id));
    const rect = unionRects(chosen.map((p) => p.rect));
    const id = uid('p');
    mutate((d) => ({
      ...d,
      panels: [...d.panels.filter((p) => !selected.includes(p.id)), { id, rect, source: 'merged' }],
      notes: d.notes.map((n) =>
        n.scope === 'panel' && n.panelId && selected.includes(n.panelId) ? { ...n, panelId: id } : n,
      ),
    }));
    setSelected([id]);
  };

  const singleSelected = doc.panels.find((p) => p.id === selected[0]);

  const patchRect = (patch: Partial<PanelRect>) => {
    if (!singleSelected) return;
    const rect = normalizeRect({ ...singleSelected.rect, ...patch });
    mutate((d) => ({
      ...d,
      panels: d.panels.map((p) => (p.id === singleSelected.id ? { ...p, rect, source: 'manual' as const } : p)),
    }));
  };

  const replacePanels = (rects: PanelRect[], label: string) => {
    const oldOrder = sortPanels(doc.panels, doc.readingDirection);
    const panels: Panel[] = rects.map((rect) => ({ id: uid('p'), rect, source: 'manual' }));
    const sameCount = oldOrder.length === panels.length;
    if (
      doc.panels.length > 0 &&
      !window.confirm(
        `将用${label}替换当前 ${doc.panels.length} 个格子。${
          sameCount ? '格子数量一致，格级批注会按阅读顺序迁移。' : '格子数量不同，格级批注会被清除（整页批注保留）。'
        }继续？`,
      )
    ) {
      return false;
    }
    mutate((d) => {
      if (!sameCount) {
        return { ...d, panels, notes: d.notes.filter((n) => n.scope !== 'panel') };
      }
      const map = new Map(oldOrder.map((p, i) => [p.id, panels[i].id]));
      return {
        ...d,
        panels,
        notes: d.notes.map((n) =>
          n.scope === 'panel' && n.panelId && map.has(n.panelId) ? { ...n, panelId: map.get(n.panelId)! } : n,
        ),
      };
    });
    setSelected([panels[0].id]);
    return true;
  };

  const makeGrid = () => {
    const rows = Math.min(8, Math.max(1, gridRows));
    const cols = Math.min(6, Math.max(1, gridCols));
    const gap = Math.max(0, gridGap) / 100;
    const w = (1 - gap * (cols - 1)) / cols;
    const h = (1 - gap * (rows - 1)) / rows;
    const rects: PanelRect[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        rects.push({ x: c * (w + gap), y: r * (h + gap), w, h });
      }
    }
    replacePanels(rects, `${rows}×${cols} 网格`);
  };

  const saveTemplate = async () => {
    if (!doc.panels.length) return;
    setTplBusy(true);
    try {
      const res = await api.savePanelTemplate({
        name: tplName.trim() || `${doc.chapter} 第 ${doc.pageIndex + 1} 页`,
        volume: doc.volume,
        chapter: doc.chapter,
        panels: doc.panels.map((p) => p.rect),
        readingDirection: doc.readingDirection,
      });
      setTplName('');
      setSelectedTpl(res.template.id);
      setTplMsg(`已保存模板「${res.template.name}」`);
      loadTemplates();
    } catch (err) {
      setTplMsg(err instanceof Error ? err.message : '保存模板失败');
    } finally {
      setTplBusy(false);
    }
  };

  const applyTemplate = async (scope: 'page' | 'chapter') => {
    if (!selectedTpl) return;
    if (scope === 'chapter' && !window.confirm('把该模板套用到整话？已有分格会被覆盖，格数相同的页面会迁移批注。')) return;
    setTplBusy(true);
    try {
      // 先把当前页未保存的编辑落盘，避免被模板覆盖后丢失
      await api.savePage(doc);
      const res = await api.applyPanelTemplate(
        selectedTpl,
        doc.volume,
        doc.chapter,
        scope === 'page' ? [doc.pageIndex] : undefined,
      );
      setTplMsg(
        `已套用 ${res.applied} 页${res.droppedNotes ? `，清除格级批注 ${res.droppedNotes} 条` : ''}`,
      );
      onReload();
    } catch (err) {
      setTplMsg(err instanceof Error ? err.message : '套用模板失败');
    } finally {
      setTplBusy(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTpl) return;
    await api.deletePanelTemplate(selectedTpl).catch(() => null);
    setSelectedTpl('');
    setTplMsg('模板已删除');
    loadTemplates();
  };

  const copyJsonPath = async () => {
    const rel = `data/pages/${doc.volume}/${doc.chapter}/${doc.pageIndex}.json`;
    try {
      await navigator.clipboard.writeText(rel);
    } catch {
      window.prompt('复制该路径，用编辑器打开即可手改：', rel);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // 确认模式下 Enter/Esc 对应 ✓/×；框选进行中时 Esc 留给取消框选
    if (saveMode === 'confirm') {
      if (e.key === 'Enter' && dirty) {
        e.preventDefault();
        onCommit();
        return;
      }
      if (e.key === 'Escape' && dirty && !marqueeActive) {
        e.preventDefault();
        onDiscard();
        return;
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (selected.length && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.002;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      mutate((d) => ({
        ...d,
        panels: d.panels.map((p) =>
          selected.includes(p.id) ? { ...p, rect: applyDrag(p.rect, 'move', dx, dy), source: 'manual' } : p,
        ),
      }));
    }
  };

  const url = page.files[refLang];

  return (
    <div className="panels-tab" onKeyDown={onKeyDown} tabIndex={0}>
      {page.warnings.length > 0 && (
        <div className="warn-strip">
          {page.warnings.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
      )}

      <div className="stage-toolbar">
        <div className="tb-group">
          <label className="tb-label">底图</label>
          <select value={refLang} onChange={(e) => setRefLang(e.target.value as Lang)} className="tb-select">
            {availableLangs.map((l) => (
              <option value={l} key={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
        </div>

        <div className="tb-group detect-meta">
          <span className="tb-label">切格</span>
          <span className="chip-mini" title="生成这一页格子所用的算法版本与最近一次编辑">
            {doc.detectorVersion ?? '旧数据'}
          </span>
          <span className="muted tiny">
            {doc.detectSource === 'manual' || doc.panels.some((p) => p.source !== 'auto')
              ? '手动改过'
              : doc.detectSource === 'template'
                ? '按模板'
                : doc.detectSource === 'plugin'
                  ? '按插件'
                  : '自动'}
            {doc.editCount ? ` · 保存 ${doc.editCount} 次` : ''}
            {doc.lastEditedAt ? ` · ${new Date(doc.lastEditedAt).toLocaleString()}` : ''}
            {doc.lastEditSummary ? ` · ${doc.lastEditSummary}` : ''}
          </span>
        </div>

        <div className="tb-group">
          <button type="button" className="btn" onClick={() => onDetect(refLang)} disabled={detecting || !url}>
            {detecting ? '检测中…' : '自动切格'}
          </button>
          <button type="button" className="btn" onClick={() => addPanel()} disabled={!imgLoaded}>
            添加格子
          </button>
          <button type="button" className="btn" onClick={mergeSelected} disabled={selected.length < 2}>
            合并 {selected.length >= 2 ? `(${selected.length})` : ''}
          </button>
          <button type="button" className="btn danger" onClick={deleteSelected} disabled={!selected.length}>
            删除
          </button>
        </div>

        <div className="tb-group save-group">
          <span className="tb-label">保存</span>
          <div className="seg">
            <button
              type="button"
              className={saveMode === 'auto' ? 'on' : ''}
              onClick={() => setSaveMode('auto')}
              title="改动后约 0.7 秒自动落盘"
            >
              自动
            </button>
            <button
              type="button"
              className={saveMode === 'confirm' ? 'on' : ''}
              onClick={() => setSaveMode('confirm')}
              title="点 ✓ 或按 Enter 才保存；× 或 Esc 放弃并回到上次保存"
            >
              确认
            </button>
          </div>
          {saveMode === 'confirm' && dirty && <span className="unsaved-flag">未保存</span>}
          <button type="button" className="btn icon" disabled={!canUndo} onClick={onUndo} title="撤销（Ctrl+Z）">
            ↶
          </button>
          <button type="button" className="btn icon" disabled={!canRedo} onClick={onRedo} title="重做（Ctrl+Shift+Z）">
            ↷
          </button>
          {saveMode === 'confirm' && dirty && (
            <>
              <button type="button" className="btn primary" onClick={onCommit} disabled={saving} title="保存改动（Enter）">
                ✓
              </button>
              <button type="button" className="btn danger" onClick={onDiscard} title="放弃改动（Esc）">
                ×
              </button>
            </>
          )}
        </div>

        <div className="tb-group right">
          <label className="tb-check">
            <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} />
            编号
          </label>
          <div className="zoom">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}>
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))}>
              ＋
            </button>
          </div>
        </div>
      </div>

      <div className="stage-toolbar sub">
        {singleSelected && (
          <div className="tb-group rect-inputs">
            <span className="tb-label">格子坐标</span>
            <label className="num">
              X
              <input
                type="number"
                step={0.1}
                value={+(singleSelected.rect.x * 100).toFixed(2)}
                onChange={(e) => patchRect({ x: Number(e.target.value) / 100 })}
              />
              %
            </label>
            <label className="num">
              Y
              <input
                type="number"
                step={0.1}
                value={+(singleSelected.rect.y * 100).toFixed(2)}
                onChange={(e) => patchRect({ y: Number(e.target.value) / 100 })}
              />
              %
            </label>
            <label className="num">
              宽
              <input
                type="number"
                step={0.1}
                value={+(singleSelected.rect.w * 100).toFixed(2)}
                onChange={(e) => patchRect({ w: Number(e.target.value) / 100 })}
              />
              %
            </label>
            <label className="num">
              高
              <input
                type="number"
                step={0.1}
                value={+(singleSelected.rect.h * 100).toFixed(2)}
                onChange={(e) => patchRect({ h: Number(e.target.value) / 100 })}
              />
              %
            </label>
          </div>
        )}

        <div className="tb-group">
          <span className="tb-label">网格</span>
          <label className="num">
            行
            <input
              type="number"
              min={1}
              max={8}
              value={gridRows}
              onChange={(e) => setGridRows(Number(e.target.value) || 1)}
            />
          </label>
          <label className="num">
            列
            <input
              type="number"
              min={1}
              max={6}
              value={gridCols}
              onChange={(e) => setGridCols(Number(e.target.value) || 1)}
            />
          </label>
          <label className="num">
            间距
            <input
              type="number"
              min={0}
              max={8}
              step={0.2}
              value={gridGap}
              onChange={(e) => setGridGap(Number(e.target.value))}
            />
            %
          </label>
          <button type="button" className="btn tiny" onClick={makeGrid}>
            生成网格
          </button>
        </div>

        <div className="tb-group right">
          <button type="button" className={`btn tiny ${tplOpen ? 'on' : ''}`} onClick={() => setTplOpen((v) => !v)}>
            分格模板 {templates.length ? `(${templates.length})` : ''}
          </button>
          <button type="button" className="btn tiny" onClick={() => void copyJsonPath()} title="复制当前页标注 JSON 路径">
            {copied ? '已复制路径' : '复制 JSON 路径'}
          </button>
        </div>
      </div>

      {tplOpen && (
        <div className="tpl-box">
          <div className="tpl-row">
            <input
              className="preset-name"
              placeholder="模板名称，例如「四格无缝隙」"
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
            />
            <button type="button" className="btn tiny" onClick={() => void saveTemplate()} disabled={tplBusy || !doc.panels.length}>
              把当前页存为模板
            </button>
          </div>
          <div className="tpl-row">
            <select className="tb-select" value={selectedTpl} onChange={(e) => setSelectedTpl(e.target.value)}>
              <option value="">选择模板…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.panels.length} 格
                </option>
              ))}
            </select>
            <button type="button" className="btn tiny" onClick={() => void applyTemplate('page')} disabled={tplBusy || !selectedTpl}>
              套用本页
            </button>
            <button type="button" className="btn tiny" onClick={() => void applyTemplate('chapter')} disabled={tplBusy || !selectedTpl}>
              套用整话
            </button>
            <button type="button" className="btn tiny danger" onClick={() => void deleteTemplate()} disabled={tplBusy || !selectedTpl}>
              删除模板
            </button>
            <span className="muted tiny">数据文件：data/pages/{doc.volume}/{doc.chapter}/{doc.pageIndex}.json</span>
          </div>
          {tplMsg && <div className="tpl-msg">{tplMsg}</div>}
        </div>
      )}

      <div className="stage-scroll">
        {!url ? (
          <div className="stage-empty">这一页没有任何语言的图片</div>
        ) : (
          <div className="canvas-wrap" style={{ width: `${zoom * 100}%` }}>
            <div
              className="shot"
              ref={shotRef}
              onPointerDown={startMarquee}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('.pbox')) return;
                const r = e.currentTarget.getBoundingClientRect();
                addPanel({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
              }}
            >
              <img
                src={url}
                alt={`第 ${doc.pageIndex + 1} 页`}
                draggable={false}
                onLoad={() => setImgLoaded(true)}
              />
              {imgLoaded &&
                doc.panels.map((panel) => {
                  const isSel = selected.includes(panel.id);
                  return (
                    <div
                      key={panel.id}
                      className={`pbox ${isSel ? 'sel' : ''}`}
                      style={{
                        left: `${panel.rect.x * 100}%`,
                        top: `${panel.rect.y * 100}%`,
                        width: `${panel.rect.w * 100}%`,
                        height: `${panel.rect.h * 100}%`,
                      }}
                      onPointerDown={(e) => startDrag(e, panel, 'move')}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {showNumbers && <em className="pnum">{numberMap.get(panel.id)}</em>}
                      {isSel &&
                        HANDLES.map((h) => (
                          <span
                            key={h}
                            className={`handle h-${h}`}
                            onPointerDown={(e) => startDrag(e, panel, h)}
                          />
                        ))}
                    </div>
                  );
                })}
              {marquee && (
                <div
                  className="marquee"
                  style={{
                    left: `${marquee.rect.x * 100}%`,
                    top: `${marquee.rect.y * 100}%`,
                    width: `${marquee.rect.w * 100}%`,
                    height: `${marquee.rect.h * 100}%`,
                  }}
                >
                  <span className="marquee-label">
                    {(marquee.rect.w * 100).toFixed(1)}% × {(marquee.rect.h * 100).toFixed(1)}%
                    <i>
                      {Math.round(marquee.wPx)} × {Math.round(marquee.hPx)} px
                    </i>
                  </span>
                </div>
              )}
            </div>
            {doc.panels.length === 0 && (
              <div className="stage-hint">
                还没有格子。在页面空白处拖拽框出格子，或点「自动切格」自动识别；双击空白处可加一个默认格子。
              </div>
            )}
          </div>
        )}
      </div>

      <div className="stage-status">
        <span>
          共 <b>{doc.panels.length}</b> 格
          {selected.length > 0 && ` · 已选 ${selected.length}`}
        </span>
        <span className="muted">
          空白处拖拽框出格子 · Shift 正方形 · Alt 关闭吸附 · Esc 取消
        </span>
        <span className="muted">
          拖动框体移动，拖角点缩放；Ctrl/Shift 点选多格后可合并；Delete 删除
        </span>
      </div>
    </div>
  );
}
