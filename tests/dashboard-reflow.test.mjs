import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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
  const measuredRects = new Map();
  const originalRect = window.Element.prototype.getBoundingClientRect;
  const originalSvgRect = window.SVGElement.prototype.getBoundingClientRect;
  const originalAnimate = window.Element.prototype.animate;
  const originalSvgAnimate = window.SVGElement.prototype.animate;
  const originalComputed = window.getComputedStyle;
  window.Element.prototype.getBoundingClientRect = function () {
    const step = Number(this.closest("[data-step]")?.dataset.step ?? 0);
    const box = this.dataset?.target ?? (this.matches("svg") ? "b" : undefined);
    if (!box) return new window.DOMRect(0, 0, 0, 0);
    const shift = step ? 80 : 0;
    let rect = new window.DOMRect(box === "a" ? shift : 10, 20 + shift, box === "a" && step ? 120 : 100, 50);
    if (options.legendGeometry && this.matches(".dashboard-focus-counts")) {
      rect = new window.DOMRect(step ? 470 : 500, 30, step ? 330 : 300, step ? 15 : 12);
    } else if (options.legendGeometry && this.matches(".dashboard-focus-counts > span")) {
      const index = [...this.parentElement.children].indexOf(this);
      rect = new window.DOMRect((step ? 470 : 500) + index * (step ? 120 : 114), 30, step ? 90 : 72, step ? 15 : 12);
    }
    const history = measuredRects.get(this) ?? [];
    history.push(rect);
    measuredRects.set(this, history);
    return rect;
  };
  window.SVGElement.prototype.getBoundingClientRect = window.Element.prototype.getBoundingClientRect;
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
  const animate = function (frames, timing) {
    const animation = { cancelled: false, cancel() { this.cancelled = true; } };
    calls.push({ element: this, frames, timing, animation });
    return animation;
  };
  if (!options.noAnimate) {
    window.Element.prototype.animate = animate;
    window.SVGElement.prototype.animate = animate;
  }
  const root = createRoot(document.getElementById("root"));
  const render = (reflowKey, step, label = "initial", reducedMotion, restoredCourse = false) => act(async () => {
    const details = options.details ? [
      createElement("div", { className: "dashboard-focus-counts", "data-target": "b", key: "counts" }, ...["overdue", "due today", "done this week"].map((label) => createElement("span", { "data-target": "b", key: label }, label))),
      createElement("button", { className: "dashboard-focus-item", key: "assignment" },
        createElement("span", { className: "status-badge", "data-target": "b" }),
        createElement("svg", { "data-target": "b" }),
      ),
      createElement("div", { className: "dashboard-focus-pagination", key: "pagination" },
        createElement("button", { className: "dashboard-focus-page-button", "data-target": "b" }, "previous"),
        createElement("button", { className: "dashboard-focus-page-button", "data-target": "b" }, "next"),
      ),
    ] : [];
    root.render(createElement(Dashboard, { reflowKey, reducedMotion, restoredCourse }, createElement("section", { "data-step": step },
      createElement("div", { className: "dashboard-study-brief", "data-target": "a" }, label, ...details),
      createElement("div", { className: "dashboard-classes-heading", "data-target": "a" },
        createElement("div", { className: "dashboard-classes-actions", "data-target": "b" },
          createElement("button", { "data-target": "b" }, "Add assignment"),
          createElement("button", { "data-target": "b" }, "Add Class"),
          createElement("button", { className: "view-toggle", "data-target": "b" }, "Cards / List"),
        ),
      ),
      createElement("div", { className: "class-grid" }, createElement("div", { className: "class-card", "data-target": "b" })),
    )));
  });
  const cleanup = async () => {
    await act(async () => root.unmount());
    window.Element.prototype.getBoundingClientRect = originalRect;
    window.SVGElement.prototype.getBoundingClientRect = originalSvgRect;
    window.getComputedStyle = originalComputed;
    if (originalAnimate) window.Element.prototype.animate = originalAnimate;
    else delete window.Element.prototype.animate;
    if (originalSvgAnimate) window.SVGElement.prototype.animate = originalSvgAnimate;
    else delete window.SVGElement.prototype.animate;
    document.documentElement.dataset.motion = "full";
    systemReduced = false;
  };
  return { calls, measuredRects, render, cleanup };
}

