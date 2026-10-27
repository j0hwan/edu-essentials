"use client";

import { useLayoutEffect, useRef, useState, type ReactElement } from "react";

const EXIT_DURATION_MS = 190;
const EXIT_FALLBACK_MS = 400;
const EXIT_EASING = "ease-in";

function supportsAnimatedExit() {
  if (typeof window === "undefined" || typeof document === "undefined") return true;
  if (document.documentElement.dataset.motion === "reduced"
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
}

export default function ModalPresence({
  children,
  animateExit = true,
}: {
  children: ReactElement | null;
  animateExit?: boolean;
}) {
  const [lastChildren, setLastChildren] = useState<ReactElement | null>(children);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const keepForExit = children === null && animateExit && supportsAnimatedExit();
  if (children !== null && lastChildren !== children) setLastChildren(children);
  else if (children === null && !keepForExit && lastChildren !== null) setLastChildren(null);

  const visibleChildren = children ?? (keepForExit ? lastChildren : null);

  useLayoutEffect(() => {
    if (children !== null || !keepForExit || !lastChildren) return;

    const backdrop = wrapperRef.current?.querySelector<HTMLElement>(".modal-backdrop");
    const dialog = backdrop?.querySelector<HTMLElement>(":scope > [role='dialog']");
    if (!backdrop || !dialog) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setLastChildren(null);
      });
      return () => { cancelled = true; };
    }

    const originalInert = backdrop.hasAttribute("inert");
    const originalAriaHidden = backdrop.getAttribute("aria-hidden");
    backdrop.dataset.modalExiting = "true";
    backdrop.setAttribute("inert", "");
    backdrop.setAttribute("aria-hidden", "true");

    const restoreBackdrop = () => {
      if (backdrop.dataset.modalExiting !== "true") return;
      delete backdrop.dataset.modalExiting;
      if (originalInert) backdrop.setAttribute("inert", "");
      else backdrop.removeAttribute("inert");
      if (originalAriaHidden === null) backdrop.removeAttribute("aria-hidden");
      else backdrop.setAttribute("aria-hidden", originalAriaHidden);
    };

    const backdropStyle = window.getComputedStyle(backdrop);
    const dialogStyle = window.getComputedStyle(dialog);
    const standardFilter = backdropStyle.backdropFilter;
    const prefixedFilter = backdropStyle.getPropertyValue("-webkit-backdrop-filter");
    const currentFilter = standardFilter && standardFilter !== "none"
      ? standardFilter
      : prefixedFilter || standardFilter || "none";

    let timer: number | null = null;
    let active = true;
    const animations: Animation[] = [];
    const finish = () => {
      if (!active) return;
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      setLastChildren(null);
    };

    try {
      animations.push(backdrop.animate([
        {
          opacity: backdropStyle.opacity,
          backdropFilter: currentFilter,
          "-webkit-backdrop-filter": currentFilter,
        } as Keyframe,
        {
          opacity: "0",
          backdropFilter: "blur(0px)",
          "-webkit-backdrop-filter": "blur(0px)",
        } as Keyframe,
      ], { duration: EXIT_DURATION_MS, easing: EXIT_EASING, fill: "forwards" }));
      animations.push(dialog.animate([
        { opacity: dialogStyle.opacity, transform: dialogStyle.transform } as Keyframe,
        { opacity: "0", transform: "translateY(10px) scale(.985)" } as Keyframe,
      ], { duration: EXIT_DURATION_MS, easing: EXIT_EASING, fill: "forwards" }));
    } catch {
      finish();
    }

    if (active) {
      timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
      void Promise.all(animations.map((animation) => animation.finished)).then(finish, () => {});
    }

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      restoreBackdrop();
    };
  }, [children, keepForExit, lastChildren]);

  return <div ref={wrapperRef} style={{ display: "contents" }}>{visibleChildren}</div>;
}
