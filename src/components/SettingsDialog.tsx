import { useCallback, useEffect, useState } from 'react';
import type { CacheOverview } from '../types';
import { api } from '../api';
import { formatBytes, useI18n } from '../i18n';
import { setAnnSurface, useAnnSurface } from '../lib/annotationSurface';
import type { AnnSurface } from '../lib/annotationSurface';

type CacheTarget = 'thumbs' | 'remote' | 'staging';

/**
 * Preferences plus storage/cache maintenance. Every clear action targets rebuildable
 * data only; notes, annotations, presets and templates are never touched here.
 */
export function SettingsDialog({ onClose, onPageReload }: { onClose: () => void; onPageReload?: () => void }) {
  const { t, formatNumber } = useI18n();
  const surface = useAnnSurface();
  const [cache, setCache] = useState<CacheOverview | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [busy, setBusy] = useState<CacheTarget | 'detect' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDetect, setConfirmDetect] = useState(false);

  const loadCache = useCallback(() => {
    api
      .cacheOverview()
      .then((next) => {
        setCache(next);
        setCacheError(null);
      })
      .catch((err: unknown) => setCacheError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(loadCache, [loadCache]);

  const clear = async (target: CacheTarget) => {
    if (!cache) return;
    const before =
      target === 'thumbs' ? cache.thumbs.bytes : target === 'remote' ? cache.remote.bytes : cache.staging.bytes;
    setBusy(target);
    setMessage(null);
    setCacheError(null);
    try {
      const res = await api.clearCache(target);
      const after =
        target === 'thumbs'
          ? res.cache.thumbs.bytes
          : target === 'remote'
            ? res.cache.remote.bytes
            : res.cache.staging.bytes;
      setCache(res.cache);
      setMessage(
        t('settings.cacheClearDone', {
          count: formatNumber(res.removed),
          size: formatBytes(Math.max(0, before - after)),
        }),
      );
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const resetDetect = async () => {
    setBusy('detect');
    setMessage(null);
    setCacheError(null);
    try {
      const res = await api.resetDetect();
      setCache(res.cache);
      setConfirmDetect(false);
      setMessage(
        t('settings.detectDone', {
          pages: formatNumber(res.pages),
          panels: formatNumber(res.panels),
          notes: formatNumber(res.notes),
          annotations: formatNumber(res.annotations),
        }),
      );
      onPageReload?.();
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const usage = (size: { bytes: number; files: number }) =>
    t('settings.cacheUsage', { bytes: formatBytes(size.bytes), files: formatNumber(size.files) });

  const clearButton = (target: CacheTarget) => (
    <button
      type="button"
      className="btn tiny"
      disabled={
        busy !== null ||
        !cache ||
        (target === 'thumbs' ? cache.thumbs.files : target === 'remote' ? cache.remote.files : cache.staging.files) ===
          0
      }
      onClick={() => void clear(target)}
    >
      {busy === target ? t('settings.cacheClearing') : t('settings.cacheClear')}
    </button>
  );

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal">
        <header className="modal-head">
          <div>
            <h2>{t('settings.title')}</h2>
            <p>{t('settings.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('settings.close')}>
            ×
          </button>
        </header>
        <div className="settings-body">
          <div className="settings-row">
            <div>
              <strong>{t('settings.annSurface')}</strong>
              <p className="muted tiny">{t('settings.annSurfaceHint')}</p>
            </div>
            <select
              className="tb-select"
              value={surface}
              onChange={(e) => setAnnSurface(e.target.value as AnnSurface)}
              title={t('settings.annSurface')}
              aria-label={t('settings.annSurface')}
            >
              <option value="read">{t('settings.annRead')}</option>
              <option value="panels">{t('settings.annPanels')}</option>
              <option value="both">{t('settings.annBoth')}</option>
            </select>
          </div>

          <section className="settings-section" aria-labelledby="settings-storage">
            <div className="settings-section-head">
              <h3 id="settings-storage">{t('settings.storageSection')}</h3>
              <button type="button" className="btn tiny" disabled={busy !== null} onClick={loadCache}>
                {t('settings.refresh')}
              </button>
            </div>
            <p className="muted tiny">{t('settings.storageHint')}</p>

            <div className="settings-row">
              <div>
                <strong>{t('settings.thumbs')}</strong>
                <p className="muted tiny">{t('settings.thumbsHint')}</p>
                {cache && <span className="settings-cache-usage muted tiny">{usage(cache.thumbs)}</span>}
              </div>
              {clearButton('thumbs')}
            </div>

            <div className="settings-row">
              <div>
                <strong>{t('settings.staging')}</strong>
                <p className="muted tiny">{t('settings.stagingHint')}</p>
                {cache && <span className="settings-cache-usage muted tiny">{usage(cache.staging)}</span>}
              </div>
              {clearButton('staging')}
            </div>

            <div className="settings-row">
              <div>
                <strong>{t('settings.remoteCache')}</strong>
                <p className="muted tiny">{t('settings.remoteCacheHint')}</p>
                {cache && <span className="settings-cache-usage muted tiny">{usage(cache.remote)}</span>}
              </div>
              {clearButton('remote')}
            </div>

            <div className="settings-row">
              <div>
                <strong>{t('settings.detect')}</strong>
                <p className="muted tiny">{t('settings.detectHint')}</p>
                {cache && (
                  <span className="settings-cache-usage muted tiny">
                    {t('settings.detectUsage', {
                      pages: formatNumber(cache.detect.pages),
                      panels: formatNumber(cache.detect.panels),
                    })}
                    {' · '}
                    {t('settings.detectProtected', {
                      notes: formatNumber(cache.detect.notes),
                      annotations: formatNumber(cache.detect.annotations),
                    })}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn tiny danger"
                disabled={busy !== null || !cache || cache.detect.pages === 0}
                onClick={() => setConfirmDetect(true)}
              >
                {busy === 'detect' ? t('settings.cacheClearing') : t('settings.detectClear')}
              </button>
            </div>

            {confirmDetect && cache && (
              <div className="settings-confirm" role="alertdialog" aria-live="polite">
                <p>{t('settings.detectConfirm', { pages: formatNumber(cache.detect.pages) })}</p>
                <div className="settings-confirm-actions">
                  <button
                    type="button"
                    className="btn tiny"
                    disabled={busy !== null}
                    onClick={() => setConfirmDetect(false)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn tiny danger"
                    disabled={busy !== null}
                    onClick={() => void resetDetect()}
                  >
                    {busy === 'detect' ? t('settings.cacheClearing') : t('settings.detectClear')}
                  </button>
                </div>
              </div>
            )}

            {message && <div className="banner info">{message}</div>}
            {cacheError && <div className="banner error">{cacheError}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
