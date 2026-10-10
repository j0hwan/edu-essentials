import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const AUTH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = {
  archiveRoot: "10101010-1010-4010-8010-101010101010",
  child: "12121212-1212-4121-8121-121212121212",
  outside: "13131313-1313-4131-8131-131313131313",
  native: "15151515-1515-4151-8151-151515151515",
  upload: "16161616-1616-4161-8161-161616161616",
};
const course = {
  id: "course-a", code: "BIO 101", name: "Biology", credits: 3, instructor: "",
  room: "", color: "#123456", soft_color: "#ffffff", initials: "BI",
};
const dashboard = {
  v: 1, a: "day", w: [], n: "",
  d: { assignments: [{ id: "assignment-a", courseId: course.id, title: "Lab", dateKey: "2026-10-08" }] },
};
const digest = "a".repeat(64);
const migrations = [
  "20260903000000_workspace_persistence.sql",
  "20260904000000_google_accounts.sql",
  "20260905000000_persistence_foundation.sql",
  "20260907000000_private_files.sql",
  "20261008000000_onboarding_details.sql",
  "20261008010000_file_organization.sql",
  "20261008020000_file_content_api.sql",
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
  const pg = new PGlite();
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
  for (const file of migrations.slice(0, 2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [AUTH_ID]);
  const profile = (await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [AUTH_ID])).rows[0];
  await sql("select initialize_account_workspace($1,$2,$3)", [profile.id, JSON.stringify([course]), JSON.stringify(dashboard)]);
  for (const file of migrations.slice(2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const admin = {
    async rpc(name, args) {
      if (name !== "mutate_account_folder") return { data: null, error: { code: "42883", message: `Unexpected RPC ${name}` } };
      try {
        const result = await sql("select public.mutate_account_folder($1,$2,$3,$4,$5,$6::jsonb) as data", [
          args.p_profile_id, args.p_auth_user_id, args.p_operation, args.p_folder_id ?? null,
          args.p_expected_revision ?? null, JSON.stringify(args.p_metadata ?? {}),
        ]);
        return { data: result.rows[0]?.data ?? null, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
  globalThis.__archiveIntegrityTest = { admin, profile };
  const auth = moduleUrl(`
    export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
    export const requireProfile = async () => globalThis.__archiveIntegrityTest.profile;
    export function requireSameOrigin(request) {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new AuthError("Wrong origin.", 403);
    }
    export function apiError(error) {
      return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "no-store" } });
    }
  `);
  const db = moduleUrl("export const getSupabaseAdmin = () => globalThis.__archiveIntegrityTest.admin;");
  const files = await compile("lib/files.ts");
  const organization = await compile("lib/file-organization.ts");
  const persistence = await compile("lib/persistence-request.ts");
  const helper = await compile("lib/private-files-server.ts", {
    "./auth": auth, "./supabase-server": db, "./persistence-request": persistence, "./files": files,
  });
  const api = await import(await compile("app/api/file-folders/route.ts", {
    "../../../lib/private-files-server": helper,
    "../../../lib/files": files,
    "../../../lib/persistence-request": persistence,
    "../../../lib/file-organization": organization,
    "../../../lib/supabase-server": db,
  }));

  const courseFolderId = (await sql("select id from file_folders where profile_id=$1 and kind='course' and course_id=$2", [profile.id, course.id])).rows[0]?.id;
  assert.ok(courseFolderId, "managed course folders are created from authoritative course rows");
  const folder = async (operation, id = null, revision = null, metadata = {}) => (await sql(
    "select public.mutate_account_folder($1,$2,$3,$4,$5,$6::jsonb) as data",
    [profile.id, AUTH_ID, operation, id, revision, JSON.stringify(metadata)],
  )).rows[0].data;
  const document = async (id, operation, revision, metadata) => (await sql(
    "select public.mutate_account_document($1,$2,$3,$4,$5,$6::jsonb) as data",
    [profile.id, AUTH_ID, id, operation, revision, JSON.stringify(metadata)],
  )).rows[0].data;
  const file = async (id, operation, revision = null, metadata = {}) => (await sql(
    "select public.mutate_account_file($1,$2,$3,$4,$5,$6::jsonb) as data",
    [profile.id, AUTH_ID, id, operation, revision, JSON.stringify(metadata)],
  )).rows[0].data;
  const fileLocation = async (id, operation, revision, metadata = {}) => (await sql(
    "select public.mutate_account_file_location($1,$2,$3,$4,$5,$6::jsonb) as data",
    [profile.id, AUTH_ID, id, operation, revision, JSON.stringify(metadata)],
  )).rows[0].data;
  const filesAction = async (action, items, destinationId = null) => (await sql(
    "select public.mutate_account_files_action($1,$2,$3,$4::jsonb,$5,false) as data",
    [profile.id, AUTH_ID, action, JSON.stringify(items), destinationId],
  )).rows[0].data;
  const folderRow = async (id) => (await sql("select * from public.file_folders where profile_id=$1 and id=$2", [profile.id, id])).rows[0];
  const fileRow = async (id) => (await sql("select * from public.user_files where profile_id=$1 and id=$2", [profile.id, id])).rows[0];
  const apiRequest = (body) => new Request("https://edu.example/api/file-folders", {
    method: "PUT",
    headers: { origin: "https://edu.example", "x-profile-id": profile.id, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { pg, sql, profile, courseFolderId, api, folder, document, file, fileLocation, filesAction, folderRow, fileRow, apiRequest };
}

test("archive boundaries enforce revisions, snapshots, read-only contents, and Trash compatibility", async (t) => {
  const fixture = await setup();
  t.after(async () => {
    delete globalThis.__archiveIntegrityTest;
    await fixture.pg.close();
  });
  const { sql, profile, courseFolderId, api, folder, document, file, fileLocation, filesAction, folderRow, fileRow, apiRequest } = fixture;
  const root = await folder("create", ID.archiveRoot, null, { name: "Study files" });
  const child = await folder("create", ID.child, null, { name: "Week 1", parentId: ID.archiveRoot });
  const outside = await folder("create", ID.outside, null, { name: "Outside" });
  const courseFolder = await folderRow(courseFolderId);
  const native = await document(ID.native, "create", null, {
    name: "Notes.txt", body: "saved body\n", courseId: course.id, assignmentId: "assignment-a", folderId: ID.child,
  });
  assert.equal(native.file.folder_id, ID.child);
  const upload = await file(ID.upload, "reserve", null, {
    name: "Evidence.bin", kind: "resource", courseId: course.id, assignmentId: "assignment-a",
    folderId: ID.child, mime: "application/octet-stream", size: 1, sha256: digest,
  });
  assert.equal(upload.folder_id, ID.child);
  await file(ID.upload, "ready");

  await t.test("privileged wrappers are the only service-role entrypoints", async () => {
    const grants = (await sql(`select
      has_function_privilege('service_role', 'public.mutate_account_folder(uuid,uuid,text,uuid,bigint,jsonb)', 'execute') as folder_rpc,
      has_function_privilege('authenticated', 'public.mutate_account_folder(uuid,uuid,text,uuid,bigint,jsonb)', 'execute') as authenticated_folder_rpc,
      has_function_privilege('service_role', 'public.mutate_account_folder_legacy(uuid,uuid,text,uuid,bigint,jsonb)', 'execute') as legacy_folder_rpc,
      has_function_privilege('service_role', 'public.mutate_account_document(uuid,uuid,uuid,text,bigint,jsonb)', 'execute') as document_rpc,
      has_function_privilege('service_role', 'public.mutate_account_document_legacy(uuid,uuid,uuid,text,bigint,jsonb)', 'execute') as legacy_document_rpc,
      has_function_privilege('service_role', 'public.preserve_replaced_course_syllabi()', 'execute') as syllabus_trigger_rpc`)).rows[0];
    assert.equal(grants.folder_rpc, true);
    assert.equal(grants.authenticated_folder_rpc, false);
    assert.equal(grants.legacy_folder_rpc, false);
    assert.equal(grants.document_rpc, true);
    assert.equal(grants.legacy_document_rpc, false);
    assert.equal(grants.syllabus_trigger_rpc, false);
  });

  await t.test("the direct folder API rejects stale activity revisions and ignores client snapshot spoofing", async () => {
    const missingRevision = await api.PUT(apiRequest({ id: ID.archiveRoot, action: "open" }));
    assert.equal(missingRevision.status, 428);
    const staleOpen = await api.PUT(apiRequest({ id: ID.archiveRoot, action: "open", revision: Number(root.revision) + 1 }));
    assert.equal(staleOpen.status, 409, await staleOpen.clone().text());
    assert.equal((await sql("select count(*)::int as count from folder_activity where profile_id=$1 and folder_id=$2", [profile.id, ID.archiveRoot])).rows[0].count, 0);
    const opened = await api.PUT(apiRequest({ id: ID.archiveRoot, action: "open", revision: Number(root.revision) }));
    assert.equal(opened.status, 200, await opened.clone().text());
    assert.ok((await sql("select last_opened_at from folder_activity where profile_id=$1 and folder_id=$2", [profile.id, ID.archiveRoot])).rows[0].last_opened_at);

    const archive = await api.PUT(apiRequest({
      id: courseFolderId, action: "archive", revision: Number(courseFolder.revision), semesterLabel: "Fall 2026",
      courseNameSnapshot: "Spoofed course", courseColorSnapshot: "#badbad",
    }));
    assert.equal(archive.status, 200, await archive.clone().text());
    const archived = (await archive.json()).folder;
    assert.equal(archived.semester_label, "Fall 2026");
    assert.equal(archived.course_name_snapshot, "Biology");
    assert.equal(archived.course_color_snapshot, "#123456");
  });

  await t.test("only active root folders archive and only archived roots unarchive", async () => {
    await assert.rejects(folder("archive", ID.child, Number(child.revision), { semesterLabel: "Fall 2026" }), { code: "23514" });
    await assert.rejects(folder("unarchive", ID.archiveRoot, Number(root.revision), {}), { code: "23514" });
    const archived = await folder("archive", ID.archiveRoot, Number(root.revision), {
      semesterLabel: "Fall 2026", courseNameSnapshot: "Spoofed", courseColorSnapshot: "#000000",
    });
    assert.equal(archived.semester_label, "Fall 2026");
    assert.equal(archived.course_name_snapshot, null);
    assert.equal(archived.course_color_snapshot, null);
    await assert.rejects(folder("archive", ID.archiveRoot, Number(archived.revision), { semesterLabel: "Winter 2027" }), { code: "23514" });
    await assert.rejects(folder("unarchive", ID.child, Number(child.revision), {}), { code: "23514" });
  });

  await t.test("create, rename, and move paths cannot write into or originate inside an archive", async () => {
    await assert.rejects(folder("create", ID.later, null, { name: "Inside archive", parentId: ID.archiveRoot }), { code: "23514" });
    await assert.rejects(document("17171717-1717-4171-8171-171717171718", "create", null, {
      name: "New.txt", body: "x", folderId: ID.child,
    }), { code: "23514" });
    await assert.rejects(file("17171717-1717-4171-8171-171717171719", "reserve", null, {
      name: "New.bin", kind: "resource", mime: "application/octet-stream", size: 1, sha256: digest,
      folderId: ID.child,
    }), { code: "23514" });
    await assert.rejects(folder("rename", ID.child, Number(child.revision), { name: "Renamed" }), { code: "23514" });
    await assert.rejects(folder("move", ID.child, Number(child.revision), { parentId: ID.outside }), { code: "23514" });
    await assert.rejects(folder("create", null, null, { name: "New child", parentId: ID.child }), { code: "23514" });
    await assert.rejects(fileLocation(ID.upload, "move", Number(upload.metadata_revision), { folderId: ID.outside }), { code: "23514" });
    await assert.rejects(filesAction("move", [{ type: "folder", id: ID.child, revision: Number(child.revision) }], null), { code: "23514" });
    await assert.rejects(filesAction("move", [{ type: "folder", id: ID.outside, revision: Number(outside.revision) }], ID.archiveRoot), { code: "23514" });
    await assert.rejects(sql("select public.rename_account_file($1,$2,$3,$4,$5)", [profile.id, AUTH_ID, ID.upload, Number(upload.metadata_revision), "Renamed.bin"]), { code: "23514" });
    await assert.rejects(document(ID.native, "update_content", Number(native.file.content_revision), { body: "changed" }), { code: "23514" });
    assert.equal((await fileRow(ID.upload)).name, "Evidence.bin");
  });

  await t.test("archive labels and snapshots stay captured while account term and course data change", async () => {
    await sql("update app_profiles set current_term='Spring 2027' where id=$1", [profile.id]);
    await sql("update courses set name='Human Biology', code='BIO 110', color='#654321' where profile_id=$1 and id=$2", [profile.id, course.id]);
    const academicAfterCourseEdit = (await sql(`select
      (select jsonb_agg(to_jsonb(c) order by c.id) from courses c where c.profile_id=$1) as courses,
      (select payload from dashboard_state where profile_id=$1) as dashboard`, [profile.id])).rows[0];
    const changedCourseFolder = await folderRow(courseFolderId);
    assert.equal(changedCourseFolder.course_code, "BIO 110", "the managed code remains live from course data");
    assert.equal(changedCourseFolder.semester_label, "Fall 2026");
    assert.equal(changedCourseFolder.course_name_snapshot, "Biology");
    assert.equal(changedCourseFolder.course_color_snapshot, "#123456");
    const afterCourseChange = await folderRow(courseFolderId);
    const unarchivedCourse = await folder("unarchive", courseFolderId, Number(afterCourseChange.revision), {});
    assert.equal(unarchivedCourse.archived_at, null);
    const rearchivedCourse = await folder("archive", courseFolderId, Number(unarchivedCourse.revision), { semesterLabel: "Spring 2027" });
    assert.equal(rearchivedCourse.semester_label, "Spring 2027");
    assert.equal(rearchivedCourse.course_name_snapshot, "Human Biology");
    assert.equal(rearchivedCourse.course_color_snapshot, "#654321");
    const academicAfter = (await sql(`select
      (select jsonb_agg(to_jsonb(c) order by c.id) from courses c where c.profile_id=$1) as courses,
      (select payload from dashboard_state where profile_id=$1) as dashboard`, [profile.id])).rows[0];
    assert.deepEqual(academicAfter, academicAfterCourseEdit, "archive transitions do not edit courses or workspace records");

    const currentRoot = await folderRow(ID.archiveRoot);
    const unarchivedRoot = await folder("unarchive", ID.archiveRoot, Number(currentRoot.revision), {});
    assert.equal(unarchivedRoot.semester_label, null);
    const rearchivedRoot = await folder("archive", ID.archiveRoot, Number(unarchivedRoot.revision), { semesterLabel: "Spring 2027" });
    assert.equal(rearchivedRoot.semester_label, "Spring 2027");
  });

  await t.test("archived descendants keep recursive Trash and restore behavior", async () => {
    const currentChild = await folderRow(ID.child);
    const trash = await filesAction("trash", [{ type: "folder", id: ID.child, revision: Number(currentChild.revision) }]);
    assert.equal(trash.folders[0].trashed_at != null, true);
    const trashed = await folderRow(ID.child);
    const restore = await filesAction("restore", [{ type: "folder", id: ID.child, revision: Number(trashed.revision) }]);
    assert.equal(restore.folders[0].trashed_at, null);
    assert.equal(restore.folders[0].parent_id, ID.archiveRoot);
    assert.ok((await folderRow(ID.archiveRoot)).archived_at);
    assert.ok((await folderRow(courseFolderId)).archived_at);
  });
});
