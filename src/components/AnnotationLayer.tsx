/**
 * Vector annotation overlay for the panel editor.
 *
 * Coordinates are normalized to the owning scope, so annotations survive zoom,
 * window resizing and full-resolution exports without re-layout:
 * - page scope:  0..1 across the whole page
 * - panel scope: 0..1 inside that panel's rect
 * Stroke width is a fraction of the page width and font size a fraction of the
 * page height, for the same reason. Only `select` lets pointer events fall through
 * to the panel boxes underneath; every drawing tool captures the page.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Annotation, AnnotationAnchor, AnnotationKind, Lang, Panel, PanelRect } from '../types';
import { clamp01, uid } from '../lib/geometry';
import { mosaicRegion } from '../lib/mosaicPatch';
import { MosaicPatch } from './MosaicPatch';
import { annotationsForLang, annotationLeader } from '../../shared/annotations';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';

export type AnnotationTool = 'select' | AnnotationKind;

/** Toolbar order: selection first, then shapes, then freehand/text helpers. */
export const ANNOTATION_TOOL_ORDER: AnnotationTool[] = [
  'select',
  'arrow',
  'rect',
  'ellipse',
  'highlight',
  'pen',
  'text',
  'badge',
  'mosaic',
];

export const ANNOTATION_TOOLS: Record<AnnotationTool, { icon: string; labelKey: MessageKey }> = {
  select: { icon: '↖', labelKey: 'ann.tool.select' },
  arrow: { icon: '→', labelKey: 'ann.tool.arrow' },
  rect: { icon: '▭', labelKey: 'ann.tool.rect' },
  ellipse: { icon: '○', labelKey: 'ann.tool.ellipse' },
  highlight: { icon: '▬', labelKey: 'ann.tool.highlight' },
  pen: { icon: '✎', labelKey: 'ann.tool.pen' },
  text: { icon: 'T', labelKey: 'ann.tool.text' },
  badge: { icon: '①', labelKey: 'ann.tool.badge' },
  mosaic: { icon: '▦', labelKey: 'ann.tool.mosaic' },
};

/** Swatches keep good contrast on both light and dark page images. */
export const ANNOTATION_COLORS = ['#e0453a', '#f0a020', '#2f9e44', '#2b7de9', '#111111'];

const PAGE_RECT: PanelRect = { x: 0, y: 0, w: 1, h: 1 };
/** Smallest drag that still counts as a shape (normalized). */
const MIN_SIZE = 0.004;
/** Freehand sampling distance; keeps point lists small. */
const PEN_MIN_STEP = 0.004;
const DEFAULT_WIDTH = 0.0035;
const DEFAULT_FONT = 0.035;

type Point = { x: number; y: number };
type Box = { w: number; h: number };
type Draft = { kind: AnnotationKind; rect: PanelRect; panelId: string | null; points: Point[] };
/** Drag while placing a locator: a click sets a point, a longer drag sets a box. */
type AnchorDraft = { start: Point; current: Point };
type TextEdit = {
  kind: 'text' | 'badge';
  rect: PanelRect;
  panelId: string | null;
  point: Point;
  value: string;
};

/**
 * Project the dragged end point onto the nearest 0°/45°/90° ray from the start.
 * Angles are measured in rendered pixels, so a 45° line stays visually diagonal on any page aspect.
 */
export function snapLineEnd(start: Point, end: Point, pxPerX: number, pxPerY: number): Point {
  if (!pxPerX || !pxPerY) return end;
  const dx = (end.x - start.x) * pxPerX;
  const dy = (end.y - start.y) * pxPerY;
  if (!dx && !dy) return end;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  // Keep the cursor's projection instead of its radius, so the line follows the pointer.
  const length = dx * ux + dy * uy;
  return {
    x: clamp01(start.x + (ux * length) / pxPerX),
    y: clamp01(start.y + (uy * length) / pxPerY),
  };
}

