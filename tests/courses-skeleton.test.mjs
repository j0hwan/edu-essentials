import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://edu.example.invalid/dashboard",
  pretendToBeVisual: true,
});
const { window } = dom;
for (const name of [
  "window", "document", "Element", "HTMLElement", "HTMLFormElement", "HTMLInputElement",
  "HTMLSelectElement", "HTMLTextAreaElement", "Node", "MouseEvent", "KeyboardEvent",
  "PopStateEvent", "MutationObserver", "localStorage", "requestAnimationFrame", "cancelAnimationFrame",
]) {
  globalThis[name] = name === "localStorage" ? window.localStorage : window[name];
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
window.confirm = () => true;
window.alert = () => {};
window.scrollTo = () => {};
window.Image = class {
  complete = true;
  naturalWidth = 120;
  naturalHeight = 80;
  decode() { return Promise.resolve(); }
};

const { createElement, act } = await import("react");
const { createRoot, hydrateRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { validateProfile } = await import(await clientModule("lib/profile.ts"));
const { encodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));
const { default: Workspace } = await import(await clientModule("app/workspace-client.tsx"));
const { default: ExpandedCourseSkeleton } = await import(await clientModule("app/expanded-course-skeleton.tsx"));
const { default: DashboardLoadTransition } = await import(await clientModule("app/dashboard-load-transition.tsx"));
const { useCourseExpansion } = await import(await clientModule("app/use-course-expansion.ts"));
const { MAP_PREVIEW_PLACEHOLDERS, SYLLABUS_PREVIEW_PLACEHOLDER } = await import(await clientModule("lib/course-preview-placeholders.ts"));
const rootNode = document.getElementById("root");

const profileId = "courses-skeleton-test-profile";
const profile = {
  ...validateProfile({ display_name: "Alex", major: "History" }),
  id: profileId,
  auth_user_id: `auth-${profileId}`,
  email: "alex@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: "2026-10-08T12:00:00.000Z",
  onboarding_completed_at: "2026-10-07T00:00:00.000Z",
};
const course = {
  id: "course-loading-test",
  code: "HIST 201",
  name: "World History",
  credits: 3,
  instructor: "Dr. Rivera",
  room: "Room 12",
  color: "#5b63e8",
  soft: "#eef0ff",
  initials: "WH",
};
const courseImage = {
  id: "course-loading-image",
  name: "World History image.png",
  mime_type: "image/png",
  size_bytes: 68,
  course_id: course.id,
  assignment_id: null,
  kind: "class-image",
  state: "ready",
  created_at: "2026-10-08T11:00:00.000Z",
  updated_at: "2026-10-08T11:00:00.000Z",
  content_sha256: null,
  folder_id: null,
  content_backend: "object",
  metadata_revision: 1,
  content_revision: 1,
  trashed_at: null,
  deleted_at: null,
  trash_operation_id: null,
  original_folder_id: null,
};
const dashboard = encodeWorkspaceState(
  [{ id: "saved-home", name: "Saved Home", widgets: [] }],
  "saved-home",
  "",
  { assignments: [], manualEvents: [], dashboardView: "cards" },
);
const successPayload = () => ({ initialized: true, courses: [course], dashboard, revision: profile.updated_at, profile });

function installWorkspaceFetch({ failReads = 0 } = {}) {
  let getCalls = 0;
  let failuresRemaining = failReads;
  const pending = [];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/files")) return Response.json({ files: [] });
    assert.ok(url.startsWith("/api/workspace"), `Unexpected test fetch ${init.method ?? "GET"} ${url}`);
    if (init.method === "PUT") return Response.json({ ok: true, revision: "2026-10-08T12:01:00.000Z" });
    if (init.method === "POST") return Response.json({ initialized: true, revision: profile.updated_at });
    getCalls++;
    if (failuresRemaining > 0) {
      failuresRemaining--;
      return Response.json({ error: "Workspace is temporarily offline." }, { status: 503 });
    }
    return await new Promise((resolve) => pending.push(resolve));
  };
  globalThis.fetch = fetcher;
  window.fetch = fetcher;
  return {
    get getCalls() { return getCalls; },
    releaseNext() { pending.shift()?.(Response.json(successPayload())); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

function installHeldDashboardFetch({ failFiles = false, failImage = false, stallFiles = false } = {}) {
  const workspaceReads = [], fileLists = [], imageReads = [];
  const requests = [];
  const fileSignals = [];
  let workspaceCalls = 0, fileListCalls = 0, imageCalls = 0;
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    requests.push(`${init.method ?? "GET"} ${url}`);
    if (url === "/api/files") {
      fileListCalls++;
      if (stallFiles) {
        fileSignals.push(init.signal);
        return await new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason ?? new DOMException("Timed out", "TimeoutError")), { once: true });
        });
      }
      return await new Promise((resolve) => fileLists.push(resolve));
    }
    if (url.startsWith(`/api/files?id=${courseImage.id}`)) {
      imageCalls++;
      return await new Promise((resolve) => imageReads.push(resolve));
    }
    assert.ok(url.startsWith("/api/workspace"), `Unexpected test fetch ${init.method ?? "GET"} ${url}`);
    if (init.method === "PUT") return Response.json({ ok: true, revision: profile.updated_at });
    if (init.method === "POST") return Response.json({ initialized: true, revision: profile.updated_at });
    workspaceCalls++;
    return await new Promise((resolve) => workspaceReads.push(resolve));
  };
  globalThis.fetch = fetcher;
  window.fetch = fetcher;
  return {
    get workspaceCalls() { return workspaceCalls; },
    get fileListCalls() { return fileListCalls; },
    get imageCalls() { return imageCalls; },
    get requests() { return requests; },
    get fileSignals() { return fileSignals; },
    releaseWorkspace(overrides = {}) { workspaceReads.shift()?.(Response.json({ ...successPayload(), ...overrides })); },
    releaseFiles(files = [courseImage]) {
      while (fileLists.length) {
        if (failFiles) fileLists.shift()(Response.json({ error: "Files are offline." }, { status: 503 }));
        else fileLists.shift()(Response.json({ files }));
      }
    },
    releaseImage() {
      while (imageReads.length) {
        if (failImage) imageReads.shift()(Response.json({ error: "Image bytes are unavailable." }, { status: 503 }));
        else imageReads.shift()(new Response(new Blob([new Uint8Array(68)], { type: "image/png" }), { headers: { "content-type": "image/png" } }));
      }
    },
  };
}