function reflowProgress(offset) {
  const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1.06];
  const bezier = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    if (bezier(middle, x1, x2) < offset) low = middle;
    else high = middle;
  }
  return offset === 0 || offset === 1 ? offset : bezier((low + high) / 2, y1, y2);
}

test("sidebar reflow animates the study brief and counter-transforms its fixed priority controls", async () => {
  const { calls, measuredRects, render, cleanup } = setup({ details: true });
  try {
    await render("open", 0);
    await render("closed", 1);
    const brief = document.querySelector(".dashboard-study-brief");
    assert.equal(brief.querySelector(".dashboard-focus-item > svg").getBoundingClientRect().width, 100, "the nested chevron fixture has a measurable rect");
    assert.ok(brief.querySelector(".dashboard-focus-counts > span"));
    assert.ok(brief.querySelector(".status-badge"));
    assert.ok(brief.querySelector(".dashboard-focus-item > svg"));
    assert.ok(calls.some(({ element }) => element === brief), "the brief shell animates with the sidebar");
    const [briefFrom, briefTo] = measuredRects.get(brief);
    for (const anchor of [brief.querySelector(".dashboard-focus-counts"), brief.querySelector(".status-badge"), brief.querySelector(".dashboard-focus-item > svg"), brief.querySelector(".dashboard-focus-pagination > button:last-child")]) {
      const counter = calls.find(({ element }) => element === anchor);
      assert.ok(counter, `fixed nested control ${anchor.className.baseVal || anchor.className} receives counter-animation`);
      assert.ok(counter.frames.length > 2, "counter-animation follows sampled parent easing");
      assert.equal(counter.frames[0].offset, 0);
      assert.equal(counter.frames.at(-1).offset, 1);
      const [initial, final] = measuredRects.get(anchor);
      const scalesWithBrief = anchor.classList.contains("dashboard-focus-counts");
      const [translateX, translateY] = counter.frames.at(-1).translate.split(" ").map(Number.parseFloat);
      const [scaleX, scaleY] = counter.frames.at(-1).scale.split(" ").map(Number.parseFloat);
      assert.ok(Math.abs(translateX - (initial.left - final.left)) < 0.001, `the counter transform restores original screen x (${translateX} vs ${initial.left} - ${final.left}; end scale ${scaleX}; frame ${JSON.stringify(counter.frames.at(-1))})`);
      assert.ok(Math.abs(translateY - (initial.top - final.top)) < 0.001, "the counter transform restores the original screen y position");
      assert.ok(Math.abs(scaleX - (initial.width / final.width)) < 0.001, "the counter transform restores the original screen width");
      assert.ok(Math.abs(scaleY - (initial.height / final.height)) < 0.001, "the counter transform restores the original screen height");
      for (const frame of counter.frames) {
        const progress = reflowProgress(frame.offset);
        const parentScaleX = briefFrom.width / briefTo.width + (1 - briefFrom.width / briefTo.width) * progress;
        const parentScaleY = briefFrom.height / briefTo.height + (1 - briefFrom.height / briefTo.height) * progress;
        const parentDx = (briefFrom.left - briefTo.left) * (1 - progress);
        const parentDy = (briefFrom.top - briefTo.top) * (1 - progress);
        const [frameX, frameY] = frame.translate.split(" ").map(Number.parseFloat);
        const [frameScaleX, frameScaleY] = frame.scale.split(" ").map(Number.parseFloat);
        const screenLeft = briefTo.left + parentDx + (final.left - briefTo.left) * parentScaleX + frameX * parentScaleX;
        const screenTop = briefTo.top + parentDy + (final.top - briefTo.top) * parentScaleY + frameY * parentScaleY;
        const screenWidth = final.width * frameScaleX * parentScaleX;
        const screenHeight = final.height * frameScaleY * parentScaleY;
        assert.ok(Math.abs(screenTop - initial.top) < 0.001, "anchor y remains fixed throughout brief interpolation");
        if (scalesWithBrief) {
          assert.ok(Math.abs(screenLeft + screenWidth - initial.left - initial.width) < 0.001, "legend right edge remains anchored while text scales");
          assert.ok(Math.abs(frameScaleX * parentScaleX - 1) < 0.001, "legend cancels horizontal parent distortion");
          assert.ok(Math.abs(frameScaleY * parentScaleY - 1) < 0.001, "legend cancels vertical parent distortion");
        } else {
          assert.ok(Math.abs(screenLeft - initial.left) < 0.001, "anchor x remains fixed throughout brief interpolation");
          assert.ok(Math.abs(screenWidth - initial.width) < 0.001, "anchor width remains fixed throughout brief interpolation");
          assert.ok(Math.abs(screenHeight - initial.height) < 0.001, "anchor height remains fixed throughout brief interpolation");
        }
      }
    }
    assert.ok(calls.some(({ element }) => element.className === "class-card"));
  } finally { await cleanup(); }
});

