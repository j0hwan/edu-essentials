import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FILE = {
  uploaded: "11111111-1111-4111-8111-111111111111",
  inactive: "22222222-2222-4222-8222-222222222222",
  replacement: "55555555-5555-4555-8555-555555555555",
  customChild: "44444444-4444-4444-8444-444444444444",
};

const course = (id = "history", name = "History") => ({
  id, code: "HIST 205", name, credits: 3, instructor: "Dr. Stone", room: "Hall 2",
  color: "#224466", soft_color: "#22446618", initials: "HI",
});
const dashboard = (courseDetails = {}, syllabusDrafts = []) => ({
  v: 2, a: "day", w: [], t: [], n: "", d: { assignments: [], manualEvents: [], courseDetails, syllabusDrafts },
});
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sqlMigrations = [
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

async function setup({ withAi = true } = {}) {
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
  await pg.exec(await readFile(new URL(`../supabase/migrations/${sqlMigrations[0]}`, import.meta.url), "utf8"));
  await pg.exec(await readFile(new URL(`../supabase/migrations/${sqlMigrations[1]}`, import.meta.url), "utf8"));

  const profileFor = async (authId) => {
    await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [authId]);
    return (await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [authId])).rows[0];
  };
  const a = await profileFor(USER_A);
  const b = await profileFor(USER_B);
  const coursesA = [course()];
  const coursesB = [course()];
  const initialA = dashboard({
    history: { officeHours: "Friday by appointment", meetings: [{ id: "meeting-a", days: [2, 4], start: "09:30", end: "10:45", from: "2026-09-01", until: "2026-12-15", location: "Hall 2" }], syllabusText: "Syllabus A: résumé — Unicode ✓\nExam 1: 2026-10-15", syllabusName: "Fall 2026 syllabus" },
  });
  const initialB = dashboard({ history: {
    officeHours: "Wednesday after class",
    meetings: [{ id: "meeting-b", days: [1, 3], start: "13:00", end: "14:00", from: "2026-09-01", until: "2026-12-15", location: "Room 7" }],
  } });
  await sql("select initialize_account_workspace($1, $2, $3)", [a.id, JSON.stringify(coursesA), JSON.stringify(initialA)]);
  await sql("select initialize_account_workspace($1, $2, $3)", [b.id, JSON.stringify(coursesB), JSON.stringify(initialB)]);

  for (const file of sqlMigrations.slice(2)) {
    if (!withAi && (file.startsWith("20260918") || file === "20261008030000_file_content_ai.sql")) continue;
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const revision = async (profile) => (await sql("select updated_at from dashboard_state where profile_id=$1", [profile])).rows[0].updated_at;
  const currentCourses = async (profile) => (await sql("select id,code,name,credits,instructor,room,color,soft_color,initials from courses where profile_id=$1 order by id", [profile])).rows;
  const payload = async (profile) => (await sql("select payload from dashboard_state where profile_id=$1", [profile])).rows[0].payload;
  const save = async (profile, authId, nextDashboard, baseRevision, nextCourses) => {
    baseRevision ??= await revision(profile);
    nextCourses ??= await currentCourses(profile);
    return sql("select save_account_workspace($1,$2,$3,$4,$5) as revision",
      [profile, authId, baseRevision, JSON.stringify(nextCourses), JSON.stringify(nextDashboard)]);
  };
  const upload = async (profile, authId, id, body, folderId = null) => {
    const bytes = Buffer.from(body);
    const metadata = { name: "Source — schedule.txt", mime: "text/plain", size: bytes.byteLength,
      sha256: digest(bytes), kind: "syllabus", courseId: "history", assignmentId: "", ...(folderId ? { folderId } : {}) };
    await sql("select mutate_account_file($1,$2,$3,'reserve',null,$4)", [profile, authId, id, JSON.stringify(metadata)]);
    await sql("select mutate_account_file($1,$2,$3,'ready')", [profile, authId, id]);
    await sql("insert into storage.objects(bucket_id,name,body) values('eduessentials-private',$1,$2)", [`${profile}/${id}`, bytes]);
  };
  const batchTrash = async (profile, authId, id) => {
    const row = await sql("select metadata_revision from user_files where profile_id=$1 and id=$2", [profile, id]);
    return sql("select mutate_account_files_action($1,$2,'trash',$3,null,false)", [
      profile, authId, JSON.stringify([{ type: "file", id, revision: Number(row.rows[0].metadata_revision) }]),
    ]);
  };
  const fileMetadata = async (profile, id) => (await sql(
    "select id,course_id,assignment_id,kind,name,mime_type,size_bytes,object_path,content_sha256,content_backend,folder_id from user_files where profile_id=$1 and id=$2",
    [profile, id],
  )).rows[0];
  const nativeBodies = async (profile) => (await sql(`
    select f.id, f.name, f.size_bytes, f.content_sha256, f.content_backend, f.kind, f.course_id, f.folder_id, d.body
      from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id
     where f.profile_id=$1 and f.kind='syllabus' order by d.created_at, f.id
  `, [profile])).rows;
  return { pg, sql, a, b, coursesA, coursesB, initialA, initialB, revision, currentCourses, payload, save, upload, batchTrash, fileMetadata, nativeBodies };
}