function stubFileListTimeouts() {
  const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  const nativeAny = AbortSignal.any.bind(AbortSignal);
  const timeoutSignals = new WeakMap();
  const combinedSignals = new WeakMap();
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    writable: true,
    value(milliseconds) {
      if (milliseconds !== 15_000) return nativeTimeout(milliseconds);
      const controller = new AbortController();
      timeoutSignals.set(controller.signal, { controller, milliseconds });
      return controller.signal;
    },
  });
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    writable: true,
    value(signals) {
      const combined = nativeAny(signals);
      const timeout = signals.map((signal) => timeoutSignals.get(signal)).find(Boolean);
      if (timeout) combinedSignals.set(combined, timeout);
      return combined;
    },
  });
  return {
    timeoutFor(signal) { return combinedSignals.get(signal) ?? timeoutSignals.get(signal); },
    abort(signal) {
      const timeout = combinedSignals.get(signal) ?? timeoutSignals.get(signal);
      assert.ok(timeout, "the file-list request uses the bounded 15-second timeout signal");
      timeout.controller.abort(new DOMException("The file-list request timed out.", "TimeoutError"));
    },
    restore() {
      if (timeoutDescriptor) Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor);
      if (anyDescriptor) Object.defineProperty(AbortSignal, "any", anyDescriptor);
    },
  };
}

async function waitFor(predicate, description, timeoutMs = 2200) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  assert.ok(predicate(), `Timed out waiting for ${typeof description === "function" ? description() : description}`);
}

async function mountWorkspace(path = "/dashboard") {
  window.history.replaceState({}, "", path);
  const root = createRoot(rootNode);
  await act(async () => root.render(createElement(Workspace, { initialProfile: profile })));
  return root;
}

async function clickLink(href) {
  const link = rootNode.querySelector(`a[href="${href}"]`);
  assert.ok(link, `Missing navigation link to ${href}`);
  await act(async () => link.click());
}

function assertCoursesSkeleton() {
  const skeleton = rootNode.querySelector('.courses-skeleton[role="status"][aria-label="Loading dashboard"]');
  assert.ok(skeleton, "the Dashboard page exposes its accessible loading skeleton");
  assert.equal(skeleton.getAttribute("aria-busy"), "true");
  assert.equal(skeleton.querySelectorAll(".courses-skeleton__class").length, 4, "four course placeholders reserve the expected grid shape");
  assert.equal(skeleton.querySelectorAll("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])").length, 0, "the loading decoration has no actionable or focusable controls");
  const decoration = skeleton.querySelector(".courses-skeleton__decoration");
  assert.equal(decoration?.getAttribute("aria-hidden"), "true", "the visual skeleton is hidden from assistive technology");
  assert.ok(decoration?.hasAttribute("inert"), "the visual skeleton subtree is inert");
  return skeleton;
}

function stubNavigationType(type) {
  const descriptor = Object.getOwnPropertyDescriptor(window.performance, "getEntriesByType");
  Object.defineProperty(window.performance, "getEntriesByType", {
    configurable: true,
    value(entryType) { return entryType === "navigation" ? [{ type }] : []; },
  });
  return () => {
    if (descriptor) Object.defineProperty(window.performance, "getEntriesByType", descriptor);
    else delete window.performance.getEntriesByType;
  };
}

