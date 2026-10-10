import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const { default: Grid, calculateWidgetPlacements } = await import(await clientModule("app/animated-widget-grid.tsx"));

function assertValidPacking(cards, placements, columns) {
  assert.equal(placements.length, cards.length, "each widget keeps its placement identity");
  assert.equal(new Set(cards.map(({ id }) => id)).size, cards.length, "widget identities are unique");

  placements.forEach((placement, index) => {
    const card = cards[index];
    assert.ok(placement.column >= 1, `${card.id} starts inside the grid`);
    assert.ok(placement.column + placement.columnSpan - 1 <= columns, `${card.id} stays within ${columns} columns`);
    assert.ok(placement.row >= 1 && placement.rowSpan >= 1, `${card.id} has a positive row footprint`);

    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const other = placements[otherIndex];
      const overlapsColumns = placement.column < other.column + other.columnSpan
        && other.column < placement.column + placement.columnSpan;
      const overlapsRows = placement.row < other.row + other.rowSpan
        && other.row < placement.row + placement.rowSpan;
      assert.equal(overlapsColumns && overlapsRows, false,
        `${card.id} overlaps ${cards[otherIndex].id}`);
    }
  });

  return Object.fromEntries(cards.map(({ id }, index) => [id, placements[index]]));
}

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

test("mini block flags opt out of legacy automatic pairing", () => {
  const sizes = ["mini", "small", "mini"];
  for (const columns of [2, 4]) {
    const legacy = calculateWidgetPlacements(sizes, columns);
    assert.deepEqual(legacy[2], { column: 1, columnSpan: 1, row: 2, rowSpan: 1 },
      `${columns} columns retains legacy pairing across a full widget`);

    const startsNewBlock = [false, false, true];
    const flagsBefore = [...startsNewBlock];
    const separated = calculateWidgetPlacements(sizes, columns, startsNewBlock);
    assert.notDeepEqual(separated[2], legacy[2], `${columns} columns honors the fresh-cell flag`);
    assert.deepEqual(startsNewBlock, flagsBefore, "placement does not mutate its flags");
  }

  assert.deepEqual(calculateWidgetPlacements(["mini", "small", "mini"], 2, [false, false, true]), [
    { column: 1, columnSpan: 1, row: 1, rowSpan: 1 },
    { column: 2, columnSpan: 1, row: 1, rowSpan: 2 },
    { column: 1, columnSpan: 1, row: 3, rowSpan: 1 },
  ], "a fresh mini block takes a new full cell on two columns");
  assert.deepEqual(calculateWidgetPlacements(["mini", "small", "mini"], 4, [false, false, true]), [
    { column: 1, columnSpan: 1, row: 1, rowSpan: 1 },
    { column: 2, columnSpan: 1, row: 1, rowSpan: 2 },
    { column: 3, columnSpan: 1, row: 1, rowSpan: 1 },
  ], "a fresh mini block takes a new full cell on four columns");

  assert.deepEqual(calculateWidgetPlacements(["mini", "mini", "mini"], 4, [false, true, false]), [
    { column: 1, columnSpan: 1, row: 1, rowSpan: 1 },
    { column: 2, columnSpan: 1, row: 1, rowSpan: 1 },
    { column: 2, columnSpan: 1, row: 2, rowSpan: 1 },
  ], "a flagged mini starts a fresh block that the following mini can join");
  assert.deepEqual(calculateWidgetPlacements(["mini", "unknown", "mini"], 4),
    calculateWidgetPlacements(["mini", "small", "mini"], 4),
    "an unknown size keeps the legacy full-cell fallback and pending mini pair");
});

test("an anchored mini starting a new block leaves earlier minis separate", () => {
  const cards = [
    { id: "earlier-mini", size: "mini" },
    { id: "small-between", size: "small" },
    { id: "new-block-mini", size: "mini" },
    { id: "new-block-partner", size: "mini" },
  ];
  const startsNewMiniBlocks = [false, false, true, false];
  const desktop = calculateWidgetPlacements(cards.map(({ size }) => size), 4, startsNewMiniBlocks, {
    index: 2,
    column: 3,
    row: 1,
  });
  const desktopById = assertValidPacking(cards, desktop, 4);

  assert.deepEqual(desktopById["earlier-mini"], { column: 1, columnSpan: 1, row: 1, rowSpan: 1 });
  assert.deepEqual(desktopById["new-block-mini"], { column: 3, columnSpan: 1, row: 1, rowSpan: 1 });
  assert.deepEqual(desktopById["new-block-partner"], { column: 3, columnSpan: 1, row: 2, rowSpan: 1 },
    "the following mini partners the anchored mini in its lower half");

  const phone = calculateWidgetPlacements(cards.map(({ size }) => size), 2, startsNewMiniBlocks, {
    index: 2,
    column: 2,
    row: 7,
  });
  const phoneById = assertValidPacking(cards, phone, 2);

  assert.deepEqual(phoneById["earlier-mini"], { column: 1, columnSpan: 1, row: 1, rowSpan: 1 });
  assert.deepEqual(phoneById["new-block-mini"], { column: 2, columnSpan: 1, row: 7, rowSpan: 1 });
  assert.deepEqual(phoneById["new-block-partner"], { column: 2, columnSpan: 1, row: 8, rowSpan: 1 },
    "the two-column anchor stays on its later row and keeps its partner there");
});