test("adding a first pasted syllabus preserves existing schedule details without making replacement history", async (t) => {
  const fixture = await setup();
  const { pg, b, payload, save, nativeBodies } = fixture;
  t.after(() => pg.close());

  const before = (await payload(b.id)).d.courseDetails.history;
  assert.equal(Object.hasOwn(before, "syllabusText"), false);
  const withSyllabus = dashboard({
    history: { ...before, syllabusText: "First syllabus for this class", syllabusName: "Course outline" },
  });
  await save(b.id, USER_B, withSyllabus);

  const saved = (await payload(b.id)).d.courseDetails.history;
  assert.equal(saved.syllabusText, "First syllabus for this class");
  assert.equal(saved.officeHours, before.officeHours);
  assert.deepEqual(saved.meetings, before.meetings);
  assert.equal((await nativeBodies(b.id)).length, 0, "there was no previous syllabus body to preserve");
});

test("syllabus replacement migration works when optional AI source tables are absent", async (t) => {
  const fixture = await setup({ withAi: false });
  const { pg, sql, a, payload, save, nativeBodies } = fixture;
  t.after(() => pg.close());

  assert.equal((await sql("select to_regclass('public.ai_sources') as relation")).rows[0].relation, null);
  const current = await payload(a.id);
  current.d.courseDetails.history.syllabusText = "Replacement without AI enabled";
  await save(a.id, USER_A, current);
  assert.equal((await nativeBodies(a.id)).length, 1);
  assert.equal((await nativeBodies(a.id))[0].body, "Syllabus A: résumé — Unicode ✓\nExam 1: 2026-10-15");
});

