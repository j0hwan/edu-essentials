import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
const { emptyStudy, timerAction, timerElapsed, settleTimer, segmentSeconds, studyStats, gradeAverage, validateStudy, detachStudyCourse, completedInWeek } = await import(await clientModule("lib/study.ts"));
const { academicSnapshot } = await import(await clientModule("lib/academic-snapshot.ts"));
const start = Date.parse("2026-09-07T10:00:00.000Z");
const iso = (minutes) => new Date(start + minutes * 60000).toISOString();
const course = { id: "c", code: "BIO", name: "Biology", credits: 3, instructor: "", room: "", color: "#112233", soft: "#11223318", initials: "BI" };
const layout = (study) => ({ v: 2, a: "day", w: [["day", "Day", []]], d: { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month", study } });
test("timers resume from timestamps, exclude pauses and complete exactly once after a closed page", () => {
  let data = timerAction(emptyStudy(), "start", "pomodoro", start, "timer-a");
  assert.equal(timerElapsed(data.active, start + 5 * 60000), 300);
  data = timerAction(data, "pause", "pomodoro", start + 5 * 60000, "unused");
  assert.equal(timerElapsed(data.active, start + 60 * 60000), 300);
  data = JSON.parse(JSON.stringify(data));
  data = timerAction(data, "resume", "pomodoro", start + 60 * 60000, "unused");
  const completed = settleTimer(data, start + 500 * 60000);
  assert.equal(completed.active, null); assert.equal(completed.sessions.length, 1); assert.equal(completed.sessions[0].id, "timer-a");
  assert.deepEqual(completed.sessions[0].segments, [{ start: iso(0), end: iso(5) }, { start: iso(60), end: iso(80) }]);
  assert.equal(segmentSeconds(completed.sessions[0].segments), 1500);
  assert.equal(settleTimer(completed, start + 600 * 60000), completed);
  assert.doesNotThrow(() => validateStudy(completed));
});
test("focus timer, early finish, reset and exclusive active timer preserve correct history", () => {
  let data = timerAction(emptyStudy(), "start", "focus", start, "focus-a");
  assert.equal(data.active.durationSeconds, 2700);
  assert.throws(() => timerAction(data, "start", "pomodoro", start, "other"), /current timer/);
  data = timerAction(data, "finish", "focus", start + 60000, "unused");
  assert.equal(segmentSeconds(data.sessions[0].segments), 60);
  data = timerAction(data, "start", "pomodoro", start + 120000, "reset-me");
  data = timerAction(data, "reset", "pomodoro", start + 180000, "unused");
  assert.equal(data.sessions.length, 1); assert.equal(data.active, null);
  const immediate = timerAction(timerAction(emptyStudy(), "start", "focus", start, "zero"), "finish", "focus", start, "unused");
  assert.equal(immediate.sessions.length, 0);
});
test("study validation blocks malformed intervals, duplicate or overlapping time, excessive counts and foreign classes", () => {
  const active = timerAction(emptyStudy(), "start", "focus", start, "active");
  const complete = settleTimer(active, start + 3600000);
  for (const bad of [
    { ...emptyStudy(), dailyMinutes: -1 }, { ...emptyStudy(), weeklyMinutes: 10081 },
    { ...complete, sessions: [...complete.sessions, ...complete.sessions] },
    { ...complete, sessions: [...complete.sessions, { ...complete.sessions[0], id: "duplicate-time" }] },
    { ...complete, sessions: [{ ...complete.sessions[0], segments: [{ start: "yesterday", end: iso(1) }] }] },
    { ...active, active: { ...active.active, durationSeconds: 10 } },
    { ...emptyStudy(), grades: [{ id: "g", courseId: "c", term: "", system: "4.0 scale", max: 100, value: 90 }] },
  ]) assert.throws(() => validateStudy(bad));
  assert.throws(() => academicSnapshot([], layout({ ...active, active: { ...active.active, courseId: "foreign" } })), /class from this account/);
  assert.throws(() => academicSnapshot([], layout({ ...emptyStudy(), grades: [{ id: "g", courseId: "foreign", term: "", system: "Percentage", max: 100, value: 0 }] })), /Grades must belong/);
  assert.doesNotThrow(() => academicSnapshot([course], layout({ ...emptyStudy(), grades: [{ id: "g", courseId: "c", term: "", system: "Percentage", max: 100, value: 0 }] })));
});
test("daily and weekly study split at local midnight and across daylight-saving changes", () => {
  const sessions = [{ id: "midnight", kind: "focus", courseId: "", segments: [{ start: "2026-09-07T06:30:00.000Z", end: "2026-09-07T07:30:00.000Z" }] }];
  const monday = studyStats(sessions, "2026-09-07", "America/Los_Angeles", true);
  assert.equal(monday.dailySeconds, 1800); assert.equal(monday.weeklySeconds, 1800); assert.equal(monday.byDay["2026-09-06"], 1800);
  const sunday = studyStats(sessions, "2026-09-07", "America/Los_Angeles", false); assert.equal(sunday.weeklySeconds, 3600);
  const dst = studyStats([{ id: "dst", kind: "focus", courseId: "", segments: [{ start: "2026-11-01T07:30:00.000Z", end: "2026-11-01T10:30:00.000Z" }] }], "2026-11-01", "America/Los_Angeles", false);
  assert.equal(dst.dailySeconds, 10800);
  assert.equal(studyStats(sessions, "2026-09-07", "UTC", true).dailySeconds, 3600);
});
test("streaks tolerate an unfinished today and count only days with recorded work", () => {
  const sessions = [1, 2, 3, 6, 7].map((day) => ({ id: String(day), kind: "focus", courseId: "", segments: [{ start: `2026-09-0${day}T12:00:00.000Z`, end: `2026-09-0${day}T13:00:00.000Z` }] }));
  const stats = studyStats(sessions, "2026-09-08", "UTC", true); assert.equal(stats.streak, 2); assert.equal(stats.longest, 3);
  assert.equal(studyStats(sessions, "2026-09-09", "UTC", true).streak, 0);
  assert.equal(studyStats([], "2026-09-09", "UTC", true).longest, 0);
});
test("grade averages honor credits, term, zero grades and the saved system without implicit conversions", () => {
  const courses = [course, { ...course, id: "second", credits: 1 }, { ...course, id: "zero-credit", credits: 0 }];
  const grades = [{ id: "g", courseId: "c", term: "Fall", system: "4.0 scale", max: 4, value: 4 }, { id: "g2", courseId: "second", term: "Fall", system: "4.0 scale", max: 4, value: 0 }, { id: "g3", courseId: "zero-credit", term: "Fall", system: "4.0 scale", max: 4, value: 1 }];
  assert.deepEqual(gradeAverage(grades, courses, "4.0 scale", "Fall"), { value: 3, max: 4, count: 2 });
  assert.equal(gradeAverage(grades, courses, "Percentage", "Fall"), null); assert.equal(gradeAverage(grades, courses, "4.0 scale", "Spring"), null);
  assert.equal(gradeAverage(grades.map((g, i) => ({ ...g, system: "Custom", max: i + 10 })), courses, "Custom", "Fall"), null);
  assert.throws(() => validateStudy({ ...emptyStudy(), grades: [...grades, { ...grades[0], id: "another" }] }), /one grade/);
});
test("class removal retains personal study time and active work while removing its grades", () => {
  const data = { ...emptyStudy(), timers: { pomodoro: { minutes: 25, courseId: "c" }, focus: { minutes: 45, courseId: "c" } }, sessions: [{ id: "old", kind: "focus", courseId: "c", segments: [{ start: iso(-60), end: iso(-30) }] }], grades: [{ id: "grade", courseId: "c", term: "", system: "Percentage", max: 100, value: 80 }] };
  const active = timerAction(data, "start", "focus", start, "new");
  const detached = detachStudyCourse(active, "c");
  assert.equal(detached.sessions[0].courseId, ""); assert.deepEqual(detached.sessions[0].segments, data.sessions[0].segments); assert.equal(detached.active.courseId, ""); assert.equal(detached.timers.focus.courseId, ""); assert.equal(detached.grades.length, 0);
  assert.doesNotThrow(() => academicSnapshot([], layout(detached)));
});
test("weekly completion excludes undated legacy completions and uses saved time zone/week start", () => {
  const assignments = [{ status: "done", completedAt: "2026-09-07T06:30:00.000Z" }, { status: "done" }, { status: "later", completedAt: "2026-09-07T08:00:00.000Z" }];
  assert.equal(completedInWeek(assignments, "2026-09-07", "America/Los_Angeles", true), 0);
  assert.equal(completedInWeek(assignments, "2026-09-07", "UTC", true), 1);
});
