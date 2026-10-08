import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/home" });
for (const name of ["window", "document", "Element", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent", "KeyboardEvent"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const [{ createElement, act }, { createRoot }, { default: OnboardingFlow }, { validateProfile }, { decodeWorkspaceState, encodeWorkspaceState }, { emptyStudy }, { default: Workspace }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  clientModule("app/onboarding-flow.tsx").then((url) => import(url)),
  clientModule("lib/profile.ts").then((url) => import(url)),
  clientModule("lib/workspace-codec.ts").then((url) => import(url)),
  clientModule("lib/study.ts").then((url) => import(url)),
  clientModule("app/workspace-client.tsx").then((url) => import(url)),
]);

const rootNode = document.getElementById("root");
const initialProfile = {
  ...validateProfile({
    display_name: "Alex",
    last_name: "Rivera",
    birthday: "2004-02-29",
    timezone: "America/Los_Angeles",
    study_goal: "Keep up with weekly readings",
    university: "Saved University",
    major: "History",
    school_type: "college",
    graduation_year: "2028",
    program_length: "4",
    academic_year: "Senior",
    current_term: "Fall",
    academic_structure: "Quarter",
    gpa_system: "Percentage",
    week_starts_on: "Monday",
    preferences: { theme: "dark", reducedMotion: false, highContrast: true, deadlineReminders: true, dailyStudyPlan: false, streakNudges: true },
  }),
  id: "profile-a",
  auth_user_id: "user-a",
  email: "alex@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: "2026-09-06T00:00:00.000Z",
  onboarding_completed_at: null,
};

let root;
async function mount(component = OnboardingFlow, props = { initialProfile, preview: true }) {
  root = createRoot(rootNode);
  await act(async () => root.render(createElement(component, props)));
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
  rootNode.innerHTML = "";
}
function button(text, container = rootNode) {
  const found = [...container.querySelectorAll("button")].find((node) => {
    const label = node.textContent.trim();
    return label === text || label.startsWith(text) || node.querySelector("strong")?.textContent.trim() === text || node.getAttribute("aria-label") === text;
  }) ?? (text === "Continue" ? container.querySelector(".ee-onboarding-primary") : text === "Skip this step" ? container.querySelector(".ee-onboarding-text-action") : null);
  assert.ok(found, `Missing button: ${text}`);
  return found;
}
async function click(text, container = rootNode) {
  const target = button(text, container);
  await act(async () => target.click());
  return target;
}
function field(label, container = rootNode) {
  const found = [...container.querySelectorAll("label")].find((node) => node.querySelector("span")?.textContent.trim().startsWith(label));
  assert.ok(found, `Missing field: ${label}`);
  const input = found.querySelector("input, select, textarea");
  assert.ok(input, `Missing input for field: ${label}`);
  return input;
}
async function edit(label, value, container = rootNode) {
  const input = field(label, container);
  const prototype = input.tagName === "SELECT" ? HTMLSelectElement.prototype : input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  return input;
}
async function waitUntil(predicate, description, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate() && Date.now() - started < timeoutMs) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.ok(predicate(), `Timed out waiting for ${description}`);
}
async function typeKey(target, key) {
  await act(async () => target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}

function controlWindowTimers() {
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  let now = 0;
  window.setTimeout = (callback, delay = 0, ...args) => {
    const id = ++nextId;
    timers.set(id, { callback, dueAt: now + Number(delay), args });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  return {
    async fire(delay) {
      now += delay;
      const due = [...timers.entries()].filter(([, timer]) => timer.dueAt <= now).sort((a, b) => a[1].dueAt - b[1].dueAt || a[0] - b[0]);
      await act(async () => {
        for (const [id, timer] of due) {
          if (!timers.delete(id)) continue;
          timer.callback(...timer.args);
        }
      });
    },
    restore() {
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    },
  };
}

async function reachSyllabus(timers) {
  await click("Continue");
  assert.match(rootNode.textContent, /Where do you study\?/);
  await click("Skip this step");
  assert.match(rootNode.textContent, /Schools near you/);
  await timers.fire(1000); await timers.fire(1000);
  await click("Skip this step");
  assert.match(rootNode.textContent, /When do you expect to graduate\?/);
  await click("Skip this step");
  assert.match(rootNode.textContent, /Add a syllabus/);
}

test("preview opens with five blank steps even when the saved profile is populated", async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return Response.json({}); };
  let geolocationCalls = 0;
  Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: { getCurrentPosition() { geolocationCalls++; }, watchPosition() { geolocationCalls++; } } });
  const storageBefore = [...Array(window.localStorage.length)].map((_, index) => [window.localStorage.key(index), window.localStorage.getItem(window.localStorage.key(index))]);
  await mount();
  try {
    assert.match(rootNode.textContent, /Step 1 of 5/);
    assert.match(rootNode.textContent, /Let’s get to know you\./);
    for (const name of ["First name", "Last name", "Birthday", "Time zone", "Study goal"]) assert.equal(field(name).value, "", `${name} starts blank in preview`);
    assert.equal(geolocationCalls, 0);
    assert.deepEqual(calls, [], "opening preview does not call an API");
    const storageAfter = [...Array(window.localStorage.length)].map((_, index) => [window.localStorage.key(index), window.localStorage.getItem(window.localStorage.key(index))]);
    assert.deepEqual(storageAfter, storageBefore);
  } finally { await unmount(); }
});

