import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
afterEach(unmount);

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
  await render({ file: file(), store: storeOld });
  await flush();
  assert.equal(signals.length, 1);
  const revised = file({ content_revision: 2, updated_at: "2026-10-09T00:00:00.000Z" });
  const storeNew = { blob: async (_file, signal) => { signals.push(signal); return fresh.promise; } };
  await render({ file: revised, store: storeNew });
  await flush();
  assert.equal(signals[0].aborted, true);
  old.resolve(new Blob(["stale"]));
  await flush();
  assert.equal(node.querySelector("pre"), null);
  fresh.resolve(new Blob(["current"]));
  await flush();
  assert.equal(node.querySelector("pre")?.textContent, "current");
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
  const pending = deferred(), signals = [];
  await render({ file: file(), store: { blob: async (_file, signal) => { signals.push(signal); return pending.promise; } } });
  await flush();
  await unmount();
  assert.equal(signals[0].aborted, true);

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
