import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/files" });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLFormElement", "HTMLButtonElement", "HTMLAnchorElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent", "KeyboardEvent", "Event", "FormData", "MutationObserver"]) {
  globalThis[name] = dom.window[name];
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback) => setTimeout(() => callback(Date.now()), 0) });
Object.defineProperty(dom.window, "cancelAnimationFrame", { configurable: true, value: (id) => clearTimeout(id) });
dom.window.confirm = () => true;

const [{ createElement, act }, { createRoot }, { default: FilesBrowser }, { default: Workspace }, { validateProfile }, { encodeWorkspaceState }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/files-browser.tsx")),
  import(await clientModule("app/workspace-client.tsx")),
  import(await clientModule("lib/profile.ts")),
  import(await clientModule("lib/workspace-codec.ts")),
]);

const course = { id: "biology", code: "BIO 201", name: "Biology", credits: 4, instructor: "Dr. Moss", room: "Science 2", color: "#b23b53", soft: "#b23b5318", initials: "BIO" };
const baseProfile = {
  ...validateProfile({ display_name: "Alex" }),
  id: "profile-a", auth_user_id: "user-a", email: "alex@example.invalid", avatar_url: null,
  initialized: true, updated_at: "2026-10-01T00:00:00.000Z", onboarding_completed_at: "2026-09-30T00:00:00.000Z",
};

const makeFolder = (id, name, parent_id = null, overrides = {}) => ({
  id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-03T00:00:00.000Z",
  archived_at: null, semester_label: null, course_name_snapshot: null, course_color_snapshot: null,
  trashed_at: null, trash_operation_id: null, original_parent_id: null, ...overrides,
});
const makeFile = (id, name, folder_id = null, overrides = {}) => ({
  id, name, mime_type: "text/plain", size_bytes: 128, course_id: null, assignment_id: null,
  kind: "resource", state: "ready", created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-03T00:00:00.000Z", content_sha256: null, folder_id,
  content_backend: "object", metadata_revision: 1, content_revision: 1,
  trashed_at: null, trash_operation_id: null, original_folder_id: null, ...overrides,
});

const activeFolders = [
  makeFolder("course-root", "BIO 201", null, { kind: "course", course_id: "biology", course_code: "BIO 201" }),
  makeFolder("course-labs", "Labs", "course-root"),
  makeFolder("course-week", "Week 1", "course-labs"),
  makeFolder("personal-root", "Class notes"),
  makeFolder("personal-deep", "Research", "personal-root"),
  makeFolder("empty-folder", "Empty folder"),
];
const archivedFolders = [
  makeFolder("archive-root", "Fall 2025", null, { archived_at: "2026-01-01T00:00:00.000Z", semester_label: "Fall 2025", course_color_snapshot: "#335577" }),
  makeFolder("archive-child", "Old labs", "archive-root", { archived_at: "2026-01-01T00:00:00.000Z", semester_label: "Fall 2025", course_color_snapshot: "#335577" }),
];
const trashedFolders = [
  makeFolder("trash-root", "Discarded", null, { trashed_at: "2026-10-02T00:00:00.000Z" }),
  makeFolder("trash-child", "Discarded child", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_parent_id: "trash-root" }),
];
const activeFiles = [
  makeFile("root-file", "Root notes.txt", null),
  makeFile("root-untitled", "Untitled.txt", null),
  makeFile("native-file", "Native journal.txt", null, { content_backend: "native-text", size_bytes: 0 }),
  makeFile("course-file", "BIO reading.txt", "course-root", { course_id: "biology" }),
  makeFile("lab-file", "Lab notes.txt", "course-labs", { course_id: "biology" }),
  makeFile("lab-untitled", "Untitled.txt", "course-labs", { course_id: "biology" }),
  makeFile("deep-file", "Week one.txt", "course-week", { course_id: "biology" }),
  makeFile("personal-file", "Research.txt", "personal-deep"),
  makeFile("archive-file", "Archived reading.txt", "archive-child", { course_id: "biology" }),
  makeFile("recent-a", "Daily planner.txt", null),
  makeFile("recent-b", "Lab setup.txt", "course-labs", { course_id: "biology" }),
  makeFile("recent-c", "Reading summary.txt", null),
  makeFile("recent-d", "Study checklist.txt", "personal-deep"),
  makeFile("pending-file", "Pending upload.txt", null, { state: "pending" }),
  makeFile("deleting-file", "Deleting upload.txt", null, { state: "deleting" }),
];
const trashedFiles = [makeFile("trash-file", "Removed.txt", null, { trashed_at: "2026-10-02T00:00:00.000Z", original_folder_id: "trash-root" })];
const fileActivity = {
  files: [
    { file_id: "root-file", starred_at: null, last_opened_at: "2026-10-03T10:00:00.000Z" },
    { file_id: "course-file", starred_at: "2026-10-03T09:00:00.000Z", last_opened_at: "2026-10-03T11:00:00.000Z" },
    { file_id: "deep-file", starred_at: null, last_opened_at: "2026-10-03T12:00:00.000Z" },
    { file_id: "recent-a", starred_at: null, last_opened_at: "2026-10-03T16:00:00.000Z" },
    { file_id: "recent-b", starred_at: null, last_opened_at: "2026-10-03T15:00:00.000Z" },
    { file_id: "recent-c", starred_at: null, last_opened_at: "2026-10-03T14:00:00.000Z" },
    { file_id: "recent-d", starred_at: null, last_opened_at: "2026-10-03T13:00:00.000Z" },
    { file_id: "pending-file", starred_at: null, last_opened_at: "2026-10-03T17:00:00.000Z" },
    { file_id: "deleting-file", starred_at: null, last_opened_at: "2026-10-03T18:00:00.000Z" },
    { file_id: "trash-file", starred_at: null, last_opened_at: "2026-10-03T19:00:00.000Z" },
  ],
};
const folderActivity = {
  folders: [
    { folder_id: "course-root", starred_at: null, last_opened_at: "2026-10-03T08:00:00.000Z" },
    { folder_id: "personal-root", starred_at: "2026-10-03T07:00:00.000Z", last_opened_at: null },
    { folder_id: "archive-root", starred_at: "2026-10-03T06:00:00.000Z", last_opened_at: null },
  ],
};

