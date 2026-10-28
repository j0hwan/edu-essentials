"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

type CoursePreviewRevealContextValue = {
  revealed: boolean;
  settle: (participantKey: string) => void;
};

const CoursePreviewRevealContext = createContext<CoursePreviewRevealContextValue | null>(null);
const noop = () => {};

export const MAP_PREVIEW_PLACEHOLDERS = [
  "/preview-placeholders/map-1.png",
  "/preview-placeholders/map-2.png",
] as const;

export const SYLLABUS_PREVIEW_PLACEHOLDER = "/preview-placeholders/syllabus-blurred.png";

export function CoursePreviewRevealProvider({ participants, children }: { participants: string[]; children: ReactNode }) {
  const participantSet = useMemo(() => new Set(participants), [participants]);
  const participantSetRef = useRef(participantSet);
  useLayoutEffect(() => { participantSetRef.current = participantSet; }, [participantSet]);
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());

  const settle = useCallback((participantKey: string) => {
    if (!participantSetRef.current.has(participantKey)) return;
    setSettled((current) => {
      if (current.has(participantKey)) return current;
      const next = new Set(current);
      next.add(participantKey);
      return next;
    });
  }, []);

  const revealed = [...participantSet].every((participantKey) => settled.has(participantKey));
  const value = useMemo(() => ({ revealed, settle }), [revealed, settle]);

  return <CoursePreviewRevealContext.Provider value={value}>{children}</CoursePreviewRevealContext.Provider>;
}

export function useCoursePreviewReveal(participantKey?: string): { revealed: boolean; settle: () => void; coordinated: boolean } {
  const context = useContext(CoursePreviewRevealContext);
  const contextSettle = context?.settle;
  const settle = useCallback(() => {
    if (participantKey !== undefined) contextSettle?.(participantKey);
  }, [contextSettle, participantKey]);

  return context
    ? { revealed: context.revealed, settle, coordinated: true }
    : { revealed: true, settle: noop, coordinated: false };
}

function useStableMapPlaceholder(enabled: boolean): string | undefined {
  const [mapPlaceholder, setMapPlaceholder] = useState<string>(MAP_PREVIEW_PLACEHOLDERS[0]);
  const choseMapPlaceholder = useRef(false);

  useLayoutEffect(() => {
    if (!enabled || choseMapPlaceholder.current) return;
    choseMapPlaceholder.current = true;
    setMapPlaceholder(MAP_PREVIEW_PLACEHOLDERS[Math.floor(Math.random() * MAP_PREVIEW_PLACEHOLDERS.length)]);
  }, [enabled]);

  return enabled ? mapPlaceholder : undefined;
}

export function useMapPreviewPlaceholder(enabled: boolean): string | undefined {
  return useStableMapPlaceholder(enabled);
}

/* eslint-disable @next/next/no-img-element -- these are local decorative placeholders. */
export function CoursePreviewPlaceholder({ kind, src }: { kind: "map" | "syllabus"; src?: string }) {
  const localMapPlaceholder = useStableMapPlaceholder(kind === "map" && src === undefined);

  const placeholderSrc = kind === "map" ? src ?? localMapPlaceholder ?? MAP_PREVIEW_PLACEHOLDERS[0] : SYLLABUS_PREVIEW_PLACEHOLDER;

  return <img className="course-preview-placeholder" src={placeholderSrc} alt="" aria-hidden="true" />;
}
/* eslint-enable @next/next/no-img-element */
