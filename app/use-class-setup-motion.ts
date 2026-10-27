"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { createWidgetResizeSettleFrames, WIDGET_RESIZE_SETTLE_DURATION_MS, WIDGET_RESIZE_SETTLE_EASING, WIDGET_RESIZE_CONTENT_REVEAL_DURATION_MS } from "../lib/widget-resize-motion";

export type ClassSetupBounds = { width: number; height: number };

const reducedMotion = () => document.documentElement.dataset.motion === "reduced"
  || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function getPanelBounds(panel: HTMLElement): ClassSetupBounds {
  const style = window.getComputedStyle(panel);
  return {
    width: style.boxSizing === "border-box" ? Number.parseFloat(style.width) || panel.offsetWidth : panel.offsetWidth,
    height: style.boxSizing === "border-box" ? Number.parseFloat(style.height) || panel.offsetHeight : panel.offsetHeight,
  };
}

export function useClassSetupMotion(panelRef: RefObject<HTMLElement | null>, revision: unknown, initialBounds?: ClassSetupBounds) {
  const boundsRef = useRef<ClassSetupBounds | undefined>(initialBounds);
  const animationsRef = useRef<Animation[]>([]);
  const pendingRef = useRef(false);
  const generationRef = useRef(0);

  const cancel = useCallback(() => {
    generationRef.current++;
    animationsRef.current.forEach((animation) => animation.cancel());
    animationsRef.current = [];
    panelRef.current?.removeAttribute("data-resizing");
    panelRef.current?.removeAttribute("inert");
  }, [panelRef]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let disposed = false;
    let resizeFrame: number | null = null;
    const measure = (reveal = false) => {
      if (disposed || (!reveal && animationsRef.current.length)) return;
      const previous = boundsRef.current;
      cancel();
      const next = getPanelBounds(panel);
      boundsRef.current = { width: next.width, height: next.height };
      pendingRef.current = false;
      if (reducedMotion() || typeof panel.animate !== "function" || !previous?.width || !next.width) return;
      const generation = generationRef.current;
      const animations: Animation[] = [];
      if (previous.width !== next.width || previous.height !== next.height) {
        panel.setAttribute("data-resizing", "true");
        const frames = createWidgetResizeSettleFrames({ ...previous, left: 0, top: 0 }, { width: next.width, height: next.height, left: 0, top: 0 }, 14)
          .map(({ width, height, offset }) => ({ width, height, offset }));
        animations.push(panel.animate(frames, { duration: WIDGET_RESIZE_SETTLE_DURATION_MS + 40, easing: WIDGET_RESIZE_SETTLE_EASING }));
      }
      if (reveal) {
        for (const child of panel.children) {
          animations.push(child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: WIDGET_RESIZE_CONTENT_REVEAL_DURATION_MS, delay: 75, fill: "backwards", easing: "ease-out" }));
        }
      }
      animationsRef.current = animations;
      if (!animations.length) return;
      void Promise.all(animations.map((animation) => animation.finished)).then(() => {
        if (disposed || generation !== generationRef.current) return;
        cancel();
        measure();
      }).catch(() => {});
    };
    measure(true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (disposed || resizeFrame !== null || animationsRef.current.length) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        measure();
      });
    });
    observer?.observe(panel);
    for (const child of panel.children) observer?.observe(child);
    const onResize = () => { cancel(); measure(); };
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      cancel();
      pendingRef.current = false;
    };
  }, [panelRef, revision, cancel]);

  return useCallback((update: (bounds?: ClassSetupBounds) => void) => {
    const panel = panelRef.current;
    if (pendingRef.current) return;
    if (!panel || reducedMotion() || typeof panel.animate !== "function") {
      update(panel ? getPanelBounds(panel) : undefined);
      return;
    }
    const bounds = getPanelBounds(panel);
    cancel();
    boundsRef.current = { width: bounds.width, height: bounds.height };
    pendingRef.current = true;
    panel.setAttribute("inert", "");
    const generation = generationRef.current;
    const animations = [...panel.children].map((child) => child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: "forwards", easing: "ease-out" }));
    animationsRef.current = animations;
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (generation === generationRef.current) update(boundsRef.current);
    }).catch(() => {});
  }, [panelRef, cancel]);
}
