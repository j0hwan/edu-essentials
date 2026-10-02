"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, PanelRightClose, PanelRightOpen, Plus, SlidersHorizontal, ArrowRight, CircleAlert } from "lucide-react";
import { addDays, dateLabel, isDate, type Course, type CourseDetails } from "../lib/academics";
import { calendarDays, calendarTime, placeCalendarItems, timeMinutes, type CalendarView } from "../lib/calendar-layout";
import type { SavedAssignment, SavedEvent } from "../lib/workspace-codec";
import "./calendar.css";

type Item = {
  id: string; date: string; time: string; endTime?: string; title: string; subtitle: string;
  color: string; kind: "class" | "event" | "deadline"; allDay: boolean; done?: boolean;
  source: Course | SavedEvent | SavedAssignment;
};
type Props = {
  courses: Course[]; assignments: SavedAssignment[]; events: SavedEvent[]; details: Record<string, CourseDetails>;
  today: string; monday: boolean; timezone: string; filter: string;
  onView: (view: CalendarView) => void; onFilter: (filter: string) => void;
  onAssignment: (a: SavedAssignment) => void; onEvent: (e: SavedEvent) => void; onCourse: (c: Course) => void; onAdd: (date: string) => void;
};
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const itemStyle = (item: Item) => ({ "--event-color": item.color } as CSSProperties);

