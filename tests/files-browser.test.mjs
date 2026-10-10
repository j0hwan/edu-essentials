import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { deriveFilesBrowser } = await import(await clientModule("lib/files-browser.ts"));

const folder = (id, name, parent_id = null, fields = {}) => ({
  id,
  name,
  parent_id,
  kind: "custom",
  course_id: null,
  course_code: null,
  revision: 1,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  archived_at: null,
  semester_label: null,
  course_name_snapshot: null,
  course_color_snapshot: null,
  trashed_at: null,
  trash_operation_id: null,
  original_parent_id: null,
  ...fields,
});

const file = (id, name, folder_id = null, fields = {}) => ({
  id,
  name,
  mime_type: "text/plain",
  size_bytes: 100,
  course_id: null,
  assignment_id: null,
  kind: "resource",
  state: "ready",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  content_sha256: null,
  folder_id,
  content_backend: "object",
  metadata_revision: 1,
  content_revision: 1,
  trashed_at: null,
  trash_operation_id: null,
  original_folder_id: null,
  ...fields,
});

const data = {
  folders: [
    folder("course-root", "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
    folder("custom-root", "Class notes"),
    folder("nested", "Labs", "custom-root"),
    folder("deep", "Week 1", "nested"),
    folder("archive-root", "Fall 2025", null, { archived_at: "2026-01-01T00:00:00.000Z", semester_label: "Fall 2025", course_color_snapshot: "#335577" }),
    folder("archive-child", "Old labs", "archive-root"),
    folder("trash-root", "Discarded", null, { trashed_at: "2026-10-02T00:00:00.000Z" }),
    folder("trash-child", "Discarded child", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_parent_id: "trash-root" }),
  ],
  files: [
    file("root-file", "zeta.txt"),
    file("child-file", "notes.txt", "custom-root"),
    file("deep-file", "week.txt", "deep"),
    file("course-file", "reading.txt", "course-root", { course_id: "biology" }),
    file("archive-file", "old.txt", "archive-child"),
    file("trash-file", "removed.txt", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_folder_id: "trash-root" }),
    file("pending-file", "upload.txt", null, { state: "pending" }),
  ],
  fileActivity: {
    "root-file": { starred_at: null, last_opened_at: "2026-10-03T10:00:00.000Z" },
    "child-file": { starred_at: "2026-10-03T09:00:00.000Z", last_opened_at: "2026-10-03T11:00:00.000Z" },
    "deep-file": { starred_at: null, last_opened_at: "2026-10-03T12:00:00.000Z" },
    "archive-file": { starred_at: "2026-10-03T13:00:00.000Z", last_opened_at: "2026-10-03T13:00:00.000Z" },
  },
  folderActivity: {
    "custom-root": { starred_at: "2026-10-03T08:00:00.000Z", last_opened_at: null },
    nested: { starred_at: null, last_opened_at: null },
    "archive-root": { starred_at: "2026-10-03T07:00:00.000Z", last_opened_at: null },
  },
};

test("My Files returns direct children, folders first, and preserves item IDs after a rename", () => {
  const root = deriveFilesBrowser(data, { view: "my-files", folderId: null, layout: "list" });
  assert.deepEqual(root.items.map(({ type, id }) => [type, id]), [
    ["folder", "course-root"],
    ["folder", "custom-root"],
    ["file", "pending-file"],
    ["file", "root-file"],
  ]);
  assert.deepEqual(root.breadcrumbs, []);

  const deep = deriveFilesBrowser(data, { view: "my-files", folderId: "deep", layout: "grid" });
  assert.deepEqual(deep.breadcrumbs.map(({ id }) => id), ["custom-root", "nested", "deep"]);
  assert.deepEqual(deep.items.map(({ id }) => id), ["deep-file"]);
  assert.equal(deep.folder.id, "deep");

  const renamed = structuredClone(data);
  renamed.folders.find(({ id }) => id === "deep").name = "Week One";
  const afterRename = deriveFilesBrowser(renamed, { view: "my-files", folderId: "deep", layout: "grid" });
  assert.equal(afterRename.folder.name, "Week One");
  assert.equal(afterRename.items[0].id, deep.items[0].id);
});

test("Recent and Starred filter unavailable content and apply activity ordering", () => {
  const recent = deriveFilesBrowser(data, { view: "recent", folderId: null, layout: "list" });
  assert.deepEqual(recent.items.map(({ id }) => id), ["deep-file", "child-file", "root-file"]);

  const starred = deriveFilesBrowser(data, { view: "starred", folderId: null, layout: "grid" });
  assert.deepEqual(starred.items.map(({ type, id }) => [type, id]), [
    ["folder", "custom-root"],
    ["file", "child-file"],
  ]);
  const nestedStarred = deriveFilesBrowser(data, { view: "starred", folderId: "custom-root", layout: "list" });
  assert.deepEqual(nestedStarred.items.map(({ id }) => id), ["nested", "child-file"]);
});

