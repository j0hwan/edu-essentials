import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let imageComplete = false, imageNaturalWidth = 0, imageDecode = () => Promise.resolve();
Object.defineProperties(dom.window.HTMLImageElement.prototype, {
  complete: { configurable: true, get: () => imageComplete },
  naturalWidth: { configurable: true, get: () => imageNaturalWidth },
  decode: { configurable: true, value() { return imageDecode(this); } },
});
let created = 0;
const revoked = [];
const previewBlobs = [];
globalThis.URL.createObjectURL = (blob) => { previewBlobs.push(blob); return `blob:inline-${++created}`; };
globalThis.URL.revokeObjectURL = (url) => revoked.push(url);
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
dom.window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;
const [{ createElement, act }, { createRoot }, { InlineFilePreview, FilePreview }] = await Promise.all([import("react"), import("react-dom/client"), import(await clientModule("app/private-files.tsx"))]);
const node = document.getElementById("root");
let root;
const file = (overrides = {}) => ({ id: "11111111-1111-4111-8111-111111111111", name: "Notes.txt", mime_type: "text/plain", size_bytes: 100, course_id: null, assignment_id: null, kind: "resource", state: "ready", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z", content_sha256: null, folder_id: null, content_backend: "object", metadata_revision: 1, content_revision: 1, trashed_at: null, deleted_at: null, trash_operation_id: null, original_folder_id: null, ...overrides });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function render(props) { await act(async () => root.render(createElement(InlineFilePreview, props))); }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function unmount() { if (root) await act(async () => root.unmount()); root = undefined; node.replaceChildren(); }
async function reset() { await unmount(); root = createRoot(node); }
afterEach(async () => { await unmount(); imageComplete = false; imageNaturalWidth = 0; imageDecode = () => Promise.resolve(); });

test("inline previews use a supplied loading fallback only until their private content is ready", async () => {
  await reset();
  const pending = deferred();
  const store = { blob: () => pending.promise };
  await render({ file: file(), store, loadingFallback: createElement("div", { role: "status" }, "Loading Syllabus") });
  assert.equal(node.querySelector('[role="status"]')?.textContent, "Loading Syllabus");
  assert.doesNotMatch(node.textContent, /Loading private preview/);
  pending.resolve(new Blob(["Loaded syllabus"]));
  await flush();
  assert.equal(node.querySelector('[role="status"]'), null);
  assert.equal(node.querySelector("pre")?.textContent, "Loaded syllabus");
});

test("PDF uses a private canvas renderer without embedding uploaded content", async () => {
  await reset();
  let reads = 0;
  await render({ file: file({ name: "Guide.pdf", mime_type: "application/pdf" }), store: { blob: async () => { reads++; return new Blob(["pdf"], { type: "application/pdf" }); } } });
  await flush();
  assert.ok(node.querySelector(".private-pdf-preview canvas"));
  assert.equal(node.querySelector("iframe, embed, object"), null);
  assert.match(node.querySelector('[role="alert"]').textContent, /could not be previewed/);
  assert.equal(reads, 1);
  assert.equal(node.querySelector('[role="dialog"], .modal-backdrop'), null);
  assert.ok(node.querySelector(".inline-file-preview"));
  assert.equal(node.querySelector("a[download]").getAttribute("href"), `blob:inline-${created}`);
});

test("modal PDF preview uses the same canvas renderer and normalizes the blob MIME", async () => {
  await reset();
  await act(async () => root.render(createElement(FilePreview, {
    file: file({ name: "Guide.pdf", mime_type: "application/pdf" }),
    store: { blob: async () => new Blob(["<html>not a PDF</html>"], { type: "text/html" }), url: () => "/private-download" },
    onClose: () => {}, onEdit: () => {}, canWrite: true,
  })));
  await flush();
  assert.ok(node.querySelector(".private-pdf-preview canvas"));
  assert.equal(node.querySelector("iframe, embed, object, script"), null);
  assert.match(node.querySelector('[role="alert"]').textContent, /could not be previewed/);
  assert.equal(previewBlobs.at(-1).type, "application/pdf");
  assert.equal([...node.querySelectorAll("a")].find((link) => link.textContent === "Download original file").getAttribute("href"), "/private-download");
});

test("text and image render, while unsupported files give a download hint without fetching", async () => {
  await reset();
  await render({ file: file(), store: { blob: async () => new Blob(["private text"]) } });
  await flush();
  assert.equal(node.querySelector("pre.syllabus-source")?.textContent, "private text");
  await render({ file: file({ mime_type: "image/png", name: "Photo.png" }), store: { blob: async () => new Blob(["image"], { type: "image/png" }) } });
  await flush();
  assert.match(node.querySelector("img")?.src ?? "", /^blob:inline-/);
  let reads = 0;
  await render({ file: file({ mime_type: "application/zip" }), store: { blob: async () => { reads++; return new Blob(); }, url: () => "/private-download" } });
  assert.match(node.textContent, /Download this file/);
  assert.equal(node.querySelector("a[download]").getAttribute("href"), "/private-download");
  assert.equal(reads, 0);
});

test("settlement waits for text readiness, uses the latest callback, and covers unavailable, unsupported, and failed requests", async () => {
  await reset();
  const pending = deferred();
  let reads = 0, oldCallbackCalls = 0, latestCallbackCalls = 0;
  const store = { blob: () => { reads++; return pending.promise; }, url: () => "/private-download" };
  await render({ file: file(), store, onPreviewSettled: () => oldCallbackCalls++ });
  await render({ file: file(), store, onPreviewSettled: () => latestCallbackCalls++ });
  assert.equal(reads, 1);
  assert.equal(oldCallbackCalls + latestCallbackCalls, 0);
  pending.resolve(new Blob(["ready text"]));
  await flush();
  assert.equal(node.querySelector("pre")?.textContent, "ready text");
  assert.equal(oldCallbackCalls, 0);
  assert.equal(latestCallbackCalls, 1);

  let terminalSettlements = 0, unavailableReads = 0;
  await render({ file: file({ state: "pending" }), store: { blob: async () => { unavailableReads++; }, url: () => "/private-download" }, onPreviewSettled: () => terminalSettlements++ });
  await flush();
  await render({ file: file({ mime_type: "application/zip" }), store: { blob: async () => { unavailableReads++; }, url: () => "/private-download" }, onPreviewSettled: () => terminalSettlements++ });
  await flush();
  await render({ file: file({ content_revision: 2 }), store: { blob: async () => { throw new Error("offline"); }, url: () => "/private-download" }, onPreviewSettled: () => terminalSettlements++ });
  await flush();
  assert.equal(terminalSettlements, 3);
  assert.equal(unavailableReads, 0);
});

test("image settlement waits for decode after load, including a cached complete image, and settles on image error", async () => {
  await reset();
  const pendingDecode = deferred();
  imageDecode = () => pendingDecode.promise;
  let settled = 0;
  const store = { blob: async () => new Blob(["image"], { type: "image/png" }), url: () => "/private-download" };
  await render({ file: file({ mime_type: "image/png" }), store, onPreviewSettled: () => settled++ });
  await flush();
  const image = node.querySelector("img");
  assert.ok(image);
  assert.equal(settled, 0);
  imageNaturalWidth = 640;
  await act(async () => image.dispatchEvent(new Event("load")));
  assert.equal(settled, 0);
  pendingDecode.resolve();
  await flush();
  assert.equal(settled, 1);

  imageComplete = true;
  imageNaturalWidth = 640;
  const cachedDecode = deferred();
  imageDecode = () => cachedDecode.promise;
  const cachedSettlements = [];
  await render({ file: file({ id: "22222222-2222-4222-8222-222222222222", mime_type: "image/png" }), store, onPreviewSettled: () => cachedSettlements.push("settled") });
  await flush();
  assert.equal(cachedSettlements.length, 0);
  cachedDecode.resolve();
  await flush();
  assert.deepEqual(cachedSettlements, ["settled"]);

  imageComplete = false;
  imageNaturalWidth = 0;
  imageDecode = () => Promise.resolve();
  const failedSettlements = [];
  await render({ file: file({ id: "33333333-3333-4333-8333-333333333333", mime_type: "image/png" }), store, onPreviewSettled: () => failedSettlements.push("settled") });
  await flush();
  await act(async () => node.querySelector("img").dispatchEvent(new Event("error")));
  assert.deepEqual(failedSettlements, ["settled"]);
  assert.match(node.querySelector('[role="alert"]')?.textContent ?? "", /could not be previewed/);
  assert.equal(node.querySelector("a[download]")?.getAttribute("href"), "/private-download");
});

test("observed stalled fetch aborts, settles to retry/download, and retry clears its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await reset();
    const stalled = deferred(), signals = [], settlements = [];
    let reads = 0;
    const store = {
      blob: (_file, signal) => {
        reads++;
        signals.push(signal);
        if (reads > 1) return Promise.resolve(new Blob(["recovered"]));
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
          stalled.promise.then(resolve, reject);
        });
      },
      url: () => "/private-download",
    };
    await render({ file: file(), store, onPreviewSettled: () => settlements.push("settled") });
    await flush();
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, false);

    await act(async () => t.mock.timers.tick(30_000));
    await flush();
    assert.equal(signals[0].aborted, true);
    assert.match(node.querySelector('[role="alert"]')?.textContent ?? "", /timed out/);
    assert.equal(node.querySelector("a[download]")?.getAttribute("href"), "/private-download");
    assert.deepEqual(settlements, ["settled"]);

    stalled.resolve(new Blob(["late response"]));
    await flush();
    assert.match(node.querySelector('[role="alert"]')?.textContent ?? "", /timed out/);
    assert.deepEqual(settlements, ["settled"]);

    await act(async () => node.querySelector("button").click());
    await flush();
    assert.equal(reads, 2);
    assert.equal(node.querySelector("pre")?.textContent, "recovered");
    assert.deepEqual(settlements, ["settled", "settled"]);
    await act(async () => t.mock.timers.tick(30_000));
    await flush();
    assert.equal(node.querySelector('[role="alert"]'), null);
    assert.deepEqual(settlements, ["settled", "settled"]);
  } finally {
    await unmount();
    t.mock.timers.reset();
  }
});

