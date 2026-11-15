import fs from 'node:fs';
import path from 'node:path';
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { decodeGray, sortReadingOrder } from './detect.ts';
import { readPageDoc } from './storage.ts';
import { applyGroupOrder } from '../shared/panelOrder.ts';
import type { ExportConfig, Library, Note, PageDoc } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { currentLang, langName, t } from './messages/index.ts';
import type { MessageLang } from './messages/index.ts';

const DATE_LOCALE: Record<MessageLang, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' };

const IMAGE_WIDTH = 520;
const IMAGE_MAX_HEIGHT = 620;

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

/** Minimal inline markdown: bold and inline code become runs, everything else stays literal. */
function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) runs.push(new TextRun(text.slice(last, index)));
    const token = match[0];
    if (token.startsWith('**')) runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    else runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas' }));
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
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: heading[2], bold: true, size: Math.max(20, 30 - heading[1].length * 2) })],
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
      const kind = imageKind(buffer.subarray(0, 4), '');
      if (!kind) continue;
      try {
        const { width, height } = decodeGray(buffer, 'note.png');
        if (!width || !height) continue;
        const scale = Math.min(320 / width, 240 / height, 1);
        out.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: kind,
                data: buffer,
                transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
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

  const indices = config.pageIndices?.length ? config.pageIndices : chapter.pages.map((page) => page.index);
  const warnings: string[] = [];
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
    for (const language of config.languages) {
      const url = page.files[language];
      if (!url) continue;
      const file = path.join(rootDir, decodeURIComponent(url));
      if (!fs.existsSync(file)) continue;
      try {
        const buffer = fs.readFileSync(file);
        const kind = imageKind(buffer.subarray(0, 4), path.extname(file).toLowerCase());
        if (!kind) continue;
        const { width, height } = decodeGray(buffer, file);
        if (!width || !height) continue;
        const scale = Math.min(IMAGE_WIDTH / width, IMAGE_MAX_HEIGHT / height, 1);
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
                type: kind,
                data: buffer,
                transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
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
  return {
    file: filename,
    url: '/exports/' + encodeURIComponent(filename),
    pages: exported,
    warnings,
    imageMode: 'embed',
  };
}
