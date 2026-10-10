import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const USERS = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  c: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const FILE = {
  main: "22222222-2222-4222-8222-222222222222",
  other: "33333333-3333-4333-8333-333333333333",
  second: "3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a",
  large: "44444444-4444-4444-8444-444444444444",
  tooLarge: "55555555-5555-4555-8555-555555555555",
  invalidUnicode: "66666666-6666-4666-8666-666666666666",
  capacity: "77777777-7777-4777-8777-777777777777",
  trash: "88888888-8888-4888-8888-888888888888",
  cascade: "99999999-9999-4999-8999-999999999999",
  profileCascade: "abababab-abab-4bab-8bab-abababababab",
};
const REQUEST = {
  first: "aaaaaaaa-0000-4000-8000-000000000001",
  stale: "aaaaaaaa-0000-4000-8000-000000000002",
  atomicBody: "aaaaaaaa-0000-4000-8000-000000000003",
  atomicMetadata: "aaaaaaaa-0000-4000-8000-000000000004",
  earlierWriter: "aaaaaaaa-0000-4000-8000-000000000005",
  laterWriter: "aaaaaaaa-0000-4000-8000-000000000006",
  trash: "aaaaaaaa-0000-4000-8000-000000000007",
  cascade: "aaaaaaaa-0000-4000-8000-000000000008",
  profileCascade: "aaaaaaaa-0000-4000-8000-000000000009",
  independentBody: "aaaaaaaa-0000-4000-8000-000000000010",
  trashRetry: "aaaaaaaa-0000-4000-8000-000000000011",
};

const course = (id = "history") => ({
  id, code: "HIST 205", name: "History", credits: 3, instructor: "", room: "",
  color: "#224466", soft_color: "#22446618", initials: "HI",
});
const dashboard = {
  v: 2, a: "day", w: [], t: [], n: "",
  d: { assignments: [], manualEvents: [], courseDetails: {}, syllabusDrafts: [] },
};
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const migrationFiles = [
  "20260903000000_workspace_persistence.sql",
  "20260904000000_google_accounts.sql",
  "20260905000000_persistence_foundation.sql",
  "20260907000000_private_files.sql",
  "20260918000000_academic_ai.sql",
  "20260918010000_ai_vectors.sql",
  "20260918020000_ai_export_backfill.sql",
  "20261008000000_onboarding_details.sql",
  "20261008010000_file_organization.sql",
  "20261008020000_file_content_api.sql",
  "20261008030000_file_content_ai.sql",
  "20261008040000_managed_course_folders.sql",
  "20261008050000_syllabus_replacement.sql",
  "20261008060000_document_save_requests.sql",
  "20261008070000_folder_moves.sql",
  "20261008080000_recursive_trash.sql",
  "20261008090000_archive_integrity.sql",
  "20261009100000_selected_file_download.sql",
  "20261009110000_file_release_integrity.sql", "20261009120000_ai_file_result_fence.sql",
];

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compile(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
}