test("observed image decode deadline falls back, and stale source or unmounted decode work cannot settle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await reset();
    imageNaturalWidth = 640;
    const oldDecode = deferred(), oldSettlements = [], freshFetch = deferred(), signals = [];
    imageDecode = () => oldDecode.promise;
    const oldStore = { blob: async () => new Blob(["image"], { type: "image/png" }), url: () => "/private-download" };
    await render({ file: file({ mime_type: "image/png" }), store: oldStore, onPreviewSettled: () => oldSettlements.push("old") });
    await flush();
    const oldImage = node.querySelector("img");
    await act(async () => oldImage.dispatchEvent(new Event("load")));
    assert.deepEqual(oldSettlements, []);

    const revised = file({ content_revision: 2, updated_at: "2026-10-09T00:00:00.000Z", mime_type: "text/plain" });
    await render({ file: revised, store: { blob: async (_file, signal) => { signals.push(signal); return freshFetch.promise; } } });
    await flush();
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, false);
    await act(async () => t.mock.timers.tick(30_000));
    await flush();
    assert.equal(signals[0].aborted, false);
    assert.deepEqual(oldSettlements, []);
    oldDecode.resolve();
    await flush();
    assert.deepEqual(oldSettlements, []);

    await unmount();
    await reset();
    const unmountedDecode = deferred(), unmountedSettlements = [];
    imageDecode = () => unmountedDecode.promise;
    await render({ file: file({ mime_type: "image/png" }), store: oldStore, onPreviewSettled: () => unmountedSettlements.push("settled") });
    await flush();
    await act(async () => node.querySelector("img").dispatchEvent(new Event("load")));
    await unmount();
    await act(async () => t.mock.timers.tick(30_000));
    unmountedDecode.resolve();
    await flush();
    assert.deepEqual(unmountedSettlements, []);

    await reset();
    const terminalDecode = deferred(), terminalSettlements = [];
    imageDecode = () => terminalDecode.promise;
    await render({ file: file({ mime_type: "image/png" }), store: oldStore, onPreviewSettled: () => terminalSettlements.push("settled") });
    await flush();
    await act(async () => node.querySelector("img").dispatchEvent(new Event("load")));
    await act(async () => t.mock.timers.tick(30_000));
    await flush();
    assert.match(node.querySelector('[role="alert"]')?.textContent ?? "", /image preview timed out/i);
    assert.equal(node.querySelector("a[download]")?.getAttribute("href"), "/private-download");
    assert.deepEqual(terminalSettlements, ["settled"]);
    terminalDecode.resolve();
    await flush();
    assert.deepEqual(terminalSettlements, ["settled"]);
  } finally {
    await unmount();
    t.mock.timers.reset();
  }
});

