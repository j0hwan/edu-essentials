import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/files" });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLFormElement", "HTMLButtonElement", "HTMLAnchorElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent", "KeyboardEvent", "Event", "FormData"]) {
  globalThis[name] = dom.window[name];
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback) => setTimeout(() => callback(Date.now()), 0) });
Object.defineProperty(dom.window, "cancelAnimationFrame", { configurable: true, value: (id) => clearTimeout(id) });
dom.window.confirm = () => true;

const [{ createElement, act }, { createRoot }, { SyllabusAttachment, SyllabusTextPreview }, { default: FilesBrowser }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/course-syllabus.tsx")),
  import(await clientModule("app/files-browser.tsx")),
]);

const course = { id: "biology", code: "BIO 201", name: "Biology", credits: 4, instructor: "Dr. Moss", room: "Science 2", color: "#b23b53", soft: "#b23b5318", initials: "BIO" };
const sourceFile = {
  id: "source-file", name: "BIO 201 syllabus.pdf", mime_type: "application/pdf", size_bytes: 128,
  course_id: course.id, assignment_id: null, kind: "syllabus", state: "ready",
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-03T00:00:00.000Z",
  content_sha256: null, folder_id: "course-root", content_backend: "object", metadata_revision: 1,
  content_revision: 1, trashed_at: null, trash_operation_id: null, original_folder_id: null,
};
const makeFolder = (id, name, parent_id = null, overrides = {}) => ({
  id, name, parent_id, kind: "custom", course_id: null, course_code: null, revision: 1,
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-03T00:00:00.000Z",
  archived_at: null, semester_label: null, course_name_snapshot: null, course_color_snapshot: null,
  trashed_at: null, trash_operation_id: null, original_parent_id: null, ...overrides,
});
const folders = [
  makeFolder("course-root", "BIO 201", null, { kind: "course", course_id: course.id, course_code: course.code }),
  makeFolder("course-labs", "Labs", "course-root"),
];
const emptyActivities = { files: [], folders: [] };
const node = document.getElementById("root");
let root;
let alerts = [];
let downloads = [];
let browserCallbacks;
let activeFiles = [sourceFile];
let browserRequests = 0;

