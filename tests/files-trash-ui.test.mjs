import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<main><div id="outside"><input aria-label="Outside focus target"></div><div id="root"></div></main>', {
  url: "https://edu.example/files?view=my-files&layout=list", pretendToBeVisual: true,
});
for (const name of [
  "window", "document", "Element", "Node", "HTMLElement", "HTMLFormElement", "HTMLButtonElement",
  "HTMLAnchorElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent",
  "KeyboardEvent", "Event", "FormData", "PopStateEvent", "MutationObserver",
]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback) => setTimeout(() => callback(Date.now()), 0) });
Object.defineProperty(dom.window, "cancelAnimationFrame", { configurable: true, value: (id) => clearTimeout(id) });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.scrollTo = () => {};

const [{ createElement, Fragment, act }, { createRoot }, { default: FilesBrowser }, { FileList, PrivateImage }, { default: FilesTrashDialog }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/files-browser.tsx")),
  import(await clientModule("app/private-files.tsx")),
  import(await clientModule("app/files-trash-dialog.tsx")),
]);

const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE_ROOT = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_FOLDER = "22222222-2222-4222-8222-222222222222";
const TRASH_ROOT = "33333333-3333-4333-8333-333333333333";
const TRASH_CHILD = "44444444-4444-4444-8444-444444444444";
const EARLIER_ROOT = "88888888-8888-4888-8888-888888888888";
const ACTIVE_FILE = "aaaaaaaa-1111-4111-8111-111111111111";
const LOST_FILE = "bbbbbbbb-1111-4111-8111-111111111111";
const TRASH_FILE = "cccccccc-1111-4111-8111-111111111111";
const EARLIER_FILE = "dddddddd-1111-4111-8111-111111111111";
const MISSING_FOLDER = "55555555-5555-4555-8555-555555555555";
const RECOVERY_FOLDER = "66666666-6666-4666-8666-666666666666";
const OPERATION = "77777777-7777-4777-8777-777777777777";
const EARLIER_OPERATION = "99999999-9999-4999-8999-999999999999";
const NOW = "2026-10-08T12:00:00.000Z";
const course = { id: "biology", code: "BIO 201", name: "Biology", credits: 4, instructor: "Dr. Moss", room: "Science 2", color: "#b23b53", soft: "#b23b5318", initials: "BIO" };

function makeFolder(id, name, parent_id = null, overrides = {}) {
  return {
    id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 2,
    created_at: NOW, updated_at: NOW, archived_at: null, semester_label: null,
    course_name_snapshot: null, course_color_snapshot: null, trashed_at: null,
    trash_operation_id: null, original_parent_id: null, ...overrides,
  };
}

function makeFile(id, name, folder_id = null, overrides = {}) {
  return {
    id, name, mime_type: "text/plain", size_bytes: 12, course_id: null, assignment_id: null,
    kind: "resource", state: "ready", created_at: NOW, updated_at: NOW,
    content_sha256: null, folder_id, content_backend: "object", metadata_revision: 3,
    content_revision: 7, trashed_at: null, trash_operation_id: null,
    original_folder_id: null, ...overrides,
  };
}

