import { isFileId, type PrivateFile } from "./files";
import {
  actionItems,
  BrowserOrganizationFailure,
  parseFile,
  parseFolder,
  requestOrganization,
  type BrowserActionItem,
} from "./files-browser-operations";
import {
  requireNumericRevision,
  safeFileItemName,
  type FileFolder,
  type FileItemActivity,
} from "./file-organization";
import type { BrowserItem } from "./files-browser";

export type FilesBrowserRequestOptions = { signal?: AbortSignal };

function fail(message: string, kind: "conflict" | "session-error" | "request-error" = "request-error"): never {
  throw new BrowserOrganizationFailure(message, kind);
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(message, "conflict");
  return value as Record<string, unknown>;
}

function requireProfile(profileId: string) {
  if (!isFileId(profileId)) return fail("The signed-in account is unavailable. Sign in again before changing Files.", "session-error");
}

function requireItemId(id: unknown, label: string): string {
  if (typeof id !== "string" || !isFileId(id)) return fail("The " + label + " is invalid.");
  return id;
}

function requireRevision(value: unknown, label: string) {
  try {
    return requireNumericRevision(value, label);
  } catch {
    return fail("Reload the latest saved data before changing this " + label + ".", "conflict");
  }
}

function checkedActionItem(item: BrowserItem): BrowserActionItem {
  if (!item || (item.type !== "file" && item.type !== "folder")) return fail("The selected item is invalid.");
  const id = requireItemId(item.id, "item ID");
  const nestedId = item.type === "file" ? item.file?.id : item.folder?.id;
  if (nestedId !== id) return fail("The selected item is invalid. Reload Files before continuing.", "conflict");
  const selected = actionItems([item]);
  if (selected.length !== 1 || selected[0].id !== id || selected[0].type !== item.type) {
    return fail("The selected item is invalid. Reload Files before continuing.", "conflict");
  }
  requireRevision(selected[0].revision, item.type + " revision");
  return selected[0];
}

function ensureActivityEligible(item: BrowserItem, action: "star" | "unstar" | "open") {
  if (item.type === "file") {
    const file = item.file as PrivateFile & { purge_pending_at?: string | null };
    if (file.trashed_at !== null || file.deleted_at != null || file.purge_pending_at != null) {
      return fail("Trashed or deleted files cannot be changed.", "conflict");
    }
    if (action === "open" && file.state !== "ready") return fail("Only ready files can be opened.", "conflict");
    if (action !== "open" && file.state === "deleting") return fail("This file is being deleted.", "conflict");
    return;
  }
  const folder = item.folder;
  if (folder.trashed_at !== null || folder.deleted_at != null || folder.purge_pending_at != null) {
    return fail("Trashed or deleted folders cannot be changed.", "conflict");
  }
}

function parseActivityTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
    return fail("The server returned an invalid " + label + ".", "conflict");
  }
  return value;
}

function parseActivity(
  value: unknown,
  profileId: string,
  item: BrowserItem,
  action: "star" | "unstar" | "open",
): FileItemActivity {
  const record = objectRecord(value, "The server returned invalid item activity.");
  const key = item.type === "file" ? "file_id" : "folder_id";
  if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] !== item.id || !isFileId(record[key])) {
    return fail("The server activity did not match the selected item.", "conflict");
  }
  if (record.profile_id !== undefined && record.profile_id !== profileId) {
    return fail("The activity belongs to a different signed-in account.", "session-error");
  }
  if (!Object.prototype.hasOwnProperty.call(record, "starred_at") ||
      !Object.prototype.hasOwnProperty.call(record, "last_opened_at")) {
    return fail("The server returned incomplete item activity.", "conflict");
  }
  const activity = {
    starred_at: parseActivityTimestamp(record.starred_at, "star date"),
    last_opened_at: parseActivityTimestamp(record.last_opened_at, "last-opened date"),
  };
  if (action === "star" && activity.starred_at === null) {
    return fail("The server did not confirm the star action.", "conflict");
  }
  if (action === "unstar" && activity.starred_at !== null) {
    return fail("The server did not confirm the unstar action.", "conflict");
  }
  if (action === "open" && activity.last_opened_at === null) {
    return fail("The server did not confirm the open action.", "conflict");
  }
  return activity;
}

