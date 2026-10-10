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
};
const ID = {
  root: "10101010-1010-4010-8010-101010101010",
  duplicate: "11111111-1111-4111-8111-111111111111",
  child: "12121212-1212-4121-8121-121212121212",
  deep: "13131313-1313-4131-8131-131313131313",
  destination: "14141414-1414-4141-8141-141414141414",
  otherSource: "15151515-1515-4151-8151-151515151515",
  normalizedChild: "16161616-1616-4161-8161-161616161616",
  normalizedFile: "17171717-1717-4171-8171-171717171717",
  staleRoot: "18181818-1818-4181-8181-181818181818",
  staleChild: "19191919-1919-4191-8191-191919191919",
  staleFile: "20202020-2020-4020-8020-202020202020",
  cycleRoot: "21212121-2121-4121-8121-212121212121",
  cycleChild: "22222222-2222-4222-8222-222222222222",
  cycleDeep: "23232323-2323-4323-8323-232323232323",
  cycleDestination: "24242424-2424-4424-8424-242424242424",
  edgeFile: "25252525-2525-4525-8525-252525252525",
  trashedDestination: "26262626-2626-4626-8626-262626262626",
  raceMoveFirst: "27272727-2727-4727-8727-272727272727",
  raceTrashFirst: "28282828-2828-4828-8828-282828282828",
  foreignFolder: "29292929-2929-4929-8929-292929292929",
  native: "30303030-3030-4030-8030-303030303030",
  upload: "31313131-3131-4131-8131-313131313131",
};

