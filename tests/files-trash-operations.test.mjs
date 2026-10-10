import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const {
  emptyTrash,
  itemTrashReason,
  originalDisplayPath,
  permanentDeleteTrashItems,
  restoreTrashItems,
  trashBrowserItems,
} = await import(await clientModule("lib/files-trash-operations.ts"));
const { BrowserOrganizationFailure } = await import(await clientModule("lib/files-browser-operations.ts"));

const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const GRANDCHILD = "33333333-3333-4333-8333-333333333333";
const FILE = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_FILE = "bbbbbbbb-1111-4111-8111-111111111111";
const RECOVERY = "cccccccc-1111-4111-8111-111111111111";
const REQUEST = "dddddddd-1111-4111-8111-111111111111";
const OPERATION = "eeeeeeee-1111-4111-8111-111111111111";
const NOW = "2026-10-08T12:00:00.000Z";

function makeFolder(id, name, parent_id = null, overrides = {}) {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 2,
    created_at: NOW, updated_at: NOW, archived_at: null, semester_label: null,
    course_name_snapshot: null, course_color_snapshot: null, trashed_at: null,
    trash_operation_id: null, original_parent_id: null, ...overrides,
  };
}

function makeFile(id, name, folder_id = null, overrides = {}) {
  return {
    id, name, mime_type: "text/plain", size_bytes: 12, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: NOW, updated_at: NOW,
    content_sha256: null, folder_id, content_backend: "object", metadata_revision: 4,
    content_revision: 9, trashed_at: null, trash_operation_id: null,
    original_folder_id: null, ...overrides,
  };
}

const rootFolder = makeFolder(ROOT, "Personal", null);
const childFolder = makeFolder(CHILD, "Research", ROOT, { revision: 3 });
const grandchildFolder = makeFolder(GRANDCHILD, "Drafts", CHILD, { revision: 5 });
const hierarchy = [rootFolder, childFolder, grandchildFolder];
const fileItem = (file) => ({ type: "file", id: file.id, file });
const folderItem = (folder) => ({ type: "folder", id: folder.id, folder });
const trashedFile = (file, originalFolderId = file.folder_id) => ({
  ...file, folder_id: null, original_folder_id: originalFolderId,
  metadata_revision: file.metadata_revision + 1, trashed_at: NOW, trash_operation_id: OPERATION,
});
const trashedFolder = (folder, originalParentId = folder.parent_id) => ({
  ...folder, parent_id: null, original_parent_id: originalParentId,
  revision: folder.revision + 1, trashed_at: NOW, trash_operation_id: OPERATION,
});

async function withFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); }
  finally { globalThis.fetch = originalFetch; }
}

function captureRequest(requests) {
  return async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body ?? "{}") });
    return Response.json({ files: [], folders: [] });
  };
}

test("recursive Trash sends every captured revision, accepts only the confirmed subtree, and preserves file associations/content revision", async () => {
  const savedFile = makeFile(FILE, "Essay.txt", GRANDCHILD, {
    course_id: "biology", assignment_id: "final-essay", kind: "syllabus", content_backend: "native-text",
  });
  const responseFile = trashedFile(savedFile);
  const responseFolders = [trashedFolder(rootFolder), trashedFolder(childFolder, ROOT), trashedFolder(grandchildFolder, CHILD)];
  const requests = [];

  const result = await withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({ files: [{ ...responseFile, profile_id: PROFILE }], folders: responseFolders.map((folder) => ({ ...folder, profile_id: PROFILE })) });
  }, () => trashBrowserItems(PROFILE, [folderItem(rootFolder), folderItem(childFolder), fileItem(savedFile)], { folders: hierarchy }));

  assert.equal(requests.length, 1);
  const [{ url, init, body }] = requests;
  assert.equal(url, "/api/files/actions");
  assert.equal(init.method, "POST");
  assert.equal(new Headers(init.headers).get("x-profile-id"), PROFILE);
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.deepEqual(body, { action: "trash", items: [
    { type: "folder", id: ROOT, revision: rootFolder.revision },
    { type: "folder", id: CHILD, revision: childFolder.revision },
    { type: "file", id: FILE, revision: savedFile.metadata_revision },
  ] }, "every selected revision reaches the server before descendants are covered by the selected root");
  assert.equal(result.undo.profileId, PROFILE);
  assert.deepEqual(result.undo.items.map(({ type, id }) => [type, id]), [["folder", ROOT]]);
  assert.equal(result.undo.label, "Personal");
  assert.equal(result.files[0].content_revision, savedFile.content_revision);
  assert.equal(result.files[0].course_id, "biology");
  assert.equal(result.files[0].assignment_id, "final-essay");
  assert.equal(result.files[0].content_backend, "native-text");
});

