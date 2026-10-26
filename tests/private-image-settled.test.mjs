import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLImageElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let objectUrlId = 0;
const nativeCreateObjectURL = globalThis.URL.createObjectURL;
const nativeRevokeObjectURL = globalThis.URL.revokeObjectURL;
globalThis.URL.createObjectURL = () => `blob:private-image-${++objectUrlId}`;
globalThis.URL.revokeObjectURL = () => {};
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
dom.window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;

const [{ createElement, act }, { createRoot }, { PrivateImage }] = await Promise.all([
  import("react"), import("react-dom/client"), import(await clientModule("app/private-files.tsx")),
]);

const rootNode = document.getElementById("root");
let root;

const file = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", name: "Course photo.png", mime_type: "image/png", size_bytes: 100,
  course_id: "biology", assignment_id: null, kind: "class-image", state: "ready",
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z",
  content_sha256: null, folder_id: null, content_backend: "object", metadata_revision: 1,
  content_revision: 5, trashed_at: null, deleted_at: null, trash_operation_id: null, original_folder_id: null,
  ...overrides,
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function reset() {
  await unmount();
  rootNode.replaceChildren();
  root = createRoot(rootNode);
}

async function render(props) {
  await act(async () => root.render(createElement(PrivateImage, props)));
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function waitUntil(predicate, description, timeoutMs = 3000) {
  let elapsed = 0;
  while (!predicate() && elapsed < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await act(async () => { await Promise.resolve(); });
    elapsed += 10;
  }
  assert.ok(predicate(), `Timed out waiting for ${description}`);
}

async function unmount() {
  if (!root) return;
  await act(async () => root.unmount());
  root = undefined;
  rootNode.replaceChildren();
}

function installImageState({ complete = false, naturalWidth = 120, decode = () => Promise.resolve() } = {}) {
  const prototype = window.HTMLImageElement.prototype;
  const descriptors = Object.fromEntries(["complete", "naturalWidth", "decode"].map((key) => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
  Object.defineProperty(prototype, "complete", { configurable: true, get: () => complete });
  Object.defineProperty(prototype, "naturalWidth", { configurable: true, get: () => naturalWidth });
  Object.defineProperty(prototype, "decode", { configurable: true, value: decode });
  return () => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(prototype, key, descriptor);
      else delete prototype[key];
    }
  };
}

afterEach(async () => {
  await unmount();
  globalThis.URL.createObjectURL = nativeCreateObjectURL;
  globalThis.URL.revokeObjectURL = nativeRevokeObjectURL;
  dom.window.URL.createObjectURL = nativeCreateObjectURL;
  dom.window.URL.revokeObjectURL = nativeRevokeObjectURL;
});

test("onSettled waits for decode, uses the latest callback, and fires once per source revision", async () => {
  await reset();
  const decode = deferred(), calls = [];
  let blobReads = 0, decodeCalls = 0;
  const restoreImage = installImageState({ decode: () => { decodeCalls += 1; return decode.promise; } });
  const currentFile = file();
  const store = { blob: async () => { blobReads += 1; return new Blob(["course image"], { type: "image/png" }); } };
  try {
    await render({ file: currentFile, store, fadeIn: false, onSettled: () => calls.push("old") });
    await waitUntil(() => !!rootNode.querySelector("img"), "the compact course image");
    assert.equal(calls.length, 0, "creating a URL does not settle before the image decodes");

    const image = rootNode.querySelector("img");
    await act(async () => image.dispatchEvent(new Event("load")));
    assert.equal(calls.length, 0, "the load event alone is not a successful decode");
    await render({ file: currentFile, store, fadeIn: false, onSettled: () => calls.push("latest") });
    assert.equal(blobReads, 1, "changing the callback does not fetch the blob again");
    assert.equal(decodeCalls, 1, "changing the callback does not restart image decoding");

    await act(async () => { decode.resolve(); await decode.promise; await Promise.resolve(); });
    assert.deepEqual(calls, ["latest"]);
    await render({ file: currentFile, store, fadeIn: false, onSettled: () => calls.push("rerender") });
    assert.deepEqual(calls, ["latest"], "rerendering the same source does not notify twice");

    const revisedFile = file({ content_revision: 6, updated_at: "2026-10-09T00:00:00.000Z" });
    await render({ file: revisedFile, store, fadeIn: false, onSettled: () => calls.push("revision") });
    await waitUntil(() => !!rootNode.querySelector("img"), "the revised course image");
    await act(async () => rootNode.querySelector("img").dispatchEvent(new Event("load")));
    await flush();
    assert.equal(blobReads, 2);
    assert.deepEqual(calls, ["latest", "revision"], "a new content revision gets its own settlement");
  } finally {
    restoreImage();
  }
});

test("blob, image load, and decode failures settle the current request", async () => {
  await reset();
  let blobFailureCalls = 0;
  const restoreImage = installImageState();
  try {
    await render({ file: file(), store: { blob: async () => { throw new Error("offline"); } }, onSettled: () => { blobFailureCalls += 1; } });
    await flush();
    assert.equal(rootNode.querySelector("img"), null, "a failed blob read never creates an image URL");
    assert.equal(blobFailureCalls, 1, "a blob fetch rejection unblocks the dashboard");
  } finally {
    restoreImage();
  }

  await reset();
  let imageErrorCalls = 0;
  const restoreImageError = installImageState();
  try {
    await render({ file: file(), store: { blob: async () => new Blob(["bad image"], { type: "image/png" }) }, onSettled: () => { imageErrorCalls += 1; } });
    await waitUntil(() => !!rootNode.querySelector("img"), "the image that will fail to load");
    await act(async () => rootNode.querySelector("img").dispatchEvent(new Event("error")));
    assert.equal(imageErrorCalls, 1, "an img error settles a request without a URL decode");
    assert.equal(rootNode.querySelector("img"), null, "a failed image is removed so the card fallback can show cleanly");
  } finally {
    restoreImageError();
  }

  await reset();
  let decodeFailureCalls = 0;
  const restoreDecodeFailure = installImageState({ decode: () => Promise.reject(new Error("decode failed")) });
  try {
    await render({ file: file(), store: { blob: async () => new Blob(["bad image"], { type: "image/png" }) }, onSettled: () => { decodeFailureCalls += 1; } });
    await waitUntil(() => !!rootNode.querySelector("img"), "the image that will fail to decode");
    await act(async () => rootNode.querySelector("img").dispatchEvent(new Event("load")));
    await flush();
    assert.equal(decodeFailureCalls, 1, "decode rejection settles the request");
    assert.ok(rootNode.querySelector("img"), "a decode rejection with positive naturalWidth can keep the usable image visible");
  } finally {
    restoreDecodeFailure();
  }

  await reset();
  let emptyCompleteCalls = 0;
  const restoreEmptyComplete = installImageState({ complete: true, naturalWidth: 0 });
  try {
    await render({ file: file(), store: { blob: async () => new Blob(["empty image"], { type: "image/png" }) }, onSettled: () => { emptyCompleteCalls += 1; } });
    await flush();
    assert.equal(emptyCompleteCalls, 1, "a completed image without decoded pixels settles as a failure");
    assert.equal(rootNode.querySelector("img"), null, "an invalid complete image is removed for the fallback");
  } finally {
    restoreEmptyComplete();
  }
});

test("a valid already-complete image settles after decode", async () => {
  await reset();
  const decode = deferred(), calls = [];
  let decodeCalls = 0;
  const restoreImage = installImageState({ complete: true, naturalWidth: 48, decode: () => { decodeCalls += 1; return decode.promise; } });
  try {
    await render({ file: file(), store: { blob: async () => new Blob(["cached image"], { type: "image/png" }) }, fadeIn: false, onSettled: () => calls.push(true) });
    await waitUntil(() => decodeCalls === 1, "decode of the complete cached image");
    assert.deepEqual(calls, [], "a complete image still waits for its decode promise");
    await act(async () => { decode.resolve(); await decode.promise; await Promise.resolve(); });
    assert.deepEqual(calls, [true]);
  } finally {
    restoreImage();
  }
});

test("source changes abort old reads and unmount prevents late settlement", async () => {
  await reset();
  const oldBytes = deferred(), newBytes = deferred(), signals = [];
  const notices = { old: 0, current: 0 };
  const restoreImage = installImageState({ decode: () => Promise.resolve() });
  const oldFile = file();
  const oldStore = { blob: async (_file, signal) => { signals.push(signal); return oldBytes.promise; } };
  const newFile = file({ content_revision: 6, updated_at: "2026-10-09T00:00:00.000Z" });
  const newStore = { blob: async (_file, signal) => { signals.push(signal); return newBytes.promise; } };
  try {
    await render({ file: oldFile, store: oldStore, onSettled: () => { notices.old += 1; } });
    await waitUntil(() => signals.length === 1, "the original image request");
    await render({ file: newFile, store: newStore, onSettled: () => { notices.current += 1; } });
    await waitUntil(() => signals.length === 2, "the replacement image request");
    assert.equal(signals[0].aborted, true, "the source change aborts the old account/source read");

    oldBytes.reject(new Error("late old read"));
    await flush();
    assert.deepEqual(notices, { old: 0, current: 0 }, "the abandoned source cannot signal dashboard readiness");

    await act(async () => { newBytes.resolve(new Blob(["current image"], { type: "image/png" })); await newBytes.promise; await Promise.resolve(); });
    await waitUntil(() => !!rootNode.querySelector("img"), "the current image");
    await act(async () => rootNode.querySelector("img").dispatchEvent(new Event("load")));
    await flush();
    assert.deepEqual(notices, { old: 0, current: 1 });

    const pending = deferred();
    const pendingSignal = [];
    await render({ file: file({ content_revision: 7, updated_at: "2026-10-10T00:00:00.000Z" }), store: { blob: async (_file, signal) => { pendingSignal.push(signal); return pending.promise; } }, onSettled: () => { notices.old += 1; } });
    await waitUntil(() => pendingSignal.length === 1, "the image request that will be unmounted");
    await unmount();
    assert.equal(pendingSignal[0].aborted, true);
    pending.resolve(new Blob(["after unmount"], { type: "image/png" }));
    await flush();
    assert.deepEqual(notices, { old: 0, current: 1 }, "an unmounted image cannot settle later");
  } finally {
    restoreImage();
  }
});

test("the opt-in watchdog settles a hung image read and aborts it", async () => {
  await reset();
  const pending = deferred(), calls = [], signals = [], watchdogs = [];
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 15_000) {
      const handle = { watchdog: watchdogs.length };
      watchdogs.push({ callback: () => callback(...args), handle });
      return handle;
    }
    return nativeSetTimeout(callback, delay, ...args);
  };
  globalThis.clearTimeout = (handle) => handle?.watchdog === undefined ? nativeClearTimeout(handle) : undefined;
  try {
    await render({ file: file(), store: { blob: async (_file, signal) => { signals.push(signal); return pending.promise; } }, onSettled: () => calls.push(true) });
    await waitUntil(() => watchdogs.length === 1 && signals.length === 1, "the watchdog for a hung opt-in image");
    await act(async () => watchdogs[0].callback());
    assert.deepEqual(calls, [true], "the watchdog releases dashboard readiness");
    assert.equal(signals[0].aborted, true, "the hung blob request is aborted after the timeout");
    pending.resolve(new Blob(["late image"], { type: "image/png" }));
    await flush();
    assert.equal(rootNode.querySelector("img"), null, "a late response cannot recreate an image after timeout");
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }
});
