import { createElement, Fragment, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import FilesBrowser from "../../app/files-browser";
import FileUploadDialog from "../../app/file-upload-dialog";
import { useFileUploads } from "../../app/use-file-uploads";
import { usePrivateFiles } from "../../app/use-private-files";
import { planSelectedDownload, type SelectedDownloadFile, type SelectedDownloadFolder, type SelectedDownloadItem } from "../../lib/files-selected-download";
import { zipStream, type ZipEntry } from "../../lib/zip";
import type { Course, CourseDetails } from "../../lib/academics";
import type { FileFolder } from "../../lib/file-organization";
import type { PrivateFile } from "../../lib/files";
import type { TrashUndoReceipt } from "../../lib/files-trash-operations";
import type { FilesBrowserPreferences } from "../../lib/files-browser";

const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID = {
  course: "11111111-1111-4111-8111-111111111111",
  chemistry: "12121212-1212-4212-8212-121212121212",
  project: "22222222-2222-4222-8222-222222222222",
  nested: "23232323-2323-4323-8323-232323232323",
  destination: "24242424-2424-4424-8424-242424242424",
  protected: "25252525-2525-4525-8525-252525252525",
  sharedOne: "26262626-2626-4626-8626-262626262626",
  sharedTwo: "27272727-2727-4727-8727-272727272727",
  archived: "2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a",
  trashFolder: "28282828-2828-4828-8828-282828282828",
  trashNested: "29292929-2929-4929-8929-292929292929",
  recovery: "30303030-3030-4030-8030-303030303030",
  courseFile: "31313131-3131-4131-8131-313131313131",
  syllabus: "32323232-3232-4232-8232-323232323232",
  projectFile: "33333333-3333-4333-8333-333333333333",
  nestedFile: "34343434-3434-4343-8343-343434343434",
  looseFile: "35353535-3535-4353-8353-353535353535",
  moveFile: "36363636-3636-4363-8363-363636363636",
  protectedFile: "37373737-3737-4373-8373-373737373737",
  sharedFileOne: "38383838-3838-4383-8383-383838383838",
  sharedFileTwo: "39393939-3939-4393-8393-393939393939",
  trashFile: "40404040-4040-4040-8040-404040404040",
  lostFile: "41414141-4141-4141-8141-414141414141",
  trashOperation: "42424242-4242-4242-8242-424242424242",
};
const NOW = "2026-10-09T12:00:00.000Z";
const CREATED = "2026-09-01T00:00:00.000Z";
const course: Course = {
  id: "biology", code: "BIO 201", name: "Biology", credits: 4, instructor: "Dr. Moss", room: "Science 2",
  color: "#b23b53", soft: "#b23b5318", initials: "BIO",
};
const chemistry: Course = {
  id: "chemistry", code: "CHEM 102", name: "Chemistry", credits: 4, instructor: "Dr. Lin", room: "Science 4",
  color: "#8062b2", soft: "#8062b218", initials: "CHEM",
};
const COURSES = [course, chemistry];
const COURSE_DETAILS: Record<string, CourseDetails> = {
  biology: { officeHours: "Tue 10:00", meetings: [], syllabusFileId: ID.syllabus },
  chemistry: { officeHours: "Thu 13:00", meetings: [] },
};

type AccountState = { files: PrivateFile[]; folders: FileFolder[]; bytes: Map<string, Uint8Array> };
type RequestRecord = { path: string; method: string; profileId: string; headers: Record<string, string>; body?: Record<string, unknown> };
type UploadRecord = { id: string; profileId: string; name: string; size: number; type: string; contentType: string; metadata: Record<string, unknown>; attempt: number };
type UploadPlan = { mode: "hold" | "fail-once" | "lose-first-response" | "success" };
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };
type DownloadPlan = "success" | "interrupt" | "hold" | "fail";

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, deny) => { resolve = accept; reject = deny; });
  return { promise, resolve, reject };
}

function makeFolder(id: string, name: string, parent_id: string | null, patch: Partial<FileFolder> = {}): FileFolder {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
    created_at: CREATED, updated_at: "2026-10-04T00:00:00.000Z", archived_at: null,
    semester_label: null, course_name_snapshot: null, course_color_snapshot: null,
    trashed_at: null, trash_operation_id: null, original_parent_id: null,
    deleted_at: null, purge_pending_at: null, original_location_path: null,
    ...patch,
  };
}

