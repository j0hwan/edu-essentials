import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const SUMMARY = "I’d start with the work that needs your attention most, then give you a head start on the next deadline. Your week looks manageable—let’s take it one priority at a time.";
const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act, StrictMode } = await import("react");
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

async function mountInStrictMode(overrides = {}) {
  root = createRoot(node);
  await act(async () => root.render(createElement(
    StrictMode,
    null,
    createElement(DashboardStudyBrief, { ...props, ...overrides }),
  )));
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
  Object.defineProperty(event, "momentum", { value: momentum });
  await act(async () => element.dispatchEvent(event));
  return event;
}

function priorityNumbers() {
  return [...node.querySelectorAll("#dashboard-priority-list .dashboard-focus-number")].map((number) => number.textContent);
}

function priorityPage() {
  const pageDots = node.querySelector(".dashboard-focus-page-dots");
  return Number(pageDots?.getAttribute("data-page"));
}

function priorityCommittedPage() {
  return Number(node.querySelector("[data-priority-carousel]")?.getAttribute("data-committed-page"));
}

function priorityTransitioning() {
  return node.querySelector("[data-priority-carousel]")?.getAttribute("data-transitioning") === "true";
}

function assertPageDots(page, pageCount) {
  const status = node.querySelector(".dashboard-focus-page-dots");
  assert.ok(status, "page status is present");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.equal(status.getAttribute("data-page"), String(page));
  assert.equal(status.getAttribute("data-page-count"), String(pageCount));
  assert.equal(status.querySelectorAll(".dashboard-focus-page-dot").length, pageCount);
  assert.equal(status.querySelectorAll(".dashboard-focus-page-dot--active").length, 1);
  const dots = [...status.querySelectorAll(".dashboard-focus-page-dot")];
  assert.equal(dots.findIndex((dot) => dot.classList.contains("dashboard-focus-page-dot--active")) + 1, page);
  assert.ok(dots.every((dot) => dot.tagName === "SPAN" && dot.getAttribute("aria-hidden") === "true"), "page dots are visual and noninteractive");
  assert.equal(status.querySelector("button, a, [role=button], [tabindex]"), null, "the live page status has no interactive dots");
  assert.equal(status.querySelector(".sr-only")?.textContent, `Page ${page} of ${pageCount}`);
  assert.equal(node.querySelector(".dashboard-focus-range"), null, "page range text is no longer visible");
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
  act(() => window.dispatchEvent(new window.Event("resize")));
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
    "Help me plan my week",
    "What should I work on next",
    "Break down this assignment",
    "Make me a study schedule",
    "Help me prepare for an exam",
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
      await timers.advance(2249);
      assert.equal(input.placeholder, suggestions[index]);
      const next = suggestions[(index + 1) % suggestions.length];
      await timers.advance(1 + (suggestions[index].length * 35) + 350 + (next.length * 80));
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
    assert.equal(priorityPage(), 1);
    assertPageDots(1, 3);
    assert.equal(node.querySelector('[aria-label="Previous priorities"]').disabled, true);
    assert.equal(node.querySelector('[aria-label="Next priorities"]').disabled, false);

    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
    assert.equal(priorityPage(), 2);
    assertPageDots(2, 3);
    await click(node.querySelector(".dashboard-focus-item"));
    assert.deepEqual(selected, ["assignment-3"]);

    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.deepEqual(priorityNumbers(), ["05"]);
    assert.equal(node.querySelectorAll(".dashboard-focus-list > li").length, 1);
    assert.equal(node.querySelector(".dashboard-focus-list").getAttribute("start"), "5");
    assert.equal(priorityPage(), 3);
    assertPageDots(3, 3);
    assert.equal(node.querySelector('[aria-label="Next priorities"]').disabled, true);

    await click(node.querySelector('[aria-label="Previous priorities"]'));
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
    assertPageDots(2, 3);
    await click(node.querySelector('[aria-label="Previous priorities"]'));
    assert.equal(node.querySelector('[aria-label="Previous priorities"]').disabled, true);
    assert.equal(priorityPage(), 1);
    assertPageDots(1, 3);
  } finally { await unmount(); }
});

