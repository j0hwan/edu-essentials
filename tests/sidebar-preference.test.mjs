import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "https://edu.example/home",
  runScripts: "dangerously",
});
for (const name of [
  "window", "document", "Element", "HTMLElement", "HTMLFormElement", "HTMLInputElement",
  "HTMLSelectElement", "HTMLTextAreaElement", "SVGElement", "Node", "Event", "MouseEvent",
  "MutationObserver",
]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act, createElement } = React;
const { renderToString } = await import("react-dom/server");
const { hydrateRoot } = await import("react-dom/client");
const { default: Workspace } = await import(await clientModule("app/workspace-client.tsx"));
const { validateProfile } = await import(await clientModule("lib/profile.ts"));
const {
  SIDEBAR_COLLAPSED_BOOTSTRAP,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} = await import(await clientModule("lib/sidebar-preference.ts"));

const profile = {
  ...validateProfile({ display_name: "Alex" }),
  id: "profile-a",
  auth_user_id: "user-a",
  email: "alex@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: "2026-09-06T00:00:00.000Z",
  onboarding_completed_at: "2026-09-05T00:00:00.000Z",
};
const dashboard = {
  v: 1,
  a: "day",
  w: [["day", "Day", [[12, 1]]]],
  n: "Saved notes",
  d: { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month" },
};

let media;
globalThis.fetch = async (input) => String(input).startsWith("/api/files")
  ? Response.json({ files: [] })
  : Response.json({ initialized: true, courses: [], dashboard, revision: profile.updated_at, profile });
window.matchMedia = () => media;

function setMediaQuery() {
  media = {
    matches: false,
    listeners: new Set(),
    addEventListener(_event, listener) { this.listeners.add(listener); },
    removeEventListener(_event, listener) { this.listeners.delete(listener); },
  };
}

function resetDocument() {
  setMediaQuery();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.getElementById("root").innerHTML = "";
}

function runBootstrap() {
  // Evaluate the exact script body passed to next/script in the root layout.
  window.eval(SIDEBAR_COLLAPSED_BOOTSTRAP);
}

test("the before-interactive bootstrap applies only valid saved values and tolerates blocked storage", () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  const storage = window.localStorage;
  for (const [stored, expected] of [["true", "true"], ["false", "false"], ["yes", null], [null, null]]) {
    resetDocument();
    if (stored === null) storage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    else storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, stored);
    runBootstrap();
    assert.equal(document.documentElement.getAttribute("data-sidebar-collapsed"), expected, `stored value ${String(stored)}`);
  }

  resetDocument();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { throw new Error("Storage blocked"); },
  });
  try {
    assert.doesNotThrow(runBootstrap);
    assert.equal(document.documentElement.hasAttribute("data-sidebar-collapsed"), false);
  } finally {
    Object.defineProperty(window, "localStorage", storageDescriptor);
  }
});

