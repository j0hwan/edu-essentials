import { createElement, Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";
import Workspace from "../../app/workspace-client";
import { encodeWorkspaceState } from "../../lib/workspace-codec";
import { validateProfile } from "../../lib/profile";
import { calculateWidgetPlacements } from "../../lib/widget-layout";
import { reorderWidgetIds } from "../../lib/widget-reorder";

const longNote = Array.from({ length: 180 }, (_, index) => `Browser-only notes fixture line ${String(index + 1).padStart(3, "0")}. The current textarea scroll position should follow the lifted widget.`).join("\n");
const compactWidgets = [
  { instanceId: "notes-main", type: "notes" as const, size: "medium" as const, note: longNote },
  { instanceId: "timer-main", type: "pomodoro" as const, size: "small" as const },
  { instanceId: "mini-calendar-main", type: "mini-calendar" as const, size: "mini" as const },
  { instanceId: "quote-main", type: "quote" as const, size: "mini" as const },
  { instanceId: "upcoming-main", type: "upcoming" as const, size: "medium-vertical" as const },
  { instanceId: "stoplight-main", type: "stoplight" as const, size: "small" as const },
  { instanceId: "spacer-main", type: "spacer" as const, size: "large" as const },
];
const longWidgets = Array.from({ length: 18 }, (_, index) => ({
  ...compactWidgets[index % compactWidgets.length],
  instanceId: `${compactWidgets[index % compactWidgets.length].instanceId}-${index}`,
}));
const widgets = location.search.includes("long=1") ? longWidgets : compactWidgets;
const initialDashboard = encodeWorkspaceState([{ id: "fixture-day", name: "Fixture day", widgets }], "fixture-day", "");
const updatedAt = "2026-10-06T00:00:00.000Z";
const profile = {
  ...validateProfile({ display_name: "Browser fixture" }),
  id: "browser-fixture-profile",
  auth_user_id: "browser-fixture-user",
  email: "fixture@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: updatedAt,
  onboarding_completed_at: updatedAt,
};

let dashboard = initialDashboard;
let revision = updatedAt;
const writes: Array<{ dashboard: typeof initialDashboard; revision: string }> = [];
const pointerTypes: string[] = [];
const pointerEvents: Array<{ type: string; id: number; x: number; y: number; target: string }> = [];
const requestOriginal = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("/api/files")) return Response.json({ files: [] });
  if (init?.method === "PUT") {
    const body = JSON.parse(String(init.body)) as { dashboard: typeof initialDashboard };
    dashboard = body.dashboard;
    revision = new Date(Date.parse(revision) + 1000).toISOString();
    writes.push({ dashboard: structuredClone(dashboard), revision });
    return Response.json({ ok: true, revision });
  }
  return Response.json({ initialized: true, courses: [], dashboard, revision, profile });
};

function TrackPointers() {
  useEffect(() => {
    const track = (event: PointerEvent) => pointerTypes.push(event.pointerType);
    const trackDetails = (event: PointerEvent) => pointerEvents.push({
      type: event.type,
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: (event.target as HTMLElement)?.outerHTML?.slice(0, 180) ?? "",
    });
    window.addEventListener("pointerdown", track, true);
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) window.addEventListener(type, trackDetails, true);
    return () => {
      window.removeEventListener("pointerdown", track, true);
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) window.removeEventListener(type, trackDetails, true);
    };
  }, []);
  return null;
}

declare global {
  interface Window {
    __widgetFixture: {
      pointerTypes: string[];
      pointerEvents: typeof pointerEvents;
      get writes(): number;
      get dashboard(): typeof initialDashboard;
      get widgetIds(): string[];
      get noteLength(): number;
      setTextareaScrollToEnd(): { before: number; scrollHeight: number; clientHeight: number };
      targetFor(draggedId: string, destinationIndex: number, grabOffsetX: number, grabOffsetY: number): { x: number; y: number; candidate: string[] };
    };
  }
}

window.__widgetFixture = {
  pointerTypes,
  pointerEvents,
  get writes() { return writes.length; },
  get dashboard() { return structuredClone(dashboard); },
  get widgetIds() { return widgets.map((widget) => widget.instanceId); },
  get noteLength() { return longNote.length; },
  setTextareaScrollToEnd() {
    const textarea = document.querySelector<HTMLTextAreaElement>('.widget-grid [data-widget-id^="notes-main"] textarea');
    if (!textarea) throw new Error("The fixture notes textarea did not render.");
    textarea.scrollTop = textarea.scrollHeight;
    return { before: textarea.scrollTop, scrollHeight: textarea.scrollHeight, clientHeight: textarea.clientHeight };
  },
  targetFor(draggedId, destinationIndex, grabOffsetX, grabOffsetY) {
    const grid = document.querySelector<HTMLElement>(".widget-grid");
    if (!grid) throw new Error("The fixture widget grid did not render.");
    const ids = [...grid.querySelectorAll<HTMLElement>(":scope > [data-widget-id]")].map((card) => card.dataset.widgetId!);
    const sizes = Object.fromEntries([...grid.querySelectorAll<HTMLElement>(":scope > [data-widget-id]")].map((card) => [card.dataset.widgetId!, card.dataset.size ?? "small"]));
    const candidate = reorderWidgetIds(ids, draggedId, destinationIndex);
    const orderedSizes = candidate.map((id) => sizes[id] ?? "small");
    const placement = calculateWidgetPlacements(orderedSizes, window.innerWidth <= 600 ? 2 : 4)[candidate.indexOf(draggedId)];
    const rect = grid.getBoundingClientRect();
    const style = window.getComputedStyle(grid);
    const columns = window.innerWidth <= 600 ? 2 : 4;
    const gap = Number.parseFloat(style.columnGap) || 16;
    const unit = Number.parseFloat(style.getPropertyValue("--widget-unit")) || (rect.width - gap * (columns - 1)) / columns;
    const rowUnit = (unit - gap) / 2;
    return {
      x: rect.left + (placement.column - 1) * (unit + gap) + grabOffsetX,
      y: rect.top + (placement.row - 1) * (rowUnit + gap) + grabOffsetY,
      candidate,
    };
  },
};

const root = createRoot(document.getElementById("root")!);
root.render(createElement(Fragment, null, createElement(TrackPointers), createElement(Workspace, { initialProfile: profile })));
window.addEventListener("pagehide", () => {
  root.unmount();
  globalThis.fetch = requestOriginal;
}, { once: true });
