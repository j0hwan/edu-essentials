import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const [{ DocumentAutosave }, { DocumentSaveFailure }] = await Promise.all([
  import(await clientModule("lib/document-autosave.ts")),
  import(await clientModule("lib/native-documents.ts")),
]);

const fileId = "00000000-0000-4000-8000-000000000001";
const makeFile = (overrides = {}) => ({
  id: fileId,
  name: "Notes.txt",
  mime_type: "text/plain",
  size_bytes: 0,
  course_id: null,
  assignment_id: null,
  kind: "resource",
  state: "ready",
  created_at: "2026-10-08T00:00:00.000Z",
  updated_at: "2026-10-08T00:00:00.000Z",
  content_sha256: null,
  folder_id: null,
  content_backend: "native-text",
  metadata_revision: 1,
  content_revision: 1,
  trashed_at: null,
  trash_operation_id: null,
  original_folder_id: null,
  ...overrides,
});

const resultFor = (file, body, requestId, contentRevision, metadataRevision = file.metadata_revision, name = file.name) => ({
  file: makeFile({ ...file, name, content_revision: contentRevision, metadata_revision: metadataRevision, size_bytes: new TextEncoder().encode(body).byteLength }),
  document: { file_id: file.id, body, content_revision: contentRevision },
  requestId,
  acknowledgedContentRevision: contentRevision,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("rapid typing waits for the 750ms quiet period and writes only the newest name and body", async () => {
  const writes = [];
  const save = new DocumentAutosave(async (draft, file, requestId) => {
    writes.push({ draft, file, requestId });
    return resultFor(file, draft.body, requestId, file.content_revision + 1, draft.name === file.name ? file.metadata_revision : file.metadata_revision + 1, draft.name);
  });
  save.hydrate({ file: makeFile(), document: { file_id: fileId, body: "", content_revision: 1 } });

  save.change({ name: "Typing.txt", body: "first" });
  await tick(420);
  save.change({ name: "Typing.txt", body: "first and second" });
  await tick(420);
  assert.equal(writes.length, 0, "typing inside the debounce window does not start a write");
  save.change({ name: "Final.txt", body: "latest ✓" });
  await tick(650);
  assert.equal(writes.length, 0, "the last edit restarts the full debounce period");
  await tick(250);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].draft, { name: "Final.txt", body: "latest ✓" });
  await save.flush();
  assert.equal(save.getSnapshot().status, "saved");
  assert.equal(save.getSnapshot().dirty, false);
  save.stop();
});

test("one in-flight write keeps its attempt on lost acknowledgement, then flushes the newest queued revision", async () => {
  const lostResponse = deferred();
  const retryStarted = deferred();
  const latestStarted = deferred();
  const writes = [];
  const save = new DocumentAutosave(async (draft, file, requestId) => {
    const entry = { draft, file, requestId };
    writes.push(entry);
    if (writes.length === 1) return lostResponse.promise;
    if (writes.length === 2) {
      retryStarted.resolve();
      return resultFor(file, draft.body, requestId, 2, 2, draft.name);
    }
    latestStarted.resolve();
    return resultFor(file, draft.body, requestId, 3, 3, draft.name);
  }, 60_000);
  save.hydrate({ file: makeFile(), document: { file_id: fileId, body: "base", content_revision: 1 } });
  save.change({ name: "Renamed.txt", body: "first snapshot" });
  const firstFlush = save.flush();
  save.change({ name: "Final.txt", body: "newest queued draft" });
  assert.equal(writes.length, 1, "edits during the request are queued behind the active write");

  lostResponse.reject(new Error("server committed, response was lost"));
  await firstFlush;
  await tick(20);
  assert.equal(writes.length, 1, "a lost acknowledgement does not trigger an automatic retry");
  assert.equal(save.getSnapshot().status, "save-error");
  assert.deepEqual(save.getSnapshot().draft, { name: "Final.txt", body: "newest queued draft" });

  const retry = save.retry();
  await retryStarted.promise;
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], writes[0], "retry reuses the exact snapshot, base file revisions, and idempotency UUID");
  assert.match(writes[0].requestId, /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);

  await latestStarted.promise;
  assert.deepEqual(writes[2].draft, { name: "Final.txt", body: "newest queued draft" });
  assert.equal(writes[2].file.content_revision, 2, "the newest write uses the revision acknowledged by the idempotent retry");
  assert.equal(writes[2].file.metadata_revision, 2);
  await retry;
  assert.equal(save.getSnapshot().draft.body, "newest queued draft");
  assert.equal(save.getSnapshot().status, "saved");
  assert.equal(save.getSnapshot().dirty, false);
  save.stop();
});

