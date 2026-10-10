import { isFileId, type PrivateFile } from "./files";
import type { BrowserItem } from "./files-browser";
import {
  BrowserOrganizationFailure,
  actionItems,
  parseFile,
  parseFolder,
  requestOrganization,
  type BrowserActionItem,
} from "./files-browser-operations";
import { requireNumericRevision, type FileFolder } from "./file-organization";

const UUID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

export type TrashOperationOptions = { signal?: AbortSignal; folders?: readonly FileFolder[] };
export type TrashUndoReceipt = { profileId: string; items: BrowserItem[]; label: string };

type TrashFileFields = PrivateFile & {
  original_location_path?: string | null;
  purge_pending_at?: string | null;
  deleted_at?: string | null;
};
type TrashFolderFields = FileFolder & {
  original_location_path?: string | null;
  purge_pending_at?: string | null;
  deleted_at?: string | null;
};

function fail(message: string, kind: "conflict" | "session-error" | "request-error" = "request-error"): never {
  throw new BrowserOrganizationFailure(message, kind);
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return fail(`The ${label} is invalid.`);
  return value;
}

function requireProfile(profileId: string): string {
  if (typeof profileId !== "string" || !UUID_PATTERN.test(profileId)) {
    return fail("The signed-in account is unavailable. Sign in again before changing Files.", "session-error");
  }
  return profileId;
}

function checkedRevision(value: unknown, label: string): number {
  try {
    return requireNumericRevision(value, label);
  } catch {
    return fail(`The ${label} is invalid.`);
  }
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(message, "conflict");
  return value as Record<string, unknown>;
}

function envelopeValue(payload: unknown, key: string, message: string): unknown {
  const record = objectRecord(payload, message);
  if (!Object.prototype.hasOwnProperty.call(record, key)) return fail(message, "conflict");
  return record[key];
}

function itemKey(item: Pick<BrowserItem, "type" | "id">): string {
  return `${item.type}:${item.id}`;
}

function validBrowserItem(item: BrowserItem): boolean {
  return Boolean(item && (item.type === "file" || item.type === "folder") &&
    typeof item.id === "string" && isFileId(item.id) &&
    (item.type === "file" ? item.file?.id === item.id : item.folder?.id === item.id));
}

function folderMap(folders: readonly FileFolder[]): Map<string, FileFolder> {
  const byId = new Map<string, FileFolder>();
  for (const folder of folders) {
    if (!folder || !isFileId(folder.id) || byId.has(folder.id)) {
      return fail("The folder hierarchy is invalid. Reload Files before continuing.", "conflict");
    }
    byId.set(folder.id, folder);
  }
  return byId;
}

function foldersFor(items: readonly BrowserItem[], folders: readonly FileFolder[] = []): FileFolder[] {
  const byId = new Map<string, FileFolder>();
  for (const folder of [...folders, ...items.flatMap((item) => item.type === "folder" ? [item.folder] : [])]) {
    const previous = byId.get(folder.id);
    if (previous && (previous.parent_id !== folder.parent_id || previous.original_parent_id !== folder.original_parent_id ||
        previous.revision !== folder.revision || previous.kind !== folder.kind || previous.course_id !== folder.course_id ||
        previous.trashed_at !== folder.trashed_at || previous.trash_operation_id !== folder.trash_operation_id)) {
      return fail("A folder changed while the selection was being prepared. Reload Files before continuing.", "conflict");
    }
    byId.set(folder.id, folder);
  }
  return [...byId.values()];
}

function activeParentId(folder: FileFolder): string | null {
  return folder.trashed_at === null ? folder.parent_id : folder.original_parent_id;
}

function trashParentId(folder: FileFolder): string | null {
  return folder.trashed_at === null ? folder.parent_id : folder.original_parent_id;
}