function assertExpandedCourseSkeleton() {
  const skeleton = rootNode.querySelector('.expanded-course-skeleton[role="status"][aria-label="Loading expanded course"]');
  assert.ok(skeleton, "a saved-course reload exposes the dedicated expanded-course loading view");
  assert.equal(skeleton.getAttribute("aria-busy"), "true");
  assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the dashboard grid skeleton is replaced while a saved expansion reloads");
  assert.equal(skeleton.querySelectorAll("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])").length, 0, "the loading decoration has no actionable or focusable controls");
  const decoration = skeleton.querySelector(".expanded-course-skeleton__decoration");
  assert.equal(decoration?.getAttribute("aria-hidden"), "true", "the visual decoration is hidden from assistive technology");
  assert.ok(decoration?.hasAttribute("inert"), "the visual decoration subtree is inert");
  assert.equal(skeleton.querySelectorAll("img, .course-preview-placeholder").length, 0, "the skeleton contains no preview images");
  return skeleton;
}

function CourseExpansionTransitionHarness({ ready, courses = [] }) {
  const expansion = useCourseExpansion({ profileId, page: "dashboard", courses, ready, persist: true });
  return createElement(DashboardLoadTransition, {
    ready,
    restorationChecked: expansion.restorationChecked,
    restoringCourseOnReload: expansion.restoringCourseOnReload,
    imagesListed: true,
    imageKeys: [],
    children: () => expansion.selectedClass
      ? createElement("section", {
        className: "test-restored-course",
        role: "dialog",
        "data-restored": expansion.skipOpeningAnimation ? "true" : undefined,
      }, expansion.selectedClass.name)
      : createElement("main", { className: "test-regular-dashboard" }, "Regular Dashboard"),
  });
}

test("Dashboard shows a dedicated skeleton during a held workspace read, then reveals saved classes", async () => {
  rootNode.replaceChildren();
  const api = installWorkspaceFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.getCalls === 1, "the held workspace read");

    assertCoursesSkeleton();
    assert.equal(rootNode.querySelector(".workspace-loading"), null, "Dashboard does not show the generic Loading workspace view");
    assert.equal(rootNode.querySelector(".dashboard-study-brief"), null, "sample AI content is not shown while real workspace data is loading");
    assert.equal(rootNode.querySelector("[data-course-card-id]"), null, "live course cards are not shown before hydration");
    assert.equal(rootNode.querySelector(".dashboard-classes"), null, "interactive class controls are not shown before hydration");

    await act(async () => { api.releaseNext(); await Promise.resolve(); });
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the saved course card");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the skeleton is removed after hydration");
    assert.match(rootNode.querySelector('[data-course-card-id="course-loading-test"]').textContent, /World History/);
    assert.equal(rootNode.querySelector(".workspace-loading"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("Dashboard cards mount hidden and stay under the skeleton until their private image decodes", async () => {
  rootNode.replaceChildren();
  const api = installHeldDashboardFetch();
  const pendingDecode = deferred();
  const nativeCreateObjectURL = globalThis.URL.createObjectURL;
  const nativeRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const imagePrototype = window.HTMLImageElement.prototype;
  const imageDescriptors = Object.fromEntries(["complete", "naturalWidth", "decode"].map((name) => [name, Object.getOwnPropertyDescriptor(imagePrototype, name)]));
  let decodeCalls = 0;
  Object.defineProperty(globalThis.URL, "createObjectURL", { configurable: true, value: () => "blob:held-course-image" });
  Object.defineProperty(globalThis.URL, "revokeObjectURL", { configurable: true, value: () => {} });
  window.URL.createObjectURL = globalThis.URL.createObjectURL;
  window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;
  Object.defineProperty(imagePrototype, "complete", { configurable: true, get: () => true });
  Object.defineProperty(imagePrototype, "naturalWidth", { configurable: true, get: () => 120 });
  Object.defineProperty(imagePrototype, "decode", { configurable: true, value: () => { decodeCalls++; return pendingDecode.promise; } });
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls === 1, "the held workspace and private-file reads");
    assertCoursesSkeleton();
    assert.equal(rootNode.querySelector(".dashboard-reflow"), null, "the live Dashboard content waits for its workspace data");

    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the live card mounted behind the skeleton");
    let dashboardRoot = rootNode.querySelector("main > .dashboard-reflow");
    assertCoursesSkeleton();
    assert.equal(dashboardRoot?.dataset.imagesPending, "true");
    assert.ok(dashboardRoot?.hasAttribute("inert"), "pending Dashboard controls are inert");
    assert.equal(dashboardRoot?.getAttribute("aria-hidden"), "true");
    assert.equal(rootNode.querySelector(".private-class-image"), null, "the held file list has not started a duplicate card request");
    assert.equal(api.imageCalls, 0);

    api.releaseFiles();
    await waitFor(() => api.imageCalls > 0, () => `the card's private image request; calls=${JSON.stringify(api.requests)} files=${JSON.stringify(rootNode.querySelector(".class-card")?.textContent)}`);
    assert.equal(api.imageCalls, 1, "the card starts exactly one private image request");
    assert.ok(api.fileListCalls > 0, "Dashboard image metadata came from the private-file list");
    api.releaseImage();
    await waitFor(() => rootNode.querySelector(".private-class-image"), "the private image mounted inside the existing course card");
    const image = rootNode.querySelector(".class-card .private-class-image");
    assert.ok(image, "the image is sourced by the already-rendered card");
    assert.equal(image.getAttribute("src"), "blob:held-course-image");
    await waitFor(() => decodeCalls === 1, "the actual image decode to begin");
    dashboardRoot = rootNode.querySelector("main > .dashboard-reflow");
    assertCoursesSkeleton();
    assert.equal(dashboardRoot?.dataset.imagesPending, "true", "load alone cannot reveal the dashboard before decode settles");
    assert.ok(dashboardRoot?.hasAttribute("inert"));
    assert.equal(api.imageCalls, 1, "the image is not fetched a second time when the gate observes it");
    assert.equal(window.localStorage.getItem(`edu-dashboard-course-thumbnail:${profileId}`), null, "compact cards do not write expanded-course thumbnails");

    await act(async () => { pendingDecode.resolve(); await pendingDecode.promise; await Promise.resolve(); });
    await waitFor(() => rootNode.querySelector(".courses-skeleton") === null, "the decoded image to release the skeleton");
    dashboardRoot = rootNode.querySelector("main > .dashboard-reflow");
    assert.equal(dashboardRoot?.getAttribute("data-images-pending"), null);
    assert.equal(dashboardRoot?.hasAttribute("inert"), false);
    assert.equal(dashboardRoot?.getAttribute("aria-hidden"), null);
    assert.equal(rootNode.querySelector(".class-card .private-class-image"), image, "the same decoded card image remains visible after reveal");
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    if (nativeCreateObjectURL) Object.defineProperty(globalThis.URL, "createObjectURL", { configurable: true, value: nativeCreateObjectURL });
    else delete globalThis.URL.createObjectURL;
    if (nativeRevokeObjectURL) Object.defineProperty(globalThis.URL, "revokeObjectURL", { configurable: true, value: nativeRevokeObjectURL });
    else delete globalThis.URL.revokeObjectURL;
    window.URL.createObjectURL = nativeCreateObjectURL;
    window.URL.revokeObjectURL = nativeRevokeObjectURL;
    for (const [name, descriptor] of Object.entries(imageDescriptors)) {
      if (descriptor) Object.defineProperty(imagePrototype, name, descriptor);
      else delete imagePrototype[name];
    }
  }
});

