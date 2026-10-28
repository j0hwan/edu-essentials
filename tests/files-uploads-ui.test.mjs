/* eslint-disable react/prop-types -- Minimal React harness for client-hook and dialog acceptance tests. */
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/files" });
Object.defineProperty(dom.window, "AnimationEvent", {
  configurable: true,
  value: class TestAnimationEvent extends dom.window.Event {
    constructor(type, options = {}) {
      super(type, options);
      this.animationName = options.animationName ?? "";
    }
  },
});
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Event", "KeyboardEvent", "MutationObserver"]) {
  globalThis[name] = dom.window[name];
}
Object.defineProperty(globalThis, "File", { configurable: true, value: NodeFile });
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback) => setTimeout(() => callback(Date.now()), 0) });
Object.defineProperty(dom.window, "cancelAnimationFrame", { configurable: true, value: (id) => clearTimeout(id) });

const [React, ReactDom, { useFileUploads }, { default: FileUploadDialog }, { usePrivateFiles }, { hashBytes }, { uploadFileWithProgress }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/use-file-uploads.ts")),
  import(await clientModule("app/file-upload-dialog.tsx")),
  import(await clientModule("app/use-private-files.ts")),
  import(await clientModule("lib/files.ts")),
  import(await clientModule("lib/file-upload.ts")),
]);

const { createElement, act } = React;
const rootNode = document.getElementById("root");
const PROFILE_A = "profile-a";
const PROFILE_B = "profile-b";
const ID_A = "10000000-0000-4000-8000-000000000001";
const ID_B = "10000000-0000-4000-8000-000000000002";
const DEFAULTS = { folderId: null, courseId: "" };
let root;
let queue;
let privateStore;
let pendingFolderSelection;
const nativeFetch = globalThis.fetch;
const NativeXMLHttpRequest = globalThis.XMLHttpRequest;
const nativeConfirm = dom.window.confirm;

function UploadHarness({
  session = { profileId: PROFILE_A, generation: 1 },
  store,
  onUploaded = async () => {},
  enabled = true,
  showDialog = false,
  mode = "files",
  initialFiles,
  confirmUploads = true,
  onConfirmUploadsChange = () => {},
  onClose = () => {},
  defaults = DEFAULTS,
}) {
  queue = useFileUploads(session, store, onUploaded, enabled);
  return showDialog ? createElement(FileUploadDialog, {
    queue,
    currentProfileId: session.profileId,
    currentSessionGeneration: session.generation,
    defaults,
    mode,
    initialFiles,
    confirmUploads,
    onConfirmUploadsChange,
    canWrite: enabled,
    onClose,
  }) : null;
}

function FolderPlanHarness({ store, initialPlan }) {
  const [folderUpload, setFolderUpload] = React.useState(initialPlan);
  pendingFolderSelection = folderUpload;
  queue = useFileUploads({ profileId: PROFILE_A, generation: 1 }, store, async () => {}, true);
  return createElement(FileUploadDialog, {
    queue,
    currentProfileId: PROFILE_A,
    currentSessionGeneration: 1,
    defaults: DEFAULTS,
    mode: "folder",
    folderUpload,
    onFolderUploadChange: setFolderUpload,
    canWrite: true,
    onClose: () => {},
  });
}

function PrivateStoreHarness({ profileId }) {
  privateStore = usePrivateFiles(profileId);
  return null;
}

async function render(element) {
  if (!root) root = ReactDom.createRoot(rootNode);
  await act(async () => { root.render(element); });
}