function makeFile(id: string, name: string, folder_id: string | null, patch: Partial<PrivateFile> = {}): PrivateFile {
  return {
    id, name, mime_type: "text/plain", size_bytes: 16, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: CREATED,
    updated_at: "2026-10-05T00:00:00.000Z", content_sha256: null, folder_id,
    content_backend: "object", metadata_revision: 1, content_revision: 1,
    trashed_at: null, trash_operation_id: null, original_folder_id: null,
    deleted_at: null, original_location_path: null,
    ...patch,
  };
}

function makeAccount(): AccountState {
  const folders: FileFolder[] = [
    makeFolder(ID.course, "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
    makeFolder(ID.chemistry, "CHEM 102", null, { kind: "course", course_id: "chemistry", course_code: "CHEM 102" }),
    makeFolder(ID.project, "Project Alpha", null),
    makeFolder(ID.nested, "Nested", ID.project),
    makeFolder(ID.destination, "Destination", null),
    makeFolder(ID.protected, "Protected project", null),
    makeFolder(ID.sharedOne, "Shared label", null),
    makeFolder(ID.sharedTwo, "Shared label", null),
    makeFolder(ID.archived, "Archived project", null, { archived_at: "2026-10-02T12:00:00.000Z", semester_label: "Fall 2025" }),
    makeFolder(ID.trashFolder, "Deleted project", null, {
      trashed_at: "2026-10-06T12:00:00.000Z", trash_operation_id: ID.trashOperation,
      original_parent_id: null, parent_id: null, original_location_path: "My files",
    }),
    makeFolder(ID.trashNested, "Deleted drafts", null, {
      trashed_at: "2026-10-06T12:00:00.000Z", trash_operation_id: ID.trashOperation,
      original_parent_id: ID.trashFolder, parent_id: null, original_location_path: "My files / Deleted project",
    }),
  ];
  const files: PrivateFile[] = [
    makeFile(ID.courseFile, "Course plan.pdf", ID.course, { mime_type: "application/pdf", course_id: "biology", size_bytes: 28 }),
    makeFile(ID.syllabus, "Attached syllabus.pdf", ID.protected, { mime_type: "application/pdf", course_id: "biology", kind: "syllabus", size_bytes: 23 }),
    makeFile(ID.projectFile, "Project brief.txt", ID.project, { size_bytes: 30 }),
    makeFile(ID.nestedFile, "Nested note.txt", ID.nested, { size_bytes: 27 }),
    makeFile(ID.looseFile, "Loose read.txt", null, { size_bytes: 17 }),
    makeFile(ID.moveFile, "Move me.txt", null, { size_bytes: 20, course_id: "biology", assignment_id: "51515151-5151-4151-8151-515151515151" }),
    makeFile(ID.protectedFile, "Protected note.txt", ID.protected, { size_bytes: 24 }),
    makeFile(ID.sharedFileOne, "notes.txt", ID.sharedOne, { size_bytes: 10 }),
    makeFile(ID.sharedFileTwo, "notes.txt", ID.sharedTwo, { size_bytes: 11 }),
    makeFile(ID.trashFile, "Deleted note.txt", null, {
      trashed_at: "2026-10-06T12:00:00.000Z", trash_operation_id: ID.trashOperation,
      original_folder_id: ID.trashNested, original_location_path: "My files / Deleted project / Deleted drafts",
      size_bytes: 14,
    }),
    makeFile(ID.lostFile, "Recovered handout.txt", null, {
      trashed_at: "2026-10-07T12:00:00.000Z", trash_operation_id: "43434343-4343-4343-8343-434343434343",
      original_folder_id: "44444444-4444-4444-8444-444444444444", original_location_path: "My files / Missing folder",
      size_bytes: 22,
    }),
  ];
  const contents = new Map<string, string>([
    [ID.courseFile, "BIO 201 course plan bytes."],
    [ID.syllabus, "Attached syllabus bytes."],
    [ID.projectFile, "Project brief data."],
    [ID.nestedFile, "Nested planning note."],
    [ID.looseFile, "Loose reader data."],
    [ID.moveFile, "File awaiting move."],
    [ID.protectedFile, "Protected syllabus child."],
    [ID.sharedFileOne, "First duplicate name."],
    [ID.sharedFileTwo, "Second duplicate name."],
    [ID.trashFile, "Deleted nested content."],
    [ID.lostFile, "Recovered content."],
  ]);
  return { folders, files, bytes: new Map([...contents].map(([id, value]) => [id, new TextEncoder().encode(value)])) };
}

const accounts = new Map<string, AccountState>([[PROFILE_A, makeAccount()], [PROFILE_B, makeAccount()]]);
const requests: RequestRecord[] = [];
const uploadLog: UploadRecord[] = [];
const uploadPlans = new Map<string, UploadPlan>();
const uploadAttempts = new Map<string, number>();
const uploadHolds = new Map<string, Deferred<void>>();
const trashReceipts: TrashUndoReceipt[] = [];
const plannedZipEntries: string[] = [];
const zipBlobs: Blob[] = [];
const anchorClicks: string[] = [];
let downloadPlan: DownloadPlan = "success";
let heldDownload: Deferred<Response> | null = null;
let idCounter = 0;
let root: Root | null = null;

function account(profileId: string): AccountState {
  const value = accounts.get(profileId);
  if (!value) throw new Error(`Unknown fixture account ${profileId}`);
  return value;
}

function withProfile<T extends object>(row: T, profileId: string) {
  return { ...structuredClone(row), profile_id: profileId };
}

function activeFiles(profileId: string) { return account(profileId).files.filter((file) => !file.trashed_at && !file.deleted_at); }
function trashedFiles(profileId: string) { return account(profileId).files.filter((file) => file.trashed_at && !file.deleted_at); }
function activeFolders(profileId: string) { return account(profileId).folders.filter((folder) => !folder.archived_at && !folder.trashed_at && !folder.deleted_at); }
function archivedFolders(profileId: string) { return account(profileId).folders.filter((folder) => folder.archived_at && !folder.trashed_at && !folder.deleted_at); }
function trashedFolders(profileId: string) { return account(profileId).folders.filter((folder) => folder.trashed_at && !folder.deleted_at); }

function pathForFolder(profileId: string, folderId: string | null): string {
  const state = account(profileId);
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId = folderId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = state.folders.find((item) => item.id === currentId);
    if (!folder) break;
    path.unshift(folder.name);
    currentId = folder.parent_id;
  }
  return path.length ? `My files / ${path.join(" / ")}` : "My files";
}