test("a failed file-list read releases Dashboard readiness without leaving the skeleton", async () => {
  rootNode.replaceChildren();
  const api = installHeldDashboardFetch({ failFiles: true });
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls === 1, "the held workspace and file-list reads");
    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the live Dashboard card");
    assertCoursesSkeleton();
    api.releaseFiles();
    await waitFor(() => rootNode.querySelector(".courses-skeleton") === null, "the failed file-list read to end the loading gate");
    assert.equal(api.imageCalls, 0, "no image bytes are requested without listed file metadata");
    assert.equal(rootNode.querySelector(".class-card .private-class-image"), null, "the card fallback remains available when image metadata cannot load");
    assert.equal(rootNode.querySelector("main > .dashboard-reflow")?.getAttribute("data-images-pending"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("a failed private-image request releases the skeleton and leaves the card fallback visible", async () => {
  rootNode.replaceChildren();
  const api = installHeldDashboardFetch({ failImage: true });
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls === 1, "the held workspace and file-list reads");
    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the live Dashboard card");
    api.releaseFiles();
    await waitFor(() => api.imageCalls === 1, "the card image request");
    assertCoursesSkeleton();
    api.releaseImage();
    await waitFor(() => rootNode.querySelector(".courses-skeleton") === null, "the failed image request to release the skeleton");
    assert.equal(rootNode.querySelector(".class-card .private-class-image"), null, "a broken private image falls back to the card's background and watermark");
    assert.ok(rootNode.querySelector(".class-card .course-watermark"));
    assert.equal(rootNode.querySelector("main > .dashboard-reflow")?.getAttribute("data-images-pending"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("a stalled private-file listing times out and releases the Dashboard skeleton", async () => {
  rootNode.replaceChildren();
  const timeout = stubFileListTimeouts();
  const api = installHeldDashboardFetch({ stallFiles: true });
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls > 0, "the held workspace read and stalled file-list request");
    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the live Dashboard card");
    assertCoursesSkeleton();
    assert.ok(api.fileSignals.length > 0);
    assert.ok(api.fileSignals.every((signal) => timeout.timeoutFor(signal)?.milliseconds === 15_000), "each file-list read has the 15-second deadline");
    for (const signal of api.fileSignals) timeout.abort(signal);
    await waitFor(() => rootNode.querySelector(".courses-skeleton") === null, "the timed-out file-list read to release the gate");
    assert.equal(api.imageCalls, 0, "a timed-out metadata read does not invent or request an image");
    assert.equal(rootNode.querySelector("main > .dashboard-reflow")?.getAttribute("data-images-pending"), null);
    assert.ok(rootNode.querySelector("[data-course-card-id] .course-watermark"), "the live card fallback remains visible");
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    timeout.restore();
  }
});

test("a reload with a saved course shows its detail skeleton until the workspace restores that course", async () => {
  rootNode.replaceChildren();
  const restoreNavigation = stubNavigationType("reload");
  window.localStorage.setItem(`edu-dashboard-expanded-course:${profileId}`, course.id);
  const api = installHeldDashboardFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls > 0, "the held workspace and file-list reads");

    assertExpandedCourseSkeleton();
    assert.equal(rootNode.querySelector(".class-card-expansion-dialog"), null, "course details wait for authoritative workspace data");

    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector('.class-card-expansion-dialog[data-restored="true"]'), "the saved course detail");
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null, "hydration replaces the reload skeleton with the restored detail");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the restored detail does not flash the compact dashboard grid");
    assert.match(rootNode.querySelector(".class-card-expansion-dialog").textContent, /World History/);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.localStorage.removeItem(`edu-dashboard-expanded-course:${profileId}`);
    restoreNavigation();
  }
});