test("omits page dots when a single page already contains every priority", async () => {
  for (const count of [1, 2]) {
    try {
      await mount({ focusAssignments: assignments(count), reducedMotion: true });
      assert.equal(node.querySelectorAll(".dashboard-focus-list > li").length, count);
      assert.equal(node.querySelector(".dashboard-focus-page-dots"), null);
      assert.equal(node.querySelector(".dashboard-focus-pagination"), null);
    } finally { await unmount(); }
  }
});

test("resets paging when the ordered assignment IDs change, but preserves the page on an unchanged rerender", async () => {
  const focusAssignments = assignments(5);
  try {
    await mount({ focusAssignments, reducedMotion: true });
    await click(node.querySelector('[aria-label="Next priorities"]'));
    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.equal(priorityPage(), 3);
    assertPageDots(3, 3);

    await rerender({ focusAssignments: [...focusAssignments], reducedMotion: true });
    assert.equal(priorityPage(), 3);
    assertPageDots(3, 3);

    const reordered = [...focusAssignments].reverse();
    await rerender({ focusAssignments: reordered, reducedMotion: true });
    assert.deepEqual(priorityNumbers(), ["01", "02"]);
    assert.equal(node.querySelector(".dashboard-focus-list").textContent.includes("Assignment 5"), true);
    assert.equal(priorityPage(), 1);
    assertPageDots(1, 3);

    await click(node.querySelector('[aria-label="Next priorities"]'));
    assertPageDots(2, 3);
    await rerender({ focusAssignments: reordered.slice(0, 2), reducedMotion: true });
    assert.deepEqual(priorityNumbers(), ["01", "02"]);
    assert.equal(node.querySelector(".dashboard-focus-page-dots"), null);
    assert.equal(node.querySelector(".dashboard-focus-pagination"), null);
  } finally { await unmount(); }
});