const node = document.getElementById("root");
let root;
let fetcher;
let requests;
let callbacks;
let storeFiles;
let folderRename;

globalThis.fetch = (...args) => fetcher(...args);
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};

function reset(path = "/files") {
  window.history.replaceState({}, "", path);
  node.innerHTML = "";
  requests = [];
  callbacks = { opened: [], edited: [], uploads: [], layouts: [], newTextFiles: [] };
  storeFiles = [...activeFiles];
  folderRename = null;
  root = createRoot(node);
}

function folderPayload(url, { emptyLibrary = false, createdFolders = [], emptyFolders = [] } = {}) {
  if (emptyLibrary) return { folders: url.includes("view=active") ? [...emptyFolders, ...createdFolders] : [], activities: { folders: [] } };
  const folders = url.includes("view=archives") ? archivedFolders : url.includes("view=trash") ? trashedFolders : activeFolders;
  return { folders: folders.map((folder) => folderRename?.id === folder.id ? { ...folder, name: folderRename.name } : folder), activities: folderActivity };
}

function installApi({ failFirst = false, holdProfile = null, renamedAccount = null, emptyLibrary = false, emptyFiles = [], emptyFolders = [] } = {}) {
  let shouldFail = failFirst;
  const pending = new Map();
  const released = new Set();
  const createdFolders = [];
  const release = (profileId) => {
    released.add(profileId);
    for (const resolve of pending.get(profileId) ?? []) resolve();
    pending.delete(profileId);
  };
  fetcher = async (input, init = {}) => {
    const url = String(input);
    const profileId = new Headers(init.headers).get("x-profile-id") ?? "";
    requests.push({ url, profileId, method: init.method ?? "GET" });
    if (holdProfile === profileId && !released.has(profileId)) await new Promise((resolve) => {
      const resolvers = pending.get(profileId) ?? [];
      resolvers.push(resolve);
      pending.set(profileId, resolvers);
    });
    if (shouldFail && url === "/api/files?view=active") {
      shouldFail = false;
      return Response.json({ error: "Temporary fixture failure" }, { status: 503 });
    }

    let body;
    if (url === "/api/files?view=active" || url === "/api/files") body = emptyLibrary
      ? { files: emptyFiles, activities: { files: [], folders: [] } }
      : { files: activeFiles, activities: fileActivity };
    else if (url === "/api/files?view=trash") body = emptyLibrary
      ? { files: [], activities: { files: [], folders: [] } }
      : { files: trashedFiles, activities: fileActivity };
    else if (url.startsWith("/api/file-folders?view=")) body = folderPayload(url, { emptyLibrary, createdFolders, emptyFolders });
    else if (url === "/api/file-folders" && init.method === "POST") {
      const input = JSON.parse(init.body);
      const folder = makeFolder(input.id, input.name, input.parentId);
      createdFolders.push(folder);
      return Response.json({ folder });
    }
    else if (url === "/api/workspace") {
      const dashboard = encodeWorkspaceState([{ id: "fixture-day", name: "Fixture day", widgets: [] }], "fixture-day", "");
      return Response.json({ initialized: true, courses: [course], dashboard, revision: baseProfile.updated_at, profile: baseProfile });
    } else throw new Error(`Unexpected fixture request: ${url}`);

    if (profileId === "profile-b" || profileId === renamedAccount) {
      if (Array.isArray(body.files)) body = { ...body, files: body.files.map((file) => ({ ...file, id: `${profileId}-${file.id}`, name: `${profileId} ${file.name}` })) };
    }
    return Response.json(body);
  };
  return { release };
}

function props({ profileId = "profile-a", layout = "list", canWrite = true, withTextCreate = false } = {}) {
  const result = {
    profileId, courses: [course], store: { files: storeFiles, url: (file) => `/api/files?id=${file.id}&account=${encodeURIComponent(profileId)}` },
    layout, onLayoutChange: (value) => callbacks.layouts.push(value),
    onUpload: (folderId, courseId) => callbacks.uploads.push({ folderId, courseId }),
    onOpen: (file) => callbacks.opened.push(file.id), onEdit: (file) => callbacks.edited.push(file.id), canWrite,
  };
  if (withTextCreate) result.onNewTextFile = (...args) => callbacks.newTextFiles.push(args);
  return result;
}

async function render(component = FilesBrowser, componentProps = props()) {
  await act(async () => { root.render(createElement(component, componentProps)); });
}

async function unmount() {
  if (!root) return;
  await act(async () => root.unmount());
  root = undefined;
  node.innerHTML = "";
}

after(() => dom.window.close());
afterEach(async () => { await unmount(); });

