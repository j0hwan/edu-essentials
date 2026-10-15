export type PriorityPageDelta = -1 | 0 | 1;

export type PrioritySpringSample = {
  position: number;
  velocity: number;
  done: boolean;
};

const MIN_SWIPE_DISTANCE = 48;
const MAX_SWIPE_DISTANCE = 120;
const SWIPE_DISTANCE_RATIO = 0.22;
const FLICK_VELOCITY = 0.65;
const MIN_FLICK_DISTANCE = 20;
const FLICK_PROJECTION_MS = 120;
const MIN_REVERSAL_VELOCITY = 0.12;

/** Compress movement that is already beyond an edge while keeping the first part responsive. */
export function rubberBandOffset(distance: number, limit: number, factor = 0.55) {
  if (!Number.isFinite(distance) || !Number.isFinite(limit) || limit <= 0) return 0;

  const magnitude = Math.abs(distance) * Math.max(0, factor);
  const resistedMagnitude = Math.min((limit * magnitude) / (limit + magnitude), limit * 0.9);
  return Math.sign(distance) * resistedMagnitude;
}

/** Recover the uncompressed overflow amount from a displayed rubber-band offset. */
export function inverseRubberBandOffset(resistedDistance: number, limit: number, factor = 0.55) {
  if (!Number.isFinite(resistedDistance) || !Number.isFinite(limit) || limit <= 0 || factor <= 0) return 0;

  const magnitude = Math.min(Math.abs(resistedDistance), limit * 0.9);
  const distance = (limit * magnitude) / (factor * (limit - magnitude));
  return Math.sign(resistedDistance) * distance;
}

/**
 * Advance a displayed carousel offset by one input delta. Reversing an edge
 * pull moves the displayed position immediately; only further outward travel
 * is mapped through the inverse rubber-band curve.
 */
export function advancePriorityOffset(
  displayedOffset: number,
  delta: number,
  {
    min,
    max,
    resistMin = false,
    resistMax = false,
    resistanceLimit = 24,
  }: {
    min: number;
    max: number;
    resistMin?: boolean;
    resistMax?: boolean;
    resistanceLimit?: number;
  },
) {
  if (!Number.isFinite(displayedOffset)) return 0;
  if (!Number.isFinite(delta) || delta === 0) return displayedOffset;

  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return displayedOffset;
  const limit = Number.isFinite(resistanceLimit) && resistanceLimit > 0 ? resistanceLimit : 24;

  // Unwind visible resistance one-to-one so a tiny reversal is immediately
  // perceptible even after a large outward pull.
  if (displayedOffset < lower && delta > 0) return Math.min(upper, displayedOffset + delta);
  if (displayedOffset > upper && delta < 0) return Math.max(lower, displayedOffset + delta);

  const proposed = displayedOffset + delta;
  if (proposed < lower) {
    if (!resistMin) return lower;
    const rawOverflow = displayedOffset < lower
      ? inverseRubberBandOffset(displayedOffset - lower, limit) + delta
      : proposed - lower;
    return lower + rubberBandOffset(rawOverflow, limit);
  }
  if (proposed > upper) {
    if (!resistMax) return upper;
    const rawOverflow = displayedOffset > upper
      ? inverseRubberBandOffset(displayedOffset - upper, limit) + delta
      : proposed - upper;
    return upper + rubberBandOffset(rawOverflow, limit);
  }
  return proposed;
}

