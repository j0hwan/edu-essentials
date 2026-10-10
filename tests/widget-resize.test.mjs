import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { getWidgetKeyboardResizeSize, getWidgetPointerResizeGeometry, getWidgetPointerResizeSize, getWidgetResizeContentFilter, getWidgetResizeSize } = await import(await clientModule("lib/widget-resize.ts"));

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

test("pointer resize maps horizontal, vertical, and diagonal deltas to size changes", () => {
  const unit = 100;
  const gap = 10;
  const resize = (size, deltaX, deltaY) => getWidgetPointerResizeSize({
    ...dimensions(size, unit, gap),
    unit,
    gap,
    previousSize: size,
    hysteresisPx: 0,
    deltaX,
    deltaY,
  });

  assert.equal(resize("small", 120, 0), "medium");
  assert.equal(resize("medium", -120, 0), "small");
  assert.equal(resize("small", 0, 120), "medium-vertical");
  assert.equal(resize("medium-vertical", 0, -120), "small");
  assert.equal(resize("small", 120, 120), "large");
  assert.equal(resize("large", -120, -120), "small");
});

test("pointer resize maps physical deltas across a two-column grid unit", () => {
  const unit = 260;
  const gap = 16;
  assert.equal(getWidgetPointerResizeSize({
    ...dimensions("small", unit, gap),
    unit,
    gap,
    previousSize: "small",
    hysteresisPx: 0,
    deltaX: 276,
    deltaY: 0,
  }), "medium");
});

test("pointer resize uses physical cursor travel for snap thresholds", () => {
  for (const [originalSize, targetSize, direction] of [["small", "medium", 1], ["medium", "small", -1]]) {
    const input = {
      ...dimensions(originalSize, 100, 10),
      unit: 100,
      gap: 10,
      previousSize: originalSize,
      deltaY: 0,
    };
    assert.equal(getWidgetPointerResizeSize({ ...input, deltaX: direction * 60 }), originalSize);
    assert.equal(getWidgetPointerResizeSize({ ...input, deltaX: direction * 66 }), targetSize);
    assert.equal(getWidgetResizeSize({ ...input, width: input.width + direction * 66 }), targetSize);
  }
});

test("pointer resize keeps committed sizes stable through six-pixel movements", () => {
  const unit = 100;
  const gap = 10;
  const resize = (size, deltaX, deltaY) => getWidgetPointerResizeSize({
    ...dimensions(size, unit, gap),
    unit,
    gap,
    previousSize: size,
    deltaX,
    deltaY,
  });

  assert.equal(resize("medium", -6, 0), "medium");
  assert.equal(resize("medium-vertical", 0, -6), "medium-vertical");
  assert.equal(resize("large", -6, -6), "large");
});

test("pointer resize uses the original committed dimensions for each measurement", () => {
  const input = Object.freeze({
    ...dimensions("small", 100, 10),
    unit: 100,
    gap: 10,
    previousSize: "small",
    hysteresisPx: 0,
    deltaX: 120,
    deltaY: 0,
  });

  assert.equal(getWidgetPointerResizeSize(input), "medium");
  assert.equal(getWidgetPointerResizeSize({ ...input, deltaX: 0 }), "small");
  assert.deepEqual(input, {
    width: 100,
    height: 100,
    unit: 100,
    gap: 10,
    previousSize: "small",
    hysteresisPx: 0,
    deltaX: 120,
    deltaY: 0,
  });
});

test("continuous pointer geometry tracks growth, shrinkage, and diagonal movement one-for-one", () => {
  const input = {
    ...dimensions("small", 100, 10),
    width: 155,
    unit: 100,
    gap: 10,
    previousSize: "small",
  };

  assert.deepEqual(getWidgetPointerResizeGeometry({ ...input, deltaX: 4, deltaY: 0 }), {
    width: 159,
    height: 100,
    blurPx: 0.32,
  });
  assert.deepEqual(getWidgetPointerResizeGeometry({ ...input, deltaX: -4, deltaY: 0 }), {
    width: 151,
    height: 100,
    blurPx: 0.32,
  });
  assert.deepEqual(getWidgetPointerResizeGeometry({ ...input, deltaX: 4, deltaY: -2 }), {
    width: 159,
    height: 98,
    blurPx: Math.hypot(4, 2) / 100 * 8,
  });
});

