import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import FilesBrowser from "../../app/files-browser";
import type { Course } from "../../lib/academics";
import type { FileFolder } from "../../lib/file-organization";
import type { PrivateFile } from "../../lib/files";
import type { SavedAssignment } from "../../lib/workspace-codec";

const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOLDER_ID = {
  biology: "11111111-1111-4111-8111-111111111111",
  biologyLabs: "12121212-1212-4121-8121-121212121212",
  biologyWeek: "13131313-1313-4131-8131-131313131313",
  history: "14141414-1414-4141-8141-141414141414",
  historyReadings: "15151515-1515-4151-8151-151515151515",
  organization: "16161616-1616-4161-8161-161616161616",
  organizationChild: "17171717-1717-4171-8171-171717171717",
  organizationDeep: "18181818-1818-4181-8181-181818181818",
  rename: "19191919-1919-4191-8191-191919191919",
  target: "20202020-2020-4020-8020-202020202020",
  dragFolder: "21212121-2121-4121-8121-212121212121",
  duplicate1: "22222222-2222-4222-8222-222222222222",
  duplicate2: "23232323-2323-4323-8323-232323232323",
  spare1: "24242424-2424-4424-8424-242424242424",
  spare2: "25252525-2525-4525-8525-252525252525",
  spare3: "26262626-2626-4626-8626-262626262626",
  spare4: "27272727-2727-4727-8727-272727272727",
  spare5: "28282828-2828-4828-8828-282828282828",
  spare6: "29292929-2929-4929-8929-292929292929",
};
const FILE_ID = {
  biologyNotes: "31313131-3131-4131-8131-313131313131",
  renameNotes: "32323232-3232-4232-8232-323232323232",
  historySource: "33333333-3333-4333-8333-333333333333",
};
const TIMESTAMP = "2026-10-08T12:00:00.000Z";
const FILE_BODY = "Biology lab notes remain intact after folder moves and renames.\nAssignment: experiment 4 — café, 中文, ✓";
const RENAME_BODY = "Planning body survives a metadata-only rename.\nSecond line: π and résumé.";
const OBJECT_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 127, 255, 13, 10]);
const UPLOADED_SHA256 = "ce408f218c9c9ddc92ae4e7702902268a648fad01656225cc0ec8f70c345c5b7";

type BrowserRequest = { path: string; method: string; profileId: string; body?: Record<string, unknown> };
type StoredDocument = { fileId: string; body: string };

const courses: Course[] = [
  { id: "biology", code: "BIO 201", name: "Biology", credits: 4, instructor: "Dr. Moss", room: "Science 2", color: "#b23b53", soft: "#b23b5318", initials: "BIO" },
  { id: "history", code: "HIST 104", name: "History", credits: 3, instructor: "Dr. Lin", room: "Room 4", color: "#8062b2", soft: "#8062b218", initials: "HIST" },
];
const assignments: Pick<SavedAssignment, "id" | "title" | "courseId">[] = [
  { id: "biology-lab", title: "Biology Lab 4", courseId: "biology" },
  { id: "history-reading", title: "History Reading", courseId: "history" },
];

function makeFolder(id: string, name: string, parent_id: string | null, fields: Partial<FileFolder> = {}): FileFolder {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
    created_at: TIMESTAMP, updated_at: TIMESTAMP, archived_at: null, semester_label: null,
    course_name_snapshot: null, course_color_snapshot: null, trashed_at: null,
    trash_operation_id: null, original_parent_id: null, ...fields,
  };
}

function makeFile(
  id: string,
  name: string,
  folder_id: string | null,
  fields: Partial<PrivateFile> = {},
): PrivateFile {
  return {
    id, name, mime_type: "text/plain", size_bytes: 0, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: TIMESTAMP, updated_at: TIMESTAMP,
    content_sha256: null, folder_id, content_backend: "native-text", metadata_revision: 1,
    content_revision: 1, trashed_at: null, trash_operation_id: null, original_folder_id: null,
    ...fields,
  };
}

