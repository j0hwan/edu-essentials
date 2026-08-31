"use client";

import {
  Accessibility,
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  Flame,
  FolderOpen,
  GraduationCap,
  GripVertical,
  House,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  List,
  Maximize2,
  Menu,
  Minimize2,
  Monitor,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  PieChart,
  Play,
  Plus,
  Quote as QuoteIcon,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Sun,
  Target,
  TimerReset,
  Trash2,
  Trophy,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type PageId = "home" | "dashboard" | "calendar" | "search" | "files" | "settings";
type Stoplight = "overdue" | "today" | "later" | "done";
type WidgetSize = "small" | "medium" | "large";

type Course = {
  id: string;
  code: string;
  name: string;
  credits: number;
  instructor: string;
  room: string;
  color: string;
  soft: string;
  initials: string;
};

type Assignment = {
  id: string;
  title: string;
  courseId: string;
  due: string;
  dateKey: string;
  status: Stoplight;
  progress: number;
  description: string;
  weight: string;
};

type WidgetType =
  | "daily-goal"
  | "weekly-goal"
  | "upcoming"
  | "stoplight"
  | "red-alerts"
  | "mini-calendar"
  | "pomodoro"
  | "focus-timer"
  | "task-completion"
  | "assignment-pie"
  | "gpa"
  | "class-links"
  | "notes"
  | "exams"
  | "streak"
  | "today"
  | "quote"
  | "spacer";

type WidgetInstance = { instanceId: string; type: WidgetType; size: WidgetSize };
type Workspace = { id: string; name: string; widgets: WidgetInstance[] };

const navItems: { id: PageId; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "search", label: "Search", icon: Search },
  { id: "files", label: "Files", icon: FolderOpen },
];

const initialCourses: Course[] = [
  { id: "math", code: "MATH 101", name: "Calculus I", credits: 4, instructor: "Dr. Elena Park", room: "Science 214", color: "#5b63e8", soft: "#eef0ff", initials: "M1" },
  { id: "psych", code: "PSYC 220", name: "Cognitive Psychology", credits: 3, instructor: "Prof. Marcus Reed", room: "Hale 108", color: "#df6b57", soft: "#fff0ec", initials: "P2" },
  { id: "bio", code: "BIO 115", name: "Principles of Biology", credits: 4, instructor: "Dr. Nina Shah", room: "Life Sci 302", color: "#249975", soft: "#e9f8f2", initials: "B1" },
  { id: "writing", code: "WRIT 150", name: "Academic Writing", credits: 3, instructor: "Jordan Ellis", room: "Library 42", color: "#d6922c", soft: "#fff7e6", initials: "W1" },
];