function deduplicateByFolderAncestors(items: readonly BrowserItem[], folders: readonly FileFolder[], trash: boolean, sameOperation = false): BrowserItem[] {
  const byId = folderMap(folders);
  const selectedFolders = new Set(items.filter((item) => item.type === "folder").map((item) => item.id));
  const seen = new Set<string>();
  const result: BrowserItem[] = [];
  for (const item of items) {
    if (!validBrowserItem(item)) return fail("A selected item is invalid. Reload Files before continuing.");
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    let parentId = item.type === "file"
      ? trash ? item.file.original_folder_id : item.file.folder_id
      : trash ? item.folder.original_parent_id : item.folder.parent_id;
    const visited = new Set<string>();
    let covered = false;
    const operationId = item.type === "file" ? item.file.trash_operation_id : item.folder.trash_operation_id;
    while (parentId !== null && !visited.has(parentId)) {
      const parent = byId.get(parentId);
      // Restore can only cover a chain trashed by the same recursive operation.
      if (sameOperation && (!parent?.trashed_at || parent.trash_operation_id !== operationId)) break;
      if (selectedFolders.has(parentId)) {
        covered = true;
        break;
      }
      visited.add(parentId);
      if (!parent) break;
      parentId = trash ? trashParentId(parent) : activeParentId(parent);
    }
    if (!covered) result.push(item);
  }
  return result;
}

function requireActiveTrashable(item: BrowserItem, folders: readonly FileFolder[]): void {
  const reason = itemTrashReason(item, folders);
  if (reason) fail(reason);
}

export function itemTrashReason(item: BrowserItem, folders: readonly FileFolder[] = []): string {
  if (!validBrowserItem(item)) return "A selected item is invalid. Reload Files before continuing.";
  if (item.type === "file") {
    if (item.file.state === "deleting") return "This file is being permanently deleted.";
    if (item.file.state !== "ready") return "Only ready files can be moved to Trash.";
    if (item.file.trashed_at !== null || item.file.trash_operation_id !== null) return "This file is already in Trash.";
    if (item.file.folder_id !== null && folders.length > 0) {
      let currentId: string | null = item.file.folder_id;
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      const visited = new Set<string>();
      while (currentId !== null) {
        if (visited.has(currentId)) return "The folder hierarchy contains a cycle.";
        visited.add(currentId);
        const current = byId.get(currentId);
        if (!current) return "A selected file has an unavailable folder path. Reload Files before continuing.";
        if (current.trashed_at !== null) return "Restore trashed folders before moving their contents to Trash.";
        currentId = current.parent_id;
      }
    }
    return "";
  }
  if (item.folder.kind === "course" && item.folder.course_id !== null) {
    return "Managed course folders cannot be moved to Trash.";
  }
  if (item.folder.trashed_at !== null || item.folder.trash_operation_id !== null) return "This folder is already in Trash.";
  if (folders.length > 0) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    let currentId: string | null = item.folder.id;
    const visited = new Set<string>();
    while (currentId !== null) {
      if (visited.has(currentId)) return "The folder hierarchy contains a cycle.";
      visited.add(currentId);
      const current = byId.get(currentId);
      if (!current) return "A selected folder has an unavailable path. Reload Files before continuing.";
      if (current.trashed_at !== null) return "Restore trashed folders before moving them to Trash.";
      currentId = current.parent_id;
    }
  }
  return "";
}

function submittedItems(items: readonly BrowserItem[]): BrowserActionItem[] {
  const revisions = new Map<string, number>();
  for (const item of items) {
    if (!validBrowserItem(item)) return fail("A selected item is invalid. Reload Files before continuing.");
    const revision = checkedRevision(item.type === "file" ? item.file.metadata_revision : item.folder.revision, `${item.type} revision`);
    const key = itemKey(item);
    if (revisions.has(key) && revisions.get(key) !== revision) return fail("A selected item has conflicting revisions. Reload Files before continuing.", "conflict");
    revisions.set(key, revision);
  }
  const actions = actionItems(items);
  for (const action of actions) {
    requireUuid(action.id, "item ID");
    checkedRevision(action.revision, `${action.type} revision`);
  }
  if (actions.length === 0) return fail("Select at least one item to continue.");
  return actions;
}

