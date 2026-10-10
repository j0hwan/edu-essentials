import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { clientModule } from "./helpers/client-modules.mjs";

const { trashBrowserItems, restoreTrashItems } = await import(await clientModule("lib/files-trash-operations.ts"));

const USERS = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const ID = {
  root: "10101010-1010-4010-8010-101010101010",
  child: "12121212-1212-4121-8121-121212121212",
  deep: "13131313-1313-4131-8131-131313131313",
  sibling: "14141414-1414-4141-8141-141414141414",
  grandchild: "15151515-1515-4151-8151-151515151515",
  destination: "16161616-1616-4161-8161-161616161616",
  independentFolder: "17171717-1717-4171-8171-171717171717",
  native: "18181818-1818-4818-8818-181818181818",
  image: "19191919-1919-4919-8919-191919191919",
  independentFile: "20202020-2020-4020-8020-202020202020",
  staleRoot: "21212121-2121-4121-8121-212121212121",
  staleChild: "22222222-2222-4222-8222-222222222222",
  staleFile: "23232323-2323-4323-8323-232323232323",
  protectedSavedFolder: "24242424-2424-4424-8424-242424242424",
  protectedDraftFolder: "25252525-2525-4525-8525-252525252525",
  savedSyllabus: "26262626-2626-4626-8626-262626262626",
  draftSyllabus: "27272727-2727-4727-8727-272727272727",
  parent: "28282828-2828-4828-8828-282828282828",
  orphan: "29292929-2929-4929-8929-292929292929",
  orphanFileA: "30303030-3030-4030-8030-303030303030",
  orphanFileB: "31313131-3131-4131-8131-313131313131",
  purgeRoot: "32323232-3232-4232-8232-323232323232",
  purgeChild: "33333333-3333-4333-8333-333333333333",
  purgeNative: "34343434-3434-4434-8434-343434343434",
  purgeObjectA: "35353535-3535-4535-8535-353535353535",
  purgeObjectB: "36363636-3636-4636-8636-363636363636",
  laterFolder: "37373737-3737-4737-8737-373737373737",
  laterFile: "38383838-3838-4838-8838-383838383838",
  activeFolder: "39393939-3939-4939-8939-393939393939",
  activeFile: "40404040-4040-4040-8040-404040404040",
  courseRoot: "41414141-4141-4141-8141-414141414141",
  foreignFolder: "42424242-4242-4242-8242-424242424242",
  recoveryCollision: "43434343-4343-4343-8343-434343434343",
  secondParent: "44444444-4444-4444-8444-444444444444",
  secondChild: "45454545-4545-4555-8555-454545454545",
  secondFile: "46464646-4646-4646-8464-464646464646",
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

async function setup({ withAi = true } = {}) {
  const pg = new PGlite(withAi ? { extensions: { vector } } : {});
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
    if (!withAi && (file.startsWith("20260918") || file === "20261008030000_file_content_ai.sql")) continue;
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const runtime = {
    profile: profiles[USERS.a], profiles, objects: new Map(),
    failedRemovePaths: new Set(), removeCalls: [],
  };
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
        mutate_account_file_tree_action: () => sql("select public.mutate_account_file_tree_action($1,$2,$3,$4::jsonb,$5,$6) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_action, JSON.stringify(args.p_items),
          args.p_destination_id ?? null, args.p_destination_provided ?? false,
        ]),
        begin_account_file_purge: () => sql("select public.begin_account_file_purge($1,$2,$3,$4::jsonb,$5) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_request_id, JSON.stringify(args.p_items), args.p_empty ?? false,
        ]),
        finalize_account_file_purge: () => sql("select public.finalize_account_file_purge($1,$2,$3) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_request_id,
        ]),
        read_account_file_content: () => sql("select public.read_account_file_content($1,$2,$3,$4) as data", [
          args.p_profile_id, args.p_file_id, args.p_expected_content_revision ?? null, args.p_allow_trashed ?? false,
        ]),
        read_account_file_browser: () => sql("select public.read_account_file_browser($1,$2) as data", [
          args.p_profile_id, args.p_auth_user_id,
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
      if (!new Set(["user_files", "file_folders", "file_activity", "folder_activity"]).has(table)) throw new Error(`Unexpected table ${table}`);
      let columns = "*";
      const filters = [];
      const orderings = [];
      let offset = 0, limit = null;
      const builder = {
        select(value) { columns = value || "*"; return builder; },
        eq(column, value) { filters.push({ column, value, op: "=" }); return builder; },
        is(column, value) { filters.push({ column, value, op: value === null ? "is null" : "=" }); return builder; },
        order(column, options = {}) { orderings.push(`${ident(column)} ${options.ascending === false ? "desc" : "asc"}`); return builder; },
        range(start, end) { offset = start; limit = end - start + 1; return builder; },
        async execute(single = false) {
          const values = [];
          const where = filters.map(({ column, value, op }) => {
            if (op === "is null") return `${ident(column)} is null`;
            values.push(value);
            return `${ident(column)} = $${values.length}`;
          }).join(" and ");
          const selected = columns === "*" ? "*" : columns.split(",").map((column) => ident(column.trim())).join(",");
          const clauses = [where ? `where ${where}` : "", orderings.length ? `order by ${orderings.join(",")}` : ""];
          const pagination = single ? "limit 1" : limit === null ? "" : `limit ${limit} offset ${offset}`;
          try {
            const result = await sql(`select ${selected} from public.${ident(table)} ${clauses.filter(Boolean).join(" ")} ${pagination}`, values);
            return { data: single ? result.rows[0] ?? null : result.rows, error: null };
          } catch (error) { return { data: null, error }; }
        },
        async maybeSingle() {
          return builder.execute(true);
        },
        then(resolve, reject) { return builder.execute().then(resolve, reject); },
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
          async remove(paths) {
            const requested = [...paths];
            runtime.removeCalls.push(requested);
            for (const path of requested) {
              if (runtime.failedRemovePaths.has(path)) return { data: null, error: new Error(`storage removal failed: ${path}`) };
              runtime.objects.delete(path);
            }
            return { data: null, error: null };
          },
        };
      },
    },
  };
  globalThis.__recursiveTrashTestAdmin = admin;
  globalThis.__recursiveTrashTestRuntime = runtime;
  const auth = moduleUrl(`
    export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
    export const requireProfile = async () => globalThis.__recursiveTrashTestRuntime.profile;
    export function requireSameOrigin(request) {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new AuthError("Wrong origin.", 403);
    }
    export function apiError(error) {
      return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "no-store" } });
    }
  `);
  const db = moduleUrl("export const getSupabaseAdmin = () => globalThis.__recursiveTrashTestAdmin;");
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
  const createDocument = async (id, name, body, courseId, assignmentId, folderId, kind = "resource") => documents.POST(apiRequest(`/api/file-documents?id=${id}`, "POST", {
    name, body, courseId, assignmentId, folderId, kind,
  }));
  const upload = async (id, name, bytes, courseId, assignmentId, folderId, kind = "attachment") => filesApi.POST(new Request(`https://edu.example/api/files?id=${id}`, {
    method: "POST",
    headers: {
      origin: "https://edu.example", "x-profile-id": runtime.profile.id,
      "content-type": "application/octet-stream",
      "x-file-metadata": encodeURIComponent(JSON.stringify({ name, kind, courseId, assignmentId, folderId })),
    },
    body: Buffer.from(bytes),
  }));
  const move = (items, destinationId) => actions.POST(apiRequest("/api/files/actions", "POST", { action: "move", destinationId, items }));
  const trash = (items) => actions.POST(apiRequest("/api/files/actions", "POST", { action: "trash", items }));
  const restore = (items, destinationId) => actions.POST(apiRequest("/api/files/actions", "POST", {
    action: "restore", items, ...(destinationId === undefined ? {} : { destinationId }),
  }));
  const permanentDelete = (items, requestId) => actions.POST(apiRequest("/api/files/actions", "POST", {
    action: "permanent-delete", items, ...(requestId ? { requestId } : {}),
  }));
  const emptyTrash = (requestId) => actions.POST(apiRequest("/api/files/actions", "POST", {
    action: "empty-trash", requestId,
  }));
  const folderRow = async (id, profileId = runtime.profile.id) => (await sql("select * from public.file_folders where profile_id=$1 and id=$2", [profileId, id])).rows[0];
  const fileRow = async (id, profileId = runtime.profile.id) => (await sql("select * from public.user_files where profile_id=$1 and id=$2", [profileId, id])).rows[0];
  const fileActivityRow = async (id, profileId = runtime.profile.id) => (await sql("select * from public.file_activity where profile_id=$1 and file_id=$2", [profileId, id])).rows[0];
  const folderActivityRow = async (id, profileId = runtime.profile.id) => (await sql("select * from public.folder_activity where profile_id=$1 and folder_id=$2", [profileId, id])).rows[0];
  return { pg, sql, profiles, runtime, folders, filesApi, documents, actions, request, apiRequest, createFolder, createDocument, upload,
    move, trash, restore, permanentDelete, emptyTrash, folderRow, fileRow, fileActivityRow, folderActivityRow };
}