function initialState() {
  return {
    folders: [
      makeFolder(COURSE_ROOT, "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
      makeFolder(ORIGINAL_FOLDER, "Class notes"),
      makeFolder(TRASH_ROOT, "Discarded folder", null, { trashed_at: NOW, trash_operation_id: OPERATION, original_parent_id: ORIGINAL_FOLDER }),
      makeFolder(TRASH_CHILD, "Old drafts", TRASH_ROOT, { trashed_at: NOW, trash_operation_id: OPERATION, original_parent_id: TRASH_ROOT }),
      makeFolder(EARLIER_ROOT, "Earlier cleanup", null, { trashed_at: NOW, trash_operation_id: OPERATION, original_parent_id: ORIGINAL_FOLDER }),
    ],
    files: [
      makeFile(ACTIVE_FILE, "Active notes.txt"),
      makeFile(LOST_FILE, "Lost-location.txt", null, { trashed_at: NOW, trash_operation_id: OPERATION, original_folder_id: MISSING_FOLDER, original_location_path: "My files / Gone" }),
      makeFile(TRASH_FILE, "Old draft.txt", null, { trashed_at: NOW, trash_operation_id: OPERATION, original_folder_id: TRASH_CHILD }),
      makeFile(EARLIER_FILE, "Earlier trashed file.txt", null, { trashed_at: NOW, trash_operation_id: EARLIER_OPERATION, original_folder_id: EARLIER_ROOT }),
    ],
  };
}

const rootNode = document.getElementById("root");
let root;
let state;
let requests;
let mutations;
let callbacks;
let failures;
let getFailures;
let holdNextMutation;
let pendingMutation;

globalThis.fetch = (...args) => fetchFixture(...args);

function reset(path = "/files?view=my-files&layout=list") {
  window.history.replaceState({}, "", path);
  rootNode.hidden = false;
  rootNode.innerHTML = "";
  root = createRoot(rootNode);
  state = initialState();
  requests = [];
  mutations = [];
  callbacks = { saved: 0, trashCompleted: [], reports: [] };
  failures = [];
  getFailures = [];
  holdNextMutation = false;
  pendingMutation = null;
}

function withProfile(row, profileId) { return { ...row, profile_id: profileId }; }

async function fetchFixture(input, init = {}) {
  const url = String(input);
  const profileId = new Headers(init.headers).get("x-profile-id") ?? "";
  const method = init.method ?? "GET";
  const entry = { url, method, profileId, init };
  requests.push(entry);
  if (method === "GET") {
    const failureIndex = getFailures.findIndex((failure) => failure.url === url && (!failure.profileId || failure.profileId === profileId));
    if (failureIndex >= 0) {
      const [failure] = getFailures.splice(failureIndex, 1);
      return Response.json({ error: failure.message }, { status: failure.status });
    }
    if (url === "/api/files?view=active" || url === "/api/files") return Response.json({ files: state.files.filter((file) => !file.trashed_at), activities: { files: [] } });
    if (url === "/api/files?view=trash") return Response.json({ files: state.files.filter((file) => file.trashed_at), activities: { files: [] } });
    if (url === "/api/file-folders?view=active") return Response.json({ folders: state.folders.filter((folder) => !folder.archived_at && !folder.trashed_at), activities: { folders: [] } });
    if (url === "/api/file-folders?view=archives") return Response.json({ folders: state.folders.filter((folder) => folder.archived_at), activities: { folders: [] } });
    if (url === "/api/file-folders?view=trash") return Response.json({ folders: state.folders.filter((folder) => folder.trashed_at), activities: { folders: [] } });
    throw new Error(`Unexpected GET fixture request: ${url}`);
  }

  const body = JSON.parse(init.body ?? "{}");
  const mutation = { url, method, profileId, body, signal: init.signal };
  mutations.push(mutation);
  if (holdNextMutation) {
    holdNextMutation = false;
    await new Promise((resolve) => { pendingMutation = { resolve, mutation }; });
  }
  const failureIndex = failures.findIndex((failure) => failure.action === body.action);
  if (failureIndex >= 0) {
    const [failure] = failures.splice(failureIndex, 1);
    return Response.json({ error: failure.message }, { status: failure.status });
  }

  if (body.action === "trash") {
    const files = [], folders = [];
    for (const item of body.items) {
      if (item.type === "file") {
        const index = state.files.findIndex((file) => file.id === item.id);
        const current = state.files[index];
        const changed = { ...current, folder_id: null, original_folder_id: current.folder_id, trashed_at: NOW, trash_operation_id: OPERATION, metadata_revision: current.metadata_revision + 1, updated_at: NOW };
        state.files[index] = changed;
        files.push(withProfile(changed, profileId));
      } else {
        const index = state.folders.findIndex((folder) => folder.id === item.id);
        const current = state.folders[index];
        const changed = { ...current, parent_id: null, original_parent_id: current.parent_id, trashed_at: NOW, trash_operation_id: OPERATION, revision: current.revision + 1, updated_at: NOW };
        state.folders[index] = changed;
        folders.push(withProfile(changed, profileId));
      }
    }
    return Response.json({ files, folders });
  }

  if (body.action === "restore") {
    const files = [], folders = [];
    let recoveryFolder = null;
    for (const item of body.items) {
      if (item.type === "file") {
        const index = state.files.findIndex((file) => file.id === item.id);
        const current = state.files[index];
        const destinationExists = current.original_folder_id === null || state.folders.some((folder) => folder.id === current.original_folder_id && !folder.trashed_at);
        if (!destinationExists) {
          recoveryFolder = state.folders.find((folder) => folder.id === RECOVERY_FOLDER) ?? makeFolder(RECOVERY_FOLDER, "Restored files");
          if (!state.folders.some((folder) => folder.id === recoveryFolder.id)) state.folders.push(recoveryFolder);
        }
        const changed = { ...current, folder_id: destinationExists ? current.original_folder_id : RECOVERY_FOLDER, original_folder_id: null, trashed_at: null, trash_operation_id: null, metadata_revision: current.metadata_revision + 1, updated_at: NOW };
        state.files[index] = changed;
        files.push(withProfile(changed, profileId));
      } else {
        const index = state.folders.findIndex((folder) => folder.id === item.id);
        const current = state.folders[index];
        const changed = { ...current, parent_id: current.original_parent_id, original_parent_id: null, trashed_at: null, trash_operation_id: null, revision: current.revision + 1, updated_at: NOW };
        state.folders[index] = changed;
        folders.push(withProfile(changed, profileId));
      }
    }
    return Response.json({ files, folders, recoveryFolder: recoveryFolder ? withProfile(recoveryFolder, profileId) : null });
  }

  if (body.action === "permanent-delete") {
    for (const item of body.items) {
      if (item.type === "file") state.files = state.files.filter((file) => file.id !== item.id);
      else state.folders = state.folders.filter((folder) => folder.id !== item.id);
    }
    mutation.response = { requestId: body.requestId, removed: {
      files: body.items.filter((item) => item.type === "file").map((item) => item.id),
      folders: body.items.filter((item) => item.type === "folder").map((item) => item.id),
    } };
    return Response.json(mutation.response);
  }

  if (body.action === "empty-trash") {
    const removed = {
      files: state.files.filter((file) => file.trashed_at && !file.deleted_at).map((file) => file.id),
      folders: state.folders.filter((folder) => folder.trashed_at && !folder.deleted_at).map((folder) => folder.id),
    };
    state.files = state.files.filter((file) => !file.trashed_at || file.deleted_at);
    state.folders = state.folders.filter((folder) => !folder.trashed_at || folder.deleted_at);
    mutation.response = { requestId: body.requestId, removed };
    return Response.json(mutation.response);
  }
  throw new Error(`Unexpected mutation action: ${body.action}`);
}

function props({ profileId = PROFILE_A, canWrite = true } = {}) {
  return {
    profileId, courses: [course], assignments: [],
    store: { files: state.files, url: (file) => `/api/files?id=${file.id}&account=${profileId}` },
    layout: "list", onLayoutChange() {}, onUpload() {}, onOpen() {}, onEdit() {}, canWrite,
    onOrganizationSaved: async () => { callbacks.saved += 1; },
    onOrganizationStateChange: (report) => callbacks.reports.push(report),
    onTrashCompleted: (receipt) => callbacks.trashCompleted.push(receipt),
  };
}

async function render(componentProps = props()) {
  await act(async () => { root.render(createElement(FilesBrowser, componentProps)); });
}

async function renderElement(element) {
  await act(async () => { root.render(element); });
}

async function unmount() {
  if (!root) return;
  await act(async () => root.unmount());
  root = undefined;
  rootNode.hidden = false;
  rootNode.innerHTML = "";
}

after(() => dom.window.close());
afterEach(async () => { await unmount(); });

async function waitUntil(predicate, description, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  assert.ok(predicate(), `Timed out waiting for ${description}`);
}

function button(label, container = rootNode) {
  const found = [...container.querySelectorAll("button")].find((item) => {
    const ariaLabel = item.getAttribute("aria-label") ?? "";
    return ariaLabel === label || item.textContent.trim() === label;
  });
  assert.ok(found, `Missing button ${label}`);
  return found;
}

async function click(label, container = rootNode) {
  const control = button(label, container);
  await act(async () => control.click());
  return control;
}

async function downloadRequestDraft(container) {
  const captured = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalAnchorClick = dom.window.HTMLAnchorElement.prototype.click;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob) => { captured.push(blob); return "blob:trash-request"; } });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value() {} });
  Object.defineProperty(dom.window.HTMLAnchorElement.prototype, "click", { configurable: true, value() { captured.push({ download: this.download, href: this.href }); } });
  try {
    await click("Download request", container);
    await waitUntil(() => captured.some((entry) => entry instanceof Blob), "the saved Trash request download");
    const blob = captured.find((entry) => entry instanceof Blob);
    const anchor = captured.find((entry) => entry.download === "eduessentials-trash-request.json");
    assert.equal(anchor?.href, "blob:trash-request");
    return JSON.parse(await blob.text());
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    Object.defineProperty(dom.window.HTMLAnchorElement.prototype, "click", { configurable: true, value: originalAnchorClick });
  }
}