test("restoration keeps an image-free skeleton until every placeholder loads and decodes", async () => {
  rootNode.replaceChildren();
  const restoreNavigation = stubNavigationType("reload");
  const key = `edu-dashboard-expanded-course:${profileId}`;
  window.localStorage.setItem(key, course.id);
  const originalImage = window.Image;
  const images = [];
  window.Image = class {
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    decoded = deferred();
    constructor() { images.push(this); }
    decode() { return this.decoded.promise; }
    load() {
      this.complete = true;
      this.naturalWidth = 120;
      this.naturalHeight = 80;
      this.onload?.();
    }
  };
  const api = installHeldDashboardFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => images.length === 3 && api.workspaceCalls === 1, "placeholder requests and workspace read");
    assertExpandedCourseSkeleton();
    await act(async () => { api.releaseWorkspace(); });
    assertExpandedCourseSkeleton();
    assert.equal(rootNode.querySelector(".class-card-expansion-dialog"), null, "workspace readiness alone cannot reveal the course");
    await act(async () => { images.forEach((image) => image.load()); });
    assertExpandedCourseSkeleton();
    await act(async () => { images[0].decoded.resolve(); images[1].decoded.resolve(); });
    assertExpandedCourseSkeleton();
    assert.equal(rootNode.querySelector(".class-card-expansion-dialog"), null, "the final decode still blocks restoration");
    await act(async () => { images[2].decoded.resolve(); });
    await waitFor(() => rootNode.querySelector('.class-card-expansion-dialog[data-restored="true"]'), "decoded placeholder handoff");
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.Image = originalImage;
    window.localStorage.removeItem(key);
    restoreNavigation();
  }
});

test("failed restoration placeholders show retry instead of revealing an unprepared course", async () => {
  rootNode.replaceChildren();
  const restoreNavigation = stubNavigationType("reload");
  const key = `edu-dashboard-expanded-course:${profileId}`;
  window.localStorage.setItem(key, course.id);
  const originalImage = window.Image;
  window.Image = class { complete = true; naturalWidth = 0; naturalHeight = 0; };
  const api = installHeldDashboardFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1, "workspace read");
    await act(async () => { api.releaseWorkspace(); });
    await waitFor(() => rootNode.querySelector('[role="alert"] button')?.textContent === "Retry previews", "preview retry state");
    assert.equal(rootNode.querySelector(".class-card-expansion-dialog"), null);
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null, "failure replaces the indefinite skeleton with an actionable state");
    window.Image = originalImage;
    await act(async () => { rootNode.querySelector('[role="alert"] button').click(); });
    await waitFor(() => rootNode.querySelector('.class-card-expansion-dialog[data-restored="true"]'), "successful retry");
    assert.equal(rootNode.querySelector('[role="alert"]'), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.Image = originalImage;
    window.localStorage.removeItem(key);
    restoreNavigation();
  }
});