function closeFixture(t, fixture) {
  t.after(async () => {
    delete globalThis.__recursiveTrashTestAdmin;
    delete globalThis.__recursiveTrashTestRuntime;
    await fixture.pg.close();
  });
}

const fileSelection = (row) => ({ type: "file", id: row.id, revision: row.metadata_revision });
const folderSelection = (row) => ({ type: "folder", id: row.id, revision: row.revision });

async function savedDashboard(sql, profileId, update) {
  const current = (await sql("select payload from public.dashboard_state where profile_id=$1", [profileId])).rows[0].payload;
  const next = structuredClone(current);
  update(next);
  await sql("update public.dashboard_state set payload=$2::jsonb where profile_id=$1", [profileId, JSON.stringify(next)]);
  return next;
}

test("recursive Trash keeps operation boundaries, original paths, contents, and scoped restore behavior", async (t) => {
  const fixture = await setup();
  closeFixture(t, fixture);
  const { sql, profiles, folders, filesApi, documents, actions, apiRequest, createFolder, createDocument, upload, trash, restore, folderRow, fileRow, fileActivityRow, folderActivityRow } = fixture;
  const profile = profiles[USERS.a];
  const nativeBody = "Résumé — 東京 🌱\nWeek 1: naïve café ✓\n";
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

  for (const [id, name, parentId] of [
    [ID.root, "Course Notes"],
    [ID.child, "Reading", ID.root],
    [ID.deep, "Week 1", ID.child],
    [ID.sibling, "Lab work", ID.root],
    [ID.independentFolder, "Deleted before parent", ID.root],
  ]) {
    const response = await createFolder(id, name, parentId);
    assert.equal(response.status, 201, await response.clone().text());
  }
  const nativeCreate = await createDocument(ID.native, "考察 résumé.txt", nativeBody, "history", "history-reading", ID.deep, "attachment");
  assert.equal(nativeCreate.status, 201, await nativeCreate.clone().text());
  const imageCreate = await upload(ID.image, "Evidence.png", png, "history", "history-reading", ID.deep);
  assert.equal(imageCreate.status, 201, await imageCreate.clone().text());
  const independentCreate = await createDocument(ID.independentFile, "Already deleted.txt", "Separate Trash operation", "history", "history-reading", ID.deep);
  assert.equal(independentCreate.status, 201, await independentCreate.clone().text());
  const siblingCreate = await createDocument(ID.activeFile, "Lab checklist.txt", "Sibling branch", "biology", "biology-lab", ID.sibling);
  assert.equal(siblingCreate.status, 201, await siblingCreate.clone().text());

  const activity = await actions.POST(apiRequest("/api/files/actions", "POST", {
    action: "star",
    items: [
      fileSelection((await fileRow(ID.native))),
      folderSelection(await folderRow(ID.deep)),
    ],
  }));
  assert.equal(activity.status, 200, await activity.clone().text());
  const fileStarredAt = (await fileActivityRow(ID.native)).starred_at;
  const folderStarredAt = (await folderActivityRow(ID.deep)).starred_at;
  assert.ok(fileStarredAt);
  assert.ok(folderStarredAt);

  // The six-argument action RPC still routes move/activity to the legacy body.
  assert.equal((await createFolder(ID.destination, "Move destination")).status, 201);
  assert.equal((await createFolder(ID.grandchild, "Move compatibility source")).status, 201);
  const moved = await actions.POST(apiRequest("/api/files/actions", "POST", {
    action: "move", destinationId: ID.destination,
    items: [folderSelection(await folderRow(ID.grandchild))],
  }));
  assert.equal(moved.status, 200, await moved.clone().text());
  assert.equal((await folderRow(ID.grandchild)).parent_id, ID.destination);

  const independentFileTrash = await trash([fileSelection(await fileRow(ID.independentFile))]);
  assert.equal(independentFileTrash.status, 200, await independentFileTrash.clone().text());
  const independentFolderTrash = await trash([folderSelection(await folderRow(ID.independentFolder))]);
  assert.equal(independentFolderTrash.status, 200, await independentFolderTrash.clone().text());
  const independentFileBeforeParent = await fileRow(ID.independentFile);
  const independentFolderBeforeParent = await folderRow(ID.independentFolder);
  assert.equal(independentFileBeforeParent.original_location_path, "Course Notes/Reading/Week 1/Already deleted.txt");
  assert.equal(independentFolderBeforeParent.original_location_path, "Course Notes/Deleted before parent");

  const rootTrash = await trash([folderSelection(await folderRow(ID.root))]);
  assert.equal(rootTrash.status, 200, await rootTrash.clone().text());
  const trashedRoot = await folderRow(ID.root), trashedChild = await folderRow(ID.child), trashedDeep = await folderRow(ID.deep);
  const trashedNative = await fileRow(ID.native), trashedImage = await fileRow(ID.image), trashedSiblingFile = await fileRow(ID.activeFile);
  assert.ok(trashedRoot.trashed_at);
  assert.ok(trashedChild.trashed_at);
  assert.ok(trashedDeep.trashed_at);
  assert.equal(trashedRoot.original_location_path, "Course Notes");
  assert.equal(trashedChild.original_location_path, "Course Notes/Reading");
  assert.equal(trashedDeep.original_location_path, "Course Notes/Reading/Week 1");
  assert.equal(trashedNative.original_location_path, "Course Notes/Reading/Week 1/考察 résumé.txt");
  assert.equal(trashedImage.original_location_path, "Course Notes/Reading/Week 1/Evidence.png");
  assert.equal(trashedNative.trashed_at, trashedRoot.trashed_at);
  assert.equal(trashedNative.trash_operation_id, trashedRoot.trash_operation_id);
  assert.equal(trashedSiblingFile.trash_operation_id, trashedRoot.trash_operation_id);
  assert.equal((await fileRow(ID.image)).course_id, "history");
  assert.equal((await fileRow(ID.image)).assignment_id, "history-reading");
  assert.equal((await fileRow(ID.image)).content_backend, "object");
  assert.equal((await fileRow(ID.native)).content_backend, "native-text");
  assert.deepEqual(await sql("select body from public.native_file_documents where profile_id=$1 and file_id=$2", [profile.id, ID.native]).then((r) => r.rows[0].body), nativeBody);

  const independentFileAfterParent = await fileRow(ID.independentFile), independentFolderAfterParent = await folderRow(ID.independentFolder);
  assert.equal(independentFileAfterParent.trashed_at, independentFileBeforeParent.trashed_at);
  assert.equal(independentFileAfterParent.trash_operation_id, independentFileBeforeParent.trash_operation_id);
  assert.equal(independentFileAfterParent.original_location_path, independentFileBeforeParent.original_location_path);
  assert.equal(independentFolderAfterParent.trashed_at, independentFolderBeforeParent.trashed_at);
  assert.equal(independentFolderAfterParent.trash_operation_id, independentFolderBeforeParent.trash_operation_id);
  assert.equal(independentFolderAfterParent.original_location_path, independentFolderBeforeParent.original_location_path);
  assert.notEqual(independentFileAfterParent.trash_operation_id, trashedRoot.trash_operation_id);
  assert.notEqual(independentFolderAfterParent.trash_operation_id, trashedRoot.trash_operation_id);

  const trashFiles = await filesApi.GET(apiRequest("/api/files?view=trash"));
  assert.equal(trashFiles.status, 200, await trashFiles.clone().text());
  assert.ok((await trashFiles.json()).files.some((row) => row.id === ID.native));
  const trashFolders = await folders.GET(apiRequest("/api/file-folders?view=trash"));
  assert.equal(trashFolders.status, 200, await trashFolders.clone().text());
  assert.ok((await trashFolders.json()).folders.some((row) => row.id === ID.root));

  // Restoring a nested selection revives that selected branch and its original
  // operation descendants, while the sibling and independent operations stay in Trash.
  const restoredBranch = await restore([folderSelection(await folderRow(ID.child))], null);
  assert.equal(restoredBranch.status, 200, await restoredBranch.clone().text());
  assert.equal((await folderRow(ID.child)).trashed_at, null);
  assert.equal((await folderRow(ID.deep)).trashed_at, null);
  assert.equal((await folderRow(ID.child)).parent_id, null, "an explicitly null destination restores the selected nested folder to the account root");
  assert.equal((await fileRow(ID.native)).trashed_at, null);
  assert.equal((await fileRow(ID.image)).trashed_at, null);
  assert.equal((await fileRow(ID.native)).folder_id, ID.deep);
  assert.equal((await fileRow(ID.image)).folder_id, ID.deep);
  assert.equal((await folderRow(ID.root)).trashed_at, trashedRoot.trashed_at);
  assert.ok((await folderRow(ID.sibling)).trashed_at);
  assert.ok((await fileRow(ID.activeFile)).trashed_at);
  assert.ok((await fileRow(ID.independentFile)).trashed_at);
  assert.ok((await folderRow(ID.independentFolder)).trashed_at);
  assert.equal((await fileActivityRow(ID.native)).starred_at, fileStarredAt);
  assert.equal((await folderActivityRow(ID.deep)).starred_at, folderStarredAt);
  const nativeGet = await documents.GET(apiRequest(`/api/file-documents?id=${ID.native}`));
  assert.equal(nativeGet.status, 200, await nativeGet.clone().text());
  assert.equal((await nativeGet.json()).document.body, nativeBody);
  const imageGet = await filesApi.GET(apiRequest(`/api/files?id=${ID.image}`));
  assert.equal(imageGet.status, 200);
  assert.deepEqual(new Uint8Array(await imageGet.arrayBuffer()), new Uint8Array(png));

  // Restoring the operation root later restores its still-trashed branch only.
  const explicitRootRestore = await restore([folderSelection(await folderRow(ID.root))], null);
  assert.equal(explicitRootRestore.status, 200, await explicitRootRestore.clone().text());
  assert.equal((await folderRow(ID.root)).trashed_at, null);
  assert.equal((await folderRow(ID.root)).parent_id, null);
  assert.equal((await folderRow(ID.sibling)).trashed_at, null);
  assert.equal((await fileRow(ID.activeFile)).trashed_at, null);
  assert.ok((await fileRow(ID.independentFile)).trashed_at);
  assert.ok((await folderRow(ID.independentFolder)).trashed_at);
});