function dialog() {
  const found = rootNode.querySelector(".files-trash-dialog[role='dialog']");
  assert.ok(found, "Trash dialog is open");
  return found;
}

async function openItemMenu(name) {
  await act(async () => button(`More options for ${name}`).click());
  await waitUntil(() => Boolean(rootNode.querySelector('[role="menu"]')), `the ${name} menu`);
}

async function clickMenuItem(label) {
  const found = [...rootNode.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === label);
  assert.ok(found, `Missing menu item ${label}`);
  await act(async () => found.click());
}

function hasItem(name) {
  return [...rootNode.querySelectorAll(".files-item-title strong")].some((item) => item.textContent.trim() === name);
}

async function ready() {
  await waitUntil(() => hasItem("Active notes.txt"), "the active Files rows");
}

test("Trash requires explicit confirmation, does not optimistically remove a row, and sends the captured revision after confirmation", async () => {
  reset();
  holdNextMutation = true;
  await render();
  await ready();
  await openItemMenu("Active notes.txt");
  await clickMenuItem("Move to Trash");
  assert.match(dialog().textContent, /Move “Active notes\.txt” to Trash\?/);
  assert.equal(mutations.length, 0, "opening the confirmation does not mutate the file");
  assert.ok(hasItem("Active notes.txt"));
  assert.equal(document.activeElement, dialog().querySelector(".files-trash-submit"), "the dialog focuses its primary action on open");

  await click("Move to Trash", dialog());
  await waitUntil(() => mutations.length === 1, "the confirmed Trash request");
  assert.equal(mutations[0].body.action, "trash");
  assert.deepEqual(mutations[0].body.items, [{ type: "file", id: ACTIVE_FILE, revision: 3 }]);
  assert.ok(hasItem("Active notes.txt"), "the active row stays visible while the server request is unresolved");
  assert.match(dialog().textContent, /Moving to Trash/);
  assert.equal(button("Close", dialog()).disabled, true, "the busy dialog cannot be cancelled out from under the request");

  await act(async () => pendingMutation.resolve());
  await waitUntil(() => !rootNode.querySelector(".files-trash-dialog") && !hasItem("Active notes.txt"), "the confirmed Trash refresh");
  assert.equal(callbacks.saved, 1);
  assert.equal(callbacks.trashCompleted.length, 1);
  assert.equal(callbacks.trashCompleted[0].profileId, PROFILE_A);
  assert.equal(callbacks.trashCompleted[0].label, "Active notes.txt");
});

