"use client";
/* eslint-disable @next/next/no-img-element -- The cached thumbnail and authenticated image use private local/blob URLs. */
import { useCallback, useLayoutEffect, useRef } from "react";
import { clearCourseImageThumbnail, matchesCourseImageThumbnail, readCourseImageThumbnail, writeCourseImageThumbnail } from "../lib/course-image-thumbnail";
import type { PrivateFile } from "../lib/files";
import { PrivateImage } from "./private-files";
import type { FileStore } from "./use-private-files";
import { useCoursePreviewReveal } from "./course-preview-reveal";

type Props = {
  profileId: string;
  courseId: string;
  file: PrivateFile | undefined;
  store: FileStore;
  filesReady: boolean;
  restored: boolean;
  cacheEnabled?: boolean;
  previewKey?: string;
};

type ActiveImage = {
  scope: string;
  profileId: string;
  courseId: string;
  file?: PrivateFile;
  cacheEnabled: boolean;
  mounted: boolean;
};

function scopeKey(profileId: string, courseId: string) {
  return `${profileId}\u001f${courseId}`;
}

function isReadyCourseImage(file: PrivateFile | undefined, courseId: string): file is PrivateFile {
  return Boolean(file
    && file.course_id === courseId
    && file.kind === "class-image"
    && file.state === "ready"
    && !file.trashed_at
    && !file.deleted_at
    && file.mime_type.startsWith("image/"));
}

export default function ExpandedCourseImage({ profileId, courseId, file, store, filesReady, restored, cacheEnabled = true, previewKey }: Props) {
  const { revealed, settle, coordinated } = useCoursePreviewReveal(previewKey);
  const coordinateReveal = restored && previewKey !== undefined && coordinated;
  const scope = scopeKey(profileId, courseId);
  const thumbnail = cacheEnabled ? readCourseImageThumbnail(profileId, courseId) : null;
  const readyFile = isReadyCourseImage(file, courseId) ? file : undefined;
  useLayoutEffect(() => {
    if (coordinateReveal && filesReady && !readyFile) settle();
  }, [coordinateReveal, filesReady, readyFile, settle]);
  const matchesCurrentFile = Boolean(thumbnail
    && isReadyCourseImage(file, courseId)
    && matchesCourseImageThumbnail(thumbnail, file));
  const showThumbnail = Boolean(restored
    && cacheEnabled
    && thumbnail?.courseId === courseId
    && (file ? matchesCurrentFile : !filesReady));

  useLayoutEffect(() => {
    if (!thumbnail) return;
    const stale = file ? !matchesCurrentFile : filesReady;
    if (!stale) return;
    clearCourseImageThumbnail(profileId, courseId);
  }, [thumbnail, file, filesReady, matchesCurrentFile, profileId, courseId]);

  const activeImageRef = useRef<ActiveImage>({ scope, profileId, courseId, file: readyFile, cacheEnabled, mounted: true });
  useLayoutEffect(() => {
    activeImageRef.current = { ...activeImageRef.current, scope, profileId, courseId, file: readyFile, cacheEnabled };
  }, [scope, profileId, courseId, readyFile, cacheEnabled]);
  useLayoutEffect(() => {
    activeImageRef.current.mounted = true;
    return () => { activeImageRef.current.mounted = false; };
  }, []);

  const saveThumbnail = useCallback((image: HTMLImageElement) => {
    const active = activeImageRef.current;
    if (!active.mounted || !active.cacheEnabled || !active.file) return;
    writeCourseImageThumbnail(active.profileId, active.courseId, active.file, image);
  }, []);

  const fullImage = readyFile && <PrivateImage file={readyFile} store={store} fadeIn={restored && !coordinateReveal} onDecoded={cacheEnabled ? saveThumbnail : undefined} onSettled={coordinateReveal ? settle : undefined} />;

  return <>
    {showThumbnail && <img className="private-class-image-thumbnail" src={thumbnail!.dataUrl} alt="" aria-hidden="true" />}
    {coordinateReveal
      ? <div className={`expanded-course-image-reveal private-class-image private-class-image-fade${revealed ? " is-ready" : ""}`}>{fullImage}</div>
      : fullImage}
  </>;
}