test("a restored syllabus stays blurred while file metadata loads instead of flashing the empty state", async () => {
  rootNode.replaceChildren();
  const restoreNavigation = stubNavigationType("reload");
  const key = `edu-dashboard-expanded-course:${profileId}`;
  window.localStorage.setItem(key, course.id);
  const api = installHeldDashboardFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls > 0, "workspace and file-list reads");
    assertExpandedCourseSkeleton();
    const restoredDashboard = encodeWorkspaceState([{ id: "saved-home", name: "Saved Home", widgets: [] }], "saved-home", "", {
      assignments: [], manualEvents: [], dashboardView: "cards",
      courseDetails: { [course.id]: { meetings: [], officeHours: "", syllabusFileId: "11111111-1111-4111-8111-111111111111" } },
    });
    api.releaseWorkspace({ dashboard: restoredDashboard });
    await waitFor(() => rootNode.querySelector('.class-card-expansion-dialog[data-restored="true"]'), "restored course before files arrive");
    const preview = rootNode.querySelector(".course-syllabus-preview");
    assert.ok(preview, "the syllabus placeholder survives the skeleton-to-course handoff");
    assert.equal(preview.getAttribute("aria-busy"), "true");
    assert.equal(preview.querySelector(".course-preview-placeholder").getAttribute("src"), SYLLABUS_PREVIEW_PLACEHOLDER);
    assert.equal(rootNode.querySelector(".expanded-class-syllabus-empty"), null, "pending file metadata is not an empty syllabus");
    assert.doesNotMatch(rootNode.querySelector('[aria-label="Course syllabus"]').textContent, /file is unavailable/);
    api.releaseFiles([]);
    await waitFor(() => rootNode.querySelector(".expanded-class-syllabus-empty"), "the terminal missing-file state");
    assert.match(rootNode.querySelector('[aria-label="Course syllabus"]').textContent, /file is unavailable/);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.localStorage.removeItem(key);
    restoreNavigation();
  }
});

test("a reload whose saved course is missing falls back to the regular Dashboard", async () => {
  rootNode.replaceChildren();
  const restoreNavigation = stubNavigationType("reload");
  const key = `edu-dashboard-expanded-course:${profileId}`;
  window.localStorage.setItem(key, "deleted-course");
  const api = installWorkspaceFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.getCalls === 1, "the held workspace read");
    assertExpandedCourseSkeleton();

    api.releaseNext();
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the regular Dashboard course card");
    await waitFor(() => rootNode.querySelector(".courses-skeleton") === null, "the regular Dashboard to finish its empty image-list gate");
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null, "a deleted course does not leave a detail skeleton behind");
    assert.equal(rootNode.querySelector(".class-card-expansion-dialog"), null, "a deleted course does not open unrelated details");
    assert.equal(window.localStorage.getItem(key), null, "the stale saved selection is cleared");
    assert.match(rootNode.querySelector('[data-course-card-id="course-loading-test"]').textContent, /World History/);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.localStorage.removeItem(key);
    restoreNavigation();
  }
});

test("ordinary navigation keeps the Dashboard grid skeleton while a saved course is loading", async () => {
  rootNode.replaceChildren();
  const restoreNavigation = stubNavigationType("navigate");
  window.localStorage.setItem(`edu-dashboard-expanded-course:${profileId}`, course.id);
  const api = installHeldDashboardFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls > 0, "the held workspace and file-list reads");
    assertCoursesSkeleton();
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null, "ordinary navigation does not use the reload-only detail skeleton");

    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector('.class-card-expansion-dialog[data-restored="true"]'), "the saved course detail after hydration");
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.localStorage.removeItem(`edu-dashboard-expanded-course:${profileId}`);
    restoreNavigation();
  }
});

test("navigating away removes the expanded-course skeleton during a held reload", async () => {
  rootNode.replaceChildren();
  const restoreNavigation = stubNavigationType("reload");
  window.localStorage.setItem(`edu-dashboard-expanded-course:${profileId}`, course.id);
  const api = installHeldDashboardFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1, "the held workspace read");
    assertExpandedCourseSkeleton();

    await clickLink("/home");
    await waitFor(() => window.location.pathname === "/home", "navigation to Home");
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null, "the reload detail skeleton leaves when Dashboard is no longer active");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "neither Dashboard skeleton leaks into Home");
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.localStorage.removeItem(`edu-dashboard-expanded-course:${profileId}`);
    restoreNavigation();
  }
});

test("SSR waits for the reload decision, then hydration chooses the expanded skeleton without a mismatch", async () => {
  rootNode.replaceChildren();
  const key = `edu-dashboard-expanded-course:${profileId}`;
  window.localStorage.setItem(key, course.id);
  const element = createElement(CourseExpansionTransitionHarness, { ready: false, courses: [] });
  const serverMarkup = renderToString(element);
  assert.equal(serverMarkup, "", "the server does not guess between the grid and expanded-course skeletons");
  rootNode.innerHTML = serverMarkup;

  // Keep the server output mounted for a short interval to model delayed client hydration.
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the grid skeleton is absent before the reload decision");
  assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null, "the detail skeleton is also absent before the reload decision");

  const restoreNavigation = stubNavigationType("reload");
  const recoverableErrors = [];
  let root;
  try {
    await act(async () => {
      root = hydrateRoot(rootNode, element, { onRecoverableError: (error) => recoverableErrors.push(error) });
    });
    assertExpandedCourseSkeleton();
    assert.deepEqual(recoverableErrors, [], "server and first-client renders match; restoration happens after hydration starts");

    await act(async () => root.render(createElement(CourseExpansionTransitionHarness, { ready: true, courses: [course] })));
    const detail = rootNode.querySelector('.test-restored-course[role="dialog"][data-restored="true"]');
    assert.ok(detail, "ready workspace data replaces the loading view with restored course detail");
    assert.match(detail.textContent, /World History/);
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null);
    assert.equal(rootNode.querySelector(".courses-skeleton"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.localStorage.removeItem(key);
    restoreNavigation();
  }
});

