import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ProfileEditor } = await import(await clientModule("app/profile-editor.tsx"));
const { default: Workspace } = await import(await clientModule("app/workspace-client.tsx"));
const { validateProfile } = await import(await clientModule("lib/profile.ts"));
const { decodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));
const { academicSnapshot } = await import(await clientModule("lib/academic-snapshot.ts"));
const { emptyStudy, timerAction } = await import(await clientModule("lib/study.ts"));
const baseProfile = { ...validateProfile({ display_name: "Alex" }), id: "profile-a", auth_user_id: "user-a", email: "alex@example.invalid", avatar_url: null, initialized: true, updated_at: "2026-09-06T00:00:00.000Z", onboarding_completed_at: "2026-09-05T00:00:00.000Z" };
const rootNode = document.getElementById("root");
let root, fetcher, filesFetcher, alerts, media, downloads;
globalThis.fetch = (...args) => String(args[0]).startsWith("/api/files") ? filesFetcher ? filesFetcher(...args) : Response.json({ files: [] }) : fetcher(...args);
window.confirm = () => true;
window.alert = (text) => alerts.push(text);
// Capture downloaded values without navigating or retaining personal data.
URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:test"; };
URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {};
function reset() {
  alerts = []; downloads = [];
  window.history.replaceState({}, "", "/home");
  window.confirm = () => true;
  media = { matches: false, listeners: new Set(), addEventListener(_event, fn) { this.listeners.add(fn); }, removeEventListener(_event, fn) { this.listeners.delete(fn); } };
  window.matchMedia = () => media;
  root = createRoot(rootNode);
}
async function render(component, props) { await act(async () => root.render(createElement(component, props))); }
async function unmount() { await act(async () => root.unmount()); root = undefined; rootNode.innerHTML = ""; }
function field(label) {
  const scope = rootNode.querySelector(".academic-editor") ?? rootNode;
  const node = [...scope.querySelectorAll("label")].find((node) => node.textContent.startsWith(label));
  assert.ok(node, `Missing field ${label}`); return node.querySelector("input,select,textarea");
}
async function edit(label, value) {
  const input = field(label);
  await act(async () => {
    if (input.type === "checkbox") { if (input.checked !== value) input.click(); }
    else {
      const prototype = input.tagName === "SELECT" ? HTMLSelectElement.prototype : input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
      input.dispatchEvent(new window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }
  });
}
async function click(text) {
  const control = [...rootNode.querySelectorAll("button,a")].find((node) => node.textContent.trim() === text);
  assert.ok(control, `Missing control ${text}`);
  await act(async () => {
    if (control.tagName === "A") control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    else control.click();
  });
}
function unloadBlocked() { const event = new window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
const savedDashboard = { v: 1, a: "day", w: [["day", "Day", [[12, 1]]]], n: "Saved notes", d: { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month" } };
async function editNotes(value) {
  const textarea = rootNode.querySelector('textarea[aria-label="Quick notes"]');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value); textarea.dispatchEvent(new window.Event("input", { bubbles: true })); });
}

test("settings UI saves, preserves drafts, and recovers without losing account edits", async (t) => {
  t.afterEach(async () => { if (root) await unmount(); });
  await t.test("all settings fields submit together and clear dirty state after confirmation", async () => {
    reset(); let payload;
    fetcher = async (_url, init) => { payload = JSON.parse(init.body); return Response.json({ profile: { ...baseProfile, ...validateProfile(payload), updated_at: "2026-09-06T00:00:01Z" } }); };
    await render(ProfileEditor, { initialProfile: baseProfile });
    for (const [name, value] of Object.entries({ "Display name": "Taylor", "Last name": "Lee", "College or university": "Example University", "Major": "History", "Academic year": "Senior", "Age": "22", "Study goal": "Read every day", "Current term": "Fall", "Academic structure": "Quarter", "GPA system": "Percentage", "Week starts on": "Monday", "Time zone": "America/New_York", "Theme": "system" })) await edit(name, value);
    for (const [name, value] of [["Deadline reminders", false], ["Daily study plan", false], ["Study streak nudges", true], ["Reduce motion", true], ["High-contrast status labels", false]]) await edit(name, value);
    assert.equal(unloadBlocked(), true);
    await click("Save changes");
    assert.equal(payload.display_name, "Taylor"); assert.equal(payload.university, "Example University"); assert.equal(payload.age, 22);
    assert.equal(payload.timezone, "America/New_York"); assert.equal(payload.preferences.theme, "system"); assert.equal(payload.preferences.deadlineReminders, false);
    assert.equal(field("Display name").value, "Taylor"); assert.equal(unloadBlocked(), false);
    assert.match(rootNode.textContent, /profile and preferences are saved/);
    assert.equal(document.documentElement.dataset.motion, "reduced"); assert.equal(document.documentElement.dataset.contrast, "normal");
    await act(async () => { media.matches = true; media.listeners.forEach((fn) => fn()); });
    assert.equal(document.documentElement.dataset.theme, "dark");
    await unmount(); assert.equal(media.listeners.size, 0);
  });

  await t.test("failed saves preserve the draft, block signout, and retry without retyping", async () => {
    reset(); let fail = true;
    fetcher = async (_url, init) => { if (fail) throw new Error("Offline"); return Response.json({ profile: { ...baseProfile, ...validateProfile(JSON.parse(init.body)), updated_at: "2026-09-06T00:00:01Z" } }); };
    await render(ProfileEditor, { initialProfile: baseProfile }); await edit("Major", "Biology"); await click("Save changes");
    assert.equal(field("Major").value, "Biology"); assert.equal(unloadBlocked(), true);
    const signout = document.createElement("form"); signout.action = "/auth/signout"; document.body.append(signout);
    const event = new window.Event("submit", { bubbles: true, cancelable: true }); signout.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true); assert.equal(alerts.length, 1); signout.remove();
    await click("Download settings draft"); assert.equal(JSON.parse(await downloads[0].text()).settings.major, "Biology");
    fail = false; await click("Retry settings save"); assert.equal(unloadBlocked(), false); await unmount();
  });

  await t.test("conflicts preserve draft fields and require an explicit reload decision", async () => {
    reset(); let puts = 0;
    fetcher = async (_url, init) => {
      if (init?.method === "PUT") { puts++; return Response.json({ error: "conflict" }, { status: 409 }); }
      return Response.json({ profile: { ...baseProfile, major: "Latest saved major", updated_at: "2026-09-06T00:00:02Z" } });
    };
    await render(ProfileEditor, { initialProfile: baseProfile }); await edit("Major", "My draft"); await click("Save changes");
    assert.equal(field("Major").value, "My draft"); await click("Save changes"); assert.equal(puts, 1);
    window.confirm = () => false; await click("Load latest saved settings"); assert.equal(field("Major").value, "My draft");
    window.confirm = () => true; await click("Load latest saved settings"); assert.equal(field("Major").value, "Latest saved major");
    assert.equal(unloadBlocked(), false); await unmount();
  });

  await t.test("session expiry keeps settings visible and can retry after sign-in", async () => {
    reset(); let expired = true;
    fetcher = async (_url, init) => expired ? Response.json({}, { status: 401 }) : Response.json({ profile: { ...baseProfile, ...validateProfile(JSON.parse(init.body)), updated_at: "2026-09-06T00:00:03Z" } });
    await render(ProfileEditor, { initialProfile: baseProfile }); await edit("Last name", "Retained"); await click("Save changes");
    assert.equal(field("Last name").value, "Retained"); assert.equal(window.location.pathname, "/home");
    assert.ok(rootNode.querySelector('a[target="_blank"]')); expired = false;
    await click("Retry settings save"); assert.equal(unloadBlocked(), false); await unmount();
  });

  await t.test("invalid settings keep the draft and do not send a write", async () => {
    reset(); let writes = 0; fetcher = async () => { writes++; throw new Error("unexpected"); };
    await render(ProfileEditor, { initialProfile: baseProfile }); await edit("Time zone", "Not/A_Zone"); await click("Save changes");
    assert.equal(writes, 0); assert.equal(field("Time zone").value, "Not/A_Zone"); assert.match(rootNode.textContent, /valid time zone/);
    await unmount();
  });

  await t.test("onboarding skip retries preserve existing optional details and keep failed drafts", async () => {
    reset(); const payloads = [];
    fetcher = async (_url, init) => { payloads.push(JSON.parse(init.body)); throw new Error("Offline"); };
    await render(ProfileEditor, { initialProfile: { ...baseProfile, major: "Existing major", onboarding_completed_at: null }, onboarding: true });
    await edit("Display name", "New name"); await click("Continue"); await edit("Major", "Optional draft");
    await click("Skip optional details"); await click("Retry settings save");
    assert.equal(payloads.length, 2); assert.deepEqual(payloads[1], payloads[0]);
    assert.equal(payloads[0].major, "Existing major"); assert.equal(payloads[0].display_name, "New name");
    assert.equal(field("Major").value, "Optional draft"); assert.equal(unloadBlocked(), true);
    await unmount();
  });

  await t.test("onboarding saves custom choices and opens the workspace", async () => {
    reset(); window.history.replaceState({}, "", "/onboarding"); let payload;
    const onboardingProfile = { ...baseProfile, onboarding_completed_at: null };
    fetcher = async (_url, init) => {
      payload = JSON.parse(init.body);
      return Response.json({ profile: { ...onboardingProfile, ...validateProfile(payload), onboarding_completed_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" } });
    };
    await render(ProfileEditor, { initialProfile: onboardingProfile, onboarding: true });
    await edit("Display name", "Jordan"); await click("Continue");
    assert.equal(field("College or university").getAttribute("list"), "profile-university-options");
    assert.equal(field("Time zone").getAttribute("list"), "profile-timezone-options");
    await edit("Academic year", "__custom__"); await edit("Your academic year", "Fifth year");
    await edit("Time zone", "America/Los_Angeles"); await click("Use automatic"); assert.equal(field("Time zone").value, "");
    await edit("Time zone", "America/Los_Angeles"); await click("Save and open workspace");
    assert.equal(payload.academic_year, "Other: Fifth year"); assert.equal(payload.timezone, "America/Los_Angeles");
    assert.equal(window.location.pathname, "/home"); assert.equal(unloadBlocked(), false);
    await unmount();
  });

  await t.test("workspace acknowledges a lost save response by readback and preserves true conflicts", async () => {
    reset(); let dashboard = savedDashboard, revision = baseProfile.updated_at, puts = 0;
    fetcher = async (_url, init) => {
      assert.equal(new Headers(init.headers).get("x-profile-id"), baseProfile.id);
      if (init.method === "PUT") {
        puts++; const body = JSON.parse(init.body);
        if (body.baseRevision !== revision) return Response.json({}, { status: 409 });
        dashboard = body.dashboard; revision = "2026-09-06T00:00:02Z";
        throw new Error("Response lost after commit");
      }
      return Response.json({ initialized: true, courses: [], dashboard, revision, profile: baseProfile });
    };
    await render(Workspace, { initialProfile: baseProfile }); await editNotes("First saved edit");
    assert.equal(unloadBlocked(), true); assert.match(rootNode.textContent, /Unsaved workspace changes/);
    await click("Save now"); assert.match(rootNode.textContent, /Response lost/);
    assert.equal(rootNode.querySelector("textarea").value, "First saved edit");
    await click("Retry save"); assert.equal(puts, 2); assert.equal(unloadBlocked(), false);
    assert.match(rootNode.textContent, /Workspace saved/);
    // A second session now changes the server before this tab's next save.
    dashboard = { ...dashboard, t: ["Other tab"] }; revision = "2026-09-06T00:00:03Z";
    await editNotes("Keep this draft"); await click("Save now");
    assert.match(rootNode.textContent, /Another session saved different changes/);
    assert.equal(rootNode.querySelector("textarea").value, "Keep this draft"); assert.equal(unloadBlocked(), true);
    assert.equal([...rootNode.querySelectorAll("button")].some((b) => b.textContent === "Retry save"), false);
    await click("Download unsaved work"); assert.equal(JSON.parse(await downloads[0].text()).workspaces[0].widgets[0].note, "Keep this draft");
    window.confirm = () => false; await click("Reload saved workspace"); assert.equal(rootNode.querySelector("textarea").value, "Keep this draft");
    window.confirm = () => true; await click("Reload saved workspace"); assert.equal(rootNode.querySelector("textarea").value, "Other tab");
    assert.equal(unloadBlocked(), false); await unmount();
  });

  await t.test("workspace load retry gates editing and preserves settings across navigation", async () => {
    reset(); let fail = true, writes = 0;
    const dashboard = savedDashboard;
    fetcher = async (_url, init) => {
      if (init?.method) { writes++; throw new Error("No save expected"); }
      if (fail) throw new Error("Offline");
      return Response.json({ initialized: true, courses: [], dashboard, revision: baseProfile.updated_at, profile: baseProfile });
    };
    await render(Workspace, { initialProfile: baseProfile });
    assert.equal(rootNode.querySelector('textarea[aria-label="Quick notes"]'), null);
    assert.match(rootNode.textContent, /could not be loaded/); fail = false; await click("Retry loading");
    assert.equal(rootNode.querySelector('textarea[aria-label="Quick notes"]').value, "Saved notes");
    assert.equal(writes, 0); assert.equal(unloadBlocked(), false);
    await click("Settings"); assert.equal(window.location.pathname, "/settings"); await edit("Major", "Kept while navigating");
    await click("Home"); assert.equal(window.location.pathname, "/home"); await click("Settings"); assert.equal(window.location.pathname, "/settings");
    assert.equal(field("Major").value, "Kept while navigating"); assert.equal(unloadBlocked(), true);
    assert.equal([...rootNode.querySelectorAll("button")].find((b) => b.textContent === "Sign out").disabled, true);
    await unmount();
  });
});

async function clickAria(label, container = rootNode) {
  const button = [...container.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label);
  assert.ok(button, `Missing button ${label}`); await act(async () => button.click());
}
async function clickIn(container, text) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent.trim() === text);
  assert.ok(button, `Missing button ${text}`); await act(async () => button.click());
}
function installWorkspaceServer(initial = savedDashboard, courses = [], profile = baseProfile) {
  const server = { dashboard: structuredClone(initial), courses, profile, revision: baseProfile.updated_at, writes: 0, offline: false, loseResponse: false };
  fetcher = async (_url, init) => {
    if (init.method === "PUT") {
      if (server.offline) throw new Error("Offline");
      const body = JSON.parse(init.body);
      if (body.baseRevision !== server.revision) return Response.json({}, { status: 409 });
      const state = academicSnapshot(body.courses, body.dashboard);
      server.dashboard = state.dashboard; server.courses = state.courses;
      server.writes++; server.revision = new Date(Date.parse(server.revision) + 1000).toISOString();
      if (server.loseResponse) { server.loseResponse = false; throw new Error("Response lost"); }
      return Response.json({ ok: true, revision: server.revision });
    }
    return Response.json({ initialized: true, courses: server.courses, dashboard: server.dashboard, revision: server.revision, profile: server.profile });
  };
  return server;
}
async function saveAndReload() {
  if ([...rootNode.querySelectorAll("button")].some((button) => button.textContent === "Save now")) await click("Save now");
  assert.equal(unloadBlocked(), false); await unmount(); reset(); await render(Workspace, { initialProfile: baseProfile });
}
const cards = () => [...rootNode.querySelectorAll(".widget-card")];

const sampleCourse = { id: "history", code: "HIST 205", name: "History", credits: 3, instructor: "Teacher", room: "Hall", color: "#112233", soft: "#11223318", initials: "HI" };
test("experimental mode previews each schedule without saving and restores the real workspace", async () => {
  reset(); const server = installWorkspaceServer(savedDashboard, []);
  try {
    await render(Workspace, { initialProfile: baseProfile });
    await clickAria("Experimental mode"); await clickAria("Load Clear experimental data");
    assert.match(rootNode.textContent, /Clear experimental mode/);
    assert.equal(rootNode.querySelector(".nav-count").textContent, "0");
    assert.match(rootNode.textContent, /No overdue or due-today tasks/);
    assert.match(rootNode.textContent, /No events yet/);
    assert.equal(server.writes, 0); assert.equal(unloadBlocked(), false);

    await clickAria("Experimental mode"); await clickAria("Load Light experimental data");
    assert.match(rootNode.textContent, /Light experimental mode/);
    assert.equal(rootNode.querySelector(".nav-count").textContent, "2");
    assert.equal(server.writes, 0); assert.equal(unloadBlocked(), false);

    await clickAria("Experimental mode"); await clickAria("Load Medium experimental data");
    assert.match(rootNode.textContent, /Medium experimental mode/);
    assert.equal(rootNode.querySelector(".nav-count").textContent, "4");

    await clickAria("Experimental mode"); await clickAria("Load Packed experimental data");
    assert.match(rootNode.textContent, /Packed experimental mode/);
    assert.equal(rootNode.querySelector(".nav-count").textContent, "6");
    assert.equal(server.writes, 0); assert.equal(unloadBlocked(), false);

    await clickAria("Experimental mode"); await click("Exit experimental mode");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.doesNotMatch(rootNode.textContent, /Packed experimental mode/);
    assert.equal(rootNode.querySelector(".nav-count").textContent, "0");
    assert.equal(rootNode.querySelector('textarea[aria-label="Quick notes"]').value, "Saved notes");
    assert.equal(server.writes, 0); assert.equal(unloadBlocked(), false);
  } finally { if (root) await unmount(); }
});

test("study controls persist targets, timers, history and grades", async (t) => {
  t.afterEach(async () => { if (root) await unmount(); });
  await t.test("goals and timer settings retain offline edits and form drafts, then reload", async () => {
    reset(); const server = installWorkspaceServer(savedDashboard, [sampleCourse]); await render(Workspace, { initialProfile: baseProfile });
    assert.equal(server.writes, 0); await click("Study & grades");
    await edit("Daily target", "90"); await edit("Weekly target", "420"); await edit("pomodoro duration", "30"); await edit("focus duration", "50"); await edit("focus class", "history");
    window.confirm = () => false; await click("Close study panel"); assert.ok(rootNode.querySelector('[aria-label="Study and grades"]')); assert.equal(unloadBlocked(), true);
    await click("Save goals and timer settings"); server.offline = true; await click("Save now"); assert.match(rootNode.textContent, /Offline/);
    assert.equal(field("Daily target").value, "90"); server.offline = false; await click("Retry save"); await click("Close study panel"); await saveAndReload();
    assert.equal(server.dashboard.d.study.dailyMinutes, 90); assert.equal(server.dashboard.d.study.weeklyMinutes, 420); assert.deepEqual(server.dashboard.d.study.timers.focus, { minutes: 50, courseId: "history" });
    await click("Study & grades"); assert.equal(field("pomodoro duration").value, "30");
  });
  await t.test("timer pause and resume survive reload and reset requires confirmation", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-07T12:00:00.000Z") });
    reset(); const server = installWorkspaceServer(); await render(Workspace, { initialProfile: baseProfile }); await click("Study & grades"); await click("Start Focus");
    assert.equal([...rootNode.querySelectorAll("button")].find((b) => b.textContent === "Start Pomodoro").disabled, true);
    await click("Close study panel"); await saveAndReload(); const id = server.dashboard.d.study.active.id;
    const writes = server.writes; t.mock.timers.tick(5 * 60000);
    await act(async () => window.dispatchEvent(new window.Event("focus")));
    assert.equal(server.writes, writes); assert.equal(unloadBlocked(), false);
    await click("Study & grades"); await click("Pause Focus"); await click("Close study panel"); await saveAndReload();
    assert.equal(server.dashboard.d.study.active.id, id); assert.equal(server.dashboard.d.study.active.runningSince, null);
    t.mock.timers.tick(60 * 60000); await click("Study & grades"); assert.match(rootNode.querySelector('[aria-label="Focus timer"]').textContent, /40:00/);
    await click("Resume Focus"); t.mock.timers.tick(2 * 60000); await click("Finish Focus"); await click("Close study panel"); await saveAndReload();
    assert.equal(server.dashboard.d.study.active, null); assert.equal(server.dashboard.d.study.sessions.length, 1); assert.equal(server.dashboard.d.study.sessions[0].segments.length, 2);
    await click("Study & grades"); await click("Start Pomodoro"); window.confirm = () => false; await click("Reset Pomodoro"); assert.ok(rootNode.textContent.includes("Pause Pomodoro"));
    window.confirm = () => true; await click("Reset Pomodoro"); await click("Close study panel"); await saveAndReload(); assert.equal(server.dashboard.d.study.active, null); assert.equal(server.dashboard.d.study.sessions.length, 1);
  });
  await t.test("an expired timer completes on load and lost-response retry records it exactly once", async () => {
    reset(); const started = timerAction(emptyStudy(), "start", "pomodoro", Date.now() - 3600000, "closed-page-session");
    const server = installWorkspaceServer({ ...savedDashboard, d: { ...savedDashboard.d, study: started } }); await render(Workspace, { initialProfile: baseProfile });
    server.loseResponse = true; await click("Save now"); assert.match(rootNode.textContent, /Response lost/); await click("Retry save"); await saveAndReload();
    assert.equal(server.dashboard.d.study.active, null); assert.equal(server.dashboard.d.study.sessions.length, 1); assert.equal(server.dashboard.d.study.sessions[0].id, "closed-page-session");
    await click("Study & grades"); assert.match(rootNode.textContent, /0h 25m/); await click("Delete session"); await click("Close study panel"); await saveAndReload(); assert.equal(server.dashboard.d.study.sessions.length, 0);
  });
  await t.test("widgets, sidebar, class details and dashboard calculate from the same saved records", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-07T12:00:00.000Z") });
    reset(); const profile = { ...baseProfile, gpa_system: "4.0 scale", current_term: "Fall", timezone: "UTC", week_starts_on: "Monday" };
    const study = { ...emptyStudy(), dailyMinutes: 120, weeklyMinutes: 240, sessions: [6, 7].map((day) => ({ id: String(day), kind: "focus", courseId: "history", segments: [{ start: `2026-09-0${day}T09:00:00.000Z`, end: `2026-09-0${day}T10:00:00.000Z` }] })), grades: [{ id: "g", courseId: "history", term: "Fall", system: "4.0 scale", max: 4, value: 3.5 }] };
    const a = { id: "done", title: "Finished essay", courseId: "history", due: "", dateKey: "2026-09-07", status: "done", progress: 100, completedAt: "2026-09-07T11:00:00.000Z", description: "", weight: "" };
    installWorkspaceServer({ ...savedDashboard, w: [["day", "Day", [0, 1, 8, 9, 10, 13, 14, 15].map((type) => [type, 1])]], d: { ...savedDashboard.d, study, assignments: [a, { ...a, id: "essay", title: "Actual essay", status: "later", progress: 30, completedAt: null }, { ...a, id: "exam", title: "Actual exam", courseId: "", type: "Exam", dateKey: "2026-09-08", status: "later", progress: 0, completedAt: null }], manualEvents: [{ id: "event-exam", title: "Calendar exam", courseId: "history", dateKey: "2026-09-09", time: "10:00", type: "Exam" }] } }, [sampleCourse], profile);
    await render(Workspace, { initialProfile: profile });
    assert.match(rootNode.querySelector(".widget-daily-goal").textContent, /1h 00m.*2h 00m.*50%/);
    assert.match(rootNode.querySelector(".widget-weekly-goal").textContent, /1h 00m.*4h 00m.*25%/);
    assert.match(rootNode.querySelector(".widget-task-completion").textContent, /1of 3 tasks/);
    assert.match(rootNode.querySelector(".widget-assignment-pie").textContent, /2open.*HIST 205.*1.*Personal.*1/);
    assert.match(rootNode.querySelector(".widget-gpa").textContent, /3.50/); assert.match(rootNode.querySelector(".widget-streak").textContent, /2 days.*Longest: 2/);
    assert.match(rootNode.querySelector(".widget-exams").textContent, /Actual exam.*1 days.*Calendar exam.*2 days/);
    assert.match(rootNode.querySelector(".widget-today").textContent, /Actual essay/); assert.equal(rootNode.querySelector(".nav-count").textContent, "1");
    await click("Dashboard"); assert.match(rootNode.querySelector(".summary-strip").textContent, /1Completed this week.*25%/);
    await act(async () => rootNode.querySelector(".class-card").click()); assert.match(rootNode.querySelector('[aria-label="Class details"]').textContent, /2h 00m recorded study · 1 \/ 2 assignments complete.*Grade: 3.50 \/ 4/);
  });
  await t.test("grades create, edit, change scale and delete with account reloads", async () => {
    reset(); const profile = { ...baseProfile, gpa_system: "4.0 scale", current_term: "Fall" };
    const initial = { ...savedDashboard, w: [["day", "Day", [[10, 1]]]] };
    const server = installWorkspaceServer(initial, [sampleCourse], profile); await render(Workspace, { initialProfile: profile });
    assert.match(rootNode.querySelector(".gpa-widget").textContent, /Enter grades/); await click("Edit grades");
    await edit("Grade class", "history"); await edit("Grade value", "3.5"); await click("Save grade"); await click("Close study panel"); await saveAndReload();
    assert.match(rootNode.querySelector(".gpa-widget").textContent, /3.50/); assert.equal(server.dashboard.d.study.grades[0].term, "Fall");
    await click("Edit grades"); await click("Edit grade"); await edit("Grade value", "0"); await click("Save grade"); await click("Close study panel"); await saveAndReload(); assert.match(rootNode.querySelector(".gpa-widget").textContent, /0.00/);
    await click("Edit grades"); await edit("Grade class", "history"); await edit("Grade scale", "Custom"); await edit("Custom scale maximum", "10"); await edit("Grade value", "8"); await click("Save grade"); await click("Close study panel"); await saveAndReload(); assert.equal(server.dashboard.d.study.grades.length, 2); assert.equal(server.dashboard.d.study.grades[1].max, 10);
    await click("Edit grades"); await click("Delete grade"); await click("Close study panel"); await saveAndReload(); assert.equal(server.dashboard.d.study.grades.length, 1); assert.match(rootNode.querySelector(".gpa-widget").textContent, /Enter grades/);
  });
});

