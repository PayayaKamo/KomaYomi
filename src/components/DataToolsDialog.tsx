import { useEffect, useRef, useState } from 'react';
import type { CacheStats, Library, StorageConfig, StorageStatus, StorageTarget } from '../types';
import { api } from '../api';
import { formatBytes, formatNumber, t, useI18n } from '../i18n';

type Props = {
  onClose: () => void;
  onRestored: (library: Library) => void;
};

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(t('common.readFileFailed')));
    reader.readAsDataURL(file);
  });
}

/** 一键备份 / 恢复：恢复前先展示将覆盖什么，并自动留下恢复前快照 */
export function DataToolsDialog({ onClose, onRestored }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ url: string; size: number } | null>(null);
  const [pending, setPending] = useState<{
    data: string;
    name: string;
    info: { pages: number; notes: number; volumes: string[]; templates: number; presets: number; overwrite: number };
  } | null>(null);
  const [restored, setRestored] = useState<{ restored: number; snapshot: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Remote storage state: config, cache usage and per-target reachability.
  const [storage, setStorage] = useState<{ config: StorageConfig; cache: CacheStats } | null>(null);
  const [statuses, setStatuses] = useState<Record<string, StorageStatus>>({});
  const [draft, setDraft] = useState<{ role: 'raw' | 'backup'; target: StorageTarget } | null>(null);
  const [draftSecret, setDraftSecret] = useState('');
  const [cacheLimit, setCacheLimit] = useState(512);
  const [storageMsg, setStorageMsg] = useState<string | null>(null);

  const loadStorage = async () => {
    try {
      const res = await api.storage();
      setStorage(res);
      setCacheLimit(res.config.cacheLimitMb);
    } catch (err) {
      setStorageMsg(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void loadStorage();
  }, []);

  const beginEdit = (role: 'raw' | 'backup', target?: StorageTarget) => {
    setDraft({
      role,
      target: target ?? { id: `${role}-${Date.now()}`, name: '', kind: 'local', enabled: true },
    });
    setDraftSecret('');
  };

  const saveDraft = async () => {
    if (!storage || !draft) return;
    setBusy(true);
    setStorageMsg(null);
    try {
      const target: StorageTarget = {
        ...draft.target,
        name: draft.target.name.trim() || t(draft.role === 'raw' ? 'backup.defaultRawName' : 'backup.defaultBackupName'),
      };
      const config: StorageConfig = { ...storage.config, cacheLimitMb: cacheLimit };
      if (draft.role === 'raw') {
        config.rawSource = target;
      } else {
        const exists = config.backups.some((t) => t.id === target.id);
        config.backups = exists ? config.backups.map((t) => (t.id === target.id ? target : t)) : [...config.backups, target];
      }
      const res = await api.saveStorage(config, draftSecret ? { [target.id]: draftSecret } : undefined);
      setStorage({ config: res.config, cache: storage.cache });
      setDraft(null);
      setDraftSecret('');
      setStorageMsg(t('backup.saved'));
    } catch (err) {
      setStorageMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const testStorage = async () => {
    setBusy(true);
    try {
      const res = await api.testStorage();
      setStatuses(Object.fromEntries(res.statuses.map((s) => [s.id, s])));
    } catch (err) {
      setStorageMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const syncRemote = async () => {
    setBusy(true);
    setStorageMsg(t('backup.loadingTree'));
    try {
      const res = await api.syncStorage();
      onRestored(res.library);
      await loadStorage();
      setStorageMsg(
        [
          t('backup.synced', { files: formatNumber(res.files), dirs: formatNumber(res.dirs) }),
          res.skipped ? t('backup.syncedSkipped', { count: formatNumber(res.skipped) }) : '',
          res.truncated ? t('backup.syncedTruncated') : '',
        ].join(''),
      );
    } catch (err) {
      setStorageMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clearCache = async () => {
    setBusy(true);
    try {
      const res = await api.clearStorageCache();
      await loadStorage();
      setStorageMsg(t('backup.cacheCleared', { count: formatNumber(res.removed) }));
    } catch (err) {
      setStorageMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const backupTo = async (targetId?: string) => {
    setBusy(true);
    try {
      const res = await api.backupToStorage(targetId);
      setStorageMsg(
        t('backup.backupDone', {
          target: res.target ? `${res.target} / ` : '',
          file: res.file,
          size: formatBytes(res.size),
        }),
      );
    } catch (err) {
      setStorageMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const statusLine = (target: StorageTarget) => {
    const status = statuses[target.id];
    if (!status) return null;
    return (
      <span className={status.online ? 'muted tiny' : 'banner error'}>
        {status.online ? t('backup.online') : t('backup.offline')}: {status.message}
        {status.readOnly && status.online ? t('backup.statusReadOnly') : ''}
      </span>
    );
  };

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createBackup();
      setExported({ url: res.url, size: res.size });
      const a = document.createElement('a');
      a.href = res.url;
      a.download = res.file;
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setRestored(null);
    try {
      const data = await readFileBase64(file);
      const info = await api.inspectBackup(data);
      setPending({ data, name: file.name, info });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.restoreBackup(pending.data);
      setRestored({ restored: res.restored, snapshot: res.snapshot });
      setPending(null);
      onRestored(res.library);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>{t('backup.title')}</h2>
            <p>{t('backup.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <section className="backup-section">
            <h3>{t('backup.exportSection')}</h3>
            <p className="muted tiny">{t('backup.exportHint')}</p>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runExport()}>
              {busy ? t('backup.processing') : t('backup.generateBackup')}
            </button>
            {exported && (
              <p className="muted tiny">
                {t('backup.generatedBefore')}
                <a href={exported.url} download>
                  {t('backup.backupFileLink')}
                </a>
                {t('backup.generatedAfter', { size: formatBytes(exported.size) })}
              </p>
            )}
          </section>

          <section className="backup-section">
            <h3>{t('backup.restoreSection')}</h3>
            <p className="muted tiny">{t('backup.restoreHint')}</p>
            <input
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
              {t('backup.chooseBackupFile')}
            </button>

            {pending && (
              <div className="banner warn">
                <b>{t('backup.confirmOverwrite')}</b> {pending.name}
                <ul>
                  <li>
                    {t('backup.containsSummary', {
                      pages: formatNumber(pending.info.pages),
                      notes: formatNumber(pending.info.notes),
                      templates: formatNumber(pending.info.templates),
                      presets: formatNumber(pending.info.presets),
                    })}
                  </li>
                  <li>
                    {t('backup.volumesInvolved', {
                      volumes: pending.info.volumes.join(t('common.listSeparator')) || t('backup.none'),
                    })}
                  </li>
                  <li>
                    {t('backup.willOverwriteBefore')}
                    <b>{formatNumber(pending.info.overwrite)}</b>
                    {t('backup.willOverwriteAfter')}
                  </li>
                </ul>
                <div className="row-inline">
                  <button type="button" className="btn" onClick={() => setPending(null)} disabled={busy}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn danger" onClick={() => void confirmRestore()} disabled={busy}>
                    {t('backup.confirmRestore')}
                  </button>
                </div>
              </div>
            )}

            {restored && (
              <div className="banner info">
                {t('backup.restoredCount', { count: formatNumber(restored.restored) })}
                {restored.snapshot && (
                  <>
                    {t('backup.snapshotBeforeRestore')}
                    <code>{restored.snapshot}</code>
                  </>
                )}
              </div>
            )}
          </section>
          <section className="backup-section">
            <h3>{t('backup.remoteSection')}</h3>
            <p className="muted tiny">{t('backup.remoteHint')}</p>
            {!storage ? (
              <p className="muted tiny">{t('backup.loadingStorage')}</p>
            ) : (
              <>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => void testStorage()}>
                    {t('backup.testConnection')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !storage.config.rawSource}
                    onClick={() => void syncRemote()}
                  >
                    {t('backup.syncTree')}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void clearCache()}>
                    {t('backup.clearCache')}
                  </button>
                </div>
                <p className="muted tiny">
                  {t('backup.cacheUsage', {
                    bytes: formatBytes(storage.cache.bytes),
                    limit: formatNumber(storage.cache.limitMb),
                    files: formatNumber(storage.cache.files),
                  })}
                </p>
                <label className="field">
                  {t('backup.cacheLimit')}
                  <input
                    type="number"
                    min={32}
                    step={32}
                    value={cacheLimit}
                    onChange={(e) => setCacheLimit(Number(e.target.value) || 512)}
                  />
                </label>

                <div className="banner info">
                  <b>{t('backup.remoteDir')}</b>
                  {storage.config.rawSource ? (
                    <>
                      <div>
                        {storage.config.rawSource.name} ·{' '}
                        {storage.config.rawSource.kind === 'webdav'
                          ? storage.config.rawSource.url
                          : storage.config.rawSource.path}
                      </div>
                      {statusLine(storage.config.rawSource)}
                      <div className="row-inline">
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => beginEdit('raw', storage.config.rawSource)}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => {
                            setStorage({
                              ...storage,
                              config: { ...storage.config, rawSource: undefined },
                            });
                            void api
                              .saveStorage({ ...storage.config, rawSource: undefined })
                              .then((res) => setStorage({ config: res.config, cache: storage.cache }))
                              .catch((err) => setStorageMsg(err instanceof Error ? err.message : String(err)));
                          }}
                        >
                          {t('backup.remove')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="muted tiny">{t('backup.notConfiguredRaw')}</div>
                      <button type="button" className="btn" disabled={busy} onClick={() => beginEdit('raw')}>
                        {t('backup.addRemoteDir')}
                      </button>
                    </>
                  )}
                </div>

                <div className="banner info">
                  <b>{t('backup.backupTargets')}</b>
                  <div className="muted tiny">{t('backup.backupTargetsHint')}</div>
                  {storage.config.backups.length === 0 && <div className="muted tiny">{t('backup.noTargets')}</div>}
                  {storage.config.backups.map((target) => (
                    <div key={target.id}>
                      {target.name} · {target.kind === 'webdav' ? target.url : target.path}
                      {statusLine(target)}
                      <div className="row-inline">
                        <button type="button" className="btn" disabled={busy} onClick={() => void backupTo(target.id)}>
                          {t('backup.backupToTarget')}
                        </button>
                        <button type="button" className="btn" disabled={busy} onClick={() => beginEdit('backup', target)}>
                          {t('common.edit')}
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="row-inline">
                    <button type="button" className="btn" disabled={busy} onClick={() => beginEdit('backup')}>
                      {t('backup.addTarget')}
                    </button>
                  </div>
                </div>

                {draft && (
                  <div className="banner warn">
                    <b>{draft.role === 'raw' ? t('backup.editRawDir') : t('backup.editTarget')}</b>
                    <div className="row-inline">
                      <label className="field">
                        {t('backup.name')}
                        <input
                          value={draft.target.name}
                          onChange={(e) => setDraft({ ...draft, target: { ...draft.target, name: e.target.value } })}
                        />
                      </label>
                      <label className="field">
                        {t('backup.kind')}
                        <select
                          value={draft.target.kind}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              target: { ...draft.target, kind: e.target.value as StorageTarget['kind'] },
                            })
                          }
                        >
                          <option value="local">{t('backup.kindLocal')}</option>
                          <option value="network">{t('backup.kindNetwork')}</option>
                          <option value="webdav">WebDAV</option>
                        </select>
                      </label>
                    </div>
                    {draft.target.kind === 'webdav' ? (
                      <>
                        <label className="field">
                          {t('backup.webdavUrl')}
                          <input
                            placeholder="https://nas.local/dav/manga"
                            value={draft.target.url ?? ''}
                            onChange={(e) => setDraft({ ...draft, target: { ...draft.target, url: e.target.value } })}
                          />
                        </label>
                        <label className="field">
                          {t('backup.username')}
                          <input
                            value={draft.target.username ?? ''}
                            onChange={(e) =>
                              setDraft({ ...draft, target: { ...draft.target, username: e.target.value } })
                            }
                          />
                        </label>
                      </>
                    ) : (
                      <label className="field">
                        {t('backup.dirPath')}
                        <input
                          placeholder={t('backup.dirPathPlaceholder')}
                          value={draft.target.path ?? ''}
                          onChange={(e) => setDraft({ ...draft, target: { ...draft.target, path: e.target.value } })}
                        />
                      </label>
                    )}
                    <label className="field">
                      {t('backup.password')}
                      {draft.target.hasSecret ? t('backup.passwordSaved') : ''}
                      <input
                        type="password"
                        value={draftSecret}
                        onChange={(e) => setDraftSecret(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="field">
                      <span>
                        <input
                          type="checkbox"
                          checked={Boolean(draft.target.readOnly)}
                          onChange={(e) =>
                            setDraft({ ...draft, target: { ...draft.target, readOnly: e.target.checked } })
                          }
                        />{' '}
                        {t('backup.readOnlyField')}
                      </span>
                    </label>
                    <div className="row-inline">
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void saveDraft()}>
                        {t('common.save')}
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {storageMsg && <div className="banner info">{storageMsg}</div>}
              </>
            )}
          </section>
          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