function descendantFolderIds(profileId: string, rootId: string): Set<string> {
  const folders = account(profileId).folders;
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parent_id && ids.has(folder.parent_id) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; }
    }
  }
  return ids;
}

function isDescendantFolder(profileId: string, folderId: string, ancestorId: string): boolean {
  let current = account(profileId).folders.find((folder) => folder.id === folderId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = current.parent_id ? account(profileId).folders.find((folder) => folder.id === current!.parent_id) : undefined;
  }
  return false;
}

function operationRoots(profileId: string, items: SelectedDownloadItem[]) {
  return items.filter((item) => !items.some((candidate) => candidate.type === "folder" && candidate.id !== item.id &&
    (item.type === "folder" ? isDescendantFolder(profileId, item.id, candidate.id) : account(profileId).files.find((file) => file.id === item.id)?.folder_id
      ? isDescendantFolder(profileId, account(profileId).files.find((file) => file.id === item.id)!.folder_id!, candidate.id)
      : false)));
}

async function zipResponse(profileId: string, items: SelectedDownloadItem[], mode: DownloadPlan, signal?: AbortSignal): Promise<Response> {
  const state = account(profileId);
  for (const item of items) {
    const row = item.type === "file" ? state.files.find((file) => file.id === item.id) : state.folders.find((folder) => folder.id === item.id);
    const revision = row && item.type === "file" ? (row as PrivateFile).metadata_revision : row && item.type === "folder" ? (row as FileFolder).revision : undefined;
    if (!row || revision !== item.revision) return Response.json({ error: "A selected item changed." }, { status: 409 });
  }
  const roots = operationRoots(profileId, items);
  const selectedFiles: SelectedDownloadFile[] = [];
  const selectedFolders: SelectedDownloadFolder[] = [];
  roots.forEach((rootItem, index) => {
    const ordinal = index + 1;
    if (rootItem.type === "file") {
      const file = state.files.find((candidate) => candidate.id === rootItem.id)!;
      selectedFiles.push({ ...structuredClone(file), download_root_type: "file", download_root_id: file.id, download_root_ordinal: ordinal });
      return;
    }
    const folderIds = descendantFolderIds(profileId, rootItem.id);
    for (const folder of state.folders.filter((candidate) => folderIds.has(candidate.id))) {
      selectedFolders.push({ ...structuredClone(folder), download_root_type: "folder", download_root_id: rootItem.id, download_root_ordinal: ordinal });
    }
    for (const file of state.files.filter((candidate) => candidate.folder_id && folderIds.has(candidate.folder_id) && !candidate.trashed_at && !candidate.deleted_at)) {
      selectedFiles.push({ ...structuredClone(file), download_root_type: "folder", download_root_id: rootItem.id, download_root_ordinal: ordinal });
    }
  });
  const planned = planSelectedDownload(items, { files: selectedFiles, folders: selectedFolders, documents: [] });
  plannedZipEntries.splice(0, plannedZipEntries.length, ...planned.map((entry) => entry.name));
  const entries: ZipEntry[] = planned.map((entry) => ({
    name: entry.name,
    bytes: async (signal) => {
      if (signal?.aborted) throw signal.reason;
      if (entry.type === "directory") return new Uint8Array();
      return new Uint8Array(state.bytes.get(entry.file.id) ?? []);
    },
  }));
  const headers = {
    "content-type": "application/zip",
    "content-disposition": "attachment; filename=eduessentials-selected-files.zip",
  };
  if (mode === "fail") return Response.json({ error: "ZIP service unavailable." }, { status: 503 });
  if (mode === "hold") {
    const held = deferred<Response>();
    heldDownload = held;
    if (signal?.aborted) return Promise.reject(signal.reason);
    const abort = () => held.reject(signal?.reason ?? new DOMException("The selected ZIP was aborted.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    try { return await held.promise; }
    finally { signal?.removeEventListener("abort", abort); if (heldDownload === held) heldDownload = null; }
  }
  const complete = zipStream(entries);
  if (mode === "interrupt") {
    const reader = complete.getReader();
    const first = await reader.read();
    const interrupted = new ReadableStream<Uint8Array>({
      start(controller) {
        if (first.value) controller.enqueue(first.value);
        queueMicrotask(() => controller.error(new Error("Fixture ZIP connection interrupted.")));
      },
    });
    return new Response(interrupted, { headers });
  }
  return new Response(complete, { headers });
}

function makeError(message: string, status = 503) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

async function fetchFixture(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), window.location.origin);
  const path = `${url.pathname}${url.search}`;
  const method = init.method ?? request?.method ?? "GET";
  const headers = new Headers(init.headers ?? request?.headers);
  const profileId = headers.get("x-profile-id") ?? "";
  let body: Record<string, unknown> | undefined;
  if (typeof init.body === "string") {
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { return makeError("Invalid fixture JSON.", 400); }
  }
  const headersRecord = Object.fromEntries(headers.entries());
  requests.push({ path, method, profileId, headers: headersRecord, ...(body ? { body: structuredClone(body) } : {}) });
  if (!accounts.has(profileId)) return makeError("Unknown fixture account.", 401);

  if (method === "GET") {
    if (url.pathname === "/api/files") {
      const view = url.searchParams.get("view");
      const rows = view === "trash" ? trashedFiles(profileId) : activeFiles(profileId);
      return Response.json({ files: structuredClone(rows).map((file) => withProfile(file, profileId)), activities: { files: [] } });
    }
    if (url.pathname === "/api/file-folders") {
      const view = url.searchParams.get("view");
      const rows = view === "trash" ? trashedFolders(profileId) : view === "archives" ? archivedFolders(profileId) : activeFolders(profileId);
      return Response.json({ folders: structuredClone(rows).map((folder) => withProfile(folder, profileId)), activities: { folders: [] } });
    }
    return makeError(`Unexpected fixture GET ${path}`, 404);
  }

  if (method === "POST" && url.pathname === "/api/files/download") {
    const items = Array.isArray(body?.items) ? body.items as SelectedDownloadItem[] : [];
    const currentPlan = downloadPlan;
    downloadPlan = "success";
    return zipResponse(profileId, items, currentPlan, init.signal ?? request?.signal);
  }

  if (method === "POST" && url.pathname === "/api/files/actions") {
    const state = account(profileId);
    const action = body?.action;
    const items = Array.isArray(body?.items) ? body.items as Array<{ type: "file" | "folder"; id: string; revision: number }> : [];
    if (action === "move") {
      const destinationId = typeof body?.destinationId === "string" ? body.destinationId : null;
      const resultFiles: PrivateFile[] = [];
      const resultFolders: FileFolder[] = [];
      for (const item of items) {
        if (item.type === "file") {
          const file = state.files.find((row) => row.id === item.id);
          if (!file || file.metadata_revision !== item.revision) return makeError("File revision changed.", 409);
          file.folder_id = destinationId;
          file.metadata_revision += 1;
          file.updated_at = NOW;
          resultFiles.push(file);
        } else {
          const folder = state.folders.find((row) => row.id === item.id);
          if (!folder || folder.revision !== item.revision || folder.kind === "course") return makeError("Folder revision changed.", 409);
          folder.parent_id = destinationId;
          folder.revision += 1;
          folder.updated_at = NOW;
          resultFolders.push(folder);
        }
      }
      return Response.json({ files: resultFiles.map((file) => withProfile(file, profileId)), folders: resultFolders.map((folder) => withProfile(folder, profileId)) });
    }

    if (action === "trash") {
      const filesOut: PrivateFile[] = [];
      const foldersOut: FileFolder[] = [];
      for (const item of items) {
        if (item.type === "file") {
          const file = state.files.find((row) => row.id === item.id);
          if (!file || file.metadata_revision !== item.revision) return makeError("File revision changed.", 409);
          const originalFolder = file.folder_id;
          file.trashed_at = NOW;
          file.trash_operation_id = ID.trashOperation;
          file.original_folder_id = originalFolder;
          file.original_location_path = pathForFolder(profileId, originalFolder);
          file.folder_id = null;
          file.metadata_revision += 1;
          file.updated_at = NOW;
          filesOut.push(file);
          continue;
        }
        const folder = state.folders.find((row) => row.id === item.id);
        if (!folder || folder.revision !== item.revision || folder.kind === "course") return makeError("Folder revision changed.", 409);
        const ids = descendantFolderIds(profileId, folder.id);
        const originalPaths = new Map([...ids].map((id) => {
          const folder = state.folders.find((candidate) => candidate.id === id);
          return [id, pathForFolder(profileId, folder?.parent_id ?? null)];
        }));
        for (const descendant of state.folders.filter((row) => ids.has(row.id))) {
          descendant.original_parent_id = descendant.parent_id;
          descendant.parent_id = null;
          descendant.trashed_at = NOW;
          descendant.trash_operation_id = ID.trashOperation;
          descendant.original_location_path = originalPaths.get(descendant.id) ?? "My files";
          descendant.revision += 1;
          descendant.updated_at = NOW;
          foldersOut.push(descendant);
        }
        for (const file of state.files.filter((row) => row.folder_id && ids.has(row.folder_id))) {
          const originalFolder = file.folder_id;
          file.original_folder_id = originalFolder;
          file.folder_id = null;
          file.trashed_at = NOW;
          file.trash_operation_id = ID.trashOperation;
          file.original_location_path = pathForFolder(profileId, originalFolder);
          file.metadata_revision += 1;
          file.updated_at = NOW;
          filesOut.push(file);
        }
      }
      return Response.json({ files: filesOut.map((file) => withProfile(file, profileId)), folders: foldersOut.map((folder) => withProfile(folder, profileId)), recoveryFolder: null });
    }

    if (action === "restore") {
      const filesOut: PrivateFile[] = [];
      const foldersOut: FileFolder[] = [];
      let recovery: FileFolder | null = null;
      for (const item of items) {
        if (item.type === "file") {
          const file = state.files.find((row) => row.id === item.id);
          if (!file || file.metadata_revision !== item.revision || !file.trashed_at) return makeError("File revision changed.", 409);
          const parent = file.original_folder_id ? state.folders.find((folder) => folder.id === file.original_folder_id && !folder.trashed_at && !folder.deleted_at) : undefined;
          if (file.original_folder_id && !parent) {
            recovery = state.folders.find((folder) => folder.id === ID.recovery) ?? makeFolder(ID.recovery, "Restored files", null);
            if (!state.folders.some((folder) => folder.id === recovery!.id)) state.folders.push(recovery);
          }
          file.folder_id = parent?.id ?? (recovery ? recovery.id : null);
          file.original_folder_id = null;
          file.trashed_at = null;
          file.trash_operation_id = null;
          file.original_location_path = null;
          file.metadata_revision += 1;
          file.updated_at = NOW;
          filesOut.push(file);
          continue;
        }
        const folder = state.folders.find((row) => row.id === item.id);
        if (!folder || folder.revision !== item.revision || !folder.trashed_at) return makeError("Folder revision changed.", 409);
        const operationId = folder.trash_operation_id;
        if (!operationId) return makeError("Folder Trash operation is missing.", 409);
        const folderId = folder.id;
        const descendants = state.folders.filter((row) => {
          if (!row.trashed_at || row.trash_operation_id !== operationId) return false;
          if (row.id === folderId) return true;
          const parentId = row.original_parent_id;
          return parentId !== null && isDescendantFolderFromOriginal(state.folders, parentId!, folderId, operationId);
        });
        const idSet = new Set(descendants.map((row) => row.id));
        for (const descendant of descendants) {
          const target = descendant.original_parent_id;
          const targetExists = target === null || state.folders.some((candidate) => candidate.id === target && (!candidate.trashed_at || idSet.has(candidate.id)));
          if (target && !targetExists) {
            recovery = state.folders.find((candidate) => candidate.id === ID.recovery) ?? makeFolder(ID.recovery, "Restored files", null);
            if (!state.folders.some((candidate) => candidate.id === recovery!.id)) state.folders.push(recovery);
          }
          descendant.parent_id = targetExists ? target : recovery?.id ?? null;
          descendant.original_parent_id = null;
          descendant.trashed_at = null;
          descendant.trash_operation_id = null;
          descendant.original_location_path = null;
          descendant.revision += 1;
          descendant.updated_at = NOW;
          foldersOut.push(descendant);
        }
        for (const file of state.files.filter((row) => row.trashed_at && row.trash_operation_id === operationId &&
          Boolean(row.original_folder_id && idSet.has(row.original_folder_id)))) {
          file.folder_id = file.original_folder_id;
          file.original_folder_id = null;
          file.trashed_at = null;
          file.trash_operation_id = null;
          file.original_location_path = null;
          file.metadata_revision += 1;
          file.updated_at = NOW;
          filesOut.push(file);
        }
      }
      return Response.json({ files: filesOut.map((file) => withProfile(file, profileId)), folders: foldersOut.map((folder) => withProfile(folder, profileId)), recoveryFolder: recovery ? withProfile(recovery, profileId) : null });
    }
    return makeError(`Unknown Files action ${String(action)}.`, 400);
  }

  return makeError(`Unexpected fixture request: ${method} ${path}`, 404);
}

