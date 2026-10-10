import { createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import FilesBrowser from "../../app/files-browser";
import { NativeDocumentEditor } from "../../app/native-document-editor";
import { FilePreview } from "../../app/private-files";
import type { Course } from "../../lib/academics";
import type { FileFolder } from "../../lib/file-organization";
import type { PrivateFile } from "../../lib/files";
import type { NativeDocumentCreate } from "../../lib/native-documents";

const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESEARCH_FOLDER_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = {
  untitled: "33333333-3333-4333-8333-333333333333",
  untitled2: "44444444-4444-4444-8444-444444444444",
  folderUntitled: "55555555-5555-4555-8555-555555555555",
  uploaded: "66666666-6666-4666-8666-666666666666",
};
const uploadedText = "Uploaded reference text stays read-only: résumé, 中文, ✓\nPage two: example notes.";
const timestamp = "2026-10-08T12:00:00.000Z";
const createIds = [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "aaaaaaaa-0000-4000-8000-000000000002",
  "aaaaaaaa-0000-4000-8000-000000000003",
];

function makeFolder(id: string, name: string, parent_id: string | null): FileFolder {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
    created_at: timestamp, updated_at: timestamp, archived_at: null, semester_label: null,
    course_name_snapshot: null, course_color_snapshot: null, trashed_at: null,
    trash_operation_id: null, original_parent_id: null,
  };
}

function makeFile(id: string, name: string, folder_id: string | null, patch: Partial<PrivateFile> = {}): PrivateFile {
  return {
    id, name, mime_type: "text/plain", size_bytes: 0, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: timestamp, updated_at: timestamp,
    content_sha256: null, folder_id, content_backend: "native-text", metadata_revision: 1,
    content_revision: 1, trashed_at: null, trash_operation_id: null, original_folder_id: null,
    ...patch,
  };
}

const initialFolders = [
  makeFolder(RESEARCH_FOLDER_ID, "Research", null),
  makeFolder(CHILD_FOLDER_ID, "Archive", RESEARCH_FOLDER_ID),
];
const initialFiles: PrivateFile[] = [
  makeFile(FILE_ID.untitled, "Untitled.txt", null),
  makeFile(FILE_ID.untitled2, "Untitled (2).txt", null),
  makeFile(FILE_ID.folderUntitled, "Untitled.txt", RESEARCH_FOLDER_ID),
  makeFile(FILE_ID.uploaded, "Uploaded reference.txt", null, {
    content_backend: "object", size_bytes: new TextEncoder().encode(uploadedText).byteLength,
  }),
];

type StoredDocument = { file: PrivateFile; body: string };
type RequestRecord = { path: string; method: string; profileId: string; body?: Record<string, unknown> };
const durableFiles = [...initialFiles];
const folders = [...initialFolders];
const documents = new Map<string, StoredDocument>(initialFiles
  .filter((file) => file.content_backend === "native-text")
  .map((file) => [file.id, { file, body: "" }]));
const receipts = new Map<string, { fingerprint: string; acknowledgedContentRevision: number }>();
const requests: RequestRecord[] = [];
let dateCounter = 0;
let root: Root | null = null;
let createIdIndex = 0;

function nextUpdatedAt(previous: string) {
  dateCounter += 1;
  return new Date(Math.max(Date.parse(previous) + 1000, Date.parse(timestamp) + dateCounter * 1000)).toISOString();
}

