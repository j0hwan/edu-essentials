import { createElement, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import FilesBrowser from "../../app/files-browser";
import { NativeDocumentEditor } from "../../app/native-document-editor";
import { FilePreview } from "../../app/private-files";
import { useFileActivity } from "../../app/use-file-activity";
import type { Course, CourseDetails } from "../../lib/academics";
import type { FileFolder } from "../../lib/file-organization";
import type { FilesBrowserPreferences } from "../../lib/files-browser";
import type { PrivateFile } from "../../lib/files";

const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = {
  biology: "11111111-1111-4111-8111-111111111111",
  projects: "22222222-2222-4222-8222-222222222222",
  design: "33333333-3333-4333-8333-333333333333",
  biologyLabs: "44444444-4444-4444-8444-444444444444",
  archive: "55555555-5555-4555-8555-555555555555",
  archiveShelf: "66666666-6666-4666-8666-666666666666",
  trashFolder: "77777777-7777-4777-8777-777777777777",
  alpha: "88888888-8888-4888-8888-888888888888",
  biologyText: "99999999-9999-4999-8999-999999999999",
  broken: "10101010-1010-4010-8010-101010101010",
  native: "12121212-1212-4212-8212-121212121212",
  rootPlanning: "13131313-1313-4313-8313-131313131313",
  csv: "14141414-1414-4414-8414-141414141414",
  projectNote: "15151515-1515-4515-8515-151515151515",
  labNote: "16161616-1616-4616-8616-161616161616",
  archivePdf: "17171717-1717-4717-8717-171717171717",
  trashFile: "18181818-1818-4818-8818-181818181818",
};
const FIXED_NOW = "2026-10-08T12:00:00.000Z";
const BASE_CREATED = "2026-09-01T00:00:00.000Z";
const NATIVE_BODY = "Biology appears in this document body only.\nNative notes are private.";
const COURSE_RECORDS: Course[] = [
  { id: "biology", code: "BIO 201", name: "Biology", credits: 4, instructor: "Dr. Moss", room: "Science 2", color: "#b23b53", soft: "#b23b5318", initials: "BIO" },
  { id: "chemistry", code: "CHEM 102", name: "Chemistry", credits: 4, instructor: "Dr. Lin", room: "Science 4", color: "#8062b2", soft: "#8062b218", initials: "CHEM" },
  { id: "old-biology", code: "BIO 199", name: "History of Biology", credits: 3, instructor: "Dr. Reed", room: "Science 1", color: "#335577", soft: "#33557718", initials: "BIO" },
];
const ASSIGNMENT_RECORDS = [
  { id: "assignment-lab", title: "Lab report", courseId: "biology" },
  { id: "assignment-review", title: "Course review", courseId: "chemistry" },
];
const COURSE_DETAILS: Record<string, CourseDetails> = {
  biology: { officeHours: "Tue 10:00", meetings: [{ id: "bio-meeting", days: [1, 3], start: "09:00", end: "10:15", location: "Science 2", from: "2026-09-01", until: "2026-12-18" }] },
  chemistry: { officeHours: "Thu 13:00", meetings: [{ id: "chem-meeting", days: [2, 4], start: "13:30", end: "14:45", location: "Science 4", from: "2026-09-01", until: "2026-12-18" }] },
};

function makeFolder(id: string, name: string, parent_id: string | null, patch: Partial<FileFolder> = {}): FileFolder {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
    created_at: BASE_CREATED, updated_at: "2026-10-03T00:00:00.000Z", archived_at: null,
    semester_label: null, course_name_snapshot: null, course_color_snapshot: null,
    trashed_at: null, trash_operation_id: null, original_parent_id: null,
    deleted_at: null, purge_pending_at: null, original_location_path: null,
    ...patch,
  };
}

function makeFile(id: string, name: string, folder_id: string | null, patch: Partial<PrivateFile> = {}): PrivateFile {
  return {
    id, name, mime_type: "text/plain", size_bytes: 128, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: BASE_CREATED,
    updated_at: "2026-10-04T00:00:00.000Z", content_sha256: null, folder_id,
    content_backend: "object", metadata_revision: 1, content_revision: 1,
    trashed_at: null, trash_operation_id: null, original_folder_id: null,
    deleted_at: null, original_location_path: null,
    ...patch,
  };
}

