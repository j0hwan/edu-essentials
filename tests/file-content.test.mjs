import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { clientModule } from "./helpers/client-modules.mjs";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compile(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}

const filesUrl = await clientModule("lib/files.ts");
const { hashBytes } = await import(filesUrl);
const readerUrl = await compile("lib/file-content.ts", { "./files": filesUrl });
const { readFileContent } = await import(readerUrl);
const encoded = (value) => new TextEncoder().encode(value);
const fileRecord = async (id, body, patch = {}) => ({
  id,
  name: "Résumé.txt",
  mime_type: "text/plain",
  size_bytes: encoded(body).byteLength,
  course_id: null,
  assignment_id: null,
  kind: "resource",
  state: "ready",
  created_at: "2026-10-08T00:00:00.000Z",
  updated_at: "2026-10-08T00:00:00.000Z",
  content_sha256: await hashBytes(encoded(body)),
  folder_id: null,
  content_backend: "object",
  metadata_revision: 1,
  content_revision: 1,
  trashed_at: null,
  trash_operation_id: null,
  original_folder_id: null,
  ...patch,
});

test("the shared reader verifies uploaded bytes against recorded size and digest", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const body = "Unicode upload: résumé — ✓";
  const file = await fileRecord(id, body);
  let storageReads = 0;
  const db = {
    storage: { from(bucket) {
      assert.equal(bucket, "eduessentials-private");
      return { async download(path) {
        storageReads++;
        assert.equal(path, `profile-a/${id}`);
        return { data: new Blob([body]), error: null };
      } };
    } },
    async rpc() { assert.fail("Uploaded content is read from private storage, not the document RPC."); },
  };
  assert.deepEqual(await readFileContent(db, "profile-a", file), encoded(body));
  assert.equal(storageReads, 1);
  await assert.rejects(readFileContent(db, "profile-a", { ...file, size_bytes: file.size_bytes + 1 }), /size/);

  const wrongDigest = { ...file, content_sha256: "0".repeat(64) };
  await assert.rejects(readFileContent(db, "profile-a", wrongDigest), /content/);
});

test("native reads use one matching content revision and never touch object storage", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const body = "Native text: 日本語\n";
  const file = await fileRecord(id, body, { content_backend: "native-text", content_revision: 7 });
  const document = { file_id: id, body, content_revision: 7 };
  const calls = [];
  const db = {
    storage: { from() { assert.fail("Native document content must never be read from storage."); } },
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { file, document }, error: null };
    },
  };

  assert.deepEqual(await readFileContent(db, "profile-a", file), encoded(body));
  assert.deepEqual(calls, [["read_account_file_content", {
    p_profile_id: "profile-a",
    p_file_id: id,
    p_expected_content_revision: 7,
    p_allow_trashed: false,
  }]]);

  const snapshot = { ...document, body: "old exported content" };
  const snapshotFile = await fileRecord(id, snapshot.body, { content_backend: "native-text", content_revision: 3 });
  calls.length = 0;
  assert.deepEqual(await readFileContent(db, "profile-a", snapshotFile, { allowTrashed: true, nativeSnapshot: { ...snapshot, content_revision: 3 } }), encoded(snapshot.body));
  assert.equal(calls.length, 0, "an export uses the body captured with the manifest revision");
  await assert.rejects(readFileContent(db, "profile-a", snapshotFile, { nativeSnapshot: { ...snapshot, content_revision: 2 } }), /snapshot/);

  const trashed = { ...file, trashed_at: "2026-10-08T01:00:00.000Z" };
  calls.length = 0;
  await assert.rejects(readFileContent(db, "profile-a", trashed), { code: "P0002" });
  assert.equal(calls.length, 0, "Trash is rejected before content access by default");
  db.rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: { file: trashed, document }, error: null };
  };
  assert.deepEqual(await readFileContent(db, "profile-a", trashed, { allowTrashed: true }), encoded(body));
  assert.equal(calls[0][1].p_allow_trashed, true, "explicit export access carries its Trash permission to SQL");
});
