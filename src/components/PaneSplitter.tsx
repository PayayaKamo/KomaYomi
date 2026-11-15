import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Panes never take more than this share of the window, so the stage stays usable. */
const VIEWPORT_SHARE = 0.45;

export function clampPaneWidth(value: number, min: number, max: number): number {
  const viewportMax = Math.round(window.innerWidth * VIEWPORT_SHARE);
  const upper = Math.max(min, Math.min(max, viewportMax));
  return Math.round(Math.min(upper, Math.max(min, value)));
}

/** Reads a stored pane width; returns null when the user never resized that pane. */
export function loadPaneWidth(key: string, min: number, max: number): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? clampPaneWidth(n, min, max) : null;
  } catch {
    return null;
  }
}

/** Persists a pane width, or clears the key so the responsive CSS default applies again. */
export function savePaneWidth(key: string, width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(width)));
  } catch {
    /* private mode / quota: resizing still works for the session */
  }
}

type Props = {
  /** Which border of the stage the handle sits on. */
  edge: 'left' | 'right';
  /** Selector of the pane that should be measured and resized. */
  target: string;
  min: number;
  max: number;
  label: string;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
  onReset: () => void;
};

/**
 * Thin drag handle between the stage and a side pane.
 *
 * Widths are read from the live DOM at pointer-down, so the responsive CSS defaults
 * (240/300px on smaller desktops) are respected until the user actually drags.
 * The handle is hidden below the layout breakpoints, where both panes become drawers.
 */
export function PaneSplitter({ edge, target, min, max, label, onChange, onCommit, onReset }: Props) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const pane = document.querySelector<HTMLElement>(target);
    if (!pane) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: pane.getBoundingClientRect().width };
    widthRef.current = dragRef.current.startWidth;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.classList.add('pane-resizing');
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = edge === 'left' ? e.clientX - drag.startX : drag.startX - e.clientX;
    const next = clampPaneWidth(drag.startWidth + delta, min, max);
    widthRef.current = next;
    onChange(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    document.body.classList.remove('pane-resizing');
    onCommit(widthRef.current);
  };

  return (
    <div
      className={`pane-splitter ${edge} ${dragging ? 'active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
    />
  );
}