function parseActionRows(payload: unknown, profileId: string, actionLabel: string): { files: PrivateFile[]; folders: FileFolder[] } {
  const filesValue = envelopeValue(payload, "files", `The server returned incomplete ${actionLabel} data.`);
  const foldersValue = envelopeValue(payload, "folders", `The server returned incomplete ${actionLabel} data.`);
  if (!Array.isArray(filesValue) || !Array.isArray(foldersValue)) return fail(`The server returned invalid ${actionLabel} data.`, "conflict");
  const keys = new Set<string>();
  const files = filesValue.map((raw): PrivateFile => {
    const file = parseFile(raw, profileId);
    const key = `file:${file.id}`;
    if (keys.has(key)) return fail(`The server returned a duplicate file in the ${actionLabel} result.`, "conflict");
    keys.add(key);
    return file;
  });
  const folders = foldersValue.map((raw): FileFolder => {
    const folder = parseFolder(raw, profileId);
    const key = `folder:${folder.id}`;
    if (keys.has(key)) return fail(`The server returned a duplicate folder in the ${actionLabel} result.`, "conflict");
    keys.add(key);
    return folder;
  });
  return { files, folders };
}

function rowMap(files: readonly PrivateFile[], folders: readonly FileFolder[]): Map<string, BrowserItem> {
  const result = new Map<string, BrowserItem>();
  for (const file of files) result.set(`file:${file.id}`, { type: "file", id: file.id, file });
  for (const folder of folders) result.set(`folder:${folder.id}`, { type: "folder", id: folder.id, folder });
  return result;
}

function requireRootCoverage(roots: readonly BrowserItem[], returned: ReadonlyMap<string, BrowserItem>, label: string): void {
  for (const root of roots) {
    if (!returned.has(itemKey(root))) {
      return fail(`The server did not confirm every selected item for ${label}. Reload Files before continuing.`, "conflict");
    }
  }
}

function selectedFolderIds(roots: readonly BrowserItem[]): Set<string> {
  return new Set(roots.filter((item) => item.type === "folder").map((item) => item.id));
}

function isOriginalDescendant(
  folderId: string | null,
  selectedFolders: ReadonlySet<string>,
  capturedFolders: ReadonlyMap<string, FileFolder>,
  responseParents: ReadonlyMap<string, string | null>,
): boolean {
  const visited = new Set<string>();
  let currentId = folderId;
  while (currentId !== null) {
    if (selectedFolders.has(currentId)) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const captured = capturedFolders.get(currentId);
    if (captured) {
      currentId = captured.trashed_at === null ? captured.parent_id : captured.original_parent_id;
    } else if (responseParents.has(currentId)) {
      currentId = responseParents.get(currentId) ?? null;
    } else {
      return false;
    }
  }
  return false;
}

function assertTrashAcknowledgement(
  roots: readonly BrowserItem[],
  inputItems: readonly BrowserItem[],
  rows: { files: PrivateFile[]; folders: FileFolder[] },
  capturedFolders: readonly FileFolder[],
): void {
  const returned = rowMap(rows.files, rows.folders);
  requireRootCoverage(roots, returned, "Trash");
  const rootByKey = new Map(roots.map((item) => [itemKey(item), item]));
  const captured = folderMap(capturedFolders);
  const selectedFolders = selectedFolderIds(roots);
  const responseParents = new Map(rows.folders.map((folder) => [folder.id, folder.original_parent_id]));

  for (const file of rows.files) {
    const key = `file:${file.id}`;
    const originalRoot = rootByKey.get(key);
    const original = inputItems.find((item) => item.type === "file" && item.id === file.id);
    if (file.trashed_at === null || file.trash_operation_id === null || !isFileId(file.trash_operation_id) ||
        file.folder_id !== null || file.state !== "ready") {
      return fail("The file Trash operation could not be confirmed. Reload Files before continuing.", "conflict");
    }
    if (originalRoot) {
      if (!original || original.type !== "file" || file.metadata_revision <= original.file.metadata_revision ||
          file.content_revision !== original.file.content_revision || file.course_id !== original.file.course_id ||
          file.assignment_id !== original.file.assignment_id || file.kind !== original.file.kind ||
          file.content_backend !== original.file.content_backend || file.original_folder_id !== original.file.folder_id) {
        return fail("The file Trash result changed saved file details. Reload Files before continuing.", "conflict");
      }
    } else if (!isOriginalDescendant(file.original_folder_id, selectedFolders, captured, responseParents)) {
      return fail("The server returned a file outside the selected folder hierarchy. Reload Files before continuing.", "conflict");
    }
  }

  for (const folder of rows.folders) {
    const key = `folder:${folder.id}`;
    const originalRoot = rootByKey.get(key);
    const original = inputItems.find((item) => item.type === "folder" && item.id === folder.id);
    if (folder.trashed_at === null || folder.trash_operation_id === null || !isFileId(folder.trash_operation_id) || folder.parent_id !== null) {
      return fail("The folder Trash operation could not be confirmed. Reload Files before continuing.", "conflict");
    }
    if (originalRoot) {
      if (!original || original.type !== "folder" || folder.revision <= original.folder.revision ||
          folder.kind !== original.folder.kind || folder.course_id !== original.folder.course_id ||
          folder.original_parent_id !== original.folder.parent_id) {
        return fail("The folder Trash result changed saved folder details. Reload Files before continuing.", "conflict");
      }
    } else if (!isOriginalDescendant(folder.original_parent_id, selectedFolders, captured, responseParents)) {
      return fail("The server returned a folder outside the selected hierarchy. Reload Files before continuing.", "conflict");
    }
  }
}

