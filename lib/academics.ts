export type Course = { id: string; code: string; name: string; credits: number; instructor: string; room: string; color: string; soft: string; initials: string };
export type Meeting = { id: string; days: number[]; start: string; end: string; from: string; until: string; location: string };
export type CourseDetails = { officeHours: string; meetings: Meeting[]; syllabusText?: string; syllabusName?: string; syllabusFileId?: string };
export type ReviewItem = { id: string; title: string; date: string; type: "Assignment" | "Exam" | "Project"; description: string; weight: string };
export type SyllabusDraft = { id: string; sourceText: string; sourceName: string; sourceFileId?: string; course: Course; items: ReviewItem[] };
export const assignmentTypes = ["Assignment", "Exam", "Project"] as const;
export const eventTypes = ["Study block", "Exam", "Office hours", "Appointment", "Personal"] as const;
export const emptyCourse = (id: string): Course => ({ id, code: "", name: "", credits: 3, instructor: "", room: "", color: "#5b63e8", soft: "#5b63e818", initials: "" });
export const emptyCourseDetails = (): CourseDetails => ({ officeHours: "", meetings: [] });
export function isDate(value: string) { const date = new Date(`${value}T12:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1900-01-01" && value <= "2200-12-31" && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
export function isTime(value: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
// Earlier event forms stored this default in display format instead of HH:mm.
export function legacyEventTime(value: string) { return value === "12:00 PM" ? "12:00" : value; }
export function dayKey(now: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function addDays(date: string, offset: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) { return isDate(date) ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" }) : "Set a due date"; }
export function weekStart(date: string, monday: boolean) { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -((day - (monday ? 1 : 0) + 7) % 7)); }
export function assignmentStatus(item: { status: string; dateKey: string }, today: string): "done" | "overdue" | "today" | "later" { return item.status === "done" ? "done" : item.dateKey && item.dateKey < today ? "overdue" : item.dateKey === today ? "today" : "later"; }
export function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error(`Invalid ${label}.`); return value;
}
export function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid academic data."); return value as Record<string, unknown>; }
export function validateCourse(value: unknown, draft = false): Course {
  const c = record(value);
  const result = { id: text(c.id, "course ID", 120, true), code: text(c.code, "course code", 30, !draft).trim(), name: text(c.name, "class name", 160, !draft).trim(), credits: c.credits as number, instructor: text(c.instructor, "instructor", 160), room: text(c.room, "location", 160), color: text(c.color, "class color", 9), soft: text(c.soft, "class color", 9), initials: text(c.initials, "initials", 8) };
  if (!Number.isInteger(result.credits) || result.credits < 0 || result.credits > 30) throw new Error("Credits must be a whole number between 0 and 30.");
  if (!/^#[a-f\d]{6}$/i.test(result.color) || !/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(result.soft)) throw new Error("Invalid class color.");
  return result;
}
export function validateCourseDetails(value: unknown): CourseDetails {
  const d = record(value); text(d.officeHours, "office hours", 2000);
  if (!Array.isArray(d.meetings) || d.meetings.length > 30) throw new Error("A class can have up to 30 meeting schedules.");
  const ids = new Set<string>();
  for (const raw of d.meetings) {
    const m = record(raw); text(m.id, "meeting ID", 120, true); text(m.location, "meeting location", 160);
    if (ids.has(m.id as string)) throw new Error("Duplicate meeting ID."); ids.add(m.id as string);
    if (!Array.isArray(m.days) || !m.days.length || m.days.length > 7 || new Set(m.days).size !== m.days.length || m.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Choose meeting weekdays.");
    if (!isTime(String(m.start)) || !isTime(String(m.end)) || String(m.end) <= String(m.start)) throw new Error("Meeting end must be after its start on the same day.");
    if (!isDate(String(m.from)) || !isDate(String(m.until)) || String(m.until) < String(m.from)) throw new Error("Choose a valid meeting date range.");
  }
  if (d.syllabusText !== undefined) text(d.syllabusText, "syllabus text", 60000);
  if (d.syllabusName !== undefined) text(d.syllabusName, "syllabus name", 255);
  if (d.syllabusFileId !== undefined && !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(String(d.syllabusFileId))) throw new Error("Invalid syllabus file.");
  return d as CourseDetails;
}
export function validateDraft(value: unknown): SyllabusDraft {
  const d = record(value); text(d.id, "review ID", 120, true); text(d.sourceText, "syllabus text", 60000); text(d.sourceName, "syllabus name", 255); validateCourse(d.course, true);
  if (d.sourceFileId !== undefined && !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(String(d.sourceFileId))) throw new Error("Invalid syllabus file.");
  if (!Array.isArray(d.items) || d.items.length > 200) throw new Error("A syllabus review can have up to 200 items.");
  const ids = new Set<string>();
  for (const raw of d.items) { const i = record(raw); text(i.id, "review item ID", 120, true); text(i.title, "review title", 500); text(i.date, "review date", 10); text(i.description, "description", 20000); text(i.weight, "weight", 100); if (!assignmentTypes.includes(i.type as ReviewItem["type"]) || (i.date && !isDate(String(i.date))) || ids.has(String(i.id))) throw new Error("Invalid review item."); ids.add(String(i.id)); }
  return d as SyllabusDraft;
}

// A transparent convenience parser, not an AI extraction claim. Only explicit
// ISO dates are suggested; the complete original text stays available for review.
export function suggestSyllabusItems(source: string, makeId: () => string): ReviewItem[] {
  return source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/\b(\d{4}-\d{2}-\d{2})\b/); if (!match || !isDate(match[1])) return [];
    return [{ id: makeId(), title: line.replace(match[1], "").replace(/^[\s:—–-]+|[\s:—–-]+$/g, "").slice(0, 500), date: match[1], type: /\b(exam|test|quiz)\b/i.test(line) ? "Exam" as const : /\bproject\b/i.test(line) ? "Project" as const : "Assignment" as const, description: "", weight: "" }];
  }).slice(0, 200);
}
