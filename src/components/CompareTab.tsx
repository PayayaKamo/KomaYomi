import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AlignMode, AlignOffset, AlignPreset, Lang, PageDoc, PageEntry, Panel } from '../types';
import { DEFAULT_OFFSET, LANG_SHORT, LANGUAGES } from '../types';
import { sortPanels } from '../lib/geometry';
import { api } from '../api';
import { langLabel, readingLabel, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';

type Props = {
  doc: PageDoc;
  page: PageEntry;
  mutate: (fn: (doc: PageDoc) => PageDoc) => void;
  reload: () => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  langs: Lang[];
  setLangs: (langs: Lang[]) => void;
  overlay: boolean;
  setOverlay: (v: boolean) => void;
};

const sizeCache = new Map<string, { w: number; h: number }>();
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const ALIGN_MODES: AlignMode[] = ['page', 'panel', 'anchors', 'grid'];

const ALIGN_MODE_KEY: Record<AlignMode, MessageKey> = {
  page: 'align.mode.page',
  panel: 'align.mode.panel',
  anchors: 'align.mode.anchors',
  grid: 'align.mode.grid',
};

const ALIGN_HINT_KEY: Record<AlignMode, MessageKey> = {
  page: 'align.hint.page',
  panel: 'align.hint.panel',
  anchors: 'align.hint.anchors',
  grid: 'align.hint.grid',
};

/**
 * Returns the image pane under a viewport point, or null.
 *
 * Hit-testing by coordinates (instead of the event target) keeps the wheel
 * behaviour identical over badges, masks and the pane border: anything inside
 * the cell zooms, anything outside scrolls the page. `elementsFromPoint` also
 * skips overlays that opt out with pointer-events: none.
 */
function paneAtPoint(x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement)) continue;
    const pane = el.closest('.lang-pane') as HTMLElement | null;
    if (!pane || pane.dataset.hasImage !== '1') continue;
    const r = pane.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return pane;
  }
  return null;
}

/* ---------- 拖动/缩放作用域 ---------- */
type DragScope = 'page' | 'panel';
const DRAG_SCOPE_KEY = 'manga-memo.drag-scope';

function loadDragScope(): DragScope {
  try {
    return localStorage.getItem(DRAG_SCOPE_KEY) === 'panel' ? 'panel' : 'page';
  } catch {
    return 'page';
  }
}

/* ---------- 语言遮蔽偏好（跨会话记住，导出不读取） ---------- */
type MaskPrefs = {
  master: boolean;
  masked: Record<Lang, boolean>;
  style: 'blur' | 'solid';
};
const MASK_KEY = 'manga-memo.mask-prefs';
const DEFAULT_MASK_PREFS: MaskPrefs = {
  master: false,
  masked: { ja: false, zh: true, en: true },
  style: 'blur',
};

function loadMaskPrefs(): MaskPrefs {
  try {
    const raw = localStorage.getItem(MASK_KEY);
    if (!raw) return DEFAULT_MASK_PREFS;
    const parsed = JSON.parse(raw) as Partial<MaskPrefs>;
    return {
      master: Boolean(parsed.master),
      masked: { ...DEFAULT_MASK_PREFS.masked, ...(parsed.masked ?? {}) },
      style: parsed.style === 'solid' ? 'solid' : 'blur',
    };
  } catch {
    return DEFAULT_MASK_PREFS;
  }
}

function useImageSize(url: string | undefined) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(url ? sizeCache.get(url) ?? null : null);
  useEffect(() => {
    if (!url) {
      setSize(null);
      return;
    }
    const cached = sizeCache.get(url);
    if (cached) {
      setSize(cached);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const s = { w: img.naturalWidth, h: img.naturalHeight };
      sizeCache.set(url, s);
      setSize(s);
    };
    img.src = url;
  }, [url]);
  return size;
}

