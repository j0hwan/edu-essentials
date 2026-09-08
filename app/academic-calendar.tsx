"use client";
import { useState } from "react";
import { addDays, dateLabel, isDate, weekStart, type Course, type CourseDetails } from "../lib/academics";
import type { SavedAssignment, SavedEvent } from "../lib/workspace-codec";
export default function AcademicCalendar({ courses, assignments, events, details, today, monday, timezone, view, filter, onView, onFilter, onAssignment, onEvent, onCourse, onAdd }: { courses: Course[]; assignments: SavedAssignment[]; events: SavedEvent[]; details: Record<string, CourseDetails>; today: string; monday: boolean; timezone: string; view: "month" | "week" | "day"; filter: string; onView: (view: "month" | "week" | "day") => void; onFilter: (filter: string) => void; onAssignment: (a: SavedAssignment) => void; onEvent: (e: SavedEvent) => void; onCourse: (c: Course) => void; onAdd: () => void }) {
  const [anchor, setAnchor] = useState(today);
  const first = anchor.slice(0, 7) + "-01";
  const start = view === "month" ? weekStart(first, monday) : view === "week" ? weekStart(anchor, monday) : anchor;
  const days = Array.from({ length: view === "month" ? 42 : view === "week" ? 7 : 1 }, (_, i) => addDays(start, i));
  const matches = (id: string) => filter === "all" || (filter === "personal" ? id === "" : id === filter);
  const move = (offset: number) => { if (view !== "month") { setAnchor(addDays(anchor, offset * (view === "week" ? 7 : 1))); return; } const date = new Date(first + "T12:00:00Z"); date.setUTCMonth(date.getUTCMonth() + offset); setAnchor(date.toISOString().slice(0, 10)); };
  return <div className="page calendar-page"><div className="page-heading"><div><p className="eyebrow">Planning</p><h1>Calendar</h1><p>Dates and meeting times use {timezone || "your device time zone"}.</p></div><button className="primary-button" onClick={onAdd}>Add event</button></div>
    <div className="calendar-toolbar"><div className="calendar-title-controls"><button className="secondary-button" onClick={() => setAnchor(today)}>Today</button><button className="secondary-button" aria-label="Previous period" disabled={anchor <= "1900-02-01"} onClick={() => move(-1)}>←</button><button className="secondary-button" aria-label="Next period" disabled={anchor >= "2200-11-30"} onClick={() => move(1)}>→</button><h2>{view === "month" ? dateLabel(first, { month: "long", year: "numeric" }) : view === "week" ? `${dateLabel(start)} – ${dateLabel(days[6])}` : dateLabel(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2></div><div className="view-toggle">{(["month", "week", "day"] as const).map((v) => <button key={v} aria-pressed={view === v} className={view === v ? "active" : ""} onClick={() => onView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div></div>
    <div className="calendar-filters"><label>Class filter<select value={filter} onChange={(e) => onFilter(e.target.value)}><option value="all">All classes and personal</option><option value="personal">Personal</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label><label>Go to date<input type="date" min="1900-01-01" max="2200-12-31" value={anchor} onChange={(e) => { if (isDate(e.target.value)) setAnchor(e.target.value); }} /></label></div>
    <div className={`academic-calendar academic-calendar-${view}`}>
      {view === "month" && <div className="calendar-weekdays">{Array.from({ length: 7 }, (_, i) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(i + (monday ? 1 : 0)) % 7]).map((day) => <span key={day}>{day}</span>)}</div>}
      <div className="academic-days">{days.map((date) => {
        const rows = [
          ...assignments.filter((a) => a.dateKey === date && matches(a.courseId)).map((a) => ({ id: a.id, time: a.dueTime ?? "", text: `${a.type ?? "Assignment"}: ${a.title}`, courseId: a.courseId, action: () => onAssignment(a), kind: a.status })),
          ...events.filter((e) => e.dateKey === date && matches(e.courseId)).map((e) => ({ id: e.id, time: e.time, text: e.title, courseId: e.courseId, action: () => onEvent(e), kind: "event" })),
          ...courses.filter((c) => matches(c.id)).flatMap((c) => (details[c.id]?.meetings ?? []).filter((m) => date >= m.from && date <= m.until && m.days.includes(new Date(date + "T12:00:00Z").getUTCDay())).map((m) => ({ id: c.id + m.id, time: m.start, text: `${c.code} class · ${m.location || c.room} · until ${m.end}`, courseId: c.id, action: () => onCourse(c), kind: "event" }))),
        ].sort((a, b) => a.time.localeCompare(b.time) || a.text.localeCompare(b.text));
        return <section key={date} className={`academic-day ${date === today ? "is-today" : ""} ${view === "month" && date.slice(0, 7) !== first.slice(0, 7) ? "muted" : ""}`} aria-label={date}><button className="day-number" onClick={() => { setAnchor(date); onView("day"); }}>{view === "month" ? Number(date.slice(-2)) : dateLabel(date, { weekday: "short", month: "short", day: "numeric" })}{date === today && " · Today"}</button>{rows.map((row) => <button key={row.id} className={`calendar-chip ${row.kind}`} onClick={row.action}><strong>{row.time || "All day"} · {row.text}</strong><small>{courses.find((c) => c.id === row.courseId)?.code ?? "Personal"}</small></button>)}{!rows.length && <p className="form-hint">No items</p>}</section>;
      })}</div>
    </div>
  </div>;
}
