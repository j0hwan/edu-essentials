import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { experimentalData } = await import(await clientModule("lib/experimental-data.ts"));
const { academicSnapshot } = await import(await clientModule("lib/academic-snapshot.ts"));
const { encodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));

const expected = {
  clear: { courses: 0, assignments: 0, events: 0, sessions: 0, grades: 0, workspaces: 1 },
  light: { courses: 2, assignments: 6, events: 3, sessions: 2, grades: 2, workspaces: 1 },
  medium: { courses: 4, assignments: 14, events: 7, sessions: 5, grades: 4, workspaces: 2 },
  packed: { courses: 6, assignments: 28, events: 14, sessions: 10, grades: 6, workspaces: 3 },
};

for (const [density, counts] of Object.entries(expected)) {
  test(`${density} experimental data is deterministic and valid`, () => {
    const first = experimentalData(density, "2026-09-10");
    const second = experimentalData(density, "2026-09-10");
    assert.deepEqual(first, second);
    assert.equal(first.courses.length, counts.courses);
    assert.equal(first.assignments.length, counts.assignments);
    assert.equal(first.manualEvents.length, counts.events);
    assert.equal(first.study.sessions.length, counts.sessions);
    assert.equal(first.study.grades.length, counts.grades);
    assert.equal(first.workspaces.length, counts.workspaces);

    const dashboard = encodeWorkspaceState(first.workspaces, first.activeWorkspaceId, first.notes, {
      assignments: first.assignments,
      manualEvents: first.manualEvents,
      dashboardView: "cards",
      calendarView: "month",
      calendarFilter: "all",
      courseDetails: first.courseDetails,
      syllabusDrafts: [],
      study: first.study,
      filePreferences: { filter: "all", view: "list" },
    });
    const snapshot = academicSnapshot(first.courses, dashboard);
    assert.equal(snapshot.courses.length, counts.courses);
    assert.equal(new Set(first.assignments.map((item) => item.id)).size, counts.assignments);
    assert.equal(new Set(first.manualEvents.map((item) => item.id)).size, counts.events);
  });
}
