import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://edu.example.invalid" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: WorkspaceLoadError } = await import(await clientModule("app/workspace-load-error.tsx"));
const container = document.getElementById("root");

test("loading errors count down and refresh once after five seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  let retries = 0;
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(WorkspaceLoadError, { title: "Course previews could not be loaded", onRetry: () => retries++ })));
    assert.match(container.textContent, /Course previews could not be loadedRetrying in 5 seconds/);
    await act(async () => t.mock.timers.tick(2000));
    assert.match(container.textContent, /Retrying in 3 seconds/);
    await act(async () => t.mock.timers.tick(2999));
    assert.equal(retries, 0);
    await act(async () => t.mock.timers.tick(1));
    assert.equal(retries, 1);
    assert.match(container.textContent, /Retrying now/);
    await act(async () => t.mock.timers.tick(5000));
    assert.equal(retries, 1);
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
  }
});

test("rerendering updates the retry callback without restarting the countdown", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  let retries = 0;
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(WorkspaceLoadError, { title: "Loading failed", onRetry: () => { throw new Error("stale retry callback"); } })));
    await act(async () => t.mock.timers.tick(3000));
    await act(async () => root.render(createElement(WorkspaceLoadError, { title: "Loading failed", onRetry: () => retries++ })));
    await act(async () => t.mock.timers.tick(2000));
    assert.equal(retries, 1);
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
  }
});

test("manual retry cancels the countdown and remains available if the reload is canceled", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  let retries = 0;
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(WorkspaceLoadError, { title: "Your workspace could not be loaded", onRetry: () => retries++ })));
    await act(async () => t.mock.timers.tick(4000));
    await act(async () => container.querySelector("button").click());
    assert.equal(retries, 1);
    await act(async () => t.mock.timers.tick(2000));
    assert.equal(retries, 1, "the automatic retry is canceled after a manual retry");
    await act(async () => container.querySelector("button").click());
    assert.equal(retries, 2, "the user can retry again if navigation was canceled");
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
  }
});

test("unmounting cancels the pending retry", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  let retries = 0;
  const root = createRoot(container);
  await act(async () => root.render(createElement(WorkspaceLoadError, { title: "Loading failed", onRetry: () => retries++ })));
  await act(async () => root.unmount());
  await act(async () => t.mock.timers.tick(5000));
  assert.equal(retries, 0);
  t.mock.timers.reset();
});