test("StrictMode effect replay leaves the carousel ready for a swipe", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mountInStrictMode({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const swipe = await dispatchWheel(viewport, { deltaX: 80 });
    assert.equal(swipe.defaultPrevented, true);
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true);
    await timers.advanceFrame(70);
    assert.equal(priorityCommittedPage(), 2);
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("wheel input converts pixel, line, and page units, then returns subthreshold motion after idle", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 0.5 });
    await dispatchWheel(viewport, { deltaX: 1, deltaMode: 1 });
    await dispatchWheel(viewport, { deltaX: 0.05, deltaMode: 2 });
    await dispatchWheel(viewport, { deltaX: -0.04, deltaMode: 2 });
    assert.ok(Math.abs(priorityTrackOffset() + 19.7) < 0.001);
    assert.equal(priorityPage(), 1);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), false);

    await timers.advance(80);
    assert.equal(timers.pendingAnimationFrameCount, 1);
    assert.equal(priorityPage(), 1);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true);
    await timers.advanceFrame(70);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(priorityTransitioning(), false);

    await dispatchWheel(viewport, { deltaX: 40 });
    assert.equal(priorityTrackOffset(), -40);
    await timers.advance(80);
    assert.equal(priorityPage(), 1, "a below-threshold burst returns to its committed page");
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true);
    await timers.advanceFrame(70);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(priorityTransitioning(), false);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("wheel intent stays on its first axis through mixed packets", async () => {
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

    await timers.advance(80);
    assert.equal(timers.pendingAnimationFrameCount, 1);
    assert.equal(priorityTransitioning(), true);
    await timers.advanceFrame(70);
    assert.equal(priorityPage(), 1);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(priorityTransitioning(), false);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a vertical wheel start before a page-button click stays native and leaves the button available", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const verticalStart = await dispatchWheel(viewport, { deltaX: 2, deltaY: 30, momentum: false });
    assert.equal(verticalStart.defaultPrevented, false);
    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true);
    await timers.advanceFrame(70);
    assert.equal(priorityCommittedPage(), 2);
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("crossing the wheel distance threshold settles immediately with capped preview and pending dots", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(7) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const accepted = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(accepted.defaultPrevented, true);
    assert.equal(priorityTrackOffset(), -64, "the displayed preview is capped below the raw 80px intent");
    assert.equal(priorityPage(), 2, "the destination dot updates as soon as the intent is accepted");
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true);
    assert.deepEqual(priorityNumbers(), ["01", "02"], "the source page remains rendered during the slide");
    const nextPagePreview = node.querySelector(".dashboard-focus-list--neighbor");
    assert.ok(nextPagePreview, "the adjacent page is rendered for the slide");
    assert.equal(nextPagePreview.getAttribute("aria-hidden"), "true");
    assert.equal(nextPagePreview.hasAttribute("inert"), true, "offscreen assignment controls are unavailable during the slide");
    assertPageDots(2, 4);

    await timers.advanceFrame(17.5);
    assert.ok(Math.abs(priorityTrackOffset() - -105.25) < 0.001, "the first quarter follows eased motion");
    await timers.advanceFrame(17.5);
    assert.ok(Math.abs(priorityTrackOffset() - -196) < 0.001, "the midpoint lies halfway between preview and destination");
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 1);
    assert.deepEqual(priorityNumbers(), ["01", "02"]);

    await timers.advanceFrame(34);
    assert.equal(priorityTransitioning(), true, "the slide remains active until its full 70ms minimum duration");
    await timers.advanceFrame(1);
    assert.equal(priorityTransitioning(), false);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 2);
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
    assert.equal(node.querySelector(".dashboard-focus-list--neighbor"), null, "offscreen pages are removed after the slide");
    assertPageDots(2, 4);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a large wheel packet stays within the preview cap and input spam cannot alter the slide deadline", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  try {
    await mount({ focusAssignments: assignments(7) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 10000, momentum: false });
    assert.equal(priorityTrackOffset(), -64, "a huge packet cannot render a page-sized jump");
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true);
    assert.deepEqual(priorityNumbers(), ["01", "02"]);

    await timers.advanceFrame(50);
    const offsetBeforeSpam = priorityTrackOffset();
    for (const momentum of [undefined, false, true]) {
      await dispatchWheel(viewport, { deltaX: 100, momentum });
      await dispatchWheel(viewport, { deltaX: -50, momentum });
    }
    await dispatchPointer(viewport, "pointerdown", { pointerId: 41, x: 200, y: 100 });
    await dispatchPointer(viewport, "pointermove", { pointerId: 41, x: 20, y: 100 });
    await dispatchPointer(viewport, "pointerup", { pointerId: 41, x: 20, y: 100 });
    await dispatchPointer(viewport, "pointercancel", { pointerId: 41, x: 20, y: 100 });
    await click(node.querySelector('[aria-label="Previous priorities"]'));
    await click(node.querySelector('[aria-label="Next priorities"]'));

    assert.equal(priorityTrackOffset(), offsetBeforeSpam, "ignored sources do not retarget or restart the animation");
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true);
    assert.equal(timers.pendingAnimationFrameCount, 1);
    await timers.advanceFrame(19);
    assert.equal(priorityTransitioning(), true, "late input spam cannot defer the original 70ms deadline");
    await timers.advanceFrame(1);
    assert.equal(priorityTransitioning(), false);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(priorityCommittedPage(), 2);
    assert.deepEqual(priorityNumbers(), ["03", "04"]);

    await click(node.querySelector('[aria-label="Next priorities"]'));
    assert.equal(priorityPage(), 3, "a fresh button click works after its earlier click was ignored during settling");
    assert.equal(priorityCommittedPage(), 2);
    await timers.advanceFrame(70);
    assert.equal(priorityCommittedPage(), 3);
    assert.deepEqual(priorityNumbers(), ["05", "06"]);
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("wheel swipes can repeat forward and backward on each quiet arrival without jamming", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(7) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    let committedPage = 1;
    for (const [deltaX, destinationPage] of [[80, 2], [80, 3], [80, 4], [-80, 3], [-80, 2], [-80, 1]]) {
      const accepted = await dispatchWheel(viewport, { deltaX, momentum: false });
      assert.equal(accepted.defaultPrevented, true);
      assert.equal(priorityPage(), destinationPage, "the pending dot updates for each adjacent page");
      assert.equal(priorityCommittedPage(), committedPage);
      assertPageDots(destinationPage, 4);

      await timers.advanceFrame(70);
      assert.equal(priorityTransitioning(), false);
      assert.equal(priorityCommittedPage(), destinationPage);
      assert.equal(priorityPage(), destinationPage);
      assertPageDots(destinationPage, 4);
      committedPage = destinationPage;
    }

    assert.deepEqual(priorityNumbers(), ["01", "02"]);
    assert.equal(priorityTrackOffset(), 0);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a dense wheel burst stays blocked across arrival, then rearms after 70ms quiet", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(7) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(priorityTransitioning(), true);
    for (const [elapsed, committedPage] of [[30, 1], [30, 1], [30, 2], [30, 2]]) {
      await timers.advanceFrame(elapsed);
      const continuingPacket = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
      assert.equal(continuingPacket.defaultPrevented, true, "dense tail packets remain part of the accepted burst");
      assert.equal(priorityPage(), 2);
      assert.equal(priorityCommittedPage(), committedPage);
    }
    assert.equal(priorityCommittedPage(), 2);
    assert.equal(priorityTrackOffset(), 0);

    const yDominantSameBurstTail = await dispatchWheel(viewport, { deltaX: 0, deltaY: 40, momentum: false });
    assert.equal(yDominantSameBurstTail.defaultPrevented, true, "an accepted burst keeps its horizontal lock through arrival for y-dominant tail packets");
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 2);
    assert.equal(priorityTrackOffset(), 0, "the continuing physical burst remains quarantined after commit");

    await timers.advanceFrame(69);
    const beforeRearm = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(beforeRearm.defaultPrevented, true, "69ms of quiet does not rearm the still-active burst");
    assert.equal(priorityPage(), 2);
    assert.equal(priorityTrackOffset(), 0);

    await timers.advanceFrame(70);
    const nextPhysicalSwipe = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(nextPhysicalSwipe.defaultPrevented, true);
    assert.equal(priorityTrackOffset(), -64, "a fresh gesture starts after the 70ms quiet period");
    assert.equal(priorityPage(), 3);
    assert.equal(priorityCommittedPage(), 2);
    assertPageDots(3, 4);

    await timers.advanceFrame(70);
    assert.equal(priorityCommittedPage(), 3);
    const reverseSwipe = await dispatchWheel(viewport, { deltaX: -80, momentum: false });
    assert.equal(reverseSwipe.defaultPrevented, true, "reverse navigation remains available after rearming");
    assert.equal(priorityPage(), 2);
    assertPageDots(2, 4);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a reduced-motion accepted swipe rearms only after 70ms quiet", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(7), reducedMotion: true });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const accepted = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(accepted.defaultPrevented, true);
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 2);
    assert.equal(priorityTransitioning(), false);

    await timers.advance(39);
    const sameBurstTail = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(sameBurstTail.defaultPrevented, true);
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 2);

    await timers.advance(69);
    const beforeQuietBoundary = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(beforeQuietBoundary.defaultPrevented, true);
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 2);

    await timers.advance(70);
    const freshSwipe = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(freshSwipe.defaultPrevented, true);
    assert.equal(priorityPage(), 3);
    assert.equal(priorityCommittedPage(), 3);
    assertPageDots(3, 4);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a second wheel burst that starts during a 70ms slide stays quarantined through 70ms quiet", async (t) => {
  for (const momentum of [undefined, false]) {
    await t.test(`momentum=${momentum}`, async () => {
      const timers = installFakeWindowTimers();
      try {
        await mount({ focusAssignments: assignments(7) });
        const viewport = node.querySelector(".dashboard-focus-viewport");
        setViewportSize(viewport);

        await dispatchWheel(viewport, { deltaX: 80, momentum: false });
        await timers.advanceFrame(55);
        assert.equal(priorityTransitioning(), true, "the first slide is still active when the second burst begins");
        assert.equal(priorityPage(), 2);
        assert.equal(priorityCommittedPage(), 1);

        const secondBurstStart = await dispatchWheel(viewport, { deltaX: 80, momentum });
        assert.equal(secondBurstStart.defaultPrevented, true);
        assert.equal(priorityPage(), 2);
        assert.equal(priorityCommittedPage(), 1);
        await timers.advanceFrame(15);
        assert.equal(priorityTransitioning(), false);
        assert.equal(priorityPage(), 2);
        assert.equal(priorityCommittedPage(), 2);
        assert.equal(priorityTrackOffset(), 0);

        // Tails arrive at 105, 155, and 224ms: 50ms, 50ms, then 69ms apart.
        // Each remains part of the ignored burst that began at 55ms.
        for (const [gap, label] of [[35, "tail across arrival after a 50ms total gap"], [50, "next tail after 50ms"], [69, "tail after 69ms"]]) {
          await timers.advanceFrame(gap);
          const tail = await dispatchWheel(viewport, { deltaX: 80, momentum });
          assert.equal(tail.defaultPrevented, true, `${label} remains part of the second physical burst`);
          assert.equal(priorityPage(), 2, `${label} does not change the pending page dot`);
          assert.equal(priorityCommittedPage(), 2, `${label} does not change the committed page`);
          assert.equal(priorityTransitioning(), false, `${label} does not start another slide`);
          assert.equal(priorityTrackOffset(), 0, `${label} does not move the track`);
          assertPageDots(2, 4);
        }

        await timers.advance(70);
        const freshSwipe = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
        assert.equal(freshSwipe.defaultPrevented, true, "a new burst is accepted after 70ms without packets");
        assert.equal(priorityPage(), 3);
        assert.equal(priorityCommittedPage(), 2);
        assertPageDots(3, 4);
        await timers.advanceFrame(70);
        assert.equal(priorityTransitioning(), false);
        assert.equal(priorityPage(), 3);
        assert.equal(priorityCommittedPage(), 3);
        assert.deepEqual(priorityNumbers(), ["05", "06"]);
        assertPageDots(3, 4);
      } finally {
        await unmount();
        timers.restore();
      }
    });
  }
});

