import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFileReleaseMetadata, requiredFileTables, requiredFileRpcs } from "../scripts/verify-files-release.mjs";

function installedMetadata() {
  return {
    schema: { status: 200, body: {
      definitions: Object.fromEntries(Object.entries(requiredFileTables).map(([table, columns]) =>
        [table, { properties: Object.fromEntries(columns.map((column) => [column, {}])) }])),
      paths: Object.fromEntries(requiredFileRpcs.map((name) => [`/rpc/${name}`, {}])),
    } },
    anonymousSchema: { status: 200, body: { paths: {} } },
    anonymousAccess: Object.fromEntries(Object.keys(requiredFileTables).map((table) => [table, { status: 401 }])),
    bucket: { status: 200, body: { public: false, file_size_limit: 26_214_400 } },
  };
}

test("metadata preflight cannot mark the release ready even when structural prerequisites pass", () => {
  const report = evaluateFileReleaseMetadata(installedMetadata());
  assert.equal(report.structuralPrerequisitesPassed, true);
  assert.equal(report.releaseReady, false);
  assert.equal(report.status, "metadata-passed");
  assert.ok(report.outstandingGates.some((gate) => gate.includes("authenticated")));
});

test("preflight blocks old schema, exposed RPCs, readable tables and a public or resized bucket", () => {
  const cases = [
    (data) => { delete data.schema.body.paths["/rpc/read_account_file_browser"]; },
    (data) => { delete data.schema.body.definitions.file_folders.properties.purge_pending_at; },
    (data) => { data.anonymousSchema.body.paths["/rpc/mutate_account_folder"] = {}; },
    (data) => { data.anonymousAccess.native_file_documents.status = 200; },
    (data) => { data.bucket.body.public = true; },
    (data) => { data.bucket.body.file_size_limit = null; },
    (data) => { data.anonymousSchema.status = 500; },
  ];
  for (const change of cases) {
    const data = installedMetadata(); change(data);
    assert.equal(evaluateFileReleaseMetadata(data).structuralPrerequisitesPassed, false);
  }
});

test("denied anonymous schema discovery does not encourage weakening access and still requires SQL privilege verification", () => {
  const data = installedMetadata(); data.anonymousSchema.status = 401;
  const report = evaluateFileReleaseMetadata(data);
  assert.equal(report.structuralPrerequisitesPassed, true);
  assert.equal(report.anonymousRpcVisibilityVerified, false);
  assert.equal(report.releaseReady, false);
  assert.ok(report.outstandingGates[0].includes("SQL grants"));
});

test("AI installations require owned source and completion RPCs while optional AI remains optional", () => {
  const data = installedMetadata();
  assert.equal(evaluateFileReleaseMetadata(data).aiInstalled, false);
  data.schema.body.paths["/rpc/ai_begin_message"] = {};
  assert.equal(evaluateFileReleaseMetadata(data).structuralPrerequisitesPassed, false);
  data.schema.body.paths["/rpc/ai_finish_message"] = {};
  data.schema.body.paths["/rpc/mutate_account_ai_source"] = {};
  assert.equal(evaluateFileReleaseMetadata(data).structuralPrerequisitesPassed, true);
  data.anonymousSchema.body.paths["/rpc/ai_finish_message"] = {};
  assert.equal(evaluateFileReleaseMetadata(data).structuralPrerequisitesPassed, false);
});

test("preflight reports fixed metadata fields without exposing returned bodies or credentials", () => {
  const data = installedMetadata();
  data.schema.body.error = "secret-service-key";
  data.bucket.body.extra = "private-record";
  data.anonymousAccess.user_files.body = [{ name: "private-user-record" }];
  const report = JSON.stringify(evaluateFileReleaseMetadata(data));
  assert.doesNotMatch(report, /secret-service-key|private-record|private-user-record/);
});