async function waitUntil(predicate, description, timeoutMs = 3000) {
  let remaining = timeoutMs;
  await act(async () => {
    while (!predicate() && remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      remaining -= 20;
    }
  });
  assert.ok(predicate(), `Timed out waiting for ${description}`);
}

function button(label) {
  const found = [...node.querySelectorAll("button")].find((item) => {
    const ariaLabel = item.getAttribute("aria-label") ?? "";
    return ariaLabel === label || ariaLabel.startsWith(`${label} in `) || item.textContent.trim() === label;
  });
  assert.ok(found, `Missing button ${label}`);
  return found;
}

async function click(label) {
  const control = button(label);
  await act(async () => control.click());
  return control;
}

async function clickView(label) {
  const control = [...node.querySelectorAll(".files-revamp-nav button")].find((item) => item.textContent.trim() === label);
  assert.ok(control, `Missing file view ${label}`);
  await act(async () => control.click());
}

async function openMenuFor(name) {
  const trigger = button(`More options for ${name}`);
  await act(async () => trigger.click());
  await waitUntil(() => !!node.querySelector('[role="menu"]'), `menu for ${name}`);
  return trigger;
}

function menuLabels() {
  return [...node.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim());
}

async function escapeMenu() {
  const menu = node.querySelector('[role="menu"]');
  assert.ok(menu, "context menu is open");
  await act(async () => menu.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

test("Files Browser loads scoped data, navigates by stable folder IDs, saves layout, and carries course upload scope", async () => {
  reset("/files?view=my-files&layout=list&keep=1");
  const { release } = installApi({ holdProfile: "profile-a" });
  await render();
  assert.match(node.textContent, /Loading files/);
  await waitUntil(() => requests.length === 5, "the five scoped file and folder reads");
  assert.equal(requests.length, 5);
  assert.ok(requests.every((request) => request.profileId === "profile-a" && request.method === "GET"));
  release("profile-a");
  await waitUntil(() => node.textContent.includes("Root notes.txt"), "the root file list");

  assert.ok(node.querySelector(".files-items.is-list"));
  const courseItem = [...node.querySelectorAll(".files-item")].find((item) => item.querySelector(".files-item-title strong")?.textContent === "BIO 201");
  assert.equal(courseItem?.style.getPropertyValue("--file-item-accent"), "#b23b53");

  await click("Open folder: BIO 201");
  assert.equal(new URL(window.location.href).searchParams.get("folder"), "course-root");
  assert.equal(new URL(window.location.href).searchParams.get("keep"), "1");
  await click("Open folder: Labs");
  assert.equal(new URL(window.location.href).searchParams.get("folder"), "course-labs");
  assert.match(node.querySelector(".files-breadcrumbs").textContent, /BIO 201.*Labs/);
  await click("New");
  assert.deepEqual(menuLabels(), ["Upload files", "Create new folder", "Google Slides", "Google Docs", "Google Drive"]);
  assert.equal(node.querySelectorAll('[role="menu"] [role="separator"]').length, 0, "the New menu has no dividers");
  await click("Upload files");
  assert.deepEqual(callbacks.uploads, [{ folderId: "course-labs", courseId: "biology" }]);

  await click("Grid view");
  assert.ok(node.querySelector(".files-items.is-grid"));
  assert.equal(new URL(window.location.href).searchParams.get("layout"), "grid");
  assert.equal(new URL(window.location.href).searchParams.get("folder"), "course-labs");
  assert.deepEqual(callbacks.layouts, ["grid"]);

  folderRename = { id: "course-labs", name: "Lab work renamed" };
  storeFiles = [...storeFiles];
  await render(FilesBrowser, props());
  await waitUntil(() => requests.length >= 10, "folder data refresh after a renamed store item");
  await waitUntil(() => node.querySelector(".files-content-heading h2")?.textContent === "Lab work renamed", "renamed folder data");
  assert.equal(new URL(window.location.href).searchParams.get("folder"), "course-labs");
});

test("recent activity stays separate from the main file list during folder and search navigation", async () => {
  reset("/files?view=my-files&layout=list");
  installApi();
  await render();
  await waitUntil(() => node.querySelectorAll(".files-recent-activity-item").length >= 7, "the recent activity entries");

  const recentRail = node.querySelector(".files-recent-activity");
  assert.ok(recentRail, "the browser renders a persistent Recently opened rail");
  assert.equal(node.querySelector(".files-recent-activity-heading h2 span")?.textContent, "Recently opened");
  const recentEntries = [...node.querySelectorAll(".files-recent-activity-item")];
  assert.deepEqual(recentEntries.slice(0, 6).map((entry) => entry.querySelector(".files-recent-activity-open")?.getAttribute("aria-label")), [
    "Open recently opened file: Daily planner.txt",
    "Open recently opened file: Lab setup.txt",
    "Open recently opened file: Reading summary.txt",
    "Open recently opened file: Study checklist.txt",
    "Open recently opened file: Week one.txt",
    "Open recently opened file: BIO reading.txt",
  ], "ready file previews follow last_opened_at while trashed and unavailable uploads are excluded");
  assert.ok(recentEntries.every((entry) => entry.querySelector(".files-recent-activity-preview")), "each history entry has a preview area");
  assert.ok(recentEntries.every((entry) => !entry.closest(".files-item") && !entry.querySelector('input[type="checkbox"]') && entry.getAttribute("draggable") !== "true"),
    "recent activity has no bulk-selection or drag identity that duplicates the main list");

  await act(async () => recentEntries[0].querySelector("button")?.click());
  assert.deepEqual(callbacks.opened, ["recent-a"], "activating the first recent preview opens its file");

  await click("Open folder: BIO 201");
  assert.equal(node.querySelector(".files-recent-activity"), recentRail, "the history rail remains available in a folder");
  assert.equal(node.querySelectorAll(".files-recent-activity-item").length, recentEntries.length, "folder navigation does not duplicate or replace activity entries");

  await click("Home");
  await waitUntil(() => node.querySelector(".files-items.is-list"), "the root list after returning Home");
  const search = node.querySelector('input[aria-label="Search files"]');
  assert.ok(search, "the file search control is available");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "Root");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await waitUntil(() => [...node.querySelectorAll(".files-item")].some((item) => item.textContent.includes("Root notes.txt")), "the filtered main file results");
  assert.equal([...node.querySelectorAll(".files-item")].some((item) => item.textContent.includes("Daily planner.txt")), false, "search filters the main list");
  assert.equal(node.querySelectorAll(".files-recent-activity-item").length, recentEntries.length, "search results do not replace the independent activity rail");
});

test("an empty root library offers working upload and folder actions without leaking into filtered views", async () => {
  reset("/files?view=my-files&layout=list");
  storeFiles = [];
  const emptyProfileId = "b0000000-0000-4000-8000-000000000001";
  installApi({ emptyLibrary: true });
  await render(FilesBrowser, props({ profileId: emptyProfileId }));
  await waitUntil(() => !!node.querySelector(".files-empty-home"), "the empty personal library welcome");

  const welcome = node.querySelector(".files-empty-home");
  assert.equal(welcome.querySelector("h3")?.textContent, "A home for every file.");
  assert.equal(welcome.querySelector(".files-empty-home-art")?.getAttribute("aria-hidden"), "true", "the illustration stays decorative");
  assert.ok(welcome.querySelector('[aria-label="Library features"]'), "the welcome content explains the library features");
  assert.match(node.querySelector(".files-recent-empty")?.textContent ?? "", /Files you open will appear here/, "empty recent activity describes future behavior without inventing activity");

  await click("Upload files");
  assert.deepEqual(callbacks.uploads, [{ folderId: null, courseId: "" }], "the welcome upload action uses the existing root upload flow");

  const search = node.querySelector('input[aria-label="Search files"]');
  assert.ok(search, "the empty root keeps file search available");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "no matching file");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await waitUntil(() => node.querySelector(".files-state-panel h3")?.textContent === "No files match your search", "the empty search result");
  assert.equal(node.querySelector(".files-empty-home"), null, "search results do not show the root welcome illustration");

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await waitUntil(() => !!node.querySelector(".files-empty-home"), "the root welcome after clearing search");
  const fileType = node.querySelector('select[aria-label="File type"]');
  assert.ok(fileType);
  await act(async () => {
    fileType.value = "pdf";
    fileType.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await waitUntil(() => !!node.querySelector(".files-state-panel"), "the filtered empty result");
  assert.equal(node.querySelector(".files-empty-home"), null, "file-type filters suppress the root welcome");

  await act(async () => {
    fileType.value = "all";
    fileType.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await waitUntil(() => !!node.querySelector(".files-empty-home"), "the root welcome after clearing filters");
  await click("Create folder");
  const dialog = node.querySelector('[role="dialog"][aria-labelledby="file-organization-title"]');
  assert.equal(dialog.querySelector("h2")?.textContent, "Create folder", "the welcome folder action opens the existing folder dialog");
  const folderName = dialog.querySelector('input[aria-label="Folder name"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(folderName, "Study resources");
    folderName.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(folderName.value, "Study resources");
  assert.equal(dialog.querySelector('button[type="submit"]').disabled, false, "the folder save is enabled after entering a name");
  await act(async () => dialog.querySelector('button[type="submit"]').click());
  await waitUntil(() => requests.some((request) => request.url === "/api/file-folders" && request.method === "POST"), "the folder creation request");
  await waitUntil(() => [...node.querySelectorAll(".files-item")].some((item) => item.textContent.includes("Study resources")), `the created folder in the root library (${node.textContent.slice(-220)})`);
  assert.ok(node.querySelector(".files-empty-home"), "the welcome stays while the library has no active files, even when it has folders");
  await click("Open folder: Study resources");
  await waitUntil(() => node.querySelector(".files-content-heading h2")?.textContent === "Study resources", "the created folder contents");
  assert.equal(node.querySelector(".files-empty-home"), null, "a nested empty folder uses its own empty state");
  assert.equal(node.querySelector(".files-state-panel h3")?.textContent, "This folder is empty");

  await clickView("Trash");
  await waitUntil(() => node.querySelector(".files-state-panel h3")?.textContent === "Trash is empty", "the empty Trash view");
  assert.equal(node.querySelector(".files-empty-home"), null, "Trash never shows the personal-library welcome");
});

test("the empty root welcome preserves course folders and yields to files nested inside them", async () => {
  const emptyProfileId = "b0000000-0000-4000-8000-000000000001";
  const courseFolder = makeFolder("empty-course", "CPE 281", null, { kind: "course", course_id: course.id, course_code: course.code });
  reset("/files?view=my-files&layout=list");
  storeFiles = [];
  installApi({ emptyLibrary: true, emptyFolders: [courseFolder] });
  await render(FilesBrowser, props({ profileId: emptyProfileId }));
  await waitUntil(() => !!node.querySelector(".files-empty-home"), "the empty welcome alongside a course folder");
  assert.equal(node.querySelector(".files-empty-existing-folders h3")?.textContent, "Your folders", "existing root folders have a separate, named section below the welcome");
  assert.ok([...node.querySelectorAll(".files-empty-existing-folders .files-item")].some((item) => item.textContent.includes("CPE 281")), "the course folder remains available below the welcome");

  const nestedFile = makeFile("nested-course-file", "Week 1 notes.txt", courseFolder.id, { course_id: course.id });
  reset("/files?view=my-files&layout=list");
  storeFiles = [nestedFile];
  installApi({ emptyLibrary: true, emptyFiles: [nestedFile], emptyFolders: [courseFolder] });
  await render(FilesBrowser, props({ profileId: emptyProfileId }));
  await waitUntil(() => [...node.querySelectorAll(".files-item")].some((item) => item.textContent.includes("CPE 281")), "the root course folder with a nested active file");
  assert.equal(node.querySelector(".files-empty-home"), null, "an active file in a nested course folder suppresses the empty-library welcome");
  assert.equal(node.querySelector(".files-empty-existing-folders"), null, "the empty welcome section is absent when any active library file exists");
});

test("file and folder menus expose keyboard, pointer, details, preview, edit, and download actions", async () => {
  reset("/files?view=my-files&layout=list");
  installApi();
  await render();
  await waitUntil(() => node.textContent.includes("Root notes.txt"), "the root file list");

  const trigger = await openMenuFor("Root notes.txt");
  assert.deepEqual(menuLabels(), ["Add to Starred", "Preview", "Download", "Rename file", "Move to…", "Edit details", "Details"]);
  await escapeMenu();
  assert.equal(document.activeElement, trigger, "Escape returns focus to the three-dot trigger");

  const fileRow = [...node.querySelectorAll(".files-item")].find((item) => item.textContent.includes("Root notes.txt"));
  assert.ok(fileRow);
  await act(async () => fileRow.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 70, clientY: 70 })));
  assert.deepEqual(menuLabels(), ["Add to Starred", "Preview", "Download", "Rename file", "Move to…", "Edit details", "Details"]);
  await escapeMenu();

  await act(async () => fileRow.querySelector(".files-item-main").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })));
  assert.deepEqual(menuLabels(), ["Add to Starred", "Preview", "Download", "Rename file", "Move to…", "Edit details", "Details"]);
  await escapeMenu();

  await openMenuFor("Root notes.txt");
  await act(async () => document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
  assert.equal(node.querySelector('[role="menu"]'), null, "an outside pointer press closes the menu");

  await openMenuFor("Root notes.txt");
  const download = [...node.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === "Download");
  assert.equal(download.getAttribute("download"), "Root notes.txt");
  assert.match(download.getAttribute("href"), /\/api\/files\?id=root-file&account=profile-a/);
  await click("Preview");
  assert.deepEqual(callbacks.opened, ["root-file"]);

  await openMenuFor("Root notes.txt");
  await click("Edit details");
  assert.deepEqual(callbacks.edited, ["root-file"]);

  await openMenuFor("BIO 201");
  assert.deepEqual(menuLabels(), ["Open folder", "Add to Starred", "Archive folder…", "New folder", "Details"]);
  await click("Details");
  const dialog = node.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /Biology/);
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(node.querySelector('[role="dialog"]'), null);
});

