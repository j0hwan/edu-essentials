import { createElement, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import FilesBrowser from "../../app/files-browser";
import type { Course } from "../../lib/academics";
import type { FileFolder } from "../../lib/file-organization";
import type { PrivateFile } from "../../lib/files";
import { restoreTrashItems, type TrashUndoReceipt } from "../../lib/files-trash-operations";

const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = {
  root: "11111111-1111-4111-8111-111111111111",
  child: "22222222-2222-4222-8222-222222222222",
  deep: "33333333-3333-4333-8333-333333333333",
  independent: "77777777-7777-4777-8777-777777777777",
  notes: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  lost: "88888888-8888-4888-8888-888888888888",
  recovery: "99999999-9999-4999-8999-999999999999",
};
const MISSING_FOLDER = "abababab-abab-4bab-8bab-abababababab";
const ROOT_OPERATION = "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1";
const INDEPENDENT_OPERATION = "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2";
const LOST_OPERATION = "e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3";
const STAMP = "2026-10-08T12:00:00.000Z";
const CONTENT_HASH = "a45e79274507b88b677c1f7933388f0980fae989e3cb865aa0c0f658da5dfccb";
const courses: Course[] = [];
type RequestRecord = { path: string; method: string; profileId: string; body?: Record<string, unknown> };
type PurgeManifest = { requestId: string; descriptor: string; files: string[]; folders: string[] };

function folder(id: string, name: string, parent_id: string | null, fields: Partial<FileFolder> = {}): FileFolder {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
    created_at: STAMP, updated_at: STAMP, archived_at: null, semester_label: null,
    course_name_snapshot: null, course_color_snapshot: null, trashed_at: null,
    trash_operation_id: null, original_parent_id: null, ...fields,
  };
}

function file(id: string, name: string, folder_id: string | null, fields: Partial<PrivateFile> = {}): PrivateFile {
  return {
    id, name, mime_type: name.endsWith(".pdf") ? "application/pdf" : "text/plain", size_bytes: 1240,
    course_id: null, assignment_id: null, kind: "resource", state: "ready", created_at: STAMP,
    updated_at: STAMP, content_sha256: CONTENT_HASH, folder_id, content_backend: "object",
    metadata_revision: 1, content_revision: 1, trashed_at: null, trash_operation_id: null,
    original_folder_id: null, ...fields,
  };
}

const folders: FileFolder[] = [
  folder(ID.root, "Project Phoenix", null),
  folder(ID.child, "Working copy", ID.root),
  folder(ID.deep, "Draft notes", ID.child),
];
const files: PrivateFile[] = [
  file(ID.notes, "Numbers.txt", ID.child),
  file(ID.source, "Sources.pdf", ID.deep),
];
const requests: RequestRecord[] = [];
const purgeManifests = new Map<string, PurgeManifest>();
const physicalFailures = new Map<string, number>();
let root: Root | null = null;
const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "layout";

function pathForFolder(folderId: string | null): string {
  if (!folderId) return "My files";
  const segments: string[] = [];
  const seen = new Set<string>();
  let current: string | null = folderId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const item = folders.find((candidate) => candidate.id === current);
    if (!item) break;
    segments.unshift(item.name);
    current = item.parent_id ?? item.original_parent_id;
  }
  return segments.join("/");
}

function trashFolderSeed(id: string, operationId: string, time = STAMP) {
  const selected = folders.find((candidate) => candidate.id === id);
  if (!selected) return;
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of folders) {
      if (!candidate.trashed_at && candidate.parent_id && ids.has(candidate.parent_id) && !ids.has(candidate.id)) {
        ids.add(candidate.id);
        changed = true;
      }
    }
  }
  for (const item of folders.filter((candidate) => ids.has(candidate.id))) {
    const originalParent = item.parent_id;
    item.original_location_path = pathForFolder(item.id);
    item.original_parent_id = originalParent;
    item.parent_id = null;
    item.trashed_at = time;
    item.trash_operation_id = operationId;
    item.revision += 1;
  }
  for (const item of files.filter((candidate) => candidate.folder_id && ids.has(candidate.folder_id))) {
    item.original_location_path = `${pathForFolder(item.folder_id)}/${item.name}`;
    item.original_folder_id = item.folder_id;
    item.folder_id = null;
    item.trashed_at = time;
    item.trash_operation_id = operationId;
    item.metadata_revision += 1;
  }
}