test("momentum=true during a slide ends the accepted burst and permits a fresh swipe on arrival", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(7) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    const release = await dispatchWheel(viewport, { deltaX: 1000, momentum: true });
    assert.equal(release.defaultPrevented, true);
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTrackOffset(), -64);

    await timers.advanceFrame(70);
    assert.equal(priorityCommittedPage(), 2);
    const nextSwipe = await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(nextSwipe.defaultPrevented, true);
    assert.equal(priorityTrackOffset(), -64);
    assert.equal(priorityPage(), 3);
    assert.equal(priorityCommittedPage(), 2);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("after a momentum end marker, a fresh vertical-first burst stays native during and across the slide", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(7) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    const endMarker = await dispatchWheel(viewport, { deltaX: 1, momentum: true });
    assert.equal(endMarker.defaultPrevented, true);
    assert.equal(priorityTransitioning(), true);

    const verticalStart = await dispatchWheel(viewport, { deltaX: 2, deltaY: 30, momentum: false });
    const horizontalDominantTail = await dispatchWheel(viewport, { deltaX: 80, deltaY: 30, momentum: false });
    assert.equal(verticalStart.defaultPrevented, false, "a fresh vertical gesture after the explicit end marker remains native");
    assert.equal(horizontalDominantTail.defaultPrevented, false, "a vertical-first burst cannot become horizontal during the slide");

    await timers.advanceFrame(30);
    const verticalKeepalive = await dispatchWheel(viewport, { deltaX: 2, deltaY: 30, momentum: false });
    assert.equal(verticalKeepalive.defaultPrevented, false);
    await timers.advanceFrame(20);
    await dispatchWheel(viewport, { deltaX: 2, deltaY: 30, momentum: false });
    await timers.advanceFrame(19);
    const nearArrivalMixed = await dispatchWheel(viewport, { deltaX: 80, deltaY: 30, momentum: false });
    assert.equal(nearArrivalMixed.defaultPrevented, false, "the vertical axis remains native near arrival");
    await timers.advanceFrame(1);
    assert.equal(priorityTransitioning(), false);

    const acrossArrivalMixed = await dispatchWheel(viewport, { deltaX: 80, deltaY: 30, momentum: false });
    assert.equal(acrossArrivalMixed.defaultPrevented, false, "the active vertical burst remains native just after arrival");
    assert.equal(priorityCommittedPage(), 2);
    assert.equal(priorityPage(), 2);
    assert.deepEqual(priorityNumbers(), ["03", "04"]);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a true end marker on a subthreshold burst does not relatch a fresh vertical gesture during return", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchWheel(viewport, { deltaX: 20, momentum: false });
    assert.equal(priorityTrackOffset(), -20);
    const endMarker = await dispatchWheel(viewport, { deltaX: 1, momentum: true });
    assert.equal(endMarker.defaultPrevented, true);
    assert.equal(priorityTransitioning(), true);
    assert.equal(priorityPage(), 1);
    assert.equal(priorityCommittedPage(), 1);

    const freshVertical = await dispatchWheel(viewport, { deltaX: 2, deltaY: 30, momentum: false });
    const mixedHorizontal = await dispatchWheel(viewport, { deltaX: 80, deltaY: 30, momentum: false });
    assert.equal(freshVertical.defaultPrevented, false, "the ended subthreshold horizontal gesture does not own the new vertical gesture");
    assert.equal(mixedHorizontal.defaultPrevented, false, "horizontal movement cannot relatch the vertical-first gesture during return");
    await timers.advanceFrame(70);
    assert.equal(priorityTransitioning(), false);
    assert.equal(priorityTrackOffset(), 0);
    assert.equal(priorityCommittedPage(), 1);
  } finally {
    await unmount();
    timers.restore();
  }
});

