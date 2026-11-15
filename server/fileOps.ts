/**
 * Destructive file operations for the preprocessing wizard.
 *
 * Batch rename rewrites the image files under `raw/` and renumbers them in the
 * requested page order. Page documents and version history are keyed by page
 * index, so every rename also moves `data/pages` / `data/history` entries and
 * rewrites the stored chapter overrides. A manifest is written before anything
 * moves and a failed run is rolled back, so the folder never stays half-renamed.
 *
 * Page split cuts one image at a normalized position, inserts the second half
 * as the next page and shifts later page data. All operations resolve paths
 * through `pathSafety.ts`; nothing may escape the raw or data root.
 */
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { Annotation, Lang, Note, PageDoc, Panel, PanelGroup } from '../shared/types.ts';
import { createLibrary } from './library.ts';
import { requireChapter } from './pageTargets.ts';
import { assertSafeSegment, resolveWithin } from './pathSafety.ts';
import { AppError } from './errors.ts';
import { sniffFormat } from './detect.ts';
import { historyFilePath } from './pageHistory.ts';
import { pageFilePath, readPageDoc, writePageDoc } from './storage.ts';
import { writeJsonFile } from './schemaStore.ts';
import { remapChapterPages } from './preprocess.ts';

export type RenameInput = {
  volume: string;
  chapter: string;
  prefix?: string;
  start?: number;
  padding?: number;
  /** Current page indices in the desired file order. Defaults to the current order. */
  order?: number[];
};

export type RenameResult = {
  at: string;
  manifest: string;
  /** Image files renamed. */
  files: number;
  /** Page documents (and history files) moved to their new index. */
  docs: number;
  /** Languages left untouched because they are missing one of the pages. */
  skipped: Lang[];
};

export type SplitInput = {
  volume: string;
  chapter: string;
  pageIndex: number;
  axis?: 'vertical' | 'horizontal';
  /** Normalized cut position along the split axis (0.1–0.9). */
  ratio?: number;
};

export type SplitResult = {
  at: string;
  manifest: string;
  pageIndex: number;
  languages: Lang[];
};

type Move = { from: string; to: string };
type MoveState = { original: string; target: string; current: string };

