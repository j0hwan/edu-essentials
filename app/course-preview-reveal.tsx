"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAP_PREVIEW_PLACEHOLDERS, SYLLABUS_PREVIEW_PLACEHOLDER } from "../lib/course-preview-placeholders";

export { MAP_PREVIEW_PLACEHOLDERS, SYLLABUS_PREVIEW_PLACEHOLDER };

type CoursePreviewRevealContextValue = {
  revealed: boolean;
  settle: (participantKey: string) => void;
};

const CoursePreviewRevealContext = createContext<CoursePreviewRevealContextValue | null>(null);
const noop = () => {};

export function CoursePreviewRevealProvider({ participants, children }: { participants: string[]; children: ReactNode }) {
  const participantVersion = JSON.stringify([...new Set(participants)].sort());
  const group = useMemo(() => ({ participants: new Set(JSON.parse(participantVersion) as string[]) }), [participantVersion]);
  const [state, setState] = useState<{ group: typeof group; settled: ReadonlySet<string> }>(() => ({ group, settled: new Set() }));
  if (state.group !== group) {
    setState({ group, settled: new Set([...state.settled].filter((key) => group.participants.has(key))) });
  }

  const settle = useCallback((participantKey: string) => {
    if (!group.participants.has(participantKey)) return;
    setState((current) => {
      if (current.group !== group || current.settled.has(participantKey)) return current;
      const next = new Set(current.settled);
      next.add(participantKey);
      return { group, settled: next };
    });
  }, [group]);

  const revealed = [...group.participants].every((participantKey) => state.settled.has(participantKey));
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

  return <img className="course-preview-placeholder" src={placeholderSrc} alt="" aria-hidden="true" loading="eager" />;
}
/* eslint-enable @next/next/no-img-element */
