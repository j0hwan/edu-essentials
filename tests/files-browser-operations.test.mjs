import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const {
  BrowserOrganizationFailure,
  actionItems,
  associationDiffersFromLocation,
  createCustomFolder,
  deduplicateMoveItems,
  folderCourseId,
  folderDestinationReason,
  moveBrowserItems,
  moveDestinationReason,
  renameBrowserItem,
} = await import(await clientModule("lib/files-browser-operations.ts"));

const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE_ROOT = "11111111-1111-4111-8111-111111111111";
const COURSE_CHILD = "22222222-2222-4222-8222-222222222222";
const PERSONAL_ROOT = "33333333-3333-4333-8333-333333333333";
const PERSONAL_CHILD = "44444444-4444-4444-8444-444444444444";
const ARCHIVE_ROOT = "55555555-5555-4555-8555-555555555555";
const ARCHIVE_CHILD = "66666666-6666-4666-8666-666666666666";
const TRASH_ROOT = "77777777-7777-4777-8777-777777777777";
const CYCLE_A = "88888888-8888-4888-8888-888888888888";
const CYCLE_B = "99999999-9999-4999-8999-999999999999";
const FILE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const FOLDER_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const DESTINATION_ID = "cccccccc-1111-4111-8111-111111111111";
const NOW = "2026-10-08T12:00:00.000Z";

function makeFolder(id, name, parent_id = null, overrides = {}) {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
    created_at: NOW, updated_at: NOW, archived_at: null, semester_label: null,
    course_name_snapshot: null, course_color_snapshot: null, trashed_at: null,
    trash_operation_id: null, original_parent_id: null, ...overrides,
  };
}

function makeFile(id, name, folder_id = null, overrides = {}) {
  return {
    id, name, mime_type: "text/plain", size_bytes: 12, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: NOW, updated_at: NOW,
    content_sha256: null, folder_id, content_backend: "object", metadata_revision: 1,
    content_revision: 1, trashed_at: null, trash_operation_id: null,
    original_folder_id: null, ...overrides,
  };
}

const folders = [
  makeFolder(COURSE_ROOT, "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
  makeFolder(COURSE_CHILD, "Labs", COURSE_ROOT),
  makeFolder(PERSONAL_ROOT, "Notes"),
  makeFolder(PERSONAL_CHILD, "Research", PERSONAL_ROOT),
  makeFolder(ARCHIVE_ROOT, "Fall archive", null, { archived_at: NOW, semester_label: "Fall 2025" }),
  makeFolder(ARCHIVE_CHILD, "Archived child", ARCHIVE_ROOT, { archived_at: NOW }),
  makeFolder(TRASH_ROOT, "Trash", null, { trashed_at: NOW }),
  makeFolder(CYCLE_A, "Cycle A", CYCLE_B),
  makeFolder(CYCLE_B, "Cycle B", CYCLE_A),
];

function fileItem(file) { return { type: "file", id: file.id, file }; }
function folderItem(folder) { return { type: "folder", id: folder.id, folder }; }

async function withFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); }
  finally { globalThis.fetch = originalFetch; }
}

test("move selection deduplication removes descendants while action revisions retain every selected item", () => {
  const root = makeFolder(PERSONAL_ROOT, "Notes");
  const child = makeFolder(PERSONAL_CHILD, "Research", PERSONAL_ROOT, { revision: 3 });
  const childFile = makeFile(FILE_ID, "Source.txt", PERSONAL_CHILD, { metadata_revision: 7 });
  const selected = [folderItem(root), folderItem(child), fileItem(childFile), fileItem(childFile)];

  assert.deepEqual(deduplicateMoveItems(selected, [root, child]).map(({ type, id }) => [type, id]), [["folder", PERSONAL_ROOT]]);
  assert.deepEqual(actionItems(selected), [
    { type: "folder", id: PERSONAL_ROOT, revision: 1 },
    { type: "folder", id: PERSONAL_CHILD, revision: 3 },
    { type: "file", id: FILE_ID, revision: 7 },
  ]);
});

