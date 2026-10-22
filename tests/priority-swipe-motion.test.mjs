import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const {
  PRIORITY_MAX_SLIDE_SPEED_PX_PER_MS,
  PRIORITY_SLIDE_DURATION_MS,
  advancePriorityOffset,
  getPriorityPreviewOffset,
  getPrioritySlideDuration,
  samplePrioritySlide,
  selectPriorityTarget,
} = await import(await clientModule("lib/priority-swipe-motion.ts"));

test("priority slide has a 70ms base duration and a 12px/ms speed cap", () => {
  assert.equal(PRIORITY_SLIDE_DURATION_MS, 70);
  assert.equal(PRIORITY_MAX_SLIDE_SPEED_PX_PER_MS, 12);
  assert.equal(getPrioritySlideDuration(-120, -328), 70);
  assert.equal(getPrioritySlideDuration(0, -1000), 125);
});

test("gesture preview is capped independently from raw intent used for page selection", () => {
  assert.equal(getPriorityPreviewOffset(-10000, 328), -64);
  assert.equal(getPriorityPreviewOffset(10000, 328), 64);
  assert.equal(getPriorityPreviewOffset(-10000, 80), -20);
  assert.equal(getPriorityPreviewOffset(10000, 80), 20);
  assert.equal(getPriorityPreviewOffset(-12.5, 328), -12.5);
  assert.equal(getPriorityPreviewOffset(Number.NaN, 328), 0);

  const select = (offset, width) => selectPriorityTarget({
    offset,
    width,
    canPrevious: true,
    canNext: true,
  });
  assert.equal(getPriorityPreviewOffset(-100, 328), -64);
  assert.equal(select(-100, 320), 1, "page selection uses uncapped intent even when the preview is below threshold");
});

test("offset advancement clamps both page edges without rubber banding", () => {
  const bounds = { min: -328, max: 328 };
  assert.equal(advancePriorityOffset(0, -1000, bounds), -328);
  assert.equal(advancePriorityOffset(-328, -1000, bounds), -328);
  assert.equal(advancePriorityOffset(0, 1000, bounds), 328);
  assert.equal(advancePriorityOffset(328, 1000, bounds), 328);

  const firstPageBounds = { min: -328, max: 0 };
  assert.equal(advancePriorityOffset(0, 1, firstPageBounds), 0);
  assert.equal(advancePriorityOffset(0, 1000, firstPageBounds), 0);
  assert.equal(advancePriorityOffset(-40, -1000, firstPageBounds), -328);
  assert.equal(advancePriorityOffset(Number.NaN, 100, bounds), 0);
  assert.equal(advancePriorityOffset(0, Number.POSITIVE_INFINITY, bounds), 0);
});

test("page selection uses only the bounded distance threshold", () => {
  const select = (offset, width, canPrevious = true, canNext = true) => selectPriorityTarget({
    offset,
    width,
    canPrevious,
    canNext,
  });

  assert.equal(select(-47.99, 100), 0);
  assert.equal(select(-48, 100), 1);
  assert.equal(select(48, 100), -1);

  assert.equal(select(-70.39, 320), 0);
  assert.equal(select(-70.4, 320), 1);
  assert.equal(select(70.4, 320), -1);

  assert.equal(select(-119.99, 1000), 0);
  assert.equal(select(-120, 1000), 1);
  assert.equal(select(120, 1000), -1);

  assert.equal(select(120, 320, false, true), 0);
  assert.equal(select(-120, 320, true, false), 0);
  assert.equal(select(Number.NaN, 320), 0);
});

test("slide samples use smoothstep easing, clamp at the target, and never overshoot", () => {
  const start = -120;
  const target = -328;
  const at = (elapsedMs) => samplePrioritySlide({ position: start, target, elapsedMs });

  assert.deepEqual(at(0), { position: -120, done: false });
  assert.deepEqual(at(17.5), { position: -152.5, done: false });
  assert.deepEqual(at(35), { position: -224, done: false });
  assert.deepEqual(at(52.5), { position: -295.5, done: false });
  assert.deepEqual(at(70), { position: target, done: true });
  assert.deepEqual(at(90), { position: target, done: true });
  assert.notEqual(at(17.5).position, start + (target - start) * 0.25, "the path is eased instead of linear");

  for (const elapsedMs of [0, 1, 9, 17, 34, 35, 52, 69, 70, 90]) {
    const sample = at(elapsedMs);
    assert.ok(sample.position <= start && sample.position >= target, "the forward slide stays between its endpoints");
  }
});

test("slide sampling also moves back toward the origin without overshoot", () => {
  const sample = (elapsedMs) => samplePrioritySlide({ position: 328, target: 0, elapsedMs });
  assert.deepEqual(sample(0), { position: 328, done: false });
  assert.deepEqual(sample(17.5), { position: 276.75, done: false });
  assert.deepEqual(sample(35), { position: 164, done: false });
  assert.deepEqual(sample(70), { position: 0, done: true });
  assert.ok(sample(52).position > 0);
  assert.ok(sample(52).position < 328);
});

test("long slides extend their duration to keep sampled speed at or below 12px/ms", () => {
  const start = 123;
  const target = -877;
  const durationMs = getPrioritySlideDuration(start, target);
  assert.equal(durationMs, 125);

  let priorPosition = start;
  let maxSampledSpeed = 0;
  for (let elapsedMs = 1; elapsedMs <= durationMs; elapsedMs += 1) {
    const sample = samplePrioritySlide({
      position: start,
      target,
      elapsedMs,
      durationMs: 1,
    });
    maxSampledSpeed = Math.max(maxSampledSpeed, Math.abs(sample.position - priorPosition));
    assert.ok(sample.position <= start && sample.position >= target, "every sample remains within its endpoints");
    priorPosition = sample.position;
  }
  assert.ok(maxSampledSpeed <= PRIORITY_MAX_SLIDE_SPEED_PX_PER_MS, `sampled speed is ${maxSampledSpeed}px/ms`);
  assert.equal(samplePrioritySlide({ position: start, target, elapsedMs: 124, durationMs: 1 }).done, false);
  assert.deepEqual(samplePrioritySlide({ position: start, target, elapsedMs: 125, durationMs: 1 }), { position: target, done: true });
});
