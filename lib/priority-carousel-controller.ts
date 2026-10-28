import {
  advancePriorityOffset,
  PRIORITY_ARROW_NAVIGATION_DURATION_MS,
  getPriorityPreviewOffset,
  getPrioritySlideDuration,
  samplePrioritySlide,
  selectPriorityTarget,
  type PriorityPageDelta,
} from "./priority-swipe-motion";

export type PriorityCarouselPhase =
  | { type: "idle" }
  | { type: "dragging"; source: "pointer" | "wheel" }
  | { type: "settling"; targetPage: number };

export type PriorityCarouselSnapshot = {
  page: number;
  selectedPage: number;
  phase: PriorityCarouselPhase;
  motionVisible: boolean;
};

export type PriorityCarouselControllerOptions = {
  pageCount: number;
  width: number;
  reducedMotion?: boolean;
  pageGap?: number;
  now: () => number;
  requestAnimationFrame: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
  onSnapshot?: (snapshot: PriorityCarouselSnapshot, atomicCommit: boolean) => void;
  onOffset?: (offset: number) => void;
};

export type PriorityPointerDown = {
  pointerId: number;
  x: number;
  y: number;
  isPrimary?: boolean;
  pointerType?: string;
  button?: number;
};

export type PriorityPointerMove = {
  pointerId: number;
  x: number;
  y: number;
};

export type PriorityPointerEnd = {
  pointerId: number;
  x?: number;
};

export type PriorityPointerResult = {
  capturePointer: boolean;
  preventDefault: boolean;
  quarantined: boolean;
  releasePointerId: number | null;
  suppressClick: boolean;
};

export type PriorityWheelInput = {
  deltaX: number;
  deltaY: number;
  cancelable: boolean;
  /** Native WheelEvent.momentum when the browser exposes it. */
  momentum?: boolean;
};

export type PriorityWheelResult = {
  preventDefault: boolean;
  releasePointerIds: number[];
};

export type PriorityNavigateResult = {
  accepted: boolean;
  releasePointerIds: number[];
};

type PointerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  axis: "pending" | "horizontal" | "vertical";
  captured: boolean;
};

type WheelAxis = "horizontal" | "vertical";

type WheelTrend = {
  lastAt: number;
  lastMagnitude: number;
  direction: -1 | 0 | 1;
  decaySamples: number;
};

type WheelSession = WheelTrend & {
  axis: WheelAxis;
  consumed: boolean;
  rejected: boolean;
  nativeMomentumKnown: boolean;
};

type WheelTailGuard = WheelTrend & {
  axis: "horizontal";
};

type SlideMotion = {
  targetPageDelta: PriorityPageDelta;
  targetOffset: number;
  initialPosition: number;
  startedAt: number;
  durationMs: number;
};

