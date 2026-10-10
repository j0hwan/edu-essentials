import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const AUTH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID = {
  archivedRoot: "10101010-1010-4010-8010-101010101010",
  archivedChild: "12121212-1212-4121-8121-121212121212",
  trashFolder: "13131313-1313-4131-8131-131313131313",
  pendingFolder: "14141414-1414-4141-8141-141414141414",
  ordinaryDocument: "15151515-1515-4151-8151-151515151515",
  firstPurgeRequest: "16161616-1616-4161-8161-161616161616",
  retryPurgeRequest: "17171717-1717-4171-8171-171717171717",
};
const course = {
  id: "history", code: "HIST 205", name: "History", credits: 3, instructor: "Dr. Stone", room: "Hall 2",
  color: "#224466", soft_color: "#22446618", initials: "HI",
};
const originalSyllabus = "Original syllabus: résumé — Unicode ✓\nExam one remains on October 15.";
const dashboard = {
  v: 2, a: "day", w: [], t: [], n: "",
  d: {
    assignments: [{ id: "history-reading", courseId: "history", title: "Read chapter", dateKey: "2026-10-09", due: "", type: "Assignment", status: "later", progress: 0 }],
    manualEvents: [],
    courseDetails: { history: { officeHours: "Friday", meetings: [], syllabusText: originalSyllabus, syllabusName: "Fall guide" } },
    syllabusDrafts: [],
  },
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
  const pg = withAi ? new PGlite({ extensions: { vector } }) : new PGlite();
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
  for (const [key, authId] of [["a", AUTH_A], ["b", AUTH_B]]) {
    await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [authId]);
    profiles[key] = (await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [authId])).rows[0];
  }
  await sql("select initialize_account_workspace($1,$2,$3)", [profiles.a.id, JSON.stringify([course]), JSON.stringify(dashboard)]);
  await sql("select initialize_account_workspace($1,$2,$3)", [profiles.b.id, "[]", JSON.stringify({ v: 2, a: "day", w: [], t: [], n: "", d: {} })]);

  for (const file of migrationFiles.slice(2)) {
    if (!withAi && (file.startsWith("20260918") || file === "20261008030000_file_content_ai.sql")) continue;
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const runtime = { profile: profiles.a, failNextFinalize: false, fromCalls: 0 };
  const admin = {
    async rpc(name, args) {
      if (name === "finalize_account_file_purge" && runtime.failNextFinalize) {
        runtime.failNextFinalize = false;
        return { data: null, error: { code: "XX000", message: "Injected finalization failure" } };
      }
      const calls = {
        read_account_file_browser: () => sql("select public.read_account_file_browser($1,$2) as data", [args.p_profile_id, args.p_auth_user_id]),
        mutate_account_folder: () => sql("select public.mutate_account_folder($1,$2,$3,$4,$5,$6::jsonb) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_operation, args.p_folder_id ?? null,
          args.p_expected_revision ?? null, JSON.stringify(args.p_metadata ?? {}),
        ]),
        mutate_account_files_action: () => sql("select public.mutate_account_files_action($1,$2,$3,$4::jsonb,$5,$6) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_action, JSON.stringify(args.p_items),
          args.p_destination_id ?? null, args.p_destination_provided ?? false,
        ]),
        begin_account_file_purge: () => sql("select public.begin_account_file_purge($1,$2,$3,$4::jsonb,$5) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_request_id, JSON.stringify(args.p_items), args.p_empty ?? false,
        ]),
        finalize_account_file_purge: () => sql("select public.finalize_account_file_purge($1,$2,$3) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_request_id,
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
    from() { runtime.fromCalls += 1; throw new Error("File-folder GET must use the account snapshot RPC."); },
    storage: { from() { throw new Error("Unexpected storage access for empty-folder purge."); } },
  };
  globalThis.__fileReleaseIntegrityTest = { runtime, admin };

  const auth = moduleUrl(`
    export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
    export const requireProfile = async () => globalThis.__fileReleaseIntegrityTest.runtime.profile;
    export function requireSameOrigin(request) {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new AuthError("Wrong origin.", 403);
    }
    export function apiError(error) {
      return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "no-store" } });
    }
  `);
  const db = moduleUrl("export const getSupabaseAdmin = () => globalThis.__fileReleaseIntegrityTest.admin;");
  const files = await compile("lib/files.ts");
  const organization = await compile("lib/file-organization.ts");
  const persistence = await compile("lib/persistence-request.ts");
  const helper = await compile("lib/private-files-server.ts", {
    "./auth": auth, "./supabase-server": db, "./persistence-request": persistence, "./files": files,
  });
  const folders = await import(await compile("app/api/file-folders/route.ts", {
    "../../../lib/private-files-server": helper,
    "../../../lib/files": files,
    "../../../lib/persistence-request": persistence,
    "../../../lib/file-organization": organization,
    "../../../lib/supabase-server": db,
  }));
  const actions = await import(await compile("app/api/files/actions/route.ts", {
    "../../../../lib/private-files-server": helper,
    "../../../../lib/files": files,
    "../../../../lib/persistence-request": persistence,
    "../../../../lib/file-organization": organization,
    "../../../../lib/supabase-server": db,
  }));

  const apiRequest = (path, method = "GET", body) => new Request(`https://edu.example${path}`, {
    method,
    headers: { origin: "https://edu.example", "x-profile-id": runtime.profile.id, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const courseFolder = (await sql("select * from public.file_folders where profile_id=$1 and kind='course' and course_id='history'", [profiles.a.id])).rows[0];
  return { pg, sql, profiles, runtime, folders, actions, apiRequest, courseFolder };
}

test("account folder snapshots include rows beyond PostgREST caps and classify archived ancestors", async (t) => {
  const fixture = await setup({ withAi: false });
  const { pg, sql, profiles, runtime, folders, apiRequest, courseFolder } = fixture;
  t.after(async () => { delete globalThis.__fileReleaseIntegrityTest; await pg.close(); });
  const profileId = profiles.a.id;
  await sql(`
    insert into public.file_folders(profile_id,id,name,archived_at,semester_label)
      values ($1,$2,'z archived root',now(),'Fall 2026');
  `, [profileId, ID.archivedRoot]);
  await sql(`
    insert into public.file_folders(profile_id,id,parent_id,name)
      values ($1,$3,$2,'000 archived descendant');
  `, [profileId, ID.archivedRoot, ID.archivedChild]);
  await sql(`
    insert into public.file_folders(profile_id,id,name)
      values ($1,$2,'Trash folder');
  `, [profileId, ID.trashFolder]);
  await sql(`
    insert into public.file_folders(profile_id,id,name)
      values ($1,$2,'Pending Trash folder');
  `, [profileId, ID.pendingFolder]);
  await sql(`
    insert into public.file_folders(profile_id,id,name)
      select $1,gen_random_uuid(),'a filler ' || lpad(series::text,4,'0') from generate_series(1,1001) series;
  `, [profileId]);
  await sql(`
    insert into public.file_folders(profile_id,name)
      values ($1,'Foreign folder');
  `, [profiles.b.id]);
  await sql(`
    insert into public.folder_activity(profile_id,folder_id,starred_at)
      select folder.profile_id,folder.id,now() from public.file_folders folder
       where folder.profile_id in ($1,$2);
  `, [profileId, profiles.b.id]);
  for (const id of [ID.trashFolder, ID.pendingFolder]) {
    const row = (await sql("select revision from public.file_folders where profile_id=$1 and id=$2", [profileId, id])).rows[0];
    await sql("select public.mutate_account_folder($1,$2,'trash',$3,$4,'{}'::jsonb)", [profileId, AUTH_A, id, Number(row.revision)]);
  }
  const pendingRevision = (await sql("select revision from public.file_folders where profile_id=$1 and id=$2", [profileId, ID.pendingFolder])).rows[0].revision;
  await sql("select public.begin_account_file_purge($1,$2,$3,$4::jsonb,false)", [
    profileId, AUTH_A, ID.firstPurgeRequest,
    JSON.stringify([{ type: "folder", id: ID.pendingFolder, revision: Number(pendingRevision) }]),
  ]);

  const grants = (await sql(`select
    has_function_privilege('service_role','public.read_account_file_browser(uuid,uuid)','execute') as service_exec,
    has_function_privilege('anon','public.read_account_file_browser(uuid,uuid)','execute') as anon_exec,
    has_function_privilege('authenticated','public.read_account_file_browser(uuid,uuid)','execute') as authenticated_exec`)).rows[0];
  assert.deepEqual(grants, { service_exec: true, anon_exec: false, authenticated_exec: false });
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    try {
      await assert.rejects(sql("select public.read_account_file_browser($1,$2)", [profileId, AUTH_A]), { code: "42501" });
    } finally { await pg.exec("reset role"); }
  }
  await pg.exec("set role service_role");
  try {
    await assert.rejects(sql("select public.read_account_file_browser($1,$2)", [profileId, AUTH_B]), { code: "42501" }, "the RPC checks profile ownership even for service-role callers");
  } finally { await pg.exec("reset role"); }

  const activeResponse = await folders.GET(apiRequest("/api/file-folders?view=active"));
  assert.equal(activeResponse.status, 200, await activeResponse.clone().text());
  const active = await activeResponse.json();
  assert.ok(active.folders.length > 1000, "the full folder set is returned beyond PostgREST's default 1,000-row cap");
  assert.ok(active.folders.some((folder) => folder.id === courseFolder.id));
  assert.ok(!active.folders.some((folder) => folder.id === ID.archivedRoot || folder.id === ID.archivedChild));
  assert.ok(!active.folders.some((folder) => folder.id === ID.pendingFolder));
  assert.ok(!active.folders.some((folder) => folder.name === "Foreign folder"));
  assert.ok(active.activities.folders.length > 1000);
  assert.equal(active.activities.folders.length, active.folders.length + 4,
    "activity returns the complete account snapshot, including archived and trashed rows excluded from this view");
  assert.doesNotMatch(JSON.stringify(active), /"profile_id"/);

  const archives = await (await folders.GET(apiRequest("/api/file-folders?view=archives"))).json();
  assert.deepEqual(new Set(archives.folders.map((folder) => folder.id)), new Set([ID.archivedRoot, ID.archivedChild]));
  const trash = await (await folders.GET(apiRequest("/api/file-folders?view=trash"))).json();
  assert.ok(trash.folders.some((folder) => folder.id === ID.trashFolder));
  assert.ok(trash.folders.some((folder) => folder.id === ID.pendingFolder));
  assert.ok(!trash.folders.some((folder) => folder.name === "Foreign folder"));
  assert.equal(runtime.fromCalls, 0, "the route uses the single account snapshot RPC instead of PostgREST table reads");
});

async function assertArchivedSyllabusRelease({ withAi }) {
  const fixture = await setup({ withAi });
  const { pg, sql, profiles, courseFolder } = fixture;
  try {
    const profileId = profiles.a.id;
    const savedRevision = async () => (await sql("select updated_at from public.dashboard_state where profile_id=$1", [profileId])).rows[0].updated_at;
    const savedDashboard = async () => (await sql("select payload from public.dashboard_state where profile_id=$1", [profileId])).rows[0].payload;
    const save = async (payload) => sql("select public.save_account_workspace($1,$2,$3,$4,$5)", [
      profileId, AUTH_A, await savedRevision(), JSON.stringify([course]), JSON.stringify(payload),
    ]);
    const ordinary = await sql("select public.mutate_account_document($1,$2,$3,'create',null,$4::jsonb) as data", [
      profileId, AUTH_A, ID.ordinaryDocument,
      JSON.stringify({ name: "Ordinary.txt", body: "ordinary user content", folderId: courseFolder.id }),
    ]);
    assert.equal(ordinary.rows[0].data.file.folder_id, courseFolder.id);

    const archive = await sql("select public.mutate_account_folder($1,$2,'archive',$3,$4,$5::jsonb) as data", [
      profileId, AUTH_A, courseFolder.id, Number(courseFolder.revision), JSON.stringify({ semesterLabel: "Fall 2026" }),
    ]);
    assert.equal(archive.rows[0].data.archived_at != null, true);

    await assert.rejects(sql("select public.mutate_account_document($1,$2,$3,'create',null,$4::jsonb)", [
      profileId, AUTH_A, "18181818-1818-4818-8818-181818181818",
      JSON.stringify({ name: "Blocked.txt", body: "must remain blocked", folderId: courseFolder.id }),
    ]), { code: "23514" }, "ordinary document creation stays blocked in an archived folder");
    await assert.rejects(sql("select public.mutate_account_document($1,$2,$3,'update_content',1,$4::jsonb)", [
      profileId, AUTH_A, ID.ordinaryDocument, JSON.stringify({ body: "ordinary edit must remain blocked" }),
    ]), { code: "23514" }, "ordinary document edits stay blocked in an archived folder");

    if (withAi) {
      await sql("update public.ai_sources set enabled=false where profile_id=$1 and source_key='syllabus:history'", [profileId]);
    }
    const revisedText = "Revised syllabus: new class schedule — 10/12.";
    const beforeReplace = await savedDashboard();
    await save({ ...beforeReplace, d: { ...beforeReplace.d, courseDetails: {
      ...beforeReplace.d.courseDetails, history: { ...beforeReplace.d.courseDetails.history, syllabusText: revisedText },
    } } });
    assert.equal((await savedDashboard()).d.courseDetails.history.syllabusText, revisedText);

    const clearBase = await savedDashboard();
    await save({ ...clearBase, d: { ...clearBase.d, courseDetails: {
      ...clearBase.d.courseDetails, history: { ...clearBase.d.courseDetails.history, syllabusText: "" },
    } } });
    assert.equal((await savedDashboard()).d.courseDetails.history.syllabusText, "");

    const preserved = (await sql(`
      select file_row.id, file_row.folder_id, document_row.body, file_row.name
        from public.user_files file_row
        join public.native_file_documents document_row
          on document_row.profile_id=file_row.profile_id and document_row.file_id=file_row.id
       where file_row.profile_id=$1 and file_row.kind='syllabus'
       order by document_row.created_at, file_row.id
    `, [profileId])).rows;
    assert.deepEqual(preserved.map((row) => row.body).sort(), [originalSyllabus, revisedText].sort());
    assert.ok(preserved.every((row) => row.folder_id === courseFolder.id));
    assert.equal((await sql("select archived_at is not null as archived, semester_label from public.file_folders where profile_id=$1 and id=$2", [profileId, courseFolder.id])).rows[0].archived, true);
    const persisted = await savedDashboard();
    assert.deepEqual(persisted.d.assignments, dashboard.d.assignments, "course assignments survive the replacement and clear saves");
    assert.equal((await sql("select id from public.courses where profile_id=$1 and id='history'", [profileId])).rows.length, 1);

    if (withAi) {
      for (const row of preserved) {
        const source = (await sql("select enabled from public.ai_sources where profile_id=$1 and source_key=$2", [profileId, `file:${row.id}`])).rows[0];
        assert.equal(source?.enabled, false, "the archived syllabus copy keeps its synthetic AI source preference");
      }
    } else {
      assert.equal((await sql("select to_regclass('public.ai_sources') as relation")).rows[0].relation, null,
        "preservation also works when optional AI migrations are absent");
    }

    const latest = await savedDashboard();
    const latestRevision = await savedRevision();
    const nextText = "A third syllabus used to verify the file limit.";
    await save({ ...latest, d: { ...latest.d, courseDetails: {
      ...latest.d.courseDetails, history: { ...latest.d.courseDetails.history, syllabusText: nextText },
    } } });
    const atCapacity = await savedDashboard();
    const atCapacityRevision = await savedRevision();
    const currentCount = (await sql("select count(*)::int as count from public.user_files where profile_id=$1 and deleted_at is null", [profileId])).rows[0].count;
    assert.ok(currentCount < 1000);
    await sql(`
      with account as (select $1::uuid as profile_id), generated as (select gen_random_uuid() as id from generate_series(1,$2::int))
      insert into public.user_files(profile_id,id,kind,name,mime_type,size_bytes,object_path)
      select account.profile_id,generated.id,'resource','Capacity fixture','text/plain',0,
        account.profile_id::text || '/' || generated.id::text from account cross join generated
    `, [profileId, 1000 - currentCount]);
    await assert.rejects(save({ ...atCapacity, d: { ...atCapacity.d, courseDetails: {
      ...atCapacity.d.courseDetails, history: { ...atCapacity.d.courseDetails.history, syllabusText: "Capacity must reject this save." },
    } } }), /PRESERVE_SYLLABUS_REPLACEMENT: account file limit of 1000 reached/);
    assert.equal(await savedRevision(), atCapacityRevision, "a full-account rollback leaves the workspace revision unchanged");
    assert.equal((await savedDashboard()).d.courseDetails.history.syllabusText, nextText);
    assert.equal((await sql("select count(*)::int as count from public.user_files where profile_id=$1 and deleted_at is null", [profileId])).rows[0].count, 1000);
    assert.equal((await sql("select count(*)::int as count from public.native_file_documents document_row join public.user_files file_row on file_row.profile_id=document_row.profile_id and file_row.id=document_row.file_id where file_row.profile_id=$1 and file_row.kind='syllabus'", [profileId])).rows[0].count, 2,
      "the rejected capacity write does not create a partial preserved copy");
    assert.notEqual(atCapacityRevision, latestRevision);
  } finally {
    delete globalThis.__fileReleaseIntegrityTest;
    await pg.close();
  }
}

test("archived course syllabus replacement and clear preserve content and rollback at capacity (with AI)", async () => {
  await assertArchivedSyllabusRelease({ withAi: true });
});

test("archived course syllabus replacement and clear preserve content and rollback at capacity (without AI)", async () => {
  await assertArchivedSyllabusRelease({ withAi: false });
});

test("a pending folder stays visible in Trash and a new purge request can finish finalization", async (t) => {
  const fixture = await setup({ withAi: false });
  const { pg, sql, profiles, runtime, folders, actions, apiRequest } = fixture;
  t.after(async () => { delete globalThis.__fileReleaseIntegrityTest; await pg.close(); });
  const profileId = profiles.a.id;
  await sql("insert into public.file_folders(profile_id,id,name) values ($1,$2,'Empty folder')", [profileId, ID.pendingFolder]);
  const initial = (await sql("select revision from public.file_folders where profile_id=$1 and id=$2", [profileId, ID.pendingFolder])).rows[0];
  await sql("select public.mutate_account_folder($1,$2,'trash',$3,$4,'{}'::jsonb)", [profileId, AUTH_A, ID.pendingFolder, Number(initial.revision)]);
  const trashed = (await sql("select revision from public.file_folders where profile_id=$1 and id=$2", [profileId, ID.pendingFolder])).rows[0];

  runtime.failNextFinalize = true;
  const failed = await actions.POST(apiRequest("/api/files/actions", "POST", {
    action: "permanent-delete", requestId: ID.firstPurgeRequest,
    items: [{ type: "folder", id: ID.pendingFolder, revision: Number(trashed.revision) }],
  }));
  assert.equal(failed.status, 503, await failed.clone().text());
  assert.equal((await sql("select purge_pending_at is not null as pending, deleted_at from public.file_folders where profile_id=$1 and id=$2", [profileId, ID.pendingFolder])).rows[0].pending, true);

  const active = await (await folders.GET(apiRequest("/api/file-folders?view=active"))).json();
  const trash = await (await folders.GET(apiRequest("/api/file-folders?view=trash"))).json();
  assert.ok(!active.folders.some((folder) => folder.id === ID.pendingFolder));
  const visiblePending = trash.folders.find((folder) => folder.id === ID.pendingFolder && folder.purge_pending_at != null);
  assert.ok(visiblePending,
    "a reload can find the folder again in Trash after the finalization step fails");

  const retried = await actions.POST(apiRequest("/api/files/actions", "POST", {
    action: "permanent-delete", requestId: ID.retryPurgeRequest,
    items: [{ type: "folder", id: ID.pendingFolder, revision: Number(visiblePending.revision) }],
  }));
  assert.equal(retried.status, 200, await retried.clone().text());
  const retained = (await sql("select deleted_at,purge_pending_at from public.file_folders where profile_id=$1 and id=$2", [profileId, ID.pendingFolder])).rows[0];
  assert.ok(retained.deleted_at);
  assert.equal(retained.purge_pending_at, null);
  assert.equal((await sql("select completed_at is not null as completed from public.account_file_purge_manifests where profile_id=$1 and request_id=$2", [profileId, ID.retryPurgeRequest])).rows[0].completed, true);
  assert.ok(!(await (await folders.GET(apiRequest("/api/file-folders?view=trash"))).json()).folders.some((folder) => folder.id === ID.pendingFolder),
    "completed folder purges disappear from the visible Trash snapshot");
});
