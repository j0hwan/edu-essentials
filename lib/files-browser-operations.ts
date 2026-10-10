import { isFileId, fileKinds, type PrivateFile } from "./files";
import type { BrowserItem } from "./files-browser";
import {
  requireNumericRevision,
  safeFileItemName,
  type FileFolder,
} from "./file-organization";

export type BrowserActionItem = { type: "file" | "folder"; id: string; revision: number };
export type BrowserOrganizationFailureKind = "conflict" | "session-error" | "request-error";

export class BrowserOrganizationFailure extends Error {
  constructor(message: string, public kind: BrowserOrganizationFailureKind = "request-error") {
    super(message);
    this.name = "BrowserOrganizationFailure";
  }
}

const UUID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const REQUEST_TIMEOUT_MS = 120_000;
const PROFILE_KEYS = ["profile_id", "profileId", "account_id", "accountId", "owner_id", "ownerId", "user_id", "userId"] as const;

function byFolderId(folders: readonly FileFolder[]): Map<string, FileFolder> | null {
  const result = new Map<string, FileFolder>();
  for (const folder of folders) {
    if (result.has(folder.id)) return null;
    result.set(folder.id, folder);
  }
  return result;
}

type FolderPathState = "active" | "archived" | "trash" | "missing" | "cycle" | "invalid";

function folderPathState(startId: string, foldersById: ReadonlyMap<string, FileFolder>): FolderPathState {
  const visited = new Set<string>();
  let currentId: string | null = startId;
  while (currentId !== null) {
    if (typeof currentId !== "string" || !currentId) return "invalid";
    if (visited.has(currentId)) return "cycle";
    visited.add(currentId);
    const current = foldersById.get(currentId);
    if (!current) return "missing";
    if (current.trashed_at !== null) return "trash";
    if (current.archived_at !== null) return "archived";
    if (current.parent_id !== null && (typeof current.parent_id !== "string" || !current.parent_id)) return "invalid";
    currentId = current.parent_id;
  }
  return "active";
}

export function actionItems(items: readonly BrowserItem[]): BrowserActionItem[] {
  const seen = new Set<string>();
  const result: BrowserActionItem[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      type: item.type,
      id: item.id,
      revision: item.type === "file" ? item.file.metadata_revision : item.folder.revision,
    });
  }
  return result;
}