test("stale descendants, saved syllabus references, managed roots, and foreign selections fail atomically", async (t) => {
  const fixture = await setup();
  closeFixture(t, fixture);
  const { sql, profiles, runtime, filesApi, apiRequest, createFolder, createDocument, trash, folderRow, fileRow } = fixture;
  const profileA = profiles[USERS.a], profileB = profiles[USERS.b];

  assert.equal((await createFolder(ID.staleRoot, "Stale parent")).status, 201);
  assert.equal((await createFolder(ID.staleChild, "Stale child", ID.staleRoot)).status, 201);
  const staleFileResponse = await createDocument(ID.staleFile, "Before rename.txt", "Stable body", "history", "history-reading", ID.staleChild);
  assert.equal(staleFileResponse.status, 201, await staleFileResponse.clone().text());
  const staleFile = (await staleFileResponse.json()).file;
  const staleRoot = await folderRow(ID.staleRoot), staleChild = await folderRow(ID.staleChild);
  const rename = await filesApi.PUT(apiRequest(`/api/files?id=${ID.staleFile}`, "PUT", {
    action: "rename", name: "After rename.txt", baseMetadataRevision: staleFile.metadata_revision,
  }));
  assert.equal(rename.status, 200, await rename.clone().text());
  const afterRename = await fileRow(ID.staleFile);
  const staleBatch = await trash([
    folderSelection(staleRoot),
    folderSelection(staleChild),
    { type: "file", id: ID.staleFile, revision: staleFile.metadata_revision },
  ]);
  assert.equal(staleBatch.status, 409, await staleBatch.clone().text());
  assert.equal((await folderRow(ID.staleRoot)).parent_id, null);
  assert.equal((await folderRow(ID.staleRoot)).trashed_at, null);
  assert.equal((await folderRow(ID.staleRoot)).revision, staleRoot.revision);
  assert.equal((await folderRow(ID.staleChild)).parent_id, ID.staleRoot);
  assert.equal((await folderRow(ID.staleChild)).trashed_at, null);
  assert.equal((await folderRow(ID.staleChild)).revision, staleChild.revision);
  const staleAfterRollback = await fileRow(ID.staleFile);
  assert.equal(staleAfterRollback.name, "After rename.txt");
  assert.equal(staleAfterRollback.metadata_revision, afterRename.metadata_revision);
  assert.equal(staleAfterRollback.folder_id, ID.staleChild);
  assert.equal(staleAfterRollback.trashed_at, null);
  assert.equal(staleAfterRollback.original_location_path, null);

  // Exercise the real browser helper against the compiled route and migrated
  // RPC, so client-side overlap handling cannot hide a stale descendant.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => fixture.actions.POST(new Request(new URL(url, "https://edu.example"), {
    ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), origin: "https://edu.example" },
  }));
  try {
    await assert.rejects(trashBrowserItems(profileA.id, [
      { type: "folder", id: staleRoot.id, folder: staleRoot },
      { type: "folder", id: staleChild.id, folder: staleChild },
      { type: "file", id: staleFile.id, file: staleFile },
    ], { folders: [staleRoot, staleChild] }), /changed/i);
    assert.equal((await folderRow(ID.staleRoot)).trashed_at, null);
    assert.equal((await fileRow(ID.staleFile)).trashed_at, null);

    const savedTrash = await trash([folderSelection(await folderRow(ID.staleRoot))]);
    assert.equal(savedTrash.status, 200);
    const capturedParent = await folderRow(ID.staleRoot);
    const capturedChild = await folderRow(ID.staleChild);
    const capturedFile = await fileRow(ID.staleFile);
    const independentlyRestored = await fixture.restore([fileSelection(capturedFile)]);
    assert.equal(independentlyRestored.status, 200);
    await assert.rejects(restoreTrashItems(profileA.id, [
      { type: "folder", id: capturedParent.id, folder: capturedParent },
      { type: "file", id: capturedFile.id, file: capturedFile },
    ], { folders: [capturedParent, capturedChild] }), /changed/i);
    assert.equal((await folderRow(ID.staleRoot)).trashed_at, capturedParent.trashed_at);
    assert.equal((await folderRow(ID.staleRoot)).revision, capturedParent.revision);
    assert.equal((await fileRow(ID.staleFile)).trashed_at, null);
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const [folderId, name, fileId, fileName, referenceKind] of [
    [ID.protectedSavedFolder, "Saved source folder", ID.savedSyllabus, "Protected saved syllabus.pdf", "saved"],
    [ID.protectedDraftFolder, "Draft source folder", ID.draftSyllabus, "Protected draft source.pdf", "draft"],
  ]) {
    const folderResponse = await createFolder(folderId, name);
    assert.equal(folderResponse.status, 201, await folderResponse.clone().text());
    const fileResponse = await createDocument(fileId, fileName, "Referenced syllabus text", "history", "", folderId, "syllabus");
    assert.equal(fileResponse.status, 201, await fileResponse.clone().text());
    await savedDashboard(sql, profileA.id, (payload) => {
      payload.d.courseDetails = referenceKind === "saved" ? { history: { syllabusFileId: fileId } } : {};
      payload.d.syllabusDrafts = referenceKind === "draft"
        ? [{ id: "draft-history", sourceFileId: fileId, sourceName: fileName, sourceText: "Review this source" }]
        : [];
    });
    const folderBefore = await folderRow(folderId), fileBefore = await fileRow(fileId);
    const rejected = await trash([folderSelection(folderBefore)]);
    const errorText = await rejected.text();
    assert.equal(rejected.status, 409, errorText);
    assert.ok(errorText.includes(fileName), `the blocker filename must be reported: ${errorText}`);
    assert.ok(errorText.includes(fileId), `the blocker UUID must be reported: ${errorText}`);
    const folderAfter = await folderRow(folderId), fileAfter = await fileRow(fileId);
    assert.equal(folderAfter.trashed_at, null);
    assert.equal(folderAfter.revision, folderBefore.revision);
    assert.equal(folderAfter.original_location_path, null);
    assert.equal(fileAfter.folder_id, folderId);
    assert.equal(fileAfter.trashed_at, null);
    assert.equal(fileAfter.metadata_revision, fileBefore.metadata_revision);
    assert.equal(fileAfter.original_location_path, null);
  }

  await savedDashboard(sql, profileA.id, (payload) => {
    payload.d.courseDetails = {};
    payload.d.syllabusDrafts = [];
  });
  const managed = (await sql("select * from public.file_folders where profile_id=$1 and kind='course' and course_id='history'", [profileA.id])).rows[0];
  const managedTrash = await trash([folderSelection(managed)]);
  assert.equal(managedTrash.status, 400, await managedTrash.clone().text());
  const managedAfter = await folderRow(managed.id);
  assert.equal(managedAfter.trashed_at, null);
  assert.equal(managedAfter.revision, managed.revision);
  assert.equal(managedAfter.name, "History");

  runtime.profile = profileB;
  const foreignFolderResponse = await createFolder(ID.foreignFolder, "Private to account B");
  assert.equal(foreignFolderResponse.status, 201, await foreignFolderResponse.clone().text());
  const foreignFileResponse = await createDocument(ID.native, "Private B document.txt", "B-only content", "history", "history-reading", ID.foreignFolder);
  assert.equal(foreignFileResponse.status, 201, await foreignFileResponse.clone().text());
  const foreignFolder = await folderRow(ID.foreignFolder, profileB.id);
  const foreignFile = await fileRow(ID.native, profileB.id);
  runtime.profile = profileA;
  const rejectedForeignFolder = await trash([folderSelection(foreignFolder)]);
  assert.equal(rejectedForeignFolder.status, 404, await rejectedForeignFolder.clone().text());
  const rejectedForeignFile = await trash([fileSelection(foreignFile)]);
  assert.equal(rejectedForeignFile.status, 404, await rejectedForeignFile.clone().text());
  assert.equal((await folderRow(ID.foreignFolder, profileB.id)).trashed_at, null);
  assert.equal((await fileRow(ID.native, profileB.id)).trashed_at, null);
});

