import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const [{ reorderWidgetIds, getWidgetInsertionIndex }, { calculateWidgetPlacements }] = await Promise.all([
  import(await clientModule("lib/widget-reorder.ts")),
  import(await clientModule("lib/widget-layout.ts")),
]);

test("reorderWidgetIds moves one stable ID to a final slot without mutating its input", () => {
  const ids = ["notes", "timer", "calendar", "quote"];
  assert.deepEqual(reorderWidgetIds(ids, "notes", 3), ["timer", "calendar", "quote", "notes"]);
  assert.deepEqual(reorderWidgetIds(ids, "quote", 1), ["notes", "quote", "timer", "calendar"]);
  assert.deepEqual(reorderWidgetIds(ids, "timer", 1), ids);
  assert.deepEqual(reorderWidgetIds(ids, "missing", 1), ids);
  assert.deepEqual(ids, ["notes", "timer", "calendar", "quote"]);
});

function insertionInput({ ids, sizes, draggedId, columns, destinationIndex, previousIndex = null }) {
  const gridRect = { left: 120, top: 80, right: 1120, bottom: 1600 };
  const unit = 180;
  const gap = 16;
  const grabOffsetX = 27;
  const grabOffsetY = 19;
  const candidateOrder = reorderWidgetIds(ids, draggedId, destinationIndex);
  const placements = calculateWidgetPlacements(candidateOrder.map((id) => sizes[id]), columns);
  const placement = placements[candidateOrder.indexOf(draggedId)];
  const rowUnit = (unit - gap) / 2;
  return {
    ids, sizes, draggedId, columns, gridRect, unit, gap,
    pointerX: gridRect.left + (placement.column - 1) * (unit + gap) + grabOffsetX,
    pointerY: gridRect.top + (placement.row - 1) * (rowUnit + gap) + grabOffsetY,
    grabOffsetX, grabOffsetY, previousIndex,
  };
}

test("insertion projection follows packed mixed-size and mini-pair positions on two- and four-column boards", () => {
  const ids = ["notes", "mini-a", "wide", "mini-b", "vertical", "small"];
  const sizes = { notes: "large", "mini-a": "mini", wide: "medium", "mini-b": "mini", vertical: "medium-vertical", small: "small" };

  for (const columns of [2, 4]) {
    for (const destinationIndex of [0, 2, ids.length - 1]) {
      const input = insertionInput({ ids, sizes, draggedId: "wide", columns, destinationIndex });
      const actualIndex = getWidgetInsertionIndex(input);
      const placementAt = (index) => {
        const order = reorderWidgetIds(ids, "wide", index);
        return calculateWidgetPlacements(order.map((id) => sizes[id]), columns)[order.indexOf("wide")];
      };
      assert.deepEqual(placementAt(actualIndex), placementAt(destinationIndex), `${columns} columns, destination ${destinationIndex}`);
    }
  }
});

test("a dragged medium card can reach the logical end after two packed small cards", () => {
  const ids = ["medium", "small-a", "small-b"];
  const sizes = { medium: "medium", "small-a": "small", "small-b": "small" };

  for (const columns of [2, 4]) {
    const input = insertionInput({ ids, sizes, draggedId: "medium", columns, destinationIndex: 2 });
    assert.equal(getWidgetInsertionIndex(input), 2, `${columns} columns preserves the requested final logical slot`);
    assert.deepEqual(reorderWidgetIds(ids, "medium", getWidgetInsertionIndex(input)), ["small-a", "small-b", "medium"]);
  }
});

test("a medium card in the middle advances past an ambiguous packed slot when landing below two small cards", () => {
  const ids = ["small-a", "medium", "small-b"];
  const sizes = { "small-a": "small", medium: "medium", "small-b": "small" };
  const input = insertionInput({ ids, sizes, draggedId: "medium", columns: 2, destinationIndex: 2, previousIndex: 1 });
  assert.equal(getWidgetInsertionIndex(input), 2);
});

test("insertion hysteresis holds a stable slot near a boundary, then follows clear pointer movement", () => {
  const ids = ["a", "drag", "c", "d"];
  const sizes = Object.fromEntries(ids.map((id) => [id, "small"]));
  const base = {
    ids, sizes, draggedId: "drag", columns: 4,
    gridRect: { left: 0, top: 0, right: 600, bottom: 600 }, unit: 100, gap: 10,
    pointerY: 20, grabOffsetX: 0, grabOffsetY: 0, previousIndex: 2, hysteresisPx: 14,
  };

  assert.equal(getWidgetInsertionIndex({ ...base, pointerX: 280 }), 2, "a nearby boundary does not oscillate the projected slot");
  assert.equal(getWidgetInsertionIndex({ ...base, pointerX: 280 }), 2, "a stationary pointer keeps the same projected slot");
  assert.equal(getWidgetInsertionIndex({ ...base, pointerX: 300 }), 3, "clear movement past the boundary changes the slot");
  assert.equal(getWidgetInsertionIndex({ ...base, pointerX: 610 }), null, "the board rejects an off-board pointer");
});