test("a successful Trash with a failed browser refresh keeps an acknowledged draft and retries only the refresh", async () => {
  reset();
  await render();
  await ready();
  getFailures.push({ url: "/api/files?view=active", profileId: PROFILE_A, status: 503, message: "Refresh temporarily unavailable." });
  await openItemMenu("Active notes.txt");
  await clickMenuItem("Move to Trash");
  await click("Move to Trash", dialog());

  await waitUntil(() => dialog().querySelector('[role="alert"]')?.textContent.includes("Files refresh did not finish"), "the failed post-Trash browser refresh");
  assert.equal(mutations.length, 1, "the file mutation succeeded once before refresh failed");
  assert.equal(state.files.find((file) => file.id === ACTIVE_FILE).trashed_at, NOW);
  assert.match(dialog().textContent, /The server saved this change/);
  assert.ok(callbacks.reports.some((report) => report?.draft?.acknowledged === true), "the retained request draft records the server acknowledgement");
  assert.ok(button("Retry Files refresh", dialog()));

  await click("Retry Files refresh", dialog());
  await waitUntil(() => !rootNode.querySelector(".files-trash-dialog") && callbacks.saved === 1, "the refresh-only retry");
  assert.equal(mutations.length, 1, "refresh recovery never repeats the successful Trash mutation");
  assert.equal(requests.filter((request) => request.method === "GET" && request.url === "/api/files?view=active").length, 3,
    "the initial load, failed refresh, and refresh retry each read Files");
});