test("restore falls back from deleted parents to one stable recovery root without merging duplicate names", async (t) => {
  const fixture = await setup();
  closeFixture(t, fixture);
  const { sql, profiles, folders, createFolder, createDocument, trash, restore, folderRow, fileRow } = fixture;
  const profile = profiles[USERS.a];
  const sameName = "Recovered notes.txt";

  assert.equal((await createFolder(ID.parent, "Original parent")).status, 201);
  assert.equal((await createFolder(ID.orphan, "Original child", ID.parent)).status, 201);
  const fileAResponse = await createDocument(ID.orphanFileA, sameName, "First copy", "history", "history-reading", ID.orphan);
  const fileBResponse = await createDocument(ID.orphanFileB, sameName, "Second copy", "history", "history-reading", ID.orphan);
  assert.equal(fileAResponse.status, 201, await fileAResponse.clone().text());
  assert.equal(fileBResponse.status, 201, await fileBResponse.clone().text());
  assert.equal((await createFolder(ID.recoveryCollision, "Restored files")).status, 201);
  const originalFileTrash = await trash([fileSelection(await fileRow(ID.orphanFileA)), fileSelection(await fileRow(ID.orphanFileB))]);
  assert.equal(originalFileTrash.status, 200, await originalFileTrash.clone().text());
  assert.equal((await fileRow(ID.orphanFileA)).original_location_path, "Original parent/Original child/Recovered notes.txt");
  // The child is empty after its files move to Trash. Simulate deletion of that
  // original parent so its composite FK is set null while the saved path remains.
  await sql("delete from public.file_folders where profile_id=$1 and id=$2", [profile.id, ID.orphan]);
  assert.equal((await fileRow(ID.orphanFileA)).original_folder_id, null);
  assert.equal((await fileRow(ID.orphanFileA)).original_location_path, "Original parent/Original child/Recovered notes.txt");
  assert.equal((await fileRow(ID.orphanFileA)).deleted_at, null);
  assert.equal((await fileRow(ID.orphanFileB)).deleted_at, null);

  const firstRestore = await restore([fileSelection(await fileRow(ID.orphanFileA))]);
  assert.equal(firstRestore.status, 200, await firstRestore.clone().text());
  const firstPayload = await firstRestore.json();
  const recoveryId = firstPayload.recoveryFolder?.id;
  assert.ok(recoveryId, "the restore response identifies the recovery folder");
  assert.notEqual(recoveryId, ID.recoveryCollision, "a same-name user folder is not mistaken for the recovery location");
  const recovery = await folderRow(recoveryId);
  assert.equal(recovery.name, "Restored files");
  assert.equal(recovery.parent_id, null);
  assert.equal((await fileRow(ID.orphanFileA)).folder_id, recoveryId);

  const secondRestore = await restore([fileSelection(await fileRow(ID.orphanFileB))]);
  assert.equal(secondRestore.status, 200, await secondRestore.clone().text());
  const secondPayload = await secondRestore.json();
  assert.equal(secondPayload.recoveryFolder.id, recoveryId, "successive fallbacks reuse the account's mapped root");
  const duplicateCount = await sql("select count(*)::int as count from public.user_files where profile_id=$1 and folder_id=$2 and name=$3 and deleted_at is null", [profile.id, recoveryId, sameName]);
  assert.equal(duplicateCount.rows[0].count, 2, "same-name files restore as two separate IDs");

  const destination = await createFolder(ID.destination, "Moved destination");
  assert.equal(destination.status, 201, await destination.clone().text());
  const renamed = await folders.PUT(fixture.apiRequest("/api/file-folders", "PUT", {
    id: recoveryId, action: "rename", name: "Recovered archive", revision: (await folderRow(recoveryId)).revision,
  }));
  assert.equal(renamed.status, 200, await renamed.clone().text());
  const moved = await folders.PUT(fixture.apiRequest("/api/file-folders", "PUT", {
    id: recoveryId, action: "move", parentId: ID.destination, revision: (await folderRow(recoveryId)).revision,
  }));
  assert.equal(moved.status, 200, await moved.clone().text());

  assert.equal((await createFolder(ID.secondParent, "Second original parent")).status, 201);
  assert.equal((await createFolder(ID.secondChild, "Second original child", ID.secondParent)).status, 201);
  const secondFileResponse = await createDocument(ID.secondFile, "Third notes.txt", "Third copy", "history", "history-reading", ID.secondChild);
  assert.equal(secondFileResponse.status, 201, await secondFileResponse.clone().text());
  assert.equal((await trash([fileSelection(await fileRow(ID.secondFile))])).status, 200);
  await sql("delete from public.file_folders where profile_id=$1 and id=$2", [profile.id, ID.secondChild]);
  assert.equal((await fileRow(ID.secondFile)).original_folder_id, null);
  const recreated = await restore([fileSelection(await fileRow(ID.secondFile))]);
  assert.equal(recreated.status, 200, await recreated.clone().text());
  const recreatedPayload = await recreated.json();
  assert.ok(recreatedPayload.recoveryFolder?.id);
  assert.notEqual(recreatedPayload.recoveryFolder.id, recoveryId, "renaming and moving the mapped folder creates a fresh root fallback");
  assert.equal(recreatedPayload.recoveryFolder.name, "Restored files");
  assert.equal(recreatedPayload.recoveryFolder.parent_id, null);
  assert.equal((await fileRow(ID.secondFile)).folder_id, recreatedPayload.recoveryFolder.id);
});

