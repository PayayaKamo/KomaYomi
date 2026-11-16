import fs from 'node:fs';
import path from 'node:path';
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { PNG } from 'pngjs';
import { imageSize, sortReadingOrder, sniffFormat } from './detect.ts';
import { decodeWebpRgba } from './webp.ts';
import { readPageDoc } from './storage.ts';
import { applyGroupOrder } from '../shared/panelOrder.ts';
import type { ExportConfig, Library, Note, PageDoc } from '../shared/types.ts';
import { orderPageIndices } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { currentLang, langName, t } from './messages/index.ts';
import { fillMissingPageDocs } from './pageDetect.ts';
import type { MessageLang } from './messages/index.ts';

const DATE_LOCALE: Record<MessageLang, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' };

const IMAGE_WIDTH = 520;
const IMAGE_MAX_HEIGHT = 620;

/** Staging area for page PNGs the browser composited with annotations baked in. */
const STAGING_DIR = '.staging';
const STAGING_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Browser-composited page image for one page/language, if the client uploaded one. */
function stagedPage(staging: string | null, index: number, lang: string): string | null {
  if (!staging) return null;
  const file = path.join(staging, `p${index}-${lang}.png`);
  return fs.existsSync(file) ? file : null;
}

/** Drop staging folders a crashed export or closed tab left behind. */
function purgeStaleStaging(exportRoot: string): void {
  const root = path.join(exportRoot, STAGING_DIR);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* another export may own it right now */
    }
  }
}

type DocxArgs = {
  rootDir: string;
  dataRoot: string;
  exportRoot: string;
  config: ExportConfig;
  library: Library;
};

type ImageKind = 'png' | 'jpg' | 'gif' | 'bmp';

function imageKind(head: Buffer, ext: string): ImageKind | null {
  if (head[0] === 0x89 && head[1] === 0x50) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpg';
  if (head[0] === 0x47 && head[1] === 0x49) return 'gif';
  if (head[0] === 0x42 && head[1] === 0x4d) return 'bmp';
  if (ext === '.png') return 'png';
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg';
  return null;
}

type WordImage = { type: ImageKind; data: Buffer; width: number; height: number };

/** Word cannot embed WebP, so those pages are decoded and re-encoded as PNG first. */
function wordImage(buffer: Buffer, ext: string): WordImage | null {
  const kind = imageKind(buffer.subarray(0, 4), ext);
  if (kind) {
    const { width, height } = imageSize(buffer, ext || 'image.png');
    return width && height ? { type: kind, data: buffer, width, height } : null;
  }
  if (sniffFormat(buffer) === 'webp') {
    const image = decodeWebpRgba(buffer);
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.data);
    return { type: 'png', data: PNG.sync.write(png), width: image.width, height: image.height };
  }
  return null;
}

/**
 * Minimal inline markdown: bold, italic, underline, strikethrough, inline code and links
 * become runs. Tags never leak into the document as literal text.
 */
function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(<u>[\s\S]*?<\/u>|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|!?\[[^\]]*\]\([^)]*\))/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) runs.push(new TextRun(text.slice(last, index)));
    const token = match[0];
    if (token.startsWith('<u>')) {
      runs.push(new TextRun({ text: token.slice(3, -4), underline: {} }));
    } else if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith('~~')) {
      runs.push(new TextRun({ text: token.slice(2, -2), strike: true }));
    } else if (token.startsWith('`')) {
      runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas' }));
    } else {
      // Links and images keep their visible text; the URL would not be clickable in print.
      const label = token.replace(/^!?\[([^\]]*)\]\([^)]*\)$/, '$1');
      if (label) runs.push(new TextRun(label));
    }
    last = index + token.length;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length ? runs : [new TextRun('')];
}

/** Converts the note markdown into paragraphs Word can edit, keeping headings and lists. */
function markdownParagraphs(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  let inCode = false;
  for (const raw of md.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(new Paragraph({ children: [new TextRun({ text: raw, font: 'Consolas' })] }));
      continue;
    }
    if (!trimmed) {
      out.push(new Paragraph({ children: [new TextRun('')] }));
      continue;
    }
    const aligned = /^<div align="(left|center|right)">(.*)<\/div>$/.exec(trimmed);
    if (aligned) {
      const alignment =
        aligned[1] === 'center'
          ? AlignmentType.CENTER
          : aligned[1] === 'right'
            ? AlignmentType.RIGHT
            : AlignmentType.LEFT;
      out.push(new Paragraph({ alignment, children: inlineRuns(aligned[2]) }));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: heading[2].replace(/<\/?u>/g, ''),
              bold: true,
              size: Math.max(20, 30 - heading[1].length * 2),
            }),
          ],
          spacing: { before: 120, after: 60 },
        }),
      );
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      out.push(new Paragraph({ children: inlineRuns(bullet[1]), bullet: { level: 0 } }));
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      out.push(new Paragraph({ children: inlineRuns(`${ordered[1]}. ${ordered[2]}`), indent: { left: 360 } }));
      continue;
    }
    if (trimmed.startsWith('>')) {
      out.push(new Paragraph({ children: inlineRuns(trimmed.replace(/^>\s?/, '')), indent: { left: 360 } }));
      continue;
    }
    out.push(new Paragraph({ children: inlineRuns(trimmed) }));
  }
  return out;
}