test("Trash acknowledgement requires every effective root and rejects rows outside its captured hierarchy", async () => {
  const selectedFile = makeFile(FILE, "Root.txt", null);
  const unrelated = trashedFile(makeFile(OTHER_FILE, "Elsewhere.txt", null), null);
  const assertConflict = (handler, items, folders = []) => withFetch(handler, () => assert.rejects(
    trashBrowserItems(PROFILE, items, { folders }),
    (error) => error instanceof BrowserOrganizationFailure && error.kind === "conflict",
  ));

  await assertConflict(async () => Response.json({ files: [], folders: [] }), [fileItem(selectedFile)]);
  await assertConflict(async () => Response.json({
    files: [{ ...unrelated, profile_id: PROFILE }],
    folders: [{ ...trashedFolder(rootFolder, null), profile_id: PROFILE }],
  }), [folderItem(rootFolder)], hierarchy);
  await assertConflict(async () => Response.json({ files: [{ ...trashedFile(selectedFile, null), content_revision: selectedFile.content_revision + 1, profile_id: PROFILE }], folders: [] }), [fileItem(selectedFile)]);

  const conflictingFolders = [rootFolder, { ...rootFolder, revision: rootFolder.revision + 1 }];
  await assert.rejects(
    trashBrowserItems(PROFILE, [folderItem(rootFolder)], { folders: conflictingFolders }),
    (error) => error instanceof BrowserOrganizationFailure && error.kind === "conflict" && /folder changed/i.test(error.message),
  );
});

test("Trash rejects invalid account, item UUID, and captured revision before making a request", async () => {
  const requests = [];
  await withFetch(captureRequest(requests), async () => {
    await assert.rejects(trashBrowserItems("not-a-uuid", [fileItem(makeFile(FILE, "Root.txt"))]), (error) => error.kind === "session-error");
    await assert.rejects(trashBrowserItems(PROFILE, [fileItem(makeFile("not-a-uuid", "Broken.txt"))]), /selected item is invalid/i);
    await assert.rejects(trashBrowserItems(PROFILE, [fileItem(makeFile(FILE, "Broken revision.txt", null, { metadata_revision: 0 }))]), /revision is invalid/i);
    await assert.rejects(trashBrowserItems(PROFILE, [fileItem(makeFile(FILE, "Missing revision.txt", null, { metadata_revision: undefined }))]), /revision is invalid/i);
  });
  assert.equal(requests.length, 0);

  const requestsWithProfileMismatch = [];
  await withFetch(async (input, init) => {
    requestsWithProfileMismatch.push({ input: String(input), profile: new Headers(init.headers).get("x-profile-id") });
    return Response.json({ profile_id: OTHER_PROFILE, files: [], folders: [] });
  }, async () => {
    await assert.rejects(trashBrowserItems(PROFILE, [fileItem(makeFile(FILE, "Root.txt"))]), (error) => error.kind === "session-error");
  });
  assert.deepEqual(requestsWithProfileMismatch, [{ input: "/api/files/actions", profile: PROFILE }]);
});

test("trashability and original-location display handle missing paths, cycles, and saved path snapshots", () => {
  const activeFile = fileItem(makeFile(FILE, "Nested.txt", GRANDCHILD));
  assert.equal(itemTrashReason(activeFile, hierarchy), "");
  assert.match(itemTrashReason(activeFile, [rootFolder, childFolder]), /unavailable folder path/i);
  const cycleA = makeFolder(ROOT, "Cycle A", CHILD);
  const cycleB = makeFolder(CHILD, "Cycle B", ROOT);
  assert.match(itemTrashReason(fileItem(makeFile(FILE, "Cycle.txt", ROOT)), [cycleA, cycleB]), /cycle/i);

  const trashed = fileItem(makeFile(FILE, "Nested.txt", null, {
    trashed_at: NOW, trash_operation_id: OPERATION, original_folder_id: GRANDCHILD,
  }));
  assert.equal(originalDisplayPath(trashed, hierarchy), "My files / Personal / Research / Drafts");
  assert.equal(originalDisplayPath({ ...trashed, file: { ...trashed.file, original_location_path: "My files / Captured / Before rename" } }, []), "My files / Captured / Before rename");
  assert.equal(originalDisplayPath(trashed, [rootFolder]), "Unavailable original folder");
  assert.equal(originalDisplayPath(trashed, [cycleA, cycleB]), "Unavailable original folder");
  assert.equal(originalDisplayPath(fileItem(makeFile(FILE, "Root.txt", null, { trashed_at: NOW, trash_operation_id: OPERATION }))), "My files");
});

