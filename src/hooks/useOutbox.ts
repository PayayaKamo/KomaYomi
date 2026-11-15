import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { dropOutbox, listOutbox, pendingOutboxCount, subscribeOutbox } from '../lib/outbox';
import type { OutboxEntry } from '../lib/outbox';

/** How often a queued write is retried while the tab stays open. */
const RETRY_INTERVAL_MS = 30_000;

/**
 * Send one queued write. Every branch is idempotent: page/config saves are PUT-style,
 * and the two "create" operations skip when a record with the same user-visible identity
 * already exists, so a retry after a lost response cannot duplicate it.
 */
async function replayEntry(entry: OutboxEntry): Promise<void> {
  switch (entry.kind) {
    case 'page':
      await api.savePage(entry.doc, entry.source);
      return;
    case 'volumeDirs':
      await api.saveVolumeDirs(entry.volume, entry.dirs);
      return;
    case 'langOrder':
      await api.saveLangOrder(entry.order);
      return;
    case 'panelTemplate': {
      const { templates } = await api.panelTemplates();
      const exists = templates.some(
        (tpl) =>
          tpl.name === entry.input.name && tpl.volume === entry.input.volume && tpl.chapter === entry.input.chapter,
      );
      if (!exists) await api.savePanelTemplate(entry.input);
      return;
    }
    case 'alignPreset': {
      const { presets } = await api.alignPresets();
      const exists = presets.some(
        (preset) =>
          preset.name === entry.preset.name &&
          preset.volume === entry.preset.volume &&
          preset.chapter === entry.preset.chapter,
      );
      if (!exists) await api.saveAlignPreset(entry.preset);
      return;
    }
  }
}

/**
 * Replays writes queued by failed saves: on mount, when the browser reconnects, every 30s
 * while anything is pending, and on demand from the pending-count chip.
 */
export function useOutbox() {
  const [count, setCount] = useState(pendingOutboxCount);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => subscribeOutbox(() => setCount(pendingOutboxCount())), []);

  const replay = useCallback(async () => {
    if (running.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!pendingOutboxCount()) return;
    running.current = true;
    setSyncing(true);
    setError(null);
    let failures = 0;
    let detail: string | null = null;
    try {
      // Snapshot once: entries added while replaying are picked up on the next pass.
      for (const entry of listOutbox()) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
        try {
          await replayEntry(entry);
          // Drop only the exact queued revision, never a newer write for the same target.
          dropOutbox(entry.key, entry.at);
        } catch (err) {
          failures += 1;
          detail ??= err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      running.current = false;
      setSyncing(false);
      setCount(pendingOutboxCount());
      setError(failures > 0 ? t('outbox.replayFailed', { count: failures, detail: detail ?? '' }) : null);
    }
  }, []);

  useEffect(() => {
    void replay();
    const onOnline = () => void replay();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      if (pendingOutboxCount() > 0) void replay();
    }, RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [replay]);

  return { count, syncing, error, replay };
}