test("a fast pointer drag previews at the cap but chooses its page from raw intent", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  const selected = [];
  try {
    await mount({ focusAssignments: assignments(5), onSelectAssignment: (assignment) => selected.push(assignment.id) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    await dispatchPointer(viewport, "pointerdown", { x: 300, y: 100 });
    await dispatchPointer(viewport, "pointermove", { x: -700, y: 100 });
    assert.equal(priorityTrackOffset(), -64, "a page-sized fast drag still has a small preview");
    assert.equal(priorityPage(), 1);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), false);

    await dispatchPointer(viewport, "pointerup", { x: -700, y: 100 });
    assert.equal(priorityPage(), 2, "release selects from the clamped raw gesture intent");
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), true, "pointer speed cannot bypass the settling animation");
    assert.equal(priorityTrackOffset(), -64);
    assert.deepEqual(priorityNumbers(), ["01", "02"]);
    await timers.advanceFrame(69);
    assert.equal(priorityTransitioning(), true);
    await timers.advanceFrame(1);
    assert.equal(priorityTransitioning(), false);
    assert.equal(priorityCommittedPage(), 2);
    assert.deepEqual(priorityNumbers(), ["03", "04"]);

    const item = node.querySelector(".dashboard-focus-item");
    await dispatchPointer(item, "pointerdown", { x: 100, y: 100 });
    await dispatchPointer(item, "pointerup", { x: 102, y: 101 });
    const tap = await dispatchClick(item, 1);
    assert.equal(tap.defaultPrevented, false);
    assert.deepEqual(selected, ["assignment-3"], "intentional taps still select the assignment after swiping");
    const keyboardClick = await dispatchClick(item, 0);
    assert.equal(keyboardClick.defaultPrevented, false);
    assert.deepEqual(selected, ["assignment-3", "assignment-3"]);
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("vertical-first wheel input remains native and vertical pointer movement cannot become a swipe", async () => {
  const timers = installFakeWindowTimers();
  const restorePointerCapture = installFakePointerCapture();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);

    const verticalWheel = await dispatchWheel(viewport, { deltaX: 2, deltaY: 30 });
    const horizontalTail = await dispatchWheel(viewport, { deltaX: 80, deltaY: 0 });
    assert.equal(verticalWheel.defaultPrevented, false);
    assert.equal(horizontalTail.defaultPrevented, false);
    assert.equal(priorityTrackOffset(), 0);

    const item = node.querySelector(".dashboard-focus-item");
    await dispatchPointer(item, "pointerdown", { x: 200, y: 100 });
    const verticalMove = await dispatchPointer(item, "pointermove", { x: 197, y: 130 });
    const horizontalAfterVertical = await dispatchPointer(item, "pointermove", { x: 100, y: 131 });
    assert.equal(verticalMove.defaultPrevented, false);
    assert.equal(horizontalAfterVertical.defaultPrevented, false);
    assert.equal(priorityTrackOffset(), 0);
    await dispatchPointer(item, "pointerup", { x: 100, y: 131 });
    assert.equal(priorityPage(), 1);
    assert.equal(priorityCommittedPage(), 1);
    assert.equal(priorityTransitioning(), false);

    await timers.advance(80);
    assert.equal(priorityTrackOffset(), 0);
  } finally {
    await unmount();
    timers.restore();
    restorePointerCapture();
  }
});