function seedIndependentTrash() {
  folders.push(folder(ID.independent, "Old draft", null, {
    parent_id: null, original_parent_id: ID.root, original_location_path: "Project Phoenix/Old draft",
    trashed_at: STAMP, trash_operation_id: INDEPENDENT_OPERATION, revision: 2,
  }));
  files.push(file(ID.lost, "Lost item.txt", null, {
    folder_id: null, original_folder_id: MISSING_FOLDER,
    original_location_path: "Removed class/Lost item.txt",
    trashed_at: STAMP, trash_operation_id: LOST_OPERATION, metadata_revision: 2,
  }));
}

if (scenario === "main" || scenario === "layout" || scenario === "empty" || scenario === "readonly") {
  seedIndependentTrash();
  if (scenario !== "main") trashFolderSeed(ID.root, ROOT_OPERATION);
} else if (scenario === "retry") {
  trashFolderSeed(ID.root, ROOT_OPERATION);
}

function clone<T>(value: T): T { return structuredClone(value); }
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}
function error(message: string, status: number) { return json({ error: message }, status); }
function allTrashFiles() { return files.filter((item) => item.trashed_at !== null && item.deleted_at == null); }
function allTrashFolders() { return folders.filter((item) => item.trashed_at !== null && item.deleted_at == null); }
function findFolder(id: string) { return folders.find((item) => item.id === id); }
function findFile(id: string) { return files.find((item) => item.id === id); }

function folderOperationMembers(rootId: string, operationId: string | null) {
  const folderIds = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of folders) {
      if (item.trashed_at && item.trash_operation_id === operationId && item.original_parent_id &&
          folderIds.has(item.original_parent_id) && !folderIds.has(item.id)) {
        folderIds.add(item.id);
        changed = true;
      }
    }
  }
  const fileIds = files.filter((item) => item.trashed_at && item.trash_operation_id === operationId &&
    item.original_folder_id !== null && folderIds.has(item.original_folder_id)).map((item) => item.id);
  return { folderIds: [...folderIds], fileIds };
}

function activeFolderMembers(rootId: string) {
  const folderIds = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of folders) {
      if (item.trashed_at === null && item.parent_id && folderIds.has(item.parent_id) && !folderIds.has(item.id)) {
        folderIds.add(item.id);
        changed = true;
      }
    }
  }
  return {
    folderIds: [...folderIds],
    fileIds: files.filter((item) => item.trashed_at === null && item.folder_id !== null && folderIds.has(item.folder_id)).map((item) => item.id),
  };
}

function mutateTrash(body: Record<string, unknown>) {
  const selected = body.items as Array<{ type: "file" | "folder"; id: string }>;
  const fileRows: PrivateFile[] = [];
  const folderRows: FileFolder[] = [];
  const now = STAMP;
  for (const item of selected) {
    if (item.type === "folder") {
      const rootFolder = findFolder(item.id);
      if (!rootFolder || rootFolder.trashed_at) continue;
      const members = activeFolderMembers(item.id);
      for (const id of members.fileIds) {
        const current = findFile(id)!;
        current.original_folder_id = current.folder_id;
        current.original_location_path = `${pathForFolder(current.folder_id)}/${current.name}`;
        current.folder_id = null;
        current.trashed_at = now;
        current.trash_operation_id = ROOT_OPERATION;
        current.metadata_revision += 1;
        fileRows.push(current);
      }
      for (const id of members.folderIds) {
        const current = findFolder(id)!;
        current.original_location_path = pathForFolder(current.id);
        current.original_parent_id = current.parent_id;
        current.parent_id = null;
        current.trashed_at = now;
        current.trash_operation_id = ROOT_OPERATION;
        current.revision += 1;
        folderRows.push(current);
      }
    } else {
      const current = findFile(item.id);
      if (!current || current.trashed_at) continue;
      current.original_folder_id = current.folder_id;
      current.original_location_path = `${pathForFolder(current.folder_id)}/${current.name}`;
      current.folder_id = null;
      current.trashed_at = now;
      current.trash_operation_id = ROOT_OPERATION;
      current.metadata_revision += 1;
      fileRows.push(current);
    }
  }
  return { files: clone(fileRows), folders: clone(folderRows), activities: { files: [], folders: [] } };
}

