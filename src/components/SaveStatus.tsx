import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import type { ProjectLinkStatus } from '../api';
import { formatBytes, formatDate, useI18n } from '../i18n';
import { saveProjectCopy } from '../lib/projectCopy';

type Props = {
  dirty: boolean;
  saving: boolean;
  saveMode: 'auto' | 'confirm';
  readOnly?: boolean;
  /** Flush the current page first so "write back now" includes the latest edits. */
  onSavePage: () => Promise<void>;
};

type Tone = 'saved' | 'dirty' | 'queued' | 'busy' | 'failed';

const TONE_STYLE: Record<Tone, CSSProperties> = {
  saved: {},
  dirty: { color: 'var(--warn)', borderColor: 'var(--warn)' },
  queued: { color: 'var(--warn-text)' },
  busy: { color: 'var(--info-text)' },
  failed: { color: 'var(--danger-text)', background: 'var(--danger-soft)', borderColor: 'var(--danger)' },
};

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 10,
  padding: '4px 10px',
  fontSize: 11.5,
};
const ROW_LABEL: CSSProperties = { color: 'var(--muted)', flex: '0 0 auto' };
const ROW_VALUE: CSSProperties = {
  color: 'var(--text-2)',
  textAlign: 'right',
  wordBreak: 'break-all',
  minWidth: 0,
};
const NOTE: CSSProperties = { padding: '6px 10px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 };
const ERROR: CSSProperties = {
  margin: '4px 10px',
  padding: '6px 8px',
  borderRadius: 8,
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--danger-text)',
  background: 'var(--danger-soft)',
  wordBreak: 'break-word',
};
const INFO: CSSProperties = {
  margin: '4px 10px',
  padding: '6px 8px',
  borderRadius: 8,
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--info-text)',
  background: 'var(--info-soft)',
  wordBreak: 'break-word',
};

/**
 * Top-bar save chip: shows the page save state at a glance and opens a panel with
 * the write-back status of the linked .mnproj (target, last write, queue, errors).
 */
export function SaveStatus({ dirty, saving, saveMode, readOnly = false, onSavePage }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<ProjectLinkStatus | null>(null);
  const [busy, setBusy] = useState<'save' | 'saveAs' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setLink(await api.projectLink());
    } catch {
      setLink(null);
    }
  }, []);

  // Poll lightly so queued → written transitions show up without user action.
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), busy ? 1200 : 4000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const writeNow = useCallback(async () => {
    if (readOnly || !link?.linked) return;
    setBusy('save');
    setNotice(null);
    try {
      // Unflushed page edits would otherwise be missing from the archive.
      if (dirty) await onSavePage();
      const res = await api.saveProjectFile();
      setLink(res.link);
      setNotice(
        res.result
          ? {
              kind: 'info',
              text: t('file.saveProjectDone', { path: res.result.path, size: formatBytes(res.result.size) }),
            }
          : { kind: 'error', text: t('file.saveProjectNoLink') },
      );
    } catch (err) {
      setNotice({
        kind: 'error',
        text: `${t('file.saveProjectFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [dirty, link?.linked, onSavePage, readOnly, refresh, t]);

  /** Guidance when nothing is linked: keep a standalone copy without touching any file. */
  const saveAs = useCallback(async () => {
    const suggested = link?.name || `komayomi-${new Date().toISOString().slice(0, 10)}`;
    setBusy('saveAs');
    setNotice(null);
    const out = await saveProjectCopy({ title: t('file.saveAsTitle'), suggestedName: suggested });
    setBusy(null);
    if (out.kind === 'canceled') return;
    if (out.kind === 'saved') {
      setNotice({ kind: 'info', text: t('file.saveAsDone', { path: out.path, size: formatBytes(out.size) }) });
    } else if (out.kind === 'downloaded') {
      setNotice({ kind: 'info', text: t('file.saveAsDownloaded', { file: out.file }) });
    } else {
      setNotice({ kind: 'error', text: `${t('file.saveAsFailed')}: ${out.message}` });
    }
  }, [link?.name, t]);

  const tone: Tone =
    saving || busy === 'save'
      ? 'busy'
      : link?.paused || link?.lastError
        ? 'failed'
        : dirty
          ? 'dirty'
          : link?.pending
            ? 'queued'
            : 'saved';

  const label = saving
    ? t('app.saveSaving')
    : busy === 'save'
      ? t('file.statusWriting')
      : tone === 'failed'
        ? t('file.statusFailed')
        : dirty
          ? saveMode === 'confirm'
            ? t('app.saveUnsaved')
            : t('app.savePending')
          : link?.pending
            ? t('file.statusQueued')
            : t('app.saveSaved');

  const canWrite = !readOnly && Boolean(link?.linked) && busy === null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={`save-state ${tone === 'dirty' ? 'dirty' : ''}`}
        style={{ cursor: 'pointer', ...TONE_STYLE[tone] }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('file.statusTitle')}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>

      {open && (
        <div
          className="file-pop"
          role="dialog"
          aria-label={t('file.statusTitle')}
          style={{ width: 'min(360px, calc(100vw - 24px))' }}
        >
          <div className="file-group">{t('file.statusTitle')}</div>

          <div style={ROW}>
            <span style={ROW_LABEL}>{t('file.statusTarget')}</span>
            <span style={ROW_VALUE}>{link?.linked ? link.path : t('file.statusUnlinked')}</span>
          </div>
          <div style={ROW}>
            <span style={ROW_LABEL}>{t('file.statusLastWrite')}</span>
            <span style={ROW_VALUE}>
              {link?.lastWriteAt
                ? `${formatDate(link.lastWriteAt)}${link.lastWriteSize ? ` · ${formatBytes(link.lastWriteSize)}` : ''}`
                : t('file.statusNever')}
            </span>
          </div>
          <div style={ROW}>
            <span style={ROW_LABEL}>{t('file.statusQueue')}</span>
            <span style={ROW_VALUE}>{link?.pending ? t('file.statusQueuedYes') : t('file.statusQueuedNo')}</span>
          </div>

          {link?.lastError && (
            <div style={ERROR} role="alert">
              {link.lastError}
            </div>
          )}

          {!link?.linked && <div style={NOTE}>{t('file.statusNotLinked')}</div>}
          {readOnly && <div style={NOTE}>{t('file.statusReadOnly')}</div>}
          {busy === 'save' && <div style={NOTE}>{t('file.saveProjectBusy')}</div>}
          {busy === 'saveAs' && <div style={NOTE}>{t('file.saveAsBusy')}</div>}
          {notice && (
            <div style={notice.kind === 'error' ? ERROR : INFO} role="status">
              {notice.text}
            </div>
          )}

          <div className="file-sep" />
          <button
            type="button"
            className="file-item"
            disabled={!canWrite}
            title={readOnly ? t('file.statusReadOnly') : link?.linked ? undefined : t('file.saveProjectNoLink')}
            onClick={() => void writeNow()}
          >
            {link?.lastError ? t('file.retry') : t('file.writeNow')}
          </button>
          {!link?.linked && (
            <button
              type="button"
              className="file-item"
              disabled={readOnly || busy !== null}
              title={window.mangaDesktop ? undefined : t('file.saveAsBrowser')}
              onClick={() => void saveAs()}
            >
              {t('file.saveAs')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
