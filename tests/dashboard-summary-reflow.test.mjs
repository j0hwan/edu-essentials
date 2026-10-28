import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Brief } = await import(await clientModule("app/dashboard-study-brief.tsx"));

test("summary geometry batches notifications, ignores visual scaling, and cleans pending frames", async () => {
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = (frame) => frames.delete(frame);
  const callbacks = [];
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { callbacks.push(callback); observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const root = createRoot(document.getElementById("root"));
  const props = {
    focusAssignments: [], overdueCount: 0, dueTodayCount: 0, completedThisWeek: 0, courseCount: 0,
    courseCodeFor: () => "", renderStatusBadge: () => null, onSelectAssignment() {},
    onAddAssignment() {}, onAddClass() {}, onOpenAssistant() {}, onAskAssistant() {}, reducedMotion: true,
  };
  try {
    await act(async () => root.render(createElement(Brief, props)));
    const section = document.querySelector(".dashboard-study-brief");
    const path = section.querySelector(".dashboard-study-outline path");
    const rectangles = new Map([
      [section, { left: 0, top: 0, width: 600, height: 300 }],
      [section.querySelector(".dashboard-study-summary"), { left: 20, top: 20, width: 300, height: 260 }],
      [section.querySelector(".dashboard-focus"), { left: 340, top: 20, width: 240, height: 260 }],
      [section.querySelector(".dashboard-study-lead"), { left: 20, top: 80, width: 300, height: 80 }],
      [section.querySelector(".dashboard-study-footer"), { left: 20, top: 240, width: 300, height: 40 }],
    ]);
    let scaleX = 1;
    let scaleY = 1;
    let reads = 0;
    for (const [element, rectangle] of rectangles) {
      element.getBoundingClientRect = () => {
        reads++;
        return {
          left: 100 + rectangle.left * scaleX, top: 50 + rectangle.top * scaleY,
          width: rectangle.width * scaleX, height: rectangle.height * scaleY,
          right: 100 + (rectangle.left + rectangle.width) * scaleX,
          bottom: 50 + (rectangle.top + rectangle.height) * scaleY,
        };
      };
    }
    Object.defineProperty(section, "offsetWidth", { value: 600 });
    Object.defineProperty(section, "offsetHeight", { value: 300 });
    section.style.paddingBottom = "20px";
    section.style.borderTopLeftRadius = "16px";
    const notify = callbacks.at(-1);
    const flush = () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0)); };
    notify([]);
    notify([]);
    window.dispatchEvent(new window.Event("resize"));
    assert.equal(reads, 0);
    assert.equal(frames.size, 1);
    flush();
    const originalShape = path.getAttribute("d");
    assert.ok(originalShape);
    const changed = [];
    const mutations = new window.MutationObserver(records => changed.push(...records));
    mutations.observe(section, { attributes: true, subtree: true });
    scaleX = 0.8;
    scaleY = 1.2;
    notify([]);
    flush();
    await Promise.resolve();
    assert.equal(path.getAttribute("d"), originalShape);
    assert.equal(changed.length, 0, "visual reflow transforms do not invalidate the layout-space outline");
    mutations.disconnect();
    notify([]);
    assert.equal(frames.size, 1);
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
    assert.ok(observers.every(observer => observer.disconnected));
  } finally {
    await act(async () => root.unmount());
    delete globalThis.ResizeObserver;
    dom.window.close();
  }
});
