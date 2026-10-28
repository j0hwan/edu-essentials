"use client";

import type { ReactNode } from "react";
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronRight, Clock3, FileSearch, FileText, GraduationCap, Search, StickyNote, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { dateLabel } from "../lib/academics";
import type { Course, CourseDetails } from "../lib/academics";
import type { PrivateFile } from "../lib/files";
import { fileSize } from "../lib/files";
import { durationLabel, segmentSeconds, type StudyData } from "../lib/study";
import type { SavedAssignment, SavedEvent, Workspace as WorkspaceLayout } from "../lib/workspace-codec";

export type WorkspaceSearchItem = {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  action: () => void;
};

export type WorkspaceSearchGroup = {
  title: string;
  icon: LucideIcon;
  items: WorkspaceSearchItem[];
};

export type SearchableAssignment = SavedAssignment & {
  status: "overdue" | "today" | "later" | "done";
};

type WorkspaceSearchActions = {
  onAssignment: (assignment: SearchableAssignment) => void;
  onCourse: (course: Course) => void;
  onFile: (file: PrivateFile) => void;
  onEvent: (event: SavedEvent) => void;
  onStudyOpen: () => void;
  onNote: (workspaceId: string, widgetInstanceId: string) => void;
};

export type CreateWorkspaceSearchResultGroupsOptions = WorkspaceSearchActions & {
  query: string;
  assignments: SearchableAssignment[];
  courses: Course[];
  courseDetails: Record<string, CourseDetails>;
  files: PrivateFile[];
  events: SavedEvent[];
  study: StudyData;
  workspaces: WorkspaceLayout[];
};

function courseFor(courses: Course[], id: string) {
  return courses.find((course) => course.id === id) ?? { id, code: "Personal", name: "Personal", credits: 0, instructor: "", room: "", color: "#5b63e8", soft: "#eef0ff", initials: "P" };
}

export function createWorkspaceSearchResultGroups({
  query: rawQuery,
  assignments,
  courses,
  courseDetails,
  files,
  events,
  study,
  workspaces,
  onAssignment,
  onCourse,
  onFile,
  onEvent,
  onStudyOpen,
  onNote,
}: CreateWorkspaceSearchResultGroupsOptions): WorkspaceSearchGroup[] {
  const query = rawQuery.toLowerCase().trim();
  const statusMeta = {
    overdue: { label: "Overdue", short: "Past due" },
    today: { label: "Due today", short: "Today" },
    later: { label: "Due later", short: "Upcoming" },
    done: { label: "Completed", short: "Done" },
  } satisfies Record<SearchableAssignment["status"], { label: string; short: string }>;
  return [
    { title: "Assignments", icon: CheckCircle2, items: assignments.filter((assignment) => !query || `${assignment.title} ${assignment.description} ${assignment.notes ?? ""} ${statusMeta[assignment.status].label} ${courseFor(courses, assignment.courseId).code}`.toLowerCase().includes(query)).map((assignment) => ({ id: assignment.id, title: assignment.title, subtitle: `${courseFor(courses, assignment.courseId).code} · ${assignment.due}`, badge: statusMeta[assignment.status].short, action: () => onAssignment(assignment) })) },
    { title: "Classes", icon: BookOpen, items: courses.filter((course) => !query || `${course.name} ${course.code} ${course.instructor} ${course.room} ${courseDetails[course.id]?.officeHours ?? ""} ${courseDetails[course.id]?.meetingNotes ?? ""}`.toLowerCase().includes(query)).map((course) => ({ id: course.id, title: course.name, subtitle: `${course.code} · ${course.instructor}`, badge: `${course.credits} credits`, action: () => onCourse(course) })) },
    { title: "Files", icon: FileText, items: files.filter((file) => !query || (file.name + " " + file.kind + " " + file.mime_type + " " + courseFor(courses, file.course_id ?? "").code).toLowerCase().includes(query)).map((file) => ({ id: file.id, title: file.name, subtitle: fileSize(Number(file.size_bytes)) + " · " + file.state, badge: file.kind, action: () => onFile(file) })) },
    { title: "Events", icon: CalendarDays, items: events.filter((event) => !query || (event.title + " " + event.description + " " + event.type + " " + courseFor(courses, event.courseId).code).toLowerCase().includes(query)).map((event) => ({ id: event.id, title: event.title, subtitle: dateLabel(event.dateKey) + " · " + event.time, badge: event.type, action: () => onEvent(event) })) },
    { title: "Syllabus text", icon: FileText, items: courses.filter((course) => courseDetails[course.id]?.syllabusText && (!query || (courseDetails[course.id].syllabusText + " " + course.code).toLowerCase().includes(query))).map((course) => ({ id: course.id, title: course.code + " syllabus", subtitle: courseDetails[course.id].syllabusName ?? "Saved text", badge: "Syllabus", action: () => onCourse(course) })) },
    { title: "Grades", icon: GraduationCap, items: study.grades.filter((grade) => !query || (courseFor(courses, grade.courseId).code + " " + grade.term + " " + grade.value + " " + grade.system).toLowerCase().includes(query)).map((grade) => ({ id: grade.id, title: courseFor(courses, grade.courseId).code + " grade", subtitle: grade.value + " / " + grade.max + " · " + grade.term, badge: grade.system, action: onStudyOpen })) },
    { title: "Study history", icon: Clock3, items: study.sessions.filter((session) => !query || (session.kind + " " + courseFor(courses, session.courseId).code + " " + session.segments.at(-1)!.end).toLowerCase().includes(query)).map((session) => ({ id: session.id, title: courseFor(courses, session.courseId).code + " study session", subtitle: durationLabel(segmentSeconds(session.segments)) + " · " + session.segments.at(-1)!.end.slice(0, 10), badge: session.kind, action: onStudyOpen })) },
    { title: "Notes", icon: StickyNote, items: workspaces.flatMap((workspace) => workspace.widgets.filter((widget) => widget.type === "notes").map((widget, index) => ({ id: widget.instanceId, title: `Quick notes ${index + 1} · ${workspace.name}`, subtitle: (widget.note ?? "").replace(/\n/g, " · "), badge: "Note", action: () => onNote(workspace.id, widget.instanceId) }))).filter((item) => !query || `${item.title} ${item.subtitle}`.toLowerCase().includes(query)) },
  ];
}

