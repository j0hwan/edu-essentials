import { addDays, dayKey, record, text, weekStart, type Course } from "./academics";

export type TimerKind = "pomodoro" | "focus";
export type StudySegment = { start: string; end: string };
export type ActiveTimer = { id: string; kind: TimerKind; courseId: string; durationSeconds: number; segments: StudySegment[]; runningSince: string | null };
export type StudySession = { id: string; kind: TimerKind; courseId: string; segments: StudySegment[] };
export type Grade = { id: string; courseId: string; term: string; system: string; max: number; value: number };
export type StudyData = { dailyMinutes: number; weeklyMinutes: number; timers: Record<TimerKind, { minutes: number; courseId: string }>; active: ActiveTimer | null; sessions: StudySession[]; grades: Grade[] };
export const gradeSystems = ["4.0 scale", "Percentage", "Custom"];
export const emptyStudy = (): StudyData => ({ dailyMinutes: 0, weeklyMinutes: 0, timers: { pomodoro: { minutes: 25, courseId: "" }, focus: { minutes: 45, courseId: "" } }, active: null, sessions: [], grades: [] });
const timestamp = (value: unknown): number => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value || value < "1900" || value >= "2201") throw new Error("Invalid study timestamp.");
  return Date.parse(value);
};
const number = (value: unknown, min: number, max: number, integer = false) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Enter a number from ${min} to ${max}.`);
};
export const segmentSeconds = (segments: StudySegment[]) => segments.reduce((sum, s) => sum + (Date.parse(s.end) - Date.parse(s.start)) / 1000, 0);
function validateSegments(value: unknown, empty = false): StudySegment[] {
  if (!Array.isArray(value) || value.length > 100 || (!empty && !value.length)) throw new Error("A session needs 1–100 study intervals.");
  let previous = -Infinity;
  for (const raw of value) { const s = record(raw), start = timestamp(s.start), end = timestamp(s.end); if (end <= start || start < previous) throw new Error("Study intervals must be ordered and cannot overlap."); previous = end; }
  number(segmentSeconds(value), 0, 480 * 60);
  return value;
}
export function validateStudy(value: unknown): StudyData {
  const d = record(value); number(d.dailyMinutes, 0, 1440, true); number(d.weeklyMinutes, 0, 10080, true);
  const timers = record(d.timers);
  for (const kind of ["pomodoro", "focus"]) { const timer = record(timers[kind]); number(timer.minutes, 1, 480, true); text(timer.courseId, "timer class", 120); }
  if (!Array.isArray(d.sessions) || d.sessions.length > 1000 || !Array.isArray(d.grades) || d.grades.length > 1000) throw new Error("Keep at most 1,000 study sessions and 1,000 grades. Download history before removing older entries.");
  const ids = new Set<string>();
  const session = (value: unknown, active = false) => { const s = record(value); text(s.id, "study ID", 120, true); text(s.courseId, "study class", 120); if (!["pomodoro", "focus"].includes(String(s.kind)) || ids.has(String(s.id))) throw new Error("Invalid or duplicate study session."); ids.add(String(s.id)); validateSegments(s.segments, active); return s; };
  d.sessions.forEach((s) => session(s));
  if (d.active !== null) {
    if (d.sessions.length >= 1000) throw new Error("Download and remove older study history before starting another timer.");
    const a = session(d.active, true); number(a.durationSeconds, 60, 480 * 60, true);
    const segments = a.segments as StudySegment[];
    if (segmentSeconds(segments) > (a.durationSeconds as number)) throw new Error("Timer duration is shorter than recorded work.");
    if (a.runningSince !== null) { if (segments.length >= 100) throw new Error("Finish this session before starting another interval."); const start = timestamp(a.runningSince); if (segments.length && start < timestamp(segments.at(-1)!.end)) throw new Error("Timer starts before its last pause."); }
  }
  const keys = new Set<string>(), gradeIds = new Set<string>();
  for (const raw of d.grades) {
    const g = record(raw); text(g.id, "grade ID", 120, true); text(g.courseId, "grade class", 120, true); text(g.term, "grade term", 160);
    if (!gradeSystems.includes(String(g.system))) throw new Error("Choose a supported grade system.");
    number(g.max, 0.01, 1000); number(g.value, 0, g.max as number);
    if ((g.system === "4.0 scale" && g.max !== 4) || (g.system === "Percentage" && g.max !== 100)) throw new Error("Grade maximum does not match its scale.");
    const key = JSON.stringify([g.courseId, g.term, g.system]); if (keys.has(key) || gradeIds.has(String(g.id))) throw new Error("A class can have only one grade per term and scale."); keys.add(key); gradeIds.add(String(g.id));
  }
  // Reject overlapping recorded time, including an active timer's past intervals.
  const intervals = [...(d.sessions as StudySession[]).flatMap((s) => s.segments), ...((d.active as ActiveTimer | null)?.segments ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < intervals.length; i++) if (intervals[i].start < intervals[i - 1].end) throw new Error("Study sessions cannot double-count the same time.");
  const running = (d.active as ActiveTimer | null)?.runningSince;
  if (running && intervals.some((s) => s.end > running)) throw new Error("Timer overlaps recorded study time.");
  return d as StudyData;
}

export function timerElapsed(timer: ActiveTimer, now: number): number { return Math.min(timer.durationSeconds, segmentSeconds(timer.segments) + (timer.runningSince ? Math.max(0, now - Date.parse(timer.runningSince)) / 1000 : 0)); }
function paused(timer: ActiveTimer, now: number): ActiveTimer {
  if (!timer.runningSince) return timer;
  const start = Date.parse(timer.runningSince), end = Math.min(now, start + (timer.durationSeconds - segmentSeconds(timer.segments)) * 1000);
  return { ...timer, runningSince: null, segments: end > start ? [...timer.segments, { start: timer.runningSince, end: new Date(end).toISOString() }] : timer.segments };
}
export function finishTimer(data: StudyData, now: number): StudyData {
  if (!data.active) return data;
  const { id, kind, courseId, segments } = paused(data.active, now);
  return { ...data, active: null, sessions: segments.length ? [...data.sessions, { id, kind, courseId, segments }] : data.sessions };
}
export function settleTimer(data: StudyData, now: number): StudyData { return data.active && timerElapsed(data.active, now) >= data.active.durationSeconds ? finishTimer(data, now) : data; }
export function timerAction(data: StudyData, action: "start" | "pause" | "resume" | "finish" | "reset", kind: TimerKind, now: number, id: string): StudyData {
  let next = settleTimer(data, now);
  if (action === "start") {
    if (next.active) throw new Error("Finish or reset the current timer before starting another.");
    const config = next.timers[kind]; next = { ...next, active: { id, kind, courseId: config.courseId, durationSeconds: config.minutes * 60, segments: [], runningSince: new Date(now).toISOString() } };
  } else if (next.active?.kind === kind) {
    if (action === "pause") next = { ...next, active: paused(next.active, now) };
    if (action === "resume" && !next.active!.runningSince) next = { ...next, active: { ...next.active!, runningSince: new Date(now).toISOString() } };
    if (action === "finish") next = finishTimer(next, now);
    if (action === "reset") next = { ...next, active: null };
  }
  validateStudy(next); return next;
}
export function detachStudyCourse(data: StudyData, courseId: string): StudyData {
  return { ...data, active: data.active?.courseId === courseId ? { ...data.active, courseId: "" } : data.active, sessions: data.sessions.map((s) => s.courseId === courseId ? { ...s, courseId: "" } : s), grades: data.grades.filter((g) => g.courseId !== courseId), timers: { pomodoro: { ...data.timers.pomodoro, courseId: data.timers.pomodoro.courseId === courseId ? "" : data.timers.pomodoro.courseId }, focus: { ...data.timers.focus, courseId: data.timers.focus.courseId === courseId ? "" : data.timers.focus.courseId } } };
}
export function studyStats(sessions: StudySession[], today: string, timezone: string, monday: boolean) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const key = (time: number) => formatter.format(time), byDay: Record<string, number> = {};
  for (const session of sessions) for (const segment of session.segments) {
    let start = Date.parse(segment.start); const end = Date.parse(segment.end);
    while (start < end) {
      const date = key(start); let boundary = end;
      if (key(end - 1) !== date) { let low = start + 1, high = end; while (low < high) { const mid = Math.floor((low + high) / 2); if (key(mid) === date) low = mid + 1; else high = mid; } boundary = low; }
      byDay[date] = (byDay[date] ?? 0) + (boundary - start) / 1000; start = boundary;
    }
  }
  const dates = Object.keys(byDay).filter((d) => d <= today && byDay[d] > 0).sort();
  let longest = 0, run = 0, previous = "";
  for (const date of dates) { run = previous && addDays(previous, 1) === date ? run + 1 : 1; longest = Math.max(longest, run); previous = date; }
  let streak = 0, cursor = byDay[today] ? today : addDays(today, -1); while (byDay[cursor]) { streak++; cursor = addDays(cursor, -1); }
  const start = weekStart(today, monday), week = Array.from({ length: 7 }, (_, i) => { const date = addDays(start, i); return { date, seconds: byDay[date] ?? 0 }; });
  return { byDay, week, dailySeconds: byDay[today] ?? 0, weeklySeconds: week.reduce((sum, d) => sum + d.seconds, 0), streak, longest };
}
export function gradeAverage(grades: Grade[], courses: Course[], system: string, term: string): { value: number; max: number; count: number } | null {
  const included = grades.filter((g) => g.system === system && g.term === term && courses.some((c) => c.id === g.courseId && c.credits > 0));
  if (!included.length || new Set(included.map((g) => g.max)).size !== 1) return null;
  let weight = 0, total = 0;
  for (const grade of included) { const credits = courses.find((c) => c.id === grade.courseId)!.credits; weight += credits; total += credits * grade.value; }
  return { value: total / weight, max: included[0].max, count: included.length };
}
export const durationLabel = (seconds: number) => `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m`;
export const goalPercent = (seconds: number, minutes: number) => minutes ? Math.min(100, Math.floor(seconds / (minutes * 60) * 100)) : 0;
export function completedInWeek(assignments: { status: string; completedAt?: string | null }[], today: string, timezone: string, monday: boolean) {
  const start = weekStart(today, monday), end = addDays(start, 7);
  return assignments.filter((a) => { if (a.status !== "done" || !a.completedAt || !Number.isFinite(Date.parse(a.completedAt))) return false; const date = dayKey(new Date(a.completedAt), timezone); return date >= start && date < end && date <= today; }).length;
}
