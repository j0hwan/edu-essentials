"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { courseImageFramingStyle, type CourseImageFraming } from "../lib/course-image-framing";

const layoutUpdates = new WeakMap<Element, () => void>();

export function refreshCourseImageFrames(root: HTMLElement) {
  for (const frame of root.querySelectorAll(".course-image-frame")) layoutUpdates.get(frame)?.();
}

export default function CourseImageFrame({ framing, fileId, courseId, expanded, children }: { framing?: CourseImageFraming; fileId?: string; courseId: string; expanded: boolean; children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const container = frame?.parentElement;
    if (!frame || !container) return;
    Object.assign(frame.style, courseImageFramingStyle(framing, fileId, expanded));
    if (!expanded) return;
    const update = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const source = Array.from(document.querySelectorAll<HTMLElement>("[data-course-card-id]"))
        .find((card) => card.dataset.courseCardId === courseId)?.querySelector<HTMLElement>(".class-card-media");
      const image = [source?.querySelector("img"), ...frame.querySelectorAll("img")]
        .find((candidate) => candidate && candidate.naturalWidth > 0 && candidate.naturalHeight > 0);
      const measuredFraming = framing && (!fileId || framing.fileId === fileId) ? {
        ...framing,
        imageAspectRatio: framing.imageAspectRatio ?? (image?.naturalHeight ? image.naturalWidth / image.naturalHeight : undefined),
        frameAspectRatio: framing.frameAspectRatio ?? (source?.clientHeight ? source.clientWidth / source.clientHeight : undefined),
      } : framing;
      Object.assign(frame.style, courseImageFramingStyle(measuredFraming, fileId, true, width / height));
    };
    layoutUpdates.set(frame, update);
    update();
    frame.addEventListener("load", update, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      layoutUpdates.delete(frame);
      frame.removeEventListener("load", update, true);
    };
  }, [framing, fileId, courseId, expanded]);
  return <div ref={frameRef} className="course-image-frame" style={courseImageFramingStyle(framing, fileId, expanded)}>{children}</div>;
}
