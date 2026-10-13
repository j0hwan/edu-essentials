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

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { validateProfile } = await import(await clientModule("lib/profile.ts"));
const { encodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));
const { default: Workspace } = await import(await clientModule("app/workspace-client.tsx"));
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

async function waitFor(predicate, description, timeoutMs = 2200) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  assert.ok(predicate(), `Timed out waiting for ${description}`);
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
  const skeleton = rootNode.querySelector('.courses-skeleton[role="status"][aria-label="Loading courses"]');
  assert.ok(skeleton, "the Courses page exposes its accessible loading skeleton");
  assert.equal(skeleton.getAttribute("aria-busy"), "true");
  assert.equal(skeleton.querySelectorAll(".courses-skeleton__class").length, 4, "four course placeholders reserve the expected grid shape");
  assert.equal(skeleton.querySelectorAll("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])").length, 0, "the loading decoration has no actionable or focusable controls");
  const decoration = skeleton.querySelector(".courses-skeleton__decoration");
  assert.equal(decoration?.getAttribute("aria-hidden"), "true", "the visual skeleton is hidden from assistive technology");
  assert.ok(decoration?.hasAttribute("inert"), "the visual skeleton subtree is inert");
  return skeleton;
}

test("Courses shows a dedicated skeleton during a held workspace read, then reveals saved classes", async () => {
  rootNode.replaceChildren();
  const api = installWorkspaceFetch();
  let root;
  try {
    root = await mountWorkspace();
    await waitFor(() => api.getCalls === 1, "the held workspace read");

    assertCoursesSkeleton();
    assert.equal(rootNode.querySelector(".workspace-loading"), null, "Courses does not show the generic Loading workspace view");
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

test("a failed Courses read shows the error, and retry restores the skeleton until saved data arrives", async () => {
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
    assert.equal(rootNode.querySelector(".workspace-loading"), null, "retry uses the Courses skeleton instead of the generic loader");

    await act(async () => { api.releaseNext(); await Promise.resolve(); });
    await waitFor(() => rootNode.querySelector('[data-course-card-id="course-loading-test"]'), "the saved course after retry");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null);
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("a held Courses skeleton does not leak after navigating to Home or another page", async () => {
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
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the Courses skeleton leaves when Home is selected");
    assert.equal(rootNode.querySelector(".workspace-loading"), null, "Home keeps its own loading presentation");

    await clickLink("/calendar");
    await waitFor(() => window.location.pathname === "/calendar", "navigation to Calendar");
    assert.equal(rootNode.querySelector(".courses-skeleton"), null, "the Courses skeleton does not leak to Calendar");
    assert.match(rootNode.querySelector(".workspace-loading")?.textContent ?? "", /Loading your workspace/);
    assert.equal(api.getCalls, 1, "navigation does not start a second workspace read");
  } finally {
    if (root) await act(async () => root.unmount());
    rootNode.replaceChildren();
  }
});

test("Courses skeleton supports the reduced-motion rendering option", async () => {
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
