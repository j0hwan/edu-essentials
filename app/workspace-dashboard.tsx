"use client";

import type { ComponentProps } from "react";
import { ArrowRight, LayoutGrid, List, Plus } from "lucide-react";
import type { Course, CourseDetails } from "../lib/academics";
import type { PrivateFile } from "../lib/files";
import type { SavedAssignment } from "../lib/workspace-codec";
import type { FileStore } from "./use-private-files";
import AnimatedDashboard from "./animated-dashboard";
import ClassCardBody from "./class-card-body";
import CourseVisual from "./course-visual";
import DashboardLoadTransition from "./dashboard-load-transition";
import DashboardStudyBrief from "./dashboard-study-brief";
import { AssignmentTable, StatusBadge } from "./assignment-table";

type StudyBriefProps = ComponentProps<typeof DashboardStudyBrief>;

export type WorkspaceDashboardProps = {
  loadKey: string;
  ready: boolean;
  restoringCourseOnReload?: boolean;
  restorationChecked?: boolean;
  imagesListed: boolean;
  imageKeys: string[];
  reducedMotion: boolean;
  reflowKey: string;
  skipOpeningAnimation: boolean;
  profileId: string;
  filesReady: boolean;
  cacheEnabled: boolean;
  courses: Course[];
  assignments: SavedAssignment[];
  courseDetails: Record<string, CourseDetails>;
  courseImages: Map<string, PrivateFile | undefined>;
  store: FileStore;
  focusAssignments: SavedAssignment[];
  overdueCount: number;
  dueTodayCount: number;
  completedThisWeek: number;
  dashboardView: "cards" | "list";
  selectedCourseId?: string;
  getCourse: (courseId: string) => Course;
  chatMessages?: StudyBriefProps["chatMessages"];
  chatBusy?: boolean;
  onSelectAssignment: (assignment: SavedAssignment) => void;
  onSelectCourse: (course: Course) => void;
  onAddAssignment: () => void;
  onAddClass: () => void;
  onOpenAssistant: NonNullable<StudyBriefProps["onOpenAssistant"]>;
  onAskAssistant: NonNullable<StudyBriefProps["onAskAssistant"]>;
  onContinueAssistant?: StudyBriefProps["onContinueAssistant"];
  onToggleView: () => void;
  onShowAllAssignments: () => void;
};

export default function WorkspaceDashboard({
  loadKey,
  ready,
  restoringCourseOnReload = false,
  restorationChecked = true,
  imagesListed,
  imageKeys,
  reducedMotion,
  reflowKey,
  skipOpeningAnimation,
  profileId,
  filesReady,
  cacheEnabled,
  courses,
  assignments,
  courseDetails,
  courseImages,
  store,
  focusAssignments,
  overdueCount,
  dueTodayCount,
  completedThisWeek,
  dashboardView,
  selectedCourseId,
  getCourse,
  chatMessages,
  chatBusy,
  onSelectAssignment,
  onSelectCourse,
  onAddAssignment,
  onAddClass,
  onOpenAssistant,
  onAskAssistant,
  onContinueAssistant,
  onToggleView,
  onShowAllAssignments,
}: WorkspaceDashboardProps) {
  return <DashboardLoadTransition key={loadKey} ready={ready} restoringCourseOnReload={restoringCourseOnReload} restorationChecked={restorationChecked} imagesListed={imagesListed} imageKeys={imageKeys} reducedMotion={reducedMotion}>{(onImageSettled, imagesPending) => <AnimatedDashboard reflowKey={reflowKey} reducedMotion={reducedMotion} restoredCourse={skipOpeningAnimation} imagesPending={imagesPending}>
    <DashboardStudyBrief
      reflowKey={reflowKey}
      key={profileId}
      chatMessages={chatMessages}
      chatBusy={chatBusy}
      focusAssignments={focusAssignments}
      overdueCount={overdueCount}
      dueTodayCount={dueTodayCount}
      completedThisWeek={completedThisWeek}
      courseCount={courses.length}
      courseCodeFor={(courseId) => getCourse(courseId).code}
      renderStatusBadge={(status) => <StatusBadge status={status} compact />}
      onSelectAssignment={onSelectAssignment}
      onAddAssignment={onAddAssignment}
      onAddClass={onAddClass}
      onOpenAssistant={onOpenAssistant}
      onAskAssistant={onAskAssistant}
      onContinueAssistant={onContinueAssistant}
      reducedMotion={reducedMotion}
    />
    <section className="dashboard-classes" aria-labelledby="dashboard-classes-title">
      <div className="section-title-row dashboard-classes-heading">
        <h2 id="dashboard-classes-title">Your classes</h2>
        <div className="dashboard-classes-actions">
          <button className="secondary-button" onClick={onAddClass}><Plus size={16} />Add Class</button>
          <button type="button" className="view-toggle" role="switch" aria-label="Dashboard view" aria-checked={dashboardView === "list"} onClick={onToggleView}><span className={dashboardView === "cards" ? "active" : ""}><LayoutGrid size={16} /> Cards</span><span className={dashboardView === "list" ? "active" : ""}><List size={16} /> List</span></button>
        </div>
      </div>
      {dashboardView === "cards" ? (
        <div>
          <div className="class-grid">
            {courses.map((course) => {
              const courseAssignments = assignments.filter((assignment) => assignment.courseId === course.id && assignment.status !== "done");
              return <button key={course.id} className="class-card" data-course-card-id={course.id} aria-haspopup="dialog" aria-expanded={selectedCourseId === course.id} onClick={() => onSelectCourse(course)}>
                <CourseVisual course={course} details={courseDetails[course.id]} image={courseImages.get(course.id)} profileId={profileId} store={store} filesReady={filesReady} restored={skipOpeningAnimation} cacheEnabled={cacheEnabled} onImageSettled={onImageSettled} />
                <ClassCardBody course={course} overdue={courseAssignments.filter((item) => item.status === "overdue").length} today={courseAssignments.filter((item) => item.status === "today").length} later={courseAssignments.filter((item) => item.status === "later").length} />
              </button>;
            })}
          </div>
        </div>
      ) : <AssignmentTable items={assignments} courseFor={getCourse} onSelectAssignment={onSelectAssignment} />}
    </section>
    {dashboardView === "cards" && <section className="dashboard-upcoming"><div className="section-title-row"><div><h2>Coming up</h2></div><button className="text-button" onClick={onShowAllAssignments}>See all <ArrowRight size={14} /></button></div><AssignmentTable items={focusAssignments.slice(0, 5)} compact courseFor={getCourse} onSelectAssignment={onSelectAssignment} /></section>}
  </AnimatedDashboard>}</DashboardLoadTransition>;
}
