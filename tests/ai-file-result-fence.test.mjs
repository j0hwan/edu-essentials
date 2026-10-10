import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { syntheticContext } from "./fixtures/ai-context.mjs";

const migration = await readFile(new URL("../supabase/migrations/20261009120000_ai_file_result_fence.sql", import.meta.url), "utf8");
const migrations = [
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
];

test("AI completion fences stale workspace and document state atomically", async (t) => {
  await t.test("migration succeeds when optional AI tables are absent", async () => {
    const empty = new PGlite();
    try { await empty.exec(migration); }
    finally { await empty.close(); }
  });
  await t.test("migration rejects a partial AI installation instead of silently skipping the fence", async () => {
    const partial = new PGlite();
    try {
      await partial.exec("create table public.ai_messages(id uuid primary key)");
      await assert.rejects(partial.exec(migration), /AI result fence migration requires/);
    } finally { await partial.close(); }
  });

  const pg = new PGlite({ extensions: { vector } });
  const query = (sql, args = []) => pg.query(sql, args, {
    parsers: { 1184: (value) => value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") },
  });
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema public,storage to anon,authenticated,service_role;`);
    for (const file of migrations) {
      await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }

    const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const context = syntheticContext();
    const courses = context.courses.map(({ soft, ...course }) => ({ ...course, soft_color: soft }));
    const profiles = [];
    for (const userId of [userA, userB]) {
      await query("insert into auth.users values($1,'synthetic@example.invalid','{\"provider\":\"google\"}','{}')", [userId]);
      const profile = (await query("update app_profiles set onboarding_completed_at=now() where auth_user_id=$1 returning *", [userId])).rows[0];
      await query("select initialize_account_workspace($1,$2,$3)", [profile.id, JSON.stringify(courses), JSON.stringify(context.dashboard)]);
      profiles.push((await query("select * from app_profiles where id=$1", [profile.id])).rows[0]);
    }
    const [a, b] = profiles;

    for (const file of ["20261008030000_file_content_ai.sql", "20261008040000_managed_course_folders.sql"]) {
      await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }

    const fileIds = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, profile] of profiles.entries()) {
      await query("select mutate_account_file($1,$2,$3,'reserve',null,$4)", [profile.id, [userA, userB][index], fileIds[index], JSON.stringify({
        name: `Result fence ${index}.txt`, mime: "text/plain", size: 3,
        sha256: String(index + 1).repeat(64), kind: "resource", courseId: "", assignmentId: "",
      })]);
      await query("select mutate_account_file($1,$2,$3,'ready')", [profile.id, [userA, userB][index], fileIds[index]]);
    }

    for (const file of [
      "20261008050000_syllabus_replacement.sql",
      "20261008060000_document_save_requests.sql",
      "20261008070000_folder_moves.sql",
      "20261008080000_recursive_trash.sql",
      "20261008090000_archive_integrity.sql",
      "20261009100000_selected_file_download.sql",
      "20261009110000_file_release_integrity.sql",
    ]) {
      await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    await pg.exec(migration);

    const revision = async (profileId) => (await query("select updated_at from dashboard_state where profile_id=$1", [profileId])).rows[0].updated_at;
    const sourceFor = async (profileId, fileId) => (await query(
      "select * from ai_sources where profile_id=$1 and file_id=$2", [profileId, fileId],
    )).rows[0];
    const sources = [await sourceFor(a.id, fileIds[0]), await sourceFor(b.id, fileIds[1])];
    for (const source of sources) {
      await query("update ai_sources set state='ready',enabled=true where profile_id=$1 and id=$2", [source.profile_id, source.id]);
      source.state = "ready";
      source.enabled = true;
    }

    const begin = async (profileId, question) => {
      const conversationId = (await query(
        "insert into ai_conversations(profile_id,title) values($1,'Fence test') returning id", [profileId],
      )).rows[0].id;
      const messageId = crypto.randomUUID();
      await query("select ai_begin_message($1,$2,$3,$4,'test-model','test-prompt')", [profileId, conversationId, messageId, question]);
      return messageId;
    };
    const output = async (profileId, citations, extra = {}) => JSON.stringify({
      answer: { blocks: [{ kind: "general", text: "Verified test answer.", citations: [] }] },
      citations, revision: await revision(profileId), ...extra,
    });
    const finish = (profileId, messageId, result, proposal = null) => query(
      "select ai_finish_message($1,$2,$3,$4)", [profileId, messageId, JSON.stringify(result), proposal === null ? null : JSON.stringify(proposal)],
    );
    const documentCitation = (source, version = source.version) => ({
      id: `document:${source.id}:0`, kind: "document", sourceId: source.id, version,
      page: 1, label: "Indexed text · page/section 1", text: "Indexed proof",
    });
    const proposal = (revisionValue) => ({
      id: crypto.randomUUID(), revision: revisionValue,
      profileRevision: (profiles[0].updated_at),
      snapshot: { courses, dashboard: context.dashboard },
      preview: { changes: [], warnings: [], timezone: context.profile.timezone },
    });
    const assertUnchangedRunning = async (profileId, messageId) => {
      const row = (await query("select status,result from ai_messages where profile_id=$1 and id=$2", [profileId, messageId])).rows[0];
      assert.equal(row.status, "running");
      assert.equal(row.result, null);
      assert.equal((await query("select count(*)::int as count from ai_proposals where profile_id=$1 and message_id=$2", [profileId, messageId])).rows[0].count, 0);
    };

    await t.test("normal document citations finish successfully", async () => {
      const docMessage = await begin(a.id, "Use my file");
      await finish(a.id, docMessage, JSON.parse(await output(a.id, [documentCitation(sources[0])], { proposalId: null })));
      const completed = (await query("select status,result from ai_messages where id=$1", [docMessage])).rows[0];
      assert.equal(completed.status, "complete");
      assert.equal(completed.result.citations[0].sourceId, sources[0].id);
    });

    await t.test("live record citations ignore document source and record-version checks", async () => {
      const recordMessage = await begin(b.id, "Use my note");
      const record = { id: "record:legacy-note:0", kind: "record", recordId: "legacy-note", version: "not-a-workspace-revision", label: "Legacy notes", text: "Live note" };
      await finish(b.id, recordMessage, JSON.parse(await output(b.id, [record])));
      assert.equal((await query("select status from ai_messages where id=$1", [recordMessage])).rows[0].status, "complete");
    });

    await t.test("Trash committed after the application precheck rejects final completion", async () => {
      const source = await sourceFor(a.id, fileIds[0]);
      const precheck = (await query(`
        select s.enabled,s.state,s.file_available,s.version,
          public.ai_source_file_is_current(s.profile_id,s.file_id,s.version) as file_current
        from ai_sources s where s.profile_id=$1 and s.id=$2
      `, [a.id, source.id])).rows[0];
      assert.equal(precheck.enabled, true);
      assert.equal(precheck.state, "ready");
      assert.equal(precheck.file_available, true);
      assert.equal(precheck.file_current, true);
      assert.equal(precheck.version, source.version);

      const messageId = await begin(a.id, "Use file before Trash");
      const currentRevision = await revision(a.id);
      const pendingProposal = proposal(currentRevision);
      const metadataRevision = (await query("select metadata_revision from user_files where profile_id=$1 and id=$2", [a.id, fileIds[0]])).rows[0].metadata_revision;
      await query("select mutate_account_file_location($1,$2,$3,'trash',$4,'{}')", [a.id, userA, fileIds[0], metadataRevision]);
      assert.equal(await revision(a.id), currentRevision, "file Trash does not change the academic workspace revision");

      const result = await output(a.id, [documentCitation(source)], { proposalId: pendingProposal.id });
      await assert.rejects(finish(a.id, messageId, JSON.parse(result), pendingProposal), { code: "40001" });
      await assertUnchangedRunning(a.id, messageId);
      assert.equal((await query("select trashed_at is not null as trashed from user_files where profile_id=$1 and id=$2", [a.id, fileIds[0]])).rows[0].trashed, true);
    });

    await t.test("stale academic revision and foreign source citations are rejected without proposals", async () => {
      const staleMessage = await begin(a.id, "Use stale workspace");
      const staleProposal = proposal(await revision(a.id));
      const staleResult = await output(a.id, [], { revision: "2000-01-01T00:00:00.000Z", proposalId: staleProposal.id });
      await assert.rejects(finish(a.id, staleMessage, JSON.parse(staleResult), staleProposal), { code: "40001" });
      await assertUnchangedRunning(a.id, staleMessage);

      const foreignMessage = await begin(a.id, "Use a different account's file");
      const foreignResult = await output(a.id, [documentCitation(sources[1])]);
      await assert.rejects(finish(a.id, foreignMessage, JSON.parse(foreignResult)), { code: "40001" });
      await assertUnchangedRunning(a.id, foreignMessage);
    });

    await t.test("source exclusion and version changes invalidate a previously checked citation", async () => {
      const source = await sourceFor(b.id, fileIds[1]);
      const excludedMessage = await begin(b.id, "Use source before exclusion");
      const precheck = (await query("select enabled,state,file_available,version from ai_sources where profile_id=$1 and id=$2", [b.id, source.id])).rows[0];
      assert.equal(precheck.enabled, true);
      assert.equal(precheck.state, "ready");
      assert.equal(precheck.file_available, true);
      await query("select mutate_account_ai_source($1,$2,$3,'exclude')", [b.id, userB, source.id]);
      await assert.rejects(finish(b.id, excludedMessage, JSON.parse(await output(b.id, [documentCitation(source)]))), { code: "40001" });
      await assertUnchangedRunning(b.id, excludedMessage);

      await query("select mutate_account_ai_source($1,$2,$3,'include')", [b.id, userB, source.id]);
      await query("update ai_sources set state='ready',version='changed-version' where profile_id=$1 and id=$2", [b.id, source.id]);
      const versionMessage = await begin(b.id, "Use old indexed version");
      await assert.rejects(finish(b.id, versionMessage, JSON.parse(await output(b.id, [documentCitation(source)]))), { code: "40001" });
      await assertUnchangedRunning(b.id, versionMessage);
    });

    await t.test("excluded note and syllabus record citations are rejected after the application precheck", async () => {
      const noteKey = (await query(
        "select source_key from ai_sources where profile_id=$1 and source_key like 'note:%' order by source_key limit 1", [a.id],
      )).rows[0]?.source_key;
      assert.ok(noteKey, "the initialized workspace has a note source");
      for (const recordId of [noteKey, "syllabus:calc"]) {
        const source = (await query("select id,enabled from ai_sources where profile_id=$1 and source_key=$2", [a.id, recordId])).rows[0];
        assert.ok(source);
        assert.equal(source.enabled, true);
        const messageId = await begin(a.id, `Use ${recordId}`);
        const precheck = (await query(`
          select count(*)::int as count from ai_sources
          where profile_id=$1 and source_key=$2 and enabled=false
        `, [a.id, recordId])).rows[0];
        assert.equal(precheck.count, 0);
        await query("select mutate_account_ai_source($1,$2,$3,'exclude')", [a.id, userA, source.id]);
        const record = { id: `record:${recordId}:0`, kind: "record", recordId, version: "old-record-version", label: recordId, text: "Earlier workspace text" };
        await assert.rejects(finish(a.id, messageId, JSON.parse(await output(a.id, [record]))), { code: "40001" });
        await assertUnchangedRunning(a.id, messageId);
      }
    });

    await t.test("finish remains service-role only", async () => {
      const grants = (await query(`
        select has_function_privilege('authenticated','public.ai_finish_message(uuid,uuid,jsonb,jsonb)','execute') as authenticated,
          has_function_privilege('service_role','public.ai_finish_message(uuid,uuid,jsonb,jsonb)','execute') as service_role
      `)).rows[0];
      assert.equal(grants.authenticated, false);
      assert.equal(grants.service_role, true);
      await pg.exec("set role authenticated");
      await assert.rejects(query("select ai_finish_message($1,$2,'{}',null)", [a.id, crypto.randomUUID()]), /permission denied/);
      await pg.exec("reset role");
    });
  } finally {
    await pg.close();
  }
});