test("each corner axis matches cursor travel in every direction within resize limits", () => {
  const input = { width: 155, height: 130, unit: 100, gap: 10, previousSize: "small" };
  for (const [deltaX, deltaY] of [[24, 0], [-24, 0], [0, 16], [0, -16], [24, 16], [-24, -16], [24, -16], [-24, 16]]) {
    const geometry = getWidgetPointerResizeGeometry({ ...input, deltaX, deltaY });
    assert.equal(geometry.width - input.width, deltaX);
    assert.equal(geometry.height - input.height, deltaY);
  }
});

test("continuous pointer geometry remains continuous at supported boundaries", () => {
  const input = {
    ...dimensions("small", 100, 10),
    unit: 100,
    gap: 10,
    previousSize: "small",
    deltaY: 0,
  };
  const boundaryDelta = 110;
  const before = getWidgetPointerResizeGeometry({ ...input, deltaX: boundaryDelta - 0.001 });
  const boundary = getWidgetPointerResizeGeometry({ ...input, deltaX: boundaryDelta });
  const after = getWidgetPointerResizeGeometry({ ...input, deltaX: boundaryDelta + 0.001 });

  assert.ok(Math.abs(boundary.width - 210) < 1e-10);
  assert.ok(before.width < boundary.width);
  assert.ok(after.width > boundary.width);
  assert.ok(after.width - boundary.width < 0.01);
});

test("continuous pointer geometry rubber-bands at all limits and stays finite", () => {
  const input = {
    ...dimensions("small", 100, 10),
    unit: 100,
    gap: 10,
    previousSize: "small",
  };
  const expanded = getWidgetPointerResizeGeometry({ ...input, deltaX: Number.MAX_VALUE, deltaY: Number.MAX_VALUE });
  const contracted = getWidgetPointerResizeGeometry({ ...input, deltaX: -Number.MAX_VALUE, deltaY: -Number.MAX_VALUE });

  assert.deepEqual(expanded, { width: 225, height: 225, blurPx: 8 });
  assert.equal(contracted.width, 85);
  assert.equal(contracted.height, 30);
  assert.ok(contracted.blurPx > 0 && contracted.blurPx <= 8);
  for (const geometry of [expanded, contracted]) {
    assert.ok(geometry.width >= 0);
    assert.ok(geometry.height >= 0);
    assert.ok([geometry.width, geometry.height, geometry.blurPx].every(Number.isFinite));
  }
});

test("continuous pointer geometry preserves captured spring baselines and follows new movement", () => {
  for (const baseline of [{ width: 100, height: 225 }, { width: 95, height: 40 }]) {
    const input = Object.freeze({ ...baseline, unit: 100, gap: 10, previousSize: "small" });
    assert.deepEqual(getWidgetPointerResizeGeometry({ ...input, deltaX: 0, deltaY: 0 }), {
      ...baseline,
      blurPx: 0,
    });

    for (const delta of [-0.0001, 0.0001]) {
      const geometry = getWidgetPointerResizeGeometry({ ...input, deltaX: delta, deltaY: delta });
      assert.ok(Math.abs(geometry.width - baseline.width - delta) < 1e-8);
      assert.ok(Math.abs(geometry.height - baseline.height - delta) < 1e-8);
    }

    const moved = getWidgetPointerResizeGeometry({ ...input, deltaX: 5, deltaY: 5 });
    assert.equal(moved.width, baseline.width + 5);
    assert.equal(moved.height, baseline.height === 225 ? 225 + 15 * -Math.expm1(-5 / 15) : baseline.height + 5);
    assert.ok(moved.blurPx > 0);
    assert.deepEqual(input, { ...baseline, unit: 100, gap: 10, previousSize: "small" });
  }
});