test("ordinary hydration still reveals the regular Dashboard skeleton after the decision", async () => {
  rootNode.replaceChildren();
  const serverMarkup = renderToString(createElement(CourseExpansionTransitionHarness, { ready: false, courses: [] }));
  rootNode.innerHTML = serverMarkup;
  const restoreNavigation = stubNavigationType("navigate");
  const recoverableErrors = [];
  let root;
  try {
    await act(async () => {
      root = hydrateRoot(rootNode, createElement(CourseExpansionTransitionHarness, { ready: false, courses: [] }), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });
    assertCoursesSkeleton();
    assert.equal(rootNode.querySelector(".expanded-course-skeleton"), null, "ordinary navigation remains on the compact Dashboard loading view");
    assert.deepEqual(recoverableErrors, []);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    restoreNavigation();
  }
});

test("a restored expanded course bypasses the compact-image gate without losing its image entrance", async () => {
  rootNode.replaceChildren();
  window.localStorage.setItem(`edu-dashboard-expanded-course:${profileId}`, course.id);
  const api = installHeldDashboardFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls > 0, "the held workspace and file-list reads");
    assertCoursesSkeleton();
    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector(".class-card-expansion-dialog[data-restored='true']"), "the saved expanded course to restore");
    await waitFor(() => rootNode.querySelector(".courses-skeleton") === null, "the selected-course exception to release the skeleton");

    const dashboardRoot = rootNode.querySelector("main > .dashboard-reflow");
    assert.equal(dashboardRoot?.getAttribute("data-restored-course"), "true", "the restored dashboard keeps its entrance state");
    assert.equal(dashboardRoot?.getAttribute("data-images-pending"), null);
    assert.equal(rootNode.querySelector(".class-card-expansion-content .private-class-image"), null, "the expanded fallback renders before the held metadata list");
    assert.equal(api.imageCalls, 0, "selected-course restoration does not wait for the compact card image");

    api.releaseFiles();
    await waitFor(() => api.imageCalls > 0, "the expanded course image request");
    api.releaseImage();
    await waitFor(() => rootNode.querySelector(".class-card-expansion-content .private-class-image"), "the expanded image to mount");
    const expandedImage = rootNode.querySelector(".class-card-expansion-content .private-class-image");
    assert.ok(expandedImage.classList.contains("private-class-image-fade"), "the expanded image keeps its restored blur and fade entrance");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "loading an expanded image does not restore the full-page skeleton");
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    window.localStorage.removeItem(`edu-dashboard-expanded-course:${profileId}`);
  }
});

test("navigating away during a held image decode ignores its late settlement", async () => {
  rootNode.replaceChildren();
  const api = installHeldDashboardFetch();
  const pendingDecode = deferred();
  const nativeCreateObjectURL = globalThis.URL.createObjectURL;
  const nativeRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const imagePrototype = window.HTMLImageElement.prototype;
  const imageDescriptors = Object.fromEntries(["complete", "naturalWidth", "decode"].map((name) => [name, Object.getOwnPropertyDescriptor(imagePrototype, name)]));
  let decodeCalls = 0;
  Object.defineProperty(globalThis.URL, "createObjectURL", { configurable: true, value: () => "blob:navigating-course-image" });
  Object.defineProperty(globalThis.URL, "revokeObjectURL", { configurable: true, value: () => {} });
  window.URL.createObjectURL = globalThis.URL.createObjectURL;
  window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;
  Object.defineProperty(imagePrototype, "complete", { configurable: true, get: () => true });
  Object.defineProperty(imagePrototype, "naturalWidth", { configurable: true, get: () => 120 });
  Object.defineProperty(imagePrototype, "decode", { configurable: true, value: () => { decodeCalls++; return pendingDecode.promise; } });
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.workspaceCalls === 1 && api.fileListCalls > 0, "the held workspace and file-list reads");
    api.releaseWorkspace();
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the live card");
    api.releaseFiles();
    await waitFor(() => api.imageCalls > 0, "the compact card image request");
    api.releaseImage();
    await waitFor(() => rootNode.querySelector(".class-card .private-class-image"), "the private image to render");
    await waitFor(() => decodeCalls === 1, "the private image decode to begin");
    assertCoursesSkeleton();

    await clickLink("/home");
    await waitFor(() => window.location.pathname === "/home", "navigation to Home");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "Dashboard's skeleton leaves during navigation");
    await act(async () => { pendingDecode.resolve(); await pendingDecode.promise; await Promise.resolve(); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "a decode callback from the old page cannot restore Dashboard's skeleton");
    assert.equal(rootNode.querySelector(".dashboard-reflow"), null, "the old Dashboard stays unmounted after its decode completes");
    assert.equal(api.imageCalls, 1);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
    if (nativeCreateObjectURL) Object.defineProperty(globalThis.URL, "createObjectURL", { configurable: true, value: nativeCreateObjectURL });
    else delete globalThis.URL.createObjectURL;
    if (nativeRevokeObjectURL) Object.defineProperty(globalThis.URL, "revokeObjectURL", { configurable: true, value: nativeRevokeObjectURL });
    else delete globalThis.URL.revokeObjectURL;
    window.URL.createObjectURL = nativeCreateObjectURL;
    window.URL.revokeObjectURL = nativeRevokeObjectURL;
    for (const [name, descriptor] of Object.entries(imageDescriptors)) {
      if (descriptor) Object.defineProperty(imagePrototype, name, descriptor);
      else delete imagePrototype[name];
    }
  }
});