test("restore keeps the captured root revision, returns the visible recovery folder, and refuses unselected acknowledgement rows", async () => {
  const trashedRoot = trashedFolder(rootFolder, null);
  const trashedChild = trashedFolder(childFolder, ROOT);
  const trashedLeaf = trashedFolder(grandchildFolder, CHILD);
  const recovery = makeFolder(RECOVERY, "Restored files", null, { revision: 1, profile_id: PROFILE });
  const restoredRoot = { ...rootFolder, revision: trashedRoot.revision + 1, profile_id: PROFILE };
  const restoredChild = { ...childFolder, profile_id: PROFILE };
  const restoredLeaf = { ...grandchildFolder, profile_id: PROFILE };
  const restoredFile = { ...makeFile(FILE, "Essay.txt", GRANDCHILD, { course_id: "biology", assignment_id: "essay", content_revision: 12 }), profile_id: PROFILE };
  const requests = [];

  const result = await withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({ files: [restoredFile], folders: [restoredRoot, restoredChild, restoredLeaf], recoveryFolder: recovery });
  }, () => restoreTrashItems(PROFILE, [folderItem(trashedRoot)], { folders: [trashedRoot, trashedChild, trashedLeaf] }));

  assert.deepEqual(requests[0].body, { action: "restore", items: [{ type: "folder", id: ROOT, revision: trashedRoot.revision }] });
  assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), PROFILE);
  assert.equal(result.recoveryFolder.id, RECOVERY);
  assert.equal(result.recoveryFolder.name, "Restored files");
  assert.equal(result.files[0].content_revision, 12);
  assert.equal(result.files[0].course_id, "biology");
  assert.equal(result.files[0].assignment_id, "essay");

  await withFetch(async () => Response.json({
    files: [{ ...restoredFile, id: OTHER_FILE, folder_id: null, profile_id: PROFILE }], folders: [restoredRoot], recoveryFolder: null,
  }), async () => {
    await assert.rejects(
      restoreTrashItems(PROFILE, [folderItem(trashedRoot)], { folders: [trashedRoot, trashedChild, trashedLeaf] }),
      (error) => error instanceof BrowserOrganizationFailure,
    );
  });
});

test("covered restore descendants retain their revisions and invalid covered selections fail before a request", async () => {
  const parent = trashedFolder(rootFolder);
  const child = trashedFile(makeFile(FILE, "Covered.txt", ROOT));
  const requests = [];
  await withFetch(async (_input, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.deepEqual(body.items, [
      { type: "folder", id: ROOT, revision: parent.revision },
      { type: "file", id: FILE, revision: child.metadata_revision },
    ]);
    return Response.json({ error: "The selected child changed." }, { status: 409 });
  }, () => assert.rejects(restoreTrashItems(PROFILE, [folderItem(parent), fileItem(child)], { folders: [parent] }), /child changed/));
  assert.equal(requests.length, 1);

  const unexpectedRequests = [];
  await withFetch(captureRequest(unexpectedRequests), async () => {
    await assert.rejects(trashBrowserItems(PROFILE, [folderItem(rootFolder), fileItem(makeFile(FILE, "Invalid.txt", ROOT, { metadata_revision: 0 }))], { folders: [rootFolder] }), /revision is invalid/);
    await assert.rejects(restoreTrashItems(PROFILE, [folderItem(parent), fileItem({ ...child, metadata_revision: 0 })], { folders: [parent] }), /revision is invalid/);
    await assert.rejects(restoreTrashItems(PROFILE, [fileItem(child), fileItem({ ...child, metadata_revision: child.metadata_revision + 1 })]), /conflicting revisions/);
  });
  assert.equal(unexpectedRequests.length, 0);
});