const initialAssignments: Assignment[] = [
  { id: "a1", title: "Limits problem set", courseId: "math", due: "Yesterday, 11:59 PM", dateKey: "2026-08-11", status: "overdue", progress: 70, description: "Complete problems 1–24 and show your work for all odd-numbered questions.", weight: "5%" },
  { id: "a2", title: "Memory lab reflection", courseId: "psych", due: "Today, 4:00 PM", dateKey: "2026-08-12", status: "today", progress: 45, description: "Write a 600-word reflection connecting the memory lab to two concepts from lecture.", weight: "8%" },
  { id: "a3", title: "Cell structure quiz", courseId: "bio", due: "Today, 9:00 PM", dateKey: "2026-08-12", status: "today", progress: 20, description: "Review organelles, cell transport, and microscopy vocabulary before starting the quiz.", weight: "4%" },
  { id: "a4", title: "Argument essay outline", courseId: "writing", due: "Tomorrow, 11:59 PM", dateKey: "2026-08-13", status: "later", progress: 60, description: "Submit a thesis, three supporting claims, and at least four annotated sources.", weight: "10%" },
  { id: "a5", title: "Derivative practice", courseId: "math", due: "Friday, 6:00 PM", dateKey: "2026-08-14", status: "later", progress: 15, description: "Complete the adaptive practice set on the product and quotient rules.", weight: "3%" },
  { id: "a6", title: "Research methods notes", courseId: "psych", due: "Monday, 10:00 AM", dateKey: "2026-08-17", status: "later", progress: 0, description: "Create a one-page study sheet covering experimental and correlational methods.", weight: "2%" },
  { id: "a7", title: "Lab report: osmosis", courseId: "bio", due: "Wednesday, 3:30 PM", dateKey: "2026-08-19", status: "later", progress: 35, description: "Write the results and discussion sections using the shared class data.", weight: "12%" },
  { id: "a8", title: "Source evaluation", courseId: "writing", due: "Friday, 11:59 PM", dateKey: "2026-08-21", status: "later", progress: 100, description: "Evaluate three scholarly sources using the CRAAP framework.", weight: "5%" },
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

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function courseFor(courses: Course[], id: string) {
  return courses.find((course) => course.id === id) ?? courses[0];
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

export default function EduEssentialsApp() {
  const [page, setPage] = useState<PageId>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [studentName, setStudentName] = useState("Maya");
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(defaultWorkspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("my-day");
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [widgetSearch, setWidgetSearch] = useState("");
  const [openWidgetMenu, setOpenWidgetMenu] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<"new" | "rename" | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [draggedWidget, setDraggedWidget] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [notes, setNotes] = useState("Review derivatives\nEmail Professor Park\nBring lab goggles");
  const [dashboardView, setDashboardView] = useState<"cards" | "list">("cards");
  const [selectedClass, setSelectedClass] = useState<Course | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [addClassOpen, setAddClassOpen] = useState(false);
  const [addClassMode, setAddClassMode] = useState<"manual" | "import" | "review">("manual");
  const [parsing, setParsing] = useState(false);
  const [reviewRows, setReviewRows] = useState([
    { id: "r1", title: "Chapter 1 response", date: "2026-08-24", type: "Assignment" },
    { id: "r2", title: "Midterm exam", date: "2026-09-18", type: "Exam" },
    { id: "r3", title: "Final presentation", date: "2026-11-30", type: "Project" },
  ]);
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("month");
  const [calendarOffset, setCalendarOffset] = useState(0);
  const [calendarFilterOpen, setCalendarFilterOpen] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState("all");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [manualEvents, setManualEvents] = useState([{ id: "e1", title: "Study group", dateKey: "2026-08-13", time: "6:30 PM", type: "Study block", courseId: "math" }]);
  const [searchQuery, setSearchQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [profileMajor, setProfileMajor] = useState("Cognitive Science");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const topSearchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onboarded = window.localStorage.getItem("eduessentials-onboarded");
    if (!onboarded) setShowOnboarding(true);
    const savedTheme = window.localStorage.getItem("eduessentials-theme") as typeof theme | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const applied = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    root.dataset.theme = applied;
    root.dataset.motion = reducedMotion ? "reduced" : "full";
    window.localStorage.setItem("eduessentials-theme", theme);
  }, [theme, reducedMotion]);

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((seconds) => {
          if (seconds <= 1) {
            setTimerRunning(false);
            return 25 * 60;
          }
          return seconds - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning]);

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

  const updateWorkspaceWidgets = (updater: (widgets: WidgetInstance[]) => WidgetInstance[]) => {
    setWorkspaces((current) => current.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, widgets: updater(workspace.widgets) } : workspace));
  };

  const addWidget = (type: WidgetType) => {
    const template = widgetTemplates.find((item) => item.type === type)!;
    updateWorkspaceWidgets((widgets) => [...widgets, { instanceId: uid("widget"), type, size: template.defaultSize }]);
    flash(`${template.title} added`);
  };

  const moveWidget = (from: number, to: number) => {
    if (from === to || to < 0 || to >= activeWorkspace.widgets.length) return;
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
    setWorkspaces((current) => [...current, { id, name: cleanName, widgets: [] }]);
    setActiveWorkspaceId(id);
    setWorkspaceDialog(null);
    setWorkspaceNameDraft("");
    flash(`${cleanName} created`);
  };

  const renameWorkspace = () => {
    const cleanName = workspaceNameDraft.trim();
    if (!cleanName) return;
    setWorkspaces((current) => current.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, name: cleanName } : workspace));
    setWorkspaceDialog(null);
    setWorkspaceNameDraft("");
    flash("Workspace renamed");
  };

  const duplicateWorkspace = () => {
    const id = uid("workspace");
    const copy: Workspace = { id, name: `${activeWorkspace.name} copy`, widgets: activeWorkspace.widgets.map((widget) => ({ ...widget, instanceId: uid("widget") })) };
    setWorkspaces((current) => [...current, copy]);
    setActiveWorkspaceId(id);
    setWorkspaceMenuOpen(false);
    flash("Workspace duplicated");
  };

  const deleteWorkspace = () => {
    if (workspaces.length === 1) {
      flash("Keep at least one workspace");
      return;
    }
    const next = workspaces.filter((workspace) => workspace.id !== activeWorkspaceId);
    setWorkspaces(next);
    setActiveWorkspaceId(next[0].id);
    setWorkspaceMenuOpen(false);
    flash("Workspace deleted");
  };

  const completeOnboarding = () => {
    window.localStorage.setItem("eduessentials-onboarded", "true");
    setShowOnboarding(false);
    setOnboardingStep(0);
    flash("Your workspace is ready");
  };

  const handleManualClass = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const name = String(data.get("className") || "New Course");
    const code = String(data.get("classCode") || "COURSE 101");
    const color = String(data.get("classColor") || "#5b63e8");
    const id = uid("course");
    setCourses((current) => [...current, {
      id,
      code,
      name,
      credits: Number(data.get("credits") || 3),
      instructor: String(data.get("instructor") || "Instructor TBA"),
      room: String(data.get("meeting") || "Location TBA"),
      color,
      soft: `${color}18`,
      initials: code.slice(0, 2).toUpperCase(),
    }]);
    setAddClassOpen(false);
    flash(`${code} added to your dashboard`);
  };

  const parseSyllabus = () => {
    setParsing(true);
    setTimeout(() => {
      setParsing(false);
      setAddClassMode("review");
    }, 1100);
  };

  const approveImport = () => {
    const newCourse: Course = { id: "sociology", code: "SOCI 130", name: "Social Change", credits: 3, instructor: "Dr. Avery Kim", room: "Barton 206", color: "#8c5bd7", soft: "#f3ecff", initials: "S1" };
    setCourses((current) => current.some((course) => course.id === newCourse.id) ? current : [...current, newCourse]);
    setAssignments((current) => [
      ...current,
      ...reviewRows.map((row, index) => ({ id: uid("assignment"), title: row.title, courseId: newCourse.id, due: new Date(`${row.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }), dateKey: row.date, status: "later" as Stoplight, progress: 0, description: `Imported from the ${newCourse.code} syllabus.`, weight: index === 1 ? "20%" : "10%" })),
    ]);
    setAddClassOpen(false);
    setAddClassMode("manual");
    flash("Syllabus verified and class added");
  };

  const toggleAssignmentComplete = (assignmentId: string) => {
    setAssignments((current) => current.map((assignment) => assignment.id === assignmentId ? { ...assignment, status: assignment.status === "done" ? "later" : "done", progress: assignment.status === "done" ? 60 : 100 } : assignment));
    setSelectedAssignment((current) => current?.id === assignmentId ? { ...current, status: current.status === "done" ? "later" : "done", progress: current.status === "done" ? 60 : 100 } : current);
    flash("Assignment updated");
  };

  const addCalendarEvent = (form: HTMLFormElement) => {
    const data = new FormData(form);
    setManualEvents((current) => [...current, {
      id: uid("event"),
      title: String(data.get("title") || "New event"),
      dateKey: String(data.get("date") || "2026-08-12"),
      time: String(data.get("time") || "12:00 PM"),
      type: String(data.get("type") || "Study block"),
      courseId: String(data.get("course") || "math"),
    }]);
    setEventDialogOpen(false);
    flash("Event added to calendar");
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
                {item.id === "dashboard" && <span className="nav-count">2</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-focus-card">
          <div className="focus-card-top"><span><Flame size={15} /> 8 day streak</span><strong>67%</strong></div>
          <div className="tiny-progress"><span style={{ width: "67%" }} /></div>
          <p>40 more minutes to reach today’s goal.</p>
          <button onClick={() => { navigate("home"); setActiveWorkspaceId("study-mode"); }}>Start focus session <ArrowRight size={14} /></button>
        </div>

        <div className="sidebar-bottom">
          <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button>
          <button className="profile-card" onClick={() => navigate("settings")}>
            <span className="avatar">{studentName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{studentName} Chen</strong><small>{profileMajor}</small></span>
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
            <span><small>Today</small><strong>Aug 12</strong></span>
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

        {page === "home" && renderHome()}
        {page === "dashboard" && renderDashboard()}
        {page === "calendar" && renderCalendar()}
        {page === "search" && renderSearch()}
        {page === "files" && renderFiles()}
        {page === "settings" && renderSettings()}
      </main>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
        })}
        <button className={page === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button>
      </nav>

      {showOnboarding && renderOnboarding()}
      {widgetPickerOpen && renderWidgetPicker()}
      {workspaceDialog && renderWorkspaceDialog()}
      {selectedClass && renderClassDetail(selectedClass)}
      {selectedAssignment && renderAssignmentDetail(selectedAssignment)}
      {addClassOpen && renderAddClassDialog()}
      {eventDialogOpen && renderEventDialog()}
      {filePreview && renderFilePreview(filePreview)}
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
    const featuredAssignments = assignments.slice(0, 3);
    const schedule = [
      { time: "2:00 PM", title: "Calculus lecture", detail: "Science Hall 201", color: courses[0].color, onOpen: () => navigate("calendar") },
      { time: "4:00 PM", title: "Memory lab reflection due", detail: "PSYC 220", color: courses[1].color, onOpen: () => setSelectedAssignment(assignments[1]) },
      { time: "6:30 PM", title: "Study group", detail: "University Library", color: "var(--red)", onOpen: () => navigate("calendar") },
    ];

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
              <button className="add-tab" onClick={() => { setWorkspaceNameDraft(""); setWorkspaceDialog("new"); }} aria-label="Add workspace"><Plus size={16} /></button>
            </div>
            <div className="workspace-actions">
              <button className="secondary-button" onClick={() => setWidgetPickerOpen(true)}><Plus size={16} /> Add widget</button>
              <div className="menu-wrap">
                <button className="icon-button" onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-label="Workspace options"><MoreHorizontal size={19} /></button>
                {workspaceMenuOpen && <div className="popover workspace-menu">
                  <button onClick={() => { setWorkspaceNameDraft(activeWorkspace.name); setWorkspaceDialog("rename"); setWorkspaceMenuOpen(false); }}><Pencil size={15} /> Rename</button>
                  <button onClick={duplicateWorkspace}><Copy size={15} /> Duplicate</button>
                  <button onClick={() => {
                    const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
                    if (index > 0) setWorkspaces((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; });
                    setWorkspaceMenuOpen(false);
                  }}><ArrowLeft size={15} /> Move left</button>
                  <button className="danger" onClick={deleteWorkspace}><Trash2 size={15} /> Delete</button>
                </div>}
              </div>
            </div>
          </div>

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
        className={`widget-card widget-${widget.type} ${draggedWidget === index ? "dragging" : ""}`}
        data-size={widget.size}
        draggable
        onDragStart={() => setDraggedWidget(index)}
        onDragEnter={(event) => { event.preventDefault(); if (draggedWidget !== null && draggedWidget !== index) { moveWidget(draggedWidget, index); setDraggedWidget(index); } }}
        onDragOver={(event) => event.preventDefault()}
        onDragEnd={() => { setDraggedWidget(null); flash("Widget moved"); }}
      >
        <div className="widget-header">
          <span className={`widget-icon tone-${template.color}`}><TemplateIcon size={16} /></span>
          <h2>{template.title}</h2>
          <span className="drag-handle" aria-hidden="true"><GripVertical size={16} /></span>
          <div className="menu-wrap">
            <button className="icon-button mini" onClick={() => setOpenWidgetMenu(openWidgetMenu === widget.instanceId ? null : widget.instanceId)} aria-label={`${template.title} options`}><MoreHorizontal size={17} /></button>
            {openWidgetMenu === widget.instanceId && (
              <div className="popover widget-menu">
                <p>Widget size</p>
                <div className="size-options">
                  {(["small", "medium", "large"] as WidgetSize[]).map((size) => <button key={size} className={widget.size === size ? "active" : ""} onClick={() => resizeWidget(widget.instanceId, size)}>{size.slice(0, 1).toUpperCase()}</button>)}
                </div>
                <button onClick={() => moveWidget(index, index - 1)} disabled={index === 0}><ArrowLeft size={15} /> Move earlier</button>
                <button onClick={() => moveWidget(index, index + 1)} disabled={index === activeWorkspace.widgets.length - 1}><ArrowRight size={15} /> Move later</button>
                <button onClick={() => { updateWorkspaceWidgets((widgets) => [...widgets, { ...widget, instanceId: uid("widget") }]); setOpenWidgetMenu(null); }}><Copy size={15} /> Duplicate</button>
                <button className="danger" onClick={() => { updateWorkspaceWidgets((widgets) => widgets.filter((item) => item.instanceId !== widget.instanceId)); setOpenWidgetMenu(null); flash("Widget removed"); }}><Trash2 size={15} /> Remove</button>
              </div>
            )}
          </div>
        </div>
        <div className="widget-body">{renderWidgetBody(widget.type)}</div>
      </article>
    );
  }

  function renderWidgetBody(type: WidgetType) {
    if (type === "daily-goal") return <div className="goal-widget"><div className="progress-ring" style={{ "--progress": "67%" } as React.CSSProperties}><strong>67%</strong><span>complete</span></div><div><strong>2h 00m</strong><p>of your 3 hour goal</p><button className="text-button" onClick={() => flash("Study goal editor opened")}>Adjust goal <ArrowRight size={13} /></button></div></div>;
    if (type === "weekly-goal") return <div><div className="metric-row"><span><strong>9h 40m</strong><small>of 14 hours</small></span><b>69%</b></div><div className="week-bars">{[62, 80, 45, 74, 30, 18, 0].map((height, i) => <span key={i}><i style={{ height: `${Math.max(height, 6)}%` }} /><small>{["M", "T", "W", "T", "F", "S", "S"][i]}</small></span>)}</div></div>;
    if (type === "upcoming") return <div className="compact-list">{assignments.filter((item) => item.status !== "done").slice(0, 4).map((assignment) => { const course = courseFor(courses, assignment.courseId); return <button key={assignment.id} className="compact-assignment" onClick={() => setSelectedAssignment(assignment)}><StatusBadge status={assignment.status} compact /><span><strong>{assignment.title}</strong><small>{course.code} · {assignment.due}</small></span><ChevronRight size={15} /></button>; })}</div>;
    if (type === "stoplight") return <div className="stoplight-summary"><button onClick={() => navigate("dashboard")}><span className="stoplight-count red"><AlertOctagon size={17} />{overdueAssignments.length}</span><span><strong>Overdue</strong><small>Needs attention</small></span></button><button onClick={() => navigate("dashboard")}><span className="stoplight-count amber"><Clock3 size={17} />{todayAssignments.length}</span><span><strong>Due today</strong><small>Before midnight</small></span></button><button onClick={() => navigate("dashboard")}><span className="stoplight-count green"><Circle size={17} />{assignments.filter((item) => item.status === "later").length}</span><span><strong>Upcoming</strong><small>After today</small></span></button></div>;
    if (type === "red-alerts") return <div className="alert-widget"><div className="alert-banner"><AlertOctagon size={18} /><span><strong>{overdueAssignments.length + todayAssignments.length} tasks need attention</strong><small>One is already overdue</small></span></div>{[...overdueAssignments, ...todayAssignments].slice(0, 2).map((assignment) => <button key={assignment.id} onClick={() => setSelectedAssignment(assignment)}><span className={`urgency-line ${assignment.status}`} /><span><strong>{assignment.title}</strong><small>{assignment.due}</small></span><ChevronRight size={15} /></button>)}</div>;
    if (type === "mini-calendar") return <div className="mini-cal"><div className="mini-cal-month"><strong>August 2026</strong><span>Week 33</span></div><div className="mini-days">{[10,11,12,13,14,15,16].map((day, i) => <button key={day} className={day === 12 ? "today" : ""} onClick={() => navigate("calendar")}><small>{["M","T","W","T","F","S","S"][i]}</small><strong>{day}</strong>{[11,12,13,14].includes(day) && <i />}</button>)}</div><button className="text-button" onClick={() => navigate("calendar")}>Open full calendar <ArrowRight size={13} /></button></div>;
    if (type === "pomodoro") return <div className={`timer-widget ${timerRunning ? "running" : ""}`}><div className="timer-dial"><strong>{String(Math.floor(timerSeconds / 60)).padStart(2, "0")}:{String(timerSeconds % 60).padStart(2, "0")}</strong><span>Focus</span></div><div className="timer-controls"><button onClick={() => setTimerRunning((running) => !running)} aria-label={timerRunning ? "Pause timer" : "Start timer"}>{timerRunning ? <Pause size={18} /> : <Play size={18} />}</button><button onClick={() => { setTimerRunning(false); setTimerSeconds(25 * 60); }} aria-label="Reset timer"><RotateCcw size={17} /></button></div></div>;
    if (type === "focus-timer") return <div className="focus-timer"><strong>45:00</strong><p>Deep work · No interruptions</p><button className="primary-button compact" onClick={() => flash("45-minute focus started")}><Play size={15} /> Begin</button></div>;
    if (type === "task-completion") return <div className="completion-widget"><div className="big-number"><strong>18</strong><span>of 24 tasks</span></div><div className="completion-track"><span style={{ width: "75%" }} /></div><div className="legend-row"><span><i className="legend-dot done" />18 complete</span><span><i className="legend-dot open" />6 open</span></div><p>Up 12% from last week</p></div>;
    if (type === "assignment-pie") return <div className="pie-widget"><div className="pie-chart"><span><strong>8</strong><small>open</small></span></div><div className="pie-legend">{courses.slice(0, 4).map((course, index) => <span key={course.id}><i style={{ background: course.color }} />{course.code}<b>{[3,2,2,1][index]}</b></span>)}</div></div>;
    if (type === "gpa") return <div className="gpa-widget"><strong>3.82</strong><span>Current GPA</span><p><ArrowRight size={14} className="trend-up" /> +0.14 this term</p><div className="gpa-scale"><i style={{ width: "95.5%" }} /></div></div>;
    if (type === "class-links") return <div className="class-link-grid">{courses.slice(0, 4).map((course) => <button key={course.id} onClick={() => { setPage("dashboard"); setSelectedClass(course); }}><CourseStamp course={course} small /><span><strong>{course.code}</strong><small>{course.name}</small></span><ChevronRight size={14} /></button>)}</div>;
    if (type === "notes") return <div className="notes-widget"><textarea aria-label="Quick notes" value={notes} onChange={(event) => setNotes(event.target.value)} /><div><span>Saved just now</span><button onClick={() => setNotes("")} aria-label="Clear notes"><Trash2 size={14} /></button></div></div>;
    if (type === "exams") return <div className="exam-list"><button><span className="exam-date"><strong>24</strong><small>AUG</small></span><span><strong>Calculus quiz 2</strong><small>MATH 101 · 12 days</small></span></button><button><span className="exam-date"><strong>02</strong><small>SEP</small></span><span><strong>Biology practical</strong><small>BIO 115 · 21 days</small></span></button></div>;
    if (type === "streak") return <div className="streak-widget"><span className="flame-orb"><Flame size={28} /></span><div><strong>8 days</strong><span>Longest: 14 days</span></div><div className="streak-dots">{[1,2,3,4,5,6,7].map((day) => <i key={day} className={day < 7 ? "filled" : ""} />)}</div></div>;
    if (type === "today") return <div className="today-widget"><div className="today-column"><p className="widget-kicker">Up next</p><strong>Memory lab reflection</strong><span>PSYC 220 · Due at 4:00 PM</span><div className="completion-track"><span style={{ width: "45%" }} /></div><button className="primary-button compact" onClick={() => setSelectedAssignment(assignments[1])}>Continue work <ArrowRight size={14} /></button></div><div className="today-agenda"><p><Clock3 size={14} /> Today’s agenda</p><span><i>2:00</i> Calculus lecture</span><span><i>4:00</i> Reflection due</span><span><i>6:30</i> Study group</span></div></div>;
    if (type === "quote") return <div className="quote-widget"><QuoteIcon size={24} /><blockquote>Small, focused steps turn heavy weeks into manageable days.</blockquote><span>— Your Edu AI reminder</span></div>;
    return <div className="spacer-widget"><span>Spacer</span><p>This tile creates breathing room. Resize it to shape your layout.</p></div>;
  }

  function renderDashboard() {
    return (
      <div className="page">
        {renderPageHeader("Academic overview", "Your dashboard", "Classes, deadlines, and progress—without the clutter.", <><div className="view-toggle" role="group" aria-label="Dashboard view"><button className={dashboardView === "cards" ? "active" : ""} onClick={() => setDashboardView("cards")}><LayoutGrid size={16} /> Cards</button><button className={dashboardView === "list" ? "active" : ""} onClick={() => setDashboardView("list")}><List size={16} /> List</button></div><button className="primary-button" onClick={() => { setAddClassMode("manual"); setAddClassOpen(true); }}><Plus size={17} /> Add class</button></>)}

        <div className="summary-strip">
          <div><span className="summary-icon red"><AlertOctagon size={18} /></span><p><strong>{overdueAssignments.length}</strong><small>Overdue</small></p></div>
          <div><span className="summary-icon amber"><Clock3 size={18} /></span><p><strong>{todayAssignments.length}</strong><small>Due today</small></p></div>
          <div><span className="summary-icon green"><CheckCircle2 size={18} /></span><p><strong>18</strong><small>Completed this week</small></p></div>
          <div className="summary-progress"><p><strong>67%</strong><small>Weekly study goal</small></p><div className="completion-track"><span style={{ width: "67%" }} /></div></div>
        </div>

        {dashboardView === "cards" ? (
          <section>
            <div className="section-title-row"><div><h2>Your classes</h2><p>{courses.length} active courses · 14 total credits</p></div><button className="text-button" onClick={() => setDashboardView("list")}>View every assignment <ArrowRight size={14} /></button></div>
            <div className="class-grid">
              {courses.map((course) => {
                const courseAssignments = assignments.filter((assignment) => assignment.courseId === course.id && assignment.status !== "done");
                return <button key={course.id} className="class-card" onClick={() => setSelectedClass(course)}>
                  <div className="class-card-visual" style={{ background: `linear-gradient(135deg, ${course.soft}, color-mix(in srgb, ${course.color} 18%, white))` }}>
                    <span className="course-watermark">{course.initials}</span><span className="course-pill" style={{ color: course.color }}>{course.code}</span><BookOpen size={34} style={{ color: course.color }} />
                  </div>
                  <div className="class-card-body"><div><h3>{course.name}</h3><p>{course.instructor} · {course.credits} credits</p></div><div className="class-statuses"><span className="status-overdue"><AlertOctagon size={14} />{courseAssignments.filter((item) => item.status === "overdue").length}<small>overdue</small></span><span className="status-today"><Clock3 size={14} />{courseAssignments.filter((item) => item.status === "today").length}<small>today</small></span><span className="status-later"><Circle size={14} />{courseAssignments.filter((item) => item.status === "later").length}<small>later</small></span></div></div>
                </button>;
              })}
              <button className="class-card add-class-card" onClick={() => { setAddClassMode("manual"); setAddClassOpen(true); }}><span><Plus size={24} /></span><strong>Add another class</strong><small>Enter it manually or import a syllabus</small></button>
            </div>
          </section>
        ) : renderAssignmentTable(assignments)}

        {dashboardView === "cards" && <section className="dashboard-upcoming"><div className="section-title-row"><div><h2>Coming up</h2><p>Your nearest deadlines across every class.</p></div><button className="text-button" onClick={() => setDashboardView("list")}>See all <ArrowRight size={14} /></button></div>{renderAssignmentTable(assignments.slice(0, 5), true)}</section>}
      </div>
    );
  }

  function renderAssignmentTable(items: Assignment[], compact = false) {
    return <div className={`assignment-table ${compact ? "compact" : ""}`}>
      {!compact && <div className="assignment-table-head"><span>Status</span><span>Assignment</span><span>Class</span><span>Due</span><span>Progress</span><span /></div>}
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
    const baseDate = new Date(2026, 7 + calendarOffset, 1);
    const monthLabel = baseDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const startDay = baseDate.getDay();
    const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
    const prevDays = new Date(baseDate.getFullYear(), baseDate.getMonth(), 0).getDate();
    const cells = Array.from({ length: 42 }, (_, index) => {
      const raw = index - startDay + 1;
      if (raw < 1) return { day: prevDays + raw, muted: true, dateKey: "" };
      if (raw > daysInMonth) return { day: raw - daysInMonth, muted: true, dateKey: "" };
      const dateKey = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}-${String(raw).padStart(2, "0")}`;
      return { day: raw, muted: false, dateKey };
    });
    return <div className="page calendar-page">
      {renderPageHeader("Planning", "Calendar", "A dedicated view of deadlines, classes, and study time.", <><button className="secondary-button filter-button" onClick={() => setCalendarFilterOpen((open) => !open)}><SlidersHorizontal size={16} /> Filter <ChevronDown size={14} /></button><button className="primary-button" onClick={() => setEventDialogOpen(true)}><Plus size={17} /> Add event</button></>)}
      {calendarFilterOpen && <div className="calendar-filter-panel"><strong>Show on calendar</strong><div>{["all", ...courses.map((course) => course.id)].map((filter) => <button key={filter} className={calendarFilter === filter ? "active" : ""} onClick={() => setCalendarFilter(filter)}>{filter === "all" ? "All classes" : courseFor(courses, filter).code}{calendarFilter === filter && <Check size={14} />}</button>)}</div></div>}
      <div className="calendar-toolbar">
        <div className="calendar-title-controls"><button className="secondary-button compact-button" onClick={() => setCalendarOffset(0)}>Today</button><button className="icon-button" onClick={() => setCalendarOffset((offset) => offset - 1)} aria-label="Previous period"><ChevronLeft size={20} /></button><button className="icon-button" onClick={() => setCalendarOffset((offset) => offset + 1)} aria-label="Next period"><ChevronRight size={20} /></button><h2>{monthLabel}</h2></div>
        <div className="view-toggle"><button className={calendarView === "month" ? "active" : ""} onClick={() => setCalendarView("month")}>Month</button><button className={calendarView === "week" ? "active" : ""} onClick={() => setCalendarView("week")}>Week</button><button className={calendarView === "day" ? "active" : ""} onClick={() => setCalendarView("day")}>Day</button></div>
      </div>
      {calendarView === "month" && <div className="calendar-grid"><div className="calendar-weekdays">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-cells">{cells.map((cell, index) => {
        const dayAssignments = cell.dateKey ? assignments.filter((assignment) => assignment.dateKey === cell.dateKey && (calendarFilter === "all" || assignment.courseId === calendarFilter)) : [];
        const dayEvents = cell.dateKey ? manualEvents.filter((event) => event.dateKey === cell.dateKey && (calendarFilter === "all" || event.courseId === calendarFilter)) : [];
        const isToday = cell.dateKey === "2026-08-12";
        return <div className={`calendar-cell ${cell.muted ? "muted" : ""} ${isToday ? "is-today" : ""}`} key={index}><span className="day-number">{cell.day}{isToday && <small>Today</small>}</span><div className="calendar-events">{dayAssignments.slice(0, 3).map((assignment) => <button className={`calendar-chip ${assignment.status}`} key={assignment.id} onClick={() => setSelectedAssignment(assignment)} title={`${assignment.title}, ${statusMeta[assignment.status].label}`}><i />{assignment.title}<small>{courseFor(courses, assignment.courseId).code}</small></button>)}{dayEvents.map((event) => <button className="calendar-chip event" key={event.id} onClick={() => flash(`${event.title} · ${event.time}`)}><i />{event.title}<small>{event.time}</small></button>)}</div></div>;
      })}</div></div>}
      {calendarView === "week" && renderWeekCalendar()}
      {calendarView === "day" && renderDayCalendar()}
      <div className="calendar-legend"><span><i className="overdue" /> Overdue</span><span><i className="today" /> Due today</span><span><i className="later" /> Due later</span><span><i className="event" /> Personal event</span></div>
    </div>;
  }

  function renderWeekCalendar() {
    return <div className="week-calendar"><div className="week-header"><span /><span>Mon 10</span><span>Tue 11</span><span className="today">Wed 12<small>Today</small></span><span>Thu 13</span><span>Fri 14</span><span>Sat 15</span><span>Sun 16</span></div>{["9 AM","11 AM","1 PM","3 PM","5 PM","7 PM"].map((time, row) => <div className="week-row" key={time}><span>{time}</span>{Array.from({ length: 7 }, (_, day) => <div key={day}>{row === 2 && day === 2 && <button className="schedule-block indigo" onClick={() => flash("Calculus lecture · Science 214")}><strong>Calculus</strong><small>2:00–3:15</small></button>}{row === 3 && day === 2 && <button className="schedule-block amber" onClick={() => setSelectedAssignment(assignments[1])}><strong>Reflection due</strong><small>4:00 PM</small></button>}{row === 4 && day === 3 && <button className="schedule-block teal" onClick={() => flash("Study group · 6:30 PM")}><strong>Study group</strong><small>6:30–7:30</small></button>}</div>)}</div>)}</div>;
  }

  function renderDayCalendar() {
    return <div className="day-calendar"><div className="day-agenda-head"><div className="date-tile"><span>AUG</span><strong>12</strong></div><div><h3>Wednesday</h3><p>3 scheduled items · 2 deadlines</p></div><span className="weather-pill"><Sun size={15} /> 73°</span></div><div className="day-timeline">{["9:00 AM","10:30 AM","12:00 PM","2:00 PM","4:00 PM","6:30 PM","8:00 PM"].map((time, index) => <div key={time}><span>{time}</span><i />{index === 3 && <button className="agenda-block indigo"><strong>Calculus lecture</strong><small>Science 214 · 2:00–3:15 PM</small></button>}{index === 4 && <button className="agenda-block amber" onClick={() => setSelectedAssignment(assignments[1])}><strong>Memory lab reflection due</strong><small>PSYC 220 · 45% complete</small></button>}{index === 5 && <button className="agenda-block teal"><strong>Study group</strong><small>Learning Commons · 6:30–7:30 PM</small></button>}</div>)}</div></div>;
  }

  function renderSearch() {
    const query = searchQuery.toLowerCase().trim();
    const resultGroups = [
      { title: "Assignments", icon: CheckCircle2, items: assignments.filter((assignment) => !query || `${assignment.title} ${assignment.description} ${courseFor(courses, assignment.courseId).code}`.toLowerCase().includes(query)).map((assignment) => ({ id: assignment.id, title: assignment.title, subtitle: `${courseFor(courses, assignment.courseId).code} · ${assignment.due}`, badge: statusMeta[assignment.status].short, action: () => setSelectedAssignment(assignment) })) },
      { title: "Classes", icon: BookOpen, items: courses.filter((course) => !query || `${course.name} ${course.code} ${course.instructor}`.toLowerCase().includes(query)).map((course) => ({ id: course.id, title: course.name, subtitle: `${course.code} · ${course.instructor}`, badge: `${course.credits} credits`, action: () => setSelectedClass(course) })) },
      { title: "Syllabi & files", icon: FileText, items: [
        { id: "f1", title: "MATH 101 Syllabus.pdf", subtitle: "Mentions: office hours, grading policy, limits", badge: "PDF", action: () => setFilePreview("MATH 101 Syllabus.pdf") },
        { id: "f2", title: "Memory Lab Instructions.pdf", subtitle: "Mentions: reflection, encoding, lab procedure", badge: "PDF", action: () => setFilePreview("Memory Lab Instructions.pdf") },
      ].filter((item) => !query || `${item.title} ${item.subtitle}`.toLowerCase().includes(query)) },
      { title: "Notes", icon: StickyNote, items: [{ id: "n1", title: "Quick notes", subtitle: notes.replace(/\n/g, " · "), badge: "Note", action: () => { navigate("home"); setActiveWorkspaceId("my-day"); } }].filter((item) => !query || `${item.title} ${item.subtitle}`.toLowerCase().includes(query)) },
    ];
    const resultCount = resultGroups.reduce((total, group) => total + group.items.length, 0);
    return <div className="page search-page">
      {renderPageHeader("Find anything", "Search your workspace", "Assignments, syllabi, notes, events, classes, and files in one place.")}
      <div className="global-search"><Search size={22} /><input autoFocus aria-label="Search everything" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Try “reflection,” “office hours,” or “MATH 101”…" />{searchQuery && <button onClick={() => setSearchQuery("")} aria-label="Clear search"><X size={18} /></button>}<kbd>⌘ K</kbd></div>
      {!query && <div className="search-suggestions"><span>Try searching</span>{["Due today", "Lab report", "Office hours", "Grading policy"].map((suggestion) => <button key={suggestion} onClick={() => setSearchQuery(suggestion)}>{suggestion}</button>)}</div>}
      <div className="search-meta"><strong>{resultCount} {query ? `results for “${searchQuery}”` : "items ready to search"}</strong><span>Results update as you type</span></div>
      {resultCount === 0 ? <div className="empty-search"><FileSearch size={30} /><h2>No results found</h2><p>Check the spelling or try a broader phrase.</p></div> : <div className="search-results">{resultGroups.filter((group) => group.items.length).map((group) => { const GroupIcon = group.icon; return <section key={group.title}><div className="result-group-title"><span><GroupIcon size={17} /></span><h2>{group.title}</h2><small>{group.items.length}</small></div><div>{group.items.slice(0, query ? 8 : 3).map((item) => <button key={item.id} onClick={item.action}><span className="result-type-icon"><GroupIcon size={18} /></span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><em>{item.badge}</em><ChevronRight size={16} /></button>)}</div></section>; })}</div>}
    </div>;
  }

  function renderFiles() {
    const fileItems = [
      { name: "MATH 101 Syllabus.pdf", course: "math", type: "Syllabus", size: "1.8 MB", updated: "Aug 2" },
      { name: "Limits practice set.pdf", course: "math", type: "Assignment", size: "420 KB", updated: "Aug 10" },
      { name: "Memory Lab Instructions.pdf", course: "psych", type: "Class resource", size: "2.1 MB", updated: "Aug 8" },
      { name: "Cognitive Psychology Syllabus.pdf", course: "psych", type: "Syllabus", size: "1.2 MB", updated: "Aug 1" },
      { name: "Cell microscopy guide.jpg", course: "bio", type: "Image", size: "3.4 MB", updated: "Aug 11" },
      { name: "Osmosis lab data.csv", course: "bio", type: "Dataset", size: "84 KB", updated: "Aug 12" },
      { name: "Essay rubric.pdf", course: "writing", type: "Class resource", size: "308 KB", updated: "Aug 5" },
    ].filter((file) => !fileQuery || `${file.name} ${file.type} ${courseFor(courses, file.course).code}`.toLowerCase().includes(fileQuery.toLowerCase()));
    return <div className="page files-page">
      {renderPageHeader("Resources", "Your files", "Syllabi, class resources, and assignment attachments—organized automatically.", <label className="primary-button upload-button"><UploadCloud size={17} /> Upload file<input type="file" onChange={(event) => { if (event.target.files?.[0]) flash(`${event.target.files[0].name} uploaded`); }} /></label>)}
      <div className="files-toolbar"><div className="inline-search"><Search size={17} /><input aria-label="Search files" placeholder="Search files…" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} /></div><button className="secondary-button"><SlidersHorizontal size={16} /> All classes <ChevronDown size={14} /></button><button className="secondary-button"><List size={16} /> List</button></div>
      <div className="storage-card"><div className="storage-copy"><span className="storage-icon"><FolderOpen size={20} /></span><div><strong>2.4 GB of 10 GB used</strong><p>Your course files are backed up and searchable.</p></div></div><div className="storage-bar"><span style={{ width: "24%" }} /></div><small>24%</small></div>
      <div className="file-table"><div className="file-table-head"><span>Name</span><span>Class</span><span>Type</span><span>Updated</span><span>Size</span><span /></div>{fileItems.map((file) => { const course = courseFor(courses, file.course); const image = file.type === "Image"; return <button className="file-row" key={file.name} onClick={() => setFilePreview(file.name)}><span className={`file-type ${image ? "image" : ""}`}>{image ? <ImageIcon size={20} /> : <FileText size={20} />}</span><span><strong>{file.name}</strong><small>{file.name.split(".").pop()?.toUpperCase()}</small></span><span className="file-course"><CourseStamp course={course} small />{course.code}</span><span>{file.type}</span><span>{file.updated}</span><span>{file.size}</span><MoreHorizontal size={17} /></button>; })}</div>
      {fileItems.length === 0 && <div className="empty-search"><FileSearch size={30} /><h2>No matching files</h2><p>Try a class name or file type.</p></div>}
    </div>;
  }

  function renderSettings() {
    return <div className="page settings-page">
      {renderPageHeader("Preferences", "Settings", "Keep EduEssentials aligned with the way you study.", <button className="primary-button" onClick={() => flash("All changes saved")}><Check size={17} /> Save changes</button>)}
      <div className="settings-layout"><nav className="settings-nav"><a href="#appearance" className="active"><Sun size={17} /> Appearance</a><a href="#profile"><UserRound size={17} /> Profile</a><a href="#academic"><GraduationCap size={17} /> Academic</a><a href="#notifications"><Bell size={17} /> Notifications</a><a href="#accessibility"><Accessibility size={17} /> Accessibility</a><a href="#data"><ShieldCheck size={17} /> Data & privacy</a></nav><div className="settings-content">
        <section className="settings-card" id="appearance"><div className="settings-card-title"><span><Sun size={19} /></span><div><h2>Appearance</h2><p>Choose how your workspace looks.</p></div></div><div className="setting-row"><div><strong>Theme</strong><p>Use light, dark, or match your computer.</p></div><div className="theme-options">{([{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }, { id: "system", label: "System", icon: Monitor }] as const).map((option) => { const Icon = option.icon; return <button key={option.id} className={theme === option.id ? "active" : ""} onClick={() => setTheme(option.id)}><Icon size={18} /><span>{option.label}</span>{theme === option.id && <Check size={14} />}</button>; })}</div></div></section>
        <section className="settings-card" id="profile"><div className="settings-card-title"><span><UserRound size={19} /></span><div><h2>Profile</h2><p>Personal details help Edu AI make useful suggestions.</p></div></div><div className="settings-form-grid"><label>First name<input value={studentName} onChange={(event) => setStudentName(event.target.value)} /></label><label>Last name<input defaultValue="Chen" /></label><label>College or university<input defaultValue="Northbridge University" /></label><label>Major<input value={profileMajor} onChange={(event) => setProfileMajor(event.target.value)} /></label><label>Academic year<select defaultValue="Sophomore"><option>Freshman</option><option>Sophomore</option><option>Junior</option><option>Senior</option><option>Graduate</option></select></label><label>Study goal<input defaultValue="Build a consistent study routine" /></label></div></section>
        <section className="settings-card" id="academic"><div className="settings-card-title"><span><GraduationCap size={19} /></span><div><h2>Academic preferences</h2><p>Set up terms, grades, and planning rules.</p></div></div><div className="settings-form-grid"><label>Academic structure<select defaultValue="Semester"><option>Quarter</option><option>Semester</option><option>Trimester</option></select></label><label>GPA system<select defaultValue="4.0 scale"><option>4.0 scale</option><option>Percentage</option><option>Custom</option></select></label><label>Current term<input defaultValue="Fall 2026" /></label><label>Week starts on<select defaultValue="Monday"><option>Sunday</option><option>Monday</option></select></label></div></section>
        <section className="settings-card" id="notifications"><div className="settings-card-title"><span><Bell size={19} /></span><div><h2>Notifications</h2><p>Stay informed without feeling interrupted.</p></div></div>{[["Deadline reminders", "24 hours and 2 hours before work is due", true], ["Daily study plan", "A morning summary of your day", true], ["Study streak nudges", "A gentle reminder when your streak is at risk", false]].map(([title, description, checked]) => <div className="toggle-row" key={String(title)}><div><strong>{title}</strong><p>{description}</p></div><label className="switch"><input type="checkbox" defaultChecked={Boolean(checked)} /><span /></label></div>)}</section>
        <section className="settings-card" id="accessibility"><div className="settings-card-title"><span><Accessibility size={19} /></span><div><h2>Accessibility</h2><p>Adjust movement and visual comfort.</p></div></div><div className="toggle-row"><div><strong>Reduce motion</strong><p>Replace animated movement with simple transitions.</p></div><label className="switch"><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /><span /></label></div><div className="toggle-row"><div><strong>High-contrast status labels</strong><p>Show text and shapes alongside stoplight colors.</p></div><label className="switch"><input type="checkbox" defaultChecked /><span /></label></div></section>
        <section className="settings-card" id="data"><div className="settings-card-title"><span><ShieldCheck size={19} /></span><div><h2>Data & privacy</h2><p>Control what you keep and take with you.</p></div></div><div className="data-actions"><button className="secondary-button" onClick={() => { const blob = new Blob([JSON.stringify({ profile: { studentName, profileMajor }, courses, assignments }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "eduessentials-export.json"; anchor.click(); URL.revokeObjectURL(url); flash("Data export downloaded"); }}><Download size={16} /> Export data</button><label className="secondary-button upload-button"><UploadCloud size={16} /> Import data<input type="file" accept="application/json" onChange={(event) => { if (event.target.files?.[0]) flash("Import ready for review"); }} /></label></div><p className="privacy-note"><ShieldCheck size={15} /> AI-imported syllabus information is always shown for review before anything is saved.</p></section>
      </div></div>
    </div>;
  }

  function renderOnboarding() {
    const steps = ["About you", "Academic setup", "Personalize"];
    return <div className="modal-backdrop onboarding-backdrop"><div className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><div className="onboarding-brand"><div className="brand-mark"><BookOpen size={20} /></div><strong>EduEssentials</strong><button onClick={completeOnboarding}>Skip for now</button></div><div className="onboarding-progress">{steps.map((step, index) => <div key={step} className={index <= onboardingStep ? "active" : ""}><span>{index < onboardingStep ? <Check size={14} /> : index + 1}</span><small>{step}</small></div>)}</div>
      <div className="onboarding-content">
        {onboardingStep === 0 && <><span className="onboarding-icon"><Sparkles size={24} /></span><p className="eyebrow">Welcome to your new workspace</p><h1 id="onboarding-title">Let’s make college feel manageable.</h1><p className="onboarding-lead">A few details help Edu AI suggest the right deadlines, study blocks, and priorities for you.</p><div className="onboarding-form"><label>What should we call you?<input autoFocus value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="First name" /></label><label>College or university <small>Optional</small><input defaultValue="Northbridge University" /></label><div className="two-fields"><label>Academic year<select defaultValue="Sophomore"><option>Freshman</option><option>Sophomore</option><option>Junior</option><option>Senior</option><option>Graduate</option></select></label><label>Age <small>Optional</small><input type="number" placeholder="19" /></label></div></div></>}
        {onboardingStep === 1 && <><span className="onboarding-icon"><GraduationCap size={24} /></span><p className="eyebrow">Academic setup</p><h1 id="onboarding-title">How is your school organized?</h1><p className="onboarding-lead">We’ll use this to understand due dates, credits, and your term rhythm.</p><div className="onboarding-form"><label>Academic structure<div className="choice-cards">{["Quarter","Semester","Trimester"].map((choice) => <button key={choice} className={choice === "Semester" ? "active" : ""}>{choice}{choice === "Semester" && <Check size={15} />}</button>)}</div></label><label>GPA system<div className="choice-cards">{["4.0 scale","Percentage","Custom"].map((choice) => <button key={choice} className={choice === "4.0 scale" ? "active" : ""}>{choice}{choice === "4.0 scale" && <Check size={15} />}</button>)}</div></label><label>Major<input value={profileMajor} onChange={(event) => setProfileMajor(event.target.value)} /></label></div></>}
        {onboardingStep === 2 && <><span className="onboarding-icon"><Sun size={24} /></span><p className="eyebrow">Make it yours</p><h1 id="onboarding-title">Choose your starting style.</h1><p className="onboarding-lead">You can change any of this later in Settings.</p><div className="onboarding-form"><label>Appearance<div className="theme-choice-large">{([{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }, { id: "system", label: "System", icon: Monitor }] as const).map((option) => { const Icon = option.icon; return <button key={option.id} className={theme === option.id ? "active" : ""} onClick={() => setTheme(option.id)}><span><Icon size={22} /></span><strong>{option.label}</strong>{theme === option.id && <Check size={15} />}</button>; })}</div></label><label>What would you most like help with?<div className="goal-chips">{["Meet every deadline","Study consistently","Improve my GPA","Feel less overwhelmed"].map((goal, index) => <button key={goal} className={index < 2 ? "active" : ""}>{index < 2 && <Check size={14} />}{goal}</button>)}</div></label><div className="ai-privacy"><ShieldCheck size={18} /><p><strong>You stay in control.</strong><span>Edu AI suggests; you review and approve changes before they reach your calendar.</span></p></div></div></>}
      </div><div className="onboarding-footer"><button className="secondary-button" disabled={onboardingStep === 0} onClick={() => setOnboardingStep((step) => Math.max(0, step - 1))}><ArrowLeft size={16} /> Back</button><span>Step {onboardingStep + 1} of 3</span><button className="primary-button" onClick={() => onboardingStep === 2 ? completeOnboarding() : setOnboardingStep((step) => step + 1)}>{onboardingStep === 2 ? "Open my workspace" : "Continue"} <ArrowRight size={16} /></button></div></div></div>;
  }

  function renderWidgetPicker() {
    const filtered = widgetTemplates.filter((template) => `${template.title} ${template.description}`.toLowerCase().includes(widgetSearch.toLowerCase()));
    return <div className="modal-backdrop"><div className="widget-picker-modal" role="dialog" aria-modal="true" aria-labelledby="widget-picker-title"><div className="modal-header"><div><p className="eyebrow">Customize {activeWorkspace.name}</p><h2 id="widget-picker-title">Add a widget</h2><p>Choose a study tile, then move and resize it on your grid.</p></div><button className="icon-button" onClick={() => { setWidgetPickerOpen(false); setWidgetSearch(""); }} aria-label="Close widget picker"><X size={20} /></button></div><div className="picker-search"><Search size={17} /><input autoFocus aria-label="Search widgets" placeholder="Search 18 widgets…" value={widgetSearch} onChange={(event) => setWidgetSearch(event.target.value)} /></div><div className="widget-picker-grid">{filtered.map((template) => { const Icon = template.icon; return <button key={template.type} onClick={() => addWidget(template.type)}><span className={`picker-icon tone-${template.color}`}><Icon size={20} /></span><span><strong>{template.title}</strong><small>{template.description}</small></span><Plus size={18} /></button>; })}</div><div className="picker-footer"><span><GripVertical size={15} /> Drag widgets to rearrange</span><button className="primary-button" onClick={() => setWidgetPickerOpen(false)}>Done</button></div></div></div>;
  }

  function renderWorkspaceDialog() {
    return <div className="modal-backdrop"><form className="small-modal" onSubmit={(event) => { event.preventDefault(); workspaceDialog === "new" ? createWorkspace() : renameWorkspace(); }}><div className="modal-header"><div><p className="eyebrow">Home workspace</p><h2>{workspaceDialog === "new" ? "Create a new workspace" : "Rename workspace"}</h2></div><button type="button" className="icon-button" onClick={() => setWorkspaceDialog(null)}><X size={19} /></button></div><label>Workspace name<input autoFocus value={workspaceNameDraft} onChange={(event) => setWorkspaceNameDraft(event.target.value)} placeholder="e.g. Finals Prep" /></label><p className="form-hint">New workspaces start empty so you can build them exactly how you want.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setWorkspaceDialog(null)}>Cancel</button><button className="primary-button">{workspaceDialog === "new" ? "Create workspace" : "Save name"}</button></div></form></div>;
  }

  function renderClassDetail(course: Course) {
    const items = assignments.filter((assignment) => assignment.courseId === course.id);
    return <div className="modal-backdrop side-panel-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedClass(null); }}><aside className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="class-detail-title"><div className="detail-hero" style={{ background: `linear-gradient(135deg, ${course.soft}, color-mix(in srgb, ${course.color} 15%, white))` }}><button className="icon-button" onClick={() => setSelectedClass(null)} aria-label="Close class"><X size={20} /></button><CourseStamp course={course} /><div><p>{course.code}</p><h2 id="class-detail-title">{course.name}</h2><span>{course.credits} credits · {course.room}</span></div></div><div className="detail-panel-body"><div className="instructor-row"><span className="avatar small">{course.instructor.split(" ").slice(-1)[0][0]}</span><div><strong>{course.instructor}</strong><p>Instructor · Office hours Tue 2–4 PM</p></div><button className="secondary-button compact-button" onClick={() => flash("Message draft opened")}>Message</button></div><div className="detail-tabs"><button className="active">Assignments</button><button onClick={() => { setSelectedClass(null); navigate("files"); }}>Files</button><button onClick={() => { setSelectedClass(null); navigate("calendar"); }}>Schedule</button></div><div className="class-panel-summary"><div><strong>{items.filter((item) => item.status !== "done").length}</strong><span>Open tasks</span></div><div><strong>84%</strong><span>Current grade</span></div><div><strong>6.5h</strong><span>Study time</span></div></div><h3>Assignments</h3>{renderAssignmentTable(items, true)}</div></aside></div>;
  }

  function renderAssignmentDetail(assignment: Assignment) {
    const course = courseFor(courses, assignment.courseId);
    return <div className="modal-backdrop"><div className="assignment-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-detail-title"><div className="modal-header assignment-modal-head"><div><div className="assignment-course-label"><CourseStamp course={course} small /><span>{course.code} · {course.name}</span></div><h2 id="assignment-detail-title">{assignment.title}</h2></div><button className="icon-button" onClick={() => setSelectedAssignment(null)} aria-label="Close assignment"><X size={20} /></button></div><div className="assignment-meta-strip"><div><span>Status</span><StatusBadge status={assignment.status} /></div><div><span>Due</span><strong>{assignment.due}</strong></div><div><span>Weight</span><strong>{assignment.weight}</strong></div></div><div className="assignment-modal-body"><section><h3>About this assignment</h3><p>{assignment.description}</p><div className="assignment-checklist"><label><input type="checkbox" defaultChecked={assignment.progress >= 35} /><span>Review instructions and rubric</span></label><label><input type="checkbox" defaultChecked={assignment.progress >= 60} /><span>Complete first draft</span></label><label><input type="checkbox" defaultChecked={assignment.progress >= 90} /><span>Proofread and submit</span></label></div><h3>Notes</h3><textarea placeholder="Add a note for this assignment…" defaultValue={assignment.progress > 50 ? "Double-check the last two questions before submitting." : ""} /></section><aside><div className="progress-editor"><div><span>Progress</span><strong>{assignment.progress}%</strong></div><input type="range" min="0" max="100" value={assignment.progress} onChange={(event) => { const progress = Number(event.target.value); setAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, progress } : item)); setSelectedAssignment({ ...assignment, progress }); }} /></div><div className="attachment-card"><FileText size={20} /><span><strong>Assignment brief.pdf</strong><small>PDF · 840 KB</small></span><button aria-label="Download attachment"><Download size={16} /></button></div><button className={`primary-button full ${assignment.status === "done" ? "success-button" : ""}`} onClick={() => toggleAssignmentComplete(assignment.id)}>{assignment.status === "done" ? <><RotateCcw size={17} /> Mark incomplete</> : <><CheckCircle2 size={17} /> Mark complete</>}</button><button className="secondary-button full" onClick={() => { setSelectedAssignment(null); navigate("calendar"); }}><CalendarDays size={17} /> View in calendar</button></aside></div></div></div>;
  }

  function renderAddClassDialog() {
    return <div className="modal-backdrop"><div className="add-class-modal" role="dialog" aria-modal="true" aria-labelledby="add-class-title"><div className="modal-header"><div><p className="eyebrow">Academic setup</p><h2 id="add-class-title">{addClassMode === "review" ? "Check if this is right" : "Add a class"}</h2><p>{addClassMode === "review" ? "Review every item before it reaches your dashboard and calendar." : "Enter details yourself or let Edu AI read a syllabus."}</p></div><button className="icon-button" onClick={() => setAddClassOpen(false)} aria-label="Close"><X size={20} /></button></div>{addClassMode !== "review" && <div className="method-tabs"><button className={addClassMode === "manual" ? "active" : ""} onClick={() => setAddClassMode("manual")}><Pencil size={16} /> Manual entry</button><button className={addClassMode === "import" ? "active" : ""} onClick={() => setAddClassMode("import")}><Sparkles size={16} /> Import syllabus</button></div>}
      {addClassMode === "manual" && <form className="add-class-form" onSubmit={(event) => { event.preventDefault(); handleManualClass(event.currentTarget); }}><div className="settings-form-grid"><label>Course code<input required name="classCode" placeholder="e.g. HIST 205" /></label><label>Class name<input required name="className" placeholder="e.g. Modern World History" /></label><label>Credits<input name="credits" type="number" min="1" max="8" defaultValue="3" /></label><label>Instructor<input name="instructor" placeholder="Professor name" /></label><label>Meeting time & location<input name="meeting" placeholder="Tue/Thu · Hall 210" /></label><label>Class color<input name="classColor" type="color" defaultValue="#5b63e8" /></label></div><label className="image-drop"><ImageIcon size={21} /><span><strong>Add a class image</strong><small>Upload an optional JPG or PNG</small></span><input type="file" accept="image/*" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAddClassOpen(false)}>Cancel</button><button className="primary-button"><Plus size={16} /> Add class</button></div></form>}
      {addClassMode === "import" && <div className="syllabus-import"><div className="import-drop"><span><UploadCloud size={25} /></span><h3>Drop in your syllabus</h3><p>PDF, photo, or scanned image up to 25 MB</p><label className="secondary-button upload-button">Choose file<input type="file" accept=".pdf,image/*" /></label></div><div className="or-divider"><span>or paste the text</span></div><textarea aria-label="Paste syllabus text" placeholder="Paste syllabus text here…" defaultValue="SOCI 130: Social Change\nDr. Avery Kim · Barton 206\nChapter 1 response — August 24\nMidterm exam — September 18\nFinal presentation — November 30" /><div className="ai-safety-note"><ShieldCheck size={17} /><p><strong>Nothing is saved automatically.</strong><span>You’ll review and edit everything Edu AI finds before approving it.</span></p></div><div className="modal-actions"><button className="secondary-button" onClick={() => setAddClassOpen(false)}>Cancel</button><button className="primary-button" disabled={parsing} onClick={parseSyllabus}>{parsing ? <><span className="spinner" /> Reading syllabus…</> : <><Sparkles size={16} /> Extract information</>}</button></div></div>}
      {addClassMode === "review" && <div className="review-import"><div className="review-class-card"><CourseStamp course={{ ...initialCourses[0], color: "#8c5bd7", soft: "#f3ecff", initials: "S1" }} /><div><span>Detected class</span><h3>SOCI 130 · Social Change</h3><p>Dr. Avery Kim · 3 credits · Barton 206</p></div><button className="secondary-button compact-button"><Pencil size={14} /> Edit</button></div><div className="review-heading"><div><h3>Assignments & exams</h3><p>{reviewRows.length} items found</p></div><span className="verified-badge"><ShieldCheck size={14} /> Needs your approval</span></div><div className="review-table">{reviewRows.map((row) => <div key={row.id}><select value={row.type} onChange={(event) => setReviewRows((current) => current.map((item) => item.id === row.id ? { ...item, type: event.target.value } : item))}><option>Assignment</option><option>Exam</option><option>Project</option></select><input value={row.title} onChange={(event) => setReviewRows((current) => current.map((item) => item.id === row.id ? { ...item, title: event.target.value } : item))} /><input type="date" value={row.date} onChange={(event) => setReviewRows((current) => current.map((item) => item.id === row.id ? { ...item, date: event.target.value } : item))} /><button className="icon-button" onClick={() => setReviewRows((current) => current.filter((item) => item.id !== row.id))} aria-label={`Remove ${row.title}`}><Trash2 size={16} /></button></div>)}</div><button className="text-button" onClick={() => setReviewRows((current) => [...current, { id: uid("review"), title: "New assignment", date: "2026-08-24", type: "Assignment" }])}><Plus size={14} /> Add missing item</button><div className="modal-actions"><button className="secondary-button" onClick={() => setAddClassMode("import")}><ArrowLeft size={16} /> Back</button><button className="primary-button" onClick={approveImport}><Check size={16} /> Approve and add class</button></div></div>}
    </div></div>;
  }

  function renderEventDialog() {
    return <div className="modal-backdrop"><form className="small-modal event-modal" onSubmit={(event) => { event.preventDefault(); addCalendarEvent(event.currentTarget); }}><div className="modal-header"><div><p className="eyebrow">Calendar</p><h2>Add an event</h2></div><button type="button" className="icon-button" onClick={() => setEventDialogOpen(false)}><X size={19} /></button></div><label>Event name<input name="title" autoFocus required placeholder="e.g. Biology study group" /></label><div className="two-fields"><label>Date<input name="date" type="date" defaultValue="2026-08-13" /></label><label>Time<input name="time" type="time" defaultValue="18:30" /></label></div><div className="two-fields"><label>Type<select name="type"><option>Study block</option><option>Exam</option><option>Office hours</option><option>Appointment</option><option>Personal</option></select></label><label>Class<select name="course">{courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}</select></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEventDialogOpen(false)}>Cancel</button><button className="primary-button"><Plus size={16} /> Add event</button></div></form></div>;
  }

  function renderFilePreview(name: string) {
    return <div className="modal-backdrop"><div className="file-preview-modal"><div className="modal-header"><div className="file-preview-title"><span className="file-type"><FileText size={20} /></span><div><h2>{name}</h2><p>Preview · Last updated Aug 10</p></div></div><button className="icon-button" onClick={() => setFilePreview(null)}><X size={20} /></button></div><div className="document-preview"><div className="paper"><p className="paper-eyebrow">NORTHBRIDGE UNIVERSITY</p><h3>{name.includes("Syllabus") ? "Course Syllabus" : "Class Resource"}</h3><p className="paper-sub">Fall 2026 · Updated August 10</p><hr /><h4>Overview</h4><p>This document contains the course expectations, key learning objectives, weekly schedule, and important deadlines.</p><h4>Important dates</h4><div className="paper-lines"><span /><span /><span /></div><h4>Contact & office hours</h4><div className="paper-lines short"><span /><span /></div></div></div><div className="preview-actions"><button className="secondary-button" onClick={() => flash("Download started")}><Download size={16} /> Download</button><button className="primary-button" onClick={() => flash("Opened in a new view")}><ExternalLink size={16} /> Open full screen</button></div></div></div>;
  }
}
