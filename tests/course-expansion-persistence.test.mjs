import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.localStorage = window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => dom.window.close());

const [{ createElement, act }, { createRoot }, { useCourseExpansion }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/use-course-expansion.ts")),
]);

const rootNode = document.getElementById("root");
const storageKey = (profileId) => `edu-dashboard-expanded-course:${profileId}`;
const thumbnailKey = (profileId) => `edu-dashboard-course-thumbnail:${profileId}`;
const courseA = { id: "course-a", code: "BIO 101", name: "Biology" };
const courseB = { id: "course-b", code: "HIST 202", name: "History" };
let root;
let latest;

function Harness({ profileId = "profile-one", page = "dashboard", courses = [courseA], ready = true, persist = true }) {
  latest = useCourseExpansion({ profileId, page, courses, ready, persist });
  return createElement("div", null, latest.selectedClass?.id ?? "closed");
}

async function mount(props = {}) {
  rootNode.replaceChildren();
  root = createRoot(rootNode);
  await act(async () => root.render(createElement(Harness, props)));
}

async function render(props = {}) {
  await act(async () => root.render(createElement(Harness, props)));
}

async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
  rootNode.replaceChildren();
}

afterEach(async () => {
  await unmount();
  window.localStorage.clear();
});

test("restores the expanded course after dashboard to home/files navigation", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  assert.equal(latest.selectedClass?.id, courseA.id);
  assert.equal(latest.skipOpeningAnimation, false, "an explicit course open keeps its normal entrance animation");
  assert.notEqual(window.localStorage.getItem(storageKey("profile-one")), null);

  await render({ page: "home" });
  assert.equal(latest.selectedClass, null, "leaving the dashboard clears the visible expansion");
  assert.notEqual(window.localStorage.getItem(storageKey("profile-one")), null, "navigation keeps the saved course");

  await render({ page: "files" });
  assert.equal(latest.selectedClass, null);
  await render({ page: "dashboard" });
  assert.equal(latest.selectedClass?.id, courseA.id, "returning to the dashboard restores the saved course");
  assert.equal(latest.skipOpeningAnimation, true, "navigation restoration skips the entrance animation");
});

test("explicit close removes the saved course and course-list changes do not reopen it", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  assert.equal(latest.skipOpeningAnimation, false, "a fresh explicit open is not treated as restored");
  await act(async () => latest.setSelectedClass(null));
  assert.equal(latest.selectedClass, null);
  assert.equal(latest.skipOpeningAnimation, false, "a closed course has no opening animation to skip");
  assert.equal(window.localStorage.getItem(storageKey("profile-one")), null);

  await act(async () => latest.setSelectedClass(courseA));
  assert.equal(latest.selectedClass?.id, courseA.id);
  assert.equal(latest.skipOpeningAnimation, false, "reopening explicitly after close uses the normal entrance animation");
  await act(async () => latest.setSelectedClass(null));

  await render({ courses: [courseA, courseB] });
  assert.equal(latest.selectedClass, null, "adding courses does not restore an explicitly closed expansion");
  await render({ page: "files", courses: [courseA, courseB] });
  await render({ page: "dashboard", courses: [courseA, courseB] });
  assert.equal(latest.selectedClass, null, "navigation does not reopen an explicitly closed expansion");
});

test("remount waits for hydrated courses before restoring the saved course", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  assert.equal(latest.skipOpeningAnimation, false, "an explicit selection before remount is animated normally");
  await unmount();

  await mount({ courses: [], ready: false });
  assert.equal(latest.selectedClass, null, "the course is not restored before data is ready");
  assert.equal(latest.skipOpeningAnimation, false, "loading without a selection does not skip an entrance");
  assert.notEqual(window.localStorage.getItem(storageKey("profile-one")), null, "an empty loading list does not erase the saved choice");

  await render({ courses: [courseA, courseB], ready: true });
  assert.equal(latest.selectedClass?.id, courseA.id, "hydrated course data unlocks restoration");
  assert.equal(latest.skipOpeningAnimation, true, "hydration restoration skips the entrance animation");
});

test("expanded-course storage is scoped to the profile", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  await render({ profileId: "profile-two", courses: [courseB] });
  assert.equal(latest.selectedClass, null, "another profile does not inherit the first profile's course");
  await act(async () => latest.setSelectedClass(courseB));

  await render({ profileId: "profile-one", courses: [courseA, courseB] });
  assert.equal(latest.selectedClass?.id, courseA.id, "switching back restores that profile's own saved course");
  assert.notEqual(window.localStorage.getItem(storageKey("profile-one")), window.localStorage.getItem(storageKey("profile-two")));
});

