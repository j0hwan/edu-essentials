import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { clientModule } from "./helpers/client-modules.mjs";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compile(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const policyUrl = await compile("lib/auth-policy.ts");
const profileUrl = await compile("lib/profile.ts");
const codecUrl = await clientModule("lib/workspace-codec.ts");
const requestUrl = await compile("lib/persistence-request.ts");
const revision = "2026-09-04T00:00:00.000Z";
const { isGoogleUser, isPublicPath } = await import(policyUrl);
const { validateProfile, defaultPreferences } = await import(profileUrl);
const { encodeWorkspaceState, decodeWorkspaceState } = await import(codecUrl);
const layout = encodeWorkspaceState([{ id: "day", name: "My day", widgets: [{ instanceId: "one", type: "notes", size: "large", note: "My notes" }] }], "day", "");

test("identity checks use server app metadata, never editable user metadata", () => {
  assert.equal(isGoogleUser(null), false);
  assert.equal(isGoogleUser({ app_metadata: { provider: "email" }, user_metadata: { provider: "google" } }), false);
  assert.equal(isGoogleUser({ app_metadata: { provider: "google" }, is_anonymous: true }), false);
  assert.equal(isGoogleUser({ app_metadata: { provider: "google" } }), true);
  assert.equal(isPublicPath("/overview/"), true);
  assert.equal(isPublicPath("/overview/private"), false);
  assert.equal(isPublicPath("/private.json"), false);
});
test("onboarding accepts only a name; all optional details can be skipped", () => {
  const profile = validateProfile({ display_name: "  Alex  " });
  assert.equal(profile.display_name, "Alex");
  assert.equal(profile.age, null);
  assert.equal(profile.university, "");
  assert.deepEqual(profile.preferences, defaultPreferences);
});
test("profile validation rejects malformed fields and excludes ownership fields", () => {
  for (const patch of [{ display_name: " " }, { age: -1 }, { academic_year: "invalid" }, { timezone: "not/a/zone" }, { preferences: { theme: "other" } }]) assert.throws(() => validateProfile({ display_name: "Alex", ...patch }));
  const custom = validateProfile({ display_name: "Alex", academic_year: "Other: Fifth year", academic_structure: "Other: Block plan", gpa_system: "Custom: 5.0 scale" });
  assert.equal(custom.academic_year, "Other: Fifth year"); assert.equal(custom.academic_structure, "Other: Block plan"); assert.equal(custom.gpa_system, "Custom: 5.0 scale");
  const result = validateProfile({ display_name: "Alex", id: "attacker", auth_user_id: "attacker", email: "fake@example.com", onboarding_completed_at: "forged" });
  assert.equal(result.auth_user_id, undefined);
  assert.equal(result.email, undefined);
  assert.equal(result.onboarding_completed_at, undefined);
});
test("widgets, notes, assignment edits and calendar events round trip", () => {
  const data = { assignments: [{ id: "a", title: "Essay", courseId: "c", due: "Tomorrow", dateKey: "2026-09-05", status: "done", progress: 100, description: "Write", weight: "10%", notes: "Submitted", checklist: [true, true, true] }], manualEvents: [{ id: "e", title: "Study", courseId: "c", dateKey: "2026-09-05", time: "18:00", type: "Study block" }], dashboardView: "list", calendarView: "week" };
  const decoded = decodeWorkspaceState({ ...layout, d: data });
  assert.deepEqual(decoded.data, data);
  assert.equal(decoded.workspaces[0].widgets[0].note, "My notes");
  assert.equal(decoded.workspaces[0].widgets[0].size, "large");
  assert.throws(() => decodeWorkspaceState({ ...layout, d: { ...data, assignments: [{ ...data.assignments[0], progress: 101 }] } }));
  assert.throws(() => decodeWorkspaceState({ ...layout, w: [["day", "Day", [[1000, 0]]]] }));
});

// Run real auth and API functions with a deterministic Supabase adapter.
// No live users or production data are created by these tests.
const state = globalThis.__accountTests = { user: null, calls: [], profile: null };
function query(table) {
  const call = { table, filters: [], action: "select" }; state.calls.push(call);
  const result = () => ({ error: null, data: table === "app_profiles" ? state.profile : table === "dashboard_state" ? { payload: layout, updated_at: call.value?.updated_at ?? revision } : [] });
  const chain = {
    select() { return chain; }, eq(key, value) { call.filters.push([key, value]); return chain; }, order() { return chain; },
    update(value) { call.action = "update"; call.value = value; return chain; },
    insert(value) { call.action = "insert"; call.value = value; return chain; },
    upsert(value) { call.action = "upsert"; call.value = value; return chain; },
    delete() { call.action = "delete"; return chain; },
    maybeSingle: async () => result(), single: async () => result(), then(resolve) { return Promise.resolve(result()).then(resolve); },
  };
  return chain;
}
state.db = { from: query, rpc: async (name, args) => { state.calls.push({ rpc: name, args }); return { data: revision, error: null }; } };
const sdk = moduleUrl('export const createServerClient = () => ({ auth: { getUser: async () => ({ data: { user: globalThis.__accountTests.user }, error: globalThis.__accountTests.authError }) } });');
const cookieStub = moduleUrl('export const cookies = async () => ({getAll: () => [],set: () => {}});');
const dbStub = moduleUrl('export const getSupabaseAdmin = () => globalThis.__accountTests.db; export const getSupabaseAuthConfig = () => ({url:"https://example.supabase.co",key:"test"});');
const authUrl = await compile("lib/auth.ts", { "@supabase/ssr": sdk, "next/headers": cookieStub, "./supabase-server": dbStub, "./auth-policy": policyUrl, "./profile": profileUrl });
const workspace = await import(await compile("app/api/workspace/route.ts", { "../../../lib/auth": authUrl, "../../../lib/academic-snapshot": await clientModule("lib/academic-snapshot.ts"), "../../../lib/supabase-server": dbStub, "../../../lib/persistence-request": requestUrl }));
const profileApi = await import(await compile("app/api/profile/route.ts", { "../../../lib/auth": authUrl, "../../../lib/profile": profileUrl, "../../../lib/supabase-server": dbStub, "../../../lib/persistence-request": requestUrl }));
const origin = "https://edu.example";
function reset() {
  state.user = { id: "user-a", email: "alex@example.com", app_metadata: { provider: "google" } };
  state.profile = { id: "profile-a", auth_user_id: "user-a", initialized: true, onboarding_completed_at: "2026-09-04", preferences: defaultPreferences, updated_at: revision };
  state.authError = null; state.calls = [];
}
function request(method, body, path = "/api/workspace") { return new Request(origin + path, { method, headers: { origin, "content-type": "application/json", cookie: "eduessentials_profile=profile-b" }, ...(body ? { body: JSON.stringify({ baseRevision: revision, ...body }) } : {}) }); }

test("workspace API rejects unverified users even without middleware", async () => {
  for (const user of [null, { id: "user-a", app_metadata: { provider: "email" } }]) {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      reset(); state.user = user;
      assert.equal((await workspace[method](request(method))).status, 401);
      assert.equal(state.calls.length, 0);
    }
  }
});
test("onboarding must complete before workspace data can be accessed", async () => {
  reset(); state.profile.onboarding_completed_at = null;
  assert.equal((await workspace.GET(request("GET"))).status, 403);
  assert.ok(state.calls.every((call) => call.table === "app_profiles"));
});

