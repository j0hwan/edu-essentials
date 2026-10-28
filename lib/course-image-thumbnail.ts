import type { PrivateFile } from "./files";

export type CourseImageThumbnail = {
  version: 1;
  courseId: string;
  fileId: string;
  contentRevision: number;
  updatedAt: string;
  dataUrl: string;
  width: number;
  height: number;
};

const THUMBNAIL_KEY_PREFIX = "edu-dashboard-course-thumbnail:";
const MAX_THUMBNAIL_DATA_URL_LENGTH = 16 * 1024;
const MAX_STORED_VALUE_LENGTH = MAX_THUMBNAIL_DATA_URL_LENGTH + 1024;
const MAX_THUMBNAIL_DIMENSION = 32;
const JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,";

type CourseImageFileRevision = Pick<PrivateFile, "id" | "content_revision" | "updated_at">;

function thumbnailStorageKey(profileId: string): string {
  return `${THUMBNAIL_KEY_PREFIX}${profileId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJpegDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_THUMBNAIL_DATA_URL_LENGTH || !value.startsWith(JPEG_DATA_URL_PREFIX)) return false;
  const payload = value.slice(JPEG_DATA_URL_PREFIX.length);
  return payload.length > 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload);
}

function isCourseImageThumbnail(value: unknown): value is CourseImageThumbnail {
  if (!isRecord(value)) return false;
  const dataUrl = value.dataUrl;
  return Object.keys(value).every((key) => ["version", "courseId", "fileId", "contentRevision", "updatedAt", "dataUrl", "width", "height"].includes(key))
    && value.version === 1
    && typeof value.courseId === "string"
    && value.courseId.length > 0
    && typeof value.fileId === "string"
    && value.fileId.length > 0
    && typeof value.contentRevision === "number"
    && Number.isInteger(value.contentRevision)
    && value.contentRevision >= 0
    && typeof value.updatedAt === "string"
    && isJpegDataUrl(dataUrl)
    && Number.isInteger(value.width)
    && Number.isInteger(value.height)
    && Number(value.width) >= 1
    && Number(value.width) <= MAX_THUMBNAIL_DIMENSION
    && Number(value.height) >= 1
    && Number(value.height) <= MAX_THUMBNAIL_DIMENSION;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function courseIsExpanded(storage: Storage, profileId: string, courseId: string): boolean {
  try {
    return storage.getItem(courseExpansionStorageKey(profileId)) === courseId;
  } catch {
    return false;
  }
}

/** The local-storage key used to remember the course currently expanded on the dashboard. */
export function courseExpansionStorageKey(profileId: string): string {
  return `edu-dashboard-expanded-course:${profileId}`;
}

/** Read this account's small image snapshot only when it belongs to the requested course. */
export function readCourseImageThumbnail(profileId: string, courseId: string): CourseImageThumbnail | null {
  if (!profileId || !courseId) return null;
  const storage = getStorage();
  if (!storage) return null;

  let stored: string | null;
  try {
    stored = storage.getItem(thumbnailStorageKey(profileId));
  } catch {
    return null;
  }
  if (stored === null || stored.length > MAX_STORED_VALUE_LENGTH) return null;

  try {
    const value: unknown = JSON.parse(stored);
    return isCourseImageThumbnail(value) && value.courseId === courseId ? value : null;
  } catch {
    return null;
  }
}

/** Remove one account's snapshot, or remove it only when it belongs to a given course. */
export function clearCourseImageThumbnail(profileId: string, courseId?: string): void {
  if (!profileId) return;
  const storage = getStorage();
  if (!storage) return;

  const key = thumbnailStorageKey(profileId);
  if (courseId !== undefined) {
    const cached = readCourseImageThumbnail(profileId, courseId);
    if (!cached) return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Browser storage can be unavailable or full; cache cleanup is best-effort.
  }
}

/** Compare a cached thumbnail with the current file revision. */
export function matchesCourseImageThumbnail(
  record: CourseImageThumbnail | null | undefined,
  file: CourseImageFileRevision,
): boolean {
  return Boolean(record
    && record.fileId === file.id
    && record.contentRevision === file.content_revision
    && record.updatedAt === file.updated_at);
}

/** Create a tiny account-local JPEG snapshot, but only while its course is still expanded. */
export function writeCourseImageThumbnail(
  profileId: string,
  courseId: string,
  file: CourseImageFileRevision,
  image: HTMLImageElement,
): CourseImageThumbnail | null {
  if (!profileId || !courseId || !file.id || !Number.isInteger(file.content_revision) || file.content_revision < 0
    || typeof file.updated_at !== "string") return null;

  try {
    const storage = getStorage();
    if (!storage || !courseIsExpanded(storage, profileId, courseId)) return null;

    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0
      || typeof document === "undefined") return null;

    const scale = Math.min(1, MAX_THUMBNAIL_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.min(MAX_THUMBNAIL_DIMENSION, Math.round(sourceWidth * scale)));
    const height = Math.max(1, Math.min(MAX_THUMBNAIL_DIMENSION, Math.round(sourceHeight * scale)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.35);
    if (!isJpegDataUrl(dataUrl)) return null;

    const record: CourseImageThumbnail = {
      version: 1,
      courseId,
      fileId: file.id,
      contentRevision: file.content_revision,
      updatedAt: file.updated_at,
      dataUrl,
      width,
      height,
    };

    // Recheck after canvas work so a close during image decode/encoding cannot repopulate the cache.
    if (!courseIsExpanded(storage, profileId, courseId)) return null;
    const serialized = JSON.stringify(record);
    if (serialized.length > MAX_STORED_VALUE_LENGTH) return null;
    storage.setItem(thumbnailStorageKey(profileId), serialized);
    return record;
  } catch {
    // Canvas, serialization, and browser-storage failures must not affect the dashboard.
    return null;
  }
}