async function waitFor(predicate, message = "Timed out waiting for the upload queue.") {
  for (let count = 0; count < 150; count++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

async function waitForReact(predicate, message) {
  for (let count = 0; count < 150; count++) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  assert.fail(message || "Timed out waiting for the upload queue.");
}

async function waitForUploadPanelExit() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
}

async function finishUploadPanelExit(shell) {
  const event = new dom.window.AnimationEvent("animationend", { bubbles: true, animationName: "files-upload-exit" });
  await act(async () => { shell.dispatchEvent(event); });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeFile(name, contents = `bytes for ${name}`) {
  return new File([contents], name, { type: "text/plain", lastModified: 1_791_500_000_000 });
}

async function makeAck(file, metadata, id) {
  const sha = await hashBytes(new Uint8Array(await file.arrayBuffer()));
  return {
    id,
    name: metadata.name,
    mime_type: "text/plain",
    size_bytes: file.size,
    course_id: metadata.courseId || null,
    assignment_id: metadata.assignmentId || null,
    kind: metadata.kind,
    state: "ready",
    created_at: "2026-10-09T00:00:00.000Z",
    updated_at: "2026-10-09T00:00:00.000Z",
    content_sha256: sha,
    folder_id: metadata.folderId ?? null,
    content_backend: "object",
    metadata_revision: 1,
    content_revision: 1,
    trashed_at: null,
    trash_operation_id: null,
    original_folder_id: null,
  };
}

function makeStore(upload) { return { upload }; }

function allRowsSettled() {
  return queue?.rows.length > 0 && queue.rows.every((row) => row.status === "complete" || row.status === "error" || row.status === "refresh-error");
}

afterEach(async () => {
  if (root) {
    await act(async () => { root.unmount(); });
    root = null;
  }
  queue = null;
  privateStore = null;
  pendingFolderSelection = undefined;
  rootNode.innerHTML = "";
  globalThis.fetch = nativeFetch;
  globalThis.XMLHttpRequest = NativeXMLHttpRequest;
  dom.window.confirm = nativeConfirm;
});

test("uploads are serial and independent; retry keeps the selected File, metadata, and UUID", async () => {
  const calls = [];
  const refreshes = [];
  let failSecond = true;
  const store = makeStore(async (file, metadata, id, options) => {
    calls.push({ file, metadata, id });
    options.onProgress(file.size, file.size);
    if (file.name === "b.txt" && failSecond) { failSecond = false; throw new Error("connection dropped"); }
    return makeAck(file, metadata, id);
  });
  const selected = [makeFile("a.txt"), makeFile("b.txt"), makeFile("c.txt")];
  await render(createElement(UploadHarness, { store, onUploaded: async (file) => { refreshes.push(file.id); } }));

  await act(async () => { queue.enqueue(selected, DEFAULTS); });
  await waitForReact(allRowsSettled);

  assert.deepEqual(calls.map((call) => call.file.name), ["a.txt", "b.txt", "c.txt"]);
  assert.deepEqual(queue.rows.map((row) => row.status), ["complete", "error", "complete"]);
  assert.equal(queue.busy, false);
  assert.equal(queue.dirty, true);
  const failed = queue.rows[1];
  assert.match(failed.error, /connection dropped/);
  assert.equal(queue.draft.uploads.length, 1);
  assert.equal(queue.draft.uploads[0].id, failed.id);
  assert.equal(queue.draft.uploads[0].profileId, PROFILE_A);
  assert.equal("bytes" in queue.draft.uploads[0], false);
  assert.doesNotThrow(() => JSON.stringify(queue.draft));

  await act(async () => { await queue.retry(failed.id); });
  assert.deepEqual(queue.rows.map((row) => row.status), ["complete", "complete", "complete"]);
  assert.equal(queue.dirty, false);
  assert.equal(calls[1].id, calls[3].id);
  assert.equal(calls[1].file, calls[3].file);
  assert.equal(calls[1].metadata, calls[3].metadata);
  assert.equal(refreshes.length, 3);
});

test("a failed post-ACK refresh retries only the refresh callback", async () => {
  let uploads = 0;
  let refreshes = 0;
  const store = makeStore(async (file, metadata, id) => { uploads++; return makeAck(file, metadata, id); });
  await render(createElement(UploadHarness, {
    store,
    onUploaded: async () => { refreshes++; if (refreshes === 1) throw new Error("Files list is offline"); },
  }));
  await act(async () => { queue.enqueue([makeFile("refresh.txt")], DEFAULTS); });
  await waitForReact(allRowsSettled);
  const row = queue.rows[0];
  assert.equal(row.status, "refresh-error");
  assert.equal(row.acknowledged, true);
  assert.equal(queue.draft.uploads[0].acknowledged, true);

  await act(async () => { await queue.retry(row.id); });
  assert.equal(queue.rows[0].status, "complete");
  assert.equal(uploads, 1);
  assert.equal(refreshes, 2);
});

test("late A-to-B-to-A response is fenced until explicit retry in the new generation", async () => {
  const held = deferred();
  const calls = [];
  let refreshes = 0;
  const store = makeStore(async (file, metadata, id, options) => {
    calls.push({ file, metadata, id, signal: options.signal });
    if (calls.length === 1) return held.promise;
    return makeAck(file, metadata, id);
  });
  const onUploaded = async () => { refreshes++; };
  await render(createElement(UploadHarness, { store, onUploaded, session: { profileId: PROFILE_A, generation: 1 } }));
  await act(async () => {
    queue.enqueue([makeFile("late.txt")], DEFAULTS);
    await waitFor(() => calls.length === 1);
  });
  const uploadId = queue.rows[0].id;
  await render(createElement(UploadHarness, { store, onUploaded, session: { profileId: PROFILE_B, generation: 2 } }));
  await render(createElement(UploadHarness, { store, onUploaded, session: { profileId: PROFILE_A, generation: 3 } }));
  assert.equal(calls[0].signal.aborted, true);

  await act(async () => { held.resolve(await makeAck(calls[0].file, calls[0].metadata, calls[0].id)); });
  await waitForReact(() => queue.rows[0].status === "error");
  assert.equal(queue.rows[0].acknowledged, false);
  assert.equal(refreshes, 0);
  assert.equal(calls.length, 1);

  await act(async () => { await queue.retry(uploadId); });
  assert.equal(queue.rows[0].status, "complete");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].id, uploadId);
  assert.equal(calls[1].file, calls[0].file);
  assert.equal(refreshes, 1);
});

test("chooser selections stay local until explicit confirmation and progress stays below 100% until ACK", async () => {
  const pending = [];
  const calls = [];
  const store = makeStore((file, metadata, id, options) => {
    calls.push({ file, metadata, id });
    options.onProgress(file.size, file.size);
    const task = deferred();
    pending.push({ task, file, metadata, id });
    return task.promise;
  });
  await render(createElement(UploadHarness, { store, showDialog: true }));
  const dialog = document.querySelector(".files-upload-dialog");
  assert.ok(dialog);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement, dialog.querySelector(".files-upload-choose"), "the chooser receives initial focus");
  const input = [...dialog.querySelectorAll("input[type=file]")].find((element) => element.multiple);
  assert.ok(input);
  const selected = [makeFile("one.txt"), makeFile("two.txt")];
  Object.defineProperty(input, "files", { configurable: true, value: selected });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const localPreview = dialog.querySelector('[aria-label="Local file preview"]');
  assert.ok(localPreview, "selected files have an on-device preview");
  const localReview = dialog.querySelector('[aria-label="Files ready for upload"]');
  assert.ok(localReview, "selected files appear in the local review area");
  assert.equal(localReview.querySelectorAll("[data-local-file-id]").length, 2);
  assert.match(localReview.textContent, /one\.txt/);
  assert.match(localReview.textContent, /two\.txt/);
  assert.match(localPreview.textContent, /Not uploaded/);
  assert.equal(calls.length, 0, "choosing files does not call the upload store");
  assert.equal(queue.rows.length, 0, "choosing files does not reserve IDs or create queue rows");

  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Upload files");
  assert.ok(confirm, "the local review has an explicit Upload files action");
  await act(async () => { confirm.click(); });
  await waitForReact(() => calls.length === 1);
  assert.equal(queue.rows.length, 2);
  assert.equal(queue.rows[0].status, "uploading");
  assert.equal(queue.rows[1].status, "queued");
  const progress = dialog.querySelector("progress");
  assert.equal(progress.value, 99);
  assert.equal(dialog.querySelectorAll(".files-upload-row").length, 2);
  assert.ok([...dialog.querySelectorAll("button")].some((button) => button.textContent === "Download original"));
  assert.ok([...dialog.querySelectorAll("button")].some((button) => button.textContent === "Download request draft"));

  await act(async () => {
    pending[0].task.resolve(await makeAck(pending[0].file, pending[0].metadata, pending[0].id));
    await waitFor(() => calls.length === 2);
  });
  await act(async () => { pending[1].task.resolve(await makeAck(pending[1].file, pending[1].metadata, pending[1].id)); });
  await waitForReact(allRowsSettled);
  assert.deepEqual(queue.rows.map((row) => row.status), ["complete", "complete"]);
});