const initialFolders: FileFolder[] = [
  makeFolder(ID.biology, "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201", updated_at: "2026-10-02T00:00:00.000Z" }),
  makeFolder(ID.projects, "Personal Projects", null, { updated_at: "2026-10-03T00:00:00.000Z" }),
  makeFolder(ID.design, "Design drafts", null, { updated_at: "2026-10-01T00:00:00.000Z" }),
  makeFolder(ID.biologyLabs, "Lab notes", ID.biology, { kind: "custom", course_id: null }),
  makeFolder(ID.archive, "Old Biology", null, { kind: "course", course_id: "old-biology", course_code: "BIO 199", archived_at: "2026-02-01T00:00:00.000Z", semester_label: "Fall 2025", course_name_snapshot: "History of Biology", course_color_snapshot: "#335577" }),
  makeFolder(ID.archiveShelf, "Archived shelf", ID.archive, { archived_at: "2026-02-01T00:00:00.000Z", semester_label: "Fall 2025", course_name_snapshot: "History of Biology", course_color_snapshot: "#335577" }),
  makeFolder(ID.trashFolder, "Deleted project", null, { trashed_at: "2026-10-06T00:00:00.000Z", original_parent_id: null, original_location_path: "My files" }),
];

const initialFiles: PrivateFile[] = [
  makeFile(ID.alpha, "Alpha guide.pdf", null, { mime_type: "application/pdf", size_bytes: 512, course_id: "biology", updated_at: "2026-10-04T00:00:00.000Z" }),
  makeFile(ID.biologyText, "BIO 201 notes.txt", null, { course_id: "biology", size_bytes: 86, updated_at: "2026-10-06T00:00:00.000Z" }),
  makeFile(ID.broken, "Broken preview.txt", null, { size_bytes: 24, updated_at: "2026-10-02T00:00:00.000Z" }),
  makeFile(ID.native, "Native plan.txt", null, { content_backend: "native-text", size_bytes: new TextEncoder().encode(NATIVE_BODY).byteLength, updated_at: "2026-10-07T00:00:00.000Z" }),
  makeFile(ID.rootPlanning, "Root planning.txt", ID.projects, { size_bytes: 52, updated_at: "2026-10-05T00:00:00.000Z" }),
  makeFile(ID.csv, "Zeta records.csv", null, { mime_type: "text/csv", size_bytes: 250, course_id: "chemistry", updated_at: "2026-10-01T00:00:00.000Z" }),
  makeFile(ID.projectNote, "Project note.txt", ID.projects, { size_bytes: 45, updated_at: "2026-10-03T00:00:00.000Z" }),
  makeFile(ID.labNote, "Lab results.txt", ID.biologyLabs, { course_id: "biology", assignment_id: "assignment-lab", size_bytes: 64, updated_at: "2026-10-05T00:00:00.000Z" }),
  makeFile(ID.archivePdf, "Archived specimen.pdf", ID.archiveShelf, { mime_type: "application/pdf", size_bytes: 93, course_id: "old-biology", updated_at: "2026-02-01T00:00:00.000Z" }),
  makeFile(ID.trashFile, "Deleted notes.txt", ID.trashFolder, { trashed_at: "2026-10-06T00:00:00.000Z", original_folder_id: ID.projects, original_location_path: "My files / Personal Projects", updated_at: "2026-09-30T00:00:00.000Z" }),
];

