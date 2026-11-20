export const econSyllabusExtraction = {
  course: {
    code: "ECON 1", name: "Principles of Microeconomics", instructor: "Dr. Yinlin Dai",
    term: "Fall Quarter 2026", officeHours: "See the Course Information module in Canvas.", pages: [1, 2],
  },
  meetings: [
    { name: "Lecture 004", days: [1, 3, 5], start: "10:00", end: "10:50", location: "JEANN AUD", pages: [1] },
    ...[17, 18, 19, 20, 19].map((hour, index) => ({
      name: `Discussion 004-00${index + 1}`, days: [index === 4 ? 1 : 2], start: `${hour}:00`, end: `${hour}:50`,
      location: index === 4 ? "Center Hall Room 214" : "Pepper Canyon Hall Room 122",
      alternative: true, timing: "Starts in week 2", pages: [index < 2 ? 1 : 2],
    })),
  ],
  categories: [["Syllabus Quiz", 3], ["Problem Sets", 10], ["Midterm Exam 1", 20], ["Midterm Exam 2", 20], ["Final Exam", 47]]
    .map(([name, weight]) => ({ name, weight, pages: [3] })),
  tasks: [
    { title: "Syllabus Quiz", type: "Assignment", category: "Syllabus Quiz", date: "2026-10-04", weekday: 0, time: "23:59", pages: [3, 4, 5] },
    { title: "Problem Set", numbers: [1, 2], type: "Assignment", category: "Problem Sets", date: "2026-10-16", weekday: 5, time: "23:59", pages: [5] },
    { title: "Problem Set", numbers: [3, 4], type: "Assignment", category: "Problem Sets", date: "2026-11-13", weekday: 5, time: "23:59", pages: [5] },
    { title: "Problem Set", numbers: [5, 6, 7, 8], type: "Assignment", category: "Problem Sets", date: "2026-12-07", weekday: 1, time: "23:59", pages: [5] },
    { title: "Midterm Exam 1", type: "Exam", category: "Midterm Exam 1", date: "2026-10-16", pages: [3] },
    { title: "Exam 1", type: "Exam", date: "2026-10-16", weekday: 5, time: "10:00", endTime: "10:50", location: "JEANN AUD", pages: [4, 5] },
    { title: "Midterm Exam 2", type: "Exam", category: "Midterm Exam 2", date: "2026-11-13", weekday: 5, time: "10:00", endTime: "10:50", location: "JEANN AUD", pages: [3, 4, 5] },
    { title: "Final Exam", type: "Exam", category: "Final Exam", date: "2026-12-11", weekday: 5, time: "08:00", endTime: "10:59", pages: [3, 4, 5] },
    { title: "Comprehensive Final Exam", type: "Exam", pages: [6] },
  ],
  notes: [
    { heading: "Course materials", text: "Principles of Economics, 8th edition and Uflo.", pages: [3, 4] },
    { heading: "Conditional grading change", text: "If completion is high, the course evaluation may increase Problem Sets to 15% and decrease the Final Exam to 42%.", pages: [5] },
    { heading: "Tentative course outline", text: "Chapter 1 starts with thinking like an economist and opportunity costs.", pages: [6] },
  ],
  warnings: [],
};
