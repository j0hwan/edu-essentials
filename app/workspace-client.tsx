"use client";

import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  FileSearch,
  FileText,
  Flame,
  FolderOpen,
  GraduationCap,
  GripVertical,
  House,
  LayoutDashboard,
  LayoutGrid,
  List,
  Maximize2,
  Menu,
  MoreHorizontal,
  Pencil,
  PieChart,
  Plus,
  Quote as QuoteIcon,
  Search,
  Settings,
  SlidersHorizontal,
  StickyNote,
  Sun,
  Target,
  TimerReset,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Autosave, SaveFailure, canonicalJson } from "../lib/autosave";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
import { usePreferences } from "./use-preferences";
import AcademicEditor from "./academic-editor";
import SyllabusReview from "./syllabus-review";
import AcademicCalendar from "./academic-calendar";
import { usePrivateFiles } from "./use-private-files";
import { FileEditor, FileList, FilePreview, PrivateImage } from "./private-files";
import { fileSize, type PrivateFile, type FileMetadata } from "../lib/files";
import StudyWidget, { studyWidgetTypes } from "./study-widgets";
import StudyPanel from "./study-panel";
import { useStudyStats } from "./use-study-stats";
import { emptyStudy, settleTimer, timerAction, goalPercent, durationLabel, completedInWeek, detachStudyCourse, segmentSeconds, type StudyData, type TimerKind } from "../lib/study";
import { academicSnapshot, validateAcademicEdit } from "../lib/academic-snapshot";
import { dayKey, dateLabel, addDays, weekStart, assignmentStatus, legacyEventTime, emptyCourse, emptyCourseDetails, type Course, type CourseDetails, type SyllabusDraft } from "../lib/academics";
import type { SavedAssignment, SavedEvent, WorkspaceData } from "../lib/workspace-codec";
import ProfileEditor from "./profile-editor";
import type { Profile } from "../lib/profile";
import "./auth.css";
import {
  decodeWorkspaceState,
  encodeWorkspaceState,
  MAX_WORKSPACES,
  MAX_WIDGETS_PER_WORKSPACE,
  MAX_NOTES_LENGTH,
  type WidgetInstance,
  type WidgetSize,
  type WidgetType,
  type Workspace,
} from "../lib/workspace-codec";

type PageId = "home" | "dashboard" | "calendar" | "search" | "files" | "settings";
type Stoplight = "overdue" | "today" | "later" | "done";

type Assignment = SavedAssignment;

type WorkspaceResponse = {
  initialized: boolean;
  courses?: Course[];
  dashboard?: unknown;
  revision?: string | null;
  profile?: Profile;
  error?: string;
};

const navItems: { id: PageId; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "search", label: "Search", icon: Search },
  { id: "files", label: "Files", icon: FolderOpen },
];

const widgetTemplates: { type: WidgetType; title: string; description: string; icon: typeof Target; color: string; defaultSize: WidgetSize }[] = [
  { type: "daily-goal", title: "Daily study goal", description: "Progress ring and time remaining", icon: Target, color: "indigo", defaultSize: "medium" },
  { type: "weekly-goal", title: "Weekly study goal", description: "Seven-day progress overview", icon: BarChart3, color: "sky", defaultSize: "medium" },
  { type: "upcoming", title: "Upcoming assignments", description: "Your next deadlines in order", icon: List, color: "violet", defaultSize: "large" },
  { type: "stoplight", title: "Stoplight assignments", description: "Work grouped by urgency", icon: SlidersHorizontal, color: "coral", defaultSize: "medium" },
  { type: "red-alerts", title: "Red-light alerts", description: "Overdue and due today only", icon: AlertOctagon, color: "red", defaultSize: "medium" },
  { type: "mini-calendar", title: "Mini calendar", description: "A compact look at your week", icon: CalendarDays, color: "blue", defaultSize: "medium" },
  { type: "pomodoro", title: "Pomodoro timer", description: "Focused 25-minute sessions", icon: TimerReset, color: "tomato", defaultSize: "small" },
  { type: "focus-timer", title: "Focus timer", description: "Minimal countdown for deep work", icon: Clock3, color: "navy", defaultSize: "small" },
  { type: "task-completion", title: "Task completion", description: "Track work across all classes", icon: CheckCircle2, color: "green", defaultSize: "medium" },
  { type: "assignment-pie", title: "Assignment pie chart", description: "Workload split by class", icon: PieChart, color: "purple", defaultSize: "medium" },
  { type: "gpa", title: "GPA tracker", description: "Current GPA and term trend", icon: GraduationCap, color: "gold", defaultSize: "small" },
  { type: "class-links", title: "Class quick links", description: "Jump into your courses", icon: BookOpen, color: "teal", defaultSize: "medium" },
  { type: "notes", title: "Quick notes", description: "An editable scratchpad", icon: StickyNote, color: "yellow", defaultSize: "medium" },
  { type: "exams", title: "Upcoming exams", description: "Countdowns for important tests", icon: FileSearch, color: "rose", defaultSize: "medium" },
  { type: "streak", title: "Study streak", description: "Keep your momentum going", icon: Flame, color: "orange", defaultSize: "small" },
  { type: "today", title: "Today at a glance", description: "Agenda, classes, and deadlines", icon: Sun, color: "blue", defaultSize: "large" },
  { type: "quote", title: "Daily motivation", description: "A calm reminder to keep going", icon: QuoteIcon, color: "lilac", defaultSize: "medium" },
  { type: "spacer", title: "Empty spacer", description: "Create breathing room in your layout", icon: Maximize2, color: "neutral", defaultSize: "small" },
];

const defaultWorkspaces: Workspace[] = [
  {
    id: "my-day",
    name: "My Day",
    widgets: [
      { instanceId: "w1", type: "daily-goal", size: "medium" },
      { instanceId: "w2", type: "today", size: "large" },
      { instanceId: "w3", type: "red-alerts", size: "medium" },
      { instanceId: "w4", type: "pomodoro", size: "small" },
      { instanceId: "w5", type: "mini-calendar", size: "medium" },
      { instanceId: "w6", type: "task-completion", size: "medium" },
      { instanceId: "w7", type: "notes", size: "medium" },
    ],
  },
  {
    id: "study-mode",
    name: "Study Mode",
    widgets: [
      { instanceId: "w8", type: "pomodoro", size: "medium" },
      { instanceId: "w9", type: "upcoming", size: "large" },
      { instanceId: "w10", type: "weekly-goal", size: "medium" },
      { instanceId: "w11", type: "class-links", size: "medium" },
      { instanceId: "w12", type: "quote", size: "medium" },
    ],
  },
  {
    id: "finals-week",
    name: "Finals Week",
    widgets: [
      { instanceId: "w13", type: "exams", size: "medium" },
      { instanceId: "w14", type: "stoplight", size: "large" },
      { instanceId: "w15", type: "assignment-pie", size: "medium" },
      { instanceId: "w16", type: "streak", size: "small" },
    ],
  },
];

const statusMeta: Record<Stoplight, { label: string; short: string; icon: typeof Circle }> = {
  overdue: { label: "Overdue", short: "Past due", icon: AlertOctagon },
  today: { label: "Due today", short: "Today", icon: Clock3 },
  later: { label: "Due later", short: "Upcoming", icon: Circle },
  done: { label: "Completed", short: "Done", icon: CheckCircle2 },
};

async function workspaceFetch(input: string, init?: RequestInit) {
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  const response = await fetch(input, { ...init, signal });
  if (response.status === 401) throw new SaveFailure("Your session ended or the account changed. Sign in to the same account in a new tab, then retry. Your edits are still here.", "session-error");
  if (response.status === 403) throw new SaveFailure("Your account could not access this workspace. Your edits are still here. Reload after checking your account.", "session-error");
  return response;
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function courseFor(courses: Course[], id: string) {
  return courses.find((course) => course.id === id) ?? { id, code: "Personal", name: "Personal", credits: 0, instructor: "", room: "", color: "#5b63e8", soft: "#eef0ff", initials: "P" };
}

function StatusBadge({ status, compact = false }: { status: Stoplight; compact?: boolean }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <span className={`status-badge status-${status}`} aria-label={meta.label}>
      <Icon size={compact ? 13 : 14} strokeWidth={2.4} aria-hidden="true" />
      {!compact && <span>{meta.short}</span>}
    </span>
  );
}

function CourseStamp({ course, small = false }: { course: Course; small?: boolean }) {
  return (
    <span className={`course-stamp ${small ? "small" : ""}`} style={{ background: course.soft, color: course.color }} aria-hidden="true">
      {course.initials}
    </span>
  );
}

