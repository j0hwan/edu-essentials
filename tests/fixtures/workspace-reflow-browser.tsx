import { createRoot } from "react-dom/client";
import Workspace from "../../app/workspace-client";
import { validateProfile } from "../../lib/profile";
import { encodeWorkspaceState, type WidgetType } from "../../lib/workspace-codec";

const profile = {
  ...validateProfile({ display_name: "Reflow Preview", major: "History" }),
  id: "reflow-preview",
  auth_user_id: "reflow-preview-user",
  email: "reflow@example.invalid",
  avatar_url: null,
  initialized: true,
  updated_at: "2026-10-25T00:00:00.000Z",
  onboarding_completed_at: "2026-10-24T00:00:00.000Z",
};
const courses = Array.from({ length: 5 }, (_, index) => ({
  id: `course-${index}`,
  code: `HIST ${201 + index}`,
  name: ["World History", "Literature", "Chemistry", "Mathematics", "Art History"][index],
  credits: 3,
  instructor: "Dr. Rivera",
  room: "Room 12",
  color: "#5b63e8",
  soft: "#eef0ff",
  initials: "WH",
}));
const types: WidgetType[] = ["daily-goal", "weekly-goal", "notes", "pomodoro", "gpa", "quote", "mini-calendar", "class-links"];
const dashboard = encodeWorkspaceState(
  [{ id: "reflow", name: "Day", widgets: types.map((type, index) => ({ instanceId: `widget-${index}`, type, size: "medium" })) }],
  "reflow",
  "Study notes for the next seminar.",
  {
    assignments: courses.map((course, index) => ({
      id: `assignment-${index}`, courseId: course.id, title: "Prepare seminar notes",
      description: "Read the next chapter.", dateKey: "2026-10-24", due: "Oct 24, 2026",
      status: "overdue", weight: "10%", progress: 0, type: "Assignment",
    })),
    manualEvents: [], dashboardView: "cards",
  },
);

window.localStorage.removeItem("edu-sidebar-collapsed");
window.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith("/api/files")) return Response.json({ files: [] });
  if (url.startsWith("/api/workspace")) {
    if (init.method === "PUT") return Response.json({ ok: true, revision: profile.updated_at });
    return Response.json({ initialized: true, courses, dashboard, revision: profile.updated_at, profile });
  }
  return Response.json({});
};

createRoot(document.getElementById("root")!).render(<Workspace initialProfile={profile} />);
