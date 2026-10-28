export type PriorityPageDelta = -1 | 0 | 1;

export const PRIORITY_SLIDE_DURATION_MS = 70;
export const PRIORITY_ARROW_NAVIGATION_DURATION_MS = 320;
export const PRIORITY_MAX_SLIDE_SPEED_PX_PER_MS = 12;

const PRIORITY_PREVIEW_MAX_PX = 64;

const MIN_SWIPE_DISTANCE = 48;
const MAX_SWIPE_DISTANCE = 120;
const SWIPE_DISTANCE_RATIO = 0.22;

/** Keep the live gesture preview small while retaining the full intent for selection. */
export function getPriorityPreviewOffset(intent: number, pageDistance: number) {
  const safeIntent = Number.isFinite(intent) ? intent : 0;
  const safePageDistance = Number.isFinite(pageDistance) ? Math.max(0, pageDistance) : 0;
  const previewLimit = Math.min(PRIORITY_PREVIEW_MAX_PX, safePageDistance / 4);
  return Math.max(-previewLimit, Math.min(previewLimit, safeIntent));
}

/** Keep the peak speed of a smoothstep slide at or below the configured limit. */
export function getPrioritySlideDuration(position: number, target: number, requestedDurationMs = PRIORITY_SLIDE_DURATION_MS) {
  const start = Number.isFinite(position) ? position : 0;
  const destination = Number.isFinite(target) ? target : start;
  const distance = Math.abs(destination - start);
  return Math.max(
    Number.isFinite(requestedDurationMs) ? Math.max(0, requestedDurationMs) : PRIORITY_SLIDE_DURATION_MS,
    Math.ceil(1.5 * distance / PRIORITY_MAX_SLIDE_SPEED_PX_PER_MS),
  );
}

/** Move an offset by a delta while keeping it inside the available page bounds. */
export function advancePriorityOffset(
  displayedOffset: number,
  delta: number,
  { min, max }: { min: number; max: number },
) {
  if (!Number.isFinite(displayedOffset)) return 0;

  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return displayedOffset;

  const proposed = displayedOffset + (Number.isFinite(delta) ? delta : 0);
  return Math.max(lower, Math.min(upper, proposed));
}

/** Choose at most one adjacent page using the final distance from the committed page. */
export function selectPriorityTarget({
  offset,
  width,
  canPrevious,
  canNext,
}: {
  offset: number;
  width: number;
  canPrevious: boolean;
  canNext: boolean;
}): PriorityPageDelta {
  if (!Number.isFinite(offset)) return 0;

  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const threshold = Math.min(MAX_SWIPE_DISTANCE, Math.max(MIN_SWIPE_DISTANCE, safeWidth * SWIPE_DISTANCE_RATIO));
  if (offset >= threshold) return canPrevious ? -1 : 0;
  if (offset <= -threshold) return canNext ? 1 : 0;
  return 0;
}

export type PrioritySlideSample = {
  position: number;
  done: boolean;
};

/** Sample a monotone, eased slide from its initial position to its target. */
export function samplePrioritySlide({
  position,
  target,
  elapsedMs,
  durationMs = PRIORITY_SLIDE_DURATION_MS,
}: {
  position: number;
  target: number;
  elapsedMs: number;
  durationMs?: number;
}): PrioritySlideSample {
  const start = Number.isFinite(position) ? position : 0;
  const destination = Number.isFinite(target) ? target : start;
  const requestedDuration = Number.isFinite(durationMs)
    ? Math.max(0, durationMs)
    : PRIORITY_SLIDE_DURATION_MS;
  const duration = Math.max(requestedDuration, getPrioritySlideDuration(start, destination));
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;

  if (elapsed >= duration) return { position: destination, done: true };

  const linearProgress = elapsed / duration;
  const progress = linearProgress * linearProgress * (3 - 2 * linearProgress);
  return {
    position: start + (destination - start) * progress,
    done: false,
  };
}
