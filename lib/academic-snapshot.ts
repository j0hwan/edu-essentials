import { validateCourse, isDate, isTime, assignmentTypes, eventTypes, type Course } from "./academics";
import { decodeWorkspaceState, encodeWorkspaceState, type CompactWorkspaceState, type WorkspaceData } from "./workspace-codec";

export function academicSnapshot(courses: unknown, dashboard: unknown): { courses: Course[]; dashboard: CompactWorkspaceState } {
  return buildSnapshot(courses, dashboard);
}

// Existing invalid dates can be repaired one record at a time in the editor.
// Only unchanged old records may bypass field validation here. The autosave and
// server still require a fully valid snapshot before any database write.
export function validateAcademicEdit(courses: unknown, dashboard: unknown, previous: WorkspaceData): void {
  buildSnapshot(courses, dashboard, previous);
}

function buildSnapshot(courses: unknown, dashboard: unknown, unchanged?: WorkspaceData): { courses: Course[]; dashboard: CompactWorkspaceState } {
  if (!Array.isArray(courses) || courses.length > 100) throw new Error("A workspace can have up to 100 classes.");
  const cleanCourses = courses.map((course) => validateCourse(course)).sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(cleanCourses.map((c) => c.id));
  if (ids.size !== cleanCourses.length) throw new Error("Duplicate class ID.");
  const decoded = decodeWorkspaceState(dashboard), data = decoded.data;
  if (data) {
    const owned = (id: string) => { if (id && !ids.has(id)) throw new Error("Choose a class from this account, or Personal."); };
    if (data.filePreferences && !["all", "personal"].includes(data.filePreferences.filter)) owned(data.filePreferences.filter);
    if (data.study) {
      Object.values(data.study.timers).forEach((timer) => owned(timer.courseId));
      if (data.study.active) owned(data.study.active.courseId);
      data.study.sessions.forEach((session) => owned(session.courseId));
      data.study.grades.forEach((grade) => { if (!ids.has(grade.courseId)) throw new Error("Grades must belong to a class in this account."); });
    }
    for (const a of data.assignments) {
      owned(a.courseId);
      if (unchanged && JSON.stringify(a) === JSON.stringify(unchanged.assignments.find((old) => old.id === a.id))) continue;
      if (!a.title.trim()) throw new Error("Enter an assignment title.");
      if (!isDate(a.dateKey) || (a.dueTime !== undefined && (typeof a.dueTime !== "string" || (a.dueTime !== "" && !isTime(a.dueTime))))) throw new Error(`Set a valid due date and time for ${a.title}.`);
      if (a.type !== undefined && !assignmentTypes.includes(a.type)) throw new Error("Invalid assignment type.");
      if (a.completedAt != null && (typeof a.completedAt !== "string" || !Number.isFinite(Date.parse(a.completedAt)) || !/^\d{4}-\d\d-\d\dT/.test(a.completedAt))) throw new Error("Invalid completion timestamp.");
      if (a.progressBeforeCompletion !== undefined && (!Number.isFinite(a.progressBeforeCompletion) || a.progressBeforeCompletion < 0 || a.progressBeforeCompletion > 100)) throw new Error("Invalid previous progress.");
      if (a.status === "done" && a.progress !== 100) throw new Error("Completed assignments must have 100% progress.");
    }
    for (const e of data.manualEvents) {
      owned(e.courseId);
      if (unchanged && JSON.stringify(e) === JSON.stringify(unchanged.manualEvents.find((old) => old.id === e.id))) continue;
      if (!e.title.trim() || !isDate(e.dateKey) || (e.time && !isTime(e.time)) || !eventTypes.includes(e.type as typeof eventTypes[number]) || (e.description !== undefined && (typeof e.description !== "string" || e.description.length > 20000))) throw new Error(`Set valid event details for ${e.title}.`);
    }
    for (const id of Object.keys(data.courseDetails ?? {})) if (!ids.has(id)) throw new Error("Class details must belong to a class in this account.");
    if (data.calendarFilter && data.calendarFilter !== "all" && data.calendarFilter !== "personal") owned(data.calendarFilter);
  }
  const result = { courses: cleanCourses, dashboard: encodeWorkspaceState(decoded.workspaces, decoded.activeWorkspaceId, decoded.notes, data) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1_000_000) throw new Error("Workspace storage limit reached. Shorten notes or syllabus text before adding more content.");
  return result;
}