test("optional school answers can be skipped and Back restores the draft", async () => {
  const timers = controlWindowTimers();
  try {
    await mount();
    await edit("First name", "Avery");
    await click("Continue");
    await act(async () => button("College").click());
    await click("Skip this step");
    assert.match(rootNode.textContent, /Schools near you/);
    await click("Back");
    assert.equal(button("College").getAttribute("aria-pressed"), "true");
    await click("Back");
    assert.equal(field("First name").value, "Avery");
  } finally { timers.restore(); await unmount(); }
});

test("location skip is locked for two seconds on every arrival and never requests geolocation", async () => {
  const timers = controlWindowTimers();
  let geolocationCalls = 0;
  Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: { getCurrentPosition() { geolocationCalls++; } } });
  try {
    await mount();
    await click("Continue");
    await act(async () => button("High school").click());
    await click("Continue");
    assert.match(rootNode.textContent, /Schools near you/);
    assert.ok(button("Continue").disabled);
    assert.ok(button("Skip this step").disabled);
    await timers.fire(1000);
    assert.ok(button("Continue").disabled, "the step remains locked after one second");
    await timers.fire(1000);
    assert.equal(button("Continue").disabled, false);
    assert.equal(button("Skip this step").disabled, false);
    await click("Back");
    await click("Continue");
    assert.ok(button("Continue").disabled, "returning to location starts a fresh delay");
    await timers.fire(1000);
    assert.ok(button("Skip this step").disabled);
    await timers.fire(1000);
    assert.equal(button("Skip this step").disabled, false);
    assert.equal(geolocationCalls, 0);
    assert.ok(rootNode.querySelector(".ee-onboarding-skeleton-lines"), "campus discovery is presented as a loading skeleton");
  } finally { timers.restore(); await unmount(); }
});

test("school type routes high school past major and college through the optional major step", async () => {
  const timers = controlWindowTimers();
  try {
    await mount();
    await click("Continue");
    await act(async () => button("High school").click());
    await click("Continue");
    await timers.fire(1000); await timers.fire(1000);
    await click("Continue");
    assert.match(rootNode.textContent, /When do you expect to graduate\?/);
    assert.doesNotMatch(rootNode.textContent, /What are you studying\?/);

    await unmount();
    await mount();
    await click("Continue");
    await act(async () => button("College").click());
    await click("Continue");
    await timers.fire(1000); await timers.fire(1000);
    await click("Continue");
    assert.match(rootNode.textContent, /What are you studying\?/);
    await click("Skip this step");
    assert.match(rootNode.textContent, /When do you expect to graduate\?/);
  } finally { timers.restore(); await unmount(); }
});

test("syllabus step shows a disabled coming-soon upload with no file input", async () => {
  const timers = controlWindowTimers();
  try {
    await mount();
    await click("Continue");
    await click("Skip this step");
    await timers.fire(1000); await timers.fire(1000);
    await click("Skip this step");
    await click("Skip this step");
    assert.match(rootNode.textContent, /Add a syllabus/);
    assert.equal(button("Coming soon").disabled, true);
    assert.equal(rootNode.querySelector('input[type="file"]'), null);
  } finally { timers.restore(); await unmount(); }
});

