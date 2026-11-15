import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { HistorySource, PageVersion } from '../api';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Selection } from '../hooks/usePage';

/**
 * Page version history dialog.
 *
 * Every save appends a snapshot on the server (see `server/pageHistory.ts`), so these
 * versions are cross-session. The dialog deliberately sits apart from the undo/redo
 * buttons: undo is the in-memory editing stack, history is the on-disk audit trail.
 */

const SOURCE_KEY: Record<HistorySource, MessageKey> = {
  auto: 'history.source.auto',
  manual: 'history.source.manual',
  batch: 'history.source.batch',
  template: 'history.source.template',
  align: 'history.source.align',
  annotation: 'history.source.annotation',
  import: 'history.source.import',
  restore: 'history.source.restore',
  detect: 'history.source.detect',
};

type Props = {
  open: boolean;
  sel: Selection | null;
  onClose: () => void;
  /** Flush pending auto-saves so the snapshot does not miss the latest keystrokes. */
  onBeforeRestore: () => Promise<void>;
  onRestored: () => void;
};

function PanelPreview({ panels, label }: { panels: PageVersion['panels']; label: string }) {
  return (
    <figure className="hist-preview">
      <svg viewBox="0 0 100 100" role="img" aria-label={label} preserveAspectRatio="none">
        <rect x="0" y="0" width="100" height="100" className="hist-preview-bg" />
        {panels.map((panel) => (
          <rect
            key={panel.id}
            x={panel.rect.x * 100}
            y={panel.rect.y * 100}
            width={panel.rect.w * 100}
            height={panel.rect.h * 100}
            className="hist-preview-panel"
          />
        ))}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function PageHistoryDialog({ open, sel, onClose, onBeforeRestore, onRestored }: Props) {
  const { t, locale, formatDate, formatNumber } = useI18n();
  const [entries, setEntries] = useState<PageVersion[]>([]);
  const [limit, setLimit] = useState(50);
  const [limitDraft, setLimitDraft] = useState('50');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!sel) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.pageHistory(sel.volume, sel.chapter, sel.pageIndex);
      setEntries(res.entries);
      setLimit(res.limit);
      setLimitDraft(String(res.limit));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [sel]);

  useEffect(() => {
    if (!open) return;
    setExpanded(new Set());
    setUndoId(null);
    setNotice('');
    setBusy(null);
    void load();
    // Version summaries are written on the server in the interface language: refetch on switch.
  }, [open, load, locale]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const restore = async (id: string, undo = false) => {
    if (!sel) return;
    if (!undo && !window.confirm(t('history.restoreConfirm'))) return;
    setBusy(undo ? 'undo' : id);
    setError(null);
    setNotice('');
    try {
      await onBeforeRestore();
      const res = await api.restorePageVersion({
        volume: sel.volume,
        chapter: sel.chapter,
        pageIndex: sel.pageIndex,
        id,
      });
      setUndoId(res.previousId);
      setNotice(t('history.restoredNotice'));
      onRestored();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveLimit = async () => {
    const value = Number(limitDraft);
    if (!Number.isFinite(value) || Math.round(value) === limit) return;
    try {
      const res = await api.setHistoryLimit(value);
      setLimit(res.limit);
      setLimitDraft(String(res.limit));
      setNotice(t('history.keepSaved'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const diffChips = (version: PageVersion): string[] => {
    const d = version.diff;
    if (!d) return [];
    const chips: string[] = [];
    if (d.panelsDelta) {
      chips.push(
        t('history.diffPanels', {
          from: formatNumber(d.panels - d.panelsDelta),
          to: formatNumber(d.panels),
        }),
      );
    }
    if (d.added) chips.push(t('history.diffAdded', { count: formatNumber(d.added) }));
    if (d.removed) chips.push(t('history.diffRemoved', { count: formatNumber(d.removed) }));
    if (d.moved) chips.push(t('history.diffMoved', { count: formatNumber(d.moved) }));
    if (d.resized) chips.push(t('history.diffResized', { count: formatNumber(d.resized) }));
    if (d.annotationsDelta) {
      chips.push(
        t('history.diffAnnotations', {
          from: formatNumber(d.annotations - d.annotationsDelta),
          to: formatNumber(d.annotations),
        }),
      );
    }
    return chips;
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history-modal" role="dialog" aria-modal="true" aria-label={t('history.heading')}>
        <header className="modal-head">
          <div>
            <h2>{t('history.heading')}</h2>
            <p>{t('history.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('history.heading')}>
            ×
          </button>
        </header>

        <div className="modal-body history-body">
          <div className="hist-toolbar">
            <span className="muted tiny">{t('history.count', { count: formatNumber(entries.length) })}</span>
            <label className="hist-limit">
              <span>{t('history.keepLimit')}</span>
              <input
                type="number"
                min={5}
                max={200}
                value={limitDraft}
                onChange={(e) => setLimitDraft(e.target.value)}
                onBlur={() => void saveLimit()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveLimit();
                }}
              />
              <span>{t('history.keepUnit')}</span>
            </label>
            {undoId && (
              <button
                type="button"
                className="btn tiny"
                title={t('history.undoRestoreHint')}
                disabled={busy !== null}
                onClick={() => void restore(undoId, true)}
              >
                ↶ {t('history.undoRestore')}
              </button>
            )}
          </div>

          <p className="hist-legend">{t('history.legend')}</p>
          {notice && <div className="banner info">{notice}</div>}
          {error && <div className="banner error">{t('history.error', { error })}</div>}
          {loading && <div className="muted small">{t('history.loading')}</div>}
          {!loading && !entries.length && !error && <div className="muted small">{t('history.empty')}</div>}

          <ul className="hist-list">
            {entries.map((version, index) => {
              const previous = entries[index + 1];
              const chips = diffChips(version);
              const isOpen = expanded.has(version.id);
              return (
                <li key={version.id} className={`hist-row ${index === 0 ? 'current' : ''}`}>
                  <div className="hist-main">
                    <div className="hist-meta">
                      <time dateTime={version.at}>{formatDate(version.at)}</time>
                      <span className="hist-source">{t(SOURCE_KEY[version.source] ?? 'history.source.auto')}</span>
                      {index === 0 && <span className="hist-current-tag">{t('history.current')}</span>}
                    </div>
                    <p className="hist-summary">{version.summary || t('history.noChanges')}</p>
                    <div className="hist-chips">
                      <span className="hist-chip">
                        {t('history.panels', { count: formatNumber(version.panelCount) })}
                      </span>
                      <span className="hist-chip">
                        {t('history.annotations', { count: formatNumber(version.annotationCount) })}
                      </span>
                      <span className="hist-chip">
                        {t('history.notes', { count: formatNumber(version.noteCount) })}
                      </span>
                      {chips.map((chip) => (
                        <span key={chip} className="hist-chip diff">
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="hist-actions">
                    <button
                      type="button"
                      className="btn tiny"
                      aria-expanded={isOpen}
                      onClick={() => toggle(version.id)}
                    >
                      {isOpen ? t('history.collapse') : t('history.expand')}
                    </button>
                    <button
                      type="button"
                      className="btn tiny primary"
                      disabled={busy !== null || index === 0}
                      onClick={() => void restore(version.id)}
                    >
                      {busy === version.id ? t('history.restoring') : t('history.restore')}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="hist-previews">
                      <PanelPreview panels={version.panels} label={t('history.versionPreview')} />
                      <PanelPreview panels={previous?.panels ?? []} label={t('history.previousPreview')} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
