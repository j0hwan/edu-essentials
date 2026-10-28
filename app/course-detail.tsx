"use client";

import { CalendarDays, FileText, Plus, Trash2, Upload, X } from "lucide-react";
import type { RefObject } from "react";
import { formatExpandedMeetingLocation } from "../lib/meeting-location-preview";
import { calendarTime } from "../lib/calendar-layout";
import type { Course, CourseDetails } from "../lib/academics";
import type { PrivateFile } from "../lib/files";
import type { SavedAssignment } from "../lib/workspace-codec";
import ClassMeetingWeek from "./class-meeting-week";
import ClassCardExpansion from "./class-card-expansion";
import CourseEditTransition, { CourseEditTransitionList } from "./course-edit-transition";
import MeetingLocationPreview from "./meeting-location-preview";
import { InlineFilePreview } from "./private-files";
import { AssignmentTable } from "./assignment-table";
import CourseVisual from "./course-visual";
import type { FileStore } from "./use-private-files";

export type CourseDetailProps = {
  course: Course;
  assignments: SavedAssignment[];
  details: CourseDetails;
  image?: PrivateFile;
  profileId: string;
  sessionGeneration: number;
  today: string;
  store: FileStore;
  filesReady: boolean;
  restored: boolean;
  cacheEnabled: boolean;
  skipOpeningAnimation: boolean;
  suspended: boolean;
  closeControlRef: RefObject<(() => void) | null>;
  canWriteFiles: boolean;
  profilePending: boolean;
  getCourse: (courseId: string) => Course;
  onCloseStart?: () => void;
  onClose: () => void;
  onSelectAssignment: (assignment: SavedAssignment) => void;
  onAddAssignment: (course: Course) => void;
  onEditCourse: (course: Course, details: CourseDetails) => void;
  onViewSchedule: (courseId: string) => void;
  onImportSyllabus: (course: Course) => void;
  onDeleteSyllabus: (course: Course, details: CourseDetails) => void;
};

