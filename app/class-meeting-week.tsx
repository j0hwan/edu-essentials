"use client";

import { useId, useState } from "react";
import { addDays, dateLabel, meetingOccursOn, weekStart, type Meeting } from "../lib/academics";

function MeetingLabel({ name, label }: { name: string; label: string }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  return <span className="expanded-class-weekday-meeting-anchor" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <span className="expanded-class-weekday-meeting" aria-label={name} aria-describedby={open ? tooltipId : undefined}>{label}</span>
    {open && <span className="expanded-class-weekday-tooltip" id={tooltipId} role="tooltip">{name}</span>}
  </span>;
}

export default function ClassMeetingWeek({ meetings, today }: { meetings: Meeting[]; today: string }) {
  const start = weekStart(today, false);
  return <ul className="expanded-class-weekdays" aria-label="Meeting schedule for this week">
    {Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addDays(start, dayIndex);
      return <li key={date}>
        <time dateTime={date} title={dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>{dateLabel(date, { weekday: "short" })}</time>
        <div className="expanded-class-weekday-meetings">
          {meetings.map((meeting, meetingIndex) => {
            if (meeting.until < today || !meetingOccursOn(meeting, date)) return null;
            const name = meeting.name?.trim() || `Meeting ${meetingIndex + 1}`;
            const label = name.replace(/^Meeting (\d+)$/, "Meet$1");
            return <MeetingLabel key={meeting.id} name={name} label={Array.from(label).slice(0, 5).join("")} />;
          })}
        </div>
      </li>;
    })}
  </ul>;
}
