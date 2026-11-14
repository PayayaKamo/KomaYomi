import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PageDoc, PageEntry } from '../types';

export type Selection = { volume: string; chapter: string; pageIndex: number };

/** 保存模式：auto = 防抖自动保存；confirm = 需点 ✓ 才落盘 */
export type SaveMode = 'auto' | 'confirm';

const SAVE_MODE_KEY = 'manga-memo.save-mode';
const HISTORY_LIMIT = 60;
const HISTORY_COALESCE_MS = 600;

function readSaveMode(): SaveMode {
  try {
    return localStorage.getItem(SAVE_MODE_KEY) === 'confirm' ? 'confirm' : 'auto';
  } catch {
    return 'auto';
  }
}

const cloneDoc = (doc: PageDoc): PageDoc => JSON.parse(JSON.stringify(doc)) as PageDoc;

type State = {
  doc: PageDoc | null;
  page: PageEntry | null;
  exists: boolean;
  loading: boolean;
  error: string | null;
  detecting: boolean;
  dirty: boolean;
  saving: boolean;
};

const initial: State = {
  doc: null,
  page: null,
  exists: false,
  loading: false,
  error: null,
  detecting: false,
  dirty: false,
  saving: false,
};

/**
 * 页面文档的加载 / 自动切格 / 保存 / 撤销重做。
 * auto 模式使用 700ms 防抖；confirm 模式只有 commit() 才写盘，discard() 回到磁盘版本。
 */
