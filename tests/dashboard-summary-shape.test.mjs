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
