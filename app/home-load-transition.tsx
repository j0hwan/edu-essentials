"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import HomeSkeleton from "./home-skeleton";
import type { HomeSkeletonPresetId } from "../lib/home-skeleton";

type HomeLoadTransitionProps = {
  ready: boolean;
  preset?: HomeSkeletonPresetId;
  reducedMotion?: boolean;
  children?: ReactNode;
};

type MeasuredCard = {
  element: HTMLElement;
  rect: DOMRect;
  size: string;
  index: number;
};

type CardMatch = {
  source: MeasuredCard;
  target: MeasuredCard;
};

const movementDuration = 520;
const emptyBoardDuration = 360;
const revealDuration = 180;
const movementEasing = "cubic-bezier(.22, 1, .36, 1)";

function hasReducedMotionOverride(reducedMotion: boolean) {
  if (reducedMotion || typeof window === "undefined") return reducedMotion;
  const html = document.documentElement;
  return html.dataset.motion === "reduced"
    || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function readCards(elements: HTMLElement[]): MeasuredCard[] {
  return elements.flatMap((element, index) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      ? [{ element, rect, size: element.dataset.size ?? "small", index }]
      : [];
  });
}

function matchCards(sources: MeasuredCard[], targets: MeasuredCard[]): CardMatch[] {
  const pairs = sources.flatMap((source) => targets.map((target) => {
    const sameSize = source.size === target.size;
    const areaDifference = Math.abs(Math.log(
      Math.max(1, source.rect.width * source.rect.height)
      / Math.max(1, target.rect.width * target.rect.height),
    ));
    const centerDistance = Math.hypot(
      source.rect.left + source.rect.width / 2 - target.rect.left - target.rect.width / 2,
      source.rect.top + source.rect.height / 2 - target.rect.top - target.rect.height / 2,
    );
    return { source, target, sameSize, areaDifference, centerDistance };
  }));

  pairs.sort((left, right) =>
    Number(right.sameSize) - Number(left.sameSize)
    || left.areaDifference - right.areaDifference
    || left.centerDistance - right.centerDistance
    || left.source.index - right.source.index
    || left.target.index - right.target.index,
  );

  const usedSources = new Set<MeasuredCard>();
  const usedTargets = new Set<MeasuredCard>();
  const matches: CardMatch[] = [];
  for (const pair of pairs) {
    if (usedSources.has(pair.source) || usedTargets.has(pair.target)) continue;
    usedSources.add(pair.source);
    usedTargets.add(pair.target);
    matches.push({ source: pair.source, target: pair.target });
  }
  return matches;
}