test("Archives and Trash show their own direct-child hierarchies", () => {
  const archives = deriveFilesBrowser(data, { view: "archives", folderId: null, layout: "list" });
  assert.deepEqual(archives.items.map(({ id }) => id), ["archive-root"]);
  const archiveContents = deriveFilesBrowser(data, { view: "archives", folderId: "archive-root", layout: "list" });
  assert.deepEqual(archiveContents.items.map(({ type, id }) => [type, id]), [["folder", "archive-child"]]);
  const archiveDeep = deriveFilesBrowser(data, { view: "archives", folderId: "archive-child", layout: "list" });
  assert.deepEqual(archiveDeep.items.map(({ id }) => id), ["archive-file"]);

  const trash = deriveFilesBrowser(data, { view: "trash", folderId: null, layout: "list" });
  assert.deepEqual(trash.items.map(({ id }) => id), ["trash-root"]);
  const trashContents = deriveFilesBrowser(data, { view: "trash", folderId: "trash-root", layout: "grid" });
  assert.deepEqual(trashContents.items.map(({ type, id }) => [type, id]), [
    ["folder", "trash-child"],
    ["file", "trash-file"],
  ]);
});

test("a pending folder stays visible only in Trash until its purge completes", () => {
  const interruptedPurge = structuredClone(data);
  interruptedPurge.folders.push(
    folder("pending-folder", "Cleanup folder", null, {
      trashed_at: "2026-10-04T00:00:00.000Z",
      original_parent_id: "custom-root",
      purge_pending_at: "2026-10-04T00:01:00.000Z",
    }),
    folder("deleted-folder", "Deleted tombstone", null, {
      trashed_at: "2026-10-04T00:00:00.000Z",
      original_parent_id: "custom-root",
      deleted_at: "2026-10-04T00:02:00.000Z",
    }),
  );

  const trash = deriveFilesBrowser(interruptedPurge, { view: "trash", folderId: null, layout: "list" });
  assert.ok(trash.items.some(({ id }) => id === "pending-folder"));
  assert.equal(trash.items.some(({ id }) => id === "deleted-folder"), false, "deleted tombstones stay hidden");
  assert.equal(deriveFilesBrowser(interruptedPurge, { view: "my-files", folderId: null, layout: "list" }).items.some(({ id }) => id === "pending-folder"), false);
  assert.equal(deriveFilesBrowser(interruptedPurge, { view: "archives", folderId: null, layout: "list" }).items.some(({ id }) => id === "pending-folder"), false);
  assert.equal(deriveFilesBrowser(interruptedPurge, { view: "recent", folderId: null, layout: "list" }).items.some(({ id }) => id === "pending-folder"), false);
  assert.equal(deriveFilesBrowser(interruptedPurge, { view: "starred", folderId: null, layout: "list" }).items.some(({ id }) => id === "pending-folder"), false);
  assert.equal(deriveFilesBrowser(interruptedPurge, { view: "trash", folderId: "pending-folder", layout: "list" }).unavailable, true, "pending folder navigation remains invalid");
});

test("stale, malformed, and cyclic folder locations are unavailable without broken breadcrumbs", () => {
  const missing = deriveFilesBrowser(data, { view: "my-files", folderId: "removed-folder", layout: "list" });
  assert.equal(missing.unavailable, true);
  assert.equal(missing.folder, null);
  assert.deepEqual(missing.items, []);
  assert.deepEqual(missing.breadcrumbs, []);

  const malformed = structuredClone(data);
  malformed.folders.push(folder("orphan", "Orphan", "missing-parent"));
  const orphan = deriveFilesBrowser(malformed, { view: "my-files", folderId: "orphan", layout: "list" });
  assert.equal(orphan.unavailable, true);
  assert.deepEqual(orphan.breadcrumbs, []);

  const cyclic = structuredClone(data);
  cyclic.folders.push(folder("cycle-a", "A", "cycle-b"), folder("cycle-b", "B", "cycle-a"));
  const cycle = deriveFilesBrowser(cyclic, { view: "my-files", folderId: "cycle-a", layout: "list" });
  assert.equal(cycle.unavailable, true);
  assert.deepEqual(cycle.items, []);
});
