/**
 * Anchor picking hand-off between the notes composer and the artwork views.
 *
 * The composer starts a pick, the compare / detail views resolve the click into a page point
 * and hand it back, then picking ends. A tiny external store keeps the two components in sync
 * without threading state through every layer of the reader.
 */
import { useSyncExternalStore } from 'react';
import type { NoteAnchor } from '../../shared/types';

type Handler = (anchor: NoteAnchor) => void;

let handler: Handler | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function beginAnchorPick(next: Handler) {
  handler = next;
  emit();
}

export function cancelAnchorPick() {
  if (!handler) return;
  handler = null;
  emit();
}

export function isAnchorPicking() {
  return handler !== null;
}

/** Resolve a click on the artwork; picking always ends after one placement. */
export function pickNoteAnchor(anchor: NoteAnchor) {
  const next = handler;
  handler = null;
  emit();
  next?.(anchor);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAnchorPicking() {
  return useSyncExternalStore(subscribe, isAnchorPicking, isAnchorPicking);
}
