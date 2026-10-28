import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { renderPdfPreviewPage } = await import(await clientModule("lib/pdf-preview.ts"));
const pdfBlob = () => new Blob(["%PDF-1.7\nprivate document"]);

function renderer({ renderPromise = Promise.resolve(), documentPromise, pagePromise } = {}) {
  const calls = { destroyed: 0, cancelled: 0, options: null, pages: [], renders: [] };
  const page = { getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: (options) => { calls.renders.push(options); return { promise: renderPromise, cancel: () => { calls.cancelled++; } }; } };
  const pdf = { numPages: 3, getPage: async (number) => { calls.pages.push(number); return pagePromise ?? page; } };
  const load = async () => ({ getDocument: (options) => { calls.options = options; return { promise: documentPromise ?? Promise.resolve(pdf), destroy: async () => { calls.destroyed++; } }; } });
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  return { calls, load, canvas };
}

test("renders selected PDF page as bounded pixels with scripting features disabled", async () => {
  const { calls, load, canvas } = renderer();
  assert.equal(await renderPdfPreviewPage(pdfBlob(), canvas, 2, new AbortController().signal, load), 3);
  assert.deepEqual(calls.pages, [2]);
  assert.equal(calls.options.enableXfa, false);
  assert.equal(calls.options.useWasm, false);
  assert.equal(calls.options.stopAtErrors, true);
  assert.equal(calls.options.url, undefined);
  assert.equal(canvas.width, 1200);
  assert.equal(canvas.height, 1600);
  assert.equal(calls.renders.length, 1);
  assert.equal(calls.destroyed, 1);
});

test("rejects HTML masquerading as PDF and oversized files before loading PDF.js", async () => {
  const { calls, load, canvas } = renderer();
  await assert.rejects(renderPdfPreviewPage(new Blob(['<script>alert(1)</script>'], { type: "application/pdf" }), canvas, 1, new AbortController().signal, load), /Invalid PDF/);
  await assert.rejects(renderPdfPreviewPage(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), canvas, 1, new AbortController().signal, load), /too large/);
  assert.equal(calls.options, null);
});

test("destroys malformed PDF documents and propagates errors for the fallback", async () => {
  const { calls, load, canvas } = renderer({ documentPromise: Promise.reject(new Error("Malformed PDF")) });
  await assert.rejects(renderPdfPreviewPage(pdfBlob(), canvas, 1, new AbortController().signal, load), /Malformed PDF/);
  assert.equal(calls.destroyed, 1);
});

test("aborting cancels an in-flight render and releases the PDF task", async () => {
  let finish;
  const renderPromise = new Promise((resolve) => { finish = resolve; });
  const { calls, load, canvas } = renderer({ renderPromise });
  const controller = new AbortController();
  const rendering = renderPdfPreviewPage(pdfBlob(), canvas, 1, controller.signal, load);
  while (!calls.renders.length) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  finish();
  assert.equal(await rendering, 0);
  assert.equal(calls.cancelled, 1);
  assert.ok(calls.destroyed >= 1);
});

test("an aborted source does not start parsing or rendering", async () => {
  const { calls, load, canvas } = renderer();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await renderPdfPreviewPage(pdfBlob(), canvas, 1, controller.signal, load), 0);
  assert.equal(calls.options, null);
});
