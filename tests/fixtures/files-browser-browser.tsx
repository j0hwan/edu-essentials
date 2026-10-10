import { createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SyllabusAttachment, SyllabusTextPreview } from "../../app/course-syllabus";
import FilesBrowser from "../../app/files-browser";
import { FilePreview } from "../../app/private-files";
import type { Course, CourseDetails } from "../../lib/academics";
import type { FileFolder } from "../../lib/file-organization";
import type { PrivateFile } from "../../lib/files";

type BrowserRequest = { url: string; profileId: string; method: string };
type BrowserCallbacks = {
  opened: string[];
  edited: string[];
  uploads: Array<{ folderId: string | null; courseId: string }>;
  attachments: Array<{ courseId: string; folderId: string }>;
  syllabusText: string[];
  layouts: string[];
};

function makeFolder(id: string, name: string, parent_id: string | null, fields: Partial<FileFolder> = {}): FileFolder {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null,
    revision: 1, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-03T00:00:00.000Z",
    archived_at: null, semester_label: null, course_name_snapshot: null, course_color_snapshot: null,
    trashed_at: null, trash_operation_id: null, original_parent_id: null,
    ...fields,
  };
}

function makeFile(id: string, name: string, folder_id: string | null, fields: Partial<PrivateFile> = {}): PrivateFile {
  return {
    id, name, mime_type: "text/plain", size_bytes: 128, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-03T00:00:00.000Z", content_sha256: null, folder_id,
    content_backend: "object", metadata_revision: 1, content_revision: 1,
    trashed_at: null, trash_operation_id: null, original_folder_id: null,
    ...fields,
  };
}

const course: Course = {
  id: "biology", code: "BIO 201", name: "Biology", credits: 4, instructor: "Dr. Moss",
  room: "Science 2", color: "#b23b53", soft: "#b23b5318", initials: "BIO",
};
const chemistry: Course = {
  id: "chemistry", code: "CHEM 102", name: "Chemistry", credits: 4, instructor: "Dr. Lin",
  room: "Science 4", color: "#8062b2", soft: "#8062b218", initials: "CHEM",
};
const physics: Course = {
  id: "physics", code: "PHYS 110", name: "Physics", credits: 3, instructor: "Dr. West",
  room: "Lab 1", color: "#327f78", soft: "#327f7818", initials: "PHYS",
};
const courses: Course[] = [course, chemistry, physics];
const courseDetails: Record<string, CourseDetails> = {
  biology: {
    officeHours: "", meetings: [], syllabusText: "BIO 201 text source — résumé, labs, and exam dates.\nExam 1: 2026-10-15",
    syllabusName: "BIO 201 syllabus notes", syllabusFileId: "syllabus-file",
  },
  chemistry: {
    officeHours: "", meetings: [], syllabusText: "Chemistry text-only source — café, molécules, and labs ✓\nMidterm: 2026-10-21",
    syllabusName: "CHEM 102 text syllabus",
  },
  physics: { officeHours: "", meetings: [] },
};

