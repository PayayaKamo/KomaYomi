import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { HistorySource } from '../api';
import { t, useI18n } from '../i18n';
import { dropOutbox, enqueueOutbox, outboxKeyOf } from '../lib/outbox';
import { keepaliveFits } from '../lib/keepalive';
import { remapPanelRefs } from '../../shared/panelRemap';
import type { PageDoc, PageEntry } from '../types';

export type Selection = { volume: string; chapter: string; pageIndex: number };

/** Save mode: auto = debounced autosave; confirm = only saves when ✓ is clicked. */
export type SaveMode = 'auto' | 'confirm';

/** Coarse action label for one undoable edit, surfaced by the operation-history panel. */
export type UndoKind = 'notes' | 'annotations' | 'panels' | 'other';

/** One entry of the in-memory undo stack, metadata only (the snapshot stays internal). */
export type UndoEntry = {
  id: string;
  at: number;
  source: HistorySource;
  kind: UndoKind;
  /** Panel the edit belongs to, when the diff points at one. */
  panelId: string | null;
};

type StackEntry = UndoEntry & { doc: PageDoc };

let entrySeq = 0;
const nextEntryId = () => `u${Date.now().toString(36)}-${(entrySeq += 1)}`;

/** Compare two documents just enough to name the action that produced the newer one. */
function describeChange(before: PageDoc, after: PageDoc, source: HistorySource): UndoEntry {
  let kind: UndoKind = 'other';
  let panelId: string | null = null;
  const noteIndex = after.notes.findIndex((n, i) => before.notes[i] !== n);
  if (before.notes !== after.notes) {
    kind = 'notes';
    panelId = (noteIndex >= 0 ? after.notes[noteIndex] : after.notes[after.notes.length - 1])?.panelId ?? null;
  } else if (before.annotations !== after.annotations) {
    kind = 'annotations';
    const afterAnn = after.annotations ?? [];
    const beforeAnn = before.annotations ?? [];
    const annIndex = afterAnn.findIndex((a, i) => beforeAnn[i] !== a);
    panelId = (annIndex >= 0 ? afterAnn[annIndex] : afterAnn[afterAnn.length - 1])?.panelId ?? null;
  } else if (before.panels !== after.panels) {
    kind = 'panels';
  }
  return { id: nextEntryId(), at: Date.now(), source, kind, panelId };
}

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
 * Loading / auto panel detection / saving / undo-redo for a page document.
 * auto mode debounces writes by 700ms; confirm mode writes only on commit(), and discard() reverts to disk.
 * `readOnly` keeps every in-memory view change (panning alignment, selection) working while
 * disabling detection, saving and every disk write.
 */
