import type { CSSProperties } from "react";

export type CourseImageFraming = { fileId: string; x: number; y: number; zoom: number };
export const DEFAULT_COURSE_IMAGE_FRAMING = { x: 50, y: 50, zoom: 1 };
const clampPosition = (value: number) => Math.max(0, Math.min(100, value));

export function courseImageFramingStyle(framing?: CourseImageFraming, fileId?: string): CSSProperties {
  const { x, y, zoom } = framing && (!fileId || framing.fileId === fileId) ? framing : DEFAULT_COURSE_IMAGE_FRAMING;
  const position = `${x}% ${y}%`;
  return { backgroundPosition: position, objectPosition: position, transform: `scale(${zoom})`, transformOrigin: position };
}

export function moveCourseImage(framing: CourseImageFraming, deltaX: number, deltaY: number, width: number, height: number, imageWidth: number, imageHeight: number): CourseImageFraming {
  if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) return framing;
  const scale = Math.max(width / imageWidth, height / imageHeight) * framing.zoom;
  const overflowX = Math.max(0, imageWidth * scale - width);
  const overflowY = Math.max(0, imageHeight * scale - height);
  return { ...framing, x: overflowX > 0 ? clampPosition(framing.x - deltaX / overflowX * 100) : framing.x, y: overflowY > 0 ? clampPosition(framing.y - deltaY / overflowY * 100) : framing.y };
}
