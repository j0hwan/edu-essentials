import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { PriorityCarouselController } = await import(
  await clientModule("lib/priority-carousel-controller.ts")
);

function createClock() {
  let currentTime = 0;
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();

  return {
    now: () => currentTime,
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { callback, at: currentTime + Math.max(0, delayMs) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    get pendingFrameCount() {
      return frames.size;
    },
    get pendingTimerCount() {
      return timers.size;
    },
    nextFrameCallback() {
      return frames.values().next().value;
    },
    frame(elapsedMs = 16) {
      currentTime += elapsedMs;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(currentTime);
    },
    advance(elapsedMs) {
      const target = currentTime + elapsedMs;
      let callbackCount = 0;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        if (++callbackCount > 1000) throw new Error("Fake timer callback limit exceeded");
        const [id, timer] = next;
        timers.delete(id);
        currentTime = timer.at;
        timer.callback();
      }
      currentTime = target;
    },
  };
}

function createHarness({ pageCount = 5, width = 320, reducedMotion = false } = {}) {
  const clock = createClock();
  const events = [];
  const controller = new PriorityCarouselController({
    pageCount,
    width,
    reducedMotion,
    now: clock.now,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onSnapshot(snapshot, atomicCommit) {
      events.push({ type: "snapshot", at: clock.now(), snapshot, atomicCommit });
    },
    onOffset(offset) {
      events.push({ type: "offset", at: clock.now(), offset });
    },
  });
  return { controller, clock, events };
}

function sendWheel(controller, deltaX, deltaY = 0, options = {}) {
  const input = { deltaX, deltaY, cancelable: options.cancelable ?? true };
  if (Object.hasOwn(options, "momentum")) input.momentum = options.momentum;
  return controller.wheel(input);
}

function assertWheel(controller, deltaX, deltaY, expectedPreventDefault, options = {}) {
  const result = sendWheel(controller, deltaX, deltaY, options);
  assert.equal(result.preventDefault, expectedPreventDefault);
  return result;
}

function assertSettling(controller, targetPage) {
  assert.deepEqual(controller.getSnapshot(), {
    page: targetPage - 1,
    selectedPage: targetPage,
    phase: { type: "settling", targetPage },
    motionVisible: true,
  });
}

test("equal horizontal swipes can repeat at the 70ms atomic arrival boundary", () => {
  const { controller, clock, events } = createHarness({ pageCount: 4 });

  assertWheel(controller, 160, 0, true);
  assertSettling(controller, 1);
  clock.frame(70);

  assert.deepEqual(controller.getSnapshot(), {
    page: 1,
    selectedPage: 1,
    phase: { type: "idle" },
    motionVisible: false,
  });
  assert.equal(events.filter((event) => event.type === "snapshot" && event.atomicCommit).length, 1);
  assert.deepEqual(events.slice(-2).map((event) => event.type), ["offset", "snapshot"]);
  assert.equal(events.at(-1).atomicCommit, true, "the settled page is published after the track returns to origin");

  assertWheel(controller, 160, 0, true);
  assertSettling(controller, 2);
});

test("arrow navigation settles over 320ms in either direction", () => {
  const { controller, clock } = createHarness({ pageCount: 4, width: 320 });

  assert.equal(controller.navigate(1).accepted, true);
  assertSettling(controller, 1);
  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 0, "the 70ms gesture duration does not finish arrow navigation");
  assert.equal(controller.getSnapshot().selectedPage, 1);
  assert.equal(controller.getSnapshot().phase.type, "settling");
  clock.frame(250);
  assert.equal(controller.getSnapshot().page, 1);
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });

  assert.equal(controller.navigate(-1).accepted, true);
  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().selectedPage, 0);
  clock.frame(250);
  assert.equal(controller.getSnapshot().page, 0);
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });
});

test("a decaying consumed tail survives the quiet boundary without starting another page", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  sendWheel(controller, 80);
  clock.advance(10);
  sendWheel(controller, 35);
  clock.advance(10);
  sendWheel(controller, 16);
  clock.advance(15);
  sendWheel(controller, 8);
  clock.frame(35);
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().phase.type, "idle");

  clock.advance(35);
  assert.equal(clock.pendingFrameCount, 0);
  assert.equal(controller.getSnapshot().page, 1, "quiet expiry does not convert a consumed burst into navigation");
  clock.advance(230);
  assert.equal(controller.getSnapshot().page, 1, "the bounded tail guard does not advance a page by itself");

  assertWheel(controller, 80, 0, true);
  assertSettling(controller, 2);
});

