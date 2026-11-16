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

/** A flyout submenu. Its children are plain actions, which is all the app needs today. */
export type ContextMenuSubmenu = {
  type: 'submenu';
  id: string;
  label: string;
  disabled?: boolean;
  items: (ContextMenuItem | { type: 'separator'; id: string })[];
};

export type ContextMenuEntry = ContextMenuItem | ContextMenuSubmenu | { type: 'separator'; id: string };

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

const isAction = (entry: ContextMenuEntry): entry is ContextMenuItem => !('type' in entry);
const isSubmenu = (entry: ContextMenuEntry): entry is ContextMenuSubmenu => 'type' in entry && entry.type === 'submenu';
const isNavigable = (entry: ContextMenuEntry) => isAction(entry) || isSubmenu(entry);

const enabledIndexes = (items: ContextMenuEntry[]) =>
  items.flatMap((entry, index) => (isNavigable(entry) && !entry.disabled ? [index] : []));

/**
 * App-wide context menu host. Components call `openMenu` from their own `onContextMenu`
 * (that handler prevents the native menu); anything else is suppressed here so the
 * browser menu never leaks through, except inside text fields.
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [submenu, setSubmenu] = useState<{
    id: string;
    anchor: { left: number; right: number; top: number };
  } | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ left: number; top: number } | null>(null);
  const [subActive, setSubActive] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusSubmenuRef = useRef(false);

  const closeAll = useCallback(() => {
    setMenu(null);
    setPos(null);
    setSubmenu(null);
    setSubmenuPos(null);
    setActive(-1);
    setSubActive(-1);
    focusSubmenuRef.current = false;
  }, []);

  const openMenu = useCallback((point: ContextMenuPoint, items: ContextMenuEntry[]) => {
    if (!items.length) return;
    setMenu({ x: point.clientX, y: point.clientY, items });
    setPos(null);
    setActive(-1);
    setSubmenu(null);
    setSubmenuPos(null);
    setSubActive(-1);
    focusSubmenuRef.current = false;
  }, []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (isNativeTextTarget(e.target) || e.defaultPrevented) return;
      e.preventDefault();
      closeAll();
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [closeAll]);

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

  // A flyout opens beside its row and flips to the left/bottom edge when it would overflow.
  useLayoutEffect(() => {
    if (!submenu) return;
    const el = submenuRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let left = submenu.anchor.right - 2;
    if (left + rect.width > window.innerWidth - margin) left = submenu.anchor.left - rect.width + 2;
    let top = submenu.anchor.top - 5;
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
    setSubmenuPos({ left, top });
  }, [submenu]);

  // Focus once the measured position is applied; a visibility:hidden node cannot take focus.
  useEffect(() => {
    if (pos) menuRef.current?.focus();
  }, [pos]);

  useEffect(() => {
    if (!submenu || !submenuPos || !focusSubmenuRef.current) return;
    focusSubmenuRef.current = false;
    submenuRef.current?.querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
  }, [submenu, submenuPos]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) closeAll();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAll();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', closeAll, true);
    window.addEventListener('resize', closeAll);
    window.addEventListener('blur', closeAll);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', closeAll, true);
      window.removeEventListener('resize', closeAll);
      window.removeEventListener('blur', closeAll);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu, closeAll]);

  const choose = (item: ContextMenuItem) => {
    if (item.disabled) return;
    closeAll();
    item.onSelect();
  };

  const openSubmenu = (entry: ContextMenuSubmenu, trigger: HTMLElement, focusFirst = false) => {
    if (entry.disabled) return;
    const rect = trigger.getBoundingClientRect();
    submenuTriggerRef.current = trigger instanceof HTMLButtonElement ? trigger : null;
    focusSubmenuRef.current = focusFirst;
    setSubmenu({ id: entry.id, anchor: { left: rect.left, right: rect.right, top: rect.top } });
    setSubmenuPos(null);
    const first = entry.items.findIndex((item) => isAction(item) && !item.disabled);
    setSubActive(first);
  };

  const showSubmenu = (entry: ContextMenuSubmenu, trigger: HTMLElement, focusFirst = false) => {
    if (submenu?.id === entry.id) {
      // Already open: keyboard activation still moves focus into the visible flyout.
      if (focusFirst) {
        setSubActive(entry.items.findIndex((item) => isAction(item) && !item.disabled));
        submenuRef.current?.querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
      }
      return;
    }
    openSubmenu(entry, trigger, focusFirst);
  };

  const closeSubmenu = (focusTrigger: boolean) => {
    const focusWasInside = Boolean(submenuRef.current?.contains(document.activeElement));
    setSubmenu(null);
    setSubmenuPos(null);
    setSubActive(-1);
    if (focusTrigger) submenuTriggerRef.current?.focus();
    else if (focusWasInside) menuRef.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menu) return;
    // The flyout owns its own arrow/Enter handling.
    if ((e.target as HTMLElement).closest('.ctx-submenu')) return;
    if (submenu && (e.key === 'Escape' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      e.stopPropagation();
      closeSubmenu(true);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      closeAll();
      return;
    }
    const available = enabledIndexes(menu.items);
    if (!available.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (submenu) closeSubmenu(false);
      const at = available.indexOf(active);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : available.length - 1) : (at + step + available.length) % available.length;
      setActive(available[next]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (submenu) closeSubmenu(false);
      setActive(available[e.key === 'Home' ? 0 : available.length - 1]);
      return;
    }
    const entry = active >= 0 ? menu.items[active] : null;
    if (entry && isSubmenu(entry)) {
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const trigger = menuRef.current?.querySelector<HTMLButtonElement>(`[data-menu-index="${active}"]`);
        if (trigger) showSubmenu(entry, trigger, true);
      }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && entry && isAction(entry)) {
      e.preventDefault();
      choose(entry);
    }
  };

  const onSubmenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menu || !submenu) return;
    const entry = menu.items.find((item): item is ContextMenuSubmenu => isSubmenu(item) && item.id === submenu.id);
    if (!entry) return;
    const available = entry.items.flatMap((item, index) => (isAction(item) && !item.disabled ? [index] : []));
    if (!available.length) return;
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      closeSubmenu(true);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const at = available.indexOf(subActive);
      const index =
        e.key === 'Home'
          ? available[0]
          : e.key === 'End'
            ? available[available.length - 1]
            : available[
                at < 0 ? (step > 0 ? 0 : available.length - 1) : (at + step + available.length) % available.length
              ];
      setSubActive(index);
      submenuRef.current?.querySelector<HTMLButtonElement>(`[data-sub-index="${index}"]`)?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const item = subActive >= 0 ? entry.items[subActive] : null;
      if (item && isAction(item)) choose(item);
    }
  };

  const openSubmenuEntry =
    submenu && menu
      ? menu.items.find((entry): entry is ContextMenuSubmenu => isSubmenu(entry) && entry.id === submenu.id)
      : undefined;

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
            {menu.items.map((entry, index) => {
              if (isSubmenu(entry)) {
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    data-menu-index={index}
                    aria-haspopup="menu"
                    aria-expanded={submenu?.id === entry.id}
                    className={`ctx-item ${index === active ? 'active' : ''}`}
                    disabled={entry.disabled}
                    onMouseEnter={(e) => {
                      setActive(entry.disabled ? -1 : index);
                      if (!entry.disabled) showSubmenu(entry, e.currentTarget);
                    }}
                    onClick={(e) => {
                      if (!entry.disabled) showSubmenu(entry, e.currentTarget, true);
                    }}
                  >
                    <span>{entry.label}</span>
                    <span className="ctx-arrow" aria-hidden="true">
                      ›
                    </span>
                  </button>
                );
              }
              if (isAction(entry)) {
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    data-menu-index={index}
                    className={`ctx-item ${entry.danger ? 'danger' : ''} ${index === active ? 'active' : ''}`}
                    disabled={entry.disabled}
                    onMouseEnter={() => {
                      setActive(entry.disabled ? -1 : index);
                      if (submenu) closeSubmenu(false);
                    }}
                    onClick={() => choose(entry)}
                  >
                    <span>{entry.label}</span>
                    {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
                  </button>
                );
              }
              return <div key={entry.id} className="ctx-sep" role="separator" />;
            })}
            {submenu && openSubmenuEntry && (
              <div
                ref={submenuRef}
                className="ctx-menu ctx-submenu"
                role="menu"
                aria-label={openSubmenuEntry.label}
                tabIndex={-1}
                style={{
                  left: submenuPos?.left ?? submenu.anchor.right,
                  top: submenuPos?.top ?? submenu.anchor.top,
                  visibility: submenuPos ? 'visible' : 'hidden',
                }}
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={onSubmenuKeyDown}
              >
                {openSubmenuEntry.items.map((entry, index) =>
                  isAction(entry) ? (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitem"
                      data-sub-index={index}
                      className={`ctx-item ${entry.danger ? 'danger' : ''} ${index === subActive ? 'active' : ''}`}
                      disabled={entry.disabled}
                      onMouseEnter={() => setSubActive(entry.disabled ? -1 : index)}
                      onClick={() => choose(entry)}
                    >
                      <span>{entry.label}</span>
                      {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
                    </button>
                  ) : (
                    <div key={entry.id} className="ctx-sep" role="separator" />
                  ),
                )}
              </div>
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