test("growing a paired bottom mini keeps its small-cell row and displaces packed widgets", () => {
  const beforeResize = [
    { id: "mini-partner", size: "mini" },
    { id: "mini-anchor", size: "mini" },
    { id: "large-blocker", size: "large" },
    { id: "mini-c", size: "mini" },
    { id: "mini-d", size: "mini" },
    { id: "large-later", size: "large" },
  ];
  const oldPlacement = calculateWidgetPlacements(beforeResize.map(({ size }) => size), 4)[1];
  assert.deepEqual(oldPlacement, { column: 1, columnSpan: 1, row: 2, rowSpan: 1 });

  const afterResize = beforeResize.map(({ id, size }) => ({
    id,
    size: id === "mini-anchor" ? "large" : size,
  }));
  const packed = calculateWidgetPlacements(afterResize.map(({ size }) => size), 4, [], {
    index: 1,
    column: oldPlacement.column,
    row: oldPlacement.row,
  });
  const byId = assertValidPacking(afterResize, packed, 4);
  const legacy = calculateWidgetPlacements(afterResize.map(({ size }) => size), 4);

  assert.deepEqual(byId["mini-anchor"], { column: 1, columnSpan: 2, row: 1, rowSpan: 4 },
    "the lower-half mini anchor grows from CSS row 2 to the full cell starting at row 1");
  assert.notDeepEqual(byId["mini-partner"], legacy[0], "the paired mini is repacked around the reserved anchor");
  assert.notDeepEqual(byId["large-blocker"], legacy[2], "the large blocker is repacked around the reserved anchor");
});

test("width growth at the right edge clamps the column and preserves the anchor row", () => {
  const cards = [
    { id: "right-edge", size: "medium" },
    { id: "large-a", size: "large" },
    { id: "small-a", size: "small" },
  ];
  const placements = calculateWidgetPlacements(cards.map(({ size }) => size), 4, [], {
    index: 0,
    column: 4,
    row: 5,
  });
  const byId = assertValidPacking(cards, placements, 4);

  assert.deepEqual(byId["right-edge"], { column: 3, columnSpan: 2, row: 5, rowSpan: 2 });
});

test("vertical and large growth keep their anchored rows", () => {
  for (const scenario of [
    { size: "medium-vertical", column: 4, row: 5, expected: { column: 4, columnSpan: 1, row: 5, rowSpan: 4 } },
    { size: "large", column: 3, row: 7, expected: { column: 3, columnSpan: 2, row: 7, rowSpan: 4 } },
  ]) {
    const cards = [
      { id: "anchor", size: scenario.size },
      { id: "large-a", size: "large" },
      { id: "small-a", size: "small" },
    ];
    const placements = calculateWidgetPlacements(cards.map(({ size }) => size), 4, [], {
      index: 0,
      column: scenario.column,
      row: scenario.row,
    });
    const byId = assertValidPacking(cards, placements, 4);

    assert.deepEqual(byId.anchor, scenario.expected, `${scenario.size} retains its anchored footprint`);
  }
});

test("shrinking to mini preserves its cell and pairs without collisions", () => {
  const cards = [
    { id: "shrunken", size: "mini" },
    { id: "partner", size: "mini" },
    { id: "large-a", size: "large" },
    { id: "small-a", size: "small" },
  ];
  const placements = calculateWidgetPlacements(cards.map(({ size }) => size), 4, [], {
    index: 0,
    column: 3,
    row: 5,
  });
  const byId = assertValidPacking(cards, placements, 4);

  assert.deepEqual(byId.shrunken, { column: 3, columnSpan: 1, row: 5, rowSpan: 1 });
  assert.deepEqual(byId.partner, { column: 3, columnSpan: 1, row: 6, rowSpan: 1 },
    "the next mini uses the lower half of the anchored cell");
});

test("a later-row anchor is not pulled upward by earlier widgets", () => {
  const cards = [
    { id: "small-a", size: "small" },
    { id: "medium-a", size: "medium" },
    { id: "anchor", size: "large" },
    { id: "mini-a", size: "mini" },
  ];
  const placements = calculateWidgetPlacements(cards.map(({ size }) => size), 4, [], {
    index: 2,
    column: 3,
    row: 9,
  });
  const byId = assertValidPacking(cards, placements, 4);

  assert.equal(byId.anchor.row, 9);
  assert.deepEqual(byId.anchor, { column: 3, columnSpan: 2, row: 9, rowSpan: 4 });
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
  const liveRender = (cards, layoutKey, resizePriorities, columns = 4) => h(Grid, {
    layoutKey,
    label: "Live widgets",
    animateLayout: false,
    resizePriorities,
    style: { "--widget-columns": String(columns), columnGap: "16px" },
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
    assert.equal(preview("mini-b").style.gridColumn, "3 / span 1");
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

    grid.style.setProperty("--widget-columns", "4");
    const responsiveCards = [
      { id: "priority-large", size: "large" },
      { id: "resize-target", size: "medium" },
      { id: "priority-small", size: "small" },
    ];
    const priorities = [
      { widgetId: "resize-target", columns: 4, column: 4, row: 5 },
      { widgetId: "resize-target", columns: 2, column: 2, row: 7 },
    ];
    await act(async () => root.render(liveRender(responsiveCards, "responsive-priority", priorities)));
    const resizeTarget = document.querySelector('[data-widget-id="resize-target"]');
    assert.equal(resizeTarget.style.gridColumn, "3 / span 2", "four-column layout uses its matching priority");
    assert.equal(resizeTarget.style.gridRow, "5 / span 2");

    grid.style.setProperty("--widget-columns", "2");
    window.dispatchEvent(new window.Event("resize"));
    flushFrames();
    assert.equal(resizeTarget.style.gridColumn, "1 / span 2", "two-column layout clamps its matching priority");
    assert.equal(resizeTarget.style.gridRow, "7 / span 2", "the four-column priority does not leak into two columns");
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
