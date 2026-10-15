import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const SUMMARY = "I’d start with the work that needs your attention most, then give you a head start on the next deadline. Your week looks manageable—let’s take it one priority at a time.";
const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: DashboardStudyBrief } = await import(await clientModule("app/dashboard-study-brief.tsx"));
const node = document.getElementById("root");
const props = {
  focusAssignments: [],
  overdueCount: 0,
  dueTodayCount: 0,
  completedThisWeek: 0,
  courseCount: 0,
  courseCodeFor: () => "",
  renderStatusBadge: () => null,
  onSelectAssignment() {},
  onAddAssignment() {},
  onAddClass() {},
  onOpenAssistant() {},
  onAskAssistant() {},
};
let root;

async function mount(overrides = {}) {
  root = createRoot(node);
  await act(async () => root.render(createElement(DashboardStudyBrief, { ...props, ...overrides })));
}

async function rerender(overrides = {}) {
  await act(async () => root.render(createElement(DashboardStudyBrief, { ...props, ...overrides })));
}

async function wait(milliseconds) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, milliseconds)));
}

function installFakeWindowTimers() {
  const original = {
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    performanceNow: window.performance.now,
  };
  let now = 0;
  let nextId = 1;
  let summaryInterval;
  const timeouts = new Map();
  const intervals = new Map();
  const animationFrames = new Map();

  window.performance.now = () => now;
  window.setTimeout = (callback, delay = 0) => {
    const id = nextId++;
    timeouts.set(id, { callback, at: now + Number(delay) });
    return id;
  };
  window.clearTimeout = (id) => timeouts.delete(id);
  window.setInterval = (callback) => {
    const id = nextId++;
    intervals.set(id, callback);
    summaryInterval = id;
    return id;
  };
  window.clearInterval = (id) => {
    intervals.delete(id);
    if (summaryInterval === id) summaryInterval = undefined;
  };
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    animationFrames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => animationFrames.delete(id);

  return {
    get now() { return now; },
    get pendingTimeoutCount() { return timeouts.size; },
    get pendingIntervalCount() { return intervals.size; },
    get pendingAnimationFrameCount() { return animationFrames.size; },
    async tickSummary(elapsed) {
      now = elapsed;
      const callback = intervals.get(summaryInterval);
      assert.equal(typeof callback, "function");
      await act(async () => callback());
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      let callbacks = 0;
      while (true) {
        const next = [...timeouts.entries()]
          .filter(([, timeout]) => timeout.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        if (++callbacks > 1000) throw new Error("Fake timer callback limit exceeded");
        const [id, timeout] = next;
        timeouts.delete(id);
        now = timeout.at;
        await act(async () => timeout.callback());
      }
      now = target;
    },
    async advanceFrame(milliseconds = 16) {
      now += milliseconds;
      const frameCallbacks = [...animationFrames.values()];
      animationFrames.clear();
      await act(async () => {
        for (const callback of frameCallbacks) callback(now);
      });
    },
    async finishAnimation(maxFrames = 180) {
      for (let frame = 0; frame < maxFrames && animationFrames.size > 0; frame += 1) {
        await this.advanceFrame();
      }
    },
    restore() {
      window.setTimeout = original.setTimeout;
      window.clearTimeout = original.clearTimeout;
      window.setInterval = original.setInterval;
      window.clearInterval = original.clearInterval;
      if (original.requestAnimationFrame) window.requestAnimationFrame = original.requestAnimationFrame;
      else delete window.requestAnimationFrame;
      if (original.cancelAnimationFrame) window.cancelAnimationFrame = original.cancelAnimationFrame;
      else delete window.cancelAnimationFrame;
      window.performance.now = original.performanceNow;
    },
  };
}

async function unmount() {
  if (root) await act(async () => root.unmount());
  root = null;
  node.replaceChildren();
}

function animatedCopy() {
  return node.querySelector(".dashboard-study-copy-animated");
}

function assignments(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `assignment-${index + 1}`,
    title: `Assignment ${index + 1}`,
    courseId: "course-1",
    status: "overdue",
    dateKey: "2026-10-12",
    due: "Oct 12, 2026",
  }));
}

async function click(element) {
  await act(async () => element.click());
}

async function setInputValue(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function dispatchClick(element, detail) {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, detail });
  await act(async () => element.dispatchEvent(event));
  return event;
}

async function dispatchPointer(element, type, { pointerId = 1, pointerType = "touch", isPrimary = true, x = 0, y = 0 } = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    isPrimary: { value: isPrimary },
  });
  await act(async () => element.dispatchEvent(event));
  return event;
}

async function dispatchWheel(element, { deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false, momentum, cancelable = true } = {}) {
  const event = new window.WheelEvent("wheel", {
    bubbles: true,
    cancelable,
    deltaX,
    deltaY,
    deltaMode,
    ctrlKey,
  });
  if (momentum !== undefined) Object.defineProperty(event, "momentum", { value: momentum });
  await act(async () => element.dispatchEvent(event));
  return event;
}

function priorityNumbers() {
  return [...node.querySelectorAll(".dashboard-focus-number")].map((number) => number.textContent);
}

function priorityTrackOffset() {
  const transform = node.querySelector(".dashboard-focus-track")?.style.transform ?? "";
  const match = transform.match(/translate3d\((-?[\d.]+)px/);
  return match ? Number(match[1]) : 0;
}

function setViewportSize(viewport, width = 320, height = 480) {
  Object.defineProperty(viewport, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: height });
  const track = viewport.querySelector(".dashboard-focus-track");
  if (track) Object.defineProperty(track, "clientWidth", { configurable: true, value: width });
}

function installFakePointerCapture() {
  const prototype = window.HTMLElement.prototype;
  const original = {
    setPointerCapture: prototype.setPointerCapture,
    hasPointerCapture: prototype.hasPointerCapture,
    releasePointerCapture: prototype.releasePointerCapture,
  };
  const captures = new WeakMap();
  prototype.setPointerCapture = function (pointerId) {
    let pointerIds = captures.get(this);
    if (!pointerIds) {
      pointerIds = new Set();
      captures.set(this, pointerIds);
    }
    pointerIds.add(pointerId);
  };
  prototype.hasPointerCapture = function (pointerId) { return captures.get(this)?.has(pointerId) ?? false; };
  prototype.releasePointerCapture = function (pointerId) { captures.get(this)?.delete(pointerId); };
  return () => {
    for (const name of Object.keys(original)) {
      if (original[name]) prototype[name] = original[name];
      else delete prototype[name];
    }
  };
}

test("types the sample summary with a caret, then completes without shifting its reserved copy", async () => {
  try {
    await mount();
    assert.equal(node.querySelector("#dashboard-summary-title").textContent, "Your study summary");
    assert.equal(animatedCopy().textContent, "");
    assert.ok(node.querySelector(".dashboard-study-caret"));
    assert.equal(node.querySelector(".dashboard-study-copy-reserve").textContent, SUMMARY);
    assert.equal(node.querySelector(".dashboard-study-screen-reader-copy").textContent, SUMMARY);
    assert.equal(animatedCopy().getAttribute("aria-hidden"), "true");

    await wait(500);
    assert.ok(animatedCopy().textContent.length > 0);
    assert.ok(animatedCopy().textContent.length < SUMMARY.length);
    assert.ok(node.querySelector(".dashboard-study-caret"));

    await wait(2200);
    assert.equal(animatedCopy().textContent, SUMMARY);
    assert.equal(node.querySelector(".dashboard-study-caret"), null);
  } finally { await unmount(); }
});

test("app reduced-motion preference renders the complete summary without typing", async () => {
  try {
    await mount({ reducedMotion: true });
    assert.equal(animatedCopy().textContent, SUMMARY);
    assert.equal(node.querySelector(".dashboard-study-caret"), null);
    await act(async () => root.render(createElement(DashboardStudyBrief, { ...props, reducedMotion: false })));
    assert.equal(animatedCopy().textContent, SUMMARY);
    assert.equal(node.querySelector(".dashboard-study-caret"), null);
  } finally { await unmount(); }
});

