import { validateCourseDetails, validateDraft, type CourseDetails, type SyllabusDraft } from "./academics";
import { validateStudy, type StudyData } from "./study";
export const widgetTypes = [
  "daily-goal",
  "weekly-goal",
  "upcoming",
  "stoplight",
  "red-alerts",
  "mini-calendar",
  "pomodoro",
  "focus-timer",
  "task-completion",
  "assignment-pie",
  "gpa",
  "class-links",
  "notes",
  "exams",
  "streak",
  "today",
  "quote",
  "spacer",
] as const;

export const widgetSizes = ["small", "medium", "large"] as const;

export type WidgetType = (typeof widgetTypes)[number];
export type WidgetSize = (typeof widgetSizes)[number];

export type WidgetInstance = {
  instanceId: string;
  type: WidgetType;
  size: WidgetSize;
  note?: string;
};

export type Workspace = {
  id: string;
  name: string;
  widgets: WidgetInstance[];
};

type CompactWidget = [type: number, size: number, instanceId: string, noteIndex?: number];
type CompactWorkspace = [id: string, name: string, widgets: CompactWidget[]];

export type CompactWorkspaceState = {
  v: 2;
  a: string;
  w: CompactWorkspace[];
  n?: string;
  t?: string[];
  d?: WorkspaceData;
};

export type SavedAssignment = {
  id: string; title: string; courseId: string; due: string; dateKey: string;
  status: "overdue" | "today" | "later" | "done"; progress: number; description: string; weight: string;
  notes?: string; checklist?: boolean[];
  type?: "Assignment" | "Exam" | "Project"; dueTime?: string; completedAt?: string | null; progressBeforeCompletion?: number;
};
export type SavedEvent = { id: string; title: string; courseId: string; dateKey: string; time: string; type: string; description?: string };
export type WorkspaceData = {
  assignments: SavedAssignment[]; manualEvents: SavedEvent[];
  dashboardView: "cards" | "list"; calendarView: "month" | "week" | "day";
  calendarFilter?: string; courseDetails?: Record<string, CourseDetails>; syllabusDrafts?: SyllabusDraft[];
  study?: StudyData;
  filePreferences?: { filter: string; view: "list" | "grid" };
};

export type DecodedWorkspaceState = {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  notes: string;
  data?: WorkspaceData;
};

export const MAX_WORKSPACES = 20;
export const MAX_WIDGETS_PER_WORKSPACE = 100;
export const MAX_NOTES_LENGTH = 20_000;
export const MAX_WORKSPACE_BYTES = 1_000_000;

/**
 * V2 retains stable widget identities and independent note text. The n field
 * holds legacy text only when no notes widget existed to receive it. Equal note
 * strings are packed once in t; references are rebuilt on each save, so edits
 * remain independent and large legacy layouts don't multiply shared text.
 */
export function encodeWorkspaceState(
  workspaces: Workspace[],
  activeWorkspaceId: string,
  notes: string,
  data?: WorkspaceData,
): CompactWorkspaceState {
  if (!workspaces.length || workspaces.length > MAX_WORKSPACES) {
    throw new Error("A dashboard must contain between 1 and 20 workspaces.");
  }
  if (new Set(workspaces.map((workspace) => workspace.id)).size !== workspaces.length) throw new Error("Duplicate workspace ID.");

  const texts: string[] = [], textIndexes = new Map<string, number>();
  const compactWorkspaces: CompactWorkspace[] = workspaces.map((workspace) => {
    if (!workspace.id || workspace.id.length > 120) {
      throw new Error("Invalid workspace ID.");
    }
    if (!workspace.name.trim() || workspace.name.length > 80) {
      throw new Error("Invalid workspace name.");
    }
    if (workspace.widgets.length > MAX_WIDGETS_PER_WORKSPACE) {
      throw new Error("A workspace cannot contain more than 100 widgets.");
    }

    const widgets: CompactWidget[] = workspace.widgets.map((widget) => {
      const type = widgetTypes.indexOf(widget.type);
      const size = widgetSizes.indexOf(widget.size);
      if (type < 0 || size < 0) throw new Error("Invalid widget layout.");
      if (widget.type !== "notes") return [type, size, widget.instanceId];
      const note = widget.note ?? "";
      if (typeof note !== "string" || note.length > MAX_NOTES_LENGTH) throw new Error("Quick notes cannot exceed 20,000 characters.");
      if (!textIndexes.has(note)) { textIndexes.set(note, texts.length); texts.push(note); }
      return [type, size, widget.instanceId, textIndexes.get(note)!];
    });

    return [workspace.id, workspace.name.trim(), widgets];
  });

  if (notes.length > MAX_NOTES_LENGTH) {
    throw new Error("Quick notes cannot exceed 20,000 characters.");
  }

  const active = workspaces.some((workspace) => workspace.id === activeWorkspaceId)
    ? activeWorkspaceId
    : workspaces[0].id;

  const payload: CompactWorkspaceState = {
    v: 2,
    a: active,
    w: compactWorkspaces,
    ...(texts.length ? { t: texts } : {}),
    ...(notes ? { n: notes } : {}),
    ...(data ? { d: validateWorkspaceData(data) } : {}),
  };
  decodeWorkspaceState(payload);
  return payload;
}

