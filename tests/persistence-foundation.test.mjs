import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { clientModule } from "./helpers/client-modules.mjs";
import { privateFileCases } from "./private-file-cases.mjs";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compile(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const requestUrl = await compile("lib/persistence-request.ts");
const { readPersistenceJson, requireSaveRevision, nextSaveRevision } = await import(requestUrl);
const codecUrl = await clientModule("lib/workspace-codec.ts");
const { decodeWorkspaceState, encodeWorkspaceState } = await import(codecUrl);
const layout = encodeWorkspaceState([{ id: "day", name: "My day", widgets: [{ instanceId: "note", type: "notes", size: "large" }] }], "day", "Existing shared notes", { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month" });

test("request limits count actual streamed UTF-8 bytes and reject invalid content", async () => {
  const make = (body, headers = {}) => new Request("https://edu.example/api/workspace", { method: "PUT", headers: { "content-type": "application/json", ...headers }, body });
  assert.deepEqual(await readPersistenceJson(make('{"note":"é"}'), 13), { note: "é" });
  await assert.rejects(readPersistenceJson(make('{"note":"éé"}'), 13), { status: 413 });
  await assert.rejects(readPersistenceJson(make("{}", { "content-length": "1000000" }), 13), { status: 413 });
  await assert.rejects(readPersistenceJson(make("[]"), 13), { status: 400 });
  await assert.rejects(readPersistenceJson(make("{"), 13), { status: 400 });
  await assert.rejects(readPersistenceJson(make("{}", { "content-type": "text/plain" }), 13), { status: 415 });
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  await assert.rejects(readPersistenceJson(new Request("https://edu.example", { method: "PUT", headers: { "content-type": "application/json" }, body: stream, duplex: "half" }), 13), { status: 413 });
  assert.equal(cancelled, true);
});

test("revision tokens are required and strictly advance even for a future timestamp", () => {
  assert.throws(() => requireSaveRevision(undefined), { status: 428 });
  for (const invalid of [null, 0, "yesterday", "2026-09-05"]) assert.throws(() => requireSaveRevision(invalid));
  assert.equal(requireSaveRevision(null, true), null);
  const previous = "2099-01-01T00:00:00.123456+00:00";
  assert.equal(requireSaveRevision(previous), previous);
  assert.ok(Date.parse(nextSaveRevision(previous)) > Date.parse(previous));
});

test("legacy layouts preserve notes and all widget types, and duplicate identities fail", () => {
  const old = { v: 1, a: "day", w: [["day", "Day", Array.from({ length: 18 }, (_, i) => [i, i % 3])]], n: "Legacy notes" };
  const decoded = decodeWorkspaceState(old);
  assert.equal(decoded.workspaces[0].widgets.length, 18);
  assert.equal(decoded.workspaces[0].widgets[12].note, "Legacy notes");
  assert.equal(decoded.notes, "");
  const upgraded = encodeWorkspaceState(decoded.workspaces, decoded.activeWorkspaceId, decoded.notes);
  assert.equal(upgraded.v, 2);
  assert.deepEqual(decodeWorkspaceState(upgraded), decoded);
  assert.throws(() => decodeWorkspaceState({ ...old, w: [...old.w, ...old.w] }), /Duplicate/);
  const event = { id: "e", title: "Study", courseId: "", dateKey: "2026-09-05", time: "18:00", type: "Study block" };
  assert.throws(() => decodeWorkspaceState({ ...layout, d: { ...layout.d, manualEvents: [event, event] } }), /Duplicate/);
});

test("PostgreSQL migration, account isolation, conditional APIs and atomic snapshots", async (t) => {
  const pg = new PGlite();
  const sql = (query, params = []) => pg.query(query, params, { parsers: { 1184: (value) => value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") } });
  try {
    // Supabase-owned schemas/roles only. The actual app migrations run unchanged.
    await pg.exec(`
      set timezone = 'UTC';
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema public, storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;
      create policy unrelated_broad_policy on storage.objects for all to anon, authenticated using (true) with check (true);
    `);
    for (const file of ["20260903000000_workspace_persistence.sql", "20260904000000_google_accounts.sql"]) {
      await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (const user of [userA, userB]) {
      await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [user]);
      await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1", [user]);
    }
    const profileFor = async (user) => (await sql("select * from app_profiles where auth_user_id = $1", [user])).rows[0];
    const a = await profileFor(userA), b = await profileFor(userB);
    for (const profile of [a, b]) await sql("select initialize_account_workspace($1, $2, $3)", [profile.id, "[]", JSON.stringify(layout)]);
    const before = (await sql("select payload, updated_at from dashboard_state where profile_id = $1", [a.id])).rows[0];
    const migration = await readFile(new URL("../supabase/migrations/20260905000000_persistence_foundation.sql", import.meta.url), "utf8");
    await t.test("an incompatible existing bucket aborts the entire migration", async () => {
      await sql("insert into storage.buckets values ('eduessentials-private','eduessentials-private',true,26214400)");
      await assert.rejects(pg.exec(migration), /must be private/);
      await pg.exec("rollback");
      assert.equal((await sql("select to_regclass('public.user_files') as relation")).rows[0].relation, null);
      assert.deepEqual((await sql("select payload, updated_at from dashboard_state where profile_id = $1", [a.id])).rows[0], before);
      await sql("delete from storage.buckets where id = 'eduessentials-private'");
    });
    await pg.exec(migration);
    await pg.exec(await readFile(new URL("../supabase/migrations/20260907000000_private_files.sql", import.meta.url), "utf8"));

    await t.test("additive migration preserves existing payloads and revisions", async () => {
      const after = (await sql("select payload, updated_at from dashboard_state where profile_id = $1", [a.id])).rows[0];
      assert.deepEqual(after, before);
      assert.equal((await profileFor(userA)).id, a.id);
      const bucket = (await sql("select * from storage.buckets where id = 'eduessentials-private'")).rows[0];
      assert.equal(bucket.public, false);
      assert.equal(Number(bucket.file_size_limit), 26214400);
    });

    // The adapter implements only Supabase's transport/query shape. Filtering,
    // writes, triggers, constraints, transactions, and RLS execute in Postgres.
    const ident = (value) => { assert.match(value, /^[a-z_][a-z_0-9]*$/); return `"${value}"`; };
    function from(table) {
      let action = "select", columns = "*", body, single = false;
      const filters = [];
      const chain = {
        select(value = "*") { columns = value; return chain; },
        eq(key, value) { filters.push([key, value]); return chain; },
        is(key, value) { filters.push([key, value]); return chain; },
        range() { return chain; },
        order() { return chain; },
        update(value) { action = "update"; body = value; return chain; },
        insert(value) { action = "insert"; body = value; return chain; },
        delete() { action = "delete"; return chain; },
        maybeSingle() { single = true; return execute(); },
        single() { single = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        await globalThis.__foundationTest?.beforeQuery?.(table, action);
        const values = [], param = (value) => { values.push(value && typeof value === "object" ? JSON.stringify(value) : value); return `$${values.length}`; };
        const selected = columns === "*" ? "*" : columns.split(",").map(ident).join(",");
        try {
          let query;
          if (action === "insert") query = `insert into ${ident(table)} (${Object.keys(body).map(ident).join(",")}) values (${Object.values(body).map(param).join(",")}) returning ${selected}`;
          else {
            const prefix = action === "update" ? `update ${ident(table)} set ${Object.entries(body).map(([key, value]) => `${ident(key)} = ${param(value)}`).join(",")}` : action === "delete" ? `delete from ${ident(table)}` : `select ${selected} from ${ident(table)}`;
            const where = filters.map(([key, value]) => value === null ? `${ident(key)} is null` : `${ident(key)} = ${param(value)}`).join(" and ");
            query = prefix + (where ? ` where ${where}` : "") + (action === "select" ? "" : ` returning ${selected}`);
          }
          const result = await sql(query, values);
          return { data: single ? result.rows[0] ?? null : result.rows, error: null };
        } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      }
      return chain;
    }
    const runtime = globalThis.__foundationTest = { user: userA, from };
    const profileUrl = await compile("lib/profile.ts");
    const { defaultPreferences, editableProfile, validateProfile } = await import(profileUrl);
    runtime.profileFor = async () => { const profile = await profileFor(runtime.user); return { ...profile, preferences: { ...defaultPreferences, ...profile.preferences } }; };
    const authUrl = moduleUrl(`
      export class AuthError extends Error {}
      export const requireProfile = () => globalThis.__foundationTest.profileFor();
      export function requireSameOrigin(r) { if(r.headers.get('origin') !== new URL(r.url).origin) throw new Error('bad origin'); }
      export const apiError = () => Response.json({error:'Account error'}, {status:503});
    `);
    runtime.rpc = async (name, args) => {
      if (name === "mutate_account_file" || name === "export_account") {
        try { const result = name === "mutate_account_file" ? await sql("select mutate_account_file($1,$2,$3,$4,$5,$6) as value", [args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_operation, args.p_expected_revision, JSON.stringify(args.p_metadata)]) : await sql("select export_account($1,$2) as value", [args.p_profile_id, args.p_auth_user_id]); return { data: result.rows[0].value, error: null }; }
        catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      }
      assert.equal(name, "save_account_workspace");
      try { const result = await sql("select save_account_workspace($1,$2,$3,$4,$5) as revision", [args.p_profile_id, args.p_auth_user_id, args.p_expected_revision, JSON.stringify(args.p_courses), JSON.stringify(args.p_dashboard)]); return { data: result.rows[0].revision, error: null }; }
      catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    };
    const dbUrl = moduleUrl("export const getSupabaseAdmin = () => ({from:globalThis.__foundationTest.from,rpc:globalThis.__foundationTest.rpc,storage:globalThis.__foundationTest.storage});");
    const imports = { "../../../lib/auth": authUrl, "../../../lib/supabase-server": dbUrl, "../../../lib/persistence-request": requestUrl, "../../../lib/academic-snapshot": await clientModule("lib/academic-snapshot.ts"), "../../../lib/profile": profileUrl };
    const workspace = await import(await compile("app/api/workspace/route.ts", imports));
    const profileApi = await import(await compile("app/api/profile/route.ts", imports));
    const request = (body, path = "workspace") => new Request(`https://edu.example/api/${path}`, { method: "PUT", headers: { origin: "https://edu.example", "content-type": "application/json" }, body: JSON.stringify({ ...(path === "workspace" ? { courses: [] } : {}), ...body }) });
    const getWorkspace = async () => (await workspace.GET(new Request("https://edu.example/api/workspace"))).json();

    await t.test("two editors of the same revision cannot overwrite each other", async () => {
      const loaded = await getWorkspace();
      const body = { baseRevision: loaded.revision, dashboard: { ...layout, n: "First editor" }, profile_id: b.id };
      const responses = await Promise.all([workspace.PUT(request(body)), workspace.PUT(request({ ...body, dashboard: { ...layout, n: "Second editor" } }))]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const saved = await getWorkspace();
      assert.notEqual(saved.revision, loaded.revision);
      assert.equal(saved.dashboard.n, "First editor");
      assert.deepEqual((await sql("select payload from dashboard_state where profile_id = $1", [b.id])).rows[0].payload, layout);
      assert.equal((await workspace.PUT(request({ dashboard: layout }))).status, 428);
      assert.equal((await workspace.PUT(request({ dashboard: layout, baseRevision: null }))).status, 400);
    });

    await t.test("profile revisions reject stale edits and client-supplied ownership", async () => {
      const profile = (await (await profileApi.GET()).json()).profile;
      const body = { display_name: "Saved name", baseRevision: profile.updated_at, auth_user_id: userB, id: b.id, email: "forged@example.invalid" };
      const response = await profileApi.PUT(request(body, "profile"));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).profile.display_name, "Saved name");
      assert.equal((await profileApi.PUT(request({ ...body, display_name: "Stale" }, "profile"))).status, 409);
      assert.equal((await profileFor(userB)).display_name, "Test student");
      assert.equal((await profileFor(userA)).email, "test@example.invalid");
    });

    await t.test("switching users reads only that account and a foreign revision cannot grant access", async () => {
      const savedA = await getWorkspace();
      runtime.user = userB;
      assert.deepEqual((await getWorkspace()).dashboard, layout);
      assert.equal((await workspace.PUT(request({ dashboard: savedA.dashboard, baseRevision: savedA.revision, profile_id: a.id }))).status, 409);
      runtime.user = userA;
    });

    await t.test("every settings field round-trips, partial edits preserve values, and optional values can be cleared", async () => {
      const details = validateProfile({ display_name: "Taylor", last_name: "Lee", university: "Example University", major: "History", academic_year: "Senior", age: 22, study_goal: "Read every day", current_term: "Fall", academic_structure: "Quarter", gpa_system: "Percentage", week_starts_on: "Monday", timezone: "America/New_York", preferences: { theme: "system", reducedMotion: true, highContrast: false, deadlineReminders: false, dailyStudyPlan: false, streakNudges: true } });
      const beforeB = await profileFor(userB);
      const saved = await profileApi.PUT(request({ ...details, baseRevision: (await profileFor(userA)).updated_at }, "profile"));
      assert.equal(saved.status, 200);
      assert.deepEqual(editableProfile((await (await profileApi.GET()).json()).profile), details);
      const partial = await profileApi.PUT(request({ major: "Physics", baseRevision: (await profileFor(userA)).updated_at }, "profile"));
      assert.equal(partial.status, 200);
      assert.deepEqual(editableProfile((await partial.json()).profile), { ...details, major: "Physics" });
      const cleared = validateProfile({ display_name: "Taylor", preferences: { theme: "light", reducedMotion: false, highContrast: false, deadlineReminders: false, dailyStudyPlan: false, streakNudges: false } });
      assert.equal((await profileApi.PUT(request({ ...cleared, baseRevision: (await profileFor(userA)).updated_at }, "profile"))).status, 200);
      assert.deepEqual(editableProfile((await (await profileApi.GET()).json()).profile), cleared);
      assert.deepEqual(await profileFor(userB), beforeB);
    });

    await t.test("retrying a confirmed profile write after a lost response is idempotent", async () => {
      const body = { ...editableProfile(await runtime.profileFor()), study_goal: "Keep this goal", baseRevision: (await profileFor(userA)).updated_at };
      assert.equal((await profileApi.PUT(request(body, "profile"))).status, 200);
      const confirmed = await profileFor(userA);
      const retry = await profileApi.PUT(request(body, "profile"));
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).profile.updated_at, confirmed.updated_at);
      assert.deepEqual(await profileFor(userA), confirmed);
      const changed = await profileApi.PUT(request({ ...body, study_goal: "Newer tab", baseRevision: confirmed.updated_at }, "profile"));
      assert.equal(changed.status, 200);
      assert.equal((await profileApi.PUT(request(body, "profile"))).status, 409);
      assert.equal((await profileFor(userA)).study_goal, "Newer tab");
    });

    await t.test("a tab cannot read or send old drafts to a newly signed-in account", async () => {
      const beforeA = await profileFor(userA), beforeB = await profileFor(userB);
      runtime.user = userB;
      try {
        const scoped = (method, path, body) => new Request(`https://edu.example/api/${path}`, { method, headers: { origin: "https://edu.example", "content-type": "application/json", "x-profile-id": a.id }, ...(body ? { body: JSON.stringify(body) } : {}) });
        assert.equal((await profileApi.GET(scoped("GET", "profile"))).status, 401);
        assert.equal((await profileApi.PUT(scoped("PUT", "profile", { display_name: "Wrong account", baseRevision: beforeB.updated_at }))).status, 401);
        assert.equal((await workspace.GET(scoped("GET", "workspace"))).status, 401);
        for (const method of ["PUT", "POST", "DELETE"]) assert.equal((await workspace[method](scoped(method, "workspace", { dashboard: layout, baseRevision: null }))).status, 401);
        assert.deepEqual(await profileFor(userB), beforeB);
        assert.deepEqual(await profileFor(userA), beforeA);
        assert.deepEqual((await getWorkspace()).dashboard, layout);
      } finally { runtime.user = userA; }
    });

    await t.test("legacy API saves upgrade once and independent widget notes stay account-owned", async () => {
      const old = { v: 1, a: "second", w: [["first", "First", [[12, 1], [17, 0]]], ["second", "Second", [[12, 2]]]], n: "Original shared text" };
      await sql("update dashboard_state set payload = $1 where profile_id = $2", [JSON.stringify(old), a.id]);
      const beforeB = (await sql("select * from dashboard_state where profile_id = $1", [b.id])).rows[0];
      const loaded = await getWorkspace(); assert.deepEqual(loaded.dashboard, old);
      assert.equal((await workspace.PUT(request({ dashboard: old, baseRevision: loaded.revision }))).status, 200);
      const migrated = await getWorkspace(); assert.equal(migrated.dashboard.v, 2);
      assert.equal((await workspace.PUT(request({ dashboard: old, baseRevision: migrated.revision }))).status, 426);
      assert.equal((await getWorkspace()).revision, migrated.revision);
      const decoded = decodeWorkspaceState(migrated.dashboard), firstId = decoded.workspaces[0].widgets[0].instanceId;
      decoded.workspaces[0].widgets[0].note = "Only the first note"; decoded.workspaces[0].widgets[0].size = "small";
      decoded.workspaces[0].widgets.reverse(); decoded.workspaces.reverse(); decoded.workspaces[1].name = "Renamed";
      const changed = encodeWorkspaceState(decoded.workspaces, "first", decoded.notes);
      assert.equal((await workspace.PUT(request({ dashboard: changed, baseRevision: migrated.revision, profile_id: b.id }))).status, 200);
      const readback = decodeWorkspaceState((await getWorkspace()).dashboard);
      assert.equal(readback.workspaces[1].widgets[1].instanceId, firstId);
      assert.equal(readback.workspaces[1].widgets[1].note, "Only the first note");
      assert.equal(readback.workspaces[0].widgets[0].note, "Original shared text");
      assert.deepEqual((await sql("select * from dashboard_state where profile_id = $1", [b.id])).rows[0], beforeB);
    });

    const course = { id: "course-a", code: "TEST 101", name: "Test course", credits: 3, instructor: "Teacher", room: "Room", color: "#112233", soft_color: "#11223318", initials: "T1" };
    const snapshot = async (courses, dashboard = layout, revision) => sql("select save_account_workspace($1, $2, $3, $4, $5) as revision", [a.id, userA, revision ?? (await getWorkspace()).revision, JSON.stringify(courses), JSON.stringify(dashboard)]);
    await t.test("academic API round-trips a review draft and its atomic approval without touching another account", async () => {
      const { soft_color, ...fields } = course, clientCourse = { ...fields, soft: soft_color };
      const beforeB = await sql("select * from dashboard_state where profile_id = $1", [b.id]);
      const draft = { id: "review", sourceName: "history.txt", sourceText: "Final exam 2026-12-15", course: clientCourse, items: [{ id: "row", title: "Reviewed final", date: "2026-12-15", type: "Exam", description: "Chapters 1–5", weight: "30%" }] };
      const pending = { ...layout, d: { ...layout.d, syllabusDrafts: [draft] } };
      assert.equal((await workspace.PUT(request({ courses: [], dashboard: pending, baseRevision: (await getWorkspace()).revision }))).status, 200);
      assert.deepEqual((await getWorkspace()).dashboard.d.syllabusDrafts, [draft]);
      const dashboard = { ...layout, d: { ...layout.d,
        calendarView: "week", calendarFilter: course.id, syllabusDrafts: [],
        assignments: [{ id: "syllabus-row", title: "Reviewed final", courseId: course.id, dateKey: "2026-12-15", dueTime: "18:00", due: "Dec 15", type: "Exam", description: "Chapters 1–5", weight: "30%", notes: "Outline", checklist: [true, false, true], status: "done", progress: 100, progressBeforeCompletion: 40, completedAt: "2026-12-15T23:00:00.000Z" }],
        manualEvents: [{ id: "event", title: "Consultation", courseId: course.id, dateKey: "2026-12-14", time: "13:30", type: "Office hours", description: "Bring outline" }],
        courseDetails: { [course.id]: { officeHours: "Monday", syllabusText: draft.sourceText, syllabusName: draft.sourceName, meetings: [{ id: "meeting", days: [1, 3], start: "09:00", end: "10:30", from: "2026-09-01", until: "2026-12-15", location: "Hall 2" }] } },
      } };
      const revision = (await getWorkspace()).revision;
      const response = await workspace.PUT(request({ courses: [clientCourse], dashboard, baseRevision: revision, profile_id: b.id }));
      assert.equal(response.status, 200);
      const saved = await getWorkspace();
      assert.deepEqual(saved.courses, [clientCourse]); assert.deepEqual(saved.dashboard, dashboard);
      assert.equal(saved.revision, (await response.json()).revision);
      assert.equal((await workspace.PUT(request({ courses: [clientCourse], dashboard, baseRevision: revision }))).status, 409);
      assert.equal((await getWorkspace()).revision, saved.revision);
      for (const bad of [
        { ...dashboard, d: { ...dashboard.d, assignments: [{ ...dashboard.d.assignments[0], courseId: "foreign" }] } },
        { ...dashboard, d: { ...dashboard.d, manualEvents: [{ ...dashboard.d.manualEvents[0], dateKey: "2026-02-30" }] } },
      ]) assert.equal((await workspace.PUT(request({ courses: [{ ...clientCourse, name: "Must not update" }], dashboard: bad, baseRevision: saved.revision }))).status, 400);
      assert.deepEqual(await getWorkspace(), saved);
      assert.deepEqual(await sql("select * from dashboard_state where profile_id = $1", [b.id]), beforeB);
    });

    await t.test("legacy partial write paths cannot erase academic data", async () => {
      const saved = await getWorkspace();
      const raw = (method, body) => new Request("https://edu.example/api/workspace", { method, headers: { origin: "https://edu.example", "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal((await workspace.PUT(raw("PUT", { dashboard: layout, baseRevision: saved.revision }))).status, 426);
      assert.equal((await workspace.POST(raw("POST", { action: "create-course", course }))).status, 426);
      assert.equal((await workspace.DELETE(raw("DELETE", { id: course.id }))).status, 426);
      assert.deepEqual(await getWorkspace(), saved);
    });

    await t.test("GET retries a commit between document and course reads and returns one revision", async () => {
      const before = await getWorkspace();
      const nextDashboard = { ...before.dashboard, n: "Concurrent document" };
      let changed = false;
      runtime.beforeQuery = async (table, action) => {
        if (changed || table !== "courses" || action !== "select") return;
        changed = true;
        await snapshot([{ ...course, name: "Concurrent class" }], nextDashboard, before.revision);
      };
      try {
        const loaded = await getWorkspace();
        assert.equal(changed, true); assert.equal(loaded.courses[0].name, "Concurrent class");
        assert.equal(loaded.dashboard.n, "Concurrent document"); assert.notEqual(loaded.revision, before.revision);
      } finally { delete runtime.beforeQuery; }
    });

    await t.test("snapshot RPC atomically saves courses, data, and revision", async () => {
      const assignment = { id: "assignment-a", title: "Essay", courseId: course.id, due: "Sep 5", dateKey: "2026-09-05", status: "later", progress: 0, description: "Write", weight: "10%" };
      const dashboard = { ...layout, d: { ...layout.d, assignments: [assignment] } };
      const before = await getWorkspace();
      await snapshot([course], dashboard);
      const saved = await getWorkspace();
      assert.equal(saved.courses[0].name, course.name);
      assert.deepEqual(saved.dashboard, dashboard);
      await assert.rejects(snapshot([{ ...course, name: "Stale" }], layout, before.revision), { code: "40001" });
      await assert.rejects(snapshot([], dashboard), { code: "23503" });
      // A later row fails after a valid row has updated: the whole call rolls back.
      await assert.rejects(snapshot([{ ...course, name: "Must roll back" }, { ...course, id: "bad", credits: 100 }]), { code: "23514" });
      assert.equal((await getWorkspace()).courses[0].name, course.name);
      assert.equal((await getWorkspace()).revision, saved.revision);
      await assert.rejects(sql("select save_account_workspace($1, $2, $3, '[]', $4)", [a.id, userB, saved.revision, JSON.stringify(layout)]), { code: "42501" });
    });

    await t.test("file metadata enforces account folders, course ownership and size", async () => {
      const file = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const insert = (owner, courseId, path, size = 12) => sql("insert into user_files(profile_id,id,course_id,assignment_id,name,mime_type,size_bytes,object_path) values ($1,$2,$3,'assignment-a','Essay.pdf','application/pdf',$4,$5)", [owner, file, courseId, size, path]);
      await assert.rejects(insert(a.id, course.id, `${b.id}/${file}`), { code: "23514" });
      await assert.rejects(insert(b.id, course.id, `${b.id}/${file}`), { code: "23503" });
      await assert.rejects(insert(a.id, course.id, `${a.id}/${file}`, 26214401), { code: "23514" });
      await insert(a.id, course.id, `${a.id}/${file}`);
      // The current API removes the class and its assignments in one transaction.
      assert.equal((await workspace.PUT(request({ courses: [], dashboard: layout, baseRevision: (await getWorkspace()).revision }))).status, 200);
      const saved = (await sql("select * from user_files where profile_id = $1", [a.id])).rows[0];
      assert.equal(saved.course_id, null);
      assert.equal(saved.assignment_id, null);
      assert.equal(saved.name, "Essay.pdf");
    });

    await t.test("database and storage reject browser roles even with broad storage policies", async () => {
      await sql("insert into storage.objects(bucket_id,name) values ('eduessentials-private','private'), ('unrelated','public')");
      for (const role of ["anon", "authenticated"]) {
        await pg.exec(`set role ${role}`);
        try {
          for (const table of ["app_profiles", "courses", "dashboard_state", "user_files"]) await assert.rejects(sql(`select * from ${table}`), { code: "42501" });
          assert.deepEqual((await sql("select name from storage.objects")).rows.map((r) => r.name), ["public"]);
          await assert.rejects(sql("insert into storage.objects(bucket_id,name) values ('eduessentials-private','forged')"), { code: "42501" });
          await assert.rejects(sql("select save_account_workspace($1,$2,now(),'[]',$3)", [a.id, userA, JSON.stringify(layout)]), { code: "42501" });
        } finally { await pg.exec("reset role"); }
      }
    });

    await t.test("study settings, active timers, completion and grades are atomic, account-owned and protected from older clients", async () => {
      const { emptyStudy, timerAction, settleTimer, detachStudyCourse } = await import(await clientModule("lib/study.ts"));
      const { soft_color, ...fields } = course, clientCourse = { ...fields, soft: soft_color };
      const beforeB = (await sql("select * from dashboard_state where profile_id = $1", [b.id])).rows;
      const beginning = Date.parse("2026-09-07T10:00:00.000Z");
      const study = timerAction({ ...emptyStudy(), dailyMinutes: 60, weeklyMinutes: 300, timers: { pomodoro: { minutes: 25, courseId: course.id }, focus: { minutes: 45, courseId: "" } }, grades: [{ id: "grade-a", courseId: course.id, system: "4.0 scale", term: "Fall", max: 4, value: 3.5 }] }, "start", "pomodoro", beginning, "session-a");
      const dashboard = { ...layout, d: { ...layout.d, study } };
      const loaded = await getWorkspace();
      assert.equal((await workspace.PUT(request({ courses: [clientCourse], dashboard, baseRevision: loaded.revision, profile_id: b.id }))).status, 200);
      const running = await getWorkspace(); assert.deepEqual(running.dashboard.d.study, study);
      const completed = { ...dashboard, d: { ...dashboard.d, study: settleTimer(study, beginning + 3600000) } };
      const body = { courses: [clientCourse], dashboard: completed, baseRevision: running.revision };
      const responses = await Promise.all([workspace.PUT(request(body)), workspace.PUT(request(body))]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const saved = await getWorkspace(); assert.equal(saved.dashboard.d.study.active, null); assert.equal(saved.dashboard.d.study.sessions.length, 1); assert.equal(saved.dashboard.d.study.sessions[0].id, "session-a");
      assert.deepEqual(saved.dashboard.d.study.grades, study.grades);
      assert.equal((await workspace.PUT(request({ courses: [clientCourse], dashboard: layout, baseRevision: saved.revision }))).status, 426);
      const foreign = { ...completed, d: { ...completed.d, study: { ...completed.d.study, grades: [{ ...study.grades[0], courseId: "foreign-course" }] } } };
      assert.equal((await workspace.PUT(request({ courses: [clientCourse], dashboard: foreign, baseRevision: saved.revision }))).status, 400);
      assert.equal((await getWorkspace()).revision, saved.revision);
      const detached = { ...completed, d: { ...completed.d, study: detachStudyCourse(completed.d.study, course.id) } };
      assert.equal((await workspace.PUT(request({ courses: [], dashboard: detached, baseRevision: saved.revision }))).status, 200);
      const removed = await getWorkspace(); assert.equal(removed.courses.length, 0); assert.equal(removed.dashboard.d.study.sessions[0].courseId, ""); assert.equal(removed.dashboard.d.study.grades.length, 0);
      assert.deepEqual((await sql("select * from dashboard_state where profile_id = $1", [b.id])).rows, beforeB);
    });

    await privateFileCases({ t, assert, sql, runtime, a, b, userA, userB, compile, clientModule, authUrl, dbUrl, requestUrl, getWorkspace });

    await t.test("database triggers advance revisions after identity sync and direct writes", async () => {
      const before = await profileFor(userA);
      await sql("update auth.users set email = 'updated@example.invalid' where id = $1", [userA]);
      const after = await profileFor(userA);
      assert.notEqual(after.updated_at, before.updated_at);
      assert.equal(after.email, "updated@example.invalid");
      assert.equal(after.display_name, before.display_name);
    });
  } finally { delete globalThis.__foundationTest; await pg.close(); }
});