const INVALID_NAME = /[\\/:*?"<>|\0]/;
const fileOpsRoot = (dataRoot: string) => path.join(dataRoot, 'file-ops');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const relPath = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Resolve a library file URL (`/raw/<volume>/…`) below the raw root. */
function imagePath(rawRoot: string, url: string): string {
  const segments = url
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (segments[0] !== 'raw') throw new AppError('ERR_UNSAFE_SEGMENT', { segment: 'path' }, 400);
  return resolveWithin(rawRoot, ...segments.slice(1));
}

/**
 * Rename a set of files in two phases (source → unique temp → target) so that
 * permutations and swaps cannot overwrite each other. Returns an undo function;
 * when a phase fails the batch is already back at its original names.
 */
function applyMoves(moves: Move[]): () => void {
  const active = moves.filter((move) => path.resolve(move.from) !== path.resolve(move.to));
  if (!active.length) return () => {};
  const states: MoveState[] = active.map((move) => ({
    original: move.from,
    target: move.to,
    current: move.from,
  }));

  /** Move every state to its target (or back to its original) in two phases. */
  const run = (destination: 'target' | 'original') => {
    const temps: { state: MoveState; temp: string }[] = [];
    for (const [i, state] of states.entries()) {
      if (state.current === state[destination]) continue;
      const temp = path.join(path.dirname(state.current), `.komayomi-${process.pid}-${Date.now()}-${i}.tmp`);
      fs.renameSync(state.current, temp);
      state.current = temp;
      temps.push({ state, temp });
    }
    for (const item of temps) {
      const to = item.state[destination];
      fs.renameSync(item.temp, to);
      item.state.current = to;
    }
  };

  try {
    run('target');
  } catch (err) {
    try {
      run('original');
    } catch {
      /* best effort: the manifest still lists every planned move */
    }
    throw err;
  }
  return () => {
    try {
      run('original');
    } catch {
      /* best effort */
    }
  };
}

type DocMove = { kind: 'page' | 'history'; from: number; to: number };

/**
 * Move page documents / history files to new page indices and rewrite their
 * `pageIndex` fields. Missing files are skipped (a page may never have been
 * opened). Returns the number of files moved and an undo function.
 */
function movePageData(
  dataRoot: string,
  volume: string,
  chapter: string,
  moves: DocMove[],
): { moved: number; undo: () => void } {
  const active = moves.filter((move) => move.from !== move.to);
  if (!active.length) return { moved: 0, undo: () => {} };

  const patches: { file: string; original: string }[] = [];
  const pairMoves: Move[] = [];
  for (const move of active) {
    const source =
      move.kind === 'page'
        ? pageFilePath(dataRoot, volume, chapter, move.from)
        : historyFilePath(dataRoot, volume, chapter, move.from);
    if (!fs.existsSync(source)) continue;
    const original = fs.readFileSync(source, 'utf8');
    try {
      const record = JSON.parse(original) as Record<string, unknown>;
      record.pageIndex = move.to;
      if (move.kind === 'history' && Array.isArray(record.entries)) {
        for (const entry of record.entries as Record<string, unknown>[]) {
          const doc = entry?.doc as Record<string, unknown> | undefined;
          if (doc) doc.pageIndex = move.to;
        }
      }
      writeJsonFile(source, record);
      patches.push({ file: source, original });
    } catch {
      // Unreadable JSON is moved verbatim instead of being rewritten.
    }
    const target =
      move.kind === 'page'
        ? pageFilePath(dataRoot, volume, chapter, move.to)
        : historyFilePath(dataRoot, volume, chapter, move.to);
    pairMoves.push({ from: source, to: target });
  }

  if (!pairMoves.length) return { moved: 0, undo: () => {} };

  let undoMoves: () => void;
  try {
    undoMoves = applyMoves(pairMoves);
  } catch (err) {
    for (const patch of [...patches].reverse()) {
      try {
        fs.writeFileSync(patch.file, patch.original, 'utf8');
      } catch {
        /* best effort */
      }
    }
    throw err;
  }

  return {
    moved: pairMoves.length,
    undo: () => {
      undoMoves();
      for (const patch of [...patches].reverse()) {
        try {
          fs.writeFileSync(patch.file, patch.original, 'utf8');
        } catch {
          /* best effort */
        }
      }
    },
  };
}

function writeManifest(
  dataRoot: string,
  file: string,
  value: Record<string, unknown>,
  status: 'pending' | 'applied' | 'rolled-back',
): void {
  writeJsonFile(file, {
    schemaVersion: 1,
    kind: 'mnfileops',
    ...value,
    status,
  });
}

/** Validate a user-supplied filename prefix; returns the trimmed prefix. */
function cleanPrefix(value: unknown): string {
  const prefix = String(value ?? '').trim();
  if (!prefix) return '';
  if (prefix.length > 40 || INVALID_NAME.test(prefix)) {
    throw new AppError('ERR_DIR_NAME_INVALID', { name: prefix }, 400);
  }
  return prefix;
}

/**
 * Renumber a chapter's images on disk in the requested page order.
 *
 * Every language that covers all pages is renamed, so page `i` stays the same
 * artwork in every language. Page documents, history, exclusion/role overrides
 * and the saved reading order follow the moved pages.
 */
export function renameChapterFiles(rawRoot: string, dataRoot: string, input: RenameInput): RenameResult {
  const volume = String(input.volume ?? '');
  const chapter = assertSafeSegment(input.chapter, 'chapter');
  if (!volume) throw new AppError('ERR_MISSING_VOLUME', {}, 400);

  const library = createLibrary(rawRoot, dataRoot);
  const entry = requireChapter(library, volume, chapter);
  const pages = [...entry.pages].sort((a, b) => a.index - b.index);
  if (!pages.length) throw new AppError('ERR_PAGE_NO_IMAGES', {}, 400);

  const indices = pages.map((page) => page.index);
  const order = input.order?.length ? input.order.map((index) => Number(index)) : indices;
  const unique = new Set(order);
  if (
    order.length !== indices.length ||
    unique.size !== indices.length ||
    !order.every((index) => Number.isInteger(index) && indices.includes(index))
  ) {
    throw new AppError('ERR_RENAME_ORDER', {}, 400);
  }

  const allLangs = [...new Set(pages.flatMap((page) => Object.keys(page.files)))].sort() as Lang[];
  const complete = allLangs.filter((lang) => pages.every((page) => Boolean(page.files[lang])));
  const skipped = allLangs.filter((lang) => !complete.includes(lang));
  if (!complete.length) throw new AppError('ERR_PAGE_NO_IMAGES', {}, 400);

  const prefix = cleanPrefix(input.prefix);
  const start = clampInt(input.start, 1, 999_999, 1);
  const padding = clampInt(input.padding, 1, 6, 3);
  const byIndex = new Map(pages.map((page) => [page.index, page]));
  const positionOf = new Map(order.map((index, position) => [index, position]));

  const entries: { lang: Lang; from: string; to: string; dir: string }[] = [];
  for (const [position, oldIndex] of order.entries()) {
    const page = byIndex.get(oldIndex);
    if (!page) continue;
    for (const lang of complete) {
      const url = page.files[lang];
      if (!url) continue;
      const from = imagePath(rawRoot, url);
      if (!fs.existsSync(from)) {
        throw new AppError('ERR_IMAGE_NOT_FOUND', { path: relPath(rawRoot, from) }, 404);
      }
      const ext = path.extname(from);
      const name = `${prefix}${String(start + position).padStart(padding, '0')}${ext}`;
      const dir = path.dirname(from);
      const to = resolveWithin(dir, name);
      entries.push({ lang, from, to, dir });
    }
  }

  // Reject a target that belongs to a file outside this batch (case-insensitive on every OS).
  const sourcesByDir = new Map<string, Set<string>>();
  for (const item of entries) {
    const set = sourcesByDir.get(item.dir) ?? new Set<string>();
    set.add(path.basename(item.from).toLowerCase());
    sourcesByDir.set(item.dir, set);
  }
  const targetsByDir = new Map<string, Set<string>>();
  for (const item of entries) {
    const name = path.basename(item.to).toLowerCase();
    const sources = sourcesByDir.get(item.dir) ?? new Set<string>();
    const targets = targetsByDir.get(item.dir) ?? new Set<string>();
    const exists = fs.readdirSync(item.dir).some((file) => file.toLowerCase() === name);
    if ((exists && !sources.has(name)) || targets.has(name)) {
      throw new AppError('ERR_RENAME_CONFLICT', { name: path.basename(item.to) }, 409);
    }
    targets.add(name);
    targetsByDir.set(item.dir, targets);
  }

  const at = new Date().toISOString();
  const tag = stamp();
  fs.mkdirSync(fileOpsRoot(dataRoot), { recursive: true });
  const manifestFile = path.join(
    fileOpsRoot(dataRoot),
    `${tag}-rename-${volume.replace(INVALID_NAME, '_')}-${chapter.replace(INVALID_NAME, '_')}.json`,
  );
  const docMoves: DocMove[] = [];
  for (const [oldIndex, position] of positionOf) {
    docMoves.push({ kind: 'page', from: oldIndex, to: position });
    docMoves.push({ kind: 'history', from: oldIndex, to: position });
  }
  const manifest = {
    op: 'rename',
    at,
    volume,
    chapter,
    prefix,
    start,
    padding,
    order,
    files: entries.map((item) => ({
      lang: item.lang,
      from: relPath(rawRoot, item.from),
      to: relPath(rawRoot, item.to),
    })),
    docs: docMoves.filter((move) => move.from !== move.to),
  };

  writeManifest(dataRoot, manifestFile, manifest, 'pending');

  let undoFiles: (() => void) | null = null;
  let undoDocs: (() => void) | null = null;
  try {
    undoFiles = applyMoves(entries.map((item) => ({ from: item.from, to: item.to })));
    const docs = movePageData(dataRoot, volume, chapter, docMoves);
    undoDocs = docs.undo;
    remapChapterPages(dataRoot, volume, chapter, (index) => positionOf.get(index) ?? null);
    // The moves are already committed; a failed status write must not undo them.
    try {
      writeManifest(dataRoot, manifestFile, manifest, 'applied');
    } catch {
      /* the pending manifest still lists every move */
    }
    return {
      at,
      manifest: relPath(dataRoot, manifestFile),
      files: entries.length,
      docs: docs.moved,
      skipped,
    };
  } catch (err) {
    try {
      undoDocs?.();
    } catch {
      /* best effort */
    }
    try {
      undoFiles?.();
    } catch {
      /* best effort */
    }
    try {
      writeManifest(dataRoot, manifestFile, manifest, 'rolled-back');
    } catch {
      /* the manifest was written before the moves; keep the original error */
    }
    throw new AppError('ERR_RENAME_FAILED', { detail: errorText(err) }, 500);
  }
}

type DecodedImage = { width: number; height: number; rgba: Uint8Array; format: 'png' | 'jpeg' };
type Region = { x: number; y: number; w: number; h: number };

function decodeImage(buffer: Buffer): DecodedImage | null {
  const format = sniffFormat(buffer);
  if (format === 'png') {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, rgba: png.data, format: 'png' };
  }
  if (format === 'jpeg') {
    const image = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    return { width: image.width, height: image.height, rgba: image.data as Uint8Array, format: 'jpeg' };
  }
  return null;
}

