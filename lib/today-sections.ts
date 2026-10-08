export const todaySectionOptions = [
  { id: "next-class", label: "Next Class", description: "Your next class and where to go." },
  { id: "due-today", label: "Due Today", description: "Assignments that need your attention today." },
  { id: "schedule", label: "Today’s Schedule", description: "Today’s classes and personal events." },
  { id: "study-goal", label: "Study Goal", description: "Your progress toward today’s study target." },
  { id: "upcoming-deadlines", label: "Upcoming Deadlines", description: "A quick look at assignments coming up next." },
  { id: "study-streak", label: "Study Streak", description: "How many days you’ve kept up your study habit." },
] as const;

export type TodaySectionId = (typeof todaySectionOptions)[number]["id"];
export const defaultTodaySections: TodaySectionId[] = ["next-class", "due-today", "schedule"];

export function validateTodaySections(value: unknown): TodaySectionId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3
    || new Set(value).size !== value.length
    || value.some((id) => !todaySectionOptions.some((option) => option.id === id))) {
    throw new Error("Choose between 1 and 3 different Today sections.");
  }
  return [...value] as TodaySectionId[];
}
