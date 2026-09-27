export function syntheticContext() {
  return {
    now: new Date("2026-09-18T16:00:00Z"), revision: "2026-09-18T15:00:00Z",
    profile: { timezone: "America/Los_Angeles", major: "Engineering", academic_year: "Sophomore", study_goal: "Practice every weekday", current_term: "Fall 2026", gpa_system: "4.0 scale", week_starts_on: "Monday" },
    courses: [
      { id: "calc", code: "MATH 2", name: "Calculus II", credits: 4, instructor: "Fictional Instructor", room: "A1", color: "#5566aa", soft: "#5566aa18", initials: "MA" },
      { id: "ece", code: "ECE 10", name: "Circuits", credits: 3, instructor: "Fictional Instructor", room: "B2", color: "#5566aa", soft: "#5566aa18", initials: "EC" },
    ],
    dashboard: { v: 2, a: "day", w: [["day", "My day", [[12, 1, "notes", 0]]]], t: ["The integration study group meets on Fridays."], d: {
      assignments: [
        { id: "exam-calc", title: "Calculus midterm", courseId: "calc", dateKey: "2026-09-25", due: "Sep 25", dueTime: "10:00", status: "later", progress: 20, weight: "", description: "Chapters 1–3", type: "Exam" },
        { id: "lab-ece", title: "Circuits lab", courseId: "ece", dateKey: "2026-09-24", due: "Sep 24", status: "later", progress: 0, weight: "", description: "Build a series circuit", type: "Assignment" },
      ],
      manualEvents: [{ id: "study", title: "Calculus practice", courseId: "calc", dateKey: "2026-09-23", time: "14:00", durationMinutes: 60, type: "Study block" }],
      dashboardView: "cards", calendarView: "month",
      courseDetails: { calc: { officeHours: "", syllabusText: "Late work loses 10 percent per day. The syllabus lists a midterm on September 24, 2026; the saved assignment was updated to September 25.", syllabusName: "Calculus syllabus", meetings: [{ id: "meeting", days: [1, 3, 5], start: "10:00", end: "11:00", from: "2026-09-01", until: "2026-12-15", location: "A1" }] } },
      study: { dailyMinutes: 60, weeklyMinutes: 300, timers: { pomodoro: { minutes: 25, courseId: "" }, focus: { minutes: 50, courseId: "" } }, active: null, sessions: [], grades: [{ id: "g1", courseId: "calc", term: "Fall 2026", system: "4.0 scale", value: 3, max: 4 }, { id: "g2", courseId: "ece", term: "Fall 2026", system: "4.0 scale", value: 4, max: 4 }] },
      filePreferences: { filter: "all", view: "list" },
    } },
  };
}
