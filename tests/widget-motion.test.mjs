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
  const queuedCancelCallbacks = [];
  let queueCancelCallbacks = false;
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  const originalAnimate = window.HTMLElement.prototype.animate;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const large = document.querySelector('[data-widget-id="a"]')?.dataset.size === "large";
    const a = this.dataset.widgetId === "a";
    const width = Number.parseFloat(this.style.width) || (a && large ? 500 : 240);
    const height = Number.parseFloat(this.style.height) || (a && large ? 240 : 180);
    const translate = this.style.translate.match(/^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?$/);
    const transform = this.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    const translateX = Number.parseFloat(translate?.[1] ?? transform?.[1] ?? "0");
    const translateY = Number.parseFloat(translate?.[2] ?? transform?.[2] ?? "0");
    return new window.DOMRect((a || large ? 0 : 250) + translateX, (!a && large ? 250 : 0) + translateY, width, height);
  };
  window.HTMLElement.prototype.animate = function (frames, options) {
    const animation = {
      cancelled: false,
      onfinish: null,
      oncancel: null,
      cancel() {
        this.cancelled = true;
        const callback = this.oncancel;
        if (queueCancelCallbacks) queuedCancelCallbacks.push(() => callback?.());
        else callback?.();
      },
    };
    calls.push({ element: this, id: this.dataset.widgetId, frames, options, animation });
    return animation;
  };
  const root = createRoot(document.getElementById("root"));
  const render = async (size, label = "Notes", key = size, reflowKey = undefined, resizeMotion = false, resizePreview = undefined) => act(async () => root.render(h(Grid, { layoutKey: key, reflowKey, resizeMotion, resizePreview, label: "Test widgets" },
    h("article", { key: "a", "data-widget-id": "a", "data-size": size }, h("div", { className: "widget-frame" }, label)),
    h("article", { key: "b", "data-widget-id": "b" }, h("div", { className: "widget-frame" }, "Timer")),
  )));
  const cleanup = async () => {
    await act(async () => root.unmount());
    window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    if (originalAnimate) window.HTMLElement.prototype.animate = originalAnimate;
    else delete window.HTMLElement.prototype.animate;
  };
  return {
    calls,
    render,
    cleanup,
    queueCancelCallbacks(value = true) { queueCancelCallbacks = value; },
    flushCancelCallbacks() { queuedCancelCallbacks.splice(0).forEach((callback) => callback()); },
  };
}

function resizePreview(overrides = {}) {
  return { widgetId: "a", size: "small", width: 320, height: 140, blurPx: 4, sourceColumn: 1, sourceRow: 1, unit: 240, gap: 16, ...overrides };
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

test("sidebar reflow cancels widget FLIP without creating new FLIP, then size changes still animate", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small", "Notes", "small:expanded", "expanded");
    assert.equal(calls.length, 0, "initial hydration does not animate");

    await render("large", "Notes", "large:expanded", "expanded");
    assert.equal(calls.length, 2, "a widget resize starts the existing FLIP animations");
    const activeResizeAnimations = calls.map(({ animation }) => animation);
    assert.ok(activeResizeAnimations.every((animation) => !animation.cancelled));

    await render("large", "Notes", "large:collapsed", "collapsed");
    assert.equal(calls.length, 2, "the sidebar reflow itself does not start FLIP animations");
    assert.ok(activeResizeAnimations.every((animation) => animation.cancelled), "sidebar reflow cancels in-flight widget motion");

    await render("small", "Notes", "small:collapsed", "collapsed");
    assert.equal(calls.length, 4, "a later widget resize still starts FLIP animations");
    assert.ok(calls.slice(2).every(({ animation }) => !animation.cancelled));
  } finally { await cleanup(); }
});

test("individual appearance timing disables one card while animating its neighbor", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small");
    document.querySelector('[data-widget-id="a"]').style.setProperty("--wa-transition-ms", "0ms");
    document.querySelector('[data-widget-id="b"]').style.setProperty("--wa-transition-ms", "350ms");
    await render("large");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "b");
    assert.equal(calls[0].options.duration, 350);
  } finally { await cleanup(); }
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

