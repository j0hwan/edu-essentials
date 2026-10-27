import type { CSSProperties } from "react";

export type CourseImageFraming = { fileId: string; x: number; y: number; zoom: number; imageAspectRatio?: number; frameAspectRatio?: number };
export const DEFAULT_COURSE_IMAGE_FRAMING = { x: 50, y: 50, zoom: 1 };
const clampPosition = (value: number) => Math.max(0, Math.min(100, value));

export function expandedCourseImageY(positionY: number, zoom: number, imageAspectRatio: number, sourceAspectRatio: number, targetAspectRatio: number): number {
  if (![imageAspectRatio, sourceAspectRatio, targetAspectRatio].every((ratio) => Number.isFinite(ratio) && ratio > 0)) return positionY;
  const sourceHeight = Math.max(1, sourceAspectRatio / imageAspectRatio) * zoom;
  const targetHeight = Math.max(1, targetAspectRatio / imageAspectRatio);
  const center = 0.5 + (positionY / 100 - 0.5) * (1 - 1 / sourceHeight);
  return targetHeight <= 1 ? 50 : clampPosition((0.5 + (center - 0.5) / (1 - 1 / targetHeight)) * 100);
}

export function courseImageFramingStyle(framing?: CourseImageFraming, fileId?: string, expanded = false, targetAspectRatio?: number): CSSProperties {
  const { x, y, zoom } = framing && (!fileId || framing.fileId === fileId) ? framing : DEFAULT_COURSE_IMAGE_FRAMING;
  const expandedY = expanded && targetAspectRatio && framing?.imageAspectRatio && framing.frameAspectRatio && (!fileId || framing.fileId === fileId)
    ? expandedCourseImageY(y, zoom, framing.imageAspectRatio, framing.frameAspectRatio, targetAspectRatio) : y;
  const position = `${x}% ${expandedY}%`;
  const displayZoom = expanded ? 1 : zoom;
  return { backgroundPosition: position, objectPosition: position, transform: `scale(${displayZoom})`, transformOrigin: position };
}

export function moveCourseImage(framing: CourseImageFraming, deltaX: number, deltaY: number, width: number, height: number, imageWidth: number, imageHeight: number): CourseImageFraming {
  if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) return framing;
  const scale = Math.max(width / imageWidth, height / imageHeight) * framing.zoom;
  const overflowX = Math.max(0, imageWidth * scale - width);
  const overflowY = Math.max(0, imageHeight * scale - height);
  return { ...framing, x: overflowX > 0 ? clampPosition(framing.x - deltaX / overflowX * 100) : framing.x, y: overflowY > 0 ? clampPosition(framing.y - deltaY / overflowY * 100) : framing.y };
}
