import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<button id="opener">Add class</button><div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLTextAreaElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ClassSetup } = await import(await clientModule("app/class-setup.tsx"));
const { default: AcademicEditor } = await import(await clientModule("app/academic-editor.tsx"));
const { emptyCourse } = await import(await clientModule("lib/academics.ts"));
const host = document.getElementById("root");
let root;
let saved;
let calls;
let closed;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => "blob:class-cover";
URL.revokeObjectURL = () => {};

async function mount(overrides = {}) {
  saved = undefined; calls = 0; closed = 0;
  document.getElementById("opener").focus();
  root = createRoot(host);
  await act(async () => root.render(createElement(ClassSetup, {
    initial: { ...emptyCourse("new-course"), code: "BIO 101", name: "Biology" }, today: "2026-10-26", canUpload: true,
    onSave: async (...args) => { calls++; saved = args; }, onClose: () => { closed++; }, ...overrides,
  })));
}
const button = (text) => [...host.querySelectorAll("button")].find((node) => node.textContent === text || node.getAttribute("aria-label") === text);
async function click(text) { assert.ok(button(text), `Missing button ${text}`); await act(async () => button(text).click()); }
async function submit() { await act(async () => host.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); }
async function change(label, value) {
  const node = [...host.querySelectorAll("label")].find((item) => item.textContent.replace(/\s*\*$/, "").trim() === label)?.querySelector("input,textarea") ?? [...host.querySelectorAll("[aria-label]")].find((input) => input.getAttribute("aria-label") === label);
  assert.ok(node, `Missing field ${label}`);
  if (node.hasAttribute("contenteditable")) {
    await act(async () => {
      node.textContent = value;
      const range = document.createRange();
      range.selectNodeContents(node); range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      node.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText" }));
    });
    return;
  }
  const prototype = node.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
    node.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
async function appearance() { await submit(); await click("Monday"); await submit(); }
async function file(kind, value) {
  const input = host.querySelectorAll('input[type="file"]')[kind === "image" ? 0 : 1];
  Object.defineProperty(input, "files", { configurable: true, value: [value] });
  await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; });
after(() => { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; dom.window.close(); });

function mockSetupMotion() {
  const originalAnimate = HTMLElement.prototype.animate;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalMatchMedia = window.matchMedia;
  const animations = [];
  window.matchMedia = () => ({ matches: false });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const schedule = this.classList.contains("class-setup-schedule-step");
    return { width: schedule ? 1080 : 760, height: schedule ? 720 : 540 };
  };
  HTMLElement.prototype.animate = function (frames, options) {
    let finish;
    let reject;
    const finished = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const animation = { target: this, frames, options, finished, finish, cancelled: false, cancel() { this.cancelled = true; reject(new Error("cancelled")); } };
    animations.push(animation);
    return animation;
  };
  return {
    animations,
    async finish() { await act(async () => { for (const animation of [...animations]) if (!animation.cancelled) animation.finish(); }); },
    restore() {
      HTMLElement.prototype.animate = originalAnimate;
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      window.matchMedia = originalMatchMedia;
      delete document.documentElement.dataset.motion;
    },
  };
}

function mockSetupFrames() {
  const originalRequest = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = (frame) => { frames.delete(frame); };
  return {
    frames,
    async flush() {
      const pending = [...frames.values()];
      frames.clear();
      await act(async () => { for (const callback of pending) callback(0); });
    },
    restore() {
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    },
  };
}

