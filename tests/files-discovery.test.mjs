import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { browserItemLocation, deriveFilesBrowser } = await import(await clientModule("lib/files-browser.ts"));

const folder = (id, name, parent_id = null, fields = {}) => ({
  id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
  archived_at: null, semester_label: null, course_name_snapshot: null, course_color_snapshot: null,
  trashed_at: null, trash_operation_id: null, original_parent_id: null, ...fields,
});

const file = (id, name, folder_id = null, fields = {}) => ({
  id, name, mime_type: "text/plain", size_bytes: 100, course_id: null, assignment_id: null,
  kind: "resource", state: "ready", created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z", content_sha256: null, folder_id,
  content_backend: "object", metadata_revision: 1, content_revision: 1,
  trashed_at: null, trash_operation_id: null, original_folder_id: null, ...fields,
});

const itemIds = (result) => result.items.map(({ id }) => id);
const atRoot = (view = "my-files") => ({ view, folderId: null, layout: "list" });

function fixture() {
  const folders = [
    folder("course", "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
    folder("course-child", "Labs", "course"),
    folder("course-grandchild", "Week 1", "course-child"),
    folder("personal", "Personal"),
    folder("personal-child", "Research", "personal"),
    folder("archive-fall", "Fall archive", null, { archived_at: "2026-01-01T00:00:00.000Z", semester_label: "Fall 2025", course_name_snapshot: "Biology archive" }),
    folder("archive-child", "Old labs", "archive-fall", { archived_at: "2026-01-01T00:00:00.000Z" }),
    folder("archive-unnamed", "Old personal", null, { archived_at: "2026-01-01T00:00:00.000Z", semester_label: "  " }),
    folder("trash-root", "Discarded", null, { trashed_at: "2026-10-02T00:00:00.000Z" }),
    folder("trash-lost-parent", "Recovered after parent loss", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_parent_id: "missing-trash-parent" }),
    folder("trash-lost-child", "Nested recovery", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_parent_id: "trash-lost-parent" }),
    folder("trash-tombstone-parent", "Recovered after tombstone", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_parent_id: "deleted-folder" }),
    folder("trash-cycle", "Unsafe cycle", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_parent_id: "cycle-a" }),
    folder("cycle-a", "Cycle A", "cycle-b"),
    folder("cycle-b", "Cycle B", "cycle-a"),
    folder("orphan", "Orphan", "missing-parent"),
    folder("deleted-folder", "Deleted", null, { deleted_at: "2026-10-01T00:00:00.000Z" }),
    folder("purging-folder", "Purging", null, { purge_pending_at: "2026-10-01T00:00:00.000Z" }),
  ];
  const files = [
    file("root-personal", "Root note.txt"),
    file("course-associated-personal", "Course linked note.txt", "personal-child", { course_id: "biology" }),
    file("course-location-unlinked", "Course unlinked note.txt", "course-child"),
    file("course-associated", "BIO note.txt", "course-grandchild", { course_id: "biology" }),
    file("personal-child-file", "Research plan.txt", "personal-child"),
    file("archive-file", "Old note.txt", "archive-child"),
    file("trash-file", "Trashed note.txt", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_folder_id: "trash-root" }),
    file("trash-lost-file", "Nested recovery.txt", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_folder_id: "trash-lost-parent" }),
    file("trash-missing-file", "Restorable missing parent.txt", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_folder_id: "missing-trash-parent" }),
    file("cycle-file", "Cycle note.txt", "cycle-a"),
    file("orphan-file", "Orphan note.txt", "orphan"),
    file("deleted-file", "Deleted note.txt", null, { deleted_at: "2026-10-01T00:00:00.000Z" }),
    file("purging-file", "Purging note.txt", null, { purge_pending_at: "2026-10-01T00:00:00.000Z" }),
    file("pdf-file", "Guide.PDF", null, { mime_type: "application/pdf" }),
    file("image-file", "Photo.png", null, { mime_type: "image/png" }),
    file("binary-file", "Archive.zip", null, { mime_type: "application/zip" }),
  ];
  return { folders, files, fileActivity: {}, folderActivity: {} };
}

test("search is name-only in the current folder and all-scope searches valid items across active folders", () => {
  const data = fixture();
  const scoped = deriveFilesBrowser(data, { view: "my-files", folderId: "personal-child", layout: "list" }, { query: "plan" });
  assert.deepEqual(itemIds(scoped), ["personal-child-file"]);
  const doesNotSearchParentPath = deriveFilesBrowser(data, { view: "my-files", folderId: "personal-child", layout: "list" }, { query: "Personal" });
  assert.deepEqual(doesNotSearchParentPath.items, []);

  const all = deriveFilesBrowser(data, { view: "my-files", folderId: "personal-child", layout: "list" }, { query: "note", searchScope: "all" });
  assert.deepEqual(itemIds(all), ["course-associated", "course-associated-personal", "course-location-unlinked", "root-personal"]);
  assert.equal(all.folder.id, "personal-child", "all-scope search preserves the current location context");
  assert.ok(!itemIds(all).includes("archive-file"), "all-scope search excludes archives by default");
  assert.ok(!itemIds(all).includes("trash-file"), "all-scope search never includes Trash");
});

