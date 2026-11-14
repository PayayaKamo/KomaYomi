import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AlignMode, AlignOffset, AlignPreset, Lang, PageDoc, PageEntry, Panel } from '../types';
import {
  ALIGN_MODE_HINT,
  ALIGN_MODE_LABEL,
  DEFAULT_OFFSET,
  LANG_LABEL,
  LANG_SHORT,
  LANGUAGES,
  READING_LABEL,
} from '../types';
import { sortPanels } from '../lib/geometry';
import { api } from '../api';

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
  const ordered = useMemo(() => sortPanels(doc.panels, doc.readingDirection), [doc.panels, doc.readingDirection]);
  const mode: AlignMode = doc.alignMode ?? 'page';
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
  const movedRef = useRef(false);
  const dragRef = useRef<{
    lang: Lang;
    panelId: string;
    mode: AlignMode;
    sx: number;
    sy: number;
    rect: DOMRect;
    start: AlignOffset;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

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

  const offsetOf = (lang: Lang, panel: Panel): AlignOffset =>
    isPanelMode ? doc.panelOffsets?.[panel.id]?.[lang] ?? DEFAULT_OFFSET : doc.offsets[lang] ?? DEFAULT_OFFSET;

  const setOffset = (lang: Lang, panel: Panel, next: AlignOffset) => {
    mutate((d) =>
      isPanelMode
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
        const usePanel = d.mode === 'panel' || d.mode === 'anchors';
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
      const current = offsetOf(lang, panel);
      setOffset(lang, panel, {
        ...current,
        x: clamp(current.x + (pendingAnchor.x - tx), -2, 2),
        y: clamp(current.y + (pendingAnchor.y - ty), -2, 2),
      });
      setDragLang(lang);
      setPendingAnchor(null);
      return;
    }
    e.preventDefault();
    movedRef.current = false;
    dragRef.current = {
      lang,
      panelId: panel.id,
      mode,
      sx: e.clientX,
      sy: e.clientY,
      rect,
      start: offsetOf(lang, panel),
    };
    setDragLang(lang);
    setDragging(true);
  };

  const zoomBy = (lang: Lang, panel: Panel, deltaY: number) => {
    const current = offsetOf(lang, panel);
    const next = clamp(+(current.scale * (deltaY < 0 ? 1.06 : 0.94)).toFixed(3), 0.5, 3);
    setOffset(lang, panel, { ...current, scale: next });
  };

  // 滚轮缩放：只在真正悬停在某一语言的图格上时接管，其他位置让页面正常滚动。
  // React 的 onWheel 在根节点上是 passive 的，无法阻止页面滚动，所以这里用原生非 passive 监听。
  const scrollRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    const paneEl = target?.closest('.lang-pane') as HTMLElement | null;
    if (!paneEl || paneEl.dataset.hasImage !== '1') return;
    const lang = paneEl.dataset.lang as Lang | undefined;
    const panel = doc.panels.find((p) => p.id === paneEl.dataset.panelId);
    if (!lang || !panel) return;
    e.preventDefault();
    e.stopPropagation();
    zoomBy(lang, panel, e.deltaY);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // 无分格时会提前 return，等到有分格后需要重新挂载监听
  }, [doc.panels.length]);

  const resetLang = (lang: Lang, panel?: Panel) => {
    if (isPanelMode) {
      if (!panel) return;
      mutate((d) => ({
        ...d,
        panelOffsets: { ...d.panelOffsets, [panel.id]: { ...d.panelOffsets?.[panel.id], [lang]: DEFAULT_OFFSET } },
      }));
      return;
    }
    mutate((d) => ({ ...d, offsets: { ...d.offsets, [lang]: DEFAULT_OFFSET } }));
  };

  const resetAll = () => {
    setPendingAnchor(null);
    if (isPanelMode) mutate((d) => ({ ...d, panelOffsets: {} }));
    else mutate((d) => ({ ...d, offsets: {} }));
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

  const offsetsOf = (lang: Lang, panel: Panel): AlignOffset => offsetOf(lang, panel);

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
          <div className="pane-missing">本页缺少{LANG_LABEL[lang]}图片</div>
        </div>
      );
    }
    return (
      <div
        key={lang}
        className={`lang-pane ${dragging && dragLang === lang ? 'dragging' : ''}`}
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
            title={`${LANG_LABEL[lang]} 已遮蔽：点击显示，再点画面可遮回`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((r) => ({ ...r, [revealKey(panel.id, lang)]: true }));
            }}
          >
            <span>
              {LANG_SHORT[lang]} 已遮蔽
              <em>点击显示</em>
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
            title="复位该格该语言"
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
        className="lang-pane overlay"
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
            title="有些语言被遮蔽，点击显示"
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
              部分语言已遮蔽
              <em>点击显示</em>
            </span>
          </div>
        )}
        <span className="lang-tag">
          {langs.map((l) => LANG_SHORT[l]).join(' + ')} 叠加 · 正在对齐 {LANG_SHORT[dragLang]}
        </span>
      </div>
    );
  };

  if (!doc.panels.length) {
    return (
      <div className="compare-empty">
        <p>这一页还没有格子。</p>
        <p className="muted">先到「分格」里自动检测或手动框选，再进行对照阅读。</p>
      </div>
    );
  }

  return (
    <div className="compare-tab">
      <div className="stage-toolbar">
        <div className="tb-group">
          <span className="tb-label">语言</span>
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
                  title={disabled ? '本页缺少该语言' : LANG_LABEL[l]}
                >
                  {LANG_SHORT[l]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="tb-group mask-group">
          <span className="tb-label">遮蔽</span>
          <button
            type="button"
            className={`btn tiny ${maskPrefs.master ? 'on' : ''}`}
            onClick={() => {
              setMaskPrefs((p) => ({ ...p, master: !p.master }));
              setRevealed({});
            }}
            title="开启后按下方语言分别遮蔽；H 全部遮住，Shift+H 全部显示"
          >
            {maskPrefs.master ? '开' : '关'}
          </button>
          {maskPrefs.master &&
            availableLangs.map((l) => (
              <button
                type="button"
                key={l}
                className={`lang-chip ${maskPrefs.masked[l] ? 'on' : ''}`}
                onClick={() => toggleMaskLang(l)}
                title={`${LANG_LABEL[l]}：${maskPrefs.masked[l] ? '遮蔽（点击可临时显示）' : '不遮蔽'}`}
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
                title="遮蔽样式"
              >
                <option value="blur">模糊</option>
                <option value="solid">色块</option>
              </select>
              <button type="button" className="btn tiny" onClick={() => setRevealed({})} title="全部遮住（H）">
                全遮
              </button>
              <button
                type="button"
                className="btn tiny"
                onClick={() => setMaskPrefs((p) => ({ ...p, master: false }))}
                title="全部显示（Shift+H）"
              >
                全显
              </button>
              <button
                type="button"
                className={`btn tiny ${maskDefaultsOpen ? 'on' : ''}`}
                onClick={() => setMaskDefaultsOpen((v) => !v)}
                title="设置默认遮蔽哪些语言（跨会话记住）"
              >
                默认…
              </button>
            </>
          )}
        </div>

        <div className="tb-group">
          <div className="seg">
            <button type="button" className={!overlay ? 'on' : ''} onClick={() => setOverlay(false)}>
              并排
            </button>
            <button type="button" className={overlay ? 'on' : ''} onClick={() => setOverlay(true)}>
              叠加
            </button>
          </div>
          {overlay && (
            <>
              <label className="tb-check">
                <input type="checkbox" checked={blend} onChange={(e) => setBlend(e.target.checked)} />
                正片叠底
              </label>
              <span className="muted tiny">对齐对象</span>
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
          <span className="tb-label">对齐</span>
          <select
            className={`tb-select mode mode-${mode}`}
            value={mode}
            onChange={(e) => changeMode(e.target.value as AlignMode)}
            title={ALIGN_MODE_HINT[mode]}
          >
            {(Object.keys(ALIGN_MODE_LABEL) as AlignMode[]).map((m) => (
              <option key={m} value={m}>
                {ALIGN_MODE_LABEL[m]}
              </option>
            ))}
          </select>
          {mode === 'grid' && (
            <select
              className="tb-select"
              value={doc.gridStep ?? 1}
              onChange={(e) => mutate((d) => ({ ...d, gridStep: Number(e.target.value) }))}
              title="吸附步长"
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
            title="对齐数值、预设与批量套用"
          >
            对齐设置
          </button>
        </div>

        <div className="tb-group right">
          <span className="muted tiny">{READING_LABEL[doc.readingDirection]}</span>
          <button type="button" className="btn tiny" onClick={() => goTo(-1)}>
            上一格
          </button>
          <button type="button" className="btn tiny" onClick={() => goTo(1)}>
            下一格
          </button>
          <button type="button" className="btn tiny" onClick={resetAll}>
            全部复位
          </button>
        </div>
      </div>

      {alignOpen && (
        <div className="align-box">
          <div className="align-hint">
            <b>{ALIGN_MODE_LABEL[mode]}</b>
            <span>{ALIGN_MODE_HINT[mode]}</span>
            {mode === 'anchors' && (
              <span className="anchor-tip">
                {pendingAnchor
                  ? `参考点已取（${LANG_SHORT[pendingAnchor.lang]}），请在另一种语言点同一位置`
                  : `参考语言：${LANG_SHORT[baseLang]}，先在任一格点特征点`}
                {pendingAnchor && (
                  <button type="button" className="btn tiny" onClick={() => setPendingAnchor(null)}>
                    取消取点
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="align-row">
            <span className="tb-label">对象</span>
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
              {isPanelMode ? `作用于第 ${ordered.findIndex((p) => p.id === panelForInput?.id) + 1 || 1} 格` : '作用于整页'}
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
              缩放
              <input
                type="number"
                step={0.01}
                min={0.5}
                max={3}
                value={+inputOffset.scale.toFixed(2)}
                onChange={(e) => applyNumeric({ scale: clamp(Number(e.target.value), 0.5, 3) })}
              />
            </label>
          </div>

          <div className="align-row">
            <input
              className="preset-name"
              placeholder="预设名称，例如「纸质版扫描」"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button
              type="button"
              className="btn tiny"
              disabled={!presetName.trim() || presetBusy}
              onClick={() => savePreset('page')}
            >
              存为页预设
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={!presetName.trim() || presetBusy}
              onClick={() => savePreset('chapter')}
            >
              存为话预设
            </button>
            <span className="align-sep" />
            <select className="tb-select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">选择预设…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {ALIGN_MODE_LABEL[p.mode]} · {p.scope === 'chapter' ? '话' : '页'}
                </option>
              ))}
            </select>
            <button type="button" className="btn tiny" disabled={!presetId || presetBusy} onClick={() => applyPreset('page')}>
              套用本页
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={!presetId || presetBusy}
              onClick={() => applyPreset('chapter')}
            >
              套用整话
            </button>
            <button
              type="button"
              className="btn tiny danger"
              disabled={!presetId || presetBusy}
              onClick={() => void deletePreset()}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {maskDefaultsOpen && (
        <div className="mask-defaults">
          <b>默认遮蔽</b>
          {LANGUAGES.map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                checked={maskPrefs.masked[l]}
                onChange={() =>
                  setMaskPrefs((p) => ({ ...p, masked: { ...p.masked, [l]: !p.masked[l] } }))
                }
              />
              {LANG_LABEL[l]}
            </label>
          ))}
          <span className="muted tiny">勾选的语言在开启遮蔽时默认盖住；偏好会自动保存，导出永远不带遮罩。</span>
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

      <div className="compare-scroll" ref={scrollRef}>
        {ordered.map((panel, idx) => {
          const isSel = selected.includes(panel.id);
          const notes = doc.notes.filter((n) => n.scope === 'panel' && n.panelId === panel.id);
          return (
            <article
              key={panel.id}
              id={`panel-${panel.id}`}
              className={`panel-card ${isSel ? 'sel' : ''}`}
              onClick={() => setSelected([panel.id])}
            >
              <div className="panel-card-head">
                <b>第 {idx + 1} 格</b>
                <span className="muted tiny">
                  x {Math.round(panel.rect.x * 100)}% · y {Math.round(panel.rect.y * 100)}% ·{' '}
                  {Math.round(panel.rect.w * 100)}% × {Math.round(panel.rect.h * 100)}%
                </span>
                <span className="spacer" />
                {notes.length > 0 && <span className="chip">{notes.length} 条批注</span>}
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
