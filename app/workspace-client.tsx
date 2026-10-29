"use client";

import "./location-input.css";
import "./course-icon-picker.css";
import "./class-setup.css";
import "./course-syllabus.css";
import "./course-syllabus-upload.css";
import "./calendar.css";
import "./local-file-preview.css";
import "./file-upload-dialog.css";
import "./file-organization-dialogs.css";
import "./files-trash-dialog.css";
import "./files-browser-tools.css";
import "./file-archive-dialog.css";
import "./files-card-preview.css";
import "./files-browser.css";
import "./native-document-editor.css";
import "./widget-customization.css";
import "./workspace-save-status.css";
import "./onboarding-flow.css";
import "./assistant.css";
import "./class-card-expansion.css";
import "./auth.css";
import "./reference-ui.css";
import "./dashboard.css";
import "./home-skeleton.css";
import "./courses-skeleton.css";
import "./widget-appearance.css";
import "./widget-block-layout.css";
import "./widget-reorder.css";
import { WorkspaceAcademicDialogs } from "./workspace-academic-dialogs";
import { WorkspaceFileDialogs } from "./workspace-file-dialogs";
import { WorkspaceHome, WidgetPicker, WorkspaceDialog } from "./workspace-home";
import { defaultWorkspaces, widgetTemplates } from "./workspace-widget-catalog";
import type { WidgetActions, WidgetBodyData } from "./workspace-widget";
import WorkspaceFilesPage from "./workspace-files";
import WorkspaceSettingsPage from "./workspace-settings";
import { createWorkspaceSearchResultGroups, WorkspaceQuickSearchResults, WorkspaceSearchPage } from "./workspace-search";
import WorkspaceDashboard from "./workspace-dashboard";
import CourseDetail from "./course-detail";
import AssignmentDetailDialog from "./assignment-detail-dialog";
import { AssignmentTable, CourseStamp, StatusBadge } from "./assignment-table";
import WorkspaceNavigation, { WorkspaceMobileHeader, WorkspaceMobileNavigation, type PageId } from "./workspace-navigation";
import { CourseEditTransitionContext } from "./course-edit-transition";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CheckCircle2, FlaskConical, Plus, Search, Send } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { Autosave, SaveFailure, canonicalJson } from "../lib/autosave";
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from "../lib/sidebar-preference";
import { useCourseExpansion } from "./use-course-expansion";
import { useCoursePreviewPlaceholders } from "./use-course-preview-placeholders";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
import { usePreferences } from "./use-preferences";
import type { ClassSetupUploads } from "./class-setup";
import { useClassSetupMotion, type ClassSetupBounds } from "./use-class-setup-motion";
import TopbarSearch from "./topbar-search";
import type { SyllabusAttachmentValue } from "./course-syllabus";
import AcademicCalendar from "./academic-calendar";
import { usePrivateFiles } from "./use-private-files";
import { useFileActivity } from "./use-file-activity";
import { useFileUploads } from "./use-file-uploads";
import type { PendingFolderUpload } from "./file-upload-dialog";
import { DEFAULT_FILES_BROWSER_PREFERENCES, FILES_BROWSER_APPEARANCE_VERSION, migrateFilesBrowserPreferences, type FilesBrowserPreferences } from "../lib/files-browser";
import { restoreTrashItems, type TrashUndoReceipt } from "../lib/files-trash-operations";
import type { NativeDocumentCreate } from "../lib/native-documents";
import { InlineFilePreview } from "./private-files";
import { type PrivateFile, type FileMetadata } from "../lib/files";
import WidgetCustomization from "./widget-customization";
import HomeLoadTransition from "./home-load-transition";
import type { HomeSkeletonGreeting } from "./home-skeleton";
import { cacheLayoutsMatch, createHomeSkeletonLayout, DEFAULT_HOME_SKELETON_LAYOUT, layoutsMatch, readHomeSkeletonLayout, writeHomeSkeletonLayout, type HomeSkeletonGeometry, type HomeSkeletonLayout } from "../lib/home-skeleton";
import { resolveWidgetAppearance, type WidgetAppearanceState } from "../lib/widget-appearance";
import StudyPanel from "./study-panel";
import { useStudyStats } from "./use-study-stats";
import { emptyStudy, settleTimer, timerAction, goalPercent, completedInWeek, detachStudyCourse, type StudyData, type TimerKind } from "../lib/study";
import { academicSnapshot, validateAcademicEdit } from "../lib/academic-snapshot";
import { dayKey, dateLabel, assignmentStatus, legacyEventTime, emptyCourse, emptyCourseDetails, type Course, type CourseDetails, type SyllabusDraft } from "../lib/academics";
import { experimentalData, type ExperimentalDensity } from "../lib/experimental-data";
import OnboardingFlow from "./onboarding-flow";
import type { SavedAssignment, SavedEvent, WorkspaceData } from "../lib/workspace-codec";
import AcademicAssistant, { type AssistantPrompt } from "./academic-assistant";
import { useDashboardChat } from "./use-dashboard-chat";
import { courseImageLoadKey } from "./dashboard-load-transition";
import { dashboardFocus } from "../lib/dashboard-focus";
import SaveToast from "./save-toast";
import type { Profile } from "../lib/profile";
import type { WidgetResizePriority } from "../lib/widget-layout";
import { decodeWorkspaceState, encodeWorkspaceState, type WidgetInstance, type WidgetSize, type WidgetType, type Workspace } from "../lib/workspace-codec";


type Assignment = SavedAssignment;

type WorkspaceResponse = {
  initialized: boolean;
  courses?: Course[];
  dashboard?: unknown;
  revision?: string | null;
  profile?: Profile;
  error?: string;
};

const pageIds = new Set<PageId>(["home", "dashboard", "calendar", "tasks", "search", "files", "settings", "assistant"]);

function pageFromPathname(pathname: string): PageId {
  const segment = pathname.split("/").filter(Boolean)[0] as PageId | undefined;
  return segment && pageIds.has(segment) ? segment : "home";
}

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

function courseImageFor(files: PrivateFile[], courseId: string) {
  return files.filter((file) => file.course_id === courseId && file.kind === "class-image" && file.state === "ready" && !file.trashed_at && !file.deleted_at)
    .sort((first, second) => second.created_at.localeCompare(first.created_at))[0];
}