test("course syllabus replacement keeps every previous body and ordinary upload intact", async (t) => {
  const fixture = await setup();
  const { pg, sql, a, b, revision, payload, save, upload, batchTrash, fileMetadata, nativeBodies } = fixture;
  t.after(() => pg.close());

  // The source lives in a child of the managed course folder so both the upload
  // and the custom-folder Trash guard are exercised against real stored rows.
  const courseFolder = (await sql("select id from file_folders where profile_id=$1 and kind='course' and course_id='history'", [a.id])).rows[0].id;
  await sql("select mutate_account_folder($1,$2,'create',$3,null,$4)", [
    a.id, USER_A, FILE.customChild, JSON.stringify({ name: "Reading", parentId: courseFolder }),
  ]);
  await upload(a.id, USER_A, FILE.uploaded, "Uploaded source bytes: façade, 中文, ✓\n", FILE.customChild);
  let detail = (await payload(a.id)).d.courseDetails.history;
  detail = { ...detail, syllabusFileId: FILE.uploaded };
  await save(a.id, USER_A, dashboard({ ...((await payload(a.id)).d.courseDetails), history: { ...detail, syllabusFileId: FILE.uploaded } }));

  const uploadedBefore = await fileMetadata(a.id, FILE.uploaded);
  const uploadedBytesBefore = (await sql("select body from storage.objects where name=$1", [`${a.id}/${FILE.uploaded}`])).rows[0].body;
  await sql("update ai_sources set enabled=false where profile_id=$1 and source_key='syllabus:history'", [a.id]);
  const firstBase = await revision(a.id);
  const bodyB = "Syllabus B: dates move to October — résumé ✓\n";
  const dashboardB = dashboard({ ...((await payload(a.id)).d.courseDetails), history: { ...detail, syllabusText: bodyB, syllabusName: "Revised guide" } });
  await save(a.id, USER_A, dashboardB, firstBase);
  const afterB = await nativeBodies(a.id);
  const oldA = afterB.find((document) => document.body === detail.syllabusText);
  assert.ok(oldA, "the previous UTF-8 source is retained as a native syllabus file");
  assert.equal(oldA.name, "Fall 2026 syllabus.txt");
  assert.equal(Number(oldA.size_bytes), Buffer.byteLength(detail.syllabusText, "utf8"));
  assert.equal(oldA.content_sha256, digest(detail.syllabusText));
  assert.equal(oldA.content_backend, "native-text");
  assert.equal(oldA.kind, "syllabus");
  assert.equal(oldA.course_id, null);
  assert.equal(oldA.folder_id, courseFolder);
  assert.equal((await sql("select enabled from ai_sources where profile_id=$1 and source_key=$2", [a.id, `file:${oldA.id}`])).rows[0].enabled, false,
    "the prior optional AI source preference is copied to the preserved native file");

  const staleBase = firstBase;
  const dashboardC = dashboard({ ...((await payload(a.id)).d.courseDetails), history: { ...detail, syllabusText: "Syllabus C: final review", syllabusName: "Final guide" } });
  await save(a.id, USER_A, dashboardC);
  const beforeStale = await nativeBodies(a.id);
  assert.deepEqual(beforeStale.map((document) => document.body).sort(), [detail.syllabusText, bodyB].sort());
  assert.equal(new Set(beforeStale.map((document) => document.id)).size, 2, "each replacement uses a distinct native document UUID");
  const staleDashboard = dashboard({ ...((await payload(a.id)).d.courseDetails), history: { ...((await payload(a.id)).d.courseDetails.history), syllabusText: "Stale retry body" } });
  await assert.rejects(save(a.id, USER_A, staleDashboard, staleBase), { code: "40001" });
  assert.equal((await nativeBodies(a.id)).length, beforeStale.length, "a stale retry does not create another history document");
  assert.deepEqual((await payload(a.id)).d.courseDetails.history.syllabusText, "Syllabus C: final review");

  await t.test("name-only changes do not create history; uploaded bytes and metadata stay unchanged", async () => {
    const before = await nativeBodies(a.id);
    const current = await payload(a.id);
    const next = dashboard({ ...current.d.courseDetails, history: { ...current.d.courseDetails.history, syllabusName: "Renamed final guide" } });
    await save(a.id, USER_A, next);
    assert.equal((await nativeBodies(a.id)).length, before.length);
    assert.deepEqual(await fileMetadata(a.id, FILE.uploaded), uploadedBefore);
    assert.deepEqual((await sql("select body from storage.objects where name=$1", [`${a.id}/${FILE.uploaded}`])).rows[0].body, uploadedBytesBefore);
  });

  await t.test("swapping to a second upload retains the old file and makes it trashable", async () => {
    await upload(a.id, USER_A, FILE.replacement, "Replacement upload bytes: café ✓\n", FILE.customChild);
    const replacementBefore = await fileMetadata(a.id, FILE.replacement);
    const replacementBytesBefore = (await sql("select body from storage.objects where name=$1", [`${a.id}/${FILE.replacement}`])).rows[0].body;
    const historyBefore = await nativeBodies(a.id);
    const current = await payload(a.id);
    current.d.courseDetails.history.syllabusFileId = FILE.replacement;
    await save(a.id, USER_A, current);

    assert.deepEqual(await nativeBodies(a.id), historyBefore, "changing only the uploaded source ID does not make a text history copy");
    assert.deepEqual(await fileMetadata(a.id, FILE.uploaded), uploadedBefore);
    assert.equal((await fileMetadata(a.id, FILE.uploaded)).folder_id, FILE.customChild, "the old source keeps its file ID and folder before Trash");
    assert.deepEqual((await sql("select body from storage.objects where name=$1", [`${a.id}/${FILE.uploaded}`])).rows[0].body, uploadedBytesBefore);
    assert.deepEqual(await fileMetadata(a.id, FILE.replacement), replacementBefore);
    assert.deepEqual((await sql("select body from storage.objects where name=$1", [`${a.id}/${FILE.replacement}`])).rows[0].body, replacementBytesBefore);

    await batchTrash(a.id, USER_A, FILE.uploaded);
    const oldSource = (await sql("select folder_id,original_folder_id,trashed_at from user_files where profile_id=$1 and id=$2", [a.id, FILE.uploaded])).rows[0];
    assert.equal(oldSource.folder_id, null);
    assert.equal(oldSource.original_folder_id, FILE.customChild);
    assert.ok(oldSource.trashed_at, "the detached old source can move to Trash");
    assert.deepEqual((await sql("select body from storage.objects where name=$1", [`${a.id}/${FILE.uploaded}`])).rows[0].body, uploadedBytesBefore);
  });

  await t.test("direct deletes and batch Trash protect both saved-course and review sources", async () => {
    const currentFile = await sql("select updated_at from user_files where profile_id=$1 and id=$2", [a.id, FILE.replacement]);
    await assert.rejects(sql("select mutate_account_file($1,$2,$3,'deleting',$4,'{}')", [a.id, USER_A, FILE.replacement, currentFile.rows[0].updated_at]), { code: "23503" });
    await assert.rejects(batchTrash(a.id, USER_A, FILE.replacement), { code: "23503" });

    const current = await payload(a.id);
    const detached = structuredClone(current);
    delete detached.d.courseDetails.history.syllabusFileId;
    await save(a.id, USER_A, detached);
    const draftSource = structuredClone(await payload(a.id));
    draftSource.d.syllabusDrafts = [{ id: "draft-history", sourceFileId: FILE.replacement, sourceName: "Source — schedule.txt", sourceText: "Review text" }];
    await save(a.id, USER_A, draftSource);
    const freshFile = await sql("select updated_at from user_files where profile_id=$1 and id=$2", [a.id, FILE.replacement]);
    await assert.rejects(sql("select mutate_account_file($1,$2,$3,'deleting',$4,'{}')", [a.id, USER_A, FILE.replacement, freshFile.rows[0].updated_at]), { code: "23503" });
    await assert.rejects(batchTrash(a.id, USER_A, FILE.replacement), { code: "23503" });
  });

  await t.test("protected subtree Trash, foreign references, and inactive references are rejected", async () => {
    const folder = await sql("select revision from file_folders where profile_id=$1 and id=$2", [a.id, FILE.customChild]);
    await assert.rejects(sql("select mutate_account_folder($1,$2,'trash',$3,$4,'{}')", [a.id, USER_A, FILE.customChild, folder.rows[0].revision]), { code: "23503" });

    const foreignDashboard = dashboard({ history: { syllabusFileId: FILE.replacement } });
    await assert.rejects(save(b.id, USER_B, foreignDashboard), { code: "23503" });

    await upload(a.id, USER_A, FILE.inactive, "Inactive source", null);
    const inactiveRevision = (await sql("select updated_at from user_files where profile_id=$1 and id=$2", [a.id, FILE.inactive])).rows[0].updated_at;
    await sql("select mutate_account_file($1,$2,$3,'deleting',$4,'{}')", [a.id, USER_A, FILE.inactive, inactiveRevision]);
    const current = await payload(a.id);
    current.d.courseDetails.history.syllabusFileId = FILE.inactive;
    await assert.rejects(save(a.id, USER_A, current), { code: "23503" });
  });

  await t.test("capacity counts recoverable Trash rows and rolls back the full workspace write", async () => {
    const { a: profile } = fixture;
    await pg.exec(`
    with generated as (select gen_random_uuid() as id, i from generate_series(1, 995) i)
    insert into public.user_files(profile_id,id,course_id,assignment_id,kind,name,mime_type,size_bytes,object_path,state,trashed_at,trash_operation_id)
      select '${profile.id}', generated.id, null, null, 'resource', 'capacity-' || generated.i || '.txt', 'text/plain', 0,
        '${profile.id}/' || generated.id::text, 'pending', case when generated.i = 995 then now() else null end,
        case when generated.i = 995 then gen_random_uuid() else null end
      from generated;
    `);
    assert.equal(Number((await sql("select count(*) as count from user_files where profile_id=$1 and deleted_at is null", [profile.id])).rows[0].count), 1000,
      "the attached upload counts toward the 1000-file limit alongside pending and trashed rows");
    const beforeRevision = await revision(profile.id);
    const beforeDashboard = await payload(profile.id);
    const replacement = structuredClone(beforeDashboard);
    replacement.d.courseDetails.history.syllabusText = "A replacement that must roll back";
    await assert.rejects(save(profile.id, USER_A, replacement, beforeRevision), (error) =>
      error.code === "P0001" && error.message.includes("PRESERVE_SYLLABUS_REPLACEMENT:"));
    assert.equal(await revision(profile.id), beforeRevision);
    assert.deepEqual(await payload(profile.id), beforeDashboard);
    assert.equal((await nativeBodies(profile.id)).length, 2, "failed replacement leaves existing history untouched");
  });
});

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compileRoute(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}

