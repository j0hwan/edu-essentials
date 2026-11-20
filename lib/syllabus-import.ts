import { z } from "zod";
import { assignmentStatus, assignmentTypes, dateLabel, emptyCourse, isDate, isTime, type Course, type CourseDetails, type Meeting } from "./academics";
import type { SavedAssignment } from "./workspace-codec";

const short = (max: number) => z.string().trim().max(max);
const pages = z.array(z.number().int().min(1).max(100)).max(100);
const date = short(10);
const time = short(5);
export const syllabusExtractionSchema = z.object({
  course: z.object({
    code: short(30).optional(), name: short(160).optional(), instructor: short(160).optional(),
    credits: z.number().int().min(0).max(30).optional(), term: short(160).optional(),
    officeHours: short(2000).optional(), meetingNotes: short(2000).optional(), pages,
  }),
  meetings: z.array(z.object({
    name: short(160).min(1), days: z.array(z.number().int().min(0).max(6)).max(7),
    location: short(160).optional(), start: time.optional(), end: time.optional(),
    from: date.optional(), until: date.optional(), excludedDates: z.array(date).max(100).optional(),
    alternative: z.boolean().optional(), timing: short(300).optional(), pages,
  })).max(30),
  categories: z.array(z.object({ name: short(100).min(1), weight: z.number().min(0).max(100).optional(), pages })).max(50),
  tasks: z.array(z.object({
    title: short(500).min(1), type: z.enum(assignmentTypes), category: short(100).optional(),
    date: date.optional(), explicitYear: z.boolean().optional(), weekday: z.number().int().min(0).max(6).optional(),
    time: time.optional(), endTime: time.optional(), location: short(160).optional(), description: short(2000).optional(),
    numbers: z.array(z.number().int().min(1).max(999)).max(50).optional(), pages,
  })).max(200),
  notes: z.array(z.object({ heading: short(100).min(1), text: short(3000).min(1), pages })).max(20),
  warnings: z.array(z.object({ step: z.enum(["info", "schedule", "categories", "tasks"]), message: short(500).min(1), pages })).max(30),
});

export type SyllabusExtraction = z.infer<typeof syllabusExtractionSchema>;
export type ReviewSection = "info" | "schedule" | "categories" | "tasks";
export type SyllabusReviewNote = { step: ReviewSection; message: string; pages: number[] };
export type SyllabusImportDraft = {
  course: Course;
  details: CourseDetails;
  assignments: SavedAssignment[];
  alternatives: { meeting: Meeting; pages: number[]; timing?: string }[];
  sources: Record<ReviewSection, number[]>;
  warnings: SyllabusReviewNote[];
  creditsUnknown: boolean;
};

const keyOf = (name: string) => name.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const taskKey = (task: SyllabusExtraction["tasks"][number]) => {
  const key = keyOf(task.title);
  if (task.type === "Exam") {
    if (/^(?:(?:comprehensive|cumulative) )?final(?: exam(?:ination)?| test)?$/.test(key)) return "exam:final";
    const midterm = key.match(/^(?:midterm(?: exam)?|exam) (\d+)$/);
    if (midterm) return `exam:midterm-${midterm[1]}`;
  }
  return `${task.type}:${key}`;
};