test("chooser, panel drop, and raw initial files all stage without uploading until one confirmation", async () => {
  const calls = [];
  const store = makeStore(async (file, metadata, id) => {
    calls.push({ file, metadata, id });
    return makeAck(file, metadata, id);
  });
  const initial = makeFile("main-drop.txt");
  await render(createElement(UploadHarness, { store, showDialog: true, initialFiles: [initial] }));
  let dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => dialog.querySelectorAll("[data-local-file-id]").length === 1);
  assert.equal(calls.length, 0, "raw files passed from Files drop enter local review only");
  assert.equal(queue.rows.length, 0);

  const input = [...dialog.querySelectorAll("input[type=file]")].find((element) => element.multiple);
  assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [makeFile("chooser.txt")] });
  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  const dropzone = dialog.querySelector('[aria-label="File upload dropzone"]');
  assert.ok(dropzone);
  const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { configurable: true, value: { files: [makeFile("panel-drop.txt")] } });
  await act(async () => { dropzone.dispatchEvent(drop); });

  assert.equal(dialog.querySelectorAll("[data-local-file-id]").length, 3);
  assert.deepEqual(calls, [], "chooser and panel-drop files remain local with raw initial files");
  assert.equal(queue.rows.length, 0, "all three entry paths wait before queue admission");
  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Upload files");
  await act(async () => { confirm.click(); });
  await waitForReact(() => queue.rows.length === 3 && queue.rows.every((row) => row.status === "complete"));
  assert.deepEqual(calls.map((call) => call.file.name).sort(), ["chooser.txt", "main-drop.txt", "panel-drop.txt"]);
});

test("restoring confirmation before folder readiness keeps saved-opt-out initial files staged", async () => {
  const heldFolders = deferred();
  const requests = [];
  const calls = [];
  globalThis.fetch = (input) => {
    const url = new URL(String(input), "https://edu.example");
    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/api/file-folders" && url.searchParams.get("view") === "active") return heldFolders.promise;
    return Promise.resolve(new Response(JSON.stringify({
      files: [],
      folders: [],
      activities: { files: [], folders: [] },
    }), { headers: { "content-type": "application/json" } }));
  };
  const store = makeStore(async (file, metadata, id) => {
    calls.push(file.name);
    return makeAck(file, metadata, id);
  });
  const selected = [makeFile("saved-opt-out.txt")];
  await render(createElement(UploadHarness, {
    store,
    showDialog: true,
    initialFiles: selected,
    confirmUploads: false,
  }));
  await waitFor(() => requests.includes("/api/file-folders?view=active"), "the dialog starts loading destination folders");
  let dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => dialog.querySelector('[data-local-file-id]'), "opted-out initial files enter local review while folder data is pending");
  assert.equal(calls.length, 0);
  assert.equal(queue.rows.length, 0);

  await render(createElement(UploadHarness, {
    store,
    showDialog: true,
    initialFiles: selected,
    confirmUploads: true,
  }));
  dialog = document.querySelector(".files-upload-dialog");
  assert.ok(dialog.querySelector('[data-local-file-id]'), "restoring confirmation preserves the local selection");
  assert.equal(calls.length, 0, "restoring confirmation does not upload while folders are still loading");
  assert.equal(queue.rows.length, 0);

  await act(async () => {
    heldFolders.resolve(new Response(JSON.stringify({
      folders: [],
      activities: { folders: [] },
    }), { headers: { "content-type": "application/json" } }));
  });
  await waitForReact(() => !dialog.textContent.includes("Loading active folders"), "active folder data resolves");
  assert.ok(dialog.querySelector('[data-local-file-id]'), "the local selection remains after destination data resolves");
  assert.equal(calls.length, 0, "a resolved destination cannot auto-admit a batch whose confirmation setting was restored");
  assert.equal(queue.rows.length, 0);

  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Upload files");
  assert.ok(confirm && !confirm.disabled, "an explicit confirmation is available after folder readiness");
  await act(async () => { confirm.click(); });
  await waitForReact(() => queue.rows.length === 1 && queue.rows[0].status === "complete");
  assert.deepEqual(calls, ["saved-opt-out.txt"]);
});