test("continuous pointer geometry bounds extreme movement around the captured range", () => {
  for (const baseline of [{ width: 100, height: 225 }, { width: 95, height: 40 }]) {
    const input = { ...baseline, unit: 100, gap: 10, previousSize: "small" };
    const expanded = getWidgetPointerResizeGeometry({ ...input, deltaX: Number.MAX_VALUE, deltaY: Number.MAX_VALUE });
    const contracted = getWidgetPointerResizeGeometry({ ...input, deltaX: -Number.MAX_VALUE, deltaY: -Number.MAX_VALUE });

    assert.equal(expanded.width, Math.max(210, baseline.width) + 15);
    assert.equal(expanded.height, Math.max(210, baseline.height) + 15);
    assert.equal(contracted.width, Math.min(100, baseline.width) - 15);
    assert.equal(contracted.height, Math.min(45, baseline.height) - 15);
    for (const geometry of [expanded, contracted]) {
      assert.ok([geometry.width, geometry.height, geometry.blurPx].every(Number.isFinite));
      assert.ok(geometry.width >= 0 && geometry.height >= 0);
      assert.ok(geometry.blurPx >= 0 && geometry.blurPx <= 8);
    }
  }
});

test("continuous pointer geometry returns original dimensions for invalid input", () => {
  const input = {
    ...dimensions("small", 100, 10),
    unit: 100,
    gap: 10,
    previousSize: "small",
    deltaX: 12,
    deltaY: 5,
  };
  const invalidInputs = [
    { deltaX: Number.NaN },
    { deltaY: Number.POSITIVE_INFINITY },
    { unit: 0 },
    { gap: 100 },
    { previousSize: "unknown" },
  ];

  for (const invalidInput of invalidInputs) {
    assert.deepEqual(getWidgetPointerResizeGeometry({ ...input, ...invalidInput }), {
      width: 100,
      height: 100,
      blurPx: 0,
    });
  }

  for (const invalidDimensions of [{ width: 0 }, { width: -1 }, { height: 0 }, { height: -1 }]) {
    const invalidInput = { ...input, ...invalidDimensions };
    assert.deepEqual(getWidgetPointerResizeGeometry(invalidInput), {
      width: invalidInput.width,
      height: invalidInput.height,
      blurPx: 0,
    });
  }
});

test("continuous pointer geometry increases and caps blur, then resets at origin", () => {
  const input = {
    ...dimensions("small", 100, 10),
    unit: 100,
    gap: 10,
    previousSize: "small",
    deltaY: 0,
  };
  const blurValues = [0, 1, 5, 20, 100].map((deltaX) => (
    getWidgetPointerResizeGeometry({ ...input, deltaX }).blurPx
  ));

  const expectedBlurValues = [0, 0.08, 0.4, 1.6, 8];
  for (let index = 0; index < blurValues.length; index += 1) {
    assert.ok(Math.abs(blurValues[index] - expectedBlurValues[index]) < 1e-9);
    if (index > 0) assert.ok(blurValues[index] > blurValues[index - 1]);
  }
  assert.deepEqual(getWidgetPointerResizeGeometry({ ...input, deltaX: 0 }), {
    width: 100,
    height: 100,
    blurPx: 0,
  });
});

test("resize content filter starts neutral and progressively diffuses color and light", () => {
  assert.equal(getWidgetResizeContentFilter(0), "blur(0px) saturate(1) brightness(1)");
  assert.equal(getWidgetResizeContentFilter(2), "blur(2px) saturate(1.06) brightness(1.025)");
  assert.equal(getWidgetResizeContentFilter(3.5), "blur(3.5px) saturate(1.105) brightness(1.04375)");
  assert.equal(getWidgetResizeContentFilter(4), "blur(4px) saturate(1.12) brightness(1.05)");
  assert.equal(getWidgetResizeContentFilter(8), "blur(8px) saturate(1.24) brightness(1.1)");
});

test("resize content filter clamps finite amounts and maps invalid values to neutral", () => {
  assert.equal(getWidgetResizeContentFilter(-2), "blur(0px) saturate(1) brightness(1)");
  assert.equal(getWidgetResizeContentFilter(12), "blur(8px) saturate(1.24) brightness(1.1)");
  for (const blurPx of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(getWidgetResizeContentFilter(blurPx), "blur(0px) saturate(1) brightness(1)");
  }
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
