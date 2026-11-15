import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** One actionable row. Disabled rows stay visible so the menu shape never shifts. */
export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export type ContextMenuEntry = ContextMenuItem | { type: 'separator'; id: string };

export type ContextMenuPoint = { clientX: number; clientY: number };

type MenuApi = {
  openMenu: (point: ContextMenuPoint, items: ContextMenuEntry[]) => void;
};

const MenuContext = createContext<MenuApi | null>(null);

/** Text fields keep the browser menu: clipboard, IME candidate windows and spellcheck live there. */
export function isNativeTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]'),
  );
}

const isItem = (entry: ContextMenuEntry): entry is ContextMenuItem => !('type' in entry);

const enabledIndexes = (items: ContextMenuEntry[]) =>
  items.flatMap((entry, index) => (isItem(entry) && !entry.disabled ? [index] : []));

/**
 * App-wide context menu host. Components call `openMenu` from their own `onContextMenu`
 * (that handler prevents the native menu); anything else is suppressed here so the
 * browser menu never leaks through, except inside text fields.
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback((point: ContextMenuPoint, items: ContextMenuEntry[]) => {
    if (!items.length) return;
    setMenu({ x: point.clientX, y: point.clientY, items });
    setPos(null);
    setActive(-1);
  }, []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (isNativeTextTarget(e.target) || e.defaultPrevented) return;
      e.preventDefault();
      setMenu(null);
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Measure once mounted, then flip toward the viewport when the natural position overflows.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - margin) left = menu.x - rect.width;
    if (top + rect.height > window.innerHeight - margin) top = menu.y - rect.height;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
    setPos({ left, top });
  }, [menu]);

  // Focus once the measured position is applied; a visibility:hidden node cannot take focus.
  useEffect(() => {
    if (pos) menuRef.current?.focus();
  }, [pos]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  const choose = (item: ContextMenuItem) => {
    if (item.disabled) return;
    setMenu(null);
    item.onSelect();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menu) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      setMenu(null);
      return;
    }
    const available = enabledIndexes(menu.items);
    if (!available.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = available.indexOf(active);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : available.length - 1) : (at + step + available.length) % available.length;
      setActive(available[next]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(available[e.key === 'Home' ? 0 : available.length - 1]);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = active >= 0 ? menu.items[active] : null;
      if (item && isItem(item)) choose(item);
    }
  };

  return (
    <MenuContext.Provider value={{ openMenu }}>
      {children}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="ctx-menu"
            role="menu"
            tabIndex={-1}
            style={{
              left: pos?.left ?? menu.x,
              top: pos?.top ?? menu.y,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={onKeyDown}
          >
            {menu.items.map((entry, index) =>
              isItem(entry) ? (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  className={`ctx-item ${entry.danger ? 'danger' : ''} ${index === active ? 'active' : ''}`}
                  disabled={entry.disabled}
                  onMouseEnter={() => setActive(entry.disabled ? -1 : index)}
                  onClick={() => choose(entry)}
                >
                  <span>{entry.label}</span>
                  {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
                </button>
              ) : (
                <div key={entry.id} className="ctx-sep" role="separator" />
              ),
            )}
          </div>,
          document.body,
        )}
    </MenuContext.Provider>
  );
}

export function useContextMenu(): MenuApi {
  const api = useContext(MenuContext);
  if (!api) throw new Error('useContextMenu must be used inside ContextMenuProvider');
  return api;
}