test("folder purge freezes a request manifest across partial storage failures and retries", async (t) => {
  const fixture = await setup();
  closeFixture(t, fixture);
  const { sql, profiles, runtime, createFolder, createDocument, upload, trash, restore, permanentDelete, folderRow, fileRow } = fixture;
  const profile = profiles[USERS.a];
  const requestId = "61616161-6161-4161-8161-616161616161";
  const objectAPath = `${profile.id}/${ID.purgeObjectA}`;
  const objectBPath = `${profile.id}/${ID.purgeObjectB}`;
  const objectBytes = Buffer.from([0, 1, 2, 3, 127, 254, 255]);

  assert.equal((await createFolder(ID.purgeRoot, "Purge tree")).status, 201);
  assert.equal((await createFolder(ID.purgeChild, "Purge child", ID.purgeRoot)).status, 201);
  assert.equal((await createDocument(ID.purgeNative, "Native notes.txt", "Purge me — Unicode ✓", "history", "history-reading", ID.purgeChild)).status, 201);
  assert.equal((await upload(ID.purgeObjectA, "Object A.bin", objectBytes, "", "", ID.purgeChild)).status, 201);
  assert.equal((await upload(ID.purgeObjectB, "Object B.bin", objectBytes, "", "", ID.purgeChild)).status, 201);
  assert.equal(runtime.objects.has(objectAPath), true);
  assert.equal(runtime.objects.has(objectBPath), true);
  assert.equal((await sql("select count(*)::int as count from public.native_file_documents where profile_id=$1 and file_id=$2", [profile.id, ID.purgeNative])).rows[0].count, 1);

  const trashed = await trash([folderSelection(await folderRow(ID.purgeRoot))]);
  assert.equal(trashed.status, 200, await trashed.clone().text());
  const selectedRoot = folderSelection(await folderRow(ID.purgeRoot));
  runtime.failedRemovePaths.add(objectAPath);
  const firstAttempt = await permanentDelete([selectedRoot], requestId);
  assert.equal(firstAttempt.status, 503, await firstAttempt.clone().text());
  assert.ok((await folderRow(ID.purgeRoot)).purge_pending_at);
  assert.equal((await fileRow(ID.purgeNative)).state, "deleting");
  assert.equal((await fileRow(ID.purgeObjectA)).state, "deleting");
  assert.equal(runtime.objects.has(objectAPath), true, "the deliberately failed first path remains stored");

  const pendingRoot = await folderRow(ID.purgeRoot), pendingFile = await fileRow(ID.purgeObjectA);
  const restoreFolder = await restore([folderSelection(pendingRoot)]);
  assert.notEqual(restoreFolder.status, 200, await restoreFolder.clone().text());
  const restoreFile = await restore([fileSelection(pendingFile)]);
  assert.notEqual(restoreFile.status, 200, await restoreFile.clone().text());
  assert.ok((await folderRow(ID.purgeRoot)).purge_pending_at);
  assert.equal((await fileRow(ID.purgeObjectA)).trashed_at !== null, true);

  // A later Trash operation must not enter the already frozen purge manifest.
  assert.equal((await createFolder(ID.laterFolder, "Later independent Trash")).status, 201);
  const laterUpload = await upload(ID.laterFile, "Later item.bin", objectBytes, "", "", ID.laterFolder);
  assert.equal(laterUpload.status, 201, await laterUpload.clone().text());
  const laterTrash = await trash([folderSelection(await folderRow(ID.laterFolder))]);
  assert.equal(laterTrash.status, 200, await laterTrash.clone().text());

  runtime.failedRemovePaths.delete(objectAPath);
  runtime.failedRemovePaths.add(objectBPath);
  const secondAttempt = await permanentDelete([selectedRoot], requestId);
  assert.equal(secondAttempt.status, 503, await secondAttempt.clone().text());
  const frozen = (await sql("select file_ids,folder_ids,completed_at from public.account_file_purge_manifests where profile_id=$1 and request_id=$2", [profile.id, requestId])).rows[0];
  assert.ok(frozen);
  assert.equal(frozen.completed_at, null);
  assert.deepEqual([...frozen.file_ids].sort(), [ID.purgeNative, ID.purgeObjectA, ID.purgeObjectB].sort());
  assert.deepEqual([...frozen.folder_ids].sort(), [ID.purgeRoot, ID.purgeChild].sort());
  assert.ok((await fileRow(ID.purgeNative)).deleted_at, "successfully cleaned rows become tombstones before the next path fails");
  assert.ok((await fileRow(ID.purgeObjectA)).deleted_at);
  assert.equal((await fileRow(ID.purgeObjectB)).deleted_at, null);
  assert.equal(runtime.objects.has(objectAPath), false);
  assert.equal(runtime.objects.has(objectBPath), true);
  assert.equal((await fileRow(ID.laterFile)).state, "ready");
  assert.equal((await fileRow(ID.laterFile)).deleted_at, null);
  assert.equal((await folderRow(ID.laterFolder)).deleted_at, null);
  assert.equal((await folderRow(ID.laterFolder)).purge_pending_at, null);
  assert.equal((await sql("select count(*)::int as count from public.account_file_purge_manifests where profile_id=$1 and request_id=$2 and $3=any(file_ids)", [profile.id, requestId, ID.laterFile])).rows[0].count, 0);

  runtime.failedRemovePaths.delete(objectBPath);
  const finalAttempt = await permanentDelete([selectedRoot], requestId);
  assert.equal(finalAttempt.status, 200, await finalAttempt.clone().text());
  const finalPayload = await finalAttempt.json();
  assert.equal(finalPayload.requestId, requestId);
  assert.deepEqual([...finalPayload.removed.files].sort(), [ID.purgeNative, ID.purgeObjectA, ID.purgeObjectB].sort());
  assert.deepEqual([...finalPayload.removed.folders].sort(), [ID.purgeRoot, ID.purgeChild].sort());
  for (const id of [ID.purgeNative, ID.purgeObjectA, ID.purgeObjectB]) assert.ok((await fileRow(id)).deleted_at);
  for (const id of [ID.purgeRoot, ID.purgeChild]) {
    assert.ok((await folderRow(id)).deleted_at);
    assert.equal((await folderRow(id)).purge_pending_at, null);
  }
  assert.equal(runtime.objects.has(objectAPath), false);
  assert.equal(runtime.objects.has(objectBPath), false);
  assert.equal((await sql("select count(*)::int as count from public.native_file_documents where profile_id=$1 and file_id=$2", [profile.id, ID.purgeNative])).rows[0].count, 0);
  assert.ok((await sql("select completed_at from public.account_file_purge_manifests where profile_id=$1 and request_id=$2", [profile.id, requestId])).rows[0].completed_at);

  const doneRetry = await permanentDelete([selectedRoot], requestId);
  assert.equal(doneRetry.status, 200, await doneRetry.clone().text());
  const donePayload = await doneRetry.json();
  assert.deepEqual([...donePayload.removed.files].sort(), [ID.purgeNative, ID.purgeObjectA, ID.purgeObjectB].sort());
  assert.deepEqual([...donePayload.removed.folders].sort(), [ID.purgeRoot, ID.purgeChild].sort());
  assert.equal(donePayload.files.length, 0, "completed rows do not repeat physical storage cleanup");
});