test("course search filters file association independently from folder location", () => {
  const data = fixture();
  const courseResults = deriveFilesBrowser(data, atRoot(), { query: "", courseFilter: "biology" });
  assert.deepEqual(itemIds(courseResults), ["course"]);
  assert.ok(!itemIds(courseResults).includes("course-location-unlinked"), "a course folder does not assign its file to that course");

  const personalResults = deriveFilesBrowser(data, atRoot(), { query: "", courseFilter: "personal" });
  assert.deepEqual(itemIds(personalResults), ["personal", "binary-file", "pdf-file", "image-file", "root-personal"]);

  const allSearch = deriveFilesBrowser(data, atRoot(), { query: "linked", searchScope: "all", courseFilter: "biology" });
  assert.deepEqual(itemIds(allSearch), ["course-associated-personal"]);
});

test("file-type filters classify text, PDF, image, and other without hiding folders", () => {
  const data = fixture();
  const addFolder = folder("nav-folder", "Navigation folder");
  data.folders.push(addFolder);
  for (const [kind, expected] of [
    ["text", ["course", "nav-folder", "personal", "root-personal"]],
    ["pdf", ["course", "nav-folder", "personal", "pdf-file"]],
    ["image", ["course", "nav-folder", "personal", "image-file"]],
    ["other", ["course", "nav-folder", "personal", "binary-file"]],
  ]) {
    assert.deepEqual(itemIds(deriveFilesBrowser(data, atRoot(), { fileType: kind })), expected, `${kind} type`);
  }
  data.files.push(file("csv-file", "Records.csv", null, { mime_type: "text/csv" }));
  assert.ok(itemIds(deriveFilesBrowser(data, atRoot(), { fileType: "text" })).includes("csv-file"), "text MIME formats cannot fall between Text and Other");
  assert.ok(!itemIds(deriveFilesBrowser(data, atRoot(), { fileType: "other" })).includes("csv-file"));
});

test("name and modified sorts honor direction while folders stay first and ties use stable IDs", () => {
  const data = {
    folders: [folder("folder-z", "Same"), folder("folder-a", "Same"), folder("folder-last", "Zulu")],
    files: [
      file("file-z", "Same.txt", null, { updated_at: "2026-10-03T00:00:00.000Z" }),
      file("file-a", "Same.txt", null, { updated_at: "2026-10-03T00:00:00.000Z" }),
      file("file-old", "Alpha.txt", null, { updated_at: "2026-10-01T00:00:00.000Z" }),
    ],
    fileActivity: {}, folderActivity: {},
  };

  assert.deepEqual(itemIds(deriveFilesBrowser(data, atRoot(), { sortBy: "name", sortDirection: "asc" })), ["folder-a", "folder-z", "folder-last", "file-old", "file-a", "file-z"]);
  assert.deepEqual(itemIds(deriveFilesBrowser(data, atRoot(), { sortBy: "name", sortDirection: "desc" })), ["folder-last", "folder-a", "folder-z", "file-a", "file-z", "file-old"]);
  assert.deepEqual(itemIds(deriveFilesBrowser(data, atRoot(), { sortBy: "modified", sortDirection: "asc" })), ["folder-a", "folder-last", "folder-z", "file-old", "file-a", "file-z"]);
  assert.deepEqual(itemIds(deriveFilesBrowser(data, atRoot(), { sortBy: "modified", sortDirection: "desc" })), ["folder-a", "folder-last", "folder-z", "file-a", "file-z", "file-old"]);
});

test("includeArchived reveals archived roots but still excludes Trash, tombstones, broken parents, and cycles", () => {
  const data = fixture();
  const defaultSearch = deriveFilesBrowser(data, atRoot(), { query: "note", searchScope: "all" });
  assert.ok(!itemIds(defaultSearch).includes("archive-fall"));

  const include = deriveFilesBrowser(data, atRoot(), { query: "note", searchScope: "all", includeArchived: true });
  assert.ok(itemIds(include).includes("archive-file"));
  for (const invalidId of ["trash-root", "trash-file", "deleted-folder", "purging-folder", "deleted-file", "purging-file", "cycle-a", "cycle-b", "cycle-file", "orphan", "orphan-file"]) {
    assert.ok(!itemIds(include).includes(invalidId), `${invalidId} is excluded`);
  }
});