test("academic forms, syllabus review and calendar save complete account snapshots", async (t) => {
  t.afterEach(async () => { if (root) await unmount(); });
  await t.test("legacy noon events remain saveable and multiple undated assignments can be repaired individually", async () => {
    reset();
    const initial = { ...savedDashboard, d: { ...savedDashboard.d, assignments: ["First", "Second"].map((title) => ({ id: title, title, courseId: "", dateKey: "", due: "Invalid Date", status: "later", progress: 0, description: "Keep this description", weight: "" })), manualEvents: [{ id: "legacy", title: "Old noon event", courseId: "math", dateKey: "2026-10-15", time: "12:00 PM", type: "Study block" }] } };
    const server = installWorkspaceServer(initial); await render(Workspace, { initialProfile: baseProfile });
    assert.equal(server.writes, 0); assert.equal(unloadBlocked(), true);
    await click("Dashboard");
    for (const title of ["First", "Second"]) {
      const row = [...rootNode.querySelectorAll(".assignment-row")].find((node) => node.textContent.includes(title));
      await act(async () => row.click()); await click("Edit assignment"); await edit("Due date", "2026-10-15"); await click("Save assignment");
      assert.equal(rootNode.querySelector('[aria-label="Edit assignment"]'), null);
    }
    await saveAndReload();
    assert.ok(server.dashboard.d.assignments.every((a) => a.dateKey === "2026-10-15" && a.description === "Keep this description"));
    assert.equal(server.dashboard.d.manualEvents[0].time, "12:00"); assert.equal(server.dashboard.d.manualEvents[0].courseId, "");
  });

  await t.test("recurring meetings use saved weekdays and date ranges in every calendar view", async () => {
    reset();
    const initial = { ...savedDashboard, d: { ...savedDashboard.d, courseDetails: { history: { officeHours: "", meetings: [{ id: "m", days: [1, 3], start: "09:30", end: "11:00", from: "2026-10-01", until: "2026-10-31", location: "Hall 2" }] } } } };
    installWorkspaceServer(initial, [sampleCourse]); await render(Workspace, { initialProfile: baseProfile }); await click("Calendar");
    await edit("Go to date", "2026-10-05");
    assert.match(rootNode.querySelector('[aria-label="2026-10-05"]').textContent, /09:30.*HIST 205 class.*Hall 2/);
    assert.ok(!rootNode.querySelector('[aria-label="2026-10-06"]').textContent.includes("HIST 205 class"));
    await click("Week"); assert.equal(rootNode.querySelectorAll(".calendar-chip").length, 2);
    await click("Day"); assert.equal(rootNode.querySelectorAll(".calendar-chip").length, 1);
    await act(async () => rootNode.querySelector(".calendar-chip").click()); assert.match(rootNode.querySelector('[aria-label="Class details"]').textContent, /Hall 2/);
    await click("Close class"); await edit("Go to date", "2026-11-02"); assert.equal(rootNode.querySelectorAll(".calendar-chip").length, 0);
  });

  await t.test("class fields and schedule survive a failed save, retry, edit, and reload", async () => {
    reset(); const server = installWorkspaceServer(); await render(Workspace, { initialProfile: baseProfile }); await click("Dashboard"); await click("Add class"); await click("Manual entry");
    for (const [key, value] of Object.entries({ "Course code": "BIO 42", "Class name": "Field Biology", "Credits": "4", "Instructor": "Dr. Rivers", "Location / meeting notes": "Lab 4", "Office hours": "Friday by appointment" })) await edit(key, value);
    await click("Add meeting"); await edit("First date", "2026-09-01"); await edit("Last date", "2027-05-31"); await edit("Start time", "10:00"); await edit("End time", "11:30"); await edit("Meeting location", "Garden");
    assert.equal(unloadBlocked(), true); await click("Save class");
    server.offline = true; await click("Save now"); assert.match(rootNode.textContent, /Offline/); assert.equal(server.courses.length, 0);
    server.offline = false; await click("Retry save"); await saveAndReload(); await click("Dashboard");
    assert.equal(server.courses.length, 1); const course = server.courses[0]; assert.equal(course.credits, 4); assert.equal(course.room, "Lab 4");
    assert.equal(server.dashboard.d.courseDetails[course.id].meetings[0].location, "Garden");
    await act(async () => rootNode.querySelector(".class-card").click()); await click("Edit class");
    assert.equal(field("Office hours").value, "Friday by appointment"); await edit("Instructor", "Dr. Lake"); await click("Save class"); await saveAndReload();
    assert.equal(server.courses[0].instructor, "Dr. Lake"); assert.equal(server.courses[0].id, course.id);
  });

  await t.test("assignment fields, checklist, completion/reopening and deletion persist", async () => {
    reset(); const server = installWorkspaceServer(savedDashboard, [sampleCourse]); await render(Workspace, { initialProfile: baseProfile }); await click("Dashboard"); await click("Add assignment");
    await edit("Assignment title", "Archival essay"); await edit("Class", "history"); await edit("Due date", "2026-10-15"); await edit("Due time", "17:00"); await edit("Type", "Project"); await edit("Description", "Use primary sources"); await edit("Weight", "25%"); await edit("Assignment notes", "Outline ready"); await edit("Progress", "37"); await edit("Review instructions", true); await click("Save assignment");
    await saveAndReload(); let a = server.dashboard.d.assignments[0]; assert.equal(a.type, "Project"); assert.equal(a.dueTime, "17:00"); assert.equal(a.notes, "Outline ready"); assert.deepEqual(a.checklist, [true, false, false]);
    await click("Dashboard"); await act(async () => rootNode.querySelector(".assignment-row").click()); await click("Mark complete"); await click("Close assignment"); await saveAndReload();
    a = server.dashboard.d.assignments[0]; assert.equal(a.progress, 100); assert.ok(a.completedAt); assert.equal(a.progressBeforeCompletion, 37);
    await click("Dashboard"); await click("View every assignment"); await act(async () => rootNode.querySelector(".assignment-row").click()); await click("Mark incomplete"); await click("Close assignment"); await saveAndReload();
    assert.equal(server.dashboard.d.assignments[0].progress, 37); assert.equal(server.dashboard.d.assignments[0].completedAt, null);
    await click("Dashboard"); await act(async () => rootNode.querySelector(".assignment-row").click()); await click("Delete assignment"); await saveAndReload(); assert.equal(server.dashboard.d.assignments.length, 0);
  });

  await t.test("calendar event CRUD, all views, week start and filters share saved data", async () => {
    reset(); const profile = { ...baseProfile, week_starts_on: "Monday", timezone: "America/Los_Angeles" };
    const server = installWorkspaceServer(savedDashboard, [sampleCourse], profile); await render(Workspace, { initialProfile: profile }); await click("Calendar"); await click("Add event");
    await edit("Event name", "Personal appointment"); await edit("Event date", "2026-10-15"); await edit("Time", "15:45"); await edit("Description", "Bring notes"); await click("Save event"); await saveAndReload(); await click("Calendar");
    assert.equal(server.dashboard.d.manualEvents[0].courseId, "");
    await edit("Go to date", "2026-10-15"); assert.equal(rootNode.querySelector(".calendar-weekdays span").textContent, "Mon");
    assert.match(rootNode.querySelector(".academic-calendar").textContent, /Personal appointment/);
    await click("Week"); assert.equal(rootNode.querySelectorAll(".academic-day").length, 7); assert.match(rootNode.querySelector(".academic-calendar").textContent, /Personal appointment/);
    await click("Day"); assert.equal(rootNode.querySelectorAll(".academic-day").length, 1);
    await act(async () => rootNode.querySelector(".academic-calendar .calendar-chip").click());
    assert.equal(field("Description").value, "Bring notes"); await edit("Event name", "Revised appointment"); await click("Save event");
    await edit("Class filter", "history"); assert.ok(!rootNode.querySelector(".academic-calendar").textContent.includes("Revised appointment"));
    await edit("Class filter", "personal"); await saveAndReload(); await click("Calendar");
    assert.equal(field("Class filter").value, "personal"); assert.equal(rootNode.querySelectorAll(".academic-day").length, 1);
    await edit("Go to date", "2026-10-15"); await act(async () => rootNode.querySelector(".calendar-chip").click()); await click("Delete event"); await saveAndReload(); assert.equal(server.dashboard.d.manualEvents.length, 0);
  });

  await t.test("syllabus source and edited review resume, then approve exactly once after a lost response", async () => {
    reset(); const server = installWorkspaceServer(); await render(Workspace, { initialProfile: baseProfile }); await click("Dashboard"); await click("Import syllabus");
    await edit("Syllabus text", "HIST 222\nEssay - 2026-10-15\nMidterm exam - 2026-11-03\nRead chapter 1 in September."); await edit("Course code", "HIST 222"); await edit("Class name", "Local history"); await click("Suggest dated items");
    assert.equal(rootNode.querySelectorAll(".meeting-editor").length, 2); await edit("Item title", "Reviewed essay"); await edit("Item weight", "20%");
    await click("Close review"); await saveAndReload(); assert.equal(server.courses.length, 0); assert.equal(server.dashboard.d.assignments.length, 0);
    await click("Dashboard"); await click("Resume HIST 222"); assert.equal(field("Item title").value, "Reviewed essay"); assert.match(field("Syllabus text").value, /Read chapter/);
    await click("Approve class and items"); server.loseResponse = true; await click("Save now"); assert.match(rootNode.textContent, /Response lost/);
    await click("Retry save"); await saveAndReload(); assert.equal(server.courses.length, 1); assert.equal(server.dashboard.d.assignments.length, 2); assert.equal(server.dashboard.d.syllabusDrafts.length, 0);
    assert.equal(server.dashboard.d.assignments[1].type, "Exam"); assert.equal(server.dashboard.d.assignments[0].weight, "20%"); assert.match(Object.values(server.dashboard.d.courseDetails)[0].syllabusText, /Read chapter/);
  });

  await t.test("removing a class clears its assignments and schedule but retains personal events", async () => {
    reset(); const initial = { ...savedDashboard, d: { ...savedDashboard.d, calendarFilter: "history", assignments: [{ id: "a", courseId: "history", title: "Essay", dateKey: "2026-10-15", due: "", status: "later", progress: 0, description: "", weight: "" }], manualEvents: [{ id: "e", courseId: "history", title: "Keep event", dateKey: "2026-10-15", time: "", type: "Personal" }], courseDetails: { history: { officeHours: "Mondays", meetings: [] } } } };
    const server = installWorkspaceServer(initial, [sampleCourse]); await render(Workspace, { initialProfile: baseProfile }); await click("Dashboard"); await act(async () => rootNode.querySelector(".class-card").click()); await click("Remove class"); await saveAndReload();
    assert.equal(server.courses.length, 0); assert.equal(server.dashboard.d.assignments.length, 0); assert.deepEqual(server.dashboard.d.courseDetails, {});
    assert.equal(server.dashboard.d.manualEvents[0].courseId, ""); assert.equal(server.dashboard.d.calendarFilter, "all");
  });
});