function mutateRestore(body: Record<string, unknown>) {
  const selected = body.items as Array<{ type: "file" | "folder"; id: string }>;
  const fileRows: PrivateFile[] = [];
  const folderRows: FileFolder[] = [];
  let recoveryFolder: FileFolder | null = null;
  for (const item of selected) {
    if (item.type === "folder") {
      const source = findFolder(item.id);
      if (!source?.trashed_at) continue;
      const members = folderOperationMembers(source.id, source.trash_operation_id);
      for (const id of members.folderIds) {
        const current = findFolder(id)!;
        current.parent_id = current.id === source.id ? current.original_parent_id : current.original_parent_id;
        current.original_parent_id = null;
        current.trashed_at = null;
        current.trash_operation_id = null;
        current.original_location_path = null;
        current.revision += 1;
        folderRows.push(current);
      }
      for (const id of members.fileIds) {
        const current = findFile(id)!;
        current.folder_id = current.original_folder_id;
        current.original_folder_id = null;
        current.trashed_at = null;
        current.trash_operation_id = null;
        current.original_location_path = null;
        current.metadata_revision += 1;
        fileRows.push(current);
      }
    } else {
      const current = findFile(item.id);
      if (!current?.trashed_at) continue;
      const parentId = current.original_folder_id;
      const parent = parentId ? findFolder(parentId) : undefined;
      if (parentId && (!parent || parent.trashed_at !== null)) {
        recoveryFolder = findFolder(ID.recovery) ?? folder(ID.recovery, "Restored files", null);
        if (!findFolder(ID.recovery)) folders.push(recoveryFolder);
        current.folder_id = recoveryFolder.id;
      } else current.folder_id = parentId;
      current.original_folder_id = null;
      current.trashed_at = null;
      current.trash_operation_id = null;
      current.original_location_path = null;
      current.metadata_revision += 1;
      fileRows.push(current);
    }
  }
  return { files: clone(fileRows), folders: clone(folderRows), activities: { files: [], folders: [] }, recoveryFolder: clone(recoveryFolder) };
}

function purgeMembers(body: Record<string, unknown>, isEmpty: boolean): PurgeManifest | null {
  const requestId = String(body.requestId ?? "");
  const descriptor = JSON.stringify({ empty: isEmpty, items: body.items ?? [] });
  const existing = purgeManifests.get(requestId);
  if (existing) return existing.descriptor === descriptor ? existing : null;
  const selected = (body.items ?? []) as Array<{ type: "file" | "folder"; id: string }>;
  const folderIds = new Set<string>();
  const fileIds = new Set<string>();
  if (isEmpty) {
    for (const item of allTrashFolders()) folderIds.add(item.id);
    for (const item of allTrashFiles()) fileIds.add(item.id);
  } else {
    for (const item of selected) {
      if (item.type === "folder") {
        const source = findFolder(item.id);
        if (!source) continue;
        const members = folderOperationMembers(source.id, source.trash_operation_id);
        members.folderIds.forEach((id) => folderIds.add(id));
        members.fileIds.forEach((id) => fileIds.add(id));
      } else if (findFile(item.id)) fileIds.add(item.id);
    }
  }
  const manifest: PurgeManifest = { requestId, descriptor, files: [...fileIds], folders: [...folderIds] };
  purgeManifests.set(requestId, manifest);
  return manifest;
}

function removeManifest(manifest: PurgeManifest) {
  for (let index = files.length - 1; index >= 0; index -= 1) if (manifest.files.includes(files[index]!.id)) files.splice(index, 1);
  for (let index = folders.length - 1; index >= 0; index -= 1) if (manifest.folders.includes(folders[index]!.id)) folders.splice(index, 1);
}