test("New, folder, background, and keyboard menus preserve destination scope and gate Archives and Trash", async () => {
  reset("/files?view=my-files&layout=list");
  installApi();
  await render(FilesBrowser, props({ withTextCreate: true }));
  await waitUntil(() => node.textContent.includes("Root notes.txt"), "the root file list");

  await click("New");
  assert.deepEqual(menuLabels(), ["Upload files", "Create new folder", "Text document", "Google Slides", "Google Docs", "Google Drive"]);
  assert.equal(node.querySelectorAll('[role="menu"] [role="separator"]').length, 0, "the New menu has no dividers");
  const googleLinks = [...node.querySelectorAll('[role="menu"] a[role="menuitem"]')];
  assert.deepEqual(googleLinks.map((link) => [link.textContent.trim(), link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]), [
    ["Google Slides", "https://slides.google.com/", "_blank", "noopener noreferrer"],
    ["Google Docs", "https://docs.google.com/", "_blank", "noopener noreferrer"],
    ["Google Drive", "https://drive.google.com/", "_blank", "noopener noreferrer"],
  ]);
  assert.equal(requests.some((request) => /^https:\/\/(slides|docs|drive)\.google\.com\//.test(request.url)), false, "opening the menu makes no Google requests");
  await click("Text document");
  assert.deepEqual(callbacks.newTextFiles, [[null, "", "Untitled (2).txt"]], "root creation increments a case-insensitive sibling name");
  await click("New");
  await click("Upload files");
  assert.deepEqual(callbacks.uploads, [{ folderId: null, courseId: "" }], "the upload option keeps its existing root destination");

  await click("Open folder: BIO 201");
  await openMenuFor("Labs");
  assert.deepEqual(menuLabels(), ["Open folder", "Add to Starred", "New text file", "New folder", "Rename folder", "Move to…", "Details"]);
  await click("New text file");
  assert.deepEqual(callbacks.newTextFiles[1], ["course-labs", "biology", "Untitled (2).txt"], "folder creation carries the folder and ancestor course ID");
  await click("Open folder: Labs");

  const content = node.querySelector(".files-browser-content");
  await act(async () => content.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 64, clientY: 72 })));
  assert.deepEqual(menuLabels(), ["Select visible", "New folder", "Text document"]);
  await click("Text document");
  assert.deepEqual(callbacks.newTextFiles[2], ["course-labs", "biology", "Untitled (2).txt"], "the background menu targets the current folder");

  const locationActions = button("Actions for Labs");
  await act(async () => locationActions.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })));
  await waitUntil(() => !!node.querySelector('[role="menu"]'), "the keyboard-opened location menu");
  assert.deepEqual(menuLabels(), ["Select visible", "New folder", "Text document"]);
  await click("Text document");
  assert.deepEqual(callbacks.newTextFiles[3], ["course-labs", "biology", "Untitled (2).txt"], "the keyboard menu uses the same destination and name rules");

  await clickView("Archives");
  await waitUntil(() => node.textContent.includes("Fall 2025"), "archived folders");
  assert.equal(button("New").disabled, true);
  await click("Open folder: Fall 2025");
  await click("Open folder: Old labs");
  await openMenuFor("Archived reading.txt");
  assert.equal(menuLabels().includes("New text file"), false, "archived files cannot open the editor creation flow");
  await escapeMenu();

  await clickView("Trash");
  await waitUntil(() => node.textContent.includes("Discarded"), "Trash folders");
  assert.equal(button("New").disabled, true);
  await click("Open folder: Discarded");
  await waitUntil(() => node.textContent.includes("Removed.txt"), "trashed files");
  await openMenuFor("Removed.txt");
  assert.deepEqual(menuLabels(), ["Restore", "Delete permanently", "Details"], "Trash offers recovery and cleanup without text editing");
});