test("a lower same-direction packet after an 80ms gap is still part of a short momentum tail", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  sendWheel(controller, 160);
  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 1);
  clock.advance(10);

  assertWheel(controller, 90, 0, true);
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().selectedPage, 1);
  assert.equal(controller.getSnapshot().phase.type, "idle");
});

test("confirmed decay survives a low-jitter plateau before a renewed wheel impulse", () => {
  const { controller, clock, events } = createHarness({ pageCount: 4 });

  sendWheel(controller, 160);
  clock.frame(70);
  clock.advance(0);
  assert.equal(controller.getSnapshot().page, 1, "the first swipe has arrived before its gradual tail");

  const tailAndJitter = [
    { delta: 90, gap: 8 },
    { delta: 60, gap: 12 },
    { delta: 35, gap: 8 },
    { delta: 18, gap: 12 },
    { delta: 2, gap: 8 },
    { delta: 9, gap: 12 },
    { delta: 8, gap: 8 },
    { delta: 9, gap: 10 },
    { delta: 10, gap: 12 },
  ];
  for (const { delta, gap } of tailAndJitter) {
    clock.advance(gap);
    assertWheel(controller, delta, 0, true);
    assert.equal(controller.getSnapshot().page, 1);
    assert.equal(controller.getSnapshot().selectedPage, 1);
    assert.deepEqual(
      controller.getSnapshot().phase,
      { type: "idle" },
      `the ${delta}px decay or low-jitter packet must remain in the consumed tail`,
    );
  }
  assert.equal(events.filter((event) => event.type === "snapshot" && event.atomicCommit).length, 1);

  clock.advance(16);
  assertWheel(controller, 20, 0, true);
  assert.deepEqual(controller.getSnapshot().phase, { type: "dragging", source: "wheel" });
  assert.equal(controller.getSnapshot().selectedPage, 1, "the renewed impulse starts a fresh session without selecting early");
  clock.advance(12);
  assertWheel(controller, 37, 0, true);
  assert.deepEqual(controller.getSnapshot().phase, { type: "dragging", source: "wheel" });
  clock.advance(14);
  assertWheel(controller, 48, 0, true);
  assertSettling(controller, 2);

  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 2, "the renewed 20+37+48px gesture advances to the third page");
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });
  assert.equal(events.filter((event) => event.type === "snapshot" && event.atomicCommit).length, 2);
});

test("two declining samples let a renewed impulse begin a new session after arrival", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  sendWheel(controller, 80);
  clock.advance(10);
  sendWheel(controller, 35);
  clock.advance(10);
  sendWheel(controller, 16);
  clock.frame(50);
  assert.equal(controller.getSnapshot().page, 1);

  clock.advance(10);
  assertWheel(controller, 80, 0, true);
  assertSettling(controller, 2);
});

test("a renewed impulse that begins during settling stays rejected through arrival and 70ms quiet", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  sendWheel(controller, 80);
  clock.advance(10);
  sendWheel(controller, 35);
  clock.advance(10);
  sendWheel(controller, 16);
  clock.advance(10);
  assertWheel(controller, 40, 0, true);
  assertSettling(controller, 1);

  clock.frame(40);
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().phase.type, "idle");
  clock.advance(29);
  assertWheel(controller, 80, 0, true);
  assert.equal(controller.getSnapshot().selectedPage, 1, "a rejected session cannot rearm from a fresh-looking impulse");
  assert.equal(controller.getSnapshot().page, 1);

  clock.advance(69);
  assertWheel(controller, 80, 0, true);
  assert.equal(controller.getSnapshot().selectedPage, 1, "69ms since the last rejected packet is still inside its quiet boundary");
  clock.advance(70);
  assertWheel(controller, 80, 0, true);
  assertSettling(controller, 2);
});

test("a deliberate direction reversal after decaying input can start the opposite page gesture", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  sendWheel(controller, 80);
  clock.advance(10);
  sendWheel(controller, 35);
  clock.advance(10);
  sendWheel(controller, 16);
  clock.frame(50);
  assert.equal(controller.getSnapshot().page, 1);

  clock.advance(10);
  assertWheel(controller, -16, 0, true);
  assert.deepEqual(controller.getSnapshot().phase, { type: "dragging", source: "wheel" });
  assert.equal(controller.getSnapshot().selectedPage, 1, "the reversal starts a session without projecting a page change");
  assertWheel(controller, -60, 0, true);
  assert.deepEqual(controller.getSnapshot().phase, { type: "settling", targetPage: 0 });
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().selectedPage, 0);
});

