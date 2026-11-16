import type { Annotation, Lang, Panel, PanelRect } from './types';

export const ANNOTATION_PAGE_RECT: PanelRect = { x: 0, y: 0, w: 1, h: 1 };

export type PagePoint = { x: number; y: number };
export type Leader = { from: PagePoint; to: PagePoint };

/**
 * Whether a mark belongs to one language lane.
 * Marks without `lang` predate lane scoping and there is no way to know where they were
 * drawn, so they stay visible everywhere; `allLangs` makes that choice explicit for new ones.
 */
export function annotationMatchesLang(a: Annotation, lang?: Lang | null): boolean {
  if (!lang) return true;
  if (a.allLangs) return true;
  if (!a.lang) return true;
  return a.lang === lang;
}

/** Marks to render/export for one lane. Without a lane every mark is kept. */
export function annotationsForLang(list: Annotation[], lang?: Lang | null): Annotation[] {
  return lang ? list.filter((a) => annotationMatchesLang(a, lang)) : list;
}

/** Drop only the marks owned by one lane, leaving every other language untouched. */
export function clearAnnotationsForLang(list: Annotation[], lang?: Lang | null): Annotation[] {
  if (!lang) return [];
  return list.filter((a) => !annotationMatchesLang(a, lang));
}

/** Drop one mark by id, leaving every other annotation on the page alone. */
export function removeAnnotation(list: Annotation[], id: string): Annotation[] {
  return list.filter((a) => a.id !== id);
}

/** Recolour one mark without touching the rest. */
export function recolorAnnotation(list: Annotation[], id: string, color: string): Annotation[] {
  const now = new Date().toISOString();
  return list.map((a) => (a.id === id ? { ...a, color, updatedAt: now } : a));
}

/** Distance from a point to a segment, both in page fractions (y weighted by the page aspect). */
function segmentDistance(p: PagePoint, a: PagePoint, b: PagePoint, aspect: number): number {
  const ax = a.x;
  const ay = a.y * aspect;
  const bx = b.x;
  const by = b.y * aspect;
  const px = p.x;
  const py = p.y * aspect;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideBox(p: PagePoint, box: PanelRect, tolerance: number, aspect: number): boolean {
  return (
    p.x >= box.x - tolerance &&
    p.x <= box.x + box.w + tolerance &&
    p.y >= box.y - tolerance * aspect &&
    p.y <= box.y + box.h + tolerance * aspect
  );
}

/**
 * Topmost annotation under a page-space point, used by the compare view context menu.
 * Hits cover the shapes themselves plus their locator and leader line, so a right-click on
 * an anchor or a leader opens the same menu as a right-click on the mark.
 */
export function annotationAtPoint(
  list: Annotation[],
  point: PagePoint,
  opts: { panels?: Pick<Panel, 'id' | 'rect'>[]; aspect?: number; tolerance?: number } = {},
): Annotation | null {
  const panels = opts.panels ?? [];
  const aspect = opts.aspect ?? 1.4;
  const tolerance = opts.tolerance ?? 0.01;
  // Later marks are drawn on top, so they win the hit test.
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    const scope = annotationScope(a, panels);
    const pts = a.points.map((p) => ({ x: scope.x + p.x * scope.w, y: scope.y + p.y * scope.h }));
    if (!pts.length) continue;
    const slack = Math.max(tolerance, (a.width ?? 0.0035) * 1.5);

    switch (a.kind) {
      case 'arrow':
      case 'pen':
      case 'highlight': {
        let best = Infinity;
        for (let j = 1; j < pts.length; j++) best = Math.min(best, segmentDistance(point, pts[j - 1], pts[j], aspect));
        if (best <= slack) return a;
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'mosaic':
        if (insideBox(point, annotationBBox(a, scope), slack, aspect)) return a;
        break;
      case 'text':
      case 'badge': {
        // Text width is not stored: approximate from the glyph count so the whole callout is clickable.
        const font = a.fontSize ?? 0.035;
        const width =
          a.kind === 'badge'
            ? font * aspect * 1.4
            : Math.max(font * aspect, (a.text?.length ?? 1) * font * aspect * 0.62);
        if (insideBox(point, { x: pts[0].x, y: pts[0].y, w: width, h: font }, slack, aspect)) return a;
        break;
      }
    }

    if (a.anchor) {
      const { x, y, w = 0, h = 0 } = a.anchor;
      const center = { x: x + w / 2, y: y + h / 2 };
      if (insideBox(point, { x, y, w, h }, slack, aspect)) return a;
      if (Math.hypot(point.x - center.x, (point.y - center.y) * aspect) <= slack * 2) return a;
    }
    const leader = annotationLeader(a, scope);
    if (leader && segmentDistance(point, leader.from, leader.to, aspect) <= slack * 1.5) return a;
  }
  return null;
}

/** Whole page unless the annotation belongs to a panel. */
export function annotationScope(a: Annotation, panels: Pick<Panel, 'id' | 'rect'>[]): PanelRect {
  if (a.scope !== 'panel') return ANNOTATION_PAGE_RECT;
  return panels.find((p) => p.id === a.panelId)?.rect ?? ANNOTATION_PAGE_RECT;
}

/** Annotation bounding box in page coordinates. */
export function annotationBBox(a: Annotation, scope: PanelRect): PanelRect {
  const xs = a.points.map((p) => scope.x + p.x * scope.w);
  const ys = a.points.map((p) => scope.y + p.y * scope.h);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Centre of the locator (point or box), in page coordinates. */
export function annotationAnchorPoint(a: Annotation): PagePoint | null {
  if (!a.anchor) return null;
  return { x: a.anchor.x + (a.anchor.w ?? 0) / 2, y: a.anchor.y + (a.anchor.h ?? 0) / 2 };
}

/**
 * Leader line between an annotation and the place it points at.
 * An explicit anchor always wins; callouts (text/badge) fall back to the centre of the
 * owning panel so old annotations without anchors still get a sensible line.
 */
export function annotationLeader(a: Annotation, scope: PanelRect): Leader | null {
  if (a.showLeader === false) return null;
  const anchor = annotationAnchorPoint(a);
  const callout = a.kind === 'text' || a.kind === 'badge';
  if (!anchor && !callout) return null;

  const box = annotationBBox(a, scope);
  const from: PagePoint = callout
    ? { x: scope.x + a.points[0].x * scope.w, y: scope.y + a.points[0].y * scope.h }
    : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const to = anchor ?? { x: scope.x + scope.w / 2, y: scope.y + scope.h / 2 };
  if (Math.hypot(to.x - from.x, to.y - from.y) < 0.002) return null;
  return { from, to };
}