test("mixed staged validation keeps invalid files local while explicit confirmation uploads only valid files", async () => {
  const calls = [];
  const store = makeStore(async (file, metadata, id) => {
    calls.push(file.name);
    return makeAck(file, metadata, id);
  });
  await render(createElement(UploadHarness, { store, showDialog: true }));
  const dialog = document.querySelector(".files-upload-dialog");
  const input = [...dialog.querySelectorAll("input[type=file]")].find((element) => element.multiple);
  const selected = [makeFile("valid.txt"), makeFile("x".repeat(256)), new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.txt")];
  Object.defineProperty(input, "files", { configurable: true, value: selected });
  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.equal(calls.length, 0, "even a valid item in a mixed selection stays local before confirmation");
  const review = dialog.querySelector('[aria-label="Files ready for upload"]');
  assert.equal(review.querySelectorAll("[data-local-file-id]").length, 3);
  assert.match(review.textContent, /1–255 characters/);
  assert.match(review.textContent, /25 MiB/);

  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Upload files");
  await act(async () => { confirm.click(); });
  await waitForReact(() => queue.rows.length === 1 && queue.rows[0].status === "complete");
  assert.deepEqual(calls, ["valid.txt"]);
  assert.equal(dialog.querySelectorAll('[aria-label="Files ready for upload"] [data-local-file-id]').length, 2, "invalid files remain available to correct or remove");
});

test("a staged Files drop cannot be admitted by an A-to-B-to-A session change", async () => {
  const calls = [];
  const store = makeStore(async (...args) => { calls.push(args); return makeAck(...args.slice(0, 3)); });
  const selected = makeFile("staged-for-a.txt");
  await render(createElement(UploadHarness, { store, showDialog: true, session: { profileId: PROFILE_A, generation: 1 }, initialFiles: [selected] }));
  let dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => dialog.querySelector('[data-local-file-id]'));
  assert.equal(calls.length, 0);

  await render(createElement(UploadHarness, { store, showDialog: true, session: { profileId: PROFILE_B, generation: 2 }, initialFiles: [selected] }));
  await render(createElement(UploadHarness, { store, showDialog: true, session: { profileId: PROFILE_A, generation: 3 }, initialFiles: [selected] }));
  dialog = document.querySelector(".files-upload-dialog");
  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Upload files");
  if (confirm && !confirm.disabled) await act(async () => { confirm.click(); });
  assert.equal(calls.length, 0, "returning to the same profile cannot transfer a generation-1 selection into generation 3");
  assert.equal(queue.rows.length, 0);
  assert.match(dialog.textContent, /previous account session/);
});

test("closing a reviewed selection and changing the opt-out do not admit pending files", async () => {
  const calls = [];
  const preferenceChanges = [];
  const store = makeStore(async (...args) => { calls.push(args); return makeAck(...args.slice(0, 3)); });
  const selected = makeFile("pending.txt");
  let closed = 0;
  await render(createElement(UploadHarness, {
    store,
    showDialog: true,
    initialFiles: [selected],
    onClose: () => { closed++; },
    onConfirmUploadsChange: (value) => preferenceChanges.push(value),
  }));
  const dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => dialog.querySelector('[data-local-file-id]'));
  assert.equal(calls.length, 0);
  const optOut = [...dialog.querySelectorAll("input[type=checkbox]")].find((input) => input.getAttribute("aria-label") === "Do not show again" || input.closest("label")?.textContent.includes("Do not show again"));
  assert.ok(optOut, "review exposes the opt-out checkbox");
  await act(async () => { optOut.click(); });
  assert.deepEqual(preferenceChanges, [], "the opt-out stays a draft until the Upload files action is confirmed");
  assert.equal(calls.length, 0, "remembering opt-out does not upload the batch already under review");
  assert.equal(queue.rows.length, 0);

  const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel selection");
  assert.ok(cancel, "the review offers a cancel action distinct from closing the panel");
  await act(async () => { cancel.click(); });
  assert.equal(dialog.querySelector('[aria-label="Files ready for upload"]'), null, "Cancel selection clears the pending local batch");
  assert.equal(calls.length, 0, "Cancel selection never admits pending files");
  Object.defineProperty(dialog.querySelector('input[type="file"]'), "files", { configurable: true, value: [makeFile("close-without-upload.txt")] });
  await act(async () => { dialog.querySelector('input[type="file"]').dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.ok(dialog.querySelector('[aria-label="Files ready for upload"]'), "a fresh selection can be staged after cancellation");

  const close = dialog.querySelector('[aria-label="Close upload panel"]');
  assert.ok(close);
  await act(async () => { close.click(); });
  assert.equal(closed, 0, "the panel remains mounted while its exit animation runs");
  assert.equal(dialog.getAttribute("aria-hidden"), "true");
  const shell = document.querySelector(".files-upload-shell");
  assert.ok(shell.classList.contains("is-collapsed"), "full dismissal starts the panel exit");
  await finishUploadPanelExit(shell);
  assert.equal(closed, 1, "the parent closes the panel after the exit animation");
  assert.equal(calls.length, 0, "closing the panel with pending staged files never uploads them");
  assert.equal(queue.rows.length, 0);
});

test("Escape animates the upload panel closed before requesting dismissal", async () => {
  let closed = 0;
  await render(createElement(UploadHarness, { store: makeStore(async () => { throw new Error("no upload expected"); }), showDialog: true, onClose: () => { closed++; } }));
  const shell = document.querySelector(".files-upload-shell");
  await act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  assert.ok(shell.classList.contains("is-collapsed"));
  assert.equal(closed, 0, "Escape waits for the exit animation");
  await waitForUploadPanelExit();
  assert.equal(closed, 1);
});

test("reduced-motion settings close the upload panel immediately", async () => {
  const originalMotion = document.documentElement.getAttribute("data-motion");
  let closed = 0;
  document.documentElement.setAttribute("data-motion", "reduced");
  try {
    await render(createElement(UploadHarness, { store: makeStore(async () => { throw new Error("no upload expected"); }), showDialog: true, onClose: () => { closed++; } }));
    await act(async () => { document.querySelector('[aria-label="Close upload panel"]').click(); });
    assert.equal(closed, 1, "the saved reduced-motion preference skips the exit delay");
  } finally {
    if (originalMotion === null) document.documentElement.removeAttribute("data-motion");
    else document.documentElement.setAttribute("data-motion", originalMotion);
  }
});

test("the operating-system reduced-motion setting closes the upload panel immediately", async () => {
  const originalMatchMedia = dom.window.matchMedia;
  Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  let closed = 0;
  try {
    await render(createElement(UploadHarness, { store: makeStore(async () => { throw new Error("no upload expected"); }), showDialog: true, onClose: () => { closed++; } }));
    await act(async () => { document.querySelector('[aria-label="Close upload panel"]').click(); });
    assert.equal(closed, 1, "the operating-system preference skips the exit delay");
  } finally {
    if (originalMatchMedia === undefined) delete dom.window.matchMedia;
    else Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: originalMatchMedia });
  }
});