test("a rejected save callback after Trash retains an acknowledged draft and refresh retry does not repost", async () => {
  reset();
  const savedReports = [];
  const receipts = [];
  let saveAttempts = 0;
  let closeCalls = 0;
  const file = state.files.find((item) => item.id === ACTIVE_FILE);
  const request = { action: "trash", profileId: PROFILE_A, items: [{ type: "file", id: file.id, file }], folders: [], count: 1 };
  await renderElement(createElement(FilesTrashDialog, {
    request, currentProfileId: PROFILE_A, canWrite: true,
    onClose: () => { closeCalls += 1; },
    onSaved: async (profileId, signal) => {
      assert.equal(profileId, PROFILE_A);
      assert.equal(signal.aborted, false);
      saveAttempts += 1;
      if (saveAttempts === 1) throw new Error("The workspace save callback rejected.");
    },
    onRefresh: async () => {},
    onStateChange: (report) => savedReports.push(report),
    onTrashCompleted: (receipt) => receipts.push(receipt),
    onRestored: () => {},
  }));
  await click("Move to Trash", dialog());
  await waitUntil(() => dialog().querySelector('[role="alert"]')?.textContent.includes("Files refresh did not finish"), "the rejected post-save callback");
  assert.equal(mutations.length, 1);
  assert.equal(saveAttempts, 1);
  assert.equal(receipts.length, 0, "the completion receipt waits until the follow-up callback succeeds");
  assert.ok(savedReports.some((report) => report?.draft?.acknowledged === true));

  await click("Retry Files refresh", dialog());
  await waitUntil(() => saveAttempts === 2 && closeCalls === 1, "the callback-only retry");
  assert.equal(mutations.length, 1, "the acknowledged Trash request is not sent again");
  assert.equal(receipts.length, 1);
});

test("Trash cancellation sends no request and the managed course root has no generic Trash action", async () => {
  reset();
  await render();
  await ready();

  await openItemMenu("BIO 201");
  const managedMenuLabels = [...rootNode.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim());
  assert.equal(managedMenuLabels.some((label) => label === "Move to Trash"), false);
  assert.equal(managedMenuLabels.some((label) => label === "Move to…" || label === "Rename folder"), false);
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  await openItemMenu("Active notes.txt");
  await clickMenuItem("Move to Trash");
  const trigger = button("More options for Active notes.txt");
  await click("Close", dialog());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  assert.equal(rootNode.querySelector(".files-trash-dialog"), null);
  assert.equal(mutations.length, 0);
  assert.ok(hasItem("Active notes.txt"));
  assert.equal(document.activeElement, trigger, "cancelling returns focus to the item menu trigger");
});