test("preview can finish and restart with a fresh draft, then exits by Escape or its close button without writes", async () => {
  const timers = controlWindowTimers();
  const writes = [];
  globalThis.fetch = async (url, init = {}) => { if (init.method) writes.push([url, init.method]); return Response.json({}); };
  let exits = 0;
  try {
    await mount(OnboardingFlow, { initialProfile, preview: true, onExit: () => exits++ });
    await edit("First name", "Morgan");
    await reachSyllabus(timers);
    assert.equal(button("Finish preview").disabled, false);
    await click("Finish preview");
    assert.match(rootNode.textContent, /Your setup is complete/);
    await click("Restart preview");
    assert.match(rootNode.textContent, /Step 1 of 5/);
    assert.equal(field("First name").value, "");
    await click("Exit onboarding test");
    await act(async () => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(exits, 2);
    assert.deepEqual(writes, [], "preview finish and restart never persist profile or workspace data");
  } finally { timers.restore(); await unmount(); }
});

test("normal completion sends the account-scoped profile revision and onboarding fields", async () => {
  let request;
  let finishSave;
  globalThis.fetch = (url, init = {}) => new Promise((resolve) => {
    request = { url, init, body: JSON.parse(init.body) };
    finishSave = () => resolve(Response.json({ profile: { ...initialProfile, ...request.body, updated_at: "2026-09-06T00:00:01.000Z" } }));
  });
  await mount(OnboardingFlow, { initialProfile, preview: false });
  try {
    await edit("Birthday", "");
    await edit("Birthday", "2004-02-29");
    await click("Skip setup");
    const answers = rootNode.querySelector(".ee-onboarding-answers");
    assert.ok(answers?.matches(":disabled"), "all answer controls are disabled while the profile PUT is pending");
    for (const control of answers.querySelectorAll("input, select, button")) assert.ok(control.matches(":disabled"), `${control.tagName} is disabled through the answer fieldset`);
    await act(async () => finishSave());
    await waitUntil(() => rootNode.textContent.includes("Your setup is saved"), "profile save completion");
    assert.equal(request.url, "/api/profile");
    assert.equal(request.init.method, "PUT");
    assert.equal(request.init.headers["x-profile-id"], initialProfile.id);
    assert.equal(request.body.baseRevision, initialProfile.updated_at);
    assert.equal(request.body.birthday, "2004-02-29");
    assert.equal(request.body.school_type, "college");
    assert.equal(request.body.major, "History");
    assert.equal(request.body.graduation_year, "2028");
    assert.equal(request.body.program_length, "4");
    assert.equal(request.body.age, 22);
  } finally { await unmount(); }
});

test("401, revision conflict, and network errors keep the user's draft visible", async () => {
  const scenarios = [
    { name: "401 session error", fetch: async () => Response.json({ error: "Session ended" }, { status: 401 }), message: /session ended or the account changed/i },
    { name: "409 revision conflict", fetch: async () => Response.json({}, { status: 409 }), message: /profile changed in another session/i },
    { name: "network error", fetch: async () => { throw new Error("Offline"); }, message: /could not be saved/i },
  ];
  for (const scenario of scenarios) {
    await unmount();
    globalThis.fetch = scenario.fetch;
    await mount(OnboardingFlow, { initialProfile, preview: false });
    try {
      await edit("First name", "Jamie");
      await click("Skip setup");
      await waitUntil(() => rootNode.querySelector('[role="alert"]'), `${scenario.name} message`);
      assert.match(rootNode.querySelector('[role="alert"]').textContent, scenario.message, scenario.name);
      assert.equal(field("First name").value, "Jamie", `${scenario.name} preserves the draft value`);
      assert.equal(field("Birthday").value, "2004-02-29", `${scenario.name} preserves optional answers`);
      assert.ok(button(scenario.name.includes("conflict") ? "Load latest & retry" : "Retry"), `${scenario.name} offers recovery`);
    } finally { await unmount(); }
  }
});

test("repeated profile conflicts preserve local name edits and the newest remote settings", async () => {
  const latestOne = {
    ...initialProfile,
    university: "Remote University One",
    current_term: "Spring term",
    gpa_system: "4.0 scale",
    preferences: { ...initialProfile.preferences, theme: "light", dailyStudyPlan: true },
    updated_at: "2026-10-07T00:00:01.000Z",
  };
  const latestTwo = {
    ...latestOne,
    university: "Remote University Two",
    current_term: "Summer term",
    gpa_system: "Custom",
    preferences: { ...latestOne.preferences, theme: "system", dailyStudyPlan: false, highContrast: false },
    updated_at: "2026-10-07T00:00:02.000Z",
  };
  let latest = latestOne;
  const writes = [];
  let reads = 0;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, "/api/profile");
    if (init.method === "PUT") {
      const body = JSON.parse(init.body);
      writes.push(body);
      if (writes.length === 1) return Response.json({}, { status: 409 });
      if (writes.length === 2) {
        latest = latestTwo;
        return Response.json({}, { status: 409 });
      }
      return Response.json({ profile: { ...latest, ...body, updated_at: "2026-10-07T00:00:03.000Z" } });
    }
    reads++;
    return Response.json({ profile: latest });
  };
  await mount(OnboardingFlow, { initialProfile, preview: false });
  try {
    await edit("First name", "Jamie");
    await click("Skip setup");
    await waitUntil(() => writes.length === 1 && rootNode.querySelector('[role="alert"]')?.textContent.toLowerCase().includes("profile changed in another session"), "first profile conflict");
    await click("Load latest & retry");
    await waitUntil(() => writes.length === 2 && rootNode.querySelector('[role="alert"]')?.textContent.toLowerCase().includes("profile changed in another session"), "second profile conflict");
    await click("Load latest & retry");
    await waitUntil(() => rootNode.textContent.includes("Your setup is saved"), "successful retry after second conflict");

    assert.equal(reads, 2);
    assert.equal(writes[0].display_name, "Jamie");
    assert.equal(writes[1].display_name, "Jamie");
    assert.equal(writes[1].university, "Remote University One");
    assert.equal(writes[2].display_name, "Jamie");
    assert.equal(writes[2].university, "Remote University Two", "the second remote edit survives another conflict");
    assert.equal(writes[2].current_term, "Summer term");
    assert.equal(writes[2].gpa_system, "Custom");
    assert.deepEqual(writes[2].preferences, latestTwo.preferences);
    assert.equal(writes[2].baseRevision, latestTwo.updated_at);
  } finally { await unmount(); }
});

