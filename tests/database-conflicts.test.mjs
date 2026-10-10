import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const AUTH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dashboard = { v: 2, a: "day", w: [], t: [], n: "Original notes", d: {} };
const course = {
  id: "course-a", code: "BIO 101", name: "Biology", credits: 3, instructor: "",
  room: "", color: "#123456", soft_color: "#12345618", initials: "BI",
};
const rewrittenFunctionNames = [
  "ai_apply_proposal", "ai_begin_message", "ai_finish_message", "begin_account_file_purge",
  "finalize_account_file_purge", "mutate_account_document", "mutate_account_document_legacy",
  "mutate_account_document_request", "mutate_account_file", "mutate_account_file_legacy",
  "mutate_account_file_location", "mutate_account_file_location_legacy", "mutate_account_file_tree_action",
  "mutate_account_files_action", "mutate_account_files_action_legacy", "mutate_account_folder",
  "mutate_account_folder_legacy", "read_account_file_content", "rename_account_file",
  "rename_account_file_legacy", "save_account_workspace", "snapshot_account_file_selection",
];
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
  "20261009110000_file_release_integrity.sql",
  "20261009120000_ai_file_result_fence.sql",
];
const migrationText = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

async function setupDatabase(withAi) {
  const pg = withAi ? new PGlite({ extensions: { vector } }) : new PGlite();
  const query = (sql, params = []) => pg.query(sql, params);
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

  for (const file of migrationFiles.slice(0, 2)) await pg.exec(await migrationText(file));
  await query("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [AUTH_ID]);
  const profile = (await query(
    "update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [AUTH_ID],
  )).rows[0];
  await query("select initialize_account_workspace($1, $2, $3)", [profile.id, JSON.stringify([course]), JSON.stringify(dashboard)]);

  for (const file of migrationFiles.slice(2)) {
    if (!withAi && (file.startsWith("20260918") || file === "20261008030000_file_content_ai.sql")) continue;
    await pg.exec(await migrationText(file));
  }
  return { pg, query, profile };
}

test("logical database conflicts use PT409 across optional AI migration paths", async (t) => {
  for (const withAi of [false, true]) {
    await t.test(withAi ? "AI migrations installed" : "AI migrations omitted", async () => {
      const { pg, query, profile } = await setupDatabase(withAi);
      try {
        const signature = "public.save_account_workspace(uuid,uuid,timestamptz,jsonb,jsonb)";
        const aiSignature = "public.ai_finish_message(uuid,uuid,jsonb,jsonb)";
        const metadataBefore = (await query(`
          select p.proowner, p.proacl, p.prosecdef, p.proconfig, p.pronargdefaults
          from pg_catalog.pg_proc as p where p.oid = $1::regprocedure
        `, [signature])).rows[0];
        const aiMetadataBefore = withAi ? (await query(`
          select p.proowner, p.proacl, p.prosecdef, p.proconfig, p.pronargdefaults
          from pg_catalog.pg_proc as p where p.oid = $1::regprocedure
        `, [aiSignature])).rows[0] : null;
        const migration = await migrationText("20261010000000_nonretryable_conflicts.sql");
        await pg.exec(migration);

        const metadataAfter = (await query(`
          select p.proowner, p.proacl, p.prosecdef, p.proconfig, p.pronargdefaults
          from pg_catalog.pg_proc as p where p.oid = $1::regprocedure
        `, [signature])).rows[0];
        assert.deepEqual(metadataAfter, metadataBefore, "function owner, grants, security, settings, and defaults are preserved");
        assert.equal(metadataAfter.prosecdef, true);
        assert.deepEqual(metadataAfter.proconfig, ['search_path=""']);
        const grants = (await query(`
          select has_function_privilege('anon', $1, 'execute') as anon,
            has_function_privilege('authenticated', $1, 'execute') as authenticated,
            has_function_privilege('service_role', $1, 'execute') as service_role
        `, [signature])).rows[0];
        assert.deepEqual(grants, { anon: false, authenticated: false, service_role: true });
        if (withAi) {
          const aiMetadataAfter = (await query(`
            select p.proowner, p.proacl, p.prosecdef, p.proconfig, p.pronargdefaults
            from pg_catalog.pg_proc as p where p.oid = $1::regprocedure
          `, [aiSignature])).rows[0];
          assert.deepEqual(aiMetadataAfter, aiMetadataBefore, "AI function grants, security, settings, and defaults are preserved");
          assert.equal(aiMetadataAfter.pronargdefaults, 1);
        }

        const rewrittenFunctions = (await query(`
          select p.proname, pg_catalog.pg_get_functiondef(p.oid) as definition
          from pg_catalog.pg_proc as p
          join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and p.proname = any ($1::text[])
          order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
        `, [rewrittenFunctionNames])).rows;
        assert.ok(rewrittenFunctions.some(({ proname, definition }) => proname === "save_account_workspace" && definition.includes("'PT409'")));
        if (withAi) assert.ok(rewrittenFunctions.some(({ proname, definition }) => proname === "ai_finish_message" && definition.includes("'PT409'")));
        else assert.equal(rewrittenFunctions.some(({ proname }) => proname === "ai_finish_message"), false);

        const definitionsBeforeRetry = rewrittenFunctions.map(({ proname, definition }) => [proname, definition]);
        await pg.exec(migration);
        const definitionsAfterRetry = (await query(`
          select p.proname, pg_catalog.pg_get_functiondef(p.oid) as definition
          from pg_catalog.pg_proc as p
          join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and p.proname = any ($1::text[])
          order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
        `, [rewrittenFunctionNames])).rows.map(({ proname, definition }) => [proname, definition]);
        assert.deepEqual(definitionsAfterRetry, definitionsBeforeRetry, "rerunning the migration is idempotent");

        const remainingConflicts = await query(`
          select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
          from pg_catalog.pg_proc as p
          join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and pg_catalog.pg_get_functiondef(p.oid) ~* 'errcode[[:space:]]*=[[:space:]]*''40001'''
        `);
        assert.deepEqual(remainingConflicts.rows, [], "application public functions have no manually raised 40001 conflicts");

        const before = (await query("select payload, updated_at from dashboard_state where profile_id = $1", [profile.id])).rows[0];
        const staleCourse = { ...course, id: "should-not-save", name: "Stale write" };
        await assert.rejects(query(
          "select save_account_workspace($1, $2, $3, $4, $5)",
          [profile.id, AUTH_ID, "2000-01-01T00:00:00Z", JSON.stringify([staleCourse]), JSON.stringify({ ...dashboard, n: "Stale notes" })],
        ), { code: "PT409" });
        assert.deepEqual(
          (await query("select payload, updated_at from dashboard_state where profile_id = $1", [profile.id])).rows[0],
          before,
          "a stale workspace write leaves the dashboard unchanged",
        );
        assert.equal((await query("select count(*)::int as count from courses where profile_id = $1 and id = 'should-not-save'", [profile.id])).rows[0].count, 0);

        if (withAi) {
          const aiAccess = (await query(`
            select has_function_privilege('authenticated', $1, 'execute') as authenticated,
              has_function_privilege('service_role', $1, 'execute') as service_role
          `, [aiSignature])).rows[0];
          assert.deepEqual(aiAccess, { authenticated: false, service_role: true });

          const conversationId = (await query(
            "insert into ai_conversations(profile_id, title) values ($1, 'Conflict test') returning id", [profile.id],
          )).rows[0].id;
          const messageId = crypto.randomUUID();
          await query("select ai_begin_message($1, $2, $3, 'Test question', 'test-model', 'test-prompt')", [
            profile.id, conversationId, messageId,
          ]);
          await assert.rejects(query(
            "select ai_finish_message($1, $2, $3, null)",
            [profile.id, messageId, JSON.stringify({ revision: "2000-01-01T00:00:00Z", citations: [] })],
          ), { code: "PT409" });
          assert.deepEqual((await query(
            "select status, result from ai_messages where profile_id = $1 and id = $2", [profile.id, messageId],
          )).rows[0], { status: "running", result: null }, "a stale AI result leaves the request running for a fresh retry");
        }
      } finally {
        await pg.close();
      }
    });
  }
});