type Activity = { starred_at: string | null; last_opened_at: string | null };
type RecordedRequest = { path: string; method: string; profileId: string; body?: Record<string, unknown>; activityRefresh?: boolean };
type NativeDocument = { file: PrivateFile; body: string };
const durableFiles = structuredClone(initialFiles);
const folders = structuredClone(initialFolders);
const fileActivity = new Map<string, Activity>([
  [ID.native, { starred_at: null, last_opened_at: null }],
]);
const folderActivity = new Map<string, Activity>();
const requests: RecordedRequest[] = [];
const academicRecords = structuredClone({ courses: COURSE_RECORDS, assignments: ASSIGNMENT_RECORDS, courseDetails: COURSE_DETAILS });
const nativeDocuments = new Map<string, NativeDocument>([
  [ID.native, { file: durableFiles.find((file) => file.id === ID.native)!, body: NATIVE_BODY }],
]);
let failNextGetPath = "";
let failNextActivityRefresh = false;
let activityClock = Date.parse(FIXED_NOW);
let root: Root | null = null;
let deterministicIdIndex = 0;
const deterministicIds = [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "aaaaaaaa-0000-4000-8000-000000000002",
  "aaaaaaaa-0000-4000-8000-000000000003",
  "aaaaaaaa-0000-4000-8000-000000000004",
];
const realRandomUUID = crypto.randomUUID.bind(crypto);
crypto.randomUUID = () => deterministicIds[deterministicIdIndex++ % deterministicIds.length] as `${string}-${string}-${string}-${string}-${string}`;

function nextActivityTime() {
  activityClock += 1000;
  return new Date(activityClock).toISOString();
}

function folderIsArchived(folder: FileFolder) {
  let current: FileFolder | undefined = folder;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.archived_at !== null) return true;
    visited.add(current.id);
    current = current.parent_id ? folders.find((row) => row.id === current!.parent_id) : undefined;
  }
  return false;
}

function activityRows<T extends { id: string }>(rows: T[], source: Map<string, Activity>, key: "file_id" | "folder_id") {
  return rows.map((row) => ({ [key]: row.id, profile_id: PROFILE_ID, ...(source.get(row.id) ?? { starred_at: null, last_opened_at: null }) }));
}

