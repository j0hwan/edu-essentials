"use client";

import { useId, useState, type Ref } from "react";
import { addDays, dateLabel, meetingOccursOn, weekStart, type Meeting } from "../lib/academics";
import { CourseEditTransitionList } from "./course-edit-transition";

function MeetingLabel({ name, label, ref }: { name: string; label: string; ref?: Ref<HTMLSpanElement> }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  return <span ref={ref} className="expanded-class-weekday-meeting-anchor" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <span className="expanded-class-weekday-meeting" aria-label={name} aria-describedby={open ? tooltipId : undefined}>{label}</span>
    {open && <span className="expanded-class-weekday-tooltip" id={tooltipId} role="tooltip">{name}</span>}
  </span>;
}

export default function ClassMeetingWeek({ meetings, today }: { meetings: Meeting[]; today: string }) {
  const start = weekStart(today, false);
  return <ul className="expanded-class-weekdays" aria-label="Meeting schedule for this week">
    {Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addDays(start, dayIndex);
      const scheduledMeetings = meetings.flatMap((meeting, meetingIndex) => {
        if (meeting.until < today || !meetingOccursOn(meeting, date)) return [];
        const name = meeting.name?.trim() || `Meeting ${meetingIndex + 1}`;
        return [{ id: meeting.id, name, label: Array.from(name.replace(/^Meeting (\d+)$/, "Meet$1")).slice(0, 5).join("") }];
      });
      return <li key={date} aria-current={date === today ? "date" : undefined}>
        <time dateTime={date} title={dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>{dateLabel(date, { weekday: "short" })}</time>
        <div className="expanded-class-weekday-meetings">
          <CourseEditTransitionList revisions={Object.fromEntries(scheduledMeetings.map((meeting) => [meeting.id, JSON.stringify([meeting.name, meeting.label])]))}>{scheduledMeetings.map((meeting) => <MeetingLabel key={meeting.id} name={meeting.name} label={meeting.label} />)}</CourseEditTransitionList>
        </div>
      </li>;
    })}
  </ul>;
}