test("step changes fade old content before resizing and revealing, in both directions", async () => {
  const motion = mockSetupMotion();
  try {
    await mount();
    await submit();
    assert.equal(host.querySelector("h2").textContent, "Course information");
    assert.ok(host.querySelector("form").hasAttribute("inert"));
    assert.ok(motion.animations.some((animation) => animation.options.duration === 110 && animation.frames.at(-1).opacity === 0));
    await submit();
    await motion.finish();
    assert.equal(host.querySelector("h2").textContent, "Class schedule");
    assert.equal(host.querySelector("form").hasAttribute("inert"), false);
    const expansion = motion.animations.find((animation) => animation.target.tagName === "FORM");
    assert.equal(expansion.options.duration, 460);
    assert.equal(expansion.frames[0].width, "760px");
    assert.equal(expansion.frames.at(-1).width, "1080px");
    assert.equal(expansion.frames.at(-1).height, "720px");
    assert.ok(motion.animations.some((animation) => animation.options.delay === 75 && animation.options.duration === 220));
    await motion.finish();
    await click("Back");
    await motion.finish();
    const shrink = motion.animations.filter((animation) => animation.target.tagName === "FORM").at(-1);
    assert.equal(shrink.frames[0].width, "1080px");
    assert.equal(shrink.frames.at(-1).width, "760px");
    assert.equal(host.querySelector('input').value, "BIO 101");
    await motion.finish();
  } finally {
    if (root) await act(async () => root.unmount());
    root = undefined;
    motion.restore();
  }
});

test("manual-entry handoff resizes from the choice dialog and cancels safely on unmount", async () => {
  const motion = mockSetupMotion();
  try {
    await mount({ initialBounds: { width: 620, height: 350 } });
    const expansion = motion.animations.find((animation) => animation.target.tagName === "FORM");
    assert.equal(expansion.frames[0].width, "620px");
    assert.equal(expansion.frames[0].height, "350px");
    await submit();
    await act(async () => root.unmount());
    root = undefined;
    assert.ok(motion.animations.every((animation) => animation.cancelled));
    assert.equal(document.activeElement.id, "opener");
  } finally { motion.restore(); }
});

test("system and app reduced-motion preferences skip fades and resizing", async () => {
  const motion = mockSetupMotion();
  try {
    for (const preference of ["system", "app"]) {
      window.matchMedia = () => ({ matches: preference === "system" });
      document.documentElement.dataset.motion = preference === "app" ? "reduced" : "full";
      await mount();
      await submit();
      assert.equal(host.querySelector("h2").textContent, "Class schedule");
      assert.equal(motion.animations.length, 0);
      await act(async () => root.unmount());
      root = undefined;
    }
  } finally { motion.restore(); }
});

