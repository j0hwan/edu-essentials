import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const calls = [];
globalThis.pdfPreviewTestRender = (data, canvas, page, signal) => new Promise((resolve, reject) => calls.push({ data, canvas, page, signal, resolve, reject }));
const mockRenderer = `data:text/javascript;base64,${Buffer.from("export const renderPdfPreviewPage = (...args) => globalThis.pdfPreviewTestRender(...args);").toString("base64")}`;
const source = await readFile(new URL("../app/pdf-preview.tsx", import.meta.url), "utf8");
let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
for (const specifier of ["react", "react/jsx-runtime"]) compiled = compiled.replaceAll(JSON.stringify(specifier), JSON.stringify(import.meta.resolve(specifier)));
compiled = compiled.replaceAll('"../lib/pdf-preview-client"', JSON.stringify(mockRenderer));
const { PdfPreview } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const host = document.getElementById("root");
let root;
async function mount(data = new Blob(["pdf"])) {
  root ??= createRoot(host);
  await act(async () => root.render(createElement(PdfPreview, { data, name: "Private.pdf", downloadUrl: "blob:private-pdf" })));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; calls.length = 0; });

test("shows PDF pages with accessible controls without embedding a document", async () => {
  await mount();
  assert.match(host.textContent, /Rendering PDF/);
  assert.equal(host.querySelector("iframe, object, embed"), null);
  await act(async () => calls[0].resolve(3));
  assert.equal(host.querySelector("canvas").hidden, false);
  assert.equal(host.querySelector("canvas").getAttribute("aria-label"), "Private.pdf, page 1");
  const [previous, next] = host.querySelectorAll("button");
  assert.equal(previous.disabled, true);
  await act(async () => next.click());
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].page, 2);
  assert.notEqual(calls[0].canvas, calls[1].canvas);
  await act(async () => calls[1].resolve(3));
  assert.match(host.textContent, /Page 2 of 3/);
});

test("a changed source aborts old work and ignores its eventual completion", async () => {
  await mount();
  const old = calls[0];
  await mount(new Blob(["new PDF"]));
  assert.equal(old.signal.aborted, true);
  await act(async () => old.resolve(100));
  assert.match(host.textContent, /Rendering PDF/);
  await act(async () => calls[1].resolve(2));
  assert.match(host.textContent, /Page 1 of 2/);
});

test("a page-specific error retains navigation back to a working page", async () => {
  await mount();
  await act(async () => calls[0].resolve(3));
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Next page").click());
  await act(async () => calls[1].reject(new Error("Malformed page")));
  assert.ok(host.querySelector('[role="alert"]'));
  const previous = [...host.querySelectorAll("button")].find((button) => button.textContent === "Previous page");
  assert.equal(previous.disabled, false);
  await act(async () => previous.click());
  assert.equal(calls[2].page, 1);
  await act(async () => calls[2].resolve(3));
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.match(host.textContent, /Page 1 of 3/);
});

test("failure offers retry and a private download, and unmount aborts work", async () => {
  await mount();
  await act(async () => calls[0].reject(new Error("Invalid PDF")));
  assert.match(host.querySelector('[role="alert"]').textContent, /could not be previewed/);
  assert.match(host.querySelector('[role="alert"]').textContent, /Invalid PDF/);
  assert.equal(host.querySelector("a[download]").getAttribute("href"), "blob:private-pdf");
  await act(async () => host.querySelector("button").click());
  assert.equal(calls.length, 2);
  await act(async () => root.unmount());
  root = undefined;
  assert.equal(calls[1].signal.aborted, true);
});
