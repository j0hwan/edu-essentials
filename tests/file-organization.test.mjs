import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const READY_FILE = "11111111-1111-4111-8111-111111111111";
const PENDING_FILE = "22222222-2222-4222-8222-222222222222";
const DELETED_FILE = "33333333-3333-4333-8333-333333333333";
const ROOT_FOLDER = "44444444-4444-4444-8444-444444444444";
const CHILD_FOLDER = "55555555-5555-4555-8555-555555555555";
const DUPLICATE_FOLDER = "66666666-6666-4666-8666-666666666666";
const TRASHED_FOLDER = "77777777-7777-4777-8777-777777777777";
const SELF_FOLDER = "77777777-1111-4111-8111-111111111111";
const EMPTY_DOCUMENT = "88888888-8888-4888-8888-888888888888";
const ASSOCIATED_DOCUMENT = "99999999-9999-4999-8999-999999999999";
const FOREIGN_DOCUMENT = "bbbbbbbb-1111-4111-8111-111111111111";
const CAP_DOCUMENT = "dddddddd-1111-4111-8111-111111111111";
const OVER_CAP_DOCUMENT = "dddddddd-2222-4222-8222-222222222222";
const OLD_TOMBSTONE_B = "eeeeeeee-1111-4111-8111-111111111111";
const MANAGED_FOLDER = "eeeeeeee-2222-4222-8222-222222222222";
const SERVICE_FOLDER = "eeeeeeee-3333-4333-8333-333333333333";
const SERVICE_DOCUMENT = "eeeeeeee-4444-4444-8444-444444444444";
const BROKEN_NATIVE_FILE = "eeeeeeee-5555-4555-8555-555555555555";
const OPERATION_ID = "cccccccc-1111-4111-8111-111111111111";
const digest = "a".repeat(64);
const dashboard = {
  v: 1,
  a: "day",
  w: [],
  n: "",
  d: { assignments: [{ id: "assignment-a", courseId: "course-a" }] },
};
const course = (id, name) => ({
  id,
  code: id.toUpperCase(),
  name,
  credits: 3,
  instructor: "",
  room: "",
  color: "#123456",
  soft_color: "#ffffff",
  initials: name.slice(0, 2).toUpperCase(),
});