function crop(image: DecodedImage, axis: 'vertical' | 'horizontal', ratio: number, half: 'a' | 'b'): DecodedImage {
  if (axis === 'vertical') {
    const cut = Math.min(image.width - 1, Math.max(1, Math.round(image.width * ratio)));
    const x0 = half === 'a' ? 0 : cut;
    const width = half === 'a' ? cut : image.width - cut;
    const rgba = new Uint8Array(width * image.height * 4);
    for (let y = 0; y < image.height; y++) {
      const start = (y * image.width + x0) * 4;
      rgba.set(image.rgba.subarray(start, start + width * 4), y * width * 4);
    }
    return { width, height: image.height, rgba, format: image.format };
  }
  const cut = Math.min(image.height - 1, Math.max(1, Math.round(image.height * ratio)));
  const y0 = half === 'a' ? 0 : cut;
  const height = half === 'a' ? cut : image.height - cut;
  const rgba = new Uint8Array(image.width * height * 4);
  rgba.set(image.rgba.subarray(y0 * image.width * 4, (y0 + height) * image.width * 4));
  return { width: image.width, height, rgba, format: image.format };
}

function encode(image: DecodedImage): Buffer {
  if (image.format === 'png') {
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.rgba);
    return PNG.sync.write(png);
  }
  return jpeg.encode({ data: Buffer.from(image.rgba), width: image.width, height: image.height }, 92).data;
}

