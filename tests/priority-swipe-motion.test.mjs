import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { advancePriorityOffset, inverseRubberBandOffset, rubberBandOffset, selectPriorityTarget, samplePrioritySpring } = await import(
  await clientModule("lib/priority-swipe-motion.ts")
);

test("rubber banding preserves direction and progressively compresses increasing overflow", () => {
  assert.equal(rubberBandOffset(0, 100), 0);

  const firstOverflow = rubberBandOffset(30, 100);
  const fartherOverflow = rubberBandOffset(80, 100);
  assert.ok(firstOverflow > 0 && firstOverflow < 30);
  assert.ok(fartherOverflow > firstOverflow && fartherOverflow < 80);
  assert.ok(fartherOverflow < 100);
  assert.ok(rubberBandOffset(-80, 100) < -firstOverflow);
  assert.ok(rubberBandOffset(-80, 100) > -80);
});

test("edge regrab recovers the raw pull from its compressed display offset", () => {
  for (const rawDistance of [8, 30, 80]) {
    const displayedDistance = rubberBandOffset(rawDistance, 100);
    assert.ok(Math.abs(inverseRubberBandOffset(displayedDistance, 100) - rawDistance) < 1e-8);
  }
});

test("offset advancement caps edge resistance and reverses without hidden overflow debt", () => {
  const pageBounds = { min: -408, max: 408 };
  assert.equal(advancePriorityOffset(0, -1000, pageBounds), -408);
  assert.equal(advancePriorityOffset(-408, -500, pageBounds), -408);

  const firstPageBounds = { min: -408, max: 0, resistMax: true, resistanceLimit: 24 };
  const pulled = advancePriorityOffset(0, 1000, firstPageBounds);
  assert.ok(pulled > 0 && pulled <= 24, `edge pull stays within 24px (got ${pulled})`);

  const reversed = advancePriorityOffset(pulled, -1, firstPageBounds);
  assert.equal(reversed, pulled - 1, "a small reverse delta immediately unwinds the displayed edge pull");
  assert.ok(reversed < pulled);
});

test("release selection commits long drags and short flicks, cancels small motion, and respects ends", () => {
  const options = { width: 400, canPrevious: true, canNext: true };
  assert.equal(selectPriorityTarget({ ...options, offset: -130, velocity: 0.02 }), 1);
  assert.equal(selectPriorityTarget({ ...options, offset: 130, velocity: -0.02 }), -1);
  assert.equal(selectPriorityTarget({ ...options, offset: -24, velocity: -0.9 }), 1);
  assert.equal(selectPriorityTarget({ ...options, offset: -16, velocity: -0.9 }), 0);
  assert.equal(selectPriorityTarget({ ...options, offset: -1, velocity: -0.9 }), 0);
  assert.equal(selectPriorityTarget({ ...options, offset: -16, velocity: 0.02 }), 0);
  assert.equal(selectPriorityTarget({ ...options, offset: 16, velocity: -0.02 }), 0);

  assert.equal(selectPriorityTarget({ ...options, canPrevious: false, offset: 130, velocity: 0.9 }), 0);
  assert.equal(selectPriorityTarget({ ...options, canNext: false, offset: -130, velocity: -0.9 }), 0);
});

test("a recent deliberate reversal cancels a page-threshold drag even when it is slow", () => {
  const options = { width: 320, canPrevious: true, canNext: true };
  assert.equal(selectPriorityTarget({ ...options, offset: -120, velocity: 0.2 }), 0);
  assert.equal(selectPriorityTarget({ ...options, offset: -120, velocity: -0.1 }), 1);
});

test("a spring carries motion toward its target and settles without drifting", () => {
  const start = { position: 0, velocity: 0 };
  const sampleAt16ms = samplePrioritySpring({ ...start, target: 1, elapsedMs: 16 });
  assert.ok(sampleAt16ms.position > 0);

  let sample;
  for (let elapsedMs = 16; elapsedMs <= 1500; elapsedMs += 16) {
    sample = samplePrioritySpring({ ...start, target: 1, elapsedMs });
    if (sample.done) break;
  }

  assert.equal(sample.done, true);
  assert.ok(Math.abs(sample.position - 1) < 0.01);
  assert.ok(Math.abs(sample.velocity) < 0.01);
});

test("a critically damped edge return settles under 300ms without crossing its target", () => {
  let previousPosition = 24;
  let sample;
  let elapsedMs = 0;

  for (elapsedMs = 16; elapsedMs <= 300; elapsedMs += 16) {
    sample = samplePrioritySpring({
      position: 24,
      velocity: 0,
      target: 0,
      elapsedMs,
      stiffness: 900,
      damping: 60,
    });
    assert.ok(sample.position >= 0, `edge return never passes its target (${sample.position}px)`);
    assert.ok(sample.position <= previousPosition, `edge return moves inward (${sample.position}px)`);
    previousPosition = sample.position;
    if (sample.done) break;
  }

  assert.equal(sample?.done, true);
  assert.ok(elapsedMs < 300, `edge return finishes before 300ms (finished at ${elapsedMs}ms)`);
});