test("system reduced-motion preference skips typing and completes if enabled during typing", async () => {
  const originalMatchMedia = window.matchMedia;
  let listener;
  const preference = {
    matches: true,
    addEventListener(_type, callback) { listener = callback; },
    removeEventListener(_type, callback) { if (listener === callback) listener = undefined; },
  };
  window.matchMedia = () => preference;
  try {
    await mount();
    assert.equal(animatedCopy().textContent, SUMMARY);
    assert.equal(node.querySelector(".dashboard-study-caret"), null);
    await unmount();

    preference.matches = false;
    await mount();
    await wait(120);
    assert.ok(animatedCopy().textContent.length > 0);
    preference.matches = true;
    await act(async () => listener({ matches: true }));
    assert.equal(animatedCopy().textContent, SUMMARY);
    assert.equal(node.querySelector(".dashboard-study-caret"), null);
    preference.matches = false;
    await act(async () => listener({ matches: false }));
    assert.equal(animatedCopy().textContent, SUMMARY);
    assert.equal(node.querySelector(".dashboard-study-caret"), null);
  } finally {
    await unmount();
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
    else delete window.matchMedia;
  }
});

test("starts Ask Edu suggestions after the summary, pauses for input, then types, deletes, and loops five suggestions", async () => {
  const timers = installFakeWindowTimers();
  const suggestions = [
    "Help me plan my week.",
    "What should I work on next?",
    "Break down this assignment.",
    "Make me a study schedule.",
    "Help me prepare for an exam.",
  ];
  try {
    await mount();
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);

    await timers.tickSummary(2499);
    assert.ok(animatedCopy().textContent.length < SUMMARY.length);
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);
    assert.equal(timers.pendingTimeoutCount, 0);

    await timers.tickSummary(2500);
    assert.equal(animatedCopy().textContent, SUMMARY);
    assert.equal(input.placeholder, "Ask Edu AI…");
    const suggestion = node.querySelector(".dashboard-study-ask-suggestion");
    assert.ok(suggestion);
    assert.equal(suggestion.getAttribute("aria-hidden"), "true");
    assert.equal(suggestion.textContent, "Ask Edu AI…");
    assert.ok(suggestion.querySelector(".dashboard-study-ask-caret"));
    assert.ok(input.classList.contains("dashboard-study-ask-input--suggestion"));
    assert.equal(timers.pendingTimeoutCount, 1);

    const initialPlaceholder = "Ask Edu AI…";
    for (let length = initialPlaceholder.length - 1; length >= 0; length -= 1) {
      await timers.advance(35);
      assert.equal(input.placeholder, initialPlaceholder.slice(0, length));
      assert.equal(suggestion.querySelector(".dashboard-study-ask-suggestion-text").textContent, input.placeholder);
      assert.equal(input.value, "");
      assert.equal(node.querySelector('[aria-label="Send question"]').disabled, true);
    }
    await timers.advance(350);
    assert.equal(input.placeholder, "");

    await timers.advance(80);
    assert.equal(input.placeholder, "H");
    assert.equal(suggestion.querySelector(".dashboard-study-ask-suggestion-text").textContent, input.placeholder);
    await rerender({ overdueCount: 1 });
    await timers.advance(80);
    assert.equal(input.placeholder, "He");
    assert.equal(suggestion.querySelector(".dashboard-study-ask-suggestion-text").textContent, input.placeholder);

    await act(async () => input.focus());
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);
    assert.equal(input.classList.contains("dashboard-study-ask-input--suggestion"), false);
    assert.equal(timers.pendingTimeoutCount, 0);
    await timers.advance(1200);
    assert.equal(input.placeholder, "Ask Edu AI…");

    await setInputValue(input, " \t ");
    await act(async () => input.blur());
    assert.equal(input.value, " \t ");
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);
    assert.equal(timers.pendingTimeoutCount, 0);

    await act(async () => input.focus());
    await setInputValue(input, "Keep this actual question");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);
    await act(async () => input.blur());
    assert.equal(input.value, "Keep this actual question");
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);
    assert.equal(node.querySelector('[aria-label="Send question"]').disabled, false);
    await timers.advance(1000);
    assert.equal(input.value, "Keep this actual question");
    assert.equal(input.placeholder, "Ask Edu AI…");

    await act(async () => input.focus());
    await setInputValue(input, "");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);
    await act(async () => input.blur());
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion-text").textContent, input.placeholder);
    assert.equal(input.placeholder, "He");
    while (input.placeholder !== suggestions[0]) await timers.advance(80);

    for (let index = 0; index < suggestions.length; index += 1) {
      assert.equal(input.placeholder, suggestions[index]);
      assert.equal(node.querySelector(".dashboard-study-ask-suggestion-text").textContent, input.placeholder);
      const next = suggestions[(index + 1) % suggestions.length];
      await timers.advance(1400 + (suggestions[index].length * 35) + 350 + (next.length * 80));
      assert.equal(input.placeholder, next);
    }
    assert.equal(timers.pendingTimeoutCount, 1);

    await unmount();
    assert.equal(timers.pendingTimeoutCount, 0);
    assert.equal(timers.pendingIntervalCount, 0);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("reduced motion keeps the Ask Edu placeholder static", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ reducedMotion: true });
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(node.querySelector(".dashboard-study-ask-suggestion"), null);
    await timers.advance(30000);
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(timers.pendingTimeoutCount, 0);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("unmount clears the typing timer", async () => {
  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;
  let callback;
  let cleared;
  window.setInterval = (nextCallback) => { callback = nextCallback; return 73; };
  window.clearInterval = (timer) => { cleared = timer; };
  try {
    await mount();
    assert.equal(typeof callback, "function");
    await unmount();
    assert.equal(cleared, 73);
    assert.equal(node.textContent, "");
  } finally {
    await unmount();
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
  }
});

test("submits a trimmed question, disables blank prompts, and keeps one separate assistant button", async () => {
  const submitted = [];
  let openCount = 0;
  let openDraft;
  try {
    await mount({
      reducedMotion: true,
      onAskAssistant: (question) => submitted.push(question),
      onOpenAssistant: (draft) => { openCount += 1; openDraft = draft; },
    });

    const form = node.querySelector(".dashboard-study-ask");
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    const sendButton = node.querySelector('[aria-label="Send question"]');
    const openButton = node.querySelector('[aria-label="Open assistant"]');
    assert.equal(input.placeholder, "Ask Edu AI…");
    assert.equal(input.maxLength, 8000);
    assert.equal(sendButton.disabled, true);
    assert.equal(node.querySelectorAll('[aria-label="Open assistant"]').length, 1);
    assert.equal(openButton.textContent, "");

    await setInputValue(input, "  \t ");
    assert.equal(sendButton.disabled, true);
    const blankSubmit = new window.Event("submit", { bubbles: true, cancelable: true });
    await act(async () => form.dispatchEvent(blankSubmit));
    assert.equal(blankSubmit.defaultPrevented, true);
    assert.deepEqual(submitted, []);

    await setInputValue(input, "  Help me plan my week.  ");
    assert.equal(sendButton.disabled, false);
    await act(async () => form.requestSubmit(sendButton));
    assert.deepEqual(submitted, ["Help me plan my week."]);
    assert.equal(input.value, "");
    assert.equal(sendButton.disabled, true);

    await setInputValue(input, "  Keep this as a draft  ");
    await click(openButton);
    assert.equal(openCount, 1);
    assert.equal(openDraft, "Keep this as a draft");
    assert.equal(input.value, "  Keep this as a draft  ");
    assert.deepEqual(submitted, ["Help me plan my week."]);
  } finally { await unmount(); }
});

test("keeps the question when navigation to the assistant is blocked", async () => {
  try {
    await mount({ reducedMotion: true, onAskAssistant: () => false });
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    await setInputValue(input, "Keep this question");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.equal(input.value, "Keep this question");
  } finally { await unmount(); }
});