test("school search debounces, aborts stale requests, and supports keyboard selection", async () => {
  const requests = [];
  globalThis.fetch = (url, init = {}) => {
    const parsed = new URL(String(url), "https://edu.example");
    const request = { query: parsed.searchParams.get("q"), signal: init.signal };
    requests.push(request);
    if (requests.length === 1) return new Promise((resolve, reject) => {
      request.resolve = resolve;
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    return Promise.resolve(Response.json({ schools: [{ id: "school-1", name: "North State University", location: "North City" }] }));
  };
  await mount();
  try {
    await click("Continue");
    await act(async () => button("College").click());
    const school = field("Your school");
    await edit("Your school", "N");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    await edit("Your school", "North");
    await waitUntil(() => requests.length === 1, "debounced school query", 1000);
    assert.equal(requests[0].query, "North", "the earlier short query was cancelled before it reached the API");
    await edit("Your school", "North City");
    assert.equal(requests[0].signal.aborted, true, "changing the query aborts the in-flight request");
    await waitUntil(() => requests.length === 2, "replacement school query", 1000);
    await waitUntil(() => rootNode.querySelector('[role="option"]'), "school suggestions");
    await typeKey(school, "ArrowDown");
    assert.equal(school.getAttribute("aria-activedescendant"), "ee-school-option-0");
    await typeKey(school, "Enter");
    assert.equal(school.value, "North State University");
    assert.equal(rootNode.querySelector('[role="option"]'), null, "selecting a suggestion closes the list");
  } finally { await unmount(); }
});

test("workspace menu opens and exits onboarding preview without account writes or local storage writes", async () => {
  const dashboard = encodeWorkspaceState([{ id: "my-day", name: "My Day", widgets: [] }], "my-day", "", { assignments: [], manualEvents: [], dashboardView: "cards" });
  const accountWrites = [];
  const storageWrites = [];
  const storage = Object.getPrototypeOf(window.localStorage);
  const originalSetItem = storage.setItem;
  const originalRemoveItem = storage.removeItem;
  storage.setItem = function (...args) { storageWrites.push(["set", ...args]); return originalSetItem.apply(this, args); };
  storage.removeItem = function (...args) { storageWrites.push(["remove", ...args]); return originalRemoveItem.apply(this, args); };
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && ["PUT", "POST", "DELETE"].includes(init.method)) accountWrites.push([url, init.method]);
    if (String(url).startsWith("/api/files")) return Response.json({ files: [] });
    if (String(url) === "/api/workspace") return Response.json({ initialized: true, courses: [], dashboard, revision: initialProfile.updated_at, profile: initialProfile });
    throw new Error(`Unexpected workspace request: ${url}`);
  };
  try {
    await mount(Workspace, { initialProfile });
    await waitUntil(() => rootNode.querySelector(".experimental-trigger") && !rootNode.querySelector(".experimental-trigger").disabled, "workspace menu availability");
    await click("Experimental mode");
    await click("Onboard test");
    assert.match(rootNode.textContent, /Step 1 of 5/);
    assert.equal(field("First name").value, "");
    await click("Exit onboarding test");
    await waitUntil(() => rootNode.querySelector(".experimental-trigger"), "return to workspace");
    assert.deepEqual(accountWrites, []);
    assert.deepEqual(storageWrites, []);
  } finally {
    storage.setItem = originalSetItem;
    storage.removeItem = originalRemoveItem;
    await unmount();
  }
});

