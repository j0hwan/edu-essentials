export const courseIconOptions = [
  { id: "book-open", label: "Book" },
  { id: "graduation-cap", label: "Graduation cap" },
  { id: "calculator", label: "Calculator" },
  { id: "atom", label: "Atom" },
  { id: "flask-conical", label: "Chemistry" },
  { id: "microscope", label: "Microscope" },
  { id: "dna", label: "Biology" },
  { id: "globe", label: "Globe" },
  { id: "landmark", label: "History" },
  { id: "languages", label: "Languages" },
  { id: "code", label: "Code" },
  { id: "palette", label: "Art" },
  { id: "music", label: "Music" },
  { id: "pencil", label: "Writing" },
  { id: "chart-no-axes-combined", label: "Chart" },
  { id: "dumbbell", label: "Fitness" },
] as const;

export type CourseIconId = typeof courseIconOptions[number]["id"];
export const DEFAULT_COURSE_ICON: CourseIconId = "book-open";
export function isCourseIconId(value: unknown): value is CourseIconId {
  return courseIconOptions.some((option) => option.id === value);
}
