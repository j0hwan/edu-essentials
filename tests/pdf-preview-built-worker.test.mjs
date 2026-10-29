import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import { clientModule } from "./helpers/client-modules.mjs";

const { renderPdfPreviewPage } = await import(await clientModule("lib/pdf-preview-client.ts"));

function pdfBlob() {
  const contents = "0.2 0.4 0.8 rg 10 10 100 100 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [];
  for (const [index, body] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: "application/pdf" });
}

test("production worker renders through PDF.js browser startup messages", async () => {
  const directory = new URL("../dist/client/_next/static/", import.meta.url);
  const filename = (await readdir(directory)).find((name) => /^pdf-preview\.worker-.*\.js$/.test(name));
  assert.ok(filename, "Build the app before testing its emitted PDF worker.");
  const messages = [], draws = [];
  let terminated = false;
  const worker = {
    postMessage: (data) => { void scope.onmessage({ data }); },
    terminate: () => { terminated = true; },
  };
  const scope = {
    console, Blob, URL, TextDecoder, TextEncoder, AbortController, AbortSignal, setTimeout, clearTimeout, structuredClone, atob, btoa, performance,
    ReadableStream, WritableStream, TransformStream,
    onmessage: null, fonts: new Set(),
    postMessage: (data) => { messages.push(data); if (!terminated) worker.onmessage({ data }); },
    addEventListener: () => {}, removeEventListener: () => {},
  };
  scope.self = scope;
  scope.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width; this.height = height;
      this.context = new Proxy({ canvas: this, getTransform: () => new scope.DOMMatrix(), getLineDash: () => [] }, {
        get: (target, key) => key in target ? target[key] : (...args) => { draws.push([key, ...args]); },
      });
    }
    getContext() { return this.context; }
    async convertToBlob() { return new Blob([new Uint8Array([1])], { type: "image/png" }); }
  };
  scope.Path2D = class { constructor() { return new Proxy(this, { get: () => () => {} }); } };
  vm.runInNewContext(await readFile(new URL(filename, directory), "utf8"), scope);
  const preview = await renderPdfPreviewPage(pdfBlob(), 1, new AbortController().signal, () => worker);
  assert.equal(preview.pages, 1);
  assert.equal(preview.image.type, "image/png");
  assert.ok(preview.image.size > 0);
  assert.ok(messages.some((message) => message.action === "ready" && message.sourceName === "worker"));
  assert.ok(messages.some((message) => message.type === "pdf-preview:result" && message.image));
  assert.equal(terminated, true);
  assert.ok(draws.length > 0);
});