test("native text uses Edit text while uploaded text remains a preview and is never converted", async () => {
  reset("/files?view=my-files&layout=list");
  installApi();
  await render(FilesBrowser, props({ withTextCreate: true }));
  await waitUntil(() => node.textContent.includes("Native journal.txt"), "the native and uploaded text files");

  const nativeRow = [...node.querySelectorAll(".files-item")].find((item) => item.textContent.includes("Native journal.txt"));
  assert.ok(nativeRow);
  assert.equal(nativeRow.querySelector(".files-item-main").getAttribute("aria-label"), "Edit text: Native journal.txt");
  await openMenuFor("Native journal.txt");
  assert.deepEqual(menuLabels(), ["Add to Starred", "Edit text", "Download", "Rename file", "Move to…", "Details"]);
  await click("Edit text");
  assert.deepEqual(callbacks.opened, ["native-file"]);
  assert.deepEqual(callbacks.edited, [], "native text opens the editor callback rather than upload metadata editing");
  assert.equal(storeFiles.find((file) => file.id === "native-file").content_backend, "native-text");

  await openMenuFor("Root notes.txt");
  assert.deepEqual(menuLabels(), ["Add to Starred", "Preview", "Download", "Rename file", "Move to…", "Edit details", "Details"]);
  await click("Preview");
  assert.deepEqual(callbacks.opened, ["native-file", "root-file"], "uploaded text keeps its existing preview callback");
  assert.equal(storeFiles.find((file) => file.id === "root-file").content_backend, "object");
});