globalThis.fetch = async (input) => {
  browserRequests++;
  const url = String(input);
  if (url === "/api/files?view=active") return Response.json({ files: activeFiles, activities: emptyActivities });
  if (url === "/api/files?view=trash") return Response.json({ files: [], activities: emptyActivities });
  if (url === "/api/file-folders?view=active") return Response.json({ folders, activities: emptyActivities });
  if (url === "/api/file-folders?view=archives" || url === "/api/file-folders?view=trash") return Response.json({ folders: [], activities: emptyActivities });
  throw new Error(`Unexpected syllabus UI request: ${url}`);
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
URL.createObjectURL = (blob) => { downloads.push({ blob, anchor: null }); return `blob:syllabus-${downloads.length}`; };
URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {
  const last = downloads.at(-1);
  if (last) last.anchor = { href: this.href, download: this.download };
};
window.alert = (message) => alerts.push(message);

function reset(path = "/files") {
  alerts = [];
  downloads = [];
  activeFiles = [sourceFile];
  browserCallbacks = { opened: [], syllabusText: [], attached: [] };
  browserRequests = 0;
  window.history.replaceState({}, "", path);
  node.innerHTML = "";
  root = createRoot(node);
}

async function render(component, props) {
  await act(async () => root.render(createElement(component, props)));
}

async function unmount() {
  if (!root) return;
  await act(async () => root.unmount());
  root = undefined;
  node.innerHTML = "";
}

after(() => {
  dom.window.close();
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else delete URL.createObjectURL;
  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
  else delete URL.revokeObjectURL;
  window.HTMLAnchorElement.prototype.click = originalAnchorClick;
});
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

function labeledControl(label) {
  const labelNode = [...node.querySelectorAll("label")].find((item) => item.textContent.trim().startsWith(label));
  assert.ok(labelNode, `Missing label ${label}`);
  const control = labelNode.querySelector("input,textarea,select");
  assert.ok(control, `${label} has an editable control`);
  return control;
}

async function click(text) {
  const button = [...node.querySelectorAll("button")].find((item) => item.textContent.trim() === text || item.getAttribute("aria-label") === text);
  assert.ok(button, `Missing button ${text}`);
  await act(async () => button.click());
  return button;
}

test("existing-course syllabus attachment keeps the complete draft and identity on save failure", async () => {
  reset();
  const details = {
    officeHours: "Friday by appointment",
    meetings: [{ id: "meeting-a", days: [2], start: "09:30", end: "10:45", from: "2026-09-01", until: "2026-12-15", location: "Hall 2" }],
    syllabusText: "Current source text",
    syllabusName: "Current guide",
    syllabusFileId: sourceFile.id,
  };
  const savedValues = [];
  let shouldFail = true;
  const store = { files: [sourceFile], busy: false, url: () => "/private/source", blob: async () => new Blob(["pdf"]) };
  const editorProps = {
    courseId: course.id, course, details, folderId: "course-root", store,
    canWrite: true,
    async onSave(value) {
      savedValues.push(value);
      if (shouldFail) throw new Error("Workspace save failed. Retry when online.");
    },
    onClose() { browserCallbacks.closed = true; },
  };
  await render(SyllabusAttachment, editorProps);

  const text = labeledControl("Syllabus text");
  text.focus();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(text, "Keep this Unicode draft: 日本語, résumé, ✓");
    text.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(document.activeElement, text, "typing stays focused in the syllabus text field");
  await render(SyllabusAttachment, { ...editorProps, onClose() { browserCallbacks.parentRerenderClose = true; } });
  assert.equal(document.activeElement, text, "a parent rerender with a new close callback does not steal focus");
  await click("Save syllabus");
  await waitUntil(() => node.querySelector('[role="alert"]')?.textContent.includes("Workspace save failed"), "syllabus save error");

  assert.equal(node.querySelector('[role="dialog"]').getAttribute("aria-label"), "Attach syllabus for BIO 201");
  assert.equal(labeledControl("Syllabus text").value, "Keep this Unicode draft: 日本語, résumé, ✓");
  assert.equal(savedValues[0].syllabusFileId, sourceFile.id, "the original uploaded source ID remains in the draft");
  assert.equal(savedValues[0].syllabusText, "Keep this Unicode draft: 日本語, résumé, ✓");
  assert.equal(browserCallbacks.closed, undefined, "a failed workspace write keeps the editor open");
  assert.equal(node.querySelector('input[type="file"]'), null, "no upload is started by a text save");
  assert.equal([...node.querySelectorAll("button")].some((button) => /Suggest dated items|Approve class and items|Create assignments|Extract/i.test(button.textContent)), false);
  assert.equal([...node.querySelectorAll("label")].some((label) => /Course code|Class name|Assignment title/.test(label.textContent)), false);

  shouldFail = false;
  await click("Save syllabus");
  assert.deepEqual(savedValues[1], savedValues[0], "retry sends the identical course-bound source and text draft");
  await waitUntil(() => browserCallbacks.parentRerenderClose, "successful syllabus close through the latest parent callback");
});

test("nested upload and file preview dialogs suspend the outer Escape trap and restore focus", async () => {
  reset();
  const details = { officeHours: "", meetings: [], syllabusText: "Saved text", syllabusFileId: sourceFile.id };
  const store = { files: [sourceFile], busy: false, url: () => "/private/source", blob: async () => new Blob(["Uploaded syllabus preview"]) };
  let closeCalls = 0;
  await render(SyllabusAttachment, {
    courseId: course.id, course, details, folderId: "course-root", store, canWrite: true,
    async onSave() {}, onClose() { closeCalls++; },
  });

  const previewTrigger = [...node.querySelectorAll("button")].find((button) => button.textContent.trim() === "Preview source");
  assert.ok(previewTrigger);
  await act(async () => previewTrigger.click());
  await waitUntil(() => node.querySelector('[aria-label="Private file preview"]'), "nested uploaded-file preview");
  const outer = node.querySelector(".syllabus-attachment-modal");
  assert.equal(outer.getAttribute("aria-hidden"), "true");
  assert.ok(outer.hasAttribute("inert"), "the syllabus editor is inert under the nested preview");
  const preview = node.querySelector('[aria-label="Private file preview"]');
  const previewClose = [...preview.querySelectorAll("button")].find((button) => button.textContent.trim() === "Close file preview");
  assert.equal(document.activeElement, previewClose, "the topmost preview receives initial focus");
  await waitUntil(() => preview.querySelectorAll("button:not(:disabled),a[href]").length >= 3, "preview links for nested focus trapping");
  const previewFocusables = [...preview.querySelectorAll("button:not(:disabled),a[href]")];
  previewFocusables.at(-1).focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, previewClose, "Tab wraps to the first control inside the preview");
  previewClose.focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, previewFocusables.at(-1), "Shift+Tab wraps to the last control inside the preview");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(node.querySelector('[aria-label="Private file preview"]'), null, "Escape closes only the topmost preview");
  assert.equal(closeCalls, 0);
  assert.equal(outer.hasAttribute("inert"), false);
  assert.equal(document.activeElement, previewTrigger, "closing preview restores focus to its trigger");

  const uploadTrigger = [...node.querySelectorAll("button")].find((button) => button.textContent.trim() === "Replace upload");
  assert.ok(uploadTrigger);
  await act(async () => uploadTrigger.click());
  const fileEditor = node.querySelector('[aria-label="File editor"]');
  assert.ok(fileEditor, "the nested file editor opens");
  assert.equal(outer.getAttribute("aria-hidden"), "true");
  assert.ok(outer.hasAttribute("inert"));
  const uploadClose = [...fileEditor.querySelectorAll("button")].find((button) => button.textContent.trim() === "Close file editor");
  assert.equal(document.activeElement, uploadClose, "the topmost file editor receives initial focus");
  const uploadFocusables = [...fileEditor.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]")];
  uploadFocusables.at(-1).focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, uploadClose, "Tab wraps to the first control inside the upload editor");
  uploadClose.focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, uploadFocusables.at(-1), "Shift+Tab wraps to the last control inside the upload editor");
  const chooser = fileEditor.querySelector('input[type="file"]');
  Object.defineProperty(chooser, "files", { configurable: true, value: [new File(["replacement"], "replacement.pdf", { type: "application/pdf" })] });
  await act(async () => chooser.dispatchEvent(new Event("change", { bubbles: true })));
  const confirmations = [];
  window.confirm = (message) => { confirmations.push(message); return false; };
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.ok(node.querySelector('[aria-label="File editor"]'), "cancelling the dirty-upload confirmation keeps the editor open");
  assert.match(confirmations[0], /Discard this file selection/);
  assert.equal(closeCalls, 0);
  window.confirm = () => true;
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(node.querySelector('[aria-label="File editor"]'), null, "Escape closes the dirty upload after confirmation");
  assert.equal(outer.hasAttribute("inert"), false);
  assert.equal(document.activeElement, uploadTrigger, "closing upload editor restores focus to its trigger");
});

