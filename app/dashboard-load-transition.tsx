"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PrivateFile } from "../lib/files";
import CoursesSkeleton from "./courses-skeleton";

type DashboardLoadTransitionProps = {
  ready: boolean;
  imagesListed: boolean;
  imageKeys: string[];
  reducedMotion?: boolean;
  children: (onImageSettled: (key: string) => void, imagesPending: boolean) => ReactNode;
};

export function courseImageLoadKey(file: Pick<PrivateFile, "id" | "content_revision" | "updated_at">): string {
  return JSON.stringify([file.id, file.content_revision, file.updated_at]);
}

export function DashboardLoadTransition({
  ready,
  imagesListed,
  imageKeys,
  reducedMotion = false,
  children,
}: DashboardLoadTransitionProps) {
  const imageVersion = JSON.stringify([...new Set(imageKeys)].sort());
  const currentImageKeys = useMemo(() => new Set(JSON.parse(imageVersion) as string[]), [imageVersion]);
  const [settledImageKeys, setSettledImageKeys] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(true);
  const currentImageKeysRef = useRef(currentImageKeys);
  const [revealedOnce, setRevealedOnce] = useState(false);

  const pendingImages = !imagesListed || [...currentImageKeys].some((key) => !settledImageKeys.has(key));
  const imagesPending = !ready || (!revealedOnce && pendingImages);

  const onImageSettled = useCallback((key: string) => {
    if (!mountedRef.current || !currentImageKeysRef.current.has(key)) return;
    setSettledImageKeys((settled) => {
      if (settled.has(key)) return settled;
      const next = new Set(settled);
      next.add(key);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    currentImageKeysRef.current = currentImageKeys;
  }, [currentImageKeys]);

  useLayoutEffect(() => {
    if (ready && !pendingImages && !revealedOnce) {
      // Latch before paint so later image-list edits never restore the full-page skeleton.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRevealedOnce(true);
    }
  }, [pendingImages, ready, revealedOnce]);

  if (!ready) return <CoursesSkeleton reducedMotion={reducedMotion} />;

  // The callback reads refs only when a later image event invokes it.
  // eslint-disable-next-line react-hooks/refs
  const renderedChildren = children(onImageSettled, imagesPending);
  return <>
    {imagesPending && <CoursesSkeleton reducedMotion={reducedMotion} />}
    {renderedChildren}
  </>;
}

export default DashboardLoadTransition;
