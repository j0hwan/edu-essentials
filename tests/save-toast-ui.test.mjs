import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const [{ createElement, act }, { createRoot }, { default: SaveToast }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/save-toast.tsx")),
]);
const rootNode = document.getElementById("root");
const root = createRoot(rootNode);

async function render(props) {
  await act(async () => root.render(createElement(SaveToast, props)));
}
async function wait(ms) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}
async function waitForDismissal(timeoutMs = 1000) {
  let remaining = timeoutMs;
  await act(async () => {
    while (card() && remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      remaining -= 25;
    }
  });
  assert.equal(card(), null, "the inactive toast eventually unmounts");
}
function card() {
  return rootNode.querySelector(".save-toast-card");
}

test("save toast cancels an exit when reopened and eventually unmounts after closing", async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
    rootNode.innerHTML = "";
    dom.window.close();
  });

  await render({ active: false, title: "Saving workspace…", loading: true });
  assert.equal(card(), null, "an inactive toast starts unmounted");
  await render({ active: true, title: "Saving workspace…", loading: true });
  assert.ok(card(), "active save toast is mounted");
  assert.match(card().textContent, /Saving workspace/);

  // Let the first entry reach its exit, then reopen before the old dismissal
  // timer fires so a stale timer cannot remove the active toast.
  await render({ active: false, title: "Saving workspace…", loading: true });
  await wait(500);
  assert.ok(card()?.classList.contains("is-exiting"), "the first exit animation starts after minimum visibility");
  await render({ active: true, title: "Saving workspace…", loading: true, message: "A second edit is pending" });
  await wait(260);
  assert.ok(card(), "reopening cancels the previous exit timer");
  assert.match(card().textContent, /A second edit is pending/);

  await render({ active: false, title: "Saving workspace…", loading: true, message: "A second edit is pending" });
  await wait(80);
  assert.ok(card(), "closing keeps the last visible content through the exit");
  assert.match(card().textContent, /A second edit is pending/);
  await waitForDismissal();

  await render({ active: true, title: "Saving workspace…", loading: true, message: "A later edit is pending" });
  assert.ok(card(), "a later save mounts a fresh toast after the prior close");
  await wait(500);
  await render({ active: false, title: "Saving workspace…", loading: true, message: "A later edit is pending" });
  assert.ok(card(), "the second save also remains present for its exit");
  await waitForDismissal();
});
