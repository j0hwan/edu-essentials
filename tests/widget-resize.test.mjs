import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { getWidgetKeyboardResizeSize, getWidgetResizeSize } = await import(await clientModule("lib/widget-resize.ts"));

function dimensions(size, unit, gap) {
  const footprints = {
    small: { width: 1, height: 1 },
    medium: { width: 2, height: 1 },
    large: { width: 2, height: 2 },
    mini: { width: 1, height: 0.5 },
    "medium-vertical": { width: 1, height: 2 },
  };
  const footprint = footprints[size];
  return {
    width: footprint.width * unit + (footprint.width - 1) * gap,
    height: footprint.height * unit + (footprint.height - 1) * gap,
  };
}

test("pointer geometry recognizes each supported size for growth, shrinkage, and diagonal changes", () => {
  const unit = 100;
  const gap = 10;
  const previousSizes = {
    small: "mini",
    medium: "small",
    large: "medium",
    mini: "small",
    "medium-vertical": "large",
  };

  for (const [size, previousSize] of Object.entries(previousSizes)) {
    assert.equal(getWidgetResizeSize({ ...dimensions(size, unit, gap), unit, gap, previousSize, hysteresisPx: 0 }), size);
  }
  assert.equal(getWidgetResizeSize({ ...dimensions("large", unit, gap), unit, gap, previousSize: "small", hysteresisPx: 0 }), "large");
  assert.equal(getWidgetResizeSize({ ...dimensions("medium-vertical", unit, gap), unit, gap, previousSize: "large", hysteresisPx: 0 }), "medium-vertical");
});

test("physical geometry matches two- and four-column board units", () => {
  const cases = [
    { unit: 260, gap: 16, columns: 2, boardWidth: 536 },
    { unit: 260, gap: 16, columns: 4, boardWidth: 1088 },
    { unit: 134, gap: 32, columns: 2, boardWidth: 300 },
  ];

  for (const { unit, gap, columns, boardWidth } of cases) {
    assert.equal(boardWidth, unit * columns + gap * (columns - 1));
    for (const size of ["small", "medium", "large", "mini", "medium-vertical"]) {
      assert.equal(getWidgetResizeSize({ ...dimensions(size, unit, gap), unit, gap, previousSize: "small", hysteresisPx: 0 }), size);
    }
  }
});

test("hysteresis retains the prior size through nearby boundaries and resolves ties", () => {
  const input = { width: 160, height: 100, unit: 100, gap: 10 };
  assert.equal(getWidgetResizeSize({ ...input, previousSize: "small" }), "small");
  assert.equal(getWidgetResizeSize({ ...input, previousSize: "medium" }), "medium");
  assert.equal(getWidgetResizeSize({ ...input, width: 165, previousSize: "small" }), "medium");
  assert.equal(getWidgetResizeSize({ ...input, width: 155, previousSize: "mini", hysteresisPx: 0 }), "small");
});

test("requested dimensions clamp at zero and invalid measurements preserve the prior size", () => {
  const zero = getWidgetResizeSize({ width: 0, height: 0, unit: 100, gap: 10, previousSize: "large", hysteresisPx: 0 });
  assert.equal(getWidgetResizeSize({ width: -300, height: -20, unit: 100, gap: 10, previousSize: "large", hysteresisPx: 0 }), zero);

  const invalidInputs = [
    { width: 0, height: 0, unit: 0, gap: 0 },
    { width: 0, height: 0, unit: -1, gap: 0 },
    { width: 0, height: 0, unit: 100, gap: -1 },
    { width: 0, height: 0, unit: 100, gap: 100 },
    { width: Number.NaN, height: 0, unit: 100, gap: 10 },
    { width: 0, height: Number.POSITIVE_INFINITY, unit: 100, gap: 10 },
    { width: 0, height: 0, unit: Number.NaN, gap: 10 },
    { width: 0, height: 0, unit: 100, gap: Number.POSITIVE_INFINITY },
    { width: 0, height: 0, unit: 100, gap: 10, hysteresisPx: Number.NaN },
  ];

  for (const input of invalidInputs) {
    assert.equal(getWidgetResizeSize({ ...input, previousSize: "medium-vertical" }), "medium-vertical");
  }
});

test("resizing reads frozen inputs without mutating them", () => {
  const input = Object.freeze({ width: 210, height: 100, unit: 100, gap: 10, previousSize: "small", hysteresisPx: 0 });
  assert.equal(getWidgetResizeSize(input), "medium");
  assert.deepEqual(input, { width: 210, height: 100, unit: 100, gap: 10, previousSize: "small", hysteresisPx: 0 });
});

test("keyboard resize steps across available widths and heights", () => {
  const cases = [
    ["small", "ArrowRight", "medium"],
    ["medium-vertical", "ArrowRight", "large"],
    ["large", "ArrowLeft", "medium-vertical"],
    ["medium-vertical", "ArrowUp", "small"],
    ["large", "ArrowUp", "medium"],
    ["medium", "ArrowLeft", "small"],
    ["medium", "ArrowDown", "large"],
    ["small", "ArrowDown", "medium-vertical"],
    ["mini", "ArrowDown", "small"],
    ["small", "ArrowUp", "mini"],
  ];

  for (const [size, key, expected] of cases) {
    assert.equal(getWidgetKeyboardResizeSize(size, key), expected, `${size} ${key}`);
  }
});

test("keyboard resize stays at directional boundaries and ignores other keys", () => {
  const cases = [
    ["small", "ArrowLeft"],
    ["medium", "ArrowRight"],
    ["large", "ArrowDown"],
    ["mini", "ArrowUp"],
    ["large", "Enter"],
  ];

  for (const [size, key] of cases) {
    assert.equal(getWidgetKeyboardResizeSize(size, key), size, `${size} ${key}`);
  }
});