test("destination and move guards reject deep cycles, archived or trashed paths, and managed course roots", () => {
  const custom = makeFolder(PERSONAL_ROOT, "Notes");
  const selectedFile = fileItem(makeFile(FILE_ID, "Source.txt", PERSONAL_ROOT));
  const managedCourse = folderItem(folders[0]);

  assert.equal(folderDestinationReason(PERSONAL_CHILD, folders), "");
  assert.match(folderDestinationReason(CYCLE_A, folders), /cycle/i);
  assert.match(folderDestinationReason(ARCHIVE_CHILD, folders), /archived/i);
  assert.match(folderDestinationReason(TRASH_ROOT, folders), /Trash/i);
  assert.match(folderDestinationReason("aaaaaaaa-2222-4222-8222-222222222222", folders), /could not be found/i);
  assert.match(moveDestinationReason([managedCourse], null, folders), /stay at the root/i);
  assert.match(moveDestinationReason([folderItem(custom)], PERSONAL_CHILD, folders), /itself or one of its descendants/i);
  assert.match(moveDestinationReason([selectedFile], ARCHIVE_CHILD, folders), /archived/i);
  assert.match(moveDestinationReason([selectedFile], TRASH_ROOT, folders), /Trash/i);
  assert.match(moveDestinationReason([fileItem(makeFile(FILE_ID, "Broken.txt", CYCLE_A))], null, folders), /invalid or missing folder path/i);
});

test("course ancestry and file associations remain independent of folder location", () => {
  assert.equal(folderCourseId(COURSE_CHILD, folders), "biology");
  assert.equal(folderCourseId(PERSONAL_CHILD, folders), "");
  assert.equal(folderCourseId(null, folders), "");

  assert.equal(associationDiffersFromLocation(makeFile(FILE_ID, "BIO.txt", COURSE_CHILD, { course_id: "biology" }), folders), false);
  assert.equal(associationDiffersFromLocation(makeFile(FILE_ID, "Linked.txt", PERSONAL_CHILD, { course_id: "biology", assignment_id: "essay" }), folders), true);
  assert.equal(associationDiffersFromLocation(makeFile(FILE_ID, "Unlinked.txt", COURSE_CHILD), folders), true);
});

test("folder creation retries with the same client ID and sends the profile-scoped request", async () => {
  const requests = [];
  const responseFolder = makeFolder(FOLDER_ID, "Repeated name", COURSE_CHILD, { profile_id: PROFILE });
  await withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({ folder: responseFolder });
  }, async () => {
    const input = { id: FOLDER_ID, name: "Repeated name", parentId: COURSE_CHILD };
    const first = await createCustomFolder(PROFILE, input);
    const retry = await createCustomFolder(PROFILE, input);
    assert.equal(first.id, FOLDER_ID);
    assert.equal(retry.id, FOLDER_ID);
  });

  assert.equal(requests.length, 2);
  for (const { url, init, body } of requests) {
    assert.equal(url, "/api/file-folders");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("x-profile-id"), PROFILE);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(body, { id: FOLDER_ID, name: "Repeated name", parentId: COURSE_CHILD });
  }
});

test("a file rename uses metadata revision only and preserves content and association revisions", async () => {
  const original = makeFile(FILE_ID, "Essay.txt", COURSE_CHILD, {
    course_id: "biology", assignment_id: "final-essay", metadata_revision: 4, content_revision: 9,
  });
  const requests = [];
  await withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({ file: { ...original, name: "Final essay.txt", metadata_revision: 5, profile_id: PROFILE } });
  }, async () => {
    const renamed = await renameBrowserItem(PROFILE, fileItem(original), "Final essay.txt");
    assert.equal(renamed.file.name, "Final essay.txt");
    assert.equal(renamed.file.content_revision, 9);
    assert.equal(renamed.file.folder_id, COURSE_CHILD);
    assert.equal(renamed.file.course_id, "biology");
    assert.equal(renamed.file.assignment_id, "final-essay");
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `/api/files?id=${encodeURIComponent(FILE_ID)}`);
  assert.equal(requests[0].init.method, "PUT");
  assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), PROFILE);
  assert.deepEqual(requests[0].body, { action: "rename", name: "Final essay.txt", baseMetadataRevision: 4 });
});

test("move request carries every selected item revision and verifies the scoped result", async () => {
  const parent = makeFolder(PERSONAL_ROOT, "Notes", null, { revision: 2 });
  const child = makeFolder(PERSONAL_CHILD, "Research", PERSONAL_ROOT, { revision: 5 });
  const sourceFile = makeFile(FILE_ID, "Source.txt", PERSONAL_CHILD, { metadata_revision: 7, content_revision: 3 });
  const selected = [folderItem(parent), folderItem(child), fileItem(sourceFile)];
  const requests = [];
  await withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({
      folders: [{ ...parent, parent_id: DESTINATION_ID, revision: 3, profile_id: PROFILE }],
      files: [],
    });
  }, async () => {
    const moved = await moveBrowserItems(PROFILE, selected, DESTINATION_ID, { folders: [parent, child] });
    assert.equal(moved.folders.length, 1, "the move acknowledgement confirms only the effective selected root");
    assert.equal(moved.folders[0].id, PERSONAL_ROOT);
    assert.equal(moved.files.length, 0, "covered descendants are not accepted as substitute acknowledgements");
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/files/actions");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), PROFILE);
  assert.deepEqual(requests[0].body, {
    action: "move",
    destinationId: DESTINATION_ID,
    items: [
      { type: "folder", id: PERSONAL_ROOT, revision: 2 },
      { type: "folder", id: PERSONAL_CHILD, revision: 5 },
      { type: "file", id: FILE_ID, revision: 7 },
    ],
  });
});

