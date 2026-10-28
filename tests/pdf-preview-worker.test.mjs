import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { renderPdfPreviewPage } = await import(await clientModule("lib/pdf-preview-client.ts"));

function setup() {
  const state = { terminated: 0, posted: [], painted: [], closed: 0 };
  const worker = { postMessage: (message) => state.posted.push(message), terminate: () => { state.terminated++; } };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => state.painted.push(args) }) };
  const bitmap = { width: 600, height: 800, close: () => { state.closed++; } };
  return { state, worker, canvas, bitmap, controller: new AbortController(), data: new Blob(["%PDF-1.7"]) };
}

test("only worker-rendered pixels reach the UI and the worker is terminated", async () => {
  const { state, worker, canvas, bitmap, controller, data } = setup();
  const result = renderPdfPreviewPage(data, canvas, 2, controller.signal, () => worker);
  assert.deepEqual(state.posted, [{ type: "pdf-preview:render", data, page: 2 }]);
  worker.onmessage({ data: { type: "pdf-preview:result", pages: 3, bitmap } });
  assert.equal(await result, 3);
  assert.equal(canvas.width, 600);
  assert.equal(state.painted.length, 1);
  assert.equal(state.closed, 1);
  assert.equal(state.terminated, 1);
});

test("a lost canvas context before or during drawing cannot report success", async () => {
  for (const lossPhase of ["before", "after"]) {
    const { state, worker, canvas, bitmap, controller, data } = setup();
    let lost = lossPhase === "before";
    canvas.getContext = () => ({
      isContextLost: () => lost,
      drawImage: (...args) => {
        state.painted.push(args);
        if (lossPhase === "after") lost = true;
      },
    });
    const result = renderPdfPreviewPage(data, canvas, 1, controller.signal, () => worker);
    worker.onmessage({ data: { type: "pdf-preview:result", pages: 1, bitmap } });

    await assert.rejects(result, /Canvas context was lost/);
    assert.equal(state.painted.length, lossPhase === "before" ? 0 : 1);
    assert.equal(state.closed, 1);
    assert.equal(state.terminated, 1);
  }
});

test("PDF.js startup and unrelated messages are ignored until the preview result arrives", async () => {
  const { state, worker, canvas, bitmap, controller, data } = setup();
  const result = renderPdfPreviewPage(data, canvas, 1, controller.signal, () => worker);
  worker.onmessage({ data: { sourceName: "worker", targetName: "main", action: "ready", data: null } });
  worker.onmessage({ data: undefined });
  assert.equal(state.terminated, 0);
  assert.equal(state.painted.length, 0);
  worker.onmessage({ data: { type: "pdf-preview:result", pages: 1, bitmap } });
  assert.equal(await result, 1);
  assert.equal(state.terminated, 1);
});

test("aborting terminates work immediately and ignores late results", async () => {
  const { state, worker, canvas, bitmap, controller, data } = setup();
  const result = renderPdfPreviewPage(data, canvas, 1, controller.signal, () => worker);
  controller.abort();
  assert.equal(await result, 0);
  worker.onmessage({ data: { type: "pdf-preview:result", pages: 3, bitmap } });
  assert.equal(state.terminated, 1);
  assert.equal(state.painted.length, 0);
  assert.equal(state.closed, 1);
});

test("unresponsive PDF processing is forcibly terminated on timeout", async () => {
  const { state, worker, canvas, controller, data } = setup();
  await assert.rejects(renderPdfPreviewPage(data, canvas, 1, controller.signal, () => worker, 5), /timed out/);
  assert.equal(state.terminated, 1);
});

test("worker failures and invalid output do not paint content", async () => {
  for (const failure of ["error", "parse", "oversized"]) {
    const { state, worker, canvas, bitmap, controller, data } = setup();
    const result = renderPdfPreviewPage(data, canvas, 1, controller.signal, () => worker);
    if (failure === "error") worker.onerror();
    else worker.onmessage({ data: failure === "parse" ? { type: "pdf-preview:result", error: true } : { type: "pdf-preview:result", pages: 3, bitmap: { ...bitmap, width: 50000 } } });
    await assert.rejects(result);
    assert.equal(state.terminated, 1);
    assert.equal(state.painted.length, 0);
  }
});

test("worker render errors retain bounded diagnostic detail", async () => {
  const { worker, canvas, controller, data } = setup();
  const result = renderPdfPreviewPage(data, canvas, 1, controller.signal, () => worker);
  const reason = "Invalid PDF: ".padEnd(400, "x");
  worker.onmessage({ data: { type: "pdf-preview:result", error: true, reason } });
  await assert.rejects(result, (error) => error.message === `PDF could not be rendered: ${reason.slice(0, 200)}`);
});

test("oversized and already-aborted inputs never start a worker", async () => {
  const { canvas, controller, data } = setup();
  const createWorker = () => { throw new Error("Worker must not start"); };
  await assert.rejects(renderPdfPreviewPage(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), canvas, 1, controller.signal, createWorker), /too large/);
  controller.abort();
  assert.equal(await renderPdfPreviewPage(data, canvas, 1, controller.signal, createWorker), 0);
});