function rectStyle(rect: DOMRect, host: DOMRect): Partial<CSSStyleDeclaration> {
  return {
    left: `${rect.left - host.left}px`,
    top: `${rect.top - host.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

function waitForAnimations(animations: Animation[]) {
  return Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
}

export function HomeLoadTransition({
  ready,
  preset,
  reducedMotion = false,
  children,
}: HomeLoadTransitionProps) {
  const [hasBeenPending, setHasBeenPending] = useState(() => !ready);
  if (!ready && !hasBeenPending) setHasBeenPending(true);
  const shouldAnimate = ready && hasBeenPending;

  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const skeletonRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    const content = contentRef.current;
    const overlay = overlayRef.current;
    if (!root || !host) return;

    const pendingPhase = ready ? "entering" : "pending";
    root.dataset.phase = pendingPhase;
    if (content) {
      content.removeAttribute("aria-hidden");
      content.removeAttribute("inert");
    }

    if (!ready) {
      completedRef.current = false;
      return;
    }
    if (completedRef.current) {
      root.dataset.phase = "done";
      return;
    }
    if (!shouldAnimate) {
      completedRef.current = true;
      root.dataset.phase = "done";
      return;
    }

    if (!content || !overlay || hasReducedMotionOverride(reducedMotion)
      || typeof content.animate !== "function") {
      completedRef.current = true;
      root.dataset.phase = "done";
      setHasBeenPending(false);
      return;
    }

    content.setAttribute("aria-hidden", "true");
    content.setAttribute("inert", "");

    let cancelled = false;
    let settled = false;
    let frame: number | null = null;
    let observer: ResizeObserver | null = null;
    let stopMotionListener: () => void = () => undefined;
    const animations: Animation[] = [];
    const cancelAnimations = () => {
      for (const animation of animations) animation.cancel();
      animations.length = 0;
    };
    const clearOverlay = () => overlay.replaceChildren();
    const activateContent = () => {
      content.removeAttribute("aria-hidden");
      content.removeAttribute("inert");
    };
    const directReveal = () => {
      if (settled) return;
      settled = true;
      completedRef.current = true;
      cancelAnimations();
      observer?.disconnect();
      stopMotionListener();
      host.style.removeProperty("height");
      clearOverlay();
      activateContent();
      root.dataset.phase = "done";
      setHasBeenPending(false);
    };
    if (typeof window.matchMedia === "function") {
      const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      const handleMotionChange = () => {
        if (motionQuery.matches) directReveal();
      };
      if (typeof motionQuery.addEventListener === "function") {
        motionQuery.addEventListener("change", handleMotionChange);
        stopMotionListener = () => motionQuery.removeEventListener("change", handleMotionChange);
      } else {
        motionQuery.addListener(handleMotionChange);
        stopMotionListener = () => motionQuery.removeListener(handleMotionChange);
      }
      if (motionQuery.matches) directReveal();
    }

    const measureAndAnimate = () => {
      if (cancelled || settled) return;

      const skeleton = skeletonRef.current;
      const sourceElements = skeleton
        ? [...skeleton.querySelectorAll<HTMLElement>(".home-skeleton__card")]
        : [];
      const targetElements = [...content.querySelectorAll<HTMLElement>(".widget-card[data-widget-id]")];
      const sources = readCards(sourceElements);
      const targets = readCards(targetElements);
      const sourceToday = skeleton?.querySelector<HTMLElement>(".home-skeleton__today");
      const sourceTodayRect = sourceToday?.getBoundingClientRect();
      const today = content.querySelector<HTMLElement>(
        ".home-page > .home-today-panel:not(.today-section-hidden)",
      );
      const todayRect = today?.getBoundingClientRect();
      if (!sources.length && !sourceTodayRect?.height) {
        // A genuinely empty Home has no outlines to animate.
        directReveal();
        return;
      }

      const hostRect = host.getBoundingClientRect();
      const startHeight = hostRect.height;
      const home = content.querySelector<HTMLElement>(".home-page") ?? content;
      const homeRect = home.getBoundingClientRect();
      const targetHeight = Math.max(0, homeRect.bottom - hostRect.top);
      if (!hostRect.width || !startHeight || !targetHeight) {
        directReveal();
        return;
      }

      const matches = matchCards(sources, targets);
      const duration = targets.length ? movementDuration : emptyBoardDuration;
      const matchedSources = new Set(matches.map((match) => match.source));
      const matchedTargets = new Set(matches.map((match) => match.target));
      const makeSurface = (rect: DOMRect, className = "home-load-transition__surface") => {
        const surface = document.createElement("span");
        surface.className = className;
        surface.setAttribute("aria-hidden", "true");
        surface.setAttribute("inert", "");
        Object.assign(surface.style, rectStyle(rect, hostRect));
        overlay.appendChild(surface);
        return surface;
      };
      const matchSurfaceAppearance = (surface: HTMLElement, target: HTMLElement) => {
        const style = window.getComputedStyle(target);
        surface.style.background = style.background;
        surface.style.border = style.border;
        surface.style.borderTop = style.borderTop;
        surface.style.borderRight = style.borderRight;
        surface.style.borderBottom = style.borderBottom;
        surface.style.borderLeft = style.borderLeft;
        surface.style.borderRadius = style.borderRadius;
        surface.style.boxShadow = style.boxShadow;
      };

      try {
        for (const { source, target } of matches) {
          const surface = makeSurface(target.rect);
          matchSurfaceAppearance(surface, target.element);
          surface.dataset.transitionTargetId = target.element.dataset.widgetId ?? "";
          surface.dataset.size = target.size;
          const x = source.rect.left - target.rect.left;
          const y = source.rect.top - target.rect.top;
          const scaleX = source.rect.width / target.rect.width;
          const scaleY = source.rect.height / target.rect.height;
          animations.push(surface.animate([
            { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`, opacity: 1 },
            { transform: "none", opacity: 1 },
          ], { duration, easing: movementEasing, fill: "forwards" }));
        }

        for (const source of sources) {
          if (matchedSources.has(source)) continue;
          const surface = makeSurface(source.rect);
          surface.dataset.size = source.size;
          animations.push(surface.animate([
            { transform: "scale(1)", opacity: 1 },
            { transform: "scale(.94)", opacity: 0 },
          ], { duration, easing: movementEasing, fill: "forwards" }));
        }

        for (const target of targets) {
          if (matchedTargets.has(target)) continue;
          const surface = makeSurface(target.rect);
          matchSurfaceAppearance(surface, target.element);
          surface.dataset.transitionTargetId = target.element.dataset.widgetId ?? "";
          surface.dataset.size = target.size;
          animations.push(surface.animate([
            { transform: "scale(.94)", opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
          ], { duration: movementDuration, easing: movementEasing, fill: "forwards" }));
        }

        if (today && todayRect && todayRect.width > 0 && todayRect.height > 0) {
          const outline = makeSurface(todayRect, "home-load-transition__today-outline");
          matchSurfaceAppearance(outline, today);
          const start = sourceTodayRect ?? todayRect;
          const x = start.left - todayRect.left;
          const y = start.top - todayRect.top;
          animations.push(outline.animate([
            { transform: `translate(${x}px, ${y}px) scale(${start.width / todayRect.width}, ${start.height / todayRect.height})`, opacity: 1 },
            { transform: "none", opacity: 1 },
          ], { duration, easing: movementEasing, fill: "forwards" }));
        } else if (sourceToday && sourceTodayRect?.height) {
          const outline = makeSurface(sourceTodayRect, "home-load-transition__today-outline");
          matchSurfaceAppearance(outline, sourceToday);
          outline.dataset.hiddenToday = "true";
          animations.push(outline.animate([
            { opacity: 1 },
            { opacity: 0 },
          ], { duration: Math.min(260, duration), easing: "ease-out", fill: "forwards" }));
        }

        host.style.height = `${startHeight}px`;
        animations.push(host.animate([
          { height: `${startHeight}px` },
          { height: `${targetHeight}px` },
        ], { duration, easing: movementEasing, fill: "forwards" }));
        root.dataset.phase = "animating";

        if (typeof ResizeObserver !== "undefined") {
          const initialWidth = hostRect.width;
          observer = new ResizeObserver(() => {
            if (cancelled || settled) return;
            if (Math.abs(host.getBoundingClientRect().width - initialWidth) > 1) directReveal();
          });
          observer.observe(host);
        } else {
          const initialWidth = hostRect.width;
          const handleResize = () => {
            if (Math.abs(host.getBoundingClientRect().width - initialWidth) > 1) directReveal();
          };
          window.addEventListener("resize", handleResize);
          observer = {
            disconnect: () => window.removeEventListener("resize", handleResize),
            observe: () => undefined,
            unobserve: () => undefined,
          } as ResizeObserver;
        }

        void waitForAnimations(animations).then(() => {
          if (cancelled || settled) return;
          root.dataset.phase = "revealing";

          const reveals = [content.animate([
            { opacity: 0 },
            { opacity: 1 },
          ], { duration: revealDuration, easing: "ease-out", fill: "forwards" })];
          for (const surface of [...overlay.children]) {
            if (surface instanceof HTMLElement) {
              reveals.push(surface.animate([
                { opacity: getComputedStyle(surface).opacity || 1 },
                { opacity: 0 },
              ], { duration: revealDuration, easing: "ease-out", fill: "forwards" }));
            }
          }
          animations.push(...reveals);
          return waitForAnimations(reveals).then(() => {
            if (cancelled || settled) return;
            settled = true;
            completedRef.current = true;
            observer?.disconnect();
            stopMotionListener();
            host.style.height = `${targetHeight}px`;
            cancelAnimations();
            clearOverlay();
            activateContent();
            root.dataset.phase = "done";
            host.style.removeProperty("height");
            setHasBeenPending(false);
          });
        }).catch(directReveal);
      } catch {
        directReveal();
      }
    };

    if (!settled) {
      if (typeof window.requestAnimationFrame === "function") {
        frame = window.requestAnimationFrame(() => {
          frame = null;
          measureAndAnimate();
        });
      } else {
        measureAndAnimate();
      }
    }

    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      stopMotionListener();
      cancelAnimations();
      clearOverlay();
      host.style.removeProperty("height");
      if (!settled) root.dataset.phase = pendingPhase;
      activateContent();
    };
  }, [ready, preset, reducedMotion, shouldAnimate]);

  const showSkeleton = !ready || hasBeenPending;
  const phase = !ready ? "pending" : shouldAnimate ? "entering" : "done";

  return (
    <div ref={rootRef} className="home-load-transition" data-phase={phase}>
      <div ref={hostRef} className="home-load-transition__host">
        {showSkeleton && (
          <div ref={skeletonRef} className="home-load-transition__skeleton">
            <HomeSkeleton preset={preset} reducedMotion={reducedMotion} />
          </div>
        )}
        {ready && <div ref={contentRef} className="home-load-transition__content">{children}</div>}
        <div ref={overlayRef} className="home-load-transition__overlay" aria-hidden="true" inert />
      </div>
    </div>
  );
}

export default HomeLoadTransition;
