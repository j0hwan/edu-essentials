import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Dashboard } = await import(await clientModule("app/animated-dashboard.tsx"));
let systemReduced = false;
window.matchMedia = () => ({ matches: systemReduced });

function setup(options = {}) {
  const calls = [];
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  const originalAnimate = window.HTMLElement.prototype.animate;
  const originalComputed = window.getComputedStyle;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const step = Number(this.closest("[data-step]")?.dataset.step ?? 0);
    const box = this.dataset.target;
    if (!box) return new window.DOMRect(0, 0, 0, 0);
    const shift = step ? 80 : 0;
    return new window.DOMRect(box === "a" ? shift : 10, 20 + shift, box === "a" && step ? 120 : 100, 50);
  };
  window.getComputedStyle = (element) => {
    const computed = originalComputed(element);
    if (element.classList?.contains("dashboard-reflow")) {
      return { ...computed, getPropertyValue(name) {
        if (name === "--shell-reflow-duration") return options.duration ?? "320ms";
        if (name === "--shell-reflow-easing") return options.easing ?? "cubic-bezier(.22,1,.36,1.06)";
        return computed.getPropertyValue(name);
      } };
    }
    return computed;
  };
  if (!options.noAnimate) window.HTMLElement.prototype.animate = function (frames, timing) {
    const animation = { cancelled: false, cancel() { this.cancelled = true; } };
    calls.push({ element: this, frames, timing, animation });
    return animation;
  };
  const root = createRoot(document.getElementById("root"));
  const render = (reflowKey, step, label = "initial", reducedMotion) => act(async () => {
    root.render(createElement(Dashboard, { reflowKey, reducedMotion }, createElement("section", { "data-step": step },
      createElement("div", { className: "dashboard-study-brief", "data-target": "a", style: { transform: "rotate(2deg)" } }, label),
      createElement("div", { className: "dashboard-classes-heading", "data-target": "b" }),
    )));
  });
  const cleanup = async () => {
    await act(async () => root.unmount());
    window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    window.getComputedStyle = originalComputed;
    if (originalAnimate) window.HTMLElement.prototype.animate = originalAnimate;
    else delete window.HTMLElement.prototype.animate;
    document.documentElement.dataset.motion = "full";
    systemReduced = false;
  };
  return { calls, render, cleanup };
}

test("reflow uses shared timing and captures position and size with individual properties", async () => {
  const { calls, render, cleanup } = setup({ duration: "0.4s", easing: "ease-out" });
  try {
    await render("open", 0);
    assert.equal(calls.length, 0);
    await render("closed", 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].timing.duration, 400);
    assert.equal(calls[0].timing.easing, "ease-out");
    assert.deepEqual(calls[0].frames[0], { translate: "-80px -80px", scale: "0.8333333333333334 1", transformOrigin: "top left" });
    assert.deepEqual(calls[0].frames[1], { translate: "0px 0px", scale: "1 1", transformOrigin: "top left" });
    assert.equal(calls[0].element.style.transform, "rotate(2deg)");
  } finally { await cleanup(); }
});

test("interrupted reflow cancels prior animations and starts from the current visual rect", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("a", 0); await render("b", 1);
    const prior = calls.slice();
    const element = document.querySelector(".dashboard-study-brief");
    element.getBoundingClientRect = () => prior[0].animation.cancelled
      ? new window.DOMRect(0, 20, 100, 50)
      : new window.DOMRect(55, 60, 110, 50);
    await render("c", 0);
    assert.ok(prior.every(({ animation }) => animation.cancelled));
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[2].frames[0], { translate: "55px 40px", scale: "1.1 1", transformOrigin: "top left" });
    assert.deepEqual(calls[3].frames[0], { translate: "0px 80px", scale: "1 1", transformOrigin: "top left" });
  } finally { await cleanup(); }
});

test("enabling reduced motion without another reflow cancels running animations", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("a", 0);
    await render("b", 1);
    assert.equal(calls.length, 2);
    await render("b", 1, "reduced", true);
    assert.ok(calls.every(({ animation }) => animation.cancelled));
  } finally { await cleanup(); }
});

test("ordinary rerenders and each reduced-motion or unavailable-motion condition skip animation", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("a", 0); await render("a", 1, "updated"); assert.equal(calls.length, 0);
    await render("b", 0, "reduced", true); assert.equal(calls.length, 0);
    await render("c", 1); assert.equal(calls.length, 2);
    document.documentElement.dataset.motion = "reduced";
    await render("d", 0); assert.equal(calls.length, 2);
    document.documentElement.dataset.motion = "full";
    systemReduced = true; await render("e", 1); assert.equal(calls.length, 2);
  } finally { await cleanup(); }
});

test("zero duration, missing WAAPI, resize, and unmount cancel or skip motion", async () => {
  const zero = setup({ duration: "0ms" });
  try { await zero.render("a", 0); await zero.render("b", 1); assert.equal(zero.calls.length, 0); } finally { await zero.cleanup(); }
  const missing = setup({ noAnimate: true });
  try { await missing.render("a", 0); await missing.render("b", 1); assert.equal(missing.calls.length, 0); } finally { await missing.cleanup(); }
  const { calls, render, cleanup } = setup();
  await render("a", 0); await render("b", 1);
  const running = calls.map(({ animation }) => animation);
  window.dispatchEvent(new window.Event("resize"));
  assert.ok(running.every((animation) => animation.cancelled));
  await render("c", 0);
  const remaining = calls.slice(2).map(({ animation }) => animation);
  await cleanup();
  assert.ok(remaining.every((animation) => animation.cancelled));
});