test("pending upload-panel dismissal is cancelled when its component unmounts", async () => {
  let closed = 0;
  await render(createElement(UploadHarness, { store: makeStore(async () => { throw new Error("no upload expected"); }), showDialog: true, onClose: () => { closed++; } }));
  await act(async () => { document.querySelector('[aria-label="Close upload panel"]').click(); });
  assert.equal(closed, 0);
  const mountedRoot = root;
  await act(async () => { mountedRoot.unmount(); });
  root = null;
  await new Promise((resolve) => setTimeout(resolve, 420));
  assert.equal(closed, 0, "unmount cleanup cancels the fallback dismissal timer");
});

test("a fresh upload request cancels a pending panel dismissal", async () => {
  let closed = 0;
  const store = makeStore(async () => { throw new Error("no upload expected"); });
  await render(createElement(UploadHarness, { store, showDialog: true, onClose: () => { closed++; } }));
  const shell = document.querySelector(".files-upload-shell");
  await act(async () => { document.querySelector('[aria-label="Close upload panel"]').click(); });
  assert.equal(shell.classList.contains("is-collapsed"), true);
  assert.equal(closed, 0);

  await render(createElement(UploadHarness, { store, showDialog: true, defaults: { folderId: "fresh-request-folder", courseId: "fresh-request-course" }, onClose: () => { closed++; } }));
  await waitForReact(() => document.querySelector(".files-upload-dialog").getAttribute("aria-hidden") === "false");
  assert.equal(document.querySelector(".files-upload-shell"), shell, "the new request reuses the existing upload panel");
  await new Promise((resolve) => setTimeout(resolve, 420));
  assert.equal(closed, 0, "the stale dismissal timer cannot close the fresh request");
  assert.equal(document.querySelector(".files-upload-dialog").getAttribute("aria-hidden"), "false");
});

test("hiding and reopening the upload panel retains staged files without uploading", async () => {
  const calls = [];
  const selected = makeFile("keep-this-selection.txt", "selection remains on this device");
  const store = makeStore(async (...args) => { calls.push(args); return makeAck(...args.slice(0, 3)); });
  await render(createElement(UploadHarness, { store, showDialog: true }));
  const dialog = document.querySelector(".files-upload-dialog");
  const input = [...dialog.querySelectorAll('input[type="file"]')].find((element) => element.multiple);
  Object.defineProperty(input, "files", { configurable: true, value: [selected] });
  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await waitForReact(() => dialog.querySelector("[data-local-file-id]"));
  const stagedId = dialog.querySelector("[data-local-file-id]").getAttribute("data-local-file-id");
  const shell = dialog.parentElement;
  assert.match(dialog.textContent, /keep-this-selection\.txt/);
  assert.equal(shell.getAttribute("role"), "dialog", "the shell makes the handle part of the open modal dialog");
  assert.equal(shell.getAttribute("aria-modal"), "true");
  assert.equal(calls.length, 0);
  assert.equal(queue.rows.length, 0);

  const toggle = document.querySelector(".files-upload-panel-toggle");
  assert.ok(toggle, "the open panel exposes its arrow handle");
  assert.equal(toggle.getAttribute("aria-label"), "Hide upload panel");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.parentElement, document.querySelector(".files-upload-shell"), "the handle is the shell's first child");
  assert.equal(toggle, toggle.parentElement.firstElementChild, "the handle leads the shell DOM order");
  await act(async () => { toggle.click(); });
  await waitForReact(() => document.activeElement === document.querySelector('[aria-label="Show upload panel"]'));
  const show = document.querySelector('[aria-label="Show upload panel"]');
  assert.equal(show, toggle, "the same arrow handle changes to Show upload panel");
  assert.equal(show.getAttribute("aria-expanded"), "false");
  assert.equal(dialog.getAttribute("aria-hidden"), "true");
  assert.equal(shell.getAttribute("role"), null, "the collapsed shell leaves the dialog navigation scope");
  assert.equal(shell.getAttribute("aria-modal"), null);
  assert.equal(dialog.querySelector("[data-local-file-id]").getAttribute("data-local-file-id"), stagedId);
  assert.match(dialog.textContent, /keep-this-selection\.txt/);
  assert.equal(calls.length, 0, "hiding the panel does not upload the staged File");
  assert.equal(queue.rows.length, 0);

  await act(async () => { show.click(); });
  await waitForReact(() => document.activeElement === dialog.querySelector(".files-upload-choose"));
  assert.equal(shell.getAttribute("role"), "dialog");
  assert.equal(shell.getAttribute("aria-modal"), "true");
  assert.equal(document.querySelector('[aria-label="Hide upload panel"]'), toggle, "reopening keeps the original arrow handle");
  assert.equal(document.activeElement, dialog.querySelector(".files-upload-choose"), "reopening returns keyboard focus to the chooser");
  assert.equal(dialog.querySelector("[data-local-file-id]").getAttribute("data-local-file-id"), stagedId);
  assert.match(dialog.textContent, /keep-this-selection\.txt/);
  assert.match(dialog.querySelector('[aria-label="Local file preview"]').textContent, /selection remains on this device/);
  assert.equal(calls.length, 0, "reopening the panel leaves the staged File local until confirmation");
  assert.equal(queue.rows.length, 0);
});

