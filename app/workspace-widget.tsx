"use client";

import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  FileSearch,
  FileText,
  Flame,
  FolderOpen,
  GraduationCap,
  MoreHorizontal,
  Quote as QuoteIcon,
  Save,
  Target,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { addDays, dateLabel, meetingOccursOn, weekStart, type Course, type CourseDetails } from "../lib/academics";
import type { SaveStatus } from "../lib/autosave";
import { durationLabel, studyStats, type StudyData, type TimerKind } from "../lib/study";
import { defaultTodaySections, type TodaySectionId } from "../lib/today-sections";
import {
  MAX_NOTES_LENGTH,
  MAX_WIDGETS_PER_WORKSPACE,
  type SavedAssignment,
  type SavedEvent,
  type WidgetInstance,
  type WidgetSize,
  type Workspace,
} from "../lib/workspace-codec";
import { resolveWidgetAppearance, widgetAppearanceStyle, type WidgetAppearanceState } from "../lib/widget-appearance";
import { widgetSizeOptions } from "../lib/widget-layout";
import { getWidgetKeyboardResizeSize } from "../lib/widget-resize";
import StudyWidget, { studyWidgetTypes } from "./study-widgets";
import TodaySection from "./today-section";
import { widgetTemplates } from "./workspace-widget-catalog";

export type WidgetPage = "dashboard" | "tasks" | "files" | "calendar";

export type WidgetBodyData = {
  assignments: SavedAssignment[];
  manualEvents: SavedEvent[];
  courses: Course[];
  courseDetails: Record<string, CourseDetails>;
  study: StudyData;
  stats: ReturnType<typeof studyStats>;
  today: string;
  now: Date;
  timezone: string;
  monday: boolean;
  activeGpaSystem: string;
  activeTerm: string;
  filesCreatedAt: readonly string[];
  experimentalMode: boolean;
  miniWeekOffset: number;
  persistenceStatus: SaveStatus;
};

export type WidgetFrameData = {
  activeWorkspace: Workspace;
  widgetAppearance?: WidgetAppearanceState;
  widgetEditingEnabled: boolean;
  openWidgetMenu: string | null;
  closingWidgetMenu: boolean;
};

export type WidgetActions = {
  onNavigate: (destination: WidgetPage) => void;
  onOpenStudy: () => void;
  onAssignment: (assignment: SavedAssignment) => void;
  onEvent: (event: SavedEvent) => void;
  onCourse: (course: Course) => void;
  onTimer: (action: "start" | "pause" | "resume" | "finish" | "reset", kind: TimerKind) => void;
  onOpenDashboardCourse: (course: Course) => void;
  onMiniWeekOffsetChange: (update: (offset: number) => number) => void;
  onToggleMenu: (widgetId: string) => void;
  onOpenResizeMenu: (widgetId: string) => void;
  onCloseMenu: () => void;
  onResize: (widgetId: string, size: WidgetSize) => boolean;
  onMove: (from: number, to: number) => void;
  onDuplicate: (widget: WidgetInstance) => void;
  onRemove: (widgetId: string) => boolean;
  onNoteChange: (widgetId: string, value: string) => void;
  onSaveNote: () => void;
  onFlash: (message: string) => void;
};

type WidgetCardProps = {
  widget: WidgetInstance;
  index: number;
  isDragged?: boolean;
  isResizing?: boolean;
  bodyData: WidgetBodyData;
  frameData: WidgetFrameData;
  actions: WidgetActions;
  widgetMenuRef: RefObject<HTMLDivElement | null>;
  renderStatusBadge: (status: SavedAssignment["status"], compact?: boolean) => ReactNode;
  renderCourseStamp: (course: Course, small?: boolean) => ReactNode;
};

function courseFor(courses: Course[], id: string): Course {
  return courses.find((course) => course.id === id) ?? {
    id,
    code: "Personal",
    name: "Personal",
    credits: 0,
    instructor: "",
    room: "",
    color: "#5b63e8",
    soft: "#eef0ff",
    initials: "P",
  };
}