test("restore keeps an independently trashed child selected beside its parent and requires both root acknowledgements", async () => {
  const parent = trashedFolder(rootFolder, null);
  const independentOperation = "ffffffff-1111-4111-8111-111111111111";
  const independentChild = makeFile(FILE, "Earlier removal.txt", null, {
    trashed_at: NOW, trash_operation_id: independentOperation, original_folder_id: ROOT,
    metadata_revision: 8, content_revision: 11, course_id: "biology", assignment_id: "essay",
  });
  const selected = [folderItem(parent), fileItem(independentChild)];
  const restoredParent = { ...rootFolder, revision: parent.revision + 1, profile_id: PROFILE };
  const restoredChild = {
    ...independentChild, folder_id: ROOT, original_folder_id: null, trashed_at: null,
    trash_operation_id: null, metadata_revision: independentChild.metadata_revision + 1, profile_id: PROFILE,
  };
  const requests = [];

  const restored = await withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({ files: [restoredChild], folders: [restoredParent], recoveryFolder: null });
  }, () => restoreTrashItems(PROFILE, selected, { folders: [parent] }));

  assert.deepEqual(requests[0].body, {
    action: "restore",
    items: [
      { type: "folder", id: ROOT, revision: parent.revision },
      { type: "file", id: FILE, revision: independentChild.metadata_revision },
    ],
  }, "a selected parent cannot absorb a child trashed by another operation");
  assert.deepEqual(restored.folders.map((folder) => folder.id), [ROOT]);
  assert.deepEqual(restored.files.map((file) => file.id), [FILE]);
  assert.equal(restored.files[0].course_id, "biology");
  assert.equal(restored.files[0].assignment_id, "essay");
  assert.equal(restored.files[0].content_revision, 11);

  await withFetch(async () => Response.json({ files: [], folders: [restoredParent], recoveryFolder: null }), () => assert.rejects(
    restoreTrashItems(PROFILE, selected, { folders: [parent] }),
    (error) => error instanceof BrowserOrganizationFailure && error.kind === "conflict",
  ));
});

test("permanent deletion requires the exact request UUID and valid acknowledgements for every selected root", async () => {
  const trashed = makeFile(FILE, "Old.txt", null, { trashed_at: NOW, trash_operation_id: OPERATION });
  const selected = [fileItem(trashed)];
  const requests = [];
  const response = async (payload) => withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json(payload);
  }, () => permanentDeleteTrashItems(PROFILE, selected, REQUEST));

  assert.deepEqual(await response({ requestId: REQUEST, removed: { files: [FILE], folders: [] } }), {
    removed: { files: [FILE], folders: [] }, requestId: REQUEST,
  });
  assert.deepEqual(requests[0].body, { action: "permanent-delete", items: [{ type: "file", id: FILE, revision: trashed.metadata_revision }], requestId: REQUEST });
  assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), PROFILE);

  for (const payload of [
    { requestId: OTHER_PROFILE, removed: { files: [FILE], folders: [] } },
    { requestId: REQUEST, removed: { files: [], folders: [] } },
    { requestId: REQUEST, removed: { files: ["not-a-uuid"], folders: [] } },
    { requestId: REQUEST, removed: { files: [FILE, FILE], folders: [] } },
    { requestId: REQUEST, removed: { files: [FILE] } },
  ]) {
    await withFetch(async () => Response.json(payload), () => assert.rejects(
      permanentDeleteTrashItems(PROFILE, selected, REQUEST),
      (error) => error instanceof BrowserOrganizationFailure,
    ));
  }
  await withFetch(captureRequest([]), () => assert.rejects(permanentDeleteTrashItems(PROFILE, selected, "bad-request"), /deletion request ID is invalid/i));
});

test("Empty Trash requires a valid captured request UUID and rejects malformed, duplicate, or mismatched purge acknowledgements", async () => {
  const requests = [];
  const result = await withFetch(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({ requestId: REQUEST, removed: { files: [FILE], folders: [ROOT] } });
  }, () => emptyTrash(PROFILE, REQUEST));
  assert.deepEqual(result, { removed: { files: [FILE], folders: [ROOT] }, requestId: REQUEST });
  assert.deepEqual(requests[0].body, { action: "empty-trash", requestId: REQUEST });
  assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), PROFILE);

  const badAcks = [
    { requestId: OTHER_PROFILE, removed: { files: [], folders: [] } },
    { requestId: REQUEST, removed: { files: "all", folders: [] } },
    { requestId: REQUEST, removed: { files: ["not-a-uuid"], folders: [] } },
    { requestId: REQUEST, removed: { files: [], folders: [ROOT, ROOT] } },
    { requestId: REQUEST, removed: {} },
  ];
  for (const payload of badAcks) {
    await withFetch(async () => Response.json(payload), () => assert.rejects(
      emptyTrash(PROFILE, REQUEST),
      (error) => error instanceof BrowserOrganizationFailure,
    ));
  }
  await withFetch(captureRequest([]), () => assert.rejects(emptyTrash(PROFILE, "bad-request"), /deletion request ID is invalid/i));
});
