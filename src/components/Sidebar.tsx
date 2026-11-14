import { useMemo, useState } from 'react';
import type { ChapterEntry, Lang, Library, PageEntry, VolumeEntry } from '../types';
import { LANGUAGES, LANG_SHORT, SINGLE_CHAPTER } from '../types';
import type { Selection } from '../hooks/usePage';
import { thumbUrl } from '../api';
import { AddVolumeDialog, VolumeSettingsDialog } from './LibraryDialogs';
import { DataToolsDialog } from './DataToolsDialog';
import { ProjectDialog } from './ProjectDialog';
import { ExchangeDialog } from './ExchangeDialog';
import { DirRulesDialog } from './DirRulesDialog';

type Props = {
  library: Library | null;
  rootPath: string;
  selection: Selection | null;
  onOpen: (sel: Selection) => void;
  onReload: (library?: Library) => void;
  /** 当前页面是否有未保存修改，工程导出/导入前提示 */
  dirty: boolean;
};

function pickFile(page: PageEntry): { url: string; lang: Lang } | null {
  for (const lang of LANGUAGES) {
    const url = page.files[lang];
    if (url) return { url, lang };
  }
  return null;
}

export function Sidebar({ library, rootPath, selection, onOpen, onReload, dirty }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({}));
  const [addOpen, setAddOpen] = useState(false);
  const [settings, setSettings] = useState<VolumeEntry | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [dirRulesOpen, setDirRulesOpen] = useState(false);

  const activeChapterKey = selection ? `${selection.volume}/${selection.chapter}` : '';

  // 当前话自动展开
  const expanded = useMemo(() => {
    const base = { ...open };
    if (activeChapterKey) base[activeChapterKey] = base[activeChapterKey] ?? true;
    return base;
  }, [open, activeChapterKey]);

  if (!library) {
    return (
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">KomaYomi</div>
          <div className="root-path">载入图库中…</div>
        </div>
      </aside>
    );
  }

  if (!library.volumes.length) {
    return (
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">KomaYomi</div>
        </div>
        <div className="sidebar-empty">
          没有在 <code>{rootPath || 'raw'}</code> 下找到任何卷目录。
          <br />
          请把图片按 <code>raw/卷名/ja/话号/01.jpg</code> 的层级放好，或直接添加漫画。
          <button type="button" className="btn primary block" onClick={() => setAddOpen(true)}>
            ＋ 添加漫画
          </button>
        </div>
        {addOpen && (
          <AddVolumeDialog
            onClose={() => setAddOpen(false)}
            onDone={(lib) => {
              onReload(lib);
              setAddOpen(false);
            }}
          />
        )}
      </aside>
    );
  }

  const renderChapter = (volumeId: string, chapter: ChapterEntry) => {
    const key = `${volumeId}/${chapter.chapter}`;
    const isOpen = expanded[key];
    const pageWarnings = chapter.pages.reduce((n, p) => n + p.warnings.length, 0);
    const annotated = chapter.pages.filter((p) => p.annotated).length;

    return (
      <div className="chapter" key={key}>
        <button
          type="button"
          className={`chapter-row ${selection?.volume === volumeId && selection.chapter === chapter.chapter ? 'active' : ''}`}
          onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
        >
          <span className={`chev ${isOpen ? 'open' : ''}`}>▸</span>
          <span className="ch-name">{chapter.chapter === SINGLE_CHAPTER ? SINGLE_CHAPTER : `第 ${chapter.chapter} 话`}</span>
          <span className="ch-meta">
            {annotated > 0 && <span className="chip-mini ok">{annotated}</span>}
            {pageWarnings > 0 && (
              <span className="chip-mini warn" title={chapter.pages.flatMap((p) => p.warnings).join('\n')}>
                !
              </span>
            )}
            <span className="ch-count">{chapter.pages.length}p</span>
          </span>
        </button>

        {isOpen && (
          <>
            {chapter.warnings.map((w) => (
              <div className="warn-line" key={w}>
                {w}
              </div>
            ))}
            <div className="page-grid">
              {chapter.pages.map((page) => {
                const file = pickFile(page);
                const active =
                  selection?.volume === volumeId &&
                  selection.chapter === chapter.chapter &&
                  selection.pageIndex === page.index;
                return (
                  <button
                    type="button"
                    key={page.index}
                    className={`thumb ${active ? 'active' : ''} ${file ? '' : 'missing'}`}
                    title={`第 ${page.index + 1} 页${page.warnings.length ? '\n' + page.warnings.join('\n') : ''}`}
                    onClick={() => onOpen({ volume: volumeId, chapter: chapter.chapter, pageIndex: page.index })}
                  >
                    {file ? (
                      <img src={thumbUrl(file.url, 200)} alt={`第 ${page.index + 1} 页`} loading="lazy" />
                    ) : (
                      <span>缺图</span>
                    )}
                    <em>{page.index + 1}</em>
                    {page.warnings.length > 0 && <i className="thumb-warn">!</i>}
                    {page.annotated && <i className="thumb-dot" />}
                    {file && <b className="thumb-lang">{LANG_SHORT[file.lang]}</b>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          KomaYomi
          <span className="brand-sub">Manga Learner</span>
        </div>
        <div className="root-path" title={rootPath}>
          {library.volumes.length} 卷 · {library.volumes.reduce((n, v) => n + v.chapters.length, 0)} 话
          <button type="button" className="btn tiny add-volume-btn" onClick={() => setAddOpen(true)} title="添加漫画目录">
            ＋ 漫画
          </button>
        </div>
      </div>
      <div className="sidebar-scroll">
        {library.volumes.map((volume) => (
          <div className="volume" key={volume.id}>
            <div className="volume-title">
              <span>{volume.title}</span>
              <span className="volume-langs">{volume.languages.map((l) => LANG_SHORT[l]).join(' · ') || '未配置'}</span>
              <button
                type="button"
                className="icon-btn volume-gear"
                title="卷设置：语言目录"
                onClick={() => setSettings(volume)}
              >
                ⚙
              </button>
              {volume.warnings.map((w) => (
                <em key={w}>{w}</em>
              ))}
            </div>
            {volume.chapters.map((chapter) => renderChapter(volume.id, chapter))}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <span>raw 只读</span>
        <span className="sidebar-foot-actions">
          <button
            type="button"
            className="btn tiny"
            onClick={() => setProjectOpen(true)}
            title="工程文件：导出 / 导入 .mnproj"
          >
            工程文件…
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() => setExchangeOpen(true)}
            title="交换文件：.mntpl / .mnexp / .mnpage.json"
          >
            交换文件…
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() => setDirRulesOpen(true)}
            title="目录识别：声明式规则 + 实时预览 + 未识别文件"
          >
            目录识别…
          </button>
          <button type="button" className="btn tiny" onClick={() => setDataOpen(true)} title="备份 / 恢复 data/">
            备份 / 恢复
          </button>
        </span>
      </div>

      {addOpen && (
        <AddVolumeDialog
          onClose={() => setAddOpen(false)}
          onDone={(lib) => {
            onReload(lib);
            setAddOpen(false);
          }}
        />
      )}
      {settings && (
        <VolumeSettingsDialog
          volume={settings}
          onClose={() => setSettings(null)}
          onDone={(lib) => {
            onReload(lib);
            setSettings(null);
          }}
        />
      )}
      {dataOpen && <DataToolsDialog onClose={() => setDataOpen(false)} onRestored={(lib) => onReload(lib)} />}
      {projectOpen && (
        <ProjectDialog
          dirty={dirty}
          onClose={() => setProjectOpen(false)}
          onImported={(lib) => onReload(lib)}
        />
      )}
      {exchangeOpen && (
        <ExchangeDialog
          dirty={dirty}
          selection={selection}
          onClose={() => setExchangeOpen(false)}
          onChanged={() => onReload()}
        />
      )}
      {dirRulesOpen && (
        <DirRulesDialog
          onClose={() => setDirRulesOpen(false)}
          onSaved={(lib) => onReload(lib)}
        />
      )}
    </aside>
  );
}