export default function AcademicCalendar({ courses, assignments, events, details, today, monday, timezone, filter, onView, onFilter, onAssignment, onEvent, onCourse, onAdd }: Props) {
  // Every visit opens in Week; changing tabs never changes the underlying account data.
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [sidebar, setSidebar] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleKinds, setVisibleKinds] = useState({ class: true, event: true, deadline: true });
  const [allUpcoming, setAllUpcoming] = useState(false);
  const days = useMemo(() => calendarDays(anchor, view, monday), [anchor, view, monday]);
  const start = days[0], last = days[days.length - 1];
  const first = anchor.slice(0, 7) + "-01";
  const itemsByDate = useMemo(() => {
    const result = new Map<string, Item[]>();
    const matches = (id: string) => filter === "all" || (filter === "personal" ? id === "" : id === filter);
    const courseMap = new Map(courses.map((course) => [course.id, course]));
    const put = (item: Item) => { if (visibleKinds[item.kind]) result.set(item.date, [...(result.get(item.date) ?? []), item]); };
    for (const a of assignments) if (a.dateKey && matches(a.courseId)) put({ id: `assignment-${a.id}`, date: a.dateKey, time: a.dueTime ?? "", title: a.title, subtitle: courseMap.get(a.courseId)?.code ?? "Personal", color: "#ffcf62", kind: "deadline", allDay: true, done: a.status === "done", source: a });
    for (const e of events) if (matches(e.courseId)) put({ id: `event-${e.id}`, date: e.dateKey, time: e.time, title: e.title, subtitle: courseMap.get(e.courseId)?.code ?? e.type, color: e.type === "Exam" ? "#ffcf62" : courseMap.get(e.courseId)?.color ?? "#8ae6a4", kind: e.type === "Exam" ? "deadline" : "event", allDay: !e.time, source: e });
    // Generate only the visible range plus the sidebar's next 30 days.
    const dates = new Set([...days, selected, ...Array.from({ length: 30 }, (_, i) => addDays(selected, i + 1))]);
    for (const date of dates) for (const c of courses) if (matches(c.id)) {
      for (const m of details[c.id]?.meetings ?? []) if (date >= m.from && date <= m.until && m.days.includes(new Date(date + "T12:00:00Z").getUTCDay())) {
        put({ id: `class-${c.id}-${m.id}`, date, time: m.start, endTime: m.end, title: c.name || c.code, subtitle: [c.code, m.location || c.room].filter(Boolean).join(" · "), color: c.color, kind: "class", allDay: false, source: c });
      }
    }
    result.forEach((items) => items.sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title)));
    return result;
  }, [assignments, events, courses, details, filter, visibleKinds, selected, days]);
  const rows = (date: string) => itemsByDate.get(date) ?? [];
  const open = (item: Item) => {
    if (item.kind === "class") onCourse(item.source as Course);
    else if (item.id.startsWith("assignment-")) onAssignment(item.source as SavedAssignment);
    else onEvent(item.source as SavedEvent);
  };
  const chooseDate = (date: string) => { if (isDate(date)) { setAnchor(date); setSelected(date); setAllUpcoming(false); } };
  const move = (offset: number) => {
    if (view !== "month") { chooseDate(addDays(anchor, offset * (view === "week" ? 7 : 1))); return; }
    const date = new Date(first + "T12:00:00Z"); date.setUTCMonth(date.getUTCMonth() + offset); chooseDate(date.toISOString().slice(0, 10));
  };
  const period = view === "month" ? dateLabel(first, { month: "long", year: "numeric" }) : view === "day" ? dateLabel(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : start.slice(0, 7) === last.slice(0, 7) ? `${dateLabel(start, { month: "long", day: "numeric" })} – ${Number(last.slice(-2))}, ${last.slice(0, 4)}` : `${dateLabel(start)} – ${dateLabel(last)}`;
  const timedItems = days.flatMap((date) => rows(date).filter((item) => !item.allDay));
  // Events have a start time only. A one-hour display slot is not a saved duration.
  const timed = (item: Item) => ({ ...item, start: timeMinutes(item.time), end: item.endTime ? timeMinutes(item.endTime) : Math.min(1440, timeMinutes(item.time) + 60) });
  const firstHour = Math.min(8, ...timedItems.map((item) => Math.floor(timeMinutes(item.time) / 60)));
  const lastHour = Math.min(24, Math.max(21, ...timedItems.map((item) => Math.ceil(timed(item).end / 60))));
  const totalMinutes = (lastHour - firstHour) * 60;
  const hourLabels = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const nowParts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const nowMinutes = Number(nowParts.find((p) => p.type === "hour")?.value) * 60 + Number(nowParts.find((p) => p.type === "minute")?.value);
  const upcoming = Array.from({ length: 30 }, (_, i) => addDays(selected, i + 1)).flatMap(rows).filter((item) => !item.done);
  const timezoneLabel = (timezone || Intl.DateTimeFormat().resolvedOptions().timeZone).replaceAll("_", " ").split("/").pop();
  const itemLabel = (item: Item) => `${item.title}, ${calendarTime(item.time)}${item.endTime ? ` – ${calendarTime(item.endTime)}` : ""}, ${item.subtitle}${item.done ? ", completed" : ""}`;
  const sidebarRow = (item: Item, upcomingRow = false) => <button key={`${item.date}-${item.id}`} className={`planner-agenda-item ${item.done ? "is-complete" : ""}`} style={itemStyle(item)} onClick={() => open(item)}>
    <time>{upcomingRow ? dateLabel(item.date, { weekday: "short", month: "short", day: "numeric" }) : calendarTime(item.time)}</time>
    <span className="planner-agenda-copy"><i className="planner-dot" /><strong>{item.title}</strong><small>{upcomingRow ? `${calendarTime(item.time)} · ` : ""}{item.subtitle}</small>{item.kind === "deadline" && <em>{item.done ? "Done" : "Due"}</em>}</span>
  </button>;

  return <div className="page calendar-page planner-page">
    <header className="planner-heading"><p className="eyebrow">Calendar</p><h1>{view === "month" ? period : "Calendar"}</h1>{view !== "month" && <p className="planner-period">{period}</p>}</header>
    <div className="planner-toolbar">
      <div className="planner-navigation">
        <button className="planner-control planner-today" onClick={() => chooseDate(today)}>Today</button>
        <button className="planner-control planner-icon" aria-label="Previous period" disabled={anchor <= "1900-02-01"} onClick={() => move(-1)}><ChevronLeft /></button>
        <button className="planner-control planner-icon" aria-label="Next period" disabled={anchor >= "2200-11-30"} onClick={() => move(1)}><ChevronRight /></button>
        <label className="planner-date-control"><span className="planner-sr-only">Go to date</span><span aria-hidden="true">{view === "month" ? period : dateLabel(anchor, { month: "short", day: "numeric", year: "numeric" })}<CalendarDays /></span><input aria-label="Go to date" type="date" min="1900-01-01" max="2200-12-31" value={anchor} onChange={(e) => chooseDate(e.target.value)} /></label>
        <span className="planner-zone" title={`All meeting and due times use ${timezone || "your device time zone"}. Change your time zone in Settings.`}><Clock3 />{timezoneLabel}</span>
      </div>
      <div className="planner-actions">
        <div className="planner-view-toggle" role="group" aria-label="Calendar view">{(["month", "week", "day"] as const).map((v) => <button key={v} aria-pressed={view === v} onClick={() => { setView(v); onView(v); setAnchor(selected); }}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
        <label className="planner-course-filter"><span className="planner-sr-only">Class filter</span><select value={filter} onChange={(e) => onFilter(e.target.value)}><option value="all">All courses</option><option value="personal">Personal</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label>
        <div className="planner-filter-wrap"><button className="planner-control planner-icon" aria-label="Filter calendar items" aria-expanded={filtersOpen} aria-controls="calendar-item-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal /></button>{filtersOpen && <fieldset id="calendar-item-filters" className="planner-filter-popover"><legend>Show in calendar</legend>{([['class', 'Classes'], ['event', 'Events'], ['deadline', 'Deadlines / exams']] as const).map(([kind, label]) => <label key={kind}><input type="checkbox" checked={visibleKinds[kind]} onChange={(e) => setVisibleKinds({ ...visibleKinds, [kind]: e.target.checked })} />{label}</label>)}</fieldset>}</div>
        <button className="planner-control planner-icon" aria-label={sidebar ? "Hide day details" : "Show day details"} title={sidebar ? "Hide day details" : "Show day details"} aria-expanded={sidebar} aria-controls="calendar-day-details" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelRightClose /> : <PanelRightOpen />}</button>
        <button className="planner-add" onClick={() => onAdd(selected)}><Plus />Add event</button>
      </div>
    </div>
    <div className="planner-legend" aria-label="Calendar colors">{courses.filter((c) => filter === "all" || c.id === filter).map((c) => <span key={c.id} style={{ "--event-color": c.color } as CSSProperties}><i className="planner-dot" />{c.name || c.code}</span>)}<span style={{ "--event-color": "#8ae6a4" } as CSSProperties}><i className="planner-dot" />Personal / Study</span><span style={{ "--event-color": "#ffcf62" } as CSSProperties}><i className="planner-dot" />Deadline / Exam</span></div>
    <div className={`planner-layout ${sidebar ? "has-details" : ""}`}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The named overflow region needs keyboard focus for arrow-key scrolling. */}
      <div className={`academic-calendar academic-calendar-${view} planner-calendar`} role="region" aria-label={`${view} calendar`} tabIndex={0}>
        {view === "month" ? <div className="planner-month">
          <div className="calendar-weekdays planner-weekdays">{Array.from({ length: 7 }, (_, i) => <span key={i}>{weekdays[(i + (monday ? 1 : 0)) % 7]}</span>)}</div>
          <div className="academic-days planner-month-days">{days.map((date) => <section key={date} aria-label={date} className={`academic-day planner-month-day ${date === selected ? "is-selected" : ""} ${date === today ? "is-today" : ""} ${date.slice(0, 7) !== first.slice(0, 7) ? "is-outside" : ""}`}>
            <button className="planner-day-number" disabled={!isDate(date)} aria-label={`Select ${dateLabel(date)}`} aria-pressed={date === selected} onClick={() => { setSelected(date); setAllUpcoming(false); }}><span>{Number(date.slice(-2))}</span></button>
            {rows(date).slice(0, 3).map((item) => <button key={item.id} className={`calendar-chip planner-month-item ${item.done ? "is-complete" : ""}`} style={itemStyle(item)} title={itemLabel(item)} onClick={() => open(item)}><i className="planner-dot" /><span>{item.time && `${calendarTime(item.time).replace(":00", "")} `}{item.title}</span></button>)}
            {rows(date).length > 3 && <button className="planner-more" onClick={() => { setSelected(date); setSidebar(true); }}>{rows(date).length - 3} more</button>}
          </section>)}</div>
        </div> : <div className={`planner-time-grid ${view === "day" ? "is-day-view" : ""}`} style={{ "--day-count": days.length, "--hour-count": lastHour - firstHour } as CSSProperties}>
          <div className="planner-time-head"><span className="planner-time-corner" />{days.map((date) => <button key={date} className={`planner-time-date ${date === today ? "is-today" : ""} ${date === selected ? "is-selected" : ""}`} aria-label={`Select ${dateLabel(date)}`} aria-pressed={date === selected} onClick={() => { setSelected(date); setAllUpcoming(false); }}><span>{dateLabel(date, { weekday: "short" })}</span><strong>{date === today ? Number(date.slice(-2)) : dateLabel(date, { month: "short", day: "numeric" })}</strong></button>)}</div>
          <div className="planner-deadlines"><span>Deadlines<br /><small>/ All day</small></span>{days.map((date) => <div key={date} className={date === today ? "is-today" : ""}>{rows(date).filter((item) => item.allDay).map((item) => <button key={item.id} className={`calendar-chip planner-deadline ${item.done ? "is-complete" : ""}`} style={itemStyle(item)} title={itemLabel(item)} onClick={() => open(item)}><CircleAlert /><span>{item.title}{item.time && ` · ${calendarTime(item.time)}`}</span></button>)}</div>)}</div>
          <div className="planner-time-body"><div className="planner-hours">{hourLabels.map((hour) => <span key={hour} style={{ top: `${(hour - firstHour) / (lastHour - firstHour) * 100}%` }}>{hour % 12 || 12} {hour >= 12 ? "PM" : "AM"}</span>)}</div>
            {days.map((date) => <section key={date} aria-label={date} className={`academic-day planner-time-day ${date === today ? "is-today" : ""}`}>
              {placeCalendarItems(rows(date).filter((item) => !item.allDay).map(timed).map((item) => ({ ...item, end: Math.min(1440, Math.max(item.end, item.start + 30)) }))).map((item) => <button key={item.id} className="calendar-chip planner-time-event" title={`${itemLabel(item)}${!item.endTime ? ". Displayed in a one-hour slot; no end time set." : ""}`} onClick={() => open(item)} style={{ ...itemStyle(item), top: `${(item.start - firstHour * 60) / totalMinutes * 100}%`, height: `${(item.end - item.start) / totalMinutes * 100}%`, left: `calc(${item.lane / item.lanes * 100}% + 3px)`, width: `calc(${100 / item.lanes}% - 6px)` }}><strong>{item.title}</strong><span>{calendarTime(item.time)}{item.endTime && ` – ${calendarTime(item.endTime)}`}</span><small>{item.subtitle}</small></button>)}
              {date === today && nowMinutes >= firstHour * 60 && nowMinutes < lastHour * 60 && <div className="planner-now" aria-label="Current time" style={{ top: `${(nowMinutes - firstHour * 60) / totalMinutes * 100}%` }}><span /></div>}
            </section>)}
          </div>
        </div>}
      </div>
      {sidebar && <aside id="calendar-day-details" className="planner-details" aria-label="Day details">
        <header><h2>{dateLabel(selected, { weekday: "long", month: "long", day: "numeric" })}</h2><button className="planner-details-close" aria-label="Close day details" onClick={() => setSidebar(false)}><PanelRightClose /></button></header>
        <span className="planner-date-badge">{selected === today ? "Today" : dateLabel(selected, { year: "numeric" })}</span>
        <div className="planner-day-agenda">{rows(selected).length ? rows(selected).map((item) => sidebarRow(item)) : <p className="planner-empty">Nothing scheduled.<br /><span>A little room to breathe.</span></p>}</div>
        <button className="planner-add planner-add-day" onClick={() => onAdd(selected)}><Plus />Add to this day</button>
        <div className="planner-upcoming"><header><h3>Upcoming</h3>{upcoming.length > 3 && <button onClick={() => setAllUpcoming(!allUpcoming)}>{allUpcoming ? "Show less" : "View all"}<ArrowRight /></button>}</header>{upcoming.length ? upcoming.slice(0, allUpcoming ? undefined : 3).map((item) => sidebarRow(item, true)) : <p className="planner-empty">You’re all caught up.<br /><span>No items in the next 30 days.</span></p>}</div>
      </aside>}
    </div>
    <p className="planner-footnote">Times shown in {timezone || "your device time zone"}. Select a day for details or an item to edit it.</p>
  </div>;
}
