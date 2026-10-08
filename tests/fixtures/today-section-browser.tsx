import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Workspace from "../../app/workspace-client";
import { encodeWorkspaceState, type CompactWorkspaceState } from "../../lib/workspace-codec";
import { validateProfile } from "../../lib/profile";
import type { Course } from "../../lib/academics";

const storageKey = "today-section-browser-state";
const profile = {
  ...validateProfile({ display_name: "Browser Student", major: "History", study_goal: "Read every day" }),
  id: "today-browser-profile",
  auth_user_id: "today-browser-user",
  email: "fixture@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: "2026-10-06T00:00:00.000Z",
  onboarding_completed_at: "2026-10-05T00:00:00.000Z",
};
const initialDashboard = encodeWorkspaceState([
  { id: "browser-day", name: "Browser day", widgets: [
    { instanceId: "browser-notes", type: "notes", size: "large", note: "Browser fixture note" },
    { instanceId: "browser-glance", type: "today", size: "large" },
  ] },
], "browser-day", "", { assignments: [], manualEvents: [], dashboardView: "cards" });
const initialState = {
  dashboard: initialDashboard,
  courses: [] as Course[],
  profile,
  revision: profile.updated_at,
  writes: 0,
};
type FixtureState = typeof initialState;
type FixtureApi = {
  readonly dashboard: CompactWorkspaceState;
  readonly courses: Course[];
  readonly writes: number;
  readonly revision: string;
};
declare global {
  interface Window { __todayFixture: FixtureApi; }
}
const stored = sessionStorage.getItem(storageKey);
const state: FixtureState = stored ? JSON.parse(stored) as FixtureState : initialState;
if (!stored) sessionStorage.setItem(storageKey, JSON.stringify(state));

function saveState() {
  sessionStorage.setItem(storageKey, JSON.stringify(state));
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/api/files")) return Response.json({ files: [] });
  if (init?.method === "PUT") {
    const body = JSON.parse(String(init.body)) as { baseRevision: string; dashboard: CompactWorkspaceState; courses: Course[] };
    if (body.baseRevision !== state.revision) return Response.json({}, { status: 409 });
    state.dashboard = body.dashboard;
    state.courses = body.courses;
    state.revision = new Date(Date.parse(state.revision) + 1000).toISOString();
    state.writes++;
    saveState();
    return Response.json({ ok: true, revision: state.revision });
  }
  if (init?.method === "POST") return Response.json({ initialized: true, revision: state.revision });
  return Response.json({ initialized: true, ...state });
};

window.confirm = () => true;
window.alert = () => {};
window.scrollTo = () => {};
window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
(window.__todayFixture) = {
  get dashboard() { return state.dashboard; },
  get courses() { return state.courses; },
  get writes() { return state.writes; },
  get revision() { return state.revision; },
};

const rootNode = document.getElementById("root");
if (!rootNode) throw new Error("Missing browser fixture root");
createRoot(rootNode).render(createElement(Workspace, { initialProfile: profile }));