test("menus ignore queued and internal scrolls but close when their anchor moves", async () => {
  reset("/files?view=my-files&layout=list");
  installApi();
  await render();
  await waitUntil(() => node.textContent.includes("Root notes.txt"), "the root file list");

  const trigger = button("More options for Root notes.txt");
  let anchorTop = 100;
  Object.defineProperty(trigger, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 40, right: 70, top: anchorTop, bottom: anchorTop + 30, width: 30, height: 30, x: 40, y: anchorTop, toJSON() {} }),
  });
  await act(async () => trigger.click());
  await waitUntil(() => !!node.querySelector('[role="menu"]'), "the file actions menu");

  await act(async () => document.dispatchEvent(new dom.window.Event("scroll")));
  assert.ok(node.querySelector('[role="menu"]'), "a queued document scroll with unchanged anchor bounds leaves the menu open");

  const menu = node.querySelector('[role="menu"]');
  await act(async () => menu.dispatchEvent(new dom.window.Event("scroll", { bubbles: true })));
  assert.ok(node.querySelector('[role="menu"]'), "scrolling inside the menu leaves it open");

  anchorTop += 40;
  await act(async () => document.dispatchEvent(new dom.window.Event("scroll")));
  await waitUntil(() => !node.querySelector('[role="menu"]'), "the menu to close after its anchor moves");
});

test("Archives disable new uploads while Trash hides active-file actions", async () => {
  reset("/files?view=my-files&layout=list");
  installApi();
  await render(FilesBrowser, props({ canWrite: false }));
  await waitUntil(() => node.textContent.includes("Root notes.txt"), "the root file list");
  assert.equal(button("New").disabled, true);
  assert.match(node.textContent, /Uploads are unavailable while this workspace is read-only/);

  await render(FilesBrowser, props({ canWrite: true }));
  await clickView("Archives");
  await waitUntil(() => node.textContent.includes("Fall 2025"), "archived folders");
  assert.equal(button("New").disabled, true);
  assert.match(node.textContent, /Upload files from My files/);
  await click("Open folder: Fall 2025");
  await click("Open folder: Old labs");
  assert.ok(node.textContent.includes("Archived reading.txt"));
  await openMenuFor("Archived reading.txt");
  assert.deepEqual(menuLabels(), ["View file", "Download", "Details"]);
  await escapeMenu();

  await clickView("Trash");
  await waitUntil(() => node.textContent.includes("Discarded"), "Trash folders");
  assert.equal(button("New").disabled, true);
  assert.match(node.textContent, /Trash is read-only/);
  await click("Open folder: Discarded");
  assert.ok(node.textContent.includes("Removed.txt"));
  await openMenuFor("Removed.txt");
  assert.deepEqual(menuLabels(), ["Restore", "Delete permanently", "Details"]);
});