test("outside click collapses a staged file panel while settings clicks leave it open", async () => {
  const calls = [];
  const selected = makeFile("outside-click-stays-local.txt");
  const store = makeStore(async (...args) => { calls.push(args); return makeAck(...args.slice(0, 3)); });
  await render(createElement(UploadHarness, { store, showDialog: true }));
  const backdrop = document.querySelector(".files-upload-backdrop");
  const dialog = document.querySelector(".files-upload-dialog");
  const input = [...dialog.querySelectorAll('input[type="file"]')].find((element) => element.multiple);
  Object.defineProperty(input, "files", { configurable: true, value: [selected] });
  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await waitForReact(() => dialog.querySelector("[data-local-file-id]"));

  const toggle = dialog.parentElement.querySelector(".files-upload-panel-toggle");
  const settings = dialog.querySelector(".files-upload-settings-trigger");
  const settingsMenu = dialog.querySelector(".files-upload-settings-menu");
  await act(async () => { settings.click(); });
  assert.equal(settingsMenu.hidden, false, "the settings menu opens inside the upload panel");
  await act(async () => { settingsMenu.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
  assert.equal(dialog.getAttribute("aria-hidden"), "false", "a click inside settings does not collapse the panel");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(calls.length, 0);
  await act(async () => { settings.click(); });

  await act(async () => { backdrop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
  await waitForReact(() => dialog.getAttribute("aria-hidden") === "true");
  assert.equal(document.querySelector('[aria-label="Show upload panel"]'), toggle, "outside click moves the same handle into Show state");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(dialog.querySelector("[data-local-file-id]"), "the staged file remains in the collapsed panel");
  assert.equal(calls.length, 0, "collapsing from the backdrop does not upload the staged file");
  assert.equal(queue.rows.length, 0, "collapsing does not admit the file to the upload queue");
});

test("outside click preserves a pending folder plan in folder-upload mode", async () => {
  const calls = [];
  const requests = [];
  const initialPlan = {
    id: "folder-plan-retained",
    profileId: PROFILE_A,
    sessionGeneration: 1,
    folderId: null,
    courseId: null,
    files: [{ file: makeFile("folder-local.txt"), relativePath: "Course/lab/folder-local.txt", targetPath: "Course/lab" }],
    directories: [{ id: ID_A, path: "Course", name: "Course", parentPath: null, created: false }],
    status: "error",
    error: "Folder setup can be retried.",
  };
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), method: init.method ?? "GET" });
    return new Response(JSON.stringify({
      files: [],
      folders: [],
      activities: { files: [], folders: [] },
    }), { headers: { "content-type": "application/json" } });
  };
  const store = makeStore(async (...args) => { calls.push(args); return makeAck(...args.slice(0, 3)); });
  await render(createElement(FolderPlanHarness, { store, initialPlan }));
  const backdrop = document.querySelector(".files-upload-backdrop");
  const dialog = document.querySelector(".files-upload-dialog");
  const toggle = document.querySelector(".files-upload-panel-toggle");
  assert.ok(dialog.classList.contains("is-folder-upload"), "the upload panel renders in folder mode");
  assert.ok(dialog.querySelector(".files-folder-upload-plan"), "the selected folder plan is visible");
  assert.equal(pendingFolderSelection.files[0].file.name, "folder-local.txt");
  assert.equal(pendingFolderSelection, initialPlan);

  await act(async () => { backdrop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
  await waitForReact(() => dialog.getAttribute("aria-hidden") === "true");
  assert.equal(document.querySelector('[aria-label="Show upload panel"]'), toggle, "folder mode keeps the same arrow handle");
  assert.equal(pendingFolderSelection, initialPlan, "the pending folder plan remains attached while collapsed");
  assert.equal(calls.length, 0, "collapsing does not start folder creation or file uploads");
  assert.ok(requests.every((request) => request.method === "GET"), "collapsing makes no folder-creation or upload POST request");
  assert.equal(queue.rows.length, 0);

  await act(async () => { toggle.click(); });
  await waitForReact(() => dialog.getAttribute("aria-hidden") === "false");
  assert.equal(pendingFolderSelection, initialPlan, "reopening preserves the same folder plan");
  assert.equal(calls.length, 0);
  assert.ok(requests.every((request) => request.method === "GET"));
  assert.equal(queue.rows.length, 0);
});

test("changing upload defaults while a dropped selection is hidden retains both files until confirmation", async () => {
  const calls = [];
  const folder = {
    id: "20000000-0000-4000-8000-000000000001",
    parent_id: null,
    name: "Folder B",
    kind: "custom",
    course_id: null,
    course_code: null,
    revision: 1,
    created_at: "2026-10-10T00:00:00.000Z",
    updated_at: "2026-10-10T00:00:00.000Z",
    archived_at: null,
    semester_label: null,
    course_name_snapshot: null,
    course_color_snapshot: null,
    trashed_at: null,
    trash_operation_id: null,
    original_parent_id: null,
  };
  globalThis.fetch = (input) => {
    const url = new URL(String(input), "https://edu.example");
    const payload = url.pathname === "/api/file-folders"
      ? { folders: [folder], activities: { folders: [] } }
      : { files: [], folders: [], activities: { files: [], folders: [] } };
    return Promise.resolve(new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
  };
  const store = makeStore(async (file, metadata, id) => {
    calls.push({ file, metadata });
    return makeAck(file, metadata, id);
  });
  const rootFile = makeFile("root-drop.txt");
  const folderFile = makeFile("folder-drop.txt");
  const rootDefaults = { ...DEFAULTS, profileId: PROFILE_A, generation: 1 };
  const folderDefaults = { ...DEFAULTS, folderId: folder.id, profileId: PROFILE_A, generation: 1 };

  await render(createElement(UploadHarness, { store, showDialog: true, initialFiles: [rootFile], defaults: rootDefaults }));
  let dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => dialog.querySelectorAll("[data-local-file-id]").length === 1);
  assert.match(dialog.textContent, /root-drop\.txt/);
  assert.equal(calls.length, 0, "a file dropped on the Files root stays local");

  await act(async () => { document.querySelector('[aria-label="Hide upload panel"]').click(); });
  await waitForReact(() => dialog.getAttribute("aria-hidden") === "true");
  assert.equal(calls.length, 0, "hiding the root selection does not upload it");

  await render(createElement(UploadHarness, { store, showDialog: true, initialFiles: [folderFile], defaults: folderDefaults }));
  dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => dialog.getAttribute("aria-hidden") === "false" && dialog.querySelectorAll("[data-local-file-id]").length === 2);
  await waitForReact(() => !dialog.textContent.includes("Loading active folders"));
  assert.match(dialog.textContent, /root-drop\.txt/);
  assert.match(dialog.textContent, /folder-drop\.txt/);
  assert.match(dialog.querySelector('[aria-label="Upload destination"]').textContent, /Folder B/);
  assert.equal(calls.length, 0, "changing folders stages the new file without uploading either selection");
  assert.equal(queue.rows.length, 0);

  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Upload files");
  assert.ok(confirm && !confirm.disabled, `both retained files can be confirmed at the new destination (${dialog.textContent})`);
  await act(async () => { confirm.click(); });
  await waitForReact(() => queue.rows.length === 2 && queue.rows.every((row) => row.status === "complete"));
  assert.deepEqual(calls.map(({ file }) => file.name).sort(), ["folder-drop.txt", "root-drop.txt"]);
  assert.ok(calls.every(({ metadata }) => metadata.folderId === folder.id), "confirmation applies the new folder to the retained root file and the newly dropped file");
});

test("a new root upload request overrides a manual folder after hide when confirmation is disabled", async () => {
  const calls = [];
  const folder = {
    id: "manual-folder-a",
    parent_id: null,
    name: "Folder A",
    kind: "custom",
    course_id: null,
    course_code: null,
    revision: 1,
    created_at: "2026-10-10T00:00:00.000Z",
    updated_at: "2026-10-10T00:00:00.000Z",
    archived_at: null,
    semester_label: null,
    course_name_snapshot: null,
    course_color_snapshot: null,
    trashed_at: null,
    trash_operation_id: null,
    original_parent_id: null,
  };
  globalThis.fetch = (input) => {
    const url = new URL(String(input), "https://edu.example");
    const payload = url.pathname === "/api/file-folders"
      ? { folders: [folder], activities: { folders: [] } }
      : { files: [], folders: [], activities: { files: [], folders: [] } };
    return Promise.resolve(new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
  };
  const store = makeStore(async (file, metadata, id) => {
    calls.push({ file, metadata });
    return makeAck(file, metadata, id);
  });
  const initialRootDefaults = { ...DEFAULTS, profileId: PROFILE_A, generation: 1 };
  const nextRootDefaults = { ...DEFAULTS, profileId: PROFILE_A, generation: 1 };

  await render(createElement(UploadHarness, { store, showDialog: true, confirmUploads: false, defaults: initialRootDefaults }));
  let dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => !dialog.textContent.includes("Loading active folders"));
  await act(async () => { dialog.querySelector('[aria-label="Upload destination"] button').click(); });
  const destination = dialog.querySelector('[aria-label="Destination folder"]');
  assert.ok(destination, "the manual destination picker opens");
  await act(async () => {
    destination.value = folder.id;
    destination.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.match(dialog.querySelector('[aria-label="Upload destination"]').textContent, /Folder A/);
  assert.equal(calls.length, 0);

  await act(async () => { document.querySelector('[aria-label="Hide upload panel"]').click(); });
  await waitForReact(() => dialog.getAttribute("aria-hidden") === "true");
  const incomingFile = makeFile("new-root-drop.txt");
  await render(createElement(UploadHarness, {
    store,
    showDialog: true,
    confirmUploads: false,
    initialFiles: [incomingFile],
    defaults: nextRootDefaults,
  }));
  dialog = document.querySelector(".files-upload-dialog");
  await waitForReact(() => calls.length === 1 && queue.rows.length === 1 && queue.rows[0].status === "complete");
  assert.equal(calls[0].file.name, incomingFile.name);
  assert.equal(calls[0].metadata.folderId, null, "the new root defaults override the previous manual Folder A choice");
  assert.notEqual(calls[0].metadata.folderId, folder.id);
  assert.equal(dialog.getAttribute("aria-hidden"), "false", "the fresh root request reopens the hidden panel");
});

test("dismissing a partial folder plan clears the selection and leaves created folders intact", async () => {
  const selectedFile = makeFile("notes.txt");
  const initialPlan = {
    id: "folder-plan-1",
    profileId: PROFILE_A,
    sessionGeneration: 1,
    folderId: null,
    courseId: null,
    files: [{ file: selectedFile, relativePath: "Course/lab/notes.txt", targetPath: "Course/lab" }],
    directories: [
      { id: ID_A, path: "Course", name: "Course", parentPath: null, created: true },
      { id: ID_B, path: "Course/lab", name: "lab", parentPath: "Course", created: false },
    ],
    status: "error",
    error: "The folder request failed.",
  };
  const createdFolders = [{ id: ID_A, parent_id: null, name: "Course" }];
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    requests.push({ path, method: init.method ?? "GET" });
    if (path.startsWith("/api/file-folders")) {
      const view = new URL(path, dom.window.location.origin).searchParams.get("view");
      return new Response(JSON.stringify({ folders: view === "active" ? createdFolders : [], activities: { folders: [] } }), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ files: [], activities: { files: [], folders: [] } }), { headers: { "content-type": "application/json" } });
  };
  dom.window.confirm = (message) => { requests.push({ confirm: message }); return true; };

  await render(createElement(FolderPlanHarness, { store: makeStore(async () => { assert.fail("Dismissal must not upload files."); }), initialPlan }));
  await waitForReact(() => requests.filter((request) => request.path).length >= 5);
  const dialog = document.querySelector(".files-upload-dialog");
  const dismiss = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Dismiss selection");
  assert.ok(dismiss, "an idle partial folder plan can be dismissed");

  await act(async () => { dismiss.click(); });
  await waitForReact(() => pendingFolderSelection === null);
  assert.deepEqual(createdFolders, [{ id: ID_A, parent_id: null, name: "Course" }], "the server-created folder remains in Files");
  assert.ok(requests.some((request) => request.confirm?.includes("Folders already created in Files will stay in place.")), "dismissing explains that created folders are retained");
  assert.ok(requests.filter((request) => request.path).every((request) => request.method === "GET"), "dismissal does not delete folders or start uploads");
  assert.equal(queue.rows.length, 0, "the selected original file is not uploaded during dismissal");
});

test("oversize and invalid-name selections remain as per-file validation errors", async () => {
  let uploads = 0;
  const store = makeStore(async () => { uploads++; throw new Error("Validation should prevent upload."); });
  await render(createElement(UploadHarness, { store }));
  const oversize = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.bin");
  const invalidName = makeFile("x".repeat(256));
  await act(async () => { queue.enqueue([oversize, invalidName], DEFAULTS); });
  await waitForReact(() => queue.rows.length === 2 && queue.rows.every((row) => row.status === "error"));
  assert.match(queue.rows[0].error, /25 MiB/);
  assert.match(queue.rows[1].error, /1–255 characters/);
  assert.equal(queue.rows[0].retryable, false);
  assert.equal(queue.rows[1].retryable, false);
  assert.equal(uploads, 0);
  assert.equal(queue.dirty, true);
});

test("progress transport sends captured account headers and reports bytes only when requested", async () => {
  class FakeXMLHttpRequest {
    constructor() {
      this.upload = {};
      this.headers = {};
      FakeXMLHttpRequest.last = this;
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name.toLowerCase()] = value; }
    send(file) {
      this.body = file;
      this.upload.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size });
      queueMicrotask(() => {
        this.status = 201;
        this.responseText = JSON.stringify({ file: { id: ID_A } });
        this.onload?.();
      });
    }
    abort() { this.onabort?.(); }
  }
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  const file = makeFile("xhr.txt");
  const metadata = { name: file.name, courseId: "", assignmentId: "", kind: "resource", folderId: null };
  const progress = [];
  const result = await uploadFileWithProgress(PROFILE_A, ID_A, file, metadata, { onProgress: (loaded, total) => progress.push([loaded, total]) });
  const xhr = FakeXMLHttpRequest.last;
  assert.equal(xhr.method, "POST");
  assert.equal(xhr.url, `/api/files?id=${ID_A}`);
  assert.equal(xhr.headers["x-profile-id"], PROFILE_A);
  assert.equal(xhr.headers["content-type"], "application/octet-stream");
  assert.equal(decodeURIComponent(xhr.headers["x-file-metadata"]), JSON.stringify(metadata));
  assert.equal(xhr.timeout, 120_000);
  assert.deepEqual(progress, [[file.size, file.size]]);
  assert.equal(result.id, ID_A);
});