test("a conflict preserves later local edits and never retries on its own", async () => {
  let writes = 0;
  const save = new DocumentAutosave(async () => {
    writes += 1;
    throw new DocumentSaveFailure("another tab changed this document", "conflict");
  }, 30);
  save.hydrate({ file: makeFile(), document: { file_id: fileId, body: "saved", content_revision: 1 } });
  save.change({ name: "Notes.txt", body: "local edit" });
  await save.flush();
  save.change({ name: "Notes.txt", body: "newer local edit" });
  await tick(100);

  assert.equal(writes, 1);
  assert.equal(save.getSnapshot().status, "conflict", save.getSnapshot().message);
  assert.equal(save.getSnapshot().dirty, true);
  assert.equal(save.getSnapshot().draft.body, "newer local edit");
  save.stop();
});

test("an independent server rename is adopted and is not written back as a local rename", async () => {
  const writes = [];
  const save = new DocumentAutosave(async (draft, file, requestId) => {
    writes.push({ draft, file, requestId });
    return {
      ...resultFor(file, draft.body, requestId, 2, 2),
      file: makeFile({ ...file, name: "Someone else's name.txt", metadata_revision: 2, content_revision: 2, size_bytes: new TextEncoder().encode(draft.body).byteLength }),
    };
  }, 30);
  save.hydrate({ file: makeFile(), document: { file_id: fileId, body: "old", content_revision: 1 } });
  save.change({ name: "Notes.txt", body: "body-only edit" });
  await save.flush();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].draft.name, "Notes.txt");
  assert.equal(save.getSnapshot().draft.name, "Someone else's name.txt");
  assert.equal(save.getSnapshot().status, "saved");
  await tick(100);
  assert.equal(writes.length, 1, "the external metadata change is not sent back as a rename");
  save.stop();
});

test("late acknowledgements after stop or hydration cannot replace the active document snapshot", async () => {
  const pending = deferred();
  const started = deferred();
  const writes = [];
  const save = new DocumentAutosave(async (draft, file, requestId) => {
    writes.push({ draft, file, requestId });
    started.resolve();
    return pending.promise;
  }, 60_000);
  save.hydrate({ file: makeFile(), document: { file_id: fileId, body: "old", content_revision: 1 } });
  save.change({ name: "Notes.txt", body: "stale draft" });
  const flush = save.flush();
  await started.promise;
  const newerFileId = "00000000-0000-4000-8000-000000000002";
  save.hydrate({
    file: makeFile({ id: newerFileId, name: "New account.txt", content_revision: 8, metadata_revision: 5 }),
    document: { file_id: newerFileId, body: "new account contents", content_revision: 8 },
  });
  await flush;
  const beforeLateAck = save.getSnapshot();
  pending.resolve(resultFor(writes[0].file, writes[0].draft.body, writes[0].requestId, 2));
  await tick();

  assert.deepEqual(save.getSnapshot(), beforeLateAck);
  assert.equal(save.getSnapshot().file.id, newerFileId);
  assert.equal(save.getSnapshot().draft.name, "New account.txt");
  assert.equal(save.getSnapshot().draft.body, "new account contents");
  save.stop();
});