export async function trashBrowserItems(
  profileId: string,
  items: readonly BrowserItem[],
  options: TrashOperationOptions = {},
): Promise<{ files: PrivateFile[]; folders: FileFolder[]; undo: TrashUndoReceipt }> {
  requireProfile(profileId);
  if (!Array.isArray(items) || items.length === 0) return fail("Select at least one item to move to Trash.");
  const capturedFolders = foldersFor(items, options.folders);
  for (const item of items) {
    if (!validBrowserItem(item)) return fail("A selected item is invalid. Reload Files before continuing.");
    requireActiveTrashable(item, capturedFolders);
  }
  const roots = deduplicateByFolderAncestors(items, capturedFolders, false);
  // Keep every selected revision in the request. The account-locked RPC checks
  // all rows before collapsing descendants; roots only shape ACKs and Undo.
  const selected = submittedItems(items);
  const payload = await requestOrganization(profileId, "/api/files/actions", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "trash", items: selected }),
  });
  const rows = parseActionRows(payload, profileId, "Trash");
  assertTrashAcknowledgement(roots, items, rows, capturedFolders);
  const returned = rowMap(rows.files, rows.folders);
  const rootSnapshots = roots.map((root) => {
    const snapshot = returned.get(itemKey(root));
    if (!snapshot) return fail("The server did not confirm every selected item for Trash.", "conflict");
    return snapshot;
  });
  const count = roots.length;
  return {
    ...rows,
    undo: {
      profileId,
      items: rootSnapshots,
      label: count === 1 ? roots[0].type === "file" ? roots[0].file.name : roots[0].folder.name : `${count} items`,
    },
  };
}

function validateTrashItems(items: readonly BrowserItem[], folders: readonly FileFolder[], operation: "restore" | "permanent-delete"): BrowserItem[] {
  if (!Array.isArray(items) || items.length === 0) return fail("Select at least one item to continue.");
  for (const item of items) {
    if (!validBrowserItem(item)) return fail("A selected item is invalid. Reload Files before continuing.");
    if (item.type === "file") {
      if (item.file.trashed_at === null || !item.file.trash_operation_id || !isFileId(item.file.trash_operation_id)) {
        return fail("A selected file is no longer in Trash. Reload Trash before continuing.", "conflict");
      }
      if (operation === "restore" && item.file.state !== "ready") {
        return fail(item.file.state === "deleting" ? "This file is being permanently deleted." : "Only ready files can be restored.");
      }
      if (operation === "permanent-delete" && item.file.state !== "ready" && item.file.state !== "deleting") {
        return fail("Only trashed files can be permanently deleted.");
      }
    } else if (item.folder.trashed_at === null || !item.folder.trash_operation_id || !isFileId(item.folder.trash_operation_id)) {
      return fail("A selected folder is no longer in Trash. Reload Trash before continuing.", "conflict");
    }
  }
  return deduplicateByFolderAncestors(items, foldersFor(items, folders), true, operation === "restore");
}