export function deduplicateMoveItems(items: readonly BrowserItem[], folders: readonly FileFolder[]): BrowserItem[] {
  const foldersById = byFolderId(folders);
  const selectedFolders = new Set(items.filter((item) => item.type === "folder").map((item) => item.id));
  const seenItems = new Set<string>();
  const result: BrowserItem[] = [];

  for (const item of items) {
    const key = `${item.type}:${item.id}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);

    let parentId = item.type === "file" ? item.file.folder_id : item.folder.parent_id;
    const visited = new Set<string>();
    let covered = false;
    while (parentId !== null && !visited.has(parentId)) {
      if (selectedFolders.has(parentId)) {
        covered = true;
        break;
      }
      visited.add(parentId);
      const parent = foldersById?.get(parentId);
      if (!parent) break;
      parentId = parent.parent_id;
    }
    if (!covered) result.push(item);
  }
  return result;
}

export function folderCourseId(folderId: string | null, folders: readonly FileFolder[]): string {
  if (folderId === null) return "";
  const foldersById = byFolderId(folders);
  if (!foldersById) return "";
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const current = foldersById.get(currentId);
    if (!current) return "";
    if (current.kind === "course" && typeof current.course_id === "string") return current.course_id;
    currentId = current.parent_id;
  }
  return "";
}

export function folderDestinationReason(folderId: string | null, folders: readonly FileFolder[]): string {
  if (folderId === null) return "";
  if (typeof folderId !== "string" || !folderId) return "Choose a valid destination folder.";
  const foldersById = byFolderId(folders);
  if (!foldersById) return "The folder hierarchy is invalid. Reload Files before continuing.";
  switch (folderPathState(folderId, foldersById)) {
    case "active": return "";
    case "missing": return "The destination folder could not be found. Reload Files before continuing.";
    case "cycle": return "The destination folder hierarchy contains a cycle.";
    case "trash": return "A folder in Trash cannot be used as a destination.";
    case "archived": return "An archived folder cannot be used as a destination.";
    default: return "Choose a valid destination folder.";
  }
}

function sourceFolderReason(folderId: string | null, foldersById: ReadonlyMap<string, FileFolder>): string {
  if (folderId === null) return "";
  switch (folderPathState(folderId, foldersById)) {
    case "active": return "";
    case "trash": return "Restore trashed items before moving them.";
    case "archived": return "Archived items cannot be moved.";
    default: return "A selected item has an invalid or missing folder path. Reload Files before moving it.";
  }
}

function destinationIsWithinFolder(destinationId: string | null, sourceId: string, foldersById: ReadonlyMap<string, FileFolder>): boolean {
  const visited = new Set<string>();
  let currentId = destinationId;
  while (currentId !== null && !visited.has(currentId)) {
    if (currentId === sourceId) return true;
    visited.add(currentId);
    currentId = foldersById.get(currentId)?.parent_id ?? null;
  }
  return false;
}

export function moveDestinationReason(
  items: readonly BrowserItem[],
  destinationId: string | null,
  folders: readonly FileFolder[],
): string {
  if (items.length === 0) return "Select at least one item to move.";
  const foldersById = byFolderId(folders);
  if (!foldersById) return "The folder hierarchy is invalid. Reload Files before moving items.";
  const destinationReason = folderDestinationReason(destinationId, folders);
  if (destinationReason) return destinationReason;

  for (const item of items) {
    if (item.type === "file") {
      if (item.id !== item.file.id) return "A selected file is invalid. Reload Files before moving it.";
      if (item.file.state !== "ready") return "Only ready files can be moved.";
      if (item.file.trashed_at !== null) return "Restore trashed files before moving them.";
      const sourceReason = sourceFolderReason(item.file.folder_id, foldersById);
      if (sourceReason) return sourceReason;
      continue;
    }

    if (item.id !== item.folder.id) return "A selected folder is invalid. Reload Files before moving it.";
    const source = foldersById.get(item.id);
    if (!source) return "A selected folder could not be found. Reload Files before moving it.";
    if (source.kind === "course") return "Managed course folders stay at the root.";
    const sourceReason = sourceFolderReason(source.id, foldersById);
    if (sourceReason) return sourceReason;
    if (destinationIsWithinFolder(destinationId, source.id, foldersById)) {
      return "A folder cannot be moved into itself or one of its descendants.";
    }
  }
  return "";
}

export function associationDiffersFromLocation(file: PrivateFile, folders: readonly FileFolder[]): boolean {
  return (file.course_id ?? "") !== folderCourseId(file.folder_id, folders);
}

function fail(message: string, kind: BrowserOrganizationFailureKind = "request-error"): never {
  throw new BrowserOrganizationFailure(message, kind);
}

function requireId(value: unknown, label: string, kind: BrowserOrganizationFailureKind = "request-error"): string {
  if (typeof value !== "string" || !isFileId(value)) return fail(`The ${label} is invalid.`, kind);
  return value;
}

function requireRevision(value: unknown, label: string, kind: BrowserOrganizationFailureKind = "request-error"): number {
  try {
    return requireNumericRevision(value, label);
  } catch {
    return fail(`The ${label} is invalid.`, kind);
  }
}

function checkedName(value: unknown, label: string, kind: BrowserOrganizationFailureKind = "request-error"): string {
  try {
    return safeFileItemName(value);
  } catch (error) {
    return fail(error instanceof Error ? error.message : `Use a valid ${label}.`, kind);
  }
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return fail(`The server returned invalid ${label}.`, "conflict");
}

function validTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
    return fail(`The server returned an invalid ${label}.`, "conflict");
  }
  return value;
}

function optionalTrashFields(row: Record<string, unknown>): { original_location_path?: string | null; deleted_at?: string | null; purge_pending_at?: string | null } {
  const fields: { original_location_path?: string | null; deleted_at?: string | null; purge_pending_at?: string | null } = {};
  if (Object.prototype.hasOwnProperty.call(row, "original_location_path")) fields.original_location_path = nullableString(row.original_location_path, "original location path");
  for (const key of ["deleted_at", "purge_pending_at"] as const) {
    if (Object.prototype.hasOwnProperty.call(row, key)) fields[key] = row[key] === null ? null : validTimestamp(row[key], key);
  }
  return fields;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(message, "conflict");
  return value as Record<string, unknown>;
}

function assertProfileMatch(value: Record<string, unknown>, profileId: string): void {
  for (const key of PROFILE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== profileId) {
      return fail("The response belongs to a different signed-in account. Reload Files before continuing.", "session-error");
    }
  }
}

function requireProfileId(profileId: string): string {
  if (typeof profileId !== "string" || !UUID_PATTERN.test(profileId)) {
    return fail("The signed-in account is unavailable. Sign in again before changing Files.", "session-error");
  }
  return profileId;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function requestOrganization(
  profileId: string,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  requireProfileId(profileId);
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("x-profile-id", profileId);
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      signal: requestSignal(init.signal ?? undefined),
      headers,
    });
  } catch (error) {
    if (error instanceof BrowserOrganizationFailure) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? "The Files request was interrupted. Your selection is still here; retry the operation."
      : "The Files service could not be reached. Your selection is still here; retry the operation.";
    throw new BrowserOrganizationFailure(message, "request-error");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BrowserOrganizationFailure(
      "The Files service returned an unreadable response.",
      response.status === 409 ? "conflict" : "request-error",
    );
  }
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message = typeof body.error === "string" ? body.error : "The Files operation could not be completed.";
    const kind: BrowserOrganizationFailureKind = response.status === 401 || response.status === 403
      ? "session-error"
      : response.status === 409 || (response.status === 404 && init.method !== "GET")
        ? "conflict"
        : "request-error";
    throw new BrowserOrganizationFailure(message, kind);
  }
  const record = objectRecord(payload, "The Files service returned invalid data.");
  assertProfileMatch(record, profileId);
  return record;
}

export function parseFolder(value: unknown, profileId: string, expectedId?: string): FileFolder {
  const row = objectRecord(value, "The server returned invalid folder data.");
  assertProfileMatch(row, profileId);
  const id = requireId(row.id, "folder ID", "conflict");
  if (expectedId && id !== expectedId) return fail("The folder ID changed while it was being saved. Reload Files.", "conflict");
  const parentId = row.parent_id === null ? null : requireId(row.parent_id, "parent folder ID", "conflict");
  const name = checkedName(row.name, "folder name", "conflict");
  if (row.name !== name) return fail("The server returned an unexpected folder name.", "conflict");
  if (row.kind !== "custom" && row.kind !== "course") return fail("The server returned an invalid folder kind.", "conflict");
  const courseId = nullableString(row.course_id, "folder course");
  if ((row.kind === "custom" && courseId !== null) ||
      (row.kind === "course" && (courseId === null || parentId !== null))) {
    return fail("The server returned inconsistent folder kind data.", "conflict");
  }
  const courseCode = nullableString(row.course_code, "folder course code");
  const archivedAt = nullableString(row.archived_at, "folder archive date");
  const semesterLabel = nullableString(row.semester_label, "folder semester label");
  const courseNameSnapshot = nullableString(row.course_name_snapshot, "folder course name");
  const courseColorSnapshot = nullableString(row.course_color_snapshot, "folder course color");
  const trashedAt = nullableString(row.trashed_at, "folder Trash date");
  const trashOperationId = row.trash_operation_id === null ? null : requireId(row.trash_operation_id, "folder Trash operation ID", "conflict");
  const originalParentId = row.original_parent_id === null ? null : requireId(row.original_parent_id, "original parent folder ID", "conflict");
  const revision = requireRevision(row.revision, "folder revision", "conflict");
  const createdAt = validTimestamp(row.created_at, "folder creation date");
  const updatedAt = validTimestamp(row.updated_at, "folder update date");
  return {
    id, parent_id: parentId, name, kind: row.kind, course_id: courseId, course_code: courseCode,
    revision, created_at: createdAt, updated_at: updatedAt, archived_at: archivedAt,
    semester_label: semesterLabel, course_name_snapshot: courseNameSnapshot,
    course_color_snapshot: courseColorSnapshot, trashed_at: trashedAt,
    trash_operation_id: trashOperationId, original_parent_id: originalParentId,
    ...optionalTrashFields(row),
  };
}

export function parseFile(value: unknown, profileId: string, expectedId?: string): PrivateFile {
  const row = objectRecord(value, "The server returned invalid file data.");
  assertProfileMatch(row, profileId);
  const id = requireId(row.id, "file ID", "conflict");
  if (expectedId && id !== expectedId) return fail("The file ID changed while it was being saved. Reload Files.", "conflict");
  const name = checkedName(row.name, "file name", "conflict");
  if (row.name !== name) return fail("The server returned an unexpected file name.", "conflict");
  if (typeof row.mime_type !== "string" || !row.mime_type || !fileKinds.includes(row.kind as PrivateFile["kind"])) {
    return fail("The server returned an invalid file kind or type.", "conflict");
  }
  if (row.state !== "pending" && row.state !== "ready" && row.state !== "deleting") {
    return fail("The server returned an invalid file state.", "conflict");
  }
  if (row.content_backend !== "object" && row.content_backend !== "native-text") {
    return fail("The server returned an invalid file content type.", "conflict");
  }
  const sizeBytes = row.size_bytes;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    return fail("The server returned an invalid file size.", "conflict");
  }
  const courseId = nullableString(row.course_id, "file course");
  const assignmentId = nullableString(row.assignment_id, "file assignment");
  if (row.kind === "class-image" && courseId === null) {
    return fail("The server returned an invalid class image association.", "conflict");
  }
  const folderId = row.folder_id === null ? null : requireId(row.folder_id, "file folder ID", "conflict");
  const originalFolderId = row.original_folder_id === null ? null : requireId(row.original_folder_id, "original file folder ID", "conflict");
  const trashedAt = nullableString(row.trashed_at, "file Trash date");
  const trashOperationId = row.trash_operation_id === null ? null : requireId(row.trash_operation_id, "file Trash operation ID", "conflict");
  const contentSha256 = nullableString(row.content_sha256, "file content digest");
  if (contentSha256 !== null && !/^[a-f\d]{64}$/i.test(contentSha256)) {
    return fail("The server returned an invalid file content digest.", "conflict");
  }
  return {
    id, name, mime_type: row.mime_type, size_bytes: sizeBytes,
    course_id: courseId, assignment_id: assignmentId,
    kind: row.kind as PrivateFile["kind"], state: row.state,
    created_at: validTimestamp(row.created_at, "file creation date"),
    updated_at: validTimestamp(row.updated_at, "file update date"),
    content_sha256: contentSha256, folder_id: folderId,
    content_backend: row.content_backend,
    metadata_revision: requireRevision(row.metadata_revision, "file metadata revision", "conflict"),
    content_revision: requireRevision(row.content_revision, "file content revision", "conflict"),
    trashed_at: trashedAt, trash_operation_id: trashOperationId,
    original_folder_id: originalFolderId,
    ...optionalTrashFields(row),
  };
}

function requireEnvelopeValue(payload: unknown, key: string, message: string): unknown {
  const record = objectRecord(payload, message);
  if (!Object.prototype.hasOwnProperty.call(record, key)) return fail(message, "conflict");
  return record[key];
}

export type CreateCustomFolderInput = { id: string; name: string; parentId: string | null };
export type OrganizationRequestOptions = { signal?: AbortSignal; folders?: readonly FileFolder[] };

export async function createCustomFolder(
  profileId: string,
  input: CreateCustomFolderInput,
  options: OrganizationRequestOptions = {},
): Promise<FileFolder> {
  const id = requireId(input?.id, "folder ID");
  const name = checkedName(input?.name, "folder name");
  const parentId = input?.parentId === null ? null : requireId(input?.parentId, "parent folder ID");
  const payload = await requestOrganization(profileId, "/api/file-folders", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name, parentId }),
  });
  const folder = parseFolder(requireEnvelopeValue(payload, "folder", "The server returned incomplete folder data."), profileId, id);
  if (folder.kind !== "custom" || folder.name !== name || folder.parent_id !== parentId || folder.revision !== 1) {
    return fail("The created folder did not match the requested folder. Reload Files before continuing.", "conflict");
  }
  return folder;
}

function assertRenameInput(item: BrowserItem): { id: string; revision: number } {
  if (!item || (item.type !== "file" && item.type !== "folder")) return fail("The selected item is invalid.");
  const id = requireId(item?.id, "item ID");
  const nestedId = item?.type === "file" ? item.file?.id : item?.type === "folder" ? item.folder?.id : null;
  if (nestedId !== id) return fail("The selected item is invalid. Reload Files before renaming it.");
  const revision = item.type === "file"
    ? requireRevision(item.file.metadata_revision, "file metadata revision")
    : requireRevision(item.folder.revision, "folder revision");
  return { id, revision };
}

export async function renameBrowserItem(
  profileId: string,
  item: BrowserItem,
  rawName: string,
  options: OrganizationRequestOptions = {},
): Promise<BrowserItem> {
  const { id, revision } = assertRenameInput(item);
  const name = checkedName(rawName, item.type === "file" ? "file name" : "folder name");
  const isFile = item.type === "file";
  const payload = await requestOrganization(
    profileId,
    isFile ? `/api/files?id=${encodeURIComponent(id)}` : "/api/file-folders",
    {
      method: "PUT",
      signal: options.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isFile
        ? { action: "rename", name, baseMetadataRevision: revision }
        : { action: "rename", id, name, revision }),
    },
  );
  if (isFile) {
    const file = parseFile(requireEnvelopeValue(payload, "file", "The server returned incomplete file data."), profileId, id);
    const previous = (item as Extract<BrowserItem, { type: "file" }>).file;
    if (file.name !== name || file.metadata_revision < revision || (name !== previous.name && file.metadata_revision === revision) ||
        file.course_id !== previous.course_id || file.assignment_id !== previous.assignment_id ||
        file.kind !== previous.kind || file.folder_id !== previous.folder_id) {
      return fail("The file name or metadata changed while it was being saved. Reload Files before continuing.", "conflict");
    }
    return { type: "file", id, file };
  }

  const folder = parseFolder(requireEnvelopeValue(payload, "folder", "The server returned incomplete folder data."), profileId, id);
  const previous = (item as Extract<BrowserItem, { type: "folder" }>).folder;
  if (folder.name !== name || folder.revision < revision || (name !== previous.name && folder.revision === revision) ||
      folder.parent_id !== previous.parent_id || folder.kind !== previous.kind || folder.course_id !== previous.course_id) {
    return fail("The folder name or metadata changed while it was being saved. Reload Files before continuing.", "conflict");
  }
  return { type: "folder", id, folder };
}

export async function moveBrowserItems(
  profileId: string,
  items: readonly BrowserItem[],
  destinationId: string | null,
  options: OrganizationRequestOptions = {},
): Promise<{ files: PrivateFile[]; folders: FileFolder[] }> {
  if (!Array.isArray(items)) return fail("The selected items are invalid.");
  for (const item of items) {
    if (!item || (item.type !== "file" && item.type !== "folder")) return fail("The selected item is invalid.");
    const nestedId = item.type === "file" ? item.file?.id : item.folder?.id;
    if (item.id !== nestedId) return fail("The selected item is invalid. Reload Files before moving it.");
    requireId(item.id, "item ID");
    requireRevision(item.type === "file" ? item.file.metadata_revision : item.folder.revision, `${item.type} revision`);
  }
  const selected = actionItems(items);
  if (selected.length === 0) return fail("Select at least one item to move.");
  const hierarchy = options.folders ?? items.flatMap((item) => item.type === "folder" ? [item.folder] : []);
  const expected = new Set(deduplicateMoveItems(items, hierarchy).map((item) => `${item.type}:${item.id}`));
  const revisions = new Map(selected.map((item) => [`${item.type}:${item.id}`, item.revision]));
  const idTypes = new Set<string>();
  for (const item of selected) {
    requireId(item.id, "item ID");
    requireRevision(item.revision, `${item.type} revision`);
    idTypes.add(`${item.type}:${item.id}`);
  }
  if (destinationId !== null) requireId(destinationId, "destination folder ID");
  const payload = await requestOrganization(profileId, "/api/files/actions", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "move", items: selected, destinationId }),
  });
  const filesValue = requireEnvelopeValue(payload, "files", "The server returned incomplete move data.");
  const foldersValue = requireEnvelopeValue(payload, "folders", "The server returned incomplete move data.");
  if (!Array.isArray(filesValue) || !Array.isArray(foldersValue)) return fail("The server returned invalid move data.", "conflict");
  const returned = new Set<string>();
  const files = filesValue.map((raw): PrivateFile => {
    const file = parseFile(raw, profileId);
    const key = `file:${file.id}`;
    if (!idTypes.has(key) || !expected.has(key) || returned.has(key)) return fail("The server returned an unexpected file in the move result.", "conflict");
    returned.add(key);
    const original = items.find((item): item is Extract<BrowserItem, { type: "file" }> => item.type === "file" && item.id === file.id);
    if (!original || file.metadata_revision < (revisions.get(key) ?? Number.MAX_SAFE_INTEGER) ||
        (original.file.folder_id !== destinationId && file.metadata_revision === revisions.get(key)) ||
        file.folder_id !== destinationId || file.state !== "ready" || file.trashed_at !== null ||
        file.course_id !== original.file.course_id || file.assignment_id !== original.file.assignment_id || file.kind !== original.file.kind) {
      return fail("The file move could not be confirmed against the saved selection. Reload Files.", "conflict");
    }
    return file;
  });
  const folders = foldersValue.map((raw): FileFolder => {
    const folder = parseFolder(raw, profileId);
    const key = `folder:${folder.id}`;
    if (!idTypes.has(key) || !expected.has(key) || returned.has(key)) return fail("The server returned an unexpected folder in the move result.", "conflict");
    returned.add(key);
    const original = items.find((item): item is Extract<BrowserItem, { type: "folder" }> => item.type === "folder" && item.id === folder.id);
    if (!original || folder.revision < (revisions.get(key) ?? Number.MAX_SAFE_INTEGER) ||
        (original.folder.parent_id !== destinationId && folder.revision === revisions.get(key)) ||
        folder.parent_id !== destinationId || folder.kind === "course" || folder.trashed_at !== null ||
        folder.kind !== original.folder.kind || folder.course_id !== original.folder.course_id) {
      return fail("The folder move could not be confirmed against the saved selection. Reload Files.", "conflict");
    }
    return folder;
  });
  if (returned.size !== expected.size || [...expected].some((key) => !returned.has(key))) {
    return fail("The server did not confirm every selected item. Reload Files before continuing.", "conflict");
  }
  return { files, folders };
}
