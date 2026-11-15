import { useRef, useState } from 'react';
import type { Library } from '../types';
import { api } from '../api';
import type { ProjectConflict, ProjectInspect, ProjectMode } from '../api';
import { formatBytes, formatNumber, t, useI18n } from '../i18n';

type Props = {
  onClose: () => void;
  onImported: (library: Library) => void;
  /** 当前页面是否有未保存修改（confirm 模式下的待保存内容） */
  dirty: boolean;
};

function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error(t('common.readFileFailed')));
    reader.readAsArrayBuffer(file);
  });
}

const today = () => new Date().toISOString().slice(0, 10);

/** 工程文件 .mnproj：另存为工程（引用 / 打包）与打开工程（检查 → 导入） */
export function ProjectDialog({ onClose, onImported, dirty }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ProjectMode>('reference');
  const [name, setName] = useState(`komayomi-${today()}`);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ file: string; url: string; size: number; images: number } | null>(null);
  const [pending, setPending] = useState<{ data: ArrayBuffer; fileName: string; info: ProjectInspect } | null>(null);
  const [conflict, setConflict] = useState<ProjectConflict>('overwrite');
  const [relinkDir, setRelinkDir] = useState('');
  const [done, setDone] = useState<{
    restored: number;
    merged: number;
    skipped: number;
    relinked: number;
    missing: { volume: string; chapter: string; name: string }[];
    snapshot: string | null;
    projectBackup: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const confirmDirty = (action: string) => {
    if (!dirty) return true;
    return window.confirm(t('project.dirtyConfirm', { action }));
  };

  const runExport = async () => {
    if (!confirmDirty(t('project.exportAction'))) return;
    setBusy(true);
    setError(null);
    setExported(null);
    try {
      const res = await api.exportProject({ mode, name: name.trim() || undefined, notes: notes.trim() || undefined });
      setExported({ file: res.file, url: res.url, size: res.size, images: res.manifest.images });
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
    setDone(null);
    try {
      const data = await readFileBytes(file);
      const info = await api.inspectProject(data);
      setPending({ data, fileName: file.name, info });
      setConflict(info.conflictCount > 0 ? 'merge' : 'overwrite');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!pending) return;
    if (!confirmDirty(t('project.importAction'))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.importProject({
        data: pending.data,
        conflict,
        relinkDir: relinkDir.trim() || undefined,
      });
      setDone({
        restored: res.restored,
        merged: res.merged,
        skipped: res.skipped,
        relinked: res.relinked,
        missing: res.missing,
        snapshot: res.snapshot,
        projectBackup: res.projectBackup,
      });
      setPending(null);
      onImported(res.library);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pickRelink = async () => {
    if (!window.mangaDesktop) {
      setError(t('project.browserNoPicker'));
      return;
    }
    const dir = await window.mangaDesktop.pickFolder(t('project.pickFolderTitle'));
    if (dir) setRelinkDir(dir);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <header className="modal-head">
          <div>
            <h2>{t('project.title')}</h2>
            <p>{t('project.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body project-body">
          {dirty && <div className="banner warn">{t('project.dirtyBanner')}</div>}

          <section className="project-section">
            <h3>{t('project.saveSection')}</h3>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="project-mode"
                  checked={mode === 'reference'}
                  onChange={() => setMode('reference')}
                />
                {t('project.referenceMode')}
              </label>
              <label>
                <input
                  type="radio"
                  name="project-mode"
                  checked={mode === 'packaged'}
                  onChange={() => setMode('packaged')}
                />
                {t('project.packagedMode')}
              </label>
            </div>
            <label className="field">
              <span>{t('project.nameLabel')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('project.namePlaceholder')}
              />
            </label>
            <label className="field">
              <span>{t('project.notesLabel')}</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('project.notesPlaceholder')}
              />
            </label>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runExport()}>
              {busy ? t('project.processing') : t('project.generateProject')}
            </button>
            {exported && (
              <p className="muted tiny">
                {t('project.generatedBefore')}
                <a href={exported.url} download={exported.file}>
                  {exported.file}
                </a>
                {t('project.generatedAfter', {
                  size: formatBytes(exported.size),
                  images: formatNumber(exported.images),
                })}
              </p>
            )}
          </section>

          <section className="project-section">
            <h3>{t('project.openSection')}</h3>
            <p className="muted tiny">{t('project.openHint')}</p>
            <input
              ref={inputRef}
              type="file"
              accept=".mnproj,.zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
              {t('project.chooseProject')}
            </button>

            {pending && (
              <div className="banner info">
                <b>{pending.fileName}</b>
                <ul className="project-summary">
                  <li>
                    {pending.info.storageMode === 'packaged' ? t('project.modePackaged') : t('project.modeReference')} ·
                    schema {pending.info.schemaVersion}
                    {pending.info.migratedFrom !== undefined &&
                      t('project.migrateFrom', { v: String(pending.info.migratedFrom) })}
                  </li>
                  <li>
                    {t('project.summaryCounts', {
                      volumes: formatNumber(pending.info.volumes.length),
                      chapters: formatNumber(pending.info.chapters),
                      pages: formatNumber(pending.info.pages),
                      notes: formatNumber(pending.info.notes),
                      annotations: formatNumber(pending.info.annotations),
                    })}
                  </li>
                  <li>
                    {t('project.summaryAssets', {
                      images: formatNumber(pending.info.images),
                      templates: formatNumber(pending.info.templates),
                      presets: formatNumber(pending.info.presets),
                    })}
                  </li>
                  <li>
                    {t('project.conflictsBefore')}
                    <b>{formatNumber(pending.info.conflictCount)}</b>
                    {t('project.conflictsAfter')}
                    {pending.info.missingAssets.length > 0 && (
                      <>
                        {t('project.missingBefore')}
                        <b>{formatNumber(pending.info.missingAssets.length)}</b>
                        {t('project.missingAfter')}
                      </>
                    )}
                  </li>
                </ul>

                <div className="radio-row">
                  <label>
                    <input
                      type="radio"
                      name="project-conflict"
                      checked={conflict === 'overwrite'}
                      onChange={() => setConflict('overwrite')}
                    />
                    {t('project.overwrite')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="project-conflict"
                      checked={conflict === 'merge'}
                      onChange={() => setConflict('merge')}
                    />
                    {t('project.merge')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="project-conflict"
                      checked={conflict === 'skip'}
                      onChange={() => setConflict('skip')}
                    />
                    {t('project.skip')}
                  </label>
                </div>

                <label className="field">
                  <span>{t('project.relinkLabel')}</span>
                  <div className="row-inline">
                    <input
                      value={relinkDir}
                      placeholder={t('project.relinkPlaceholder')}
                      onChange={(e) => setRelinkDir(e.target.value)}
                    />
                    <button type="button" className="btn" disabled={busy} onClick={() => void pickRelink()}>
                      {t('project.choose')}
                    </button>
                  </div>
                </label>

                <div className="row-inline">
                  <button type="button" className="btn" disabled={busy} onClick={() => setPending(null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn danger" disabled={busy} onClick={() => void runImport()}>
                    {busy ? t('project.importing') : t('project.confirmImport')}
                  </button>
                </div>
              </div>
            )}

            {done && (
              <div className="banner info">
                {t('project.doneSummary', {
                  restored: formatNumber(done.restored),
                  merged: formatNumber(done.merged),
                  skipped: formatNumber(done.skipped),
                })}
                {done.relinked > 0 && t('project.doneRelinked', { count: formatNumber(done.relinked) })}.
                {done.missing.length > 0 && (
                  <>
                    <br />
                    {t('project.stillMissingBefore')}
                    <b>{formatNumber(done.missing.length)}</b>
                    {t('project.stillMissingAfter')}
                    {done.missing
                      .slice(0, 5)
                      .map((m) => `${m.volume}/${m.chapter}/${m.name}`)
                      .join(t('common.listSeparator'))}
                    {done.missing.length > 5 && t('project.moreMissing')}
                    <br />
                    {t('project.relinkTip')}
                  </>
                )}
                {done.snapshot && (
                  <>
                    <br />
                    {t('project.snapshotBeforeImport')}
                    <code>{done.snapshot}</code>
                  </>
                )}
                {done.projectBackup && (
                  <>
                    <br />
                    {t('project.projectBackup')}
                    <code>{done.projectBackup}</code>
                  </>
                )}
              </div>
            )}
          </section>

          {error && <div className="banner error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <span className="muted tiny">{t('project.footerHint')}</span>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
