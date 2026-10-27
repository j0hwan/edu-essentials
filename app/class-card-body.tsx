import { AlertOctagon, Circle, Clock3 } from "lucide-react";
import type { Course } from "../lib/academics";

export default function ClassCardBody({ course, overdue = 0, today = 0, later = 0 }: { course: Course; overdue?: number; today?: number; later?: number }) {
  return <div className="class-card-body">
    <div><h3 data-course-morph="name">{course.name}</h3><p><span data-course-morph="instructor">{course.instructor}</span> · <span data-course-morph="credits">{course.credits} credits</span></p></div>
    <div className="class-statuses">
      <span className="status-overdue"><AlertOctagon size={14} />{overdue}<small>overdue</small></span>
      <span className="status-today"><Clock3 size={14} />{today}<small>today</small></span>
      <span className="status-later"><Circle size={14} />{later}<small>later</small></span>
    </div>
  </div>;
}