test("expands inline above the same composer and renders both sides of the conversation", async () => {
  try {
    await mount({ reducedMotion: true });
    const region = node.querySelector(".dashboard-study-chat-region");
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    assert.equal(region.style.height, "0px");
    assert.equal(region.getAttribute("aria-hidden"), "true");
    await setInputValue(input, "What should I do first?");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.equal(region.style.height, "280px");
    assert.equal(region.getAttribute("aria-hidden"), "false");
    assert.equal(node.querySelector('[aria-label="Ask Edu AI"]'), input);
    assert.equal(region.nextElementSibling.className, "dashboard-study-footer");
    await rerender({ reducedMotion: true, chatMessages: [{
      id: "reply-1", question: "What should I do first?", status: "complete",
      result: { answer: { blocks: [{ kind: "recommendation", text: "Start with your overdue work.", citations: [] }] }, citations: [], proposalId: null },
    }] });
    assert.match(node.querySelector(".dashboard-study-chat-user").textContent, /What should I do first/);
    assert.match(node.querySelector(".dashboard-study-chat-assistant").textContent, /Start with your overdue work/);
    assert.equal(node.querySelector('[role="log"]').getAttribute("aria-label"), "Conversation with Edu AI");
  } finally { await unmount(); }
});

test("collapses and reopens chat without replacing the composer or losing its draft, and hands off follow-ups", async () => {
  const inline = [];
  const continued = [];
  const callbacks = {
    reducedMotion: true,
    onAskAssistant: (question) => { inline.push(question); },
    onContinueAssistant: (...args) => { continued.push(args); },
  };
  try {
    await mount(callbacks);
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    await setInputValue(input, "First question");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    await rerender({ ...callbacks, chatMessages: [{ id: "first", question: "First question", status: "complete", conversationId: "conversation-one" }] });

    const region = node.querySelector("#dashboard-study-chat");
    const collapse = node.querySelector('[aria-label="Collapse chat"]');
    const shell = node.querySelector(".dashboard-study-brief");
    assert.ok(region);
    assert.equal(collapse.parentElement, shell);
    assert.notEqual(collapse.closest(".dashboard-study-summary"), collapse.parentElement);
    assert.equal(collapse.getAttribute("aria-expanded"), "true");
    assert.equal(collapse.getAttribute("aria-controls"), "dashboard-study-chat");
    assert.equal(region.id, "dashboard-study-chat");
    assert.equal(collapse.compareDocumentPosition(region) & window.Node.DOCUMENT_POSITION_PRECEDING, window.Node.DOCUMENT_POSITION_PRECEDING);

    await setInputValue(input, "Keep this draft");
    await click(collapse);
    const expand = node.querySelector('[aria-label="Expand chat"]');
    assert.ok(expand);
    assert.equal(expand.getAttribute("aria-expanded"), "false");
    assert.equal(expand.getAttribute("aria-controls"), region.id);
    assert.equal(region.style.height, "0px");
    assert.equal(region.getAttribute("aria-hidden"), "true");
    assert.equal(region.hasAttribute("inert"), true);
    assert.equal(node.querySelector('[aria-label="Ask Edu AI"]'), input);
    assert.equal(input.value, "Keep this draft");
    assert.match(region.textContent, /First question/);
    assert.deepEqual(inline, ["First question"]);
    assert.deepEqual(continued, []);

    await click(expand);
    assert.equal(node.querySelector('[aria-label="Collapse chat"]').getAttribute("aria-expanded"), "true");
    assert.equal(region.style.height, "280px");
    assert.equal(region.getAttribute("aria-hidden"), "false");
    assert.equal(region.hasAttribute("inert"), false);
    assert.equal(input.value, "Keep this draft");

    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.deepEqual(inline, ["First question"]);
    assert.deepEqual(continued, [["Keep this draft", "conversation-one"]]);
    assert.equal(input.value, "");
    await rerender({ ...callbacks, chatMessages: [{ id: "first", question: "First question", status: "complete", conversationId: "conversation-one" }] });
    await click(node.querySelector('[aria-label="Collapse chat"]'));
    await rerender({ ...callbacks, chatMessages: [
      { id: "first", question: "First question", status: "complete", conversationId: "conversation-one" },
      { id: "reply", question: "Keep this draft", status: "complete", conversationId: "conversation-one" },
    ] });
    assert.equal(node.querySelector('[aria-label="Expand chat"]').getAttribute("aria-expanded"), "false");
    assert.equal(region.style.height, "0px");
  } finally { await unmount(); }
});

test("uses the course spring to expand chat, cancels on unmount, and skips motion when requested", async () => {
  const originalAnimate = window.HTMLElement.prototype.animate;
  const animations = [];
  window.HTMLElement.prototype.animate = function (frames, options) {
    const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  };
  try {
    await mount();
    await setInputValue(node.querySelector('[aria-label="Ask Edu AI"]'), "Plan my week");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.equal(animations.length, 1);
    assert.equal(animations[0].options.duration, 420);
    assert.equal(animations[0].frames[0].height, "0px");
    assert.equal(animations[0].frames.at(-1).height, "280px");
    assert.ok(animations[0].frames.some((frame) => Number.parseFloat(frame.height) > 280));
    await rerender({ reducedMotion: true });
    assert.equal(animations[0].cancelled, true);
    assert.equal(animations.length, 1);
    assert.equal(node.querySelector(".dashboard-study-chat-region").style.height, "280px");
  } finally {
    await unmount();
    if (originalAnimate) window.HTMLElement.prototype.animate = originalAnimate;
    else delete window.HTMLElement.prototype.animate;
  }
});

test("retargets chat height animations from the rendered height and cancels the active animation on unmount", async () => {
  const prototype = window.HTMLElement.prototype;
  const originalAnimate = prototype.animate;
  const originalRect = prototype.getBoundingClientRect;
  const animations = [];
  let renderedHeight = 0;
  prototype.getBoundingClientRect = function () {
    if (this.id === "dashboard-study-chat") return { height: renderedHeight, top: 0, bottom: renderedHeight, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} };
    return originalRect.call(this);
  };
  prototype.animate = function (frames, options) {
    const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    if (this.id === "dashboard-study-chat") animations.push(animation);
    return animation;
  };
  try {
    await mount();
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    await setInputValue(input, "First question");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.equal(animations[0].frames[0].height, "0px");
    assert.equal(animations[0].frames.at(-1).height, "280px");

    renderedHeight = 137;
    await click(node.querySelector('[aria-label="Collapse chat"]'));
    assert.equal(animations[0].cancelled, true);
    assert.equal(animations[1].frames[0].height, "137px");
    assert.equal(animations[1].frames.at(-1).height, "0px");

    renderedHeight = 91;
    await click(node.querySelector('[aria-label="Expand chat"]'));
    assert.equal(animations[1].cancelled, true);
    assert.equal(animations[2].frames[0].height, "91px");
    assert.equal(animations[2].frames.at(-1).height, "280px");
    await unmount();
    assert.equal(animations[2].cancelled, true);
  } finally {
    await unmount();
    if (originalAnimate) prototype.animate = originalAnimate;
    else delete prototype.animate;
    prototype.getBoundingClientRect = originalRect;
  }
});