function appearanceAttributes(appearance: ReturnType<typeof resolveWidgetAppearance>) {
  return {
    "data-wa-icon-style": appearance.iconStyle,
    "data-wa-show-icons": String(appearance.showIcons),
    "data-wa-header-divider": String(appearance.headerDivider),
    "data-wa-accent-edge": appearance.accentEdge,
    "data-wa-hover": appearance.hover,
    "data-wa-content-mode": appearance.contentMode,
    "data-wa-title-align": appearance.titleAlign,
    "data-wa-texture": appearance.texture,
  };
}

export function WorkspaceWidget({
  widget,
  index,
  isDragged = false,
  isResizing = false,
  bodyData,
  frameData,
  actions,
  widgetMenuRef,
  renderStatusBadge,
  renderCourseStamp,
}: WidgetCardProps) {
  const { activeWorkspace, widgetAppearance, widgetEditingEnabled, openWidgetMenu, closingWidgetMenu } = frameData;
  const template = widgetTemplates.find((item) => item.type === widget.type)!;
  const appearance = resolveWidgetAppearance(widgetAppearance, widget.instanceId);
  const resizeIndicatorSize = appearance.radius + 10;
  const resizeIndicatorEdge = resizeIndicatorSize - 1.5;
  const resizeIndicatorRadius = Math.max(0, appearance.radius - 0.5);
  const resizeIndicatorCurve = `V ${resizeIndicatorEdge - resizeIndicatorRadius} A ${resizeIndicatorRadius} ${resizeIndicatorRadius} 0 0 1 ${resizeIndicatorEdge - resizeIndicatorRadius} ${resizeIndicatorEdge}`;
  const resizeIndicatorPath = `M ${resizeIndicatorEdge} 1.5 ${resizeIndicatorCurve} H 1.5`;
  const resizeIndicatorHoverPath = `M ${resizeIndicatorEdge} -2.5 ${resizeIndicatorCurve} H -2.5`;
  const TemplateIcon = widget.type === "today" ? BarChart3 : widget.type === "red-alerts" ? Bell : widget.type === "notes" ? FileText : template.icon;

  return (
    <article
      key={widget.instanceId}
      className={`widget-card widget-${widget.type} ${isDragged ? "widget-reorder-placeholder" : ""}${isResizing ? " widget-resizing" : ""}`}
      data-size={widget.size}
      data-mini-start={widget.size === "mini" && widget.startsNewMiniBlock ? "true" : undefined}
      data-widget-id={widget.instanceId}
      aria-hidden={isDragged ? true : undefined}
      inert={isDragged}
      style={widgetAppearanceStyle(appearance) as CSSProperties}
      {...appearanceAttributes(appearance)}
    >
      <div className="widget-frame">
        <div className="widget-header">
          <span className={`widget-icon tone-${template.color}`}><TemplateIcon size={16} /></span>
          <h2 data-widget-reorder-handle>{({ "daily-goal": "Daily Study Goal", today: "At a Glance", "red-alerts": "Alerts", pomodoro: "Pomodoro", "mini-calendar": "Mini Calendar", "task-completion": "Task Completion", notes: "Quick Notes" } as Record<string, string>)[widget.type] ?? template.title}</h2>
          <div className="menu-wrap">
            <button className="icon-button mini" onClick={() => actions.onToggleMenu(widget.instanceId)} aria-label={`${template.title} options`}><MoreHorizontal size={17} /></button>
          </div>
        </div>
        <div className="widget-body">{renderWidgetBody(widget, bodyData, actions, renderStatusBadge, renderCourseStamp)}</div>
      </div>
      {widgetEditingEnabled && !isDragged && <button
        type="button"
        className="widget-resize-handle"
        style={{ "--widget-resize-border-width": appearance.borderStyle === "none" ? "0px" : "var(--wa-border-width, 1px)" } as CSSProperties}
        data-widget-resize-handle
        aria-label={`Resize ${template.title}`}
        aria-describedby={`widget-resize-size-${widget.instanceId}`}
        aria-haspopup="true"
        title="Drag to resize. Arrow keys change width or height; Enter opens size choices."
        draggable={false}
        onClick={() => actions.onOpenResizeMenu(widget.instanceId)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const nextSize = getWidgetKeyboardResizeSize(widget.size, event.key);
          if (nextSize !== widget.size) actions.onResize(widget.instanceId, nextSize);
        }}
      ><svg aria-hidden="true" viewBox={`0 0 ${resizeIndicatorSize} ${resizeIndicatorSize}`} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{
        "--widget-resize-rest-path": `path("${resizeIndicatorPath}")`,
        "--widget-resize-hover-path": `path("${resizeIndicatorHoverPath}")`,
      } as CSSProperties}>
        <path d={resizeIndicatorPath} />
      </svg></button>}
      {widgetEditingEnabled && !isDragged && <span id={`widget-resize-size-${widget.instanceId}`} className="widget-resize-status" role="status" aria-live="polite">
        {`${template.title} size: ${widgetSizeOptions.find((option) => option.value === widget.size)?.label}`}
      </span>}
      {openWidgetMenu === widget.instanceId && (
        <div className={`popover widget-menu${closingWidgetMenu ? " is-closing" : ""}`} ref={widgetMenuRef} inert={closingWidgetMenu} aria-hidden={closingWidgetMenu || undefined} onAnimationEnd={(event) => {
          if (closingWidgetMenu && event.target === event.currentTarget && event.animationName === "widget-menu-dismiss") actions.onCloseMenu();
        }}>
          <p>Widget size</p>
          <div className="size-options">
            {widgetSizeOptions.map(({ value, label, footprint }) => <button key={value} aria-label={`${label} widget`} aria-pressed={widget.size === value} className={widget.size === value ? "active" : ""} onClick={() => actions.onResize(widget.instanceId, value)}><span>{label}</span><small>{footprint.width} × {footprint.height === 0.5 ? "½" : footprint.height}</small></button>)}
          </div>
          <button onClick={() => actions.onMove(index, index - 1)} disabled={index === 0}><ArrowLeft size={15} /> Move earlier</button>
          <button onClick={() => actions.onMove(index, index + 1)} disabled={index === activeWorkspace.widgets.length - 1}><ArrowRight size={15} /> Move later</button>
          <button disabled={activeWorkspace.widgets.length >= MAX_WIDGETS_PER_WORKSPACE} onClick={() => actions.onDuplicate(widget)}><Copy size={15} /> Duplicate</button>
          <button className="danger" onClick={() => actions.onRemove(widget.instanceId)}><Trash2 size={15} /> Remove</button>
        </div>
      )}
    </article>
  );
}