async function sha256(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function updateDurableFile(file: PrivateFile) {
  const index = durableFiles.findIndex((item) => item.id === file.id);
  if (index < 0) durableFiles.push(file);
  else durableFiles[index] = file;
}

function documentResult(document: StoredDocument) {
  return {
    file: structuredClone(document.file),
    document: {
      file_id: document.file.id,
      body: document.body,
      content_revision: document.file.content_revision,
    },
  };
}

function apiError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl, window.location.origin);
  const method = init.method ?? (input instanceof Request ? input.method : "GET");
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const profileId = headers.get("x-profile-id") ?? "";
  let body: Record<string, unknown> | undefined;
  if (typeof init.body === "string") {
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { return apiError("Invalid fixture JSON.", 400); }
  }
  requests.push({ path: `${url.pathname}${url.search}`, method, profileId, ...(body ? { body: structuredClone(body) } : {}) });
  if (profileId !== PROFILE_ID) return apiError("Wrong fixture account.", 401);

  if (url.pathname === "/api/files" && method === "GET") {
    return Response.json({
      files: url.searchParams.get("view") === "trash" ? [] : structuredClone(durableFiles),
      activities: { files: [] },
    });
  }
  if (url.pathname === "/api/file-folders" && method === "GET") {
    return Response.json({
      folders: ["active", null].includes(url.searchParams.get("view")) ? structuredClone(folders) : [],
      activities: { folders: [] },
    });
  }
  if (url.pathname !== "/api/file-documents") return apiError(`Unexpected API request: ${method} ${url.pathname}${url.search}`, 404);

  if (method === "POST") {
    if (!body) return apiError("Missing document body.", 400);
    const id = typeof body.id === "string" ? body.id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const content = typeof body.body === "string" ? body.body : null;
    const folderId = typeof body.folderId === "string" && body.folderId ? body.folderId : null;
    const courseId = typeof body.courseId === "string" && body.courseId ? body.courseId : null;
    if (!id || !name || content === null) return apiError("Invalid fixture document.", 400);
    if (documents.has(id)) {
      const existing = documents.get(id)!;
      if (existing.file.name !== name || existing.body !== content || existing.file.folder_id !== folderId) return apiError("Document ID collision.", 409);
      return Response.json(documentResult(existing), { status: 201 });
    }
    const file: PrivateFile = {
      id, name, mime_type: "text/plain", size_bytes: new TextEncoder().encode(content).byteLength,
      course_id: courseId, assignment_id: null, kind: "resource", state: "ready",
      created_at: timestamp, updated_at: timestamp, content_sha256: await sha256(content),
      folder_id: folderId, content_backend: "native-text", metadata_revision: 1, content_revision: 1,
      trashed_at: null, trash_operation_id: null, original_folder_id: null,
    };
    const created = { file, body: content };
    documents.set(id, created);
    updateDurableFile(file);
    return Response.json(documentResult(created), { status: 201 });
  }

  const id = url.searchParams.get("id") ?? "";
  const saved = documents.get(id);
  if (!saved) return apiError("Document not found.", 404);
  if (method === "GET") return Response.json(documentResult(saved));
  if (method !== "PUT" || !body || body.action !== "update_content") return apiError("Invalid document action.", 400);

  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const receiptKey = `${PROFILE_ID}:${requestId}`;
  const fingerprint = JSON.stringify([
    id, body.baseContentRevision, body.body, body.name ?? null, body.baseMetadataRevision ?? null,
  ]);
  const receipt = receipts.get(receiptKey);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) return apiError("Request ID reused with different data.", 409);
    return Response.json({
      ...documentResult(saved), requestId,
      acknowledgedContentRevision: receipt.acknowledgedContentRevision,
    });
  }
  if (body.baseContentRevision !== saved.file.content_revision) return apiError("Document changed.", 409);
  if (body.name !== undefined && body.baseMetadataRevision !== saved.file.metadata_revision) return apiError("Document metadata changed.", 409);
  if (typeof body.body !== "string") return apiError("Invalid text.", 400);

  const renamed = body.name !== undefined;
  const file: PrivateFile = {
    ...saved.file,
    name: renamed ? String(body.name).trim() : saved.file.name,
    content_revision: saved.file.content_revision + 1,
    metadata_revision: saved.file.metadata_revision + (renamed ? 1 : 0),
    size_bytes: new TextEncoder().encode(body.body).byteLength,
    content_sha256: await sha256(body.body),
    updated_at: nextUpdatedAt(saved.file.updated_at),
  };
  const updated = { file, body: body.body };
  documents.set(id, updated);
  updateDurableFile(file);
  receipts.set(receiptKey, { fingerprint, acknowledgedContentRevision: file.content_revision });
  return Response.json({
    ...documentResult(updated), requestId,
    acknowledgedContentRevision: file.content_revision,
  });
};

function BrowserFixture() {
  const [files, setFiles] = useState<PrivateFile[]>(() => [...durableFiles]);
  const [editor, setEditor] = useState<{ file?: PrivateFile; create?: NativeDocumentCreate } | null>(null);
  const [preview, setPreview] = useState<PrivateFile | null>(null);
  const store = {
    files,
    busy: false,
    url: (file: PrivateFile) => `/api/files?id=${encodeURIComponent(file.id)}&account=${encodeURIComponent(PROFILE_ID)}`,
    async blob(file: PrivateFile) {
      if (file.id === FILE_ID.uploaded) return new Blob([uploadedText], { type: "text/plain" });
      return new Blob([documents.get(file.id)?.body ?? ""], { type: "text/plain" });
    },
  };
  const onSaved = (file: PrivateFile) => {
    updateDurableFile(file);
    setFiles((current) => {
      const index = current.findIndex((item) => item.id === file.id);
      if (index < 0) return [...current, file];
      const next = [...current];
      next[index] = file;
      return next;
    });
  };
  const onNewTextFile = (folderId: string | null, courseId: string, name: string) => {
    const id = createIds[createIdIndex++ % createIds.length];
    setEditor({ create: { id, folderId, courseId, name, body: "" } });
  };
  const openFile = (file: PrivateFile) => {
    if (file.content_backend === "native-text" && file.state === "ready" && !file.trashed_at) setEditor({ file });
    else setPreview(file);
  };

  return createElement(Fragment, null,
    createElement(FilesBrowser, {
      profileId: PROFILE_ID,
      courses: [] as Course[],
      courseDetails: {},
      store: store as never,
      layout: "list" as const,
      onLayoutChange: () => {},
      onUpload: () => {},
      onOpen: openFile,
      onEdit: () => {},
      onNewTextFile,
      canWrite: true,
    }),
    editor && createElement(NativeDocumentEditor, {
      key: editor.file?.id ?? editor.create?.id,
      profileId: PROFILE_ID,
      file: editor.file,
      create: editor.create,
      canWrite: true,
      onSaved,
      onClose: () => setEditor(null),
    }),
    preview && createElement(FilePreview, {
      file: preview,
      store: store as never,
      canWrite: true,
      onEdit: () => {},
      onClose: () => setPreview(null),
    }),
  );
}

declare global {
  interface Window {
    __nativeDocumentFixture: {
      profileId: string;
      requests: RequestRecord[];
      getFiles(): PrivateFile[];
      getDocuments(): Array<{ id: string; name: string; body: string; folderId: string | null; contentRevision: number; metadataRevision: number }>;
    };
  }
}

window.__nativeDocumentFixture = {
  profileId: PROFILE_ID,
  requests,
  getFiles: () => structuredClone(durableFiles),
  getDocuments: () => [...documents.values()].map(({ file, body }) => ({
    id: file.id, name: file.name, body, folderId: file.folder_id,
    contentRevision: file.content_revision, metadataRevision: file.metadata_revision,
  })),
};

const mount = () => {
  const element = document.getElementById("root");
  if (!element) throw new Error("Native document fixture requires #root.");
  root = createRoot(element);
  root.render(createElement(BrowserFixture));
};

mount();
window.addEventListener("pagehide", () => {
  root?.unmount();
}, { once: true });