test("corner resizing springs the card and neighbors while honoring reduced and zero motion", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small");
    await render("large", "Notes", "large", undefined, true);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(({ options }) => options.duration === 260 && options.easing === "cubic-bezier(0.22, 1.18, 0.36, 1)"));
    const interrupted = calls.map(({ animation }) => animation);
    await render("small", "Notes", "cancelled", undefined, false);
    assert.ok(interrupted.every((animation) => animation.cancelled));
    assert.equal(calls.at(-1).options.easing, "cubic-bezier(0.22, 1.18, 0.36, 1)", "cancellation settles with the same motion");
    systemReduced = true;
    await render("large", "Notes", "reduced", undefined, true);
    assert.equal(calls.length, 4);
    systemReduced = false;
    for (const card of document.querySelectorAll("[data-widget-id]")) card.style.setProperty("--wa-transition-ms", "0ms");
    await render("small", "Notes", "zero", undefined, true);
    assert.equal(calls.length, 4);
  } finally { await cleanup(); }
});

test("live resize applies continuous geometry, skips source FLIP, and keeps neighbor FLIP", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small");
    await render("large", "Notes", "large", undefined, true, resizePreview({
      size: "large", width: 420, height: 210, blurPx: 3.5, sourceColumn: 2, sourceRow: 3,
    }));
    const source = document.querySelector('[data-widget-id="a"]');
    assert.equal(source.dataset.widgetResizeLive, "true");
    assert.equal(source.style.width, "420px");
    assert.equal(source.style.height, "210px");
    assert.equal(source.style.maxHeight, "none");
    assert.equal(source.style.getPropertyValue("--widget-resize-blur"), "3.5px");
    assert.equal(source.style.getPropertyValue("--widget-resize-filter"), "blur(3.5px) saturate(1.105) brightness(1.04375)");
    assert.equal(source.style.translate, "256px 256px");
    assert.equal(source.getBoundingClientRect().width, 420);
    assert.equal(source.getBoundingClientRect().height, 210);
    assert.deepEqual(calls.map(({ id }) => id), ["b"]);
    assert.equal(calls[0].options.duration, 260);
  } finally { await cleanup(); }
});

test("release springs unchanged-size preview back to exact layout without committing size", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small");
    await render("small", "Notes", "small", undefined, true, resizePreview());
    const source = document.querySelector('[data-widget-id="a"]');
    assert.equal(source.style.width, "320px");
    assert.equal(source.style.height, "140px");
    await render("small", "Notes", "small", undefined, true, null);

    const spring = calls.find(({ id }) => id === "a");
    const unblur = calls.find(({ element }) => element.classList.contains("widget-frame"));
    assert.ok(spring);
    assert.equal(spring.frames.length, 31);
    assert.deepEqual(spring.frames[0], {
      offset: 0, width: "320px", height: "140px", transform: "translate(0px, 0px)", transformOrigin: "top left",
    });
    assert.deepEqual(spring.frames.at(-1), {
      offset: 1, width: "240px", height: "180px", transform: "translate(0px, 0px)", transformOrigin: "top left",
    });
    assert.ok(Number.parseFloat(spring.frames[6].width) < 240, "the damped spring overshoots its exact destination");
    assert.equal(spring.options.duration, 420);
    assert.equal(spring.options.easing, "linear");
    assert.ok(unblur);
    assert.deepEqual(unblur.frames, [{ filter: "blur(4px) saturate(1.12) brightness(1.05)" }, { filter: "blur(0px) saturate(1) brightness(1)" }]);
    assert.equal(unblur.options.duration, 220);
    assert.equal(source.style.width, "");
    assert.equal(source.style.height, "");
    assert.equal(source.style.maxHeight, "");
    assert.equal(source.style.translate, "");
    assert.equal(source.style.getPropertyValue("--widget-resize-blur"), "");
    assert.equal(source.style.getPropertyValue("--widget-resize-filter"), "");
    assert.equal(source.dataset.widgetResizeLive, undefined);
    assert.equal(source.dataset.widgetResizeSettling, "true");
    assert.equal(source.dataset.size, "small");
    spring.animation.onfinish();
    assert.equal(source.dataset.widgetResizeSettling, undefined);
  } finally { await cleanup(); }
});