test("opening a course from home selects it on dashboard over the previous saved course", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  await render({ page: "home" });
  assert.equal(latest.selectedClass, null);

  await act(async () => latest.openDashboardCourse(courseB));
  assert.equal(window.localStorage.getItem(storageKey("profile-one")), courseB.id);
  assert.equal(latest.skipOpeningAnimation, false, "a quick-link open is a fresh selection");
  await render({ page: "dashboard" });
  assert.equal(latest.selectedClass?.id, courseB.id, "the requested destination course takes precedence over the old saved choice");
  assert.equal(latest.skipOpeningAnimation, false, "the quick-link selection stays a normal open after navigation");
});

test("opening a course from home works with persist=false and leaves saved storage untouched", async () => {
  window.localStorage.setItem(storageKey("profile-one"), courseA.id);
  await mount({ page: "home", persist: false });

  await act(async () => latest.openDashboardCourse(courseB));
  await render({ page: "dashboard", persist: false });
  assert.equal(latest.selectedClass?.id, courseB.id);
  assert.equal(latest.skipOpeningAnimation, false, "a non-persisted quick-link open is also a fresh selection");
  assert.equal(window.localStorage.getItem(storageKey("profile-one")), courseA.id, "disabled persistence does not overwrite stored data");
});

test("a saved course missing from the ready course list is ignored", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  await unmount();

  await mount({ courses: [courseB], ready: true });
  assert.equal(latest.selectedClass, null, "deleted course ids do not produce a stale expansion");
});

test("resetSelectedClass hides the expansion while retaining its saved choice", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  const savedValue = window.localStorage.getItem(storageKey("profile-one"));
  assert.notEqual(savedValue, null);

  await act(async () => latest.resetSelectedClass());
  assert.equal(latest.selectedClass, null);
  assert.equal(window.localStorage.getItem(storageKey("profile-one")), savedValue);
});

test("clearSavedCourse removes storage immediately while keeping the visible course for closing", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  window.localStorage.setItem(thumbnailKey("profile-one"), "cached thumbnail");
  assert.equal(latest.selectedClass?.id, courseA.id);

  await act(async () => latest.clearSavedCourse());
  assert.equal(window.localStorage.getItem(storageKey("profile-one")), null, "the saved choice is removed immediately");
  assert.equal(window.localStorage.getItem(thumbnailKey("profile-one")), null, "the thumbnail is removed at close intent, before the exit animation");
  assert.equal(latest.selectedClass?.id, courseA.id, "the current detail stays visible for its close animation");

  await render({ page: "home" });
  await render({ page: "dashboard" });
  assert.equal(latest.selectedClass, null, "navigation does not restore a course after its saved choice was cleared");
});

test("navigation keeps the expanded-course thumbnail while explicit close deletes it", async () => {
  await mount();
  await act(async () => latest.setSelectedClass(courseA));
  window.localStorage.setItem(thumbnailKey("profile-one"), "cached thumbnail");
  await render({ page: "home" });
  assert.equal(window.localStorage.getItem(thumbnailKey("profile-one")), "cached thumbnail");
  await render({ page: "dashboard" });
  assert.equal(latest.selectedClass?.id, courseA.id);
  assert.equal(window.localStorage.getItem(thumbnailKey("profile-one")), "cached thumbnail");
  await act(async () => latest.setSelectedClass(null));
  assert.equal(window.localStorage.getItem(thumbnailKey("profile-one")), null);
});

test("expanding another course removes the previous course thumbnail", async () => {
  await mount({ courses: [courseA, courseB] });
  await act(async () => latest.setSelectedClass(courseA));
  window.localStorage.setItem(thumbnailKey("profile-one"), "cached thumbnail");
  await act(async () => latest.setSelectedClass(courseB));
  assert.equal(window.localStorage.getItem(thumbnailKey("profile-one")), null);
  assert.equal(window.localStorage.getItem(storageKey("profile-one")), courseB.id);
});

test("persist=false keeps selection in memory without writing localStorage", async () => {
  await mount({ persist: false });
  await act(async () => latest.setSelectedClass(courseA));
  assert.equal(latest.selectedClass?.id, courseA.id);
  assert.equal(window.localStorage.getItem(storageKey("profile-one")), null);
});

test("blocked localStorage does not prevent rendering or selecting a course", async () => {
  const windowStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  const globalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const blockedStorage = {
    getItem() { throw new Error("Storage blocked"); },
    setItem() { throw new Error("Storage blocked"); },
    removeItem() { throw new Error("Storage blocked"); },
  };

  Object.defineProperty(window, "localStorage", { configurable: true, value: blockedStorage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: blockedStorage });
  try {
    await mount();
    assert.equal(latest.selectedClass, null);
    await act(async () => latest.setSelectedClass(courseA));
    assert.equal(latest.selectedClass?.id, courseA.id, "storage write errors do not block in-memory selection");
    await act(async () => latest.setSelectedClass(null));
    assert.equal(latest.selectedClass, null, "storage removal errors do not block closing");
  } finally {
    await unmount();
    if (windowStorageDescriptor) Object.defineProperty(window, "localStorage", windowStorageDescriptor);
    if (globalStorageDescriptor) Object.defineProperty(globalThis, "localStorage", globalStorageDescriptor);
  }
});
