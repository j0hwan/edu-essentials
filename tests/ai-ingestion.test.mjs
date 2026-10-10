import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { processClaimedSource, failClaimedSource } = await import(await clientModule("worker/ai-ingestion.ts"));
const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sourceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const leaseId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async function hash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fileRow(backend, body, overrides = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    id: fileId, profile_id: profileId, name: "Notes.txt", mime_type: "text/plain",
    size_bytes: bytes.length, content_sha256: await hash(bytes), content_backend: backend,
    content_revision: 3, metadata_revision: 1, state: "ready", deleted_at: null, trashed_at: null,
    trash_operation_id: null, original_folder_id: null, folder_id: null, course_id: null,
    assignment_id: null, kind: "resource", created_at: "2026-10-08T00:00:00Z",
    updated_at: "2026-10-08T00:00:00Z", bytes, ...overrides,
  };
}

function fakeFileDb(file) {
  const calls = { reads: [], publishes: [], storageReads: 0 };
  return {
    calls,
    from(table) {
      assert.equal(table, "user_files");
      const query = {
        select() { return query; },
        eq() { return query; },
        async single() { return { data: file, error: null }; },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "ai_publish_source");
      calls.publishes.push(args);
      return { data: true, error: null };
    },
  };
}

const jobFor = (file, version = file.content_sha256) => ({
  id: sourceId, profile_id: profileId, file_id: fileId, version, lease_id: leaseId, attempts: 1,
});

test("AI ingestion uses the shared reader for native and uploaded content", async () => {
  for (const backend of ["native-text", "object"]) {
    const file = await fileRow(backend, `Proof from ${backend} content.`);
    const db = fakeFileDb(file);
    const reader = async (readerDb, readerProfile, metadata) => {
      assert.equal(readerDb, db);
      assert.equal(readerProfile, profileId);
      assert.equal(metadata.id, fileId);
      assert.equal(metadata.content_backend, backend);
      assert.equal(metadata.content_revision, 3);
      db.calls.reads.push(metadata.content_backend);
      return file.bytes;
    };
    assert.equal(await processClaimedSource(db, jobFor(file), reader), true);
    assert.deepEqual(db.calls.reads, [backend]);
    assert.equal(db.calls.publishes.length, 1);
    assert.equal(db.calls.publishes[0].p_version, file.content_sha256);
    assert.match(db.calls.publishes[0].p_chunks[0].body, new RegExp(backend));
    assert.equal(db.calls.storageReads, 0, "the worker delegates object and native reads to the shared reader");
  }
});

test("edited, trashed, and stale file jobs stop before reading or publishing", async (t) => {
  const current = await fileRow("native-text", "Current content.");
  const cases = [
    ["edited content hash", current, "f".repeat(64)],
    ["trashed native content", { ...current, trashed_at: "2026-10-08T01:00:00Z" }, current.content_sha256],
    ["not-ready native content", { ...current, state: "deleting" }, current.content_sha256],
  ];
  for (const [name, file, version] of cases) {
    await t.test(name, async () => {
      const db = fakeFileDb(file);
      let readCount = 0;
      await assert.rejects(processClaimedSource(db, jobFor(file, version), async () => {
        readCount++;
        return file.bytes;
      }), /changed or is unavailable/);
      assert.equal(readCount, 0);
      assert.equal(db.calls.publishes.length, 0);
    });
  }
});

test("failure updates are fenced by current profile, version, lease, state, availability, and preference", async () => {
  const staleJob = { id: sourceId, profile_id: profileId, file_id: fileId,
    version: "a".repeat(64), lease_id: leaseId, attempts: 2 };
  const current = {
    profile_id: profileId, id: sourceId, version: "b".repeat(64), lease_id: null,
    state: "queued", enabled: true, file_available: false,
  };
  let applied = false;
  let predicates = [];
  const db = {
    from(table) {
      assert.equal(table, "ai_sources");
      return {
        update(patch) {
          const query = {
            eq(column, value) { predicates.push([column, value]); return query; },
            then(resolve) {
              applied = predicates.every(([column, value]) => current[column] === value);
              if (applied) Object.assign(current, patch);
              resolve({ data: null, error: null });
            },
          };
          return query;
        },
      };
    },
  };
  await failClaimedSource(db, staleJob, new Error("Late read failed"), 0);
  assert.equal(applied, false);
  assert.deepEqual(predicates, [
    ["profile_id", profileId], ["id", sourceId], ["version", staleJob.version],
    ["lease_id", leaseId], ["state", "processing"], ["enabled", true], ["file_available", true],
  ]);
  assert.equal(current.state, "queued");
});