test("Empty Trash purges every trashed subtree and standalone item while preserving active files", async (t) => {
  const fixture = await setup();
  closeFixture(t, fixture);
  const { sql, profiles, runtime, folders, filesApi, createFolder, createDocument, upload, trash, restore, emptyTrash, folderRow, fileRow } = fixture;
  const profile = profiles[USERS.a];
  const requestId = "71717171-7171-4171-8171-717171717171";
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7]);

  assert.equal((await createFolder(ID.root, "Trash me")).status, 201);
  assert.equal((await createFolder(ID.child, "Trash child", ID.root)).status, 201);
  assert.equal((await createDocument(ID.native, "Notes.txt", "Native body to purge — ✓", "history", "history-reading", ID.child)).status, 201);
  assert.equal((await upload(ID.image, "Image.png", bytes, "history", "history-reading", ID.child)).status, 201);
  assert.equal((await createFolder(ID.independentFolder, "Independent folder")).status, 201);
  assert.equal((await createDocument(ID.independentFile, "Independent.txt", "Standalone trashed document", "biology", "biology-lab", null)).status, 201);
  assert.equal((await createFolder(ID.activeFolder, "Keep active")).status, 201);
  assert.equal((await upload(ID.activeFile, "Keep active.png", bytes, "biology", "biology-lab", ID.activeFolder)).status, 201);
  const activeObjectPath = `${profile.id}/${ID.activeFile}`;
  assert.equal(runtime.objects.has(activeObjectPath), true);

  const subtreeTrash = await trash([folderSelection(await folderRow(ID.root))]);
  assert.equal(subtreeTrash.status, 200, await subtreeTrash.clone().text());
  const independentTrash = await trash([
    fileSelection(await fileRow(ID.independentFile)),
    folderSelection(await folderRow(ID.independentFolder)),
  ]);
  assert.equal(independentTrash.status, 200, await independentTrash.clone().text());
  assert.ok((await sql("select body from public.native_file_documents where profile_id=$1 and file_id=$2", [profile.id, ID.native])).rows[0].body);

  const emptied = await emptyTrash(requestId);
  assert.equal(emptied.status, 200, await emptied.clone().text());
  const result = await emptied.json();
  assert.equal(result.requestId, requestId);
  assert.deepEqual([...result.removed.files].sort(), [ID.native, ID.image, ID.independentFile].sort());
  assert.deepEqual([...result.removed.folders].sort(), [ID.root, ID.child, ID.independentFolder].sort());
  for (const id of [ID.native, ID.image, ID.independentFile]) assert.ok((await fileRow(id)).deleted_at);
  for (const id of [ID.root, ID.child, ID.independentFolder]) {
    assert.ok((await folderRow(id)).deleted_at);
    assert.equal((await folderRow(id)).purge_pending_at, null);
  }
  assert.equal((await sql("select count(*)::int as count from public.native_file_documents where profile_id=$1 and file_id=$2", [profile.id, ID.native])).rows[0].count, 0);
  assert.equal(runtime.objects.has(`${profile.id}/${ID.image}`), false);
  assert.equal(runtime.objects.has(activeObjectPath), true);
  assert.equal((await fileRow(ID.activeFile)).trashed_at, null);
  assert.equal((await fileRow(ID.activeFile)).deleted_at, null);
  assert.equal((await folderRow(ID.activeFolder)).trashed_at, null);
  assert.equal((await folderRow(ID.activeFolder)).deleted_at, null);

  for (const response of [
    await restore([fileSelection(await fileRow(ID.native))]),
    await restore([folderSelection(await folderRow(ID.root))]),
  ]) assert.notEqual(response.status, 200, await response.clone().text());
  const recreateFolder = await createFolder(ID.root, "Trash me");
  assert.notEqual(recreateFolder.status, 201, await recreateFolder.clone().text());
  const recreateFile = await createDocument(ID.native, "Notes.txt", "Do not reuse this tombstone", "history", "history-reading", null);
  assert.notEqual(recreateFile.status, 201, await recreateFile.clone().text());

  const trashFiles = await filesApi.GET(fixture.apiRequest("/api/files?view=trash"));
  assert.equal(trashFiles.status, 200, await trashFiles.clone().text());
  const visibleTrashedFileIds = (await trashFiles.json()).files.map((row) => row.id);
  for (const id of result.removed.files) assert.equal(visibleTrashedFileIds.includes(id), false);
  const trashFolders = await folders.GET(fixture.apiRequest("/api/file-folders?view=trash"));
  assert.equal(trashFolders.status, 200, await trashFolders.clone().text());
  const visibleTrashedFolderIds = (await trashFolders.json()).folders.map((row) => row.id);
  for (const id of result.removed.folders) assert.equal(visibleTrashedFolderIds.includes(id), false);
});