function isDescendantFolderFromOriginal(folders: FileFolder[], possibleParentId: string, rootId: string, operationId: string): boolean {
  const visited = new Set<string>();
  let currentId: string | null = possibleParentId;
  while (currentId && !visited.has(currentId)) {
    if (currentId === rootId) return true;
    visited.add(currentId);
    const current = folders.find((folder) => folder.id === currentId && folder.trash_operation_id === operationId);
    currentId = current?.original_parent_id ?? null;
  }
  return false;
}

function currentActiveProfile() { return document.querySelector<HTMLElement>("[data-fixture-profile]")?.dataset.fixtureProfile ?? PROFILE_A; }

class FixtureXMLHttpRequest {
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  status = 0;
  responseText = "";
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  method = "";
  url = "";
  body: File | null = null;
  private headers = new Map<string, string>();
  private aborted = false;

  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
  getRequestHeader(name: string) { return this.headers.get(name.toLowerCase()) ?? ""; }

  send(file: File) {
    this.body = file;
    void this.uploadRequest(file);
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.onabort?.();
  }

  private async uploadRequest(file: File) {
    const url = new URL(this.url, window.location.origin);
    const id = url.searchParams.get("id") ?? "";
    const profileId = this.getRequestHeader("x-profile-id");
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(decodeURIComponent(this.getRequestHeader("x-file-metadata"))) as Record<string, unknown>; }
    catch { this.status = 400; this.responseText = JSON.stringify({ error: "Invalid upload metadata." }); this.onload?.(); return; }
    const attempt = (uploadAttempts.get(id) ?? 0) + 1;
    uploadAttempts.set(id, attempt);
    uploadLog.push({ id, profileId, name: file.name, size: file.size, type: file.type, contentType: this.getRequestHeader("content-type"), metadata: structuredClone(metadata), attempt });
    if (this.method !== "POST" || url.pathname !== "/api/files" || !profileId) {
      this.status = 400; this.responseText = JSON.stringify({ error: "Invalid upload request." }); this.onload?.(); return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 70));
    if (this.aborted) return;
    const partial = Math.max(1, Math.floor(file.size * 0.46));
    this.upload.onprogress?.({ lengthComputable: true, loaded: partial, total: file.size } as ProgressEvent);
    const plan = uploadPlans.get(file.name) ?? { mode: "success" };
    if (plan.mode === "hold" && attempt === 1) {
      const hold = deferred<void>();
      uploadHolds.set(file.name, hold);
      await hold.promise;
    }
    if (this.aborted) return;
    if (plan.mode === "fail-once" && attempt === 1) {
      this.status = 503;
      this.responseText = JSON.stringify({ error: "Fixture upload connection failed." });
      this.onload?.();
      return;
    }
    const state = accounts.get(profileId);
    if (!state) { this.status = 401; this.responseText = JSON.stringify({ error: "Unknown profile." }); this.onload?.(); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const content_sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    let canonical = state.files.find((row) => row.id === id);
    if (!canonical) {
      canonical = makeFile(id, String(metadata.name), typeof metadata.folderId === "string" ? metadata.folderId : null, {
        mime_type: file.type || "application/octet-stream", size_bytes: file.size,
        course_id: typeof metadata.courseId === "string" && metadata.courseId ? metadata.courseId : null,
        assignment_id: typeof metadata.assignmentId === "string" && metadata.assignmentId ? metadata.assignmentId : null,
        kind: metadata.kind === "syllabus" || metadata.kind === "class-image" || metadata.kind === "attachment" ? metadata.kind : "resource",
        content_sha256, content_backend: "object", metadata_revision: 1, content_revision: 1,
        updated_at: NOW,
      });
      state.files.unshift(canonical);
      state.bytes.set(id, bytes);
    } else if (canonical.content_sha256 !== content_sha256) {
      this.status = 409; this.responseText = JSON.stringify({ error: "Upload ID already belongs to different content." }); this.onload?.(); return;
    }
    this.upload.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size } as ProgressEvent);
    if (plan.mode === "lose-first-response" && attempt === 1) {
      this.onerror?.();
      return;
    }
    if (this.aborted) return;
    this.status = 201;
    this.responseText = JSON.stringify({ file: withProfile(canonical, profileId) });
    this.onload?.();
  }
}

