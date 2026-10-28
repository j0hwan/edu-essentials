import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { clientModule } from "./helpers/client-modules.mjs";

function documentBlob(transparent = false) {
  const contents = `${transparent ? "/GS1 gs " : ""}0.2 0.4 0.8 rg 10 10 100 100 re f\nBT /F1 12 Tf 20 150 Td (Private PDF preview) Tj ET`;
  const transparencyGroup = transparent ? "/Group << /S /Transparency /CS /DeviceRGB >>" : "";
  const graphicsState = transparent ? "/ExtGState << /GS1 << /Type /ExtGState /BM /Multiply /ca 0.5 /CA 0.5 >> >>" : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${transparencyGroup} /Resources << /Font << /F1 5 0 R >> ${graphicsState} >> /Contents 4 0 R >>`,
    `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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

test("worker pipeline parses real PDFs and preserves alpha in transparency layers", async () => {
  const messages = [], draws = [], contexts = [];
  globalThis.self = { fonts: new Set(), postMessage: (message) => messages.push(message) };
  globalThis.FontFace = class {
    constructor(family) { this.family = family; this.loaded = Promise.resolve(this); }
    load() { return this.loaded; }
  };
  globalThis.Path2D = class { constructor() { return new Proxy(this, { get: () => () => {} }); } };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width; this.height = height;
      this.context = new Proxy({ canvas: this, getTransform: () => new DOMMatrix(), getLineDash: () => [], measureText: () => ({ width: 10 }) }, {
        get: (target, key) => key in target ? target[key] : (...args) => { draws.push([key, ...args]); },
      });
    }
    getContext(kind, options) { contexts.push({ canvas: this, width: this.width, kind, options }); return this.context; }
    transferToImageBitmap() { return { width: this.width, height: this.height }; }
  };
  let source = await readFile(new URL("../lib/pdf-preview.worker.ts", import.meta.url), "utf8");
  source = source.replace('"./pdf-preview"', JSON.stringify(await clientModule("lib/pdf-preview.ts"))).replace('"unpdf/pdfjs"', JSON.stringify(import.meta.resolve("unpdf/pdfjs")));
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  await self.onmessage({ data: { type: "pdf-preview:render", data: documentBlob(), page: 1 } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].error, undefined);
  assert.equal(messages[0].type, "pdf-preview:result");
  assert.equal(messages[0].pages, 1);
  assert.equal(messages[0].bitmap.width, 1200);
  assert.ok(messages[0].bitmap.height <= 1600);
  assert.ok(draws.some(([method]) => method === "fillText"));
  contexts.length = 0;
  await self.onmessage({ data: { type: "pdf-preview:render", data: documentBlob(true), page: 1 } });
  assert.equal(messages[1].error, undefined);
  assert.equal(messages[1].pages, 1);
  const pageContext = contexts.find((request) => request.options?.alpha === false);
  assert.ok(pageContext, "the final display canvas remains opaque");
  const layers = contexts.filter((request) => request.canvas !== pageContext.canvas && request.width > 1);
  assert.ok(layers.length > 0, "the PDF exercises a real compositing layer");
  assert.ok(layers.every((request) => request.options?.alpha !== false), "temporary PDF layers must retain transparency rather than paint an opaque black background");
});