test("content size changes animate the form height without replaying content fades", async () => {
  const motion = mockSetupMotion();
  const scheduled = mockSetupFrames();
  const originalObserver = globalThis.ResizeObserver;
  let resized;
  let disconnected = false;
  globalThis.ResizeObserver = class {
    constructor(callback) { resized = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  try {
    await mount();
    const panel = host.querySelector("form");
    panel.getBoundingClientRect = () => ({ width: 760, height: 650 });
    await act(async () => resized());
    assert.equal(motion.animations.length, 0);
    await act(async () => { resized(); resized(); });
    assert.equal(scheduled.frames.size, 1);
    await scheduled.flush();
    const resize = motion.animations.find((animation) => animation.target === panel);
    assert.equal(resize.frames[0].height, "540px");
    assert.equal(resize.frames.at(-1).height, "650px");
    assert.equal(motion.animations.length, 1);
    assert.ok(panel.hasAttribute("data-resizing"));
    await act(async () => resized());
    assert.equal(scheduled.frames.size, 0);
    await motion.finish();
    assert.equal(panel.hasAttribute("data-resizing"), false);
    panel.getBoundingClientRect = () => ({ width: 760, height: 500 });
    await act(async () => resized());
    await scheduled.flush();
    assert.equal(motion.animations.at(-1).frames.at(-1).height, "500px");
    await motion.finish();
    await act(async () => resized());
    assert.equal(scheduled.frames.size, 1);
    await act(async () => root.unmount());
    root = undefined;
    assert.equal(disconnected, true);
    assert.equal(scheduled.frames.size, 0);
  } finally {
    globalThis.ResizeObserver = originalObserver;
    scheduled.restore();
    motion.restore();
  }
});

test("missing required fields keep the current step and defer validation resizing outside observer delivery", async () => {
  const motion = mockSetupMotion();
  const scheduled = mockSetupFrames();
  const originalObserver = globalThis.ResizeObserver;
  let resized;
  globalThis.ResizeObserver = class {
    constructor(callback) { resized = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    await mount({ initial: { ...emptyCourse("incomplete-course"), code: "", name: "" } });
    await submit();
    assert.equal(host.querySelector("h2").textContent, "Course information");
    assert.equal(host.querySelectorAll('input[aria-invalid="true"]').length, 2);
    const panel = host.querySelector("form");
    panel.getBoundingClientRect = () => ({ width: 760, height: 580 });
    await act(async () => resized());
    assert.equal(motion.animations.length, 0);
    assert.equal(panel.hasAttribute("data-resizing"), false);
    await scheduled.flush();
    assert.equal(motion.animations.length, 1);
    assert.equal(motion.animations[0].frames.at(-1).height, "580px");
    await motion.finish();
    assert.equal(host.querySelector("h2").textContent, "Course information");
    assert.equal(calls, 0);
  } finally {
    if (root) await act(async () => root.unmount());
    root = undefined;
    globalThis.ResizeObserver = originalObserver;
    scheduled.restore();
    motion.restore();
  }
});

test("required fields have visible asterisks and setup omits the removed introductory copy", async () => {
  await mount();
  const removedCopy = /NEW CLASS|Start with the essentials|Meeting times use your saved time zone|Add holidays, breaks|Give your class a look of its own/;
  const verifyLabels = () => {
    assert.doesNotMatch(host.textContent, removedCopy);
    for (const input of host.querySelectorAll("input")) {
      const marker = input.closest("label")?.querySelector('[aria-hidden="true"]');
      assert.equal(Boolean(marker), input.required, `${input.closest("label")?.textContent} marks only required inputs`);
      if (marker) assert.equal(marker.textContent.trim(), "*");
    }
  };
  verifyLabels();
  assert.deepEqual([...host.querySelectorAll("input:required")].map((input) => input.closest("label").textContent.trim()), ["Course code *", "Class name *"]);
  await submit(); verifyLabels();
  assert.match(host.querySelector(".class-setup-week-label").textContent, /Meeting days \*/);
  await click("Monday"); await click("Skip dates (0)"); await click("Add exception"); verifyLabels();
  await change("Exception date 1", "2026-11-02");
  await submit(); verifyLabels();
  assert.match(host.textContent, /Storage only/);
});

test("larger progress replaces the visible title and preserves accessible step names and completed states", async () => {
  await mount();
  const header = host.querySelector(".class-setup-header");
  const progress = header.querySelector(".class-setup-progress");
  const verifyIndicators = (completed) => {
    const indicators = [...progress.querySelectorAll(".class-setup-step-indicator")];
    assert.equal(indicators.length, 3);
    indicators.forEach((indicator, index) => {
      assert.equal(indicator.getAttribute("width"), "18");
      assert.equal(indicator.getAttribute("height"), "18");
      assert.equal(indicator.getAttribute("aria-hidden"), "true");
      assert.equal(indicator.querySelectorAll("circle").length, 1);
      assert.equal(Boolean(indicator.querySelector("path")), index < completed);
    });
  };
  verifyIndicators(0);
  assert.equal(header.children.length, 2);
  assert.equal(header.children[0], progress);
  assert.equal(header.children[1], button("Close class setup"));
  assert.equal(header.querySelector("h2"), null);
  const accessibleTitle = host.querySelector(".class-setup-accessible-title");
  assert.equal(host.querySelector('[role="dialog"]').getAttribute("aria-labelledby"), accessibleTitle.id);
  assert.equal(accessibleTitle.textContent, "Course information");
  assert.equal(host.querySelectorAll(".class-setup-progress").length, 1);
  assert.deepEqual([...progress.querySelectorAll("li > span")].map((node) => node.textContent), ["Info", "Schedule", "Customize"]);
  assert.equal(progress.querySelectorAll(".class-setup-step-separator").length, 2);
  assert.equal(progress.querySelector(".class-setup-step-separator").getAttribute("width"), "18");
  assert.equal(progress.querySelector('[aria-current="step"]').getAttribute("aria-label"), "Course information");
  assert.equal(progress.querySelectorAll(".is-complete").length, 0);
  await submit();
  assert.equal(progress.querySelector('[aria-current="step"]').getAttribute("aria-label"), "Class schedule");
  assert.equal(progress.querySelectorAll(".is-complete").length, 1);
  verifyIndicators(1);
  assert.ok(progress.querySelector(".is-complete svg"));
  await click("Monday"); await submit();
  assert.equal(progress.querySelector('[aria-current="step"]').getAttribute("aria-label"), "Make it yours");
  assert.equal(progress.querySelectorAll(".is-complete").length, 2);
  verifyIndicators(2);
  await click("Back");
  assert.equal(progress.querySelectorAll(".is-complete").length, 1);
  verifyIndicators(1);
});

test("manual setup separates information, seven-day schedule, and appearance; Back preserves fields", async () => {
  await mount();
  assert.equal(host.querySelector("h2").textContent, "Course information");
  assert.ok(host.textContent.includes("Office hours (Zoom link, location, etc.)"));
  assert.equal(host.querySelector('input[type="color"]'), null);
  await change("Instructor", "Dr. Moss");
  await change("Office hours (Zoom link, location, etc.)", "Tuesday · Zoom");
  await submit();
  assert.equal(calls, 0);
  assert.equal(host.querySelectorAll(".class-setup-week button").length, 7);
  await click("Monday"); await click("Wednesday");
  await click("Skip dates (0)"); await click("Add exception"); await change("Exception date 1", "2026-11-02");
  await submit();
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
  assert.equal(calls, 0);
  await click("Biology"); await change("Class color", "#b23b53");
  await click("Back");
  assert.equal(button("Wednesday").getAttribute("aria-pressed"), "true");
  await click("Back");
  assert.equal(host.querySelectorAll("input")[3].value, "Dr. Moss");
  await submit(); await submit(); await submit();
  assert.equal(calls, 1);
  assert.equal(saved[0].color, "#b23b53");
  assert.equal(saved[0].soft, "#b23b5318");
  assert.equal(saved[1].officeHours, "Tuesday · Zoom");
  assert.deepEqual(saved[1].meetings[0].days, [1, 3]);
  assert.deepEqual(saved[1].meetings[0].excludedDates, ["2026-11-02"]);
});

test("schedule omits marked copy and keeps meeting selection and trash deletion", async () => {
  await mount(); await submit(); await click("Monday"); await click("Wednesday");
  assert.equal(host.querySelector(".class-setup-meetings > h3"), null);
  assert.doesNotMatch(host.textContent, /Meetings \(\d+\)|Add the times this class meets\.|Remove meeting/);
  assert.match(button("Select meeting 1").textContent, /Mon, Wed/);
  assert.match(button("Select meeting 1").textContent, /9:00 AM – 10:00 AM/);
  assert.ok(button("Select meeting 1").querySelector('[aria-label="Complete"]'));
  const descriptions = button("Select meeting 1").getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id).textContent).join(" ");
  assert.match(descriptions, /Mon, Wed 9:00 AM – 10:00 AM Complete/);
  assert.equal(button("Skip dates (0)").getAttribute("aria-expanded"), "false");
  assert.equal(host.querySelector(".class-setup-skip-content"), null);
  await click("Add meeting");
  assert.equal(host.querySelectorAll(".class-setup-meeting").length, 1);
  assert.equal(button("Select meeting 2").getAttribute("aria-pressed"), "true");
  await click("Tuesday"); await change("Start time", "14:00"); await change("End time", "15:30");
  assert.match(button("Select meeting 2").textContent, /2:00 PM – 3:30 PM/);
  await click("Select meeting 1");
  assert.equal(button("Monday").getAttribute("aria-pressed"), "true");
  button("Delete meeting 2").focus();
  await click("Delete meeting 2");
  assert.equal(button("Select meeting 1").getAttribute("aria-pressed"), "true");
  assert.equal(document.activeElement, button("Select meeting 1"));
  await click("Add meeting"); await click("Thursday");
  await click("Delete meeting 2");
  assert.equal(button("Monday").getAttribute("aria-pressed"), "true");
  button("Delete meeting 1").focus();
  await click("Delete meeting 1");
  assert.match(host.textContent, /No scheduled meetings/);
  assert.equal(document.activeElement, button("Add meeting"));
  await click("Add meeting");
  assert.equal(button("Select meeting 1").getAttribute("aria-pressed"), "true");
});

test("meeting titles rename with the pencil or double click, preserve names and cancel with Escape", async () => {
  await mount(); await submit(); await click("Monday");
  const originalHeading = host.querySelector(".class-setup-meeting-title");
  await click("Rename Meeting 1");
  let input = host.querySelector('[aria-label="Meeting name"]');
  assert.equal(input, originalHeading, "editing uses the same heading instead of a differently aligned input");
  assert.equal(document.activeElement, input);
  assert.equal(window.getSelection().isCollapsed, true);
  const caretWrapper = input;
  assert.equal(caretWrapper.dataset.caretAtEnd, "true");
  await act(async () => {
    const range = document.createRange();
    range.selectNodeContents(input); range.collapse(true);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event("selectionchange"));
  });
  assert.equal(caretWrapper.dataset.caretAtEnd, "false");
  await act(async () => {
    const range = document.createRange();
    range.selectNodeContents(input); range.collapse(false);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event("selectionchange"));
  });
  assert.equal(caretWrapper.dataset.caretAtEnd, "true");
  await change("Meeting name", "  Lecture  ");
  await act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  assert.equal(host.querySelector("h2").textContent, "Class schedule");
  assert.equal(host.querySelector(".class-setup-section-heading h3").textContent, "Lecture");
  assert.equal(host.querySelector(".class-setup-meeting-title"), originalHeading);
  assert.equal(button("Select meeting 1").querySelector("strong").textContent, "Lecture");
  assert.equal(document.activeElement, button("Rename Lecture"));
  await act(async () => originalHeading.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true })));
  input = host.querySelector('[aria-label="Meeting name"]');
  assert.equal(input, originalHeading);
  assert.equal(window.getSelection().toString(), "Lecture");
  assert.equal(input.dataset.caretAtEnd, "false");
  await change("Meeting name", "Cancelled name");
  await act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(closed, 0);
  assert.equal(host.querySelector(".class-setup-section-heading h3").textContent, "Lecture");
  await click("Add meeting"); await click("Tuesday"); await click("Rename Meeting 2");
  await change("Meeting name", "Lab");
  await act(async () => host.querySelector('[aria-label="Meeting name"]').blur());
  assert.equal(host.querySelector(".class-setup-section-heading h3").textContent, "Lab");
  await click("Select meeting 1");
  assert.equal(host.querySelector(".class-setup-section-heading h3").textContent, "Lecture");
  await submit(); await click("Back");
  assert.equal(host.querySelector(".class-setup-section-heading h3").textContent, "Lecture");
  await submit(); await submit();
  assert.deepEqual(saved[1].meetings.map((meeting) => meeting.name), ["Lecture", "Lab"]);
});

