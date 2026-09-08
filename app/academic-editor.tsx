"use client";
import { useState } from "react";
import { assignmentStatus, assignmentTypes, dateLabel, emptyCourseDetails, eventTypes, validateCourse, validateCourseDetails, type Course, type CourseDetails } from "../lib/academics";
import type { SavedAssignment, SavedEvent } from "../lib/workspace-codec";
import { downloadDraft, useSaveProtection } from "./use-save-protection";

type Value = { course?: Course; details?: CourseDetails; assignment?: SavedAssignment; event?: SavedEvent };
export default function AcademicEditor({ initial, courses, today, onApply, onClose, onDelete }: { initial: Value; courses: Course[]; today: string; onApply: (value: Value) => boolean; onClose: () => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState(initial), [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useSaveProtection(dirty);
  const kind = draft.course ? "class" : draft.assignment ? "assignment" : "event";
  const course = draft.course, assignment = draft.assignment, event = draft.event, details = draft.details ?? emptyCourseDetails();
  const close = () => { if (!dirty || window.confirm("Discard these form edits? Download the draft first if you want a copy.")) onClose(); };
  const changeCourse = (patch: Partial<Course>) => setDraft({ ...draft, course: { ...course!, ...patch } });
  const changeDetails = (patch: Partial<CourseDetails>) => setDraft({ ...draft, details: { ...details, ...patch } });
  const changeItem = (patch: Partial<SavedAssignment & SavedEvent>) => setDraft(assignment ? { ...draft, assignment: { ...assignment, ...patch } } : { ...draft, event: { ...event!, ...patch } });
  const item = assignment ?? event;
  const field = (label: string, value: string | number, change: (value: string) => void, type = "text", required = false, maxLength = 160) => <label>{label}<input type={type} required={required} value={value} maxLength={maxLength} onChange={(e) => change(e.target.value)} /></label>;
  return <div className="modal-backdrop"><form className="add-class-modal academic-editor" role="dialog" aria-modal="true" aria-label={`Edit ${kind}`} onSubmit={(e) => {
    e.preventDefault(); setError("");
    try {
      let value = draft;
      if (course) value = { course: validateCourse({ ...course, initials: course.code.slice(0, 2).toUpperCase(), soft: `${course.color}18` }), details: validateCourseDetails(details) };
      if (assignment) value = { assignment: { ...assignment, due: dateLabel(assignment.dateKey), status: assignmentStatus(assignment, today) } };
      if (!onApply(value)) setError("These changes could not be accepted. Check the workspace message and keep this draft.");
    } catch (err) { setError(err instanceof Error ? err.message : "Review these fields."); }
  }}>
    <div className="modal-header"><h2>{course ? "Class details" : assignment ? "Assignment details" : "Event details"}</h2><button type="button" className="secondary-button" onClick={close}>Close editor</button></div>
    <div className="settings-form-grid">
      {course && <>{field("Course code", course.code, (code) => changeCourse({ code }), "text", true, 30)}{field("Class name", course.name, (name) => changeCourse({ name }), "text", true)}{field("Credits", course.credits, (value) => changeCourse({ credits: Number(value) }), "number")}{field("Instructor", course.instructor, (instructor) => changeCourse({ instructor }))}{field("Location / meeting notes", course.room, (room) => changeCourse({ room }))}{field("Class color", course.color, (color) => changeCourse({ color }), "color")}</>}
      {item && <>{field(assignment ? "Assignment title" : "Event name", item.title, (title) => changeItem({ title }), "text", true, 500)}<label>Class<select value={item.courseId} onChange={(e) => changeItem({ courseId: e.target.value })}><option value="">Personal</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label>{field(assignment ? "Due date" : "Event date", item.dateKey, (dateKey) => changeItem({ dateKey }), "date", true)}{field(assignment ? "Due time (optional)" : "Time (blank for all day)", assignment ? assignment.dueTime ?? "" : event!.time, (time) => changeItem(assignment ? { dueTime: time } : { time }), "time")}<label>Type<select value={item.type ?? "Assignment"} onChange={(e) => changeItem({ type: e.target.value as SavedAssignment["type"] })}>{(assignment ? assignmentTypes : eventTypes).map((type) => <option key={type}>{type}</option>)}</select></label>{assignment && field("Weight (optional)", assignment.weight, (weight) => changeItem({ weight }), "text", false, 100)}</>}
    </div>
    {item && <label>Description<textarea maxLength={20000} value={item.description ?? ""} onChange={(e) => changeItem({ description: e.target.value })} /></label>}
    {assignment && <><label>Assignment notes<textarea maxLength={20000} value={assignment.notes ?? ""} onChange={(e) => changeItem({ notes: e.target.value })} /></label><label>Progress<input type="number" min="0" max="100" value={assignment.progress} disabled={assignment.status === "done"} onChange={(e) => changeItem({ progress: Number(e.target.value) })} /></label><label className="profile-toggle">Completed<input type="checkbox" checked={assignment.status === "done"} onChange={(e) => changeItem(e.target.checked ? { status: "done", completedAt: new Date().toISOString(), progressBeforeCompletion: assignment.progress, progress: 100 } : { status: "later", completedAt: null, progress: assignment.progressBeforeCompletion ?? 0 })} /></label>{["Review instructions and rubric", "Complete first draft", "Proofread and submit"].map((label, index) => <label className="profile-toggle" key={label}>{label}<input type="checkbox" checked={assignment.checklist?.[index] ?? false} onChange={(e) => { const checklist = [...(assignment.checklist ?? [false, false, false])]; checklist[index] = e.target.checked; changeItem({ checklist }); }} /></label>)}</>}
    {course && <><label>Office hours<textarea maxLength={2000} value={details.officeHours} onChange={(e) => changeDetails({ officeHours: e.target.value })} /></label><h3>Class schedule</h3><p className="form-hint">Meeting times use your saved time zone. Choose a date range for each weekly meeting.</p>{details.meetings.map((m, index) => {
      const change = (patch: Partial<typeof m>) => changeDetails({ meetings: details.meetings.map((current) => current.id === m.id ? { ...current, ...patch } : current) });
      return <fieldset className="meeting-editor" key={m.id}><legend>Meeting {index + 1}</legend><div className="weekday-options">{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, dayIndex) => <label key={day}><input type="checkbox" checked={m.days.includes(dayIndex)} onChange={(e) => change({ days: e.target.checked ? [...m.days, dayIndex].sort() : m.days.filter((v) => v !== dayIndex) })} />{day}</label>)}</div><div className="settings-form-grid">{field("Start time", m.start, (start) => change({ start }), "time", true)}{field("End time", m.end, (end) => change({ end }), "time", true)}{field("First date", m.from, (from) => change({ from }), "date", true)}{field("Last date", m.until, (until) => change({ until }), "date", true)}{field("Meeting location", m.location, (location) => change({ location }))}</div><button type="button" className="secondary-button" onClick={() => changeDetails({ meetings: details.meetings.filter((v) => v.id !== m.id) })}>Remove meeting</button></fieldset>;
    })}<button type="button" className="secondary-button" disabled={details.meetings.length >= 30} onClick={() => changeDetails({ meetings: [...details.meetings, { id: crypto.randomUUID(), days: [1], start: "09:00", end: "10:00", from: today, until: today, location: course.room }] })}>Add meeting</button>{details.syllabusText && <details><summary>Saved syllabus source</summary><pre className="syllabus-source">{details.syllabusText}</pre></details>}</>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => downloadDraft(`eduessentials-${kind}-draft.json`, draft)}>Download form draft</button>{onDelete && <button type="button" className="secondary-button danger" onClick={onDelete}>Delete {kind}</button>}<button className="primary-button">Save {kind}</button></div>
  </form></div>;
}