export function usePage(sel: Selection | null) {
  const [state, setState] = useState<State>(initial);
  const [reloadTick, setReloadTick] = useState(0);
  const [saveMode, setSaveModeState] = useState<SaveMode>(readSaveMode);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });

  const pending = useRef<PageDoc | null>(null);
  const timer = useRef<number | null>(null);
  const lastKey = useRef<string>('');
  const docRef = useRef<PageDoc | null>(null);
  const savedDoc = useRef<PageDoc | null>(null);
  const saveModeRef = useRef<SaveMode>(saveMode);
  const undoStack = useRef<PageDoc[]>([]);
  const redoStack = useRef<PageDoc[]>([]);
  const lastHistoryAt = useRef(0);

  useEffect(() => {
    saveModeRef.current = saveMode;
    try {
      localStorage.setItem(SAVE_MODE_KEY, saveMode);
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [saveMode]);

  const syncHistoryCounts = () => {
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length });
  };

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /** 丢弃待保存内容并从磁盘重新读取（批量套用模板/预设之后用，也用于 × 放弃） */
  const reload = useCallback(() => {
    pending.current = null;
    clearTimer();
    setReloadTick((n) => n + 1);
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
    const doc = pending.current;
    if (!doc) return;
    pending.current = null;
    setState((s) => ({ ...s, saving: true }));
    try {
      const res = await api.savePage(doc);
      savedDoc.current = cloneDoc(res.doc);
      setState((s) => ({ ...s, saving: false, dirty: pending.current ? s.dirty : false, exists: true }));
    } catch (err) {
      pending.current = doc;
      setState((s) => ({ ...s, saving: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  const scheduleSave = useCallback(
    (doc: PageDoc) => {
      pending.current = doc;
      clearTimer();
      timer.current = window.setTimeout(() => {
        void flush();
      }, 700);
    },
    [flush],
  );

  const pushHistory = useCallback((doc: PageDoc) => {
    const now = Date.now();
    // 拖动会连续触发 mutate，这里按时间窗合并成一步，避免撤销一次只退 1px
    if (now - lastHistoryAt.current < HISTORY_COALESCE_MS && undoStack.current.length) return;
    undoStack.current.push(cloneDoc(doc));
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    lastHistoryAt.current = now;
    syncHistoryCounts();
  }, []);

  const mutate = useCallback(
    (fn: (doc: PageDoc) => PageDoc, opts?: { history?: boolean }) => {
      const cur = docRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      if (opts?.history !== false) pushHistory(cur);
      docRef.current = next;
      setState((s) => ({ ...s, doc: next, dirty: true }));
      if (saveModeRef.current === 'auto') scheduleSave(next);
      else pending.current = next;
    },
    [pushHistory, scheduleSave],
  );

  /** ✓ 保存（confirm 模式）；auto 模式下等于立即落盘 */
  const commit = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) return;
    pending.current = doc;
    await flush();
  }, [flush]);

  /** × 放弃：回到最近一次落盘的内容 */
  const discard = useCallback(() => {
    const base = savedDoc.current;
    if (!base) return;
    pending.current = null;
    clearTimer();
    const restored = cloneDoc(base);
    docRef.current = restored;
    setState((s) => ({ ...s, doc: restored, dirty: false }));
    undoStack.current = [];
    redoStack.current = [];
    syncHistoryCounts();
  }, []);

  const undo = useCallback(() => {
    const cur = docRef.current;
    const prev = undoStack.current.pop();
    if (!cur || !prev) return;
    redoStack.current.push(cloneDoc(cur));
    docRef.current = prev;
    setState((s) => ({ ...s, doc: prev, dirty: true }));
    if (saveModeRef.current === 'auto') scheduleSave(prev);
    else pending.current = prev;
    syncHistoryCounts();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const cur = docRef.current;
    const next = redoStack.current.pop();
    if (!cur || !next) return;
    undoStack.current.push(cloneDoc(cur));
    docRef.current = next;
    setState((s) => ({ ...s, doc: next, dirty: true }));
    if (saveModeRef.current === 'auto') scheduleSave(next);
    else pending.current = next;
    syncHistoryCounts();
  }, [scheduleSave]);

  const setSaveMode = useCallback((mode: SaveMode) => {
    const prevMode = saveModeRef.current;
    saveModeRef.current = mode;
    setSaveModeState(mode);
    // 从确认模式切回自动模式时，把挂起的修改立即落盘，避免静默丢失
    if (prevMode === 'confirm' && mode === 'auto' && pending.current) {
      scheduleSave(pending.current);
    }
  }, [scheduleSave]);

  const detect = useCallback(
    async (lang?: string) => {
      if (!sel) return;
      setState((s) => ({ ...s, detecting: true, error: null }));
      try {
        const res = await api.detect(sel.volume, sel.chapter, sel.pageIndex, lang);
        const panels = res.panels.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' as const }));
        mutate((doc) => ({
          ...doc,
          panels,
          detectorVersion: res.version,
          detectedAt: new Date().toISOString(),
          detectSource: res.source === 'template' || res.source === 'plugin' ? res.source : 'auto',
        }));
        setState((s) => ({ ...s, detecting: false, error: res.warnings?.length ? res.warnings.join('；') : null }));
      } catch (err) {
        setState((s) => ({
          ...s,
          detecting: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [mutate, sel],
  );

  // 加载页面
  useEffect(() => {
    if (!sel) {
      docRef.current = null;
      savedDoc.current = null;
      setState(initial);
      return;
    }
    const key = `${sel.volume}|${sel.chapter}|${sel.pageIndex}`;
    lastKey.current = key;
    let cancelled = false;
    // 确认模式下离开当前页时先把挂起修改落盘，避免切换页面静默丢失
    if (pending.current && saveModeRef.current === 'confirm' && undoStack.current.length) {
      const leaving = pending.current;
      pending.current = null;
      void api.savePage(leaving).catch(() => null);
    }
    undoStack.current = [];
    redoStack.current = [];
    syncHistoryCounts();
    setState({ ...initial, loading: true });

    api
      .page(sel.volume, sel.chapter, sel.pageIndex)
      .then((res) => {
        if (cancelled) return;
        docRef.current = res.doc;
        savedDoc.current = cloneDoc(res.doc);
        setState({
          doc: res.doc,
          page: res.page,
          exists: res.exists,
          loading: false,
          error: null,
          detecting: false,
          dirty: false,
          saving: false,
        });
        const hasImage = Object.keys(res.page.files).length > 0;
        if (!res.exists && res.doc.panels.length === 0 && hasImage) {
          // 首次打开：自动切格（结果会在下一步随编辑一起自动保存）
          void api
            .detect(sel.volume, sel.chapter, sel.pageIndex)
            .then((det) => {
              if (cancelled || lastKey.current !== key) return;
              const panels = det.panels.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' as const }));
              const nextDoc = {
                ...res.doc,
                panels,
                detectorVersion: det.version,
                detectedAt: new Date().toISOString(),
                detectSource: det.source === 'template' || det.source === 'plugin' ? det.source : ('auto' as const),
              };
              docRef.current = nextDoc;
              setState((s) => (s.doc ? { ...s, doc: nextDoc } : s));
              pending.current = nextDoc;
              if (timer.current !== null) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => void flush(), 700);
            })
            .catch(() => {
              /* 自动切格失败时保持空白，用户可手动加框 */
            });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ ...initial, error: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [sel, flush, reloadTick]);

  useEffect(() => {
    const onUnload = () => {
      if (pending.current) {
        void fetch('/api/page', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending.current),
          keepalive: true,
        });
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return {
    ...state,
    mutate,
    detect,
    flush,
    reload,
    saveMode,
    setSaveMode,
    commit,
    discard,
    undo,
    redo,
    canUndo: historyState.undo > 0,
    canRedo: historyState.redo > 0,
  };
}
