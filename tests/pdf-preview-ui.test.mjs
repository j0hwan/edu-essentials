import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, StrictMode, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const calls = [];
const urls = new Map(), revoked = [], decodes = [];
let nextUrl = 0, deferDecode = false;
URL.createObjectURL = (blob) => {
  const url = `blob:page-${++nextUrl}`;
  urls.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url) => { urls.delete(url); revoked.push(url); };
dom.window.HTMLImageElement.prototype.decode = function () {
  Object.defineProperty(this, "naturalWidth", { configurable: true, value: this.width });
  Object.defineProperty(this, "naturalHeight", { configurable: true, value: this.height });
  return new Promise((resolve, reject) => {
    decodes.push({ image: this, resolve, reject });
    if (!deferDecode) resolve();
  });
};
globalThis.pdfPreviewTestRender = (data, page, signal) => new Promise((resolve, reject) => {
  signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  calls.push({ data, page, signal, resolve: (pages) => resolve({ pages, width: 900, height: 1200, image: new Blob(["PNG"], { type: "image/png" }) }), reject });
});
const observers = new Map();
globalThis.IntersectionObserver = class {
  constructor(callback, options) { this.callback = callback; this.options = options; }
  observe(element) { this.element = element; observers.set(Number(element.dataset.page), this); }
  disconnect() { if (observers.get(Number(this.element?.dataset.page)) === this) observers.delete(Number(this.element.dataset.page)); }
};
async function nearby(page, isIntersecting = true) {
  await act(async () => observers.get(page).callback([{ isIntersecting }]));
}
const mockRenderer = `data:text/javascript;base64,${Buffer.from("export const renderPdfPreviewPage = (...args) => globalThis.pdfPreviewTestRender(...args);").toString("base64")}`;
const source = await readFile(new URL("../app/pdf-preview.tsx", import.meta.url), "utf8");
let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
for (const specifier of ["react", "react/jsx-runtime"]) compiled = compiled.replaceAll(JSON.stringify(specifier), JSON.stringify(import.meta.resolve(specifier)));
compiled = compiled.replaceAll('"../lib/pdf-preview-client"', JSON.stringify(mockRenderer));
const { PdfPreview } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const host = document.getElementById("root");
let root;
async function mount(data = new Blob(["pdf"]), onSettled) {
  root ??= createRoot(host);
  await act(async () => root.render(createElement(PdfPreview, { data, name: "Private.pdf", downloadUrl: "blob:private-pdf", onSettled })));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  assert.equal(urls.size, 0, "all page URLs must be revoked on unmount");
  calls.length = 0;
  decodes.length = 0;
  revoked.length = 0;
  deferDecode = false;
});

test("stacks lazy PDF pages in order without pagination or embedded documents", async () => {
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  assert.match(host.textContent, /Rendering PDF/);
  assert.deepEqual(settlements, []);
  assert.equal(host.querySelector("iframe, object, embed, canvas"), null);
  await act(async () => calls[0].resolve(3));
  assert.deepEqual(settlements, ["settled"]);
  assert.equal(host.querySelector("img").hidden, false);
  assert.equal(host.querySelector("img").getAttribute("alt"), "Private.pdf, page 1");
  assert.deepEqual([...host.querySelectorAll(".pdf-preview-page")].map((page) => page.dataset.page), ["1", "2", "3"]);
  assert.equal(host.querySelector("button"), null);
  assert.doesNotMatch(host.textContent, /Previous page|Next page|Page \d+ of/);
  assert.equal(calls.length, 1);
  assert.equal(observers.get(2).options.root, host.querySelector(".private-pdf-preview"));
  await nearby(2);
  assert.equal(calls[1].page, 2);
  await act(async () => calls[1].resolve(3));
  assert.equal(host.querySelectorAll("img:not([hidden])").length, 2);
  assert.deepEqual(settlements, ["settled"]);
});

test("a changed source aborts old work and ignores its eventual completion", async () => {
  const oldSettlements = [], freshSettlements = [];
  await mount(new Blob(["old PDF"]), () => oldSettlements.push("old"));
  const old = calls[0];
  await mount(new Blob(["new PDF"]), () => freshSettlements.push("fresh"));
  assert.equal(old.signal.aborted, true);
  await act(async () => old.resolve(100));
  assert.match(host.textContent, /Rendering PDF/);
  assert.deepEqual(oldSettlements, []);
  assert.deepEqual(freshSettlements, []);
  await act(async () => calls[1].resolve(2));
  assert.equal(host.querySelectorAll(".pdf-preview-page").length, 2);
  assert.deepEqual(oldSettlements, []);
  assert.deepEqual(freshSettlements, ["fresh"]);
});

