import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const storageKey = "edu-calendar-view";
const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/calendar" });
for (const name of ["window", "document", "Element", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent", "Event"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const [{ createElement, act }, { createRoot }, { default: Workspace }, { validateProfile }, { emptyStudy }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  clientModule("app/workspace-client.tsx").then((url) => import(url)),
  clientModule("lib/profile.ts").then((url) => import(url)),
  clientModule("lib/study.ts").then((url) => import(url)),
]);

const profile = {
  ...validateProfile({ display_name: "Alex", timezone: "America/Los_Angeles", week_starts_on: "Monday" }),
  id: "profile-a", auth_user_id: "user-a", email: "alex@example.invalid", avatar_url: null,
  initialized: true, updated_at: "2026-09-06T00:00:00.000Z", onboarding_completed_at: "2026-09-05T00:00:00.000Z",
};
// This is a canonical historical workspace payload: all hydration defaults are present,
// with only the old server-owned calendar view retained for compatibility coverage.
const legacyDashboard = {
  v: 2, a: "day", w: [["day", "My day", []]],
  d: {
    assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month", calendarFilter: "all",
    courseDetails: {}, syllabusDrafts: [], study: emptyStudy(), filePreferences: { filter: "all", view: "list" },
  },
};
const rootNode = document.getElementById("root");
let root;
let server;
let filesFetcher;
globalThis.fetch = (...args) => String(args[0]).startsWith("/api/files")
  ? (filesFetcher ? filesFetcher(...args) : Response.json({ files: [] }))
  : server.fetcher(...args);
window.confirm = () => true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

function installServer(dashboard = legacyDashboard) {
  server = {
    dashboard: structuredClone(dashboard), revision: profile.updated_at, writes: [], reads: 0,
    fetcher: async (_url, init = {}) => {
      if (init.method === "PUT") {
        const body = JSON.parse(init.body);
        assert.equal(body.baseRevision, server.revision, "workspace writes use the loaded revision");
        server.writes.push(body);
        server.dashboard = body.dashboard;
        server.revision = new Date(Date.parse(server.revision) + 1000).toISOString();
        return Response.json({ ok: true, revision: server.revision });
      }
      server.reads++;
      return Response.json({ initialized: true, courses: [], dashboard: server.dashboard, revision: server.revision, profile });
    },
  };
  return server;
}

async function reset({ keepPreference = false } = {}) {
  if (root) await unmount();
  if (!keepPreference) window.localStorage.removeItem(storageKey);
  window.history.replaceState({}, "", "/calendar");
  filesFetcher = undefined;
  installServer();
  root = createRoot(rootNode);
}
async function renderWorkspace() {
  await act(async () => root.render(createElement(Workspace, { initialProfile: profile })));
}
async function unmount() {
  await act(async () => root.unmount());
  root = undefined;
  rootNode.innerHTML = "";
}
async function click(label) {
  const control = [...rootNode.querySelectorAll("button,a")].find((node) => node.textContent.trim() === label);
  assert.ok(control, `Missing control ${label}`);
  await act(async () => control.click());
}
async function edit(label, value) {
  const scope = rootNode.querySelector(".academic-editor") ?? rootNode;
  const wrapper = [...scope.querySelectorAll("label")].find((node) => node.textContent.startsWith(label));
  assert.ok(wrapper, `Missing field ${label}`);
  const input = wrapper.querySelector("input,select,textarea");
  assert.ok(input, `Missing input for ${label}`);
  await act(async () => {
    if (input.tagName === "SELECT") {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    } else {
      const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
  });
}
async function waitFor(predicate, description, timeoutMs = 3000) {
  let remaining = timeoutMs;
  await act(async () => {
    while (!predicate() && remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      remaining -= 25;
    }
  });
  assert.ok(predicate(), `Timed out waiting for ${description}`);
}
async function wait(duration) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, duration)));
}
function selectedView() {
  const calendar = rootNode.querySelector(".academic-calendar");
  assert.ok(calendar, "calendar is visible at /calendar");
  return calendar.className.match(/academic-calendar-(month|week|day)/)?.[1];
}
function unloadBlocked() {
  const event = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function replaceStorageMethod(name, implementation) {
  const storage = window.localStorage;
  const target = Object.getPrototypeOf(storage);
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value: implementation });
  return () => {
    if (previous) Object.defineProperty(target, name, previous);
    else delete target[name];
  };
}