test("workspace controls persist configurations and independent notes", async (t) => {
  t.afterEach(async () => { if (root) await unmount(); });
  await t.test("workspace creation, rename, ordering, duplication and confirmed deletion survive reloads", async () => {
    reset(); const server = installWorkspaceServer(); await render(Workspace, { initialProfile: baseProfile });
    await clickAria("Workspace options");
    assert.equal([...rootNode.querySelectorAll(".workspace-menu button")].find((button) => button.textContent.trim() === "Delete").disabled, true);
    await clickAria("Workspace options");
    await clickAria("Add workspace"); await edit("Workspace name", "Research"); await click("Create workspace");
    await clickAria("Workspace options"); await clickIn(rootNode.querySelector(".workspace-menu"), "Rename");
    await edit("Workspace name", "Study"); await click("Save name");
    await clickAria("Workspace options"); await click("Move left");
    assert.deepEqual([...rootNode.querySelectorAll('[role="tab"]')].map((node) => node.textContent), ["Study", "Day"]);
    await clickAria("Workspace options"); await click("Move right");
    await click("Day"); await clickAria("Workspace options"); await clickIn(rootNode.querySelector(".workspace-menu"), "Duplicate");
    await editNotes("Copy only"); await saveAndReload();
    assert.equal(rootNode.querySelector('[role="tab"][aria-selected="true"]').textContent, "Day copy");
    assert.equal(rootNode.querySelector("textarea").value, "Copy only");
    await click("Day"); assert.equal(rootNode.querySelector("textarea").value, "Saved notes");
    await click("Day copy"); await clickAria("Workspace options"); window.confirm = () => false; await click("Delete");
    assert.equal(rootNode.querySelectorAll('[role="tab"]').length, 3);
    window.confirm = () => true; await click("Delete"); await saveAndReload();
    assert.deepEqual(decodeWorkspaceState(server.dashboard).workspaces.map((w) => w.name), ["Day", "Study"]);
    assert.equal(rootNode.querySelector("textarea").value, "Saved notes");
  });

  await t.test("duplicating an 80-character workspace name produces a valid saved name", async () => {
    reset(); const server = installWorkspaceServer({ ...savedDashboard, w: [["day", "x".repeat(80), [[12, 1]]]] });
    await render(Workspace, { initialProfile: baseProfile });
    await clickAria("Workspace options"); await clickIn(rootNode.querySelector(".workspace-menu"), "Duplicate");
    await saveAndReload();
    const copied = decodeWorkspaceState(server.dashboard).workspaces[1];
    assert.equal(copied.name.length, 80); assert.ok(copied.name.endsWith(" copy"));
    assert.equal(copied.widgets[0].note, "Saved notes");
  });

  await t.test("all 18 widget types add and persist; size, move and drag keep stable identities", async () => {
    reset(); const server = installWorkspaceServer({ ...savedDashboard, w: [["day", "Day", []]], n: "" });
    await render(Workspace, { initialProfile: baseProfile }); await click("Browse widgets");
    const pickerButtons = [...rootNode.querySelectorAll(".widget-picker-grid button")]; assert.equal(pickerButtons.length, 18);
    for (const button of pickerButtons) await act(async () => button.click());
    await click("Done"); assert.equal(cards().length, 18);
    const ids = cards().map((card) => card.dataset.widgetId);
    await clickAria("Quick notes options"); await clickAria("large widget");
    await clickAria("Quick notes options"); await click("Move earlier");
    await click("Move later"); await clickAria("Quick notes options");
    const source = cards()[0], destination = cards()[17];
    await act(async () => source.querySelector(".drag-handle").dispatchEvent(new window.Event("dragstart", { bubbles: true })));
    await act(async () => destination.dispatchEvent(new window.Event("drop", { bubbles: true, cancelable: true })));
    await saveAndReload();
    assert.deepEqual(cards().map((card) => card.dataset.widgetId), [...ids.slice(1), ids[0]]);
    assert.equal(rootNode.querySelector(".widget-notes").dataset.size, "large");
    assert.equal(decodeWorkspaceState(server.dashboard).workspaces[0].widgets.length, 18);
  });

  await t.test("note copies edit, clear and delete independently; search opens the exact note", async () => {
    reset(); const server = installWorkspaceServer(); await render(Workspace, { initialProfile: baseProfile });
    const originalId = cards()[0].dataset.widgetId;
    await clickAria("Quick notes options"); await clickIn(rootNode.querySelector(".widget-menu"), "Duplicate");
    const duplicateId = cards()[1].dataset.widgetId; assert.notEqual(duplicateId, originalId);
    await editNotes("Unique searchable original"); assert.equal(cards()[1].querySelector("textarea").value, "Saved notes");
    await clickAria("Clear notes", cards()[1]); assert.equal(cards()[1].querySelector("textarea").value, "");
    await saveAndReload(); assert.equal(cards()[0].querySelector("textarea").value, "Unique searchable original");
    assert.equal(cards()[1].querySelector("textarea").value, "");
    await click("Search");
    const search = rootNode.querySelector('[aria-label="Search everything"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "Unique searchable original"); search.dispatchEvent(new window.Event("input", { bubbles: true })); });
    const result = rootNode.querySelector(".search-results button"); assert.ok(result); await act(async () => result.click());
    assert.equal(document.activeElement.id, `note-${originalId}`);
    await clickAria("Quick notes options", cards()[0]); window.confirm = () => false; await click("Remove"); assert.equal(cards().length, 2);
    window.confirm = () => true; await click("Remove"); await saveAndReload();
    assert.equal(cards().length, 1); assert.equal(cards()[0].dataset.widgetId, duplicateId);
    assert.ok(!JSON.stringify(server.dashboard).includes("Unique searchable original"));
  });

  await t.test("legacy note recovery and failed saves preserve content until retry", async () => {
    reset(); const server = installWorkspaceServer({ ...savedDashboard, w: [["day", "Day", []]] });
    await render(Workspace, { initialProfile: baseProfile }); assert.match(rootNode.textContent, /earlier shared note/);
    await click("Add saved note here"); assert.equal(rootNode.querySelector("textarea").value, "Saved notes");
    server.offline = true; await click("Save now"); assert.equal(unloadBlocked(), true);
    await editNotes("Recovered and edited"); server.offline = false; await click("Retry save"); await saveAndReload();
    assert.equal(rootNode.querySelector("textarea").value, "Recovered and edited"); assert.equal(server.dashboard.n, undefined);
  });

  await t.test("workspace and widget limits prevent unsavable operations", async () => {
    reset(); installWorkspaceServer({ ...savedDashboard, w: Array.from({ length: 20 }, (_, i) => [`w${i}`, i === 0 ? "x".repeat(80) : `Space ${i}`, Array.from({ length: 100 }, () => [17, 0])]), a: "w0", n: "" });
    await render(Workspace, { initialProfile: baseProfile });
    assert.equal(rootNode.querySelector('[aria-label="Add workspace"]').disabled, true);
    await clickAria("Workspace options"); assert.equal([...rootNode.querySelectorAll(".workspace-menu button")].find((b) => b.textContent.trim() === "Duplicate").disabled, true);
    await clickAria("Workspace options"); await clickAria("Empty spacer options", cards()[0]);
    assert.equal([...rootNode.querySelectorAll(".widget-menu button")].find((b) => b.textContent.trim() === "Duplicate").disabled, true);
    await clickAria("Empty spacer options", cards()[0]); await clickIn(rootNode.querySelector(".workspace-actions"), "Add widget");
    assert.ok([...rootNode.querySelectorAll(".widget-picker-grid button")].every((b) => b.disabled));
    await click("Done"); assert.equal(unloadBlocked(), false);
  });
});

test("private files UI retains upload retries, restores file preferences, searches real metadata and downloads originals", async () => {
  reset(); const server = installWorkspaceServer(); let stored = [], fail = true; const ids = [];
  filesFetcher = async (url, init) => {
    assert.equal(new Headers(init.headers).get('x-profile-id'), baseProfile.id);
    if (init.method === 'POST') {
      const id = new URL(url, 'https://edu.example').searchParams.get('id'); ids.push(id);
      if (fail) return Response.json({ error: 'Storage offline' }, { status: 503 });
      const metadata = JSON.parse(decodeURIComponent(new Headers(init.headers).get('x-file-metadata')));
      const file = { id, name: metadata.name, course_id: metadata.courseId || null, assignment_id: metadata.assignmentId || null, kind: metadata.kind, state: 'ready', mime_type: 'text/plain', size_bytes: 12, created_at: baseProfile.updated_at, updated_at: baseProfile.updated_at, content_sha256: null };
      stored = [file]; return Response.json({ file }, { status: 201 });
    }
    if (url.includes('?id=')) return new Response('Actual bytes', { headers: { 'content-type': 'text/plain' } });
    return Response.json({ files: stored });
  };
  try {
    await render(Workspace, { initialProfile: baseProfile }); await click('Files'); await click('Upload file');
    const chooser = field('Choose file');
    await act(async () => { Object.defineProperty(chooser, 'files', { value: [new File(['Actual bytes'], 'Unique private reading.txt')] }); chooser.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.equal(unloadBlocked(), true); await click('Upload / retry file');
    assert.match(rootNode.textContent, /Storage offline/); assert.equal(field('File name').value, 'Unique private reading.txt');
    assert.equal(field('File name').matches(':disabled'), true); assert.match(rootNode.textContent, /edit its details after the upload finishes/);
    fail = false; await click('Upload / retry file'); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.equal(unloadBlocked(), false);
    assert.match(rootNode.textContent, /Unique private reading/);
    await edit('File class filter', 'personal'); await edit('File view', 'grid'); await saveAndReload();
    await click('Files'); assert.equal(field('File class filter').value, 'personal'); assert.equal(field('File view').value, 'grid');
    assert.deepEqual(server.dashboard.d.filePreferences, { filter: 'personal', view: 'grid' });
    await click('Search'); const search = rootNode.querySelector('[aria-label="Search everything"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Unique private reading'); search.dispatchEvent(new window.Event('input', { bubbles: true })); });
    const result = rootNode.querySelector('.search-results button'); assert.ok(result); await act(async () => result.click());
    assert.match(rootNode.textContent, /Actual bytes/); assert.ok(rootNode.querySelector('a[download][href*="account=profile-a"]'));
  } finally { filesFetcher = undefined; if (root) await unmount(); }
});