test("retry refetches a failed request", async () => {
  await reset();
  let reads = 0;
  await render({ file: file(), store: { blob: async () => { reads++; if (reads === 1) throw new Error("offline"); return new Blob(["recovered"]); }, url: () => "/private-download" } });
  await flush();
  assert.match(node.textContent, /offline/);
  await act(async () => node.querySelector("button").click());
  await flush();
  assert.equal(node.querySelector("pre")?.textContent, "recovered");
  assert.equal(reads, 2);
});

test("source changes abort and revoke, stale completions cannot show, and unavailable files are not fetched", async () => {
  await reset();
  const old = deferred(), fresh = deferred(), signals = [];
  const storeOld = { blob: async (_file, signal) => { signals.push(signal); return old.promise; } };
  const oldSettlements = [], currentSettlements = [];
  await render({ file: file(), store: storeOld, onPreviewSettled: () => oldSettlements.push("old") });
  await flush();
  assert.equal(signals.length, 1);
  const revised = file({ content_revision: 2, updated_at: "2026-10-09T00:00:00.000Z" });
  const storeNew = { blob: async (_file, signal) => { signals.push(signal); return fresh.promise; } };
  await render({ file: revised, store: storeNew, onPreviewSettled: () => currentSettlements.push("current") });
  await flush();
  assert.equal(signals[0].aborted, true);
  old.resolve(new Blob(["stale"]));
  await flush();
  assert.equal(node.querySelector("pre"), null);
  assert.deepEqual(oldSettlements, []);
  fresh.resolve(new Blob(["current"]));
  await flush();
  assert.equal(node.querySelector("pre")?.textContent, "current");
  assert.deepEqual(currentSettlements, ["current"]);
  const currentUrl = `blob:inline-${created}`;
  await render({ file: file({ state: "pending" }), store: { blob: async () => { throw new Error("must not fetch"); } } });
  assert.ok(revoked.includes(currentUrl));
  assert.match(node.textContent, /not ready/);
  await render({ file: file({ deleted_at: "2026-10-10T00:00:00.000Z" }), store: { blob: async () => { throw new Error("must not fetch"); } } });
  assert.match(node.textContent, /Trash/);
  await render({ file: file({ trashed_at: "2026-10-10T00:00:00.000Z" }), store: { blob: async () => { throw new Error("must not fetch"); } } });
  assert.match(node.textContent, /Trash/);
});