function noteParagraphs(notes: Note[], filterTags: string[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const note of notes) {
    if (filterTags.length && !note.tags.some((tag) => filterTags.includes(tag))) continue;
    if (note.tags.length) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: note.tags.map((tag) => `#${tag}`).join(' '), color: '9A3412', size: 18 })],
          spacing: { before: 60 },
        }),
      );
    }
    out.push(...markdownParagraphs(note.text));
    for (const image of note.images ?? []) {
      if (!image.dataUrl.startsWith('data:image/')) continue;
      const comma = image.dataUrl.indexOf(',');
      if (comma < 0) continue;
      const buffer = Buffer.from(image.dataUrl.slice(comma + 1), 'base64');
      if (!buffer.length) continue;
      try {
        const image = wordImage(buffer, '');
        if (!image) continue;
        const scale = Math.min(320 / image.width, 240 / image.height, 1);
        out.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: image.type,
                data: image.data,
                transformation: {
                  width: Math.round(image.width * scale),
                  height: Math.round(image.height * scale),
                },
              }),
            ],
            spacing: { before: 60, after: 60 },
          }),
        );
      } catch {
        /* An unreadable attachment is skipped rather than failing the export. */
      }
    }
    const source = note.source;
    if (source && (source.title || source.url || source.text)) {
      const parts = [source.url ? source.url : source.title, source.text].filter(Boolean);
      out.push(
        new Paragraph({
          children: [new TextRun({ text: `${t('EXPORT_SOURCE')} ${parts.join(' · ')}`, size: 18, color: '6B7280' })],
        }),
      );
    }
  }
  return out;
}

function pageNotes(doc: PageDoc): Note[] {
  return doc.notes.filter((note) => note.scope === 'page');
}