const POINTER_INTENT_PX = 6;
const WHEEL_IDLE_MS = 70;
const VERTICAL_WHEEL_IDLE_MS = 80;
const WHEEL_DECAY_GUARD_MS = 300;
const WHEEL_RENEWAL_MIN_PX = 12;
const CLICK_SUPPRESSION_MS = 400;
const WHEEL_DECAY_RATIO = 0.95;

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function directionOf(value: number): -1 | 0 | 1 {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

function emptyPhase(): PriorityCarouselPhase {
  return { type: "idle" };
}

/** Owns page selection, gestures, wheel sessions, and the single settle frame. */
export class PriorityCarouselController {
  private readonly options: PriorityCarouselControllerOptions;
  private readonly pageGap: number;
  private pageCount: number;
  private width: number;
  private reducedMotion: boolean;
  private snapshot: PriorityCarouselSnapshot;
  private offset = 0;
  private rawIntent = 0;
  private pointer: PointerGesture | null = null;
  private readonly quarantinedPointers = new Set<number>();
  private wheelSession: WheelSession | null = null;
  private wheelTailGuard: WheelTailGuard | null = null;
  private wheelTimer: number | null = null;
  private motion: SlideMotion | null = null;
  private frame: number | null = null;
  private suppressClickUntil = 0;
  private destroyed = false;

  constructor(options: PriorityCarouselControllerOptions) {
    this.options = options;
    this.pageGap = Math.max(0, finite(options.pageGap ?? 8));
    this.pageCount = Math.max(1, Math.floor(finite(options.pageCount, 1)));
    this.width = Math.max(1, finite(options.width, 1));
    this.reducedMotion = options.reducedMotion ?? false;
    this.snapshot = {
      page: 0,
      selectedPage: 0,
      phase: emptyPhase(),
      motionVisible: false,
    };
  }

  getSnapshot() {
    return this.snapshot;
  }

  pointerDown(input: PriorityPointerDown): PriorityPointerResult {
    if (this.destroyed) return this.pointerResult();
    if (input.isPrimary === false || (input.pointerType === "mouse" && input.button !== 0)) {
      return this.pointerResult();
    }

    if (this.snapshot.phase.type === "settling" || this.motion
      || (this.snapshot.phase.type === "dragging" && this.snapshot.phase.source === "wheel")) {
      this.quarantinedPointers.add(input.pointerId);
      return this.pointerResult({ capturePointer: true, quarantined: true });
    }

    if (this.pointer?.captured) return this.pointerResult();
    if (this.pointer && this.pointer.pointerId !== input.pointerId) this.pointer = null;
    this.quarantinedPointers.delete(input.pointerId);
    this.suppressClickUntil = 0;
    this.pointer = {
      pointerId: input.pointerId,
      startX: finite(input.x),
      startY: finite(input.y),
      lastX: finite(input.x),
      axis: "pending",
      captured: false,
    };
    return this.pointerResult();
  }

  pointerMove(input: PriorityPointerMove): PriorityPointerResult {
    const gesture = this.pointer;
    if (this.destroyed || !gesture || gesture.pointerId !== input.pointerId || this.motion) {
      return this.pointerResult();
    }

    const x = finite(input.x, gesture.lastX);
    const y = finite(input.y, gesture.startY);
    if (gesture.axis === "pending") {
      const intentX = x - gesture.startX;
      const intentY = y - gesture.startY;
      if (Math.max(Math.abs(intentX), Math.abs(intentY)) < POINTER_INTENT_PX) {
        return this.pointerResult();
      }

      gesture.axis = Math.abs(intentX) > Math.abs(intentY) ? "horizontal" : "vertical";
      if (gesture.axis === "vertical") return this.pointerResult();

      this.clearWheelInteraction();
      this.rawIntent = 0;
      this.setOffset(0);
      gesture.lastX = gesture.startX;
      this.setSnapshot({
        ...this.snapshot,
        phase: { type: "dragging", source: "pointer" },
        motionVisible: !this.reducedMotion,
      });
    }

    if (gesture.axis !== "horizontal") return this.pointerResult();
    const capturePointer = !gesture.captured;
    const nextIntent = this.advanceOffset(this.rawIntent, x - gesture.lastX);
    gesture.lastX = x;
    this.writeGestureIntent(nextIntent);
    if (capturePointer) gesture.captured = true;
    return this.pointerResult({
      capturePointer,
      preventDefault: true,
    });
  }

  pointerUp(input: PriorityPointerEnd): PriorityPointerResult {
    if (this.destroyed) return this.pointerResult();
    if (this.quarantinedPointers.delete(input.pointerId)) {
      this.suppressClickUntil = this.options.now() + CLICK_SUPPRESSION_MS;
      return this.pointerResult({
        quarantined: true,
        releasePointerId: input.pointerId,
        suppressClick: true,
      });
    }

    const gesture = this.pointer;
    if (!gesture || gesture.pointerId !== input.pointerId) return this.pointerResult();
    this.pointer = null;
    if (gesture.axis !== "horizontal") {
      if (this.snapshot.phase.type === "dragging" && this.snapshot.phase.source === "pointer") {
        this.setSnapshot({ ...this.snapshot, phase: emptyPhase(), motionVisible: false });
      }
      return this.pointerResult({ releasePointerId: gesture.captured ? input.pointerId : null });
    }

    if (input.x !== undefined) {
      this.writeGestureIntent(this.advanceOffset(this.rawIntent, finite(input.x, gesture.lastX) - gesture.lastX));
    }
    this.suppressClickUntil = this.options.now() + CLICK_SUPPRESSION_MS;
    const target = this.chooseTarget(this.rawIntent);
    const result = this.pointerResult({
      releasePointerId: gesture.captured ? input.pointerId : null,
      suppressClick: true,
    });
    this.startSettle(target);
    return result;
  }

  pointerCancel(pointerId: number): PriorityPointerResult {
    if (this.quarantinedPointers.delete(pointerId)) {
      return this.pointerResult({ quarantined: true, releasePointerId: pointerId });
    }
    if (!this.pointer || this.pointer.pointerId !== pointerId) return this.pointerResult();
    const releasePointerId = this.pointer.captured ? pointerId : null;
    this.cancel();
    return this.pointerResult({ releasePointerId });
  }

  lostPointerCapture(pointerId: number): PriorityPointerResult {
    if (this.quarantinedPointers.has(pointerId)) {
      return this.pointerResult({ quarantined: true });
    }
    return this.pointerCancel(pointerId);
  }

  wheel(input: PriorityWheelInput): PriorityWheelResult {
    let releasePointerIds: number[] = [];
    const result = (preventDefault: boolean): PriorityWheelResult => ({ preventDefault, releasePointerIds });
    if (this.destroyed) return result(false);
    const deltaX = finite(input.deltaX);
    const deltaY = finite(input.deltaY);
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (absX === 0 && absY === 0) {
      if (input.momentum === true) releasePointerIds.push(...this.endNativeWheelSession());
      return result(false);
    }

    const now = finite(this.options.now());
    const isHorizontalSample = absX > absY;
    if (input.momentum === true) {
      const axis = this.wheelSession?.axis ?? this.wheelTailGuard?.axis ?? (isHorizontalSample ? "horizontal" : "vertical");
      releasePointerIds.push(...this.endNativeWheelSession());
      return result(axis === "horizontal" && input.cancelable);
    }

    let session = this.wheelSession;
    if (!input.cancelable) {
      // Non-cancelable packets cannot move the carousel, but they still belong
      // to the active physical wheel session. Keep its quiet deadline aligned
      // with the latest packet so an ignored tail cannot expire the latch early.
      if (session && now - session.lastAt >= this.quietPeriod(session)) {
        this.expireWheelSession(session);
        session = this.wheelSession;
      }
      if (session) {
        this.recordWheelPacket(session, now, deltaX, deltaY, input.momentum);
        this.scheduleWheelRelease(session, this.quietPeriod(session));
      }
      if (this.wheelTailGuard) this.handleWheelTailGuard(input, now, deltaX, deltaY);
      return result(false);
    }

    if (session && now - session.lastAt >= this.quietPeriod(session)) {
      if (this.isFirstPostQuietDecay(session, now, deltaX, deltaY, isHorizontalSample, input.momentum)) {
        this.recordWheelPacket(session, now, deltaX, deltaY, input.momentum);
        this.scheduleWheelRelease(session, this.quietPeriod(session));
        return result(session.axis === "horizontal");
      }
      this.expireWheelSession(session);
      session = this.wheelSession;
    }

    if (this.wheelTailGuard) {
      const guarded = this.handleWheelTailGuard(input, now, deltaX, deltaY);
      if (guarded !== null) return result(guarded && input.cancelable);
      session = this.wheelSession;
    }

    if (session?.rejected) {
      this.recordWheelPacket(session, now, deltaX, deltaY, input.momentum);
      this.scheduleWheelRelease(session, this.quietPeriod(session));
      return result(session.axis === "horizontal");
    }

    if (session?.consumed) {
      const renewedImpulse = input.momentum === undefined
        && this.isRenewedImpulse(session, now, deltaX, deltaY);
      if (renewedImpulse) {
        this.clearWheelSession();
        this.wheelTailGuard = null;
        session = null;
      } else {
        this.recordWheelPacket(session, now, deltaX, deltaY, input.momentum);
        this.scheduleWheelRelease(session, WHEEL_IDLE_MS);
        return result(session.axis === "horizontal");
      }
    }

    if (session?.axis === "vertical") {
      this.recordWheelPacket(session, now, deltaX, deltaY, input.momentum);
      this.scheduleWheelRelease(session, VERTICAL_WHEEL_IDLE_MS);
      return result(false);
    }

    if (this.snapshot.phase.type === "settling" || this.motion) {
      if (!session) {
        session = this.createWheelSession(isHorizontalSample ? "horizontal" : "vertical", now, deltaX, deltaY, input.momentum);
        session.rejected = true;
        this.wheelSession = session;
      } else {
        session.rejected = true;
      }
      this.scheduleWheelRelease(session, this.quietPeriod(session));
      return result(session.axis === "horizontal");
    }

    if (!session && isHorizontalSample && this.pointer) {
      releasePointerIds = this.retirePointer();
    }

    if (this.snapshot.phase.type === "dragging" && this.snapshot.phase.source === "pointer") {
      return result(false);
    }

    if (!session) {
      session = this.createWheelSession(isHorizontalSample ? "horizontal" : "vertical", now, deltaX, deltaY, input.momentum);
      this.wheelSession = session;
    } else {
      this.recordWheelPacket(session, now, deltaX, deltaY, input.momentum);
    }

    if (session.axis === "vertical") {
      this.scheduleWheelRelease(session, VERTICAL_WHEEL_IDLE_MS);
      return result(false);
    }

    const nextIntent = this.advanceOffset(this.rawIntent, -deltaX);
    this.writeGestureIntent(nextIntent);
    this.setSnapshot({
      ...this.snapshot,
      phase: { type: "dragging", source: "wheel" },
      motionVisible: !this.reducedMotion,
    });
    const target = this.chooseTarget(this.rawIntent);
    if (target !== 0) {
      session.consumed = true;
      releasePointerIds.push(...this.startSettle(target));
      this.scheduleWheelRelease(session, WHEEL_IDLE_MS);
      return result(true);
    }

    this.scheduleWheelRelease(session, this.quietPeriod(session));
    return result(true);
  }

  navigate(pageDelta: -1 | 1) {
    if (this.destroyed || this.snapshot.phase.type === "settling" || this.motion) {
      return { accepted: false, releasePointerIds: [] };
    }
    if ((pageDelta < 0 && this.snapshot.page <= 0) || (pageDelta > 0 && this.snapshot.page >= this.pageCount - 1)) {
      return { accepted: false, releasePointerIds: [] };
    }
    const releasePointerIds = this.retirePointer();
    if (this.wheelSession?.axis !== "vertical") this.clearWheelInteraction();
    else this.wheelTailGuard = null;
    if (this.snapshot.phase.type === "dragging" && this.snapshot.phase.source === "wheel") {
      this.rawIntent = 0;
      this.setOffset(0);
      this.setSnapshot({ ...this.snapshot, phase: emptyPhase(), motionVisible: false });
    }
    releasePointerIds.push(...this.startSettle(pageDelta, PRIORITY_ARROW_NAVIGATION_DURATION_MS));
    return { accepted: true, releasePointerIds: [...new Set(releasePointerIds)] };
  }

  /** Cancel active input and motion, returning every pointer capture to release. */
  cancel() {
    const pointerIds = new Set<number>(this.quarantinedPointers);
    if (this.pointer) pointerIds.add(this.pointer.pointerId);
    this.quarantinedPointers.clear();
    this.pointer = null;
    this.clearWheelInteraction();
    this.stopMotion();
    this.rawIntent = 0;
    this.suppressClickUntil = 0;
    this.setOffset(0);
    this.setSnapshot({
      page: this.snapshot.page,
      selectedPage: this.snapshot.page,
      phase: emptyPhase(),
      motionVisible: false,
    });
    return [...pointerIds];
  }

  setReducedMotion(reducedMotion: boolean) {
    if (this.reducedMotion === reducedMotion) return [];
    const pointerIds = this.cancel();
    this.reducedMotion = reducedMotion;
    return pointerIds;
  }

  setGeometry({ pageCount, width }: { pageCount: number; width: number }) {
    const nextPageCount = Math.max(1, Math.floor(finite(pageCount, this.pageCount)));
    const nextWidth = Math.max(1, finite(width, this.width));
    if (nextPageCount === this.pageCount && nextWidth === this.width) return [];
    const pointerIds = this.cancel();
    this.pageCount = nextPageCount;
    this.width = nextWidth;
    const page = Math.min(this.snapshot.page, this.pageCount - 1);
    if (page !== this.snapshot.page) {
      this.setSnapshot({ ...this.snapshot, page, selectedPage: page });
    }
    return pointerIds;
  }

  shouldSuppressClick(detail: number) {
    if (detail === 0 || this.options.now() > this.suppressClickUntil) return false;
    this.suppressClickUntil = 0;
    return true;
  }

  destroy() {
    if (this.destroyed) return [];
    const pointerIds = new Set<number>(this.quarantinedPointers);
    if (this.pointer) pointerIds.add(this.pointer.pointerId);
    this.quarantinedPointers.clear();
    this.pointer = null;
    this.clearWheelInteraction();
    this.stopMotion();
    this.rawIntent = 0;
    this.setOffset(0);
    this.suppressClickUntil = 0;
    this.destroyed = true;
    return [...pointerIds];
  }

  private pointerResult(overrides: Partial<PriorityPointerResult> = {}): PriorityPointerResult {
    return {
      capturePointer: false,
      preventDefault: false,
      quarantined: false,
      releasePointerId: null,
      suppressClick: false,
      ...overrides,
    };
  }

  private advanceOffset(displayedOffset: number, delta: number) {
    const distance = this.width + this.pageGap;
    const page = this.snapshot.page;
    return advancePriorityOffset(displayedOffset, delta, {
      min: page < this.pageCount - 1 ? -distance : 0,
      max: page > 0 ? distance : 0,
    });
  }

  private writeGestureIntent(intent: number) {
    this.rawIntent = this.advanceOffset(intent, 0);
    this.setOffset(getPriorityPreviewOffset(this.rawIntent, this.width + this.pageGap));
  }

  private chooseTarget(offset: number): PriorityPageDelta {
    return selectPriorityTarget({
      offset,
      width: this.width,
      canPrevious: this.snapshot.page > 0,
      canNext: this.snapshot.page < this.pageCount - 1,
    });
  }

  private startSettle(pageDelta: PriorityPageDelta, requestedDurationMs?: number) {
    if (this.motion) return [];
    const releasePointerIds = this.retirePointer();
    const page = this.snapshot.page;
    const validDelta: PriorityPageDelta = pageDelta < 0 && page > 0
      ? -1
      : pageDelta > 0 && page < this.pageCount - 1
        ? 1
        : 0;
    const targetOffset = validDelta === 1
      ? -(this.width + this.pageGap)
      : validDelta === -1
        ? this.width + this.pageGap
        : 0;
    const position = this.offset;
    const alreadyAtTarget = Math.abs(position - targetOffset) < 0.5;
    this.rawIntent = 0;

    if (this.reducedMotion || (validDelta === 0 && alreadyAtTarget)) {
      this.stopMotion();
      this.setOffset(0);
      const nextPage = page + validDelta;
      const nextSnapshot: PriorityCarouselSnapshot = {
        page: nextPage,
        selectedPage: nextPage,
        phase: emptyPhase(),
        motionVisible: false,
      };
      this.setSnapshot(nextSnapshot, validDelta !== 0);
      return releasePointerIds;
    }

    const motion: SlideMotion = {
      targetPageDelta: validDelta,
      targetOffset,
      initialPosition: position,
      startedAt: finite(this.options.now()),
      durationMs: getPrioritySlideDuration(position, targetOffset, requestedDurationMs),
    };
    this.motion = motion;
    this.setSnapshot({
      page,
      selectedPage: page + validDelta,
      phase: { type: "settling", targetPage: page + validDelta },
      motionVisible: true,
    });

    const frame = (timestamp: number) => {
      if (this.motion !== motion || this.destroyed) return;
      const sample = samplePrioritySlide({
        position: motion.initialPosition,
        target: motion.targetOffset,
        elapsedMs: timestamp - motion.startedAt,
        durationMs: motion.durationMs,
      });
      this.setOffset(sample.position);

      if (sample.done) {
        this.frame = null;
        this.commitMotion(motion);
        return;
      }
      this.frame = this.options.requestAnimationFrame(frame);
    };
    this.frame = this.options.requestAnimationFrame(frame);
    return releasePointerIds;
  }

  private commitMotion(motion: SlideMotion) {
    if (this.motion !== motion) return;
    const nextPage = Math.max(0, Math.min(this.pageCount - 1, this.snapshot.page + motion.targetPageDelta));
    this.rawIntent = 0;
    this.setOffset(0);
    this.setSnapshot({
      page: nextPage,
      selectedPage: nextPage,
      phase: emptyPhase(),
      motionVisible: false,
    }, true);
    // Keep the input lock until the adapter has flushed the page, dots, and
    // origin transform into one committed render.
    if (this.motion === motion) this.motion = null;
  }

  private stopMotion() {
    if (this.frame !== null) {
      this.options.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.motion = null;
  }

  private setOffset(offset: number) {
    this.offset = finite(offset);
    this.options.onOffset?.(this.reducedMotion ? 0 : this.offset);
  }

  private setSnapshot(snapshot: PriorityCarouselSnapshot, atomicCommit = false) {
    this.snapshot = snapshot;
    this.options.onSnapshot?.(snapshot, atomicCommit);
  }

  private createWheelSession(
    axis: WheelAxis,
    now: number,
    deltaX: number,
    deltaY: number,
    momentum: boolean | undefined,
  ): WheelSession {
    const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    return {
      axis,
      lastAt: now,
      lastMagnitude: magnitude,
      direction: directionOf(axis === "horizontal" ? -deltaX : deltaY),
      decaySamples: 0,
      consumed: false,
      rejected: this.snapshot.phase.type === "settling" || this.motion !== null,
      nativeMomentumKnown: momentum !== undefined,
    };
  }

  private recordWheelPacket(
    trend: WheelTrend & { nativeMomentumKnown?: boolean },
    now: number,
    deltaX: number,
    deltaY: number,
    momentum: boolean | undefined,
  ) {
    const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    if (magnitude > 0 && trend.lastMagnitude > 0) {
      if (magnitude < trend.lastMagnitude * WHEEL_DECAY_RATIO) {
        trend.decaySamples = Math.min(2, trend.decaySamples + 1);
      } else if (magnitude > trend.lastMagnitude && trend.decaySamples < 2) {
        trend.decaySamples = 0;
      }
    }
    if (deltaX !== 0) trend.direction = directionOf(-deltaX);
    trend.lastMagnitude = magnitude;
    trend.lastAt = now;
    if (momentum !== undefined && "nativeMomentumKnown" in trend) trend.nativeMomentumKnown = true;
  }

  private isRenewedImpulse(session: WheelSession, now: number, deltaX: number, deltaY: number) {
    if (now - session.lastAt > WHEEL_DECAY_GUARD_MS || session.decaySamples < 2) return false;
    const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    const direction = directionOf(-deltaX);
    const renewed = magnitude >= Math.max(WHEEL_RENEWAL_MIN_PX, 2 * session.lastMagnitude);
    const reversed = direction !== 0 && session.direction !== 0 && direction !== session.direction && magnitude >= WHEEL_RENEWAL_MIN_PX;
    return renewed || reversed;
  }

  private isFirstPostQuietDecay(
    session: WheelSession,
    now: number,
    deltaX: number,
    deltaY: number,
    isHorizontalSample: boolean,
    momentum: boolean | undefined,
  ) {
    if (!session.consumed || session.nativeMomentumKnown || momentum !== undefined || !isHorizontalSample) return false;
    if (now - session.lastAt >= WHEEL_DECAY_GUARD_MS || session.decaySamples !== 0) return false;
    const direction = directionOf(-deltaX);
    const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    return direction !== 0 && direction === session.direction && magnitude < session.lastMagnitude * WHEEL_DECAY_RATIO;
  }

  private handleWheelTailGuard(
    input: PriorityWheelInput,
    now: number,
    deltaX: number,
    deltaY: number,
  ): boolean | null {
    const guard = this.wheelTailGuard;
    if (!guard) return null;
    // A vertical-first burst after a full horizontal quiet window belongs to
    // native page scrolling. Only same-burst vertical tails stay captured.
    if (Math.abs(deltaY) > Math.abs(deltaX) && now - guard.lastAt >= WHEEL_IDLE_MS) {
      this.wheelTailGuard = null;
      return null;
    }
    if (now - guard.lastAt >= WHEEL_DECAY_GUARD_MS || input.momentum === false) {
      this.wheelTailGuard = null;
      return null;
    }

    const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    const direction = directionOf(-deltaX);
    const renewed = magnitude >= Math.max(WHEEL_RENEWAL_MIN_PX, 2 * guard.lastMagnitude);
    const reversed = direction !== 0 && guard.direction !== 0 && direction !== guard.direction && magnitude >= WHEEL_RENEWAL_MIN_PX;
    if (input.momentum === undefined && guard.decaySamples >= 2 && (renewed || reversed)) {
      this.wheelTailGuard = null;
      return null;
    }

    if (input.momentum === undefined && guard.decaySamples === 0) {
      const sameDirectionDecay = direction !== 0
        && direction === guard.direction
        && magnitude < guard.lastMagnitude * WHEEL_DECAY_RATIO;
      if (!sameDirectionDecay) {
        this.wheelTailGuard = null;
        return null;
      }
    }

    this.recordWheelPacket(guard, now, deltaX, deltaY, undefined);
    return true;
  }

  private expireWheelSession(session: WheelSession) {
    if (this.wheelSession !== session) return;
    this.clearWheelTimer();
    this.wheelSession = null;
    if (session.consumed && !session.nativeMomentumKnown) {
      this.wheelTailGuard = {
        axis: "horizontal",
        lastAt: session.lastAt,
        lastMagnitude: session.lastMagnitude,
        direction: session.direction,
        decaySamples: session.decaySamples,
      };
      return;
    }

    if (!session.consumed && !session.rejected && session.axis === "horizontal") {
      const target = this.chooseTarget(this.rawIntent);
      this.startSettle(target);
    }
    if (!session.rejected && session.axis === "horizontal" && this.snapshot.phase.type === "dragging" && this.snapshot.phase.source === "wheel") {
      if (this.offset !== 0) this.startSettle(0);
      else this.setSnapshot({ ...this.snapshot, phase: emptyPhase(), motionVisible: false });
    }
    this.rawIntent = 0;
  }

  private quietPeriod(session: WheelSession) {
    return session.axis === "vertical" ? VERTICAL_WHEEL_IDLE_MS : WHEEL_IDLE_MS;
  }

  private scheduleWheelRelease(session: WheelSession, delayMs: number) {
    this.clearWheelTimer();
    this.wheelTimer = this.options.setTimeout(() => {
      this.wheelTimer = null;
      this.expireWheelSession(session);
    }, delayMs);
  }

  private clearWheelTimer() {
    if (this.wheelTimer !== null) {
      this.options.clearTimeout(this.wheelTimer);
      this.wheelTimer = null;
    }
  }

  private clearWheelSession() {
    this.clearWheelTimer();
    this.wheelSession = null;
  }

  private clearWheelInteraction() {
    this.clearWheelSession();
    this.wheelTailGuard = null;
  }

  private endNativeWheelSession() {
    const session = this.wheelSession;
    this.clearWheelInteraction();
    if (session && !session.consumed && !session.rejected && session.axis === "horizontal") {
      return this.startSettle(this.chooseTarget(this.rawIntent));
    }
    return [];
  }

  private retirePointer() {
    const gesture = this.pointer;
    if (!gesture) return [];
    this.pointer = null;
    this.quarantinedPointers.add(gesture.pointerId);
    this.rawIntent = 0;
    this.setOffset(0);
    if (this.snapshot.phase.type === "dragging" && this.snapshot.phase.source === "pointer") {
      this.setSnapshot({ ...this.snapshot, phase: emptyPhase(), motionVisible: false });
    }
    return [gesture.pointerId];
  }
}