test("a failed Dashboard read shows the error, and retry restores the skeleton until saved data arrives", async () => {
  rootNode.replaceChildren();
  const api = installWorkspaceFetch({ failReads: 1 });
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => rootNode.textContent.includes("could not be loaded"), "the failed initial read");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "a failed request does not leave the loading skeleton visible");
    assert.ok([...rootNode.querySelectorAll("button")].some((button) => button.textContent.trim() === "Retry loading"));

    const retry = [...rootNode.querySelectorAll("button")].find((button) => button.textContent.trim() === "Retry loading");
    await act(async () => retry.click());
    await waitFor(() => api.getCalls === 2, "the retry workspace read");
    assertCoursesSkeleton();
    assert.equal(rootNode.querySelector(".workspace-loading"), null, "retry uses the Dashboard skeleton instead of the generic loader");

    await act(async () => { api.releaseNext(); await Promise.resolve(); });
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the saved course after retry");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("a held Dashboard skeleton does not leak after navigating to Home or another page", async () => {
  rootNode.replaceChildren();
  const api = installWorkspaceFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.getCalls === 1, "the held workspace read");
    assertCoursesSkeleton();

    await clickLink("/home");
    await waitFor(() => window.location.pathname === "/home", "navigation to Home");
    await waitFor(() => rootNode.querySelector(".home-skeleton"), "Home's own loading skeleton");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the Dashboard skeleton leaves when Home is selected");
    assert.equal(rootNode.querySelector(".workspace-loading"), null, "Home keeps its own loading presentation");

    await clickLink("/calendar");
    await waitFor(() => window.location.pathname === "/calendar", "navigation to Calendar");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the Dashboard skeleton does not leak to Calendar");
    assert.match(rootNode.querySelector(".workspace-loading")?.textContent ?? "", /Loading your workspace/);
    assert.equal(api.getCalls, 1, "navigation does not start a second workspace read");
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("Dashboard skeleton supports the reduced-motion rendering option", async () => {
  rootNode.replaceChildren();
  const { default: CoursesSkeleton } = await import(await clientModule("app/courses-skeleton.tsx"));
  let root;
  try {
    root = createRoot(rootNode);
    await act(async () => root.render(createElement(CoursesSkeleton, { reducedMotion: true })));
    const skeleton = rootNode.querySelector('.courses-skeleton[role="status"]');
    assert.ok(skeleton, "reduced-motion rendering retains the accessible skeleton");
    assert.ok(skeleton.classList.contains("courses-skeleton--reduced"), "reducedMotion applies the non-animated rendering modifier");
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("dashboard server markup preloads every public placeholder before restoration", async () => {
  const { default: DashboardPage } = await import(await clientModule("app/(workspace)/dashboard/page.tsx"));
  const markup = renderToString(createElement(DashboardPage));
  const server = new JSDOM(markup);
  try {
    assert.deepEqual([...server.window.document.querySelectorAll('link[rel="preload"][as="image"]')].map((link) => link.getAttribute("href")), [...MAP_PREVIEW_PLACEHOLDERS, SYLLABUS_PREVIEW_PLACEHOLDER]);
    const loadingMarkup = renderToString(createElement(ExpandedCourseSkeleton));
    assert.doesNotMatch(loadingMarkup, /<img|preview-placeholders/);
  } finally { server.window.close(); }
});

test("expanded-course skeleton exposes its loading status and supports reduced motion", async () => {
  rootNode.replaceChildren();
  let root;
  try {
    root = createRoot(rootNode);
    await act(async () => root.render(createElement(ExpandedCourseSkeleton, { reducedMotion: true })));
    const skeleton = rootNode.querySelector('.expanded-course-skeleton[role="status"][aria-label="Loading expanded course"]');
    assert.ok(skeleton, "the expanded-course loading view has an accessible status name");
    assert.equal(skeleton.getAttribute("aria-busy"), "true");
    assert.ok(skeleton.classList.contains("expanded-course-skeleton--reduced"), "reducedMotion applies the non-animated modifier");
    assert.equal(skeleton.querySelectorAll("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])").length, 0);
    const decoration = skeleton.querySelector(".expanded-course-skeleton__decoration");
    assert.equal(decoration?.getAttribute("aria-hidden"), "true");
    assert.ok(decoration?.hasAttribute("inert"));
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});