/** Choose at most one adjacent page from the final offset and deliberate flick velocity. */
export function selectPriorityTarget({
  offset,
  velocity,
  width,
  canPrevious,
  canNext,
  isReversing = false,
}: {
  offset: number;
  velocity: number;
  width: number;
  canPrevious: boolean;
  canNext: boolean;
  isReversing?: boolean;
}): PriorityPageDelta {
  const threshold = Math.min(MAX_SWIPE_DISTANCE, Math.max(MIN_SWIPE_DISTANCE, width * SWIPE_DISTANCE_RATIO));
  let projectedOffset = offset;

  if (Math.abs(offset) < MIN_FLICK_DISTANCE || isReversing) return 0;
  if (
    Number.isFinite(velocity)
    && offset * velocity < 0
    && Math.abs(velocity) >= MIN_REVERSAL_VELOCITY
  ) {
    return 0;
  }
  if (Number.isFinite(velocity) && Math.abs(velocity) >= FLICK_VELOCITY) {
    const projection = offset + velocity * FLICK_PROJECTION_MS;
    // Reversal should unwind toward the committed page; it cannot predict through it.
    projectedOffset = Math.sign(projection) !== Math.sign(offset) ? 0 : projection;
  }

  if (projectedOffset >= threshold) return canPrevious ? -1 : 0;
  if (projectedOffset <= -threshold) return canNext ? 1 : 0;
  return 0;
}

/**
 * Sample an analytical damped spring, so frame-rate changes do not alter its motion.
 * Position and velocity use px and px/sec; elapsedMs uses milliseconds.
 */
export function samplePrioritySpring({
  position,
  velocity,
  target,
  elapsedMs,
  stiffness = 360,
  damping = 32,
}: {
  position: number;
  velocity: number;
  target: number;
  elapsedMs: number;
  stiffness?: number;
  damping?: number;
}): PrioritySpringSample {
  const safeStiffness = Math.max(0.001, Number.isFinite(stiffness) ? stiffness : 360);
  const safeDamping = Math.max(0, Number.isFinite(damping) ? damping : 32);
  const time = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0);
  const naturalFrequency = Math.sqrt(safeStiffness);
  const dampingRatio = safeDamping / (2 * naturalFrequency);
  const initialDisplacement = position - target;
  let displacement: number;
  let nextVelocity: number;

  if (dampingRatio < 0.999) {
    const dampedFrequency = naturalFrequency * Math.sqrt(1 - dampingRatio * dampingRatio);
    const sineCoefficient = (velocity + dampingRatio * naturalFrequency * initialDisplacement) / dampedFrequency;
    const phase = dampedFrequency * time;
    const envelope = Math.exp(-dampingRatio * naturalFrequency * time);
    const cosine = Math.cos(phase);
    const sine = Math.sin(phase);
    displacement = envelope * (initialDisplacement * cosine + sineCoefficient * sine);
    nextVelocity = envelope * (
      -dampingRatio * naturalFrequency * (initialDisplacement * cosine + sineCoefficient * sine)
      + (-initialDisplacement * dampedFrequency * sine + sineCoefficient * dampedFrequency * cosine)
    );
  } else if (dampingRatio <= 1.001) {
    const coefficient = velocity + naturalFrequency * initialDisplacement;
    const envelope = Math.exp(-naturalFrequency * time);
    displacement = (initialDisplacement + coefficient * time) * envelope;
    nextVelocity = (coefficient - naturalFrequency * (initialDisplacement + coefficient * time)) * envelope;
  } else {
    const root = Math.sqrt(dampingRatio * dampingRatio - 1);
    const fastRate = -naturalFrequency * (dampingRatio + root);
    const slowRate = -naturalFrequency * (dampingRatio - root);
    const fastCoefficient = (velocity - slowRate * initialDisplacement) / (fastRate - slowRate);
    const slowCoefficient = initialDisplacement - fastCoefficient;
    const fastTerm = fastCoefficient * Math.exp(fastRate * time);
    const slowTerm = slowCoefficient * Math.exp(slowRate * time);
    displacement = fastTerm + slowTerm;
    nextVelocity = fastRate * fastTerm + slowRate * slowTerm;
  }

  const nextPosition = target + displacement;
  const done = (Math.abs(displacement) <= 0.5 && Math.abs(nextVelocity) <= 5) || time >= 1.5;
  return {
    position: done ? target : nextPosition,
    velocity: done ? 0 : nextVelocity,
    done,
  };
}