export function decodeWorkspaceState(value: unknown): DecodedWorkspaceState {
  if (!isRecord(value) || ![1, 2].includes(value.v as number) || typeof value.a !== "string" || !Array.isArray(value.w)) {
    throw new Error("Unsupported dashboard layout.");
  }
  if (!value.w.length || value.w.length > MAX_WORKSPACES) {
    throw new Error("Invalid workspace count.");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_WORKSPACE_BYTES) throw new Error("Workspace storage limit reached. Shorten notes or remove unused widgets before adding more content.");
  const notes = value.n === undefined ? "" : value.n;
  if (typeof notes !== "string" || notes.length > MAX_NOTES_LENGTH) throw new Error("Invalid quick notes.");
  const widgetIds = new Set<string>();
  const texts = value.t ?? [];
  if (!Array.isArray(texts) || texts.length > MAX_WORKSPACES * MAX_WIDGETS_PER_WORKSPACE || texts.some((text) => typeof text !== "string" || text.length > MAX_NOTES_LENGTH)) throw new Error("Invalid note content.");

  const workspaces = value.w.map((workspace, workspaceIndex): Workspace => {
    if (
      !Array.isArray(workspace) ||
      workspace.length !== 3 ||
      typeof workspace[0] !== "string" ||
      !workspace[0] ||
      workspace[0].length > 120 ||
      typeof workspace[1] !== "string" ||
      !workspace[1].trim() ||
      workspace[1].length > 80 ||
      !Array.isArray(workspace[2]) ||
      workspace[2].length > MAX_WIDGETS_PER_WORKSPACE
    ) {
      throw new Error("Invalid workspace layout.");
    }

    const widgets = workspace[2].map((widget, widgetIndex): WidgetInstance => {
      if (
        !Array.isArray(widget) ||
        (value.v === 1 ? widget.length !== 2 : widget.length !== (widget[0] === 12 ? 4 : 3)) ||
        !Number.isInteger(widget[0]) ||
        !Number.isInteger(widget[1]) ||
        !widgetTypes[widget[0]] ||
        !widgetSizes[widget[1]]
      ) {
        throw new Error("Invalid widget layout.");
      }
      const instanceId = value.v === 1 ? `legacy-${workspaceIndex}-${widgetIndex}` : widget[2];
      if (typeof instanceId !== "string" || !instanceId.trim() || instanceId.length > 120 || widgetIds.has(instanceId)) throw new Error("Invalid or duplicate widget ID.");
      widgetIds.add(instanceId);
      if (value.v === 2 && widgetTypes[widget[0]] === "notes" && (!Number.isInteger(widget[3]) || widget[3] < 0 || widget[3] >= texts.length)) throw new Error("Invalid note reference.");
      const note = value.v === 1 ? notes : texts[widget[3]];
      if (widgetTypes[widget[0]] === "notes" && (typeof note !== "string" || note.length > MAX_NOTES_LENGTH)) throw new Error("Quick notes cannot exceed 20,000 characters.");

      return {
        instanceId,
        type: widgetTypes[widget[0]],
        size: widgetSizes[widget[1]],
        ...(widgetTypes[widget[0]] === "notes" ? { note } : {}),
      };
    });

    return { id: workspace[0], name: workspace[1].trim(), widgets };
  });

  if (new Set(workspaces.map((workspace) => workspace.id)).size !== workspaces.length) throw new Error("Duplicate workspace ID.");

  return {
    activeWorkspaceId: workspaces.some((workspace) => workspace.id === value.a)
      ? value.a
      : workspaces[0].id,
    workspaces,
    notes: value.v === 1 && workspaces.some((workspace) => workspace.widgets.some((widget) => widget.type === "notes")) ? "" : notes,
    ...(value.d !== undefined ? { data: validateWorkspaceData(value.d) } : {}),
  };
}