function CropLayer({
  url,
  rect,
  offset,
  opacity,
  blend,
}: {
  url: string;
  rect: Panel['rect'];
  offset: AlignOffset;
  opacity: number;
  blend: boolean;
}) {
  return (
    <div
      className={`crop-inner ${blend ? 'blend' : ''}`}
      style={{
        transform: `translate(${offset.x * 100}%, ${offset.y * 100}%) scale(${offset.scale})`,
        opacity,
      }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        style={{
          width: `${100 / rect.w}%`,
          height: `${100 / rect.h}%`,
          left: `${-(rect.x / rect.w) * 100}%`,
          top: `${-(rect.y / rect.h) * 100}%`,
        }}
      />
    </div>
  );
}

export function CompareTab({
  doc,
  page,
  mutate,
  reload,
  selected,
  setSelected,
  langs,
  setLangs,
  overlay,
  setOverlay,
}: Props) {
  const { t, formatNumber } = useI18n();
  const ordered = useMemo(() => sortPanels(doc.panels, doc.readingDirection), [doc.panels, doc.readingDirection]);
  const mode: AlignMode = doc.alignMode ?? 'page';
  const alignModeLabel = (m: AlignMode) => t(ALIGN_MODE_KEY[m]);
  const isPanelMode = mode === 'panel' || mode === 'anchors';
  const [dragLang, setDragLang] = useState<Lang>(langs[0] ?? 'ja');
  const [opacities, setOpacities] = useState<Record<Lang, number>>({ ja: 1, zh: 0.55, en: 0.45 });
  const [blend, setBlend] = useState(true);
  const [alignOpen, setAlignOpen] = useState(false);
  const [presets, setPresets] = useState<AlignPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<{ panelId: string; lang: Lang; x: number; y: number } | null>(
    null,
  );
  const [maskPrefs, setMaskPrefs] = useState<MaskPrefs>(loadMaskPrefs);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [maskDefaultsOpen, setMaskDefaultsOpen] = useState(false);
  // 默认作用域跨会话记住；当前页仍以 doc.alignMode 为准
  const [scopePref, setScopePref] = useState<DragScope>(loadDragScope);
  const [activeDrag, setActiveDrag] = useState<{ panelId: string; lang: Lang; scope: DragScope } | null>(null);
  const movedRef = useRef(false);
  const dragRef = useRef<{
    lang: Lang;
    panelId: string;
    mode: AlignMode;
    scope: DragScope;
    sx: number;
    sy: number;
    rect: DOMRect;
    start: AlignOffset;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const scopeOfMode: DragScope = isPanelMode ? 'panel' : 'page';

  useEffect(() => {
    try {
      localStorage.setItem(DRAG_SCOPE_KEY, scopePref);
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [scopePref]);

  // 打开新页时沿用上次选择的作用域（取点/网格这类特殊模式不覆盖）
  useEffect(() => {
    if (mode === 'anchors' || mode === 'grid') return;
    if (mode !== scopePref) mutate((d) => ({ ...d, alignMode: scopePref }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.volume, doc.chapter, doc.pageIndex]);

  const availableLangs = useMemo(() => LANGUAGES.filter((l) => Boolean(page.files[l])), [page]);
  const baseLang = useMemo(() => langs.find((l) => page.files[l]) ?? langs[0] ?? 'ja', [langs, page.files]);

  useEffect(() => {
    if (!langs.includes(dragLang)) setDragLang(langs[0] ?? 'ja');
  }, [langs, dragLang]);

  // 遮蔽是阅读偏好：跨会话记住；翻页只清掉「临时显形」，不重置开关
  useEffect(() => {
    try {
      localStorage.setItem(MASK_KEY, JSON.stringify(maskPrefs));
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [maskPrefs]);
  useEffect(() => {
    setRevealed({});
  }, [page.index, doc.chapter, doc.volume]);

  const maskOn = (lang: Lang) => maskPrefs.master && maskPrefs.masked[lang] && Boolean(page.files[lang]);
  const revealKey = (panelId: string, lang: Lang) => `${panelId}:${lang}`;
  const isHidden = (panelId: string, lang: Lang) => maskOn(lang) && !revealed[revealKey(panelId, lang)];

  const toggleMaskLang = (lang: Lang) =>
    setMaskPrefs((p) => ({ ...p, master: true, masked: { ...p.masked, [lang]: !p.masked[lang] } }));

  // H 全部遮住（清空临时显形），Shift+H 全部显示
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'h') return;
      e.preventDefault();
      setMaskPrefs((p) => ({ ...p, master: !e.shiftKey }));
      setRevealed({});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 页面或语言变化时，别让「已隐藏」的语言继续占用列
  useEffect(() => {
    if (!availableLangs.length) return;
    const kept = langs.filter((l) => availableLangs.includes(l));
    if (!kept.length) setLangs(availableLangs);
    else if (kept.length !== langs.length) setLangs(kept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableLangs.join(','), langs.join(',')]);

  const loadPresets = () => {
    api
      .alignPresets()
      .then((res) => setPresets(res.presets))
      .catch(() => setPresets([]));
  };
  useEffect(loadPresets, []);

  // 整页偏移与逐格偏移分开存：scope 决定读写哪一份，Alt 临时覆盖时不会污染另一份
  const offsetOf = (lang: Lang, panel: Panel, scope: DragScope = scopeOfMode): AlignOffset =>
    scope === 'panel'
      ? doc.panelOffsets?.[panel.id]?.[lang] ?? DEFAULT_OFFSET
      : doc.offsets[lang] ?? DEFAULT_OFFSET;

  const setOffset = (lang: Lang, panel: Panel, next: AlignOffset, scope: DragScope = scopeOfMode) => {
    mutate((d) =>
      scope === 'panel'
        ? {
            ...d,
            panelOffsets: {
              ...d.panelOffsets,
              [panel.id]: { ...d.panelOffsets?.[panel.id], [lang]: next },
            },
          }
        : { ...d, offsets: { ...d.offsets, [lang]: next } },
    );
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) movedRef.current = true;
      let nx = clamp(d.start.x + (e.clientX - d.sx) / d.rect.width, -2, 2);
      let ny = clamp(d.start.y + (e.clientY - d.sy) / d.rect.height, -2, 2);
      if (d.mode === 'grid') {
        const step = (doc.gridStep ?? 1) / 100;
        nx = Math.round(nx / step) * step;
        ny = Math.round(ny / step) * step;
      }
      mutate((doc2) => {
        const panel = doc2.panels.find((p) => p.id === d.panelId);
        const usePanel = d.scope === 'panel';
        if (usePanel && panel) {
          return {
            ...doc2,
            panelOffsets: {
              ...doc2.panelOffsets,
              [panel.id]: { ...doc2.panelOffsets?.[panel.id], [d.lang]: { ...d.start, x: nx, y: ny } },
            },
          };
        }
        return { ...doc2, offsets: { ...doc2.offsets, [d.lang]: { ...d.start, x: nx, y: ny } } };
      });
    };
    const up = () => {
      const d = dragRef.current;
      // 没有拖动 = 一次点击：把临时显形的语言重新遮住
      if (d && !movedRef.current) {
        setRevealed((r) => {
          const key = `${d.panelId}:${d.lang}`;
          return r[key] ? { ...r, [key]: false } : r;
        });
      }
      setDragging(false);
      setActiveDrag(null);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, doc.gridStep, mutate]);

  const startPan = (e: ReactPointerEvent<HTMLDivElement>, lang: Lang, panel: Panel) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (mode === 'anchors') {
      e.preventDefault();
      if (!pendingAnchor || pendingAnchor.panelId !== panel.id) {
        setPendingAnchor({
          panelId: panel.id,
          lang,
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        });
        return;
      }
      if (pendingAnchor.lang === lang) {
        setPendingAnchor({
          panelId: panel.id,
          lang,
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        });
        return;
      }
      // 两次点击：参考点 → 目标点，直接算出目标语言需要的平移量
      const tx = (e.clientX - rect.left) / rect.width;
      const ty = (e.clientY - rect.top) / rect.height;
      const current = offsetOf(lang, panel, 'panel');
      setOffset(lang, panel, {
        ...current,
        x: clamp(current.x + (pendingAnchor.x - tx), -2, 2),
        y: clamp(current.y + (pendingAnchor.y - ty), -2, 2),
      }, 'panel');
      setDragLang(lang);
      setPendingAnchor(null);
      return;
    }
    e.preventDefault();
    movedRef.current = false;
    // Alt 是临时覆盖：本次手势只改当前格，松手后回到原作用域
    const scope: DragScope = e.altKey ? 'panel' : scopeOfMode;
    dragRef.current = {
      lang,
      panelId: panel.id,
      mode,
      scope,
      sx: e.clientX,
      sy: e.clientY,
      rect,
      start: offsetOf(lang, panel, scope),
    };
    setActiveDrag({ panelId: panel.id, lang, scope });
    setDragLang(lang);
    setDragging(true);
  };

  const zoomBy = (lang: Lang, panel: Panel, deltaY: number, scope: DragScope = scopeOfMode) => {
    const current = offsetOf(lang, panel, scope);
    const next = clamp(+(current.scale * (deltaY < 0 ? 1.06 : 0.94)).toFixed(3), 0.5, 3);
    setOffset(lang, panel, { ...current, scale: next }, scope);
  };

  // 滚轮缩放：只在指针真正落在某一语言的图格内时接管，其他位置让页面正常滚动。
  // React 的 onWheel 在根节点上是 passive 的，无法阻止页面滚动，所以用原生非 passive 监听；
  // 挂在 window 的捕获阶段，避免滚动容器或任何内层元素先消费事件造成「又缩放又滚动」。
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    if (!e.deltaY) return;
    const paneEl = paneAtPoint(e.clientX, e.clientY);
    if (!paneEl) return;
    const lang = paneEl.dataset.lang as Lang | undefined;
    const panel = doc.panels.find((p) => p.id === paneEl.dataset.panelId);
    if (!lang || !panel) return;
    e.preventDefault();
    e.stopPropagation();
    // Alt+滚轮同样只缩放当前格，避免为了微调一格而改整栏
    zoomBy(lang, panel, e.deltaY, e.altKey ? 'panel' : scopeOfMode);
  };

  useEffect(() => {
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  const resetLang = (lang: Lang, panel?: Panel) => {
    if (scopeOfMode === 'panel') {
      if (!panel) return;
      mutate((d) => ({
        ...d,
        panelOffsets: { ...d.panelOffsets, [panel.id]: { ...d.panelOffsets?.[panel.id], [lang]: DEFAULT_OFFSET } },
      }));
      return;
    }
    mutate((d) => ({ ...d, offsets: { ...d.offsets, [lang]: DEFAULT_OFFSET } }));
  };

  /** 清空本页所有格子的逐格偏移（不影响整页偏移） */
  const resetAllPanelOffsets = () => {
    setPendingAnchor(null);
    mutate((d) => ({ ...d, panelOffsets: {} }));
  };

  /** 只清当前格的逐格偏移（不影响整页偏移与其他格） */
  const resetCurrentPanelOffsets = () => {
    const panel = doc.panels.find((p) => p.id === selected[0]) ?? ordered[0];
    if (!panel) return;
    mutate((d) => {
      const next = { ...d.panelOffsets };
      delete next[panel.id];
      return { ...d, panelOffsets: next };
    });
  };

  const resetAll = () => {
    setPendingAnchor(null);
    mutate((d) => ({ ...d, offsets: {}, panelOffsets: {} }));
  };

  const toggleLang = (lang: Lang) => {
    if (langs.includes(lang)) {
      if (langs.length === 1) return;
      setLangs(langs.filter((l) => l !== lang));
    } else {
      setLangs([...LANGUAGES.filter((l) => langs.includes(l) || l === lang)]);
    }
  };

  const goTo = (dir: -1 | 1) => {
    if (!ordered.length) return;
    const currentIdx = ordered.findIndex((p) => selected.includes(p.id));
    const base = currentIdx < 0 ? (dir > 0 ? -1 : ordered.length) : currentIdx;
    const nextIdx = Math.min(ordered.length - 1, Math.max(0, base + dir));
    const target = ordered[nextIdx];
    setSelected([target.id]);
    document.getElementById(`panel-${target.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const changeMode = (next: AlignMode) => {
    setPendingAnchor(null);
    // 整页/当前格是高频选择，记为下次打开页面时的默认作用域
    if (next === 'page' || next === 'panel') setScopePref(next);
    mutate((d) => ({ ...d, alignMode: next }));
  };

  const panelForInput = doc.panels.find((p) => p.id === selected[0]) ?? ordered[0];
  const inputOffset = panelForInput ? offsetOf(dragLang, panelForInput) : DEFAULT_OFFSET;
  const applyNumeric = (patch: Partial<AlignOffset>) => {
    if (!panelForInput) return;
    setOffset(dragLang, panelForInput, { ...inputOffset, ...patch });
  };

  const savePreset = async (scope: 'page' | 'chapter') => {
    if (!presetName.trim()) return;
    setPresetBusy(true);
    try {
      const res = await api.saveAlignPreset({
        name: presetName.trim(),
        scope,
        volume: doc.volume,
        chapter: doc.chapter,
        mode,
        offsets: doc.offsets,
        panelOffsets: doc.panelOffsets,
        gridStep: doc.gridStep,
      });
      setPresetName('');
      setPresetId(res.preset.id);
      loadPresets();
    } catch {
      /* 保存失败在状态栏不打断阅读 */
    } finally {
      setPresetBusy(false);
    }
  };

  const applyPreset = async (target: 'page' | 'chapter') => {
    if (!presetId) return;
    setPresetBusy(true);
    try {
      await api.applyAlignPreset(presetId, doc.volume, doc.chapter, target === 'page' ? [page.index] : undefined);
      if (target === 'page') reload();
      else reload();
    } catch {
      /* 保持当前状态 */
    } finally {
      setPresetBusy(false);
    }
  };

  const deletePreset = async () => {
    if (!presetId) return;
    await api.deleteAlignPreset(presetId);
    setPresetId('');
    loadPresets();
  };

  // 渲染时把两层偏移叠加：整页偏移打底，逐格偏移叠加在它之上，
  // 这样 Alt 临时微调的格子在整页模式下也能立刻看到效果，而两份数据仍然分开存。
  const offsetsOf = (lang: Lang, panel: Panel): AlignOffset => {
    const base = doc.offsets[lang] ?? DEFAULT_OFFSET;
    const extra = doc.panelOffsets?.[panel.id]?.[lang];
    if (!extra) return base;
    return {
      x: base.x + extra.x,
      y: base.y + extra.y,
      scale: +(base.scale * extra.scale).toFixed(4),
    };
  };

  // 提前载入三种语言的页面尺寸，用于计算每个格子的真实长宽比
  const sizes: Record<Lang, { w: number; h: number } | null> = {
    ja: useImageSize(page.files.ja),
    zh: useImageSize(page.files.zh),
    en: useImageSize(page.files.en),
  };

  const paneAspect = (lang: Lang, panel: Panel) => {
    const size = sizes[lang];
    return size ? (panel.rect.w * size.w) / (panel.rect.h * size.h) : 0.72;
  };

  const renderLangPane = (lang: Lang, panel: Panel) => {
    const url = page.files[lang];
    const aspect = paneAspect(lang, panel);
    const off = offsetsOf(lang, panel);
    if (!url) {
      return (
        <div className="lang-pane empty" key={lang} style={{ aspectRatio: aspect }}>
          <span className="lang-tag">{LANG_SHORT[lang]}</span>
          <div className="pane-missing">{t('compare.missingLangImage', { lang: langLabel(lang) })}</div>
        </div>
      );
    }
    return (
      <div
        key={lang}
        className={`lang-pane ${dragging && dragLang === lang ? 'dragging' : ''} ${
          activeDrag?.panelId === panel.id && activeDrag.lang === lang && activeDrag.scope === 'panel' ? 'scope-target' : ''
        }`}
        style={{ aspectRatio: aspect }}
        data-lang={lang}
        data-panel-id={panel.id}
        data-has-image="1"
        onPointerDown={(e) => startPan(e, lang, panel)}
      >
        <CropLayer url={url} rect={panel.rect} offset={off} opacity={1} blend={false} />
        {isHidden(panel.id, lang) && (
          <div
            className={`lang-mask ${maskPrefs.style}`}
            title={t('compare.maskTitle', { lang: langLabel(lang) })}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((r) => ({ ...r, [revealKey(panel.id, lang)]: true }));
            }}
          >
            <span>
              {LANG_SHORT[lang]} {t('compare.maskedBadge')}
              <em>{t('compare.clickReveal')}</em>
            </span>
          </div>
        )}
        <span className="lang-tag">{LANG_SHORT[lang]}</span>
        <span className="pane-offset">
          Δ{Math.round(off.x * 100)},{Math.round(off.y * 100)} ×{off.scale.toFixed(2)}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => resetLang(lang, panel)}
            title={t('compare.resetCellLang')}
          >
            ⟲
          </button>
        </span>
        {pendingAnchor && pendingAnchor.panelId === panel.id && pendingAnchor.lang === lang && (
          <span
            className="anchor-dot"
            style={{ left: `${pendingAnchor.x * 100}%`, top: `${pendingAnchor.y * 100}%` }}
          />
        )}
      </div>
    );
  };

  const renderOverlayPane = (panel: Panel) => {
    const first = langs.find((l) => page.files[l]);
    const aspect = first ? paneAspect(first, panel) : 0.72;
    return (
      <div
        className={`lang-pane overlay ${
          activeDrag?.panelId === panel.id && activeDrag.scope === 'panel' ? 'scope-target' : ''
        }`}
        style={{ aspectRatio: aspect }}
        data-lang={dragLang}
        data-panel-id={panel.id}
        data-has-image="1"
        onPointerDown={(e) => startPan(e, dragLang, panel)}
      >
        {langs.map((lang) => {
          const url = page.files[lang];
          if (!url) return null;
          if (isHidden(panel.id, lang)) return null;
          return (
            <CropLayer
              key={lang}
              url={url}
              rect={panel.rect}
              offset={offsetsOf(lang, panel)}
              opacity={opacities[lang] ?? 0.5}
              blend={blend}
            />
          );
        })}
        {langs.some((l) => isHidden(panel.id, l)) && (
          <div
            className={`lang-mask ${maskPrefs.style}`}
            title={t('compare.someMaskedTitle')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((r) => {
                const next = { ...r };
                for (const l of langs) if (maskOn(l)) next[revealKey(panel.id, l)] = true;
                return next;
              });
            }}
          >
            <span>
              {t('compare.someMasked')}
              <em>{t('compare.clickReveal')}</em>
            </span>
          </div>
        )}
        <span className="lang-tag">
          {t('compare.overlayTag', {
            langs: langs.map((l) => LANG_SHORT[l]).join(' + '),
            lang: LANG_SHORT[dragLang],
          })}
        </span>
      </div>
    );
  };

  if (!doc.panels.length) {
    return (
      <div className="compare-empty">
        <p>{t('compare.emptyPanels')}</p>
        <p className="muted">{t('compare.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="compare-tab">
      <div className="stage-toolbar">
        <div className="tb-group">
          <span className="tb-label">{t('compare.language')}</span>
          <div className="lang-chips">
            {LANGUAGES.map((l) => {
              const disabled = !availableLangs.includes(l);
              return (
                <button
                  type="button"
                  key={l}
                  className={`lang-chip ${langs.includes(l) ? 'on' : ''}`}
                  onClick={() => toggleLang(l)}
                  disabled={disabled}
                  title={disabled ? t('compare.langMissing') : langLabel(l)}
                >
                  {LANG_SHORT[l]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="tb-group mask-group">
          <span className="tb-label">{t('compare.mask')}</span>
          <button
            type="button"
            className={`btn tiny ${maskPrefs.master ? 'on' : ''}`}
            onClick={() => {
              setMaskPrefs((p) => ({ ...p, master: !p.master }));
              setRevealed({});
            }}
            title={t('compare.maskToggleTitle')}
          >
            {maskPrefs.master ? t('compare.maskOn') : t('compare.maskOff')}
          </button>
          {maskPrefs.master &&
            availableLangs.map((l) => (
              <button
                type="button"
                key={l}
                className={`lang-chip ${maskPrefs.masked[l] ? 'on' : ''}`}
                onClick={() => toggleMaskLang(l)}
                title={
                  maskPrefs.masked[l]
                    ? t('compare.maskLangTitleMasked', { lang: langLabel(l) })
                    : t('compare.maskLangTitleVisible', { lang: langLabel(l) })
                }
              >
                {LANG_SHORT[l]}
                <i className="mask-icon">{maskPrefs.masked[l] ? '◐' : '◯'}</i>
              </button>
            ))}
          {maskPrefs.master && (
            <>
              <select
                className="tb-select"
                value={maskPrefs.style}
                onChange={(e) =>
                  setMaskPrefs((p) => ({ ...p, style: e.target.value === 'solid' ? 'solid' : 'blur' }))
                }
                title={t('compare.maskStyle')}
              >
                <option value="blur">{t('compare.maskStyleBlur')}</option>
                <option value="solid">{t('compare.maskStyleSolid')}</option>
              </select>
              <button
                type="button"
                className="btn tiny"
                onClick={() => setRevealed({})}
                title={t('compare.maskAllTitle')}
              >
                {t('compare.maskAll')}
              </button>
              <button
                type="button"
                className="btn tiny"
                onClick={() => setMaskPrefs((p) => ({ ...p, master: false }))}
                title={t('compare.maskNoneTitle')}
              >
                {t('compare.maskNone')}
              </button>
              <button
                type="button"
                className={`btn tiny ${maskDefaultsOpen ? 'on' : ''}`}
                onClick={() => setMaskDefaultsOpen((v) => !v)}
                title={t('compare.maskDefaultsTitle')}
              >
                {t('compare.maskDefaults')}
              </button>
            </>
          )}
        </div>

        <div className="tb-group">
          <div className="seg">
            <button type="button" className={!overlay ? 'on' : ''} onClick={() => setOverlay(false)}>
              {t('compare.sideBySide')}
            </button>
            <button type="button" className={overlay ? 'on' : ''} onClick={() => setOverlay(true)}>
              {t('compare.overlay')}
            </button>
          </div>
          {overlay && (
            <>
              <label className="tb-check">
                <input type="checkbox" checked={blend} onChange={(e) => setBlend(e.target.checked)} />
                {t('compare.multiply')}
              </label>
              <span className="muted tiny">{t('compare.alignTarget')}</span>
              <div className="lang-chips">
                {langs.map((l) => (
                  <button
                    type="button"
                    key={l}
                    className={`lang-chip ${dragLang === l ? 'on' : ''}`}
                    onClick={() => setDragLang(l)}
                  >
                    {LANG_SHORT[l]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="tb-group align-mode">
          <span className="tb-label">{t('compare.align')}</span>
          <select
            className={`tb-select mode mode-${mode}`}
            value={mode}
            onChange={(e) => changeMode(e.target.value as AlignMode)}
            title={t(ALIGN_HINT_KEY[mode])}
          >
            {ALIGN_MODES.map((m) => (
              <option key={m} value={m}>
                {alignModeLabel(m)}
              </option>
            ))}
          </select>
          {mode === 'grid' && (
            <select
              className="tb-select"
              value={doc.gridStep ?? 1}
              onChange={(e) => mutate((d) => ({ ...d, gridStep: Number(e.target.value) }))}
              title={t('compare.snapStep')}
            >
              {[0.5, 1, 2, 5].map((s) => (
                <option key={s} value={s}>
                  {s}%
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className={`btn tiny ${alignOpen ? 'on' : ''}`}
            onClick={() => setAlignOpen((v) => !v)}
            title={t('compare.alignSettingsTitle')}
          >
            {t('compare.alignSettings')}
          </button>
        </div>

        <div className="tb-group scope-group">
          <span className="tb-label">{t('compare.dragZoom')}</span>
          <div className="seg scope-seg" title={t('compare.scopeTitle')}>
            <button
              type="button"
              className={scopeOfMode === 'page' ? 'on' : ''}
              onClick={() => changeMode('page')}
              title={t('compare.scopePageTitle')}
            >
              {t('compare.scopePage')}
            </button>
            <button
              type="button"
              className={scopeOfMode === 'panel' ? 'on' : ''}
              onClick={() => changeMode('panel')}
              title={t('compare.scopePanelTitle')}
            >
              {t('compare.scopePanel')}
            </button>
          </div>
          <span className="muted tiny alt-hint" title={t('compare.altHintTitle')}>
            {t('compare.altHint')}
          </span>
        </div>

        <div className="tb-group right">
          <span className="muted tiny">{readingLabel(doc.readingDirection)}</span>
          <button type="button" className="btn tiny" onClick={() => goTo(-1)}>
            {t('compare.prevPanel')}
          </button>
          <button type="button" className="btn tiny" onClick={() => goTo(1)}>
            {t('compare.nextPanel')}
          </button>
          <button type="button" className="btn tiny" onClick={resetAll}>
            {t('compare.resetAll')}
          </button>
        </div>
      </div>

      {alignOpen && (
        <div className="align-box">
          <div className="align-hint">
            <b>{alignModeLabel(mode)}</b>
            <span>{t(ALIGN_HINT_KEY[mode])}</span>
            {mode === 'anchors' && (
              <span className="anchor-tip">
                {pendingAnchor
                  ? t('compare.anchorPending', { lang: LANG_SHORT[pendingAnchor.lang] })
                  : t('compare.anchorWaiting', { lang: LANG_SHORT[baseLang] })}
                {pendingAnchor && (
                  <button type="button" className="btn tiny" onClick={() => setPendingAnchor(null)}>
                    {t('compare.cancelAnchor')}
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="align-row">
            <span className="tb-label">{t('compare.target')}</span>
            <div className="lang-chips">
              {langs.map((l) => (
                <button
                  type="button"
                  key={l}
                  className={`lang-chip ${dragLang === l ? 'on' : ''}`}
                  onClick={() => setDragLang(l)}
                  disabled={!page.files[l]}
                >
                  {LANG_SHORT[l]}
                </button>
              ))}
            </div>
            <span className="muted tiny">
              {isPanelMode
                ? t('compare.appliesPanel', {
                    number: formatNumber(ordered.findIndex((p) => p.id === panelForInput?.id) + 1 || 1),
                  })
                : t('compare.appliesPage')}
            </span>
            <label className="num">
              X
              <input
                type="number"
                step={0.1}
                value={+(inputOffset.x * 100).toFixed(2)}
                onChange={(e) => applyNumeric({ x: Number(e.target.value) / 100 })}
              />
              %
            </label>
            <label className="num">
              Y
              <input
                type="number"
                step={0.1}
                value={+(inputOffset.y * 100).toFixed(2)}
                onChange={(e) => applyNumeric({ y: Number(e.target.value) / 100 })}
              />
              %
            </label>
            <label className="num">
              {t('compare.scale')}
              <input
                type="number"
                step={0.01}
                min={0.5}
                max={3}
                value={+inputOffset.scale.toFixed(2)}
                onChange={(e) => applyNumeric({ scale: clamp(Number(e.target.value), 0.5, 3) })}
              />
            </label>
            <span className="align-sep" />
            <button
              type="button"
              className="btn tiny"
              onClick={resetAllPanelOffsets}
              title={t('compare.resetAllPanelsTitle')}
            >
              {t('compare.resetAllPanels')}
            </button>
            <button
              type="button"
              className="btn tiny"
              onClick={resetCurrentPanelOffsets}
              disabled={!panelForInput}
              title={t('compare.resetCurrentPanelTitle')}
            >
              {t('compare.resetCurrentPanel')}
            </button>
          </div>

          <div className="align-row">
            <input
              className="preset-name"
              placeholder={t('compare.presetNamePlaceholder')}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button
              type="button"
              className="btn tiny"
              disabled={!presetName.trim() || presetBusy}
              onClick={() => savePreset('page')}
            >
              {t('compare.savePresetPage')}
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={!presetName.trim() || presetBusy}
              onClick={() => savePreset('chapter')}
            >
              {t('compare.savePresetChapter')}
            </button>
            <span className="align-sep" />
            <select className="tb-select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">{t('compare.selectPreset')}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {alignModeLabel(p.mode)} ·{' '}
                  {p.scope === 'chapter' ? t('compare.presetScopeChapter') : t('compare.presetScopePage')}
                </option>
              ))}
            </select>
            <button type="button" className="btn tiny" disabled={!presetId || presetBusy} onClick={() => applyPreset('page')}>
              {t('compare.applyPresetPage')}
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={!presetId || presetBusy}
              onClick={() => applyPreset('chapter')}
            >
              {t('compare.applyPresetChapter')}
            </button>
            <button
              type="button"
              className="btn tiny danger"
              disabled={!presetId || presetBusy}
              onClick={() => void deletePreset()}
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
      )}

      {maskDefaultsOpen && (
        <div className="mask-defaults">
          <b>{t('compare.maskDefaultsHeading')}</b>
          {LANGUAGES.map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                checked={maskPrefs.masked[l]}
                onChange={() =>
                  setMaskPrefs((p) => ({ ...p, masked: { ...p.masked, [l]: !p.masked[l] } }))
                }
              />
              {langLabel(l)}
            </label>
          ))}
          <span className="muted tiny">{t('compare.maskDefaultsHint')}</span>
        </div>
      )}

      {overlay && (
        <div className="opacity-bar">
          {langs.map((l) => (
            <label key={l}>
              <span>{LANG_SHORT[l]}</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={opacities[l] ?? 0.5}
                onChange={(e) => setOpacities({ ...opacities, [l]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
      )}

      <div className="compare-scroll">
        {ordered.map((panel, idx) => {
          const isSel = selected.includes(panel.id);
          const notes = doc.notes.filter((n) => n.scope === 'panel' && n.panelId === panel.id);
          return (
            <article
              key={panel.id}
              id={`panel-${panel.id}`}
              className={`panel-card ${isSel ? 'sel' : ''} ${
                activeDrag?.panelId === panel.id && activeDrag.scope === 'page' ? 'scope-page' : ''
              }`}
              onClick={() => setSelected([panel.id])}
            >
              <div className="panel-card-head">
                <b>{t('format.panel', { number: formatNumber(idx + 1) })}</b>
                <span className="muted tiny">
                  x {Math.round(panel.rect.x * 100)}% · y {Math.round(panel.rect.y * 100)}% ·{' '}
                  {Math.round(panel.rect.w * 100)}% × {Math.round(panel.rect.h * 100)}%
                </span>
                <span className="spacer" />
                {notes.length > 0 && (
                  <span className="chip">{t('compare.noteCount', { count: formatNumber(notes.length) })}</span>
                )}
              </div>

              {overlay ? (
                <div className="lang-grid overlay">{renderOverlayPane(panel)}</div>
              ) : (
                <div className={`lang-grid cols-${langs.length}`} style={{ ['--cols' as string]: langs.length }}>
                  {langs.map((l) => renderLangPane(l, panel))}
                </div>
              )}

              {notes.length > 0 && (
                <ul className="panel-notes">
                  {notes.map((n) => (
                    <li key={n.id}>
                      {n.tags.map((t) => (
                        <span className="tag" key={t}>
                          {t}
                        </span>
                      ))}
                      <span>{n.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