function renderWidgetBody(
  widget: WidgetInstance,
  data: WidgetBodyData,
  actions: WidgetActions,
  renderStatusBadge: WidgetCardProps["renderStatusBadge"],
  renderCourseStamp: WidgetCardProps["renderCourseStamp"],
): ReactNode {
  const { type } = widget;
  const { assignments, manualEvents, courses, courseDetails, study, stats, today, now, timezone, monday, activeGpaSystem, activeTerm, filesCreatedAt, experimentalMode, miniWeekOffset, persistenceStatus } = data;
  if (type === "today") {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    const classesLeft = courses.filter((course) => (courseDetails[course.id]?.meetings ?? []).some((meeting) => meetingOccursOn(meeting, today) && meeting.end > time)).length;
    const endOfWeek = addDays(weekStart(today, monday), 6);
    const weekTasks = assignments.filter((assignment) => assignment.status !== "done" && assignment.dateKey >= today && assignment.dateKey <= endOfWeek).length;
    const newFiles = experimentalMode ? 0 : filesCreatedAt.filter((createdAt) => createdAt.slice(0, 10) >= weekStart(today, monday)).length;
    return <div className="glance-rows"><button onClick={() => actions.onNavigate("dashboard")}><span className="glance-icon green"><GraduationCap size={23} /></span><strong>{classesLeft}</strong><span>classes left</span><ChevronRight size={15} /></button><button onClick={() => actions.onNavigate("tasks")}><span className="glance-icon purple"><FileText size={21} /></span><strong>{weekTasks}</strong><span>tasks this week</span><ChevronRight size={15} /></button><button onClick={() => actions.onNavigate("files")}><span className="glance-icon pink"><FolderOpen size={22} /></span><strong>{newFiles}</strong><span>new {newFiles === 1 ? "file" : "files"}</span><ChevronRight size={15} /></button></div>;
  }
  if (studyWidgetTypes.includes(type)) return <StudyWidget type={type} data={study} stats={stats} courses={courses} assignments={assignments} events={manualEvents} details={courseDetails} today={today} now={now.getTime()} system={activeGpaSystem} term={activeTerm} onOpen={actions.onOpenStudy} onAssignment={actions.onAssignment} onEvent={actions.onEvent} onCourse={actions.onCourse} onTimer={actions.onTimer} />;
  if (type === "upcoming") return <div className="compact-list">{assignments.filter((item) => item.status !== "done").slice(0, 4).map((assignment) => { const course = courseFor(courses, assignment.courseId); return <button key={assignment.id} className="compact-assignment" onClick={() => actions.onAssignment(assignment)}>{renderStatusBadge(assignment.status, true)}<span><strong>{assignment.title}</strong><small>{course.code} · {assignment.due}</small></span><ChevronRight size={15} /></button>; })}</div>;
  if (type === "stoplight") return <div className="stoplight-summary"><button onClick={() => actions.onNavigate("dashboard")}><span className="stoplight-count red"><AlertOctagon size={17} />{assignments.filter((item) => item.status === "overdue").length}</span><span><strong>Overdue</strong><small>Needs attention</small></span></button><button onClick={() => actions.onNavigate("dashboard")}><span className="stoplight-count amber"><Clock3 size={17} />{assignments.filter((item) => item.status === "today").length}</span><span><strong>Due today</strong><small>Before midnight</small></span></button><button onClick={() => actions.onNavigate("dashboard")}><span className="stoplight-count green"><Circle size={17} />{assignments.filter((item) => item.status === "later").length}</span><span><strong>Upcoming</strong><small>After today</small></span></button></div>;
  if (type === "red-alerts") {
    const next = assignments.find((assignment) => assignment.status !== "done" && assignment.dateKey >= today);
    return <div className="reference-alerts">{next ? <button className="alert-upcoming" onClick={() => actions.onAssignment(next)}><AlertOctagon size={22} /><span><strong>{next.title}</strong><small>{courseFor(courses, next.courseId).code} · {next.dateKey === today ? "Today" : next.dateKey === addDays(today, 1) ? "Tomorrow" : next.due}</small></span><ChevronRight size={15} /></button> : <div className="alert-upcoming"><Bell size={22} /><span><strong>No upcoming deadlines</strong><small>You’re all caught up</small></span></div>}<button className="alert-status" onClick={() => actions.onNavigate("tasks")}><CheckCircle2 size={23} /><span>{assignments.filter((item) => item.status === "overdue").length ? `${assignments.filter((item) => item.status === "overdue").length} overdue ${assignments.filter((item) => item.status === "overdue").length === 1 ? "task" : "tasks"}` : "No overdue work"}</span>{assignments.some((item) => item.status === "overdue") && <ChevronRight size={15} />}</button></div>;
  }
  if (type === "mini-calendar") return <div className="mini-cal"><div className="mini-cal-month"><strong>{dateLabel(addDays(today, miniWeekOffset), { month: "long", year: "numeric" })}</strong><div><button aria-label="Previous week" onClick={() => actions.onMiniWeekOffsetChange((offset) => offset - 7)}><ChevronLeft size={16} /></button><button aria-label="Next week" onClick={() => actions.onMiniWeekOffsetChange((offset) => offset + 7)}><ChevronRight size={16} /></button><button className="mini-today" onClick={() => actions.onMiniWeekOffsetChange(() => 0)}>Today</button></div></div><div className="mini-days">{Array.from({ length: 7 }, (_, index) => addDays(weekStartForWidget(today, monday), index + miniWeekOffset)).map((date) => <button key={date} aria-label={dateLabel(date, { weekday: "long", month: "long", day: "numeric" })} className={date === today ? "today" : ""} onClick={() => actions.onNavigate("calendar")}><small>{dateLabel(date, { weekday: "short" })}</small><strong>{Number(date.slice(-2))}</strong>{(assignments.some((assignment) => assignment.dateKey === date) || manualEvents.some((event) => event.dateKey === date)) && <i />}</button>)}</div></div>;
  if (type === "class-links") return <div className="class-link-grid">{courses.slice(0, 4).map((course) => <button key={course.id} onClick={() => { actions.onNavigate("dashboard"); actions.onOpenDashboardCourse(course); }}>{renderCourseStamp(course, true)}<span><strong>{course.code}</strong><small>{course.name}</small></span><ChevronRight size={14} /></button>)}</div>;
  if (type === "notes") return <div className="notes-widget"><textarea id={`note-${widget.instanceId}`} aria-label="Quick notes" placeholder="Write a quick reminder…" value={widget.note ?? ""} maxLength={MAX_NOTES_LENGTH} onChange={(event) => actions.onNoteChange(widget.instanceId, event.target.value)} /><div className="reference-note-footer"><span className="note-label"><FileText size={13} /> Quick note</span><button className="clear-note" disabled={!widget.note} onClick={() => { if (window.confirm("Clear this note's text?")) actions.onNoteChange(widget.instanceId, ""); }} aria-label="Clear notes"><Trash2 size={13} /></button><button className="primary-button save-note" disabled={persistenceStatus === "saving"} onClick={() => experimentalMode ? actions.onFlash("Preview note updated — nothing saved to your account") : actions.onSaveNote()}><Save size={14} />{persistenceStatus === "saving" ? "Saving…" : "Save note"}</button></div></div>;
  if (type === "quote") return <div className="quote-widget"><QuoteIcon size={24} /><blockquote>Small, focused steps turn heavy weeks into manageable days.</blockquote><span>— Your Edu AI reminder</span></div>;
  return <div className="spacer-widget"><span>Spacer</span><p>This tile creates breathing room. Resize it to shape your layout.</p></div>;
}