function validateWorkspaceData(value: unknown): WorkspaceData {
  if (!isRecord(value) || !Array.isArray(value.assignments) || value.assignments.length > 2000 || !Array.isArray(value.manualEvents) || value.manualEvents.length > 2000) throw new Error("Invalid workspace data.");
  if (!["cards", "list"].includes(value.dashboardView as string) || !["month", "week", "day"].includes(value.calendarView as string)) throw new Error("Invalid workspace view.");
  const bounded = (record: Record<string, unknown>, key: string, max = 500) => {
    if (typeof record[key] !== "string" || (record[key] as string).length > max) throw new Error(`Invalid ${key}.`);
  };
  for (const item of value.assignments) {
    if (!isRecord(item)) throw new Error("Invalid assignment.");
    for (const key of ["id", "title", "courseId", "due", "dateKey", "weight"]) bounded(item, key);
    bounded(item, "description", 20000);
    if (item.notes !== undefined) bounded(item, "notes", 20000);
    if (!item.id || !item.title || !["overdue", "today", "later", "done"].includes(item.status as string) || typeof item.progress !== "number" || !Number.isFinite(item.progress) || item.progress < 0 || item.progress > 100) throw new Error("Invalid assignment progress.");
    if (item.checklist !== undefined && (!Array.isArray(item.checklist) || item.checklist.length !== 3 || item.checklist.some((item) => typeof item !== "boolean"))) throw new Error("Invalid assignment checklist.");
  }
  for (const item of value.manualEvents) {
    if (!isRecord(item)) throw new Error("Invalid calendar event.");
    for (const key of ["id", "title", "courseId", "dateKey", "time", "type"]) bounded(item, key);
    if (!item.id || !item.title) throw new Error("Invalid calendar event.");
  }
  if (JSON.stringify(value).length > 500000) throw new Error("Workspace data is too large.");
  for (const items of [value.assignments, value.manualEvents]) {
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Duplicate record ID.");
  }
  if (value.calendarFilter !== undefined && (typeof value.calendarFilter !== "string" || value.calendarFilter.length > 120)) throw new Error("Invalid calendar filter.");
  if (value.study !== undefined) validateStudy(value.study);
  if (value.filePreferences !== undefined && (!isRecord(value.filePreferences) || typeof value.filePreferences.filter !== "string" || value.filePreferences.filter.length > 120 || !["list", "grid"].includes(String(value.filePreferences.view)))) throw new Error("Invalid file preferences.");
  if (value.courseDetails !== undefined) { if (!isRecord(value.courseDetails) || Object.keys(value.courseDetails).length > 100) throw new Error("Invalid class details."); Object.values(value.courseDetails).forEach(validateCourseDetails); }
  if (value.syllabusDrafts !== undefined) { if (!Array.isArray(value.syllabusDrafts) || value.syllabusDrafts.length > 10) throw new Error("Keep at most 10 syllabus reviews."); value.syllabusDrafts.forEach(validateDraft); if (new Set(value.syllabusDrafts.map((d) => d.id)).size !== value.syllabusDrafts.length) throw new Error("Duplicate syllabus review ID."); }
  return value as WorkspaceData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