const activeFolders: FileFolder[] = [
  makeFolder("course-root", "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
  makeFolder("course-labs", "Labs", "course-root"),
  makeFolder("course-week", "Week 1", "course-labs"),
  makeFolder("chemistry-root", "CHEM 102", null, { kind: "course", course_id: "chemistry", course_code: "CHEM 102" }),
  makeFolder("physics-root", "PHYS 110", null, { kind: "course", course_id: "physics", course_code: "PHYS 110" }),
  makeFolder("personal-root", "Class notes", null),
  makeFolder("personal-deep", "Research", "personal-root"),
  makeFolder("empty-folder", "Empty folder", null),
];
const archivedFolders: FileFolder[] = [
  makeFolder("archive-root", "Fall 2025", null, { archived_at: "2026-01-01T00:00:00.000Z", semester_label: "Fall 2025", course_color_snapshot: "#335577" }),
  makeFolder("archive-child", "Old labs", "archive-root", { archived_at: "2026-01-01T00:00:00.000Z", semester_label: "Fall 2025", course_color_snapshot: "#335577" }),
];
const trashedFolders: FileFolder[] = [
  makeFolder("trash-root", "Discarded", null, { trashed_at: "2026-10-02T00:00:00.000Z" }),
  makeFolder("trash-child", "Discarded child", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_parent_id: "trash-root" }),
];
const activeFiles: PrivateFile[] = [
  makeFile("root-file", "Root notes.txt", null),
  makeFile("course-file", "BIO reading.txt", "course-root", { course_id: "biology" }),
  makeFile("syllabus-file", "BIO syllabus.txt", "course-root", { course_id: "biology", kind: "syllabus", size_bytes: 84 }),
  makeFile("lab-file", "Lab notes.txt", "course-labs", { course_id: "biology" }),
  makeFile("deep-file", "Week one.txt", "course-week", { course_id: "biology" }),
  makeFile("personal-file", "Research.txt", "personal-deep"),
  makeFile("archive-file", "Archived reading.txt", "archive-child", { course_id: "biology" }),
  makeFile("pending-file", "Pending upload.txt", null, { state: "pending" }),
];
const trashedFiles: PrivateFile[] = [
  makeFile("trash-file", "Removed.txt", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_folder_id: "trash-root" }),
];
const fileActivities = [
  { file_id: "root-file", starred_at: null, last_opened_at: "2026-10-03T10:00:00.000Z" },
  { file_id: "course-file", starred_at: "2026-10-03T09:00:00.000Z", last_opened_at: "2026-10-03T11:00:00.000Z" },
  { file_id: "deep-file", starred_at: null, last_opened_at: "2026-10-03T12:00:00.000Z" },
];
const folderActivities = [
  { folder_id: "course-root", starred_at: null, last_opened_at: "2026-10-03T08:00:00.000Z" },
  { folder_id: "personal-root", starred_at: "2026-10-03T07:00:00.000Z", last_opened_at: null },
  { folder_id: "archive-root", starred_at: "2026-10-03T06:00:00.000Z", last_opened_at: null },
];

const originalFetch = globalThis.fetch;
const requests: BrowserRequest[] = [];
const callbacks: BrowserCallbacks = { opened: [], edited: [], uploads: [], attachments: [], syllabusText: [], layouts: [] };
const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") ?? "";
const readonly = params.get("readonly") === "1";
let profileId = params.get("profile") ?? "profile-a";
let loadingErrorPending = scenario === "retry";
const released = new Set<string>();
const pendingReleases = new Map<string, Array<() => void>>();
let root: Root | null = null;
let storeFiles = activeFiles;

function waitForProfile(profile: string) {
  if (released.has(profile)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const resolvers = pendingReleases.get(profile) ?? [];
    resolvers.push(resolve);
    pendingReleases.set(profile, resolvers);
  });
}

function releaseProfile(profile: string) {
  released.add(profile);
  for (const resolve of pendingReleases.get(profile) ?? []) resolve();
  pendingReleases.delete(profile);
}

function payloadFor(url: string) {
  if (url.startsWith("/api/files?view=active")) return { files: activeFiles, activities: { files: fileActivities } };
  if (url.startsWith("/api/files?view=trash")) return { files: trashedFiles, activities: { files: fileActivities } };
  if (url.startsWith("/api/file-folders?view=active")) return { folders: activeFolders, activities: { folders: folderActivities } };
  if (url.startsWith("/api/file-folders?view=archives")) return { folders: archivedFolders, activities: { folders: folderActivities } };
  if (url.startsWith("/api/file-folders?view=trash")) return { folders: trashedFolders, activities: { folders: folderActivities } };
  throw new Error(`Unexpected Files Browser request: ${url}`);
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const headers = new Headers(init.headers);
  const requestProfile = headers.get("x-profile-id") ?? "";
  requests.push({ url, profileId: requestProfile, method: init.method ?? "GET" });

  if (scenario === "account-switch" && requestProfile === "profile-a") await waitForProfile(requestProfile);
  if (scenario === "retry" && loadingErrorPending && url === "/api/files?view=active") {
    loadingErrorPending = false;
    return Response.json({ error: "Temporary fixture failure" }, { status: 503 });
  }

  const body = payloadFor(url);
  if (requestProfile === "profile-b") {
    if (Array.isArray(body.files)) return Response.json({ files: body.files.map((file: PrivateFile) => ({ ...file, id: `account-b-${file.id}`, name: `B private ${file.name}` })), activities: body.activities });
    if (Array.isArray(body.folders)) return Response.json({ folders: body.folders.map((folder: FileFolder) => ({ ...folder, id: `account-b-${folder.id}`, parent_id: folder.parent_id ? `account-b-${folder.parent_id}` : null })), activities: body.activities });
  }
  return Response.json(body);
};