test("bounces the whole shell bottom on collapse and retargets its padding when reopened", async () => {
  const prototype = window.HTMLElement.prototype;
  const originalAnimate = prototype.animate;
  const originalRect = prototype.getBoundingClientRect;
  const originalComputedStyle = window.getComputedStyle;
  const shellAnimations = [];
  let renderedHeight = 280;
  let renderedPadding = 20;
  prototype.getBoundingClientRect = function () {
    if (this.id === "dashboard-study-chat") return { height: renderedHeight };
    return originalRect.call(this);
  };
  prototype.animate = function (frames, options) {
    const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    if (this.classList.contains("dashboard-study-brief")) shellAnimations.push(animation);
    return animation;
  };
  window.getComputedStyle = function (element) {
    if (element.classList.contains("dashboard-study-brief")) {
      const active = shellAnimations.at(-1);
      return { paddingBottom: `${active && !active.cancelled ? renderedPadding : 20}px` };
    }
    return originalComputedStyle.call(this, element);
  };
  const chatMessages = [{ id: "first", question: "First question", status: "complete" }];
  try {
    await mount({ chatMessages });
    assert.equal(shellAnimations.length, 0);
    await click(node.querySelector('[aria-label="Collapse chat"]'));
    const closing = shellAnimations[0];
    assert.equal(closing.options.duration, 420);
    assert.equal(closing.frames[0].paddingBottom, "20px");
    assert.equal(closing.frames.at(-1).paddingBottom, "20px");
    assert.ok(closing.frames.some((frame) => Number.parseFloat(frame.paddingBottom) < 20));
    assert.ok(closing.frames.every((frame) => Number.parseFloat(frame.paddingBottom) >= 0));

    renderedHeight = 0;
    renderedPadding = 14;
    await click(node.querySelector('[aria-label="Expand chat"]'));
    assert.equal(closing.cancelled, true);
    const reopening = shellAnimations[1];
    assert.equal(reopening.frames[0].paddingBottom, "14px");
    assert.equal(reopening.frames.at(-1).paddingBottom, "20px");

    await rerender({ chatMessages, reducedMotion: true });
    assert.equal(reopening.cancelled, true);
    assert.equal(shellAnimations.length, 2);
    await click(node.querySelector('[aria-label="Collapse chat"]'));
    assert.equal(shellAnimations.length, 2);
    assert.equal(node.querySelector("#dashboard-study-chat").style.height, "0px");

    await rerender({ chatMessages });
    renderedHeight = 280;
    await click(node.querySelector('[aria-label="Expand chat"]'));
    await click(node.querySelector('[aria-label="Collapse chat"]'));
    const lastAnimation = shellAnimations.at(-1);
    await unmount();
    assert.equal(lastAnimation.cancelled, true);
  } finally {
    await unmount();
    if (originalAnimate) prototype.animate = originalAnimate;
    else delete prototype.animate;
    prototype.getBoundingClientRect = originalRect;
    window.getComputedStyle = originalComputedStyle;
  }
});

test("observes the summary shell border box and keeps its outline paths in sync with shell height", async () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const prototype = window.HTMLElement.prototype;
  const originalRect = prototype.getBoundingClientRect;
  const originalComputedStyle = window.getComputedStyle;
  const observations = [];
  let observerCallback;
  let disconnected = false;
  let shellHeight = 300;
  globalThis.ResizeObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe(target, options) { observations.push({ target, options }); }
    disconnect() { disconnected = true; }
  };
  prototype.getBoundingClientRect = function () {
    if (this.classList?.contains("dashboard-study-brief")) {
      return { width: 600, height: shellHeight, top: 0, bottom: shellHeight, left: 0, right: 600 };
    }
    if (this.classList?.contains("dashboard-study-summary")) {
      return { width: 300, height: 100, top: 20, bottom: 120, left: 20, right: 320 };
    }
    if (this.classList?.contains("dashboard-focus")) {
      return { width: 240, height: 100, top: 140, bottom: 240, left: 340, right: 580 };
    }
    if (this.classList?.contains("dashboard-study-chat-toggle")) return { width: 120, height: 16 };
    if (this.classList?.contains("dashboard-study-lead")) return { width: 200, height: 20, top: 20, bottom: 40, left: 0, right: 200 };
    if (this.classList?.contains("dashboard-study-footer")) return { width: 200, height: 30, top: 250, bottom: 280, left: 0, right: 200 };
    return originalRect.call(this);
  };
  window.getComputedStyle = new Proxy(originalComputedStyle, {
    apply(target, thisArg, args) {
      const style = Reflect.apply(target, thisArg, args);
      if (args[0]?.classList?.contains("dashboard-study-brief")) {
        return { ...style, paddingBottom: "20px", borderTopLeftRadius: "16px" };
      }
      return style;
    },
  });
  try {
    await mount();
    const shell = node.querySelector(".dashboard-study-brief");
    assert.equal(shell.style.getPropertyValue("--summary-tab-center"), "170px");
    const shellObservation = observations.find(({ target }) => target === shell);
    assert.deepEqual(shellObservation?.options, { box: "border-box" });

    const outline = node.querySelector(".dashboard-study-outline path");
    const initialPath = outline.getAttribute("d");
    assert.ok(initialPath);
    assert.equal(shell.style.getPropertyValue("--summary-tab-depth"), "0px");
    await rerender({ reducedMotion: true, chatMessages: [{ id: "tab", question: "Show the tab", status: "complete" }] });
    assert.equal(shell.style.getPropertyValue("--summary-tab-depth"), "16px");
    assert.match(outline.getAttribute("d"), /315\.5/);
    assert.match(outline.getAttribute("d"), /A 8 8 /);
    shellHeight = 340;
    await act(async () => observerCallback([{ target: shell }]));
    assert.equal(shell.style.getPropertyValue("--summary-tab-center"), "170px");
    const updatedPath = outline.getAttribute("d");
    assert.notEqual(updatedPath, initialPath);
    assert.match(updatedPath, /355\.5/);
    assert.equal(shell.style.getPropertyValue("--summary-shell-path"), `path("${updatedPath}")`);

    await unmount();
    assert.equal(disconnected, true);
  } finally {
    await unmount();
    prototype.getBoundingClientRect = originalRect;
    window.getComputedStyle = originalComputedStyle;
    if (originalResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalResizeObserver;
  }
});

test("keeps inline errors visible and prevents sending while a reply is running", async () => {
  let sendCount = 0;
  try {
    await mount({ reducedMotion: true, chatBusy: true, onAskAssistant: () => { sendCount += 1; }, chatMessages: [{ id: "failed", question: "Help", status: "failed", error: "Enable the assistant first." }] });
    assert.equal(node.querySelector('[role="alert"]').textContent, "Enable the assistant first.");
    await setInputValue(node.querySelector('[aria-label="Ask Edu AI"]'), "Another question");
    assert.equal(node.querySelector('[aria-label="Send question"]').disabled, true);
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.equal(sendCount, 0);
  } finally { await unmount(); }
});

test("passes the conversation and proposal when opening an inline change preview", async () => {
  let opened;
  try {
    await mount({ reducedMotion: true, onOpenAssistant: (...args) => { opened = args; }, chatMessages: [{
      id: "proposal-message", question: "Plan study time", status: "complete", conversationId: "conversation-one",
      result: { answer: { blocks: [{ kind: "general", text: "Review this plan.", citations: [] }] }, citations: [], proposalId: "proposal-one" },
    }] });
    await click(node.querySelector(".dashboard-study-chat-assistant button"));
    assert.deepEqual(opened, [undefined, "conversation-one", "proposal-one"]);
  } finally { await unmount(); }
});

test("keeps the first send inline and hands the second send to the same assistant conversation", async () => {
  const inline = [];
  const continued = [];
  const callbacks = {
    reducedMotion: true,
    onAskAssistant: (question) => { inline.push(question); },
    onContinueAssistant: (...args) => { continued.push(args); },
  };
  try {
    await mount(callbacks);
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    await setInputValue(input, "First question");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.deepEqual(inline, ["First question"]);
    assert.deepEqual(continued, []);
    await rerender({ ...callbacks, chatMessages: [{ id: "first", question: "First question", status: "complete", conversationId: "conversation-one" }] });
    await setInputValue(input, "  Follow-up question  ");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.deepEqual(inline, ["First question"]);
    assert.deepEqual(continued, [["Follow-up question", "conversation-one"]]);
    assert.equal(input.value, "");
  } finally { await unmount(); }
});