const course = (id, code, name, initials) => ({
  id, code, name, credits: 3, instructor: "", room: "", color: "#224466",
  soft_color: "#22446618", initials,
});
const courses = [course("history", "HIST 205", "History", "HI"), course("biology", "BIO 110", "Biology", "BI")];
const assignments = [
  { id: "history-reading", courseId: "history", title: "Read chapter", dateKey: "2026-10-08", due: "", type: "Assignment", status: "later", progress: 0 },
  { id: "biology-lab", courseId: "biology", title: "Lab notes", dateKey: "2026-10-08", due: "", type: "Assignment", status: "later", progress: 0 },
];
const dashboard = {
  v: 2, a: "day", w: [], t: [], n: "",
  d: { assignments, manualEvents: [], courseDetails: {}, syllabusDrafts: [] },
};
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
    await sql("select initialize_account_workspace($1,$2,$3)", [profiles[authId].id, JSON.stringify(courses), JSON.stringify(dashboard)]);
  }
  for (const file of migrationFiles.slice(2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const runtime = { profile: profiles[USERS.a], profiles, objects: new Map() };
  const ident = (value) => {
    if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error(`Unexpected identifier ${value}`);
    return `"${value}"`;
  };
  const admin = {
    async rpc(name, args) {
      const calls = {
        mutate_account_file: () => sql("select public.mutate_account_file($1,$2,$3,$4,$5,$6) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_operation,
          args.p_expected_revision ?? null, JSON.stringify(args.p_metadata ?? {}),
        ]),
        mutate_account_folder: () => sql("select public.mutate_account_folder($1,$2,$3,$4,$5,$6) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_operation, args.p_folder_id ?? null,
          args.p_expected_revision ?? null, JSON.stringify(args.p_metadata ?? {}),
        ]),
        mutate_account_file_location: () => sql("select public.mutate_account_file_location($1,$2,$3,$4,$5,$6) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_operation,
          args.p_expected_revision ?? null, JSON.stringify(args.p_metadata ?? {}),
        ]),
        mutate_account_document: () => sql("select public.mutate_account_document($1,$2,$3,$4,$5,$6) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_operation,
          args.p_expected_content_revision ?? null, JSON.stringify(args.p_document ?? {}),
        ]),
        mutate_account_files_action: () => sql("select public.mutate_account_files_action($1,$2,$3,$4::jsonb,$5,$6) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_action, JSON.stringify(args.p_items),
          args.p_destination_id ?? null, args.p_destination_provided ?? false,
        ]),
        read_account_file_content: () => sql("select public.read_account_file_content($1,$2,$3,$4) as data", [
          args.p_profile_id, args.p_file_id, args.p_expected_content_revision ?? null, args.p_allow_trashed ?? false,
        ]),
        rename_account_file: () => sql("select public.rename_account_file($1,$2,$3,$4,$5) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_expected_metadata_revision, args.p_name,
        ]),
      }[name];
      if (!calls) return { data: null, error: { code: "42883", message: `Unexpected RPC ${name}` } };
      try {
        const result = await calls();
        return { data: result.rows[0]?.data ?? null, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
    from(table) {
      if (!new Set(["user_files", "file_folders"]).has(table)) throw new Error(`Unexpected table ${table}`);
      let columns = "*";
      const filters = [];
      const builder = {
        select(value) { columns = value || "*"; return builder; },
        eq(column, value) { filters.push({ column, value, op: "=" }); return builder; },
        is(column, value) { filters.push({ column, value, op: value === null ? "is null" : "=" }); return builder; },
        async maybeSingle() {
          const values = [];
          const where = filters.map(({ column, value, op }) => {
            if (op === "is null") return `${ident(column)} is null`;
            values.push(value);
            return `${ident(column)} = $${values.length}`;
          }).join(" and ");
          try {
            const selected = columns === "*" ? "*" : columns.split(",").map(ident).join(",");
            const result = await sql(`select ${selected} from public.${ident(table)}${where ? ` where ${where}` : ""} limit 1`, values);
            return { data: result.rows[0] ?? null, error: null };
          } catch (error) { return { data: null, error }; }
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "eduessentials-private");
        return {
          async upload(path, bytes) {
            if (runtime.objects.has(path)) return { error: new Error("duplicate object") };
            runtime.objects.set(path, new Uint8Array(bytes));
            return { error: null };
          },
          async download(path) {
            const bytes = runtime.objects.get(path);
            return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: new Error("missing object") };
          },
          async remove(paths) { paths.forEach((path) => runtime.objects.delete(path)); return { error: null }; },
        };
      },
    },
  };
  globalThis.__folderMovesTestAdmin = admin;
  globalThis.__folderMovesTestRuntime = runtime;
  const auth = moduleUrl(`
    export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
    export const requireProfile = async () => globalThis.__folderMovesTestRuntime.profile;
    export function requireSameOrigin(request) {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new AuthError("Wrong origin.", 403);
    }
    export function apiError(error) {
      return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "no-store" } });
    }
  `);
  const db = moduleUrl("export const getSupabaseAdmin = () => globalThis.__folderMovesTestAdmin;");
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
  const folders = await import(await compile("app/api/file-folders/route.ts", imports));
  const filesApi = await import(await compile("app/api/files/route.ts", imports));
  const documents = await import(await compile("app/api/file-documents/route.ts", imports));
  const actions = await import(await compile("app/api/files/actions/route.ts", {
    ...imports,
    "../../../../lib/private-files-server": helper,
    "../../../../lib/files": files,
    "../../../../lib/file-organization": organization,
    "../../../../lib/persistence-request": persistence,
    "../../../../lib/supabase-server": db,
  }));
  const request = (path, method = "GET", body, profile = runtime.profile) => new Request(`https://edu.example${path}`, {
    method,
    headers: { origin: "https://edu.example", "x-profile-id": profile.id, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const apiRequest = (path, method = "GET", body, profile = runtime.profile) => request(path, method, body, profile);
  const createFolder = async (id, name, parentId, profile = runtime.profile) => folders.POST(apiRequest("/api/file-folders", "POST", {
    id, name, ...(parentId === undefined ? {} : { parentId }),
  }, profile));
  const createDocument = async (id, name, body, courseId, assignmentId, folderId) => documents.POST(apiRequest(`/api/file-documents?id=${id}`, "POST", {
    name, body, courseId, assignmentId, folderId,
  }));
  const upload = async (id, name, bytes, courseId, assignmentId, folderId) => filesApi.POST(new Request(`https://edu.example/api/files?id=${id}`, {
    method: "POST",
    headers: {
      origin: "https://edu.example", "x-profile-id": runtime.profile.id,
      "content-type": "application/octet-stream",
      "x-file-metadata": encodeURIComponent(JSON.stringify({ name, kind: "attachment", courseId, assignmentId, folderId })),
    },
    body: Buffer.from(bytes),
  }));
  const move = (items, destinationId) => actions.POST(apiRequest("/api/files/actions", "POST", { action: "move", destinationId, items }));
  const folderRow = async (id, profileId = runtime.profile.id) => (await sql("select * from public.file_folders where profile_id=$1 and id=$2", [profileId, id])).rows[0];
  const fileRow = async (id, profileId = runtime.profile.id) => (await sql("select * from public.user_files where profile_id=$1 and id=$2", [profileId, id])).rows[0];
  return { pg, sql, profiles, runtime, folders, filesApi, documents, actions, request, apiRequest, createFolder, createDocument, upload, move, folderRow, fileRow };
}

test("folder moves validate complete selections, normalize descendants, and preserve file content", async (t) => {
  const fixture = await setup();
  const { pg, sql, profiles, runtime, folders, filesApi, documents, actions, apiRequest, createFolder, createDocument, upload, move, folderRow, fileRow } = fixture;
  t.after(async () => {
    delete globalThis.__folderMovesTestAdmin;
    delete globalThis.__folderMovesTestRuntime;
    await pg.close();
  });
  const accountA = profiles[USERS.a], accountB = profiles[USERS.b];

  await t.test("creates deep root custom folders with stable IDs and permits duplicate names", async () => {
    const root = await createFolder(ID.root, "Shared notes");
    assert.equal(root.status, 201, await root.clone().text());
    const rootData = (await root.json()).folder;
    assert.equal(rootData.id, ID.root);
    assert.equal(rootData.parent_id, null);
    assert.equal(rootData.kind, "custom");
    assert.equal(rootData.revision, 1);
    const duplicate = await createFolder(ID.duplicate, "Shared notes");
    assert.equal(duplicate.status, 201, await duplicate.clone().text());
    assert.notEqual((await duplicate.json()).folder.id, rootData.id);
    const retry = await createFolder(ID.root, "Shared notes");
    assert.equal(retry.status, 201, "retrying a stable folder UUID is idempotent");
    assert.equal((await retry.json()).folder.id, rootData.id);
    assert.equal((await createFolder(ID.root, "Different name")).status, 409, "an existing UUID cannot be reused for different folder data");

    const child = await createFolder(ID.child, "Nested", ID.root);
    const deep = await createFolder(ID.deep, "Deep", ID.child);
    assert.equal(child.status, 201, await child.clone().text());
    assert.equal(deep.status, 201, await deep.clone().text());
    assert.equal((await child.json()).folder.parent_id, ID.root);
    assert.equal((await deep.json()).folder.parent_id, ID.child);
    const courseRoots = (await sql("select id,course_id,parent_id,kind from public.file_folders where profile_id=$1 and kind='course' order by course_id", [accountA.id])).rows;
    assert.deepEqual(courseRoots.map(({ course_id, parent_id, kind }) => [course_id, parent_id, kind]), [
      ["biology", null, "course"], ["history", null, "course"],
    ]);
  });

  await t.test("mixed folder and file moves preserve descendants, associations, bodies, hashes, and uploaded bytes", async () => {
    const targetResponse = await createFolder(ID.destination, "Destination");
    const outsideResponse = await createFolder(ID.otherSource, "Other source");
    assert.equal(targetResponse.status, 201);
    assert.equal(outsideResponse.status, 201);
    const text = "History notes — déjà vu\n";
    const nativeResponse = await createDocument(ID.native, "History notes", text, "history", "history-reading", ID.deep);
    assert.equal(nativeResponse.status, 201, await nativeResponse.clone().text());
    const nativeBefore = (await nativeResponse.json()).file;
    const uploadBytes = Buffer.from([0, 1, 2, 3, 254, 255, 13, 10, 0x7f]);
    const uploadResponse = await upload(ID.upload, "Biology lab.bin", uploadBytes, "biology", "biology-lab", ID.otherSource);
    assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text());
    const uploadBefore = (await uploadResponse.json()).file;
    assert.equal(uploadBefore.content_backend, "object");
    assert.equal(uploadBefore.content_sha256, createHash("sha256").update(uploadBytes).digest("hex"));

    const parent = await folderRow(ID.root), child = await folderRow(ID.child);
    const native = await fileRow(ID.native), uploaded = await fileRow(ID.upload);
    const firstOrder = await move([
      { type: "folder", id: ID.root, revision: parent.revision },
      { type: "folder", id: ID.child, revision: child.revision },
      { type: "file", id: ID.native, revision: native.metadata_revision },
      { type: "file", id: ID.upload, revision: uploaded.metadata_revision },
    ], ID.destination);
    assert.equal(firstOrder.status, 200, await firstOrder.clone().text());
    const firstResult = await firstOrder.json();
    assert.deepEqual(firstResult.folders.map((row) => row.id), [ID.root], "the selected ancestor moves while selected descendants are deduplicated");
    assert.deepEqual(firstResult.files.map((row) => row.id), [ID.upload], "the separately selected file moves, while the file inside the selected folder stays in place");
    assert.equal((await folderRow(ID.root)).parent_id, ID.destination);
    assert.equal((await folderRow(ID.child)).parent_id, ID.root);
    assert.equal((await folderRow(ID.deep)).parent_id, ID.child);
    assert.equal((await fileRow(ID.native)).folder_id, ID.deep);
    assert.equal((await fileRow(ID.upload)).folder_id, ID.destination);

    const nativeAfterMove = await fileRow(ID.native), uploadAfterMove = await fileRow(ID.upload);
    assert.equal(nativeAfterMove.course_id, "history");
    assert.equal(nativeAfterMove.assignment_id, "history-reading");
    assert.equal(nativeAfterMove.content_revision, nativeBefore.content_revision);
    assert.equal(nativeAfterMove.content_sha256, nativeBefore.content_sha256);
    assert.equal(uploadAfterMove.course_id, "biology");
    assert.equal(uploadAfterMove.assignment_id, "biology-lab");
    assert.equal(uploadAfterMove.content_revision, uploadBefore.content_revision);
    assert.equal(uploadAfterMove.content_sha256, uploadBefore.content_sha256);
    assert.deepEqual(new Uint8Array(await (await filesApi.GET(apiRequest(`/api/files?id=${ID.upload}`))).arrayBuffer()), new Uint8Array(uploadBytes));
    const nativeDownload = await filesApi.GET(apiRequest(`/api/files?id=${ID.native}`));
    assert.equal(new TextDecoder().decode(await nativeDownload.arrayBuffer()), text);
    assert.equal((await (await documents.GET(apiRequest(`/api/file-documents?id=${ID.native}`))).json()).document.body, text);

    const currentParent = await folderRow(ID.root);
    const reset = await move([{ type: "folder", id: ID.root, revision: currentParent.revision }], null);
    assert.equal(reset.status, 200, await reset.clone().text());
    const inverted = await move([
      { type: "file", id: ID.native, revision: nativeAfterMove.metadata_revision },
      { type: "folder", id: ID.child, revision: child.revision },
      { type: "folder", id: ID.root, revision: (await folderRow(ID.root)).revision },
    ], ID.destination);
    assert.equal(inverted.status, 200, await inverted.clone().text());
    const invertedResult = await inverted.json();
    assert.deepEqual(invertedResult.folders.map((row) => row.id), [ID.root]);
    assert.deepEqual(invertedResult.files, [], "normalization uses the original hierarchy when descendants appear before their selected ancestor");
    assert.equal((await folderRow(ID.child)).parent_id, ID.root);
    assert.equal((await fileRow(ID.native)).folder_id, ID.deep);

    const renamed = await filesApi.PUT(apiRequest(`/api/files?id=${ID.native}`, "PUT", {
      action: "rename", name: "Renamed history.txt", baseMetadataRevision: nativeAfterMove.metadata_revision,
    }));
    assert.equal(renamed.status, 200, await renamed.clone().text());
    const renamedFile = (await renamed.json()).file;
    assert.equal(renamedFile.name, "Renamed history.txt");
    assert.equal(renamedFile.folder_id, ID.deep);
    assert.equal(renamedFile.course_id, "history");
    assert.equal(renamedFile.assignment_id, "history-reading");
    assert.equal(renamedFile.content_revision, nativeAfterMove.content_revision);
    assert.equal(renamedFile.content_sha256, nativeAfterMove.content_sha256);
    assert.equal((await (await documents.GET(apiRequest(`/api/file-documents?id=${ID.native}`))).json()).document.body, text);
    const staleRename = await filesApi.PUT(apiRequest(`/api/files?id=${ID.native}`, "PUT", {
      action: "rename", name: "Stale rename.txt", baseMetadataRevision: nativeAfterMove.metadata_revision,
    }));
    assert.equal(staleRename.status, 409, await staleRename.clone().text());
    assert.equal((await fileRow(ID.native)).name, "Renamed history.txt");

    const uploadRename = await filesApi.PUT(apiRequest(`/api/files?id=${ID.upload}`, "PUT", {
      action: "rename", name: "Biology lab renamed.bin", baseMetadataRevision: uploadAfterMove.metadata_revision,
    }));
    assert.equal(uploadRename.status, 200, await uploadRename.clone().text());
    const renamedUpload = (await uploadRename.json()).file;
    assert.equal(renamedUpload.folder_id, ID.destination);
    assert.equal(renamedUpload.course_id, "biology");
    assert.equal(renamedUpload.assignment_id, "biology-lab");
    assert.equal(renamedUpload.content_revision, uploadAfterMove.content_revision);
    assert.equal(renamedUpload.content_sha256, uploadAfterMove.content_sha256);
    assert.deepEqual(new Uint8Array(await (await filesApi.GET(apiRequest(`/api/files?id=${ID.upload}`))).arrayBuffer()), new Uint8Array(uploadBytes));
    const staleUploadRename = await filesApi.PUT(apiRequest(`/api/files?id=${ID.upload}`, "PUT", {
      action: "rename", name: "Stale upload name.bin", baseMetadataRevision: uploadAfterMove.metadata_revision,
    }));
    assert.equal(staleUploadRename.status, 409, await staleUploadRename.clone().text());
    assert.equal((await fileRow(ID.upload)).name, "Biology lab renamed.bin");
  });

  await t.test("stale raw descendants reject the whole move before any folder executes", async () => {
    for (const [id, name, parent] of [[ID.staleRoot, "Stale root", undefined], [ID.staleChild, "Stale child", ID.staleRoot]]) {
      const created = await createFolder(id, name, parent);
      assert.equal(created.status, 201, await created.clone().text());
    }
    const documentResponse = await createDocument(ID.staleFile, "Stale child.txt", "Before rename", "history", "history-reading", ID.staleChild);
    assert.equal(documentResponse.status, 201, await documentResponse.clone().text());
    const document = (await documentResponse.json()).file;
    const root = await folderRow(ID.staleRoot), child = await folderRow(ID.staleChild);
    const staleRename = await filesApi.PUT(apiRequest(`/api/files?id=${ID.staleFile}`, "PUT", {
      action: "rename", name: "New metadata revision.txt", baseMetadataRevision: document.metadata_revision,
    }));
    assert.equal(staleRename.status, 200, await staleRename.clone().text());
    const rejected = await move([
      { type: "folder", id: ID.staleRoot, revision: root.revision },
      { type: "folder", id: ID.staleChild, revision: child.revision },
      { type: "file", id: ID.staleFile, revision: document.metadata_revision },
    ], ID.destination);
    assert.equal(rejected.status, 409, await rejected.clone().text());
    assert.equal((await folderRow(ID.staleRoot)).parent_id, null);
    assert.equal((await folderRow(ID.staleRoot)).revision, root.revision);
    assert.equal((await folderRow(ID.staleChild)).parent_id, ID.staleRoot);
    assert.equal((await fileRow(ID.staleFile)).folder_id, ID.staleChild);
    assert.equal((await fileRow(ID.staleFile)).metadata_revision, document.metadata_revision + 1);
  });

  await t.test("rejects self, deep descendant, and selected-destination cycles atomically", async () => {
    for (const [id, name, parent] of [
      [ID.cycleRoot, "Cycle root", undefined],
      [ID.cycleChild, "Cycle child", ID.cycleRoot],
      [ID.cycleDeep, "Cycle deep", ID.cycleChild],
      [ID.cycleDestination, "Selected destination", undefined],
    ]) {
      const response = await createFolder(id, name, parent);
      assert.equal(response.status, 201, await response.clone().text());
    }
    const root = await folderRow(ID.cycleRoot), child = await folderRow(ID.cycleChild), deep = await folderRow(ID.cycleDeep);
    const self = await move([{ type: "folder", id: ID.cycleRoot, revision: root.revision }], ID.cycleRoot);
    assert.equal(self.status, 400, await self.clone().text());
    const descendant = await move([{ type: "folder", id: ID.cycleRoot, revision: root.revision }], ID.cycleDeep);
    assert.equal(descendant.status, 400, await descendant.clone().text());
    const selectedTarget = await move([
      { type: "folder", id: ID.cycleRoot, revision: root.revision },
      { type: "folder", id: ID.cycleDestination, revision: (await folderRow(ID.cycleDestination)).revision },
    ], ID.cycleDestination);
    assert.equal(selectedTarget.status, 400, await selectedTarget.clone().text());
    assert.equal((await folderRow(ID.cycleRoot)).parent_id, null);
    assert.equal((await folderRow(ID.cycleRoot)).revision, root.revision);
    assert.equal((await folderRow(ID.cycleChild)).parent_id, ID.cycleRoot);
    assert.equal((await folderRow(ID.cycleChild)).revision, child.revision);
    assert.equal((await folderRow(ID.cycleDeep)).parent_id, ID.cycleChild);
    assert.equal((await folderRow(ID.cycleDeep)).revision, deep.revision);
    assert.equal((await folderRow(ID.cycleDestination)).parent_id, null);
  });

  await t.test("rejects foreign, missing, and trashed destinations and protects managed course roots", async () => {
    runtime.profile = accountB;
    const foreignCreated = await createFolder(ID.foreignFolder, "B only");
    assert.equal(foreignCreated.status, 201, await foreignCreated.clone().text());
    runtime.profile = accountA;
    const edge = await createDocument(ID.edgeFile, "Edge cases.txt", "Do not move", "history", "history-reading", ID.otherSource);
    assert.equal(edge.status, 201, await edge.clone().text());
    const edgeFile = (await edge.json()).file;
    for (const destinationId of [ID.foreignFolder, "32323232-3232-4232-8232-323232323232"]) {
      const response = await move([{ type: "file", id: ID.edgeFile, revision: edgeFile.metadata_revision }], destinationId);
      assert.equal(response.status, 404, await response.clone().text());
    }
    const trashedDestination = await createFolder(ID.trashedDestination, "Trashed destination");
    assert.equal(trashedDestination.status, 201);
    const trashResponse = await folders.DELETE(apiRequest(`/api/file-folders?id=${ID.trashedDestination}`, "DELETE", { revision: 1 }));
    assert.equal(trashResponse.status, 200, await trashResponse.clone().text());
    const toTrash = await move([{ type: "file", id: ID.edgeFile, revision: edgeFile.metadata_revision }], ID.trashedDestination);
    assert.equal(toTrash.status, 404, await toTrash.clone().text());
    assert.equal((await fileRow(ID.edgeFile)).folder_id, ID.otherSource);

    const courseFolder = (await sql("select * from public.file_folders where profile_id=$1 and course_id='history' and kind='course'", [accountA.id])).rows[0];
    const rename = await folders.PUT(apiRequest("/api/file-folders", "PUT", { id: courseFolder.id, action: "rename", name: "Spoofed", revision: courseFolder.revision }));
    assert.equal(rename.status, 400, await rename.clone().text());
    const moveSingle = await folders.PUT(apiRequest("/api/file-folders", "PUT", { id: courseFolder.id, action: "move", parentId: ID.root, revision: courseFolder.revision }));
    assert.equal(moveSingle.status, 400, await moveSingle.clone().text());
    const moveBatch = await move([{ type: "folder", id: courseFolder.id, revision: courseFolder.revision }], ID.root);
    assert.equal(moveBatch.status, 400, await moveBatch.clone().text());
    const trash = await folders.DELETE(apiRequest(`/api/file-folders?id=${courseFolder.id}`, "DELETE", { revision: courseFolder.revision }));
    assert.equal(trash.status, 400, await trash.clone().text());
    const trashBatch = await actions.POST(apiRequest("/api/files/actions", "POST", {
      action: "trash", items: [{ type: "folder", id: courseFolder.id, revision: courseFolder.revision }],
    }));
    assert.equal(trashBatch.status, 400, await trashBatch.clone().text());
    const afterManagedAttempts = await folderRow(courseFolder.id);
    assert.equal(afterManagedAttempts.parent_id, null);
    assert.equal(afterManagedAttempts.name, "History");
    assert.equal(afterManagedAttempts.trashed_at, null);
    assert.equal(afterManagedAttempts.revision, courseFolder.revision);
  });

  await t.test("move and trash commit in serialized order and expose service-only RPC grants", async () => {
    const first = await createDocument(ID.raceMoveFirst, "Move then trash.txt", "Sequence one", "history", "history-reading", ID.otherSource);
    const second = await createDocument(ID.raceTrashFirst, "Trash then move.txt", "Sequence two", "biology", "biology-lab", ID.otherSource);
    assert.equal(first.status, 201, await first.clone().text());
    assert.equal(second.status, 201, await second.clone().text());
    const firstFile = (await first.json()).file, secondFile = (await second.json()).file;
    const moveFirst = await move([{ type: "file", id: ID.raceMoveFirst, revision: firstFile.metadata_revision }], ID.destination);
    assert.equal(moveFirst.status, 200, await moveFirst.clone().text());
    const staleTrash = await actions.POST(apiRequest("/api/files/actions", "POST", {
      action: "trash", items: [{ type: "file", id: ID.raceMoveFirst, revision: firstFile.metadata_revision }],
    }));
    assert.equal(staleTrash.status, 409, await staleTrash.clone().text());
    const movedCurrent = await fileRow(ID.raceMoveFirst);
    const trashAfterMove = await actions.POST(apiRequest("/api/files/actions", "POST", {
      action: "trash", items: [{ type: "file", id: ID.raceMoveFirst, revision: movedCurrent.metadata_revision }],
    }));
    assert.equal(trashAfterMove.status, 200, await trashAfterMove.clone().text());
    const afterMoveThenTrash = await fileRow(ID.raceMoveFirst);
    assert.equal(afterMoveThenTrash.trashed_at !== null, true);
    assert.equal(afterMoveThenTrash.original_folder_id, ID.destination);
    assert.equal(afterMoveThenTrash.folder_id, null);

    const trashFirst = await actions.POST(apiRequest("/api/files/actions", "POST", {
      action: "trash", items: [{ type: "file", id: ID.raceTrashFirst, revision: secondFile.metadata_revision }],
    }));
    assert.equal(trashFirst.status, 200, await trashFirst.clone().text());
    const staleMove = await move([{ type: "file", id: ID.raceTrashFirst, revision: secondFile.metadata_revision }], ID.destination);
    assert.equal(staleMove.status, 409, await staleMove.clone().text());
    const afterTrashThenMove = await fileRow(ID.raceTrashFirst);
    assert.ok(afterTrashThenMove.trashed_at);
    assert.equal(afterTrashThenMove.folder_id, null);
    assert.equal(afterTrashThenMove.original_folder_id, ID.otherSource);

    const actionSignature = "public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean)";
    const renameSignature = "public.rename_account_file(uuid, uuid, uuid, bigint, text)";
    for (const signature of [actionSignature, renameSignature]) {
      const grants = (await sql(`select has_function_privilege('anon',$1,'execute') as anon_exec,
        has_function_privilege('authenticated',$1,'execute') as authenticated_exec,
        has_function_privilege('service_role',$1,'execute') as service_exec`, [signature])).rows[0];
      assert.deepEqual(grants, { anon_exec: false, authenticated_exec: false, service_exec: true });
    }
    const definition = (await sql("select pg_get_functiondef($1::regprocedure) as definition", ["public.mutate_account_files_action_legacy(uuid, uuid, text, jsonb, uuid, boolean)"])).rows[0].definition.toLowerCase();
    const profileLock = definition.indexOf("perform 1 from public.app_profiles");
    const fileValidation = definition.indexOf("select * into f from public.user_files");
    const folderValidation = definition.indexOf("select * into folder_row from public.file_folders");
    assert.ok(profileLock >= 0 && fileValidation > profileLock && folderValidation > profileLock,
      "the account row lock is acquired before selected file or folder rows are read and locked");
  });
});
