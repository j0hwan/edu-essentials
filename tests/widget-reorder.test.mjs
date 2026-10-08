import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const [{ reorderWidgetIds, getWidgetInsertionCandidate, getWidgetInsertionIndex }, { calculateWidgetPlacements }] = await Promise.all([
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

function insertionInput({ ids, sizes, draggedId, columns, destinationIndex, previousIndex = null, miniStarts = {}, previousStartsNewMiniBlock }) {
  const gridRect = { left: 120, top: 80, right: 1120, bottom: 1600 };
  const unit = 180;
  const gap = 16;
  const grabOffsetX = 27;
  const grabOffsetY = 19;
  const candidateOrder = reorderWidgetIds(ids, draggedId, destinationIndex);
  const starts = candidateOrder.map((id) => miniStarts[id] ?? false);
  const placements = calculateWidgetPlacements(candidateOrder.map((id) => sizes[id]), columns, starts);
  const placement = placements[candidateOrder.indexOf(draggedId)];
  const rowUnit = (unit - gap) / 2;
  return {
    ids, sizes, draggedId, columns, gridRect, unit, gap,
    pointerX: gridRect.left + (placement.column - 1) * (unit + gap) + grabOffsetX,
    pointerY: gridRect.top + (placement.row - 1) * (rowUnit + gap) + grabOffsetY,
    grabOffsetX, grabOffsetY, previousIndex, miniStarts, previousStartsNewMiniBlock,
  };
}

function physicalPlacementInput({ ids, sizes, draggedId, columns, targetColumn, targetRow, previousIndex = null, miniStarts = {}, previousStartsNewMiniBlock }) {
  const gridRect = { left: 120, top: 80, right: 1120, bottom: 1600 };
  const unit = 180;
  const gap = 16;
  const grabOffsetX = 27;
  const grabOffsetY = 19;
  const rowUnit = (unit - gap) / 2;
  return {
    ids, sizes, draggedId, columns, gridRect, unit, gap,
    pointerX: gridRect.left + (targetColumn - 1) * (unit + gap) + grabOffsetX,
    pointerY: gridRect.top + (targetRow - 1) * (rowUnit + gap) + grabOffsetY,
    grabOffsetX, grabOffsetY, previousIndex, miniStarts, previousStartsNewMiniBlock,
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

test("a mini can move before and after a full card at a fixed physical slot", () => {
  const sizes = { glance: "mini", alerts: "small", pomodoro: "small", weekly: "mini", daily: "mini" };
  const original = ["glance", "alerts", "pomodoro", "weekly", "daily"];
  const earlier = physicalPlacementInput({
    ids: original, sizes, draggedId: "daily", columns: 4, targetColumn: 3, targetRow: 1,
  });
  const earlierCandidate = getWidgetInsertionCandidate(earlier);
  assert.deepEqual(earlierCandidate, { index: 2, startsNewMiniBlock: true }, "the pointer over Pomodoro's cell places Daily in a fresh cell before it");
  assert.deepEqual(reorderWidgetIds(original, "daily", earlierCandidate.index), ["glance", "alerts", "daily", "pomodoro", "weekly"]);

  const laterOrder = ["glance", "alerts", "daily", "pomodoro", "weekly"];
  const later = physicalPlacementInput({
    ids: laterOrder, sizes, draggedId: "daily", columns: 4, targetColumn: 4, targetRow: 1,
    miniStarts: { daily: true }, previousIndex: earlierCandidate.index,
  });
  const laterCandidate = getWidgetInsertionCandidate(later);
  assert.deepEqual(laterCandidate, { index: 3, startsNewMiniBlock: true }, "the pointer in the next fresh cell places Daily after Pomodoro");
  assert.deepEqual(reorderWidgetIds(laterOrder, "daily", laterCandidate.index), ["glance", "alerts", "pomodoro", "daily", "weekly"]);
});

test("a mini can choose a fresh cell before a full card, then rejoin an earlier mini", () => {
  const ids = ["mini-a", "small-b", "mini-c"];
  const sizes = { "mini-a": "mini", "small-b": "small", "mini-c": "mini" };

  for (const columns of [2, 4]) {
    const freshInput = physicalPlacementInput({
      ids, sizes, draggedId: "mini-c", columns, targetColumn: 2, targetRow: 1,
    });
    const freshCandidate = getWidgetInsertionCandidate(freshInput);
    assert.deepEqual(freshCandidate, { index: 1, startsNewMiniBlock: true }, `${columns} columns puts the mini in a fresh cell before the small card`);

    const separatedOrder = reorderWidgetIds(ids, "mini-c", freshCandidate.index);
    const separatedStarts = { "mini-c": freshCandidate.startsNewMiniBlock };
    const separated = calculateWidgetPlacements(
      separatedOrder.map((id) => sizes[id]),
      columns,
      separatedOrder.map((id) => separatedStarts[id] ?? false),
    );
    assert.deepEqual(separated[1], { column: 2, columnSpan: 1, row: 1, rowSpan: 1 });

    const joinInput = physicalPlacementInput({
      ids: separatedOrder, sizes, draggedId: "mini-c", columns, targetColumn: 1, targetRow: 2,
      miniStarts: separatedStarts, previousIndex: freshCandidate.index,
    });
    const joinedCandidate = getWidgetInsertionCandidate(joinInput);
    assert.equal(joinedCandidate.startsNewMiniBlock, false, `${columns} columns lets the mini join the earlier mini`);

    const joinedOrder = reorderWidgetIds(separatedOrder, "mini-c", joinedCandidate.index);
    const joined = calculateWidgetPlacements(
      joinedOrder.map((id) => sizes[id]),
      columns,
      joinedOrder.map((id) => id === "mini-c" ? joinedCandidate.startsNewMiniBlock : false),
    );
    assert.deepEqual([joined[0], joined[joinedOrder.indexOf("mini-c")]], [
      { column: 1, columnSpan: 1, row: 1, rowSpan: 1 },
      { column: 1, columnSpan: 1, row: 2, rowSpan: 1 },
    ]);
  }
});

test("insertion projection preserves other mini flags, leaves inputs untouched, and rejects off-board points", () => {
  const ids = ["mini-a", "small-b", "mini-c", "drag"];
  const sizes = { "mini-a": "mini", "small-b": "small", "mini-c": "mini", drag: "small" };
  const miniStarts = { "mini-c": true };
  const idsBefore = [...ids];
  const sizesBefore = { ...sizes };
  const miniStartsBefore = { ...miniStarts };
  const input = physicalPlacementInput({
    ids, sizes, draggedId: "drag", columns: 4, targetColumn: 4, targetRow: 1, miniStarts,
  });

  assert.deepEqual(getWidgetInsertionCandidate(input), { index: 3, startsNewMiniBlock: false });
  assert.equal(getWidgetInsertionIndex(input), 3, "the index wrapper preserves its legacy result");
  assert.deepEqual(ids, idsBefore);
  assert.deepEqual(sizes, sizesBefore);
  assert.deepEqual(miniStarts, miniStartsBefore);
  assert.equal(getWidgetInsertionCandidate({ ...input, pointerX: input.gridRect.right + 1 }), null);
  assert.equal(getWidgetInsertionIndex({ ...input, pointerY: input.gridRect.bottom + 1 }), null);
});

test("mini start mode stays stable for the same index and defaults to false when unnecessary", () => {
  const ids = ["drag", "small"];
  const sizes = { drag: "mini", small: "small" };
  const base = physicalPlacementInput({
    ids, sizes, draggedId: "drag", columns: 2, targetColumn: 1, targetRow: 1, previousIndex: 0,
  });

  assert.deepEqual(getWidgetInsertionCandidate(base), { index: 0, startsNewMiniBlock: false },
    "equivalent fresh and automatic placements prefer automatic pairing");
  assert.deepEqual(getWidgetInsertionCandidate({ ...base, previousStartsNewMiniBlock: true }),
    { index: 0, startsNewMiniBlock: true }, "hysteresis keeps the prior mini mode at the same index");
  assert.deepEqual(getWidgetInsertionCandidate({ ...base, miniStarts: { drag: true } }),
    { index: 0, startsNewMiniBlock: true }, "the prior mini mode defaults to the current dragged flag");
});

test("reordering a mini splits and rejoins its adjacent mini pair", () => {
  const ids = ["first", "second", "full"];
  const sizes = { first: "mini", second: "mini", full: "small" };
  const splitOrder = reorderWidgetIds(ids, "second", 2);
  assert.deepEqual(splitOrder, ["first", "full", "second"]);
  const joinedOrder = reorderWidgetIds(splitOrder, "second", 1);
  assert.deepEqual(joinedOrder, ids);
  const splitStarts = { second: true };
  const joinedStarts = { second: false };

  for (const columns of [2, 4]) {
    const paired = calculateWidgetPlacements(ids.map((id) => sizes[id]), columns);
    assert.deepEqual(paired.slice(0, 2), [
      { column: 1, columnSpan: 1, row: 1, rowSpan: 1 },
      { column: 1, columnSpan: 1, row: 2, rowSpan: 1 },
    ], `${columns} columns initially pairs the adjacent minis`);

    const split = calculateWidgetPlacements(splitOrder.map((id) => sizes[id]), columns, splitOrder.map((id) => splitStarts[id] ?? false));
    assert.notDeepEqual(split[2], split[0], `${columns} columns separates the moved mini from its former pair`);
    const joined = calculateWidgetPlacements(joinedOrder.map((id) => sizes[id]), columns, joinedOrder.map((id) => joinedStarts[id] ?? false));
    assert.deepEqual(joined.slice(0, 2), paired.slice(0, 2), `${columns} columns rejoins the mini pair`);
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