function activeFiles() {
  return durableFiles.filter((file) => file.trashed_at === null && file.deleted_at == null);
}
function trashedFiles() {
  return durableFiles.filter((file) => file.trashed_at !== null && file.deleted_at == null);
}
function activeFolders() {
  return folders.filter((folder) => folder.trashed_at === null && folder.deleted_at == null && !folderIsArchived(folder));
}
function archivedFolders() {
  return folders.filter((folder) => folder.trashed_at === null && folder.deleted_at == null && folderIsArchived(folder));
}
function trashedFolders() {
  return folders.filter((folder) => folder.trashed_at !== null && folder.deleted_at == null);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
function errorResponse(message: string, status = 503) {
  return json({ error: message }, status);
}

function nativeResult(document: NativeDocument) {
  return {
    file: structuredClone(document.file),
    document: { file_id: document.file.id, body: document.body, content_revision: document.file.content_revision },
  };
}

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const request = input instanceof Request ? input : null;
  const rawUrl = request ? request.url : String(input);
  const url = new URL(rawUrl, window.location.origin);
  const method = init.method ?? request?.method ?? "GET";
  const headers = new Headers(init.headers ?? request?.headers);
  const profileId = headers.get("x-profile-id") ?? "";
  const activityRefresh = headers.get("x-fixture-activity-refresh") === "1";
  let body: Record<string, unknown> | undefined;
  if (typeof init.body === "string") {
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { return errorResponse("Invalid fixture JSON.", 400); }
  } else if (request) {
    const clone = request.clone();
    const text = await clone.text();
    if (text) { try { body = JSON.parse(text) as Record<string, unknown>; } catch { return errorResponse("Invalid fixture JSON.", 400); } }
  }
  const path = `${url.pathname}${url.search}`;
  requests.push({ path, method, profileId, ...(body ? { body: structuredClone(body) } : {}), ...(activityRefresh ? { activityRefresh: true } : {}) });
  if (profileId !== PROFILE_ID) return errorResponse("Fixture request used the wrong account.", 401);

  if (method === "GET" && (path.startsWith("/api/files?view=") || path.startsWith("/api/file-folders?view="))) {
    const pathname = url.pathname;
    if (activityRefresh && failNextActivityRefresh) {
      failNextActivityRefresh = false;
      return errorResponse("Fixture Recent refresh failed.");
    }
    if (failNextGetPath && path === failNextGetPath) {
      failNextGetPath = "";
      return errorResponse("Fixture Files refresh failed.");
    }
    const view = url.searchParams.get("view");
    if (pathname === "/api/files") {
      const rows = view === "trash" ? trashedFiles() : activeFiles();
      return json({ files: structuredClone(rows), activities: { files: activityRows(rows, fileActivity, "file_id") } });
    }
    const rows = view === "trash" ? trashedFolders() : view === "archives" ? archivedFolders() : activeFolders();
    return json({ folders: structuredClone(rows), activities: { folders: activityRows(rows, folderActivity, "folder_id") } });
  }

  if (url.pathname === "/api/files/actions" && method === "POST") {
    const action = body?.action;
    const items = Array.isArray(body?.items) ? body.items as Array<{ type?: string; id?: string; revision?: number }> : [];
    if (!["star", "unstar", "open"].includes(String(action)) || items.length !== 1) return errorResponse("Invalid item activity action.", 400);
    const item = items[0];
    const row = item.type === "folder" ? folders.find((folder) => folder.id === item.id) : durableFiles.find((file) => file.id === item.id);
    if (!row || (item.type !== "folder" && item.type !== "file") || item.revision !== (item.type === "folder" ? (row as FileFolder).revision : (row as PrivateFile).metadata_revision)) {
      return errorResponse("Item activity revision mismatch.", 409);
    }
    const source = item.type === "folder" ? folderActivity : fileActivity;
    const previous = source.get(row.id) ?? { starred_at: null, last_opened_at: null };
    const next = {
      starred_at: action === "star" ? nextActivityTime() : action === "unstar" ? null : previous.starred_at,
      last_opened_at: action === "open" ? nextActivityTime() : previous.last_opened_at,
    };
    source.set(row.id, next);
    const activity = { ...(item.type === "file" ? { file_id: row.id } : { folder_id: row.id }), profile_id: PROFILE_ID, ...next };
    return json({
      files: item.type === "file" ? [structuredClone(row)] : [],
      folders: item.type === "folder" ? [structuredClone(row)] : [],
      activities: { files: item.type === "file" ? [activity] : [], folders: item.type === "folder" ? [activity] : [] },
      recoveryFolder: null,
    });
  }

  if (url.pathname === "/api/file-folders" && method === "PUT") {
    const action = body?.action;
    const folder = folders.find((row) => row.id === body?.id);
    if (!folder || body?.revision !== folder.revision) return errorResponse("Folder revision mismatch.", 409);
    if (action === "archive") {
      const semesterLabel = typeof body?.semesterLabel === "string" ? body.semesterLabel : "";
      if (!semesterLabel.trim()) return errorResponse("Missing archive label.", 400);
      folder.revision += 1;
      folder.archived_at = FIXED_NOW;
      folder.semester_label = semesterLabel;
      folder.updated_at = nextActivityTime();
      if (folder.kind === "course") {
        const course = COURSE_RECORDS.find((row) => row.id === folder.course_id);
        folder.course_name_snapshot = course?.name ?? "Course archive";
        folder.course_color_snapshot = course?.color ?? null;
      }
      return json({ folder: { ...structuredClone(folder), profile_id: PROFILE_ID } });
    }
    if (action === "unarchive") {
      folder.revision += 1;
      folder.archived_at = null;
      folder.semester_label = null;
      folder.course_name_snapshot = null;
      folder.course_color_snapshot = null;
      folder.updated_at = nextActivityTime();
      return json({ folder: { ...structuredClone(folder), profile_id: PROFILE_ID } });
    }
    return errorResponse("Unknown fixture folder action.", 400);
  }

  if (url.pathname === "/api/file-documents" && method === "GET") {
    const id = url.searchParams.get("id") ?? "";
    const document = nativeDocuments.get(id);
    return document ? json(nativeResult(document)) : errorResponse("Native document not found.", 404);
  }

  if (url.pathname === "/api/file-documents" && method === "PUT") {
    const id = url.searchParams.get("id") ?? "";
    const document = nativeDocuments.get(id);
    if (!document || body?.action !== "update_content" || body.baseContentRevision !== document.file.content_revision || typeof body.body !== "string") {
      return errorResponse("Native document changed.", 409);
    }
    const renamed = body.name !== undefined;
    document.body = body.body;
    document.file = {
      ...document.file,
      ...(renamed ? { name: String(body.name).trim(), metadata_revision: document.file.metadata_revision + 1 } : {}),
      content_revision: document.file.content_revision + 1,
      size_bytes: new TextEncoder().encode(body.body).byteLength,
      content_sha256: await sha256(body.body),
      updated_at: nextActivityTime(),
    };
    durableFiles[durableFiles.findIndex((file) => file.id === id)] = document.file;
    return json({ ...nativeResult(document), requestId: body.requestId, acknowledgedContentRevision: document.file.content_revision });
  }

  return errorResponse(`Unexpected fixture request: ${method} ${path}`, 404);
};

