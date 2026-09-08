import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
const { academicSnapshot } = await import(await clientModule("lib/academic-snapshot.ts"));
const { dayKey, weekStart, addDays, isDate, assignmentStatus, suggestSyllabusItems, validateCourseDetails } = await import(await clientModule("lib/academics.ts"));
const base = { v: 2, a: "day", w: [["day", "Day", []]], d: { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month" } };
const course = { id: "c", code: "BIO 1", name: "Biology", credits: 3, instructor: "", room: "", color: "#112233", soft: "#11223318", initials: "BI" };
const assignment = { id: "a", courseId: "c", title: "Essay", dateKey: "2026-10-15", due: "", status: "later", progress: 25, description: "", weight: "" };
test("calendar dates honor time zones, week start, leap days and month/year boundaries", () => {
  const now = new Date("2026-09-06T00:30:00Z");
  assert.equal(dayKey(now, "America/Los_Angeles"), "2026-09-05"); assert.equal(dayKey(now, "Asia/Tokyo"), "2026-09-06");
  assert.equal(weekStart("2026-09-06", true), "2026-08-31"); assert.equal(weekStart("2026-09-06", false), "2026-09-06");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01"); assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(isDate("2028-02-29"), true); for (const date of ["2026-02-29", "2026-04-31", "2026-99-99", "", "12/04/2026"]) assert.equal(isDate(date), false);
  assert.equal(assignmentStatus(assignment, "2026-10-16"), "overdue"); assert.equal(assignmentStatus(assignment, "2026-10-15"), "today"); assert.equal(assignmentStatus({ ...assignment, status: "done" }, "2026-10-16"), "done");
});
test("syllabus suggestions use actual ISO dates and preserve exam/project types", () => {
  let i = 0; const text = "Essay — 2026-10-15\nExam — 2026-11-02\nProject 2026-12-03\nBad date 2026-02-29\nMeeting in November";
  const rows = suggestSyllabusItems(text, () => String(++i));
  assert.deepEqual(rows.map((r) => [r.title, r.date, r.type]), [["Essay", "2026-10-15", "Assignment"], ["Exam", "2026-11-02", "Exam"], ["Project", "2026-12-03", "Project"]]);
  assert.deepEqual(suggestSyllabusItems("No dated work provided", () => "unused"), []);
});
test("academic snapshots reject malformed dates, ownership references and invalid completion state", () => {
  const make = (patch = {}) => ({ ...base, d: { ...base.d, assignments: [{ ...assignment, ...patch }] } });
  assert.doesNotThrow(() => academicSnapshot([course], make({ type: "Exam", dueTime: "23:59" })));
  for (const patch of [{ dateKey: "2026-02-30" }, { dueTime: "24:01" }, { dueTime: null }, { courseId: "foreign" }, { type: "Forged" }, { status: "done", progress: 20 }, { completedAt: "yesterday" }]) assert.throws(() => academicSnapshot([course], make(patch)));
  assert.throws(() => academicSnapshot([course, course], base), /Duplicate class/);
  assert.throws(() => academicSnapshot([], { ...base, d: { ...base.d, courseDetails: { c: { officeHours: "", meetings: [] } } } }), /Class details/);
  assert.doesNotThrow(() => academicSnapshot([], { ...base, d: { ...base.d, calendarFilter: "personal", manualEvents: [{ id: "e", title: "Appointment", courseId: "", dateKey: "2026-10-15", time: "", type: "Personal" }] } }));
});
test("meeting schedules reject backwards times, invalid days, ranges and duplicate IDs", () => {
  const meeting = { id: "m", days: [1, 3], start: "09:00", end: "10:00", from: "2026-09-01", until: "2026-12-15", location: "Room" };
  assert.doesNotThrow(() => validateCourseDetails({ officeHours: "Friday", meetings: [meeting] }));
  for (const patch of [{ days: [] }, { days: [1, 1] }, { days: [7] }, { end: "08:00" }, { start: "noon" }, { until: "2026-08-01" }]) assert.throws(() => validateCourseDetails({ officeHours: "", meetings: [{ ...meeting, ...patch }] }));
  assert.throws(() => validateCourseDetails({ officeHours: "", meetings: [meeting, meeting] }), /Duplicate/);
});