function BrowserFixture() {
  const [preview, setPreview] = useState<PrivateFile | null>(null);
  const [textPreview, setTextPreview] = useState<{ course: Course; text: string; name: string } | null>(null);
  const [attachment, setAttachment] = useState<{ courseId: string; folderId: string } | null>(null);
  const store = {
    files: storeFiles,
    url: (file: PrivateFile) => `/api/files?id=${file.id}&account=${encodeURIComponent(profileId)}`,
    async blob(file: PrivateFile) { return new Blob([`${file.name} — uploaded syllabus preview: résumé, 中文, ✓`], { type: file.mime_type }); },
  };
  const attachmentCourse = attachment ? courses.find((item) => item.id === attachment.courseId) : undefined;
  const attachmentDetails = attachment ? courseDetails[attachment.courseId as keyof typeof courseDetails] : undefined;
  return createElement(Fragment, null,
    createElement(FilesBrowser, {
      profileId,
      courses,
      courseDetails,
      store: store as never,
      layout: "list",
      onLayoutChange: (layout: "list" | "grid") => callbacks.layouts.push(layout),
      onUpload: (folderId: string | null, courseId: string) => callbacks.uploads.push({ folderId, courseId }),
      onOpen: (file: PrivateFile) => callbacks.opened.push(file.id),
      onOpenSyllabus: (file: PrivateFile) => { callbacks.opened.push(file.id); setPreview(file); },
      onAttachSyllabus: (courseId: string, folderId: string) => { callbacks.attachments.push({ courseId, folderId }); setAttachment({ courseId, folderId }); },
      onSyllabusText: (courseId: string) => {
        callbacks.syllabusText.push(courseId);
        const targetCourse = courses.find((item) => item.id === courseId);
        const details = courseDetails[courseId as keyof typeof courseDetails];
        if (targetCourse && details?.syllabusText) setTextPreview({ course: targetCourse, text: details.syllabusText, name: details.syllabusName ?? `${targetCourse.code} syllabus` });
      },
      onEdit: (file: PrivateFile) => callbacks.edited.push(file.id),
      canWrite: !readonly,
    }),
    preview && createElement(FilePreview, {
      file: preview,
      store: store as never,
      onClose: () => setPreview(null),
      onEdit: () => setPreview(null),
      canWrite: !readonly,
    }),
    textPreview && createElement(SyllabusTextPreview, { ...textPreview, onClose: () => setTextPreview(null) }),
    attachment && attachmentCourse && attachmentDetails && createElement(SyllabusAttachment, {
      courseId: attachment.courseId,
      course: attachmentCourse,
      details: attachmentDetails,
      folderId: attachment.folderId,
      store: store as never,
      canWrite: !readonly,
      async onSave() {},
      onClose: () => setAttachment(null),
    }),
  );
}

function render() {
  if (!root) return;
  root.render(createElement(BrowserFixture));
}

function touchStore() {
  storeFiles = [...storeFiles];
  render();
}

declare global {
  interface Window {
    __filesBrowserFixture: {
      requests: BrowserRequest[];
      callbacks: BrowserCallbacks;
      get profileId(): string;
      releaseProfile(profile: string): void;
      switchProfile(profile: string): void;
      renameFolder(id: string, name: string): void;
      touchStore(): void;
      getStoreFiles(): PrivateFile[];
      getCourse(): Course;
    };
  }
}

window.__filesBrowserFixture = {
  requests,
  callbacks,
  get profileId() { return profileId; },
  releaseProfile,
  switchProfile(nextProfileId) { profileId = nextProfileId; render(); },
  renameFolder(id, name) {
    for (const group of [activeFolders, archivedFolders, trashedFolders]) {
      const folder = group.find((item) => item.id === id);
      if (folder) folder.name = name;
    }
    touchStore();
  },
  touchStore,
  getStoreFiles() { return structuredClone(storeFiles); },
  getCourse() { return structuredClone(course); },
};

const mount = () => {
  const element = document.getElementById("root");
  if (!element) throw new Error("The Files Browser fixture requires #root.");
  root = createRoot(element);
  render();
};

if (scenario === "account-switch") {
  // profile-a's responses remain pending after abort so the test can prove that
  // an obsolete account cannot overwrite the current account's data.
  released.delete("profile-a");
}
mount();
window.addEventListener("pagehide", () => {
  root?.unmount();
  globalThis.fetch = originalFetch;
}, { once: true });
