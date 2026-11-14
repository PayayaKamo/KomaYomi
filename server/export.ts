import fs from 'node:fs';
import path from 'node:path';
import { decodeGray, sortReadingOrder } from './detect.ts';
import { readPageDoc } from './storage.ts';
import { LANG_LABEL } from '../shared/types.ts';
import { renderMarkdown } from '../shared/markdown.ts';
import type {
  AlignOffset,
  ExportConfig,
  Library,
  Note,
  PageDoc,
  Panel,
  PanelRect,
  ReadingDirection,
} from '../shared/types.ts';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n: number) => Math.round(n * 1000) / 1000;

function mimeOf(head: Buffer, ext: string): string {
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

type PageImage = { lang: string; url: string; width: number; height: number };

type ExportArgs = {
  rootDir: string;
  rawRoot: string;
  dataRoot: string;
  exportRoot: string;
  config: ExportConfig;
  library: Library;
};

const dirLabel: Record<ReadingDirection, string> = {
  rtl: '阅读方向：从右到左 · 从上到下',
  ltr: '阅读方向：从左到右 · 从上到下',
  ttb: '阅读方向：从右到左 · 竖排',
};

function notesHtml(notes: Note[], filterTags: string[]): string {
  if (!notes.length) return '';
  return notes
    .filter((n) => !filterTags.length || n.tags.some((t) => filterTags.includes(t)))
    .map(
      (n) => `<li class="note">
        ${n.tags.length ? `<span class="tags">${n.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
        <div class="text md">${renderMarkdown(n.text)}</div>
      </li>`,
    )
    .join('');
}

function panelNotesGroup(doc: PageDoc, panelId: string, label: string, filterTags: string[]): string {
  const html = notesHtml(
    doc.notes.filter((n) => n.scope === 'panel' && n.panelId === panelId),
    filterTags,
  );
  return html ? `<div class="notes-group"><h3>${esc(label)}</h3><ul>${html}</ul></div>` : '';
}

function pageNotesGroup(doc: PageDoc, filterTags: string[]): string {
  const html = notesHtml(doc.notes.filter((n) => n.scope === 'page'), filterTags);
  return html ? `<div class="notes-group"><h3>整页批注</h3><ul>${html}</ul></div>` : '';
}

function cropStyle(rect: PanelRect, pageAspect: number): string {
  const { x, y, w, h } = rect;
  const bsX = num(100 / w);
  const bsY = num(100 / h);
  const posX = w >= 0.999 ? 0 : num((x / (1 - w)) * 100);
  const posY = h >= 0.999 ? 0 : num((y / (1 - h)) * 100);
  const aspect = num((w * pageAspect) / h);
  return `aspect-ratio:${aspect};background-size:${bsX}% ${bsY}%;background-position:${posX}% ${posY}%`;
}

/** 把页面级的对齐偏移换算成实际要裁切的区域（与界面上 translate + scale 的效果一致） */
function offsetRect(rect: PanelRect, off: AlignOffset | undefined): PanelRect {
  const scale = off?.scale && off.scale > 0 ? off.scale : 1;
  const w = Math.min(1, rect.w / scale);
  const h = Math.min(1, rect.h / scale);
  let x = rect.x + (off?.x ?? 0) * rect.w + (rect.w - w) / 2;
  let y = rect.y + (off?.y ?? 0) * rect.h + (rect.h - h) / 2;
  x = Math.min(1 - w, Math.max(0, x));
  y = Math.min(1 - h, Math.max(0, y));
  return { x, y, w, h };
}

const CSS = `
:root{--ink:#1c1f24;--muted:#6b7280;--line:#e4e7ec;--accent:#c2410c;--bg:#f6f5f2}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"Segoe UI","Noto Sans SC","Hiragino Sans",sans-serif;line-height:1.65}
.wrap{max-width:1120px;margin:0 auto;padding:40px 28px 80px}
header.doc{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:32px}
header.doc h1{margin:0 0 6px;font-size:26px;letter-spacing:.02em}
header.doc .meta{color:var(--muted);font-size:13px;display:flex;gap:16px;flex-wrap:wrap}
.page{margin:0 0 40px;break-inside:avoid}
.page-head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
.page-head .idx{background:var(--ink);color:#fff;border-radius:4px;padding:1px 8px;font-size:12px;letter-spacing:.08em}
.page-head .files{color:var(--muted);font-size:12px}
.page-body{display:grid;grid-template-columns:var(--left) 1fr;gap:var(--gap)}
.page-body.stack{grid-template-columns:1fr;gap:18px}
.shot{position:relative;background:#fff;border:1px solid var(--line);border-radius:6px;overflow:hidden;align-self:start}
.shot img{display:block;width:100%;height:auto}
.box{position:absolute;border:2px solid rgba(194,65,12,.85);border-radius:2px}
.box span{position:absolute;left:0;top:0;background:rgba(194,65,12,.9);color:#fff;font-size:11px;padding:0 5px;border-radius:0 0 4px 0}
.notes{font-size:14px}
.notes-group{margin-bottom:16px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:6px}
.notes-group h3{margin:0 0 8px;font-size:13px;color:var(--accent);letter-spacing:.06em}
.notes-group ul{margin:0;padding-left:0;list-style:none}
.note{padding:6px 0;border-top:1px dashed var(--line)}
.note:first-child{border-top:0}
.tags{display:inline-flex;gap:4px;margin-right:6px;vertical-align:middle}
.tag{background:#fdece3;color:#9a3412;border-radius:99px;padding:0 7px;font-size:11px}
/* Markdown 笔记：导出后保留标题、列表、引用、代码与表格样式 */
.md h1,.md h2,.md h3,.md h4{margin:10px 0 4px;line-height:1.3;color:var(--ink)}
.md h1{font-size:18px}.md h2{font-size:16px}.md h3{font-size:15px}
.md p{margin:4px 0}
.md ul,.md ol{margin:4px 0;padding-left:20px}
.md li{margin:2px 0}
.md blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid var(--accent);background:#faf7f4;color:#4b5563}
.md code{background:#f3f4f6;border-radius:3px;padding:0 4px;font-size:.92em}
.md pre.md-code{background:#1f2937;color:#e5e7eb;padding:10px 12px;border-radius:6px;overflow:auto}
.md pre.md-code code{background:none;color:inherit;padding:0}
.md table{border-collapse:collapse;margin:8px 0;width:100%;font-size:13px}
.md th,.md td{border:1px solid var(--line);padding:4px 8px}
.md th{background:#faf7f4}
.md a{color:var(--accent)}
.md hr{border:0;border-top:1px solid var(--line);margin:10px 0}
.compare{display:grid;gap:20px;align-items:start}
.compare .notes-group{grid-column:1/-1}
.panel-row{margin:0 0 26px;padding:14px;background:#fff;border:1px solid var(--line);border-radius:8px}
.panel-row .row-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:13px;color:var(--muted)}
.panel-row .row-head b{color:var(--accent)}
.crops{display:grid;gap:10px;align-items:start}
.crop{background-repeat:no-repeat;border:1px solid var(--line);border-radius:4px;min-height:60px}
.crop-label{font-size:11px;color:var(--muted);margin-bottom:4px}
.crop-wrap{display:flex;flex-direction:column}
.empty{color:var(--muted);font-size:13px;padding:8px 0}
footer.doc{margin-top:48px;border-top:1px solid var(--line);padding-top:14px;color:var(--muted);font-size:12px}
@media print{body{background:#fff}.wrap{max-width:none;padding:0}
.page{page-break-after:always;break-after:page;margin-bottom:0}
.page:last-of-type{page-break-after:auto;break-after:auto}
.panel-row,.shot,.notes-group{break-inside:avoid}
header.doc{margin-bottom:20px}
footer.doc{display:none}}
`;

export async function exportChapter({
  rootDir,
  rawRoot,
  dataRoot,
  exportRoot,
  config,
  library,
}: ExportArgs): Promise<{
  file: string;
  url: string;
  pages: number;
  warnings: string[];
  imageMode: 'files' | 'embed';
  assetDir?: string;
}> {
  const volume = library.volumes.find((v) => v.id === config.volume);
  const chapter = volume?.chapters.find((c) => c.chapter === config.chapter);
  if (!chapter) throw new Error('找不到对应的话');

  const base = `${config.volume}-${config.chapter}-${Date.now()}`;
  const assetDir = `${base}.files`;
  const imageMode: 'files' | 'embed' = config.embedImages ? 'embed' : 'files';

  const indices = config.pageIndices?.length ? config.pageIndices : chapter.pages.map((p) => p.index);
  const warnings: string[] = [];
  const sections: string[] = [];
  const styleBlocks: string[] = [];
  let exported = 0;
  let direction: ReadingDirection | null = null;

  for (const index of indices) {
    const page = chapter.pages[index];
    if (!page) continue;
    const doc = readPageDoc(dataRoot, config.volume, config.chapter, index);
    if (!doc) {
      warnings.push(`第 ${index + 1} 页还没有分格数据，已跳过`);
      continue;
    }

    if (doc.notes.length === 0 && config.onlyWithNotes) {
      continue;
    }

    const notesAll = doc.notes;
    const hasContent = doc.panels.length > 0 || notesAll.length > 0;
    if (!hasContent) {
      warnings.push(`第 ${index + 1} 页还没有任何标注，已跳过`);
      continue;
    }

    const images: Record<string, PageImage> = {};
    let pageAspect = 0.7;
    for (const lang of config.languages) {
      const url = page.files[lang];
      if (!url) continue;
      const file = path.join(rootDir, decodeURIComponent(url));
      if (!fs.existsSync(file)) continue;
      let width = 0;
      let height = 0;
      try {
        const gray = decodeGray(fs.readFileSync(file), file);
        width = gray.width;
        height = gray.height;
        if (!pageAspect || pageAspect === 0.7) pageAspect = width / height;
      } catch {
        warnings.push(`第 ${index + 1} 页 ${LANG_LABEL[lang]} 图片无法解析`);
        continue;
      }
      let src: string;
      if (config.embedImages) {
        const buf = fs.readFileSync(file);
        const mime = mimeOf(buf.subarray(0, 4), path.extname(file).toLowerCase());
        src = `data:${mime};base64,${buf.toString('base64')}`;
      } else {
        // 目录模式：图片复制到同名 .files 目录，HTML 用相对路径引用，体积小且无需 dev server
        const ext = path.extname(file).toLowerCase() || '.jpg';
        const name = `p${String(index + 1).padStart(3, '0')}-${lang}${ext}`;
        fs.mkdirSync(path.join(exportRoot, assetDir), { recursive: true });
        fs.copyFileSync(file, path.join(exportRoot, assetDir, name));
        src = `./${encodeURI(assetDir)}/${name}`;
      }
      images[lang] = { lang, url: src, width, height };
    }

    const ordered = sortReadingOrder(doc.panels, doc.readingDirection, (p) => p.rect);
    direction = direction ?? doc.readingDirection;
    const labels = new Map<Panel, string>();
    ordered.forEach((p, i) => labels.set(p, `第 ${i + 1} 格`));

    // 每种语言的整页图只写一次 CSS 规则，格子用 background-position/size 裁切。
    // 不用 CSS 变量：Chrome 对超大 var() 值（>4MB 的 base64）会静默失效。
    const bgRules = Object.entries(images)
      .map(([lang, img]) => `.pg-${index} .lang-${lang}{background-image:url('${img.url}')}`)
      .join('\n');
    if (config.template === 'compare-wide' && bgRules) styleBlocks.push(bgRules);

    const filesLine = config.languages
      .map((l) => page.filenames[l])
      .filter(Boolean)
      .join(' · ');

    let body = '';
    if (config.template === 'compare-wide') {
      const rows = ordered
        .map((panel) => {
          const crops = config.languages
            .filter((lang) => images[lang])
            .map((lang) => {
              const img = images[lang];
              const langAspect = img.width / img.height;
              const eff = offsetRect(panel.rect, doc.offsets[lang]);
              return `<div class="crop-wrap">
                <div class="crop-label">${esc(LANG_LABEL[lang])}</div>
                <div class="crop lang-${lang}" style="${cropStyle(eff, langAspect)}"></div>
              </div>`;
            })
            .join('');
          const noteHtml = notesHtml(
            doc.notes.filter((n) => n.scope === 'panel' && n.panelId === panel.id),
            config.noteFilterTags,
          );
          return `<div class="panel-row">
            <div class="row-head"><b>${esc(labels.get(panel) ?? '')}</b><span>${esc(
              `x ${Math.round(panel.rect.x * 100)}% · y ${Math.round(panel.rect.y * 100)}% · ${Math.round(
                panel.rect.w * 100,
              )}% × ${Math.round(panel.rect.h * 100)}%`,
            )}</span></div>
            <div class="crops" style="grid-template-columns:repeat(${Math.max(1, config.languages.filter((l) => images[l]).length)},1fr)">${crops}</div>
            ${noteHtml ? `<ul>${noteHtml}</ul>` : ''}
          </div>`;
        })
        .join('');

      const pageNoteHtml = pageNotesGroup(doc, config.noteFilterTags);
      const cols = Math.min(4, Math.max(1, Math.round(config.columns || 1)));
      body = `<div class="compare" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${pageNoteHtml}${
        rows || '<div class="empty">本页暂无分格</div>'
      }</div>`;
    } else if (config.template === 'stack') {
      const shot = images[config.languages[0]]
        ? `<div class="shot"><img src="${images[config.languages[0]].url}" alt="第 ${index + 1} 页" />${boxOverlay(
            ordered,
            labels,
            config.showPanelBoxes,
          )}</div>`
        : '<div class="empty">本页没有可用图片</div>';
      const notes = `${pageNotesGroup(doc, config.noteFilterTags)}${ordered
        .map((p) => panelNotesGroup(doc, p.id, labels.get(p) ?? '', config.noteFilterTags))
        .join('')}`;
      body = `<div class="page-body stack">${shot}${notes ? `<div class="notes">${notes}</div>` : ''}</div>`;
    } else {
      const shot = images[config.languages[0]]
        ? `<div class="shot"><img src="${images[config.languages[0]].url}" alt="第 ${index + 1} 页" />${boxOverlay(
            ordered,
            labels,
            config.showPanelBoxes,
          )}</div>`
        : '<div class="empty">本页没有可用图片</div>';
      const notes = `${pageNotesGroup(doc, config.noteFilterTags)}${ordered
        .map((p) => panelNotesGroup(doc, p.id, labels.get(p) ?? '', config.noteFilterTags))
        .join('')}`;
      body = `<div class="page-body">${shot}<div class="notes">${
        notes || '<div class="empty">暂无批注</div>'
      }</div></div>`;
    }

    sections.push(`<section class="page pg-${index}">
      <div class="page-head"><span class="idx">P${index + 1}</span><span class="files">${esc(filesLine)}</span></div>
      ${body}
    </section>`);
    exported++;
  }

  if (!exported) throw new Error('没有可导出的页面（请先给页面分格或写批注）');

  const html = `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(config.title)} · ${esc(config.chapter)}</title>
<style>${CSS}${styleBlocks.join('\n')}</style>
</head>
<body>
<div class="wrap" style="--left:${config.pageWidthRatio}%;--gap:${config.columnGap}px;font-size:${num(
    config.fontScale * 16,
  )}px">
  <header class="doc">
    <h1>${esc(config.title)}</h1>
    <div class="meta">
      <span>${esc(config.volume)} · 第 ${esc(config.chapter)} 话</span>
      <span>${esc(dirLabel[direction ?? 'rtl'])}</span>
      <span>导出时间：${new Date().toLocaleString('zh-CN')}</span>
    </div>
  </header>
  ${sections.join('\n')}
  <footer class="doc">由 Manga Memo 导出 · 共 ${exported} 页</footer>
</div>
</body>
</html>`;

  fs.mkdirSync(exportRoot, { recursive: true });
  const filename = `${base}.html`;
  fs.writeFileSync(path.join(exportRoot, filename), html, 'utf8');
  return {
    file: filename,
    url: '/exports/' + encodeURIComponent(filename),
    pages: exported,
    warnings,
    imageMode,
    assetDir: imageMode === 'files' ? assetDir : undefined,
  };
}

function boxOverlay(ordered: Panel[], labels: Map<Panel, string>, show: boolean): string {
  if (!show) return '';
  return ordered
    .map((p) => {
      const r = p.rect;
      return `<div class="box" style="left:${num(r.x * 100)}%;top:${num(r.y * 100)}%;width:${num(
        r.w * 100,
      )}%;height:${num(r.h * 100)}%"><span>${esc(labels.get(p) ?? '')}</span></div>`;
    })
    .join('');
}
