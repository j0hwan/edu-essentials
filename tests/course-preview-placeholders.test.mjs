import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

test("course preview placeholder readiness waits for decoded assets and fences stale work", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
  for (const name of ["window", "document", "HTMLElement", "Element", "Node", "Event"]) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const requests = [];
  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.decodePromise = Promise.resolve();
      requests.push(this);
    }
    set src(value) { this.url = value; }
    decode() { return this.decodePromise; }
    load(width = 120, height = 80) {
      this.complete = true;
      this.naturalWidth = width;
      this.naturalHeight = height;
      this.onload?.();
    }
    fail() { this.onerror?.(); }
  }
  dom.window.Image = FakeImage;

  const [{ createElement, act }, { createRoot }, { useCoursePreviewPlaceholders }] = await Promise.all([
    import("react"), import("react-dom/client"), import(await clientModule("app/use-course-preview-placeholders.ts")),
  ]);
  const rootNode = document.getElementById("root");
  const root = createRoot(rootNode);
  let enabled = true;
  let scopeKey = "profile-a";
  function Probe() {
    const assets = useCoursePreviewPlaceholders(enabled, scopeKey);
    return createElement("span", { "data-ready": String(assets.ready), "data-failed": String(assets.failed) }, "Ready");
  }
  const render = () => act(async () => root.render(createElement(Probe)));
  const ready = () => rootNode.querySelector("span")?.getAttribute("data-ready");
  const completeAll = async () => {
    await act(async () => { for (const image of requests) image.load(); });
    await act(async () => {});
  };

  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    delete dom.window.Image;
  });

  enabled = false;
  await render();
  assert.equal(ready(), "true", "disabled hooks are immediately ready and create no images");
  assert.equal(requests.length, 0);

  enabled = true;
  await render();
  assert.equal(ready(), "false");
  assert.equal(requests.length, 3, "both maps and the syllabus placeholder preload");
  requests[0].decodePromise = new Promise((resolve) => { requests[0].finishDecode = resolve; });
  requests[0].load();
  requests[0].load();
  requests[0].load();
  await act(async () => {});
  assert.equal(ready(), "false", "load alone waits for decode");
  requests[1].load();
  requests[2].load();
  await act(async () => {});
  assert.equal(ready(), "false", "pending decode keeps the gate closed");
  await act(async () => requests[0].finishDecode());
  await act(async () => {});
  assert.equal(ready(), "true");

  scopeKey = "profile-b";
  await render();
  assert.equal(ready(), "false", "readiness is scoped to the current profile");
  const stale = requests.slice(3);
  scopeKey = "profile-c";
  await render();
  await act(async () => { for (const image of stale) image.load(); });
  assert.equal(ready(), "false", "old scope completions cannot release the new scope");
  await completeAll();
  assert.equal(ready(), "true");

  enabled = false;
  await render();
  enabled = true;
  await render();
  assert.equal(ready(), "false", "reenabling starts a fresh readiness attempt");
  await act(async () => requests.at(-1).fail());
  assert.equal(ready(), "false", "image errors never mark unprepared placeholders ready");
  assert.equal(rootNode.querySelector("span").getAttribute("data-failed"), "true");
});

test("cached placeholders are decoded and timed out placeholders fail without revealing", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
  for (const name of ["window", "document", "HTMLElement", "Element", "Node", "Event"]) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  let cached = false;
  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.complete = cached;
      this.naturalWidth = cached ? 64 : 0;
      this.naturalHeight = cached ? 48 : 0;
      requests.push(this);
    }
    set src(value) { this.url = value; }
    decode() { return Promise.resolve(); }
  }
  dom.window.Image = FakeImage;
  const [{ createElement, act }, { createRoot }, { useCoursePreviewPlaceholders }] = await Promise.all([
    import("react"), import("react-dom/client"), import(await clientModule("app/use-course-preview-placeholders.ts")),
  ]);
  const root = createRoot(document.getElementById("root"));
  let scope = "cached";
  function Probe() {
    const assets = useCoursePreviewPlaceholders(true, scope);
    return createElement("span", { "data-ready": String(assets.ready), "data-failed": String(assets.failed) });
  }
  const render = () => act(async () => root.render(createElement(Probe)));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    delete dom.window.Image;
  });

  cached = true;
  await render();
  await act(async () => {});
  assert.equal(document.querySelector("span").getAttribute("data-ready"), "true");
  assert.equal(requests.length, 3, "cached complete images still use the decode path");

  cached = false;
  scope = "timeout";
  await render();
  assert.equal(document.querySelector("span").getAttribute("data-ready"), "false");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 8_050)));
  assert.equal(document.querySelector("span").getAttribute("data-ready"), "false", "timeout never reveals unprepared placeholders");
  assert.equal(document.querySelector("span").getAttribute("data-failed"), "true");
});
