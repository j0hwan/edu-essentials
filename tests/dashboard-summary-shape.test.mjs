import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { dashboardSummaryShape } = await import(await clientModule("lib/dashboard-summary-shape.ts"));
const dimensions = { width: 1000, height: 300, split: 600, baseHeight: 300, radius: 24 };

test("collapsed summary keeps a single rounded rectangle", () => {
  const path = dashboardSummaryShape(dimensions);
  assert.match(path, /V 275.5 Q 999.5 299.5 975.5 299.5/);
  assert.doesNotMatch(path, /Q 600 /);
});

test("only the chat side extends while the priority bottom stays fixed through the spring", () => {
  for (const height of [320, 440, 580, 590, 580]) {
    const path = dashboardSummaryShape({ ...dimensions, height });
    assert.match(path, /V 275.5 Q 999.5 299.5 975.5 299.5/);
    assert.match(path, /Q 600 299.5 600 /);
    assert.ok(path.includes(`${height - 0.5}`));
    assert.ok(!path.includes("NaN"));
  }
});

test("stacked layout returns to a full-width rounded rectangle", () => {
  const path = dashboardSummaryShape({ ...dimensions, width: 390, height: 760, split: 390 });
  assert.match(path, /V 735.5 Q 389.5 759.5 365.5 759.5/);
  assert.doesNotMatch(path, /Q 600 /);
});

test("empty geometry is ignored and small expansion corners stay within their available height", () => {
  assert.equal(dashboardSummaryShape({ ...dimensions, width: 0 }), "");
  const path = dashboardSummaryShape({ ...dimensions, height: 302 });
  assert.match(path, /Q 600 299.5 600 300.5 V 300.5 Q 600 301.5 599 301.5/);
});

test("optional tab is one integrated contour below the chat column", () => {
  for (const [width, height, split, baseHeight, center] of [
    [1000, 300, 600, 300, 300],
    [1000, 440, 600, 300, 300],
    [390, 760, 390, 760, 195],
  ]) {
    const path = dashboardSummaryShape({ width, height, split, baseHeight, radius: 24,
      tab: { center, width: 120, height: 36, radius: 12 } });
    assert.equal((path.match(/\bM\b/g) ?? []).length, 1);
    assert.equal((path.match(/\bZ\b/g) ?? []).length, 1);
    assert.match(path, new RegExp(`Q ${center + 60} ${height - 0.5} ${center + 60} ${height + 17.5} V ${height + 23.5} Q ${center + 60} ${height + 35.5} ${center + 48} ${height + 35.5}`));
    assert.ok(path.includes(` ${height + 35.5}`));
    assert.doesNotMatch(path, /NaN|Infinity/);
  }
});

test("shallow tab caps its corner radius to half its depth within its total mouth width", () => {
  for (const parentRadius of [24, 20]) {
    const height = 300;
    const tabRadius = 8;
    const run = 8;
    const path = dashboardSummaryShape({ width: 1000, height, split: 600, baseHeight: height,
      radius: parentRadius, tab: { center: 300, width: 120, height: 16, radius: parentRadius } });
    const middle = height - 0.5 + 8;
    const tabBottom = height - 0.5 + 16;
    assert.ok(path.includes(`H 360 A ${tabRadius} ${tabRadius} 0 0 0 ${360 - run} ${middle} A ${tabRadius} ${tabRadius} 0 0 1 ${360 - 2 * run} ${tabBottom} H ${240 + 2 * run} A ${tabRadius} ${tabRadius} 0 0 1 ${240 + run} ${middle} A ${tabRadius} ${tabRadius} 0 0 0 240 ${height - 0.5}`));
    assert.equal((path.match(/\bM\b/g) ?? []).length, 1);
    assert.equal((path.match(/\bZ\b/g) ?? []).length, 1);
    assert.ok(path.includes(` ${tabBottom}`));
    assert.doesNotMatch(path, /NaN|Infinity/);
  }
});

test("tab clamps away from the left corner and L bend and remains safe in narrow bounds", () => {
  const path = dashboardSummaryShape({ ...dimensions, tab: { center: -100, width: 300, height: 40, radius: 30 } });
  assert.match(path, /H 324\.5 A 20 20 0 0 0 /);
  assert.doesNotMatch(path, /Q 600 /);

  const narrow = dashboardSummaryShape({ width: 100, height: 120, split: 55, baseHeight: 80, radius: 24,
    tab: { center: 50, width: 200, height: 30, radius: 40 } });
  assert.ok(narrow.includes("Z"));
  assert.doesNotMatch(narrow, /NaN|Infinity/);

  const tooNarrowForArcs = { width: 100, height: 120, split: 55, baseHeight: 80, radius: 24 };
  assert.equal(dashboardSummaryShape({ ...tooNarrowForArcs,
    tab: { center: 50, width: 120, height: 16, radius: 24 } }), dashboardSummaryShape(tooNarrowForArcs));

  const tinyBounds = { width: 40, height: 80, split: 40, baseHeight: 80, radius: 20 };
  const tinyWithTab = dashboardSummaryShape({ ...tinyBounds, tab: { center: 20, width: 20, height: 30, radius: 12 } });
  assert.equal(tinyWithTab, dashboardSummaryShape(tinyBounds));
});

test("omitting tab preserves the existing path exactly", () => {
  assert.equal(dashboardSummaryShape(dimensions),
    "M 24.5 0.5 H 975.5 Q 999.5 0.5 999.5 24.5 V 275.5 Q 999.5 299.5 975.5 299.5 H 24.5 Q 0.5 299.5 0.5 275.5 V 24.5 Q 0.5 0.5 24.5 0.5 Z");
});
