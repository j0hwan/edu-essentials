import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { renderPdfPreviewPage } = await import(await clientModule("lib/pdf-preview-client.ts"));
function setup() {
  const state = { terminated: 0, posted: [] };
  const worker = { postMessage: (message) => state.posted.push(message), terminate: () => { state.terminated++; } };
  const controller = new AbortController();
  return { state, worker, controller, data: new Blob(["%PDF-1.7"]) };
}
const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const resultMessage = (overrides = {}) => ({ type: "pdf-preview:result", pages: 3, image: image(), width: 600, height: 800, ...overrides });

test("accepts encoded PNG with bounded dimensions and terminates the worker", async () => {
  const { state, worker, controller, data } = setup();
  const promise = renderPdfPreviewPage(data, 2, controller.signal, () => worker);
  assert.deepEqual(state.posted, [{ type: "pdf-preview:render", data, page: 2 }]);
  const payload = resultMessage(); worker.onmessage({ data: payload });
  assert.deepEqual(await promise, { pages: 3, image: payload.image, width: 600, height: 800 });
  assert.equal(state.terminated, 1);
});

test("ignores startup messages", async () => {
  const { state, worker, controller, data } = setup();
  const promise = renderPdfPreviewPage(data, 1, controller.signal, () => worker);
  worker.onmessage({ data: { sourceName: "worker", action: "ready" } });
  assert.equal(state.terminated, 0);
  worker.onmessage({ data: resultMessage() });
  assert.equal((await promise).pages, 3);
});

test("abort resolves null, terminates immediately, and ignores late output", async () => {
  const { state, worker, controller, data } = setup();
  const promise = renderPdfPreviewPage(data, 1, controller.signal, () => worker);
  controller.abort();
  assert.equal(await promise, null);
  worker.onmessage({ data: resultMessage() });
  assert.equal(state.terminated, 1);
});

test("timeout and worker failure reject and terminate", async () => {
  const { state, worker, controller, data } = setup();
  await assert.rejects(renderPdfPreviewPage(data, 1, controller.signal, () => worker, 5), /timed out/);
  assert.equal(state.terminated, 1);
  const next = setup();
  const failed = renderPdfPreviewPage(next.data, 1, next.controller.signal, () => next.worker);
  next.worker.onerror();
  await assert.rejects(failed, /worker failed/);
});

test("rejects malformed PNG payloads and dimensions", async () => {
  for (const overrides of [
    { image: null }, { image: new Blob(["x"], { type: "image/jpeg" }) }, { image: new Blob([], { type: "image/png" }) },
    { pages: 0 }, { pages: 1.5 }, { width: 0 }, { height: 1601 }, { width: 1.5 },
  ]) {
    const { state, worker, controller, data } = setup();
    const promise = renderPdfPreviewPage(data, 1, controller.signal, () => worker);
    worker.onmessage({ data: resultMessage(overrides) });
    await assert.rejects(promise);
    assert.equal(state.terminated, 1);
  }
});

test("worker render errors retain bounded diagnostic detail", async () => {
  const { worker, controller, data } = setup();
  const promise = renderPdfPreviewPage(data, 1, controller.signal, () => worker);
  const reason = "Invalid PDF: ".padEnd(400, "x");
  worker.onmessage({ data: { type: "pdf-preview:result", error: true, reason } });
  await assert.rejects(promise, (error) => error.message === `PDF could not be rendered: ${reason.slice(0, 200)}`);
});

test("oversized and already-aborted inputs never start a worker", async () => {
  const { controller, data } = setup();
  const noWorker = () => { throw new Error("Worker must not start"); };
  await assert.rejects(renderPdfPreviewPage(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), 1, controller.signal, noWorker), /too large/);
  controller.abort();
  assert.equal(await renderPdfPreviewPage(data, 1, controller.signal, noWorker), null);
});