test("saved syllabus references stay usable when cached file metadata has no course association", async () => {
  reset();
  const cachedPersonalSource = { ...sourceFile, course_id: null, assignment_id: null };
  const details = { officeHours: "", meetings: [], syllabusText: "Saved secondary text", syllabusName: "Course guide", syllabusFileId: cachedPersonalSource.id };
  const store = { files: [cachedPersonalSource], busy: false, url: () => "/private/source", blob: async () => new Blob(["pdf"]) };
  await render(SyllabusAttachment, {
    courseId: course.id, course, details, folderId: "course-root", store, canWrite: true,
    async onSave() {}, onClose() {},
  });
  assert.equal(node.querySelector('[role="alert"]'), null, "an existing exact syllabus reference is not rejected for cached course metadata");
  assert.match(node.querySelector('[aria-label="Uploaded syllabus source"]').textContent, /BIO 201 syllabus\.pdf/);
  await click("Preview source");
  await waitUntil(() => node.querySelector('[aria-label="Private file preview"]'), "cached personal source preview");
  await click("Close file preview");

  await unmount();
  reset("/files");
  activeFiles = [cachedPersonalSource];
  const browserProps = {
    profileId: "profile-a", courses: [course], courseDetails: { biology: details },
    store: { files: [cachedPersonalSource], url: () => "/private/source", blob: async () => new Blob(["pdf"]) },
    layout: "list", onLayoutChange() {}, onUpload() {}, onOpen() {}, onOpenSyllabus() {}, onEdit() {}, canWrite: true,
    onAttachSyllabus() {}, onSyllabusText() {},
  };
  await render(FilesBrowser, browserProps);
  await waitUntil(() => node.querySelector('[aria-label="Open folder: BIO 201"]'), "managed course folder with cached personal source");
  await click("Open folder: BIO 201");
  await waitUntil(() => node.querySelector(".files-syllabus-pin"), "pin for cached personal source");
  assert.match(node.querySelector(".files-syllabus-pin").textContent, /BIO 201 syllabus\.pdf/);
  assert.equal(node.querySelectorAll(".files-item:not(.is-folder)").length, 1, "only the pin remains; the exact-ID source has no duplicate ordinary row");
});

