import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FILE = {
  keep: "11111111-1111-4111-8111-111111111111",
  moveRoot: "22222222-2222-4222-8222-222222222222",
  moveCustom: "33333333-3333-4333-8333-333333333333",
  explicitCustom: "44444444-4444-4444-8444-444444444444",
  otherCourse: "55555555-5555-4555-8555-555555555555",
  trashed: "66666666-6666-4666-8666-666666666666",
  tombstone: "77777777-7777-4777-8777-777777777777",
  root: "88888888-8888-4888-8888-888888888888",
};

const course = (id, code, name, color = "#224466") => ({
  id, code, name, credits: 3, instructor: "Instructor", room: "Room 1",
  color, soft_color: `${color}18`, initials: "BI",
});
const dashboard = (courseDetails = {}) => ({
  v: 2, a: "day", w: [], t: [], n: "",
  d: { assignments: [], manualEvents: [], courseDetails },
});
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("managed course folder migration reconciles course lifecycle without losing file state", async (t) => {
  const pg = new PGlite();
  const sql = (statement, params = []) => pg.query(statement, params, {
    parsers: { 1184: (value) => value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") },
  });
  const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

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
    await pg.exec(await migration("20260903000000_workspace_persistence.sql"));
    await pg.exec(await migration("20260904000000_google_accounts.sql"));

    const profileFor = async (authId) => {
      await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [authId]);
      return (await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [authId])).rows[0];
    };
    const a = await profileFor(USER_A);
    const b = await profileFor(USER_B);
    const c = await profileFor(USER_C);
    const coursesA = [course("bio-a", "BIO 101", "Biology"), course("bio-b", "BIO 102", "Biology", "#446688")];
    const coursesB = [course("bio-a", "BIO 101-B", "Biology")];
    const committedSyllabus = "Committed Biology syllabus — résumé, labs, and exam dates.\n";
    const dashboardA = dashboard({ "bio-a": { syllabusText: committedSyllabus, syllabusName: "Biology course guide" } });
    await sql("select initialize_account_workspace($1, $2, $3)", [a.id, JSON.stringify(coursesA), JSON.stringify(dashboardA)]);
    await sql("select initialize_account_workspace($1, $2, $3)", [b.id, JSON.stringify(coursesB), JSON.stringify(dashboard())]);
    await pg.exec(await migration("20260905000000_persistence_foundation.sql"));
    await pg.exec(await migration("20260907000000_private_files.sql"));
    await pg.exec(await migration("20261008000000_onboarding_details.sql"));
    await pg.exec(await migration("20261008010000_file_organization.sql"));
    await pg.exec(await migration("20261008020000_file_content_api.sql"));

    const customFolderId = "99999999-9999-4999-8999-999999999999";
    const folder = async (profile, auth, operation, id, revision, metadata = {}) => (await sql(
      "select mutate_account_folder($1,$2,$3,$4,$5,$6) as value",
      [profile, auth, operation, id, revision, JSON.stringify(metadata)],
    )).rows[0].value;
    const createdCustom = await folder(a.id, USER_A, "create", customFolderId, null, { name: "Personal research" });
    assert.equal(createdCustom.kind, "custom");

    const uploadBytes = new Map();
    const readyUpload = async (id, name, courseId, folderId = null) => {
      const bytes = Buffer.from(`original upload bytes for ${name}\n`);
      uploadBytes.set(id, bytes);
      const metadata = {
        name, mime: "text/plain", size: bytes.byteLength, sha256: digest(bytes),
        kind: "attachment", courseId: courseId ?? "", assignmentId: "",
        ...(folderId ? { folderId } : {}),
      };
      await sql("select mutate_account_file($1,$2,$3,'reserve',null,$4)", [a.id, USER_A, id, JSON.stringify(metadata)]);
      await sql("select mutate_account_file($1,$2,$3,'ready')", [a.id, USER_A, id]);
      await sql("insert into storage.objects(bucket_id,name,body) values('eduessentials-private',$1,$2)", [`${a.id}/${id}`, bytes]);
    };
    await readyUpload(FILE.keep, "Biology lab notes.txt", "bio-a");
    await readyUpload(FILE.moveRoot, "Biology reference.txt", "bio-a");
    await readyUpload(FILE.moveCustom, "Biology checklist.txt", "bio-a");
    await readyUpload(FILE.explicitCustom, "Chosen location.txt", "bio-a", customFolderId);
    await readyUpload(FILE.otherCourse, "Second Biology.txt", "bio-b");
    await readyUpload(FILE.trashed, "Trashed Biology.txt", "bio-b", customFolderId);
    const trashedRevision = (await sql("select metadata_revision from user_files where profile_id=$1 and id=$2", [a.id, FILE.trashed])).rows[0].metadata_revision;
    await sql("select mutate_account_file_location($1,$2,$3,'trash',$4,'{}')", [a.id, USER_A, FILE.trashed, trashedRevision]);
    await readyUpload(FILE.tombstone, "Old tombstone.txt", "bio-a");
    await sql("update user_files set state='deleting', deleted_at=clock_timestamp() where profile_id=$1 and id=$2", [a.id, FILE.tombstone]);
    await readyUpload(FILE.root, "Personal root.txt", null);

    const trackedColumns = "id,course_id,assignment_id,state,deleted_at,trashed_at,trash_operation_id,original_folder_id,folder_id,content_sha256,size_bytes,object_path";
    const beforeMigration = (await sql(`select ${trackedColumns} from user_files where profile_id=$1 order by id`, [a.id])).rows;
    const storageBefore = (await sql("select name,body from storage.objects where name like $1 order by name", [`${a.id}/%`])).rows;
    await pg.exec(await migration("20261008040000_managed_course_folders.sql"));
    await pg.exec(`
      create table public.lifecycle_preserve_attempts(profile_id uuid not null);
      create function public.lifecycle_watch_preserved_syllabus()
      returns trigger language plpgsql as $$
      begin
        if new.kind = 'syllabus' and new.content_backend = 'native-text' then
          insert into public.lifecycle_preserve_attempts(profile_id) values(new.profile_id);
        end if;
        return new;
      end;
      $$;
      create trigger lifecycle_watch_preserved_syllabus before insert on public.user_files
        for each row execute function public.lifecycle_watch_preserved_syllabus();
    `);

    const managed = async (profile, courseId) => (await sql(
      "select * from file_folders where profile_id=$1 and kind='course' and course_id=$2",
      [profile, courseId],
    )).rows[0];
    let folderA = await managed(a.id, "bio-a");
    const folderB = await managed(a.id, "bio-b");
    const folderOtherAccount = await managed(b.id, "bio-a");

    await t.test("one-time backfill follows course IDs and preserves selected locations, Trash, tombstones, digests, and bytes", async () => {
      assert.ok(folderA);
      assert.ok(folderB);
      assert.notEqual(folderA.id, folderB.id);
      assert.notEqual(folderA.id, folderOtherAccount.id, "the same course ID in another account gets another folder");
      assert.equal(folderA.name, "Biology");
      assert.equal(folderB.name, "Biology");
      assert.equal(folderA.course_code, "BIO 101");
      assert.equal(folderB.course_code, "BIO 102");

      const afterMigration = (await sql(`select ${trackedColumns} from user_files where profile_id=$1 order by id`, [a.id])).rows;
      const beforeById = new Map(beforeMigration.map((file) => [file.id, file]));
      for (const file of afterMigration) {
        const before = beforeById.get(file.id);
        assert.equal(file.course_id, before.course_id);
        assert.equal(file.assignment_id, before.assignment_id);
        assert.equal(file.state, before.state);
        assert.equal(file.deleted_at, before.deleted_at);
        assert.equal(file.trashed_at, before.trashed_at);
        assert.equal(file.trash_operation_id, before.trash_operation_id);
        assert.equal(file.original_folder_id, before.original_folder_id);
        assert.equal(file.content_sha256, before.content_sha256);
        assert.equal(file.size_bytes, before.size_bytes);
        assert.equal(file.object_path, before.object_path);
      }
      const located = Object.fromEntries(afterMigration.map((file) => [file.id, file.folder_id]));
      assert.equal(located[FILE.keep], folderA.id);
      assert.equal(located[FILE.moveRoot], folderA.id);
      assert.equal(located[FILE.moveCustom], folderA.id);
      assert.equal(located[FILE.otherCourse], folderB.id);
      assert.equal(located[FILE.explicitCustom], customFolderId, "a user-selected custom folder is untouched");
      assert.equal(located[FILE.trashed], null, "Trash remains at its recoverable location");
      assert.equal(located[FILE.tombstone], null, "permanent tombstones are excluded from backfill");
      assert.equal(located[FILE.root], null, "unassociated files remain at the Files root");
      assert.deepEqual((await sql("select name,body from storage.objects where name like $1 order by name", [`${a.id}/%`])).rows, storageBefore);

      const trashedFile = afterMigration.find((file) => file.id === FILE.trashed);
      assert.equal(trashedFile.original_folder_id, customFolderId);
      assert.ok(trashedFile.trashed_at);
      const tombstone = afterMigration.find((file) => file.id === FILE.tombstone);
      assert.ok(tombstone.deleted_at);
      assert.equal(tombstone.state, "deleting");
    });

    const moveFile = async (id, folderId) => {
      const revision = (await sql("select metadata_revision from user_files where profile_id=$1 and id=$2", [a.id, id])).rows[0].metadata_revision;
      return (await sql("select mutate_account_file_location($1,$2,$3,'move',$4,$5) as value", [
        a.id, USER_A, id, revision, JSON.stringify({ folderId }),
      ])).rows[0].value;
    };
    await moveFile(FILE.moveRoot, null);
    await moveFile(FILE.moveCustom, customFolderId);

    await t.test("course name and code reconciliation preserves folder identity and never reclaims moved files", async () => {
      const academicBeforeArchive = {
        courses: (await sql("select * from courses where profile_id=$1 order by id", [a.id])).rows,
        dashboard: (await sql("select payload from dashboard_state where profile_id=$1", [a.id])).rows[0].payload,
      };
      let archived = await folder(a.id, USER_A, "archive", folderA.id, Number(folderA.revision), { semesterLabel: "Fall 2026" });
      assert.equal(archived.semester_label, "Fall 2026");
      assert.equal(archived.course_name_snapshot, "Biology");
      assert.equal(archived.course_color_snapshot, "#224466");
      assert.deepEqual({
        courses: (await sql("select * from courses where profile_id=$1 order by id", [a.id])).rows,
        dashboard: (await sql("select payload from dashboard_state where profile_id=$1", [a.id])).rows[0].payload,
      }, academicBeforeArchive, "archiving a managed folder does not alter course records or dashboard state");
      await sql("update app_profiles set current_term='Spring 2027' where id=$1", [a.id]);
      const beforeCodeRevision = Number(archived.revision);
      const current = [...coursesA].map((item) => ({ ...item }));
      current.find((item) => item.id === "bio-a").code = "BIO 110";
      await sql("select save_account_workspace($1,$2,$3,$4,$5)", [
        a.id, USER_A, (await sql("select updated_at from dashboard_state where profile_id=$1", [a.id])).rows[0].updated_at,
        JSON.stringify(current), JSON.stringify(dashboardA),
      ]);
      let reconciled = await managed(a.id, "bio-a");
      assert.equal(reconciled.id, folderA.id);
      assert.equal(reconciled.course_code, "BIO 110");
      assert.ok(Number(reconciled.revision) > beforeCodeRevision, "changing only the course code advances the folder revision");
      assert.equal(reconciled.semester_label, "Fall 2026");
      assert.equal(reconciled.course_name_snapshot, "Biology");
      assert.equal(reconciled.course_color_snapshot, "#224466");

      const renamed = current.map((item) => ({ ...item }));
      Object.assign(renamed.find((item) => item.id === "bio-a"), { name: "Human Biology", color: "#6688aa", soft_color: "#6688aa18" });
      await sql("select save_account_workspace($1,$2,$3,$4,$5)", [
        a.id, USER_A, (await sql("select updated_at from dashboard_state where profile_id=$1", [a.id])).rows[0].updated_at,
        JSON.stringify(renamed), JSON.stringify(dashboardA),
      ]);
      reconciled = await managed(a.id, "bio-a");
      assert.equal(reconciled.id, folderA.id);
      assert.equal(reconciled.name, "Human Biology");
      assert.equal(reconciled.course_code, "BIO 110");
      assert.equal(reconciled.semester_label, "Fall 2026");
      assert.equal(reconciled.course_name_snapshot, "Biology", "archive labels keep the captured name through later course edits");
      assert.equal(reconciled.course_color_snapshot, "#224466");
      assert.equal((await sql("select folder_id from user_files where profile_id=$1 and id=$2", [a.id, FILE.moveRoot])).rows[0].folder_id, null);
      assert.equal((await sql("select folder_id from user_files where profile_id=$1 and id=$2", [a.id, FILE.moveCustom])).rows[0].folder_id, customFolderId);

      const beforeUnarchive = {
        courses: (await sql("select * from courses where profile_id=$1 order by id", [a.id])).rows,
        dashboard: (await sql("select payload from dashboard_state where profile_id=$1", [a.id])).rows[0].payload,
      };
      const unarchived = await folder(a.id, USER_A, "unarchive", reconciled.id, Number(reconciled.revision), {});
      assert.equal(unarchived.archived_at, null);
      assert.equal(unarchived.semester_label, null);
      assert.deepEqual({
        courses: (await sql("select * from courses where profile_id=$1 order by id", [a.id])).rows,
        dashboard: (await sql("select payload from dashboard_state where profile_id=$1", [a.id])).rows[0].payload,
      }, beforeUnarchive, "archiving and unarchiving file folders do not alter academic state");
      folderA = unarchived;
    });

    const currentCourses = async (profile) => (await sql("select id,code,name,credits,instructor,room,color,soft_color,initials from courses where profile_id=$1 order by id", [profile])).rows;
    const currentDashboard = async (profile) => (await sql("select payload from dashboard_state where profile_id=$1", [profile])).rows[0].payload;
    const workspaceRevision = async (profile) => (await sql("select updated_at from dashboard_state where profile_id=$1", [profile])).rows[0].updated_at;
    const saveWorkspace = (profile, auth, courses, state, revision) => sql(
      "select save_account_workspace($1,$2,$3,$4,$5) as revision",
      [profile, auth, revision, JSON.stringify(courses), JSON.stringify(state)],
    );

    await t.test("course deletion preserves the committed syllabus and uploads in a detached archive; same-ID recreation starts a new lifecycle", async () => {
      const beforeDeleteFolder = await managed(a.id, "bio-a");
      const beforeDeleteFile = (await sql("select * from user_files where profile_id=$1 and id=$2", [a.id, FILE.keep])).rows[0];
      const beforeDeleteBytes = (await sql("select body from storage.objects where name=$1", [beforeDeleteFile.object_path])).rows[0].body;
      const beforeDelete = await currentCourses(a.id);
      const expectedRevision = await workspaceRevision(a.id);
      const remainingCourses = beforeDelete.filter((item) => item.id !== "bio-a");
      const remainingDashboard = dashboard();
      await saveWorkspace(a.id, USER_A, remainingCourses, remainingDashboard, expectedRevision);

      const preservedFolder = (await sql("select * from file_folders where profile_id=$1 and id=$2", [a.id, beforeDeleteFolder.id])).rows[0];
      assert.equal(preservedFolder.kind, "custom");
      assert.equal(preservedFolder.course_id, null);
      assert.equal(preservedFolder.parent_id, null);
      assert.equal(preservedFolder.name, "Human Biology");
      assert.equal(preservedFolder.course_code, "BIO 110");
      assert.ok(preservedFolder.archived_at);
      assert.equal(preservedFolder.semester_label, "Deleted courses");
      assert.equal(preservedFolder.course_name_snapshot, "Human Biology");
      assert.equal(preservedFolder.course_color_snapshot, "#6688aa");

      const preservedRows = (await sql(`
        select f.*, d.body from user_files f
        join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id
        where f.profile_id=$1 and d.body=$2
      `, [a.id, committedSyllabus])).rows;
      assert.equal(preservedRows.length, 1);
      const preserved = preservedRows[0];
      assert.equal(preserved.folder_id, beforeDeleteFolder.id);
      assert.equal(preserved.content_backend, "native-text");
      assert.equal(preserved.kind, "syllabus");
      assert.equal(preserved.name, "Biology course guide.txt");
      assert.equal(preserved.size_bytes, Buffer.byteLength(committedSyllabus, "utf8"));
      assert.equal(preserved.content_sha256, digest(Buffer.from(committedSyllabus, "utf8")));
      const filesAfterDelete = (await sql("select id,course_id,folder_id,assignment_id,object_path,content_sha256 from user_files where profile_id=$1 and id=any($2::uuid[]) order by id", [a.id, [FILE.keep, FILE.moveRoot, FILE.moveCustom, FILE.explicitCustom]])).rows;
      assert.equal(filesAfterDelete.find((file) => file.id === FILE.keep).course_id, null);
      assert.equal(filesAfterDelete.find((file) => file.id === FILE.keep).folder_id, beforeDeleteFolder.id);
      assert.equal(filesAfterDelete.find((file) => file.id === FILE.moveRoot).folder_id, null);
      assert.equal(filesAfterDelete.find((file) => file.id === FILE.moveCustom).folder_id, customFolderId);
      assert.equal(filesAfterDelete.find((file) => file.id === FILE.explicitCustom).folder_id, customFolderId);
      assert.deepEqual((await sql("select body from storage.objects where name=$1", [beforeDeleteFile.object_path])).rows[0].body, beforeDeleteBytes);
      assert.equal((await sql("select course_id from user_files where profile_id=$1 and id=$2", [a.id, FILE.otherCourse])).rows[0].course_id, "bio-b");

      // Simulate the client retrying a committed delete after losing its response.
      await assert.rejects(saveWorkspace(a.id, USER_A, remainingCourses, remainingDashboard, expectedRevision), { code: "40001" });
      assert.equal((await sql("select count(*)::int as count from native_file_documents where profile_id=$1 and file_id=$2", [a.id, preserved.id])).rows[0].count, 1);

      const recreated = course("bio-a", "BIO 201", "Biology Reopened", "#335577");
      const recreatedCourses = [...remainingCourses, recreated];
      const recreatedText = "Syllabus for the recreated Biology course.";
      const recreatedDashboard = dashboard({ "bio-a": { syllabusText: recreatedText, syllabusName: "Reopened syllabus" } });
      await saveWorkspace(a.id, USER_A, recreatedCourses, recreatedDashboard, await workspaceRevision(a.id));
      const newManagedFolder = await managed(a.id, "bio-a");
      assert.ok(newManagedFolder);
      assert.notEqual(newManagedFolder.id, preservedFolder.id, "reusing a course ID starts a different folder lifecycle");
      assert.equal((await sql("select count(*)::int as count from file_folders where profile_id=$1 and id=$2 and kind='custom' and course_id is null", [a.id, preservedFolder.id])).rows[0].count, 1);

      const expectedSecondRevision = await workspaceRevision(a.id);
      await saveWorkspace(a.id, USER_A, remainingCourses, dashboard(), expectedSecondRevision);
      const secondPreserved = (await sql("select f.id,f.folder_id,d.body from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id where f.profile_id=$1 and d.body=$2", [a.id, recreatedText])).rows;
      assert.equal(secondPreserved.length, 1);
      assert.equal(secondPreserved[0].folder_id, newManagedFolder.id);
      assert.notEqual(secondPreserved[0].id, preserved.id, "preserved document identity follows the new folder lifecycle");
      assert.equal((await sql("select count(*)::int as count from native_file_documents where profile_id=$1 and body in ($2,$3)", [a.id, committedSyllabus, recreatedText])).rows[0].count, 2);
      assert.equal((await managed(b.id, "bio-a")).id, folderOtherAccount.id, "other accounts keep their independent same-ID course folder");
    });

    await t.test("initialization and service RPC writes create managed folders while raw role writes stay closed", async () => {
      const courseFromInitialize = course("init-course", "INIT 100", "Initialized course");
      const cascadeSyllabus = "Committed text is preserved only for an ordinary course deletion.";
      const initializedDashboard = dashboard({ "init-course": { syllabusText: cascadeSyllabus, syllabusName: "Cascade syllabus" } });
      await pg.exec("set role service_role");
      try {
        await sql("select initialize_account_workspace($1,$2,$3)", [c.id, JSON.stringify([courseFromInitialize]), JSON.stringify(initializedDashboard)]);
        const initializedFolder = await managed(c.id, courseFromInitialize.id);
        assert.ok(initializedFolder);
        assert.equal(initializedFolder.course_code, "INIT 100");
        await sql("select initialize_account_workspace($1,$2,$3)", [c.id, JSON.stringify([courseFromInitialize]), JSON.stringify(initializedDashboard)]);
        assert.equal((await sql("select count(*)::int as count from file_folders where profile_id=$1 and course_id=$2 and kind='course'", [c.id, courseFromInitialize.id])).rows[0].count, 1,
          "repeated initialization cannot duplicate a managed folder");

        await assert.rejects(sql("insert into courses(profile_id,id,code,name,instructor,room,color,soft_color,initials) values($1,'raw-denied','RAW','Raw course','','','#000000','#00000018','RA')", [c.id]), /permission denied/);

        const manual = course("manual-course", "MAN 210", "Manually created course");
        const profileRevision = await workspaceRevision(c.id);
        await sql("select save_account_workspace($1,$2,$3,$4,$5)", [c.id, USER_C, profileRevision, JSON.stringify([courseFromInitialize, manual]), JSON.stringify(initializedDashboard)]);
        const manualFolder = await managed(c.id, manual.id);
        assert.ok(manualFolder, "service_role can still create courses through the profile-locking workspace RPC");
        assert.equal(manualFolder.course_code, "MAN 210");
      } finally {
        await pg.exec("reset role");
      }

      const cascadeUploadIds = ["aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2"];
      const cascadeManagedFolder = await managed(c.id, courseFromInitialize.id);
      for (const [index, id] of cascadeUploadIds.entries()) {
        const bytes = Buffer.from(`account-cascade upload ${index}`);
        await sql("select mutate_account_file($1,$2,$3,'reserve',null,$4)", [c.id, USER_C, id, JSON.stringify({
          name: `Cascade ${index}.txt`, mime: "text/plain", size: bytes.length, sha256: digest(bytes),
          kind: "resource", courseId: courseFromInitialize.id, assignmentId: "", folderId: cascadeManagedFolder.id,
        })]);
        await sql("select mutate_account_file($1,$2,$3,'ready')", [c.id, USER_C, id]);
        await sql("insert into storage.objects(bucket_id,name,body) values('eduessentials-private',$1,$2)", [`${c.id}/${id}`, bytes]);
      }
      const trashedCascadeRevision = (await sql("select metadata_revision from user_files where profile_id=$1 and id=$2", [c.id, cascadeUploadIds[1]])).rows[0].metadata_revision;
      await sql("select mutate_account_file_location($1,$2,$3,'trash',$4,'{}')", [c.id, USER_C, cascadeUploadIds[1], trashedCascadeRevision]);
      const recoverableBeforeCascade = (await sql("select original_folder_id,trashed_at from user_files where profile_id=$1 and id=$2", [c.id, cascadeUploadIds[1]])).rows[0];
      assert.equal(recoverableBeforeCascade.original_folder_id, cascadeManagedFolder.id);
      assert.ok(recoverableBeforeCascade.trashed_at);

      await pg.exec("set role authenticated");
      try {
        await assert.rejects(sql("insert into courses(profile_id,id,code,name,instructor,room,color,soft_color,initials) values($1,'browser-denied','RAW','Raw course','','','#000000','#00000018','RA')", [c.id]), /permission denied/);
      } finally {
        await pg.exec("reset role");
      }

      assert.equal((await sql("select payload->'d'->'courseDetails'->'init-course'->>'syllabusText' as text from dashboard_state where profile_id=$1", [c.id])).rows[0].text, cascadeSyllabus);
      assert.equal((await sql("select count(*)::int as count from user_files where profile_id=$1", [c.id])).rows[0].count, 2);
      await sql("delete from auth.users where id=$1", [USER_C]);
      assert.equal((await sql("select count(*)::int as count from app_profiles where id=$1", [c.id])).rows[0].count, 0,
        "deleting the authenticated user cascades its app profile");
      for (const table of ["courses", "dashboard_state", "file_folders", "user_files", "native_file_documents", "file_activity", "folder_activity"]) {
        assert.equal((await sql(`select count(*)::int as count from ${table} where profile_id=$1`, [c.id])).rows[0].count, 0,
          `account cascade removes all ${table} rows`);
      }
      assert.equal((await sql("select count(*)::int as count from lifecycle_preserve_attempts where profile_id=$1", [c.id])).rows[0].count, 0,
        "account deletion skips creating a replacement syllabus document");
    });

    await t.test("failed syllabus preservation rolls back course and folder changes at UTF-8 and account file limits", async () => {
      const tooLarge = course("large-syllabus", "BIO 999", "Large syllabus course");
      const beforeLarge = await currentCourses(a.id);
      await saveWorkspace(a.id, USER_A, [...beforeLarge, tooLarge], await currentDashboard(a.id), await workspaceRevision(a.id));
      const tooLargeBody = "é".repeat(524_289);
      const oversizedDashboard = dashboard({ "large-syllabus": { syllabusText: tooLargeBody } });
      await sql("update dashboard_state set payload=$2 where profile_id=$1", [a.id, JSON.stringify(oversizedDashboard)]);
      const largeExpected = await workspaceRevision(a.id);
      const afterLargeInsert = await currentCourses(a.id);
      await assert.rejects(saveWorkspace(a.id, USER_A, afterLargeInsert.filter((item) => item.id !== tooLarge.id), dashboard(), largeExpected), {
        code: "P0001", message: /PRESERVE_COURSE_SYLLABUS: pasted syllabus exceeds the 1 MiB native document limit/,
      });
      assert.ok((await sql("select 1 from courses where profile_id=$1 and id=$2", [a.id, tooLarge.id])).rows[0]);
      assert.ok((await managed(a.id, tooLarge.id)), "the course folder remains managed after a failed delete");
      assert.equal((await sql("select payload from dashboard_state where profile_id=$1", [a.id])).rows[0].payload.d.courseDetails[tooLarge.id].syllabusText, tooLargeBody);
      assert.equal((await sql("select count(*)::int as count from native_file_documents where profile_id=$1 and body=$2", [a.id, tooLargeBody])).rows[0].count, 0);

      const capacityCourse = course("capacity-course", "BIO 998", "Capacity course");
      const beforeCapacity = await currentCourses(a.id);
      await saveWorkspace(a.id, USER_A, [...beforeCapacity, capacityCourse], dashboard({ "capacity-course": { syllabusText: "Small syllabus at capacity" } }), await workspaceRevision(a.id));
      const activeCount = (await sql("select count(*)::int as count from user_files where profile_id=$1 and deleted_at is null", [a.id])).rows[0].count;
      assert.ok(activeCount < 1000);
      const remaining = 1000 - activeCount;
      await sql(`
        with account as (select $1::uuid as profile_id),
          ids as (select gen_random_uuid() as id from generate_series(1,$2::int))
        insert into user_files(profile_id,id,kind,name,mime_type,size_bytes,object_path)
        select account.profile_id, ids.id, 'resource', 'Capacity fixture', 'text/plain', 0,
          account.profile_id::text || '/' || ids.id::text from account cross join ids
      `, [a.id, remaining]);
      const atCapacity = await currentCourses(a.id);
      const capacityRevision = await workspaceRevision(a.id);
      await assert.rejects(saveWorkspace(a.id, USER_A, atCapacity.filter((item) => item.id !== capacityCourse.id), dashboard(), capacityRevision), {
        code: "P0001", message: /PRESERVE_COURSE_SYLLABUS: account file limit of 1000 reached/,
      });
      assert.ok((await sql("select 1 from courses where profile_id=$1 and id=$2", [a.id, capacityCourse.id])).rows[0]);
      assert.ok((await managed(a.id, capacityCourse.id)), "the capacity failure rolls back folder detachment");
      assert.equal((await sql("select count(*)::int as count from native_file_documents where profile_id=$1 and body='Small syllabus at capacity'", [a.id])).rows[0].count, 0);
      assert.equal((await sql("select count(*)::int as count from user_files where profile_id=$1 and deleted_at is null", [a.id])).rows[0].count, 1000);
    });
  } finally {
    await pg.close();
  }
});
