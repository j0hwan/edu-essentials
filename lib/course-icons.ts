export const courseIconOptions = [
  { id: "none", label: "No icon" },
  { id: "graduation-cap", label: "Graduation cap" },
  { id: "calculator", label: "Calculator" },
  { id: "atom", label: "Atom" },
  { id: "flask-conical", label: "Chemistry" },
  { id: "microscope", label: "Microscope" },
  { id: "dna", label: "Biology" },
  { id: "globe", label: "Globe" },
  { id: "book-open", label: "Book" },
  { id: "languages", label: "Languages" },
  { id: "code", label: "Code" },
  { id: "palette", label: "Art" },
  { id: "music", label: "Music" },
  { id: "pencil", label: "Writing" },
  { id: "chart-no-axes-combined", label: "Chart" },
  { id: "dumbbell", label: "Fitness" },
  { id: "landmark", label: "History" },
  { id: "scale", label: "Law" },
  { id: "briefcase-business", label: "Business" },
  { id: "heart-pulse", label: "Health" },
  { id: "leaf", label: "Environmental science" },
  { id: "cog", label: "Engineering" },
  { id: "drama", label: "Theater" },
  { id: "brain", label: "Psychology" },
] as const;

export type CourseIconId = typeof courseIconOptions[number]["id"];
export const DEFAULT_COURSE_ICON: CourseIconId = "book-open";
export function isCourseIconId(value: unknown): value is CourseIconId {
  return courseIconOptions.some((option) => option.id === value);
}