test("release spring targets changed layout exactly and regrab cancels settling", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("small");
    await render("large", "Notes", "large", undefined, true, resizePreview({ size: "large", width: 420, height: 210 }));
    assert.deepEqual(calls.map(({ id }) => id), ["b"], "the held source has no FLIP while its neighbor still animates");
    await render("large", "Notes", "large", undefined, true, null);

    const source = document.querySelector('[data-widget-id="a"]');
    const spring = calls.find(({ id }) => id === "a");
    const unblur = calls.find(({ element }) => element.classList.contains("widget-frame"));
    assert.equal(source.dataset.size, "large");
    assert.equal(source.dataset.widgetResizeSettling, "true");
    assert.equal(spring.frames.length, 31);
    assert.deepEqual(spring.frames.at(-1), {
      offset: 1, width: "500px", height: "240px", transform: "translate(0px, 0px)", transformOrigin: "top left",
    });
    assert.ok(Number.parseFloat(spring.frames[6].width) > 500, "the spring oscillates before landing on its exact destination");
    assert.equal(spring.options.duration, 420);
    assert.ok(unblur);

    await render("large", "Notes", "large", undefined, true, resizePreview({ size: "large", width: 430, height: 205, blurPx: 2 }));
    assert.equal(spring.animation.cancelled, true);
    assert.equal(unblur.animation.cancelled, true);
    assert.equal(source.dataset.widgetResizeSettling, undefined);
    assert.equal(source.dataset.widgetResizeLive, "true");
    assert.equal(source.style.width, "430px");
  } finally { await cleanup(); }
});

test("resize settling cleans up without animation for reduced, zero, or unavailable motion", async () => {
  for (const mode of ["reduced", "zero", "unavailable"]) {
    const { calls, render, cleanup } = setup();
    try {
      await render("small");
      const source = document.querySelector('[data-widget-id="a"]');
      if (mode === "reduced") systemReduced = true;
      if (mode === "zero") source.style.setProperty("--wa-transition-ms", "0ms");
      if (mode === "unavailable") delete window.HTMLElement.prototype.animate;
      await render("small", "Notes", "small", undefined, true, resizePreview());
      if (mode === "reduced") assert.equal(source.style.getPropertyValue("--widget-resize-filter"), "blur(0px) saturate(1) brightness(1)");
      await render("small", "Notes", "small", undefined, true, null);
      assert.equal(calls.length, 0, `${mode} motion creates no animations`);
      assert.equal(source.dataset.widgetResizeLive, undefined);
      assert.equal(source.dataset.widgetResizeSettling, undefined);
      assert.equal(source.style.width, "");
      assert.equal(source.style.height, "");
      assert.equal(source.style.getPropertyValue("--widget-resize-blur"), "");
      assert.equal(source.style.getPropertyValue("--widget-resize-filter"), "");
    } finally { await cleanup(); }
  }
});

test("a queued cancel from an older resize spring cannot clear a newer settling marker", async () => {
  const { calls, render, cleanup, queueCancelCallbacks, flushCancelCallbacks } = setup();
  try {
    await render("small");
    await render("large", "Notes", "large", undefined, true, resizePreview({ size: "large", width: 420, height: 210 }));
    await render("large", "Notes", "large", undefined, true, null);
    const oldSpring = calls.find(({ id }) => id === "a");
    assert.equal(document.querySelector('[data-widget-id="a"]').dataset.widgetResizeSettling, "true");

    queueCancelCallbacks();
    await render("large", "Notes", "large", undefined, true, resizePreview({ size: "large", width: 430, height: 205 }));
    assert.equal(oldSpring.animation.cancelled, true);
    await render("large", "Notes", "large", undefined, true, null);
    const newSpring = calls.filter(({ id }) => id === "a").at(-1);
    assert.notEqual(newSpring, oldSpring);
    assert.equal(document.querySelector('[data-widget-id="a"]').dataset.widgetResizeSettling, "true");

    flushCancelCallbacks();
    assert.equal(document.querySelector('[data-widget-id="a"]').dataset.widgetResizeSettling, "true");
    queueCancelCallbacks(false);
    newSpring.animation.cancel();
    assert.equal(document.querySelector('[data-widget-id="a"]').dataset.widgetResizeSettling, undefined);
  } finally { await cleanup(); }
});
