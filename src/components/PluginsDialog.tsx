import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';

type PluginEntry = {
  file: string;
  name: string;
  match?: Record<string, string>;
  error?: string;
  errorCode?: string;
};

type Props = {
  onClose: () => void;
};

/**
 * Panel plugins: what is installed, what each plugin claims to match, and why a file failed to load.
 * The list is read-only; plugins are plain files on disk and a refresh picks up edits without a restart.
 */
export function PluginsDialog({ onClose }: Props) {
  const { t, formatNumber } = useI18n();
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .plugins()
      .then((res) => {
        if (!cancelled) setPlugins(res.plugins);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal plugins-modal">
        <header className="modal-head">
          <div>
            <h2>{t('plugins.title')}</h2>
            <p>{t('plugins.subtitle')}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="banner info">
            <span>
              {t('plugins.hintBefore')}
              <code>plugins/</code>
              {t('plugins.hintBetween')}
              <code>data/plugins/</code>
              {t('plugins.hintAfter')}
            </span>
          </div>

          <div className="plugins-toolbar">
            <span className="muted tiny">{t('plugins.count', { count: formatNumber(plugins.length) })}</span>
            <span className="spacer" />
            <button type="button" className="btn tiny" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              {loading ? t('plugins.refreshing') : t('plugins.refresh')}
            </button>
          </div>

          {error && <div className="banner error">{error}</div>}

          {!error && loading && !plugins.length && <div className="plugins-empty muted">{t('plugins.loading')}</div>}

          {!error && !loading && !plugins.length && (
            <div className="plugins-empty">
              <strong>{t('plugins.empty')}</strong>
              <span className="muted tiny">{t('plugins.emptyHint')}</span>
            </div>
          )}

          {plugins.length > 0 && (
            <div className="plugin-list">
              {plugins.map((plugin) => (
                <div className={`plugin-row ${plugin.error ? 'failed' : ''}`} key={plugin.file}>
                  <span className="plugin-dot" aria-hidden="true" />
                  <div className="plugin-main">
                    <div className="plugin-head">
                      <strong>{plugin.name}</strong>
                      <code>{plugin.file}</code>
                    </div>
                    {plugin.error ? (
                      <div className="plugin-error">
                        {plugin.errorCode && <code className="plugin-code">{plugin.errorCode}</code>}
                        <span>{plugin.error}</span>
                      </div>
                    ) : plugin.match ? (
                      <div className="plugin-match">
                        {plugin.match.volume && (
                          <span className="chip-mini">{t('plugins.matchVolume', { value: plugin.match.volume })}</span>
                        )}
                        {plugin.match.chapter && (
                          <span className="chip-mini">
                            {t('plugins.matchChapter', { value: plugin.match.chapter })}
                          </span>
                        )}
                        {plugin.match.file && (
                          <span className="chip-mini">{t('plugins.matchFile', { value: plugin.match.file })}</span>
                        )}
                      </div>
                    ) : (
                      <span className="muted tiny">{t('plugins.allPages')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted tiny">{t('plugins.fallbackHint')}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
