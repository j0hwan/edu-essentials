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
};

export type Workspace = {
  id: string;
  name: string;
  widgets: WidgetInstance[];
};

type CompactWidget = [type: number, size: number];
type CompactWorkspace = [id: string, name: string, widgets: CompactWidget[]];

export type CompactWorkspaceState = {
  v: 1;
  a: string;
  w: CompactWorkspace[];
  n?: string;
  d?: WorkspaceData;
};

export type SavedAssignment = {
  id: string; title: string; courseId: string; due: string; dateKey: string;
  status: "overdue" | "today" | "later" | "done"; progress: number; description: string; weight: string;
  notes?: string; checklist?: boolean[];
};
export type SavedEvent = { id: string; title: string; courseId: string; dateKey: string; time: string; type: string };
export type WorkspaceData = {
  assignments: SavedAssignment[]; manualEvents: SavedEvent[];
  dashboardView: "cards" | "list"; calendarView: "month" | "week" | "day";
};

export type DecodedWorkspaceState = {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  notes: string;
  data?: WorkspaceData;
};

const MAX_WORKSPACES = 20;
const MAX_WIDGETS_PER_WORKSPACE = 100;
const MAX_NOTES_LENGTH = 20_000;

/**
 * Stores only numeric widget/size codes. Instance IDs are UI-only and are
 * rebuilt while decoding, avoiding repeated object keys and UUIDs in JSONB.
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
      return [type, size];
    });

    return [workspace.id, workspace.name.trim(), widgets];
  });

  if (notes.length > MAX_NOTES_LENGTH) {
    throw new Error("Quick notes cannot exceed 20,000 characters.");
  }

  const active = workspaces.some((workspace) => workspace.id === activeWorkspaceId)
    ? activeWorkspaceId
    : workspaces[0].id;

  return {
    v: 1,
    a: active,
    w: compactWorkspaces,
    ...(notes ? { n: notes } : {}),
    ...(data ? { d: validateWorkspaceData(data) } : {}),
  };
}

export function decodeWorkspaceState(value: unknown): DecodedWorkspaceState {
  if (!isRecord(value) || value.v !== 1 || typeof value.a !== "string" || !Array.isArray(value.w)) {
    throw new Error("Unsupported dashboard layout.");
  }
  if (!value.w.length || value.w.length > MAX_WORKSPACES) {
    throw new Error("Invalid workspace count.");
  }

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
        widget.length !== 2 ||
        !Number.isInteger(widget[0]) ||
        !Number.isInteger(widget[1]) ||
        !widgetTypes[widget[0]] ||
        !widgetSizes[widget[1]]
      ) {
        throw new Error("Invalid widget layout.");
      }

      return {
        instanceId: `${workspace[0]}-${workspaceIndex}-${widgetIndex}`,
        type: widgetTypes[widget[0]],
        size: widgetSizes[widget[1]],
      };
    });

    return { id: workspace[0], name: workspace[1].trim(), widgets };
  });

  const notes = value.n === undefined ? "" : value.n;
  if (typeof notes !== "string" || notes.length > MAX_NOTES_LENGTH) {
    throw new Error("Invalid quick notes.");
  }

  return {
    activeWorkspaceId: workspaces.some((workspace) => workspace.id === value.a)
      ? value.a
      : workspaces[0].id,
    workspaces,
    notes,
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
  return value as WorkspaceData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