test("recursive Trash migration installs guarded cascade-owned tables without optional AI migrations", async (t) => {
  const fixture = await setup({ withAi: false });
  closeFixture(t, fixture);
  const { sql } = fixture;
  assert.equal((await sql("select to_regclass('public.ai_sources') as relation")).rows[0].relation, null);

  const relations = ["public.account_file_recovery_folders", "public.account_file_purge_manifests"];
  for (const relation of relations) {
    const access = (await sql(`select c.relrowsecurity as rls,
      has_table_privilege('anon',$1,'select') as anon_select,
      has_table_privilege('authenticated',$1,'select') as authenticated_select,
      has_table_privilege('service_role',$1,'select') as service_select
      from pg_class c where c.oid=$1::regclass`, [relation])).rows[0];
    assert.deepEqual(access, { rls: true, anon_select: false, authenticated_select: false, service_select: false });
    const profileCascade = await sql(`select count(*)::int as count from pg_constraint
      where conrelid=$1::regclass and contype='f' and confrelid='public.app_profiles'::regclass and confdeltype='c'`, [relation]);
    assert.equal(profileCascade.rows[0].count, 1, `${relation} is removed with its owning profile`);
  }

  for (const signature of [
    "public.mutate_account_files_action(uuid,uuid,text,jsonb,uuid,boolean)",
    "public.mutate_account_file_tree_action(uuid,uuid,text,jsonb,uuid,boolean)",
    "public.begin_account_file_purge(uuid,uuid,uuid,jsonb,boolean)",
    "public.finalize_account_file_purge(uuid,uuid,uuid)",
  ]) {
    const grants = (await sql(`select has_function_privilege('anon',$1,'execute') as anon_exec,
      has_function_privilege('authenticated',$1,'execute') as authenticated_exec,
      has_function_privilege('service_role',$1,'execute') as service_exec`, [signature])).rows[0];
    assert.deepEqual(grants, { anon_exec: false, authenticated_exec: false, service_exec: true }, signature);
  }
});

