import { useEffect } from 'react';
import { MODAL_SELECTOR } from '../lib/modalOpen';

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function topModal(): HTMLElement | null {
  const list = document.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
  return list.length ? list[list.length - 1] : null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

/**
 * Keeps focus inside whichever modal is open and returns it to the trigger on close.
 * Dialogs are ordinary children of the app, so a body observer covers every one of
 * them (volume settings, exchange/templates, project/import, export, help, backup…).
 */
export function useModalFocusGuard() {
  useEffect(() => {
    let count = document.querySelectorAll(MODAL_SELECTOR).length;
    let restore: HTMLElement | null = null;

    const focusFirst = () => {
      const modal = topModal();
      if (!modal) return;
      const items = focusables(modal);
      (items[0] ?? modal).focus?.();
    };

    const sync = () => {
      const next = document.querySelectorAll(MODAL_SELECTOR).length;
      if (next === count) return;
      if (count === 0 && next > 0) {
        restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // Let the dialog paint before moving focus into it.
        requestAnimationFrame(focusFirst);
      } else if (next > count) {
        requestAnimationFrame(focusFirst);
      } else if (next === 0) {
        const target = restore;
        restore = null;
        target?.focus?.();
      }
      count = next;
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || count === 0) return;
      const modal = topModal();
      if (!modal) return;
      const items = focusables(modal);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !modal.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
}