test("pointercancel, resize, blur, reduced motion, and assignment changes restore the committed page", async (t) => {
  const cases = ["pointercancel", "resize", "blur", "reduced motion", "assignment changes"];
  for (const cancelWith of cases) {
    await t.test(cancelWith, async () => {
      const timers = installFakeWindowTimers();
      const restorePointerCapture = installFakePointerCapture();
      const originalAssignments = assignments(5);
      try {
        await mount({ focusAssignments: originalAssignments });
        const viewport = node.querySelector(".dashboard-focus-viewport");
        setViewportSize(viewport);

        if (cancelWith === "pointercancel") {
          await dispatchPointer(viewport, "pointerdown", { x: 200, y: 100 });
          await dispatchPointer(viewport, "pointermove", { x: 120, y: 100 });
          assert.equal(priorityTrackOffset(), -64);
          await dispatchPointer(viewport, "pointercancel", { x: 120, y: 100 });
        } else {
          await dispatchWheel(viewport, { deltaX: 80, momentum: false });
          assert.equal(priorityPage(), 2);
          assert.equal(priorityCommittedPage(), 1);
          assert.equal(priorityTransitioning(), true);

          if (cancelWith === "resize") {
            Object.defineProperty(viewport.querySelector(".dashboard-focus-track"), "clientWidth", { configurable: true, value: 400 });
            await act(async () => window.dispatchEvent(new window.Event("resize")));
          } else if (cancelWith === "blur") {
            await act(async () => window.dispatchEvent(new window.Event("blur")));
          } else if (cancelWith === "reduced motion") {
            await rerender({ focusAssignments: originalAssignments, reducedMotion: true });
          } else {
            await rerender({ focusAssignments: [...originalAssignments].reverse() });
          }
        }

        assert.equal(priorityTrackOffset(), 0);
        assert.equal(priorityPage(), 1);
        assert.equal(priorityCommittedPage(), 1);
        assert.equal(priorityTransitioning(), false);
        assert.deepEqual(priorityNumbers(), ["01", "02"]);
        assert.equal(timers.pendingAnimationFrameCount, 0);
      } finally {
        await unmount();
        timers.restore();
        restorePointerCapture();
      }
    });
  }
});

test("unmount cancels an accepted slide and every timer", async () => {
  const timers = installFakeWindowTimers();
  try {
    await mount({ focusAssignments: assignments(5) });
    const viewport = node.querySelector(".dashboard-focus-viewport");
    setViewportSize(viewport);
    await dispatchWheel(viewport, { deltaX: 80, momentum: false });
    assert.equal(priorityTransitioning(), true);
    assert.equal(priorityPage(), 2);
    assert.equal(priorityCommittedPage(), 1);

    await unmount();
    assert.equal(node.querySelector("[data-priority-carousel]"), null);
    assert.equal(timers.pendingAnimationFrameCount, 0);
    assert.equal(timers.pendingTimeoutCount, 0);
  } finally {
    await unmount();
    timers.restore();
  }
});
