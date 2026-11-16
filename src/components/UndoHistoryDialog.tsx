import type { HistorySource } from '../api';
import type { UndoEntry } from '../hooks/usePage';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';

const KIND_KEY: Record<UndoEntry['kind'], MessageKey> = {
  notes: 'undoHistory.kind.notes',
  annotations: 'undoHistory.kind.annotations',
  panels: 'undoHistory.kind.panels',
  other: 'undoHistory.kind.other',
};

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
  /** Newest first, straight from the undo stack. */
  entries: UndoEntry[];
  redoCount: number;
  readOnly: boolean;
  /** Page number in the book, used for the target label. */
  pageNumber: number;
  /** 1-based panel number, or null for page-level edits. */
  panelNumberOf: (panelId: string | null) => number | null;
  /** Undo `steps` snapshots, landing on the picked entry. */
  onPick: (steps: number) => void;
  onClose: () => void;
};

/**
 * Read-only view of the in-memory undo stack (not the on-disk version history).
 * The newest entry is the state on screen; picking an older one undoes everything
 * above it, so redo stays available.
 */
export function UndoHistoryDialog({
  open,
  entries,
  redoCount,
  readOnly,
  pageNumber,
  panelNumberOf,
  onPick,
  onClose,
}: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal undo-history-modal" role="dialog" aria-modal="true" aria-label={t('undoHistory.title')}>
        <header className="modal-head">
          <div>
            <h2>{t('undoHistory.title')}</h2>
            <p>{t('undoHistory.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </header>

        <div className="modal-body undo-history-body">
          {readOnly ? (
            <p className="muted small">{t('undoHistory.readOnly')}</p>
          ) : entries.length === 0 ? (
            <p className="muted small">{t('undoHistory.empty')}</p>
          ) : (
            <ol className="undo-history-list">
              {entries.map((entry, index) => {
                const panel = panelNumberOf(entry.panelId);
                return (
                  <li key={entry.id} className={index === 0 ? 'current' : ''}>
                    <button
                      type="button"
                      className="undo-history-item"
                      onClick={() => {
                        onPick(index + 1);
                        onClose();
                      }}
                      title={t('undoHistory.jump')}
                    >
                      <span className={`undo-history-kind kind-${entry.kind}`}>{t(KIND_KEY[entry.kind])}</span>
                      <span className="undo-history-target">
                        {panel === null
                          ? t('undoHistory.targetPage', { page: formatNumber(pageNumber) })
                          : t('undoHistory.targetPanel', {
                              page: formatNumber(pageNumber),
                              panel: formatNumber(panel),
                            })}
                        <span className="undo-history-source">{t(SOURCE_KEY[entry.source])}</span>
                      </span>
                      {index === 0 && <span className="undo-history-current">{t('undoHistory.current')}</span>}
                      <span className="undo-history-time">{formatDate(new Date(entry.at).toISOString())}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {!readOnly && redoCount > 0 && (
            <p className="muted tiny undo-history-redo">
              {t('undoHistory.redoCount', { count: formatNumber(redoCount) })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
