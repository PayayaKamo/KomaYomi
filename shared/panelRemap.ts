import type { AlignOffset, Annotation, Lang, Note, PageDoc, Panel, PanelGroup, PanelRect } from './types.ts';
import { sortReadingOrder } from './panelOrder.ts';

/**
 * Keeping work attached to the artwork when the panel grid changes.
 *
 * Re-detecting a page, or applying a saved layout template, replaces every panel id. Notes and
 * marks are stored against those ids, so a blind `p1..pN` rewrite silently moves a note to a
 * different drawing (or orphans it when the new grid has fewer panels). Matching old panels to
 * new ones by rectangle overlap keeps each note on the drawing it was written for.
 */

/** Panels whose rectangles overlap less than this are treated as unrelated. */
const MIN_OVERLAP = 0.02;

const area = (rect: PanelRect) => Math.max(0, rect.w) * Math.max(0, rect.h);

function intersection(a: PanelRect, b: PanelRect): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

/** Intersection over union: 1 when the rectangles are identical, 0 when they do not touch. */
export function panelOverlap(a: PanelRect, b: PanelRect): number {
  const inter = intersection(a, b);
  if (inter <= 0) return 0;
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Pair old panels with the new panel that covers the same artwork.
 *
 * Greedy best-overlap matching, one new panel per old panel. When both grids have the same
 * number of panels, leftovers are paired by reading order, so a page that only shifted or
 * shrank a little still keeps every note instead of dropping the low-overlap ones.
 */
export function matchPanelsByRect(oldOrder: Panel[], newOrder: Panel[]): Map<string, string> {
  const pairs: { oldIndex: number; newIndex: number; score: number }[] = [];
  oldOrder.forEach((oldPanel, oldIndex) => {
    newOrder.forEach((newPanel, newIndex) => {
      const score = panelOverlap(oldPanel.rect, newPanel.rect);
      if (score >= MIN_OVERLAP) pairs.push({ oldIndex, newIndex, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.oldIndex - b.oldIndex || a.newIndex - b.newIndex);

  const map = new Map<string, string>();
  const usedNew = new Set<string>();
  for (const pair of pairs) {
    const oldPanel = oldOrder[pair.oldIndex];
    const newPanel = newOrder[pair.newIndex];
    if (map.has(oldPanel.id) || usedNew.has(newPanel.id)) continue;
    map.set(oldPanel.id, newPanel.id);
    usedNew.add(newPanel.id);
  }

  if (oldOrder.length === newOrder.length) {
    const free = newOrder.filter((panel) => !usedNew.has(panel.id));
    let next = 0;
    for (const panel of oldOrder) {
      if (map.has(panel.id)) continue;
      const target = free[next];
      if (!target) break;
      map.set(panel.id, target.id);
      next += 1;
    }
  }
  return map;
}

export type PanelRefRemap = {
  /** Old panel id → new panel id; unmatched panels are absent. */
  map: Map<string, string>;
  notes: Note[];
  annotations: Annotation[];
  groups: PanelGroup[];
  panelOffsets: Record<string, Partial<Record<Lang, AlignOffset>>>;
  /** Panel notes that no new panel covered; they stay available as page notes. */
  movedNotes: number;
  /** Panel marks moved to page coordinates because their panel disappeared. */
  movedAnnotations: number;
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Follow the artwork into a new panel grid.
 *
 * - matched panel notes/annotations get the new panel id;
 * - notes whose panel is gone keep their text and anchor as page notes instead of being lost;
 * - annotations whose panel is gone are converted to whole-page coordinates, so they still sit
 *   on the same drawing;
 * - panel groups and per-panel alignment offsets are remapped, dropping entries with no successor.
 */
export function remapPanelRefs(
  doc: Pick<PageDoc, 'panels' | 'notes' | 'annotations' | 'groups' | 'panelOffsets' | 'readingDirection'>,
  newPanels: Panel[],
): PanelRefRemap {
  const oldOrder = sortReadingOrder(doc.panels, doc.readingDirection, (panel) => panel.rect);
  const map = matchPanelsByRect(oldOrder, newPanels);
  const oldById = new Map(doc.panels.map((panel) => [panel.id, panel]));
  const newIds = new Set(newPanels.map((panel) => panel.id));

  let movedNotes = 0;
  const notes = doc.notes.map((note): Note => {
    if (note.scope !== 'panel' || !note.panelId) return note;
    const next = map.get(note.panelId);
    if (next && newIds.has(next)) return { ...note, panelId: next };
    movedNotes += 1;
    return { ...note, scope: 'page', panelId: null };
  });

  let movedAnnotations = 0;
  const annotations = (doc.annotations ?? []).map((annotation): Annotation => {
    if (annotation.scope !== 'panel') return annotation;
    const next = annotation.panelId ? map.get(annotation.panelId) : undefined;
    if (next && newIds.has(next)) return { ...annotation, panelId: next };
    const oldPanel = annotation.panelId ? oldById.get(annotation.panelId) : undefined;
    movedAnnotations += 1;
    if (!oldPanel) return { ...annotation, scope: 'page', panelId: null };
    return {
      ...annotation,
      scope: 'page',
      panelId: null,
      points: annotation.points.map((point) => ({
        x: round4(oldPanel.rect.x + point.x * oldPanel.rect.w),
        y: round4(oldPanel.rect.y + point.y * oldPanel.rect.h),
      })),
    };
  });

  const groups = (doc.groups ?? [])
    .map((group) => ({
      ...group,
      panelIds: group.panelIds.map((id) => map.get(id)).filter((id): id is string => Boolean(id)),
    }))
    .filter((group) => group.panelIds.length > 0);

  const panelOffsets: Record<string, Partial<Record<Lang, AlignOffset>>> = {};
  for (const [oldId, offsets] of Object.entries(doc.panelOffsets ?? {})) {
    const next = map.get(oldId);
    if (next) panelOffsets[next] = offsets;
  }

  return { map, notes, annotations, groups, panelOffsets, movedNotes, movedAnnotations };
}

const containsPoint = (rect: PanelRect, point: { x: number; y: number }) =>
  point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

const toPagePoint = (rect: PanelRect, point: { x: number; y: number }) => ({
  x: round4(rect.x + point.x * rect.w),
  y: round4(rect.y + point.y * rect.h),
});

const toLocalPoint = (rect: PanelRect, point: { x: number; y: number }) => ({
  x: rect.w > 0 ? round4((point.x - rect.x) / rect.w) : 0.5,
  y: rect.h > 0 ? round4((point.y - rect.y) / rect.h) : 0.5,
});

/** Turn a panel-scoped mark into a page-scoped one without moving it on the artwork. */
export function annotationToPage(annotation: Annotation, rect: PanelRect): Annotation {
  return {
    ...annotation,
    scope: 'page',
    panelId: null,
    points: annotation.points.map((point) => toPagePoint(rect, point)),
  };
}

/** Re-home a mark from one panel box to another, preserving its page position. */
export function annotationToPanel(annotation: Annotation, from: PanelRect, to: PanelRect): Annotation {
  return {
    ...annotation,
    points: annotation.points.map((point) => toLocalPoint(to, toPagePoint(from, point))),
  };
}

/**
 * Pick the panel that owns a mark after its panel was split: the piece containing the first
 * point wins, and the whole mark is re-expressed in that piece's local coordinates.
 */
export function annotationIntoPieces(annotation: Annotation, from: PanelRect, pieces: PanelRect[]): Annotation {
  const firstPoint = annotation.points[0];
  if (!firstPoint) return annotation;
  const pagePoint = toPagePoint(from, firstPoint);
  const owner = pieces.find((piece) => containsPoint(piece, pagePoint)) ?? pieces[0];
  return owner ? annotationToPanel(annotation, from, owner) : annotation;
}