test("vertical-first wheel input stays native across a page arrival", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  assert.equal(controller.navigate(1).accepted, true);
  clock.advance(250);
  assertWheel(controller, 2, 30, false);
  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 1);
  clock.advance(1);
  assertWheel(controller, 80, 30, false);
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().selectedPage, 1);
  assert.equal(controller.getSnapshot().phase.type, "idle");
  clock.advance(79);
  assertWheel(controller, 80, 30, false);
  assert.equal(controller.getSnapshot().selectedPage, 1, "a vertical-first session stays native for 79ms after its latest packet");
  clock.advance(80);
  assertWheel(controller, 80, 30, true);
  assert.equal(controller.getSnapshot().selectedPage, 2, "a new horizontal session is available after the 80ms vertical lock");
});

test("a native momentum marker ends the wheel session without contributing its delta", () => {
  const { controller } = createHarness({ pageCount: 4 });

  assertWheel(controller, 120, 0, true, { momentum: true });
  assert.equal(controller.getSnapshot().page, 0);
  assert.equal(controller.getSnapshot().selectedPage, 0);
  assert.equal(controller.getSnapshot().phase.type, "idle");

  sendWheel(controller, 80);
  const beforeMarker = controller.getSnapshot();
  assertWheel(controller, 1000, 0, true, { momentum: true });
  assert.deepEqual(controller.getSnapshot(), beforeMarker, "the end marker cannot add displacement or retarget the active slide");
});

test("wheel spam cannot move the target or extend the 70ms settling deadline", () => {
  const { controller, clock, events } = createHarness({ pageCount: 4 });

  sendWheel(controller, 80);
  clock.frame(20);
  assertWheel(controller, 20, 0, true);
  clock.frame(20);
  assertWheel(controller, 12, 0, true);
  assertSettling(controller, 1);
  clock.frame(30);

  assert.equal(clock.now(), 70);
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().phase.type, "idle");
  const commit = events.find((event) => event.type === "snapshot" && event.atomicCommit);
  assert.equal(commit?.at, 70, "extra wheel packets do not restart or extend the original transition");
});

test("horizontal pointer drags capture once, and cancellation releases the gesture at the committed page", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  assert.equal(controller.pointerDown({ pointerId: 9, x: 200, y: 100, pointerType: "touch" }).capturePointer, false);
  const firstMove = controller.pointerMove({ pointerId: 9, x: 190, y: 100 });
  assert.equal(firstMove.capturePointer, true);
  assert.equal(firstMove.preventDefault, true);
  assert.deepEqual(controller.getSnapshot().phase, { type: "dragging", source: "pointer" });

  const continuedMove = controller.pointerMove({ pointerId: 9, x: 150, y: 100 });
  assert.equal(continuedMove.capturePointer, false, "capture is requested only on the first horizontal move");
  assert.equal(continuedMove.preventDefault, true);
  assert.equal(controller.pointerCancel(9).releasePointerId, 9);
  assert.equal(controller.getSnapshot().page, 0);
  assert.equal(controller.getSnapshot().selectedPage, 0);
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });
  assert.equal(clock.pendingFrameCount, 0);
});

test("a fresh primary down replaces an uncaptured pointer whose up was missed", () => {
  const { controller } = createHarness({ pageCount: 4 });

  controller.pointerDown({ pointerId: 1, x: 200, y: 100, pointerType: "touch" });
  controller.pointerMove({ pointerId: 1, x: 200, y: 120 });
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" }, "the first pointer remains native vertical input");

  controller.pointerDown({ pointerId: 2, x: 200, y: 100, pointerType: "touch" });
  const newGesture = controller.pointerMove({ pointerId: 2, x: 190, y: 100 });
  assert.equal(newGesture.capturePointer, true, "a later pointer can take ownership after an uncaptured gesture was missed");
  assert.equal(newGesture.preventDefault, true);
  assert.deepEqual(controller.getSnapshot().phase, { type: "dragging", source: "pointer" });
  assert.equal(controller.pointerCancel(2).releasePointerId, 2);
});