function regionFor(axis: 'vertical' | 'horizontal', ratio: number, half: 'a' | 'b'): Region {
  if (axis === 'vertical') {
    return half === 'a' ? { x: 0, y: 0, w: ratio, h: 1 } : { x: ratio, y: 0, w: 1 - ratio, h: 1 };
  }
  return half === 'a' ? { x: 0, y: 0, w: 1, h: ratio } : { x: 0, y: ratio, w: 1, h: 1 - ratio };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function clipPanel(panel: Panel, region: Region): Panel | null {
  const left = Math.max(panel.rect.x, region.x);
  const top = Math.max(panel.rect.y, region.y);
  const right = Math.min(panel.rect.x + panel.rect.w, region.x + region.w);
  const bottom = Math.min(panel.rect.y + panel.rect.h, region.y + region.h);
  const width = right - left;
  const height = bottom - top;
  if (width < 0.02 || height < 0.02) return null;
  return {
    ...panel,
    rect: {
      x: clamp01((left - region.x) / region.w),
      y: clamp01((top - region.y) / region.h),
      w: clamp01(width / region.w),
      h: clamp01(height / region.h),
    },
  };
}

function clipAnnotation(annotation: Annotation, region: Region): Annotation | null {
  const points = annotation.points
    .map((point) => ({
      x: clamp01(Math.min(region.x + region.w, Math.max(region.x, point.x))),
      y: clamp01(Math.min(region.y + region.h, Math.max(region.y, point.y))),
    }))
    .filter((point, index, list) => {
      const prev = list[index - 1];
      return !prev || Math.abs(prev.x - point.x) > 1e-6 || Math.abs(prev.y - point.y) > 1e-6;
    });
  if (!points.length) return null;
  return {
    ...annotation,
    points: points.map((point) => ({
      x: clamp01((point.x - region.x) / region.w),
      y: clamp01((point.y - region.y) / region.h),
    })),
  };
}

/** Cut one page document into the half that matches the image region. */
function splitDoc(doc: PageDoc, axis: 'vertical' | 'horizontal', ratio: number, half: 'a' | 'b'): PageDoc {
  const region = regionFor(axis, ratio, half);
  const panels = doc.panels.map((panel) => clipPanel(panel, region)).filter((panel): panel is Panel => Boolean(panel));
  const panelIds = new Set(panels.map((panel) => panel.id));
  const notes: Note[] = doc.notes
    .filter((note) => (note.scope === 'panel' ? Boolean(note.panelId && panelIds.has(note.panelId)) : half === 'a'))
    .map((note) => ({ ...note }));
  const annotations = (doc.annotations ?? [])
    .filter(
      (annotation) => annotation.scope !== 'panel' || Boolean(annotation.panelId && panelIds.has(annotation.panelId)),
    )
    .map((annotation) => clipAnnotation(annotation, region))
    .filter((annotation): annotation is Annotation => Boolean(annotation));
  const groups: PanelGroup[] = (doc.groups ?? [])
    .map((group) => ({ ...group, panelIds: group.panelIds.filter((id) => panelIds.has(id)) }))
    .filter((group) => group.panelIds.length > 0);

  return {
    ...doc,
    panels,
    notes,
    annotations: annotations.length ? annotations : undefined,
    groups: groups.length ? groups : undefined,
    offsets: {},
    panelOffsets: {},
    alignMode: 'page',
  };
}

type Backup = { source: string; backup: string; removed: boolean };

/**
 * Split one page image into two files and insert the second half as the next
 * page. Every language that has this page is split at the same normalized
 * position; page data is shifted and the original page document is clipped into
 * both halves, keeping its reading direction.
 */
export function splitPage(rawRoot: string, dataRoot: string, input: SplitInput): SplitResult {
  const volume = String(input.volume ?? '');
  const chapter = assertSafeSegment(input.chapter, 'chapter');
  if (!volume) throw new AppError('ERR_MISSING_VOLUME', {}, 400);
  const pageIndex = Number(input.pageIndex);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new AppError('ERR_PAGE_INDEX_INVALID', {}, 400);
  }

  const library = createLibrary(rawRoot, dataRoot);
  const entry = requireChapter(library, volume, chapter);
  const page = entry.pages.find((item) => item.index === pageIndex);
  if (!page) throw new AppError('ERR_PAGE_NOT_FOUND', { volume, chapter, page: pageIndex + 1 }, 404);

  const languages = Object.keys(page.files) as Lang[];
  if (!languages.length) throw new AppError('ERR_PAGE_NO_IMAGES', {}, 400);
  const axis = input.axis === 'horizontal' ? 'horizontal' : 'vertical';
  const ratioRaw = Number(input.ratio);
  const ratio = Number.isFinite(ratioRaw) ? Math.min(0.9, Math.max(0.1, ratioRaw)) : 0.5;

  // Decode everything first: an unsupported image must not leave a half-split page.
  const parts = languages.map((lang) => {
    const url = page.files[lang]!;
    const source = imagePath(rawRoot, url);
    if (!fs.existsSync(source)) {
      throw new AppError('ERR_IMAGE_NOT_FOUND', { path: relPath(rawRoot, source) }, 404);
    }
    const decoded = decodeImage(fs.readFileSync(source));
    if (!decoded) {
      throw new AppError(
        'ERR_UNSUPPORTED_IMAGE_FORMAT',
        { format: 'webp/gif/avif/bmp', ext: path.extname(source) },
        415,
      );
    }
    const ext = decoded.format === 'png' ? '.png' : '.jpg';
    const base = path.basename(source, path.extname(source));
    const dir = path.dirname(source);
    const first = resolveWithin(dir, `${base}-a${ext}`);
    const second = resolveWithin(dir, `${base}-b${ext}`);
    for (const target of [first, second]) {
      if (fs.existsSync(target)) {
        throw new AppError('ERR_RENAME_CONFLICT', { name: path.basename(target) }, 409);
      }
    }
    return {
      lang,
      source,
      dir,
      first,
      second,
      firstData: encode(crop(decoded, axis, ratio, 'a')),
      secondData: encode(crop(decoded, axis, ratio, 'b')),
    };
  });

  const at = new Date().toISOString();
  const tag = stamp();
  fs.mkdirSync(fileOpsRoot(dataRoot), { recursive: true });
  const manifestFile = path.join(
    fileOpsRoot(dataRoot),
    `${tag}-split-${volume.replace(INVALID_NAME, '_')}-${chapter.replace(INVALID_NAME, '_')}-${pageIndex + 1}.json`,
  );
  const backupRoot = path.join(fileOpsRoot(dataRoot), `${tag}-split-${pageIndex + 1}`);

  const written: string[] = [];
  const backups: Backup[] = [];
  const undos: (() => void)[] = [];
  const manifest = {
    op: 'split',
    at,
    volume,
    chapter,
    pageIndex,
    axis,
    ratio,
    files: parts.map((part) => ({
      lang: part.lang,
      original: relPath(rawRoot, part.source),
      parts: [relPath(rawRoot, part.first), relPath(rawRoot, part.second)],
    })),
    backup: relPath(dataRoot, backupRoot),
  };
  writeManifest(dataRoot, manifestFile, manifest, 'pending');

  const writeFile = (file: string, data: Buffer) => {
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
    written.push(file);
  };

  try {
    for (const part of parts) {
      writeFile(part.first, part.firstData);
      writeFile(part.second, part.secondData);
    }

    const shift = movePageData(dataRoot, volume, chapter, [
      ...entry.pages
        .filter((item) => item.index > pageIndex)
        .flatMap((item) => [
          { kind: 'page' as const, from: item.index, to: item.index + 1 },
          { kind: 'history' as const, from: item.index, to: item.index + 1 },
        ]),
    ]);
    undos.push(shift.undo);

    // Clip the original document into the two halves; without a document the
    // pages simply inherit the volume direction, as they did before the split.
    const originalDoc = readPageDoc(dataRoot, volume, chapter, pageIndex);
    if (originalDoc) {
      const firstFile = pageFilePath(dataRoot, volume, chapter, pageIndex);
      const secondFile = pageFilePath(dataRoot, volume, chapter, pageIndex + 1);
      const firstRaw = fs.existsSync(firstFile) ? fs.readFileSync(firstFile, 'utf8') : null;
      writePageDoc(
        dataRoot,
        { ...splitDoc(originalDoc, axis, ratio, 'a'), pageIndex },
        {
          source: 'manual',
          skipHistory: true,
        },
      );
      writePageDoc(
        dataRoot,
        { ...splitDoc(originalDoc, axis, ratio, 'b'), pageIndex: pageIndex + 1 },
        {
          source: 'manual',
          skipHistory: true,
        },
      );
      undos.push(() => {
        try {
          if (firstRaw === null) fs.rmSync(firstFile, { force: true });
          else fs.writeFileSync(firstFile, firstRaw, 'utf8');
        } catch {
          /* best effort */
        }
        try {
          fs.rmSync(secondFile, { force: true });
        } catch {
          /* best effort */
        }
      });
    }

    remapChapterPages(dataRoot, volume, chapter, (index) => (index > pageIndex ? index + 1 : index));

    // Keep the originals recoverable, then remove them so the folder has one page per file again.
    for (const part of parts) {
      const backup = path.join(backupRoot, part.lang, path.basename(part.source));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(part.source, backup);
      const entryBackup: Backup = { source: part.source, backup, removed: false };
      backups.push(entryBackup);
      fs.unlinkSync(part.source);
      entryBackup.removed = true;
    }

    // The split is already committed; a failed status write must not undo it.
    try {
      writeManifest(dataRoot, manifestFile, manifest, 'applied');
    } catch {
      /* the pending manifest still lists every move */
    }
    return {
      at,
      manifest: relPath(dataRoot, manifestFile),
      pageIndex,
      languages,
    };
  } catch (err) {
    for (const undo of [...undos].reverse()) {
      try {
        undo();
      } catch {
        /* best effort */
      }
    }
    for (const entryBackup of [...backups].reverse()) {
      try {
        if (entryBackup.removed && fs.existsSync(entryBackup.backup)) {
          fs.copyFileSync(entryBackup.backup, entryBackup.source);
        }
      } catch {
        /* best effort */
      }
    }
    for (const file of [...written].reverse()) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* best effort */
      }
    }
    try {
      writeManifest(dataRoot, manifestFile, manifest, 'rolled-back');
    } catch {
      /* keep the original error */
    }
    throw new AppError('ERR_SPLIT_FAILED', { detail: errorText(err) }, 500);
  }
}
