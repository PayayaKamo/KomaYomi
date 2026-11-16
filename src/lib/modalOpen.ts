/**
 * Every dialog in the app renders a `.modal-backdrop` layer (and the image viewer is a
 * full-screen overlay), so one DOM check covers all of them — including dialogs added
 * later — without wiring a flag through each component.
 */
export const MODAL_SELECTOR = '.modal-backdrop, .lightbox';

/** True while a modal dialog or the full-screen viewer is open. */
export function isModalOpen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.querySelector(MODAL_SELECTOR));
}
