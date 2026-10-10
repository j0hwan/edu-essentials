import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { clientModule } from "./helpers/client-modules.mjs";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE_ID = "history-205";
const SYLLABUS_FILE_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const TRASH_FILE_ID = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://edu.example";
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function compile(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseStoredZip(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    assert.equal(view.getUint16(8, true), 0, "account export entries use stored ZIP data");
    const compressedSize = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, Buffer.from(bytes.subarray(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  return entries;
}

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

test("Batch 11 course-to-files release scenario runs compiled APIs against the complete PGlite migration chain", async (t) => {
  const pg = new PGlite({ extensions: { vector } });
  const sql = (statement, params = []) => pg.query(statement, params, {
    parsers: { 1184: (value) => value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") },
  });
  const runtime = { user: USER_A, sql };

  try {
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
    for (const file of migrationFiles) {
      await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }

    for (const [id, email] of [[USER_A, "a@example.invalid"], [USER_B, "b@example.invalid"]]) {
      await sql("insert into auth.users values ($1, $2, '{\"provider\":\"google\"}', '{\"name\":\"Test Student\"}')", [id, email]);
      await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1", [id]);
    }
    const profileFor = async (authId) => (await sql("select * from app_profiles where auth_user_id = $1", [authId])).rows[0];
    runtime.profileFor = async () => profileFor(runtime.user);
    runtime.from = (table) => makeQuery(table, sql);
    runtime.rpc = async (name, args) => {
      const calls = {
        initialize_account_workspace: () => sql("select initialize_account_workspace($1,$2,$3) as value", [args.p_profile_id, JSON.stringify(args.p_courses), JSON.stringify(args.p_dashboard)]),
        save_account_workspace: () => sql("select save_account_workspace($1,$2,$3,$4,$5) as value", [args.p_profile_id, args.p_auth_user_id, args.p_expected_revision, JSON.stringify(args.p_courses), JSON.stringify(args.p_dashboard)]),
        mutate_account_file: () => sql("select mutate_account_file($1,$2,$3,$4,$5,$6) as value", [args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_operation, args.p_expected_revision, JSON.stringify(args.p_metadata ?? {})]),
        mutate_account_folder: () => sql("select mutate_account_folder($1,$2,$3,$4,$5,$6) as value", [args.p_profile_id, args.p_auth_user_id, args.p_operation, args.p_folder_id, args.p_expected_revision, JSON.stringify(args.p_metadata ?? {})]),
        mutate_account_document: () => sql("select mutate_account_document($1,$2,$3,$4,$5,$6) as value", [args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_operation, args.p_expected_content_revision ?? null, JSON.stringify(args.p_document ?? {})]),
        mutate_account_files_action: () => sql("select mutate_account_files_action($1,$2,$3,$4,$5,$6) as value", [args.p_profile_id, args.p_auth_user_id, args.p_action, JSON.stringify(args.p_items), args.p_destination_id ?? null, args.p_destination_provided ?? false]),
        read_account_file_content: () => sql("select read_account_file_content($1,$2,$3,$4) as value", [args.p_profile_id, args.p_file_id, args.p_expected_content_revision ?? null, args.p_allow_trashed ?? false]),
        read_account_file_browser: () => sql("select read_account_file_browser($1,$2) as value", [args.p_profile_id, args.p_auth_user_id]),
        export_account: () => sql("select export_account($1,$2) as value", [args.p_profile_id, args.p_auth_user_id]),
      };
      assert.ok(calls[name], `unexpected RPC ${name}`);
      try {
        const result = await calls[name]();
        return { data: result.rows[0]?.value ?? null, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    };
    runtime.storage = {
      from(bucket) {
        assert.equal(bucket, "eduessentials-private");
        return {
          async upload(path, bytes) {
            await sql("insert into storage.objects(bucket_id,name,body) values($1,$2,$3)", [bucket, path, Buffer.from(bytes)]);
            return { data: { path }, error: null };
          },
          async download(path) {
            const row = (await sql("select body from storage.objects where bucket_id=$1 and name=$2", [bucket, path])).rows[0];
            return row ? { data: new Blob([new Uint8Array(row.body)]), error: null } : { data: null, error: { message: "Object not found" } };
          },
          async remove(paths) {
            for (const path of paths) await sql("delete from storage.objects where bucket_id=$1 and name=$2", [bucket, path]);
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    };
    globalThis.__filesReleaseFixture = runtime;

    const authUrl = moduleUrl(`
      export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
      export const requireProfile = () => globalThis.__filesReleaseFixture.profileFor();
      export function requireSameOrigin(request) { if (request.headers.get("origin") !== new URL(request.url).origin) throw new AuthError("bad origin", 403); }
      export const apiError = (error) => Response.json({error:"Account error"}, {status:error?.status ?? 503});
    `);
    const dbUrl = moduleUrl("export const getSupabaseAdmin = () => globalThis.__filesReleaseFixture.db;");
    runtime.db = { from: runtime.from, rpc: runtime.rpc, storage: runtime.storage };
    const requestUrl = await compile("lib/persistence-request.ts");
    const filesUrl = await clientModule("lib/files.ts");
    const organizationUrl = await clientModule("lib/file-organization.ts");
    const contentUrl = await clientModule("lib/file-content.ts");
    const privateFilesUrl = await compile("lib/private-files-server.ts", {
      "./auth": authUrl,
      "./supabase-server": dbUrl,
      "./persistence-request": requestUrl,
      "./files": filesUrl,
    });
    const route = async (path, imports) => import(await compile(path, imports));
    const workspace = await route("app/api/workspace/route.ts", {
      "../../../lib/auth": authUrl,
      "../../../lib/academic-snapshot": await clientModule("lib/academic-snapshot.ts"),
      "../../../lib/supabase-server": dbUrl,
      "../../../lib/persistence-request": requestUrl,
    });
    const fileFolders = await route("app/api/file-folders/route.ts", {
      "../../../lib/private-files-server": privateFilesUrl,
      "../../../lib/files": filesUrl,
      "../../../lib/persistence-request": requestUrl,
      "../../../lib/file-organization": organizationUrl,
      "../../../lib/supabase-server": dbUrl,
    });
    const fileDocuments = await route("app/api/file-documents/route.ts", {
      "../../../lib/private-files-server": privateFilesUrl,
      "../../../lib/files": filesUrl,
      "../../../lib/file-content": contentUrl,
      "../../../lib/file-organization": organizationUrl,
      "../../../lib/persistence-request": requestUrl,
      "../../../lib/supabase-server": dbUrl,
    });
    const files = await route("app/api/files/route.ts", {
      "../../../lib/private-files-server": privateFilesUrl,
      "../../../lib/files": filesUrl,
      "../../../lib/persistence-request": requestUrl,
      "../../../lib/file-organization": organizationUrl,
      "../../../lib/supabase-server": dbUrl,
      "../../../lib/file-content": contentUrl,
    });
    const actions = await route("app/api/files/actions/route.ts", {
      "../../../../lib/private-files-server": privateFilesUrl,
      "../../../../lib/files": filesUrl,
      "../../../../lib/persistence-request": requestUrl,
      "../../../../lib/file-organization": organizationUrl,
      "../../../../lib/supabase-server": dbUrl,
    });
    const accountExport = await route("app/api/export/route.ts", {
      "../../../lib/private-files-server": privateFilesUrl,
      "../../../lib/supabase-server": dbUrl,
      "../../../lib/files": filesUrl,
      "../../../lib/file-content": contentUrl,
      "../../../lib/zip": await clientModule("lib/zip.ts"),
    });
    const { encodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));

    const emptyDashboard = () => encodeWorkspaceState(
      [{ id: "my-day", name: "My Day", widgets: [] }], "my-day", "",
      { assignments: [], manualEvents: [], dashboardView: "cards", courseDetails: {} },
    );
    const request = (method, path, body, extraHeaders = {}) => new Request(`${ORIGIN}${path}`, {
      method,
      headers: { ...(method !== "GET" ? { origin: ORIGIN } : {}), ...(body instanceof Uint8Array ? {} : { "content-type": "application/json" }), ...extraHeaders },
      ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
    });
    const json = async (response, expectedStatus = 200) => {
      assert.equal(response.status, expectedStatus, await response.clone().text());
      return response.json();
    };
    const accountCourse = (name, code) => ({
      id: COURSE_ID, code, name, credits: 3, instructor: "Dr. Rivera", room: "Hall 2",
      color: "#224466", soft: "#22446618", initials: "HI",
    });
    const assignment = {
      id: "reading-1", title: "Primary source review", courseId: COURSE_ID,
      due: "October 20", dateKey: "2026-10-20", status: "later", progress: 0,
      description: "Read the selected source.", weight: "5%",
    };
    const createCourse = async (name, code, initialAssignments = []) => {
      const current = await json(await workspace.GET(request("GET", "/api/workspace")));
      const dashboard = encodeWorkspaceState(
        [{ id: "my-day", name: "My Day", widgets: [] }], "my-day", "",
        { assignments: initialAssignments, manualEvents: [], dashboardView: "cards", courseDetails: {} },
      );
      return workspace.PUT(request("PUT", "/api/workspace", {
        baseRevision: current.revision,
        courses: [...current.courses, accountCourse(name, code)],
        dashboard,
      }));
    };
    const profileA = await profileFor(USER_A);
    const profileB = await profileFor(USER_B);
    for (const profile of [profileA, profileB]) {
      runtime.user = profile.auth_user_id;
      await json(await workspace.POST(request("POST", "/api/workspace", { action: "initialize", courses: [], dashboard: emptyDashboard() })), 201);
    }

    await t.test("creating a course commits exactly one managed folder, visible through folder and file APIs", async () => {
      runtime.user = USER_A;
      await json(await createCourse("World History", "HIST 205", [assignment]));
      const folderRead = await json(await fileFolders.GET(request("GET", "/api/file-folders?view=active")));
      const courseFolders = folderRead.folders.filter((folder) => folder.course_id === COURSE_ID);
      assert.equal(courseFolders.length, 1);
      const courseFolder = courseFolders[0];
      assert.equal(courseFolder.kind, "course");
      assert.equal(courseFolder.name, "World History");
      assert.equal(courseFolder.course_code, "HIST 205");
      const opened = await json(await fileFolders.GET(request("GET", `/api/file-folders?view=active&parentId=${courseFolder.id}`)));
      assert.deepEqual(opened.folders, [], "opening the new course folder returns no nested folders yet");
      const fileRead = await json(await files.GET(request("GET", "/api/files?view=active")));
      assert.deepEqual(fileRead.files.filter((file) => file.folder_id === courseFolder.id), []);
      assert.equal((await sql("select count(*)::int as count from courses where profile_id=$1 and id=$2", [profileA.id, COURSE_ID])).rows[0].count, 1);
      assert.equal((await sql("select count(*)::int as count from file_folders where profile_id=$1 and course_id=$2 and kind='course'", [profileA.id, COURSE_ID])).rows[0].count, 1);
      runtime.courseFolderId = courseFolder.id;
    });

    const syllabusBytes = Buffer.from("%PDF-1.7\r\nBatch 11 source bytes: résumé and schedule.\r\n%%EOF\r\n", "utf8");
    const syllabusText = "Attach-only course syllabus — résumé, 日本語, and exam dates.\n";
    let attachedWorkspace;
    await t.test("uploading and attaching a syllabus changes courseDetails only and stale workspace edits are rejected", async () => {
      runtime.user = USER_A;
      const uploadMetadata = {
        name: "HIST 205 syllabus.pdf", courseId: COURSE_ID, assignmentId: "", kind: "syllabus", folderId: runtime.courseFolderId,
      };
      const uploaded = await json(await files.POST(request("POST", `/api/files?id=${SYLLABUS_FILE_ID}`, syllabusBytes, {
        "x-file-metadata": encodeURIComponent(JSON.stringify(uploadMetadata)),
      })), 201);
      assert.equal(uploaded.file.folder_id, runtime.courseFolderId);
      assert.equal(uploaded.file.kind, "syllabus");
      assert.deepEqual(Buffer.from(await (await runtime.storage.from("eduessentials-private").download(`${profileA.id}/${SYLLABUS_FILE_ID}`)).data.arrayBuffer()), syllabusBytes);

      const before = await json(await workspace.GET(request("GET", "/api/workspace")));
      const nextDashboard = {
        ...before.dashboard,
        d: {
          ...before.dashboard.d,
          courseDetails: {
            ...before.dashboard.d.courseDetails,
            [COURSE_ID]: {
              officeHours: "", meetings: [], syllabusText, syllabusName: "Fall 2026 outline", syllabusFileId: SYLLABUS_FILE_ID,
            },
          },
        },
      };
      await json(await workspace.PUT(request("PUT", "/api/workspace", {
        baseRevision: before.revision, courses: before.courses, dashboard: nextDashboard,
      })));
      attachedWorkspace = await json(await workspace.GET(request("GET", "/api/workspace")));
      assert.equal(attachedWorkspace.courses.length, 1);
      assert.equal(attachedWorkspace.dashboard.d.assignments.length, 1);
      assert.deepEqual(attachedWorkspace.dashboard.d.assignments, [assignment]);
      assert.deepEqual(attachedWorkspace.dashboard.d.courseDetails[COURSE_ID], nextDashboard.d.courseDetails[COURSE_ID]);
      assert.equal((await sql("select count(*)::int as count from courses where profile_id=$1", [profileA.id])).rows[0].count, 1);
      assert.equal((await sql("select jsonb_array_length(payload->'d'->'assignments')::int as count from dashboard_state where profile_id=$1", [profileA.id])).rows[0].count, 1);

      const staleDashboard = { ...nextDashboard, d: { ...nextDashboard.d, courseDetails: { ...nextDashboard.d.courseDetails, [COURSE_ID]: { ...nextDashboard.d.courseDetails[COURSE_ID], syllabusText: "stale edit" } } } };
      await json(await workspace.PUT(request("PUT", "/api/workspace", {
        baseRevision: before.revision, courses: before.courses, dashboard: staleDashboard,
      })), 409);
      const afterStale = await json(await workspace.GET(request("GET", "/api/workspace")));
      assert.equal(afterStale.dashboard.d.courseDetails[COURSE_ID].syllabusText, syllabusText);
    });

    const nativeBody = "Final study notes — 日本語, résumé, ✓\nPrimary source review: October 20\n";
    let nativeFile;
    let customFolder;
    await t.test("native document create, edit, reload and stale content guard preserve its academic links", async () => {
      runtime.user = USER_A;
      const created = await json(await fileDocuments.POST(request("POST", "/api/file-documents", {
        id: DOCUMENT_ID, name: "Exam notes.txt", kind: "resource", courseId: COURSE_ID,
        assignmentId: assignment.id, folderId: runtime.courseFolderId, body: "",
      })), 201);
      assert.equal(created.file.folder_id, runtime.courseFolderId);
      assert.equal(created.file.course_id, COURSE_ID);
      assert.equal(created.file.assignment_id, assignment.id);
      assert.equal(created.document.body, "");
      const edited = await json(await fileDocuments.PUT(request("PUT", "/api/file-documents", {
        id: DOCUMENT_ID, action: "update_content", baseContentRevision: created.file.content_revision, body: nativeBody,
      })));
      assert.ok(edited.file.content_revision > created.file.content_revision);
      const reloaded = await json(await fileDocuments.GET(request("GET", `/api/file-documents?id=${DOCUMENT_ID}`)));
      assert.equal(reloaded.document.body, nativeBody);
      assert.equal(reloaded.file.folder_id, runtime.courseFolderId);
      assert.equal(reloaded.file.course_id, COURSE_ID);
      assert.equal(reloaded.file.assignment_id, assignment.id);
      await json(await fileDocuments.PUT(request("PUT", "/api/file-documents", {
        id: DOCUMENT_ID, action: "update_content", baseContentRevision: created.file.content_revision, body: "stale overwrite",
      })), 409);
      const afterStale = await json(await fileDocuments.GET(request("GET", `/api/file-documents?id=${DOCUMENT_ID}`)));
      assert.equal(afterStale.document.body, nativeBody);
      nativeFile = reloaded.file;
    });

    await t.test("custom-folder creation and file move preserve course and assignment associations", async () => {
      runtime.user = USER_A;
      customFolder = (await json(await fileFolders.POST(request("POST", "/api/file-folders", { name: "Primary sources" })), 201)).folder;
      assert.equal(customFolder.kind, "custom");
      const result = await json(await actions.POST(request("POST", "/api/files/actions", {
        action: "move", items: [{ type: "file", id: DOCUMENT_ID, revision: nativeFile.metadata_revision }], destinationId: customFolder.id,
      })));
      const moved = result.files.find((file) => file.id === DOCUMENT_ID);
      assert.equal(moved.folder_id, customFolder.id);
      assert.equal(moved.course_id, COURSE_ID);
      assert.equal(moved.assignment_id, assignment.id);
      const row = (await sql("select folder_id,course_id,assignment_id from user_files where profile_id=$1 and id=$2", [profileA.id, DOCUMENT_ID])).rows[0];
      assert.deepEqual(row, { folder_id: customFolder.id, course_id: COURSE_ID, assignment_id: assignment.id });
      nativeFile = moved;
    });

    await t.test("Trash and restore retain the document body, location and academic links", async () => {
      runtime.user = USER_A;
      const trashed = await json(await actions.POST(request("POST", "/api/files/actions", {
        action: "trash", items: [{ type: "file", id: DOCUMENT_ID, revision: nativeFile.metadata_revision }],
      })));
      const trashRow = trashed.files.find((file) => file.id === DOCUMENT_ID);
      assert.ok(trashRow.trashed_at);
      assert.equal(trashRow.original_folder_id, customFolder.id);
      assert.equal(trashRow.course_id, COURSE_ID);
      assert.equal(trashRow.assignment_id, assignment.id);
      await json(await fileDocuments.GET(request("GET", `/api/file-documents?id=${DOCUMENT_ID}`)), 404);
      const restored = await json(await actions.POST(request("POST", "/api/files/actions", {
        action: "restore", items: [{ type: "file", id: DOCUMENT_ID, revision: trashRow.metadata_revision }],
      })));
      const restoredFile = restored.files.find((file) => file.id === DOCUMENT_ID);
      assert.equal(restoredFile.trashed_at, null);
      assert.equal(restoredFile.folder_id, customFolder.id);
      assert.equal(restoredFile.course_id, COURSE_ID);
      assert.equal(restoredFile.assignment_id, assignment.id);
      const reloaded = await json(await fileDocuments.GET(request("GET", `/api/file-documents?id=${DOCUMENT_ID}`)));
      assert.equal(reloaded.document.body, nativeBody);
      nativeFile = restoredFile;
    });

    await t.test("managed course archive and unarchive do not change academic records", async () => {
      runtime.user = USER_A;
      const academicBefore = await academicSnapshot(profileA.id, sql);
      const currentFolder = (await json(await fileFolders.GET(request("GET", "/api/file-folders?view=active")))).folders.find((folder) => folder.id === runtime.courseFolderId);
      await json(await fileFolders.PUT(request("PUT", "/api/file-folders", {
        id: currentFolder.id, action: "archive", revision: Number(currentFolder.revision) + 9, semesterLabel: "Fall 2026",
      })), 409);
      const archivedResponse = await fileFolders.PUT(request("PUT", "/api/file-folders", {
        id: currentFolder.id, action: "archive", revision: currentFolder.revision, semesterLabel: "Fall 2026",
      }));
      const archived = (await json(archivedResponse)).folder;
      assert.equal(archived.semester_label, "Fall 2026");
      assert.deepEqual(await academicSnapshot(profileA.id, sql), academicBefore);
      const archiveRead = await json(await fileFolders.GET(request("GET", "/api/file-folders?view=archives")));
      assert.ok(archiveRead.folders.some((folder) => folder.id === currentFolder.id && folder.semester_label === "Fall 2026"));
      const unarchivedResponse = await fileFolders.PUT(request("PUT", "/api/file-folders", {
        id: archived.id, action: "unarchive", revision: archived.revision,
      }));
      const unarchived = (await json(unarchivedResponse)).folder;
      assert.equal(unarchived.archived_at, null);
      assert.deepEqual(await academicSnapshot(profileA.id, sql), academicBefore);
    });

    await t.test("a separate upload remains recoverable in Trash for account export", async () => {
      runtime.user = USER_A;
      const trashBytes = Buffer.from("Recoverable handout bytes — do not purge.\n", "utf8");
      const upload = await json(await files.POST(request("POST", `/api/files?id=${TRASH_FILE_ID}`, trashBytes, {
        "x-file-metadata": encodeURIComponent(JSON.stringify({ name: "Old handout.txt", courseId: "", assignmentId: "", kind: "resource" })),
      })), 201);
      assert.equal(upload.file.state, "ready");
      const trashed = await json(await actions.POST(request("POST", "/api/files/actions", {
        action: "trash", items: [{ type: "file", id: TRASH_FILE_ID, revision: upload.file.metadata_revision }],
      })));
      assert.ok(trashed.files.find((file) => file.id === TRASH_FILE_ID).trashed_at);
      runtime.trashBytes = trashBytes;
    });

    await t.test("two initialized profiles remain isolated across course, file and folder APIs", async () => {
      runtime.user = USER_B;
      await json(await createCourse("Local History", "HIST 299"));
      const otherFolders = await json(await fileFolders.GET(request("GET", "/api/file-folders?view=active")));
      const otherCourseFolder = otherFolders.folders.find((folder) => folder.course_id === COURSE_ID);
      assert.ok(otherCourseFolder);
      assert.notEqual(otherCourseFolder.id, runtime.courseFolderId);
      assert.equal(otherCourseFolder.name, "Local History");
      const otherFiles = await json(await files.GET(request("GET", "/api/files?view=active")));
      assert.deepEqual(otherFiles.files, []);
      await json(await fileDocuments.GET(request("GET", `/api/file-documents?id=${DOCUMENT_ID}`)), 404);
      await json(await fileFolders.GET(request("GET", `/api/file-folders?view=active&account=${profileA.id}`)), 401);
      const otherWorkspace = await json(await workspace.GET(request("GET", "/api/workspace")));
      assert.equal(otherWorkspace.courses.length, 1);
      assert.equal(otherWorkspace.courses[0].name, "Local History");
      assert.deepEqual(otherWorkspace.dashboard.d.assignments, []);
      assert.equal((await sql("select count(*)::int as count from user_files where profile_id=$1", [profileB.id])).rows[0].count, 0);
      runtime.user = USER_A;
    });

    await t.test("account ZIP contains exact native and uploaded bytes plus folders and distinct recoverable Trash", async () => {
      runtime.user = USER_A;
      const response = await accountExport.GET(request("GET", "/api/export"));
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get("content-type"), /application\/zip/);
      const archive = parseStoredZip(Buffer.from(await response.arrayBuffer()));
      assert.ok(archive.has("account.json"));
      const manifest = JSON.parse(archive.get("account.json").toString("utf8"));
      assert.equal(manifest.format, "eduessentials-account-v1");
      const exportedById = new Map(manifest.files.map((file) => [file.id, file]));
      const exportedSyllabus = exportedById.get(SYLLABUS_FILE_ID);
      const exportedDocument = exportedById.get(DOCUMENT_ID);
      const exportedTrash = exportedById.get(TRASH_FILE_ID);
      assert.ok(exportedSyllabus && exportedDocument && exportedTrash);
      assert.equal(exportedSyllabus.kind, "syllabus");
      assert.equal(exportedSyllabus.folder_id, runtime.courseFolderId);
      assert.equal(exportedDocument.content_backend, "native-text");
      assert.equal(exportedDocument.folder_id, customFolder.id);
      assert.equal(exportedDocument.course_id, COURSE_ID);
      assert.equal(exportedDocument.assignment_id, assignment.id);
      assert.equal(exportedDocument.trashed_at, null);
      assert.ok(exportedTrash.trashed_at);
      assert.equal(exportedTrash.original_folder_id, null);
      assert.deepEqual(archive.get(exportedSyllabus.archivePath), syllabusBytes);
      assert.deepEqual(archive.get(exportedDocument.archivePath), Buffer.from(nativeBody, "utf8"));
      assert.deepEqual(archive.get(exportedTrash.archivePath), runtime.trashBytes);
      const exportedFolders = new Map(manifest.folders.map((folder) => [folder.id, folder]));
      assert.equal(exportedFolders.get(runtime.courseFolderId).kind, "course");
      assert.equal(exportedFolders.get(runtime.courseFolderId).course_id, COURSE_ID);
      assert.equal(exportedFolders.get(customFolder.id).name, "Primary sources");
      assert.equal(exportedFolders.get(customFolder.id).kind, "custom");
      assert.equal(exportedById.size, 3, "restored native document and two uploads have distinct manifest records");
      assert.equal([...exportedById.values()].filter((file) => file.trashed_at != null).length, 1,
        "recoverable Trash is represented by its own trashed record while the restored document remains active");
      assert.equal(manifest.workspace.dashboard.d.courseDetails[COURSE_ID].syllabusFileId, SYLLABUS_FILE_ID);
      assert.equal((await sql("select count(*)::int as count from native_file_documents where profile_id=$1", [profileA.id])).rows[0].count, 1);
      assert.equal(digest(archive.get(exportedSyllabus.archivePath)), digest(syllabusBytes));
    });
  } finally {
    delete globalThis.__filesReleaseFixture;
    await pg.close();
  }
});

function makeQuery(table, sql) {
  const ident = (value) => {
    assert.match(value, /^[a-z_][a-z_0-9]*$/);
    return `"${value}"`;
  };
  let columns = "*";
  const filters = [];
  let ordering = null;
  let limit = null;
  let offset = 0;
  let single = false;
  const chain = {
    select(value = "*") { columns = value; return chain; },
    eq(key, value) { filters.push({ key, value, operator: "=" }); return chain; },
    is(key, value) { filters.push({ key, value, operator: "is" }); return chain; },
    order(key, options = {}) { ordering = `${ident(key)} ${options.ascending === false ? "desc" : "asc"}`; return chain; },
    range(from, to) { offset = from; limit = to - from + 1; return chain; },
    maybeSingle() { single = true; return execute(); },
    single() { single = true; return execute(); },
    then(resolve, reject) { return execute().then(resolve, reject); },
  };
  async function execute() {
    try {
      const params = [];
      const where = filters.map(({ key, value, operator }) => {
        const column = ident(key);
        if (operator === "is" && value === null) return `${column} is null`;
        params.push(value);
        return `${column} ${operator === "is" ? "is not distinct from" : operator} $${params.length}`;
      }).join(" and ");
      const selected = columns === "*" ? "*" : columns.split(",").map(ident).join(",");
      let query = `select ${selected} from ${ident(table)}${where ? ` where ${where}` : ""}`;
      if (ordering) query += ` order by ${ordering}`;
      if (limit !== null) { query += ` limit ${limit} offset ${offset}`; }
      const result = await sql(query, params);
      return { data: single ? result.rows[0] ?? null : result.rows, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code, message: error.message } };
    }
  }
  return chain;
}

async function academicSnapshot(profileId, sql) {
  const courses = (await sql("select * from courses where profile_id=$1 order by id", [profileId])).rows;
  const dashboard = (await sql("select payload from dashboard_state where profile_id=$1", [profileId])).rows[0].payload;
  return { courses, dashboard };
}