function assertSameFile(before: PrivateFile, after: PrivateFile): void {
  const fields: (keyof PrivateFile)[] = [
    "id", "name", "mime_type", "size_bytes", "course_id", "assignment_id", "kind", "state",
    "created_at", "updated_at", "content_sha256", "folder_id", "content_backend",
    "metadata_revision", "content_revision", "trashed_at", "trash_operation_id",
    "original_folder_id", "original_location_path", "deleted_at",
  ];
  if (fields.some((field) => before[field] !== after[field])) {
    return fail("The activity response changed saved file data. Reload Files before continuing.", "conflict");
  }
}

function assertSameFolder(before: FileFolder, after: FileFolder): void {
  const fields: (keyof FileFolder)[] = [
    "id", "parent_id", "name", "kind", "course_id", "course_code", "revision", "created_at",
    "updated_at", "archived_at", "semester_label", "course_name_snapshot", "course_color_snapshot",
    "trashed_at", "trash_operation_id", "original_parent_id", "deleted_at", "purge_pending_at",
    "original_location_path",
  ];
  if (fields.some((field) => before[field] !== after[field])) {
    return fail("The activity response changed saved folder data. Reload Files before continuing.", "conflict");
  }
}

function assertOptionalActionRows(payload: Record<string, unknown>, profileId: string, item: BrowserItem): void {
  // The current server includes file/folder rows for activity actions. Accept an
  // activity-only response too, while checking any rows that are present.
  const filesValue = payload.files;
  const foldersValue = payload.folders;
  if (filesValue !== undefined && !Array.isArray(filesValue)) return fail("The server returned invalid activity file data.", "conflict");
  if (foldersValue !== undefined && !Array.isArray(foldersValue)) return fail("The server returned invalid activity folder data.", "conflict");
  const files = (filesValue ?? []) as unknown[];
  const folders = (foldersValue ?? []) as unknown[];

  if (item.type === "file") {
    if (folders.length !== 0) return fail("The server returned an unexpected folder for file activity.", "conflict");
    if (files.length > 1) return fail("The server returned duplicate file activity data.", "conflict");
    if (files.length === 1) {
      const file = parseFile(files[0], profileId, item.id);
      assertSameFile(item.file, file);
    }
  } else {
    if (files.length !== 0) return fail("The server returned an unexpected file for folder activity.", "conflict");
    if (folders.length > 1) return fail("The server returned duplicate folder activity data.", "conflict");
    if (folders.length === 1) {
      const folder = parseFolder(folders[0], profileId, item.id);
      assertSameFolder(item.folder, folder);
    }
  }
}

async function mutateActivity(
  profileId: string,
  item: BrowserItem,
  action: "star" | "unstar" | "open",
  options: FilesBrowserRequestOptions = {},
): Promise<{ activity: FileItemActivity }> {
  requireProfile(profileId);
  const selected = checkedActionItem(item);
  ensureActivityEligible(item, action);
  const payload = objectRecord(await requestOrganization(profileId, "/api/files/actions", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, items: [selected] }),
  }), "The server returned invalid item activity.");
  const activities = objectRecord(payload.activities, "The server returned incomplete item activity.");
  const key = item.type === "file" ? "files" : "folders";
  const otherKey = item.type === "file" ? "folders" : "files";
  if (!Array.isArray(activities[key]) || (activities[otherKey] !== undefined &&
      (!Array.isArray(activities[otherKey]) || activities[otherKey].length !== 0))) {
    return fail("The server returned incomplete item activity.", "conflict");
  }
  const rows = activities[key] as unknown[];
  if (rows.length !== 1) return fail("The server did not confirm exactly the selected item activity.", "conflict");
  const activity = parseActivity(rows[0], profileId, item, action);
  assertOptionalActionRows(payload, profileId, item);
  return { activity };
}

export function setBrowserItemStarred(
  profileId: string,
  item: BrowserItem,
  starred: boolean,
  options: FilesBrowserRequestOptions = {},
): Promise<{ activity: FileItemActivity }> {
  return mutateActivity(profileId, item, starred ? "star" : "unstar", options);
}

