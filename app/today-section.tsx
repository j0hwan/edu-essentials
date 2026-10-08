"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, EyeOff, MoreHorizontal, Pencil } from "lucide-react";

type TodaySectionProps = {
  hidden: boolean;
  customizing: boolean;
  children: ReactNode;
  onHiddenChange: (hidden: boolean) => boolean;
  onCalendar: () => void;
  onOptionsOpen: () => void;
  onHideFocus?: () => void;
  menuStyle?: CSSProperties;
};

export default function TodaySection({
  hidden,
  customizing,
  children,
  onHiddenChange,
  onCalendar,
  onOptionsOpen,
  onHideFocus,
  menuStyle,
}: TodaySectionProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const focusLastItemOnOpenRef = useRef(false);
  const focusOnOpenRef = useRef(false);

  const setSectionElement = useCallback((element: HTMLElement | null) => {
    sectionRef.current = element;
    if (element) setPortalTarget(element.closest<HTMLElement>(".reference-ui") ?? document.body);
  }, []);

  useEffect(() => {
    if (!hidden || !menuOpen) return;
    // Clear stale menu state so an externally hidden section cannot reopen it later.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A prop transition must dismiss this section's transient menu.
    setMenuOpen(false);
  }, [hidden, menuOpen]);

  const closeMenu = useCallback((returnFocus = false) => {
    focusOnOpenRef.current = false;
    setMenuOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [menuOpen, closeMenu]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;

    const placeMenu = () => {
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const triggerRect = trigger.getBoundingClientRect();
      const width = menu.offsetWidth || Math.min(240, viewportWidth * 0.85);
      const height = menu.offsetHeight;
      const left = Math.max(12, Math.min(triggerRect.right - width, viewportWidth - width - 12));
      const below = triggerRect.bottom + 4;
      const top = below + height <= viewportHeight - 12
        ? below
        : Math.max(12, triggerRect.top - height - 4);
      setMenuPosition((current) => current?.left === left && current.top === top ? current : { left, top });
    };

    placeMenu();
    window.addEventListener("resize", placeMenu);
    document.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      document.removeEventListener("scroll", placeMenu, true);
    };
  }, [menuOpen, portalTarget]);

  useLayoutEffect(() => {
    if (!menuOpen || !menuPosition || !focusOnOpenRef.current) return;
    let focusFrame = 0;
    const focusWhenVisible = () => {
      const menu = menuRef.current;
      if (!menu?.isConnected || !focusOnOpenRef.current) return;
      const active = document.activeElement;
      if (active !== triggerRef.current && active !== document.body && !menu.contains(active)) {
        focusOnOpenRef.current = false;
        return;
      }
      // Flush positioning and wait until the browser has applied visibility.
      menu.getBoundingClientRect();
      if (window.getComputedStyle(menu).visibility !== "visible") {
        focusFrame = window.requestAnimationFrame(focusWhenVisible);
        return;
      }
      const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
      const initialItem = focusLastItemOnOpenRef.current ? items[items.length - 1] : items[0];
      if (!initialItem) return;
      initialItem.focus({ preventScroll: true });
      if (document.activeElement === initialItem) {
        focusOnOpenRef.current = false;
        focusLastItemOnOpenRef.current = false;
      } else focusFrame = window.requestAnimationFrame(focusWhenVisible);
    };
    focusFrame = window.requestAnimationFrame(focusWhenVisible);
    return () => window.cancelAnimationFrame(focusFrame);
  }, [menuOpen, menuPosition, portalTarget]);

  const openMenu = (focusLastItem = false) => {
    setMenuPosition(null);
    focusOnOpenRef.current = true;
    focusLastItemOnOpenRef.current = focusLastItem;
    onOptionsOpen();
    setMenuOpen(true);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!menuOpen) openMenu(event.key === "ArrowUp");
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.tabIndex >= 0 && !menuRef.current?.contains(element) && !element.closest("[inert], [aria-hidden='true']") && element.getClientRects().length > 0);
      const triggerIndex = candidates.indexOf(triggerRef.current!);
      const next = candidates[triggerIndex + (event.shiftKey ? -1 : 1)];
      closeMenu();
      (next ?? triggerRef.current)?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + offset + items.length) % items.length;
    items[nextIndex].focus();
  };

  const hide = () => {
    if (!onHiddenChange(true)) return;
    closeMenu();
    onHideFocus?.();
  };

  const restore = () => {
    if (!onHiddenChange(false)) return;
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (hidden && !customizing) return null;

  if (hidden) {
    return (
      <section className="home-today-panel today-section-hidden" aria-label="Hidden Today section">
        <div className="today-section-ghost" aria-hidden="true" inert>
          <header className="today-panel-header">
            <h2>Today</h2>
            <div className="today-panel-actions">
              <button className="today-panel-link" tabIndex={-1}>View calendar <ArrowRight size={14} /></button>
              <button className="icon-button" tabIndex={-1} aria-hidden="true"><MoreHorizontal size={22} /></button>
            </div>
          </header>
          {children}
        </div>
        <button type="button" className="today-section-restore" aria-label="Restore Today section" onClick={restore}>
          <span>Today</span>
          <strong>Restore</strong>
        </button>
      </section>
    );
  }

  return (
    <section ref={setSectionElement} className="home-today-panel" aria-labelledby="today-panel-title">
      <header className="today-panel-header">
        <h2 id="today-panel-title">Today</h2>
        <div className="today-panel-actions">
          <button className="today-panel-link" onClick={onCalendar}>View calendar <ArrowRight size={14} /></button>
          <button
            ref={triggerRef}
            type="button"
            className="icon-button"
            aria-label="Today section options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => menuOpen ? closeMenu() : openMenu()}
            onKeyDown={handleTriggerKeyDown}
          ><MoreHorizontal size={22} /></button>
        </div>
      </header>
      {children}
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="popover widget-menu today-section-menu"
          role="menu"
          tabIndex={-1}
          aria-label="Today section options"
          onKeyDown={handleMenuKeyDown}
          style={{ ...menuStyle, position: "fixed", left: menuPosition?.left ?? -9999, top: menuPosition?.top ?? -9999, right: "auto", visibility: menuPosition ? "visible" : "hidden" }}
        >
          <button type="button" role="menuitem" disabled title="Coming soon"><Pencil size={15} /> Edit section</button>
          <button type="button" role="menuitem" onClick={hide}><EyeOff size={15} /> Hide section</button>
        </div>,
        portalTarget ?? document.body,
      )}
    </section>
  );
}
