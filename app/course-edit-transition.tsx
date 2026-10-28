"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ElementType, type ReactElement } from "react";

export const CourseEditTransitionContext = createContext<boolean | null>(null);

export default function CourseEditTransition({ revision, children, appear = false, onExited }: { revision: string; children: ReactElement | null; appear?: boolean; onExited?: () => void }) {
  const paused = useContext(CourseEditTransitionContext);
  const elementRef = useRef<HTMLElement | SVGElement>(null);
  const latest = useRef({ revision, children, onExited });
  const reveal = useRef(appear);
  const [displayed, setDisplayed] = useState({ revision, children });
  const pending = revision !== displayed.revision;
  const attachRef = useCallback((element: HTMLElement | SVGElement | null) => { elementRef.current = element; }, []);

  if (paused === false && !pending && displayed.children !== children) setDisplayed({ revision, children });

  useLayoutEffect(() => {
    latest.current = { revision, children, onExited };
  });

  useLayoutEffect(() => {
    if (paused === null || paused) return;
    const element = elementRef.current;
    const reduced = document.documentElement.dataset.motion === "reduced"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const canAnimate = element && !reduced && typeof element.animate === "function";
    let animation: Animation | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const replace = () => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      reveal.current = true;
      setDisplayed(latest.current);
      if (latest.current.children === null) latest.current.onExited?.();
    };

    if (pending) {
      if (canAnimate) {
        try {
          animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-in", fill: "forwards" });
          animation.onfinish = replace;
          timer = setTimeout(replace, 220);
        } catch { replace(); }
      } else replace();
    } else if (reveal.current) {
      reveal.current = false;
      if (canAnimate) {
        try { animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }); }
        catch { return; }
      }
    }

    return () => {
      active = false;
      clearTimeout(timer);
      animation?.cancel();
    };
  }, [revision, displayed.revision, paused, pending]);

  if (paused === null) return children;
  const content = (pending || paused ? displayed.children : children) as ReactElement<Record<string, unknown>> | null;
  if (!content) return null;
  const Content = content.type as ElementType;
  return <Content {...content.props} ref={attachRef} />;
}

export function CourseEditTransitionList({ children, revisions }: { children: ReactElement[]; revisions?: Record<string, string> }) {
  const paused = useContext(CourseEditTransitionContext);
  const [entries, setEntries] = useState(() => children.map((child) => ({ key: child.key, initial: true })));
  if (paused === null) return <>{children}</>;
  const added = children.filter((child) => !entries.some((entry) => entry.key === child.key));
  if (!paused && added.length) setEntries([...entries, ...added.map((child) => ({ key: child.key, initial: false }))]);

  return entries.map((entry) => {
    const current = children.find((child) => child.key === entry.key) ?? null;
    return <CourseEditTransition key={entry.key} revision={current ? `present:${revisions?.[String(entry.key)] ?? ""}` : "absent"} appear={!entry.initial} onExited={() => setEntries((previous) => previous.filter((item) => item.key !== entry.key))}>{current}</CourseEditTransition>;
  });
}