const folders: FileFolder[] = [
  makeFolder(FOLDER_ID.biology, "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
  makeFolder(FOLDER_ID.biologyLabs, "Labs", FOLDER_ID.biology),
  makeFolder(FOLDER_ID.biologyWeek, "Week 4", FOLDER_ID.biologyLabs),
  makeFolder(FOLDER_ID.history, "HIST 104", null, { kind: "course", course_id: "history", course_code: "HIST 104" }),
  makeFolder(FOLDER_ID.historyReadings, "Readings", FOLDER_ID.history),
  makeFolder(FOLDER_ID.organization, "Organization", null),
  makeFolder(FOLDER_ID.organizationChild, "Nested materials", FOLDER_ID.organization),
  makeFolder(FOLDER_ID.organizationDeep, "Deep archive", FOLDER_ID.organizationChild),
  makeFolder(FOLDER_ID.rename, "Folder before rename", null),
  makeFolder(FOLDER_ID.target, "Move target", null),
  makeFolder(FOLDER_ID.dragFolder, "Drag candidate", null),
  makeFolder(FOLDER_ID.duplicate1, "Shared label", null),
  makeFolder(FOLDER_ID.duplicate2, "Shared label", null),
  ...[
    [FOLDER_ID.spare1, "Spare folder 1"], [FOLDER_ID.spare2, "Spare folder 2"],
    [FOLDER_ID.spare3, "Spare folder 3"], [FOLDER_ID.spare4, "Spare folder 4"],
    [FOLDER_ID.spare5, "Spare folder 5"], [FOLDER_ID.spare6, "Spare folder 6"],
  ].map(([id, name]) => makeFolder(id, name, null)),
];

const files: PrivateFile[] = [
  makeFile(FILE_ID.biologyNotes, "Biology lab notes.txt", FOLDER_ID.organization, {
    course_id: "biology", assignment_id: "biology-lab", size_bytes: new TextEncoder().encode(FILE_BODY).byteLength,
    content_sha256: "a45e79274507b88b677c1f7933388f0980fae989e3cb865aa0c0f658da5dfccb",
  }),
  makeFile(FILE_ID.renameNotes, "Planning notes.txt", FOLDER_ID.rename, {
    course_id: "history", assignment_id: "history-reading", size_bytes: new TextEncoder().encode(RENAME_BODY).byteLength,
    content_sha256: "77dd7cdf941132a78f6646d9bd4450f4befb6acf5bd09a137a3e5815940a3fe8",
  }),
  makeFile(FILE_ID.historySource, "History reading.pdf", null, {
    mime_type: "application/pdf", course_id: "history", assignment_id: "history-reading", kind: "attachment",
    size_bytes: OBJECT_BYTES.byteLength, content_sha256: UPLOADED_SHA256, content_backend: "object",
  }),
];
const documents = new Map<string, StoredDocument>([
  [FILE_ID.biologyNotes, { fileId: FILE_ID.biologyNotes, body: FILE_BODY }],
  [FILE_ID.renameNotes, { fileId: FILE_ID.renameNotes, body: RENAME_BODY }],
]);
const objectBytes = new Map([[FILE_ID.historySource, new Uint8Array(OBJECT_BYTES)]]);
const requests: BrowserRequest[] = [];
const uploads: Array<{ folderId: string | null; courseId: string }> = [];
let timestampCounter = 0;
let root: Root | null = null;

function updatedAt(previous: string) {
  timestampCounter += 1;
  return new Date(Math.max(Date.parse(previous) + 1000, Date.parse(TIMESTAMP) + timestampCounter * 1000)).toISOString();
}

function apiError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

function asPublic<T extends object>(value: T) {
  return structuredClone(value);
}

function descendantsOf(folderId: string) {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parent_id && result.has(folder.parent_id) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

function coveredBySelectedFolder(item: { type: "file" | "folder"; id: string }) {
  const selectedFolders = new Set(
    requests.at(-1)?.body?.items && Array.isArray(requests.at(-1)?.body?.items)
      ? (requests.at(-1)!.body!.items as Array<{ type?: unknown; id?: unknown }>)
        .filter((entry) => entry.type === "folder" && typeof entry.id === "string")
        .map((entry) => String(entry.id))
      : [],
  );
  let parentId = item.type === "file"
    ? files.find((file) => file.id === item.id)?.folder_id ?? null
    : folders.find((folder) => folder.id === item.id)?.parent_id ?? null;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (selectedFolders.has(parentId)) return true;
    visited.add(parentId);
    parentId = folders.find((folder) => folder.id === parentId)?.parent_id ?? null;
  }
  return false;
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
    catch { return apiError("Invalid fixture JSON.", 400); }
  }
  const path = `${url.pathname}${url.search}`;
  requests.push({ path, method, profileId, ...(body ? { body: structuredClone(body) } : {}) });
  if (profileId !== PROFILE_ID) return apiError("Wrong fixture account.", 401);

  if (url.pathname === "/api/files" && method === "GET") {
    const view = url.searchParams.get("view");
    const visible = view === "trash" ? files.filter((file) => file.trashed_at !== null) : files.filter((file) => file.trashed_at === null);
    return Response.json({ files: asPublic(visible), activities: { files: [] } });
  }
  if (url.pathname === "/api/file-folders" && method === "GET") {
    const view = url.searchParams.get("view");
    const visible = view === "trash" ? folders.filter((folder) => folder.trashed_at !== null)
      : view === "archives" ? folders.filter((folder) => folder.archived_at !== null)
        : folders.filter((folder) => folder.trashed_at === null && folder.archived_at === null);
    return Response.json({ folders: asPublic(visible), activities: { folders: [] } });
  }
  if (url.pathname === "/api/file-folders" && method === "POST") {
    if (!body || typeof body.id !== "string" || typeof body.name !== "string") return apiError("Invalid folder request.", 400);
    const existing = folders.find((folder) => folder.id === body.id);
    if (existing) {
      if (existing.name === body.name && existing.parent_id === (typeof body.parentId === "string" ? body.parentId : null)) {
        return Response.json({ folder: asPublic(existing) }, { status: 201 });
      }
      return apiError("Folder ID already used.", 409);
    }
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
    if (parentId && !folders.some((folder) => folder.id === parentId && folder.trashed_at === null)) return apiError("Folder not found.", 404);
    const folder = makeFolder(body.id, body.name.trim(), parentId);
    folders.push(folder);
    return Response.json({ folder: asPublic(folder) }, { status: 201 });
  }
  if (url.pathname === "/api/file-folders" && method === "PUT") {
    if (!body || typeof body.id !== "string") return apiError("Invalid folder request.", 400);
    const folder = folders.find((candidate) => candidate.id === body.id);
    if (!folder || folder.trashed_at !== null) return apiError("Folder not found.", 404);
    if (folder.kind === "course") return apiError("Managed course folders follow the course list.", 400);
    if (body.revision !== folder.revision) return apiError("Folder changed.", 409);
    if (body.action !== "rename" || typeof body.name !== "string" || !body.name.trim()) return apiError("Invalid folder action.", 400);
    folder.name = body.name.trim();
    folder.revision += 1;
    folder.updated_at = updatedAt(folder.updated_at);
    return Response.json({ folder: asPublic(folder) });
  }
  if (url.pathname === "/api/files" && method === "PUT") {
    const id = url.searchParams.get("id") ?? "";
    const file = files.find((candidate) => candidate.id === id);
    if (!file || file.trashed_at !== null || file.state !== "ready") return apiError("File not found.", 404);
    if (!body || body.action !== "rename" || typeof body.name !== "string") return apiError("Invalid file rename.", 400);
    if (body.baseMetadataRevision !== file.metadata_revision) return apiError("File metadata changed.", 409);
    if (!body.name.trim() || body.name.includes("/") || body.name.includes("\\")) return apiError("Invalid file name.", 400);
    file.name = body.name.trim();
    file.metadata_revision += 1;
    file.updated_at = updatedAt(file.updated_at);
    return Response.json({ file: asPublic(file) });
  }
  if (url.pathname === "/api/files/actions" && method === "POST") {
    if (!body || body.action !== "move" || !Array.isArray(body.items)) return apiError("Invalid file action.", 400);
    const destinationId = body.destinationId === null ? null : typeof body.destinationId === "string" ? body.destinationId : undefined;
    if (destinationId === undefined || (destinationId !== null && !folders.some((folder) => folder.id === destinationId && folder.trashed_at === null))) {
      return apiError("Destination folder not found.", 404);
    }
    const selected = body.items as Array<{ type?: unknown; id?: unknown; revision?: unknown }>;
    const seen = new Set<string>();
    for (const item of selected) {
      if ((item.type !== "file" && item.type !== "folder") || typeof item.id !== "string" || typeof item.revision !== "number") return apiError("Invalid selected item.", 400);
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return apiError("Duplicate selection.", 400);
      seen.add(key);
      const current = item.type === "file" ? files.find((file) => file.id === item.id) : folders.find((folder) => folder.id === item.id);
      if (!current || current.trashed_at !== null) return apiError("Selected item not found.", 404);
      const revision = item.type === "file" ? (current as PrivateFile).metadata_revision : (current as FileFolder).revision;
      if (revision !== item.revision) return apiError("Selected item changed.", 409);
      if (item.type === "folder" && (current as FileFolder).kind === "course") return apiError("Managed course folders stay at the root.", 400);
      if (item.type === "folder" && destinationId && descendantsOf(item.id).has(destinationId)) return apiError("Folder move would create a cycle.", 400);
    }
    const movedFiles: PrivateFile[] = [];
    const movedFolders: FileFolder[] = [];
    for (const item of selected) {
      if (coveredBySelectedFolder(item as { type: "file" | "folder"; id: string })) continue;
      if (item.type === "file") {
        const file = files.find((candidate) => candidate.id === item.id)!;
        file.folder_id = destinationId;
        file.metadata_revision += 1;
        file.updated_at = updatedAt(file.updated_at);
        movedFiles.push(asPublic(file));
      } else {
        const folder = folders.find((candidate) => candidate.id === item.id)!;
        folder.parent_id = destinationId;
        folder.revision += 1;
        folder.updated_at = updatedAt(folder.updated_at);
        movedFolders.push(asPublic(folder));
      }
    }
    return Response.json({ files: movedFiles, folders: movedFolders, activities: { files: [], folders: [] } });
  }
  return apiError(`Unexpected API request: ${method} ${path}`, 404);
}