test("callback identity changes use the latest callback without restarting the first-page render", async () => {
  const data = new Blob(["same PDF"]);
  let oldCalls = 0, latestCalls = 0;
  await mount(data, () => oldCalls++);
  assert.equal(calls.length, 1);
  await mount(data, () => latestCalls++);
  assert.equal(calls.length, 1);
  await act(async () => calls[0].resolve(1));
  assert.equal(oldCalls, 0);
  assert.equal(latestCalls, 1);
});

test("a page-specific error leaves other pages available and can be retried", async () => {
  await mount();
  await act(async () => calls[0].resolve(3));
  await nearby(2);
  await act(async () => calls[1].reject(new Error("Malformed page")));
  assert.ok(host.querySelector('[role="alert"]'));
  assert.equal(host.querySelector('[data-page="1"] img').hidden, false);
  assert.equal(host.querySelectorAll(".pdf-preview-page").length, 3);
  await act(async () => host.querySelector("button").click());
  assert.equal(calls[2].page, 2);
  await act(async () => calls[2].resolve(3));
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(host.querySelectorAll("img:not([hidden])").length, 2);
});

test("serializes work and releases offscreen image URLs while preserving page space", async () => {
  await mount();
  await act(async () => calls[0].resolve(4));
  await nearby(2);
  await nearby(3);
  assert.equal(calls.length, 2);
  await act(async () => calls[1].resolve(4));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].page, 3);
  const firstImage = host.querySelector('[data-page="1"] img');
  const firstUrl = firstImage.src;
  await nearby(1, false);
  assert.equal(firstImage.hasAttribute("src"), false);
  assert.ok(revoked.includes(firstUrl));
  assert.equal(host.querySelector('[data-page="1"] img'), null);
  assert.match(host.querySelector('[data-page="1"]').style.aspectRatio, /^0\.75(?: \/ 1)?$/);
  await nearby(4);
  await nearby(3, false);
  assert.equal(calls[2].signal.aborted, true);
  assert.equal(calls[3].page, 4);
});

test("reentering the viewport creates a fresh image and ignores a late stale render", async () => {
  await mount();
  const old = calls[0];
  const oldImage = host.querySelector("img");
  await nearby(1, false);
  assert.equal(old.signal.aborted, true);
  assert.equal(oldImage.hasAttribute("src"), false);
  assert.equal(host.querySelector('[data-page="1"] img'), null);

  await nearby(1, true);
  assert.equal(calls.length, 2);
  const fresh = calls[1];
  assert.equal(fresh.page, 1);
  const freshImage = host.querySelector("img");
  assert.notEqual(freshImage, oldImage);
  await act(async () => fresh.resolve(1));
  assert.equal(freshImage.hidden, false);
  assert.equal(freshImage.width, 900);
  assert.equal(freshImage.height, 1200);

  await act(async () => old.resolve(99));
  assert.equal(host.querySelector('[data-page="1"] img'), freshImage);
  assert.equal(freshImage.hidden, false);
  assert.equal(freshImage.width, 900);
  assert.equal(freshImage.height, 1200);
});

test("first-page settlement waits for PNG decode, not just worker completion", async () => {
  deferDecode = true;
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  await act(async () => calls[0].resolve(2));
  const image = host.querySelector("img");
  assert.equal(image.hidden, true);
  assert.ok(urls.has(image.src));
  assert.deepEqual(settlements, []);
  assert.match(host.textContent, /Rendering PDF/);
  await act(async () => decodes[0].resolve());
  assert.deepEqual(settlements, ["settled"]);
  assert.equal(image.hidden, false);
  assert.equal(urls.size, 1);
});

test("a source change during decode revokes stale pixels and cannot settle the new source", async () => {
  deferDecode = true;
  const settlements = [];
  await mount(new Blob(["old"]), () => settlements.push("old"));
  await act(async () => calls[0].resolve(1));
  const oldUrl = decodes[0].image.src;
  await mount(new Blob(["new"]), () => settlements.push("new"));
  assert.ok(revoked.includes(oldUrl));
  await act(async () => decodes[0].resolve());
  assert.deepEqual(settlements, []);
  await act(async () => calls[1].resolve(2));
  await act(async () => decodes[1].resolve());
  assert.deepEqual(settlements, ["new"]);
});