test("unmount aborts a pending read and revokes its owned URL", async () => {
  await reset();
  const pending = deferred(), signals = [], settlements = [];
  await render({ file: file(), store: { blob: async (_file, signal) => { signals.push(signal); return pending.promise; } }, onPreviewSettled: () => settlements.push("settled") });
  await flush();
  await unmount();
  assert.equal(signals[0].aborted, true);
  pending.resolve(new Blob(["late"]));
  await flush();
  assert.deepEqual(settlements, []);

  root = createRoot(node);
  await render({ file: file({ mime_type: "application/pdf" }), store: { blob: async () => new Blob(["pdf"]) } });
  await flush();
  const owned = `blob:inline-${created}`;
  await unmount();
  assert.ok(revoked.includes(owned));
});

test("oversized text is not decoded even when saved metadata understates its size", async () => {
  await reset();
  let decoded = false;
  const oversized = new Blob(["x".repeat(1_000_001)]);
  oversized.text = async () => { decoded = true; return "too large"; };
  await render({ file: file(), store: { blob: async () => oversized, url: () => "/private-download" } });
  await flush();
  assert.equal(decoded, false);
  assert.match(node.querySelector('[role="alert"]').textContent, /too large to preview/);
  assert.equal(node.querySelector("a[download]").getAttribute("href"), "/private-download");
});

test("returning to a ready source waits for a fresh read instead of reusing its revoked URL", async () => {
  await reset();
  const refresh = deferred();
  let reads = 0;
  const store = { blob: async () => ++reads === 1 ? new Blob(["original"]) : refresh.promise };
  const ready = file();
  await render({ file: ready, store });
  await flush();
  assert.equal(node.querySelector("pre").textContent, "original");
  const originalUrl = `blob:inline-${created}`;
  await render({ file: file({ state: "pending" }), store });
  assert.ok(revoked.includes(originalUrl));
  await render({ file: ready, store });
  assert.equal(node.querySelector("pre"), null);
  assert.match(node.textContent, /Loading private preview/);
  refresh.resolve(new Blob(["refreshed"]));
  await flush();
  assert.equal(node.querySelector("pre").textContent, "refreshed");
});
