import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const USERS = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const FILES = {
  lower: "a1111111-a111-4111-8111-a11111111111",
  upper: "b2222222-b222-4222-8222-b22222222222",
  foreign: "c3333333-c333-4333-8333-c33333333333",
  missing: "d9999999-d999-4999-8999-d99999999999",
};
const migrationFiles = [
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
  "20261009110000_file_release_integrity.sql",
  "20261010000000_nonretryable_conflicts.sql",
  "20261010010000_workspace_save_efficiency.sql",
];

const course = (id, name) => ({
  id, code: id === "history" ? "HIST 205" : "BIO 110", name, credits: 3,
  instructor: "", room: "", color: "#224466", soft_color: "#22446618",
  initials: id === "history" ? "HI" : "BI",
});
const initialCourses = [course("history", "History"), course("biology", "Biology")];
const dashboard = (courseDetails = {}, syllabusDrafts = []) => ({
  v: 2, a: "day", w: [], t: [], n: "",
  d: { assignments: [], manualEvents: [], courseDetails, syllabusDrafts },
});

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

  for (const file of migrationFiles.slice(0, 2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const profiles = {};
  for (const authId of Object.values(USERS)) {
    await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [authId]);
    profiles[authId] = (await sql(
      "update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [authId],
    )).rows[0];
    await sql("select initialize_account_workspace($1,$2,$3)", [
      profiles[authId].id, JSON.stringify(initialCourses), JSON.stringify(dashboard()),
    ]);
  }

  for (const file of migrationFiles.slice(2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }

  const revision = async (profileId) => (await sql(
    "select updated_at from public.dashboard_state where profile_id=$1", [profileId],
  )).rows[0].updated_at;
  const payload = async (profileId) => (await sql(
    "select payload from public.dashboard_state where profile_id=$1", [profileId],
  )).rows[0].payload;
  const courses = async (profileId) => (await sql(
    "select id,code,name,credits,instructor,room,color,soft_color,initials from public.courses where profile_id=$1 order by id",
    [profileId],
  )).rows;
  const save = async (profileId, authId, nextDashboard, nextCourses, expectedRevision) => {
    expectedRevision ??= await revision(profileId);
    nextCourses ??= await courses(profileId);
    return sql("select public.save_account_workspace($1,$2,$3,$4,$5) as revision", [
      profileId, authId, expectedRevision, JSON.stringify(nextCourses), JSON.stringify(nextDashboard),
    ]);
  };
  const uploadSyllabus = async (profileId, authId, fileId) => {
    const metadata = {
      name: "Source.txt", mime: "text/plain", size: 1,
      sha256: "a".repeat(64), kind: "syllabus", courseId: "history", assignmentId: "",
    };
    await sql("select public.mutate_account_file($1,$2,$3,'reserve',null,$4)", [
      profileId, authId, fileId, JSON.stringify(metadata),
    ]);
    await sql("select public.mutate_account_file($1,$2,$3,'ready')", [profileId, authId, fileId]);
  };

  return { pg, sql, profiles, revision, payload, courses, save, uploadSyllabus };
}

test("unchanged course rows and managed folder revisions are untouched while changed courses sync", async (t) => {
  const fixture = await setup();
  const { pg, sql, profiles, payload, courses, save } = fixture;
  t.after(() => pg.close());
  const profileId = profiles[USERS.a].id;
  const beforeCourse = (await sql(
    "select updated_at from public.courses where profile_id=$1 and id='history'", [profileId],
  )).rows[0].updated_at;
  const beforeFolder = (await sql(
    "select id, name, course_code, revision, updated_at from public.file_folders where profile_id=$1 and kind='course' and course_id='history'",
    [profileId],
  )).rows[0];

  await save(profileId, USERS.a, await payload(profileId), await courses(profileId));
  const afterNoopCourse = (await sql(
    "select updated_at from public.courses where profile_id=$1 and id='history'", [profileId],
  )).rows[0].updated_at;
  const afterNoopFolder = (await sql(
    "select revision, updated_at from public.file_folders where profile_id=$1 and id=$2", [profileId, beforeFolder.id],
  )).rows[0];
  assert.equal(afterNoopCourse, beforeCourse, "an identical course snapshot skips its update trigger");
  assert.deepEqual(afterNoopFolder, { revision: beforeFolder.revision, updated_at: beforeFolder.updated_at });

  const changedCourses = await courses(profileId);
  changedCourses.find((item) => item.id === "history").name = "World History";
  await save(profileId, USERS.a, await payload(profileId), changedCourses);
  const changedCourse = (await sql(
    "select name, updated_at from public.courses where profile_id=$1 and id='history'", [profileId],
  )).rows[0];
  const changedFolder = (await sql(
    "select name, course_code, revision, updated_at from public.file_folders where profile_id=$1 and id=$2", [profileId, beforeFolder.id],
  )).rows[0];
  assert.equal(changedCourse.name, "World History");
  assert.notEqual(changedCourse.updated_at, beforeCourse);
  assert.equal(changedFolder.name, "World History");
  assert.equal(changedFolder.course_code, beforeFolder.course_code);
  assert.equal(Number(changedFolder.revision), Number(beforeFolder.revision) + 1);
  assert.notEqual(changedFolder.updated_at, beforeFolder.updated_at);
});

test("syllabus IDs are UUID-validated, owner-scoped, lowercase-canonical, and duplicate-safe", async (t) => {
  const fixture = await setup();
  const { pg, sql, profiles, revision, payload, save, uploadSyllabus } = fixture;
  t.after(() => pg.close());
  const profileId = profiles[USERS.a].id;
  const foreignProfileId = profiles[USERS.b].id;
  await uploadSyllabus(profileId, USERS.a, FILES.lower);
  await uploadSyllabus(profileId, USERS.a, FILES.upper);
  await uploadSyllabus(foreignProfileId, USERS.b, FILES.foreign);

  const attached = dashboard({
    history: { syllabusFileId: FILES.lower },
    biology: { syllabusFileId: FILES.upper },
  }, [{ id: "draft-history", sourceFileId: FILES.lower }]);
  await save(profileId, USERS.a, attached);
  const fileCourses = (await sql(
    "select id, course_id from public.user_files where profile_id=$1 and id=any($2::uuid[]) order by id",
    [profileId, [FILES.lower, FILES.upper]],
  )).rows;
  assert.deepEqual(fileCourses, [
    { id: FILES.lower, course_id: "history" },
    { id: FILES.upper, course_id: "biology" },
  ]);

  const assertUnknownFile = async (courseDetails, syllabusDrafts = []) => {
    const beforeRevision = await revision(profileId);
    const beforePayload = await payload(profileId);
    await assert.rejects(
      save(profileId, USERS.a, dashboard(courseDetails, syllabusDrafts)),
      (error) => error.code === "23503",
    );
    assert.equal(await revision(profileId), beforeRevision);
    assert.deepEqual(await payload(profileId), beforePayload);
  };
  await assertUnknownFile({ history: { syllabusFileId: "not-a-uuid" } });
  await assertUnknownFile({ history: { syllabusFileId: FILES.lower.toUpperCase() } });
  await assertUnknownFile({ history: { syllabusFileId: FILES.missing } });
  await assertUnknownFile({ history: { syllabusFileId: FILES.foreign } });
  await assertUnknownFile({}, [{ id: "draft-invalid", sourceFileId: "not-a-uuid" }]);

  const mixedCaseDuplicate = dashboard({
    history: { syllabusFileId: FILES.lower },
    biology: { syllabusFileId: FILES.lower.toUpperCase() },
  });
  await assertUnknownFile(mixedCaseDuplicate.d.courseDetails);

  const lowercaseDuplicate = dashboard({
    history: { syllabusFileId: FILES.lower },
    biology: { syllabusFileId: FILES.lower },
  });
  const beforeDuplicateRevision = await revision(profileId);
  await assert.rejects(
    save(profileId, USERS.a, lowercaseDuplicate),
    (error) => error.code === "23514",
  );
  assert.equal(await revision(profileId), beforeDuplicateRevision);
});

test("stale workspace revisions return PT409 without writing the candidate snapshot", async (t) => {
  const fixture = await setup();
  const { pg, sql, profiles, revision, payload, courses, save } = fixture;
  t.after(() => pg.close());
  const profileId = profiles[USERS.a].id;
  const staleRevision = await revision(profileId);

  const winner = dashboard();
  winner.n = "saved by another session";
  await save(profileId, USERS.a, winner);

  const beforeConflictPayload = await payload(profileId);
  const beforeConflictRevision = await revision(profileId);
  const staleCourses = await courses(profileId);
  staleCourses.find((item) => item.id === "history").name = "Must not be written";
  await assert.rejects(
    save(profileId, USERS.a, dashboard(), staleCourses, staleRevision),
    (error) => error.code === "PT409",
  );
  assert.equal(await revision(profileId), beforeConflictRevision);
  assert.deepEqual(await payload(profileId), beforeConflictPayload);
  assert.equal((await sql(
    "select name from public.courses where profile_id=$1 and id='history'", [profileId],
  )).rows[0].name, "History");
});
