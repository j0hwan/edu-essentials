import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/courses" });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Event", "MouseEvent", "MutationObserver"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "File", { configurable: true, value: NodeFile });
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback) => setTimeout(() => callback(Date.now()), 0) });
Object.defineProperty(dom.window, "cancelAnimationFrame", { configurable: true, value: (id) => clearTimeout(id) });

const [React, ReactDom, syllabusModule, { hashBytes }] = await Promise.all([
  import("react"), import("react-dom/client"), import(await clientModule("app/course-syllabus-upload.tsx")), import(await clientModule("lib/files.ts")),
]);
const CourseSyllabusUpload = syllabusModule.default ?? syllabusModule.CourseSyllabusUpload;
const { createElement, act } = React;
const rootNode = document.getElementById("root");
const SESSION = { profileId: "profile-a", generation: 4 };
const COURSE = { id: "biology-101", code: "BIO 101", name: "Biology", credits: 3, instructor: "", room: "", color: "#5b63e8", soft: "#5b63e818", initials: "BI" };
let root;
window.confirm = () => true;

async function render(props = {}) {
  if (!root) root = ReactDom.createRoot(rootNode);
  await act(async () => root.render(createElement(CourseSyllabusUpload, {
    session: SESSION, course: COURSE, store: { upload: async () => { throw new Error("unexpected upload"); } },
    canWrite: true, onSave: async () => {}, onClose: () => root.render(null), ...props,
  })));
}
async function waitFor(predicate, message = "Timed out waiting for syllabus upload.") {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await act(async () => new Promise((resolve) => setTimeout(resolve, 0))); }
  assert.fail(message);
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function makeFile(name = "BIO 101 syllabus.pdf", content = "syllabus bytes", type = "application/pdf") { return new File([content], name, { type, lastModified: 1_791_500_000_000 }); }
async function ack(file, metadata, id) {
  return { id, name: metadata.name, mime_type: file.type, size_bytes: file.size, course_id: metadata.courseId || null,
    assignment_id: metadata.assignmentId || null, kind: metadata.kind, state: "ready", created_at: "2026-10-09T00:00:00.000Z",
    updated_at: "2026-10-09T00:00:00.000Z", content_sha256: await hashBytes(new Uint8Array(await file.arrayBuffer())),
    folder_id: metadata.folderId ?? null, content_backend: "object", metadata_revision: 1, content_revision: 1,
    trashed_at: null, trash_operation_id: null, original_folder_id: null };
}
function input() { return document.querySelector('input[type="file"]'); }
function selectFiles(files) { Object.defineProperty(input(), "files", { configurable: true, value: files }); input().dispatchEvent(new dom.window.Event("change", { bubbles: true })); }

let idSequence = 0;
Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => `10000000-0000-4000-8000-${String(++idSequence).padStart(12, "0")}` });

afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
  rootNode.innerHTML = "";
  idSequence = 0;
});

test("shows the minimal accessible syllabus import dialog", async () => {
  await render();
  const dialog = document.querySelector('[role="dialog"][aria-label="Import syllabus"]');
  assert.ok(dialog);
  assert.ok(dialog.querySelector(".course-syllabus-dropzone"));
  assert.match(dialog.textContent, /Choose a file or drag & drop it here/);
  assert.match(dialog.textContent, /Browse File/);
  assert.match(dialog.textContent, /25 MiB/);
  assert.equal(dialog.querySelectorAll("textarea, select").length, 0);
  assert.equal(dialog.querySelectorAll("input:not([type=file])").length, 0);
  assert.ok(dialog.querySelector('button[aria-label="Close syllabus import"]'));
  assert.equal(input().multiple, false);
  assert.equal(input().accept, "");
});

test("browse uploads one selected file with syllabus and course metadata, then saves and refreshes", async () => {
  const selected = makeFile();
  const calls = [], saves = [], refreshes = [];
  const store = { upload: async (file, metadata, id, options) => { calls.push({ file, metadata, id }); options.onProgress(file.size / 2, file.size); return ack(file, metadata, id); }, refresh: async () => refreshes.push(true) };
  await render({ store, onSave: async (value) => saves.push(value) });
  await act(async () => selectFiles([selected]));
  await waitFor(() => document.querySelector('[role=dialog]') === null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, selected, "the exact selected File object reaches store.upload");
  assert.equal(calls[0].metadata.kind, "syllabus");
  assert.equal(calls[0].metadata.courseId, COURSE.id);
  assert.equal(calls[0].metadata.folderId, null);
  assert.deepEqual(saves, [{ syllabusText: "", syllabusName: selected.name, syllabusFileId: calls[0].id }]);
  assert.equal(refreshes.length, 1);
});

