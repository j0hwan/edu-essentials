import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Workspace from "../../app/workspace-client";
import { encodeWorkspaceState, type CompactWorkspaceState } from "../../lib/workspace-codec";
import { defaultPreferences, validateProfile } from "../../lib/profile";
import { defaultWidgetAppearance } from "../../lib/widget-appearance";
import type { Course } from "../../lib/academics";
import type { HomeSkeletonPresetId } from "../../lib/home-skeleton";

const query = new URLSearchParams(window.location.search);
const nextPresetKey = "home-skeleton-next-preset";
const reloadedPreset = sessionStorage.getItem(nextPresetKey);
if (reloadedPreset) sessionStorage.removeItem(nextPresetKey);
const preset = (reloadedPreset ?? query.get("preset") ?? "study-overview") as HomeSkeletonPresetId;
const scenario = query.get("scenario") ?? "default";
const revision = "2026-10-08T12:00:00.000Z";
const reducedMotion = query.get("accountReduced") === "true";
const profile = {
  ...validateProfile({
    display_name: "Browser Student",
    major: "History",
    preferences: { ...defaultPreferences, theme: "dark", reducedMotion },
  }),
  id: "home-skeleton-browser-profile",
  auth_user_id: "home-skeleton-browser-user",
  email: "fixture@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: revision,
  onboarding_completed_at: "2026-10-07T00:00:00.000Z",
};
const widgets = scenario === "empty" || scenario === "empty-hidden" ? [] : scenario === "count-mismatch" ? [
  { instanceId: "saved-notes", type: "notes" as const, size: "large" as const, note: "Saved browser note" },
  { instanceId: "saved-upcoming", type: "upcoming" as const, size: "medium" as const },
  { instanceId: "saved-mini", type: "daily-goal" as const, size: "mini" as const, startsNewMiniBlock: true },
] : scenario === "mini-blocks" ? [
  { instanceId: "saved-mini-a", type: "daily-goal" as const, size: "mini" as const },
  { instanceId: "saved-mini-b", type: "upcoming" as const, size: "mini" as const, startsNewMiniBlock: true },
  { instanceId: "saved-mini-c", type: "weekly-goal" as const, size: "mini" as const },
  { instanceId: "saved-notes", type: "notes" as const, size: "medium" as const, note: "Saved browser note" },
] : [
  { instanceId: "saved-notes", type: "notes" as const, size: "large" as const, note: "Saved browser note" },
  { instanceId: "saved-upcoming", type: "upcoming" as const, size: "medium" as const },
  { instanceId: "saved-mini-a", type: "daily-goal" as const, size: "mini" as const },
  { instanceId: "saved-mini-b", type: "weekly-goal" as const, size: "mini" as const, startsNewMiniBlock: true },
];
const dashboard = encodeWorkspaceState([
  {
    id: "saved-home",
    name: "Saved Home",
    widgets,
    ...(scenario === "today-hidden" || scenario === "empty-hidden" ? { todayHidden: true } : {}),
  },
], "saved-home", "", {
  assignments: [], manualEvents: [], dashboardView: "cards",
  ...(scenario === "appearance" ? {
    widgetAppearance: {
      defaults: { ...defaultWidgetAppearance, gap: 28, minHeight: 300, padding: 24, borderWidth: 2 },
      overrides: { "saved-upcoming": { minHeight: 240, padding: 20 } },
    },
  } : {}),
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
let heldReads = query.get("hold") === "true";
let failuresRemaining = query.get("failFirst") === "true" ? 1 : 0;

const fixture = {
  get getCalls() { return getCalls; },
  get writes() { return writes; },
  get pendingReads() { return pendingReads.length; },
  get preset() { return preset; },
  get scenario() { return scenario; },
  setPresetForReload(value: HomeSkeletonPresetId) { sessionStorage.setItem(nextPresetKey, value); },
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
  if (init?.method === "POST") return Response.json({ initialized: true, revision });

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
createRoot(rootNode).render(createElement(Workspace, { initialProfile: profile, initialHomeSkeletonPreset: preset }));