function BrowserFixture() {
  const [files, setFiles] = useState<PrivateFile[]>(() => structuredClone(durableFiles));
  const [preview, setPreview] = useState<{ file: PrivateFile; readOnly: boolean } | null>(null);
  const [editor, setEditor] = useState<PrivateFile | null>(null);
  const [currentTerm, setCurrentTerm] = useState(() => new URLSearchParams(window.location.search).get("term") ?? "Fall 2026");
  const [lastOpenReadOnly, setLastOpenReadOnly] = useState(false);
  const [preferences, setPreferences] = useState<FilesBrowserPreferences>({ filter: "all", fileType: "all", sortBy: "name", sortDirection: "asc", view: "list", includeArchived: false });
  const session = useMemo(() => ({ profileId: PROFILE_ID, generation: 0 }), []);
  useEffect(() => {
    const setTerm = (event: Event) => setCurrentTerm((event as CustomEvent<string>).detail);
    window.addEventListener("fixture-set-current-term", setTerm);
    return () => window.removeEventListener("fixture-set-current-term", setTerm);
  }, []);
  const refreshActivity = useCallback(async (signal?: AbortSignal, strict?: boolean) => {
    const response = await fetch("/api/files?view=active", {
      signal,
      headers: { "x-profile-id": PROFILE_ID, "x-fixture-activity-refresh": "1" },
    });
    if (!response.ok) {
      if (strict) {
        const failure = await response.json() as { error?: string };
        throw new Error(failure.error ?? "Files refresh failed.");
      }
      return;
    }
    const payload = await response.json() as { files: PrivateFile[] };
    setFiles(structuredClone(payload.files));
  }, []);
  const { opened: openedFile, failure: activityFailure, retry: retryActivity, dismiss: dismissActivity } = useFileActivity(session, true, refreshActivity);
  const fileUrl = useCallback((file: PrivateFile) => `/api/files?id=${encodeURIComponent(file.id)}&account=${encodeURIComponent(PROFILE_ID)}`, []);
  const loadBlob = useCallback(async (file: PrivateFile, signal?: AbortSignal) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (file.id === ID.broken) throw new Error("Fixture blob read failed.");
      const contents: Record<string, string> = {
        [ID.alpha]: "Uploaded PDF preview bytes.",
        [ID.biologyText]: "Biology is a course label, but this content does not affect name search.",
        [ID.rootPlanning]: "Biology appears in this file body only. Planning notes: résumé, 中文, ✓.",
        [ID.archivePdf]: "Archived specimen preview.",
      };
      return new Blob([contents[file.id] ?? `${file.name} uploaded preview`], { type: file.mime_type });
  }, []);
  const store = useMemo(() => ({ files, busy: false, url: fileUrl, blob: loadBlob }), [files, fileUrl, loadBlob]);
  const saveNativeFile = useCallback((file: PrivateFile) => {
    const document = nativeDocuments.get(file.id);
    if (document) document.file = structuredClone(file);
    const index = durableFiles.findIndex((row) => row.id === file.id);
    if (index >= 0) durableFiles[index] = structuredClone(file);
    setFiles((current) => current.map((row) => row.id === file.id ? structuredClone(file) : row));
    openedFile(file);
  }, [openedFile]);

  return createElement(Fragment, null,
    createElement(FilesBrowser, {
      profileId: PROFILE_ID,
      courses: COURSE_RECORDS,
      assignments: ASSIGNMENT_RECORDS,
      courseDetails: COURSE_DETAILS,
      store: store as never,
      layout: preferences.view as "list" | "grid",
      onLayoutChange: (view: "list" | "grid") => setPreferences((current) => ({ ...current, view })),
      preferences,
      onPreferencesChange: (next) => setPreferences(next),
      currentTerm,
      onUpload: () => {},
      onOpen: (file: PrivateFile, options?: { readOnly?: boolean }) => {
        setLastOpenReadOnly(Boolean(options?.readOnly));
        if (file.content_backend === "native-text" && file.state === "ready" && !file.trashed_at) setEditor(file);
        else setPreview({ file, readOnly: Boolean(options?.readOnly) });
      },
      onEdit: () => {},
      onFileOpened: openedFile,
      canWrite: true,
    }),
    preview && createElement(FilePreview, {
      key: `preview:${preview.file.id}`,
      file: files.find((file) => file.id === preview.file.id) ?? preview.file,
      store: store as never,
      onClose: () => setPreview(null),
      onEdit: () => setPreview(null),
      onOpened: openedFile,
      canWrite: !preview.readOnly,
    }),
    editor && createElement(NativeDocumentEditor, {
      key: `editor:${editor.id}`,
      profileId: PROFILE_ID,
      file: files.find((file) => file.id === editor.id) ?? editor,
      canWrite: true,
      onSaved: saveNativeFile,
      onClose: () => setEditor(null),
    }),
    activityFailure && createElement("div", { className: "files-activity-inline-error", role: "alert", "aria-live": "polite" },
      createElement("span", null, activityFailure.message),
      createElement("button", { type: "button", onClick: () => void retryActivity() }, activityFailure.acknowledged ? "Retry Recent refresh" : "Retry Recent update"),
      createElement("button", { type: "button", onClick: dismissActivity }, "Dismiss Recent notification"),
    ),
    createElement("div", { hidden: true, "data-fixture-current-term": currentTerm, "data-fixture-last-open-read-only": String(lastOpenReadOnly) }),
  );
}

