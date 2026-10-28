"use client";

import { useLayoutEffect, useRef, type FocusEventHandler, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { createCourseExpansionProgressFrames, COURSE_EXPANSION_MOTION_DURATION_MS, COURSE_EXPANSION_MOTION_EASING } from "../lib/course-expansion-motion";

type Props = {
  formRef: RefObject<HTMLFormElement | null>;
  open: boolean;
  reducedMotion: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onBlur: FocusEventHandler<HTMLFormElement>;
  children: ReactNode;
  results: ReactNode;
};

export default function TopbarSearch({ formRef, open, reducedMotion, onSubmit, onBlur, children, results }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const destinationRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const form = formRef.current;
    const row = rowRef.current;
    const region = resultsRef.current;
    if (!form || !row || !region) return;
    const resize = () => {
      const styles = window.getComputedStyle(form);
      const borderHeight = (Number.parseFloat(styles.borderTopWidth) || 0) + (Number.parseFloat(styles.borderBottomWidth) || 0);
      const collapsedHeight = row.getBoundingClientRect().height + borderHeight;
      const destination = collapsedHeight + (open ? region.getBoundingClientRect().height : 0);
      const skipMotion = reducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        || typeof form.animate !== "function";
      if (destinationRef.current === destination && !skipMotion) return;
      const currentHeight = form.getBoundingClientRect().height;
      const initialized = destinationRef.current !== null;
      animationRef.current?.cancel();
      animationRef.current = null;
      destinationRef.current = destination;
      form.style.height = `${destination}px`;
      if (!initialized || skipMotion || Math.abs(currentHeight - destination) < 1) return;
      const animation = form.animate(createCourseExpansionProgressFrames().map(({ offset, progress }) => ({
        offset,
        height: `${Math.max(collapsedHeight, currentHeight + (destination - currentHeight) * progress)}px`,
      })), { duration: COURSE_EXPANSION_MOTION_DURATION_MS, easing: COURSE_EXPANSION_MOTION_EASING });
      animationRef.current = animation;
      animation.onfinish = () => {
        if (animationRef.current !== animation) return;
        animationRef.current = null;
        animation.cancel();
      };
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(row);
    observer?.observe(region);
    return () => observer?.disconnect();
  });

  useLayoutEffect(() => () => {
    animationRef.current?.cancel();
    animationRef.current = null;
    destinationRef.current = null;
  }, []);

  return <div className="topbar-search-slot">
    <form ref={formRef} className="topbar-search" role="search" onSubmit={onSubmit} onBlur={onBlur}>
      <div ref={rowRef} className="topbar-search-row">{children}</div>
      <div ref={resultsRef} className="topbar-search-expansion">{results}</div>
    </form>
  </div>;
}
