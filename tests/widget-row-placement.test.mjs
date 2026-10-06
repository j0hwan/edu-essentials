import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const { default: Grid, calculateWidgetPlacements } = await import(await clientModule("app/animated-widget-grid.tsx"));

test("large and medium footprints use the first whole small-cell space", () => {
  assert.deepEqual(calculateWidgetPlacements(["large", "medium", "small", "mini", "mini"], 4), [
    { column: 1, columnSpan: 2, row: 1, rowSpan: 4 },
    { column: 3, columnSpan: 2, row: 1, rowSpan: 2 },
    { column: 3, columnSpan: 1, row: 3, rowSpan: 2 },
    { column: 4, columnSpan: 1, row: 3, rowSpan: 1 },
    { column: 4, columnSpan: 1, row: 4, rowSpan: 1 },
  ]);

  assert.deepEqual(calculateWidgetPlacements(["medium-vertical", "small", "small"], 2), [
    { column: 1, columnSpan: 1, row: 1, rowSpan: 4 },
    { column: 2, columnSpan: 1, row: 1, rowSpan: 2 },
    { column: 2, columnSpan: 1, row: 3, rowSpan: 2 },
  ]);
});

test("paired minis share a slot while other sizes start on whole small rows", () => {
  assert.deepEqual(calculateWidgetPlacements(["small", "small", "mini", "mini", "medium", "medium"], 4), [
    { column: 1, columnSpan: 1, row: 1, rowSpan: 2 },
    { column: 2, columnSpan: 1, row: 1, rowSpan: 2 },
    { column: 3, columnSpan: 1, row: 1, rowSpan: 1 },
    { column: 3, columnSpan: 1, row: 2, rowSpan: 1 },
    { column: 1, columnSpan: 2, row: 3, rowSpan: 2 },
    { column: 3, columnSpan: 2, row: 3, rowSpan: 2 },
  ]);

  assert.deepEqual(calculateWidgetPlacements(["mini", "medium"], 2), [
    { column: 1, columnSpan: 1, row: 1, rowSpan: 1 },
    { column: 1, columnSpan: 2, row: 3, rowSpan: 2 },
  ], "a lone mini reserves its entire small cell, including the unused lower half");
});

test("preview and live direct cards update placement after reorder and responsive resize", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://layout.example.invalid/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalRequestFrame = window.requestAnimationFrame;
  const originalCancelFrame = window.cancelAnimationFrame;
  const frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = (id) => frames.delete(id);

  const { createElement: h, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const previewRender = (cards, columns, layoutKey) => h(Grid, {
    layoutKey,
    label: "Preview widgets",
    className: "wa-preview-cards",
    animateLayout: false,
    style: { "--widget-columns": String(columns), columnGap: "16px" },
  },
    ...cards.map(({ id, size }) => h("article", { key: id, className: "wa-preview-card", "data-card-id": id, "data-size": size }, id)),
    h("button", { key: "add", className: "add-widget-tile" }, "Add widget"),
  );
  const liveRender = (cards, layoutKey) => h(Grid, {
    layoutKey,
    label: "Live widgets",
    animateLayout: false,
    style: { "--widget-columns": "4", columnGap: "16px" },
  },
    ...cards.map(({ id, size }) => h("article", { key: id, className: "widget-card", "data-widget-id": id, "data-size": size }, id)),
    h("button", { key: "add", className: "add-widget-tile" }, "Add widget"),
  );
  const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); };

  try {
    const screenshotOrder = [
      { id: "small-a", size: "small" }, { id: "small-b", size: "small" },
      { id: "mini-a", size: "mini" }, { id: "mini-b", size: "mini" },
      { id: "medium-a", size: "medium" }, { id: "medium-b", size: "medium" },
    ];
    await act(async () => root.render(previewRender(screenshotOrder, 4, "preview-start")));
    const preview = (id) => document.querySelector(`[data-card-id="${id}"]`);
    assert.equal(preview("medium-a").style.gridRow, "3 / span 2");
    assert.equal(preview("medium-b").style.gridRow, "3 / span 2");
    assert.equal(document.querySelector(".add-widget-tile").style.gridRow, "", "the non-card action is skipped");

    const reordered = [
      { id: "medium-a", size: "medium" }, { id: "mini-a", size: "mini" },
      { id: "small-a", size: "small" }, { id: "mini-b", size: "mini" },
    ];
    await act(async () => root.render(previewRender(reordered, 4, "preview-reordered")));
    assert.equal(preview("medium-a").style.gridColumn, "1 / span 2");
    assert.equal(preview("mini-a").style.gridRow, "1 / span 1");
    assert.equal(preview("mini-b").style.gridRow, "2 / span 1", "the next mini fills the pending slot even after other cards");

    const grid = document.querySelector(".widget-grid");
    grid.style.setProperty("--widget-columns", "2");
    window.dispatchEvent(new window.Event("resize"));
    flushFrames();
    assert.equal(preview("medium-a").style.gridRow, "1 / span 2");
    assert.equal(preview("small-a").style.gridColumn, "2 / span 1");
    assert.equal(preview("mini-a").style.gridRow, "3 / span 1");

    await act(async () => root.render(liveRender([{ id: "live-large", size: "large" }, { id: "live-mini", size: "mini" }], "live")));
    const liveLarge = document.querySelector('[data-widget-id="live-large"]');
    const liveMini = document.querySelector('[data-widget-id="live-mini"]');
    assert.equal(liveLarge.style.gridRow, "1 / span 4");
    assert.equal(liveMini.style.gridRow, "5 / span 1");
    assert.equal(document.querySelector(".add-widget-tile").style.gridRow, "", "the hidden live action is skipped");
  } finally {
    await act(async () => root.unmount());
    if (originalRequestFrame) window.requestAnimationFrame = originalRequestFrame;
    else delete window.requestAnimationFrame;
    if (originalCancelFrame) window.cancelAnimationFrame = originalCancelFrame;
    else delete window.cancelAnimationFrame;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.window;
    delete globalThis.document;
    dom.window.close();
  }
});
