import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "Element", "HTMLElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DeleteSyllabusDialog } = await import(await clientModule("app/delete-syllabus-dialog.tsx"));
const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = {
  id: "11111111-1111-4111-8111-111111111111", name: "Syllabus.pdf", mime_type: "application/pdf", size_bytes: 12,
  course_id: "history", assignment_id: null, kind: "syllabus", state: "ready", content_backend: "object",
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", content_sha256: null,
  folder_id: null, metadata_revision: 4, content_revision: 1, trashed_at: null, trash_operation_id: null, original_folder_id: null,
};
const trashed = { ...source, metadata_revision: 5, trashed_at: "2026-10-27T00:00:00.000Z", trash_operation_id: "22222222-2222-4222-8222-222222222222" };
const host = document.getElementById("root");
let root, events, requests, failures, detached, deleted, closed, activeFile, trashFiles, trashResult;
async function mount(overrides = {}) {
  events = []; requests = []; failures = {}; detached = 0; deleted = 0; closed = 0;
  activeFile = source; trashFiles = [trashed]; trashResult = trashed;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(new Headers(init.headers).get("x-profile-id"), profileId);
    if (url === "/api/files?view=trash") { events.push("recover"); return Response.json({ files: trashFiles }); }
    if (url === "/api/files?view=active") { events.push("recover-active"); return Response.json({ files: [activeFile] }); }
    assert.equal(url, "/api/files/actions");
    const body = JSON.parse(init.body);
    events.push(body.action); requests.push(body);
    if (body.action === "trash" && failures.conflict) { failures.conflict--; return Response.json({ error: "File revision changed" }, { status: 409 }); }
    if (failures[body.action]) { failures[body.action]--; return Response.json({ error: "Storage temporarily unavailable" }, { status: 503 }); }
    return body.action === "trash" ? Response.json({ files: [trashResult], folders: [] }) : Response.json({ requestId: body.requestId, removed: { files: [source.id], folders: [] } });
  };
  root = createRoot(host);
  await act(async () => root.render(createElement(DeleteSyllabusDialog, {
    profileId, file: source, fileId: source.id, canWrite: true,
    onDetach: async () => { events.push("detach"); if (failures.detach) { failures.detach--; throw new Error("Workspace save failed"); } detached++; },
    onRefresh: async () => { events.push("refresh"); if (failures.refresh) { failures.refresh--; throw new Error("Refresh failed"); } },
    onDeleted: () => { deleted++; }, onClose: () => { closed++; }, ...overrides,
  })));
}
async function press(label) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  assert.ok(button, `Missing ${label}`);
  await act(async () => button.click());
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });

test("confirmation saves detachment before trash and permanent deletion with the new revision", async () => {
  await mount();
  assert.equal(requests.length, 0);
  assert.ok(host.querySelector("button svg"));
  await press("Delete Syllabus");
  assert.deepEqual(events, ["detach", "trash", "permanent-delete", "refresh"]);
  assert.equal(requests[0].items[0].revision, 4);
  assert.equal(requests[1].items[0].revision, 5);
  assert.match(requests[1].requestId, /^[a-f\d-]{36}$/);
  assert.equal(detached, 1);
  assert.equal(deleted, 1);
});

test("cancelling confirmation never changes the workspace or files", async () => {
  await mount(); await press("Cancel");
  assert.equal(closed, 1); assert.deepEqual(events, []);
});

test("failed detachment never deletes files and can be retried", async () => {
  await mount(); failures.detach = 1;
  await press("Delete Syllabus");
  assert.equal(requests.length, 0); assert.equal(deleted, 0);
  assert.match(host.querySelector('[role="alert"]').textContent, /Workspace save failed/);
  await press("Retry deletion");
  assert.equal(deleted, 1);
});

test("failed purge retries the same idempotent request without repeating detachment or Trash", async () => {
  await mount(); failures["permanent-delete"] = 1;
  await press("Delete Syllabus");
  assert.equal(deleted, 0);
  await press("Retry deletion");
  assert.deepEqual(events, ["detach", "trash", "permanent-delete", "permanent-delete", "refresh"]);
  assert.equal(requests[1].requestId, requests[2].requestId);
  assert.equal(deleted, 1);
});

test("uncertain Trash acknowledgement is recovered before retrying permanent deletion", async () => {
  await mount(); failures.trash = 1;
  await press("Delete Syllabus");
  await press("Retry deletion");
  assert.deepEqual(events, ["detach", "trash", "recover", "permanent-delete", "refresh"]);
  assert.equal(deleted, 1);
});

test("refresh failure does not repeat an acknowledged permanent deletion", async () => {
  await mount(); failures.refresh = 1;
  await press("Delete Syllabus"); await press("Retry deletion");
  assert.deepEqual(events, ["detach", "trash", "permanent-delete", "refresh", "refresh"]);
  assert.equal(deleted, 1);
});

test("revision conflicts refresh active files and require confirmation before deleting the changed source", async () => {
  await mount(); failures.conflict = 1; trashFiles = [];
  activeFile = { ...source, name: "Updated syllabus.pdf", metadata_revision: 6, content_revision: 2 };
  trashResult = { ...trashed, name: activeFile.name, metadata_revision: 7, content_revision: 2 };
  await press("Delete Syllabus");
  await press("Retry deletion");
  assert.deepEqual(events, ["detach", "trash", "recover", "recover-active"]);
  assert.match(host.querySelector('[role="alert"]').textContent, /Confirm again.*Updated syllabus/);
  assert.equal(deleted, 0);
  await press("Delete updated syllabus");
  assert.equal(requests[1].items[0].revision, 6);
  assert.equal(requests[2].items[0].revision, 7);
  assert.equal(detached, 1); assert.equal(deleted, 1);
});

test("text-only deletion clears the saved syllabus without file requests", async () => {
  await mount({ file: undefined, fileId: undefined });
  await press("Delete Syllabus");
  assert.deepEqual(events, ["detach", "refresh"]);
  assert.equal(deleted, 1);
});

test("an unavailable source is not silently detached", async () => {
  await mount({ file: undefined }); await press("Delete Syllabus");
  assert.equal(detached, 0); assert.equal(deleted, 0); assert.deepEqual(events, []);
});

test("unmount during workspace save prevents deletion in an abandoned account session", async () => {
  let resolveSave;
  await mount({ onDetach: () => new Promise((resolve) => { resolveSave = resolve; }) });
  await press("Delete Syllabus");
  await act(async () => root.unmount()); root = null;
  await act(async () => resolveSave());
  assert.equal(requests.length, 0); assert.equal(deleted, 0);
});