test("meeting-name presets appear only during editing and apply all four names without advancing", async () => {
  await mount(); await submit(); await click("Monday");
  assert.equal(host.querySelector('[aria-label="Meeting name presets"]'), null);
  for (const [index, name] of ["Lecture", "Lab", "Discussion", "Office Hours"].entries()) {
    await click(`Rename ${index === 0 ? "Meeting 1" : ["Lecture", "Lab", "Discussion"][index - 1]}`);
    const presets = host.querySelector('[aria-label="Meeting name presets"]');
    assert.deepEqual([...presets.querySelectorAll("button")].map((node) => node.textContent), ["Lecture", "Lab", "Discussion", "Office Hours"]);
    await change("Meeting name", "Unfinished custom name");
    await act(async () => button(name).focus());
    assert.ok(host.querySelector('[aria-label="Meeting name"]'), "tabbing to a preset keeps editing active");
    await click(name);
    assert.equal(host.querySelector("h2").textContent, "Class schedule");
    assert.equal(host.querySelector(".class-setup-meeting-title").textContent, name);
    assert.equal(button("Select meeting 1").querySelector("strong").textContent, name);
    assert.equal(host.querySelector('[aria-label="Meeting name presets"]'), null);
    assert.equal(document.activeElement, button(`Rename ${name}`));
  }
  await submit(); await submit();
  assert.equal(saved[1].meetings[0].name, "Office Hours");
});