declare global {
  interface Window {
    __filesDiscoveryFixture: {
      requests: RecordedRequest[];
      getFiles(): PrivateFile[];
      getFolders(): FileFolder[];
      getFileActivity(): Array<{ id: string; starred_at: string | null; last_opened_at: string | null }>;
      getFolderActivity(): Array<{ id: string; starred_at: string | null; last_opened_at: string | null }>;
      getAcademicRecords(): typeof academicRecords;
      getCurrentTerm(): string;
      getLastOpenReadOnly(): boolean;
      setCurrentTerm(value: string): void;
      failNextGet(path: string): void;
      failNextRecentRefresh(): void;
      getNativeDocument(id: string): { file: PrivateFile; body: string } | null;
      resetRequestLog(): void;
      getRequestCount(): number;
      realRandomUUID(): string;
    };
  }
}

window.__filesDiscoveryFixture = {
  requests,
  getFiles: () => structuredClone(durableFiles),
  getFolders: () => structuredClone(folders),
  getFileActivity: () => [...fileActivity.entries()].map(([id, activity]) => ({ id, ...activity })),
  getFolderActivity: () => [...folderActivity.entries()].map(([id, activity]) => ({ id, ...activity })),
  getAcademicRecords: () => structuredClone(academicRecords),
  getCurrentTerm: () => document.querySelector<HTMLElement>("[data-fixture-current-term]")?.dataset.fixtureCurrentTerm ?? "",
  getLastOpenReadOnly: () => document.querySelector<HTMLElement>("[data-fixture-last-open-read-only]")?.dataset.fixtureLastOpenReadOnly === "true",
  setCurrentTerm: (value) => {
    window.dispatchEvent(new CustomEvent("fixture-set-current-term", { detail: value }));
  },
  failNextGet: (path) => { failNextGetPath = path; },
  failNextRecentRefresh: () => { failNextActivityRefresh = true; },
  getNativeDocument: (id) => {
    const document = nativeDocuments.get(id);
    return document ? structuredClone(document) : null;
  },
  resetRequestLog: () => { requests.length = 0; },
  getRequestCount: () => requests.length,
  realRandomUUID,
};

const mount = () => {
  const element = document.getElementById("root");
  if (!element) throw new Error("Files discovery fixture requires #root.");
  root = createRoot(element);
  root.render(createElement(BrowserFixture));
};

mount();
window.addEventListener("pagehide", () => {
  root?.unmount();
}, { once: true });
