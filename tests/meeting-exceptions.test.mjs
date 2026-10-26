import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
import { syntheticContext } from "./fixtures/ai-context.mjs";

const { addDays, meetingOccursOn, validateCourseDetails } = await import(await clientModule("lib/academics.ts"));
const { academicTool, buildProposal } = await import(await clientModule("lib/ai/academic-tools.ts"));

const meeting = { id: "m", days: [1, 3, 5], start: "10:00", end: "11:00", from: "2026-09-01", until: "2026-12-15", location: "Room", excludedDates: ["2026-09-18"] };

test("meeting occurrence respects weekday, range, and excluded dates", () => {
  assert.equal(meetingOccursOn(meeting, "2026-09-18"), false);
  assert.equal(meetingOccursOn(meeting, "2026-09-25"), true);
  assert.equal(meetingOccursOn(meeting, "2026-09-20"), false);
  assert.equal(meetingOccursOn(meeting, "2026-12-16"), false);
  assert.equal(meetingOccursOn(meeting, "2026-02-30"), false);
});

test("meeting exclusions allow up to 100 valid unique in-range dates", () => {
  const dates = Array.from({ length: 100 }, (_, index) => addDays("2026-01-01", index));
  const details = { officeHours: "", meetings: [{ ...meeting, from: "2026-01-01", until: "2026-12-31", excludedDates: dates }] };
  assert.doesNotThrow(() => validateCourseDetails(details));
  assert.doesNotThrow(() => validateCourseDetails({ officeHours: "", meetings: [{ ...meeting, excludedDates: undefined }] }));
});

test("meeting exclusions reject malformed, duplicate, out-of-range, and over-limit dates", () => {
  const makeDetails = (excludedDates) => ({ officeHours: "", meetings: [{ ...meeting, excludedDates }] });
  for (const excludedDates of [
    "2026-09-18",
    ["2026-02-30"],
    ["2026-09-18", "2026-09-18"],
    ["2026-08-31"],
    ["2026-12-16"],
    Array.from({ length: 101 }, (_, index) => addDays("2026-01-01", index)),
  ]) assert.throws(() => validateCourseDetails(makeDetails(excludedDates)));
});

test("AI calendar generation omits excluded meetings and conflict warnings honor exclusions", () => {
  const context = syntheticContext();
  context.dashboard.d.courseDetails.calc.meetings[0].excludedDates = ["2026-09-18"];

  const today = academicTool(context, "get_todays_schedule", {}, new Map());
  assert.equal(today.total, 0);

  const calendar = academicTool(context, "get_calendar", { from: "2026-09-18", through: "2026-09-25" }, new Map());
  const meetingDates = calendar.items.map((item) => item.data).filter((item) => item.dateKey && item.time === "10:00").map((item) => item.dateKey);
  assert.ok(!meetingDates.includes("2026-09-18"));
  assert.ok(meetingDates.includes("2026-09-25"));

  const event = (dateKey) => ({ kind: "create_calendar_event", title: "Practice", courseId: "calc", dateKey, time: "10:30", durationMinutes: 30, type: "Study block" });
  const excludedDate = buildProposal(context, [event("2026-09-18")]);
  assert.ok(!excludedDate.warnings.some((warning) => warning.includes("class meeting")));
  const regularDate = buildProposal(context, [event("2026-09-25")]);
  assert.ok(regularDate.warnings.some((warning) => warning.includes("class meeting")));
});