test("wheel takeover and page navigation quarantine held pointers until their release", () => {
  const wheelHarness = createHarness({ pageCount: 4 });
  const { controller, clock } = wheelHarness;
  controller.pointerDown({ pointerId: 11, x: 200, y: 100, pointerType: "touch" });
  assert.equal(controller.pointerMove({ pointerId: 11, x: 190, y: 100 }).capturePointer, true);
  const takeover = sendWheel(controller, 80);
  assert.equal(takeover.preventDefault, true);
  assert.ok(takeover.releasePointerIds.includes(11));
  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.pointerMove({ pointerId: 11, x: 100, y: 100 }).preventDefault, false);
  assert.equal(controller.getSnapshot().selectedPage, 1);
  assert.equal(controller.pointerUp({ pointerId: 11, x: 100 }).quarantined, true);

  const navigationHarness = createHarness({ pageCount: 4 });
  navigationHarness.controller.pointerDown({ pointerId: 12, x: 200, y: 100, pointerType: "touch" });
  const navigation = navigationHarness.controller.navigate(1);
  assert.equal(navigation.accepted, true);
  assert.ok(navigation.releasePointerIds.includes(12));
  navigationHarness.clock.frame(320);
  assert.equal(navigationHarness.controller.getSnapshot().page, 1);
  assert.equal(navigationHarness.controller.pointerMove({ pointerId: 12, x: 100, y: 100 }).preventDefault, false);
  assert.equal(navigationHarness.controller.getSnapshot().selectedPage, 1);
  assert.equal(navigationHarness.controller.pointerUp({ pointerId: 12 }).quarantined, true);
});

test("lost capture preserves takeover quarantine, then the same pointer id can start a fresh swipe after arrival", () => {
  const { controller, clock } = createHarness({ pageCount: 4 });

  controller.pointerDown({ pointerId: 21, x: 200, y: 100, pointerType: "touch" });
  assert.equal(controller.pointerMove({ pointerId: 21, x: 190, y: 100 }).capturePointer, true);
  const takeover = sendWheel(controller, 80);
  assert.equal(takeover.preventDefault, true);
  assert.ok(takeover.releasePointerIds.includes(21));
  assert.equal(controller.lostPointerCapture(21).quarantined, true);

  // The old physical pointerup occurs outside the viewport and is not observed.
  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 1);
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });

  const freshDown = controller.pointerDown({ pointerId: 21, x: 200, y: 100, pointerType: "touch" });
  assert.equal(freshDown.quarantined, false, "a fresh primary down clears quarantine left by the lost capture");
  assert.equal(controller.pointerMove({ pointerId: 21, x: 100, y: 100 }).capturePointer, true);
  const freshUp = controller.pointerUp({ pointerId: 21, x: 100 });
  assert.equal(freshUp.suppressClick, true);
  assert.equal(freshUp.releasePointerId, 21);
  assert.deepEqual(controller.getSnapshot().phase, { type: "settling", targetPage: 2 });
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().selectedPage, 2);

  clock.frame(70);
  assert.equal(controller.getSnapshot().page, 2, "the fresh gesture advances instead of remaining quarantined");
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });
});

test("cancel, reduced motion, and destroy make stale frame callbacks harmless", () => {
  const { controller, clock, events } = createHarness({ pageCount: 4 });

  controller.navigate(1);
  const canceledFrame = clock.nextFrameCallback();
  controller.cancel();
  canceledFrame(70);
  assert.equal(controller.getSnapshot().page, 0);
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });
  assert.equal(events.filter((event) => event.type === "snapshot" && event.atomicCommit).length, 0);

  controller.navigate(1);
  const reducedMotionFrame = clock.nextFrameCallback();
  controller.setReducedMotion(true);
  reducedMotionFrame(140);
  assert.equal(controller.getSnapshot().page, 0, "changing the preference cancels the in-flight destination");
  assert.equal(controller.navigate(1).accepted, true);
  assert.equal(controller.getSnapshot().page, 1, "subsequent navigation commits immediately with reduced motion");
  assert.deepEqual(controller.getSnapshot().phase, { type: "idle" });
  assert.equal(events.filter((event) => event.type === "snapshot" && event.atomicCommit).length, 1);

  const destroyedHarness = createHarness({ pageCount: 4 });
  destroyedHarness.controller.navigate(1);
  const destroyedFrame = destroyedHarness.clock.nextFrameCallback();
  const beforeDestroyCommitCount = destroyedHarness.events.filter(
    (event) => event.type === "snapshot" && event.atomicCommit,
  ).length;
  destroyedHarness.controller.destroy();
  destroyedFrame(70);
  assert.equal(destroyedHarness.events.filter(
    (event) => event.type === "snapshot" && event.atomicCommit,
  ).length, beforeDestroyCommitCount);
});