globalThis.fetch = handleApi;

function BrowserFixture() {
  const store = {
    files,
    busy: false,
    url: (file: PrivateFile) => `/api/files?id=${encodeURIComponent(file.id)}&account=${encodeURIComponent(PROFILE_ID)}`,
    async blob(file: PrivateFile) {
      if (file.content_backend === "object") return new Blob([objectBytes.get(file.id) ?? new Uint8Array()], { type: file.mime_type });
      return new Blob([documents.get(file.id)?.body ?? ""], { type: file.mime_type });
    },
  };
  return createElement(FilesBrowser, {
    profileId: PROFILE_ID,
    courses,
    assignments,
    courseDetails: {},
    store: store as never,
    layout: "list" as const,
    onLayoutChange: () => {},
    onUpload: (folderId: string | null, courseId: string) => uploads.push({ folderId, courseId }),
    onOpen: () => {},
    onEdit: () => {},
    onNewTextFile: () => {},
    canWrite: true,
    onOrganizationSaved: async () => {},
  });
}

declare global {
  interface Window {
    __fileOrganizationFixture: {
      profileId: string;
      requests: BrowserRequest[];
      getFiles(): PrivateFile[];
      getFolders(): FileFolder[];
      getDocuments(): Array<{ id: string; body: string }>;
      getUploadBytes(id: string): number[];
      getUploads(): Array<{ folderId: string | null; courseId: string }>;
    };
  }
}

window.__fileOrganizationFixture = {
  profileId: PROFILE_ID,
  requests,
  getFiles: () => structuredClone(files),
  getFolders: () => structuredClone(folders),
  getDocuments: () => [...documents.values()].map(({ fileId, body }) => ({ id: fileId, body })),
  getUploadBytes: (id) => [...(objectBytes.get(id) ?? new Uint8Array())],
  getUploads: () => structuredClone(uploads),
};

const mount = () => {
  const element = document.getElementById("root");
  if (!element) throw new Error("The file organization fixture requires #root.");
  root = createRoot(element);
  root.render(createElement(BrowserFixture));
};

mount();
window.addEventListener("pagehide", () => root?.unmount(), { once: true });
