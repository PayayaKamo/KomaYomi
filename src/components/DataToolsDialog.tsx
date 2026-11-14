import { useEffect, useRef, useState } from 'react';
import type { CacheStats, Library, StorageConfig, StorageStatus, StorageTarget } from '../types';
import { api } from '../api';

type Props = {
  onClose: () => void;
  onRestored: (library: Library) => void;
};

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 一键备份 / 恢复：恢复前先展示将覆盖什么，并自动留下恢复前快照 */
export function DataToolsDialog({ onClose, onRestored }: Props) {
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
        name: draft.target.name.trim() || (draft.role === 'raw' ? '远端素材' : '备份目标'),
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
      setStorageMsg('存储设置已保存');
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
    setStorageMsg('正在读取远端目录树…');
    try {
      const res = await api.syncStorage();
      onRestored(res.library);
      await loadStorage();
      setStorageMsg(
        `已同步 ${res.files} 个文件（${res.dirs} 个目录）${res.skipped ? `，${res.skipped} 个目录无法读取` : ''}${
          res.truncated ? '，已达文件上限' : ''
        }`,
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
      setStorageMsg(`已清除 ${res.removed} 个缓存文件`);
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
      setStorageMsg(`备份完成：${res.target ? `${res.target} / ` : ''}${res.file}（${kb(res.size)}）`);
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
        {status.online ? '在线' : '离线'}：{status.message}
        {status.readOnly && status.online ? '（只读）' : ''}
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
            <h2>备份与恢复</h2>
            <p>把 data/ 里的标注、模板、预设打包；缩略图缓存不包含在内</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <section className="backup-section">
            <h3>导出备份</h3>
            <p className="muted tiny">生成 .zip 下载，可用于换电脑或防误操作。</p>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runExport()}>
              {busy ? '处理中…' : '生成并下载备份'}
            </button>
            {exported && (
              <p className="muted tiny">
                已生成 <a href={exported.url} download>备份文件</a>（{kb(exported.size)}）
              </p>
            )}
          </section>

          <section className="backup-section">
            <h3>从备份恢复</h3>
            <p className="muted tiny">
              恢复会覆盖 data/ 下同名文件，但不会删除备份中没有的页面；开始前会自动保存一份当前数据的快照。
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
              选择备份文件…
            </button>

            {pending && (
              <div className="banner warn">
                <b>确认覆盖？</b> {pending.name}
                <ul>
                  <li>
                    包含 {pending.info.pages} 页数据、{pending.info.notes} 条笔记、{pending.info.templates} 个模板、
                    {pending.info.presets} 个预设
                  </li>
                  <li>涉及卷：{pending.info.volumes.join('、') || '（无）'}</li>
                  <li>
                    将覆盖 <b>{pending.info.overwrite}</b> 个现有文件；未在备份中的文件会保留
                  </li>
                </ul>
                <div className="row-inline">
                  <button type="button" className="btn" onClick={() => setPending(null)} disabled={busy}>
                    取消
                  </button>
                  <button type="button" className="btn danger" onClick={() => void confirmRestore()} disabled={busy}>
                    确认恢复
                  </button>
                </div>
              </div>
            )}

            {restored && (
              <div className="banner info">
                已恢复 {restored.restored} 个文件。
                {restored.snapshot && <>恢复前快照：<code>{restored.snapshot}</code></>}
              </div>
            )}
          </section>
          <section className="backup-section">
            <h3>远端素材 / 网络存储</h3>
            <p className="muted tiny">
              页面按需读取并缓存在本地（缓存有上限），断网时已缓存的页仍可阅读；密码加密保存，不会写进备份。
            </p>
            {!storage ? (
              <p className="muted tiny">读取存储设置…</p>
            ) : (
              <>
                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => void testStorage()}>
                    测试连接
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !storage.config.rawSource}
                    onClick={() => void syncRemote()}
                  >
                    同步远端目录树
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void clearCache()}>
                    清除图片缓存
                  </button>
                </div>
                <p className="muted tiny">
                  缓存 {kb(storage.cache.bytes)} / {storage.cache.limitMb} MB（{storage.cache.files} 个文件）
                </p>
                <label className="field">
                  缓存上限（MB）
                  <input
                    type="number"
                    min={32}
                    step={32}
                    value={cacheLimit}
                    onChange={(e) => setCacheLimit(Number(e.target.value) || 512)}
                  />
                </label>

                <div className="banner info">
                  <b>远端素材目录</b>
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
                          编辑
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
                          移除
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="muted tiny">未配置。当前只读取本机 raw/ 目录。</div>
                      <button type="button" className="btn" disabled={busy} onClick={() => beginEdit('raw')}>
                        添加远端目录
                      </button>
                    </>
                  )}
                </div>

                <div className="banner info">
                  <b>备份目标</b>
                  <div className="muted tiny">把 data/ 打包上传到本机其他目录、网络盘或 WebDAV。</div>
                  {storage.config.backups.length === 0 && <div className="muted tiny">尚未配置备份目标。</div>}
                  {storage.config.backups.map((target) => (
                    <div key={target.id}>
                      {target.name} · {target.kind === 'webdav' ? target.url : target.path}
                      {statusLine(target)}
                      <div className="row-inline">
                        <button type="button" className="btn" disabled={busy} onClick={() => void backupTo(target.id)}>
                          备份到此目标
                        </button>
                        <button type="button" className="btn" disabled={busy} onClick={() => beginEdit('backup', target)}>
                          编辑
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="row-inline">
                    <button type="button" className="btn" disabled={busy} onClick={() => beginEdit('backup')}>
                      添加备份目标
                    </button>
                  </div>
                </div>

                {draft && (
                  <div className="banner warn">
                    <b>{draft.role === 'raw' ? '编辑远端素材目录' : '编辑备份目标'}</b>
                    <div className="row-inline">
                      <label className="field">
                        名称
                        <input
                          value={draft.target.name}
                          onChange={(e) => setDraft({ ...draft, target: { ...draft.target, name: e.target.value } })}
                        />
                      </label>
                      <label className="field">
                        类型
                        <select
                          value={draft.target.kind}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              target: { ...draft.target, kind: e.target.value as StorageTarget['kind'] },
                            })
                          }
                        >
                          <option value="local">本机目录</option>
                          <option value="network">网络盘 / UNC</option>
                          <option value="webdav">WebDAV</option>
                        </select>
                      </label>
                    </div>
                    {draft.target.kind === 'webdav' ? (
                      <>
                        <label className="field">
                          WebDAV 地址
                          <input
                            placeholder="https://nas.local/dav/manga"
                            value={draft.target.url ?? ''}
                            onChange={(e) => setDraft({ ...draft, target: { ...draft.target, url: e.target.value } })}
                          />
                        </label>
                        <label className="field">
                          用户名
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
                        目录路径
                        <input
                          placeholder="D:\\manga 或 \\\\nas\\share\\manga"
                          value={draft.target.path ?? ''}
                          onChange={(e) => setDraft({ ...draft, target: { ...draft.target, path: e.target.value } })}
                        />
                      </label>
                    )}
                    <label className="field">
                      密码{draft.target.hasSecret ? '（已保存，留空则不修改）' : ''}
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
                        只读
                      </span>
                    </label>
                    <div className="row-inline">
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void saveDraft()}>
                        保存
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>
                        取消
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
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