export function WorkspaceQuickSearchResults({ groups, onSelect }: { groups: WorkspaceSearchGroup[]; onSelect: (item: WorkspaceSearchItem) => void }) {
  const results = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title, icon: group.icon })));
  return <section id="workspace-search-suggestions" className="quick-search" aria-label="Quick search results">
    <div className="quick-search-heading"><strong>Quick results</strong><span role="status">{results.length} {results.length === 1 ? "match" : "matches"}</span></div>
    {results.length ? <div className="quick-search-results">{results.slice(0, 6).map((item) => {
      const Icon = item.icon;
      return <button key={`${item.group}-${item.id}`} type="button" className="quick-search-result" onClick={() => onSelect(item)}>
        <Icon size={18} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><em>{item.group}</em>
      </button>;
    })}</div> : <p className="quick-search-empty">No matches yet. Try a different word or phrase.</p>}
    <button type="submit" className="quick-search-all"><span>View all results</span><span>Enter <ArrowRight size={14} aria-hidden="true" /></span></button>
  </section>;
}

export function WorkspaceSearchPage({ groups, query, onQueryChange, header }: {
  groups: WorkspaceSearchGroup[];
  query: string;
  onQueryChange: (query: string) => void;
  header: ReactNode;
}) {
  const normalizedQuery = query.toLowerCase().trim();
  const resultCount = groups.reduce((total, group) => total + group.items.length, 0);
  return <div className="page search-page">
    {header}
    <div className="global-search"><Search size={22} /><input aria-label="Search everything" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Try “reflection,” “office hours,” or “MATH 101”…" />{query && <button onClick={() => onQueryChange("")} aria-label="Clear search"><X size={18} /></button>}<kbd>⌘ K</kbd></div>
    {!normalizedQuery && <div className="search-suggestions"><span>Try searching</span>{["Due today", "Lab report", "Office hours", "Grading policy"].map((suggestion) => <button key={suggestion} onClick={() => onQueryChange(suggestion)}>{suggestion}</button>)}</div>}
    <div className="search-meta"><strong>{resultCount} {normalizedQuery ? `results for “${query}”` : "items ready to search"}</strong><span>Results update as you type</span></div>
    {resultCount === 0 ? <div className="empty-search"><FileSearch size={30} /><h2>No results found</h2><p>Check the spelling or try a broader phrase.</p></div> : <div className="search-results">{groups.filter((group) => group.items.length).map((group) => { const GroupIcon = group.icon; return <section key={group.title}><div className="result-group-title"><span><GroupIcon size={17} /></span><h2>{group.title}</h2><small>{group.items.length}</small></div><div>{group.items.map((item) => <button key={item.id} onClick={item.action}><span className="result-type-icon"><GroupIcon size={18} /></span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><em>{item.badge}</em><ChevronRight size={16} /></button>)}</div></section>; })}</div>}
  </div>;
}