test("file organization migration preserves uploads and enforces account-owned folders and documents", async (t) => {
  const pg = new PGlite();
  const sql = (query, params = []) => pg.query(query, params, {
    parsers: { 1184: (value) => value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") },
  });
  const migration = await readFile(new URL("../supabase/migrations/20261008010000_file_organization.sql", import.meta.url), "utf8");
  const userIds = { [USER_A]: null, [USER_B]: null };
  let accountA;
  let accountB;
  const call = async (functionName, args) => (await sql(
    `select ${functionName}(${args.map((_, index) => `$${index + 1}`).join(",")}) as value`,
    args,
  )).rows[0].value;
  const folder = (profile, authUser, operation, id = null, revision = null, metadata = {}) => call(
    "mutate_account_folder", [profile, authUser, operation, id, revision, JSON.stringify(metadata)],
  );
  const document = (profile, authUser, id, operation, revision, metadata) => call(
    "mutate_account_document", [profile, authUser, id, operation, revision, JSON.stringify(metadata)],
  );
  const fileLocation = (profile, authUser, id, operation, revision = null, metadata = {}) => call(
    "mutate_account_file_location", [profile, authUser, id, operation, revision, JSON.stringify(metadata)],
  );

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
      create policy unrelated_broad_policy on storage.objects for all to anon, authenticated using (true) with check (true);
    `);

    for (const file of ["20260903000000_workspace_persistence.sql", "20260904000000_google_accounts.sql"]) {
      await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    for (const user of [USER_A, USER_B]) {
      await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [user]);
      await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1", [user]);
      userIds[user] = (await sql("select id from app_profiles where auth_user_id = $1", [user])).rows[0].id;
    }
    accountA = { id: userIds[USER_A], auth: USER_A };
    accountB = { id: userIds[USER_B], auth: USER_B };

    const workspaceA = { ...dashboard };
    const workspaceB = { v: 1, a: "day", w: [], n: "", d: { assignments: [] } };
    await sql("select initialize_account_workspace($1, $2, $3)", [accountA.id, JSON.stringify([course("course-a", "Biology")]), JSON.stringify(workspaceA)]);
    await sql("select initialize_account_workspace($1, $2, $3)", [accountB.id, JSON.stringify([course("course-b", "History")]), JSON.stringify(workspaceB)]);
    await pg.exec(await readFile(new URL("../supabase/migrations/20260905000000_persistence_foundation.sql", import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../supabase/migrations/20260907000000_private_files.sql", import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../supabase/migrations/20261008000000_onboarding_details.sql", import.meta.url), "utf8"));

    const objectBytes = new Uint8Array([0, 1, 2, 127, 255]);
    for (const [id, courseId, assignmentId, kind, name, mimeType, size, state] of [
      [READY_FILE, "course-a", "assignment-a", "attachment", "Original.txt", "text/plain", 5, "ready"],
      [PENDING_FILE, null, null, "resource", "Pending.pdf", "application/pdf", 17, "pending"],
      [DELETED_FILE, "course-a", null, "syllabus", "Removed.pdf", "application/pdf", 29, "deleting"],
    ]) {
      await sql(`insert into user_files(profile_id,id,course_id,assignment_id,kind,name,mime_type,size_bytes,object_path,content_sha256,state)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
        accountA.id, id, courseId, assignmentId, kind, name, mimeType, size, `${accountA.id}/${id}`, digest, state,
      ]);
    }
    await sql("update user_files set deleted_at = now() where profile_id=$1 and id=$2", [accountA.id, DELETED_FILE]);
    await sql("insert into storage.objects(bucket_id,name,body) values ('eduessentials-private',$1,$2)", [`${accountA.id}/${READY_FILE}`, objectBytes]);

    const legacyColumns = "profile_id,id,course_id,assignment_id,kind,name,mime_type,size_bytes,bucket_id,object_path,state,created_at,updated_at,content_sha256,deleted_at";
    const legacyBefore = (await sql(`select ${legacyColumns} from user_files order by id`)).rows;
    const storageBefore = (await sql("select bucket_id,name,body from storage.objects order by name")).rows;
    await pg.exec(migration);
    const legacyAfter = (await sql(`select ${legacyColumns} from user_files order by id`)).rows;
    const storageAfter = (await sql("select bucket_id,name,body from storage.objects order by name")).rows;

    await t.test("the migration preserves legacy IDs, bytes, associations, pending state, and permanent tombstones", async () => {
      assert.deepEqual(legacyAfter, legacyBefore);
      assert.deepEqual(storageAfter, storageBefore);
      const newFields = (await sql("select id,content_backend,metadata_revision,content_revision,folder_id,trashed_at from user_files order by id")).rows;
      assert.deepEqual(newFields, [READY_FILE, PENDING_FILE, DELETED_FILE].map((id) => ({
        id,
        content_backend: "object",
        metadata_revision: 1,
        content_revision: 1,
        folder_id: null,
        trashed_at: null,
      })));
      const oldTombstone = (await sql("select deleted_at from user_files where id=$1", [DELETED_FILE])).rows[0].deleted_at;
      assert.ok(oldTombstone, "a permanent-deletion tombstone remains distinct from recoverable Trash");
    });

    let root;
    let child;
    let duplicate;
    let trashFolder;
    await t.test("folders keep duplicate names while rejecting foreign parents, self-parenting, cycles, and trashed destinations", async () => {
      root = await folder(accountA.id, accountA.auth, "create", ROOT_FOLDER, null, { name: "Projects" });
      child = await folder(accountA.id, accountA.auth, "create", CHILD_FOLDER, null, { name: "Shared name", parentId: ROOT_FOLDER });
      duplicate = await folder(accountA.id, accountA.auth, "create", DUPLICATE_FOLDER, null, { name: "Shared name" });
      const foreignRoot = await folder(accountB.id, accountB.auth, "create", null, null, { name: "Other account" });
      trashFolder = await folder(accountA.id, accountA.auth, "create", TRASHED_FOLDER, null, { name: "Archived destination" });
      assert.notEqual(child.id, duplicate.id);
      await assert.rejects(folder(accountA.id, accountA.auth, "create", null, null, { name: "Foreign parent", parentId: foreignRoot.id }));
      await assert.rejects(folder(accountA.id, accountA.auth, "create", SELF_FOLDER, null, { name: "Self", parentId: SELF_FOLDER }));
    });

    await t.test("folder moves reject self and descendant cycles, and Trash blocks new children and files", async () => {
      await assert.rejects(folder(accountA.id, accountA.auth, "move", CHILD_FOLDER, Number(child.revision), { parentId: CHILD_FOLDER }), { code: "23514" });
      await assert.rejects(folder(accountA.id, accountA.auth, "move", ROOT_FOLDER, Number(root.revision), { parentId: CHILD_FOLDER }), { code: "23514" });
      trashFolder = await folder(accountA.id, accountA.auth, "trash", TRASHED_FOLDER, Number(trashFolder.revision), { operationId: OPERATION_ID });
      await assert.rejects(folder(accountA.id, accountA.auth, "create", null, null, { name: "Under trash", parentId: TRASHED_FOLDER }), { code: "23514" });
      await assert.rejects(document(accountA.id, accountA.auth, EMPTY_DOCUMENT, "create", null, { name: "Invalid location.txt", body: "x", folderId: TRASHED_FOLDER }), { code: "23514" });
      await assert.rejects(folder(accountA.id, accountA.auth, "move", TRASHED_FOLDER, Number(trashFolder.revision), { parentId: ROOT_FOLDER }), { code: "23514" });
      const restored = await folder(accountA.id, accountA.auth, "restore", TRASHED_FOLDER, Number(trashFolder.revision), {});
      assert.equal(restored.trashed_at, null);
    });

    await t.test("managed folder archive labels and course snapshots survive account-term and course renames", async () => {
      let managed = await folder(accountA.id, accountA.auth, "create", MANAGED_FOLDER, null, {
        name: "Biology", kind: "course", courseId: "course-a",
      });
      const archived = await folder(accountA.id, accountA.auth, "archive", MANAGED_FOLDER, Number(managed.revision), { semesterLabel: "Fall 2026" });
      assert.equal(archived.semester_label, "Fall 2026");
      assert.equal(archived.course_name_snapshot, "Biology");
      assert.equal(archived.course_color_snapshot, "#123456");
      await assert.rejects(sql(`insert into file_folders(profile_id,name,archived_at,semester_label)
        values($1,'Missing archive label',now(),null)`, [accountA.id]), { code: "23514" });
      await sql("update app_profiles set current_term='Spring 2027' where id=$1", [accountA.id]);
      await sql("update courses set name='Human Biology',color='#654321' where profile_id=$1 and id='course-a'", [accountA.id]);
      const renamedCourse = (await sql("select id,name,color from courses where profile_id=$1 and id='course-a'", [accountA.id])).rows[0];
      managed = (await sql("select * from file_folders where profile_id=$1 and id=$2", [accountA.id, MANAGED_FOLDER])).rows[0];
      assert.equal(managed.semester_label, "Fall 2026");
      assert.equal(managed.course_name_snapshot, "Biology");
      assert.equal(managed.course_color_snapshot, "#123456");
      const unarchived = await folder(accountA.id, accountA.auth, "unarchive", MANAGED_FOLDER, Number(managed.revision), {});
      assert.equal(unarchived.archived_at, null);
      assert.deepEqual((await sql("select id,name,color from courses where profile_id=$1 and id='course-a'", [accountA.id])).rows[0], renamedCourse);
    });

    await t.test("native text writes enforce UTF-8 limits, optimistic revisions, atomic rollback, and distinct metadata revisions", async () => {
      const empty = await document(accountA.id, accountA.auth, EMPTY_DOCUMENT, "create", null, { name: "Untitled.txt", body: "" });
      assert.equal(empty.document.body, "");
      assert.equal(Number(empty.file.size_bytes), 0);
      assert.equal(empty.file.content_backend, "native-text");
      assert.equal(Number(empty.file.content_revision), 1);
      assert.equal(Number(empty.file.metadata_revision), 1);

      const exactLimitBody = "é".repeat(524288);
      const exactLimit = await document(accountA.id, accountA.auth, EMPTY_DOCUMENT, "update_content", 1, { body: exactLimitBody });
      assert.equal(Buffer.byteLength(exactLimit.document.body, "utf8"), 1_048_576);
      assert.equal(Number(exactLimit.file.size_bytes), 1_048_576);
      assert.equal(Number(exactLimit.file.content_revision), 2);
      assert.equal(Number(exactLimit.file.metadata_revision), 1);
      await assert.rejects(document(accountA.id, accountA.auth, EMPTY_DOCUMENT, "update_content", 1, { body: "stale" }), { code: "40001" });
      await assert.rejects(document(accountA.id, accountA.auth, EMPTY_DOCUMENT, "update_content", 2, { body: `${exactLimitBody}x` }), { code: "22023" });

      await pg.exec(`create function public.file_organization_test_fail_document_update()
        returns trigger language plpgsql as $$ begin
          if new.body = 'ROLLBACK_SENTINEL' then raise exception 'intentional test failure' using errcode='23514'; end if;
          return new;
        end $$;
        create trigger z_file_organization_test_fail after update of body on public.native_file_documents
          for each row execute function public.file_organization_test_fail_document_update();`);
      await assert.rejects(document(accountA.id, accountA.auth, EMPTY_DOCUMENT, "update_content", 2, { body: "ROLLBACK_SENTINEL" }), { code: "23514" });
      await pg.exec("drop trigger z_file_organization_test_fail on public.native_file_documents; drop function public.file_organization_test_fail_document_update()");
      const afterRollback = (await sql("select f.size_bytes,f.content_sha256,f.content_revision,f.metadata_revision,d.body from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id where f.profile_id=$1 and f.id=$2", [accountA.id, EMPTY_DOCUMENT])).rows[0];
      assert.equal(Number(afterRollback.size_bytes), 1_048_576);
      assert.equal(Number(afterRollback.content_revision), 2);
      assert.equal(Number(afterRollback.metadata_revision), 1);
      assert.equal(afterRollback.body, exactLimitBody);

      const associated = await document(accountA.id, accountA.auth, ASSOCIATED_DOCUMENT, "create", null, {
        name: "Shared name", body: "hello", folderId: CHILD_FOLDER, courseId: "course-a", assignmentId: "assignment-a",
      });
      assert.equal(associated.file.folder_id, CHILD_FOLDER);
      assert.equal(associated.file.course_id, "course-a");
      assert.equal(associated.file.assignment_id, "assignment-a");
      const moved = await fileLocation(accountA.id, accountA.auth, ASSOCIATED_DOCUMENT, "move", Number(associated.file.metadata_revision), { folderId: ROOT_FOLDER });
      assert.equal(moved.folder_id, ROOT_FOLDER);
      assert.equal(moved.course_id, "course-a");
      assert.equal(moved.assignment_id, "assignment-a");
      assert.equal(Number(moved.metadata_revision), 2);
      assert.equal(Number(moved.content_revision), 1);
      await assert.rejects(document(accountA.id, accountA.auth, ASSOCIATED_DOCUMENT, "create", null, {
        name: "Different body", body: "different", folderId: ROOT_FOLDER, courseId: "course-a", assignmentId: "assignment-a",
      }), { code: "23505" });
      await document(accountB.id, accountB.auth, FOREIGN_DOCUMENT, "create", null, { name: "Same title.txt", body: "B account" });
      await assert.rejects(document(accountA.id, accountA.auth, FOREIGN_DOCUMENT, "update_content", 1, { body: "forged" }), { code: "P0002" });
      await assert.rejects(fileLocation(accountA.id, accountA.auth, FOREIGN_DOCUMENT, "open"), { code: "P0002" });
      await assert.rejects(document(accountA.id, accountA.auth, "aaaaaaaa-1111-4111-8111-111111111111", "create", null, {
        name: "Foreign folder.txt", body: "x", folderId: (await sql("select id from file_folders where profile_id=$1", [accountB.id])).rows[0].id,
      }), { code: "23503" });
      await assert.rejects(document(accountA.id, accountA.auth, "aaaaaaaa-2222-4222-8222-222222222222", "create", null, { name: "Foreign course.txt", body: "x", courseId: "course-b" }), { code: "23503" });
      await assert.rejects(document(accountA.id, accountA.auth, "aaaaaaaa-3333-4333-8333-333333333333", "create", null, { name: "Foreign assignment.txt", body: "x", courseId: "course-a", assignmentId: "missing" }), { code: "23503" });
    });

    await t.test("open and star activity is account-owned and does not change modified dates or revisions", async () => {
      const fileBefore = (await sql("select updated_at,metadata_revision,content_revision from user_files where profile_id=$1 and id=$2", [accountA.id, ASSOCIATED_DOCUMENT])).rows[0];
      const folderBefore = (await sql("select updated_at,revision from file_folders where profile_id=$1 and id=$2", [accountA.id, ROOT_FOLDER])).rows[0];
      await fileLocation(accountA.id, accountA.auth, ASSOCIATED_DOCUMENT, "open");
      await fileLocation(accountA.id, accountA.auth, ASSOCIATED_DOCUMENT, "star");
      await fileLocation(accountA.id, accountA.auth, ASSOCIATED_DOCUMENT, "unstar");
      await folder(accountA.id, accountA.auth, "open", ROOT_FOLDER);
      await folder(accountA.id, accountA.auth, "star", ROOT_FOLDER);
      await folder(accountA.id, accountA.auth, "unstar", ROOT_FOLDER);
      const fileAfter = (await sql("select updated_at,metadata_revision,content_revision from user_files where profile_id=$1 and id=$2", [accountA.id, ASSOCIATED_DOCUMENT])).rows[0];
      const folderAfter = (await sql("select updated_at,revision from file_folders where profile_id=$1 and id=$2", [accountA.id, ROOT_FOLDER])).rows[0];
      assert.deepEqual(fileAfter, fileBefore);
      assert.deepEqual(folderAfter, folderBefore);
      const fileActivity = (await sql("select starred_at,last_opened_at from file_activity where profile_id=$1 and file_id=$2", [accountA.id, ASSOCIATED_DOCUMENT])).rows[0];
      const folderActivity = (await sql("select starred_at,last_opened_at from folder_activity where profile_id=$1 and folder_id=$2", [accountA.id, ROOT_FOLDER])).rows[0];
      assert.equal(fileActivity.starred_at, null);
      assert.ok(fileActivity.last_opened_at);
      assert.equal(folderActivity.starred_at, null);
      assert.ok(folderActivity.last_opened_at);
    });

    await t.test("native metadata requires a body, uploaded files cannot acquire document bodies, and service_role can only write through RPCs", async () => {
      await assert.rejects(sql(`insert into user_files(profile_id,id,kind,name,mime_type,size_bytes,object_path,content_backend,state)
        values($1,$2,'resource','No body.txt','text/plain',0,$3,'native-text','ready')`,
      [accountA.id, BROKEN_NATIVE_FILE, `${accountA.id}/${BROKEN_NATIVE_FILE}`]), { code: "23514" });
      await assert.rejects(sql("insert into native_file_documents(profile_id,file_id,body) values($1,$2,'unexpected')", [accountA.id, READY_FILE]), { code: "23514" });

      await pg.exec("set role service_role");
      try {
        const serviceFolder = await folder(accountA.id, accountA.auth, "create", SERVICE_FOLDER, null, { name: "Service RPC" });
        assert.equal(serviceFolder.id, SERVICE_FOLDER);
        const serviceDoc = await document(accountA.id, accountA.auth, SERVICE_DOCUMENT, "create", null, { name: "Service.txt", body: "body" });
        assert.equal(serviceDoc.document.body, "body");
        assert.equal((await sql("select body from native_file_documents where profile_id=$1 and file_id=$2", [accountA.id, SERVICE_DOCUMENT])).rows[0].body, "body");
        await assert.rejects(sql("insert into file_folders(profile_id,name) values($1,'direct write')", [accountA.id]), { code: "42501" });
        await assert.rejects(sql("update native_file_documents set body='direct write' where profile_id=$1 and file_id=$2", [accountA.id, SERVICE_DOCUMENT]), { code: "42501" });
      } finally {
        await pg.exec("reset role");
      }
    });

    await t.test("workspace association cleanup can remove a trashed file's assignment and course links", async () => {
      const before = (await sql(`select f.folder_id,f.original_folder_id,f.trashed_at,f.deleted_at,
          f.course_id,f.assignment_id,f.content_revision,d.body
        from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id
        where f.profile_id=$1 and f.id=$2`, [accountA.id, ASSOCIATED_DOCUMENT])).rows[0];
      const trashed = await fileLocation(accountA.id, accountA.auth, ASSOCIATED_DOCUMENT, "trash", 2, { operationId: OPERATION_ID });
      assert.equal(trashed.course_id, "course-a");
      assert.equal(trashed.assignment_id, "assignment-a");
      assert.equal(trashed.folder_id, null);
      assert.equal(trashed.original_folder_id, ROOT_FOLDER);

      const withoutAssignment = { ...dashboard, d: { ...dashboard.d, assignments: [] } };
      const saveWorkspace = async (courses) => {
        const revision = (await sql("select updated_at from dashboard_state where profile_id=$1", [accountA.id])).rows[0].updated_at;
        return sql("select save_account_workspace($1,$2,$3,$4,$5) as revision", [
          accountA.id, accountA.auth, revision, JSON.stringify(courses), JSON.stringify(withoutAssignment),
        ]);
      };
      await saveWorkspace([course("course-a", "Biology")]);
      const assignmentRemoved = (await sql(`select f.folder_id,f.original_folder_id,f.trashed_at,f.deleted_at,
          f.course_id,f.assignment_id,f.content_revision,d.body
        from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id
        where f.profile_id=$1 and f.id=$2`, [accountA.id, ASSOCIATED_DOCUMENT])).rows[0];
      assert.equal(assignmentRemoved.assignment_id, null);
      assert.equal(assignmentRemoved.course_id, "course-a");
      assert.equal(assignmentRemoved.original_folder_id, ROOT_FOLDER);
      assert.equal(assignmentRemoved.trashed_at, trashed.trashed_at);
      assert.equal(assignmentRemoved.body, before.body);
      assert.equal(assignmentRemoved.content_revision, before.content_revision);

      await saveWorkspace([]);
      const courseRemoved = (await sql(`select f.folder_id,f.original_folder_id,f.trashed_at,f.deleted_at,
          f.course_id,f.assignment_id,f.content_revision,d.body
        from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id
        where f.profile_id=$1 and f.id=$2`, [accountA.id, ASSOCIATED_DOCUMENT])).rows[0];
      assert.equal(courseRemoved.course_id, null);
      assert.equal(courseRemoved.assignment_id, null);
      assert.equal(courseRemoved.original_folder_id, ROOT_FOLDER);
      assert.equal(courseRemoved.trashed_at, trashed.trashed_at);
      assert.equal(courseRemoved.folder_id, null);
      assert.equal(courseRemoved.body, before.body);
      assert.equal(courseRemoved.content_revision, before.content_revision);
    });

    await t.test("recoverable file Trash remains separate from permanent tombstones and still counts toward the cap", async () => {
      const currentCount = Number((await sql("select count(*) as count from user_files where profile_id=$1 and deleted_at is null", [accountB.id])).rows[0].count);
      const fillCount = 999 - currentCount;
      assert.ok(fillCount >= 0);
      const inserted = await sql(`with owner as (select $1::uuid as profile_id), ids as (
          select gen_random_uuid() as id from generate_series(1,$2)
        ) insert into user_files(profile_id,id,kind,name,mime_type,size_bytes,object_path,state)
        select owner.profile_id,ids.id,'resource','Capacity fixture','text/plain',0,
          owner.profile_id::text||'/'||ids.id::text,'ready' from owner cross join ids returning id,metadata_revision`, [accountB.id, fillCount]);
      assert.equal(inserted.rows.length, fillCount);
      const last = inserted.rows.at(-1);
      assert.ok(last);
      const capped = await document(accountB.id, accountB.auth, CAP_DOCUMENT, "create", null, { name: "At capacity.txt", body: "" });
      assert.equal(Number((await sql("select count(*) as count from user_files where profile_id=$1 and deleted_at is null", [accountB.id])).rows[0].count), 1000);
      const sameIdRetry = await document(accountB.id, accountB.auth, CAP_DOCUMENT, "create", null, { name: "At capacity.txt", body: "" });
      assert.equal(sameIdRetry.file.id, capped.file.id, "an idempotent retry still succeeds after the record limit is reached");
      const trashed = await fileLocation(accountB.id, accountB.auth, last.id, "trash", Number(last.metadata_revision), { operationId: OPERATION_ID });
      assert.ok(trashed.trashed_at);
      assert.equal(trashed.folder_id, null);
      assert.equal(trashed.deleted_at, null);
      assert.equal(Number((await sql("select count(*) as count from user_files where profile_id=$1 and deleted_at is null", [accountB.id])).rows[0].count), 1000);
      await sql(`insert into user_files(profile_id,id,kind,name,mime_type,size_bytes,object_path,state,deleted_at)
        values($1,$2,'resource','Old tombstone','text/plain',0,$3,'deleting',now())`, [accountB.id, OLD_TOMBSTONE_B, `${accountB.id}/${OLD_TOMBSTONE_B}`]);
      await assert.rejects(document(accountB.id, accountB.auth, OVER_CAP_DOCUMENT, "create", null, { name: "Over cap.txt", body: "" }), { code: "22023" });
      assert.equal(Number((await sql("select count(*) as count from user_files where profile_id=$1 and deleted_at is null", [accountB.id])).rows[0].count), 1000);
    });

    await t.test("browser roles cannot read organization tables or execute mutation RPCs", async () => {
      for (const role of ["anon", "authenticated"]) {
        await pg.exec(`set role ${role}`);
        try {
          for (const table of ["file_folders", "native_file_documents", "file_activity", "folder_activity", "user_files"]) {
            await assert.rejects(sql(`select * from public.${table}`), { code: "42501" });
          }
          await assert.rejects(sql("select mutate_account_folder($1,$2,'create',null,null,$3)", [accountA.id, accountA.auth, JSON.stringify({ name: "Denied" })]), { code: "42501" });
          await assert.rejects(sql("select mutate_account_document($1,$2,$3,'create',null,$4)", [accountA.id, accountA.auth, EMPTY_DOCUMENT, JSON.stringify({ name: "Denied.txt", body: "" })]), { code: "42501" });
        } finally {
          await pg.exec("reset role");
        }
      }
    });

    await t.test("every mutation RPC locks the account row before locking its records", async () => {
      for (const [functionName, recordPattern] of [
        ["mutate_account_folder", /from public\.file_folders[\s\S]*?for update/i],
        ["mutate_account_document", /from public\.user_files[\s\S]*?for update/i],
        ["mutate_account_file_location", /from public\.user_files[\s\S]*?for update/i],
      ]) {
        const start = migration.toLowerCase().indexOf(`create function public.${functionName}(`);
        assert.notEqual(start, -1, `${functionName} is present in the migration`);
        const body = migration.slice(start, migration.indexOf("$$;", start));
        const accountLock = body.search(/perform 1 from public\.app_profiles[\s\S]*?for update/i);
        const recordLock = body.search(recordPattern);
        assert.ok(accountLock >= 0, `${functionName} locks app_profiles`);
        assert.ok(recordLock > accountLock, `${functionName} locks the account before its item rows`);
      }
    });
  } finally {
    await pg.close();
  }
});