test("pasted syllabus preview is read-only and downloads Unicode UTF-8 as a .txt file", async () => {
  reset();
  const text = "Study résumé — 日本語 ✓\nExam date: October 15";
  await render(SyllabusTextPreview, { course, text, name: "BIO syllabus / Fall 2026.pdf", onClose() {} });

  assert.equal(node.querySelector('[role="dialog"] .syllabus-text-preview-content').textContent, text);
  assert.equal(node.querySelectorAll("input,textarea,select").length, 0, "saved syllabus content has no editing controls");
  await click("Download .txt");
  assert.equal(downloads.length, 1);
  assert.equal(await downloads[0].blob.text(), text);
  assert.match(downloads[0].anchor.href, /^blob:syllabus-/);
  assert.equal(downloads[0].anchor.download, "BIO syllabus - Fall 2026.txt");
});

test("a referenced upload appears once in its course root and once in its moved folder", async () => {
  reset();
  browserCallbacks = { opened: [], syllabusText: [], attached: [] };
  const details = {
    biology: { officeHours: "", meetings: [], syllabusText: "Secondary text source", syllabusName: "BIO text guide", syllabusFileId: sourceFile.id },
  };
  const browserProps = {
    profileId: "profile-a", courses: [course], courseDetails: details,
    store: { files: [sourceFile], url: () => "/private/source", blob: async () => new Blob(["pdf"]) },
    layout: "list", onLayoutChange() {}, onUpload() {},
    onOpen: (file) => browserCallbacks.opened.push(file.id),
    onOpenSyllabus: (file) => browserCallbacks.opened.push(file.id),
    onEdit() {}, canWrite: true,
    onAttachSyllabus: (courseId, folderId) => browserCallbacks.attached.push({ courseId, folderId }),
    onSyllabusText: (courseId) => browserCallbacks.syllabusText.push(courseId),
  };
  await render(FilesBrowser, browserProps);
  await waitUntil(() => node.querySelector('[aria-label="Open folder: BIO 201"]'), "managed course folder");
  await click("Open folder: BIO 201");
  await waitUntil(() => node.querySelector(".files-syllabus-pin"), "pinned course syllabus");
  assert.equal(node.querySelectorAll(".files-syllabus-pin").length, 1);
  assert.equal(node.querySelectorAll(".files-item:not(.is-folder)").length, 1, "the root pin replaces the ordinary source-file row");
  assert.equal(node.querySelector(".files-syllabus-pin").textContent.includes("View uploaded file"), true);
  assert.equal(node.querySelector(".files-syllabus-pin").textContent.includes("View text"), true, "secondary syllabus text remains available with an upload");

  activeFiles = [{ ...sourceFile, folder_id: "course-labs" }];
  await render(FilesBrowser, { ...browserProps, store: { ...browserProps.store, files: activeFiles } });
  await waitUntil(() => browserRequests >= 10, "file list reload after moving the source");
  await click("Open folder: Labs");
  await waitUntil(() => node.querySelector('[aria-label="More options for BIO 201 syllabus.pdf"]'), "moved source file");
  assert.equal(node.querySelectorAll(".files-syllabus-pin").length, 0, "the pin stays at the managed root after the source moves");
  assert.equal(node.querySelectorAll(".files-item:not(.is-folder)").length, 1, "the moved source has one ordinary row in its current folder");

  await click("BIO 201");
  await waitUntil(() => node.querySelector(".files-syllabus-pin"), "root pin after return");
  assert.equal(node.querySelectorAll(".files-syllabus-pin").length, 1);
  assert.equal(node.querySelectorAll(".files-item:not(.is-folder)").length, 1, "the root view still has one pinned source reference and no duplicate file row");
});

test("an empty managed course folder offers a pinned syllabus upload action", async () => {
  reset();
  activeFiles = [];
  const attached = [];
  await render(FilesBrowser, {
    profileId: "profile-a", courses: [course], courseDetails: {},
    store: { files: [], url: () => "", blob: async () => new Blob() },
    layout: "list", onLayoutChange() {}, onUpload() {}, onOpen() {}, onEdit() {}, canWrite: true,
    onAttachSyllabus: (courseId, folderId) => attached.push({ courseId, folderId }),
    onSyllabusText() {},
  });
  await waitUntil(() => node.querySelector('[aria-label="Open folder: BIO 201"]'), "managed course folder");
  await click("Open folder: BIO 201");
  await waitUntil(() => node.querySelector(".files-syllabus-pin"), "empty pinned syllabus entry");

  assert.match(node.querySelector(".files-syllabus-pin").textContent, /No syllabus attached/);
  await click("Upload syllabus");
  assert.deepEqual(attached, [{ courseId: course.id, folderId: "course-root" }]);
});