test("legend labels interpolate uniform typography and gaps to their natural layout in both directions", async () => {
  const { calls, measuredRects, render, cleanup } = setup({ details: true, legendGeometry: true });
  try {
    await render("open", 0);
    for (const [key, step] of [["closed", 1], ["open", 0]]) {
      calls.length = 0;
      measuredRects.clear();
      await render(key, step);
      const legend = document.querySelector(".dashboard-focus-counts");
      const [legendFrom, legendTo] = measuredRects.get(legend);
      const labels = [...legend.children];
      const animations = labels.map((label) => calls.find(({ element }) => element === label));
      assert.ok(animations.every(Boolean));
      for (const progress of [0, 0.15, 0.5, 0.9, 1, 1.01]) {
        const rects = labels.map((label, index) => {
          const [from, to] = measuredRects.get(label);
          const animation = animations[index];
          assert.equal(animation.timing.easing, calls[0].timing.easing);
          assert.equal(animation.timing.duration, calls[0].timing.duration);
          const [startScaleX, startScaleY] = animation.frames[0].scale.split(" ").map(Number);
          assert.equal(startScaleX, startScaleY, "text scales uniformly rather than squashing glyphs");
          const scale = startScaleX + (1 - startScaleX) * progress;
          const [startX, startY] = animation.frames[0].translate.split(" ").map(Number.parseFloat);
          const left = legendFrom.right - legendTo.width + to.left - legendTo.left + startX * (1 - progress);
          const top = legendFrom.top + to.top - legendTo.top + startY * (1 - progress);
          const width = to.width * scale;
          assert.ok(Math.abs(width - (from.width + (to.width - from.width) * progress)) < 0.001);
          assert.equal(top, from.top);
          if (progress === 0) assert.ok(Math.abs(left - from.left) < 0.001, "starts at current visual position");
          if (progress === 1) {
            assert.equal(left, to.left, "ends at natural position without a finishing snap");
            assert.equal(width, to.width);
          }
          return { left, right: left + width };
        });
        for (let index = 1; index < rects.length; index += 1) {
          const gap = rects[index].left - rects[index - 1].right;
          const startGap = step ? 42 : 30;
          const endGap = step ? 30 : 42;
          assert.ok(Math.abs(gap - (startGap + (endGap - startGap) * progress)) < 0.001, "label gaps follow the same interpolation as font size");
        }
        assert.ok(Math.abs(rects.at(-1).right - legendFrom.right) < 0.001, "visible legend right edge stays anchored");
      }
    }
  } finally { await cleanup(); }
});

test("sidebar reflow leaves class action controls and their heading outside FLIP", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("open", 0);
    await render("closed", 1);
    await render("open", 0);
    const heading = document.querySelector(".dashboard-classes-heading");
    assert.equal(heading.querySelectorAll(".dashboard-classes-actions > button").length, 3);
    assert.ok(calls.length > 0, "course cards still animate");
    assert.ok(calls.every(({ element }) => element !== heading && !heading.contains(element)));
  } finally { await cleanup(); }
});

