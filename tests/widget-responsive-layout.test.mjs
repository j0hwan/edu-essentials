import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const { default: Grid, calculateWidgetUnit } = await import(await clientModule("app/animated-widget-grid.tsx"));

test("small widget units are square and scale from width and column count", () => {
  assert.equal(calculateWidgetUnit({ gridWidth: 1088, gap: 16, columns: 4 }), 260);
  assert.equal(calculateWidgetUnit({ gridWidth: 1608, gap: 16, columns: 4 }), 390);
  assert.equal(calculateWidgetUnit({ gridWidth: 536, gap: 16, columns: 2 }), 260);
  assert.equal(calculateWidgetUnit({ gridWidth: 300, gap: 32, columns: 2 }), 134);
});

test("board measurement follows grid width at every height and cleans up observers", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://layout.example.invalid/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let resizeListener;
  let removedResizeListener = false;
  const addListener = window.addEventListener.bind(window);
  const removeListener = window.removeEventListener.bind(window);
  window.addEventListener = (type, listener, options) => {
    if (type === "resize") resizeListener = listener;
    addListener(type, listener, options);
  };
  window.removeEventListener = (type, listener, options) => {
    if (type === "resize" && listener === resizeListener) removedResizeListener = true;
    removeListener(type, listener, options);
  };
  const frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  };

  const { createElement: h, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  let boardWidth = 1088;
  let documentTop = 300;
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 900 });
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
  const render = () => h("main", { style: { paddingBottom: "20px" } },
    h("header", null, "Today"),
    h(Grid, {
      layoutKey: "stable",
      label: "Widgets",
      style: { columnGap: "16px", "--widget-columns": "4" },
    }, h("article", { "data-widget-id": "notes" }, "Notes")),
  );
  const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); };
  try {
    await act(async () => root.render(render()));
    const grid = document.querySelector(".widget-grid");
    Object.defineProperty(grid, "clientWidth", { get: () => boardWidth });
    grid.getBoundingClientRect = () => {
      return { x: 0, y: documentTop - window.scrollY, top: documentTop - window.scrollY, width: boardWidth, height: 0, right: boardWidth, bottom: documentTop - window.scrollY };
    };
    window.dispatchEvent(new window.Event("resize"));
    flushFrames();
    assert.equal(grid.style.getPropertyValue("--widget-unit"), "260px");
    assert.ok(observers.at(-1).targets.has(grid));
    assert.equal(observers.at(-1).targets.size, 1, "only the grid is observed for width changes");
    assert.equal(grid.style.maxWidth, "", "board sizing does not write an inline max-width");

    window.scrollY = 200;
    window.innerHeight = 360;
    documentTop = 500;
    document.querySelector("main").style.paddingBottom = "180px";
    window.dispatchEvent(new window.Event("resize"));
    flushFrames();
    assert.equal(grid.style.getPropertyValue("--widget-unit"), "260px", "viewport height, document top, scrolling, and page padding do not change a same-width board");

    observers.at(-1).callback();
    observers.at(-1).callback();
    assert.equal(frames.size, 1, "resize measurements coalesce into one frame");
    flushFrames();
    assert.equal(grid.style.getPropertyValue("--widget-unit"), "260px", "repeated observer deliveries cannot affect width-based sizing");

    boardWidth = 1200;
    observers.at(-1).callback();
    flushFrames();
    assert.equal(grid.style.getPropertyValue("--widget-unit"), "288px", "a wider grid increases the square unit even in a short viewport");

    grid.style.setProperty("--widget-columns", "2");
    boardWidth = 536;
    window.innerWidth = 390;
    window.dispatchEvent(new window.Event("resize"));
    flushFrames();
    assert.equal(grid.style.getPropertyValue("--widget-unit"), "260px", "phone columns use the same square-unit calculation");

    boardWidth = 600;
    observers.at(-1).callback();
    assert.equal(frames.size, 1);
    await act(async () => root.unmount());
    assert.equal(frames.size, 0, "unmount cancels pending measurement");
    assert.ok(observers.every((observer) => observer.disconnected));
    assert.ok(removedResizeListener, "unmount removes its resize callback");
  } finally {
    await act(async () => root.unmount());
    delete globalThis.ResizeObserver;
    dom.window.close();
  }
});