/** Minimal shape description accepted by the renderer, so drafts reuse it. */
type Shape = {
  kind: AnnotationKind;
  points: Point[];
  color?: string;
  width?: number;
  text?: string;
  fontSize?: number;
};

type Props = {
  annotations: Annotation[];
  visible: boolean;
  tool: AnnotationTool;
  color: string;
  /** Stroke width as a fraction of the page width. */
  width: number;
  /** Panel that new annotations belong to; null means whole page. */
  activePanel: Panel | null;
  panels: Panel[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (updater: (list: Annotation[]) => Annotation[]) => void;
  /**
   * Page region shown by this layer. Defaults to the whole page; the compare view
   * passes one panel crop, so the same normalized annotations stay in sync.
   */
  viewport?: PanelRect;
  /** Page image used to pixelate mosaics; without it mosaics render as flat blocks. */
  imageUrl?: string;
  /** When set, the next drag on the page places this annotation's locator. */
  anchorTarget?: string | null;
  /** Receives the new locator, or null when the user clears it. */
  onAnchorChange?: (id: string, anchor: AnnotationAnchor | null) => void;
  /** Viewer mode: draw, drag and anchor picking are disabled; existing marks stay visible. */
  readOnly?: boolean;
  /**
   * Language lane this layer belongs to. Only marks of this lane (plus shared marks) are
   * shown, and new marks are tagged with it. Omit in language-agnostic views (panel editor).
   */
  lang?: Lang | null;
  /** Tag new marks as visible in every language instead of the current lane. */
  shareLangs?: boolean;
};

function panelRect(panels: Panel[], id: string | null): PanelRect {
  if (!id) return PAGE_RECT;
  return panels.find((p) => p.id === id)?.rect ?? PAGE_RECT;
}

function toScope(p: Point, rect: PanelRect): Point {
  if (rect.w <= 0 || rect.h <= 0) return { x: 0, y: 0 };
  return { x: clamp01((p.x - rect.x) / rect.w), y: clamp01((p.y - rect.y) / rect.h) };
}

/** Scope-relative points to overlay pixels, cropped to the visible viewport. */
function toPixels(points: Point[], rect: PanelRect, box: Box, viewport: PanelRect = PAGE_RECT): Point[] {
  return points.map((p) => ({
    x: ((rect.x + p.x * rect.w - viewport.x) / viewport.w) * box.w,
    y: ((rect.y + p.y * rect.h - viewport.y) / viewport.h) * box.h,
  }));
}

/** Page-space point to overlay pixels. */
function pageToPixels(p: Point, box: Box, viewport: PanelRect): Point {
  return { x: ((p.x - viewport.x) / viewport.w) * box.w, y: ((p.y - viewport.y) / viewport.h) * box.h };
}

/**
 * Leader line and locator marker for one annotation.
 * The anchor is a page-space point/box, so lines stay glued to the artwork when the
 * view is panned, zoomed or cropped to a panel.
 */
function annotationGuides(annotation: Annotation, scope: PanelRect, box: Box, viewport: PanelRect): ReactNode {
  const color = annotation.color ?? ANNOTATION_COLORS[0];
  const strokeWidth = Math.max(1, ((annotation.width ?? DEFAULT_WIDTH) * box.w) / viewport.w);
  const leader = annotationLeader(annotation, scope);
  const anchor = annotation.anchor;
  const anchorPoint = anchor
    ? pageToPixels({ x: anchor.x + (anchor.w ?? 0) / 2, y: anchor.y + (anchor.h ?? 0) / 2 }, box, viewport)
    : null;
  const anchorBox =
    anchor?.w && anchor.h
      ? {
          from: pageToPixels(anchor, box, viewport),
          to: pageToPixels({ x: anchor.x + anchor.w, y: anchor.y + anchor.h }, box, viewport),
        }
      : null;
  return (
    <g className="ann-guides" pointerEvents="none">
      {leader && (
        <line
          x1={pageToPixels(leader.from, box, viewport).x}
          y1={pageToPixels(leader.from, box, viewport).y}
          x2={pageToPixels(leader.to, box, viewport).x}
          y2={pageToPixels(leader.to, box, viewport).y}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.9}
        />
      )}
      {anchorPoint && (
        <circle
          cx={anchorPoint.x}
          cy={anchorPoint.y}
          r={Math.max(3, strokeWidth * 2.4)}
          fill="#ffffff"
          stroke={color}
          strokeWidth={strokeWidth}
        />
      )}
      {anchorBox && (
        <rect
          x={Math.min(anchorBox.from.x, anchorBox.to.x)}
          y={Math.min(anchorBox.from.y, anchorBox.to.y)}
          width={Math.abs(anchorBox.to.x - anchorBox.from.x)}
          height={Math.abs(anchorBox.to.y - anchorBox.from.y)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray="5 4"
          opacity={0.9}
        />
      )}
    </g>
  );
}

function arrowHead(a: Point, b: Point, size: number): string {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const spread = Math.PI / 7;
  const p1 = { x: b.x - size * Math.cos(angle - spread), y: b.y - size * Math.sin(angle - spread) };
  const p2 = { x: b.x - size * Math.cos(angle + spread), y: b.y - size * Math.sin(angle + spread) };
  return `${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

function renderShape(
  shape: Shape,
  rect: PanelRect,
  box: Box,
  extraClass = '',
  viewport: PanelRect = PAGE_RECT,
  imageUrl?: string,
): ReactNode {
  const pts = toPixels(shape.points, rect, box, viewport);
  const color = shape.color ?? ANNOTATION_COLORS[0];
  const sw = Math.max(1, ((shape.width ?? DEFAULT_WIDTH) * box.w) / viewport.w);
  const fontSize = Math.max(10, ((shape.fontSize ?? DEFAULT_FONT) * box.h) / viewport.h);

  if (pts.length === 0) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];

  switch (shape.kind) {
    case 'arrow':
      if (pts.length < 2) return null;
      return (
        <g className={`ann-shape ${extraClass}`} stroke={color} fill="none" strokeWidth={sw} strokeLinecap="round">
          <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} />
          <polygon points={arrowHead(first, last, Math.max(10, sw * 4))} fill={color} stroke="none" />
        </g>
      );
    case 'rect':
      return (
        <rect
          className={`ann-shape ${extraClass}`}
          x={Math.min(first.x, last.x)}
          y={Math.min(first.y, last.y)}
          width={Math.abs(last.x - first.x)}
          height={Math.abs(last.y - first.y)}
          fill="none"
          stroke={color}
          strokeWidth={sw}
        />
      );
    case 'ellipse': {
      const cx = (first.x + last.x) / 2;
      const cy = (first.y + last.y) / 2;
      return (
        <ellipse
          className={`ann-shape ${extraClass}`}
          cx={cx}
          cy={cy}
          rx={Math.abs(last.x - first.x) / 2}
          ry={Math.abs(last.y - first.y) / 2}
          fill="none"
          stroke={color}
          strokeWidth={sw}
        />
      );
    }
    case 'highlight':
      if (pts.length < 2) return null;
      return (
        <line
          className={`ann-shape ${extraClass}`}
          x1={first.x}
          y1={first.y}
          x2={last.x}
          y2={last.y}
          stroke={color}
          strokeWidth={Math.max(6, sw * 4)}
          strokeOpacity={0.35}
          strokeLinecap="round"
        />
      );
    case 'pen':
      return (
        <polyline
          className={`ann-shape ${extraClass}`}
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'text':
      return (
        <text
          className={`ann-shape ${extraClass}`}
          x={first.x}
          y={first.y}
          fill={color}
          fontSize={fontSize}
          fontWeight={600}
          paintOrder="stroke"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={Math.max(2, fontSize / 8)}
          strokeLinejoin="round"
        >
          {shape.text ?? ''}
        </text>
      );
    case 'badge': {
      const r = fontSize * 0.62;
      return (
        <g className={`ann-shape ${extraClass}`}>
          <circle cx={first.x} cy={first.y} r={r} fill={color} />
          <text
            x={first.x}
            y={first.y}
            fill="#fff"
            fontSize={fontSize}
            fontWeight={700}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {shape.text ?? '1'}
          </text>
        </g>
      );
    }
    case 'mosaic': {
      const x = Math.min(first.x, last.x);
      const y = Math.min(first.y, last.y);
      const w = Math.abs(last.x - first.x);
      const h = Math.abs(last.y - first.y);
      return (
        <g className={`ann-shape ${extraClass}`}>
          <MosaicPatch imageUrl={imageUrl} region={mosaicRegion(rect, shape.points)} x={x} y={y} width={w} height={h} />
        </g>
      );
    }
    default:
      return null;
  }
}

/** Dashed selection frame around one shape, padded a few screen pixels. */
function selectionFrame(
  shape: Shape,
  rect: PanelRect,
  box: Box,
  color: string,
  viewport: PanelRect = PAGE_RECT,
): ReactNode {
  const pts = toPixels(shape.points, rect, box, viewport);
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 6;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.abs(Math.max(...xs) - Math.min(...xs)) + pad * 2;
  const h = Math.abs(Math.max(...ys) - Math.min(...ys)) + pad * 2;
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill="none"
      stroke={color}
      strokeWidth={1}
      strokeDasharray="4 3"
      pointerEvents="none"
    />
  );
}

export function AnnotationLayer({
  annotations,
  visible,
  tool,
  color,
  width,
  activePanel,
  panels,
  selectedId,
  onSelect,
  onChange,
  viewport = PAGE_RECT,
  imageUrl,
  anchorTarget = null,
  onAnchorChange,
  readOnly = false,
  lang = null,
  shareLangs = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const anchorRef = useRef<AnchorDraft | null>(null);
  const [anchorDraft, setAnchorDraft] = useState<AnchorDraft | null>(null);
  const moveRef = useRef<{ id: string; rect: PanelRect; origin: Point[]; start: Point } | null>(null);
  const [moving, setMoving] = useState(false);

  const activeRect = activePanel?.rect ?? PAGE_RECT;
  const activePanelId = activePanel?.id ?? null;

  // Track the rendered size so pixel-space stroke widths follow zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const pagePoint = (e: { clientX: number; clientY: number }): Point => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    // Screen fractions map back into page space, so the same layer works over a crop.
    return {
      x: viewport.x + clamp01((e.clientX - r.left) / r.width) * viewport.w,
      y: viewport.y + clamp01((e.clientY - r.top) / r.height) * viewport.h,
    };
  };

  const createAnnotation = (
    kind: AnnotationKind,
    rect: PanelRect,
    panelId: string | null,
    points: Point[],
    text?: string,
  ) => {
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: uid('a'),
      kind,
      scope: panelId ? 'panel' : 'page',
      panelId,
      points,
      color,
      width: kind === 'text' || kind === 'badge' ? undefined : width,
      text,
      fontSize: kind === 'text' || kind === 'badge' ? DEFAULT_FONT : undefined,
      // A lane-tagged mark only shows in the column it was drawn in; shared marks show in all.
      ...(shareLangs ? { allLangs: true } : lang ? { lang } : {}),
      createdAt: now,
      updatedAt: now,
    };
    onChange((list) => [...list, annotation]);
    onSelect(annotation.id);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!visible || readOnly) return;
    if (anchorTarget) {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      const start = pagePoint(e);
      const next: AnchorDraft = { start, current: start };
      anchorRef.current = next;
      setAnchorDraft(next);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'select') return;
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    const page = pagePoint(e);
    if (tool === 'text' || tool === 'badge') {
      setTextEdit({
        kind: tool,
        rect: activeRect,
        panelId: activePanelId,
        point: toScope(page, activeRect),
        value: '',
      });
      return;
    }
    const start = toScope(page, activeRect);
    const next: Draft = { kind: tool, rect: activeRect, panelId: activePanelId, points: [start, start] };
    draftRef.current = next;
    setDraft(next);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const placing = anchorRef.current;
    if (placing) {
      const next = { ...placing, current: pagePoint(e) };
      anchorRef.current = next;
      setAnchorDraft(next);
      return;
    }
    const current = draftRef.current;
    if (!current) return;
    let point = toScope(pagePoint(e), current.rect);
    if (current.kind === 'pen') {
      const last = current.points[current.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < PEN_MIN_STEP) return;
      const next = { ...current, points: [...current.points, point] };
      draftRef.current = next;
      setDraft(next);
      return;
    }
    // Shift turns a line tool into a straight ruler: 0°, 45° or 90°, snapped while dragging.
    if (e.shiftKey && (current.kind === 'arrow' || current.kind === 'highlight')) {
      point = snapLineEnd(
        current.points[0],
        point,
        (box.w * current.rect.w) / viewport.w,
        (box.h * current.rect.h) / viewport.h,
      );
    }
    const next = { ...current, points: [current.points[0], point] };
    draftRef.current = next;
    setDraft(next);
  };

  const finishDraft = (e: ReactPointerEvent<SVGSVGElement>) => {
    const placing = anchorRef.current;
    if (placing) {
      anchorRef.current = null;
      setAnchorDraft(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* release may already have happened */
      }
      if (!anchorTarget) return;
      const { start, current } = placing;
      // A click (or tiny nudge) marks a point; a real drag marks a rectangle.
      const box =
        Math.abs(current.x - start.x) >= MIN_SIZE || Math.abs(current.y - start.y) >= MIN_SIZE
          ? {
              x: clamp01(Math.min(start.x, current.x)),
              y: clamp01(Math.min(start.y, current.y)),
              w: Math.abs(current.x - start.x),
              h: Math.abs(current.y - start.y),
            }
          : { x: clamp01(start.x), y: clamp01(start.y) };
      onAnchorChange?.(anchorTarget, box);
      return;
    }
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null;
    setDraft(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* the pointer may have been released by the browser already */
    }
    const first = current.points[0];
    const last = current.points[current.points.length - 1];
    if (current.kind === 'pen') {
      if (current.points.length < 2) return;
    } else if (Math.abs(last.x - first.x) < MIN_SIZE && Math.abs(last.y - first.y) < MIN_SIZE) {
      return;
    }
    createAnnotation(current.kind, current.rect, current.panelId, current.points);
  };

  const startMove = (e: ReactPointerEvent<SVGGElement>, annotation: Annotation) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(annotation.id);
    moveRef.current = {
      id: annotation.id,
      rect: annotation.scope === 'panel' ? panelRect(panels, annotation.panelId ?? null) : PAGE_RECT,
      origin: annotation.points.map((p) => ({ ...p })),
      start: pagePoint(e),
    };
    setMoving(true);
  };

  // Dragging an annotation is coalesced by the page history window, like panel drags.
  useEffect(() => {
    if (!moving) return;
    const move = (e: PointerEvent) => {
      const current = moveRef.current;
      if (!current) return;
      const point = pagePoint(e);
      const dx = (point.x - current.start.x) / current.rect.w;
      const dy = (point.y - current.start.y) / current.rect.h;
      const now = new Date().toISOString();
      onChange((list) =>
        list.map((a) =>
          a.id === current.id
            ? {
                ...a,
                points: current.origin.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })),
                updatedAt: now,
              }
            : a,
        ),
      );
    };
    const up = () => {
      moveRef.current = null;
      setMoving(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [moving, onChange]);

  const commitText = () => {
    const edit = textEdit;
    if (!edit) return;
    setTextEdit(null);
    const value = edit.value.trim();
    if (!value) return;
    createAnnotation(edit.kind, edit.rect, edit.panelId, [edit.point], value);
  };

  if (!visible) return null;

  const shown = annotationsForLang(annotations, lang);
  const interactive = tool !== 'select' || Boolean(anchorTarget);
  const anchorPreview = (() => {
    if (!anchorDraft) return null;
    const a = pageToPixels(anchorDraft.start, box, viewport);
    const b = pageToPixels(anchorDraft.current, box, viewport);
    const boxed = Math.abs(b.x - a.x) > 2 || Math.abs(b.y - a.y) > 2;
    return boxed ? (
      <rect
        x={Math.min(a.x, b.x)}
        y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        pointerEvents="none"
      />
    ) : (
      <circle cx={a.x} cy={a.y} r={5} fill="#ffffff" stroke={color} strokeWidth={2} pointerEvents="none" />
    );
  })();

  return (
    <div className="ann-layer">
      <svg
        ref={svgRef}
        className={`ann-svg ${interactive ? 'drawing' : ''}`}
        style={{ pointerEvents: interactive ? 'auto' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDraft}
        onPointerCancel={() => {
          draftRef.current = null;
          setDraft(null);
          anchorRef.current = null;
          setAnchorDraft(null);
        }}
      >
        {/* Leaders and locator markers sit under the marks so they never hide them. */}
        <g className="ann-guides-layer" pointerEvents="none">
          {shown.map((annotation) => (
            <g key={annotation.id}>
              {annotationGuides(
                annotation,
                annotation.scope === 'panel' ? panelRect(panels, annotation.panelId ?? null) : PAGE_RECT,
                box,
                viewport,
              )}
            </g>
          ))}
        </g>
        {shown.map((annotation) => {
          const rect = annotation.scope === 'panel' ? panelRect(panels, annotation.panelId ?? null) : PAGE_RECT;
          const selected = annotation.id === selectedId;
          return (
            <g
              key={annotation.id}
              className={`ann-item ${selected ? 'sel' : ''}`}
              style={{ pointerEvents: tool === 'select' ? 'all' : 'none' }}
              onPointerDown={readOnly ? undefined : (e) => startMove(e, annotation)}
            >
              {/* Invisible fat stroke widens the hit area of thin shapes. */}
              {tool === 'select' && annotation.kind !== 'mosaic' && (
                <polyline
                  points={toPixels(annotation.points, rect, box, viewport)
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(14, ((annotation.width ?? DEFAULT_WIDTH) * box.w) / viewport.w + 12)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {renderShape(annotation, rect, box, '', viewport, imageUrl)}
              {selected && selectionFrame(annotation, rect, box, annotation.color ?? color, viewport)}
            </g>
          );
        })}
        {draft && renderShape({ ...draft, color, width }, draft.rect, box, 'draft', viewport, imageUrl)}
        {anchorPreview}
        {textEdit && (
          <foreignObject x={0} y={0} width={box.w} height={box.h}>
            <div className="ann-input-wrap">
              <input
                className="ann-input"
                autoFocus
                value={textEdit.value}
                placeholder={textEdit.kind === 'badge' ? t('ann.badgePrompt') : t('ann.textPrompt')}
                style={{
                  left: `${((textEdit.rect.x + textEdit.point.x * textEdit.rect.w - viewport.x) / viewport.w) * box.w}px`,
                  top: `${((textEdit.rect.y + textEdit.point.y * textEdit.rect.h - viewport.y) / viewport.h) * box.h}px`,
                  borderColor: color,
                }}
                onChange={(e) => setTextEdit((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitText();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setTextEdit(null);
                  }
                  e.stopPropagation();
                }}
                onBlur={commitText}
              />
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}