test("preserves the second message draft if the assistant handoff is blocked", async () => {
  try {
    await mount({ reducedMotion: true, onContinueAssistant: () => false, chatMessages: [{ id: "first", question: "First question", status: "complete", conversationId: "conversation-one" }] });
    const input = node.querySelector('[aria-label="Ask Edu AI"]');
    await setInputValue(input, "Keep this follow-up");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.equal(input.value, "Keep this follow-up");
  } finally { await unmount(); }
});

test("routes a follow-up after a failed first ask without inventing a conversation ID", async () => {
  let continued;
  try {
    await mount({ reducedMotion: true, onAskAssistant: () => assert.fail("Do not send the follow-up inline"), onContinueAssistant: (...args) => { continued = args; }, chatMessages: [{ id: "failed", question: "First question", status: "failed", error: "Assistant setup required." }] });
    await setInputValue(node.querySelector('[aria-label="Ask Edu AI"]'), "Try again");
    await act(async () => node.querySelector(".dashboard-study-ask").requestSubmit());
    assert.deepEqual(continued, ["Try again", undefined]);
  } finally { await unmount(); }
});

test("shows two priorities per page with global numbering, working boundaries, and an unpaired final assignment", async () => {
  const focusAssignments = assignments(5);
  const selected = [];
  try {
    await mount({ focusAssignments, reducedMotion: true, onSelectAssignment: (assignment) => selected.push(assignment.id) });
    assert.deepEqual(priorityNumbers(), ["01", "02"]);
    assert.equal(node.querySelectorAll(".dashboard-focus-list > li").length, 2);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    assert.equal(node.querySelector('[aria-label="Previous priorities"]').disabled, true);
    assert.equal(node.querySelector('[aria-label="Next priorities"]').disabled, false);

    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");
    await click(node.querySelector(".dashboard-focus-item"));
    assert.deepEqual(selected, ["assignment-3"]);

    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.deepEqual(priorityNumbers(), ["05"]);
    assert.equal(node.querySelectorAll(".dashboard-focus-list > li").length, 1);
    assert.equal(node.querySelector(".dashboard-focus-list").getAttribute("start"), "5");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");
    assert.equal(node.querySelector('[aria-label="Next priorities"]').disabled, true);

    await click(node.querySelector('[aria-label="Previous priorities"]'));
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
    await click(node.querySelector('[aria-label="Previous priorities"]'));
    assert.equal(node.querySelector('[aria-label="Previous priorities"]').disabled, true);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
  } finally { await unmount(); }
});

test("resets paging when the ordered assignment IDs change, but preserves the page on an unchanged rerender", async () => {
  const focusAssignments = assignments(5);
  try {
    await mount({ focusAssignments, reducedMotion: true });
    await click(node.querySelector('[aria-label="Next priorities"]'));
    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");

    await rerender({ focusAssignments: [...focusAssignments], reducedMotion: true });
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");

    const reordered = [...focusAssignments].reverse();
    await rerender({ focusAssignments: reordered, reducedMotion: true });
    assert.deepEqual(priorityNumbers(), ["01", "02"]);
    assert.equal(node.querySelector(".dashboard-focus-list").textContent.includes("Assignment 5"), true);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await click(node.querySelector('[aria-label="Next priorities"]'));
    await rerender({ focusAssignments: reordered.slice(0, 2), reducedMotion: true });
    assert.deepEqual(priorityNumbers(), ["01", "02"]);
    assert.equal(node.querySelector(".dashboard-focus-pagination"), null);
  } finally { await unmount(); }
});

