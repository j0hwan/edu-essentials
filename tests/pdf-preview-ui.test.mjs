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
globalThis.pdfPreviewTestRender = (data, canvas, page, signal) => new Promise((resolve, reject) => {
  canvas.width = 900;
  canvas.height = 1200;
  signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  calls.push({ data, canvas, page, signal, resolve, reject });
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
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; calls.length = 0; });

test("stacks lazy PDF pages in order without pagination or embedded documents", async () => {
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  assert.match(host.textContent, /Rendering PDF/);
  assert.deepEqual(settlements, []);
  assert.equal(host.querySelector("iframe, object, embed"), null);
  await act(async () => calls[0].resolve(3));
  assert.deepEqual(settlements, ["settled"]);
  assert.equal(host.querySelector("canvas").hidden, false);
  assert.equal(host.querySelector("canvas").getAttribute("aria-label"), "Private.pdf, page 1");
  assert.deepEqual([...host.querySelectorAll(".pdf-preview-page")].map((page) => page.dataset.page), ["1", "2", "3"]);
  assert.equal(host.querySelector("button"), null);
  assert.doesNotMatch(host.textContent, /Previous page|Next page|Page \d+ of/);
  assert.equal(calls.length, 1);
  assert.equal(observers.get(2).options.root, host.querySelector(".private-pdf-preview"));
  await nearby(2);
  assert.equal(calls[1].page, 2);
  assert.notEqual(calls[0].canvas, calls[1].canvas);
  await act(async () => calls[1].resolve(3));
  assert.equal(host.querySelectorAll("canvas:not([hidden])").length, 2);
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
  assert.equal(host.querySelector('[data-page="1"] canvas').hidden, false);
  assert.equal(host.querySelectorAll(".pdf-preview-page").length, 3);
  await act(async () => host.querySelector("button").click());
  assert.equal(calls[2].page, 2);
  await act(async () => calls[2].resolve(3));
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(host.querySelectorAll("canvas:not([hidden])").length, 2);
});

test("serializes work and releases offscreen canvases while preserving page space", async () => {
  await mount();
  await act(async () => calls[0].resolve(4));
  await nearby(2);
  await nearby(3);
  assert.equal(calls.length, 2);
  await act(async () => calls[1].resolve(4));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].page, 3);
  const firstCanvas = calls[0].canvas;
  await nearby(1, false);
  assert.equal(firstCanvas.width, 0);
  assert.equal(firstCanvas.height, 0);
  assert.equal(host.querySelector('[data-page="1"] canvas'), null);
  assert.match(host.querySelector('[data-page="1"]').style.aspectRatio, /^0\.75(?: \/ 1)?$/);
  await nearby(4);
  await nearby(3, false);
  assert.equal(calls[2].signal.aborted, true);
  assert.equal(calls[3].page, 4);
});

test("reentering the viewport creates a fresh canvas and ignores a late stale render", async () => {
  await mount();
  const old = calls[0];
  const oldCanvas = old.canvas;
  await nearby(1, false);
  assert.equal(old.signal.aborted, true);
  assert.equal(oldCanvas.width, 0);
  assert.equal(oldCanvas.height, 0);
  assert.equal(host.querySelector('[data-page="1"] canvas'), null);

  await nearby(1, true);
  assert.equal(calls.length, 2);
  const fresh = calls[1];
  assert.equal(fresh.page, 1);
  assert.notEqual(fresh.canvas, oldCanvas);
  await act(async () => fresh.resolve(1));
  assert.equal(fresh.canvas.hidden, false);
  assert.equal(fresh.canvas.width, 900);
  assert.equal(fresh.canvas.height, 1200);

  await act(async () => old.resolve(99));
  assert.equal(host.querySelector('[data-page="1"] canvas'), fresh.canvas);
  assert.equal(fresh.canvas.hidden, false);
  assert.equal(fresh.canvas.width, 900);
  assert.equal(fresh.canvas.height, 1200);
});

test("context loss during an active render aborts it and rerenders on a fresh canvas", async () => {
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  const stale = calls[0];

  await act(async () => stale.canvas.dispatchEvent(new Event("contextlost")));

  assert.equal(stale.signal.aborted, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(settlements, []);
  const fresh = calls[1];
  assert.notEqual(fresh.canvas, stale.canvas);
  await act(async () => fresh.resolve(1));
  await act(async () => stale.resolve(99));
  assert.deepEqual(settlements, ["settled"]);
  assert.equal(host.querySelector('[data-page="1"] canvas'), fresh.canvas);
  assert.equal(fresh.canvas.hidden, false);
});

test("context loss on a ready page leaves another page render usable", async () => {
  await mount();
  const firstPage = calls[0];
  await act(async () => firstPage.resolve(3));
  await nearby(2);
  const secondPage = calls[1];

  await act(async () => firstPage.canvas.dispatchEvent(new Event("contextlost")));
  assert.equal(secondPage.signal.aborted, false);
  assert.equal(calls.length, 2);

  await act(async () => secondPage.resolve(3));
  assert.equal(calls.length, 3);
  const recoveredFirstPage = calls[2];
  assert.equal(recoveredFirstPage.page, 1);
  assert.notEqual(recoveredFirstPage.canvas, firstPage.canvas);
  assert.equal(secondPage.canvas.hidden, false);
  await act(async () => recoveredFirstPage.resolve(3));
  assert.equal(secondPage.canvas.hidden, false);
  assert.equal(recoveredFirstPage.canvas.hidden, false);
});

test("repeated context loss offers fallback and manual retry resets recovery allowance", async () => {
  const settlements = [];
  await mount(new Blob(["pdf"]), () => settlements.push("settled"));
  await act(async () => calls[0].canvas.dispatchEvent(new Event("contextlost")));
  assert.deepEqual(settlements, []);
  await act(async () => calls[1].canvas.dispatchEvent(new Event("contextlost")));

  assert.match(host.querySelector('[role="alert"]').textContent, /context was lost/);
  assert.deepEqual(settlements, ["settled"]);
  assert.equal(host.querySelector("a[download]").getAttribute("href"), "blob:private-pdf");
  await act(async () => host.querySelector("button").click());
  assert.equal(calls.length, 3);
  await act(async () => calls[2].canvas.dispatchEvent(new Event("contextlost")));
  assert.equal(calls.length, 4);
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.deepEqual(settlements, ["settled"]);
});

test("context loss after unmount is ignored and its listener is removed", async () => {
  await mount();
  const staleCanvas = calls[0].canvas;
  await act(async () => root.unmount());
  root = undefined;
  const countAfterUnmount = calls.length;

  staleCanvas.dispatchEvent(new Event("contextlost"));

  assert.equal(calls.length, countAfterUnmount);
  assert.equal(calls[0].signal.aborted, true);
});

test("StrictMode effect cleanup replay still lets the surviving render become visible", async () => {
  root ??= createRoot(host);
  await act(async () => root.render(createElement(StrictMode, null, createElement(PdfPreview, {
    data: new Blob(["pdf"]), name: "Private.pdf", downloadUrl: "blob:private-pdf",
  }))));
  assert.equal(calls.length, 1);
  const surviving = calls[0];
  await act(async () => surviving.resolve(1));
  assert.equal(host.querySelector('[data-page="1"] canvas'), surviving.canvas);
  assert.equal(surviving.canvas.hidden, false);
  assert.equal(surviving.canvas.width, 900);
  assert.equal(surviving.canvas.height, 1200);
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
