import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createServer } from "vite";
import { createImportMetaUrlPlugin } from "../node_modules/vinext/dist/plugins/import-meta-url.js";

test("Vite and Vinext dev transforms construct a same-origin HTTP PDF worker", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: ".vinext/pdf-preview-worker-transform",
    logLevel: "silent",
    plugins: [createImportMetaUrlPlugin({ getRoot: () => root })],
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const client = server.environments.client;
    const source = await client.transformRequest("/lib/pdf-preview-client.ts");
    assert.ok(source);
    assert.doesNotMatch(source.code, /file:\/\/\/ROOT/);
    const workerImport = source.code.match(/import\s+PdfPreviewWorker\s+from\s+["']([^"']+\?worker)["']/)?.[1];
    assert.ok(workerImport, "The client must import Vite's worker constructor instead of resolving import.meta.url.");
    const wrapper = await client.transformRequest(workerImport);
    assert.ok(wrapper);
    const compiled = ts.transpileModule(wrapper.code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const requests = [], exports = {};
    vm.runInNewContext(compiled, { exports, Worker: class {
      constructor(url, options) { requests.push({ url, options }); }
    } });
    new exports.default();
    assert.equal(requests.length, 1);
    const origin = "http://127.0.0.1:3000";
    const target = new URL(requests[0].url, origin);
    assert.equal(target.protocol, "http:");
    assert.equal(target.origin, origin);
    assert.equal(requests[0].options.type, "module");
    assert.match(target.pathname, /\/pdf-preview\.worker\.ts$/);
    const entry = await client.transformRequest(`${target.pathname}${target.search}`);
    assert.match(entry?.code ?? "", /pdf-preview:render/);
  } finally { await server.close(); }
});