test("permanent deletion shows its irreversible warning, retains the exact request UUID and draft on conflict, and can be downloaded", async () => {
  reset("/files?view=trash&layout=list");
  failures.push({ action: "permanent-delete", status: 409, message: "The Trash revision is stale." });
  await render();
  await waitUntil(() => hasItem("Lost-location.txt"), "the Trash rows");
  await openItemMenu("Lost-location.txt");
  await clickMenuItem("Delete permanently");
  assert.match(dialog().textContent, /Permanently delete “Lost-location\.txt”\?/);
  assert.match(dialog().textContent, /This action cannot be undone/);
  assert.equal(mutations.length, 0, "the irreversible request waits for confirmation");
  await click("Delete permanently", dialog());
  await waitUntil(() => dialog().querySelector('[role="alert"]')?.textContent.includes("Trash revision is stale"), "the stale deletion error");
  assert.ok(hasItem("Lost-location.txt"), "the stale request leaves its Trash row in place");
  assert.equal(mutations.length, 1);
  const first = mutations[0].body;
  assert.match(first.requestId, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
  assert.deepEqual(first.items, [{ type: "file", id: LOST_FILE, revision: 3 }]);

  const draft = await downloadRequestDraft(dialog());
  assert.equal(draft.capturedProfileId, PROFILE_A);
  assert.equal(draft.action, "permanent-delete");
  assert.equal(draft.requestId, first.requestId);
  assert.equal(draft.items[0].id, LOST_FILE);
  assert.equal(draft.items[0].revision, 3);
  assert.equal(draft.acknowledged, false);

  await click("Retry permanent deletion", dialog());
  await waitUntil(() => mutations.length === 2 && !rootNode.querySelector(".files-trash-dialog"), "the exact permanent-delete retry");
  assert.deepEqual(mutations[1].body, first, "the retry retains the same request UUID and item revision snapshot");
  assert.equal(hasItem("Lost-location.txt"), false, "the successful retry removes the item after the server refresh");
  assert.equal(callbacks.saved, 1);
});

test("permanent folder confirmation counts an earlier independently trashed child", async () => {
  reset("/files?view=trash&layout=list");
  await render();
  await waitUntil(() => hasItem("Earlier cleanup"), "the earlier trashed folder");
  await openItemMenu("Earlier cleanup");
  await clickMenuItem("Delete permanently");
  assert.match(dialog().textContent, /Permanently delete “Earlier cleanup” and its contents \(2 items\)\?/);
  assert.match(dialog().textContent, /Folder · 2 items/);
  assert.equal(mutations.length, 0, "the displayed subtree count does not bypass explicit confirmation");
  await click("Close", dialog());
});

test("recursive Trash confirmation counts retained archived descendants", async () => {
  reset();
  state.folders.push(makeFolder(MISSING_FOLDER, "Archived child", ORIGINAL_FOLDER, { archived_at: NOW, semester_label: "Fall 2026" }));
  state.files.push(makeFile(RECOVERY_FOLDER, "Archived child notes.txt", MISSING_FOLDER));
  await render(); await ready(); await openItemMenu("Class notes"); await clickMenuItem("Move to Trash");
  assert.match(dialog().textContent, /contents \(3 items\)/);
  assert.equal(mutations.length, 0, "the complete count is presented before mutation");
  await click("Close", dialog());
});

test("Empty Trash confirms the loaded count, requires confirmation, and retries the same UUID after a service failure", async () => {
  reset("/files?view=trash&layout=list");
  failures.push({ action: "empty-trash", status: 503, message: "Cleanup worker unavailable." });
  await render();
  await waitUntil(() => hasItem("Lost-location.txt"), "the Trash rows");
  assert.equal(button("Empty Trash (6)").disabled, false, "the count includes folders, nested content, and independently trashed descendants");
  await click("Empty Trash (6)");
  assert.match(dialog().textContent, /Permanently delete all 6 items in Trash\?/);
  assert.match(dialog().textContent, /This action cannot be undone/);
  assert.equal(mutations.length, 0);
  await click("Empty Trash", dialog());
  await waitUntil(() => dialog().querySelector('[role="alert"]')?.textContent.includes("Cleanup worker unavailable"), "the failed Empty Trash request");
  assert.ok(hasItem("Lost-location.txt"), "a failed purge keeps its Trash rows visible");
  assert.equal(mutations.length, 1);
  const requestId = mutations[0].body.requestId;
  assert.match(requestId, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);

  const draft = await downloadRequestDraft(dialog());
  assert.equal(draft.action, "empty-trash");
  assert.equal(draft.requestId, requestId);
  assert.equal(draft.count, 6);

  await click("Retry Empty Trash", dialog());
  await waitUntil(() => mutations.length === 2 && !rootNode.querySelector(".files-trash-dialog"), "the retried Empty Trash operation");
  assert.deepEqual(mutations[1].body, mutations[0].body, "Empty Trash keeps its exact request UUID for retry");
  await waitUntil(() => rootNode.textContent.includes("Trash is empty"), "the empty Trash view after refresh");
});

test("restoring an item with a missing original folder reports the visible Restored files destination", async () => {
  reset("/files?view=trash&layout=list");
  await render();
  await waitUntil(() => hasItem("Lost-location.txt"), "the Trash rows");
  const row = [...rootNode.querySelectorAll(".files-item")].find((item) => item.textContent.includes("Lost-location.txt"));
  assert.match(row?.textContent ?? "", /My files \/ Gone/);
  await openItemMenu("Lost-location.txt");
  await clickMenuItem("Restore");
  assert.match(dialog().textContent, /visible Restored files folder/);
  await click("Restore", dialog());
  await waitUntil(() => !rootNode.querySelector(".files-trash-dialog") && rootNode.querySelector('[role="status"]')?.textContent.includes("Restored to Restored files"), "the recovery-folder notice");
  assert.match(rootNode.textContent, /Restored to Restored files because the original location was unavailable/);
  assert.equal(state.files.find((file) => file.id === LOST_FILE).folder_id, RECOVERY_FOLDER);
  assert.ok(state.folders.some((folder) => folder.id === RECOVERY_FOLDER && folder.name === "Restored files"));
});

test("Trash controls are disabled in a read-only workspace", async () => {
  reset("/files?view=trash&layout=list");
  await render(props({ canWrite: false }));
  await waitUntil(() => hasItem("Lost-location.txt"), "the read-only Trash rows");
  assert.equal(button("Empty Trash (6)").disabled, true);
  await openItemMenu("Lost-location.txt");
  const restore = [...rootNode.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === "Restore");
  const remove = [...rootNode.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === "Delete permanently");
  assert.equal(restore?.disabled, true);
  assert.equal(remove?.disabled, true);
  assert.equal(mutations.length, 0);
});

test("a reloaded Trash shows a pending empty folder, blocks restore, and lets permanent deletion finish", async () => {
  reset("/files?view=trash&layout=list");
  state.folders.push(makeFolder("aaaaaaaa-2222-4222-8222-222222222222", "Interrupted cleanup", null, {
    trashed_at: NOW,
    trash_operation_id: OPERATION,
    original_parent_id: ORIGINAL_FOLDER,
    purge_pending_at: NOW,
  }));
  state.folders.push(makeFolder("bbbbbbbb-2222-4222-8222-222222222222", "Already deleted", null, {
    trashed_at: NOW,
    trash_operation_id: OPERATION,
    original_parent_id: ORIGINAL_FOLDER,
    deleted_at: NOW,
  }));

  await render();
  await waitUntil(() => hasItem("Interrupted cleanup"), "the interrupted purge folder after loading Trash");
  assert.equal(hasItem("Already deleted"), false, "a deleted tombstone is never shown in Trash");
  const pendingRow = [...rootNode.querySelectorAll(".files-item")].find((item) => item.textContent.includes("Interrupted cleanup"));
  assert.match(pendingRow?.querySelector(".files-status")?.className ?? "", /is-deleting/);
  assert.equal(pendingRow?.querySelector(".files-status")?.textContent, "Cleanup pending");
  await act(async () => pendingRow?.querySelector(".files-item-main")?.click());
  assert.match(rootNode.querySelector(".files-details-dialog")?.textContent ?? "", /Permanent deletion pending/);
  await click("Close", rootNode.querySelector(".files-details-dialog"));

  await openItemMenu("Interrupted cleanup");
  assert.equal([...rootNode.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.trim() === "Restore"), false, "pending folders cannot be restored");
  assert.equal([...rootNode.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.trim() === "Open folder"), false, "pending folders are not navigable");
  await clickMenuItem("Retry permanent deletion");
  assert.match(dialog().textContent, /Permanently delete “Interrupted cleanup” and its contents \(1 item\)\?/);
  assert.equal(mutations.length, 0, "permanent deletion still waits for confirmation");
  await click("Delete permanently", dialog());
  await waitUntil(() => mutations.length === 1 && !hasItem("Interrupted cleanup"), "the pending folder deletion and refreshed Trash");
  assert.deepEqual(mutations[0].body.items, [{ type: "folder", id: "aaaaaaaa-2222-4222-8222-222222222222", revision: 2 }]);
  assert.deepEqual(mutations[0].response.removed.folders, ["aaaaaaaa-2222-4222-8222-222222222222"]);
});

test("Empty Trash includes a pending folder and removes it after confirmation", async () => {
  reset("/files?view=trash&layout=list");
  state.folders.push(makeFolder("cccccccc-2222-4222-8222-222222222222", "Pending empty folder", null, {
    trashed_at: NOW,
    trash_operation_id: OPERATION,
    original_parent_id: ORIGINAL_FOLDER,
    purge_pending_at: NOW,
  }));
  await render();
  await waitUntil(() => hasItem("Pending empty folder"), "the pending folder in refreshed Trash");
  assert.equal(button("Empty Trash (7)").disabled, false, "the pending folder contributes to the loaded non-deleted Trash count");
  await click("Empty Trash (7)");
  await click("Empty Trash", dialog());
  await waitUntil(() => mutations.length === 1 && !hasItem("Pending empty folder"), "Empty Trash to finish pending folder cleanup");
  assert.equal(mutations[0].body.action, "empty-trash");
  assert.deepEqual(mutations[0].response.removed.folders, [TRASH_ROOT, TRASH_CHILD, EARLIER_ROOT, "cccccccc-2222-4222-8222-222222222222"]);
});

test("Trash dialog traps keyboard focus and does not steal focus while its browser is hidden", async () => {
  reset();
  await render();
  await ready();
  await openItemMenu("Active notes.txt");
  await clickMenuItem("Move to Trash");
  const currentDialog = dialog();
  const submit = currentDialog.querySelector(".files-trash-submit");
  await waitUntil(() => document.activeElement === submit, "the initial dialog focus");

  await act(async () => {
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  });
  assert.ok(document.activeElement === currentDialog.querySelector("button"), "Tab from the final control wraps to the first dialog control");
  await act(async () => {
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  });
  assert.ok(document.activeElement === submit, "Shift+Tab from the first control wraps to the submit action");

  const outside = document.querySelector('[aria-label="Outside focus target"]');
  await act(async () => { rootNode.hidden = true; outside.focus(); });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  assert.ok(document.activeElement === outside, "a hidden browser dialog cannot steal focus");
  await act(async () => { rootNode.hidden = false; });
  await waitUntil(() => document.activeElement === submit, "focus restored when the dialog becomes visible");
});

test("academic FileList and PrivateImage hide a cached trashed attachment without reading it, then restore its original course association", async () => {
  reset();
  const trashedImage = makeFile(ACTIVE_FILE, "Biology card.png", null, {
    mime_type: "image/png", kind: "class-image", course_id: "biology", assignment_id: null,
    trashed_at: NOW, trash_operation_id: OPERATION,
  });
  const opened = [];
  const reads = [];
  const store = {
    busy: false,
    url: (file) => `/api/files?id=${file.id}`,
    blob: async (file, signal) => { reads.push({ id: file.id, signal }); return new Blob(["private image"], { type: "image/png" }); },
  };
  const renderAcademicSurfaces = (file) => createElement(Fragment, null,
    createElement(FileList, { files: [file], store, onOpen: (openedFile) => opened.push(openedFile), onEdit() {}, canWrite: true }),
    createElement(PrivateImage, { file, store }),
  );

  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:restored-course-image" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value() {} });
  try {
    await renderElement(renderAcademicSurfaces(trashedImage));
    assert.match(rootNode.textContent, /No files yet/);
    assert.equal(rootNode.querySelector("img.private-class-image"), null);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(reads.length, 0, "a cached trashed class image does not trigger a private-byte read or download");
    assert.equal(opened.length, 0);

    const restoredImage = { ...trashedImage, trashed_at: null, trash_operation_id: null, folder_id: null, original_folder_id: null };
    await renderElement(renderAcademicSurfaces(restoredImage));
    await waitUntil(() => Boolean(rootNode.querySelector("img.private-class-image")), "the restored course image");
    assert.match(rootNode.textContent, /Biology card\.png/);
    assert.equal(rootNode.querySelector("img.private-class-image")?.alt, "Biology card.png");
    assert.equal(reads.length, 1);
    assert.equal(reads[0].id, ACTIVE_FILE);
    assert.equal(restoredImage.course_id, "biology");
    assert.equal(restoredImage.assignment_id, null);
    assert.equal(restoredImage.kind, "class-image");
    await act(async () => rootNode.querySelector(".private-file-list .text-button").click());
    assert.equal(opened.length, 1);
    assert.equal(opened[0].course_id, "biology");
    assert.equal(opened[0].assignment_id, null);
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
  }
});

test("A to B to A account changes abort the captured request and fence a late acknowledgement", async () => {
  reset();
  holdNextMutation = true;
  await render(props({ profileId: PROFILE_A }));
  await ready();
  await openItemMenu("Active notes.txt");
  await clickMenuItem("Move to Trash");
  await click("Move to Trash", dialog());
  await waitUntil(() => mutations.length === 1 && pendingMutation, "the held profile A Trash request");

  await render(props({ profileId: PROFILE_B }));
  await waitUntil(() => requests.some((request) => request.method === "GET" && request.profileId === PROFILE_B), "profile B browser requests");
  await render(props({ profileId: PROFILE_A }));
  await waitUntil(() => requests.filter((request) => request.method === "GET" && request.profileId === PROFILE_A).length >= 10, "the return to profile A");
  const savedBeforeLateAck = callbacks.saved;
  const completedBeforeLateAck = callbacks.trashCompleted.length;

  await act(async () => pendingMutation.resolve());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  assert.equal(mutations.length, 1, "the late response does not trigger a stale refresh or second action");
  assert.equal(callbacks.saved, savedBeforeLateAck, "a captured-account acknowledgement cannot run the current account save callback");
  assert.equal(callbacks.trashCompleted.length, completedBeforeLateAck, "the stale response cannot publish an undo receipt");
  assert.ok(rootNode.textContent.includes("Active notes.txt"), "the returned account view remains independent of the old pending dialog response");
  const staleDialog = dialog();
  assert.equal(staleDialog.querySelector(".files-trash-submit")?.textContent.trim(), "Move to Trash", "a late acknowledgement does not switch into refresh-retry mode");
  assert.equal([...staleDialog.querySelectorAll("button")].some((item) => item.textContent.trim() === "Retry Files refresh"), false);
  const draft = await downloadRequestDraft(staleDialog);
  assert.equal(draft.acknowledged, false, "the late response remains an unacknowledged captured draft");
  assert.equal(draft.capturedProfileId, PROFILE_A);
  assert.equal(mutations.length, 1);
});
