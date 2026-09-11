// TEMPORARY: isolated preview data for the sidebar's Experimental mode.
// It is intentionally deterministic and is never written to the account.
import { addDays, type Course, type CourseDetails } from "./academics";
import { emptyStudy, type StudyData } from "./study";
import type { SavedAssignment, SavedEvent, WidgetInstance, Workspace } from "./workspace-codec";

export type ExperimentalDensity = "clear" | "light" | "medium" | "packed";

export type ExperimentalDataset = {
  courses: Course[];
  assignments: SavedAssignment[];
  manualEvents: SavedEvent[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  notes: string;
  courseDetails: Record<string, CourseDetails>;
  study: StudyData;
};

const courseTemplates: Course[] = [
  { id: "demo-history", code: "HIST 205", name: "Modern World History", credits: 3, instructor: "Dr. Maya Chen", room: "Humanities 214", color: "#5B63E8", soft: "#5B63E818", initials: "HI" },
  { id: "demo-cs", code: "CS 214", name: "Data Structures", credits: 4, instructor: "Prof. Daniel Ortiz", room: "Tech 118", color: "#147D92", soft: "#147D9218", initials: "CS" },
  { id: "demo-biology", code: "BIO 120", name: "General Biology", credits: 4, instructor: "Dr. Aisha Patel", room: "Science 302", color: "#27825B", soft: "#27825B18", initials: "BI" },
  { id: "demo-writing", code: "ENG 102", name: "Academic Writing", credits: 3, instructor: "Prof. Lena Brooks", room: "Liberal Arts 44", color: "#B56A2D", soft: "#B56A2D18", initials: "EN" },
  { id: "demo-econ", code: "ECON 201", name: "Microeconomics", credits: 3, instructor: "Dr. Noah Kim", room: "Business 160", color: "#8A4FB5", soft: "#8A4FB518", initials: "EC" },
  { id: "demo-art", code: "ART 110", name: "Visual Culture", credits: 3, instructor: "Prof. Sofia Rivera", room: "Arts 12", color: "#C44F65", soft: "#C44F6518", initials: "AR" },
];

const taskTitles = [
  "Read chapter 6 and annotate",
  "Problem set 4",
  "Cell transport lab report",
  "Research essay outline",
  "Midterm study guide",
  "Discussion board response",
  "Weekly reflection",
  "Binary trees practice",
  "Source analysis worksheet",
  "Peer review notes",
  "Market structures quiz",
  "Museum response draft",
  "Lecture notes cleanup",
  "Algorithm complexity exercises",
  "Biology concept map",
  "Essay first draft",
  "Elasticity problem set",
  "Visual analysis presentation",
  "Primary source comparison",
  "Coding checkpoint",
  "Lab practical review",
  "Bibliography and citations",
  "Chapter 8 quiz",
  "Gallery research notes",
  "Final project proposal",
  "Practice exam",
  "Study group questions",
  "End-of-week planning",
];

const densityConfig = {
  clear: { courses: 0, assignments: 0, events: 0, sessions: 0, grades: 0, workspaces: 1 },
  light: { courses: 2, assignments: 6, events: 3, sessions: 2, grades: 2, workspaces: 1 },
  medium: { courses: 4, assignments: 14, events: 7, sessions: 5, grades: 4, workspaces: 2 },
  packed: { courses: 6, assignments: 28, events: 14, sessions: 10, grades: 6, workspaces: 3 },
} satisfies Record<ExperimentalDensity, { courses: number; assignments: number; events: number; sessions: number; grades: number; workspaces: number }>;

const dueOffsets = [-3, 0, 1, 2, 4, 6, -1, 0, 3, 5, 7, 9, -5, 1, 2, 4, 6, 8, -2, 0, 1, 3, 5, 7, 9, 10, 12, 14];
const eventTitles = ["History lecture", "Data structures lab", "Biology study group", "Writing office hours", "Economics review", "Library research block", "Advisor appointment", "Project work session", "Campus tutoring", "Exam review", "Team presentation practice", "Professor office hours", "Weekly planning", "Study break"];
const eventTypes = ["Study block", "Office hours", "Study block", "Office hours", "Study block", "Study block", "Appointment", "Study block", "Appointment", "Exam", "Study block", "Office hours", "Personal", "Personal"];

function widgets(density: ExperimentalDensity, workspace: number, types: WidgetInstance["type"][]): WidgetInstance[] {
  return types.map((type, index) => ({
    instanceId: `demo-${density}-widget-${workspace}-${index}`,
    type,
    size: type === "today" || type === "upcoming" || type === "stoplight" ? "large" : type === "pomodoro" || type === "gpa" || type === "streak" ? "small" : "medium",
    ...(type === "notes" ? { note: workspace === 0 ? "Demo notes\n• Review lecture slides\n• Email study group\n• Bring lab notebook" : "Ideas for the week\n• Start the essay early\n• Book office hours" } : {}),
  }));
}

function demoWorkspaces(density: ExperimentalDensity, count: number): Workspace[] {
  const all = [
    { id: `demo-${density}-overview`, name: "Demo Overview", widgets: widgets(density, 0, ["daily-goal", "today", "red-alerts", "mini-calendar", "task-completion", "notes"]) },
    { id: `demo-${density}-study`, name: "Demo Study", widgets: widgets(density, 1, ["pomodoro", "weekly-goal", "upcoming", "class-links", "gpa", "streak"]) },
    { id: `demo-${density}-finals`, name: "Demo Finals", widgets: widgets(density, 2, ["exams", "stoplight", "assignment-pie", "focus-timer", "quote"]) },
  ];
  return all.slice(0, count);
}

function isoSegment(date: string, hour: number, minutes: number) {
  const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const end = new Date(start.getTime() + minutes * 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function experimentalData(density: ExperimentalDensity, today: string): ExperimentalDataset {
  if (density === "clear") {
    const workspaces: Workspace[] = [{ id: "demo-clear-workspace", name: "Empty preview", widgets: [] }];
    return {
      courses: [],
      assignments: [],
      manualEvents: [],
      workspaces,
      activeWorkspaceId: workspaces[0].id,
      notes: "",
      courseDetails: {},
      study: emptyStudy(),
    };
  }
  const config = densityConfig[density];
  const courses = courseTemplates.slice(0, config.courses);
  const workspaces = demoWorkspaces(density, config.workspaces);
  const assignments: SavedAssignment[] = Array.from({ length: config.assignments }, (_, index) => {
    const course = courses[index % courses.length];
    const done = index === 6 || index === 12 || index === 20;
    const dateKey = addDays(today, dueOffsets[index]);
    return {
      id: `demo-${density}-assignment-${index}`,
      title: taskTitles[index],
      courseId: course.id,
      due: "",
      dateKey,
      dueTime: ["09:00", "11:59", "17:00", "23:59"][index % 4],
      type: index % 9 === 4 ? "Exam" : index % 8 === 3 ? "Project" : "Assignment",
      status: done ? "done" : "later",
      progress: done ? 100 : [0, 20, 45, 65][index % 4],
      description: `Demo coursework for ${course.code}. Use this record to preview task details, progress, and deadlines.`,
      weight: index % 5 === 4 ? "20%" : "5%",
      notes: index % 3 === 0 ? "Review the rubric before submitting." : "",
      checklist: done ? [true, true, true] : [index % 2 === 0, false, false],
      ...(done ? { completedAt: `${today}T18:00:00.000Z`, progressBeforeCompletion: 65 } : {}),
    };
  });
  const manualEvents: SavedEvent[] = Array.from({ length: config.events }, (_, index) => {
    const course = index === 6 || index >= courses.length * 2 ? null : courses[index % courses.length];
    return {
      id: `demo-${density}-event-${index}`,
      title: eventTitles[index],
      courseId: course?.id ?? "",
      dateKey: addDays(today, [0, 0, 1, 2, 3, 4, 5, 0, 1, 2, 4, 6, 7, 9][index]),
      time: ["09:00", "11:00", "14:00", "16:30", "18:00"][index % 5],
      type: eventTypes[index],
      description: "Temporary calendar data for previewing the schedule.",
    };
  });
  const meetingDays = [[1, 3], [2, 4], [1, 5], [2, 4], [1, 3], [3, 5]];
  const courseDetails = Object.fromEntries(courses.map((course, index) => {
    const startHour = 9 + (index % 4) * 2;
    return [course.id, {
      officeHours: index % 2 ? "Tuesday 2:00–3:30 PM, by appointment" : "Wednesday 1:00–2:30 PM",
      meetings: [{
        id: `demo-${density}-meeting-${index}`,
        days: meetingDays[index],
        start: `${String(startHour).padStart(2, "0")}:00`,
        end: `${String(startHour + 1).padStart(2, "0")}:15`,
        from: addDays(today, -35),
        until: addDays(today, 90),
        location: course.room,
      }],
      syllabusText: `${course.code} — ${course.name}\nWeekly readings, participation, assignments, and a final project.`,
      syllabusName: `${course.code.toLowerCase().replace(" ", "-")}-syllabus.txt`,
    } satisfies CourseDetails];
  }));
  const sessions = Array.from({ length: config.sessions }, (_, index) => ({
    id: `demo-${density}-session-${index}`,
    kind: index % 3 === 0 ? "pomodoro" as const : "focus" as const,
    courseId: courses[index % courses.length].id,
    segments: [isoSegment(addDays(today, -(index % 7)), 15 + Math.floor(index / 7) * 2, index % 3 === 0 ? 25 : 45)],
  }));
  const grades = courses.slice(0, config.grades).map((course, index) => ({
    id: `demo-${density}-grade-${index}`,
    courseId: course.id,
    term: "Current term",
    system: "4.0 scale",
    max: 4,
    value: [3.7, 3.35, 3.9, 3.55, 3.2, 3.8][index],
  }));
  const study: StudyData = {
    dailyMinutes: density === "light" ? 60 : density === "medium" ? 90 : 120,
    weeklyMinutes: density === "light" ? 240 : density === "medium" ? 420 : 600,
    timers: {
      pomodoro: { minutes: 25, courseId: courses[0].id },
      focus: { minutes: 50, courseId: courses[Math.min(1, courses.length - 1)].id },
    },
    active: null,
    sessions,
    grades,
  };
  return {
    courses,
    assignments,
    manualEvents,
    workspaces,
    activeWorkspaceId: workspaces[0].id,
    notes: "",
    courseDetails,
    study,
  };
}
