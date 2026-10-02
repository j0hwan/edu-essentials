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
    const revision = async (profile = a.id) => (await query("select updated_at from dashboard_state where profile_id=$1", [profile])).rows[0].updated_at;
    const conv = (await query("insert into ai_conversations(profile_id,title) values($1,'Synthetic') returning id", [a.id])).rows[0].id;
    const messageId = crypto.randomUUID();
    const begin = () => query("select ai_begin_message($1,$2,$3,'Complete my lab','fake','test') as result", [a.id, conv, messageId]);
    await t.test("conversation and request ownership cannot be forged", async () => {
      await assert.rejects(query("select ai_begin_message($1,$2,$3,'x','fake','test')", [b.id, conv, crypto.randomUUID()]), /unavailable/);
      assert.equal((await begin()).rows[0].result.created, true);
      assert.equal((await begin()).rows[0].result.created, false);
      await assert.rejects(query("select ai_begin_message($1,$2,$3,'different','fake','test')", [a.id, conv, messageId]), /reused/);
    });
    const proposalId = crypto.randomUUID(), originalRevision = await revision();
    const built = buildProposal(context, [{ kind: "mark_assignment_complete", id: "lab-ece" }]);
    const proposal = { id: proposalId, revision: originalRevision, profileRevision: a.updated_at, snapshot: { courses, dashboard: built.snapshot.dashboard }, preview: { changes: built.changes, warnings: [], timezone: context.profile.timezone } };
    await query("select ai_finish_message($1,$2,$3,$4)", [a.id, messageId, JSON.stringify({ proposalId }), JSON.stringify(proposal)]);
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
      await query("select ai_finish_message($1,$2,'{}',$3)", [a.id, mid, JSON.stringify({ ...proposal, id })]);
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
