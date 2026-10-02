import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
const { calendarDays, calendarTime, timeMinutes, placeCalendarItems } = await import(await clientModule("lib/calendar-layout.ts"));

test("calendar uses complete month rows, leap days, configured week start and cross-year weeks", () => {
  const september = calendarDays("2026-09-17", "month", false);
  assert.equal(september.length, 35);
  assert.equal(september[0], "2026-08-30");
  assert.equal(september.at(-1), "2026-10-03");
  assert.equal(calendarDays("2026-08-15", "month", false).length, 42);
  assert.ok(calendarDays("2028-02-10", "month", true).includes("2028-02-29"));
  assert.deepEqual(calendarDays("2026-01-01", "week", true), ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.deepEqual(calendarDays("2026-09-17", "day", false), ["2026-09-17"]);
});
test("calendar time formatting handles midnight, noon and partial hours", () => {
  assert.equal(calendarTime(""), "All day");
  assert.equal(calendarTime("00:00"), "12:00 AM");
  assert.equal(calendarTime("12:00"), "12:00 PM");
  assert.equal(calendarTime("23:59"), "11:59 PM");
  assert.equal(timeMinutes("09:30"), 570);
});
test("overlapping blocks get independent lanes without moving their start times", () => {
  const items = [{ id: "a", start: 600, end: 690 }, { id: "b", start: 630, end: 720 }, { id: "c", start: 690, end: 750 }, { id: "d", start: 780, end: 840 }];
  const layout = placeCalendarItems(items);
  assert.deepEqual(layout.map(({ id, lane, lanes }) => [id, lane, lanes]), [["a", 0, 2], ["b", 1, 2], ["c", 0, 2], ["d", 0, 1]]);
  assert.equal(layout[1].start, 630);
  assert.ok(items.every((item) => !("lane" in item)));
  assert.deepEqual(placeCalendarItems([]), []);
});