test("drop uploads the dropped file and reports progress", async () => {
  const selected = makeFile("syllabus.weird", "arbitrary bytes", "application/x-unusual");
  const progress = [];
  const pending = deferred();
  const store = { upload: async (file, metadata, id, options) => { options.onProgress(5, 10); progress.push(file); await pending.promise; return ack(file, metadata, id); }, refresh: async () => {} };
  await render({ store });
  const zone = document.querySelector(".course-syllabus-dropzone");
  const transfer = { files: [selected], types: ["Files"], items: [], dropEffect: "none" };
  const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  await act(async () => { zone.dispatchEvent(event); });
  await waitFor(() => progress.length === 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(progress[0], selected);
  assert.ok(document.querySelector("progress"), "upload progress is exposed while the dialog remains open");
  assert.equal(document.querySelector("progress").value, 50);
  await act(async () => pending.resolve());
});

test("rejects oversize and multiple file selections without uploading", async () => {
  let uploads = 0;
  const store = { upload: async () => { uploads++; }, refresh: async () => {} };
  await render({ store });
  const oversized = makeFile("too-large.pdf");
  Object.defineProperty(oversized, "size", { value: 25 * 1024 * 1024 + 1 });
  await act(async () => selectFiles([oversized]));
  assert.match(document.querySelector('[role=alert]')?.textContent ?? document.body.textContent, /25 MiB/i);
  await act(async () => selectFiles([makeFile("a.pdf"), makeFile("b.pdf")]));
  assert.equal(uploads, 0);
});

test("retry after upload failure reuses the same file and ID", async () => {
  const selected = makeFile();
  const calls = [];
  let fail = true;
  const store = { upload: async (file, metadata, id) => { calls.push({ file, metadata, id }); if (fail) { fail = false; throw new Error("temporary network failure"); } return ack(file, metadata, id); }, refresh: async () => {} };
  const saves = [];
  await render({ store, onSave: async (value) => saves.push(value) });
  await act(async () => selectFiles([selected]));
  await waitFor(() => Boolean(document.querySelector('[role=alert]')));
  const retry = [...document.querySelectorAll("button")].find((button) => /retry/i.test(button.textContent));
  assert.ok(retry);
  await act(async () => retry.click());
  await waitFor(() => document.querySelector('[role=dialog]') === null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].file, calls[0].file);
  assert.equal(calls[1].id, calls[0].id);
  assert.deepEqual(saves, [{ syllabusText: "", syllabusName: selected.name, syllabusFileId: calls[0].id }]);
});

test("save or refresh failure retries acknowledged work without uploading again", async () => {
  for (const failurePoint of ["save", "refresh"]) {
    const selected = makeFile();
    let uploads = 0, saves = 0, refreshes = 0;
    let fail = true;
    const store = { upload: async (file, metadata, id) => { uploads++; return ack(file, metadata, id); }, refresh: async () => { refreshes++; if (failurePoint === "refresh" && fail) { fail = false; throw new Error("refresh failed"); } } };
    await render({ store, onSave: async () => { saves++; if (failurePoint === "save" && fail) { fail = false; throw new Error("save failed"); } } });
    await act(async () => selectFiles([selected]));
    await waitFor(() => Boolean(document.querySelector('[role=alert]')));
    const retry = [...document.querySelectorAll("button")].find((button) => /retry/i.test(button.textContent));
    assert.ok(retry, `${failurePoint} error offers retry`);
    await act(async () => retry.click());
    await waitFor(() => document.querySelector('[role=dialog]') === null);
    assert.equal(uploads, 1, `${failurePoint} retry does not reupload`);
    assert.equal(saves, failurePoint === "save" ? 2 : 1);
    assert.equal(refreshes, failurePoint === "refresh" ? 2 : 1);
  }
});

test("close and unmount fence a late upload response from saving", async () => {
  const pending = deferred();
  const saves = [];
  const calls = [];
  const store = { upload: (file, metadata, id) => { calls.push({ file, metadata, id }); return pending.promise; }, refresh: async () => {} };
  await render({ store, onSave: async (value) => saves.push(value) });
  await act(async () => selectFiles([makeFile()]));
  await waitFor(() => calls.length === 1);
  await act(async () => document.querySelector('button[aria-label="Close syllabus import"]').click());
  await waitFor(() => document.querySelector('[role=dialog]') === null);
  await act(async () => pending.resolve(await ack(calls[0].file, calls[0].metadata, calls[0].id)));
  assert.deepEqual(saves, []);
});

test("account session changes fence upload completion even after returning to the original profile", async () => {
  const pending = deferred();
  const calls = [], saves = [];
  const store = { upload: (file, metadata, id, options) => { calls.push({ file, metadata, id, options }); return pending.promise; }, refresh: async () => {} };
  const onSave = async (value) => saves.push(value);
  await render({ store, onSave });
  await act(async () => selectFiles([makeFile()]));
  await waitFor(() => calls.length === 1);
  await render({ store, onSave, session: { profileId: "profile-b", generation: 5 } });
  assert.equal(calls[0].options.signal.aborted, true);
  await render({ store, onSave, session: { profileId: SESSION.profileId, generation: 6 } });
  await act(async () => pending.resolve(await ack(calls[0].file, calls[0].metadata, calls[0].id)));
  assert.deepEqual(saves, []);
});

test("Escape closes the empty importer and Tab stays within its controls", async () => {
  await render();
  const close = document.querySelector('button[aria-label="Close syllabus import"]');
  const browse = [...document.querySelectorAll("button")].find((button) => button.textContent === "Browse File");
  assert.equal(document.activeElement, close);
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, browse);
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