async function handleApi(input: RequestInfo | URL, init: RequestInit = {}) {
  const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl, window.location.origin);
  const method = init.method ?? (input instanceof Request ? input.method : "GET");
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const profileId = headers.get("x-profile-id") ?? "";
  let body: Record<string, unknown> | undefined;
  if (typeof init.body === "string") {
    try { body = JSON.parse(init.body) as Record<string, unknown>; }
    catch { return error("Invalid fixture JSON.", 400); }
  }
  const path = `${url.pathname}${url.search}`;
  requests.push({ path, method, profileId, ...(body ? { body: clone(body) } : {}) });
  if (profileId !== PROFILE_ID) return error("Wrong fixture account.", 401);
  if (url.pathname === "/api/files" && method === "GET") {
    const view = url.searchParams.get("view");
    const visible = view === "trash" ? allTrashFiles() : files.filter((item) => item.trashed_at === null && item.deleted_at == null);
    return json({ files: clone(visible), activities: { files: [] } });
  }
  if (url.pathname === "/api/file-folders" && method === "GET") {
    const view = url.searchParams.get("view");
    const visible = view === "trash" ? allTrashFolders()
      : view === "archives" ? folders.filter((item) => item.archived_at !== null && item.trashed_at === null)
        : folders.filter((item) => item.trashed_at === null && item.archived_at === null && item.deleted_at == null);
    return json({ folders: clone(visible), activities: { folders: [] } });
  }
  if (url.pathname === "/api/files/actions" && method === "POST" && body) {
    if (body.action === "trash") return json(mutateTrash(body));
    if (body.action === "restore") return json(mutateRestore(body));
    if (body.action === "permanent-delete" || body.action === "empty-trash") {
      const isEmpty = body.action === "empty-trash";
      const manifest = purgeMembers(body, isEmpty);
      if (!manifest) return error("Purge request ID was already used for a different selection.", 409);
      const attempts = (physicalFailures.get(manifest.requestId) ?? 0) + 1;
      physicalFailures.set(manifest.requestId, attempts);
      for (const id of manifest.files) {
        const item = findFile(id);
        if (item) item.state = "deleting";
      }
      for (const id of manifest.folders) {
        const item = findFolder(id);
        if (item) item.purge_pending_at = STAMP;
      }
      if (scenario === "retry" && body.action === "permanent-delete" && attempts === 1) {
        return error("Mock physical object cleanup failed.", 503);
      }
      const removed = { files: manifest.files, folders: manifest.folders };
      removeManifest(manifest);
      return json({ requestId: manifest.requestId, removed });
    }
    return error(`Unexpected fixture action: ${String(body.action)}`, 404);
  }
  return error(`Unexpected fixture request: ${method} ${path}`, 404);
}

globalThis.fetch = handleApi;

type FixtureApi = {
  getFiles(): PrivateFile[];
  getFolders(): FileFolder[];
  getRequests(): RequestRecord[];
  getMutationRequests(): RequestRecord[];
  getPurgeManifests(): PurgeManifest[];
  getUndoReceipt(): TrashUndoReceipt | null;
  setReadonly(value: boolean): void;
};
declare global { interface Window { __filesTrashFixture: FixtureApi } }

function BrowserFixture() {
  const [storeFiles, setStoreFiles] = useState<PrivateFile[]>(files);
  const [canWrite, setCanWrite] = useState(new URLSearchParams(window.location.search).get("readonly") !== "1");
  const [undoReceipt, setUndoReceipt] = useState<TrashUndoReceipt | null>(null);
  const [toast, setToast] = useState("");
  useEffect(() => { window.__filesTrashFixture = {
    getFiles: () => clone(files),
    getFolders: () => clone(folders),
    getRequests: () => clone(requests),
    getMutationRequests: () => clone(requests.filter((request) => request.method === "POST")),
    getPurgeManifests: () => clone([...purgeManifests.values()]),
    getUndoReceipt: () => clone(undoReceipt),
    setReadonly: (value) => setCanWrite(!value),
  }; }, [undoReceipt]);
  const store = { files: storeFiles, busy: false, url: () => "#", blob: async () => new Blob() };
  const undo = async () => {
    if (!undoReceipt) return;
    await restoreTrashItems(undoReceipt.profileId, undoReceipt.items, { folders: clone(folders) });
    setStoreFiles([...files]);
    setUndoReceipt(null);
    setToast("Restored the item to its original location.");
  };
  return createElement("div", null,
    toast && createElement("div", { className: "files-trash-notice", role: "status", "aria-live": "polite" },
      createElement("span", null, toast),
      undoReceipt && createElement("button", { type: "button", onClick: () => void undo() }, "Undo")),
    createElement(FilesBrowser, {
      profileId: PROFILE_ID, courses, assignments: [], courseDetails: {}, store: store as never,
      layout: "list" as const, onLayoutChange: () => {}, onUpload: () => {}, onOpen: () => {}, onEdit: () => {},
      onNewTextFile: () => {}, canWrite,
      onOrganizationSaved: () => { setStoreFiles([...files]); },
      onTrashCompleted: (receipt: TrashUndoReceipt) => { setUndoReceipt(receipt); setToast(receipt.label); },
    }));
}

const mount = () => {
  const element = document.getElementById("root");
  if (!element) throw new Error("The Files Trash fixture requires #root.");
  root = createRoot(element);
  root.render(createElement(BrowserFixture) as ReactNode);
};
mount();
window.addEventListener("pagehide", () => root?.unmount(), { once: true });
