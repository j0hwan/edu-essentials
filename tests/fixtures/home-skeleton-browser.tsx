import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Workspace from "../../app/workspace-client";
import { encodeWorkspaceState, type CompactWorkspaceState, type Workspace as HomeWorkspace } from "../../lib/workspace-codec";
import { defaultPreferences, validateProfile } from "../../lib/profile";
import { defaultWidgetAppearance } from "../../lib/widget-appearance";
import type { Course } from "../../lib/academics";

const query = new URLSearchParams(window.location.search);
const scenario = query.get("scenario") ?? "matching";
const accountId = query.get("account") ?? "home-skeleton-browser-profile";
const revision = "2026-10-08T12:00:00.000Z";
const reducedMotion = query.get("accountReduced") === "true";
const profile = {
  ...validateProfile({
    display_name: "Browser Student",
    major: "History",
    preferences: { ...defaultPreferences, theme: "dark", reducedMotion },
  }),
  id: accountId,
  auth_user_id: `auth-${accountId}`,
  email: "fixture@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: revision,
  onboarding_completed_at: "2026-10-07T00:00:00.000Z",
};

const geometryWidgets = [
  { instanceId: "geo-small", type: "notes" as const, size: "small" as const, note: "Saved browser note" },
  { instanceId: "geo-mini-a", type: "daily-goal" as const, size: "mini" as const },
  { instanceId: "geo-mini-b", type: "upcoming" as const, size: "mini" as const, startsNewMiniBlock: true },
  { instanceId: "geo-medium", type: "task-completion" as const, size: "medium" as const },
];
const mismatchWidgets = [
  { instanceId: "server-large", type: "notes" as const, size: "large" as const, note: "Server browser note" },
  { instanceId: "server-small", type: "pomodoro" as const, size: "small" as const },
];
const workspaceSets: Record<string, { workspaces: HomeWorkspace[]; activeWorkspaceId: string; gap: number }> = {
  matching: {
    workspaces: [{ id: "saved-home", name: "Saved Home", widgets: geometryWidgets, todayHidden: true }],
    activeWorkspaceId: "saved-home",
    gap: 28,
  },
  geometry: {
    workspaces: [{ id: "saved-home", name: "Saved Home", widgets: geometryWidgets, todayHidden: true }],
    activeWorkspaceId: "saved-home",
    gap: 28,
  },
  "geometry-visible": {
    workspaces: [{ id: "saved-home", name: "Saved Home", widgets: geometryWidgets, todayHidden: false }],
    activeWorkspaceId: "saved-home",
    gap: 28,
  },
  "geometry-one-section": {
    workspaces: [{ id: "saved-home", name: "Saved Home", widgets: geometryWidgets, todayHidden: false, todaySections: ["next-class"] }],
    activeWorkspaceId: "saved-home",
    gap: 28,
  },
  "geometry-two-sections": {
    workspaces: [{ id: "saved-home", name: "Saved Home", widgets: geometryWidgets, todayHidden: false, todaySections: ["next-class", "due-today"] }],
    activeWorkspaceId: "saved-home",
    gap: 28,
  },
  mismatch: {
    workspaces: [{ id: "saved-home", name: "Saved Home", widgets: mismatchWidgets, todayHidden: false }],
    activeWorkspaceId: "saved-home",
    gap: 24,
  },
  "workspace-switch": {
    workspaces: [
      { id: "saved-home", name: "Saved Home", widgets: geometryWidgets, todayHidden: false },
      { id: "secondary-home", name: "Secondary", widgets: [{ instanceId: "secondary-note", type: "notes", size: "large", note: "Secondary note" }], todayHidden: true },
    ],
    activeWorkspaceId: "saved-home",
    gap: 28,
  },
};
const selected = workspaceSets[scenario] ?? workspaceSets.matching;
const dashboard = encodeWorkspaceState(selected.workspaces, selected.activeWorkspaceId, "", {
  assignments: [],
  manualEvents: [],
  dashboardView: "cards",
  widgetAppearance: { defaults: { ...defaultWidgetAppearance, gap: selected.gap }, overrides: {} },
});

type SavedResponse = {
  initialized: true;
  courses: Course[];
  dashboard: CompactWorkspaceState;
  profile: typeof profile;
  revision: string;
};
const savedResponse = (): SavedResponse => ({ initialized: true, courses: [], dashboard, profile, revision });
const pendingReads: ((response: Response) => void)[] = [];
let getCalls = 0;
let writes = 0;
let posts = 0;
let heldReads = query.get("hold") === "true";
let failuresRemaining = query.get("failFirst") === "true" ? 1 : 0;

const fixture = {
  get getCalls() { return getCalls; },
  get writes() { return writes; },
  get posts() { return posts; },
  get pendingReads() { return pendingReads.length; },
  get accountId() { return accountId; },
  get scenario() { return scenario; },
  setHoldReads(value: boolean) { heldReads = value; },
  failNextRead() { failuresRemaining++; },
  releaseNextSuccess() {
    const release = pendingReads.shift();
    if (release) release(Response.json(savedResponse()));
  },
};

declare global {
  interface Window { __homeSkeletonFixture: typeof fixture; }
}
window.__homeSkeletonFixture = fixture;

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/api/files")) return Response.json({ files: [] });
  if (!url.startsWith("/api/workspace")) throw new Error(`Unexpected fixture request: ${url}`);

  if (init?.method === "PUT") {
    writes++;
    return Response.json({ ok: true, revision: new Date(Date.parse(revision) + writes * 1000).toISOString() });
  }
  if (init?.method === "POST") {
    posts++;
    return Response.json({ initialized: true, revision });
  }

  getCalls++;
  if (failuresRemaining > 0) {
    failuresRemaining--;
    return Response.json({ error: "Fixture workspace read failed" }, { status: 503 });
  }
  if (heldReads) return await new Promise<Response>((resolve) => pendingReads.push(resolve));
  return Response.json(savedResponse());
};

window.confirm = () => true;
window.alert = () => {};
window.scrollTo = () => {};
window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

const rootNode = document.getElementById("root");
if (!rootNode) throw new Error("Missing browser fixture root");
createRoot(rootNode).render(createElement(Workspace, { initialProfile: profile }));
