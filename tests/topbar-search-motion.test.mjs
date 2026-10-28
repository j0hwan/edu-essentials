import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: TopbarSearch } = await import(await clientModule("app/topbar-search.tsx"));

async function fixture(run) {
  const host = document.getElementById("root");
  const root = createRoot(host);
  const formRef = { current: null };
  const calls = [];
  const observers = [];
  let resultsHeight = 200;
  let visibleHeight = null;
  let systemReduced = false;
  window.matchMedia = () => ({ matches: systemReduced });
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  const originalAnimate = window.HTMLElement.prototype.animate;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    let height = 0;
    if (this.classList.contains("topbar-search-row")) height = 38;
    if (this.classList.contains("topbar-search-expansion")) height = this.childElementCount ? resultsHeight : 0;
    if (this.classList.contains("topbar-search")) height = visibleHeight ?? (Number.parseFloat(this.style.height) || 40);
    return { height };
  };
  window.HTMLElement.prototype.animate = function (frames, options) {
    const animation = { cancelled: false, cancel() { this.cancelled = true; }, onfinish: null };
    calls.push({ frames, options, animation });
    return animation;
  };
  const render = async (open, reducedMotion = false) => act(async () => {
    root.render(createElement(TopbarSearch, {
      formRef, open, reducedMotion, onSubmit() {}, onBlur() {},
      children: createElement("input"), results: open ? createElement("div", null, "Results") : null,
    }));
  });
  try {
    await render(false);
    formRef.current.style.border = "1px solid";
    await run({
      calls, formRef, render, observers,
      setResultsHeight(height) { resultsHeight = height; },
      setVisibleHeight(height) { visibleHeight = height; },
      setSystemReduced(value) { systemReduced = value; },
      resize() { observers.at(-1).callback(); },
    });
  } finally {
    await act(async () => root.unmount());
    window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    if (originalAnimate) window.HTMLElement.prototype.animate = originalAnimate;
    else delete window.HTMLElement.prototype.animate;
    delete globalThis.ResizeObserver;
  }
}

test("search animates opening, later result changes, and empty-result collapse", async () => {
  await fixture(async ({ calls, formRef, render, setResultsHeight, resize }) => {
    await render(true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].frames.at(-1).height, "240px");
    calls[0].animation.onfinish();
    setResultsHeight(80);
    resize();
    assert.equal(calls.length, 2, "resizing still animates after opening finishes");
    assert.equal(calls[1].frames[0].height, "240px");
    assert.equal(calls[1].frames.at(-1).height, "120px");
    calls[1].animation.onfinish();
    setResultsHeight(160);
    await render(true);
    assert.equal(calls[2].frames[0].height, "120px");
    assert.equal(calls[2].frames.at(-1).height, "200px");
    calls[2].animation.onfinish();
    await render(false);
    assert.equal(calls[3].frames[0].height, "200px");
    assert.equal(calls[3].frames.at(-1).height, "40px");
    assert.equal(formRef.current.style.height, "40px");
  });
});

test("search retargets from its displayed height during rapid changes", async () => {
  await fixture(async ({ calls, render, setResultsHeight, setVisibleHeight, resize }) => {
    await render(true);
    setVisibleHeight(100);
    setResultsHeight(300);
    resize();
    assert.equal(calls[0].animation.cancelled, true);
    assert.equal(calls[1].frames[0].height, "100px");
    assert.equal(calls[1].frames.at(-1).height, "340px");
    setVisibleHeight(180);
    await render(false);
    assert.equal(calls[1].animation.cancelled, true);
    assert.equal(calls[2].frames[0].height, "180px");
    assert.equal(calls[2].frames.at(-1).height, "40px");
    setVisibleHeight(120);
    await render(true);
    assert.equal(calls[2].animation.cancelled, true);
    assert.equal(calls[3].frames[0].height, "120px");
    assert.equal(calls[3].frames.at(-1).height, "340px");
  });
});

test("search avoids redundant animations and cleans up on unmount", async () => {
  let lastAnimation;
  let lastObserver;
  await fixture(async ({ calls, render, observers, resize }) => {
    await render(true);
    resize();
    await render(true);
    assert.equal(calls.length, 1);
    lastAnimation = calls[0].animation;
    lastObserver = observers.at(-1);
  });
  assert.equal(lastAnimation.cancelled, true);
  assert.equal(lastObserver.disconnected, true);
});

test("search respects both reduced-motion settings and missing animation support", async () => {
  for (const mode of ["profile", "system", "unsupported"]) {
    await fixture(async ({ calls, formRef, render, setSystemReduced, setResultsHeight, resize }) => {
      if (mode === "system") setSystemReduced(true);
      if (mode === "unsupported") formRef.current.animate = undefined;
      await render(true, mode === "profile");
      assert.equal(formRef.current.style.height, "240px");
      setResultsHeight(80);
      resize();
      assert.equal(formRef.current.style.height, "120px");
      await render(false, mode === "profile");
      assert.equal(formRef.current.style.height, "40px");
      assert.equal(calls.length, 0);
    });
  }
});
