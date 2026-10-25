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

  useLayoutEffect(() => {
    const form = formRef.current;
    const row = rowRef.current;
    const region = resultsRef.current;
    if (!open || !form || !row || !region || reducedMotion
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      || typeof form.animate !== "function") return;
    const styles = window.getComputedStyle(form);
    const borderHeight = Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
    const collapsedHeight = row.getBoundingClientRect().height + borderHeight;
    const targetHeight = () => row.getBoundingClientRect().height + region.getBoundingClientRect().height + borderHeight;
    let destination = targetHeight();
    let active = true;
    const started = performance.now();
    let animation = form.animate(createCourseExpansionProgressFrames().map(({ offset, progress }) => ({
      offset,
      height: `${Math.max(collapsedHeight, collapsedHeight + (destination - collapsedHeight) * progress)}px`,
    })), { duration: COURSE_EXPANSION_MOTION_DURATION_MS, easing: COURSE_EXPANSION_MOTION_EASING });
    animation.onfinish = () => { active = false; };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      const nextHeight = targetHeight();
      if (!active || Math.abs(nextHeight - destination) < 1) return;
      const currentHeight = form.getBoundingClientRect().height;
      animation.cancel();
      destination = nextHeight;
      animation = form.animate([{ height: `${currentHeight}px` }, { height: `${destination}px` }], {
        duration: Math.max(80, COURSE_EXPANSION_MOTION_DURATION_MS - (performance.now() - started)),
        easing: "ease-out",
      });
      animation.onfinish = () => { active = false; };
    }) : null;
    observer?.observe(region);
    return () => { observer?.disconnect(); animation.cancel(); };
  }, [formRef, open, reducedMotion]);

  return <div className="topbar-search-slot">
    <form ref={formRef} className="topbar-search" role="search" onSubmit={onSubmit} onBlur={onBlur}>
      <div ref={rowRef} className="topbar-search-row">{children}</div>
      <div ref={resultsRef} className="topbar-search-expansion">{results}</div>
    </form>
  </div>;
}