export default function EduEssentialsApp({ initialProfile }: { initialProfile: Profile }) {
  const [profile, setProfile] = useState(initialProfile);
  const [page, setPage] = useState<PageId>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  usePreferences(profile.preferences);
  const studentName = profile.display_name;
  const [courses, setCourses] = useState<Course[]>([]);
  const [storedAssignments, setAssignments] = useState<Assignment[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(defaultWorkspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("my-day");
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [widgetSearch, setWidgetSearch] = useState("");
  const [openWidgetMenu, setOpenWidgetMenu] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<"new" | "rename" | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [studyOpen, setStudyOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const noteFocusRef = useRef<string | null>(null);
  const [dashboardView, setDashboardView] = useState<"cards" | "list">("cards");
  const [selectedClass, setSelectedClass] = useState<Course | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [addClassOpen, setAddClassOpen] = useState(false);
  const [editor, setEditor] = useState<{ course?: Course; details?: CourseDetails; assignment?: Assignment; event?: SavedEvent } | null>(null);
  const [syllabusId, setSyllabusId] = useState<string | null>(null);
  const [extraData, setExtraData] = useState<{ courseDetails: Record<string, CourseDetails>; syllabusDrafts: SyllabusDraft[]; study: StudyData; filePreferences: { filter: string; view: "list" | "grid" } }>({ courseDetails: {}, syllabusDrafts: [], study: emptyStudy(), filePreferences: { filter: "all", view: "list" } });
  const [now, setNow] = useState(() => new Date());
  const today = dayKey(now, profile.timezone);
  const assignments = storedAssignments.map((item) => ({ ...item, status: assignmentStatus(item, today), due: dateLabel(item.dateKey) })).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.dueTime ?? "").localeCompare(b.dueTime ?? ""));
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("month");
  const [calendarFilter, setCalendarFilter] = useState("all");
  const [manualEvents, setManualEvents] = useState<SavedEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [filePreview, setFilePreview] = useState<PrivateFile | null>(null);
  const [fileDialog, setFileDialog] = useState<{ initial?: PrivateFile; defaults?: Partial<FileMetadata>; reviewId?: string } | null>(null);
  const fileStore = usePrivateFiles(initialProfile.id);
  const [toast, setToast] = useState<string | null>(null);
  const profileMajor = profile.major;
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [profilePending, setProfilePending] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileDraft, setProfileDraft] = useState(initialProfile);
  const handleProfileDraft = useCallback((draft: Profile, pending: boolean, busy: boolean) => { setProfileDraft(draft); setProfilePending(pending); setProfileSaving(busy); }, []);
  const accountFetch = useCallback((input: string, init?: RequestInit) => workspaceFetch(input, {
    ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), "x-profile-id": initialProfile.id },
  }), [initialProfile.id]);
  const [autosave] = useState(() => new Autosave(async (snapshot, baseRevision) => {
    const response = await accountFetch("/api/workspace", {
      method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...JSON.parse(snapshot), baseRevision }),
    });
    if (response.status === 409) {
      // A matching readback acknowledges a lost response. Never adopt a newer
      // revision for different content, which would silently overwrite it.
      const readback = await accountFetch("/api/workspace", { cache: "no-store" });
      if (readback.ok) {
        const saved = await readback.json() as WorkspaceResponse;
        if (saved.dashboard && saved.revision) {
          const decoded = decodeWorkspaceState(saved.dashboard);
          const canonical = canonicalJson(academicSnapshot(saved.courses ?? [], encodeWorkspaceState(decoded.workspaces, decoded.activeWorkspaceId, decoded.notes, decoded.data)));
          if (canonical === snapshot) return saved.revision;
        }
      }
      throw new SaveFailure("Another session saved different changes. Download your unsaved work before reloading the saved workspace.", "conflict");
    }
    const result = await response.json() as { revision?: string; error?: string };
    if (!response.ok || !result.revision) throw new SaveFailure(result.error || "Your changes could not be saved. Retry when your connection is available.");
    return result.revision;
  }));
  const saveState = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot, autosave.getSnapshot);
  const persistenceStatus = saveState.status;
  const canWriteFiles = saveState.ready && !saveState.dirty;
  const refreshFiles = fileStore.refresh;
  useEffect(() => { if (saveState.status === "saved") void refreshFiles(); }, [saveState.status, refreshFiles]);
  useSaveProtection(saveState.dirty || profilePending);
  const topSearchRef = useRef<HTMLInputElement | null>(null);
  const study = extraData.study;
  const timezone = profile.timezone, monday = profile.week_starts_on === "Monday";
  const stats = useStudyStats(study.sessions, today, timezone, monday);
  const dailyPercent = goalPercent(stats.dailySeconds, study.dailyMinutes), weeklyPercent = goalPercent(stats.weeklySeconds, study.weeklyMinutes);
  const weeklyCompleted = completedInWeek(assignments, today, profile.timezone, profile.week_starts_on === "Monday");
  useEffect(() => {
    // Completion consumes the active timer and adds its stable session ID in the
    // same account snapshot. Ticks alone never cause database writes.
    const tick = () => {
      const time = new Date(); setNow(time);
      if (saveState.ready) setExtraData((current) => { const next = settleTimer(current.study, time.getTime()); return next === current.study ? current : { ...current, study: next }; });
    };
    const interval = setInterval(tick, 1000);
    window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(interval); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, [saveState.ready]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        topSearchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    autosave.loading();
    async function hydrateWorkspace() {
      try {
        const read = async () => {
          const response = await accountFetch("/api/workspace", { cache: "no-store", signal: controller.signal });
          const data = await response.json() as WorkspaceResponse;
          if (!response.ok) throw new Error(data.error || "Unable to load your workspace. Please retry.");
          return data;
        };
        let data = await read();
        if (!data.initialized) {
          const response = await accountFetch("/api/workspace", {
            method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
            body: JSON.stringify({ action: "initialize", courses: [], dashboard: encodeWorkspaceState(defaultWorkspaces, "my-day", "", { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month" }) }),
          });
          if (!response.ok) throw new Error("Unable to initialize your workspace. Please retry.");
          data = await read();
        }
        if (controller.signal.aborted) return;
        if (!data.dashboard || !data.profile || data.profile.id !== initialProfile.id) throw new Error("Your saved workspace is incomplete or belongs to another account. Please retry loading.");
        const decoded = decodeWorkspaceState(data.dashboard);
        const loadedDetails = decoded.data ?? { assignments: [], manualEvents: [], dashboardView: "cards" as const, calendarView: "month" as const };
        const courseIds = new Set((data.courses ?? []).map((c) => c.id));
        const details = { ...loadedDetails, assignments: loadedDetails.assignments.map((a) => ({ ...a, courseId: courseIds.has(a.courseId) ? a.courseId : "" })), manualEvents: loadedDetails.manualEvents.map((e) => ({ ...e, time: legacyEventTime(e.time), courseId: courseIds.has(e.courseId) ? e.courseId : "" })), calendarFilter: (loadedDetails.calendarFilter === "all" || loadedDetails.calendarFilter === "personal") || courseIds.has(loadedDetails.calendarFilter ?? "") ? loadedDetails.calendarFilter! : "all", courseDetails: loadedDetails.courseDetails ?? {}, syllabusDrafts: loadedDetails.syllabusDrafts ?? [], study: loadedDetails.study ?? emptyStudy(), filePreferences: loadedDetails.filePreferences ?? { filter: "all", view: "list" as const } };
        setProfile(data.profile); setProfileDraft(data.profile); setProfilePending(false);
        setCourses(data.courses ?? []); setWorkspaces(decoded.workspaces);
        setActiveWorkspaceId(decoded.activeWorkspaceId); setNotes(decoded.notes);
        setAssignments(details.assignments); setManualEvents(details.manualEvents);
        setDashboardView(details.dashboardView); setCalendarView(details.calendarView); setCalendarFilter(details.calendarFilter); setExtraData({ courseDetails: details.courseDetails, syllabusDrafts: details.syllabusDrafts, study: settleTimer(details.study, Date.now()), filePreferences: details.filePreferences }); setFileDialog(null); setFilePreview(null); setStudyOpen(false); setEditor(null); setSyllabusId(null);
        setSelectedClass(null); setSelectedAssignment(null);
        autosave.hydrate(canonicalJson({ courses: [...(data.courses ?? [])].sort((a, b) => a.id.localeCompare(b.id)), dashboard: encodeWorkspaceState(decoded.workspaces, decoded.activeWorkspaceId, decoded.notes, details) }), data.revision ?? null);
      } catch (error) { if (!controller.signal.aborted) autosave.loadFailed(error); }
    }
    void hydrateWorkspace();
    return () => { controller.abort(); autosave.stop(); };
  }, [reloadAttempt, accountFetch, autosave, initialProfile.id]);

  useEffect(() => {
    try { autosave.change(canonicalJson(academicSnapshot(courses, encodeWorkspaceState(workspaces, activeWorkspaceId, notes, { assignments: storedAssignments, manualEvents, dashboardView, calendarView, calendarFilter, ...extraData })))); }
    catch (error) { autosave.invalidate(error instanceof Error ? error.message : "Invalid workspace data."); }
  }, [activeWorkspaceId, notes, workspaces, storedAssignments, manualEvents, dashboardView, calendarView, calendarFilter, extraData, courses, autosave]);

  const downloadUnsavedWork = () => downloadDraft("eduessentials-unsaved-work.json", { profile, settingsDraft: profileDraft, courses, assignments: storedAssignments, manualEvents, workspaces, activeWorkspaceId, notes, dashboardView, calendarView, calendarFilter, ...extraData });
  const reloadWorkspace = () => {
    if (persistenceStatus === "saving" || profileSaving) return;
    if ((saveState.dirty || profilePending) && !window.confirm("Replace unsaved workspace and settings edits with saved data? Download your unsaved work first to keep a copy.")) return;
    setReloadAttempt((attempt) => attempt + 1);
  };

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const todayAssignments = assignments.filter((assignment) => assignment.status === "today");
  const overdueAssignments = assignments.filter((assignment) => assignment.status === "overdue");

  const navigate = (destination: PageId) => {
    setPage(destination);
    setSidebarOpen(false);
    setSelectedAssignment(null);
    setSelectedClass(null);
  };

  const flash = (message: string) => setToast(message);

  useEffect(() => {
    if (page !== "home" || !noteFocusRef.current) return;
    const input = document.getElementById(`note-${noteFocusRef.current}`);
    if (input) { input.focus(); input.scrollIntoView?.({ block: "center" }); noteFocusRef.current = null; }
  }, [page, activeWorkspaceId, workspaces]);

  // Validate the entire candidate before accepting a change that cannot be saved.
  const commitWorkspaces = (next: Workspace[], active = activeWorkspaceId, recoveredNotes = notes) => {
    try { academicSnapshot(courses, encodeWorkspaceState(next, active, recoveredNotes, { assignments: storedAssignments, manualEvents, dashboardView, calendarView, calendarFilter, ...extraData })); }
    catch (error) { flash(error instanceof Error ? error.message : "This layout cannot be saved."); return false; }
    setWorkspaces(next); setActiveWorkspaceId(active); setNotes(recoveredNotes);
    return true;
  };

  const updateWorkspaceWidgets = (updater: (widgets: WidgetInstance[]) => WidgetInstance[]) => {
    return commitWorkspaces(workspaces.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, widgets: updater(workspace.widgets) } : workspace));
  };

  const addWidget = (type: WidgetType) => {
    const template = widgetTemplates.find((item) => item.type === type)!;
    if (updateWorkspaceWidgets((widgets) => [...widgets, { instanceId: uid("widget"), type, size: template.defaultSize, ...(type === "notes" ? { note: "" } : {}) }])) flash(`${template.title} added`);
  };

  const moveWidget = (from: number, to: number) => {
    if (from === to || from < 0 || from >= activeWorkspace.widgets.length || to < 0 || to >= activeWorkspace.widgets.length) return;
    updateWorkspaceWidgets((widgets) => {
      const next = [...widgets];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const resizeWidget = (instanceId: string, size: WidgetSize) => {
    updateWorkspaceWidgets((widgets) => widgets.map((widget) => widget.instanceId === instanceId ? { ...widget, size } : widget));
    setOpenWidgetMenu(null);
  };

  const createWorkspace = () => {
    const cleanName = workspaceNameDraft.trim() || "New workspace";
    const id = uid("workspace");
    if (!commitWorkspaces([...workspaces, { id, name: cleanName, widgets: [] }], id)) return;
    setWorkspaceDialog(null);
    setWorkspaceNameDraft("");
    flash(`${cleanName} created`);
  };

  const renameWorkspace = () => {
    const cleanName = workspaceNameDraft.trim();
    if (!cleanName) return;
    if (!commitWorkspaces(workspaces.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, name: cleanName } : workspace))) return;
    setWorkspaceDialog(null);
    setWorkspaceNameDraft("");
    flash("Workspace renamed");
  };

  const duplicateWorkspace = () => {
    const id = uid("workspace");
    const copy: Workspace = { id, name: `${activeWorkspace.name.slice(0, 75)} copy`, widgets: activeWorkspace.widgets.map((widget) => ({ ...widget, instanceId: uid("widget") })) };
    if (!commitWorkspaces([...workspaces, copy], id)) return;
    setWorkspaceMenuOpen(false);
    flash("Workspace duplicated");
  };

  const deleteWorkspace = () => {
    if (workspaces.length === 1) {
      flash("Keep at least one workspace");
      return;
    }
    if (!window.confirm(`Delete ${activeWorkspace.name} and all its widgets and notes?`)) return;
    const next = workspaces.filter((workspace) => workspace.id !== activeWorkspaceId);
    if (!commitWorkspaces(next, next[0].id)) return;
    setWorkspaceMenuOpen(false);
    flash("Workspace deleted");
  };

  const moveWorkspace = (offset: number) => {
    const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId), target = index + offset;
    if (target < 0 || target >= workspaces.length) return;
    const next = [...workspaces]; [next[index], next[target]] = [next[target], next[index]];
    commitWorkspaces(next); setWorkspaceMenuOpen(false);
  };
  const recoverNotes = () => {
    const widget: WidgetInstance = { instanceId: uid("widget"), type: "notes", size: "large", note: notes };
    if (commitWorkspaces(workspaces.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, widgets: [...workspace.widgets, widget] } : workspace), activeWorkspaceId, "")) noteFocusRef.current = widget.instanceId;
  };

  const commitAcademic = (nextCourses: Course[], patch: Partial<WorkspaceData>) => {
    const data = { assignments: storedAssignments, manualEvents, dashboardView, calendarView, calendarFilter, ...extraData, ...patch };
    try { validateAcademicEdit(nextCourses, encodeWorkspaceState(workspaces, activeWorkspaceId, notes, data), { assignments: storedAssignments, manualEvents, dashboardView, calendarView }); }
    catch (error) { flash(error instanceof Error ? error.message : "Review the academic data."); return false; }
    setCourses(nextCourses); setAssignments(data.assignments); setManualEvents(data.manualEvents); setCalendarFilter(data.calendarFilter);
    setExtraData({ courseDetails: data.courseDetails, syllabusDrafts: data.syllabusDrafts, study: data.study, filePreferences: data.filePreferences }); return true;
  };
  const commitStudy = (patch: Partial<StudyData>) => commitAcademic(courses, { study: { ...study, ...patch } });
  const controlTimer = (action: "start" | "pause" | "resume" | "finish" | "reset", kind: TimerKind) => {
    try { commitStudy(timerAction(study, action, kind, Date.now(), uid("session"))); setNow(new Date()); }
    catch (error) { flash(error instanceof Error ? error.message : "Unable to update the timer."); }
  };
  const removeClass = (course: Course) => {
    if (!window.confirm("Remove " + course.code + ", its assignments, grades, and class schedule? Study history, timers, calendar events, and files will remain as personal items.")) return;
    const details = { ...extraData.courseDetails }; delete details[course.id];
    if (commitAcademic(courses.filter((c) => c.id !== course.id), { assignments: storedAssignments.filter((a) => a.courseId !== course.id), manualEvents: manualEvents.map((e) => e.courseId === course.id ? { ...e, courseId: "" } : e), courseDetails: details, study: detachStudyCourse(study, course.id), filePreferences: { ...extraData.filePreferences, filter: extraData.filePreferences.filter === course.id ? "all" : extraData.filePreferences.filter }, calendarFilter: calendarFilter === course.id ? "all" : calendarFilter })) { setSelectedClass(null); setEditor(null); }
  };
  const applyEditor = (value: NonNullable<typeof editor>) => {
    let accepted = false;
    if (value.course) accepted = commitAcademic([...courses.filter((c) => c.id !== value.course!.id), value.course], { courseDetails: { ...extraData.courseDetails, [value.course.id]: value.details ?? emptyCourseDetails() } });
    if (value.assignment) accepted = commitAcademic(courses, { assignments: [...storedAssignments.filter((a) => a.id !== value.assignment!.id), value.assignment] });
    if (value.event) accepted = commitAcademic(courses, { manualEvents: [...manualEvents.filter((e) => e.id !== value.event!.id), value.event] });
    if (accepted) { setEditor(null); setSelectedAssignment(null); setSelectedClass(null); }
    return accepted;
  };
  const newAssignment = () => setEditor({ assignment: { id: uid("assignment"), title: "", courseId: "", due: "", dateKey: today, dueTime: "", type: "Assignment", status: "later", progress: 0, description: "", weight: "", notes: "", checklist: [false, false, false] } });
  const newEvent = () => setEditor({ event: { id: uid("event"), title: "", courseId: "", dateKey: today, time: "", type: "Personal", description: "" } });
  const newReview = () => createReview();
  const createReview = (file?: PrivateFile, sourceText = "") => {
    const draft: SyllabusDraft = { id: uid("review"), sourceText, sourceName: file?.name ?? "", ...(file ? { sourceFileId: file.id } : {}), course: emptyCourse(uid("course")), items: [] };
    if (commitAcademic(courses, { syllabusDrafts: [...extraData.syllabusDrafts, draft] })) { setSyllabusId(draft.id); setAddClassOpen(false); }
  };
  const approveReview = (draft: SyllabusDraft) => {
    const course = { ...draft.course, initials: draft.course.code.slice(0, 2).toUpperCase() };
    const items: Assignment[] = draft.items.map((item) => ({ id: "syllabus-" + item.id, courseId: course.id, title: item.title, type: item.type, dateKey: item.date, due: dateLabel(item.date), status: "later", progress: 0, description: item.description, weight: item.weight, notes: "", checklist: [false, false, false] }));
    const accepted = commitAcademic([...courses.filter((c) => c.id !== course.id), course], { assignments: [...storedAssignments, ...items], syllabusDrafts: extraData.syllabusDrafts.filter((d) => d.id !== draft.id), courseDetails: { ...extraData.courseDetails, [course.id]: { ...emptyCourseDetails(), syllabusText: draft.sourceText, syllabusName: draft.sourceName, ...(draft.sourceFileId ? { syllabusFileId: draft.sourceFileId } : {}) } } });
    if (accepted) setSyllabusId(null); return accepted;
  };
  const toggleAssignmentComplete = (id: string) => {
    const a = storedAssignments.find((a) => a.id === id); if (!a) return;
    const changed: Assignment = a.status === "done" ? { ...a, status: "later", completedAt: null, progress: a.progressBeforeCompletion ?? 0 } : { ...a, status: "done", completedAt: new Date().toISOString(), progressBeforeCompletion: a.progress, progress: 100 };
    if (commitAcademic(courses, { assignments: storedAssignments.map((item) => item.id === id ? changed : item) })) setSelectedAssignment(changed);
  };

  return (
    <div className="app-shell">

      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Primary navigation">
        <div className="brand-row">
          <div className="brand-mark"><BookOpen size={20} strokeWidth={2.5} /></div>
          <div><strong>EduEssentials</strong><span>Student workspace</span></div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>

        <nav className="main-nav">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? "page" : undefined}>
                <Icon size={19} strokeWidth={2.1} />
                <span>{item.label}</span>
                {item.id === "dashboard" && <span className="nav-count">{courses.length}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-focus-card">
          <div className="focus-card-top"><span><Flame size={15} /> {stats.streak} day streak</span><strong>{study.dailyMinutes ? `${dailyPercent}%` : "No target"}</strong></div>
          <div className="tiny-progress"><span style={{ width: `${dailyPercent}%` }} /></div>
          <p>{study.dailyMinutes ? `${durationLabel(Math.max(0, study.dailyMinutes * 60 - stats.dailySeconds))} left toward today’s target.` : "Set your study targets."}</p>
          <button disabled={!saveState.ready} onClick={() => setStudyOpen(true)}>Study & grades <ArrowRight size={14} /></button>
        </div>

        <div className="sidebar-bottom">
          <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button>
          <button className="profile-card" onClick={() => navigate("settings")}>
            <span className="avatar">{studentName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{studentName}</strong><small>{profileMajor}</small></span>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation overlay" />}

      <header className="desktop-topbar">
        <div className="topbar-context">
          <span>Workspace</span>
          <strong>{page.charAt(0).toUpperCase() + page.slice(1)}</strong>
        </div>
        <label className="topbar-search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={topSearchRef}
            aria-label="Search assignments, classes, and files"
            placeholder="Search assignments, classes, and files…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") navigate("search"); }}
          />
          <kbd>Ctrl K</kbd>
        </label>
        <div className="topbar-actions">
          <button className="topbar-date" onClick={() => navigate("calendar")} aria-label="Open today in calendar">
            <CalendarDays size={17} aria-hidden="true" />
            <span><small>Today</small><strong>{dateLabel(today, { month: "short", day: "numeric" })}</strong></span>
          </button>
          <button className="topbar-icon" onClick={() => flash("You’re all caught up")} aria-label="Open notifications">
            <Bell size={18} />
            <span className="notification-dot" />
          </button>
          <button className="topbar-avatar" onClick={() => navigate("settings")} aria-label="Open profile settings">
            {studentName.slice(0, 1).toUpperCase()}
          </button>
        </div>
      </header>

      <main id="main-content" className="main-content">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={22} /></button>
          <span className="mobile-brand"><span className="brand-mark small"><BookOpen size={16} /></span> EduEssentials</span>
          <button className="icon-button" aria-label="Notifications"><Bell size={20} /><span className="notification-dot" /></button>
        </header>

        <div className="workspace-save-bar" role={["load-error", "save-error", "conflict", "session-error"].includes(persistenceStatus) ? "alert" : "status"}>
          <span>{saveState.message || (persistenceStatus === "dirty" ? "Unsaved workspace changes" : persistenceStatus === "saving" ? "Saving workspace…" : persistenceStatus === "saved" ? "Workspace saved" : "Loading your workspace…")}{profilePending && (profileSaving ? " · Saving settings…" : " · Settings have unsaved changes")}</span>
          {profilePending && page !== "settings" && <button onClick={() => navigate("settings")}>Review settings</button>}
          {persistenceStatus === "dirty" && <button onClick={() => void autosave.flush()}>Save now</button>}
          {persistenceStatus === "save-error" && <button onClick={autosave.retry}>Retry save</button>}
          {persistenceStatus === "session-error" && <><a href="/login?error=session" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a><button onClick={saveState.ready ? autosave.retry : reloadWorkspace}>Retry after signing in</button></>}
          {persistenceStatus === "load-error" && <button onClick={reloadWorkspace}>Retry loading</button>}
          {saveState.dirty && <button onClick={downloadUnsavedWork}>Download unsaved work</button>}
          {saveState.dirty && <button disabled={persistenceStatus === "saving" || profileSaving} onClick={reloadWorkspace}>Reload saved workspace</button>}
        </div>
        {(fileStore.error || fileStore.busy) && <div className="workspace-save-bar" role={fileStore.error ? "alert" : "status"}>{fileStore.error || "Saving private files…"}{fileStore.error && <><button onClick={() => void fileStore.refresh()} disabled={fileStore.busy}>Reload files</button><a href="/login" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a></>}</div>}
        {!saveState.ready && <section className="workspace-loading"><h1>{persistenceStatus === "loading" ? "Loading your workspace" : "Your workspace could not be loaded"}</h1><p>Your saved work will be available here when the connection is restored.</p></section>}
        {saveState.ready && page === "home" && renderHome()}
        {saveState.ready && page === "dashboard" && renderDashboard()}
        {saveState.ready && page === "calendar" && renderCalendar()}
        {saveState.ready && page === "search" && renderSearch()}
        {saveState.ready && page === "files" && renderFiles()}
        {saveState.ready && <div key={reloadAttempt} hidden={page !== "settings"}>{renderSettings()}</div>}
      </main>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
        })}
        <button className={page === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button>
      </nav>

      {studyOpen && <StudyPanel data={study} courses={courses} system={profile.gpa_system} term={profile.current_term} studyGoal={profile.study_goal} timezone={profile.timezone} now={now.getTime()} onChange={commitStudy} onTimer={controlTimer} onClose={() => setStudyOpen(false)} />}
      {widgetPickerOpen && renderWidgetPicker()}
      {workspaceDialog && renderWorkspaceDialog()}
      {selectedClass && renderClassDetail(selectedClass)}
      {selectedAssignment && renderAssignmentDetail(selectedAssignment)}
      {addClassOpen && renderAddClassDialog()}
      {editor && <AcademicEditor key={(editor.course ?? editor.assignment ?? editor.event)!.id} initial={editor} courses={courses} today={today} onApply={applyEditor} onClose={() => setEditor(null)} onDelete={editor.course && courses.some((c) => c.id === editor.course!.id) ? () => removeClass(editor.course!) : editor.assignment && storedAssignments.some((a) => a.id === editor.assignment!.id) ? () => { if (window.confirm("Delete this assignment and its notes?")) { if (commitAcademic(courses, { assignments: storedAssignments.filter((a) => a.id !== editor.assignment!.id) })) setEditor(null); } } : editor.event && manualEvents.some((e) => e.id === editor.event!.id) ? () => { if (window.confirm("Delete this event?")) { if (commitAcademic(courses, { manualEvents: manualEvents.filter((e) => e.id !== editor.event!.id) })) setEditor(null); } } : undefined} />}
      {syllabusId && extraData.syllabusDrafts.filter((d) => d.id === syllabusId).map((draft) => <SyllabusReview key={draft.id} draft={draft} onUpload={() => setFileDialog({ defaults: { kind: "syllabus" }, reviewId: draft.id })} onFile={() => { const file = fileStore.files.find((f) => f.id === draft.sourceFileId); if (file) setFilePreview(file); else flash("Refresh Files to load this saved source."); }} onChange={(next) => { commitAcademic(courses, { syllabusDrafts: extraData.syllabusDrafts.map((d) => d.id === draft.id ? next : d) }); }} onApprove={() => approveReview(draft)} onClose={() => setSyllabusId(null)} onDelete={() => { if (window.confirm("Discard this syllabus review and its source text?")) { if (commitAcademic(courses, { syllabusDrafts: extraData.syllabusDrafts.filter((d) => d.id !== draft.id) })) setSyllabusId(null); } }} />)}
      {fileDialog && <FileEditor key={fileDialog.initial?.id ?? fileDialog.reviewId ?? "new-file"} store={fileStore} courses={courses} assignments={assignments} initial={fileDialog.initial} defaults={fileDialog.defaults} canWrite={canWriteFiles} onClose={() => setFileDialog(null)} onSaved={(file) => { if (fileDialog.reviewId) setExtraData((current) => ({ ...current, syllabusDrafts: current.syllabusDrafts.map((draft) => draft.id === fileDialog.reviewId ? { ...draft, sourceFileId: file.id, sourceName: file.name } : draft) })); }} />}
      {filePreview && <FilePreview file={fileStore.files.find((f) => f.id === filePreview.id) ?? filePreview} store={fileStore} onClose={() => setFilePreview(null)} canWrite={canWriteFiles} onEdit={() => { setFileDialog({ initial: fileStore.files.find((f) => f.id === filePreview.id) ?? filePreview }); setFilePreview(null); }} onReview={(file, text) => { createReview(file, text); setFilePreview(null); }} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={17} /> {toast}</div>}
    </div>
  );

  function renderPageHeader(eyebrow: string, title: string, subtitle: string, actions?: React.ReactNode) {
    return (
      <div className="page-heading">
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    );
  }

  function renderHome() {
    const featuredAssignments = assignments.filter((a) => a.dateKey <= today && a.status !== "done").slice(0, 3);
    const schedule = manualEvents.filter((event) => event.dateKey === today).sort((a, b) => a.time.localeCompare(b.time)).map((event) => {
      const course = courseFor(courses, event.courseId);
      return {
        time: event.time || "All day",
        title: event.title,
        detail: course.code === "Personal" ? event.type : course.code,
        color: course.color,
        onOpen: () => setEditor({ event }),
      };
    });
    for (const course of courses) for (const meeting of extraData.courseDetails[course.id]?.meetings ?? []) {
      if (today >= meeting.from && today <= meeting.until && meeting.days.includes(new Date(today + "T12:00:00Z").getUTCDay())) schedule.push({ time: meeting.start, title: course.name, detail: meeting.location || course.room, color: course.color, onOpen: () => setSelectedClass(course) });
    }
    schedule.sort((a, b) => a.time.localeCompare(b.time));

    return (
      <div className="page home-page">
        <section className="home-today-panel" aria-labelledby="today-panel-title">
          <header className="today-panel-header">
            <div>
              <h1 id="today-panel-title">Today</h1>
              <p>The work that matters before you sign off.</p>
            </div>
            <button className="today-panel-link" onClick={() => navigate("dashboard")}>View all tasks <ArrowRight size={14} /></button>
          </header>

          <div className="today-panel-grid">
            <section className="today-panel-section" aria-labelledby="today-tasks-title">
              <div className="today-section-heading">
                <h2 id="today-tasks-title">Tasks</h2>
                <span>{featuredAssignments.length}</span>
              </div>
              <div className="today-task-list">
                {featuredAssignments.length === 0 && <p className="today-empty">No overdue or due-today tasks.</p>}
                {featuredAssignments.map((assignment) => {
                  const course = courseFor(courses, assignment.courseId);
                  return (
                    <button key={assignment.id} className="today-task-row" onClick={() => setSelectedAssignment(assignment)}>
                      <span className={`today-urgency-line ${assignment.status}`} aria-hidden="true" />
                      <span className="today-task-copy">
                        <strong>{assignment.title}</strong>
                        <small>{course.code} · {assignment.due}</small>
                      </span>
                      <StatusBadge status={assignment.status} />
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="today-panel-section today-schedule" aria-labelledby="today-schedule-title">
              <div className="today-section-heading">
                <h2 id="today-schedule-title">Schedule</h2>
                <button onClick={() => navigate("calendar")}>Open calendar</button>
              </div>
              <div className="today-schedule-list">
                {schedule.length === 0 && <p className="today-empty">No events yet. Your schedule will appear here.</p>}
                {schedule.map((item) => (
                  <button key={`${item.time}-${item.title}`} className="today-schedule-row" onClick={item.onOpen}>
                    <time>{item.time}</time>
                    <span className="today-schedule-copy">
                      <span><i style={{ background: item.color }} aria-hidden="true" />{item.title}</span>
                      <small>{item.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="workspace-section">
          <div className="workspace-bar">
            <div className="workspace-tabs" role="tablist" aria-label="Home workspaces">
              {workspaces.map((workspace) => <button key={workspace.id} role="tab" aria-selected={activeWorkspaceId === workspace.id} className={activeWorkspaceId === workspace.id ? "active" : ""} onClick={() => setActiveWorkspaceId(workspace.id)}>{workspace.name}</button>)}
              <button className="add-tab" disabled={workspaces.length >= MAX_WORKSPACES} title={`Up to ${MAX_WORKSPACES} workspaces`} onClick={() => { setWorkspaceNameDraft(""); setWorkspaceDialog("new"); }} aria-label="Add workspace"><Plus size={16} /></button>
            </div>
            <div className="workspace-actions">
              <button className="secondary-button" onClick={() => setWidgetPickerOpen(true)}><Plus size={16} /> Add widget</button>
              <div className="menu-wrap">
                <button className="icon-button" onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-label="Workspace options"><MoreHorizontal size={19} /></button>
                {workspaceMenuOpen && <div className="popover workspace-menu">
                  <button onClick={() => { setWorkspaceNameDraft(activeWorkspace.name); setWorkspaceDialog("rename"); setWorkspaceMenuOpen(false); }}><Pencil size={15} /> Rename</button>
                  <button disabled={workspaces.length >= MAX_WORKSPACES} onClick={duplicateWorkspace}><Copy size={15} /> Duplicate</button>
                  <button disabled={workspaces[0].id === activeWorkspaceId} onClick={() => moveWorkspace(-1)}><ArrowLeft size={15} /> Move left</button>
                  <button disabled={workspaces[workspaces.length - 1].id === activeWorkspaceId} onClick={() => moveWorkspace(1)}><ArrowRight size={15} /> Move right</button>
                  <button className="danger" disabled={workspaces.length === 1} onClick={deleteWorkspace}><Trash2 size={15} /> Delete</button>
                </div>}
              </div>
            </div>
          </div>

          {notes && <div className="workspace-save-bar"><span>Your earlier shared note is saved and available to restore.</span><button disabled={activeWorkspace.widgets.length >= MAX_WIDGETS_PER_WORKSPACE} onClick={recoverNotes}>Add saved note here</button><button onClick={() => downloadDraft("eduessentials-recovered-note.json", { note: notes })}>Download saved note</button></div>}
          {activeWorkspace.widgets.length === 0 ? (
            <div className="empty-workspace">
              <div className="empty-icon"><LayoutGrid size={26} /></div>
              <h2>Make this space yours</h2>
              <p>Add study tools, deadlines, charts, notes, and timers—then arrange them exactly how you like.</p>
              <button className="primary-button" onClick={() => setWidgetPickerOpen(true)}><Plus size={17} /> Browse widgets</button>
            </div>
          ) : (
            <div className="widget-grid" aria-label={`${activeWorkspace.name} widgets`}>
              {activeWorkspace.widgets.map((widget, index) => renderWidget(widget, index))}
              <button className="add-widget-tile" onClick={() => setWidgetPickerOpen(true)}><Plus size={22} /><span>Add widget</span></button>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderWidget(widget: WidgetInstance, index: number) {
    const template = widgetTemplates.find((item) => item.type === widget.type)!;
    const TemplateIcon = template.icon;
    return (
      <article
        key={widget.instanceId}
        className={`widget-card widget-${widget.type} ${draggedWidget === widget.instanceId ? "dragging" : ""}`}
        data-size={widget.size}
        data-widget-id={widget.instanceId}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); if (draggedWidget !== null) moveWidget(activeWorkspace.widgets.findIndex((item) => item.instanceId === draggedWidget), index); setDraggedWidget(null); }}
      >
        <div className="widget-header">
          <span className={`widget-icon tone-${template.color}`}><TemplateIcon size={16} /></span>
          <h2>{template.title}</h2>
          <button className="drag-handle icon-button mini" aria-label={`Drag ${template.title}`} draggable onDragStart={(event) => { event.dataTransfer?.setData("text/plain", widget.instanceId); setDraggedWidget(widget.instanceId); }} onDragEnd={() => setDraggedWidget(null)}><GripVertical size={16} /></button>
          <div className="menu-wrap">
            <button className="icon-button mini" onClick={() => setOpenWidgetMenu(openWidgetMenu === widget.instanceId ? null : widget.instanceId)} aria-label={`${template.title} options`}><MoreHorizontal size={17} /></button>
            {openWidgetMenu === widget.instanceId && (
              <div className="popover widget-menu">
                <p>Widget size</p>
                <div className="size-options">
                  {(["small", "medium", "large"] as WidgetSize[]).map((size) => <button key={size} aria-label={`${size} widget`} aria-pressed={widget.size === size} className={widget.size === size ? "active" : ""} onClick={() => resizeWidget(widget.instanceId, size)}>{size.slice(0, 1).toUpperCase()}</button>)}
                </div>
                <button onClick={() => moveWidget(index, index - 1)} disabled={index === 0}><ArrowLeft size={15} /> Move earlier</button>
                <button onClick={() => moveWidget(index, index + 1)} disabled={index === activeWorkspace.widgets.length - 1}><ArrowRight size={15} /> Move later</button>
                <button disabled={activeWorkspace.widgets.length >= MAX_WIDGETS_PER_WORKSPACE} onClick={() => { updateWorkspaceWidgets((widgets) => [...widgets, { ...widget, instanceId: uid("widget") }]); setOpenWidgetMenu(null); }}><Copy size={15} /> Duplicate</button>
                <button className="danger" onClick={() => { if (widget.note && !window.confirm("Remove this notes widget and its text?")) return; if (updateWorkspaceWidgets((widgets) => widgets.filter((item) => item.instanceId !== widget.instanceId))) { setOpenWidgetMenu(null); flash("Widget removed"); } }}><Trash2 size={15} /> Remove</button>
              </div>
            )}
          </div>
        </div>
        <div className="widget-body">{renderWidgetBody(widget)}</div>
      </article>
    );
  }

  function renderWidgetBody(widget: WidgetInstance) {
    const { type } = widget;
    if (studyWidgetTypes.includes(type)) return <StudyWidget type={type} data={study} stats={stats} courses={courses} assignments={assignments} events={manualEvents} details={extraData.courseDetails} today={today} now={now.getTime()} system={profile.gpa_system} term={profile.current_term} onOpen={() => setStudyOpen(true)} onAssignment={setSelectedAssignment} onEvent={(event) => setEditor({ event })} onCourse={setSelectedClass} onTimer={controlTimer} />;
    if (type === "upcoming") return <div className="compact-list">{assignments.filter((item) => item.status !== "done").slice(0, 4).map((assignment) => { const course = courseFor(courses, assignment.courseId); return <button key={assignment.id} className="compact-assignment" onClick={() => setSelectedAssignment(assignment)}><StatusBadge status={assignment.status} compact /><span><strong>{assignment.title}</strong><small>{course.code} · {assignment.due}</small></span><ChevronRight size={15} /></button>; })}</div>;
    if (type === "stoplight") return <div className="stoplight-summary"><button onClick={() => navigate("dashboard")}><span className="stoplight-count red"><AlertOctagon size={17} />{overdueAssignments.length}</span><span><strong>Overdue</strong><small>Needs attention</small></span></button><button onClick={() => navigate("dashboard")}><span className="stoplight-count amber"><Clock3 size={17} />{todayAssignments.length}</span><span><strong>Due today</strong><small>Before midnight</small></span></button><button onClick={() => navigate("dashboard")}><span className="stoplight-count green"><Circle size={17} />{assignments.filter((item) => item.status === "later").length}</span><span><strong>Upcoming</strong><small>After today</small></span></button></div>;
    if (type === "red-alerts") return <div className="alert-widget"><div className="alert-banner"><AlertOctagon size={18} /><span><strong>{overdueAssignments.length + todayAssignments.length} tasks need attention</strong><small>{overdueAssignments.length} overdue · {todayAssignments.length} due today</small></span></div>{[...overdueAssignments, ...todayAssignments].slice(0, 2).map((assignment) => <button key={assignment.id} onClick={() => setSelectedAssignment(assignment)}><span className={`urgency-line ${assignment.status}`} /><span><strong>{assignment.title}</strong><small>{assignment.due}</small></span><ChevronRight size={15} /></button>)}</div>;
    if (type === "mini-calendar") return <div className="mini-cal"><div className="mini-cal-month"><strong>{dateLabel(today, { month: "long", year: "numeric" })}</strong></div><div className="mini-days">{Array.from({ length: 7 }, (_, i) => addDays(weekStart(today, profile.week_starts_on === "Monday"), i)).map((date) => <button key={date} className={date === today ? "today" : ""} onClick={() => navigate("calendar")}><small>{dateLabel(date, { weekday: "short" })}</small><strong>{Number(date.slice(-2))}</strong>{(assignments.some((a) => a.dateKey === date) || manualEvents.some((e) => e.dateKey === date)) && <i />}</button>)}</div><button className="text-button" onClick={() => navigate("calendar")}>Open full calendar</button></div>;
    if (type === "class-links") return <div className="class-link-grid">{courses.slice(0, 4).map((course) => <button key={course.id} onClick={() => { setPage("dashboard"); setSelectedClass(course); }}><CourseStamp course={course} small /><span><strong>{course.code}</strong><small>{course.name}</small></span><ChevronRight size={14} /></button>)}</div>;
    if (type === "notes") return <div className="notes-widget"><textarea id={`note-${widget.instanceId}`} aria-label="Quick notes" value={widget.note ?? ""} maxLength={MAX_NOTES_LENGTH} onChange={(event) => updateWorkspaceWidgets((widgets) => widgets.map((item) => item.instanceId === widget.instanceId ? { ...item, note: event.target.value } : item))} /><div><span>{persistenceStatus === "saved" ? "Saved" : persistenceStatus === "saving" ? "Saving…" : "Not saved"}</span><button disabled={!widget.note} onClick={() => { if (window.confirm("Clear this note's text?")) updateWorkspaceWidgets((widgets) => widgets.map((item) => item.instanceId === widget.instanceId ? { ...item, note: "" } : item)); }} aria-label="Clear notes"><Trash2 size={14} /></button></div></div>;
    if (type === "quote") return <div className="quote-widget"><QuoteIcon size={24} /><blockquote>Small, focused steps turn heavy weeks into manageable days.</blockquote><span>— Your Edu AI reminder</span></div>;
    return <div className="spacer-widget"><span>Spacer</span><p>This tile creates breathing room. Resize it to shape your layout.</p></div>;
  }

  function renderDashboard() {
    return (
      <div className="page">
        {renderPageHeader("Academic overview", "Your dashboard", "Classes, deadlines, and progress—without the clutter.", <><div className="view-toggle" role="group" aria-label="Dashboard view"><button className={dashboardView === "cards" ? "active" : ""} onClick={() => setDashboardView("cards")}><LayoutGrid size={16} /> Cards</button><button className={dashboardView === "list" ? "active" : ""} onClick={() => setDashboardView("list")}><List size={16} /> List</button></div><button className="primary-button" onClick={() => { setAddClassOpen(true); }}><Plus size={17} /> Add class</button></>)}

        <div className="summary-strip">
          <div><span className="summary-icon red"><AlertOctagon size={18} /></span><p><strong>{overdueAssignments.length}</strong><small>Overdue</small></p></div>
          <div><span className="summary-icon amber"><Clock3 size={18} /></span><p><strong>{todayAssignments.length}</strong><small>Due today</small></p></div>
          <div><span className="summary-icon green"><CheckCircle2 size={18} /></span><p><strong>{weeklyCompleted}</strong><small>Completed this week</small></p></div>
          <div className="summary-progress"><p><strong>{study.weeklyMinutes ? `${weeklyPercent}%` : "No target"}</strong><small>Weekly study goal</small></p><div className="completion-track"><span style={{ width: `${weeklyPercent}%` }} /></div></div>
        </div>

        <div className="academic-actions"><button className="secondary-button" onClick={() => setStudyOpen(true)}>Study goals, history & grades</button><button className="secondary-button" onClick={newAssignment}>Add assignment</button><button className="secondary-button" onClick={newReview}>Import syllabus</button>{extraData.syllabusDrafts.map((draft) => <button className="secondary-button" key={draft.id} onClick={() => setSyllabusId(draft.id)}>Resume {draft.course.code || "syllabus review"}</button>)}</div>
        {dashboardView === "cards" ? (
          <section>
            <div className="section-title-row"><div><h2>Your classes</h2><p>{courses.length} active courses · {courses.reduce((sum, course) => sum + course.credits, 0)} total credits</p></div><button className="text-button" onClick={() => setDashboardView("list")}>View every assignment <ArrowRight size={14} /></button></div>
            <div className="class-grid">
              {courses.map((course) => {
                const courseAssignments = assignments.filter((assignment) => assignment.courseId === course.id && assignment.status !== "done");
                return <button key={course.id} className="class-card" onClick={() => setSelectedClass(course)}>
                  <div className="class-card-visual" style={{ background: `linear-gradient(135deg, ${course.soft}, color-mix(in srgb, ${course.color} 18%, white))` }}>
                    {fileStore.files.filter((f) => f.course_id === course.id && f.kind === "class-image" && f.state === "ready").sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 1).map((f) => <PrivateImage key={f.id} file={f} store={fileStore} />)}<span className="course-watermark">{course.initials}</span><span className="course-pill" style={{ color: course.color }}>{course.code}</span><BookOpen size={34} style={{ color: course.color }} />
                  </div>
                  <div className="class-card-body"><div><h3>{course.name}</h3><p>{course.instructor} · {course.credits} credits</p></div><div className="class-statuses"><span className="status-overdue"><AlertOctagon size={14} />{courseAssignments.filter((item) => item.status === "overdue").length}<small>overdue</small></span><span className="status-today"><Clock3 size={14} />{courseAssignments.filter((item) => item.status === "today").length}<small>today</small></span><span className="status-later"><Circle size={14} />{courseAssignments.filter((item) => item.status === "later").length}<small>later</small></span></div></div>
                </button>;
              })}
              <button className="class-card add-class-card" onClick={() => { setAddClassOpen(true); }}><span><Plus size={24} /></span><strong>Add another class</strong><small>Enter it manually or import a syllabus</small></button>
            </div>
          </section>
        ) : renderAssignmentTable(assignments)}

        {dashboardView === "cards" && <section className="dashboard-upcoming"><div className="section-title-row"><div><h2>Coming up</h2><p>Your nearest deadlines across every class.</p></div><button className="text-button" onClick={() => setDashboardView("list")}>See all <ArrowRight size={14} /></button></div>{renderAssignmentTable(assignments.filter((a) => a.status !== "done").slice(0, 5), true)}</section>}
      </div>
    );
  }

  function renderAssignmentTable(items: Assignment[], compact = false) {
    return <div className={`assignment-table ${compact ? "compact" : ""}`}>
      {!compact && <div className="assignment-table-head"><span>Status</span><span>Assignment</span><span>Class</span><span>Due</span><span>Progress</span><span /></div>}
      {!items.length && <p className="form-hint">No assignments yet.</p>}
      {items.map((assignment) => { const course = courseFor(courses, assignment.courseId); return <button className={`assignment-row ${assignment.status === "done" ? "completed" : ""}`} key={assignment.id} onClick={() => setSelectedAssignment(assignment)}>
        <span><StatusBadge status={assignment.status} /></span>
        <span className="assignment-title"><strong>{assignment.title}</strong>{compact && <small>{course.code}</small>}</span>
        {!compact && <span className="assignment-course"><CourseStamp course={course} small /><span><strong>{course.code}</strong><small>{course.name}</small></span></span>}
        <span className="assignment-due"><strong>{assignment.due.split(",")[0]}</strong><small>{assignment.due.includes(",") ? assignment.due.split(",").slice(1).join(",") : ""}</small></span>
        <span className="row-progress"><i><b style={{ width: `${assignment.progress}%` }} /></i><small>{assignment.progress}%</small></span>
        <ChevronRight size={16} />
      </button>; })}
    </div>;
  }

  function renderCalendar() {
    return <AcademicCalendar courses={courses} assignments={assignments} events={manualEvents} details={extraData.courseDetails} today={today} monday={profile.week_starts_on === "Monday"} timezone={profile.timezone} view={calendarView} filter={calendarFilter} onView={setCalendarView} onFilter={setCalendarFilter} onAssignment={setSelectedAssignment} onEvent={(event) => setEditor({ event })} onCourse={setSelectedClass} onAdd={newEvent} />;
  }

  function renderSearch() {
    const query = searchQuery.toLowerCase().trim();
    const resultGroups = [
      { title: "Assignments", icon: CheckCircle2, items: assignments.filter((assignment) => !query || `${assignment.title} ${assignment.description} ${assignment.notes ?? ""} ${statusMeta[assignment.status].label} ${courseFor(courses, assignment.courseId).code}`.toLowerCase().includes(query)).map((assignment) => ({ id: assignment.id, title: assignment.title, subtitle: `${courseFor(courses, assignment.courseId).code} · ${assignment.due}`, badge: statusMeta[assignment.status].short, action: () => setSelectedAssignment(assignment) })) },
      { title: "Classes", icon: BookOpen, items: courses.filter((course) => !query || `${course.name} ${course.code} ${course.instructor} ${course.room} ${extraData.courseDetails[course.id]?.officeHours ?? ""}`.toLowerCase().includes(query)).map((course) => ({ id: course.id, title: course.name, subtitle: `${course.code} · ${course.instructor}`, badge: `${course.credits} credits`, action: () => setSelectedClass(course) })) },
      { title: "Files", icon: FileText, items: fileStore.files.filter((f) => !query || (f.name + " " + f.kind + " " + f.mime_type + " " + courseFor(courses, f.course_id ?? "").code).toLowerCase().includes(query)).map((f) => ({ id: f.id, title: f.name, subtitle: fileSize(Number(f.size_bytes)) + " · " + f.state, badge: f.kind, action: () => setFilePreview(f) })) },
      { title: "Events", icon: CalendarDays, items: manualEvents.filter((e) => !query || (e.title + " " + e.description + " " + e.type + " " + courseFor(courses, e.courseId).code).toLowerCase().includes(query)).map((e) => ({ id: e.id, title: e.title, subtitle: dateLabel(e.dateKey) + " · " + e.time, badge: e.type, action: () => setEditor({ event: e }) })) },
      { title: "Syllabus text", icon: FileText, items: courses.filter((c) => extraData.courseDetails[c.id]?.syllabusText && (!query || (extraData.courseDetails[c.id].syllabusText + " " + c.code).toLowerCase().includes(query))).map((c) => ({ id: c.id, title: c.code + " syllabus", subtitle: extraData.courseDetails[c.id].syllabusName ?? "Saved text", badge: "Syllabus", action: () => setSelectedClass(c) })) },
      { title: "Syllabus reviews", icon: FileSearch, items: extraData.syllabusDrafts.filter((d) => !query || (d.sourceText + " " + d.sourceName + " " + d.course.code + " " + d.items.map((i) => i.title).join(" ")).toLowerCase().includes(query)).map((d) => ({ id: d.id, title: d.course.code || d.sourceName || "Syllabus review", subtitle: d.sourceName, badge: "Draft", action: () => setSyllabusId(d.id) })) },
      { title: "Grades", icon: GraduationCap, items: study.grades.filter((g) => !query || (courseFor(courses, g.courseId).code + " " + g.term + " " + g.value + " " + g.system).toLowerCase().includes(query)).map((g) => ({ id: g.id, title: courseFor(courses, g.courseId).code + " grade", subtitle: g.value + " / " + g.max + " · " + g.term, badge: g.system, action: () => setStudyOpen(true) })) },
      { title: "Study history", icon: Clock3, items: study.sessions.filter((session) => !query || (session.kind + " " + courseFor(courses, session.courseId).code + " " + session.segments.at(-1)!.end).toLowerCase().includes(query)).map((session) => ({ id: session.id, title: courseFor(courses, session.courseId).code + " study session", subtitle: durationLabel(segmentSeconds(session.segments)) + " · " + session.segments.at(-1)!.end.slice(0, 10), badge: session.kind, action: () => setStudyOpen(true) })) },
      { title: "Notes", icon: StickyNote, items: workspaces.flatMap((workspace) => workspace.widgets.filter((widget) => widget.type === "notes").map((widget, index) => ({ id: widget.instanceId, title: `Quick notes ${index + 1} · ${workspace.name}`, subtitle: (widget.note ?? "").replace(/\n/g, " · "), badge: "Note", action: () => { navigate("home"); setActiveWorkspaceId(workspace.id); noteFocusRef.current = widget.instanceId; } }))).filter((item) => !query || `${item.title} ${item.subtitle}`.toLowerCase().includes(query)) },
    ];
    const resultCount = resultGroups.reduce((total, group) => total + group.items.length, 0);
    return <div className="page search-page">
      {renderPageHeader("Find anything", "Search your workspace", "Search saved text, file names, events, classes, grades, and study history. PDF/image contents are not indexed.")}
      <div className="global-search"><Search size={22} /><input aria-label="Search everything" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Try “reflection,” “office hours,” or “MATH 101”…" />{searchQuery && <button onClick={() => setSearchQuery("")} aria-label="Clear search"><X size={18} /></button>}<kbd>⌘ K</kbd></div>
      {!query && <div className="search-suggestions"><span>Try searching</span>{["Due today", "Lab report", "Office hours", "Grading policy"].map((suggestion) => <button key={suggestion} onClick={() => setSearchQuery(suggestion)}>{suggestion}</button>)}</div>}
      <div className="search-meta"><strong>{resultCount} {query ? `results for “${searchQuery}”` : "items ready to search"}</strong><span>Results update as you type</span></div>
      {resultCount === 0 ? <div className="empty-search"><FileSearch size={30} /><h2>No results found</h2><p>Check the spelling or try a broader phrase.</p></div> : <div className="search-results">{resultGroups.filter((group) => group.items.length).map((group) => { const GroupIcon = group.icon; return <section key={group.title}><div className="result-group-title"><span><GroupIcon size={17} /></span><h2>{group.title}</h2><small>{group.items.length}</small></div><div>{group.items.map((item) => <button key={item.id} onClick={item.action}><span className="result-type-icon"><GroupIcon size={18} /></span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><em>{item.badge}</em><ChevronRight size={16} /></button>)}</div></section>; })}</div>}
    </div>;
  }

  function renderFiles() {
    const prefs = extraData.filePreferences;
    const visible = fileStore.files.filter((f) => (prefs.filter === "all" || (prefs.filter === "personal" ? !f.course_id : f.course_id === prefs.filter)) && (!fileQuery || (f.name + " " + f.kind + " " + courseFor(courses, f.course_id ?? "").code).toLowerCase().includes(fileQuery.toLowerCase())));
    return <div className={"page files-page file-view-" + prefs.view}>{renderPageHeader("Resources", "Your private files", "Original files are stored privately with your account.", <button className="primary-button" disabled={!canWriteFiles} onClick={() => setFileDialog({})}>Upload file</button>)}
      <div className="files-toolbar"><label>Search files<input aria-label="Search files" value={fileQuery} onChange={(e) => setFileQuery(e.target.value)} /></label><label>File class filter<select value={prefs.filter} onChange={(e) => commitAcademic(courses, { filePreferences: { ...prefs, filter: e.target.value } })}><option value="all">All classes and personal</option><option value="personal">Personal</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label><label>File view<select value={prefs.view} onChange={(e) => commitAcademic(courses, { filePreferences: { ...prefs, view: e.target.value as "list" | "grid" } })}><option value="list">List</option><option value="grid">Grid</option></select></label><button className="secondary-button" disabled={fileStore.busy} onClick={() => void fileStore.refresh()}>Refresh files</button></div>
      <p>{fileSize(fileStore.files.filter((f) => f.state === "ready").reduce((sum, f) => sum + Number(f.size_bytes), 0))} in ready files · {fileStore.files.length} / 1,000 files · 25 MiB maximum per file</p>
      {fileStore.loading && <p>Loading files…</p>}<FileList files={visible} store={fileStore} onOpen={setFilePreview} onEdit={(initial) => setFileDialog({ initial })} canWrite={canWriteFiles} />
    </div>;
  }

  function renderSettings() {
    return <div className="page settings-page">
      {renderPageHeader("Make it yours", "Settings", "Your profile and preferences follow your Google account.")}
      <ProfileEditor initialProfile={profile} onSaved={setProfile} onDraftChange={handleProfileDraft} />
      <section className="settings-card"><h2>Account & data</h2><div className="data-actions"><a className="secondary-button" aria-disabled={profilePending || saveState.dirty || fileStore.busy} onClick={(e) => { if (profilePending || saveState.dirty || fileStore.busy) e.preventDefault(); }} href={"/api/export?account=" + encodeURIComponent(initialProfile.id)} target="_blank" rel="noopener noreferrer">Export saved account (.zip)</a><button className="secondary-button" onClick={downloadUnsavedWork}>Download current drafts (.json)</button><form action="/auth/signout" method="post"><button className="secondary-button" disabled={profilePending || saveState.dirty || fileStore.busy}>Sign out</button></form></div>{(profilePending || saveState.dirty) && <p className="form-hint">Save or discard pending edits before signing out. Download a draft first if you want to keep a copy.</p>}</section>
    </div>;
  }

  function renderWidgetPicker() {
    const filtered = widgetTemplates.filter((template) => `${template.title} ${template.description}`.toLowerCase().includes(widgetSearch.toLowerCase()));
    return <div className="modal-backdrop"><div className="widget-picker-modal" role="dialog" aria-modal="true" aria-labelledby="widget-picker-title"><div className="modal-header"><div><p className="eyebrow">Customize {activeWorkspace.name}</p><h2 id="widget-picker-title">Add a widget</h2><p>Choose a study tile, then move and resize it on your grid.</p></div><button className="icon-button" onClick={() => { setWidgetPickerOpen(false); setWidgetSearch(""); }} aria-label="Close widget picker"><X size={20} /></button></div><div className="picker-search"><Search size={17} /><input aria-label="Search widgets" placeholder="Search 18 widgets…" value={widgetSearch} onChange={(event) => setWidgetSearch(event.target.value)} /></div><div className="widget-picker-grid">{filtered.map((template) => { const Icon = template.icon; return <button key={template.type} disabled={activeWorkspace.widgets.length >= MAX_WIDGETS_PER_WORKSPACE} onClick={() => addWidget(template.type)}><span className={`picker-icon tone-${template.color}`}><Icon size={20} /></span><span><strong>{template.title}</strong><small>{template.description}</small></span><Plus size={18} /></button>; })}</div><div className="picker-footer"><span>{activeWorkspace.widgets.length} / {MAX_WIDGETS_PER_WORKSPACE} widgets · Drag or use Move earlier/later</span><button className="primary-button" onClick={() => setWidgetPickerOpen(false)}>Done</button></div></div></div>;
  }

  function renderWorkspaceDialog() {
    return <div className="modal-backdrop"><form className="small-modal" onSubmit={(event) => { event.preventDefault(); if (workspaceDialog === "new") createWorkspace(); else renameWorkspace(); }}><div className="modal-header"><div><p className="eyebrow">Home workspace</p><h2>{workspaceDialog === "new" ? "Create a new workspace" : "Rename workspace"}</h2></div><button type="button" className="icon-button" onClick={() => setWorkspaceDialog(null)}><X size={19} /></button></div><label>Workspace name<input required maxLength={80} value={workspaceNameDraft} onChange={(event) => setWorkspaceNameDraft(event.target.value)} placeholder="e.g. Finals Prep" /></label><p className="form-hint">New workspaces start empty so you can build them exactly how you want.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setWorkspaceDialog(null)}>Cancel</button><button className="primary-button">{workspaceDialog === "new" ? "Create workspace" : "Save name"}</button></div></form></div>;
  }

  function renderClassDetail(course: Course) {
    const items = assignments.filter((a) => a.courseId === course.id), details = extraData.courseDetails[course.id] ?? emptyCourseDetails();
    const average = study.grades.find((g) => g.courseId === course.id && g.system === profile.gpa_system && g.term === profile.current_term);
    const studySeconds = study.sessions.filter((s) => s.courseId === course.id).reduce((sum, s) => sum + segmentSeconds(s.segments), 0);
    return <div className="modal-backdrop side-panel-backdrop"><aside className="detail-panel" role="dialog" aria-modal="true" aria-label="Class details"><div className="modal-header"><h2>{course.code} · {course.name}</h2><button className="secondary-button" onClick={() => setSelectedClass(null)}>Close class</button></div><div className="detail-panel-body"><p>{course.credits} credits · {course.room || "No location entered"}</p><h3>Files and images</h3><button className="secondary-button" disabled={!canWriteFiles} onClick={() => setFileDialog({ defaults: { courseId: course.id } })}>Add class file</button><button className="secondary-button" disabled={!canWriteFiles} onClick={() => setFileDialog({ defaults: { courseId: course.id, kind: "class-image" } })}>Upload class image</button><FileList files={fileStore.files.filter((f) => f.course_id === course.id)} store={fileStore} onOpen={setFilePreview} onEdit={(initial) => setFileDialog({ initial })} canWrite={canWriteFiles} />{details.syllabusFileId && <button className="secondary-button" onClick={() => { const next = { ...details }; delete next.syllabusFileId; commitAcademic(courses, { courseDetails: { ...extraData.courseDetails, [course.id]: next } }); }}>Detach syllabus file</button>}<h3>Progress</h3><p>{durationLabel(studySeconds)} recorded study · {items.filter((a) => a.status === "done").length} / {items.length} assignments complete</p><p>{average ? `Grade: ${average.value.toFixed(2)} / ${average.max}` : "No matching grade entered"} · {profile.current_term || "Unspecified term"}</p><button className="text-button" onClick={() => { setSelectedClass(null); setStudyOpen(true); }}>Study history & grades</button><h3>Instructor</h3><p>{course.instructor || "No instructor entered"}</p><h3>Office hours</h3><p>{details.officeHours || "No office hours entered"}</p><h3>Schedule</h3>{details.meetings.length ? details.meetings.map((m) => <p key={m.id}>{m.days.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")} · {m.start}–{m.end} · {m.location || course.room}<br />{dateLabel(m.from)} – {dateLabel(m.until)}</p>) : <p>No recurring meetings entered.</p>}<div className="modal-actions"><button className="primary-button" onClick={() => { setEditor({ course, details }); setSelectedClass(null); }}>Edit class</button><button className="secondary-button" onClick={() => { setCalendarFilter(course.id); setSelectedClass(null); navigate("calendar"); }}>View schedule</button></div><h3>Assignments</h3>{renderAssignmentTable(items, true)}<button className="secondary-button" onClick={() => { setSelectedClass(null); setEditor({ assignment: { id: uid("assignment"), title: "", courseId: course.id, due: "", dateKey: today, type: "Assignment", status: "later", progress: 0, description: "", weight: "" } }); }}>Add assignment</button>{details.syllabusText && <details><summary>Saved syllabus source</summary><pre className="syllabus-source">{details.syllabusText}</pre></details>}<button className="secondary-button full remove-class-button" onClick={() => removeClass(course)}>Remove class</button></div></aside></div>;
  }

  function renderAssignmentDetail(assignment: Assignment) {
    const current = storedAssignments.find((a) => a.id === assignment.id) ?? assignment;
    const course = courseFor(courses, current.courseId);
    return <div className="modal-backdrop"><section className="assignment-modal academic-editor" role="dialog" aria-modal="true" aria-label="Assignment details"><div className="modal-header"><div><p>{course.code} · {current.type ?? "Assignment"}</p><h2>{current.title}</h2></div><button className="secondary-button" onClick={() => setSelectedAssignment(null)}>Close assignment</button></div><p>Due {dateLabel(current.dateKey)} {current.dueTime ?? ""}</p><StatusBadge status={assignmentStatus(current, today)} /><p>{current.description || "No description entered."}</p><p>Weight: {current.weight || "Not entered"} · Progress: {current.progress}%</p><h3>Attachments</h3><button className="secondary-button" disabled={!canWriteFiles} onClick={() => setFileDialog({ defaults: { courseId: current.courseId, assignmentId: current.id, kind: "attachment" } })}>Attach file</button><FileList files={fileStore.files.filter((f) => f.assignment_id === current.id)} store={fileStore} onOpen={setFilePreview} onEdit={(initial) => setFileDialog({ initial })} canWrite={canWriteFiles} /><h3>Notes</h3><p className="syllabus-source">{current.notes || "No notes yet."}</p><ul>{["Review instructions and rubric", "Complete first draft", "Proofread and submit"].map((label, i) => <li key={label}>{current.checklist?.[i] ? "✓" : "○"} {label}</li>)}</ul><div className="modal-actions"><button className="primary-button" onClick={() => { setEditor({ assignment: current }); setSelectedAssignment(null); }}>Edit assignment</button><button className="secondary-button" onClick={() => toggleAssignmentComplete(current.id)}>{current.status === "done" ? "Mark incomplete" : "Mark complete"}</button><button className="secondary-button" onClick={() => { if (window.confirm("Delete this assignment and its notes?")) { if (commitAcademic(courses, { assignments: storedAssignments.filter((a) => a.id !== current.id) })) setSelectedAssignment(null); } }}>Delete assignment</button></div></section></div>;
  }

  function renderAddClassDialog() {
    return <div className="modal-backdrop"><section className="small-modal" role="dialog" aria-modal="true" aria-label="Add a class"><div className="modal-header"><h2>Add a class</h2><button className="secondary-button" onClick={() => setAddClassOpen(false)}>Close</button></div><div className="modal-actions"><button className="primary-button" onClick={() => { setEditor({ course: emptyCourse(uid("course")), details: emptyCourseDetails() }); setAddClassOpen(false); }}>Manual entry</button><button className="secondary-button" onClick={newReview}>Import syllabus</button></div><h3>Saved syllabus reviews</h3>{extraData.syllabusDrafts.length ? extraData.syllabusDrafts.map((draft) => <button className="secondary-button" key={draft.id} onClick={() => { setSyllabusId(draft.id); setAddClassOpen(false); }}>{draft.course.code || draft.sourceName || "Untitled review"}</button>) : <p>No pending reviews.</p>}</section></div>;
  }

}