function weekStartForWidget(date: string, monday: boolean) {
  return weekStart(date, monday);
}

type TodayPanelData = Pick<WidgetBodyData, "assignments" | "manualEvents" | "courses" | "courseDetails" | "study" | "stats" | "today"> & {
  localTime: string;
  dailyPercent: number;
};

type TodayPanelProps = {
  data: TodayPanelData;
  workspace: Workspace;
  customizing: boolean;
  widgetAppearance?: WidgetAppearanceState;
  todayRemoveDragState: { active: boolean; over: boolean; near: boolean };
  todayRemoveTargetRef: RefObject<HTMLDivElement | null>;
  todayRemoveHitRef: RefObject<HTMLDivElement | null>;
  todayOptionsButtonRef: RefObject<HTMLButtonElement | null>;
  workspaceOptionsButtonRef: RefObject<HTMLButtonElement | null>;
  customizeButtonRef: RefObject<HTMLButtonElement | null>;
  actions: {
    onHiddenChange: (hidden: boolean) => boolean;
    onSectionsChange: (sections: TodaySectionId[]) => boolean;
    onCalendar: () => void;
    onOptionsOpen: () => void;
    onSelectClass: (course: Course) => void;
    onSelectAssignment: (assignment: SavedAssignment) => void;
    onEditEvent: (event: SavedEvent) => void;
    onStudyOpen: () => void;
    onNavigateTasks: () => void;
  };
};

