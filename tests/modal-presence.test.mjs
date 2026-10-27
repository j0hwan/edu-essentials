import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<button id="opener">Open</button><div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "Element", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLTextAreaElement", "FileReader"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, useEffect, useState, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ModalPresence } = await import(await clientModule("app/modal-presence.tsx"));
const { default: ClassSetup } = await import(await clientModule("app/class-setup.tsx"));
const { emptyCourse } = await import(await clientModule("lib/academics.ts"));
const host = document.getElementById("root");
let root;
let motion;

function mockAnimations() {
  const originalAnimate = Element.prototype.animate;
  const originalMatchMedia = window.matchMedia;
  const animations = [];
  Element.prototype.animate = function (frames, options) {
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    const animation = {
      target: this, frames, options, finished, cancelled: false,
      finish() { finish(); },
      cancel() { this.cancelled = true; },
    };
    animations.push(animation);
    return animation;
  };
  window.matchMedia = () => ({ matches: false });
  return {
    animations,
    restore() { if (originalAnimate === undefined) delete Element.prototype.animate; else Element.prototype.animate = originalAnimate; window.matchMedia = originalMatchMedia; delete document.documentElement.dataset.motion; },
  };
}

function modal(label = "Class") {
  return h("div", { className: "modal-backdrop" }, h("section", { className: "class-setup", role: "dialog", "aria-modal": "true" }, label));
}
async function render(children, animateExit = true) {
  if (!root) root = createRoot(host);
  await act(async () => root.render(h(ModalPresence, { animateExit }, children)));
}
async function finishAnimations() {
  await act(async () => {
    for (const animation of [...motion.animations]) if (!animation.cancelled) animation.finish();
    await Promise.resolve();
  });
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
}
afterEach(async () => { await unmount(); motion?.restore(); motion = undefined; });
after(() => dom.window.close());

test("retains the modal through exit and runs its child cleanup once after both animations finish", async () => {
  motion = mockAnimations();
  let cleanupCount = 0;
  function TrackedChild() {
    useEffect(() => () => { cleanupCount++; }, []);
    return modal("Tracked class");
  }
  await render(h(TrackedChild));
  await render(null);
  const backdrop = host.querySelector(".modal-backdrop");
  assert.ok(backdrop, "the modal stays mounted while its exit is pending");
  assert.ok(backdrop.hasAttribute("inert"));
  assert.equal(backdrop.getAttribute("aria-hidden"), "true");
  assert.ok(backdrop.hasAttribute("data-modal-exiting"));
  assert.equal(cleanupCount, 0);
  assert.equal(motion.animations.length, 2, "the backdrop and dialog animate together");
  assert.ok(motion.animations.every((animation) => animation.options.duration >= 180 && animation.options.duration <= 240));
  await finishAnimations();
  assert.equal(host.querySelector(".modal-backdrop"), null);
  assert.equal(cleanupCount, 1);
  await finishAnimations();
  assert.equal(cleanupCount, 1, "completion cannot unmount the child twice");
});

test("reopening cancels the old exit and a late completion cannot remove the new modal", async () => {
  motion = mockAnimations();
  await render(modal("Old class"));
  await render(null);
  const oldAnimations = [...motion.animations];
  await render(modal("Reopened class"));
  assert.ok(oldAnimations.every((animation) => animation.cancelled));
  assert.equal(host.querySelector(".class-setup").textContent, "Reopened class");
  assert.equal(host.querySelector("[data-modal-exiting]"), null);
  for (const animation of oldAnimations) animation.finish();
  await act(async () => { await Promise.resolve(); });
  assert.equal(host.querySelector(".class-setup").textContent, "Reopened class");
  assert.equal(host.querySelector(".modal-backdrop").hasAttribute("data-modal-exiting"), false);
});

test("reduced system and app preferences and explicit handoff bypass exit animations", async () => {
  motion = mockAnimations();
  for (const preference of ["system", "app"]) {
    await render(modal(preference));
    if (preference === "system") window.matchMedia = () => ({ matches: true });
    else document.documentElement.dataset.motion = "reduced";
    await render(null);
    assert.equal(host.querySelector(".modal-backdrop"), null, `${preference} reduced motion removes the modal immediately`);
    assert.equal(motion.animations.length, 0);
    window.matchMedia = () => ({ matches: false });
    delete document.documentElement.dataset.motion;
  }
  await render(modal("Chooser"));
  await render(null, false);
  assert.equal(host.querySelector(".modal-backdrop"), null, "handoff removes the chooser without starting a second backdrop exit");
  assert.equal(motion.animations.length, 0);
});

test("missing Web Animations support removes immediately and a stalled animation has a timeout fallback", async () => {
  motion = mockAnimations();
  await render(modal("No API"));
  const animate = Element.prototype.animate;
  delete Element.prototype.animate;
  await render(null);
  assert.equal(host.querySelector(".modal-backdrop"), null);
  Element.prototype.animate = animate;

  await render(modal("Stalled animation"));
  await render(null);
  assert.ok(host.querySelector("[data-modal-exiting]"));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 430)));
  assert.equal(host.querySelector(".modal-backdrop"), null, "the fallback unmounts when WAAPI never settles");
});

test("unmount during exit cancels active animations and child cleanup remains singular", async () => {
  motion = mockAnimations();
  let cleanupCount = 0;
  function TrackedChild() {
    useEffect(() => () => { cleanupCount++; }, []);
    return modal();
  }
  await render(h(TrackedChild));
  await render(null);
  await unmount();
  assert.ok(motion.animations.every((animation) => animation.cancelled));
  assert.equal(cleanupCount, 1);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 430)));
  assert.equal(cleanupCount, 1, "the cleared fallback does not repeat child cleanup");
});

test("actual ClassSetup does not reconfirm repeated Escape while ModalPresence is exiting", async () => {
  motion = mockAnimations();
  const originalConfirm = window.confirm;
  let confirmations = 0;
  let closeCalls = 0;
  window.confirm = () => { confirmations++; return true; };
  function TestPanel() {
    const [open, setOpen] = useState(true);
    return h(ModalPresence, { animateExit: true }, open ? h(ClassSetup, {
      initial: { ...emptyCourse("escape-class"), code: "BIO 101", name: "Biology" }, today: "2026-10-26", canUpload: false,
      onSave: async () => {}, onClose: () => { closeCalls++; setOpen(false); },
    }) : null);
  }
  try {
    await act(async () => { root = createRoot(host); root.render(h(TestPanel)); });
    const name = host.querySelector('.class-setup-info-grid input[type="text"]:nth-of-type(2)')
      ?? [...host.querySelectorAll(".class-setup-info-grid input")].find((input) => input.closest("label")?.textContent.includes("Class name"));
    assert.ok(name, "ClassSetup exposes its class name field");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(name, "Biology II");
      name.dispatchEvent(new window.Event("input", { bubbles: true }));
      name.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const escape = () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await act(async () => escape());
    assert.ok(host.querySelector("[data-modal-exiting]"), "the first Escape starts the retained exit");
    await act(async () => escape());
    assert.equal(confirmations, 1);
    assert.equal(closeCalls, 1);
  } finally { window.confirm = originalConfirm; }
});