test("Recent follows successful opens by last-opened time, independent of modified sort", () => {
  const data = {
    folders: [],
    files: [
      file("opened-latest", "A.txt", null, { updated_at: "2026-10-01T00:00:00.000Z" }),
      file("modified-latest", "Z.txt", null, { updated_at: "2026-10-08T00:00:00.000Z" }),
      file("pending", "Pending.txt", null, { state: "pending" }),
      file("deleted", "Deleted.txt", null, { deleted_at: "2026-10-08T00:00:00.000Z" }),
    ],
    fileActivity: {
      "opened-latest": { starred_at: null, last_opened_at: "2026-10-08T12:00:00.000Z" },
      "modified-latest": { starred_at: null, last_opened_at: "2026-10-08T11:00:00.000Z" },
      pending: { starred_at: null, last_opened_at: "2026-10-08T13:00:00.000Z" },
      deleted: { starred_at: null, last_opened_at: "2026-10-08T14:00:00.000Z" },
    },
    folderActivity: {},
  };
  assert.deepEqual(itemIds(deriveFilesBrowser(data, atRoot("recent"), { sortBy: "modified", sortDirection: "asc" })), ["opened-latest", "modified-latest"]);
});

test("Recent can include actually opened archived files while keeping open-time ordering", () => {
  const data = fixture();
  data.fileActivity = {
    "archive-file": { starred_at: null, last_opened_at: "2026-10-08T14:00:00.000Z" },
    "course-associated": { starred_at: null, last_opened_at: "2026-10-08T13:00:00.000Z" },
  };
  const recent = deriveFilesBrowser(data, atRoot("recent"), { includeArchived: true, sortBy: "modified", sortDirection: "asc" });
  assert.deepEqual(itemIds(recent), ["archive-file", "course-associated"]);
  assert.deepEqual(itemIds(deriveFilesBrowser(data, atRoot("recent"))), ["course-associated"], "archives stay excluded unless requested");
});

test("browser item locations preserve active, archived snapshot, and original Trash paths", () => {
  const data = fixture();
  const active = browserItemLocation({ type: "file", id: "course-associated", file: data.files.find(({ id }) => id === "course-associated") }, data.folders);
  assert.deepEqual(active, { label: "My files / BIO 201 / Labs / Week 1", folderId: "course-grandchild", view: "my-files", unavailable: false });

  const archived = browserItemLocation({ type: "file", id: "archive-file", file: data.files.find(({ id }) => id === "archive-file") }, data.folders);
  assert.deepEqual(archived, { label: "Archives / Fall 2025 / Biology archive / Old labs", folderId: "archive-child", view: "archives", unavailable: false });
  const archiveRoot = data.folders.find(({ id }) => id === "archive-fall");
  assert.deepEqual(browserItemLocation({ type: "folder", id: archiveRoot.id, folder: archiveRoot }, data.folders), {
    label: "Archives / Fall 2025", folderId: null, view: "archives", unavailable: false,
  });

  const trashed = file("trashed-with-path", "Gone.txt", null, {
    trashed_at: "2026-10-02T00:00:00.000Z", original_folder_id: "personal-child",
    original_location_path: "My files / Personal / Research / Gone.txt",
  });
  assert.deepEqual(browserItemLocation({ type: "file", id: trashed.id, file: trashed }, data.folders), {
    label: "My files / Personal / Research / Gone.txt", folderId: null, view: "trash", unavailable: false,
  });
  const tombstone = { ...trashed, deleted_at: "2026-10-08T00:00:00.000Z" };
  assert.equal(browserItemLocation({ type: "file", id: tombstone.id, file: tombstone }, data.folders).unavailable, true);
});

test("archive groups retain stable display labels while search filters their items", () => {
  const data = fixture();
  const archives = deriveFilesBrowser(data, atRoot("archives"));
  assert.deepEqual(archives.archiveGroups.map(({ label }) => label), ["Archived", "Fall 2025"]);
  assert.deepEqual(archives.archiveGroups.map(({ items }) => items.map(({ id }) => id)), [["archive-unnamed"], ["archive-fall"]]);

  const searched = deriveFilesBrowser(data, atRoot("archives"), { query: "Fall" });
  assert.deepEqual(searched.archiveGroups.map(({ label }) => label), ["Fall 2025"]);
  assert.deepEqual(searched.archiveGroups[0].items.map(({ id }) => id), ["archive-fall"]);
  assert.equal(data.folders.find(({ id }) => id === "archive-fall").semester_label, "Fall 2025");
  assert.equal(data.folders.find(({ id }) => id === "archive-unnamed").semester_label, "  ");
  assert.deepEqual(archives.archiveGroups.map(({ label }) => label), ["Archived", "Fall 2025"], "a later search does not mutate an earlier derivation");
});

test("Trash keeps recoverable roots with missing or tombstoned original parents and opens their subtree", () => {
  const data = fixture();
  const trash = deriveFilesBrowser(data, atRoot("trash"));
  assert.ok(itemIds(trash).includes("trash-lost-parent"));
  assert.ok(itemIds(trash).includes("trash-tombstone-parent"));
  assert.ok(itemIds(trash).includes("trash-missing-file"));
  assert.ok(!itemIds(trash).includes("trash-cycle"), "cyclic original paths remain unavailable");

  const lostRoot = deriveFilesBrowser(data, { view: "trash", folderId: "trash-lost-parent", layout: "list" });
  assert.equal(lostRoot.unavailable, false);
  assert.deepEqual(itemIds(lostRoot), ["trash-lost-child", "trash-lost-file"]);
});
