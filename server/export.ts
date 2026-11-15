import fs from 'node:fs';
import path from 'node:path';
import { decodeGray, sortReadingOrder } from './detect.ts';
import { readPageDoc } from './storage.ts';
import { renderMarkdown } from '../shared/markdown.ts';
import { applyGroupOrder } from '../shared/panelOrder.ts';
import type {
  AlignOffset,
  Annotation,
  ExportConfig,
  Library,
  Note,
  PageDoc,
  Panel,
  PanelRect,
  ReadingDirection,
} from '../shared/types.ts';
import { DEFAULT_OFFSET, orderPageIndices } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { currentLang, langName, t } from './messages/index.ts';
import type { MessageLang } from './messages/index.ts';

const DATE_LOCALE: Record<MessageLang, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' };
const HTML_LANG: Record<MessageLang, string> = { en: 'en', zh: 'zh-Hans', ja: 'ja' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

const DIRECTION_KEY = {
  rtl: 'EXPORT_DIRECTION_RTL',
  ltr: 'EXPORT_DIRECTION_LTR',
  ttb: 'EXPORT_DIRECTION_TTB',
  'horizontal-rl': 'EXPORT_DIRECTION_HORIZONTAL_RL',
  'horizontal-lr': 'EXPORT_DIRECTION_HORIZONTAL_LR',
  'vertical-rl': 'EXPORT_DIRECTION_VERTICAL_RL',
  'vertical-lr': 'EXPORT_DIRECTION_VERTICAL_LR',
  'continuous-vertical': 'EXPORT_DIRECTION_CONTINUOUS',
} as const;

const dirLabel = (direction: ReadingDirection): string => t(DIRECTION_KEY[direction]);

function notesHtml(notes: Note[], filterTags: string[]): string {
  if (!notes.length) return '';
  return notes
    .filter((n) => !filterTags.length || n.tags.some((t) => filterTags.includes(t)))
    .map((n) => {
      // Images live inline as data URLs, so the exported HTML stays a single portable
      // artefact; non-image payloads are dropped rather than trusted.
      const imgs = (n.images ?? [])
        .filter((img) => img.dataUrl.startsWith('data:image/'))
        .map((img) => `<img src="${img.dataUrl}" alt="${esc(img.name)}" loading="lazy">`)
        .join('');
      // Source line mirrors the notes panel: title links to the URL, free text follows.
      const src = n.source;
      const hasSource = Boolean(src && (src.title || src.url || src.text));
      const sourceHtml = hasSource
        ? `<div class="note-src">${esc(t('EXPORT_SOURCE'))}${
            src!.url
              ? `<a href="${esc(src!.url)}" target="_blank" rel="noreferrer noopener">${esc(
                  src!.title || src!.url,
                )}</a>`
              : esc(src!.title ?? '')
          }${src!.text ? `${src!.url || src!.title ? ' · ' : ''}${esc(src!.text)}` : ''}</div>`
        : '';
      return `<li class="note">
        ${n.tags.length ? `<span class="tags">${n.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
        <div class="text md">${renderMarkdown(n.text)}</div>
        ${imgs ? `<div class="note-images">${imgs}</div>` : ''}
        ${sourceHtml}
      </li>`;
    })
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
  const html = notesHtml(
    doc.notes.filter((n) => n.scope === 'page'),
    filterTags,
  );
  return html ? `<div class="notes-group"><h3>${esc(t('EXPORT_PAGE_NOTES'))}</h3><ul>${html}</ul></div>` : '';
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

/** Convert a page-level alignment offset into the area to crop, matching the translate + scale effect in the UI. */
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

/**
 * Match the compare view: the whole-page offset is the base and per-panel offsets are added on top.
 * Exports used to read only the page offset, so pages looked aligned in the UI but came out shifted.
 */
function combinedOffset(page: AlignOffset | undefined, panel: AlignOffset | undefined): AlignOffset | undefined {
  if (!panel) return page;
  const base = page ?? DEFAULT_OFFSET;
  return {
    x: base.x + panel.x,
    y: base.y + panel.y,
    scale: Math.round(base.scale * panel.scale * 10000) / 10000,
  };
}

const PAGE_RECT: PanelRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Render the annotation layer as vector SVG.
 * Coordinates follow the UI convention: page scope is 0..1 of the whole page, panel scope is 0..1 inside that panel;
 * stroke widths scale with page width and font sizes with page height, so proportions stay correct when cropping at a larger scale.
 */
function annotationSvg(doc: PageDoc, view: PanelRect, pageAspect: number, idSuffix: string): string {
  const annotations = doc.annotations ?? [];
  // The visibility switch on the panel editor also controls exports.
  if (doc.annotationsVisible === false || !annotations.length) return '';

  const vw = 1000;
  const vh = Math.max(1, Math.round((vw * view.h) / (Math.max(0.001, view.w) * Math.max(0.001, pageAspect))));
  const toView = (p: { x: number; y: number }, rect: PanelRect) => ({
    x: ((rect.x + p.x * rect.w - view.x) / view.w) * vw,
    y: ((rect.y + p.y * rect.h - view.y) / view.h) * vh,
  });
  const sw = (fraction: number) => Math.max(0.5, (fraction * vw) / view.w);
  const fs = (fraction: number) => Math.max(3, (fraction * vh) / view.h);
  const patternId = `ann-mosaic-${idSuffix}`;

  const shapes = annotations
    .map((a: Annotation) => {
      const rect = a.scope === 'panel' ? (doc.panels.find((p) => p.id === a.panelId)?.rect ?? PAGE_RECT) : PAGE_RECT;
      const pts = a.points.map((p) => toView(p, rect));
      if (!pts.length) return '';
      const color = a.color || '#e0453a';
      const width = sw(a.width ?? 0.0035);
      const font = fs(a.fontSize ?? 0.035);
      const first = pts[0];
      const last = pts[pts.length - 1];
      switch (a.kind) {
        case 'arrow': {
          if (pts.length < 2) return '';
          const angle = Math.atan2(last.y - first.y, last.x - first.x);
          const size = Math.max(8, width * 4);
          const spread = Math.PI / 7;
          const p1 = { x: last.x - size * Math.cos(angle - spread), y: last.y - size * Math.sin(angle - spread) };
          const p2 = { x: last.x - size * Math.cos(angle + spread), y: last.y - size * Math.sin(angle + spread) };
          return `<g stroke="${esc(color)}" fill="none" stroke-width="${num(width)}" stroke-linecap="round">
            <line x1="${num(first.x)}" y1="${num(first.y)}" x2="${num(last.x)}" y2="${num(last.y)}" />
            <polygon points="${num(last.x)},${num(last.y)} ${num(p1.x)},${num(p1.y)} ${num(p2.x)},${num(
              p2.y,
            )}" fill="${esc(color)}" stroke="none" />
          </g>`;
        }
        case 'rect':
          return `<rect x="${num(Math.min(first.x, last.x))}" y="${num(Math.min(first.y, last.y))}" width="${num(
            Math.abs(last.x - first.x),
          )}" height="${num(Math.abs(last.y - first.y))}" fill="none" stroke="${esc(color)}" stroke-width="${num(
            width,
          )}" />`;
        case 'ellipse':
          return `<ellipse cx="${num((first.x + last.x) / 2)}" cy="${num((first.y + last.y) / 2)}" rx="${num(
            Math.abs(last.x - first.x) / 2,
          )}" ry="${num(Math.abs(last.y - first.y) / 2)}" fill="none" stroke="${esc(color)}" stroke-width="${num(
            width,
          )}" />`;
        case 'highlight':
          if (pts.length < 2) return '';
          return `<line x1="${num(first.x)}" y1="${num(first.y)}" x2="${num(last.x)}" y2="${num(
            last.y,
          )}" stroke="${esc(color)}" stroke-width="${num(Math.max(6, width * 4))}" stroke-opacity="0.35" stroke-linecap="round" />`;
        case 'pen':
          return `<polyline points="${pts.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')}" fill="none" stroke="${esc(
            color,
          )}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round" />`;
        case 'text':
          return `<text x="${num(first.x)}" y="${num(first.y)}" fill="${esc(color)}" font-size="${num(
            font,
          )}" font-weight="600" paint-order="stroke" stroke="rgba(255,255,255,0.9)" stroke-width="${num(
            Math.max(2, font / 8),
          )}" stroke-linejoin="round">${esc(a.text ?? '')}</text>`;
        case 'badge':
          return `<g><circle cx="${num(first.x)}" cy="${num(first.y)}" r="${num(
            font * 0.62,
          )}" fill="${esc(color)}" /><text x="${num(first.x)}" y="${num(first.y)}" fill="#fff" font-size="${num(
            font,
          )}" font-weight="700" text-anchor="middle" dominant-baseline="central">${esc(a.text ?? '1')}</text></g>`;
        case 'mosaic':
          return `<rect x="${num(Math.min(first.x, last.x))}" y="${num(Math.min(first.y, last.y))}" width="${num(
            Math.abs(last.x - first.x),
          )}" height="${num(Math.abs(last.y - first.y))}" fill="url(#${patternId})" />`;
        default:
          return '';
      }
    })
    .join('');

  if (!shapes) return '';
  return `<svg class="ann-overlay" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none" aria-hidden="true">
    <defs><pattern id="${patternId}" width="10" height="10" patternUnits="userSpaceOnUse">
      <rect width="10" height="10" fill="#9aa0a6" /><rect width="5" height="5" fill="#6b7280" />
      <rect x="5" y="5" width="5" height="5" fill="#6b7280" />
    </pattern></defs>
    ${shapes}
  </svg>`;
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
.note-images{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;break-inside:avoid}
.note-images img{max-width:100%;max-height:180px;border:1px solid var(--line);border-radius:4px}
.tags{display:inline-flex;gap:4px;margin-right:6px;vertical-align:middle}
.tag{background:#fdece3;color:#9a3412;border-radius:99px;padding:0 7px;font-size:11px}
/* Markdown notes: exports keep heading, list, quote, code and table styles */
.md{line-height:1.75;line-break:strict;overflow-wrap:anywhere}
.md h1,.md h2,.md h3,.md h4{margin:12px 0 5px;line-height:1.35;color:var(--ink)}
.md h1{font-size:18px}.md h2{font-size:16px}.md h3{font-size:15px}
.md p{margin:6px 0}
.md ul,.md ol{margin:6px 0;padding-left:22px}
.md li{margin:3px 0}
.md blockquote{margin:8px 0;padding:5px 12px;border-left:3px solid var(--accent);background:#faf7f4;color:#4b5563;border-radius:0 4px 4px 0}
.md code{background:#f3f4f6;border-radius:3px;padding:0 4px;font-size:.92em}
.md pre.md-code{background:#1f2937;color:#e5e7eb;padding:10px 12px;border-radius:6px;overflow:auto;font-size:12.5px;line-height:1.65}
.md pre.md-code code{background:none;color:inherit;padding:0}
.md table{border-collapse:collapse;margin:10px 0;width:100%;font-size:13px}
.md tbody tr:nth-child(even){background:#fafafa}
.md th,.md td{border:1px solid var(--line);padding:5px 8px;text-align:left}
.md th{background:#faf7f4}
.md a{color:var(--accent)}
.md hr{border:0;border-top:1px solid var(--line);margin:12px 0}
.compare{display:grid;gap:20px;align-items:start}
.compare .notes-group{grid-column:1/-1}
.panel-row{margin:0 0 26px;padding:14px;background:#fff;border:1px solid var(--line);border-radius:8px}
.panel-row .row-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:13px;color:var(--muted)}
.panel-row .row-head b{color:var(--accent)}
.crops{display:grid;gap:10px;align-items:start}
.crop{position:relative;overflow:hidden;background-repeat:no-repeat;border:1px solid var(--line);border-radius:4px;min-height:60px}
.ann-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.crop-label{font-size:11px;color:var(--muted);margin-bottom:4px}
.crop-wrap{display:flex;flex-direction:column}
.note-src{margin-top:5px;font-size:12px;color:var(--muted)}
.note-src a{color:var(--accent);text-decoration:none}
.note-src a:hover{text-decoration:underline}
.empty{color:var(--muted);font-size:13px;padding:8px 0}
footer.doc{margin-top:48px;border-top:1px solid var(--line);padding-top:14px;color:var(--muted);font-size:12px}
@media print{@page{size:A4;margin:12mm}
body{background:#fff;color:#000}
.wrap{max-width:none;padding:0}
header.doc{margin-bottom:14px}
.page{margin:0;break-after:page;page-break-after:always;break-inside:avoid}
.page:last-of-type{break-after:auto;page-break-after:auto}
.page-body,.page-body.stack{display:block}
.shot{border:0;background:none;break-inside:avoid}
.shot img{width:auto;height:auto;max-width:100%;max-height:150mm;margin:0 auto;object-fit:contain}
.page-body .notes{margin-top:6mm}
.compare{display:flex;flex-direction:column;gap:12px}
.compare .notes-group{order:2;grid-column:auto}
.panel-row,.notes-group,.note,.note-images,.crop-wrap{break-inside:avoid}
a{color:#000}
footer.doc{display:none}}
`;

export async function exportChapter({ rootDir, dataRoot, exportRoot, config, library }: ExportArgs): Promise<{
  file: string;
  url: string;
  pages: number;
  warnings: string[];
  imageMode: 'files' | 'embed';
  assetDir?: string;
}> {
  const volume = library.volumes.find((v) => v.id === config.volume);
  const chapter = volume?.chapters.find((c) => c.chapter === config.chapter);
  if (!chapter) throw new AppError('ERR_CHAPTER_NOT_FOUND', { volume: config.volume, chapter: config.chapter }, 404);

  const base = `${config.volume}-${config.chapter}-${Date.now()}`;
  const assetDir = `${base}.files`;
  const imageMode: 'files' | 'embed' = config.embedImages ? 'embed' : 'files';

  const indices = config.pageIndices?.length
    ? orderPageIndices(config.pageIndices, chapter.pages)
    : chapter.pages.map((p) => p.index);
  const warnings: string[] = [];
  const sections: string[] = [];
  const styleBlocks: string[] = [];
  let exported = 0;
  let direction: ReadingDirection | null = null;

  for (const index of indices) {
    const page = chapter.pages.find((p) => p.index === index);
    if (!page || page.excluded) continue;
    const doc = readPageDoc(dataRoot, config.volume, config.chapter, index);
    if (!doc) {
      warnings.push(t('WARN_PAGE_SKIPPED_NO_PANELS', { page: index + 1 }));
      continue;
    }

    if (doc.notes.length === 0 && config.onlyWithNotes) {
      continue;
    }

    const notesAll = doc.notes;
    const hasContent = doc.panels.length > 0 || notesAll.length > 0;
    if (!hasContent) {
      warnings.push(t('WARN_PAGE_SKIPPED_NO_CONTENT', { page: index + 1 }));
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
        warnings.push(t('WARN_PAGE_IMAGE_UNREADABLE', { page: index + 1, lang: langName(lang) }));
        continue;
      }
      let src: string;
      if (config.embedImages) {
        const buf = fs.readFileSync(file);
        const mime = mimeOf(buf.subarray(0, 4), path.extname(file).toLowerCase());
        src = `data:${mime};base64,${buf.toString('base64')}`;
      } else {
        // Directory mode: copy images into a sibling .files directory and reference them relatively; output stays small and needs no dev server
        const ext = path.extname(file).toLowerCase() || '.jpg';
        // Number assets by export position, so the folder sorts in reading order even
        // when the chapter config reorders pages; section headings keep the real page.
        const name = `p${String(exported + 1).padStart(3, '0')}-${lang}${ext}`;
        fs.mkdirSync(path.join(exportRoot, assetDir), { recursive: true });
        fs.copyFileSync(file, path.join(exportRoot, assetDir, name));
        src = `./${encodeURI(assetDir)}/${name}`;
      }
      images[lang] = { lang, url: src, width, height };
    }

    const ordered = applyGroupOrder(
      sortReadingOrder(doc.panels, doc.readingDirection, (p) => p.rect),
      doc.groups,
    );
    direction = direction ?? doc.readingDirection;
    const labels = new Map<Panel, string>();
    ordered.forEach((p, i) => labels.set(p, t('EXPORT_PANEL_NO', { n: i + 1 })));

    // Write one CSS rule per language for the full-page image; panels crop it with background-position/size.
    // Avoid CSS variables: Chrome silently fails on huge var() values (base64 over 4MB).
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
              // Page offset from the page itself, falling back to the dialog snapshot.
              const pageOff = doc.offsets[lang] ?? config.offsets?.[lang];
              const eff = offsetRect(panel.rect, combinedOffset(pageOff, doc.panelOffsets?.[panel.id]?.[lang]));
              return `<div class="crop-wrap">
                <div class="crop-label">${esc(langName(lang))}</div>
                <div class="crop lang-${lang}" style="${cropStyle(eff, langAspect)}">${annotationSvg(
                  doc,
                  eff,
                  langAspect,
                  `${index}-${panel.id}-${lang}`,
                )}</div>
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
        rows || `<div class="empty">${esc(t('EXPORT_EMPTY_PANELS'))}</div>`
      }</div>`;
    } else if (config.template === 'stack') {
      const mainImg = images[config.languages[0]];
      const annPage = mainImg ? annotationSvg(doc, PAGE_RECT, mainImg.width / mainImg.height, `${index}-page`) : '';
      const shot = mainImg
        ? `<div class="shot"><img src="${mainImg.url}" alt="${esc(
            t('EXPORT_PAGE_ALT', { n: index + 1 }),
          )}" />${boxOverlay(ordered, labels, config.showPanelBoxes)}${annPage}</div>`
        : `<div class="empty">${esc(t('EXPORT_EMPTY_IMAGE'))}</div>`;
      const notes = `${pageNotesGroup(doc, config.noteFilterTags)}${ordered
        .map((p) => panelNotesGroup(doc, p.id, labels.get(p) ?? '', config.noteFilterTags))
        .join('')}`;
      body = `<div class="page-body stack">${shot}${notes ? `<div class="notes">${notes}</div>` : ''}</div>`;
    } else {
      const mainImg = images[config.languages[0]];
      const annPage = mainImg ? annotationSvg(doc, PAGE_RECT, mainImg.width / mainImg.height, `${index}-page`) : '';
      const shot = mainImg
        ? `<div class="shot"><img src="${mainImg.url}" alt="${esc(
            t('EXPORT_PAGE_ALT', { n: index + 1 }),
          )}" />${boxOverlay(ordered, labels, config.showPanelBoxes)}${annPage}</div>`
        : `<div class="empty">${esc(t('EXPORT_EMPTY_IMAGE'))}</div>`;
      const notes = `${pageNotesGroup(doc, config.noteFilterTags)}${ordered
        .map((p) => panelNotesGroup(doc, p.id, labels.get(p) ?? '', config.noteFilterTags))
        .join('')}`;
      body = `<div class="page-body">${shot}<div class="notes">${
        notes || `<div class="empty">${esc(t('EXPORT_EMPTY_NOTES'))}</div>`
      }</div></div>`;
    }

    sections.push(`<section class="page pg-${index}">
      <div class="page-head"><span class="idx">P${index + 1}</span><span class="files">${esc(filesLine)}</span></div>
      ${body}
    </section>`);
    exported++;
  }

  if (!exported) throw new AppError('ERR_EXPORT_EMPTY', {}, 400);

  const lang = currentLang();
  const html = `<!doctype html>
<html lang="${HTML_LANG[lang]}">
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
      <span>${esc(t('EXPORT_CHAPTER_LINE', { volume: config.volume, chapter: config.chapter }))}</span>
      <span>${esc(dirLabel(direction ?? 'rtl'))}</span>
      <span>${esc(t('EXPORT_AT', { time: new Date().toLocaleString(DATE_LOCALE[lang]) }))}</span>
    </div>
  </header>
  ${sections.join('\n')}
  <footer class="doc">${esc(t('EXPORT_FOOTER', { pages: exported }))}</footer>
</div>
${config.print ? '<script>window.addEventListener("load",()=>window.print())</script>' : ''}
</body>
</html>`;

  fs.mkdirSync(exportRoot, { recursive: true });
  const filename = `${base}${config.print ? '-print' : ''}.html`;
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