/** Builds the .docx file and returns the same result shape as the HTML export. */
export async function exportChapterDocx({ rootDir, dataRoot, exportRoot, config, library }: DocxArgs): Promise<{
  file: string;
  url: string;
  pages: number;
  warnings: string[];
  imageMode: 'embed';
}> {
  const volume = library.volumes.find((v) => v.id === config.volume);
  const chapter = volume?.chapters.find((c) => c.chapter === config.chapter);
  if (!chapter) throw new AppError('ERR_CHAPTER_NOT_FOUND', { volume: config.volume, chapter: config.chapter }, 404);

  // Word images come from the browser when annotations are requested: the server has no
  // canvas, so the client bakes the vector layer into page PNGs and stages them here.
  purgeStaleStaging(exportRoot);
  const includeAnnotations = config.includeAnnotations !== false;
  const staging =
    includeAnnotations && config.annotationImages && STAGING_ID.test(config.annotationImages)
      ? path.join(exportRoot, STAGING_DIR, config.annotationImages)
      : null;

  // Requested pages follow the chapter's reading order, the same as the HTML export.
  const indices = config.pageIndices?.length
    ? orderPageIndices(config.pageIndices, chapter.pages)
    : chapter.pages.map((page) => page.index);
  // Pages nobody opened yet have no panel document; detect them now so a fresh chapter
  // does not export as an empty shell.
  const autoDetected = config.onlyWithNotes
    ? []
    : await fillMissingPageDocs({
        rootDir,
        dataRoot,
        library,
        volume: config.volume,
        chapter: config.chapter,
        pageIndices: config.pageIndices,
      });
  const warnings: string[] = [];
  if (autoDetected.length) warnings.push(t('WARN_EXPORT_AUTODETECTED', { count: autoDetected.length }));
  const children: Paragraph[] = [];
  const lang = currentLang();

  children.push(new Paragraph({ text: config.title, heading: HeadingLevel.TITLE }));
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${t('EXPORT_CHAPTER_LINE', { volume: config.volume, chapter: config.chapter })} · ${new Date().toLocaleString(DATE_LOCALE[lang])}`,
          color: '6B7280',
          size: 20,
        }),
      ],
      spacing: { after: 240 },
    }),
  );

  let exported = 0;
  for (const index of indices) {
    const page = chapter.pages.find((p) => p.index === index);
    if (!page || page.excluded) continue;
    const doc = readPageDoc(dataRoot, config.volume, config.chapter, index);
    if (!doc) {
      warnings.push(t('WARN_PAGE_SKIPPED_NO_PANELS', { page: index + 1 }));
      continue;
    }
    if (doc.notes.length === 0 && config.onlyWithNotes) continue;
    if (doc.panels.length === 0 && doc.notes.length === 0) {
      warnings.push(t('WARN_PAGE_SKIPPED_NO_CONTENT', { page: index + 1 }));
      continue;
    }

    const filesLine = config.languages
      .map((language) => page.filenames[language])
      .filter(Boolean)
      .join(' · ');
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `P${index + 1}${filesLine ? ` · ${filesLine}` : ''}`, bold: true, size: 26 })],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      }),
    );

    let images = 0;
    // An annotated page is only complete when at least one baked image arrived.
    const annotated = includeAnnotations && doc.annotationsVisible !== false && (doc.annotations?.length ?? 0) > 0;
    let baked = 0;
    for (const language of config.languages) {
      const url = page.files[language];
      if (!url) continue;
      const staged = stagedPage(staging, index, language);
      const file = staged ?? path.join(rootDir, decodeURIComponent(url));
      if (!fs.existsSync(file)) continue;
      try {
        const buffer = fs.readFileSync(file);
        if (staged) fs.rmSync(staged, { force: true });
        const image = wordImage(buffer, staged ? '' : path.extname(file).toLowerCase());
        if (!image) continue;
        if (staged) baked++;
        const scale = Math.min(IMAGE_WIDTH / image.width, IMAGE_MAX_HEIGHT / image.height, 1);
        children.push(
          new Paragraph({
            children: [new TextRun({ text: langName(language), bold: true, size: 20, color: '6B7280' })],
            spacing: { before: 120 },
          }),
        );
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: image.type,
                data: image.data,
                transformation: {
                  width: Math.round(image.width * scale),
                  height: Math.round(image.height * scale),
                },
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),
        );
        images++;
      } catch {
        warnings.push(t('WARN_PAGE_IMAGE_UNREADABLE', { page: index + 1, lang: langName(language) }));
      }
    }
    if (!images) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: t('EXPORT_EMPTY_IMAGE'), italics: true, color: '6B7280' })] }),
      );
    }
    if (annotated && images > 0 && baked === 0) {
      warnings.push(t('WARN_EXPORT_ANNOTATIONS_UNBAKED', { page: index + 1 }));
    }

    const ordered = applyGroupOrder(
      sortReadingOrder(doc.panels, doc.readingDirection, (panel) => panel.rect),
      doc.groups,
    );
    const pageNotesHtml = config.includeNotes === false ? [] : pageNotes(doc);
    if (pageNotesHtml.length) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: t('EXPORT_PAGE_NOTES'), bold: true, color: 'C2410C' })],
          spacing: { before: 160, after: 60 },
        }),
      );
      children.push(...noteParagraphs(pageNotesHtml, config.noteFilterTags));
    }
    ordered.forEach((panel, idx) => {
      if (config.includeNotes === false) return;
      const notes = doc.notes.filter((note) => note.scope === 'panel' && note.panelId === panel.id);
      const paragraphs = noteParagraphs(notes, config.noteFilterTags);
      if (!paragraphs.length) return;
      children.push(
        new Paragraph({
          children: [new TextRun({ text: t('EXPORT_PANEL_NO', { n: idx + 1 }), bold: true, color: 'C2410C' })],
          spacing: { before: 160, after: 60 },
        }),
      );
      children.push(...paragraphs);
    });

    exported++;
  }

  if (!exported) throw new AppError('ERR_EXPORT_EMPTY', {}, 400);

  children.push(
    new Paragraph({
      children: [new TextRun({ text: t('EXPORT_FOOTER', { pages: exported }), size: 18, color: '6B7280' })],
      spacing: { before: 360 },
    }),
  );

  const document = new Document({
    creator: 'KomaYomi',
    title: config.title,
    description: `${config.volume} · ${config.chapter}`,
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(document);

  fs.mkdirSync(exportRoot, { recursive: true });
  const filename = `${config.volume}-${config.chapter}-${Date.now()}.docx`;
  fs.writeFileSync(path.join(exportRoot, filename), buffer);
  if (staging) {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch (err) {
      warnings.push(t('WARN_EXPORT_STAGING_CLEANUP', { detail: err instanceof Error ? err.message : String(err) }));
    }
  }
  return {
    file: filename,
    url: '/exports/' + encodeURIComponent(filename),
    pages: exported,
    warnings,
    imageMode: 'embed',
  };
}