test("wheel input tracks subpixels, cancels a reversal, and commits a new page after idle release", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const verticalMomentum = await dispatchWheel(viewport, { deltaX: 0.2, deltaY: 50, momentum: true });
    const zoom = await dispatchWheel(viewport, { deltaX: 90, ctrlKey: true });
    assert.equal(verticalMomentum.defaultPrevented, false);
    assert.equal(zoom.defaultPrevented, false);
    assert.equal(priorityTrackOffset(), 0);
    await timers.advance(80);

    await dispatchWheel(viewport, { deltaX: 0.5 });
    assert.equal(priorityTrackOffset(), -0.5);
    await dispatchWheel(viewport, { deltaX: 1, deltaMode: 1 });
    assert.equal(priorityTrackOffset(), -16.5);
    await dispatchWheel(viewport, { deltaX: 0.05, deltaMode: 2 });
    assert.equal(priorityTrackOffset(), -32.5);
    await dispatchWheel(viewport, { deltaX: -0.04, deltaMode: 2 });
    assert.ok(priorityTrackOffset() > -32.5 && priorityTrackOffset() < 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await timers.advance(79);
    assert.equal(timers.pendingAnimationFrameCount, 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.advance(1);
    assert.ok(timers.pendingAnimationFrameCount > 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.finishAnimation();
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await timers.advance(200);
    await dispatchWheel(viewport, { deltaX: 120 });
    assert.equal(priorityTrackOffset(), -120);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.advance(79);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.advance(1);
    assert.ok(timers.pendingAnimationFrameCount > 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("wheel intent stays on its first axis through mixed packets and the horizontal release tail", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const verticalStart = await dispatchWheel(viewport, { deltaX: 2, deltaY: 30 });
    const verticalBurst = await dispatchWheel(viewport, { deltaX: 30, deltaY: 0 });
    assert.equal(verticalStart.defaultPrevented, false);
    assert.equal(verticalBurst.defaultPrevented, false, "a vertical-start burst cannot become a carousel swipe");
    assert.equal(priorityTrackOffset(), 0);

    await timers.advance(80);
    const horizontalStart = await dispatchWheel(viewport, { deltaX: 20, deltaY: 2 });
    assert.equal(horizontalStart.defaultPrevented, true);
    assert.equal(priorityTrackOffset(), -20);

    const diagonalTail = await dispatchWheel(viewport, { deltaX: 1, deltaY: 40 });
    const zeroXTail = await dispatchWheel(viewport, { deltaX: 0, deltaY: 24 });
    assert.equal(diagonalTail.defaultPrevented, true, "a latched horizontal burst consumes y-dominant packets");
    assert.equal(zeroXTail.defaultPrevented, true, "a latched horizontal burst consumes zero-X packets");
    assert.equal(priorityTrackOffset(), -21, "latched packets apply only their horizontal component");

    const zoom = await dispatchWheel(viewport, { deltaX: 120, deltaY: 80, ctrlKey: true });
    assert.equal(zoom.defaultPrevented, false, "browser zoom remains available during a horizontal burst");
    assert.equal(priorityTrackOffset(), -21);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await timers.advance(79);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.advance(1);
    assert.ok(timers.pendingAnimationFrameCount > 0, "ordinary wheel motion releases after about 80ms idle");
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    const tail = await dispatchWheel(viewport, { deltaX: 0, deltaY: 30 });
    assert.equal(tail.defaultPrevented, true, "the horizontal axis remains latched through its momentum tail");
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("an uncancelable wheel packet cannot move the priority cards", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const event = await dispatchWheel(viewport, { deltaX: 80, cancelable: false });
    assert.equal(event.defaultPrevented, false);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await timers.advance(200);
    await timers.finishAnimation();
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await dispatchWheel(viewport, { deltaX: 120 });
    await dispatchWheel(viewport, { deltaX: -10 });
    await timers.advance(80);
    assert.ok(timers.pendingAnimationFrameCount > 0, "the inward correction is returning toward the original page");
    const returningOffset = priorityTrackOffset();
    const duringReturn = await dispatchWheel(viewport, { deltaX: 40, cancelable: false });
    assert.equal(duringReturn.defaultPrevented, false);
    assert.equal(priorityTrackOffset(), returningOffset, "uncancelable input cannot replace or stop the springback");
    await timers.finishAnimation();
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a corrected first-page edge pull can cross the origin and page to the next priorities", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: -1000 });
    assert.ok(priorityTrackOffset() > 0 && priorityTrackOffset() <= 24, "the unavailable previous-page pull is resisted");
    await dispatchWheel(viewport, { deltaX: 172 });
    assert.ok(priorityTrackOffset() <= -140, "a clear correction crosses the origin toward the available next page");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await timers.advance(80);
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("an explicit fresh reverse wheel packet can correct a release during the tail guard", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 100 });
    await timers.advance(80);
    assert.ok(timers.pendingAnimationFrameCount > 0, "the first gesture has begun settling");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    const correction = await dispatchWheel(viewport, { deltaX: -100, momentum: false });
    assert.equal(correction.defaultPrevented, true, "explicit momentum=false identifies a fresh physical gesture");
    assert.equal(priorityTrackOffset(), 0, "the new gesture cancels the stale release and applies its correction");
    await timers.advance(80);
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("subpixel inward wheel corrections accumulate and cancel a threshold-crossing swipe", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 120 });
    assert.equal(priorityTrackOffset(), -120);
    for (let packet = 0; packet < 24; packet += 1) {
      await timers.advance(10);
      await dispatchWheel(viewport, { deltaX: -0.25 });
    }

    assert.equal(priorityTrackOffset(), -114, "24 quarter-pixel packets add up to 6px of inward correction");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.advance(79);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.advance(1);
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5", "small recent corrections cancel the pending page change");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("native horizontal momentum releases one page and consumes its remaining tail", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(7) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 1000, momentum: false });
    assert.equal(priorityTrackOffset(), -328, "input cannot travel beyond one page plus the 8px page gap");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 7");

    const release = await dispatchWheel(viewport, { deltaX: 1, momentum: true });
    assert.equal(release.defaultPrevented, true);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 7");

    const momentumTail = await dispatchWheel(viewport, { deltaX: 40, momentum: true });
    const followingTail = await dispatchWheel(viewport, { deltaX: 80 });
    assert.equal(momentumTail.defaultPrevented, true);
    assert.equal(followingTail.defaultPrevented, true);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 7");

    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 7");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("same-direction wheel packets cannot reopen a committed page change", async (t) => {
  for (const direction of [1, -1]) {
    await t.test(direction > 0 ? "forward from the first page" : "back to the first page", async () => {
      const timers = installFakeWindowTimers();
      const focusAssignments = assignments(5);
      try {
        await mount({ focusAssignments, reducedMotion: true });
        if (direction < 0) {
          await click(node.querySelector('[aria-label="Next priorities"]'));
          assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");
        }
        await rerender({ focusAssignments, reducedMotion: false });
        const viewport = node.querySelector(".dashboard-focus-viewport");
        setViewportSize(viewport);

        await dispatchWheel(viewport, { deltaX: direction * 1000, momentum: false });
        await dispatchWheel(viewport, { deltaX: direction, momentum: true });
        assert.ok(timers.pendingAnimationFrameCount > 0, "the page spring is ready to commit");
        await timers.advanceFrame(16);

        const destination = direction > 0 ? "3–4 of 5" : "1–2 of 5";
        assert.equal(node.querySelector(".dashboard-focus-range").textContent, destination);
        assert.equal(priorityTrackOffset(), 0, "the destination is committed at the track origin");

        for (const momentum of [undefined, false, true]) {
          const packet = await dispatchWheel(viewport, {
            deltaX: direction * 120,
            ...(momentum === undefined ? {} : { momentum }),
          });
          assert.equal(packet.defaultPrevented, true, `same-direction ${String(momentum)} packet stays inside the page-change tail`);
          assert.equal(priorityTrackOffset(), 0, `same-direction ${String(momentum)} packet cannot pull the newly committed page`);
          assert.equal(node.querySelector(".dashboard-focus-range").textContent, destination);
        }

        for (let frame = 0; frame < 4; frame += 1) {
          await timers.advanceFrame(16);
          assert.equal(priorityTrackOffset(), 0, "no frame may translate the track after destination arrival");
          assert.equal(node.querySelector(".dashboard-focus-range").textContent, destination);
        }
      } finally {
        await unmount();
        timers.restore();
      }
    });
  }
});

test("sparse same-direction wheel packets remain guarded during a page spring", async (t) => {
  for (const direction of [1, -1]) {
    for (const delay of [80, 200]) {
      for (const momentum of [undefined, false, true]) {
        const momentumLabel = momentum === undefined ? "unknown" : String(momentum);
        await t.test(`${direction > 0 ? "forward" : "backward"}, ${delay}ms, momentum ${momentumLabel}`, async () => {
          const timers = installFakeWindowTimers();
          const focusAssignments = assignments(5);
          try {
            await mount({ focusAssignments, reducedMotion: true });
            if (direction < 0) await click(node.querySelector('[aria-label="Next priorities"]'));
            await rerender({ focusAssignments, reducedMotion: false });
            const viewport = node.querySelector(".dashboard-focus-viewport");
            setViewportSize(viewport);

            await dispatchWheel(viewport, { deltaX: direction * 120 });
            await timers.advance(80);
            assert.ok(timers.pendingAnimationFrameCount > 0, "idle release started a page spring");
            await timers.advance(delay);
            assert.ok(timers.pendingAnimationFrameCount > 0, `the spring is still active ${delay}ms after release`);

            const beforePacket = priorityTrackOffset();
            const packet = await dispatchWheel(viewport, {
              deltaX: direction * 20,
              ...(momentum === undefined ? {} : { momentum }),
            });
            assert.equal(packet.defaultPrevented, true, "a sparse packet in the original direction remains captured");
            assert.equal(priorityTrackOffset(), beforePacket, "the late packet cannot stop or rebase the active spring");

            const destination = direction > 0 ? "3–4 of 5" : "1–2 of 5";
            for (let frame = 0; frame < 100 && timers.pendingAnimationFrameCount > 0; frame += 1) {
              await timers.advanceFrame(16);
              if (node.querySelector(".dashboard-focus-range").textContent === destination) {
                assert.equal(priorityTrackOffset(), 0, "arrival commits the destination at the track origin");
              }
            }
            assert.equal(node.querySelector(".dashboard-focus-range").textContent, destination);
            assert.equal(priorityTrackOffset(), 0);
          } finally {
            await unmount();
            timers.restore();
          }
        });
      }
    }
  }
});

test("uncancelable same-direction tail packets extend the arrival guard without moving the track", async () => {
  const timers = installFakeWindowTimers();
  const focusAssignments = assignments(5);
  try {
    await mount({ focusAssignments, reducedMotion: true });
    await click(node.querySelector('[aria-label="Next priorities"]'));
    await rerender({ focusAssignments, reducedMotion: false });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: -1000, momentum: false });
    await dispatchWheel(viewport, { deltaX: -1, momentum: true });
    assert.ok(timers.pendingAnimationFrameCount > 0);
    await timers.advanceFrame(16);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    assert.equal(priorityTrackOffset(), 0);

    for (let packet = 0; packet < 3; packet += 1) {
      await timers.advance(100);
      const event = await dispatchWheel(viewport, {
        deltaX: -20,
        momentum: false,
        cancelable: false,
      });
      assert.equal(event.defaultPrevented, false, "the browser-owned packet remains uncancelable");
      assert.equal(priorityTrackOffset(), 0, "uncancelable tail packets cannot create an edge pull");
      assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    }

    await timers.advance(1);
    const continuation = await dispatchWheel(viewport, { deltaX: -20, momentum: false });
    assert.equal(continuation.defaultPrevented, true, "uncancelable packets keep the same-direction tail alive");
    assert.equal(priorityTrackOffset(), 0, "the next cancelable packet cannot reopen the first-page edge");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    for (let frame = 0; frame < 4; frame += 1) {
      await timers.advanceFrame(16);
      assert.equal(priorityTrackOffset(), 0, "no sampled frame translates after arrival");
      assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    }
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a tiny inward wheel correction keeps the tail aligned with the page that was selected", async () => {
  const timers = installFakeWindowTimers();
  const focusAssignments = assignments(7);
  try {
    await mount({ focusAssignments });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 120 });
    await timers.advance(20);
    await dispatchWheel(viewport, { deltaX: -1 });
    assert.equal(priorityTrackOffset(), -119, "the one-pixel correction remains visible before release");
    await timers.advance(80);
    assert.ok(timers.pendingAnimationFrameCount > 0, "the remaining page intent still begins its spring");
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 7");
    assert.equal(priorityTrackOffset(), 0);

    const lateOriginalDirection = await dispatchWheel(viewport, { deltaX: 20, momentum: false });
    assert.equal(lateOriginalDirection.defaultPrevented, true, "the tail follows the selected forward page");
    assert.equal(priorityTrackOffset(), 0, "a small inward correction cannot retarget the tail to edge-return intent");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 7");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("opposing tail jitter must reach six pixels consecutively, then a quiet tail permits a fresh swipe", async () => {
  const timers = installFakeWindowTimers();
  const focusAssignments = assignments(7);
  try {
    await mount({ focusAssignments });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 120 });
    await timers.advance(20);
    await dispatchWheel(viewport, { deltaX: -1 });
    await timers.advance(80);
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 7");

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const opposing = await dispatchWheel(viewport, { deltaX: -2, momentum: false });
      const original = await dispatchWheel(viewport, { deltaX: 0.5, momentum: false });
      assert.equal(opposing.defaultPrevented, true, "subthreshold opposite packets stay inside the page-change tail");
      assert.equal(original.defaultPrevented, true, "original-direction packets reset the pending reversal distance");
      assert.equal(priorityTrackOffset(), 0, "alternating packets cannot reopen the settled page");
    }

    await timers.advance(200);
    await dispatchWheel(viewport, { deltaX: 120 });
    assert.equal(priorityTrackOffset(), -120, "a deliberate swipe starts after a full quiet tail");
    await timers.advance(80);
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5–6 of 7");
    assert.equal(priorityTrackOffset(), 0);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("wheel pulls compress progressively at both ends and spring back without changing the page", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5), reducedMotion: true });
    await click(node.querySelector('[aria-label="Next priorities"]'));
    await click(node.querySelector('[aria-label="Next priorities"]'));
    await rerender({ focusAssignments: assignments(5), reducedMotion: false });
    let viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 30 });
    const lastPagePull = Math.abs(priorityTrackOffset());
    await dispatchWheel(viewport, { deltaX: 30 });
    const fartherLastPagePull = Math.abs(priorityTrackOffset());
    await dispatchWheel(viewport, { deltaX: 1000 });
    const cappedLastPagePull = Math.abs(priorityTrackOffset());
    assert.ok(lastPagePull > 0 && lastPagePull < 30);
    assert.ok(fartherLastPagePull > lastPagePull && fartherLastPagePull <= 24);
    assert.ok(cappedLastPagePull >= fartherLastPagePull && cappedLastPagePull <= 24, `edge travel stays within 24px (got ${cappedLastPagePull})`);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");

    await dispatchWheel(viewport, { deltaX: -2 });
    const reversedLastPagePull = Math.abs(priorityTrackOffset());
    assert.ok(reversedLastPagePull < cappedLastPagePull, "a small reversal immediately moves inward from the edge");

    await timers.advance(47);
    assert.equal(timers.pendingAnimationFrameCount, 0);
    await timers.advance(1);
    assert.ok(timers.pendingAnimationFrameCount > 0, "an edge pull releases after about 48ms idle");
    const releaseAt = timers.now;
    let previousEdgeOffset = priorityTrackOffset();
    let edgeFrames = 0;
    while (timers.pendingAnimationFrameCount > 0) {
      await timers.advanceFrame(16);
      edgeFrames += 1;
      const offset = priorityTrackOffset();
      assert.ok(offset >= previousEdgeOffset - 0.01, "edge return does not overshoot away from its origin");
      assert.ok(offset <= 0.01, "edge return does not cross the committed page origin");
      previousEdgeOffset = offset;
      assert.ok(edgeFrames <= 20, "edge return has a bounded frame count");
    }
    assert.ok(timers.now - releaseAt < 300, `edge return completes under 300ms (took ${timers.now - releaseAt}ms)`);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");

    await rerender({ focusAssignments: assignments(5), reducedMotion: true });
    await click(node.querySelector('[aria-label="Previous priorities"]'));
    await click(node.querySelector('[aria-label="Previous priorities"]'));
    await rerender({ focusAssignments: assignments(5), reducedMotion: false });
    viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: -30 });
    const firstPagePull = priorityTrackOffset();
    await dispatchWheel(viewport, { deltaX: -30 });
    const fartherFirstPagePull = priorityTrackOffset();
    await dispatchWheel(viewport, { deltaX: -1000 });
    const cappedFirstPagePull = priorityTrackOffset();
    assert.ok(firstPagePull > 0 && firstPagePull < 30);
    assert.ok(fartherFirstPagePull > firstPagePull && fartherFirstPagePull <= 24);
    assert.ok(cappedFirstPagePull >= fartherFirstPagePull && cappedFirstPagePull <= 24, `edge travel stays within 24px (got ${cappedFirstPagePull})`);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await dispatchWheel(viewport, { deltaX: 2 });
    assert.ok(priorityTrackOffset() < cappedFirstPagePull, "a small reversal immediately moves inward from the first page edge");

    await timers.advance(48);
    await timers.finishAnimation();
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a pointer regrab recovers the hidden edge pull without jumping", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchPointer(viewport, "pointerdown", { x: 100, y: 100 });
    await timers.advance(100);
    await dispatchPointer(viewport, "pointermove", { x: 106, y: 100 });
    await timers.advance(100);
    await dispatchPointer(viewport, "pointermove", { x: 130, y: 100 });
    await dispatchPointer(viewport, "pointerup", { x: 130, y: 100 });
    const beforeRegrab = priorityTrackOffset();
    assert.ok(beforeRegrab > 0 && beforeRegrab < 30);

    await timers.advanceFrame(16);
    await timers.advanceFrame(32);
    const settlingOffset = priorityTrackOffset();
    assert.ok(settlingOffset > 0 && settlingOffset <= beforeRegrab);

    await dispatchPointer(viewport, "pointerdown", { x: 130, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 136, y: 100 });
    const regrabbedOffset = priorityTrackOffset();
    assert.ok(regrabbedOffset > settlingOffset);
    assert.ok(regrabbedOffset - settlingOffset < 6);

    await dispatchPointer(viewport, "pointermove", { x: 132, y: 100 });
    assert.ok(priorityTrackOffset() < regrabbedOffset);
    assert.ok(priorityTrackOffset() > 0);
    await dispatchPointer(viewport, "pointercancel", { x: 132, y: 100 });
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("pointer movement follows subpixels, previews an inert neighbor, and keeps vertical motion and taps available", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  const selected = [];
  try {
    await mount({ focusAssignments: assignments(5), onSelectAssignment: (assignment) => selected.push(assignment.id) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);
    const tapTarget = node.querySelector(".dashboard-focus-item");

    await dispatchPointer(tapTarget, "pointerdown", { x: 200, y: 100 });
    const verticalMove = await dispatchPointer(tapTarget, "pointermove", { x: 197, y: 130 });
    assert.equal(verticalMove.defaultPrevented, false);
    assert.equal(priorityTrackOffset(), 0);
    const lockedVerticalMove = await dispatchPointer(tapTarget, "pointermove", { x: 140, y: 131 });
    assert.equal(lockedVerticalMove.defaultPrevented, false, "a vertical-start pointer gesture stays available to page scrolling");
    assert.equal(priorityTrackOffset(), 0, "horizontal motion cannot turn the same vertical gesture into a swipe");
    await dispatchPointer(tapTarget, "pointerup", { x: 140, y: 131 });

    await dispatchPointer(tapTarget, "pointerdown", { x: 200, y: 100 });
    await dispatchPointer(tapTarget, "pointermove", { x: 194, y: 100 });
    await timers.advance(10);
    await dispatchPointer(tapTarget, "pointermove", { x: 193.5, y: 100 });
    assert.ok(Math.abs(priorityTrackOffset() + 6.5) < 0.001);
    await dispatchPointer(tapTarget, "lostpointercapture", { x: 193.5, y: 100 });
    assert.ok(Math.abs(priorityTrackOffset() + 6.5) < 0.001);
    await dispatchPointer(tapTarget, "pointermove", { x: 187.5, y: 100 });
    assert.ok(Math.abs(priorityTrackOffset() + 12.5) < 0.001);

    const nextPreview = viewport.querySelector('[data-priority-neighbor="next"]');
    assert.ok(nextPreview);
    assert.equal(nextPreview.getAttribute("aria-hidden"), "true");
    assert.ok(nextPreview.hasAttribute("inert"));

    await timers.advance(10);
    await dispatchPointer(tapTarget, "pointermove", { x: 191.5, y: 100 });
    assert.ok(Math.abs(priorityTrackOffset() + 8.5) < 0.001);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");

    await dispatchPointer(tapTarget, "pointerup", { x: 191.5, y: 100 });
    await timers.finishAnimation();
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    assert.equal(viewport.querySelector('[data-priority-neighbor="next"]'), null);

    await dispatchPointer(tapTarget, "pointerdown", { x: 100, y: 100 });
    await dispatchPointer(tapTarget, "pointerup", { x: 102, y: 101 });
    const tapClick = await dispatchClick(tapTarget, 1);
    assert.equal(tapClick.defaultPrevented, false);
    assert.deepEqual(selected, ["assignment-1"]);

    const keyboardClick = await dispatchClick(tapTarget, 0);
    assert.equal(keyboardClick.defaultPrevented, false);
    assert.deepEqual(selected, ["assignment-1", "assignment-1"]);
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("a slow inward pointer release cancels a drag that crossed the page threshold", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchPointer(viewport, "pointerdown", { x: 300, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 294, y: 100 });
    await timers.advance(300);
    await dispatchPointer(viewport, "pointermove", { x: 170, y: 100 });
    assert.equal(priorityTrackOffset(), -130);

    await timers.advance(20);
    await dispatchPointer(viewport, "pointerup", { x: 180, y: 100 });
    assert.equal(priorityTrackOffset(), -120, "the final 10px inward correction remains visible at release");
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5", "recent reversal cancels the earlier page-threshold drag");
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("a full-page drag with outward residual velocity never springs past its adjacent-page bound", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport, 320, 480);

    await dispatchPointer(viewport, "pointerdown", { x: 300, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 294, y: 100 });
    await timers.advance(100);
    await dispatchPointer(viewport, "pointermove", { x: -28, y: 100 });
    assert.equal(priorityTrackOffset(), -328);
    await timers.advance(10);
    await dispatchPointer(viewport, "pointermove", { x: -128, y: 100 });
    await dispatchPointer(viewport, "pointerup", { x: -128, y: 100 });

    let frames = 0;
    while (timers.pendingAnimationFrameCount > 0) {
      await timers.advanceFrame(16);
      frames += 1;
      assert.ok(priorityTrackOffset() >= -328.01, `spring stays within one page plus gap (offset ${priorityTrackOffset()})`);
      assert.ok(frames < 100, "page spring finishes in a bounded time");
    }
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("slow drags and short flicks commit after settling, while a held drag loses stale velocity", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  const selected = [];
  try {
    await mount({
      focusAssignments: assignments(5),
      onSelectAssignment: (assignment) => selected.push(assignment.id),
    });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchPointer(viewport, "pointerdown", { x: 300, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 294, y: 100 });
    await timers.advance(200);
    await dispatchPointer(viewport, "pointermove", { x: 210, y: 100 });
    await dispatchPointer(viewport, "pointerup", { x: 210, y: 100 });
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");

    await dispatchPointer(viewport, "pointerdown", { x: 300, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 294, y: 100 });
    await timers.advance(10);
    await dispatchPointer(viewport, "pointermove", { x: 244, y: 100 });
    await timers.advance(1000);
    await dispatchPointer(viewport, "pointerup", { x: 244, y: 100 });
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");

    await dispatchPointer(viewport, "pointerdown", { x: 300, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 294, y: 100 });
    await timers.advance(10);
    await dispatchPointer(viewport, "pointermove", { x: 270, y: 100 });
    await timers.advance(2);
    await dispatchPointer(viewport, "pointerup", { x: 255, y: 100 });
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "3–4 of 5");
    await timers.finishAnimation();
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");

    const swipeClick = await dispatchClick(node.querySelector(".dashboard-focus-item"), 1);
    assert.equal(swipeClick.defaultPrevented, true);
    assert.deepEqual(selected, []);

    await dispatchPointer(viewport, "pointerdown", { x: 200, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 194, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 180, y: 100 });
    assert.notEqual(priorityTrackOffset(), 0);
    await dispatchPointer(viewport, "pointercancel", { x: 180, y: 100 });
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");

    await dispatchPointer(viewport, "pointerdown", { x: 200, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 194, y: 100 });
    assert.notEqual(priorityTrackOffset(), 0);
    await dispatchPointer(viewport, "lostpointercapture", { x: 194, y: 100 });
    assert.equal(priorityTrackOffset(), 0);

    await dispatchPointer(viewport, "pointerdown", { x: 200, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 194, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: 180, y: 100 });
    await dispatchPointer(viewport, "pointerdown", { pointerId: 2, isPrimary: false, x: 190, y: 100 });
    assert.equal(priorityTrackOffset(), 0);
    await dispatchPointer(viewport, "pointerup", { x: 180, y: 100 });
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "5 of 5");
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("assignment changes, reduced motion, empty lists, and unmount cancel pending movement", async () => {
  const timers = installFakeWindowTimers();
  try {
    const originalAssignments = assignments(5);
    const reordered = [...originalAssignments].reverse();
    await mount({ focusAssignments: originalAssignments });
    let viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 100 });
    await timers.advance(115);
    assert.ok(timers.pendingAnimationFrameCount > 0);
    await rerender({ focusAssignments: reordered });
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(timers.pendingAnimationFrameCount, 0);

    viewport = node.querySelector(".dashboard-focus-viewport");
    await dispatchWheel(viewport, { deltaX: 100 });
    await timers.advance(115);
    assert.ok(timers.pendingAnimationFrameCount > 0);
    await rerender({ focusAssignments: reordered, reducedMotion: true });
    assert.equal(node.querySelector(".dashboard-focus-range").textContent, "1–2 of 5");
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(timers.pendingAnimationFrameCount, 0);

    await rerender({ focusAssignments: reordered, reducedMotion: false });
    await timers.advance(200);
    viewport = node.querySelector(".dashboard-focus-viewport");
    const unrelatedTimeoutCount = timers.pendingTimeoutCount;
    await dispatchWheel(viewport, { deltaX: 30 });
    assert.ok(timers.pendingTimeoutCount > unrelatedTimeoutCount);
    await rerender({ focusAssignments: [] });
    assert.equal(node.querySelector("[data-priority-carousel]"), null);
    assert.equal(timers.pendingTimeoutCount, unrelatedTimeoutCount);
    assert.equal(timers.pendingAnimationFrameCount, 0);

    await rerender({ focusAssignments: reordered });
    viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);
    const wheel = await dispatchWheel(viewport, { deltaX: 40 });
    assert.equal(wheel.defaultPrevented, true);
    assert.ok(priorityTrackOffset() < 0);

    await timers.advance(115);
    assert.ok(timers.pendingAnimationFrameCount > 0);
    await unmount();
    assert.equal(timers.pendingAnimationFrameCount, 0);
    assert.equal(timers.pendingTimeoutCount, 0);
    assert.equal(timers.pendingIntervalCount, 0);
  } finally {
    await unmount();
    timers.restore();
  }
});