test("decode failure offers retry and download rather than revealing an unusable image", async () => {
  deferDecode = true;
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  await act(async () => calls[0].resolve(1));
  assert.deepEqual(settlements, []);
  const failedUrl = decodes[0].image.src;
  await act(async () => decodes[0].reject(new Error("PNG decode failed")));
  assert.match(host.querySelector('[role="alert"]').textContent, /PNG decode failed/);
  assert.equal(host.querySelector("img").hidden, true);
  assert.deepEqual(settlements, ["settled"]);
  assert.equal(host.querySelector("a[download]").getAttribute("href"), "blob:private-pdf");
  await act(async () => host.querySelector("button").click());
  assert.ok(revoked.includes(failedUrl));
  await act(async () => calls[1].resolve(1));
  await act(async () => decodes[1].resolve());
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(host.querySelector("img").hidden, false);
  assert.deepEqual(settlements, ["settled"]);
});

test("unmount during decode revokes the URL and ignores late completion", async () => {
  deferDecode = true;
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  await act(async () => calls[0].resolve(1));
  const url = decodes[0].image.src;
  await act(async () => root.unmount());
  root = undefined;
  assert.ok(revoked.includes(url));
  await act(async () => decodes[0].resolve());
  assert.deepEqual(settlements, []);
  assert.equal(calls[0].signal.aborted, true);
});

test("decode timeout releases the queue, settles once, and ignores late completion", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  deferDecode = true;
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  await act(async () => calls[0].resolve(2));
  const failedUrl = decodes[0].image.src;
  await act(async () => context.mock.timers.tick(20_000));
  assert.match(host.querySelector('[role="alert"]').textContent, /decoding timed out/);
  assert.deepEqual(settlements, ["settled"]);
  assert.ok(revoked.includes(failedUrl));
  await act(async () => decodes[0].resolve());
  assert.equal(host.querySelector("img").hidden, true);
  assert.deepEqual(settlements, ["settled"]);
  await act(async () => host.querySelector("button").click());
  assert.equal(calls.length, 2);
  await act(async () => calls[1].resolve(2));
  await act(async () => decodes[1].resolve());
  assert.equal(host.querySelector("img").hidden, false);
  assert.deepEqual(settlements, ["settled"]);
});

test("aborting a page with a pending decode lets the next queued page render", async () => {
  await mount();
  await act(async () => calls[0].resolve(3));
  deferDecode = true;
  await nearby(2);
  await act(async () => calls[1].resolve(3));
  await nearby(3);
  assert.equal(calls.length, 2);
  const abandonedUrl = decodes[1].image.src;
  await nearby(2, false);
  assert.ok(revoked.includes(abandonedUrl));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].page, 3);
  await act(async () => calls[2].resolve(3));
  await act(async () => decodes[2].resolve());
  assert.equal(host.querySelector('[data-page="3"] img').hidden, false);
});

test("StrictMode effect cleanup replay still lets the surviving render become visible", async () => {
  root ??= createRoot(host);
  await act(async () => root.render(createElement(StrictMode, null, createElement(PdfPreview, {
    data: new Blob(["pdf"]), name: "Private.pdf", downloadUrl: "blob:private-pdf",
  }))));
  assert.equal(calls.length, 1);
  const surviving = calls[0];
  await act(async () => surviving.resolve(1));
  const image = host.querySelector('[data-page="1"] img');
  assert.equal(image.hidden, false);
  assert.equal(image.width, 900);
  assert.equal(image.height, 1200);
  assert.equal(surviving.signal.aborted, false);
});

test("failure offers retry and a private download, and unmount aborts work", async () => {
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  await act(async () => calls[0].reject(new Error("Invalid PDF")));
  assert.deepEqual(settlements, ["settled"]);
  assert.match(host.querySelector('[role="alert"]').textContent, /could not be previewed/);
  assert.match(host.querySelector('[role="alert"]').textContent, /Invalid PDF/);
  assert.equal(host.querySelector("a[download]").getAttribute("href"), "blob:private-pdf");
  await act(async () => host.querySelector("button").click());
  assert.equal(calls.length, 2);
  await act(async () => root.unmount());
  root = undefined;
  assert.equal(calls[1].signal.aborted, true);
  await act(async () => calls[1].resolve(1));
  assert.deepEqual(settlements, ["settled"]);
});
