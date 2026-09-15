import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Grid } = await import(await clientModule("app/animated-widget-grid.tsx"));
let systemReduced = false;
window.matchMedia = () => ({ matches: systemReduced });

function setup() {
  systemReduced = false;
  document.documentElement.dataset.motion = "full";
  const calls = [];
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  const originalAnimate = window.HTMLElement.prototype.animate;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const large = document.querySelector('[data-widget-id="a"]')?.dataset.size === "large";
    const a = this.dataset.widgetId === "a";
    return new window.DOMRect(a || large ? 0 : 250, !a && large ? 250 : 0, a && large ? 500 : 240, a && large ? 240 : 180);
  };
  window.HTMLElement.prototype.animate = function (frames, options) {
    const animation = { cancelled: false, onfinish: null, oncancel: null, cancel() { this.cancelled = true; this.oncancel?.(); } };
    calls.push({ id: this.dataset.widgetId, frames, options, animation });
    return animation;
  };
  const root = createRoot(document.getElementById("root"));
  const render = async (size, label = "Notes", key = size) => act(async () => root.render(h(Grid, { layoutKey: key, label: "Test widgets" },
    h("article", { key: "a", "data-widget-id": "a", "data-size": size }, label),
    h("article", { key: "b", "data-widget-id": "b" }, "Timer"),
  )));
  const cleanup = async () => {
    await act(async () => root.unmount());
    window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    if (originalAnimate) window.HTMLElement.prototype.animate = originalAnimate;
    else delete window.HTMLElement.prototype.animate;
  };
  return { calls, render, cleanup };
}

test("resizing animates the resized card and displaced neighbors, not initial hydration", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small"); assert.equal(calls.length, 0);
    await render("large"); assert.equal(calls.length, 2);
    assert.equal(calls[0].frames[0].transform, "translate(0px, 0px) scale(0.48, 0.75)");
    assert.equal(calls[1].frames[0].transform, "translate(250px, -250px) scale(1, 1)");
    assert.equal(calls[0].frames[1].transform, "none");
    assert.equal(calls[0].options.duration, 280);
    await render("large", "Edited note"); assert.equal(calls.length, 2);
  } finally { await cleanup(); }
});

test("rapid size changes cancel previous motion and clean up on unmount", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small"); await render("large"); await render("small");
    assert.equal(calls.length, 4);
    assert.ok(calls.slice(0, 2).every(({ animation }) => animation.cancelled));
  } finally { await cleanup(); }
  assert.ok(calls.every(({ animation }) => animation.cancelled));
});

test("system and account reduced-motion preferences disable layout animation", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small");
    systemReduced = true; await render("large"); assert.equal(calls.length, 0);
    systemReduced = false; document.documentElement.dataset.motion = "reduced";
    await render("small"); assert.equal(calls.length, 0);
    document.documentElement.dataset.motion = "full";
    await render("large"); assert.equal(calls.length, 2);
    document.documentElement.dataset.motion = "reduced";
    await render("large", "Updated note");
    assert.ok(calls.every(({ animation }) => animation.cancelled));
  } finally { await cleanup(); }
});

test("layout changes remain usable when the animation API is unavailable", async () => {
  const { calls, render, cleanup } = setup();
  delete window.HTMLElement.prototype.animate;
  try {
    await render("small"); await render("large");
    assert.equal(calls.length, 0);
    assert.equal(document.querySelector('[data-widget-id="a"]').dataset.size, "large");
  } finally { await cleanup(); }
});