test("request failures show a retry and the retry reloads all five scoped endpoints", async () => {
  reset();
  installApi({ failFirst: true });
  await render();
  await waitUntil(() => !!node.querySelector('[role="alert"]'), "the load error");
  assert.match(node.textContent, /Temporary fixture failure/);
  await click("Retry loading");
  await waitUntil(() => node.textContent.includes("Root notes.txt"), "the retried file list");
  assert.equal(requests.length, 10);
  assert.ok(requests.every((request) => request.profileId === "profile-a"));
});

test("a profile switch fences off the old account response", async () => {
  reset();
  const api = installApi({ holdProfile: "profile-a" });
  await render(FilesBrowser, props({ profileId: "profile-a" }));
  await waitUntil(() => requests.length === 5, "profile A requests");
  await render(FilesBrowser, props({ profileId: "profile-b" }));
  await waitUntil(() => node.textContent.includes("profile-b Root notes.txt"), "profile B files");
  assert.doesNotMatch(node.textContent, /profile-a/);
  api.release("profile-a");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  assert.match(node.textContent, /profile-b Root notes\.txt/);
  assert.doesNotMatch(node.textContent, /profile-a Root notes\.txt/);
  assert.ok(requests.filter((request) => request.profileId === "profile-b").length >= 5);
});