test("SSR hydration hands the pre-paint state to the workspace class without a gap", async () => {
  resetDocument();
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");

  // The server cannot read localStorage, so this is the normal expanded SSR
  // markup. The bootstrap attribute must style this markup before hydration.
  const serverMarkup = renderToString(createElement(Workspace, { initialProfile: profile }));
  document.getElementById("root").innerHTML = serverMarkup;
  assert.equal(document.querySelector(".app-shell").classList.contains("sidebar-collapsed"), false);
  document.getElementById("root").innerHTML = "";

  runBootstrap();
  assert.equal(document.documentElement.getAttribute("data-sidebar-collapsed"), "true");
  const rootNode = document.getElementById("root");
  rootNode.innerHTML = serverMarkup;
  const shell = rootNode.querySelector(".app-shell");
  const observedMutations = [];
  const observer = new MutationObserver((records) => observedMutations.push(...records));
  observer.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true });

  const recoverableErrors = [];
  let root;
  try {
    await act(async () => {
      root = hydrateRoot(rootNode, createElement(Workspace, { initialProfile: profile }), {
        onRecoverableError(error) { recoverableErrors.push(error.message); },
      });
      await Promise.resolve();
    });

    assert.deepEqual(recoverableErrors, [], "hydration reports no recoverable mismatch");
    assert.ok(shell.classList.contains("sidebar-collapsed"), `the saved collapsed state reaches Workspace (class=${shell.className}; storage=${window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)}; bootstrap=${document.documentElement.getAttribute("data-sidebar-collapsed")})`);
    assert.equal(document.documentElement.hasAttribute("data-sidebar-collapsed"), false, "the bootstrap marker is removed after the class commit");

    const records = [...observedMutations, ...observer.takeRecords()];
    const classCommit = records.findIndex((record) => record.target === shell && record.attributeName === "class" && record.oldValue?.startsWith("app-shell reference-ui"));
    const bootstrapRemoval = records.findIndex((record) => record.target === document.documentElement && record.attributeName === "data-sidebar-collapsed" && record.oldValue === "true");
    assert.ok(classCommit >= 0, `hydration commits the collapsed class (classes=${JSON.stringify(records.filter((record) => record.target === shell && record.attributeName === "class").map((record) => record.oldValue))})`);
    assert.ok(bootstrapRemoval >= 0, "hydration removes the root bootstrap marker");
    assert.ok(classCommit < bootstrapRemoval, "the collapsed class commits before the bootstrap marker is removed");

    await act(async () => rootNode.querySelector('button[aria-label="Expand sidebar"]').click());
    assert.equal(rootNode.querySelector(".app-shell").classList.contains("sidebar-collapsed"), false);
    assert.equal(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY), "false");

    await act(async () => rootNode.querySelector('button[aria-label="Collapse sidebar"]').click());
    assert.equal(rootNode.querySelector(".app-shell").classList.contains("sidebar-collapsed"), true);
    assert.equal(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY), "true");
  } finally {
    observer.disconnect();
    if (root) await act(async () => root.unmount());
  }

  // A reload repeats the early bootstrap from the persisted choice and then
  // transfers it through hydration again.
  resetDocument();
  runBootstrap();
  assert.equal(document.documentElement.getAttribute("data-sidebar-collapsed"), "true");
  const restoredRoot = document.getElementById("root");
  restoredRoot.innerHTML = serverMarkup;
  let restored;
  try {
    await act(async () => {
      restored = hydrateRoot(restoredRoot, createElement(Workspace, { initialProfile: profile }));
      await Promise.resolve();
    });
    assert.ok(restoredRoot.querySelector(".app-shell").classList.contains("sidebar-collapsed"), "a reload restores the saved collapsed state");
    assert.equal(document.documentElement.hasAttribute("data-sidebar-collapsed"), false);
    await act(async () => restoredRoot.querySelector('button[aria-label="Expand sidebar"]').click());
    assert.equal(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY), "false");
    assert.equal(restoredRoot.querySelector(".app-shell").classList.contains("sidebar-collapsed"), false);
  } finally {
    if (restored) await act(async () => restored.unmount());
  }

  // The expanded choice also survives a reload and hydrates without a flash
  // back to the collapsed layout.
  resetDocument();
  runBootstrap();
  assert.equal(document.documentElement.getAttribute("data-sidebar-collapsed"), "false");
  const expandedRoot = document.getElementById("root");
  expandedRoot.innerHTML = serverMarkup;
  let expanded;
  const expandedHydrationErrors = [];
  try {
    await act(async () => {
      expanded = hydrateRoot(expandedRoot, createElement(Workspace, { initialProfile: profile }), {
        onRecoverableError(error) { expandedHydrationErrors.push(error.message); },
      });
      await Promise.resolve();
    });
    assert.deepEqual(expandedHydrationErrors, [], "expanded restoration reports no recoverable hydration mismatch");
    assert.equal(expandedRoot.querySelector(".app-shell").classList.contains("sidebar-collapsed"), false, "a reload restores the saved expanded state");
    assert.equal(document.documentElement.hasAttribute("data-sidebar-collapsed"), false, "the false bootstrap marker is removed after hydration");
  } finally {
    if (expanded) await act(async () => expanded.unmount());
  }
});