test("a captured full hierarchy lets an ancestor move acknowledge a selected deep file as covered", async () => {
  const parent = makeFolder(PERSONAL_ROOT, "Notes", null, { revision: 2 });
  const unselectedChild = makeFolder(PERSONAL_CHILD, "Research", PERSONAL_ROOT, { revision: 5 });
  const deepFile = makeFile(FILE_ID, "Source.txt", PERSONAL_CHILD, { metadata_revision: 7 });
  let requestBody;
  await withFetch(async (_input, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({
      folders: [{ ...parent, parent_id: DESTINATION_ID, revision: 3 }],
      files: [],
    });
  }, async () => {
    const moved = await moveBrowserItems(
      PROFILE,
      [folderItem(parent), fileItem(deepFile)],
      DESTINATION_ID,
      { folders: [parent, unselectedChild] },
    );
    assert.equal(moved.folders.length, 1);
    assert.equal(moved.folders[0].id, PERSONAL_ROOT);
  });
  assert.deepEqual(requestBody.items, [
    { type: "folder", id: PERSONAL_ROOT, revision: 2 },
    { type: "file", id: FILE_ID, revision: 7 },
  ], "the covered deep file revision still travels with the raw selection");
});

test("move acknowledgements reject empty or subset results, missing nested roots, and unchanged revisions after relocation", async () => {
  const destination = makeFolder(DESTINATION_ID, "Destination");
  const parent = makeFolder(PERSONAL_ROOT, "Notes", null, { revision: 2 });
  const child = makeFolder(PERSONAL_CHILD, "Research", PERSONAL_ROOT, { revision: 5 });
  const nestedFile = makeFile(FILE_ID, "Source.txt", PERSONAL_CHILD, { metadata_revision: 7 });
  const unrelatedFile = makeFile("dddddddd-1111-4111-8111-111111111111", "Other.txt", null, { metadata_revision: 4 });
  const selectedNested = [folderItem(parent), folderItem(child), fileItem(nestedFile)];
  const allFolders = [destination, parent, child];
  const expectConflict = async (items, payload, hierarchy = allFolders) => withFetch(
    async () => Response.json(payload),
    () => assert.rejects(
      moveBrowserItems(PROFILE, items, DESTINATION_ID, { folders: hierarchy }),
      (error) => error instanceof BrowserOrganizationFailure && error.kind === "conflict",
    ),
  );

  await expectConflict([fileItem(unrelatedFile)], { files: [], folders: [] }, [destination]);
  await expectConflict(
    [fileItem(unrelatedFile), fileItem(makeFile("eeeeeeee-1111-4111-8111-111111111111", "Second.txt", null, { metadata_revision: 2 }))],
    { files: [{ ...unrelatedFile, folder_id: DESTINATION_ID, metadata_revision: 5 }], folders: [] },
    [destination],
  );
  await expectConflict(
    selectedNested,
    { files: [], folders: [{ ...child, parent_id: DESTINATION_ID, revision: 6 }] },
    allFolders,
  );

  const sourceFile = makeFile("ffffffff-1111-4111-8111-111111111111", "Unchanged.txt", null, { metadata_revision: 3 });
  await expectConflict(
    [fileItem(sourceFile)],
    { files: [{ ...sourceFile, folder_id: DESTINATION_ID, metadata_revision: 3 }], folders: [] },
    [destination],
  );
});

test("strong account fences reject mismatched profiles in successful mutation responses", async () => {
  await withFetch(async () => Response.json({ folder: makeFolder(FOLDER_ID, "Wrong account", null, { profile_id: OTHER_PROFILE }) }), async () => {
    await assert.rejects(
      createCustomFolder(PROFILE, { id: FOLDER_ID, name: "Wrong account", parentId: null }),
      (error) => error instanceof BrowserOrganizationFailure && error.kind === "session-error" && /different signed-in account/i.test(error.message),
    );
  });
});