test("calendar view stays browser-local while workspace event autosave still works", async (t) => {
  t.after(async () => { if (root) await unmount(); });

  await t.test("restores, changes and remounts the browser preference without dirtying the workspace", async () => {
    await reset();
    window.localStorage.setItem(storageKey, "day");
    let storedWrites = 0;
    const nativeSetItem = window.localStorage.setItem.bind(window.localStorage);
    const restoreSetItem = replaceStorageMethod("setItem", function (key, value) {
      if (key === storageKey) storedWrites++;
      nativeSetItem(key, value);
    });
    try {
      await renderWorkspace();
      assert.equal(selectedView(), "day", "the browser preference overrides the legacy server month view");
      assert.equal(storedWrites, 0, "mounting does not rewrite browser storage");
      await wait(800);
      assert.equal(server.writes.length, 0, "normalizing a legacy calendar view does not autosave");
      assert.equal(unloadBlocked(), false);
      assert.doesNotMatch(rootNode.textContent, /Saving workspace/);

      for (const [label, expected] of [["Month", "month"], ["Week", "week"], ["Day", "day"]]) {
        await click(label);
        assert.equal(selectedView(), expected, `${label} changes the visible calendar immediately`);
        assert.equal(window.localStorage.getItem(storageKey), expected, `${label} is stored synchronously in the browser`);
      }
      assert.equal(storedWrites, 3, "each explicit view choice makes one local storage write");
      await wait(800);
      assert.equal(server.writes.length, 0, "view changes stay outside workspace autosave");
      assert.equal(unloadBlocked(), false);
      assert.doesNotMatch(rootNode.textContent, /Saving workspace/);

      await click("Add event");
      await edit("Event name", "Autosave positive control");
      await click("Save event");
      await waitFor(() => server.writes.length === 1 && !unloadBlocked(), "event autosave");
      assert.equal(server.dashboard.d.manualEvents[0].title, "Autosave positive control");
      assert.equal(Object.hasOwn(server.dashboard.d, "calendarView"), false, "new workspace payloads omit the legacy calendar view field");

      await unmount();
      root = createRoot(rootNode);
      installServer(server.dashboard);
      await renderWorkspace();
      assert.equal(selectedView(), "day", "the browser preference survives a full Workspace remount");
      await wait(800);
      assert.equal(server.writes.length, 0, "loading the saved event and normalized data does not trigger a follow-up write");
      assert.equal(unloadBlocked(), false);
    } finally {
      restoreSetItem();
    }
  });

  await t.test("invalid or blocked browser storage falls back to Week and remains usable", async () => {
    for (const mode of ["missing", "invalid", "blocked-read", "blocked-write"]) {
      await reset();
      if (mode === "invalid") window.localStorage.setItem(storageKey, "year");
      const restorers = [];
      if (mode === "blocked-read") restorers.push(replaceStorageMethod("getItem", () => { throw new Error("Storage read blocked"); }));
      if (mode === "blocked-write") restorers.push(replaceStorageMethod("setItem", () => { throw new Error("Storage write blocked"); }));
      try {
        await assert.doesNotReject(async () => renderWorkspace(), `${mode} storage does not break Workspace rendering`);
        assert.equal(selectedView(), "week", `${mode} uses the Week fallback`);
        assert.equal(unloadBlocked(), false);
        await click("Month");
        assert.equal(selectedView(), "month", `${mode} still allows changing the view`);
        await wait(800);
        assert.equal(server.writes.length, 0, `${mode} never dirties account data`);
        assert.equal(unloadBlocked(), false);
      } finally {
        for (const restore of restorers.reverse()) restore();
      }
    }
  });
});