test("workspace keeps the legacy files screen by default and renders Files Browser only when enabled", async () => {
  reset("/files");
  installApi();
  await render(Workspace, { initialProfile: baseProfile });
  await waitUntil(() => node.textContent.includes("Your private files"), "the default legacy files page");
  assert.equal(node.querySelector(".files-browser"), null);
  assert.equal(requests.filter((request) => request.url.startsWith("/api/file-folders?")).length, 0);
  await unmount();

  reset("/files");
  installApi();
  await render(Workspace, { initialProfile: baseProfile, filesBrowserEnabled: true });
  await waitUntil(() => node.querySelector(".files-browser") && node.textContent.includes("BIO 201"), "the enabled Files Browser page");
  assert.ok(requests.filter((request) => request.url.startsWith("/api/file-folders?")).length >= 3);
  assert.ok(requests.filter((request) => request.profileId === baseProfile.id).length >= 6);

  const brand = node.querySelector(".files-revamp-brand");
  assert.ok(brand, "the Files top bar includes the product brand");
  assert.equal(brand.getAttribute("href"), "/", "the brand link returns to the main workspace");
  const fileNavigation = node.querySelector('nav.files-revamp-nav[aria-label="File navigation"]');
  assert.ok(fileNavigation, "Files has its dedicated top navigation");
  assert.equal(node.querySelectorAll(".files-revamp-nav").length, 1, "the top navigation has one mounted instance");
  assert.deepEqual([...fileNavigation.querySelectorAll(".files-revamp-nav-link span")].map((item) => item.textContent.trim()), [
    "Files", "Starred", "Pinned", "Courses", "Archives", "Trash",
  ]);
  assert.ok(node.querySelector(".files-recent-activity"), "the root view includes a recently opened activity panel");
  assert.ok(node.querySelector('select[aria-label="Files view"]'), "the main view selector is present");
  assert.ok(node.querySelector('select[aria-label="Course filter"]'), "the course filter is present");
  assert.ok(node.querySelector('select[aria-label="File type"]'), "the file type filter is present");
  assert.ok(node.querySelector('select[aria-label="Sort by"]'), "the sort control is present");
  assert.ok(node.querySelector(".files-revamp-top-search [aria-label='Search files']"), "the top bar has file search");
  assert.ok(node.querySelector(".files-revamp-new .files-new-button"), "the top bar has New actions");

  const sidebar = node.querySelector("#workspace-sidebar");
  assert.ok(sidebar, "the primary workspace sidebar remains mounted on Files");
  const filesLink = sidebar.querySelector('a[aria-label="Files"]');
  assert.ok(filesLink, "Files uses the normal workspace sidebar link");
  assert.equal(sidebar.querySelectorAll('a[aria-label="Files"]').length, 1, "the sidebar has one Files link");
  assert.equal(filesLink.getAttribute("href"), "/files", "the Files link points to the Files route");
  assert.equal(filesLink.getAttribute("aria-current"), "page", "the Files link is active on the Files route");
  assert.equal(sidebar.querySelector('button[aria-label="Files"]'), null, "Files is not a disclosure toggle");
  assert.equal(node.querySelector("#files-primary-navigation-slot"), null, "the Files-only sidebar slot is absent");
  assert.equal(node.querySelector(".files-primary-navigation"), null, "the Files-only sidebar submenu is absent");

  const initialHistoryLength = window.history.length;
  const viewSelector = node.querySelector('select[aria-label="Files view"]');
  await act(async () => {
    viewSelector.value = "recent";
    viewSelector.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await waitUntil(() => new URL(window.location.href).searchParams.get("view") === "recent", "the Recent view from the main selector");
  assert.equal(viewSelector.value, "recent", "the main view selector controls the Files view");
  assert.ok(window.history.length > initialHistoryLength, "changing the Files view adds a browser history entry");

  await act(async () => fileNavigation.querySelector('[aria-label="Show starred files"]').click());
  await waitUntil(() => new URL(window.location.href).searchParams.get("view") === "starred" && node.textContent.includes("BIO reading.txt"), "the Starred files and folders");
  assert.equal(node.querySelector('select[aria-label="Files view"]').value, "starred", "the top navigation route is reflected in the main view selector");
  assert.equal(fileNavigation.querySelector('[aria-label="Show starred files"]')?.getAttribute("aria-current"), "page", "the top navigation marks Starred as active");
  assert.ok([...node.querySelectorAll(".files-item")].some((item) => item.textContent.includes("Class notes")), "a starred folder remains available in Starred");

  const pinnedTrigger = fileNavigation.querySelector('button[aria-label="Show pinned folders"]');
  assert.ok(pinnedTrigger, "the Pinned top navigation control is available");
  await act(async () => pinnedTrigger.click());
  const pinnedPopover = node.querySelector('[role="group"][aria-label="Pinned folders"]');
  assert.ok(pinnedPopover, "Pinned opens its folder picker");
  const pinnedFolder = [...pinnedPopover.querySelectorAll("button")].find((item) => item.textContent.trim() === "Class notes");
  assert.ok(pinnedFolder, "the picker includes the starred Class notes folder");
  const topPinTrigger = pinnedPopover.querySelector(".files-primary-pin-action");
  assert.ok(topPinTrigger, "the top navigation retains its own Pin folder action");
  await act(async () => topPinTrigger.click());
  assert.equal(node.querySelectorAll("#files-primary-pinned-picker").length, 0, "the removed sidebar does not mount a pin picker");
  assert.equal(node.querySelectorAll("#files-pinned-picker").length, 1, "the top navigation keeps one pin picker");
  await act(async () => pinnedFolder.click());
  await waitUntil(() => new URL(window.location.href).searchParams.get("folder") === "personal-root", "the pinned folder destination");
  await click("Home");
  await waitUntil(() => new URL(window.location.href).searchParams.get("view") === "my-files" && !new URL(window.location.href).searchParams.has("folder"), "the Files Home destination");

  const courseTrigger = fileNavigation.querySelector('button[aria-label="Show course folders"]');
  await act(async () => courseTrigger.click());
  const coursePopover = node.querySelector('[role="group"][aria-label="Course folders"]');
  assert.ok(coursePopover, "Courses opens its course-folder picker");
  const courseFolder = [...coursePopover.querySelectorAll("button")].find((item) => item.textContent.trim() === "BIO 201");
  assert.ok(courseFolder, "the Courses picker includes the Biology folder");
  await act(async () => courseFolder.click());
  await waitUntil(() => new URL(window.location.href).searchParams.get("folder") === "course-root", "the course folder destination");
  assert.match(node.querySelector(".files-content-heading h2")?.textContent ?? "", /BIO 201/);

  await click("Archives");
  await waitUntil(() => new URL(window.location.href).searchParams.get("view") === "archives", "the Archives view");
  assert.ok(node.querySelector(".files-state-panel") || node.querySelector(".files-items"), "Archives renders a usable view");
  await act(async () => fileNavigation.querySelector(".files-revamp-nav-link")?.click());
  await waitUntil(() => new URL(window.location.href).searchParams.get("view") === "my-files", "the Files root after Archives");
  await click("List view");
  assert.ok(node.querySelector(".files-items.is-list"), "the list layout remains available");
  await click("Grid view");
  assert.ok(node.querySelector(".files-items.is-grid"), "the card grid remains available");

  const homeLink = node.querySelector('#workspace-sidebar a[aria-label="Home"]');
  assert.ok(homeLink, "the primary workspace still exposes its Home route");
  await act(async () => homeLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
  await waitUntil(() => node.querySelector(".home-page"), "the Home route");
  assert.equal(node.querySelector(".files-revamp-nav"), null, "the Files top navigation is removed on Home");
  assert.equal(node.querySelector(".files-primary-navigation"), null, "the Files-only sidebar submenu remains absent on Home");
  assert.equal(node.querySelector("#workspace-sidebar"), sidebar, "the primary sidebar remains mounted on Home");

  const homeFilesLink = node.querySelector('#workspace-sidebar a[aria-label="Files"]');
  assert.ok(homeFilesLink, "the workspace keeps its ordinary Files link on Home");
  assert.equal(homeFilesLink.getAttribute("href"), "/files");
  await act(async () => homeFilesLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
  await waitUntil(() => node.querySelector(".files-revamp-nav"), "the Files top navigation after returning to Files");
  assert.equal(node.querySelectorAll(".files-revamp-nav").length, 1, "returning to Files restores one top navigation");
  assert.equal(node.querySelector("#workspace-sidebar"), sidebar, "the primary sidebar remains mounted after returning to Files");
  assert.equal(node.querySelectorAll('#workspace-sidebar a[aria-label="Files"]').length, 1, "returning to Files keeps one ordinary Files link");
  assert.equal(node.querySelector('#workspace-sidebar a[aria-label="Files"]')?.getAttribute("href"), "/files");
  assert.equal(node.querySelector('#workspace-sidebar a[aria-label="Files"]')?.getAttribute("aria-current"), "page", "the Files link is active after returning to Files");
  assert.equal(node.querySelector('#workspace-sidebar button[aria-label="Files"]'), null, "returning to Files does not create a disclosure toggle");
  assert.equal(node.querySelector("#files-primary-navigation-slot"), null);
  assert.equal(node.querySelector(".files-primary-navigation"), null);
});
