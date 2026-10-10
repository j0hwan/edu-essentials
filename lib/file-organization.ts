import type { PrivateFile } from "./files";

// Persistence contracts shared by the folder browser and authenticated APIs.
export const MAX_DOCUMENT_BYTES = 1_048_576;
export const MAX_ACCOUNT_FILE_RECORDS = 1_000;
export type FileContentBackend = "object" | "native-text";

export type FileFolder = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: "custom" | "course";
  course_id: string | null;
  course_code: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  semester_label: string | null;
  course_name_snapshot: string | null;
  course_color_snapshot: string | null;
  trashed_at: string | null;
  trash_operation_id: string | null;
  original_parent_id: string | null;
  deleted_at?: string | null;
  purge_pending_at?: string | null;
  original_location_path?: string | null;
};

export type OrganizedFile = PrivateFile;

export type FileItemActivity = {
  starred_at: string | null;
  last_opened_at: string | null;
};

export type NativeFileDocument = {
  file_id: string;
  body: string;
};

export type FileItemAction = "move" | "trash" | "restore" | "star" | "unstar" | "open" | "permanent-delete" | "empty-trash";

export function requireNumericRevision(value: unknown, label = "revision"): number {
  if (value === undefined) throw new Error(`Reload the latest saved data before using this ${label}.`);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}.`);
  return value;
}

export function safeFileItemName(value: unknown, maxLength = 255): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\")) {
    throw new Error(`Use a name of 1–${maxLength} characters without path separators.`);
  }
  return value.trim();
}

export function validateDocumentBody(value: unknown): { body: string; bytes: Uint8Array } {
  if (typeof value !== "string" || value.includes("\0")) throw new Error("Document text must be a valid plain-text string.");
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Document text contains invalid Unicode.");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("Document text contains invalid Unicode.");
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("Text documents are limited to 1 MiB of UTF-8 content.");
  return { body: value, bytes };
}