export function buildSyllabusDraft(extraction: SyllabusExtraction, pageCount: number, today: string, id = () => crypto.randomUUID()): SyllabusImportDraft {
  const refs = (values: number[]) => [...new Set(values.filter((page) => page <= pageCount))].sort((a, b) => a - b);
  const course = { ...emptyCourse(id()), credits: extraction.course.credits ?? 0, code: extraction.course.code ?? "",
    name: extraction.course.name ?? "", instructor: extraction.course.instructor ?? "" };
  const statedYears = new Set(extraction.course.term?.match(/\b(?:19|20|21|22)\d{2}\b/g) ?? []);
  const academicYear = extraction.course.term?.match(/\b((?:19|20|21|22)\d{2})\s*[-–/]\s*(\d{2})\b/);
  if (academicYear) statedYears.add(`${academicYear[1].slice(0, 2)}${academicYear[2]}`);
  const sources = { info: refs([...extraction.course.pages, ...extraction.notes.flatMap((note) => note.pages)]),
    schedule: refs(extraction.meetings.flatMap((meeting) => meeting.pages)),
    categories: refs(extraction.categories.flatMap((category) => category.pages)),
    tasks: refs(extraction.tasks.flatMap((task) => task.pages)) };
  const warnings: SyllabusReviewNote[] = extraction.warnings.map((item) => ({ ...item, pages: refs(item.pages) }));
  const warn = (step: ReviewSection, message: string, pages: number[]) => warnings.push({ step, message, pages: refs(pages) });
  const details: CourseDetails = { meetings: [], gradingCategories: [], officeHours: extraction.course.officeHours ?? "",
    meetingNotes: extraction.course.meetingNotes, syllabusTerm: extraction.course.term,
    syllabusNotes: extraction.notes.map(({ heading, text }) => `${heading}\n${text}`).join("\n\n").slice(0, 20000) };
  const alternatives: SyllabusImportDraft["alternatives"] = [];
  const meetingKeys = new Set<string>();
  for (const row of extraction.meetings) {
    const days = [...new Set(row.days)].sort((a, b) => a - b);
    const start = isTime(row.start ?? "") ? row.start! : "";
    const end = start && isTime(row.end ?? "") && row.end! > start ? row.end! : "";
    const from = isDate(row.from ?? "") ? row.from! : "";
    const until = isDate(row.until ?? "") && (!from || row.until! >= from) ? row.until! : "";
    const excludedDates = [...new Set(row.excludedDates ?? [])].filter((day) => isDate(day) && from && until && day >= from && day <= until);
    const meeting = { id: id(), name: row.name, days, start, end, from, until, location: row.location ?? "", excludedDates };
    const key = JSON.stringify([keyOf(row.name), days, start, end, from, until, excludedDates, keyOf(meeting.location), row.alternative ?? false]);
    if (meetingKeys.has(key)) continue;
    meetingKeys.add(key);
    if (row.alternative) alternatives.push({ meeting, pages: refs(row.pages), timing: row.timing });
    else {
      if (row.timing) warn("schedule", `${row.name} — ${row.timing}`, row.pages);
      details.meetings.push(meeting);
    }
  }
  if (details.meetings.some((meeting) => !meeting.from || !meeting.until)) {
    warn("schedule", "Enter the date range for each meeting you want to add to your calendar.", sources.schedule);
  }
  if (alternatives.length) warn("schedule", "Choose any discussion or section options you want on your calendar.", sources.schedule);
  course.room = details.meetings.find((meeting) => /\blecture\b/i.test(meeting.name ?? ""))?.location ?? details.meetings[0]?.location ?? "";

  const categories = new Map<string, (typeof extraction.categories)[number][]>();
  for (const row of extraction.categories) {
    const key = keyOf(row.name);
    categories.set(key, [...(categories.get(key) ?? []), row]);
  }
  const categoryIds = new Map<string, string>();
  for (const [key, rows] of categories) {
    const name = rows[0].name;
    const weights = [...new Set(rows.flatMap((row) => row.weight === undefined ? [] : [row.weight]))];
    if (weights.length !== 1) {
      warn("categories", `${name} needs a confirmed grading weight${weights.length ? ` (${weights.join("% or ")}%)` : ""}. You can add it after checking the syllabus.`, rows.flatMap((row) => row.pages));
      continue;
    }
    const categoryId = id();
    categoryIds.set(key, categoryId);
    details.gradingCategories!.push({ id: categoryId, name, weight: weights[0] });
  }

  const grouped = new Map<string, SyllabusExtraction["tasks"]>();
  let taskCount = 0;
  for (const row of extraction.tasks) {
    const numbers = [...new Set(row.numbers ?? [])];
    const titles = numbers.length ? numbers.map((number) => `${row.title} ${number}`.slice(0, 500)) : [row.title];
    for (const title of titles) {
      const key = taskKey({ ...row, title });
      if (!grouped.has(key) && ++taskCount > 200) throw new Error("This syllabus contains more than 200 tasks. Choose a shorter syllabus or continue manually.");
      grouped.set(key, [...(grouped.get(key) ?? []), { ...row, title }]);
    }
  }

  const assignments: SavedAssignment[] = [];
  for (const rows of grouped.values()) {
    const first = rows[0];
    const title = rows.reduce((longest, row) => row.title.length > longest.length ? row.title : longest, first.title);
    const sources = rows.flatMap((row) => row.pages);
    const choose = (field: "date" | "time" | "endTime" | "category" | "location", label: string) => {
      const values = [...new Set(rows.map((row) => row[field]).filter((value): value is string => !!value))];
      if (values.length > 1) warn("tasks", `${title} has conflicting ${label} (${values.join(" or ")}). Confirm it in Tasks.`, sources);
      return values.length === 1 ? values[0] : "";
    };
    let dateKey = choose("date", "dates");
    const dateRows = rows.filter((row) => row.date === dateKey);
    const mismatchedYear = statedYears.size > 0 && !statedYears.has(dateKey.slice(0, 4)) && !dateRows.some((row) => row.explicitYear);
    const mismatchedWeekday = dateRows.some((row) => row.weekday !== undefined && new Date(`${dateKey}T12:00:00Z`).getUTCDay() !== row.weekday);
    if (dateKey && (!isDate(dateKey) || mismatchedYear || mismatchedWeekday)) {
      warn("tasks", `${title} has a date that needs confirmation (${dateKey}). Check the term and weekday.`, sources);
      dateKey = "";
    }
    const statedTime = choose("time", "times"), endTime = choose("endTime", "end times");
    if ((statedTime && !isTime(statedTime)) || (endTime && (!isTime(endTime) || !statedTime || endTime <= statedTime))) {
      warn("tasks", `${title} has an invalid time range. Confirm the times in Tasks.`, sources);
    }
    const start = isTime(statedTime) ? statedTime : undefined;
    const descriptions = [...new Set(rows.map((row) => row.description).filter(Boolean))];
    const categoryId = categoryIds.get(keyOf(choose("category", "categories")));
    const location = first.type === "Exam" ? choose("location", "locations") : "";
    if (!dateKey && (start || endTime)) {
      warn("tasks", `${title} has a time but needs a date. Stated time ${[start, endTime].filter(Boolean).join("–")}.`, sources);
    }
    assignments.push({ id: id(), courseId: course.id, title, type: first.type, dateKey, due: dateKey ? dateLabel(dateKey) : "",
      dueTime: first.type !== "Exam" && dateKey ? start : undefined,
      ...(first.type === "Exam" ? { examStart: dateKey ? start : undefined, examEnd: dateKey && start && isTime(endTime) && endTime > start ? endTime : undefined, examLocation: location || undefined } : {}),
      description: descriptions.join("\n\n").slice(0, 20000), categoryId, weight: "", status: assignmentStatus({ status: "later", dateKey }, today), progress: 0 });
  }
  return { course, details, assignments, alternatives, sources, warnings, creditsUnknown: extraction.course.credits === undefined };
}