test("legacy three-argument store upload continues to use fetch", async () => {
  const file = makeFile("legacy.txt");
  const metadata = { name: file.name, courseId: "", assignmentId: "", kind: "resource", folderId: null };
  const canonical = await makeAck(file, metadata, ID_A);
  const requests = [];
  globalThis.XMLHttpRequest = class { constructor() { assert.fail("Legacy upload unexpectedly used XHR."); } };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(url === "/api/files" ? { files: [] } : { file: canonical }), { status: 201, headers: { "content-type": "application/json" } });
  };
  await render(createElement(PrivateStoreHarness, { profileId: PROFILE_A }));
  let saved;
  await act(async () => { saved = await privateStore.upload(file, metadata, ID_A); });
  assert.equal(saved.id, ID_A);
  const post = requests.find((request) => request.init?.method === "POST");
  assert.equal(post.url, `/api/files?id=${ID_A}`);
  assert.equal(post.init.body, file);
  assert.equal(new Headers(post.init.headers).get("x-profile-id"), PROFILE_A);
  assert.equal(privateStore.files[0].id, ID_A);
});

test("a late previous-account upload cannot write files or busy state into the next account", async () => {
  const heldPost = deferred();
  let postWasStarted = false;
  const selected = makeFile("old-account.txt");
  const metadata = { name: selected.name, courseId: "", assignmentId: "", kind: "resource", folderId: null };
  const nextAccountFile = await makeAck(makeFile("new-account.txt"), { ...metadata, name: "new-account.txt" }, ID_B);
  globalThis.fetch = async (url, init = {}) => {
    const requestProfile = new Headers(init.headers).get("x-profile-id");
    if (init.method === "POST") {
      postWasStarted = true;
      return heldPost.promise;
    }
    return new Response(JSON.stringify({ files: requestProfile === PROFILE_B ? [nextAccountFile] : [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await render(createElement(PrivateStoreHarness, { profileId: PROFILE_A }));
  await waitForReact(() => privateStore.loading === false);
  let oldUpload;
  await act(async () => { oldUpload = privateStore.upload(selected, metadata, ID_A); });
  await waitForReact(() => privateStore.busy && postWasStarted);
  await render(createElement(PrivateStoreHarness, { profileId: PROFILE_B }));
  await waitForReact(() => privateStore.loading === false && privateStore.files.some((file) => file.id === ID_B));
  assert.equal(privateStore.busy, false);

  await act(async () => {
    heldPost.resolve(new Response(JSON.stringify({ file: await makeAck(selected, metadata, ID_A) }), { status: 201, headers: { "content-type": "application/json" } }));
    await assert.rejects(oldUpload, (error) => error.name === "AbortError");
  });
  assert.deepEqual(privateStore.files.map((file) => file.id), [ID_B]);
  assert.equal(privateStore.busy, false);
});