export default function CourseDetail({
  course,
  assignments,
  details,
  image,
  profileId,
  sessionGeneration,
  today,
  store,
  filesReady,
  restored,
  cacheEnabled,
  skipOpeningAnimation,
  suspended,
  closeControlRef,
  canWriteFiles,
  profilePending,
  getCourse,
  onCloseStart,
  onClose,
  onSelectAssignment,
  onAddAssignment,
  onEditCourse,
  onViewSchedule,
  onImportSyllabus,
  onDeleteSyllabus,
}: CourseDetailProps) {
  const meetingTime = (time: string) => calendarTime(time).replace(" ", "").toLowerCase();
  const meetingDays = (days: number[]) => {
    const names = days.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]);
    const label = names.join(", ");
    return (label.length > 30 ? names.map((name) => name.slice(0, 3)).join(", ") : label) || "No days entered";
  };
  const items = assignments.filter((assignment) => assignment.courseId === course.id);
  const syllabusFile = store.files.find((file) => file.id === details.syllabusFileId && file.kind === "syllabus" && file.state === "ready" && !file.trashed_at);
  const hasSyllabusPreview = Boolean(syllabusFile || details.syllabusText);

  return <ClassCardExpansion key={`${profileId}:${course.id}`} courseId={course.id} skipOpeningAnimation={skipOpeningAnimation} closeControlRef={closeControlRef} onCloseStart={onCloseStart} onClose={onClose} suspended={suspended}>{(close) => <>
    <CourseVisual course={course} details={details} image={image} profileId={profileId} store={store} filesReady={filesReady} restored={restored} cacheEnabled={cacheEnabled} close={close} />
    <div className="expanded-class-body">
      <div className="expanded-class-heading"><div className="expanded-class-title"><h2><CourseEditTransition revision={course.code}><span className="expanded-class-code">{course.code} · </span></CourseEditTransition><CourseEditTransition revision={course.name}><span data-course-morph="name">{course.name}</span></CourseEditTransition><span className="expanded-class-metadata">· <CourseEditTransition revision={course.instructor}><span data-course-morph="instructor">{course.instructor || "No instructor entered"}</span></CourseEditTransition> · <CourseEditTransition revision={String(course.credits)}><span data-course-morph="credits">{course.credits} credits</span></CourseEditTransition></span></h2></div>
      <div className="expanded-class-actions"><button className="primary-button" onClick={() => onAddAssignment(course)}><Plus size={15} />Add assignment</button><button className="secondary-button" onClick={() => onEditCourse(course, details)}>Edit class</button></div>
      </div>
      <div className="expanded-class-grid">
        <section className="expanded-class-section expanded-class-details" aria-label="Course meeting notes"><h3>Meeting Notes</h3><CourseEditTransition revision={details.meetingNotes?.trim() || ""}><p>{details.meetingNotes?.trim() || "No meeting notes entered"}</p></CourseEditTransition></section>
        <section className="expanded-class-section expanded-class-schedule" aria-label="Course schedule">
          <div className={`expanded-class-meetings${details.meetings.length % 2 === 1 ? " expanded-class-meetings-odd" : ""}`}><CourseEditTransitionList>{details.meetings.length ? details.meetings.map((meeting, index) => <div className="expanded-class-meeting" key={meeting.id}><CourseEditTransition revision={meeting.name || `Meeting ${index + 1}`}><h3>{meeting.name || `Meeting ${index + 1}`}</h3></CourseEditTransition><p><CourseEditTransition revision={meetingDays(meeting.days)}><span>{meetingDays(meeting.days)}</span></CourseEditTransition><br /><CourseEditTransition revision={`${meetingTime(meeting.start)}–${meetingTime(meeting.end)}`}><span>{meetingTime(meeting.start)}–{meetingTime(meeting.end)}</span></CourseEditTransition><br /><CourseEditTransition revision={formatExpandedMeetingLocation(meeting.location || course.room)}><span>{formatExpandedMeetingLocation(meeting.location || course.room) || "No location entered"}</span></CourseEditTransition></p><CourseEditTransition revision={meeting.location || course.room}><MeetingLocationPreview location={meeting.location || course.room} /></CourseEditTransition></div>) : [<p key="empty">No recurring meetings entered.</p>]}</CourseEditTransitionList></div>
          <div className="expanded-class-actions"><button className="secondary-button" onClick={() => onViewSchedule(course.id)}><CalendarDays size={15} />View schedule</button></div>
          <ClassMeetingWeek meetings={details.meetings} today={today} />
        </section>
        <section className="expanded-class-section expanded-class-syllabus" aria-label="Course syllabus">
          <div className="expanded-class-syllabus-header">
            <h3>Syllabus</h3>
            <div className="expanded-class-actions">
              <button className="secondary-button" disabled={!canWriteFiles || profilePending || store.busy} onClick={() => onImportSyllabus(course)}><Upload size={15} />Import syllabus</button>
              {(details.syllabusFileId || details.syllabusText) && <button className="secondary-button" disabled={!canWriteFiles || profilePending || store.busy} onClick={() => onDeleteSyllabus(course, details)}><Trash2 size={15} aria-hidden="true" />Delete Syllabus</button>}
            </div>
          </div>
          {!hasSyllabusPreview && details.syllabusFileId && <p>The attached syllabus file is unavailable. Import a replacement to preview it.</p>}
          <CourseEditTransition revision={JSON.stringify([syllabusFile?.id, syllabusFile?.content_revision, syllabusFile ? null : details.syllabusText])}><div className="expanded-class-syllabus-preview" role="region" aria-label="Syllabus preview">{!hasSyllabusPreview ? <div className="expanded-class-syllabus-empty"><X size={36} aria-hidden="true" /><span>No Uploaded Syllabus</span></div> : syllabusFile ? <InlineFilePreview key={`${profileId}:${sessionGeneration}:${syllabusFile.id}`} file={syllabusFile} store={store} loadingFallback={<div className="expanded-class-syllabus-loading" role="status"><FileText size={28} aria-hidden="true" /><span>Loading Syllabus</span></div>} /> : <pre className="syllabus-source">{details.syllabusText}</pre>}</div></CourseEditTransition>
          <CourseEditTransition revision={JSON.stringify([Boolean(syllabusFile), details.syllabusText])}>{syllabusFile && details.syllabusText ? <details className="expanded-class-syllabus-text"><summary>Saved syllabus text</summary><pre className="syllabus-source">{details.syllabusText}</pre></details> : null}</CourseEditTransition>
        </section>
      </div>
      <section className="expanded-class-section"><h3>Assignments</h3><AssignmentTable items={items} compact courseFor={getCourse} onSelectAssignment={onSelectAssignment} /></section>
    </div>
  </>}</ClassCardExpansion>;
}