test("a running study timer does not save while workspace onboarding preview is open", async () => {
  window.history.replaceState({}, "", "/home");
  const runningStudy = {
    ...emptyStudy(),
    timers: { ...emptyStudy().timers, pomodoro: { minutes: 1, courseId: "" } },
    active: { id: "preview-timer-session", kind: "pomodoro", courseId: "", durationSeconds: 60, segments: [], runningSince: new Date(Date.now() - 58_000).toISOString() },
  };
  const dashboard = encodeWorkspaceState([{ id: "my-day", name: "My Day", widgets: [] }], "my-day", "", { assignments: [], manualEvents: [], dashboardView: "cards", study: runningStudy });
  let revision = initialProfile.updated_at;
  let savedDashboard = dashboard;
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("/api/files")) return Response.json({ files: [] });
    if (String(url) === "/api/workspace" && init.method === "PUT") {
      const body = JSON.parse(init.body);
      writes.push(body);
      savedDashboard = body.dashboard;
      revision = new Date(Date.parse(revision) + 1000).toISOString();
      return Response.json({ revision });
    }
    if (String(url) === "/api/workspace") return Response.json({ initialized: true, courses: [], dashboard: savedDashboard, revision, profile: initialProfile });
    throw new Error(`Unexpected workspace request: ${url}`);
  };
  await mount(Workspace, { initialProfile });
  try {
    await waitUntil(() => rootNode.querySelector(".experimental-trigger") && !rootNode.querySelector(".experimental-trigger").disabled, "workspace ready for onboarding preview");
    assert.equal(writes.length, 0, "the loaded timer is not an unsaved workspace edit");
    await click("Experimental mode");
    await click("Onboard test");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 3400)));
    assert.equal(writes.length, 0, "an expired running timer does not trigger an account write while preview is open");

    await click("Exit onboarding test");
    await waitUntil(() => rootNode.querySelector(".experimental-trigger"), "return to workspace after preview");
    await act(async () => window.dispatchEvent(new window.Event("focus")));
    await waitUntil(() => writes.length === 1, "the overdue timer to complete after returning", 3000);
    const savedStudy = decodeWorkspaceState(writes[0].dashboard).data.study;
    assert.equal(savedStudy.active, null);
    assert.ok(savedStudy.sessions.some((session) => session.id === "preview-timer-session"), "the timer completes normally after preview exit");
  } finally { await unmount(); }
});