function assertRestoredRoot(root: BrowserItem, restored: BrowserItem, recoveryFolder: FileFolder | null): void {
  if (root.type !== restored.type || root.id !== restored.id) return fail("The restore result did not match the selected item.", "conflict");
  if (root.type === "file" && restored.type === "file") {
    if (restored.file.trashed_at !== null || restored.file.trash_operation_id !== null ||
        restored.file.original_folder_id !== null || restored.file.state !== "ready" ||
        restored.file.metadata_revision <= root.file.metadata_revision ||
        restored.file.content_revision !== root.file.content_revision ||
        restored.file.course_id !== root.file.course_id || restored.file.assignment_id !== root.file.assignment_id ||
        restored.file.kind !== root.file.kind || restored.file.content_backend !== root.file.content_backend ||
        (restored.file.folder_id !== root.file.original_folder_id &&
          restored.file.folder_id !== recoveryFolder?.id)) {
      return fail("The file restore could not be confirmed without changing its saved details. Reload Files.", "conflict");
    }
    return;
  }
  if (root.type === "folder" && restored.type === "folder" &&
      (restored.folder.trashed_at !== null || restored.folder.trash_operation_id !== null ||
        restored.folder.original_parent_id !== null || restored.folder.revision <= root.folder.revision ||
        restored.folder.kind !== root.folder.kind || restored.folder.course_id !== root.folder.course_id ||
        (restored.folder.parent_id !== root.folder.original_parent_id &&
          restored.folder.parent_id !== recoveryFolder?.id))) {
    return fail("The folder restore could not be confirmed. Reload Files before continuing.", "conflict");
  }
}

function recoveryFolderFrom(payload: unknown, profileId: string): FileFolder | null {
  const value = envelopeValue(payload, "recoveryFolder", "The server returned incomplete restore data.");
  if (value === null) return null;
  const folder = parseFolder(value, profileId);
  if (folder.kind !== "custom" || folder.parent_id !== null || folder.trashed_at !== null || folder.archived_at !== null || folder.deleted_at || folder.purge_pending_at) {
    return fail("The server returned an invalid recovery folder.", "conflict");
  }
  return folder;
}

export async function restoreTrashItems(
  profileId: string,
  items: readonly BrowserItem[],
  options: TrashOperationOptions = {},
): Promise<{ files: PrivateFile[]; folders: FileFolder[]; recoveryFolder: FileFolder | null }> {
  requireProfile(profileId);
  const roots = validateTrashItems(items, options.folders ?? [], "restore");
  const selected = submittedItems(items);
  const payload = await requestOrganization(profileId, "/api/files/actions", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "restore", items: selected }),
  });
  const rows = parseActionRows(payload, profileId, "restore");
  const recoveryFolder = recoveryFolderFrom(payload, profileId);
  const returned = rowMap(rows.files, rows.folders);
  requireRootCoverage(roots, returned, "restore");
  for (const root of roots) {
    const restored = returned.get(itemKey(root));
    if (!restored) return fail("The server did not confirm every selected item for restore.", "conflict");
    assertRestoredRoot(root, restored, recoveryFolder);
  }
  for (const file of rows.files) {
    if (file.trashed_at !== null || file.trash_operation_id !== null || file.original_folder_id !== null || file.state !== "ready") {
      return fail("The server returned an incomplete file restore. Reload Files before continuing.", "conflict");
    }
  }
  for (const folder of rows.folders) {
    if (folder.trashed_at !== null || folder.trash_operation_id !== null || folder.original_parent_id !== null) {
      return fail("The server returned an incomplete folder restore. Reload Files before continuing.", "conflict");
    }
  }
  const selectedFolders = selectedFolderIds(roots);
  const capturedFolders = folderMap(foldersFor(items, options.folders));
  const responseParents = new Map(rows.folders.map((folder) => [folder.id, folder.parent_id]));
  const rootKeys = new Set(roots.map(itemKey));
  for (const folder of rows.folders) {
    if (rootKeys.has(`folder:${folder.id}`) || selectedFolders.size === 0) continue;
    if (!isOriginalDescendant(folder.id, selectedFolders, capturedFolders, responseParents)) {
      return fail("The server returned a folder outside the selected hierarchy. Reload Files before continuing.", "conflict");
    }
  }
  for (const file of rows.files) {
    if (rootKeys.has(`file:${file.id}`) || selectedFolders.size === 0) continue;
    if (!isOriginalDescendant(file.folder_id, selectedFolders, capturedFolders, responseParents)) {
      return fail("The server returned a file outside the selected hierarchy. Reload Files before continuing.", "conflict");
    }
  }
  if (selectedFolders.size === 0 && (rows.files.length !== roots.filter((item) => item.type === "file").length ||
      rows.folders.length !== roots.filter((item) => item.type === "folder").length)) {
    return fail("The server returned unselected items in the restore result. Reload Files before continuing.", "conflict");
  }
  return { ...rows, recoveryFolder };
}

function parseRemovedIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return fail(`The server returned invalid ${label} deletion data.`, "conflict");
  const seen = new Set<string>();
  return value.map((raw) => {
    const id = requireUuid(raw, `${label} ID`);
    if (seen.has(id)) return fail(`The server returned a duplicate ${label} deletion acknowledgement.`, "conflict");
    seen.add(id);
    return id;
  });
}

function removedResult(payload: unknown, requestId: string): { files: string[]; folders: string[] } {
  const record = objectRecord(payload, "The server returned invalid deletion data.");
  if (record.requestId !== requestId) return fail("The server did not confirm this deletion request. Reload Trash before continuing.", "conflict");
  const removed = objectRecord(record.removed, "The server returned incomplete deletion data.");
  return {
    files: parseRemovedIds(removed.files, "file"),
    folders: parseRemovedIds(removed.folders, "folder"),
  };
}

export async function permanentDeleteTrashItems(
  profileId: string,
  items: readonly BrowserItem[],
  requestId: string,
  options: TrashOperationOptions = {},
): Promise<{ removed: { files: string[]; folders: string[] }; requestId: string }> {
  requireProfile(profileId);
  requireUuid(requestId, "deletion request ID");
  const roots = validateTrashItems(items, options.folders ?? [], "permanent-delete");
  const selected = submittedItems(roots);
  const payload = await requestOrganization(profileId, "/api/files/actions", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "permanent-delete", items: selected, requestId }),
  });
  const removed = removedResult(payload, requestId);
  const removedFiles = new Set(removed.files.map((id) => `file:${id}`));
  const removedFolders = new Set(removed.folders.map((id) => `folder:${id}`));
  for (const root of roots) {
    const acknowledged = root.type === "file" ? removedFiles.has(itemKey(root)) : removedFolders.has(itemKey(root));
    if (!acknowledged) return fail("The server did not confirm every selected item for permanent deletion. Reload Trash before continuing.", "conflict");
  }
  return { removed, requestId };
}

export async function emptyTrash(
  profileId: string,
  requestId: string,
  options: Pick<TrashOperationOptions, "signal"> = {},
): Promise<{ removed: { files: string[]; folders: string[] }; requestId: string }> {
  requireProfile(profileId);
  requireUuid(requestId, "deletion request ID");
  const payload = await requestOrganization(profileId, "/api/files/actions", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "empty-trash", requestId }),
  });
  return { removed: removedResult(payload, requestId), requestId };
}

export function originalDisplayPath(item: BrowserItem, folders: readonly FileFolder[] = []): string {
  if (!validBrowserItem(item)) return "Unavailable original folder";
  const snapshot = item.type === "file"
    ? (item.file as TrashFileFields).original_location_path
    : (item.folder as TrashFolderFields).original_location_path;
  if (typeof snapshot === "string" && snapshot.trim()) return snapshot;
  const parentId = item.type === "file" ? item.file.original_folder_id : item.folder.original_parent_id;
  if (parentId === null) return "My files";
  let byId: Map<string, FileFolder>;
  try {
    byId = folderMap(folders);
  } catch {
    return "Unavailable original folder";
  }
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = parentId;
  while (currentId !== null) {
    if (visited.has(currentId)) return "Unavailable original folder";
    visited.add(currentId);
    const folder = byId.get(currentId);
    if (!folder) return "Unavailable original folder";
    path.push(folder.name);
    currentId = folder.trashed_at === null ? folder.parent_id : folder.original_parent_id;
  }
  return ["My files", ...path.reverse()].join(" / ");
}
