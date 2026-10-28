"use client";

import { AlertOctagon, CheckCircle2, ChevronRight, Circle, Clock3 } from "lucide-react";
import type { Course } from "../lib/academics";
import type { SavedAssignment } from "../lib/workspace-codec";

export type AssignmentStatus = SavedAssignment["status"];

export const statusMeta: Record<AssignmentStatus, { label: string; short: string; icon: typeof Circle }> = {
  overdue: { label: "Overdue", short: "Past due", icon: AlertOctagon },
  today: { label: "Due today", short: "Today", icon: Clock3 },
  later: { label: "Due later", short: "Upcoming", icon: Circle },
  done: { label: "Completed", short: "Done", icon: CheckCircle2 },
};

export function StatusBadge({ status, compact = false }: { status: AssignmentStatus; compact?: boolean }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <span className={`status-badge status-${status}`} aria-label={meta.label}>
      <Icon size={compact ? 13 : 14} strokeWidth={2.4} aria-hidden="true" />
      {!compact && <span>{meta.short}</span>}
    </span>
  );
}

export function CourseStamp({ course, small = false }: { course: Course; small?: boolean }) {
  return (
    <span className={`course-stamp ${small ? "small" : ""}`} style={{ background: course.soft, color: course.color }} aria-hidden="true">
      {course.initials}
    </span>
  );
}

type AssignmentTableProps = {
  items: SavedAssignment[];
  compact?: boolean;
  courseFor: (courseId: string) => Course;
  onSelectAssignment: (assignment: SavedAssignment) => void;
};

export function AssignmentTable({ items, compact = false, courseFor, onSelectAssignment }: AssignmentTableProps) {
  return <div className={`assignment-table ${compact ? "compact" : ""}`}>
    {!compact && <div className="assignment-table-head"><span>Status</span><span>Assignment</span><span>Class</span><span>Due</span><span>Progress</span><span /></div>}
    {!items.length && <div className="assignment-row assignment-empty"><span>No assignments yet...</span></div>}
    {items.map((assignment) => { const course = courseFor(assignment.courseId); return <button className={`assignment-row ${assignment.status === "done" ? "completed" : ""}`} key={assignment.id} onClick={() => onSelectAssignment(assignment)}>
      <span><StatusBadge status={assignment.status} /></span>
      <span className="assignment-title"><strong>{assignment.title}</strong>{compact && <small>{course.code}</small>}</span>
      {!compact && <span className="assignment-course"><CourseStamp course={course} small /><span><strong>{course.code}</strong><small>{course.name}</small></span></span>}
      <span className="assignment-due"><strong>{assignment.due.split(",")[0]}</strong><small>{assignment.due.includes(",") ? assignment.due.split(",").slice(1).join(",") : ""}</small></span>
      <span className="row-progress"><i><b style={{ width: `${assignment.progress}%` }} /></i><small>{assignment.progress}%</small></span>
      <ChevronRight size={16} />
    </button>; })}
  </div>;
}