test("workspace API maps syllabus preservation failures to a recoverable 409", async () => {
  const context = globalThis.__courseSyllabusApi = { code: "P0001", message: "PRESERVE_SYLLABUS_REPLACEMENT: full" };
  const auth = moduleUrl(`
    export class AuthError extends Error {}
    export const requireProfile = async () => ({ id: "profile-a", auth_user_id: "user-a", initialized: true });
    export const requireSameOrigin = () => {};
    export const apiError = () => Response.json({ error: "unexpected" }, { status: 500 });
  `);
  const snapshots = moduleUrl(`export const academicSnapshot = (courses, dashboard) => ({ courses, dashboard });`);
  const database = moduleUrl(`export const getSupabaseAdmin = () => ({
    async rpc() { return { data: null, error: { code: globalThis.__courseSyllabusApi.code, message: globalThis.__courseSyllabusApi.message } }; },
    from() { throw new Error("The complete v2 fixture must not need a compatibility read."); },
  });`);
  const requestModule = await compileRoute("lib/persistence-request.ts");
  const api = await import(await compileRoute("app/api/workspace/route.ts", {
    "../../../lib/auth": auth,
    "../../../lib/academic-snapshot": snapshots,
    "../../../lib/supabase-server": database,
    "../../../lib/persistence-request": requestModule,
  }));
  const dashboardBody = { v: 2, b: [], h: [], ts: [], d: { assignments: [], manualEvents: [], study: {}, filePreferences: {}, widgetAppearance: {} } };
  const request = () => new Request("https://edu.example/api/workspace", {
    method: "PUT", headers: { origin: "https://edu.example", "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: "2026-10-08T00:00:00.000Z", courses: [], dashboard: dashboardBody }),
  });

  for (const message of ["PRESERVE_SYLLABUS_REPLACEMENT: full", "PRESERVE_COURSE_SYLLABUS: full"]) {
    context.message = message;
    const response = await api.PUT(request());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "syllabus-preservation");
  }
});