async function setup() {
  const pg = new PGlite({ extensions: { vector } });
  const sql = (statement, params = []) => pg.query(statement, params, {
    parsers: { 1184: (value) => value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") },
  });
  await pg.exec(`
    set timezone = 'UTC';
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, body bytea);
    alter table storage.objects enable row level security;
    grant usage on schema public, storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
  `);
  for (const file of migrationFiles.slice(0, 2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  const profiles = {};
  for (const authId of Object.values(USERS)) {
    await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [authId]);
    profiles[authId] = (await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [authId])).rows[0];
  }
  for (const authId of Object.values(USERS)) {
    await sql("select initialize_account_workspace($1,$2,$3)", [profiles[authId].id, JSON.stringify([course()]), JSON.stringify(dashboard)]);
  }
  for (const file of migrationFiles.slice(2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const runtime = { profile: profiles[USERS.a] };
  const admin = {
    async rpc(name, args) {
      const signatures = {
        mutate_account_document: ["p_profile_id", "p_auth_user_id", "p_file_id", "p_operation", "p_expected_content_revision", "p_document"],
        mutate_account_document_request: ["p_profile_id", "p_auth_user_id", "p_file_id", "p_request_id", "p_expected_content_revision", "p_document", "p_name", "p_expected_metadata_revision"],
        read_account_file_content: ["p_profile_id", "p_file_id", "p_expected_content_revision", "p_allow_trashed"],
        mutate_account_file: ["p_profile_id", "p_auth_user_id", "p_file_id", "p_operation", "p_expected_revision", "p_metadata"],
      };
      const keys = signatures[name];
      if (!keys) return { data: null, error: { code: "42883", message: `Unexpected RPC ${name}` } };
      const values = keys.map((key) => args[key]);
      for (const key of ["p_document", "p_metadata"]) {
        const index = keys.indexOf(key);
        if (index >= 0 && values[index] != null && typeof values[index] !== "string") values[index] = JSON.stringify(values[index]);
      }
      try {
        const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
        const result = await sql(`select public.${name}(${placeholders}) as data`, values);
        return { data: result.rows[0]?.data ?? null, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
    from(table) {
      let columns = "*";
      const filters = [];
      const builder = {
        select(value) { columns = value || "*"; return builder; },
        eq(column, value) { filters.push({ column, value, op: "=" }); return builder; },
        is(column, value) { filters.push({ column, value, op: value === null ? "is null" : "=" }); return builder; },
        async maybeSingle() {
          try {
            if (!new Set(["user_files", "file_folders"]).has(table)) throw new Error(`Unexpected table ${table}`);
            const values = [];
            const where = filters.map(({ column, value, op }) => {
              if (op === "is null") return `${column} is null`;
              values.push(value);
              return `${column} = $${values.length}`;
            }).join(" and ");
            const result = await sql(`select ${columns} from public.${table}${where ? ` where ${where}` : ""} limit 1`, values);
            return { data: result.rows[0] ?? null, error: null };
          } catch (error) { return { data: null, error }; }
        },
      };
      return builder;
    },
    storage: { from() { throw new Error("Document routes must not use object storage."); } },
  };
  globalThis.__nativeDocumentTestAdmin = admin;
  globalThis.__nativeDocumentTestProfile = runtime.profile;

  const auth = moduleUrl(`
    export class AuthError extends Error { constructor(message, status) { super(message); this.status = status; } }
    export const requireProfile = async () => {
      const profile = globalThis.__nativeDocumentTestProfile;
      if (!profile) throw new AuthError("Please sign in with Google.", 401);
      return profile;
    };
    export function requireSameOrigin(request) {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new AuthError("This request must come from your workspace.", 403);
    }
    export function apiError(error) {
      return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "no-store" } });
    }
  `);
  const db = moduleUrl("export const getSupabaseAdmin = () => globalThis.__nativeDocumentTestAdmin;");
  const files = await compile("lib/files.ts");
  const organization = await compile("lib/file-organization.ts");
  const persistence = await compile("lib/persistence-request.ts");
  const helper = await compile("lib/private-files-server.ts", {
    "./auth": auth, "./supabase-server": db, "./persistence-request": persistence, "./files": files,
  });
  const content = await compile("lib/file-content.ts", { "./files": files });
  const imports = {
    "../../../lib/private-files-server": helper,
    "../../../lib/files": files,
    "../../../lib/file-content": content,
    "../../../lib/file-organization": organization,
    "../../../lib/persistence-request": persistence,
    "../../../lib/supabase-server": db,
  };
  const documents = await import(await compile("app/api/file-documents/route.ts", imports));
  const filesApi = await import(await compile("app/api/files/route.ts", imports));
  const request = (path, method = "GET", body, account = runtime.profile.id, origin = "https://edu.example") => new Request(`https://edu.example${path}`, {
    method,
    headers: { origin, "x-profile-id": account, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const doc = (id, method = "GET", body, account = runtime.profile.id, origin = "https://edu.example") =>
    request(`/api/file-documents?id=${id}`, method, body, account, origin);
  const create = async (id, name = "Untitled.txt", body = "", extra = {}) => documents.POST(doc(id, "POST", { name, body, ...extra }));
  const put = async (id, body, baseContentRevision, extras = {}) => documents.PUT(doc(id, "PUT", {
    action: "update_content", body, baseContentRevision, ...extras,
  }));
  return { pg, sql, profiles, runtime, documents, filesApi, request, doc, create, put };
}

test("native document request receipts preserve the body, metadata, ownership, and retry contract", async (t) => {
  const fixture = await setup();
  const { pg, sql, profiles, runtime, documents, filesApi, request, doc, create, put } = fixture;
  t.after(() => pg.close());
  const accountA = profiles[USERS.a], accountB = profiles[USERS.b], accountC = profiles[USERS.c];
  const courseFolderA = (await sql("select id from file_folders where profile_id=$1 and kind='course' and course_id='history'", [accountA.id])).rows[0].id;

  await t.test("empty creation is durable and same-ID retries remain idempotent at the file cap", async () => {
    runtime.profile = accountB;
    globalThis.__nativeDocumentTestProfile = accountB;
    const first = await create(FILE.capacity, "Untitled.txt", "");
    assert.equal(first.status, 201, await first.clone().text());
    const created = await first.json();
    assert.equal(created.document.body, "");
    assert.equal(created.file.content_revision, 1);
    assert.equal(created.file.metadata_revision, 1);
    assert.equal(created.file.size_bytes, 0);
    assert.equal(created.file.content_sha256, digest(""));
    const readBack = await documents.GET(doc(FILE.capacity));
    assert.equal(readBack.status, 200);
    assert.equal((await readBack.json()).document.body, "");

    await sql(`
      with params as (select $1::uuid as profile_id),
      generated as (select gen_random_uuid() as id, i from generate_series(1, 999) i)
      insert into public.user_files(profile_id,id,kind,name,mime_type,size_bytes,object_path,content_sha256,content_backend,state)
        select params.profile_id, generated.id, 'resource', 'capacity-' || generated.i || '.txt', 'text/plain', 0,
          params.profile_id::text || '/' || generated.id::text, repeat('0',64), 'object', 'pending'
          from generated cross join params
    `, [accountB.id]);
    assert.equal(Number((await sql("select count(*)::int as count from user_files where profile_id=$1 and deleted_at is null", [accountB.id])).rows[0].count), 1000);

    const retry = await create(FILE.capacity, "Untitled.txt", "");
    assert.equal(retry.status, 201, await retry.clone().text());
    const retried = await retry.json();
    assert.equal(retried.document.content_revision, 1);
    assert.equal(retried.file.content_revision, 1, "a lost create response does not create another body revision");
    assert.equal(retried.document.body, "");
    const overCapacity = await create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "One too many.txt", "");
    assert.equal(overCapacity.status, 400, await overCapacity.clone().text());
    assert.equal(Number((await sql("select count(*)::int as count from user_files where profile_id=$1 and deleted_at is null", [accountB.id])).rows[0].count), 1000);
  });

  await t.test("UTF-8 size and Unicode validation apply to creation and save requests", async () => {
    runtime.profile = accountA;
    globalThis.__nativeDocumentTestProfile = accountA;
    const unicode = "Résumé — 東京 — 😀\n";
    const created = await create(FILE.other, "Notes.txt", unicode, { courseId: "history", folderId: courseFolderA });
    assert.equal(created.status, 201, await created.clone().text());
    const unicodeFile = (await created.json()).file;
    assert.equal(unicodeFile.size_bytes, Buffer.byteLength(unicode, "utf8"));
    assert.equal(unicodeFile.content_sha256, digest(unicode));
    assert.equal(unicodeFile.course_id, "history");
    assert.equal(unicodeFile.folder_id, courseFolderA);

    const exactBody = "é".repeat(524288);
    const exact = await create(FILE.large, "Exact 1 MiB.txt", exactBody);
    assert.equal(exact.status, 201, await exact.clone().text());
    assert.equal((await exact.json()).file.size_bytes, 1_048_576);
    const tooLarge = await create(FILE.tooLarge, "Too large.txt", "é".repeat(524289));
    assert.equal(tooLarge.status, 413, await tooLarge.clone().text());
    const invalidUnicode = await create(FILE.invalidUnicode, "Invalid Unicode.txt", "broken \ud800 text");
    assert.equal(invalidUnicode.status, 400, await invalidUnicode.clone().text());
    assert.equal((await sql("select count(*)::int as count from user_files where profile_id=$1 and id=any($2::uuid[])", [accountA.id, [FILE.tooLarge, FILE.invalidUnicode]])).rows[0].count, 0);

    const invalidSave = await put(FILE.other, "invalid \udfff", 1, { requestId: REQUEST.first });
    assert.equal(invalidSave.status, 400, await invalidSave.clone().text());
    assert.equal((await sql("select body from native_file_documents where profile_id=$1 and file_id=$2", [accountA.id, FILE.other])).rows[0].body, unicode);
  });

  await t.test("receipt replay is compact, rejects UUID reuse, and never reapplies a later revision", async () => {
    runtime.profile = accountA;
    globalThis.__nativeDocumentTestProfile = accountA;
    const initialBody = "Initial body\n";
    const created = await create(FILE.main, "Draft.txt", initialBody, { courseId: "history", folderId: courseFolderA });
    assert.equal(created.status, 201, await created.clone().text());
    const initial = (await created.json()).file;
    assert.equal(initial.content_revision, 1);

    const firstSave = await put(FILE.main, "First saved body — résumé ✓", 1, { requestId: REQUEST.first });
    assert.equal(firstSave.status, 200, await firstSave.clone().text());
    const saved = await firstSave.json();
    assert.equal(saved.document.content_revision, 2);
    assert.equal(saved.acknowledgedContentRevision, 2);
    assert.equal(saved.requestId, REQUEST.first);
    assert.equal(saved.file.metadata_revision, 1);

    const replay = await put(FILE.main, "First saved body — résumé ✓", 1, { requestId: REQUEST.first });
    assert.equal(replay.status, 200, await replay.clone().text());
    const replayed = await replay.json();
    assert.equal(replayed.document.body, "First saved body — résumé ✓");
    assert.equal(replayed.document.content_revision, 2);
    assert.equal(replayed.acknowledgedContentRevision, 2);
    assert.equal(replayed.file.updated_at, saved.file.updated_at);
    assert.equal((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1 and file_id=$2", [accountA.id, FILE.main])).rows[0].count, 1);

    const stale = await put(FILE.main, "Stale tab body", 1, { requestId: REQUEST.stale });
    assert.equal(stale.status, 409, await stale.clone().text());
    assert.equal((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1 and file_id=$2", [accountA.id, FILE.main])).rows[0].count, 1,
      "a distinct stale request does not leave a receipt");
    assert.equal((await sql("select body from native_file_documents where profile_id=$1 and file_id=$2", [accountA.id, FILE.main])).rows[0].body, "First saved body — résumé ✓");

    const reusedBody = await put(FILE.main, "Changed payload", 1, { requestId: REQUEST.first });
    assert.equal(reusedBody.status, 409);
    const reusedBase = await put(FILE.main, "First saved body — résumé ✓", 2, { requestId: REQUEST.first });
    assert.equal(reusedBase.status, 409);
    const reusedName = await put(FILE.main, "First saved body — résumé ✓", 1, {
      requestId: REQUEST.first, name: "Different name.txt", baseMetadataRevision: 1,
    });
    assert.equal(reusedName.status, 409);
    const secondDocument = await create(FILE.second, "Second doc.txt", "Second initial", { courseId: "history", folderId: courseFolderA });
    assert.equal(secondDocument.status, 201);
    const reusedFileId = await put(FILE.second, "First saved body — résumé ✓", 1, { requestId: REQUEST.first });
    assert.equal(reusedFileId.status, 409, "a request UUID cannot be moved to another document");
    assert.equal((await sql("select body from native_file_documents where profile_id=$1 and file_id=$2", [accountA.id, FILE.second])).rows[0].body, "Second initial");

    const renamedAndSaved = await put(FILE.main, "Second saved body", 2, {
      requestId: REQUEST.atomicBody, name: "Editor renamed.txt", baseMetadataRevision: 1,
    });
    assert.equal(renamedAndSaved.status, 200, await renamedAndSaved.clone().text());
    const afterAtomicRename = await renamedAndSaved.json();
    assert.equal(afterAtomicRename.file.name, "Editor renamed.txt");
    assert.equal(afterAtomicRename.file.content_revision, 3);
    assert.equal(afterAtomicRename.file.metadata_revision, 2);
    assert.equal(afterAtomicRename.file.course_id, "history");
    assert.equal(afterAtomicRename.file.folder_id, courseFolderA);

    const legacyRename = await filesApi.PUT(request(`/api/files?id=${FILE.main}`, "PUT", {
      name: "Legacy renamed.txt", courseId: "history", assignmentId: "", kind: "resource",
      folderId: courseFolderA, baseRevision: afterAtomicRename.file.updated_at,
    }));
    assert.equal(legacyRename.status, 200, await legacyRename.clone().text());
    const legacyRenamedFile = (await legacyRename.json()).file;
    assert.equal(legacyRenamedFile.content_revision, 3);
    assert.equal(legacyRenamedFile.metadata_revision, 3);
    assert.equal(legacyRenamedFile.folder_id, courseFolderA);

    const afterLegacyRename = await put(FILE.main, "Third saved body", 3, { requestId: REQUEST.independentBody });
    assert.equal(afterLegacyRename.status, 200, await afterLegacyRename.clone().text());
    const afterLegacyRenameData = await afterLegacyRename.json();
    assert.equal(afterLegacyRenameData.file.name, "Legacy renamed.txt");
    assert.equal(afterLegacyRenameData.file.content_revision, 4);
    assert.equal(afterLegacyRenameData.file.metadata_revision, 3,
      "a body save does not advance or stale the independent metadata revision");

    const staleBodyRename = await put(FILE.main, "Must roll back", 3, {
      requestId: REQUEST.atomicMetadata, name: "Must not rename.txt", baseMetadataRevision: 3,
    });
    assert.equal(staleBodyRename.status, 409);
    const staleMetadataRename = await put(FILE.main, "Must also roll back", 4, {
      requestId: REQUEST.trash, name: "Stale metadata name.txt", baseMetadataRevision: 2,
    });
    assert.equal(staleMetadataRename.status, 409);
    const afterStaleRenames = (await sql(`
      select f.name,f.content_revision,f.metadata_revision,d.body
        from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id
       where f.profile_id=$1 and f.id=$2
    `, [accountA.id, FILE.main])).rows[0];
    assert.deepEqual(afterStaleRenames, {
      name: "Legacy renamed.txt", content_revision: 4, metadata_revision: 3, body: "Third saved body",
    });
    assert.equal(Number((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1 and request_id=any($2::uuid[])", [accountA.id, [REQUEST.atomicMetadata, REQUEST.trash]])).rows[0].count), 0,
      "a failed content or metadata check rolls back both the other write and receipt insertion");

    const earlier = await put(FILE.main, "Older request body", 4, {
      requestId: REQUEST.earlierWriter, name: "Older request name.txt", baseMetadataRevision: 3,
    });
    assert.equal(earlier.status, 200);
    const earlierAck = (await earlier.json()).acknowledgedContentRevision;
    assert.equal(earlierAck, 5);
    const later = await put(FILE.main, "Newer writer body", 5, {
      requestId: REQUEST.laterWriter, name: "Newer writer name.txt", baseMetadataRevision: 4,
    });
    assert.equal(later.status, 200);
    assert.equal((await later.json()).file.metadata_revision, 5);
    const replayEarlier = await put(FILE.main, "Older request body", 4, {
      requestId: REQUEST.earlierWriter, name: "Older request name.txt", baseMetadataRevision: 3,
    });
    assert.equal(replayEarlier.status, 200, await replayEarlier.clone().text());
    const replayEarlierData = await replayEarlier.json();
    assert.equal(replayEarlierData.document.body, "Newer writer body");
    assert.equal(replayEarlierData.file.name, "Newer writer name.txt");
    assert.equal(replayEarlierData.file.content_revision, 6);
    assert.equal(replayEarlierData.file.metadata_revision, 5);
    assert.equal(replayEarlierData.acknowledgedContentRevision, 5,
      "replay returns the original acknowledgement alongside the current snapshot");

    const legacyContentSave = await documents.PUT(doc(FILE.main, "PUT", {
      action: "update_content", body: "Legacy compatible body", baseContentRevision: 6,
    }));
    assert.equal(legacyContentSave.status, 200, await legacyContentSave.clone().text());
    const legacyContentData = await legacyContentSave.json();
    assert.equal(legacyContentData.file.content_revision, 7);
    assert.equal(Object.hasOwn(legacyContentData, "requestId"), false,
      "the existing PUT shape still works without a request ID");
  });

  await t.test("receipt replay cannot restore Trash, and file/profile cascades remove receipts", async () => {
    runtime.profile = accountA;
    globalThis.__nativeDocumentTestProfile = accountA;
    const created = await create(FILE.trash, "Trash me.txt", "Before Trash");
    assert.equal(created.status, 201);
    const firstSave = await put(FILE.trash, "Saved before Trash", 1, { requestId: REQUEST.trash });
    assert.equal(firstSave.status, 200);
    const savedFile = (await firstSave.json()).file;
    await sql("select mutate_account_files_action($1,$2,'trash',$3::jsonb,null,false)", [
      accountA.id, USERS.a, JSON.stringify([{ type: "file", id: FILE.trash, revision: savedFile.metadata_revision }]),
    ]);
    const replay = await put(FILE.trash, "Saved before Trash", 1, { requestId: REQUEST.trash });
    assert.equal(replay.status, 400, await replay.clone().text());
    const newWrite = await put(FILE.trash, "Attempt resurrection", 2, { requestId: REQUEST.trashRetry });
    assert.equal(newWrite.status, 400);
    const recreate = await create(FILE.trash, "Trash me.txt", "Saved before Trash");
    assert.equal(recreate.status, 409);
    const trashed = (await sql("select trashed_at,content_revision,metadata_revision from user_files where profile_id=$1 and id=$2", [accountA.id, FILE.trash])).rows[0];
    assert.ok(trashed.trashed_at);
    assert.equal(trashed.content_revision, 2);
    assert.equal(trashed.metadata_revision, 2);
    assert.equal((await sql("select body from native_file_documents where profile_id=$1 and file_id=$2", [accountA.id, FILE.trash])).rows[0].body, "Saved before Trash");
    assert.equal(Number((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1 and file_id=$2", [accountA.id, FILE.trash])).rows[0].count), 1,
      "denied replays do not erase the successful receipt");

    const cascadeCreate = await create(FILE.cascade, "Cascade file.txt", "Before delete");
    assert.equal(cascadeCreate.status, 201);
    assert.equal((await put(FILE.cascade, "Saved receipt", 1, { requestId: REQUEST.cascade })).status, 200);
    assert.equal(Number((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1 and file_id=$2", [accountA.id, FILE.cascade])).rows[0].count), 1);
    await sql("delete from user_files where profile_id=$1 and id=$2", [accountA.id, FILE.cascade]);
    assert.equal(Number((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1 and file_id=$2", [accountA.id, FILE.cascade])).rows[0].count), 0,
      "deleting a file cascades its save receipts");

    runtime.profile = accountC;
    globalThis.__nativeDocumentTestProfile = accountC;
    assert.equal((await create(FILE.profileCascade, "Profile cascade.txt", "Before account delete")).status, 201);
    assert.equal((await put(FILE.profileCascade, "Receipt owned by C", 1, { requestId: REQUEST.profileCascade })).status, 200);
    assert.equal(Number((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1", [accountC.id])).rows[0].count), 1);
    await sql("delete from app_profiles where id=$1", [accountC.id]);
    assert.equal(Number((await sql("select count(*)::int as count from document_save_receipts where profile_id=$1", [accountC.id])).rows[0].count), 0,
      "deleting a profile cascades its save receipts");
  });

  await t.test("receipt table and RPC are service-only, account scoped, RLS enabled, and profile-locked first", async () => {
    const functionName = "public.mutate_account_document_request(uuid, uuid, uuid, uuid, bigint, jsonb, text, bigint)";
    const permissions = (await sql(`
      select has_function_privilege('anon',$1,'execute') as anon_exec,
             has_function_privilege('authenticated',$1,'execute') as authenticated_exec,
             has_function_privilege('service_role',$1,'execute') as service_exec,
             has_table_privilege('anon','public.document_save_receipts','select') as anon_read,
             has_table_privilege('authenticated','public.document_save_receipts','select') as authenticated_read,
             has_table_privilege('service_role','public.document_save_receipts','select') as service_read,
             (select relrowsecurity from pg_class where oid='public.document_save_receipts'::regclass) as rls
    `, [functionName])).rows[0];
    assert.equal(permissions.anon_exec, false);
    assert.equal(permissions.authenticated_exec, false);
    assert.equal(permissions.service_exec, true);
    assert.equal(permissions.anon_read, false);
    assert.equal(permissions.authenticated_read, false);
    assert.equal(permissions.service_read, false);
    assert.equal(permissions.rls, true);

    const constraints = (await sql(`
      select conname, confdeltype from pg_constraint
       where conrelid='public.document_save_receipts'::regclass and contype='f'
    `)).rows;
    assert.equal(constraints.length, 2);
    assert.ok(constraints.every((constraint) => constraint.confdeltype === "c"), "both profile and file receipt references cascade");

    const functionDefinition = (await sql("select pg_get_functiondef($1::regprocedure) as definition", [functionName])).rows[0].definition.toLowerCase();
    const profileLock = functionDefinition.indexOf("perform 1 from public.app_profiles");
    const receiptRead = functionDefinition.indexOf("select * into v_receipt from public.document_save_receipts");
    const fileLock = functionDefinition.indexOf("select * into v_file from public.user_files");
    assert.ok(profileLock >= 0 && profileLock < receiptRead && profileLock < fileLock,
      "the account row lock is acquired before receipt or file access");

    runtime.profile = accountA;
    globalThis.__nativeDocumentTestProfile = accountA;
    const changedHeader = await documents.GET(doc(FILE.main, "GET", undefined, accountB.id));
    assert.equal(changedHeader.status, 401, "a profile header that changed during the request is rejected");
    runtime.profile = accountB;
    globalThis.__nativeDocumentTestProfile = accountB;
    const foreignFile = await documents.GET(doc(FILE.main));
    assert.equal(foreignFile.status, 404, "the other signed-in account cannot read the document");
    runtime.profile = accountA;
    globalThis.__nativeDocumentTestProfile = accountA;
    const spoofedOwner = await put(FILE.main, "No owner spoof", 7, {
      requestId: "aaaaaaaa-0000-4000-8000-000000000010", profile_id: accountB.id,
    });
    assert.equal(spoofedOwner.status, 400);

    const mismatch = adminDirectRpc(sql, accountA.id, USERS.b, FILE.main, "bbbbbbbb-0000-4000-8000-000000000001");
    await assert.rejects(mismatch, { code: "42501" }, "the SECURITY DEFINER RPC still validates the account's auth user");
    await sql("set role anon");
    try {
      await assert.rejects(sql(`select public.mutate_account_document_request(
        $1,$2,$3,$4,1,'{"body":"forbidden"}'::jsonb,null,null
      )`, [accountA.id, USERS.a, FILE.main, "bbbbbbbb-0000-4000-8000-000000000002"]), { code: "42501" });
    } finally { await sql("reset role"); }
  });
});

async function adminDirectRpc(sql, profileId, authUserId, fileId, requestId) {
  return sql("select public.mutate_account_document_request($1,$2,$3,$4,1,$5::jsonb,null,null)", [
    profileId, authUserId, fileId, requestId, JSON.stringify({ body: "cross-account" }),
  ]);
}