export function HomeTodayPresentation({
  data,
  workspace,
  customizing,
  widgetAppearance,
  todayRemoveDragState,
  todayRemoveTargetRef,
  todayRemoveHitRef,
  todayOptionsButtonRef,
  workspaceOptionsButtonRef,
  customizeButtonRef,
  actions,
}: TodayPanelProps) {
  const { assignments, manualEvents, courses, courseDetails, study, stats, today, localTime, dailyPercent } = data;
  const featuredAssignments = assignments.filter((assignment) => assignment.dateKey === today && assignment.status !== "done");
  const nextClass = courses.flatMap((course) => (courseDetails[course.id]?.meetings ?? []).filter((meeting) => meetingOccursOn(meeting, today) && meeting.end > localTime).map((meeting) => ({ course, meeting }))).sort((first, second) => first.meeting.start.localeCompare(second.meeting.start))[0];
  const timeLabel = (time: string) => /^\d{2}:\d{2}$/.test(time) ? `${Number(time.slice(0, 2)) % 12 || 12}:${time.slice(3)} ${Number(time.slice(0, 2)) >= 12 ? "PM" : "AM"}` : time;
  const schedule = manualEvents.filter((event) => event.dateKey === today).sort((first, second) => first.time.localeCompare(second.time)).map((event) => {
    const course = courseFor(courses, event.courseId);
    return {
      time: event.time || "All day",
      title: event.title,
      detail: course.code === "Personal" ? event.type : course.code,
      color: course.color,
      onOpen: () => actions.onEditEvent(event),
    };
  });
  for (const course of courses) for (const meeting of courseDetails[course.id]?.meetings ?? []) {
    if (meetingOccursOn(meeting, today)) schedule.push({ time: meeting.start, title: course.name, detail: meeting.location || course.room, color: course.color, onOpen: () => actions.onSelectClass(course) });
  }
  schedule.sort((first, second) => first.time.localeCompare(second.time));
  const futureAssignments = assignments.filter((assignment) => assignment.dateKey > today && assignment.status !== "done").slice(0, 3);
  const sections = workspace.todaySections ?? defaultTodaySections;
  const renderTodaySection = (sectionId: TodaySectionId) => {
    switch (sectionId) {
      case "next-class":
        return (
          <section key={sectionId} className="today-panel-section today-next-class" aria-labelledby="next-class-title">
            <div className="today-section-heading"><span className="today-heading-icon"><GraduationCap /></span><h2 id="next-class-title">Next Class</h2></div>
            <div className="next-class-content">{nextClass ? <button onClick={() => actions.onSelectClass(nextClass.course)}><div className="next-class-title"><strong>{nextClass.course.name}</strong><small>{nextClass.meeting.start <= localTime ? "Now" : "Today"}</small></div><p>{timeLabel(nextClass.meeting.start)} | {nextClass.course.code} · {nextClass.meeting.location || nextClass.course.room}</p></button> : <><strong>No more classes today</strong><p>Enjoy a little breathing room.</p></>}</div>
          </section>
        );
      case "due-today":
        return (
          <section key={sectionId} className="today-panel-section" aria-labelledby="today-tasks-title">
            <div className="today-section-heading"><span className="today-heading-icon"><FileText /></span><h2 id="today-tasks-title">Due Today ({featuredAssignments.length})</h2></div>
            <div className="today-task-list">
              {featuredAssignments.length === 0 && <p className="today-empty">Nothing due today.</p>}
              {featuredAssignments.slice(0, 2).map((assignment) => {
                const course = courseFor(courses, assignment.courseId);
                return (
                  <button key={assignment.id} className="today-task-row" onClick={() => actions.onSelectAssignment(assignment)}>
                    <span className="task-circle" aria-hidden="true" />
                    <span className="today-task-copy"><strong>{assignment.title}</strong><small>{course.name}</small></span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        );
      case "schedule":
        return (
          <section key={sectionId} className="today-panel-section today-schedule" aria-labelledby="today-schedule-title">
            <div className="today-section-heading"><span className="today-heading-icon"><CalendarDays /></span><h2 id="today-schedule-title">Today’s Schedule</h2></div>
            <div className="today-schedule-list">
              {schedule.length === 0 && <p className="today-empty">No events yet. Your schedule will appear here.</p>}
              {schedule.slice(0, 3).map((item) => (
                <button key={`${item.time}-${item.title}`} className="today-schedule-row" onClick={item.onOpen}>
                  <time>{timeLabel(item.time)}</time>
                  <span className="today-schedule-copy"><span><i style={{ background: item.color }} aria-hidden="true" />{item.title}</span></span>
                </button>
              ))}
            </div>
          </section>
        );
      case "study-goal":
        return (
          <section key={sectionId} className="today-panel-section" aria-labelledby="today-study-goal-title">
            <div className="today-section-heading"><span className="today-heading-icon"><Target /></span><h2 id="today-study-goal-title">Study Goal</h2></div>
            <div className="today-metric-content">
              {study.dailyMinutes > 0 ? <>
                <div className="today-goal-summary"><strong>{dailyPercent}%</strong><span>{durationLabel(stats.dailySeconds)} of {durationLabel(study.dailyMinutes * 60)}</span></div>
                <div className="today-goal-track" role="progressbar" aria-label="Daily study goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dailyPercent}><span style={{ width: `${dailyPercent}%` }} /></div>
                <p>{dailyPercent >= 100 ? "Today’s study goal is complete." : `${durationLabel(Math.max(0, study.dailyMinutes * 60 - stats.dailySeconds))} left toward today’s target.`}</p>
                <button type="button" className="today-inline-action" onClick={actions.onStudyOpen}>Study details <ArrowRight size={14} /></button>
              </> : <>
                <p className="today-empty">No daily study goal is set yet.</p>
                <button type="button" className="today-inline-action" onClick={actions.onStudyOpen}>Set a study goal <ArrowRight size={14} /></button>
              </>}
            </div>
          </section>
        );
      case "upcoming-deadlines":
        return (
          <section key={sectionId} className="today-panel-section" aria-labelledby="today-upcoming-title">
            <div className="today-section-heading"><span className="today-heading-icon"><FileSearch /></span><h2 id="today-upcoming-title">Upcoming Deadlines</h2></div>
            {futureAssignments.length ? <div className="today-task-list">
              {futureAssignments.map((assignment) => {
                const course = courseFor(courses, assignment.courseId);
                return (
                  <button key={assignment.id} className="today-task-row" onClick={() => actions.onSelectAssignment(assignment)}>
                    <span className="task-circle" aria-hidden="true" />
                    <span className="today-task-copy"><strong>{assignment.title}</strong><small>{course.name} · {dateLabel(assignment.dateKey, { month: "short", day: "numeric" })}</small></span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                );
              })}
            </div> : <div className="today-metric-content"><p className="today-empty">No future deadlines are scheduled.</p><button type="button" className="today-inline-action" onClick={actions.onNavigateTasks}>View assignments <ArrowRight size={14} /></button></div>}
          </section>
        );
      case "study-streak":
        return (
          <section key={sectionId} className="today-panel-section" aria-labelledby="today-streak-title">
            <div className="today-section-heading"><span className="today-heading-icon"><Flame /></span><h2 id="today-streak-title">Study Streak</h2></div>
            <div className="today-metric-content">
              <div className="today-streak-summary"><strong>{stats.streak}</strong><span>{stats.streak === 1 ? "day" : "days"}</span></div>
              <p>{stats.streak > 0 ? "Keep your momentum going with another focused session." : "Start a study session to begin your streak."}</p>
              <button type="button" className="today-inline-action" onClick={actions.onStudyOpen}>{stats.streak > 0 ? "View study log" : "Start studying"} <ArrowRight size={14} /></button>
            </div>
          </section>
        );
    }
  };

  return workspace.todayHidden ? (
    <div
      key="today-removal-drawer"
      ref={todayRemoveTargetRef}
      className="today-remove-target-host today-remove-target-dock"
      data-remove-target-active={todayRemoveDragState.active ? "true" : "false"}
      data-remove-target-over={todayRemoveDragState.over ? "true" : "false"}
      data-remove-target-near={todayRemoveDragState.near ? "true" : "false"}
      aria-hidden={!customizing || undefined}
      inert={!customizing || undefined}
    >
      <div ref={todayRemoveHitRef} className="today-remove-target-overlay" aria-hidden="true"><Trash2 size={24} strokeWidth={2.2} /><span>remove widget</span></div>
    </div>
  ) : (
    <div
      key="today-panel"
      ref={todayRemoveTargetRef}
      className="today-remove-target-host is-visible"
      data-remove-target-active={todayRemoveDragState.active ? "true" : "false"}
      data-remove-target-over={todayRemoveDragState.over ? "true" : "false"}
    >
      <div className="today-remove-target-content" inert={todayRemoveDragState.active || undefined}>
        <TodaySection
          key={workspace.id}
          hidden={Boolean(workspace.todayHidden)}
          sections={sections}
          optionsButtonRef={todayOptionsButtonRef}
          menuStyle={widgetAppearanceStyle(resolveWidgetAppearance(widgetAppearance)) as CSSProperties}
          onHiddenChange={actions.onHiddenChange}
          onSectionsChange={actions.onSectionsChange}
          onCalendar={actions.onCalendar}
          onOptionsOpen={actions.onOptionsOpen}
          onHideFocus={() => window.requestAnimationFrame(() => {
            if (customizing) workspaceOptionsButtonRef.current?.focus();
            else customizeButtonRef.current?.focus();
          })}
        >
          <div className="today-panel-grid" data-section-count={sections.length}>
            {sections.map(renderTodaySection)}
          </div>
        </TodaySection>
      </div>
      {todayRemoveDragState.active && <div className="today-remove-target-overlay" aria-hidden="true"><Trash2 size={24} strokeWidth={2.2} /><span>remove widget</span></div>}
    </div>
  );
}