test("legend reversal captures intermediate label sizes and spacing before cancelling motion", async () => {
  const { calls, measuredRects, render, cleanup } = setup({ details: true, legendGeometry: true });
  try {
    await render("open", 0);
    await render("closed", 1);
    const prior = calls.slice();
    const legend = document.querySelector(".dashboard-focus-counts");
    const legendAnimation = prior.find(({ element }) => element === legend).animation;
    const labels = [...legend.children];
    for (const [index, element] of [legend, ...labels].entries()) {
      const naturalRect = element.getBoundingClientRect.bind(element);
      element.getBoundingClientRect = () => legendAnimation.cancelled ? naturalRect() : new window.DOMRect(
        index === 0 ? 485 : 485 + (index - 1) * 117,
        30,
        index === 0 ? 315 : 81,
        13.5,
      );
    }
    calls.length = 0;
    measuredRects.clear();
    await render("open", 0);
    assert.ok(prior.every(({ animation }) => animation.cancelled));
    const legendFrom = new window.DOMRect(485, 30, 315, 13.5);
    const legendTo = legend.getBoundingClientRect();
    labels.forEach((label, index) => {
      const animation = calls.find(({ element }) => element === label);
      assert.equal(animation.frames[0].scale, "1.125 1.125", "reversal starts from interpolated typography");
      const [translateX] = animation.frames[0].translate.split(" ").map(Number.parseFloat);
      const natural = label.getBoundingClientRect();
      const startLeft = legendFrom.right - legendTo.width + natural.left - legendTo.left + translateX;
      assert.equal(startLeft, 485 + index * 117, "reversal preserves intermediate spacing");
      assert.deepEqual(animation.frames.at(-1), { translate: "0px 0px", scale: "1 1", transformOrigin: "top left" });
    });
    await render("open", 0, "reduced", true);
    assert.ok(calls.every(({ animation }) => animation.cancelled), "reduced motion cancels label and parent compensation together");
  } finally { await cleanup(); }
});

test("dashboard keeps its desktop right gutter independent of sidebar footprint", async () => {
  const css = await readFile(new URL("../app/reference-ui.css", import.meta.url), "utf8");
  assert.match(css, /\.reference-ui \.main-content:has\(\.dashboard-reflow\)\s*\{\s*padding-right:\s*var\(--page-gutter\);\s*\}/);
});

test("restored-course motion opt-in latches on the dashboard until that dashboard unmounts", async () => {
  const first = setup();
  try {
    await first.render("open", 0);
    const page = document.querySelector(".dashboard-page");
    assert.equal(page?.getAttribute("data-restored-course"), null, "ordinary dashboards do not opt into the delayed fade");
    await first.render("open", 0, "restored", undefined, true);
    assert.equal(page?.getAttribute("data-restored-course"), "true", "a restored course enables the dashboard fade");
    await first.render("open", 0, "closed", undefined, false);
    assert.equal(page?.getAttribute("data-restored-course"), "true", "closing the restored course does not replay the default page entrance");
  } finally { await first.cleanup(); }

  const next = setup();
  try {
    await next.render("open", 0);
    assert.equal(document.querySelector(".dashboard-page")?.getAttribute("data-restored-course"), null, "a fresh dashboard mount resets the latch");
  } finally { await next.cleanup(); }
});

test("reflow uses shared timing and captures position and size with individual properties", async () => {
  const { calls, render, cleanup } = setup({ duration: "0.4s", easing: "ease-out" });
  try {
    await render("open", 0);
    assert.equal(calls.length, 0);
    await render("closed", 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].timing.duration, 400);
    assert.equal(calls[0].timing.easing, "ease-out");
    assert.deepEqual(calls.find(({ element }) => element.classList.contains("dashboard-study-brief")).frames[0], { translate: "-80px -80px", scale: "0.8333333333333334 1", transformOrigin: "top left" });
    assert.deepEqual(calls.find(({ element }) => element.classList.contains("dashboard-study-brief")).frames[1], { translate: "0px 0px", scale: "1 1", transformOrigin: "top left" });
    assert.equal(calls.find(({ element }) => element.className === "class-card").frames[0].translate, "0px -80px");
  } finally { await cleanup(); }
});

test("interrupted reflow cancels prior animations and starts from the current visual rect", async () => {
  const { calls, render, cleanup } = setup();
  try {
    await render("a", 0); await render("b", 1);
    const prior = calls.slice();
    const element = document.querySelector(".class-card");
    element.getBoundingClientRect = () => prior[0].animation.cancelled
      ? new window.DOMRect(0, 20, 100, 50)
      : new window.DOMRect(55, 60, 110, 50);
    await render("c", 0);
    assert.ok(prior.every(({ animation }) => animation.cancelled));
    assert.equal(calls.length, 4);
    const cardRestart = calls.filter(({ element }) => element.className === "class-card").at(-1);
    assert.deepEqual(cardRestart.frames[0], { translate: "55px 40px", scale: "1.1 1", transformOrigin: "top left" });
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
  const remaining = calls.slice(1).map(({ animation }) => animation);
  await cleanup();
  assert.ok(remaining.every((animation) => animation.cancelled));
});