export default function EduEssentialsApp({ initialProfile, children, filesBrowserEnabled = false }: { initialProfile: Profile; children?: React.ReactNode; filesBrowserEnabled?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const page = pageFromPathname(pathname);
  const [profile, setProfile] = useState(initialProfile);
  const [homeSkeletonCache, setHomeSkeletonCache] = useState<{
    accountId: string | null;
    layout: HomeSkeletonLayout;
    readable: boolean;
    cached: boolean;
  }>({ accountId: null, layout: DEFAULT_HOME_SKELETON_LAYOUT, readable: false, cached: false });
  const [homeSkeletonMeasurement, setHomeSkeletonMeasurement] = useState<{
    accountId: string;
    workspaceId: string;
    layout: HomeSkeletonLayout;
    geometry: HomeSkeletonGeometry;
  } | null>(null);
  useLayoutEffect(() => {
    const cached = readHomeSkeletonLayout(initialProfile.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the visual-only cache before the first client paint.
    setHomeSkeletonCache({
      accountId: initialProfile.id,
      layout: cached.layout ?? DEFAULT_HOME_SKELETON_LAYOUT,
      readable: cached.readable,
      cached: cached.layout !== null,
    });
  }, [initialProfile.id]);
  const homeSkeletonRestored = homeSkeletonCache.accountId === initialProfile.id;
  const homeSkeletonLayout = homeSkeletonRestored ? homeSkeletonCache.layout : DEFAULT_HOME_SKELETON_LAYOUT;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [storedSidebarCollapsed, setStoredSidebarCollapsed] = useState<boolean | null>(null);
  const sidebarCollapsed = storedSidebarCollapsed ?? false;
  useLayoutEffect(() => {
    let collapsed = false;
    try {
      collapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      /* Expanded navigation remains available without browser storage. */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore before repaint to match the pre-hydration sidebar state.
    setStoredSidebarCollapsed(collapsed);
  }, []);
  useLayoutEffect(() => {
    if (storedSidebarCollapsed !== null) {
      document.documentElement.removeAttribute("data-sidebar-collapsed");
    }
  }, [storedSidebarCollapsed]);
  const toggleSidebar = () => {
    const collapsed = !sidebarCollapsed;
    setStoredSidebarCollapsed(collapsed);
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed)); }
    catch { /* Keep the preference for this session even if it cannot be stored. */ }
  };
  const [experimentalMenuOpen, setExperimentalMenuOpen] = useState(false);
  const [appShellElement, setAppShellElement] = useState<HTMLDivElement | null>(null);
  const experimentalControlRef = useRef<HTMLDivElement>(null);
  const experimentalTriggerRef = useRef<HTMLButtonElement>(null);
  const experimentalMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!experimentalMenuOpen) return;

    const positionMenu = () => {
      const trigger = experimentalTriggerRef.current;
      const control = experimentalControlRef.current;
      const menu = experimentalMenuRef.current;
      if (!trigger || !control || !menu) return;
      if (!sidebarOpen && window.matchMedia("(max-width: 820px)").matches) {
        setExperimentalMenuOpen(false);
        return;
      }

      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const gap = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const controlRect = control.getBoundingClientRect();
      // Re-measure the authored width on each resize before applying the viewport clamp.
      menu.style.width = "";
      menu.style.maxHeight = "";
      const naturalMenuRect = menu.getBoundingClientRect();
      const menuWidth = Math.min(naturalMenuRect.width, Math.max(0, viewportWidth - gap * 2));
      const collapsedRail = sidebarCollapsed && window.matchMedia("(min-width: 821px)").matches;
      let left = collapsedRail ? triggerRect.right + gap : controlRect.left;
      if (collapsedRail && left + menuWidth > viewportWidth - gap) left = triggerRect.left - menuWidth - gap;
      left = Math.max(gap, Math.min(left, viewportWidth - menuWidth - gap));

      const maxHeight = Math.max(0, viewportHeight - gap * 2);
      menu.style.width = `${menuWidth}px`;
      menu.style.maxHeight = `${maxHeight}px`;
      const menuHeight = menu.getBoundingClientRect().height;
      let top = triggerRect.bottom + gap;
      if (top + menuHeight > viewportHeight - gap) top = triggerRect.top - menuHeight - gap;
      top = Math.max(gap, Math.min(top, viewportHeight - Math.min(menuHeight, maxHeight) - gap));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.maxHeight = `${maxHeight}px`;
      menu.style.visibility = "visible";
    };

    positionMenu();
    const firstOption = experimentalMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (firstOption ?? experimentalMenuRef.current)?.focus({ preventScroll: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionMenu);
    if (resizeObserver) {
      if (experimentalTriggerRef.current) resizeObserver.observe(experimentalTriggerRef.current);
      if (experimentalControlRef.current) resizeObserver.observe(experimentalControlRef.current);
      if (experimentalMenuRef.current) resizeObserver.observe(experimentalMenuRef.current);
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExperimentalMenuOpen(false);
      experimentalTriggerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [experimentalMenuOpen, sidebarCollapsed, sidebarOpen]);
  const [onboardingTest, setOnboardingTest] = useState(false);
  const [experimentalMode, setExperimentalMode] = useState<ExperimentalDensity | null>(null);
  const [experimentalRestoring, setExperimentalRestoring] = useState(false);
  usePreferences(profile.preferences);
  const studentName = profile.display_name;
  const [courses, setCourses] = useState<Course[]>([]);
  const [storedAssignments, setAssignments] = useState<Assignment[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(defaultWorkspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("my-day");
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const customizeButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceOptionsButtonRef = useRef<HTMLButtonElement>(null);
  const todayOptionsButtonRef = useRef<HTMLButtonElement>(null);
  const todayRemoveTargetRef = useRef<HTMLDivElement>(null);
  const todayRemoveHitRef = useRef<HTMLDivElement>(null);
  const [todayRemoveDragState, setTodayRemoveDragState] = useState({ active: false, over: false, near: false });
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
  const [miniWeekOffset, setMiniWeekOffset] = useState(0);
  const [widgetSearch, setWidgetSearch] = useState("");
  const [openWidgetMenu, setOpenWidgetMenu] = useState<string | null>(null);
  const [closingWidgetMenu, setClosingWidgetMenu] = useState(false);
  const closeWidgetMenu = useCallback(() => { setClosingWidgetMenu(false); setOpenWidgetMenu(null); }, []);
  const dismissWidgetMenu = useCallback(() => setClosingWidgetMenu(true), []);
  const widgetMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openWidgetMenu || !closingWidgetMenu) return;
    // Also clean up when animation events are unavailable or interrupted.
    const timeout = window.setTimeout(closeWidgetMenu, 130);
    return () => window.clearTimeout(timeout);
  }, [openWidgetMenu, closingWidgetMenu, closeWidgetMenu]);
  useLayoutEffect(() => {
    const menu = widgetMenuRef.current;
    if (!openWidgetMenu || !menu) return;
    const card = menu.parentElement;
    const anchor = card?.querySelector<HTMLElement>(".widget-header .menu-wrap > button");
    if (!card || !anchor) return;
    const grid = menu.closest(".widget-grid");
    const referenceRoot = menu.closest(".reference-ui") ?? document;
    const mobileHeader = referenceRoot.querySelector<HTMLElement>(".mobile-header");
    const mobileBottomNav = referenceRoot.querySelector<HTMLElement>(".mobile-bottom-nav");
    const placeMenu = () => {
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      let minTop = 12;
      let maxBottom = viewportHeight - 12;
      const headerRect = mobileHeader?.getBoundingClientRect();
      if (headerRect && headerRect.height > 0 && headerRect.top <= 0 && headerRect.bottom > 0) {
        minTop = Math.max(minTop, headerRect.bottom + 12);
      }
      const navRect = mobileBottomNav?.getBoundingClientRect();
      if (navRect && navRect.height > 0 && navRect.top < viewportHeight && navRect.bottom >= viewportHeight) {
        maxBottom = Math.min(maxBottom, navRect.top - 12);
      }
      const maxMenuHeight = Math.max(0, maxBottom - minTop);
      menu.style.setProperty("--widget-menu-available-width", `${Math.max(0, viewportWidth - 24)}px`);
      menu.style.maxHeight = `${maxMenuHeight}px`;
      const width = menu.offsetWidth || Math.min(240, Math.max(0, viewportWidth - 24));
      const rect = anchor.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const gridRect = grid?.getBoundingClientRect();
      const cardCenter = cardRect.left + cardRect.width / 2;
      const gridCenter = gridRect ? gridRect.left + gridRect.width / 2 : viewportWidth / 2;
      const preferredLeft = cardCenter < gridCenter ? rect.left : rect.right - width;
      const left = Math.max(12, Math.min(preferredLeft, viewportWidth - width - 12));
      const belowTop = rect.bottom + 4;
      const belowSpace = Math.max(0, maxBottom - belowTop);
      const aboveTop = rect.top - 4 - menu.offsetHeight;
      const aboveSpace = Math.max(0, rect.top - 4 - minTop);
      let top = belowTop;
      if (belowTop < minTop || belowTop + menu.offsetHeight > maxBottom) {
        top = aboveTop >= minTop
          ? aboveTop
          : (aboveSpace > belowSpace ? aboveTop : belowTop);
      }
      top = Math.max(minTop, Math.min(top, maxBottom - menu.offsetHeight));
      menu.style.left = `${left - cardRect.left - card.clientLeft}px`;
      menu.style.right = "auto";
      menu.style.top = `${top - cardRect.top - card.clientTop}px`;
    };
    const dismissMenu = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!menu.contains(target) && !anchor.contains(target)) dismissWidgetMenu();
    };
    placeMenu();
    document.addEventListener("click", dismissMenu, true);
    window.addEventListener("resize", placeMenu);
    document.addEventListener("scroll", placeMenu, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(placeMenu);
    if (grid) observer?.observe(grid);
    observer?.observe(card);
    observer?.observe(menu);
    return () => { document.removeEventListener("click", dismissMenu, true); window.removeEventListener("resize", placeMenu); document.removeEventListener("scroll", placeMenu, true); observer?.disconnect(); };
  }, [openWidgetMenu, sidebarCollapsed, dismissWidgetMenu]);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<"new" | "rename" | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [studyOpen, setStudyOpen] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState<(AssistantPrompt & { profileId: string }) | null>(null);
  const aiApplyLock = useRef(false);
  const [notes, setNotes] = useState("");
  const noteFocusRef = useRef<string | null>(null);
  const [dashboardView, setDashboardView] = useState<"cards" | "list">("cards");
  const closeExpandedClassRef = useRef<(() => void) | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [addClassOpen, setAddClassOpen] = useState(false);
  const addClassChoiceRef = useRef<HTMLElement>(null);
  const transitionClassChoice = useClassSetupMotion(addClassChoiceRef, addClassOpen);
  const [classSetup, setClassSetup] = useState<{ course: Course; details?: CourseDetails; editing?: boolean; profileId: string; generation: number; initialBounds?: ClassSetupBounds } | null>(null);
  const [editor, setEditor] = useState<{ course?: Course; details?: CourseDetails; assignment?: Assignment; event?: SavedEvent; taskCourse?: Course } | null>(null);
  const [syllabusDraft, setSyllabusDraft] = useState<SyllabusDraft | null>(null);
  const [syllabusAttachment, setSyllabusAttachment] = useState<{ courseId: string; folderId: string | null; simple?: boolean; session?: { profileId: string; generation: number } } | null>(null);
  const [syllabusTextCourseId, setSyllabusTextCourseId] = useState<string | null>(null);
  const [syllabusPreviewFileId, setSyllabusPreviewFileId] = useState<string | null>(null);
  const workspaceLoadGeneration = useRef(0);
  const [extraData, setExtraData] = useState<{ courseDetails: Record<string, CourseDetails>; syllabusDrafts: SyllabusDraft[]; study: StudyData; filePreferences: FilesBrowserPreferences; widgetAppearance?: WidgetAppearanceState }>({ courseDetails: {}, syllabusDrafts: [], study: emptyStudy(), filePreferences: DEFAULT_FILES_BROWSER_PREFERENCES });
  const [now, setNow] = useState(() => new Date());
  const today = dayKey(now, profile.timezone);
  const assignments = storedAssignments.map((item) => ({ ...item, status: assignmentStatus(item, today), due: dateLabel(item.dateKey) })).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.dueTime ?? "").localeCompare(b.dueTime ?? ""));
  const [calendarFilter, setCalendarFilter] = useState("all");
  const [manualEvents, setManualEvents] = useState<SavedEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const quickSearchRef = useRef<HTMLFormElement>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [filePreview, setFilePreview] = useState<PrivateFile | null>(null);
  const [filePreviewReadOnly, setFilePreviewReadOnly] = useState(false);
  const [fileDialog, setFileDialog] = useState<{ initial?: PrivateFile; defaults?: Partial<FileMetadata>; reviewId?: string } | null>(null);
  const [uploadDialog, setUploadDialog] = useState<{ profileId: string; folderId: string | null; courseId: string; generation: number; mode?: "files" | "folder"; initialFiles?: File[] } | null>(null);
  const [pendingUploadConfirmationPreference, setPendingUploadConfirmationPreference] = useState<{ profileId: string; generation: number; confirmUploads: boolean; previousConfirmUploads: boolean; phase: "queued" | "saving" } | null>(null);
  const [pendingFolderUpload, setPendingFolderUpload] = useState<PendingFolderUpload | null>(null);
  const [filesDataRevision, setFilesDataRevision] = useState(0);
  const [nativeDocumentDialog, setNativeDocumentDialog] = useState<{ file?: PrivateFile; create?: NativeDocumentCreate; readOnly?: boolean } | null>(null);
  const [nativeDocumentDraft, setNativeDocumentDraft] = useState<{ fileId: string | null; name: string; body: string; dirty: boolean } | null>(null);
  const handleNativeDocumentDraft = useCallback((draft: typeof nativeDocumentDraft) => setNativeDocumentDraft(draft), []);
  const [organizationState, setOrganizationState] = useState<{ busy: boolean; dirty: boolean; draft: unknown } | null>(null);
  const handleOrganizationState = useCallback((state: typeof organizationState) => setOrganizationState(state), []);
  // A session generation also fences A → B → A account changes while a request is held.
  const [fileActionSession, setFileActionSession] = useState({ profileId: initialProfile.id, generation: 0 });
  if (fileActionSession.profileId !== initialProfile.id) setFileActionSession({ profileId: initialProfile.id, generation: fileActionSession.generation + 1 });
  const fileActionSessionRef = useRef(fileActionSession);
  const [syllabusDeletion, setSyllabusDeletion] = useState<{ session: typeof fileActionSession; courseId: string; fileId?: string; file?: PrivateFile } | null>(null);
  const currentSyllabusDeletion = syllabusDeletion?.session === fileActionSession ? syllabusDeletion : null;
  const undoAbortRef = useRef<AbortController | null>(null);
  const [trashUndo, setTrashUndo] = useState<{ session: typeof fileActionSession; receipt: TrashUndoReceipt; busy: boolean; error: string; restored?: boolean; recovered?: boolean } | null>(null);
  const currentTrashUndo = trashUndo?.session === fileActionSession ? trashUndo : null;
  const undoBusy = !!currentTrashUndo?.busy;
  useLayoutEffect(() => { fileActionSessionRef.current = fileActionSession; undoAbortRef.current?.abort(); }, [fileActionSession]);
  useEffect(() => () => { undoAbortRef.current?.abort(); }, []);
  const handleTrashCompleted = useCallback((receipt: TrashUndoReceipt) => {
    if (fileActionSessionRef.current !== fileActionSession || receipt.profileId !== fileActionSession.profileId) return;
    setTrashUndo({ session: fileActionSession, receipt, busy: false, error: "" });
  }, [fileActionSession, setTrashUndo]);
  const handleLegacyTrashed = useCallback((file: PrivateFile) => handleTrashCompleted({ profileId: fileActionSession.profileId, items: [{ type: "file", id: file.id, file }], label: file.name }), [fileActionSession, handleTrashCompleted]);
  const fileStore = usePrivateFiles(initialProfile.id);
  const courseImages = useMemo(() => new Map(courses.map((course) => [course.id, courseImageFor(fileStore.files, course.id)])), [courses, fileStore.files]);
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
      const failure = await response.clone().json() as { code?: string; error?: string };
      if (failure.code === "syllabus-preservation") throw new SaveFailure(failure.error || "The old syllabus could not be preserved. Your changes are still here; free file space and retry.");
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
  const { selectedClass, setSelectedClass, resetSelectedClass, clearSavedCourse, openDashboardCourse, skipOpeningAnimation, restoringCourseOnReload, restorationChecked } = useCourseExpansion({
    profileId: initialProfile.id,
    page,
    courses,
    ready: saveState.ready && profile.id === initialProfile.id,
    persist: !experimentalMode && !onboardingTest,
  });
  const placeholderAssets = useCoursePreviewPlaceholders(restoringCourseOnReload || skipOpeningAnimation, initialProfile.id);
  const restoringPlaceholderAssets = (restoringCourseOnReload || skipOpeningAnimation) && !placeholderAssets.ready;
  const persistenceStatus = saveState.status;
  const canWriteFiles = !experimentalMode && saveState.ready && !saveState.dirty && !undoBusy;
  const refreshFiles = fileStore.refresh;
  const handleUploadSaved = useCallback(async (_file: PrivateFile, signal: AbortSignal) => {
    await refreshFiles(signal, true);
    if (!signal.aborted) setFilesDataRevision((revision) => revision + 1);
  }, [refreshFiles, setFilesDataRevision]);
  const fileUploads = useFileUploads(fileActionSession, fileStore, handleUploadSaved, canWriteFiles && !profilePending && !organizationState && !nativeDocumentDialog);
  const fileActivity = useFileActivity(fileActionSession, !experimentalMode && saveState.ready && !profilePending, refreshFiles);
  const handleFileOpened = fileActivity.opened;
  const handleNativeDocumentSaved = useCallback((file: PrivateFile) => { handleFileOpened(file); void refreshFiles(); }, [handleFileOpened, refreshFiles]);
  const closeNativeDocument = useCallback(() => { setNativeDocumentDialog(null); setNativeDocumentDraft(null); void refreshFiles(); }, [refreshFiles]);
  const handleOrganizationSaved = useCallback(async (signal?: AbortSignal) => { await refreshFiles(signal, true); }, [refreshFiles]);
  const undoTrash = async () => {
    if (!currentTrashUndo || undoBusy || !canWriteFiles || profilePending || organizationState || nativeDocumentDialog || fileStore.busy) return;
    const captured = currentTrashUndo;
    let acknowledged = captured;
    const controller = new AbortController(); undoAbortRef.current = controller;
    setTrashUndo({ ...captured, busy: true, error: "" });
    try {
      if (!captured.restored) {
        const result = await restoreTrashItems(captured.receipt.profileId, captured.receipt.items, { signal: controller.signal });
        acknowledged = { ...captured, restored: true, recovered: !!result.recoveryFolder };
      }
      if (controller.signal.aborted || fileActionSessionRef.current !== captured.session) return;
      await refreshFiles(controller.signal, true);
      if (controller.signal.aborted || fileActionSessionRef.current !== captured.session) return;
      setTrashUndo(null);
      setToast(acknowledged.recovered ? "Restored to Restored files because the original location is unavailable." : "Restored from Trash.");
    } catch (error) {
      if (!controller.signal.aborted && fileActionSessionRef.current === captured.session) setTrashUndo({ ...acknowledged, busy: false, error: acknowledged.restored ? "The restore was saved, but Files could not refresh. Retry Files refresh; the restore will not be repeated." : error instanceof Error ? error.message : "Could not restore these items. Retry Undo or review Trash." });
    } finally {
      if (undoAbortRef.current === controller) undoAbortRef.current = null;
      if (controller.signal.aborted && fileActionSessionRef.current === captured.session) setTrashUndo((current) => current?.receipt === captured.receipt ? { ...current, busy: false } : current);
    }
  };
  useEffect(() => { if (saveState.status === "saved") void refreshFiles(); }, [saveState.status, refreshFiles]);
  useSaveProtection(saveState.dirty || profilePending || fileUploads.dirty || fileUploads.busy || !!pendingFolderUpload || !!nativeDocumentDraft?.dirty || !!organizationState?.dirty || !!organizationState?.busy || undoBusy);
  const topSearchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!quickSearchOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof window.Node && !quickSearchRef.current?.contains(event.target)) setQuickSearchOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !quickSearchRef.current?.contains(document.activeElement)) return;
      event.preventDefault(); setQuickSearchOpen(false); topSearchRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [quickSearchOpen]);
  const study = extraData.study;
  const activeGpaSystem = experimentalMode ? "4.0 scale" : profile.gpa_system;
  const activeTerm = experimentalMode ? "Current term" : profile.current_term;
  const timezone = profile.timezone, monday = profile.week_starts_on === "Monday";
  const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: timezone || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const currentHour = Number(localTime.slice(0, 2));
  const homeGreeting: HomeSkeletonGreeting = {
    greeting: currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening",
    studentName,
    dateLabel: dateLabel(today, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  };
  const stats = useStudyStats(study.sessions, today, timezone, monday);
  const dailyPercent = goalPercent(stats.dailySeconds, study.dailyMinutes);
  const weeklyCompleted = completedInWeek(assignments, today, profile.timezone, profile.week_starts_on === "Monday");
  useEffect(() => {
    if (onboardingTest) return;
    // Completion consumes the active timer and adds its stable session ID in the
    // same account snapshot. Ticks alone never cause database writes.
    const tick = () => {
      const time = new Date(); setNow(time);
      if (saveState.ready && !aiApplyLock.current) setExtraData((current) => { const next = settleTimer(current.study, time.getTime()); return next === current.study ? current : { ...current, study: next }; });
    };
    const interval = setInterval(tick, 1000);
    window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(interval); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, [saveState.ready, onboardingTest]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (page === "files" && filesBrowserEnabled) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!appearanceOpen) topSearchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [appearanceOpen, filesBrowserEnabled, page]);

  useEffect(() => {
    const controller = new AbortController();
    const loadGeneration = ++workspaceLoadGeneration.current;
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
            body: JSON.stringify({ action: "initialize", courses: [], dashboard: encodeWorkspaceState(defaultWorkspaces, "my-day", "", { assignments: [], manualEvents: [], dashboardView: "cards" }) }),
          });
          if (!response.ok) throw new Error("Unable to initialize your workspace. Please retry.");
          data = await read();
        }
        if (controller.signal.aborted) return;
        if (!data.dashboard || !data.profile || data.profile.id !== initialProfile.id) throw new Error("Your saved workspace is incomplete or belongs to another account. Please retry loading.");
        const decoded = decodeWorkspaceState(data.dashboard);
        const loadedDetails = decoded.data ?? { assignments: [], manualEvents: [], dashboardView: "cards" as const };
        const courseIds = new Set((data.courses ?? []).map((c) => c.id));
        const details = { ...loadedDetails, assignments: loadedDetails.assignments.map((a) => ({ ...a, courseId: courseIds.has(a.courseId) ? a.courseId : "" })), manualEvents: loadedDetails.manualEvents.map((e) => ({ ...e, time: legacyEventTime(e.time), courseId: courseIds.has(e.courseId) ? e.courseId : "" })), calendarFilter: (loadedDetails.calendarFilter === "all" || loadedDetails.calendarFilter === "personal") || courseIds.has(loadedDetails.calendarFilter ?? "") ? loadedDetails.calendarFilter! : "all", courseDetails: loadedDetails.courseDetails ?? {}, syllabusDrafts: [], study: loadedDetails.study ?? emptyStudy(), filePreferences: loadedDetails.filePreferences ?? DEFAULT_FILES_BROWSER_PREFERENCES };
        setProfile(data.profile); setProfileDraft(data.profile); setProfilePending(false);
        setCourses(data.courses ?? []); setWorkspaces(decoded.workspaces);
        setActiveWorkspaceId(decoded.activeWorkspaceId); setNotes(decoded.notes);
        setAssignments(details.assignments); setManualEvents(details.manualEvents);
        setDashboardView(details.dashboardView); setCalendarFilter(details.calendarFilter); setExtraData({ courseDetails: details.courseDetails, syllabusDrafts: [], study: settleTimer(details.study, Date.now()), filePreferences: details.filePreferences, widgetAppearance: details.widgetAppearance }); setFileDialog(null); setFilePreview(null); setStudyOpen(false); setAppearanceOpen(false); setEditor(null); setSyllabusDraft(null);
        resetSelectedClass(); setSelectedAssignment(null); setSyllabusAttachment(null); setSyllabusTextCourseId(null); setSyllabusPreviewFileId(null);
        setClassSetup(null);
        setExperimentalMode(null); setExperimentalMenuOpen(false); setExperimentalRestoring(false);
        autosave.hydrate(canonicalJson({ courses: [...(data.courses ?? [])].sort((a, b) => a.id.localeCompare(b.id)), dashboard: encodeWorkspaceState(decoded.workspaces, decoded.activeWorkspaceId, decoded.notes, details) }), data.revision ?? null);
      } catch (error) { if (!controller.signal.aborted) { setExperimentalRestoring(false); autosave.loadFailed(error); } }
    }
    void hydrateWorkspace();
    return () => { controller.abort(); workspaceLoadGeneration.current = loadGeneration + 1; autosave.stop(); };
  }, [reloadAttempt, accountFetch, autosave, initialProfile.id, resetSelectedClass]);

  useEffect(() => {
    if (experimentalMode || onboardingTest) return;
    try { autosave.change(canonicalJson(academicSnapshot(courses, encodeWorkspaceState(workspaces, activeWorkspaceId, notes, { assignments: storedAssignments, manualEvents, dashboardView, calendarFilter, ...extraData })))); }
    catch (error) { autosave.invalidate(error instanceof Error ? error.message : "Invalid workspace data."); }
  }, [activeWorkspaceId, notes, workspaces, storedAssignments, manualEvents, dashboardView, calendarFilter, extraData, courses, autosave, experimentalMode, onboardingTest]);

  // Coordinate this preference with the external autosave and upload queues:
  // apply it only after uploads settle, then wait for the save acknowledgement.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const pending = pendingUploadConfirmationPreference;
    if (!pending) return;
    if (pending.profileId !== initialProfile.id || pending.generation !== fileActionSession.generation) {
      setPendingUploadConfirmationPreference(null);
      return;
    }
    if (pending.phase === "saving") {
      const currentSave = autosave.getSnapshot();
      if (currentSave.ready && !currentSave.dirty && currentSave.status === "saved" && (extraData.filePreferences.confirmUploads !== false) === pending.confirmUploads) setPendingUploadConfirmationPreference(null);
      return;
    }
    // Saving workspace preferences briefly disables file writes. Keep the
    // explicit choice active locally and wait until admitted uploads finish.
    if (!canWriteFiles || profilePending || organizationState || nativeDocumentDialog || fileUploads.rows.some((row) => row.status === "queued" || row.status === "uploading" || row.status === "refreshing")) return;
    if ((extraData.filePreferences.confirmUploads !== false) === pending.confirmUploads) {
      setPendingUploadConfirmationPreference(null);
      return;
    }
    const filePreferences = { ...extraData.filePreferences, confirmUploads: pending.confirmUploads };
    const data = { assignments: storedAssignments, manualEvents, dashboardView, calendarFilter, ...extraData, filePreferences };
    try {
      validateAcademicEdit(courses, encodeWorkspaceState(workspaces, activeWorkspaceId, notes, data), { assignments: storedAssignments, manualEvents, dashboardView });
      setPendingUploadConfirmationPreference({ ...pending, phase: "saving" });
      setExtraData((current) => ({ ...current, filePreferences: { ...current.filePreferences, confirmUploads: pending.confirmUploads } }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to save upload confirmation settings.");
      setPendingUploadConfirmationPreference(null);
    }
  }, [pendingUploadConfirmationPreference, initialProfile.id, fileActionSession.generation, canWriteFiles, profilePending, organizationState, nativeDocumentDialog, fileUploads.rows, extraData, storedAssignments, manualEvents, dashboardView, calendarFilter, courses, workspaces, activeWorkspaceId, notes, autosave, persistenceStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const downloadUnsavedWork = () => downloadDraft("eduessentials-unsaved-work.json", { profile, settingsDraft: profileDraft, courses, assignments: storedAssignments, manualEvents, workspaces, activeWorkspaceId, notes, dashboardView, calendarFilter, nativeDocumentDraft, fileOrganizationDraft: organizationState?.draft, fileUploads: fileUploads.draft, pendingFolderUpload: pendingFolderUpload && { profileId: pendingFolderUpload.profileId, sessionGeneration: pendingFolderUpload.sessionGeneration, folderId: pendingFolderUpload.folderId, courseId: pendingFolderUpload.courseId, files: pendingFolderUpload.files.map(({ relativePath }) => relativePath), directories: pendingFolderUpload.directories.map(({ id, path, parentPath, created }) => ({ id, path, parentPath, created })) }, ...extraData });
  const reloadWorkspace = () => {
    if (fileUploads.dirty || fileUploads.busy || pendingFolderUpload) { flash("Finish or dismiss retained uploads before reloading. Review uploads to download the original selections."); return; }
    if (nativeDocumentDialog) { flash("Save or download your text draft and close its editor before reloading the workspace."); return; }
    if (organizationState) { flash("Close the Files dialog before reloading the workspace."); return; }
    if (undoBusy) { flash("Wait for Undo to finish before reloading the workspace."); return; }
    if (persistenceStatus === "saving" || profileSaving) return;
    if ((saveState.dirty || profilePending) && !window.confirm("Replace unsaved workspace and settings edits with saved data? Download your unsaved work first to keep a copy.")) return;
    setReloadAttempt((attempt) => attempt + 1);
  };

  const prepareAssistant = async () => {
    if (experimentalMode || profilePending || editor || syllabusDraft || syllabusAttachment || nativeDocumentDialog || organizationState || fileUploads.dirty || pendingFolderUpload || fileStore.busy || undoBusy) throw new Error("Save and close pending editors before asking the assistant.");
    await autosave.flush();
    const current = autosave.getSnapshot();
    if (!current.ready || current.dirty || current.status !== "saved") throw new Error("Wait for saving to finish, or resolve the workspace save message first.");
  };
  const applyAssistant = async (id: string) => {
    if (aiApplyLock.current) return;
    await prepareAssistant();
    aiApplyLock.current = true; setAiApplying(true);
    try {
      const response = await accountFetch("/api/ai/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "apply" }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The changes could not be applied.");
      // Stop the old writer before hydration. Other tabs receive ordinary 409 conflicts.
      autosave.loading(); setReloadAttempt((n) => n + 1);
    } finally { aiApplyLock.current = false; setAiApplying(false); }
  };

  const dashboardChat = useDashboardChat({ profileId: initialProfile.id, prepare: prepareAssistant, experimental: !!experimentalMode });

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const homeSkeletonBaseLayout = useMemo(
    () => createHomeSkeletonLayout(activeWorkspace, resolveWidgetAppearance(extraData.widgetAppearance).gap),
    [activeWorkspace, extraData.widgetAppearance],
  );
  const homeSkeletonServerLayout = useMemo(() => {
    if (homeSkeletonMeasurement?.accountId !== initialProfile.id
      || homeSkeletonMeasurement.workspaceId !== activeWorkspace.id
      || !layoutsMatch(homeSkeletonMeasurement.layout, homeSkeletonBaseLayout)) return homeSkeletonBaseLayout;
    return { ...homeSkeletonBaseLayout, geometry: homeSkeletonMeasurement.geometry };
  }, [activeWorkspace.id, homeSkeletonBaseLayout, homeSkeletonMeasurement, initialProfile.id]);
  useEffect(() => {
    if (page !== "home"
      || profile.id !== initialProfile.id
      || !saveState.ready
      || customizing
      || experimentalMode
      || onboardingTest
      || experimentalRestoring) return;

    const measureHomeGeometry = () => {
      const home = document.querySelector<HTMLElement>(".home-load-transition__content .home-page");
      const toolbar = home?.querySelector<HTMLElement>(".workspace-bar");
      if (!home || !toolbar) return;
      const homeRect = home.getBoundingClientRect();
      if (!homeRect.width || !toolbar.getBoundingClientRect().height) return;
      const today = home.querySelector<HTMLElement>(".home-today-panel");
      const todayHeight = today?.getBoundingClientRect().height ?? 0;
      const round = (value: number) => Math.round(value * 100) / 100;
      const geometry: HomeSkeletonGeometry = {
        viewportWidth: round(window.innerWidth),
        contentWidth: round(homeRect.width),
        todayHeight: round(todayHeight),
        toolbarHeight: round(toolbar.getBoundingClientRect().height),
      };
      setHomeSkeletonMeasurement((current) => {
        if (current?.accountId === initialProfile.id
          && current.workspaceId === activeWorkspace.id
          && layoutsMatch(current.layout, homeSkeletonBaseLayout)
          && Math.abs(current.geometry.viewportWidth - geometry.viewportWidth) < 0.1
          && Math.abs(current.geometry.contentWidth - geometry.contentWidth) < 0.1
          && Math.abs(current.geometry.todayHeight - geometry.todayHeight) < 0.1
          && Math.abs(current.geometry.toolbarHeight - geometry.toolbarHeight) < 0.1) return current;
        return {
          accountId: initialProfile.id,
          workspaceId: activeWorkspace.id,
          layout: homeSkeletonBaseLayout,
          geometry,
        };
      });
    };

    measureHomeGeometry();
    window.addEventListener("resize", measureHomeGeometry);
    const home = document.querySelector<HTMLElement>(".home-load-transition__content .home-page");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureHomeGeometry);
    if (home) observer?.observe(home);
    const toolbar = home?.querySelector<HTMLElement>(".workspace-bar");
    if (toolbar) observer?.observe(toolbar);
    const today = home?.querySelector<HTMLElement>(".home-today-panel");
    if (today) observer?.observe(today);
    return () => {
      window.removeEventListener("resize", measureHomeGeometry);
      observer?.disconnect();
    };
  }, [
    activeWorkspace.id,
    customizing,
    experimentalMode,
    experimentalRestoring,
    initialProfile.id,
    onboardingTest,
    page,
    homeSkeletonBaseLayout,
    profile.id,
    saveState.ready,
  ]);
  useEffect(() => {
    if (profile.id !== initialProfile.id
      || !homeSkeletonRestored
      || !homeSkeletonCache.readable
      || !saveState.ready
      || experimentalMode
      || onboardingTest
      || experimentalRestoring) return;
    const preserveGeometry = homeSkeletonCache.cached
      && layoutsMatch(homeSkeletonCache.layout, homeSkeletonBaseLayout)
      ? homeSkeletonCache.layout.geometry
      : undefined;
    const layoutToWrite = homeSkeletonServerLayout.geometry
      ? homeSkeletonServerLayout
      : preserveGeometry
        ? { ...homeSkeletonBaseLayout, geometry: preserveGeometry }
        : homeSkeletonBaseLayout;
    if (homeSkeletonCache.cached && cacheLayoutsMatch(homeSkeletonCache.layout, layoutToWrite)) return;
    if (!writeHomeSkeletonLayout(initialProfile.id, layoutToWrite)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep same-tab reloads aligned with the snapshot just persisted to local storage.
    setHomeSkeletonCache((current) => current.accountId === initialProfile.id && current.readable
      ? { ...current, layout: layoutToWrite, cached: true }
      : current);
  }, [
    experimentalMode,
    experimentalRestoring,
    homeSkeletonCache,
    homeSkeletonBaseLayout,
    homeSkeletonRestored,
    homeSkeletonServerLayout,
    initialProfile.id,
    onboardingTest,
    profile.id,
    saveState.ready,
  ]);
  const todayAssignments = assignments.filter((assignment) => assignment.status === "today");
  const overdueAssignments = assignments.filter((assignment) => assignment.status === "overdue");

  const navigate = (destination: PageId) => {
    setQuickSearchOpen(false);
    if (nativeDocumentDialog) { flash("Close the text editor before navigating. Your draft is still here."); return; }
    router.push(`/${destination}`);
    setSidebarOpen(false);
    setExperimentalMenuOpen(false);
    setSelectedAssignment(null);
    resetSelectedClass();
  };

  const flash = (message: string) => setToast(message);

  const handleSidebarNavigation = (event: ReactMouseEvent<HTMLAnchorElement>, destination: PageId) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (selectedClass && destination === "dashboard") {
      event.preventDefault();
      closeExpandedClassRef.current?.();
      return;
    }
    setSidebarOpen(false);
    setExperimentalMenuOpen(false);
  };

  const applyExperimentalData = (density: ExperimentalDensity) => {
    if (fileUploads.dirty || fileUploads.busy || pendingFolderUpload) { flash("Finish or dismiss retained uploads before loading preview data."); return; }
    if (nativeDocumentDialog) { flash("Close the text editor before loading preview data."); return; }
    if (organizationState) { flash("Close the Files dialog before loading preview data."); return; }
    if (undoBusy) { flash("Wait for Undo to finish before loading preview data."); return; }
    if (!saveState.ready || saveState.dirty || profilePending || fileStore.busy) {
      flash("Wait for your real workspace to finish saving first");
      return;
    }
    const demo = experimentalData(density, today);
    const demoDetails = {
      assignments: demo.assignments,
      manualEvents: demo.manualEvents,
      dashboardView: "cards" as const,
      calendarFilter: "all",
      courseDetails: demo.courseDetails,
      syllabusDrafts: [],
      study: demo.study,
      filePreferences: extraData.filePreferences,
      widgetAppearance: extraData.widgetAppearance,
    };
    try {
      academicSnapshot(demo.courses, encodeWorkspaceState(demo.workspaces, demo.activeWorkspaceId, demo.notes, demoDetails));
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to load the preview data");
      return;
    }
    setExperimentalMode(density);
    setCourses(demo.courses);
    setAssignments(demo.assignments);
    setManualEvents(demo.manualEvents);
    setWorkspaces(demo.workspaces);
    setActiveWorkspaceId(demo.activeWorkspaceId);
    setNotes(demo.notes);
    setDashboardView("cards");
    setCalendarFilter("all");
    setExtraData({ courseDetails: demo.courseDetails, syllabusDrafts: [], study: demo.study, filePreferences: extraData.filePreferences, widgetAppearance: extraData.widgetAppearance });
    setExperimentalMenuOpen(false);
    setSelectedAssignment(null); setSelectedClass(null); setEditor(null); setStudyOpen(false); setSyllabusDraft(null);
    setClassSetup(null);
    navigate("home");
    flash(`${density.charAt(0).toUpperCase() + density.slice(1)} demo loaded`);
  };

  const exitExperimentalMode = () => {
    if (experimentalRestoring) return;
    setExperimentalRestoring(true);
    setExperimentalMenuOpen(false);
    setReloadAttempt((attempt) => attempt + 1);
  };

  useEffect(() => {
    if (page !== "home" || !noteFocusRef.current) return;
    const input = document.getElementById(`note-${noteFocusRef.current}`);
    if (input) { input.focus(); input.scrollIntoView?.({ block: "center" }); noteFocusRef.current = null; }
  }, [page, activeWorkspaceId, workspaces]);

  // Validate the entire candidate before accepting a change that cannot be saved.
  const commitWorkspaces = (next: Workspace[], active = activeWorkspaceId, recoveredNotes = notes, appearance = extraData.widgetAppearance) => {
    next = next.map((workspace) => ({ ...workspace, resizePriorities: workspace.resizePriorities?.filter((priority) => workspace.widgets.some((widget) => widget.instanceId === priority.widgetId)) }));
    const ids = new Set(next.flatMap((workspace) => workspace.widgets.map((widget) => widget.instanceId)));
    const cleanedAppearance = appearance && { ...appearance, overrides: Object.fromEntries(Object.entries(appearance.overrides).filter(([id]) => ids.has(id))) };
    try { academicSnapshot(courses, encodeWorkspaceState(next, active, recoveredNotes, { assignments: storedAssignments, manualEvents, dashboardView, calendarFilter, ...extraData, widgetAppearance: cleanedAppearance })); }
    catch (error) { flash(error instanceof Error ? error.message : "This layout cannot be saved."); return false; }
    setWorkspaces(next); setActiveWorkspaceId(active); setNotes(recoveredNotes);
    if (appearance) setExtraData((current) => ({ ...current, widgetAppearance: cleanedAppearance }));
    return true;
  };

  const restoreToday = () => {
    if (!commitWorkspaces(workspaces.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, todayHidden: false } : workspace))) return;
    setWorkspaceMenuOpen(false);
    window.requestAnimationFrame(() => todayOptionsButtonRef.current?.focus());
  };

  const updateWorkspaceWidgets = (updater: (widgets: WidgetInstance[]) => WidgetInstance[], resetPlacement = false) => {
    return commitWorkspaces(workspaces.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, widgets: updater(workspace.widgets), resizePriorities: resetPlacement ? undefined : workspace.resizePriorities } : workspace));
  };

  const addWidget = (type: WidgetType) => {
    const template = widgetTemplates.find((item) => item.type === type)!;
    if (updateWorkspaceWidgets((widgets) => [...widgets, { instanceId: uid("widget"), type, size: template.defaultSize, ...(type === "notes" ? { note: "" } : {}) }])) flash(`${template.title} added`);
  };

  const removeWidget = (instanceId: string) => {
    const widget = activeWorkspace.widgets.find((item) => item.instanceId === instanceId);
    if (!widget) return false;
    if (widget.note && !window.confirm("Remove this notes widget and its text?")) return false;
    if (!updateWorkspaceWidgets((widgets) => widgets.filter((item) => item.instanceId !== instanceId))) return false;
    closeWidgetMenu();
    flash("Widget removed");
    return true;
  };

  const moveWidget = (from: number, to: number) => {
    if (from === to || from < 0 || from >= activeWorkspace.widgets.length || to < 0 || to >= activeWorkspace.widgets.length) return;
    updateWorkspaceWidgets((widgets) => {
      const next = [...widgets];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }, true);
    closeWidgetMenu();
  };

  const resizeWidget = (instanceId: string, size: WidgetSize, priority?: WidgetResizePriority) => {
    if (activeWorkspace.widgets.find((widget) => widget.instanceId === instanceId)?.size === size) {
      closeWidgetMenu();
      return true;
    }
    if (!priority) {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-widget-id]")).find((candidate) => candidate.dataset.widgetId === instanceId);
      const grid = card?.closest<HTMLElement>(".widget-grid");
      if (card && grid) {
        const columns = Number.parseInt(window.getComputedStyle(grid).getPropertyValue("--widget-columns"), 10) === 2 ? 2 : 4;
        priority = { widgetId: instanceId, columns, column: Number.parseInt(card.style.gridColumn, 10) || 1, row: Math.floor(((Number.parseInt(card.style.gridRow, 10) || 1) - 1) / 2) * 2 + 1 };
      }
    }
    const nextPriority = priority;
    const accepted = commitWorkspaces(workspaces.map((workspace) => workspace.id !== activeWorkspaceId ? workspace : { ...workspace,
      resizePriorities: nextPriority ? [...(workspace.resizePriorities ?? []).filter((candidate) => candidate.columns !== nextPriority.columns), nextPriority] : workspace.resizePriorities,
      widgets: workspace.widgets.map((widget) => {
        if (widget.instanceId !== instanceId) return widget;
        const next = { ...widget, size };
        if (size !== "mini") delete next.startsNewMiniBlock;
        return next;
      }) }));
    closeWidgetMenu();
    return accepted;
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
    const copy: Workspace = { ...activeWorkspace, id, name: `${activeWorkspace.name.slice(0, 75)} copy`, widgets: activeWorkspace.widgets.map((widget) => ({ ...widget, instanceId: uid("widget") })) };
    copy.resizePriorities = activeWorkspace.resizePriorities?.map((priority) => ({ ...priority, widgetId: copy.widgets[activeWorkspace.widgets.findIndex((widget) => widget.instanceId === priority.widgetId)].instanceId }));
    const appearance = extraData.widgetAppearance && { ...extraData.widgetAppearance, overrides: { ...extraData.widgetAppearance.overrides } };
    if (appearance) copy.widgets.forEach((widget, index) => {
      const original = appearance.overrides[activeWorkspace.widgets[index].instanceId];
      if (original) appearance.overrides[widget.instanceId] = { ...original };
    });
    if (!commitWorkspaces([...workspaces, copy], id, notes, appearance)) return;
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
    const data = { assignments: storedAssignments, manualEvents, dashboardView, calendarFilter, ...extraData, ...patch };
    try { validateAcademicEdit(nextCourses, encodeWorkspaceState(workspaces, activeWorkspaceId, notes, data), { assignments: storedAssignments, manualEvents, dashboardView }); }
    catch (error) { flash(error instanceof Error ? error.message : "Review the academic data."); return false; }
    setCourses(nextCourses); setAssignments(data.assignments); setManualEvents(data.manualEvents); setCalendarFilter(data.calendarFilter);
    setExtraData({ courseDetails: data.courseDetails, syllabusDrafts: [], study: data.study, filePreferences: data.filePreferences, widgetAppearance: data.widgetAppearance }); return true;
  };
  const commitStudy = (patch: Partial<StudyData>) => commitAcademic(courses, { study: { ...study, ...patch } });
  const saveCourseSyllabus = async (courseId: string, value: SyllabusAttachmentValue, deleting = false) => {
    if (experimentalMode || profilePending || !autosave.getSnapshot().ready || !courses.some((course) => course.id === courseId)) throw new Error("Reload the saved course before attaching a syllabus.");
    const generation = workspaceLoadGeneration.current;
    const details = { ...(extraData.courseDetails[courseId] ?? emptyCourseDetails()), syllabusText: value.syllabusText, syllabusName: value.syllabusName };
    if (deleting) details.syllabusDeleted = true;
    else delete details.syllabusDeleted;
    if (value.syllabusFileId) details.syllabusFileId = value.syllabusFileId;
    else delete details.syllabusFileId;
    const nextExtra = { ...extraData, courseDetails: { ...extraData.courseDetails, [courseId]: details } };
    const dashboard = encodeWorkspaceState(workspaces, activeWorkspaceId, notes, { assignments: storedAssignments, manualEvents, dashboardView, calendarFilter, ...nextExtra });
    validateAcademicEdit(courses, dashboard, { assignments: storedAssignments, manualEvents, dashboardView });
    const snapshot = canonicalJson(academicSnapshot(courses, dashboard));
    setExtraData(nextExtra);
    autosave.change(snapshot);
    await autosave.flushLatest(true);
    if (generation !== workspaceLoadGeneration.current) throw new Error("The workspace was reloaded. Reopen the saved course to continue.");
    const saved = autosave.getSnapshot();
    if (!saved.ready || saved.dirty || saved.status !== "saved") throw new Error(saved.message || "The syllabus could not be saved. Your draft is still here; retry saving.");
    if (!deleting) flash("Syllabus saved");
  };
  const controlTimer = (action: "start" | "pause" | "resume" | "finish" | "reset", kind: TimerKind) => {
    // This callback runs only from StudyPanel/StudyWidget user events.
    try { commitStudy(timerAction(study, action, kind, Date.now(), uid("session"))); setNow(new Date()); }
    catch (error) { flash(error instanceof Error ? error.message : "Unable to update the timer."); }
  };
  const removeClass = (course: Course) => {
    if (!window.confirm("Remove " + course.code + ", its assignments, grades, and class schedule? Study history, timers, calendar events, and files will remain as personal items.")) return;
    const details = { ...extraData.courseDetails }; delete details[course.id];
    if (commitAcademic(courses.filter((c) => c.id !== course.id), { assignments: storedAssignments.filter((a) => a.courseId !== course.id), manualEvents: manualEvents.map((e) => e.courseId === course.id ? { ...e, courseId: "" } : e), courseDetails: details, study: detachStudyCourse(study, course.id), filePreferences: { ...extraData.filePreferences, filter: extraData.filePreferences.filter === course.id ? "all" : extraData.filePreferences.filter }, calendarFilter: calendarFilter === course.id ? "all" : calendarFilter })) { setSelectedClass(null); setEditor(null); setClassSetup(null); }
  };
  const applyEditor = (value: NonNullable<typeof editor>) => {
    let accepted = false;
    if (value.course) accepted = commitAcademic([...courses.filter((c) => c.id !== value.course!.id), value.course], { courseDetails: { ...extraData.courseDetails, [value.course.id]: value.details ?? emptyCourseDetails() } });
    if (value.assignment) accepted = commitAcademic(courses, { assignments: [...storedAssignments.filter((a) => a.id !== value.assignment!.id), value.assignment] });
    if (value.event) accepted = commitAcademic(courses, { manualEvents: [...manualEvents.filter((e) => e.id !== value.event!.id), value.event] });
    if (accepted) { setEditor(null); setSelectedAssignment(null); if (!value.taskCourse) setSelectedClass(null); }
    return accepted;
  };
  const persistClassSetup = async (course: Course, details: CourseDetails, generation: number) => {
    if (generation !== workspaceLoadGeneration.current) throw new Error("The workspace changed. Reopen class setup in the original workspace.");
    const nextCourses = [...courses.filter((current) => current.id !== course.id), course];
    const courseDetails = { ...extraData.courseDetails, [course.id]: details };
    const dashboard = encodeWorkspaceState(workspaces, activeWorkspaceId, notes, { assignments: storedAssignments, manualEvents, dashboardView, calendarFilter, ...extraData, courseDetails });
    const snapshot = canonicalJson(academicSnapshot(nextCourses, dashboard));
    if (!commitAcademic(nextCourses, { courseDetails })) throw new Error("Could not save this class. Check the workspace message and retry.");
    if (!experimentalMode) {
      autosave.change(snapshot);
      await autosave.flushLatest(true);
      if (generation !== workspaceLoadGeneration.current) throw new Error("The workspace changed while saving. Reopen the saved class to continue.");
      const saved = autosave.getSnapshot();
      if (!saved.ready || saved.dirty || saved.status !== "saved") throw new Error(saved.message || "Class save is incomplete. Your setup is still here; retry saving.");
    }
  };
  const persistClassSetupRef = useRef(persistClassSetup);
  useLayoutEffect(() => { persistClassSetupRef.current = persistClassSetup; });
  const saveClassSetup = async (course: Course, details: CourseDetails, uploads: ClassSetupUploads) => {
    if (!classSetup || classSetup.course.id !== course.id || classSetup.profileId !== initialProfile.id || classSetup.profileId !== profile.id || classSetup.generation !== workspaceLoadGeneration.current) throw new Error("This class setup belongs to an earlier workspace session. Close it and start again.");
    if (profilePending || (!experimentalMode && !autosave.getSnapshot().ready)) throw new Error("Wait for your workspace to finish loading, then retry.");
    if (experimentalMode && (uploads.image || uploads.syllabus)) throw new Error("File uploads are unavailable in this workspace.");
    const generation = classSetup.generation;
    await persistClassSetupRef.current(course, details, generation);
    try {
      if (uploads.image) await fileStore.upload(uploads.image.file, { name: uploads.image.file.name, courseId: course.id, assignmentId: "", kind: "class-image" }, uploads.image.id);
      if (generation !== workspaceLoadGeneration.current) throw new Error("The workspace changed during upload.");
      if (uploads.syllabus) {
        const file = await fileStore.upload(uploads.syllabus.file, { name: uploads.syllabus.file.name, courseId: course.id, assignmentId: "", kind: "syllabus" }, uploads.syllabus.id);
        await persistClassSetupRef.current(course, { ...details, syllabusDeleted: false, syllabusText: classSetup.editing ? "" : details.syllabusText, syllabusName: file.name, syllabusFileId: file.id }, generation);
      }
    } catch (failure) {
      throw new Error(`The class was saved, but attachments may be incomplete. Retry to finish without creating another class. ${failure instanceof Error ? failure.message : "Upload failed."}`);
    }
    if (generation !== workspaceLoadGeneration.current) throw new Error("The workspace changed. Reopen the saved class to continue.");
    setClassSetup(null);
    flash(classSetup.editing ? "Class updated" : "Class created");
  };
  const newAssignment = () => setEditor({ assignment: { id: uid("assignment"), title: "", courseId: "", due: "", dateKey: today, dueTime: "", type: "Assignment", status: "later", progress: 0, description: "", weight: "", notes: "", checklist: [false, false, false] } });
  const newEvent = (date = today) => setEditor({ event: { id: uid("event"), title: "", courseId: "", dateKey: date, time: "", type: "Personal", description: "" } });
  const newReview = () => createReview();
  const createReview = (file?: PrivateFile, sourceText = "") => {
    const draft: SyllabusDraft = { id: uid("review"), sourceText, sourceName: file?.name ?? "", ...(file ? { sourceFileId: file.id } : {}), course: emptyCourse(uid("course")), items: [] };
    setSyllabusDraft(draft); setAddClassOpen(false);
  };
  const approveReview = (draft: SyllabusDraft) => {
    const course = { ...draft.course, initials: draft.course.code.slice(0, 2).toUpperCase() };
    const items: Assignment[] = draft.items.map((item) => ({ id: "syllabus-" + item.id, courseId: course.id, title: item.title, type: item.type, dateKey: item.date, due: dateLabel(item.date), status: "later", progress: 0, description: item.description, weight: item.weight, notes: "", checklist: [false, false, false] }));
    const accepted = commitAcademic([...courses.filter((c) => c.id !== course.id), course], { assignments: [...storedAssignments, ...items], courseDetails: { ...extraData.courseDetails, [course.id]: { ...emptyCourseDetails(), syllabusText: draft.sourceText, syllabusName: draft.sourceName, ...(draft.sourceFileId ? { syllabusFileId: draft.sourceFileId } : {}) } } });
    if (accepted) setSyllabusDraft(null); return accepted;
  };
  const toggleAssignmentComplete = (id: string) => {
    const a = storedAssignments.find((a) => a.id === id); if (!a) return;
    const changed: Assignment = a.status === "done" ? { ...a, status: "later", completedAt: null, progress: a.progressBeforeCompletion ?? 0 } : { ...a, status: "done", completedAt: new Date().toISOString(), progressBeforeCompletion: a.progress, progress: 100 };
    if (commitAcademic(courses, { assignments: storedAssignments.map((item) => item.id === id ? changed : item) })) setSelectedAssignment(changed);
  };

  const workspaceError = ["load-error", "save-error", "conflict", "session-error"].includes(persistenceStatus);
  const workspacePending = persistenceStatus === "dirty" || persistenceStatus === "saving";
  const homeSaveIndicator = page === "home" && saveState.ready && !experimentalMode;
  const showWorkspaceToast = !experimentalMode && ((!homeSaveIndicator && (workspaceError || workspacePending)) || (profilePending && persistenceStatus === "saved"));
  const workspaceToastTitle = persistenceStatus === "load-error" ? "Couldn't load workspace"
    : persistenceStatus === "save-error" ? ""
      : persistenceStatus === "conflict" ? "Workspace changed elsewhere"
        : persistenceStatus === "session-error" ? "Sign in to continue saving"
          : workspacePending ? "Saving workspace…"
            : profileSaving ? "Saving settings…"
              : "Settings have unsaved changes";
  const workspaceToastMessage = workspaceError ? saveState.message || "Something went wrong while saving your workspace."
    : workspacePending ? undefined
      : profileSaving ? "Your settings changes are being saved."
        : profilePending ? "Your settings changes have not been saved yet."
          : undefined;
  const workspaceToastLoading = workspacePending || (profileSaving && persistenceStatus === "saved");
  const renderWorkspaceRecoveryActions = () => <>
    {profilePending && page !== "settings" && (workspaceError || persistenceStatus === "saved") && persistenceStatus !== "save-error" && <button type="button" onClick={() => navigate("settings")}>Review settings</button>}
    {workspaceError && persistenceStatus === "save-error" && <button type="button" onClick={autosave.retry}>Retry save</button>}
    {workspaceError && persistenceStatus === "session-error" && <><a href="/login?error=session" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a><button type="button" onClick={saveState.ready ? autosave.retry : reloadWorkspace}>Retry after signing in</button></>}
    {workspaceError && persistenceStatus === "load-error" && <button type="button" onClick={reloadWorkspace}>Retry loading</button>}
    {workspaceError && saveState.dirty && <button type="button" onClick={downloadUnsavedWork}>Download unsaved work</button>}
    {workspaceError && saveState.dirty && persistenceStatus !== "save-error" && <button type="button" disabled={persistenceStatus === "saving" || profileSaving} onClick={reloadWorkspace}>Reload saved workspace</button>}
  </>;
  const widgetEditingEnabled = customizing && !appearanceOpen && !widgetPickerOpen && !workspaceDialog && !aiApplying && !studyOpen && !editor && !selectedAssignment && !selectedClass && !syllabusDraft && !syllabusAttachment && !syllabusTextCourseId && !nativeDocumentDialog;

  useEffect(() => {
    if (page !== "home" || !widgetEditingEnabled) return;
    const exitCustomization = (event: KeyboardEvent) => {
      // Let dialogs and active widget gestures handle Escape first.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setCustomizing(false);
      customizeButtonRef.current?.focus();
    };
    window.addEventListener("keydown", exitCustomization);
    return () => window.removeEventListener("keydown", exitCustomization);
  }, [page, widgetEditingEnabled]);

  const syllabusAttachmentCourse = syllabusAttachment ? courses.find((course) => course.id === syllabusAttachment.courseId) : undefined;
  const syllabusTextCourse = syllabusTextCourseId ? courses.find((course) => course.id === syllabusTextCourseId) : undefined;

  if (onboardingTest) return <OnboardingFlow initialProfile={profile} preview onExit={() => {
    setOnboardingTest(false);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(".experimental-trigger")?.focus(), 0);
  }} />;

  return (
    <div ref={setAppShellElement} className={`app-shell reference-ui ${page === "files" && filesBrowserEnabled ? "files-workspace" : ""} ${customizing ? "is-customizing" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <div className="mountain-backdrop" aria-hidden="true" />

      <a className="skip-link" href="#main-content">Skip to main content</a>
      <WorkspaceNavigation page={page} sidebarOpen={sidebarOpen} sidebarCollapsed={sidebarCollapsed} courseCount={courses.length} studentName={studentName} profileMajor={profileMajor} streak={stats.streak} dailyMinutes={study.dailyMinutes} dailySeconds={stats.dailySeconds} dailyPercent={dailyPercent} ready={saveState.ready} dirty={saveState.dirty} profilePending={profilePending} filesBusy={fileStore.busy} aiApplying={aiApplying} experimentalMode={experimentalMode} experimentalMenuOpen={experimentalMenuOpen} experimentalRestoring={experimentalRestoring} appShellElement={appShellElement} experimentalControlRef={experimentalControlRef} experimentalTriggerRef={experimentalTriggerRef} experimentalMenuRef={experimentalMenuRef} onToggleSidebar={toggleSidebar} onCloseNavigation={() => { setSidebarOpen(false); setExperimentalMenuOpen(false); }} onNavigate={handleSidebarNavigation} onExperimentalMenuChange={setExperimentalMenuOpen} onApplyExperimentalData={applyExperimentalData} onExitExperimentalMode={exitExperimentalMode} onOnboardingTest={() => {
        const current = autosave.getSnapshot();
        if (!current.ready || current.dirty || profilePending || fileStore.busy || experimentalRestoring || aiApplying) return;
        autosave.stop();
        setExperimentalMenuOpen(false); setSidebarOpen(false); setOnboardingTest(true);
      }} onNewReview={newReview} onOpenStudy={() => setStudyOpen(true)} />

      <header className="desktop-topbar">
        <TopbarSearch formRef={quickSearchRef} open={quickSearchOpen && Boolean(searchQuery.trim())} reducedMotion={profile.preferences.reducedMotion}
          results={quickSearchOpen && searchQuery.trim() ? <WorkspaceQuickSearchResults groups={searchResultGroups()} onSelect={(item) => { setQuickSearchOpen(false); item.action(); }} /> : null}
          onSubmit={(event) => { event.preventDefault(); navigate("search"); }}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setQuickSearchOpen(false); }}>
          <Search size={20} aria-hidden="true" />
          <input
            ref={topSearchRef}
            aria-label="Search assignments, classes, and files"
            aria-controls={quickSearchOpen && searchQuery.trim() ? "workspace-search-suggestions" : undefined}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && quickSearchOpen) {
                event.preventDefault(); quickSearchRef.current?.querySelector<HTMLButtonElement>(".quick-search-result")?.focus();
              }
            }}
            placeholder="Search your workspace…"
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); setQuickSearchOpen(Boolean(event.target.value.trim())); }}
          />
          <kbd>Ctrl K</kbd>
          <button type="submit" className="search-send" aria-label="Search"><Send size={18} /><span className="sr-only">Search</span></button>
        </TopbarSearch>
        <div className="topbar-actions">
          <button className="topbar-icon" onClick={() => flash("You’re all caught up")} aria-label="Open notifications">
            <Bell size={18} />
            <span className="notification-dot" />
          </button>
        </div>
      </header>

      <main id="main-content" className="main-content">
        <WorkspaceMobileHeader onOpenNavigation={() => setSidebarOpen(true)} onNotifications={() => flash(overdueAssignments.length ? `${overdueAssignments.length} overdue tasks — check Tasks for details` : "You’re all caught up")} />

        {experimentalMode && <div className="experimental-banner" role="status">
          <FlaskConical size={17} />
          <span><strong>{experimentalMode.charAt(0).toUpperCase() + experimentalMode.slice(1)} experimental mode</strong> — fake data is shown only in this tab and is not saved.</span>
          <button type="button" disabled={experimentalRestoring} onClick={exitExperimentalMode}>{experimentalRestoring ? "Restoring…" : "Exit"}</button>
        </div>}
        {page === "home" && (saveState.ready || persistenceStatus === "loading") && (
          <HomeLoadTransition
            key={`home-load-${reloadAttempt}-${initialProfile.id}-${homeSkeletonRestored}`}
            ready={saveState.ready}
            layout={homeSkeletonLayout}
            greeting={homeGreeting}
            serverLayout={saveState.ready ? homeSkeletonServerLayout : undefined}
            layoutRestored={homeSkeletonRestored}
            reducedMotion={profile.preferences.reducedMotion}
          >
            {saveState.ready ? renderHome() : null}
          </HomeLoadTransition>
        )}
        {!saveState.ready && (persistenceStatus === "loading" ? (
          page !== "dashboard" && page !== "home" && (
            <section className="workspace-loading is-pending" role="status" aria-live="polite">
              <span className="workspace-loading-spinner" aria-hidden="true" />
              <h1>Loading your workspace...</h1>
            </section>
          )
        ) : (
          <section className="workspace-loading"><h1>Your workspace could not be loaded</h1><p>Your saved work will be available here when the connection is restored.</p></section>
        ))}
        {restoringPlaceholderAssets && placeholderAssets.failed && <section className="workspace-loading" role="alert">
          <h1>Course previews could not be loaded</h1>
          <p>Retry loading the preview placeholders or return to the dashboard.</p>
          <button type="button" onClick={placeholderAssets.retry}>Retry previews</button>
          <button type="button" onClick={() => setSelectedClass(null)}>Return to dashboard</button>
        </section>}
        {page === "dashboard" && !placeholderAssets.failed && (saveState.ready || persistenceStatus === "loading") && <WorkspaceDashboard
  loadKey={`dashboard-load-${reloadAttempt}-${initialProfile.id}`}
  ready={saveState.ready && profile.id === initialProfile.id && !restoringPlaceholderAssets}
  restoringCourseOnReload={restoringCourseOnReload || restoringPlaceholderAssets}
  restorationChecked={restorationChecked}
  imagesListed={Boolean(selectedClass) || dashboardView !== "cards" || courses.length === 0 || !fileStore.loading || Boolean(fileStore.error)}
  imageKeys={!selectedClass && dashboardView === "cards" ? [...courseImages.values()].filter((file): file is PrivateFile => Boolean(file)).map(courseImageLoadKey) : []}
  reducedMotion={profile.preferences.reducedMotion}
  reflowKey={String(sidebarCollapsed)}
  skipOpeningAnimation={skipOpeningAnimation}
  profileId={initialProfile.id}
  filesReady={!fileStore.loading && !fileStore.error}
  cacheEnabled={page === "dashboard" && !experimentalMode && !onboardingTest}
  courses={courses}
  assignments={assignments}
  courseDetails={extraData.courseDetails}
  courseImages={courseImages}
  store={fileStore}
  focusAssignments={dashboardFocus(assignments)}
  overdueCount={overdueAssignments.length}
  dueTodayCount={todayAssignments.length}
  completedThisWeek={weeklyCompleted}
  dashboardView={dashboardView}
  selectedCourseId={selectedClass?.id}
  getCourse={(courseId) => courseFor(courses, courseId)}
  chatMessages={dashboardChat.messages}
  chatBusy={dashboardChat.busy}
  onSelectAssignment={setSelectedAssignment}
  onSelectCourse={setSelectedClass}
  onAddAssignment={newAssignment}
  onAddClass={() => setAddClassOpen(true)}
  onOpenAssistant={(question, conversationId, proposalId) => {
    if (nativeDocumentDialog) { navigate("assistant"); return; }
    setAssistantPrompt(question?.trim() || conversationId || proposalId ? { id: uid("assistant-prompt"), profileId: initialProfile.id, question: question?.trim() ?? "", send: false, conversationId, proposalId } : null);
    navigate("assistant");
  }}
  onAskAssistant={(question) => dashboardChat.send(question)}
  onContinueAssistant={(question, conversationId) => {
    if (nativeDocumentDialog) return false;
    setAssistantPrompt({ id: uid("assistant-prompt"), profileId: initialProfile.id, question, send: true, conversationId });
    navigate("assistant");
  }}
  onToggleView={() => setDashboardView((current) => current === "cards" ? "list" : "cards")}
  onShowAllAssignments={() => setDashboardView("list")}
/>}
        {saveState.ready && page === "tasks" && <div className="page">{renderPageHeader("Your coursework", "Tasks", "All your assignments, across every course.", <button className="primary-button" onClick={newAssignment}><Plus size={16} /> Add assignment</button>)}<AssignmentTable items={assignments} courseFor={(courseId) => courseFor(courses, courseId)} onSelectAssignment={setSelectedAssignment} /></div>}
        {saveState.ready && page === "calendar" && renderCalendar()}
        {saveState.ready && page === "search" && <WorkspaceSearchPage groups={searchResultGroups()} query={searchQuery} onQueryChange={setSearchQuery} header={renderPageHeader("Find anything", "Search your workspace", "Search saved text, file names, events, classes, grades, and study history. PDF/image contents are not indexed.")} />}
        {(saveState.ready || organizationState) && (page === "files" || organizationState) && <div hidden={page !== "files"}>{renderFiles()}</div>}
        {page === "assistant" && <AcademicAssistant key={initialProfile.id} profileId={initialProfile.id} prepare={prepareAssistant} apply={applyAssistant} experimental={!!experimentalMode} initialPrompt={assistantPrompt?.profileId === initialProfile.id ? assistantPrompt : null} onPromptConsumed={(id) => setAssistantPrompt((current) => current?.id === id ? null : current)} />}
        {saveState.ready && <div key={reloadAttempt} hidden={page !== "settings"}>{renderSettings()}</div>}
      </main>

      <WorkspaceMobileNavigation page={page} />

      {children}
      {aiApplying && <div className="assistant-apply-overlay" role="status">Applying your reviewed changes…</div>}
      {studyOpen && <StudyPanel data={study} courses={courses} system={activeGpaSystem} term={activeTerm} studyGoal={profile.study_goal} timezone={profile.timezone} now={now.getTime()} onChange={commitStudy} onTimer={controlTimer} onClose={() => setStudyOpen(false)} />}
      {widgetPickerOpen && <WidgetPicker
  activeWorkspace={activeWorkspace}
  search={widgetSearch}
  onSearchChange={setWidgetSearch}
  onAdd={addWidget}
  onCloseAndResetSearch={() => { setWidgetPickerOpen(false); setWidgetSearch(""); }}
  onDone={() => setWidgetPickerOpen(false)}
/>}
      {appearanceOpen && <WidgetCustomization value={extraData.widgetAppearance} widgets={activeWorkspace.widgets.map((widget) => ({ instanceId: widget.instanceId, title: widgetTemplates.find((template) => template.type === widget.type)!.title, size: widget.size, startsNewMiniBlock: widget.startsNewMiniBlock }))} onClose={closeAppearance} onApply={(next) => {
        if (aiApplying || !saveState.ready || !commitAcademic(courses, { widgetAppearance: next })) return false;
        setAppearanceOpen(false); flash(experimentalMode ? "Appearance preview updated — nothing saved to your account" : "Widget appearance applied"); return true;
      }} />}
      {workspaceDialog && <WorkspaceDialog
  mode={workspaceDialog}
  nameDraft={workspaceNameDraft}
  onNameDraftChange={setWorkspaceNameDraft}
  onClose={() => setWorkspaceDialog(null)}
  onSubmit={() => workspaceDialog === "new" ? createWorkspace() : renameWorkspace()}
/>}
      {selectedClass && !restoringPlaceholderAssets && <CourseEditTransitionContext.Provider value={Boolean(classSetup)}><CourseDetail
  course={selectedClass}
  assignments={assignments}
  details={extraData.courseDetails[selectedClass.id] ?? emptyCourseDetails()}
  image={courseImages.get(selectedClass.id)}
  profileId={initialProfile.id}
  sessionGeneration={fileActionSession.generation}
  today={today}
  store={fileStore}
  filesReady={!fileStore.loading && !fileStore.error}
  restored={skipOpeningAnimation}
  cacheEnabled={page === "dashboard" && !experimentalMode && !onboardingTest}
  skipOpeningAnimation={skipOpeningAnimation}
  suspended={!!(classSetup || selectedAssignment || fileDialog || filePreview || nativeDocumentDialog || syllabusAttachment || syllabusTextCourseId || currentSyllabusDeletion || studyOpen || editor || syllabusDraft)}
  closeControlRef={closeExpandedClassRef}
  canWriteFiles={canWriteFiles}
  profilePending={profilePending}
  getCourse={(courseId) => courseFor(courses, courseId)}
  onCloseStart={clearSavedCourse}
  onClose={() => setSelectedClass(null)}
  onSelectAssignment={setSelectedAssignment}
  onAddAssignment={(course) => {
    setEditor({ taskCourse: course, assignment: { id: uid("assignment"), title: "", courseId: course.id, due: "", dateKey: "", dueTime: "23:59", type: "Assignment", status: "later", progress: 0, description: "", weight: "", notes: "", checklist: [false, false, false] } });
  }}
  onEditCourse={(course, details) => setClassSetup({ course, details, editing: true, profileId: profile.id, generation: workspaceLoadGeneration.current })}
  onViewSchedule={(courseId) => { setCalendarFilter(courseId); navigate("calendar"); }}
  onImportSyllabus={(course) => setSyllabusAttachment({ courseId: course.id, folderId: null, simple: true, session: fileActionSession })}
  onDeleteSyllabus={(course, details) => setSyllabusDeletion({ session: fileActionSession, courseId: course.id, fileId: details.syllabusFileId, file: fileStore.files.find((item) => item.id === details.syllabusFileId) })}
/></CourseEditTransitionContext.Provider>}
      {selectedAssignment && <AssignmentDetailDialog
  assignment={selectedAssignment}
  storedAssignments={storedAssignments}
  today={today}
  courseFor={(courseId) => courseFor(courses, courseId)}
  store={fileStore}
  canWriteFiles={canWriteFiles}
  onClose={() => setSelectedAssignment(null)}
  onAttachFile={(current) => setFileDialog({ defaults: { courseId: current.courseId, assignmentId: current.id, kind: "attachment" } })}
  onOpenFile={setFilePreview}
  onEditFile={(initial) => setFileDialog({ initial })}
  onFileTrashed={handleLegacyTrashed}
  onEditAssignment={(current) => { setEditor({ assignment: current }); setSelectedAssignment(null); }}
  onToggleComplete={toggleAssignmentComplete}
  onDeleteAssignment={(current) => {
    if (commitAcademic(courses, { assignments: storedAssignments.filter((item) => item.id !== current.id) })) setSelectedAssignment(null);
  }}
/>}
      <WorkspaceAcademicDialogs
        classChoicePresence={{ key: `class-choice:${initialProfile.id}:${reloadAttempt}:${experimentalMode ?? "account"}`, animateExit: !classSetup && !syllabusDraft && !profilePending && !experimentalRestoring }}
        classChoice={addClassOpen ? { choiceRef: addClassChoiceRef, onClose: () => setAddClassOpen(false), onImportSyllabus: newReview, onManualEntry: () => transitionClassChoice((initialBounds) => { setClassSetup({ course: emptyCourse(uid("course")), profileId: profile.id, generation: workspaceLoadGeneration.current, initialBounds }); setAddClassOpen(false); }) } : undefined}
        classSetupPresence={{ key: `class-setup:${initialProfile.id}:${reloadAttempt}:${experimentalMode ?? "account"}`, animateExit: !profilePending && !experimentalRestoring }}
        classSetup={classSetupDialog()}
        academicEditor={editor ? { key: (editor.course ?? editor.assignment ?? editor.event)!.id, props: {
          initial: editor,
          courses: courses,
          today: today,
          onApply: applyEditor,
          onClose: () => setEditor(null),
          onDelete: editor.course && courses.some((c) => c.id === editor.course!.id) ? () => removeClass(editor.course!) : editor.assignment && storedAssignments.some((a) => a.id === editor.assignment!.id) ? () => { if (window.confirm("Delete this assignment and its notes?")) { if (commitAcademic(courses, { assignments: storedAssignments.filter((a) => a.id !== editor.assignment!.id) })) setEditor(null); } } : editor.event && manualEvents.some((e) => e.id === editor.event!.id) ? () => { if (window.confirm("Delete this event?")) { if (commitAcademic(courses, { manualEvents: manualEvents.filter((e) => e.id !== editor.event!.id) })) setEditor(null); } } : undefined
        } } : undefined}
        syllabusReviewPresence={{ key: `syllabus-review:${initialProfile.id}:${reloadAttempt}:${experimentalMode ?? "account"}`, animateExit: !profilePending && !experimentalRestoring }}
        syllabusReview={syllabusDraft ? { key: syllabusDraft.id, props: {
          draft: syllabusDraft,
          onUpload: () => setFileDialog({ defaults: { kind: "syllabus" }, reviewId: syllabusDraft.id }),
          onFile: () => { const file = fileStore.files.find((f) => f.id === syllabusDraft.sourceFileId); if (file) { setSyllabusPreviewFileId(file.id); setFilePreview(file); } else flash("Refresh Files to load this saved source."); },
          onChange: setSyllabusDraft,
          onApprove: () => approveReview(syllabusDraft),
          onClose: () => { if (window.confirm("Discard this unsaved syllabus review? Reviews are not saved for later.")) setSyllabusDraft(null); },
          onDelete: () => { if (window.confirm("Discard this syllabus review and its source text?")) setSyllabusDraft(null); }
        } } : undefined}
        courseSyllabusUpload={syllabusAttachment && syllabusAttachmentCourse && syllabusAttachment.simple && syllabusAttachment.session === fileActionSession ? { key: `${initialProfile.id}:${fileActionSession.generation}:${syllabusAttachmentCourse.id}`, props: {
          session: fileActionSession,
          course: syllabusAttachmentCourse,
          store: fileStore,
          canWrite: !experimentalMode && saveState.ready && !profilePending && !undoBusy && !organizationState && !nativeDocumentDialog,
          onSave: (value) => { if (fileActionSessionRef.current !== syllabusAttachment.session) return Promise.reject(new Error("The account session changed. Reopen the syllabus import.")); return saveCourseSyllabus(syllabusAttachmentCourse.id, value); },
          onClose: () => setSyllabusAttachment(null)
        } } : undefined}
        syllabusAttachment={syllabusAttachment && syllabusAttachmentCourse && !syllabusAttachment.simple ? { key: syllabusAttachmentCourse.id, props: {
          courseId: syllabusAttachmentCourse.id,
          course: syllabusAttachmentCourse,
          details: extraData.courseDetails[syllabusAttachmentCourse.id] ?? emptyCourseDetails(),
          folderId: syllabusAttachment.folderId,
          store: fileStore,
          canWrite: canWriteFiles,
          onSave: (value) => saveCourseSyllabus(syllabusAttachmentCourse.id, value),
          onClose: () => setSyllabusAttachment(null)
        } } : undefined}
        deleteSyllabus={currentSyllabusDeletion ? { key: `${initialProfile.id}:${fileActionSession.generation}:${currentSyllabusDeletion.courseId}`, props: {
          profileId: initialProfile.id,
          file: currentSyllabusDeletion.file,
          fileId: currentSyllabusDeletion.fileId,
          canWrite: !experimentalMode && saveState.ready && !profilePending && !undoBusy && !organizationState && !nativeDocumentDialog,
          onDetach: () => saveCourseSyllabus(currentSyllabusDeletion.courseId, { syllabusText: "", syllabusName: "" }, true),
          onRefresh: async (signal) => { await refreshFiles(signal, true); if (!signal.aborted) setFilesDataRevision((revision) => revision + 1); },
          onDeleted: () => { setSyllabusDeletion(null); flash("Syllabus deleted"); },
          onClose: () => setSyllabusDeletion(null)
        } } : undefined}
        syllabusTextPreview={syllabusTextCourse ? { key: syllabusTextCourse.id, props: {
          course: syllabusTextCourse,
          text: extraData.courseDetails[syllabusTextCourse.id]?.syllabusText ?? "",
          name: extraData.courseDetails[syllabusTextCourse.id]?.syllabusName ?? syllabusTextCourse.code + " syllabus",
          onClose: () => setSyllabusTextCourseId(null)
        } } : undefined}
      />
      <WorkspaceFileDialogs
        nativeDocument={nativeDocumentDialog ? { key: nativeDocumentDialog.file?.id ?? nativeDocumentDialog.create!.id, props: {
          profileId: initialProfile.id,
          file: nativeDocumentDialog.file,
          create: nativeDocumentDialog.create,
          canWrite: !nativeDocumentDialog.readOnly && !experimentalMode && saveState.ready && !profilePending,
          onSaved: handleNativeDocumentSaved,
          onClose: closeNativeDocument,
          onDraftChange: handleNativeDocumentDraft
        } } : undefined}
        fileEditor={fileDialog ? { key: fileDialog.initial?.id ?? fileDialog.reviewId ?? "new-file", props: {
          store: fileStore,
          courses: courses,
          assignments: assignments,
          initial: fileDialog.initial,
          defaults: fileDialog.defaults,
          canWrite: canWriteFiles,
          onClose: () => setFileDialog(null),
          onSaved: (file) => { if (fileDialog.initial?.state === "ready") handleFileOpened(file); if (fileDialog.reviewId) setSyllabusDraft((current) => current && current.id === fileDialog.reviewId ? { ...current, sourceFileId: file.id, sourceName: file.name } : current); }
        } } : undefined}
        filePreview={filePreview ? { key: `${initialProfile.id}-${fileActionSession.generation}-${filePreview.id}`, props: {
          file: fileStore.files.find((f) => f.id === filePreview.id) ?? filePreview,
          store: fileStore,
          onOpened: handleFileOpened,
          onClose: () => { setFilePreview(null); setFilePreviewReadOnly(false); setSyllabusPreviewFileId(null); },
          canWrite: canWriteFiles && !filePreviewReadOnly,
          onEdit: () => { setFileDialog({ initial: fileStore.files.find((f) => f.id === filePreview.id) ?? filePreview }); setFilePreview(null); setSyllabusPreviewFileId(null); },
          onReview: syllabusPreviewFileId === filePreview.id ? undefined : (file, text) => { createReview(file, text); setFilePreview(null); }
        } } : undefined}
        fileUpload={uploadDialog ? { key: `${uploadDialog.profileId}:${uploadDialog.generation}:${uploadDialog.mode ?? "files"}`, props: {
          queue: fileUploads,
          currentProfileId: initialProfile.id,
          currentSessionGeneration: fileActionSession.generation,
          defaults: uploadDialog,
          initialFiles: uploadDialog.initialFiles,
          confirmUploads: pendingUploadConfirmationPreference?.profileId === initialProfile.id && pendingUploadConfirmationPreference.generation === fileActionSession.generation ? pendingUploadConfirmationPreference.confirmUploads || pendingUploadConfirmationPreference.previousConfirmUploads : extraData.filePreferences.confirmUploads !== false,
          onConfirmUploadsChange: (confirmUploads) => {
          if (uploadDialog.profileId !== initialProfile.id || uploadDialog.generation !== fileActionSession.generation || !canWriteFiles || profilePending || organizationState || nativeDocumentDialog) return;
          setPendingUploadConfirmationPreference({ profileId: initialProfile.id, generation: fileActionSession.generation, confirmUploads, previousConfirmUploads: extraData.filePreferences.confirmUploads !== false, phase: "queued" });
        },
          mode: pendingFolderUpload ? "folder" : uploadDialog.mode,
          courses: courses,
          changeToken: fileStore.files,
          folderUpload: pendingFolderUpload,
          onFolderUploadChange: setPendingFolderUpload,
          canWrite: uploadDialog.profileId === initialProfile.id && canWriteFiles && !profilePending && !organizationState && !nativeDocumentDialog,
          onClose: () => setUploadDialog(null)
        } } : undefined}
      />
      <div className="toast-stack">
        <SaveToast active={(fileUploads.rows.length > 0 || !!pendingFolderUpload) && !uploadDialog} title={pendingFolderUpload ? "Folder upload needs attention" : fileUploads.busy ? "Uploading files…" : fileUploads.dirty ? "Uploads need attention" : "Uploads complete"} message={pendingFolderUpload ? "Your selected folder and created folder IDs are retained for retry." : "Review individual results or retry retained selections."} loading={fileUploads.busy || pendingFolderUpload?.status === "creating"}>
          <button type="button" onClick={() => setUploadDialog({ profileId: pendingFolderUpload?.profileId ?? initialProfile.id, folderId: pendingFolderUpload?.folderId ?? null, courseId: pendingFolderUpload?.courseId ?? "", generation: pendingFolderUpload?.sessionGeneration ?? fileActionSession.generation, mode: pendingFolderUpload ? "folder" : "files" })}>Review uploads</button>
        </SaveToast>
        <SaveToast
          active={showWorkspaceToast}
          title={workspaceToastTitle}
          message={workspaceToastMessage}
          error={workspaceError}
          loading={workspaceToastLoading}
        >
          {renderWorkspaceRecoveryActions()}
        </SaveToast>
        <SaveToast
          active={!experimentalMode && (Boolean(fileStore.error) || fileStore.busy)}
          title={fileStore.error ? "Couldn't update private files" : "Saving private files…"}
          message={fileStore.error || undefined}
          error={Boolean(fileStore.error)}
          loading={!fileStore.error && fileStore.busy}
        >
          {fileStore.error && <><button type="button" onClick={() => void fileStore.refresh()} disabled={fileStore.busy}>Reload files</button><a href="/login" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a></>}
        </SaveToast>
        <SaveToast active={!!currentTrashUndo} title={undoBusy ? "Restoring from Trash…" : currentTrashUndo?.error ? "Couldn't restore from Trash" : `${currentTrashUndo?.receipt.label ?? "Item"} moved to Trash`} message={currentTrashUndo?.error || "Undo restores the saved location and keeps class and assignment links."} error={!!currentTrashUndo?.error} loading={undoBusy}>
          <button type="button" disabled={!canWriteFiles || profilePending || !!organizationState || !!nativeDocumentDialog || fileStore.busy} onClick={() => void undoTrash()}>{currentTrashUndo?.restored ? "Retry Files refresh" : currentTrashUndo?.error ? "Retry Undo" : "Undo"}</button>
          {currentTrashUndo?.error && filesBrowserEnabled && <button type="button" disabled={undoBusy} onClick={() => router.push("/files?view=trash")}>Review Trash</button>}
          <button type="button" disabled={undoBusy} onClick={() => setTrashUndo(null)}>Dismiss Trash notification</button>
        </SaveToast>
        <SaveToast active={!!organizationState && page !== "files"} title="Files changes are still open" message="Return to Files to finish or close the dialog." loading={!!organizationState?.busy}>
          <button type="button" onClick={() => navigate("files")}>Review Files</button>
          <button type="button" onClick={downloadUnsavedWork}>Download current drafts</button>
        </SaveToast>
        <SaveToast active={!!fileActivity.failure} title="Couldn't update Recent" message={fileActivity.failure ? fileActivity.failure.message + (fileActivity.failure.acknowledged ? "" : " Later opens will appear after you retry or dismiss this update.") : undefined} error loading={fileActivity.retrying}>
          <button type="button" disabled={fileActivity.retrying || !!experimentalMode || profilePending || !saveState.ready} onClick={() => void fileActivity.retry()}>{fileActivity.failure?.acknowledged ? "Retry Recent refresh" : "Retry Recent update"}</button>
          <button type="button" disabled={fileActivity.retrying} onClick={fileActivity.dismiss}>Dismiss Recent notification</button>
        </SaveToast>
        {!experimentalMode && persistenceStatus === "saved" && !profilePending && !homeSaveIndicator && <span className="sr-only" role="status">Workspace saved</span>}
        {toast && <div className="toast" role="status"><CheckCircle2 size={17} /> {toast}</div>}
      </div>
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
    const widgetBody: WidgetBodyData = {
      assignments,
      manualEvents,
      courses,
      courseDetails: extraData.courseDetails,
      study,
      stats,
      today,
      now,
      timezone,
      monday,
      activeGpaSystem,
      activeTerm,
      filesCreatedAt: fileStore.files.map((file) => file.created_at),
      experimentalMode: Boolean(experimentalMode),
      miniWeekOffset,
      persistenceStatus,
    };

    const widgetActions: WidgetActions = {
      onNavigate: (destination) => navigate(destination),
      onOpenStudy: () => setStudyOpen(true),
      onAssignment: setSelectedAssignment,
      onEvent: (event) => setEditor({ event }),
      onCourse: setSelectedClass,
      onTimer: controlTimer,
      onOpenDashboardCourse: openDashboardCourse,
      onMiniWeekOffsetChange: (update) => setMiniWeekOffset(update),
      onToggleMenu: (widgetId) => {
        if (openWidgetMenu === widgetId && !closingWidgetMenu) dismissWidgetMenu();
        else {
          setClosingWidgetMenu(false);
          setOpenWidgetMenu(widgetId);
        }
      },
      onOpenResizeMenu: (widgetId) => {
        setClosingWidgetMenu(false);
        setOpenWidgetMenu(widgetId);
      },
      onCloseMenu: closeWidgetMenu,
      onResize: resizeWidget,
      onMove: moveWidget,
      onDuplicate: (widget) => {
        const copy = { ...widget, instanceId: uid("widget") };
        const appearance = extraData.widgetAppearance && {
          ...extraData.widgetAppearance,
          overrides: { ...extraData.widgetAppearance.overrides },
        };
        if (appearance?.overrides[widget.instanceId]) {
          appearance.overrides[copy.instanceId] = { ...appearance.overrides[widget.instanceId] };
        }
        commitWorkspaces(
          workspaces.map((workspace) => workspace.id === activeWorkspaceId
            ? { ...workspace, widgets: [...workspace.widgets, copy] }
            : workspace),
          activeWorkspaceId,
          notes,
          appearance,
        );
        closeWidgetMenu();
      },
      onRemove: removeWidget,
      onNoteChange: (widgetId, value) => updateWorkspaceWidgets((widgets) => widgets.map((widget) =>
        widget.instanceId === widgetId ? { ...widget, note: value } : widget)),
      onSaveNote: () => { void autosave.flush(); },
      onFlash: flash,
    };
    return <WorkspaceHome
      data={{
        greeting: homeGreeting,
        activeWorkspace,
        activeWorkspaceId,
        workspaces,
        notes,
        customizing,
        widgetEditingEnabled,
        widgetGridCanCustomize: !customizing && !appearanceOpen && !widgetPickerOpen && !workspaceDialog
          && !aiApplying && !studyOpen && !editor && !selectedAssignment && !selectedClass
          && !syllabusDraft && !syllabusAttachment && !syllabusTextCourseId && !nativeDocumentDialog,
        workspaceMenuOpen,
        workspaceSaveStatus: persistenceStatus,
        workspaceSaveMessage: saveState.message,
        workspaceError,
        workspacePending,
        saveReady: saveState.ready,
        sidebarCollapsed,
        experimentalMode: Boolean(experimentalMode),
        widgetAppearance: extraData.widgetAppearance,
        todayRemoveDragState,
        dailyPercent,
        localTime,
        widgetBody,
        widgetFrame: { openWidgetMenu, closingWidgetMenu },
      }}
      customizeButtonRef={customizeButtonRef}
      workspaceOptionsButtonRef={workspaceOptionsButtonRef}
      todayOptionsButtonRef={todayOptionsButtonRef}
      todayRemoveTargetRef={todayRemoveTargetRef}
      todayRemoveHitRef={todayRemoveHitRef}
      widgetMenuRef={widgetMenuRef}
      actions={{
        onActiveWorkspaceChange: setActiveWorkspaceId,
        onNewWorkspace: () => { setWorkspaceNameDraft(""); setWorkspaceDialog("new"); },
        onAppearanceOpen: () => setAppearanceOpen(true),
        onCustomizingToggle: () => setCustomizing((value) => !value),
        onWidgetPickerOpen: () => setWidgetPickerOpen(true),
        onWorkspaceMenuToggle: () => setWorkspaceMenuOpen((open) => !open),
        onRenameWorkspace: () => {
          setWorkspaceNameDraft(activeWorkspace.name);
          setWorkspaceDialog("rename");
          setWorkspaceMenuOpen(false);
        },
        onDuplicateWorkspace: duplicateWorkspace,
        onMoveWorkspace: moveWorkspace,
        onDeleteWorkspace: deleteWorkspace,
        onRestoreToday: restoreToday,
        onRecoverNotes: recoverNotes,
        onDownloadRecoveredNotes: () => downloadDraft("eduessentials-recovered-note.json", { note: notes }),
        onResizeWidget: resizeWidget,
        onRemoveWidget: removeWidget,
        onRemoveDragStateChange: (active, over, near) => setTodayRemoveDragState((current) =>
          current.active === active && current.over === over && current.near === near
            ? current
            : { active, over, near }),
        onReorderStart: closeWidgetMenu,
        onFinishCustomize: () => { closeWidgetMenu(); setCustomizing(false); },
        onGridCustomize: () => { closeWidgetMenu(); setCustomizing(true); },
        onReorder: (orderedIds, miniBlockChange) => {
          const currentWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
          if (!currentWorkspace || currentWorkspace.id !== activeWorkspace.id
            || orderedIds.length !== currentWorkspace.widgets.length) return false;
          const widgetsById = new Map(currentWorkspace.widgets.map((widget) => [widget.instanceId, widget]));
          if (new Set(orderedIds).size !== currentWorkspace.widgets.length
            || orderedIds.some((id) => !widgetsById.has(id))) return false;
          if (miniBlockChange && widgetsById.get(miniBlockChange.widgetId)?.size !== "mini") return false;
          return updateWorkspaceWidgets(() => orderedIds.map((id) => {
            const widget = widgetsById.get(id)!;
            if (id !== miniBlockChange?.widgetId) return widget;
            const next = { ...widget };
            delete next.startsNewMiniBlock;
            if (miniBlockChange.startsNewMiniBlock) next.startsNewMiniBlock = true;
            return next;
          }), true);
        },
        onTodayHiddenChange: (hidden) => commitWorkspaces(workspaces.map((workspace) =>
          workspace.id === activeWorkspaceId ? { ...workspace, todayHidden: hidden } : workspace)),
        onTodaySectionsChange: (sections) => commitWorkspaces(workspaces.map((workspace) =>
          workspace.id === activeWorkspaceId ? { ...workspace, todaySections: sections } : workspace)),
        onTodayOptionsOpen: () => { closeWidgetMenu(); setWorkspaceMenuOpen(false); },
        onSelectClass: setSelectedClass,
        onSelectAssignment: setSelectedAssignment,
        onEditEvent: (event) => setEditor({ event }),
        onCalendar: () => navigate("calendar"),
        onStudyOpen: () => setStudyOpen(true),
        onNavigateTasks: () => navigate("tasks"),
      }}
      widgetActions={widgetActions}
      renderStatusBadge={(status, compact) => <StatusBadge status={status} compact={compact} />}
      renderCourseStamp={(course, small) => <CourseStamp course={course} small={small} />}
      recoveryActions={renderWorkspaceRecoveryActions()}
    />;
  }

  function renderCalendar() {
    return <AcademicCalendar courses={courses} assignments={assignments} events={manualEvents} details={extraData.courseDetails} today={today} monday={profile.week_starts_on === "Monday"} timezone={profile.timezone} filter={calendarFilter} onFilter={setCalendarFilter} onAssignment={setSelectedAssignment} onEvent={(event) => setEditor({ event })} onCourse={setSelectedClass} onAdd={newEvent} />;
  }

  function searchResultGroups() {
    return createWorkspaceSearchResultGroups({
  query: searchQuery,
  assignments,
  courses,
  courseDetails: extraData.courseDetails,
  files: fileStore.files,
  events: manualEvents,
  study,
  workspaces,
  onAssignment: setSelectedAssignment,
  onCourse: setSelectedClass,
  onFile: setFilePreview,
  onEvent: (event) => setEditor({ event }),
  onStudyOpen: () => setStudyOpen(true),
  onNote: (workspaceId, widgetInstanceId) => {
    navigate("home");
    setActiveWorkspaceId(workspaceId);
    noteFocusRef.current = widgetInstanceId;
  },
});
  }

  function renderFiles() {
    const storedPreferences = extraData.filePreferences;
    const layoutMigrationPending = filesBrowserEnabled && storedPreferences.appearanceVersion !== FILES_BROWSER_APPEARANCE_VERSION;
    const prefs = filesBrowserEnabled ? migrateFilesBrowserPreferences(storedPreferences) : storedPreferences;
    return <WorkspaceFilesPage
      onPrimaryNavigate={() => setSidebarOpen(false)}
      profileId={initialProfile.id} courses={courses} assignments={storedAssignments} courseDetails={extraData.courseDetails}
      store={fileStore}
      filesBrowserEnabled={filesBrowserEnabled} preferences={prefs} layoutMigrationPending={layoutMigrationPending} currentTerm={profile.current_term ?? ""} onFileOpened={handleFileOpened}
      onPreferencesChange={(filePreferences) => commitAcademic(courses, { filePreferences })}
      onLayoutChange={(view) => commitAcademic(courses, { filePreferences: { ...prefs, view } })}
      onOrganizationSaved={handleOrganizationSaved} onOrganizationStateChange={handleOrganizationState}
      dataRevision={filesDataRevision}
      onTrashCompleted={handleTrashCompleted}
      onUpload={(folderId, courseId) => { if (!organizationState && !nativeDocumentDialog) setUploadDialog({ profileId: initialProfile.id, folderId, courseId, generation: fileActionSession.generation, mode: "files" }); }}
      onUploadFolder={(folderId, courseId) => { if (!organizationState && !nativeDocumentDialog) setUploadDialog({ profileId: initialProfile.id, folderId, courseId, generation: fileActionSession.generation, mode: "folder" }); }}
      onUploadFiles={(files, folderId, courseId) => { if (!organizationState && !nativeDocumentDialog && canWriteFiles && !profilePending) setUploadDialog({ profileId: initialProfile.id, folderId, courseId, generation: fileActionSession.generation, mode: "files", initialFiles: files }); }}
      onNewTextFile={(folderId, courseId, name) => { if (canWriteFiles && !profilePending && !nativeDocumentDialog && !organizationState) setNativeDocumentDialog({ create: { id: crypto.randomUUID(), folderId, courseId, name, body: "" } }); }}
      onOpen={(file, options) => { if (nativeDocumentDialog || organizationState) return; if (file.content_backend === "native-text" && file.state === "ready" && !file.trashed_at) setNativeDocumentDialog({ file, readOnly: options?.readOnly }); else { setFilePreviewReadOnly(!!options?.readOnly); setFilePreview(file); } }}
      onEdit={(initial) => { if (!organizationState) setFileDialog({ initial }); }}
      canWrite={canWriteFiles && !profilePending && !nativeDocumentDialog}
      onAttachSyllabus={(courseId, folderId) => { if (canWriteFiles && !profilePending && !organizationState) setSyllabusAttachment({ courseId, folderId }); }}
      onSyllabusText={setSyllabusTextCourseId}
      onOpenSyllabus={(file) => { setSyllabusPreviewFileId(file.id); setFilePreview(file); }}
      header={renderPageHeader("Resources", "Your private files", "Original files are stored privately with your account.", <button className="primary-button" disabled={!canWriteFiles} onClick={() => setFileDialog({})}>Upload file</button>)}
      fileQuery={fileQuery} onFileQueryChange={setFileQuery} legacyCanWrite={canWriteFiles}
      onRefreshFiles={() => void fileStore.refresh()} onLegacyOpen={setFilePreview} onLegacyEdit={(initial) => setFileDialog({ initial })} onLegacyTrashed={handleLegacyTrashed}
    />;
  }

  function renderSettings() {
    const accountActionBlocked = profilePending || saveState.dirty || fileStore.busy || fileUploads.dirty || fileUploads.busy || !!pendingFolderUpload || !!nativeDocumentDraft?.dirty || !!organizationState?.dirty || !!organizationState?.busy || undoBusy;
    return <WorkspaceSettingsPage profile={profile} accountId={initialProfile.id} header={renderPageHeader("Make it yours", "Settings", "Your profile and preferences follow your Google account.")} accountActionBlocked={accountActionBlocked} onProfileSaved={setProfile} onProfileDraftChange={handleProfileDraft} onDownloadDrafts={downloadUnsavedWork} onExportClick={(event) => { if (accountActionBlocked) event.preventDefault(); }} />;
  }

  function classSetupDialog() {
    if (!classSetup || classSetup.profileId !== initialProfile.id) return undefined;
    const image = classSetup.editing ? courseImages.get(classSetup.course.id) : undefined;
    const syllabus = fileStore.files.find((file) => file.id === classSetup.details?.syllabusFileId && file.kind === "syllabus" && file.state === "ready" && !file.trashed_at);
    return { key: `${classSetup.profileId}:${classSetup.generation}:${classSetup.course.id}`, props: {
          initial: classSetup.course,
          initialDetails: classSetup.details,
          editing: classSetup.editing,
          savedImageId: image?.id,
          savedImageUrl: image ? fileStore.url(image) : undefined,
          savedSyllabusPreview: syllabus ? <InlineFilePreview file={syllabus} store={fileStore} /> : undefined,
          initialBounds: classSetup.initialBounds,
          today: today,
          canUpload: canWriteFiles,
          onSave: saveClassSetup,
          onClose: () => setClassSetup(null),
          onDelete: classSetup.editing ? () => removeClass(classSetup.course) : undefined
        } };
  }

}
