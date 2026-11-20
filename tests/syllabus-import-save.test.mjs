import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { clientModule } from "./helpers/client-modules.mjs";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const profile = { id: "test-profile", auth_user_id: "test-user", initialized: true };
const courseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const time = "2026-10-01T10:00:00.000Z";
const concurrentTime = "2026-10-01T10:00:01.000Z";
const committedTime = "2026-10-01T10:00:02.000Z";
const { emptyCourse } = await import(await clientModule("lib/academics.ts"));
const { encodeWorkspaceState, decodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));
const workspaces = [{ id: "day", name: "My Day", widgets: [] }];
const source = { kind: "syllabus", mime_type: "application/pdf", state: "ready", course_id: null, assignment_id: null };
const draft = {
  course: { ...emptyCourse(courseId), code: "ECON 1", name: "Microeconomics" },
  details: { officeHours: "", meetings: [], syllabusFileId: fileId, syllabusName: "Original.pdf", syllabusTerm: "Fall 2026" },
  assignments: [{ id: "exam", courseId, title: "Final Exam", type: "Exam", dateKey: "2026-12-11", due: "Dec 11, 2026",
    examStart: "08:00", examEnd: "10:59", description: "", weight: "", status: "later", progress: 0 }],
  allowDuplicate: false,
};

let routeSource = await readFile(new URL("../app/api/workspace/syllabus-import/route.ts", import.meta.url), "utf8");
const mocks = new Map([
  ["auth", moduleUrl(`
    export class AuthError extends Error {}
    export const apiError = () => new Response(null, { status: 401 });
    export const requireSameOrigin = (request) => { if (request.headers.get("origin") !== "https://edu.example") throw new AuthError(); };
    export const requireProfile = async () => globalThis.__syllabusSaveTest.profile;
  `)],
  ["workspace-server", moduleUrl("export const readAcademicWorkspace = async () => globalThis.__syllabusSaveTest.workspace;")],
  ["supabase-server", moduleUrl("export const getSupabaseAdmin = () => globalThis.__syllabusSaveTest.db;")],
]);
for (const match of routeSource.matchAll(/"\.\.\/\.\.\/\.\.\/\.\.\/lib\/([^"]+)"/g)) {
  routeSource = routeSource.replaceAll(match[0], JSON.stringify(mocks.get(match[1]) ?? await clientModule(`lib/${match[1]}.ts`)));
}
const { POST } = await import(moduleUrl(ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText));

function setup({ duplicate = false, concurrent = false, file = source } = {}) {
  const unrelated = { ...emptyCourse("other"), code: duplicate ? "econ 1" : "BIO 1", name: "Other course" };
  const unrelatedTask = { id: "old-task", courseId: unrelated.id, title: "Existing task", dateKey: "", due: "",
    description: "", weight: "", progress: 0, status: "later" };
  const data = { assignments: [unrelatedTask], manualEvents: [], dashboardView: "cards" };
  const state = {
    profile, file, workspace: { courses: [unrelated], dashboard: encodeWorkspaceState(workspaces, "day", "", data), revision: time },
    writes: 0, checks: [], db: {
      from(table) {
        assert.equal(table, "user_files");
        const query = { select() { return query; }, eq(...args) { state.checks.push(args); return query; },
          async maybeSingle() { return { data: state.file }; } };
        return query;
      },
      async rpc(name, params) {
        assert.equal(name, "save_account_workspace");
        assert.equal(params.p_profile_id, profile.id);
        assert.equal(params.p_auth_user_id, profile.auth_user_id);
        assert.equal(params.p_expected_revision, state.workspace.revision);
        state.writes++;
        if (concurrent && state.writes === 1) {
          state.workspace = { ...state.workspace, revision: concurrentTime, dashboard: encodeWorkspaceState(workspaces, "day", "Concurrent workspace note", data) };
          return { error: { code: "PT409" } };
        }
        state.workspace = { courses: params.p_courses.map(({ soft_color, ...item }) => ({ ...item, soft: soft_color })), dashboard: JSON.parse(JSON.stringify(params.p_dashboard)), revision: committedTime };
        state.file = { ...state.file, course_id: courseId };
        return { data: committedTime };
      },
    },
  };
  globalThis.__syllabusSaveTest = state;
  return state;
}

const submit = (value = draft, headers = {}) => POST(new Request("https://edu.example/api/workspace/syllabus-import", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://edu.example", "x-profile-id": profile.id, ...headers },
  body: JSON.stringify(value),
}));

test("save retries on a concurrent revision and preserves unrelated work and the original PDF", async () => {
  const state = setup({ concurrent: true });
  assert.equal((await submit()).status, 201);
  assert.equal(state.writes, 2);
  const loaded = decodeWorkspaceState(state.workspace.dashboard);
  assert.equal(loaded.notes, "Concurrent workspace note");
  assert.equal(loaded.data.courseDetails[courseId].syllabusFileId, fileId);
  assert.deepEqual(loaded.data.assignments.map(({ id }) => id), ["old-task", "exam"]);
  assert.equal(loaded.data.assignments[1].examEnd, "10:59");
  assert.equal(state.file.course_id, courseId);
  assert.deepEqual(state.checks.slice(0, 2), [["profile_id", profile.id], ["id", fileId]]);

  const retried = await submit();
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).alreadySaved, true);
  assert.equal(state.writes, 2);
});

test("concurrent duplicate or unavailable PDF requires explicit resolution before any write", async () => {
  let state = setup({ duplicate: true });
  const warning = await submit();
  assert.equal(warning.status, 409);
  assert.equal((await warning.json()).code, "duplicate-class");
  assert.equal(state.writes, 0);
  assert.equal((await submit({ ...draft, allowDuplicate: true })).status, 201);

  for (const file of [null, { ...source, trashed_at: time }, { ...source, course_id: "other" }, { ...source, mime_type: "text/plain" }]) {
    state = setup({ file });
    const rejected = await submit();
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).code, "syllabus-source-unavailable");
    assert.equal(state.writes, 0);
  }
  state = setup();
  assert.equal((await submit(draft, { "x-profile-id": "another" })).status, 401);
  assert.equal(state.writes, 0);
});