export function recordFileOpened(
  profileId: string,
  file: PrivateFile,
  options: FilesBrowserRequestOptions = {},
): Promise<{ activity: FileItemActivity }> {
  return mutateActivity(profileId, { type: "file", id: file.id, file }, "open", options);
}

function assertMutableArchiveRoot(folder: FileFolder, action: "archive" | "unarchive"): void {
  if (!folder || !isFileId(folder.id)) return fail("The selected folder is invalid.");
  requireRevision(folder.revision, "folder revision");
  if (folder.parent_id !== null || folder.trashed_at !== null || folder.trash_operation_id !== null ||
      folder.deleted_at != null || folder.purge_pending_at != null || folder.original_parent_id !== null) {
    return fail("Only an available top-level folder can be archived.", "conflict");
  }
  if ((folder.kind !== "custom" && folder.kind !== "course") ||
      (folder.kind === "custom" && folder.course_id !== null) ||
      (folder.kind === "course" && folder.course_id === null)) {
    return fail("The selected folder has invalid course ownership.", "conflict");
  }
  if ((action === "archive" && folder.archived_at !== null) ||
      (action === "unarchive" && folder.archived_at === null)) {
    return fail(action === "archive" ? "This folder is already archived." : "This folder is no longer archived.", "conflict");
  }
}

function assertSameArchiveIdentity(before: FileFolder, after: FileFolder): void {
  if (after.id !== before.id || after.parent_id !== null || after.name !== before.name ||
      after.kind !== before.kind || after.course_id !== before.course_id ||
      after.course_code !== before.course_code || after.created_at !== before.created_at ||
      after.revision <= before.revision || after.trashed_at !== null ||
      after.trash_operation_id !== null || after.original_parent_id !== null ||
      after.deleted_at != null || after.purge_pending_at != null) {
    return fail("The archive result did not match the saved folder. Reload Files before continuing.", "conflict");
  }
}

export async function archiveFolder(
  profileId: string,
  folder: FileFolder,
  label: string,
  options: FilesBrowserRequestOptions = {},
): Promise<FileFolder> {
  requireProfile(profileId);
  assertMutableArchiveRoot(folder, "archive");
  let semesterLabel: string;
  try {
    semesterLabel = safeFileItemName(label, 120);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Enter a valid archive label.");
  }
  const payload = await requestOrganization(profileId, "/api/file-folders", {
    method: "PUT",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "archive", id: folder.id, revision: folder.revision, semesterLabel }),
  });
  const record = objectRecord(payload, "The server returned invalid archive data.");
  const result = parseFolder(record.folder, profileId, folder.id);
  assertSameArchiveIdentity(folder, result);
  if (!result.archived_at || !Number.isFinite(Date.parse(result.archived_at)) || result.semester_label !== semesterLabel) {
    return fail("The server did not confirm the archive label. Reload Files before continuing.", "conflict");
  }
  if (result.kind === "course"
      ? !result.course_name_snapshot?.trim() || (result.course_color_snapshot !== null && result.course_color_snapshot.length > 64)
      : result.course_name_snapshot !== null || result.course_color_snapshot !== null) {
    return fail("The server returned invalid archive display snapshots. Reload Files before continuing.", "conflict");
  }
  return result;
}

export async function unarchiveFolder(
  profileId: string,
  folder: FileFolder,
  options: FilesBrowserRequestOptions = {},
): Promise<FileFolder> {
  requireProfile(profileId);
  assertMutableArchiveRoot(folder, "unarchive");
  const payload = await requestOrganization(profileId, "/api/file-folders", {
    method: "PUT",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "unarchive", id: folder.id, revision: folder.revision }),
  });
  const record = objectRecord(payload, "The server returned invalid unarchive data.");
  const result = parseFolder(record.folder, profileId, folder.id);
  assertSameArchiveIdentity(folder, result);
  if (result.archived_at !== null || result.semester_label !== null ||
      result.course_name_snapshot !== null || result.course_color_snapshot !== null) {
    return fail("The server did not confirm that the folder was unarchived. Reload Files before continuing.", "conflict");
  }
  return result;
}