export function usePage(sel: Selection | null, readOnly = false) {
  const { locale } = useI18n();
  const [state, setState] = useState<State>(initial);
  const [reloadTick, setReloadTick] = useState(0);
  const [saveMode, setSaveModeState] = useState<SaveMode>(readSaveMode);
  const [historyState, setHistoryState] = useState<{ undo: number; redo: number; entries: UndoEntry[] }>({
    undo: 0,
    redo: 0,
    entries: [],
  });

  const pending = useRef<PageDoc | null>(null);
  /** Why the pending save happened; forwarded to the cross-session version history. */
  const pendingSource = useRef<HistorySource>('auto');
  const timer = useRef<number | null>(null);
  const lastKey = useRef<string>('');
  const docRef = useRef<PageDoc | null>(null);
  const savedDoc = useRef<PageDoc | null>(null);
  const saveModeRef = useRef<SaveMode>(saveMode);
  const undoStack = useRef<StackEntry[]>([]);
  const redoStack = useRef<StackEntry[]>([]);
  const lastHistoryAt = useRef(0);
  /** Read-only mode must never hand the document to a save path, including unload. */
  const readOnlyRef = useRef(readOnly);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    saveModeRef.current = saveMode;
    try {
      localStorage.setItem(SAVE_MODE_KEY, saveMode);
    } catch {
      /* Ignored in private mode. */
    }
  }, [saveMode]);

  const syncHistoryCounts = () => {
    const entries = undoStack.current.map(({ doc: _doc, ...meta }) => meta).reverse();
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length, entries });
  };

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /** Drop pending edits and reload from disk (after bulk template/preset apply, and by × discard). */
  const reload = useCallback(() => {
    pending.current = null;
    clearTimer();
    setReloadTick((n) => n + 1);
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
    if (readOnlyRef.current) {
      // Read mode never writes: nothing may reach the page file or the outbox.
      pending.current = null;
      return;
    }
    const doc = pending.current;
    if (!doc) return;
    const source = pendingSource.current;
    pendingSource.current = 'auto';
    pending.current = null;
    setState((s) => ({ ...s, saving: true }));
    try {
      const res = await api.savePage(doc, source);
      savedDoc.current = cloneDoc(res.doc);
      // A successful write supersedes any queued copy of the same page.
      dropOutbox(outboxKeyOf(doc));
      setState((s) => ({ ...s, saving: false, dirty: pending.current ? s.dirty : false, exists: true }));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Never lose notes: keep an offline copy that the outbox replays later.
      const queued = enqueueOutbox({ kind: 'page', doc, source });
      pending.current = doc;
      setState((s) => ({
        ...s,
        saving: false,
        error: queued ? t('outbox.queued', { detail }) : detail,
      }));
    }
  }, []);

  const scheduleSave = useCallback(
    (doc: PageDoc, source: HistorySource = 'auto') => {
      if (readOnlyRef.current) return;
      pending.current = doc;
      pendingSource.current = source;
      clearTimer();
      timer.current = window.setTimeout(() => {
        void flush();
      }, 700);
    },
    [flush],
  );

  const pushHistory = useCallback((doc: PageDoc, meta: UndoEntry) => {
    const now = Date.now();
    // Dragging fires mutate continuously; coalesce by time window so one undo doesn't move it 1px at a time.
    if (now - lastHistoryAt.current < HISTORY_COALESCE_MS && undoStack.current.length) return;
    undoStack.current.push({ ...meta, at: now, doc: cloneDoc(doc) });
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    lastHistoryAt.current = now;
    syncHistoryCounts();
  }, []);

  const mutate = useCallback(
    (fn: (doc: PageDoc) => PageDoc, opts?: { history?: boolean; source?: HistorySource }) => {
      const cur = docRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      if (opts?.history !== false) pushHistory(cur, describeChange(cur, next, opts?.source ?? 'auto'));
      docRef.current = next;
      if (readOnlyRef.current) {
        // View-only session: the change stays in memory and is never scheduled for saving.
        setState((s) => ({ ...s, doc: next }));
        return;
      }
      setState((s) => ({ ...s, doc: next, dirty: true }));
      if (saveModeRef.current === 'auto') scheduleSave(next, opts?.source);
      else {
        pending.current = next;
        pendingSource.current = opts?.source ?? 'auto';
      }
    },
    [pushHistory, scheduleSave],
  );

  /** ✓ save (confirm mode); in auto mode this writes immediately. */
  const commit = useCallback(async () => {
    if (readOnlyRef.current) return;
    const doc = docRef.current;
    if (!doc) return;
    pending.current = doc;
    pendingSource.current = 'manual';
    await flush();
  }, [flush]);

  /** × discard: revert to the last content written to disk. */
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

  /**
   * Walk back `steps` snapshots (1 = plain undo, more = jump to an older entry from the
   * history panel). Every step lands on the redo stack, so redo stays in sync.
   */
  const undoTo = useCallback(
    (steps: number) => {
      if (readOnlyRef.current) return;
      let remaining = Math.max(1, steps);
      while (remaining > 0) {
        const prev = undoStack.current.pop();
        const cur = docRef.current;
        if (!prev || !cur) {
          if (prev) undoStack.current.push(prev);
          break;
        }
        redoStack.current.push({ ...prev, doc: cloneDoc(cur), at: Date.now() });
        docRef.current = prev.doc;
        remaining -= 1;
      }
      const next = docRef.current;
      if (!next) {
        syncHistoryCounts();
        return;
      }
      setState((s) => ({ ...s, doc: next, dirty: true }));
      if (saveModeRef.current === 'auto') scheduleSave(next);
      else pending.current = next;
      syncHistoryCounts();
    },
    [scheduleSave],
  );

  const undo = useCallback(() => undoTo(1), [undoTo]);

  const redo = useCallback(() => {
    const cur = docRef.current;
    const next = redoStack.current.pop();
    if (!cur || !next) return;
    undoStack.current.push({ ...next, doc: cloneDoc(cur), at: Date.now() });
    docRef.current = next.doc;
    if (readOnlyRef.current) {
      setState((s) => ({ ...s, doc: next.doc }));
      syncHistoryCounts();
      return;
    }
    setState((s) => ({ ...s, doc: next.doc, dirty: true }));
    if (saveModeRef.current === 'auto') scheduleSave(next.doc);
    else pending.current = next.doc;
    syncHistoryCounts();
  }, [scheduleSave]);

  const setSaveMode = useCallback(
    (mode: SaveMode) => {
      const prevMode = saveModeRef.current;
      saveModeRef.current = mode;
      setSaveModeState(mode);
      // Switching confirm → auto: flush pending edits now so they are not silently lost.
      if (prevMode === 'confirm' && mode === 'auto' && pending.current) {
        scheduleSave(pending.current);
      }
    },
    [scheduleSave],
  );

  const detect = useCallback(
    async (lang?: string) => {
      if (!sel || readOnlyRef.current) return;
      setState((s) => ({ ...s, detecting: true, error: null }));
      try {
        const res = await api.detect(sel.volume, sel.chapter, sel.pageIndex, lang, docRef.current?.readingDirection);
        const panels = res.panels.map((rect, i) => ({ id: `p${i + 1}`, rect, source: 'auto' as const }));
        mutate(
          (doc) => {
            // Panel ids are rewritten on every detection; match by rectangle so notes and marks
            // stay on the drawing they were written for instead of jumping to another cell.
            const remap = remapPanelRefs(doc, panels);
            return {
              ...doc,
              panels,
              notes: remap.notes,
              annotations: remap.annotations,
              groups: remap.groups,
              panelOffsets: remap.panelOffsets,
              detectorVersion: res.version,
              detectedAt: new Date().toISOString(),
              detectSource: res.source === 'template' || res.source === 'plugin' ? res.source : 'auto',
            };
          },
          { source: 'detect' },
        );
        // Detector warnings come from the server in their own language; join them for display
        // and keep the machine-readable code visible when there is one.
        const warnings = res.warnings ?? [];
        setState((s) => ({
          ...s,
          detecting: false,
          error: warnings.length
            ? `${res.errorCode ? `[${res.errorCode}] ` : ''}${warnings.join(t('common.listSeparator'))}`
            : null,
        }));
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

  // Load the page.
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
    // Confirm mode never writes without ✓. Leaving with unsaved edits is resolved by the
    // navigation guard in App (save or stay); anything still pending is dropped here.
    if (saveModeRef.current === 'confirm') pending.current = null;
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
        if (!res.exists && res.doc.panels.length === 0 && hasImage && !readOnlyRef.current) {
          // First open: auto-detect panels (the result is autosaved along with the next edit).
          void api
            .detect(sel.volume, sel.chapter, sel.pageIndex, undefined, res.doc.readingDirection)
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
              pendingSource.current = 'detect';
              if (timer.current !== null) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => void flush(), 700);
            })
            .catch(() => {
              /* Detection failed: stay blank; the user can draw panels manually. */
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

  // Page warnings come from the server already rendered in the interface language, so a
  // locale switch refetches the page. Confirm-mode edits stay put: reloading would drop them.
  const localeRef = useRef(locale);
  useEffect(() => {
    if (localeRef.current === locale) return;
    localeRef.current = locale;
    if (readOnlyRef.current) return;
    if (saveModeRef.current === 'confirm' && pending.current) return;
    void flush().then(() => reload());
  }, [locale, flush, reload]);

  useEffect(() => {
    const onUnload = () => {
      if (readOnlyRef.current) return;
      const doc = pending.current;
      if (!doc) return;
      const body = JSON.stringify(doc);
      // A keepalive body over the browser's 64 KiB cap is rejected silently, so queue
      // that write for the outbox instead of pretending it was sent.
      const fallback = () => {
        enqueueOutbox({ kind: 'page', doc, source: pendingSource.current });
      };
      if (!keepaliveFits(body)) {
        fallback();
        return;
      }
      try {
        void fetch('/api/page', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(fallback);
      } catch {
        fallback();
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
    undoTo,
    undoEntries: historyState.entries,
    canUndo: historyState.undo > 0,
    canRedo: historyState.redo > 0,
    redoCount: historyState.redo,
  };
}