test("authentication outages preserve retry semantics instead of claiming the session expired", async () => {
  for (const error of [{ name: "AuthRetryableFetchError", status: 0 }, { name: "AuthApiError", status: 503 }]) {
    reset(); state.authError = error;
    const response = await workspace.GET(request("GET"));
    assert.equal(response.status, 503); assert.match((await response.json()).error, /temporarily unavailable/);
    assert.equal(state.calls.length, 0);
  }
  reset(); state.authError = { name: "AuthApiError", status: 401 };
  assert.equal((await workspace.GET(request("GET"))).status, 401);
});

test("OAuth callback distinguishes unavailable auth from expired codes", async () => {
  const auth = moduleUrl('export const createAuthClient = async () => ({auth:{exchangeCodeForSession:async()=>({data:{user:null},error:globalThis.__accountTests.authError})}}); export const ensureProfile=async()=>{throw new Error("unexpected profile write")};');
  const callback = await import(await compile("app/auth/callback/route.ts", { "../../../lib/auth": auth, "../../../lib/auth-policy": policyUrl }));
  const original = console.error; console.error = () => {};
  try {
    for (const [error, destination] of [[{ name: "AuthRetryableFetchError", status: 0 }, "/login?error=unavailable"], [{ name: "AuthApiError", status: 400 }, "/login?error=callback"]]) {
      state.authError = error;
      const response = await callback.GET(new Request(origin + "/auth/callback?code=test-only"));
      assert.equal(response.status, 303); assert.equal(response.headers.get("location"), destination);
    }
  } finally { console.error = original; reset(); }
});
test("reads use verified account ownership and ignore legacy cookies", async () => {
  reset(); assert.equal((await workspace.GET(request("GET"))).status, 200);
  assert.deepEqual(state.calls[0].filters, [["auth_user_id", "user-a"]]);
  for (const call of state.calls.filter((call) => call.table !== "app_profiles")) assert.deepEqual(call.filters, [["profile_id", "profile-a"]]);
});
test("writes cannot target a profile supplied by the client", async () => {
  reset(); assert.equal((await workspace.PUT(request("PUT", { profile_id: "profile-b", courses: [], dashboard: layout }))).status, 200);
  const write = state.calls.find((call) => call.rpc);
  assert.equal(write.args.p_profile_id, "profile-a"); assert.equal(write.args.p_auth_user_id, "user-a"); assert.equal(write.args.p_expected_revision, revision);
  reset(); assert.equal((await workspace.DELETE(request("DELETE", undefined, "/api/workspace?courseId=course-b&profile_id=profile-b"))).status, 426);
  assert.ok(state.calls.every((call) => call.action === "select"));
});
test("initialization uses the atomic RPC for the verified profile", async () => {
  reset(); state.profile.initialized = false; assert.equal((await workspace.POST(request("POST", { action: "initialize", courses: [], dashboard: layout }))).status, 201);
  assert.equal(state.calls.find((call) => call.rpc).args.p_profile_id, "profile-a");
});
test("cross-origin writes and malformed layouts fail before data changes", async () => {
  reset(); assert.equal((await workspace.PUT(new Request(origin + "/api/workspace", { method: "PUT", headers: { origin: "https://evil.example" } }))).status, 403);
  assert.equal(state.calls.length, 0);
  reset(); assert.equal((await workspace.PUT(request("PUT", { courses: [], dashboard: { v: 99 } }))).status, 400);
  assert.ok(state.calls.every((call) => call.action === "select"));
});
test("profile completion stores fields without changing account identity", async () => {
  reset(); state.profile.onboarding_completed_at = null;
  assert.equal((await profileApi.PUT(request("PUT", { display_name: "Alex", email: "fake@example.com", auth_user_id: "user-b" }, "/api/profile"))).status, 200);
  const update = state.calls.find((call) => call.action === "update");
  assert.equal(update.value.display_name, "Alex");
  assert.ok(update.value.onboarding_completed_at);
  assert.equal(update.value.email, undefined);
  assert.equal(update.value.auth_user_id, undefined);
  assert.deepEqual(update.filters, [["id", "profile-a"], ["auth_user_id", "user-a"], ["updated_at", revision]]);
});