test("preset hover previews replacement text without changing or saving the typed meeting name", async () => {
  await mount(); await submit(); await click("Monday"); await click("Rename Meeting 1");
  await change("Meeting name", "My custom meeting");
  const title = host.querySelector('[aria-label="Meeting name"]');
  for (const name of ["Lecture", "Lab", "Discussion", "Office Hours"]) {
    await act(async () => button(name).dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
    assert.equal(title.dataset.preview, name);
    assert.equal(title.textContent, "My custom meeting");
    assert.equal(button("Select meeting 1").querySelector("strong").textContent, "Meeting 1");
    await act(async () => button(name).dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    assert.equal(title.hasAttribute("data-preview"), false);
    assert.equal(title.textContent, "My custom meeting");
  }
  await act(async () => button("Lab").focus());
  assert.equal(title.dataset.preview, "Lab");
  await act(async () => title.focus());
  assert.equal(title.hasAttribute("data-preview"), false);
  await act(async () => title.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  await submit(); await submit();
  assert.equal(saved[1].meetings[0].name, "My custom meeting");
});

test("Escape on a meeting-name preset cancels the draft without closing the dialog", async () => {
  await mount(); await submit(); await click("Rename Meeting 1");
  await change("Meeting name", "Unfinished custom name");
  await act(async () => button("Lab").focus());
  await act(async () => button("Lab").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(closed, 0);
  assert.equal(host.querySelector(".class-setup-meeting-title").textContent, "Meeting 1");
  assert.equal(document.activeElement, button("Rename Meeting 1"));
});

test("clearing a meeting title restores its default numbered title", async () => {
  await mount(); await submit(); await click("Monday"); await click("Rename Meeting 1");
  await change("Meeting name", "  ");
  await act(async () => host.querySelector('[aria-label="Meeting name"]').blur());
  assert.equal(host.querySelector(".class-setup-section-heading h3").textContent, "Meeting 1");
  assert.equal(button("Select meeting 1").querySelector("strong").textContent, "Meeting 1");
  await submit(); await submit();
  assert.equal(saved[1].meetings[0].name, undefined);
});

test("double click preserves native word selection and meeting title edits stay bounded and single-line", async () => {
  await mount(); await submit(); await click("Monday"); await click("Rename Meeting 1");
  await change("Meeting name", "Lecture section");
  let title = host.querySelector('[aria-label="Meeting name"]');
  await act(async () => title.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  title = host.querySelector(".class-setup-meeting-title");
  await act(async () => {
    const range = document.createRange();
    range.setStart(title.firstChild, 0); range.setEnd(title.firstChild, 7);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    title.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  });
  assert.equal(window.getSelection().toString(), "Lecture");
  assert.equal(title.dataset.caretAtEnd, "false");
  await change("Meeting name", "Lab\nsection");
  assert.equal(title.textContent, "Lab section");
  await change("Meeting name", "x".repeat(161));
  assert.equal(title.textContent.length, 160);
  await act(async () => title.blur());
  await submit(); await submit();
  assert.equal(saved[1].meetings[0].name.length, 160);
});

test("validation selects an invalid background meeting and exposes collapsed skip dates", async () => {
  await mount(); await submit(); await click("Monday");
  await click("Skip dates (0)"); await click("Add exception");
  await change("Exception date 1", "2026-11-02");
  await click("Skip dates (1)");
  await change("Classes end", "2026-11-01");
  await click("Add meeting"); await click("Tuesday");
  await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /excluded dates/);
  assert.equal(button("Select meeting 1").getAttribute("aria-pressed"), "true");
  assert.equal(button("Skip dates (1)").getAttribute("aria-expanded"), "true");
  await click("Remove exception 1"); await submit(); await submit();
  assert.equal(saved[1].meetings.length, 2);
  assert.deepEqual(saved[1].meetings[0].excludedDates, []);
  assert.deepEqual(saved[1].meetings[1].days, [2]);
});

test("schedule validation blocks advancement, and asynchronous classes can remove meetings", async () => {
  await mount(); await submit(); await submit();
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.ok(host.querySelector(".class-setup-week-label .is-missing"));
  assert.equal(host.querySelector("h2").textContent, "Class schedule");
  await click("Monday"); await change("End time", "08:00"); await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /end must be after/);
  await click("Delete meeting 1"); await submit(); await submit();
  assert.deepEqual(saved[1].meetings, []);
});

test("Continue marks all missing information asterisks and clears them as fields are filled", async () => {
  await mount({ initial: emptyCourse("new-course") });
  assert.equal(host.querySelector(".is-missing"), null);
  await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Course information");
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.deepEqual([...host.querySelectorAll(".is-missing")].map((marker) => marker.closest("label").textContent.trim()), ["Course code *", "Class name *"]);
  assert.equal(host.querySelectorAll('[aria-invalid="true"]').length, 2);
  assert.equal(document.activeElement, host.querySelector("input"));
  await change("Course code", "  ");
  assert.equal(host.querySelectorAll(".is-missing").length, 2);
  await change("Course code", "BIO 101");
  assert.equal(host.querySelectorAll(".is-missing").length, 1);
  await change("Class name", "Biology");
  assert.equal(host.querySelector(".is-missing"), null);
  assert.equal(host.querySelector('[aria-invalid="true"]'), null);
  await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Class schedule");
  assert.equal(host.querySelector(".is-missing"), null);
});

test("missing schedule fields highlight together without a popup and allow advancement once complete", async () => {
  await mount(); await click("Continue");
  for (const label of ["Start time", "End time", "Classes start", "Classes end"]) await change(label, "");
  await click("Skip dates (0)"); await click("Add exception");
  await click("Continue");
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(host.querySelectorAll(".is-missing").length, 6);
  assert.equal(host.querySelectorAll('[aria-invalid="true"]').length, 6);
  assert.equal(document.activeElement, button("Sunday"));
  assert.equal(calls, 0);
  await click("Monday");
  await change("Start time", "09:00"); await change("End time", "10:00");
  await change("Classes start", "2026-10-26"); await change("Classes end", "2027-01-24");
  await change("Exception date 1", "2026-11-02");
  assert.equal(host.querySelector(".is-missing"), null);
  assert.equal(host.querySelector('[aria-invalid="true"]'), null);
  await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
});

test("missing background meeting fields are selected and hidden exception asterisks revealed", async () => {
  await mount(); await click("Continue"); await click("Monday");
  await click("Skip dates (0)"); await click("Add exception"); await click("Skip dates (1)");
  await click("Add meeting"); await click("Tuesday");
  await click("Continue");
  assert.equal(button("Select meeting 1").getAttribute("aria-pressed"), "true");
  assert.equal(button("Skip dates (1)").getAttribute("aria-expanded"), "true");
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(host.querySelectorAll(".is-missing").length, 1);
  assert.match(host.querySelector(".is-missing").closest("label").textContent, /Exception date 1/);
  assert.equal(document.activeElement, host.querySelector('[aria-invalid="true"]'));
  await click("Remove exception 1"); await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
});

test("syllabus and image stay local until final save; syllabus is storage-only and retry IDs are stable", async () => {
  let attempts = 0;
  const payloads = [];
  await mount({ onSave: async (...args) => { attempts++; payloads.push(args); if (attempts === 1) throw new Error("Upload failed; retry"); } });
  await appearance();
  const syllabus = new window.File(["Exam 2026-11-05"], "syllabus.txt", { type: "text/plain" });
  const image = new window.File(["image"], "biology.png", { type: "image/png" });
  await file("syllabus", syllabus); await file("image", image);
  assert.equal(attempts, 0);
  assert.match(host.querySelector('[aria-label="Selected class cover"]').style.backgroundImage, /blob:class-cover/);
  await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /Upload failed/);
  assert.equal(button("Remove image").matches(":disabled"), true);
  assert.equal(button("Remove syllabus").matches(":disabled"), true);
  await submit();
  assert.equal(attempts, 2);
  assert.equal(payloads[0][2].syllabus.id, payloads[1][2].syllabus.id);
  assert.equal(payloads[0][2].image.file, image);
  assert.equal(payloads[0][2].syllabus.file, syllabus);
  assert.equal(payloads[0][1].syllabusText, undefined);
  assert.equal(payloads[0][1].meetings.length, 1);
  assert.match(host.textContent, /Storage only/);
});

test("invalid files are rejected and unavailable uploads do not block class creation", async () => {
  await mount(); await appearance();
  await file("image", new window.File(["bad"], "image.svg", { type: "image/svg+xml" }));
  assert.match(host.querySelector('[role="alert"]').textContent, /PNG, JPEG/);
  await submit(); assert.equal(saved[2].image, undefined);
  await act(async () => root.unmount()); root = undefined;
  await mount({ canUpload: false }); await appearance();
  assert.ok([...host.querySelectorAll('input[type="file"]')].every((node) => node.disabled));
  await submit(); assert.equal(calls, 1);
});

test("saving locks navigation and duplicate submissions; focus returns to the opener", async () => {
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  await mount({ onSave: () => { calls++; return pending; } }); await appearance();
  await act(async () => { host.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
  assert.equal(button("Back").disabled, true);
  assert.equal(button("Close class setup").disabled, true);
  await submit(); assert.equal(calls, 1);
  await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(closed, 0);
  await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, host.querySelector("form"));
  await act(async () => resolveSave());
  await act(async () => root.unmount()); root = undefined;
  assert.equal(document.activeElement.id, "opener");
});

test("existing class edits can remove exceptions when the semester range changes", async () => {
  root = createRoot(host);
  let applied;
  await act(async () => root.render(createElement(AcademicEditor, {
    initial: { course: { ...emptyCourse("saved"), code: "BIO 101", name: "Biology" }, details: { officeHours: "", meetings: [{ id: "meeting", days: [1], start: "09:00", end: "10:00", from: "2026-10-26", until: "2026-12-15", location: "", excludedDates: ["2026-12-01"] }] } },
    courses: [], today: "2026-10-26", onApply: (value) => { applied = value; return true; }, onClose() {},
  })));
  await change("Last date", "2026-11-30"); await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /excluded dates/);
  await click("Remove exception 1"); await submit();
  assert.equal(applied.details.meetings[0].until, "2026-11-30");
  assert.deepEqual(applied.details.meetings[0].excludedDates, []);
});
