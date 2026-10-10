import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { syntheticContext } from "./fixtures/ai-context.mjs";
import { clientModule } from "./helpers/client-modules.mjs";
const { buildProposal } = await import(await clientModule("lib/ai/academic-tools.ts"));
test("AI migrations: isolation, receipts, conflicts, indexing leases, and shared budgets", async (t) => {
  const pg = new PGlite({ extensions: { vector } });
  const query = (sql, args = []) => pg.query(sql, args, { parsers: { 1184: (v) => v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") } });
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security; grant usage on schema public,storage to anon,authenticated,service_role;`);
    for (const file of ["20260903000000_workspace_persistence.sql", "20260904000000_google_accounts.sql", "20260905000000_persistence_foundation.sql", "20260907000000_private_files.sql", "20260918000000_academic_ai.sql"]) await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await pg.exec(await readFile(new URL("../supabase/migrations/20260918010000_ai_vectors.sql", import.meta.url), "utf8"));
    const context = syntheticContext(), courses = context.courses.map(({ soft, ...c }) => ({ ...c, soft_color: soft }));
    const profiles = [];
    for (const user of [userA, userB]) {
      await query("insert into auth.users values($1,'synthetic@example.invalid','{\"provider\":\"google\"}','{}')", [user]);
      const profile = (await query("update app_profiles set onboarding_completed_at=now() where auth_user_id=$1 returning *", [user])).rows[0];
      await query("select initialize_account_workspace($1,$2,$3)", [profile.id, JSON.stringify(courses), JSON.stringify(context.dashboard)]);
      profiles.push((await query("select * from app_profiles where id=$1", [profile.id])).rows[0]);
    }
    const [a, b] = profiles;
    await pg.exec(await readFile(new URL("../supabase/migrations/20260918020000_ai_export_backfill.sql", import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../supabase/migrations/20261008000000_onboarding_details.sql", import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../supabase/migrations/20261008010000_file_organization.sql", import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../supabase/migrations/20261008020000_file_content_api.sql", import.meta.url), "utf8"));
    const uploadedId = crypto.randomUUID(), nativeId = crypto.randomUUID();
    await query("select mutate_account_file($1,$2,$3,'reserve',null,$4)", [a.id, userA, uploadedId, JSON.stringify({ name: "Existing upload.txt", mime: "text/plain", size: 3, sha256: "a".repeat(64), kind: "resource", courseId: "", assignmentId: "" })]);
    await query("select mutate_account_file($1,$2,$3,'ready')", [a.id, userA, uploadedId]);
    await query("update ai_sources set enabled=false where profile_id=$1 and file_id=$2", [a.id, uploadedId]);
    await query("select mutate_account_document($1,$2,$3,'create',null,$4)", [a.id, userA, nativeId, JSON.stringify({ name: "Native.txt", body: "Native indexing proof" })]);
    const fileTimesBeforeAiBackfill = new Map((await query("select id,updated_at from user_files where profile_id=$1 and id=any($2)", [a.id, [uploadedId, nativeId]])).rows.map((file) => [file.id, file.updated_at]));
    await pg.exec(await readFile(new URL("../supabase/migrations/20261008030000_file_content_ai.sql", import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../supabase/migrations/20261008040000_managed_course_folders.sql", import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../supabase/migrations/20261009120000_ai_file_result_fence.sql", import.meta.url), "utf8"));
    const revision = async (profile = a.id) => (await query("select updated_at from dashboard_state where profile_id=$1", [profile])).rows[0].updated_at;
    const aiResult = async (profile = a.id, extra = {}) => JSON.stringify({
      answer: { blocks: [] }, citations: [], revision: await revision(profile), ...extra,
    });
    const conv = (await query("insert into ai_conversations(profile_id,title) values($1,'Synthetic') returning id", [a.id])).rows[0].id;
    const messageId = crypto.randomUUID();
    const begin = () => query("select ai_begin_message($1,$2,$3,'Complete my lab','fake','test') as result", [a.id, conv, messageId]);
    await t.test("file AI backfill includes native documents and preserves source preferences", async () => {
      const uploaded = (await query("select * from ai_sources where profile_id=$1 and file_id=$2", [a.id, uploadedId])).rows[0];
      const native = (await query("select * from ai_sources where profile_id=$1 and file_id=$2", [a.id, nativeId])).rows[0];
      assert.equal(uploaded.enabled, false);
      assert.equal(uploaded.file_available, true);
      assert.ok(native);
      assert.equal(native.enabled, true);
      assert.equal(native.file_available, true);
      assert.equal(native.version, (await query("select content_sha256 from user_files where id=$1", [nativeId])).rows[0].content_sha256);
      const fileTimesAfterAiBackfill = await query("select id,updated_at from user_files where profile_id=$1 and id=any($2)", [a.id, [uploadedId, nativeId]]);
      for (const file of fileTimesAfterAiBackfill.rows) assert.equal(file.updated_at, fileTimesBeforeAiBackfill.get(file.id), "AI backfill does not touch file timestamps");
    });
    await t.test("conversation and request ownership cannot be forged", async () => {
      await assert.rejects(query("select ai_begin_message($1,$2,$3,'x','fake','test')", [b.id, conv, crypto.randomUUID()]), /unavailable/);
      assert.equal((await begin()).rows[0].result.created, true);
      assert.equal((await begin()).rows[0].result.created, false);
      await assert.rejects(query("select ai_begin_message($1,$2,$3,'different','fake','test')", [a.id, conv, messageId]), /reused/);
    });
    const proposalId = crypto.randomUUID(), originalRevision = await revision();
    const built = buildProposal(context, [{ kind: "mark_assignment_complete", id: "lab-ece" }]);
    const proposal = { id: proposalId, revision: originalRevision, profileRevision: a.updated_at, snapshot: { courses, dashboard: built.snapshot.dashboard }, preview: { changes: built.changes, warnings: [], timezone: context.profile.timezone } };
    await query("select ai_finish_message($1,$2,$3,$4)", [a.id, messageId, await aiResult(a.id, { proposalId }), JSON.stringify(proposal)]);
    await t.test("reviewed changes commit once with a durable receipt", async () => {
      await assert.rejects(query("select ai_apply_proposal($1,$2,$3)", [b.id, userB, proposalId]), /unavailable/);
      const first = (await query("select ai_apply_proposal($1,$2,$3) as receipt", [a.id, userA, proposalId])).rows[0].receipt;
      const second = (await query("select ai_apply_proposal($1,$2,$3) as receipt", [a.id, userA, proposalId])).rows[0].receipt;
      assert.deepEqual(first, second); assert.notEqual(await revision(), originalRevision);
      const saved = (await query("select payload from dashboard_state where profile_id=$1", [a.id])).rows[0].payload;
      assert.equal(saved.d.assignments[1].status, "done");
      assert.equal((await query("select payload from dashboard_state where profile_id=$1", [b.id])).rows[0].payload.d.assignments[1].status, "later");
    });
    await t.test("stale previews fail without partial writes", async () => {
      const id = crypto.randomUUID(), mid = crypto.randomUUID();
      await query("select ai_begin_message($1,$2,$3,'New preview','fake','test')", [a.id, conv, mid]);
      await query("select ai_finish_message($1,$2,$3,$4)", [a.id, mid, await aiResult(a.id, { proposalId: id }), JSON.stringify({ ...proposal, id })]);
      const before = await revision();
      await assert.rejects(query("select ai_apply_proposal($1,$2,$3)", [a.id, userA, id]), /changed/);
      assert.equal(await revision(), before);
      assert.equal((await query("select status from ai_proposals where id=$1", [id])).rows[0].status, "pending");
    });
    await t.test("old clients cannot erase event duration", async () => {
      const stale = structuredClone(context.dashboard); delete stale.d.manualEvents[0].durationMinutes;
      await assert.rejects(query("update dashboard_state set payload=$2 where profile_id=$1", [a.id, JSON.stringify(stale)]), /updated app/);
    });
    await t.test("indexing is account-scoped, leased and source-version checked", async () => {
      assert.ok((await query("select * from ai_sources where profile_id=$1", [a.id])).rows.length >= 2);
      await query("update ai_sources set enabled=false where profile_id=$1 and file_id is not null", [a.id]);
      assert.equal((await query("select ai_claim_source($1,true) as job", [[a.id]])).rows[0].job, null);
      await query("insert into ai_access(profile_id,enabled,adult_confirmed,synthetic_confirmed) values($1,true,true,true)", [a.id]);
      const job = (await query("select ai_claim_source($1,true) as job", [[a.id]])).rows[0].job;
      assert.equal(job.profile_id, a.id);
      const chunks = JSON.stringify([{ ordinal: 0, page: 1, body: "Integration practice synthetic evidence" }]);
      assert.equal((await query("select ai_publish_source($1,$2,'stale',$3,$4) as ok", [a.id, job.id, job.lease_id, chunks])).rows[0].ok, false);
      assert.equal((await query("select ai_publish_source($1,$2,$3,$4,$5) as ok", [a.id, job.id, job.version, job.lease_id, chunks])).rows[0].ok, true);
      assert.equal((await query("select * from ai_keyword_search($1,'integration')", [a.id])).rows.length, 1);
      assert.equal((await query("select * from ai_keyword_search($1,'integration')", [b.id])).rows.length, 0);
      const embedding = JSON.stringify([1, ...Array(767).fill(0)]);
      await query("update ai_chunks set embedding=$2,embedding_model='test-embedding' where source_id=$1", [job.id, embedding]);
      assert.equal((await query("select * from ai_hybrid_search($1,'unrelated',$2,'test-embedding')", [a.id, embedding])).rows.length, 1);
      assert.equal((await query("select * from ai_hybrid_search($1,'unrelated',$2,'test-embedding')", [b.id, embedding])).rows.length, 0);
      assert.equal((await query("select * from ai_hybrid_search($1,'unrelated',$2,'wrong-model')", [a.id, embedding])).rows.length, 0);
      await query("update ai_sources set enabled=false where id=$1", [job.id]);
      assert.equal((await query("select * from ai_keyword_search($1,'integration')", [a.id])).rows.length, 0);
    });
    await t.test("shared quota limits are enforced before external work", async () => {
      const reserve = () => query("select ai_reserve($1,2,10,10,1000,1,100,0.01)", [a.id]);
      await reserve(); await reserve(); await assert.rejects(reserve(), /limit reached/);
    });
    await t.test("native file indexing backfills, requeues edits, and fences Trash and stale leases", async () => {
      const upload = (await query("select * from ai_sources where profile_id=$1 and file_id=$2", [a.id, uploadedId])).rows[0];
      assert.equal(upload.version, "a".repeat(64));
      assert.equal(upload.state, "queued");
      assert.equal(upload.enabled, false, "the AI migration backfill must retain the existing preference");
      assert.equal(upload.file_available, true);
      await query("select mutate_account_file_location($1,$2,$3,'open',null,'{}')", [a.id, userA, uploadedId]);
      assert.equal((await query("select enabled from ai_sources where id=$1", [upload.id])).rows[0].enabled, false);

      const native = (await query("select * from ai_sources where profile_id=$1 and file_id=$2", [a.id, nativeId])).rows[0];
      const nativeFile = (await query("select * from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      assert.ok(native, "ready native documents are included in the AI backfill");
      await query("update ai_sources set enabled=true,state='queued',attempts=0,error=null,lease_id=null,lease_until=null,available_at=now() where profile_id=$1 and id=$2", [a.id, native.id]);
      Object.assign(native, (await query("select * from ai_sources where id=$1", [native.id])).rows[0]);
      assert.equal(native.version, nativeFile.content_sha256);
      assert.equal(native.file_available, true);
      assert.equal(native.state, "queued");
      const snapshotBeforeEdit = (await query("select export_account($1,$2) as data", [a.id, userA])).rows[0].data;
      const exportedBeforeEdit = snapshotBeforeEdit.documents.find((document) => document.file_id === nativeId);
      assert.equal(exportedBeforeEdit.body, "Native indexing proof");
      assert.equal(exportedBeforeEdit.content_revision, nativeFile.content_revision);
      const originalVersion = native.version;
      const oldLease = crypto.randomUUID();
      const originalChunks = JSON.stringify([{ ordinal: 0, page: 1, body: "Native indexing proof" }]);
      const embed = JSON.stringify([1, ...Array(767).fill(0)]);
      const claim = async (lease) => query("update ai_sources set state='processing',attempts=2,lease_id=$2,lease_until=now()+interval '1 hour' where profile_id=$1 and id=$3", [a.id, lease, native.id]);
      const publish = async (version, lease, chunks = originalChunks) => query("select ai_publish_source($1,$2,$3,$4,$5) as ok", [a.id, native.id, version, lease, chunks]);

      await claim(oldLease);
      assert.equal((await publish(originalVersion, oldLease)).rows[0].ok, true);
      await query("update ai_chunks set embedding=$2,embedding_model='test-embedding' where profile_id=$1 and source_id=$3", [a.id, embed, native.id]);
      assert.equal((await query("select * from ai_keyword_search($1,'native')", [a.id])).rows.length, 1);
      assert.equal((await query("select * from ai_hybrid_search($1,'unrelated',$2,'test-embedding')", [a.id, embed])).rows.length, 1);

      const editedFile = (await query("select content_revision from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      await query("select mutate_account_document($1,$2,$3,'update_content',$4,$5)", [a.id, userA, nativeId, editedFile.content_revision, JSON.stringify({ body: "Native indexing proof edited" })]);
      let editedSource = (await query("select * from ai_sources where profile_id=$1 and id=$2", [a.id, native.id])).rows[0];
      const fileAfterEdit = (await query("select content_revision from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      const snapshotAfterEdit = (await query("select export_account($1,$2) as data", [a.id, userA])).rows[0].data;
      const exportedAfterEdit = snapshotAfterEdit.documents.find((document) => document.file_id === nativeId);
      assert.equal(exportedAfterEdit.body, "Native indexing proof edited");
      assert.equal(exportedAfterEdit.content_revision, fileAfterEdit.content_revision);
      assert.notEqual(exportedAfterEdit.content_revision, exportedBeforeEdit.content_revision);
      assert.notEqual(editedSource.version, originalVersion);
      assert.equal(editedSource.state, "queued");
      assert.equal(editedSource.attempts, 0);
      assert.equal(editedSource.lease_id, null);
      assert.equal(editedSource.file_available, true);
      assert.equal(editedSource.enabled, true);
      assert.equal((await query("select count(*)::int as count from ai_chunks where profile_id=$1 and source_id=$2", [a.id, native.id])).rows[0].count, 0);
      assert.equal((await publish(originalVersion, oldLease)).rows[0].ok, false, "late publication from an edited lease is rejected");

      const changedFile = (await query("select content_revision from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      await query("select mutate_account_document($1,$2,$3,'update_content',$4,$5)", [a.id, userA, nativeId, changedFile.content_revision, JSON.stringify({ body: "Native indexing proof" })]);
      editedSource = (await query("select * from ai_sources where profile_id=$1 and id=$2", [a.id, native.id])).rows[0];
      assert.equal(editedSource.version, originalVersion, "content revisions may return to an earlier hash");
      assert.equal(editedSource.state, "queued");
      assert.equal(editedSource.lease_id, null, "ABA content still invalidates the original lease");
      assert.equal((await publish(originalVersion, oldLease)).rows[0].ok, false, "an old lease cannot publish after an ABA edit");

      const currentLease = crypto.randomUUID();
      await claim(currentLease);
      assert.equal((await publish(originalVersion, currentLease)).rows[0].ok, true);
      await query("update ai_chunks set embedding=$2,embedding_model='test-embedding' where profile_id=$1 and source_id=$3", [a.id, embed, native.id]);
      const beforeTrash = (await query("select metadata_revision from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      await query("select mutate_account_file_location($1,$2,$3,'trash',$4,'{}')", [a.id, userA, nativeId, beforeTrash.metadata_revision]);
      let trashedSource = (await query("select * from ai_sources where profile_id=$1 and id=$2", [a.id, native.id])).rows[0];
      assert.equal(trashedSource.file_available, false);
      assert.equal(trashedSource.lease_id, null);
      assert.equal(trashedSource.state, "queued");
      assert.equal((await query("select count(*)::int as count from ai_chunks where profile_id=$1 and source_id=$2", [a.id, native.id])).rows[0].count, 0);
      assert.equal((await query("select * from ai_keyword_search($1,'native')", [a.id])).rows.length, 0);
      assert.equal((await query("select * from ai_hybrid_search($1,'unrelated',$2,'test-embedding')", [a.id, embed])).rows.length, 0);

      const trashedFile = (await query("select metadata_revision from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      await query("select mutate_account_file_location($1,$2,$3,'restore',$4,'{}')", [a.id, userA, nativeId, trashedFile.metadata_revision]);
      trashedSource = (await query("select * from ai_sources where profile_id=$1 and id=$2", [a.id, native.id])).rows[0];
      assert.equal(trashedSource.file_available, true);
      assert.equal(trashedSource.enabled, true);
      assert.equal(trashedSource.state, "queued");

      const restoreLease = crypto.randomUUID();
      await claim(restoreLease);
      assert.equal((await publish(originalVersion, restoreLease)).rows[0].ok, true);
      await query("update ai_sources set enabled=false where profile_id=$1 and id=$2", [a.id, native.id]);
      const beforeSecondTrash = (await query("select metadata_revision from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      await query("select mutate_account_file_location($1,$2,$3,'trash',$4,'{}')", [a.id, userA, nativeId, beforeSecondTrash.metadata_revision]);
      const disabledTrashed = (await query("select * from ai_sources where profile_id=$1 and id=$2", [a.id, native.id])).rows[0];
      assert.equal(disabledTrashed.enabled, false);
      assert.equal(disabledTrashed.file_available, false);
      const beforeRestore = (await query("select metadata_revision from user_files where profile_id=$1 and id=$2", [a.id, nativeId])).rows[0];
      await query("select mutate_account_file_location($1,$2,$3,'restore',$4,'{}')", [a.id, userA, nativeId, beforeRestore.metadata_revision]);
      const disabledRestored = (await query("select * from ai_sources where profile_id=$1 and id=$2", [a.id, native.id])).rows[0];
      assert.equal(disabledRestored.enabled, false, "Trash and restore preserve the user's disabled preference");
      assert.equal(disabledRestored.file_available, true);
      assert.equal(disabledRestored.state, "queued");
    });
    await t.test("AI course deletion preserves committed syllabus text as a queued native source and keeps opt-out", async () => {
      const dashboardRow = (await query("select payload,updated_at from dashboard_state where profile_id=$1", [a.id])).rows[0];
      const committedDashboard = dashboardRow.payload;
      const syllabusText = committedDashboard.d.courseDetails.calc.syllabusText;
      assert.ok(syllabusText);
      const syntheticSource = (await query("select * from ai_sources where profile_id=$1 and source_key='syllabus:calc'", [a.id])).rows[0];
      assert.ok(syntheticSource, "the old pasted syllabus is indexed as a synthetic AI source before deletion");
      const foreignSource = (await query("select * from ai_sources where profile_id=$1 and source_key='syllabus:calc'", [b.id])).rows[0];
      assert.ok(foreignSource, "the other account has an independent synthetic syllabus source");
      await assert.rejects(query("select mutate_account_ai_source($1,$2,$3,'exclude')", [a.id, userB, syntheticSource.id]), { code: "42501" });
      await assert.rejects(query("select mutate_account_ai_source($1,$2,$3,'exclude')", [a.id, userA, foreignSource.id]), { code: "P0002" },
        "a source ID from another account is indistinguishable from a missing source");
      const excluded = (await query("select mutate_account_ai_source($1,$2,$3,'exclude') as source", [a.id, userA, syntheticSource.id])).rows[0].source;
      assert.equal(excluded.enabled, false);

      const oldFolder = (await query("select id from file_folders where profile_id=$1 and course_id='calc' and kind='course'", [a.id])).rows[0];
      assert.ok(oldFolder);
      const nextCourses = (await query("select id,code,name,credits,instructor,room,color,soft_color,initials from courses where profile_id=$1 and id<>'calc' order by id", [a.id])).rows;
      const nextDashboard = structuredClone(committedDashboard);
      delete nextDashboard.d.courseDetails.calc;
      nextDashboard.d.assignments = nextDashboard.d.assignments.filter((item) => item.courseId !== "calc");
      nextDashboard.d.manualEvents = nextDashboard.d.manualEvents.filter((item) => item.courseId !== "calc");
      if (nextDashboard.d.study?.grades) nextDashboard.d.study.grades = nextDashboard.d.study.grades.filter((item) => item.courseId !== "calc");

      const proposalId = crypto.randomUUID(), messageId = crypto.randomUUID();
      await query("select ai_begin_message($1,$2,$3,'Remove completed Calculus course','fake','test')", [a.id, conv, messageId]);
      const profileRevision = (await query("select updated_at from app_profiles where id=$1", [a.id])).rows[0].updated_at;
      const proposal = {
        id: proposalId,
        revision: dashboardRow.updated_at,
        profileRevision,
        snapshot: { courses: nextCourses, dashboard: nextDashboard },
        preview: { changes: [{ kind: "delete_course", id: "calc" }], warnings: [], timezone: context.profile.timezone },
      };
      await query("select ai_finish_message($1,$2,$3,$4)", [a.id, messageId, await aiResult(a.id, { proposalId }), JSON.stringify(proposal)]);
      const firstReceipt = (await query("select ai_apply_proposal($1,$2,$3) as receipt", [a.id, userA, proposalId])).rows[0].receipt;
      const retryReceipt = (await query("select ai_apply_proposal($1,$2,$3) as receipt", [a.id, userA, proposalId])).rows[0].receipt;
      assert.deepEqual(retryReceipt, firstReceipt, "a lost AI-apply response returns the same receipt on retry");

      const preserved = (await query(`
        select f.id,f.name,f.folder_id,f.content_backend,f.content_sha256,f.state,f.trashed_at,d.body
        from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id
        where f.profile_id=$1 and d.body=$2
      `, [a.id, syllabusText])).rows;
      assert.equal(preserved.length, 1);
      assert.equal(preserved[0].folder_id, oldFolder.id);
      assert.equal(preserved[0].content_backend, "native-text");
      assert.equal(preserved[0].state, "ready");
      assert.equal(preserved[0].trashed_at, null);
      assert.match(preserved[0].content_sha256, /^[a-f0-9]{64}$/);
      const newSource = (await query("select * from ai_sources where profile_id=$1 and file_id=$2", [a.id, preserved[0].id])).rows[0];
      assert.ok(newSource);
      assert.equal(newSource.source_key, `file:${preserved[0].id}`);
      assert.equal(newSource.version, preserved[0].content_sha256);
      assert.equal(newSource.file_available, true);
      assert.equal(newSource.state, "queued", "the preserved native file is available for normal AI ingestion");
      assert.equal(newSource.enabled, false, "deleting a synthetic source does not silently re-enable its opt-out");
      assert.equal((await query("select count(*)::int as count from ai_sources where profile_id=$1 and source_key='syllabus:calc'", [a.id])).rows[0].count, 0,
        "the old synthetic syllabus source is removed with its course details");
      await assert.rejects(query("select mutate_account_ai_source($1,$2,$3,'exclude')", [a.id, userA, syntheticSource.id]), { code: "P0002" },
        "the removed synthetic source cannot be toggled after course deletion");
      const content = (await query("select read_account_file_content($1,$2,$3,false) as content", [a.id, preserved[0].id, null])).rows[0].content;
      assert.equal(content.document.body, syllabusText, "the AI file reader returns the preserved syllabus body");
    });
    await t.test("complete account export includes only the owner's AI history even without opt-in", async () => {
      const own = (await query("select export_account($1,$2) as data", [a.id, userA])).rows[0].data;
      assert.equal(own.assistant.conversations.length, 1);
      assert.ok(own.assistant.messages.length > 0);
      assert.ok(own.assistant.proposals.length > 0);
      const other = (await query("select export_account($1,$2) as data", [b.id, userB])).rows[0].data;
      assert.deepEqual(other.assistant.conversations, []);
      await assert.rejects(query("select export_account($1,$2)", [a.id, userB]), /not ready/);
    });
    await t.test("browser roles cannot access AI records or functions", async () => {
      await pg.exec("set role authenticated");
      await assert.rejects(query("select * from ai_messages"), /permission denied/);
      await assert.rejects(query("select ai_apply_proposal($1,$2,$3)", [a.id, userA, proposalId]), /permission denied/);
      await pg.exec("reset role");
    });
  } finally { await pg.close(); }
});