globalThis.fetch = fetchFixture;
globalThis.XMLHttpRequest = FixtureXMLHttpRequest as unknown as typeof XMLHttpRequest;
const actualCreateObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (object: Blob | MediaSource) => {
  if (object instanceof Blob) zipBlobs.push(object);
  return actualCreateObjectURL(object);
};
const actualAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function recordDownloadClick() {
  anchorClicks.push(this.download);
  actualAnchorClick.call(this);
};
crypto.randomUUID = () => {
  idCounter += 1;
  return `aaaaaaaa-0000-4000-8000-${String(idCounter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
};

function BrowserFixture() {
  const [session, setSession] = useState({ profileId: PROFILE_A, generation: 0 });
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [preferences, setPreferences] = useState<FilesBrowserPreferences>({ filter: "all", fileType: "all", sortBy: "name", sortDirection: "asc", view: "list", includeArchived: false });
  const [uploadDialog, setUploadDialog] = useState<{ profileId: string; folderId: string | null; courseId: string } | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const store = usePrivateFiles(session.profileId);
  const refreshPrivateFiles = store.refresh;
  const uploads = useFileUploads(session, store, async (_file, signal) => {
    await refreshPrivateFiles(signal, true);
    if (!signal.aborted) setDataRevision((current) => current + 1);
  }, true);

  useEffect(() => {
    const switchProfile = (event: Event) => {
      const profileId = (event as CustomEvent<string>).detail;
      setSession((current) => ({ profileId, generation: current.generation + 1 }));
    };
    window.addEventListener("fixture-switch-profile", switchProfile);
    return () => window.removeEventListener("fixture-switch-profile", switchProfile);
  }, []);

  const onOrganizationSaved = useCallback(async (signal?: AbortSignal) => {
    await refreshPrivateFiles(signal, true);
    if (!signal?.aborted) setDataRevision((current) => current + 1);
  }, [refreshPrivateFiles]);
  const enqueueUploads = uploads.enqueue;
  const openUpload = useCallback((files: File[], folderId: string | null, courseId: string) => {
    setUploadDialog({ profileId: session.profileId, folderId, courseId });
    enqueueUploads(files, { folderId, courseId });
  }, [session.profileId, enqueueUploads]);

  return createElement(Fragment, null,
    createElement(FilesBrowser, {
      profileId: session.profileId,
      courses: COURSES,
      assignments: [],
      courseDetails: COURSE_DETAILS,
      store: store as never,
      layout,
      onLayoutChange: setLayout,
      onUpload: (folderId: string | null, courseId: string) => setUploadDialog({ profileId: session.profileId, folderId, courseId }),
      onUploadFiles: openUpload,
      onOpen: () => {},
      onEdit: () => {},
      onAttachSyllabus: () => {},
      onOrganizationSaved,
      onOrganizationStateChange: () => {},
      onTrashCompleted: (receipt: TrashUndoReceipt) => trashReceipts.push(structuredClone(receipt)),
      preferences,
      onPreferencesChange: setPreferences,
      canWrite: true,
      dataRevision,
    }),
    uploadDialog && createElement(FileUploadDialog, {
      key: `upload-dialog:${uploadDialog.profileId}:${uploadDialog.folderId ?? "root"}`,
      queue: uploads,
      currentProfileId: session.profileId,
      defaults: { folderId: uploadDialog.folderId, courseId: uploadDialog.courseId },
      canWrite: uploadDialog.profileId === session.profileId,
      onClose: () => setUploadDialog(null),
    }),
    createElement("div", { hidden: true, "data-fixture-profile": session.profileId, "data-fixture-generation": session.generation }),
  );
}

declare global {
  interface Window {
    __filesBulkFixture: {
      requests: RequestRecord[];
      getFiles(profileId?: string): PrivateFile[];
      getFolders(profileId?: string): FileFolder[];
      getUploads(): UploadRecord[];
      getTrashReceipts(): TrashUndoReceipt[];
      getPlannedZipEntries(): string[];
      getZipCapture(): Promise<{ type: string; size: number; bytes: number[] } | null>;
      getAnchorClicks(): string[];
      getZipCaptureCount(): number;
      sameUploadFileReference(name: string): boolean;
      currentProfile(): string;
      currentGeneration(): number;
      setUploadPlan(name: string, mode: UploadPlan["mode"]): void;
      releaseUpload(name: string): void;
      setDownloadPlan(mode: DownloadPlan): void;
      releaseDownload(): void;
      switchProfile(profileId: string): void;
      dispatchExternalDrop(targetName: string, fileName: string, body: string): void;
      resetRequests(): void;
    };
  }
}

window.__filesBulkFixture = {
  requests,
  getFiles: (profileId = currentActiveProfile()) => structuredClone(account(profileId).files),
  getFolders: (profileId = currentActiveProfile()) => structuredClone(account(profileId).folders),
  getUploads: () => uploadLog.map(({ id, profileId, name, size, type, contentType, metadata, attempt }) => ({ id, profileId, name, size, type, contentType, metadata: structuredClone(metadata), attempt })),
  getTrashReceipts: () => structuredClone(trashReceipts),
  getPlannedZipEntries: () => [...plannedZipEntries],
  getZipCapture: async () => {
    const blob = zipBlobs.at(-1);
    return blob ? { type: blob.type, size: blob.size, bytes: [...new Uint8Array(await blob.arrayBuffer())] } : null;
  },
  getAnchorClicks: () => [...anchorClicks],
  getZipCaptureCount: () => zipBlobs.length,
  sameUploadFileReference: (name) => {
    const matching = uploadLog.filter((row) => row.name === name);
    if (matching.length < 2) return false;
    const records = (window as Window & { __bulkUploadFileRefs?: Map<string, File[]> }).__bulkUploadFileRefs;
    const files = records?.get(name) ?? [];
    return files.length > 1 && files.every((file) => file === files[0]);
  },
  currentProfile: currentActiveProfile,
  currentGeneration: () => Number(document.querySelector<HTMLElement>("[data-fixture-generation]")?.dataset.fixtureGeneration ?? 0),
  setUploadPlan: (name, mode) => uploadPlans.set(name, { mode }),
  releaseUpload: (name) => { uploadHolds.get(name)?.resolve(); uploadHolds.delete(name); },
  setDownloadPlan: (mode) => { downloadPlan = mode; },
  releaseDownload: () => {
    heldDownload?.resolve(Response.json({ error: "The held ZIP response should have been aborted." }, { status: 503 }));
    heldDownload = null;
  },
  switchProfile: (profileId) => window.dispatchEvent(new CustomEvent("fixture-switch-profile", { detail: profileId })),
  dispatchExternalDrop: (targetName, fileName, body) => {
    const row = [...document.querySelectorAll<HTMLElement>(".files-item")].find((item) => item.querySelector(".files-item-title strong")?.textContent?.trim() === targetName);
    if (!row) throw new Error(`Could not find external-drop target ${targetName}`);
    const file = new File([body], fileName, { type: "text/plain", lastModified: 1_791_521_640_000 });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    row.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    row.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  },
  resetRequests: () => { requests.splice(0); },
};

const fileRefs = new Map<string, File[]>();
const OriginalXhr = FixtureXMLHttpRequest.prototype.send;
FixtureXMLHttpRequest.prototype.send = function sendWithReferenceRecord(file: File) {
  const saved = fileRefs.get(file.name) ?? [];
  saved.push(file);
  fileRefs.set(file.name, saved);
  (window as Window & { __bulkUploadFileRefs?: Map<string, File[]> }).__bulkUploadFileRefs = fileRefs;
  return OriginalXhr.call(this, file);
};

const mount = () => {
  const element = document.getElementById("root");
  if (!element) throw new Error("Files bulk fixture requires #root.");
  root = createRoot(element);
  root.render(createElement(BrowserFixture));
};
mount();
window.addEventListener("pagehide", () => root?.unmount(), { once: true });