test("recursive Trash preserves AI opt-out and fences a pre-Trash indexing lease", async (t) => {
  const fixture = await setup();
  closeFixture(t, fixture);
  const { sql, profiles, createFolder, createDocument, trash, restore, folderRow, fileRow } = fixture;
  const profile = profiles[USERS.a];
  const oldLease = "81818181-8181-4181-8181-818181818181";
  assert.ok((await sql("select to_regclass('public.ai_sources') as relation")).rows[0].relation, "the full fixture includes the optional AI schema");

  assert.equal((await createFolder(ID.root, "AI source folder")).status, 201);
  const created = await createDocument(ID.native, "AI source.txt", "Searchable text for a stale job", "history", "history-reading", ID.root);
  assert.equal(created.status, 201, await created.clone().text());
  const source = (await sql("select * from public.ai_sources where profile_id=$1 and file_id=$2", [profile.id, ID.native])).rows[0];
  assert.ok(source);
  await sql("update public.ai_sources set enabled=false,state='processing',lease_id=$3,lease_until=clock_timestamp()+interval '5 minutes' where profile_id=$1 and id=$2", [profile.id, source.id, oldLease]);
  await sql("insert into public.ai_chunks(profile_id,source_id,version,ordinal,page,body) values($1,$2,$3,0,1,'Old source chunk')", [profile.id, source.id, source.version]);

  const trashed = await trash([folderSelection(await folderRow(ID.root))]);
  assert.equal(trashed.status, 200, await trashed.clone().text());
  const unavailable = (await sql("select * from public.ai_sources where profile_id=$1 and id=$2", [profile.id, source.id])).rows[0];
  assert.equal(unavailable.file_available, false);
  assert.equal(unavailable.enabled, false);
  assert.equal(unavailable.state, "queued");
  assert.equal(unavailable.lease_id, null);
  assert.equal((await sql("select count(*)::int as count from public.ai_chunks where profile_id=$1 and source_id=$2", [profile.id, source.id])).rows[0].count, 0);
  assert.equal((await sql("select public.ai_publish_source($1,$2,$3,$4,'[]'::jsonb) as accepted", [profile.id, source.id, source.version, oldLease])).rows[0].accepted, false);
  assert.equal((await sql("select public.ai_claim_source(array[$1]::uuid[],false) as claim", [profile.id])).rows[0].claim, null);

  const restored = await restore([folderSelection(await folderRow(ID.root))]);
  assert.equal(restored.status, 200, await restored.clone().text());
  const availableAgain = (await sql("select * from public.ai_sources where profile_id=$1 and id=$2", [profile.id, source.id])).rows[0];
  assert.equal(availableAgain.file_available, true);
  assert.equal(availableAgain.enabled, false, "restoring a file keeps the account's AI exclusion preference");
  assert.equal(availableAgain.state, "queued");
  assert.equal(availableAgain.lease_id, null);
  assert.equal((await fileRow(ID.native)).trashed_at, null);
});
