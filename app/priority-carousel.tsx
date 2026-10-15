import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { SavedAssignment } from "../lib/workspace-codec";
import { advancePriorityOffset, samplePrioritySpring, selectPriorityTarget } from "../lib/priority-swipe-motion";

const PRIORITIES_PER_PAGE = 2;
const PAGE_GAP_PX = 8;
const POINTER_INTENT_PX = 6;
const EDGE_RESISTANCE_PX = 24;
const WHEEL_IDLE_MS = 80;
const EDGE_WHEEL_IDLE_MS = 48;
const WHEEL_TAIL_IDLE_MS = 200;
const EDGE_SPRING_STIFFNESS = 900;
const PAGE_SPRING_STIFFNESS = 700;

type Props = {
  assignments: SavedAssignment[];
  courseCodeFor: (courseId: string) => string;
  renderStatusBadge: (status: SavedAssignment["status"]) => ReactNode;
  onSelectAssignment: (assignment: SavedAssignment) => void;
  reducedMotion: boolean;
};

type PointerGesture = {
  pointerId: number;
  axis: "pending" | "vertical" | "horizontal";
  startX: number;
  startY: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  lastDirection: -1 | 0 | 1;
  reversalDistance: number;
  returning: boolean;
  dragging: boolean;
  captureTarget: HTMLDivElement | null;
};

type WheelAxis = "horizontal" | "vertical";

type WheelGesture = {
  axis: WheelAxis;
  lastAt: number;
  velocity: number;
  lastDirection: -1 | 0 | 1;
  reversalDistance: number;
  returning: boolean;
};

type SpringMotion = {
  targetPageDelta: -1 | 0 | 1;
  targetOffset: number;
  initialPosition: number;
  initialVelocity: number;
  startedAt: number;
  stiffness: number;
  damping: number;
};

function blendGestureVelocity(previous: number, instantaneous: number, elapsedMs: number) {
  const decayedPrevious = previous * Math.exp(-Math.max(0, elapsedMs) / 80);
  if (instantaneous === 0) return decayedPrevious;
  if (decayedPrevious !== 0 && Math.sign(decayedPrevious) !== Math.sign(instantaneous)) return instantaneous;
  return 0.65 * instantaneous + 0.35 * decayedPrevious;
}

function updateReturnIntent(
  gesture: {
    lastDirection: -1 | 0 | 1;
    reversalDistance: number;
    returning: boolean;
  },
  offsetDelta: number,
  currentOffset: number,
) {
  if (offsetDelta === 0) return;
  const direction = Math.sign(offsetDelta) as -1 | 1;
  gesture.lastDirection = direction;
  if (currentOffset === 0 || currentOffset * offsetDelta >= 0) {
    gesture.reversalDistance = 0;
    gesture.returning = false;
    return;
  }
  gesture.reversalDistance += Math.abs(offsetDelta);
  if (gesture.reversalDistance >= 5) gesture.returning = true;
}

function priorityAdvice(assignment: SavedAssignment) {
  if (assignment.status === "overdue") return "Clear this first to get back on track.";
  if (assignment.status === "today") return "Make time for this before the day ends.";
  return "Get a head start on your next deadline.";
}

function releasePointerCapture(gesture: PointerGesture | null) {
  if (!gesture?.captureTarget) return;
  try {
    if (gesture.captureTarget.hasPointerCapture?.(gesture.pointerId)) {
      gesture.captureTarget.releasePointerCapture(gesture.pointerId);
    }
  } catch {
    // The browser may already have released capture during cancellation.
  }
}

function PriorityCarouselSession({
  assignments,
  courseCodeFor,
  renderStatusBadge,
  onSelectAssignment,
  reducedMotion,
}: Props) {
  const pageCount = Math.ceil(assignments.length / PRIORITIES_PER_PAGE);
  const [currentPageState, setCurrentPageState] = useState(0);
  const [motionState, setMotionState] = useState({ reducedMotion, visible: false });
  if (motionState.reducedMotion !== reducedMotion) {
    setMotionState({ reducedMotion, visible: false });
  }
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(0);
  const offsetRef = useRef(0);
  const reducedMotionRef = useRef(reducedMotion);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const wheelGestureRef = useRef<WheelGesture | null>(null);
  const springMotionRef = useRef<SpringMotion | null>(null);
  const springFrameRef = useRef<number | null>(null);
  const wheelIdleTimerRef = useRef<number | null>(null);
  const wheelTailTimerRef = useRef<number | null>(null);
  const wheelTailAxisRef = useRef<WheelAxis | null>(null);
  const wheelTailDirectionRef = useRef<-1 | 0 | 1>(0);
  const wheelTailReversalRef = useRef(0);
  const suppressSwipeClickRef = useRef(false);
  const clickResetTimerRef = useRef<number | null>(null);

  const currentPage = Math.max(0, Math.min(currentPageState, Math.max(0, pageCount - 1)));
  const pageStartIndex = currentPage * PRIORITIES_PER_PAGE;
  const visibleAssignments = assignments.slice(pageStartIndex, pageStartIndex + PRIORITIES_PER_PAGE);
  const rangeEnd = pageStartIndex + visibleAssignments.length;
  const rangeLabel = rangeEnd === pageStartIndex + 1
    ? `${rangeEnd} of ${assignments.length}`
    : `${pageStartIndex + 1}–${rangeEnd} of ${assignments.length}`;
  const canPrevious = currentPage > 0;
  const canNext = currentPage < pageCount - 1;
  const motionVisible = motionState.visible && !reducedMotion;

  function showMotion() {
    setMotionState({ reducedMotion, visible: !reducedMotion });
  }

  function hideMotion() {
    setMotionState({ reducedMotion, visible: false });
  }

  function clearWheelIdleTimer() {
    if (wheelIdleTimerRef.current !== null) {
      window.clearTimeout(wheelIdleTimerRef.current);
      wheelIdleTimerRef.current = null;
    }
  }

  function clearWheelTailGuard() {
    if (wheelTailTimerRef.current !== null) {
      window.clearTimeout(wheelTailTimerRef.current);
      wheelTailTimerRef.current = null;
    }
    wheelTailAxisRef.current = null;
    wheelTailDirectionRef.current = 0;
    wheelTailReversalRef.current = 0;
  }

  function startWheelTailGuard(axis: WheelAxis, direction: -1 | 0 | 1) {
    if (wheelTailAxisRef.current !== axis || wheelTailDirectionRef.current !== direction) {
      wheelTailReversalRef.current = 0;
    }
    wheelTailAxisRef.current = axis;
    wheelTailDirectionRef.current = direction;
    if (wheelTailTimerRef.current !== null) window.clearTimeout(wheelTailTimerRef.current);
    wheelTailTimerRef.current = window.setTimeout(() => {
      wheelTailTimerRef.current = null;
      // A page change still owns its input until it has arrived. Otherwise a
      // late packet can interrupt the spring and be rebased onto the new page.
      if (springMotionRef.current?.targetPageDelta) return;
      wheelTailAxisRef.current = null;
      wheelTailDirectionRef.current = 0;
      wheelTailReversalRef.current = 0;
    }, WHEEL_TAIL_IDLE_MS);
  }

  function stopSpring() {
    if (springFrameRef.current !== null) {
      window.cancelAnimationFrame(springFrameRef.current);
      springFrameRef.current = null;
    }
    springMotionRef.current = null;
  }

  function writeOffset(offset: number) {
    offsetRef.current = offset;
    const track = trackRef.current;
    if (!track) return;
    const visibleOffset = reducedMotionRef.current ? 0 : offset;
    track.style.transform = `translate3d(${visibleOffset}px, 0, 0)`;
  }

  function advanceOffset(displayedOffset: number, delta: number, page = pageRef.current) {
    const width = Math.max(1, trackRef.current?.clientWidth ?? viewportRef.current?.clientWidth ?? 1);
    const pageDistance = width + PAGE_GAP_PX;
    const previousAvailable = page > 0;
    const nextAvailable = page < pageCount - 1;
    return advancePriorityOffset(displayedOffset, delta, {
      min: nextAvailable ? -pageDistance : 0,
      max: previousAvailable ? pageDistance : 0,
      resistMin: !nextAvailable,
      resistMax: !previousAvailable,
      resistanceLimit: EDGE_RESISTANCE_PX,
    });
  }

  function clearInteractionTimers() {
    clearWheelIdleTimer();
    clearWheelTailGuard();
  }

  function snapToCommittedPage() {
    const pointerGesture = pointerGestureRef.current;
    pointerGestureRef.current = null;
    releasePointerCapture(pointerGesture);
    wheelGestureRef.current = null;
    clearInteractionTimers();
    stopSpring();
    writeOffset(0);
    hideMotion();
  }

  function commitPageDelta(pageDelta: -1 | 0 | 1) {
    if (pageDelta === 0) return;
    const nextPage = Math.max(0, Math.min(pageCount - 1, pageRef.current + pageDelta));
    if (nextPage === pageRef.current) return;
    pageRef.current = nextPage;
    setCurrentPageState(nextPage);
  }

  function startSettle(pageDelta: -1 | 0 | 1, velocityPxPerSecond: number, fromButton = false) {
    const validDelta = pageDelta < 0 && pageRef.current > 0
      ? -1
      : pageDelta > 0 && pageRef.current < pageCount - 1
        ? 1
        : 0;
    const width = Math.max(1, trackRef.current?.clientWidth ?? viewportRef.current?.clientWidth ?? 1);
    const targetOffset = validDelta === 1
      ? -(width + PAGE_GAP_PX)
      : validDelta === -1
        ? width + PAGE_GAP_PX
        : 0;

    pointerGestureRef.current = null;
    wheelGestureRef.current = null;
    clearInteractionTimers();
    stopSpring();

    if (reducedMotionRef.current) {
      writeOffset(0);
      commitPageDelta(validDelta);
      hideMotion();
      return;
    }

    showMotion();
    const position = offsetRef.current;
    const boundaryReturn = validDelta === 0 && (
      (position > 0 && pageRef.current === 0)
      || (position < 0 && pageRef.current === pageCount - 1)
    );
    const stiffness = boundaryReturn ? EDGE_SPRING_STIFFNESS : PAGE_SPRING_STIFFNESS;
    const damping = 2 * Math.sqrt(stiffness);
    let velocity = boundaryReturn || fromButton
      ? 0
      : Math.max(-width * 3, Math.min(width * 3, velocityPxPerSecond));
    const displacement = position - targetOffset;
    const maxInwardVelocity = Math.sqrt(stiffness) * Math.abs(displacement);
    if (displacement === 0) {
      velocity = 0;
    } else if (displacement * velocity < 0 && Math.abs(velocity) > maxInwardVelocity) {
      velocity = -Math.sign(displacement) * maxInwardVelocity;
    }
    const motion: SpringMotion = {
      targetPageDelta: validDelta,
      targetOffset,
      initialPosition: position,
      initialVelocity: velocity,
      startedAt: window.performance.now(),
      stiffness,
      damping,
    };
    springMotionRef.current = motion;

    const frame = (timestamp: number) => {
      if (springMotionRef.current !== motion) return;
      const sample = samplePrioritySpring({
        position: motion.initialPosition,
        velocity: motion.initialVelocity,
        target: motion.targetOffset,
        elapsedMs: timestamp - motion.startedAt,
        stiffness: motion.stiffness,
        damping: motion.damping,
      });
      writeOffset(sample.position);

      if (sample.done) {
        springFrameRef.current = null;
        springMotionRef.current = null;
        // Commit the new cards and origin together so the old page cannot flash.
        flushSync(() => {
          writeOffset(0);
          commitPageDelta(motion.targetPageDelta);
          hideMotion();
        });
        if (motion.targetPageDelta !== 0 && wheelTailAxisRef.current === "horizontal") {
          wheelTailReversalRef.current = 0;
          startWheelTailGuard("horizontal", -motion.targetPageDelta as -1 | 1);
        }
        return;
      }

      springFrameRef.current = window.requestAnimationFrame(frame);
    };

    springFrameRef.current = window.requestAnimationFrame(frame);
  }

  function chooseTarget(velocityPxPerMs: number, isReversing = false) {
    const width = Math.max(1, trackRef.current?.clientWidth ?? viewportRef.current?.clientWidth ?? 1);
    return selectPriorityTarget({
      offset: offsetRef.current,
      velocity: velocityPxPerMs,
      width,
      canPrevious: pageRef.current > 0,
      canNext: pageRef.current < pageCount - 1,
      isReversing,
    });
  }

  function finishPointerGesture(gesture: PointerGesture, event: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture.dragging || gesture.axis !== "horizontal" || gesture.pointerId !== event.pointerId) {
      pointerGestureRef.current = null;
      return;
    }

    const now = window.performance.now();
    const elapsed = Math.max(1, now - gesture.lastAt);
    const previousOffset = offsetRef.current;
    const currentOffset = advanceOffset(previousOffset, event.clientX - gesture.lastX);
    const offsetDelta = currentOffset - previousOffset;
    gesture.velocity = blendGestureVelocity(gesture.velocity, offsetDelta / elapsed, elapsed);
    updateReturnIntent(gesture, offsetDelta, currentOffset);
    writeOffset(currentOffset);
    pointerGestureRef.current = null;
    releasePointerCapture(gesture);
    suppressSwipeClickRef.current = true;
    if (clickResetTimerRef.current !== null) window.clearTimeout(clickResetTimerRef.current);
    clickResetTimerRef.current = window.setTimeout(() => {
      clickResetTimerRef.current = null;
      suppressSwipeClickRef.current = false;
    }, 400);
    startSettle(chooseTarget(gesture.velocity, gesture.returning), gesture.velocity * 1000);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.isPrimary === false) {
      snapToCommittedPage();
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;

    if (clickResetTimerRef.current !== null) {
      window.clearTimeout(clickResetTimerRef.current);
      clickResetTimerRef.current = null;
    }
    suppressSwipeClickRef.current = false;
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      axis: "pending",
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastAt: window.performance.now(),
      velocity: 0,
      lastDirection: 0,
      reversalDistance: 0,
      returning: false,
      dragging: false,
      captureTarget: null,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    if (gesture.axis === "pending") {
      const intentX = event.clientX - gesture.startX;
      const intentY = event.clientY - gesture.startY;
      if (Math.max(Math.abs(intentX), Math.abs(intentY)) < POINTER_INTENT_PX) return;
      gesture.axis = Math.abs(intentX) > Math.abs(intentY) ? "horizontal" : "vertical";
      if (gesture.axis === "vertical") return;

      stopSpring();
      wheelGestureRef.current = null;
      clearInteractionTimers();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        pointerGestureRef.current = null;
        writeOffset(0);
        hideMotion();
        return;
      }

      gesture.dragging = true;
      gesture.captureTarget = event.currentTarget;
      suppressSwipeClickRef.current = true;
      showMotion();
    }
    if (gesture.axis !== "horizontal") return;

    const now = window.performance.now();
    const elapsed = Math.max(1, now - gesture.lastAt);
    const previousOffset = offsetRef.current;
    const currentOffset = advanceOffset(previousOffset, event.clientX - gesture.lastX);
    const offsetDelta = currentOffset - previousOffset;
    gesture.velocity = blendGestureVelocity(gesture.velocity, offsetDelta / elapsed, elapsed);
    updateReturnIntent(gesture, offsetDelta, currentOffset);
    gesture.lastX = event.clientX;
    gesture.lastAt = now;
    writeOffset(currentOffset);
    if (event.cancelable) event.preventDefault();
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    finishPointerGesture(gesture, event);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerGestureRef.current?.pointerId === event.pointerId) snapToCommittedPage();
  }

  function handleLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    // Implicit capture on a child button is released when the viewport takes
    // over a drag; that bubbled event does not mean the viewport lost capture.
    if (event.target !== event.currentTarget) return;
    if (pointerGestureRef.current?.pointerId === event.pointerId) snapToCommittedPage();
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressSwipeClickRef.current || event.detail === 0) return;
    suppressSwipeClickRef.current = false;
    if (clickResetTimerRef.current !== null) window.clearTimeout(clickResetTimerRef.current);
    clickResetTimerRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  }

  function scheduleWheelRelease() {
    clearWheelIdleTimer();
    const gesture = wheelGestureRef.current;
    const isEdgeReturn = gesture?.axis === "horizontal" && (
      (offsetRef.current > 0 && pageRef.current === 0)
      || (offsetRef.current < 0 && pageRef.current === pageCount - 1)
    );
    wheelIdleTimerRef.current = window.setTimeout(() => {
      wheelIdleTimerRef.current = null;
      const finishedGesture = wheelGestureRef.current;
      if (!finishedGesture) return;
      wheelGestureRef.current = null;
      const elapsed = Math.max(0, window.performance.now() - finishedGesture.lastAt);
      const velocity = finishedGesture.velocity * Math.exp(-elapsed / 80);
      let tailDirection = finishedGesture.lastDirection;
      if (finishedGesture.axis === "horizontal") {
        const pageDelta = chooseTarget(velocity, finishedGesture.returning);
        startSettle(pageDelta, velocity * 1000);
        if (pageDelta !== 0) tailDirection = -pageDelta as -1 | 1;
      }
      startWheelTailGuard(finishedGesture.axis, tailDirection);
    }, isEdgeReturn ? EDGE_WHEEL_IDLE_MS : WHEEL_IDLE_MS);
  }

  function handleWheel(event: WheelEvent) {
    if (event.ctrlKey) return;
    const momentum = (event as WheelEvent & { momentum?: boolean }).momentum;
    if (!event.cancelable) {
      const tailAxis = wheelTailAxisRef.current;
      if (tailAxis && (event.deltaX !== 0 || event.deltaY !== 0)) {
        wheelTailReversalRef.current = 0;
        startWheelTailGuard(tailAxis, wheelTailDirectionRef.current);
      }
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;

    const lineScale = event.deltaMode === 1 ? 16 : 1;
    const pageScaleX = event.deltaMode === 2 ? trackRef.current?.clientWidth || 1 : lineScale;
    const pageScaleY = event.deltaMode === 2 ? viewport.clientHeight || 1 : lineScale;
    const deltaX = event.deltaX * pageScaleX;
    const deltaY = event.deltaY * pageScaleY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (absX === 0 && absY === 0) return;

    let tailAxis = wheelTailAxisRef.current;
    if (tailAxis) {
      let reversedTailInput = false;
      if (tailAxis === "horizontal" && (momentum === true || (absX > 0 && Math.sign(-deltaX) === wheelTailDirectionRef.current))) {
        wheelTailReversalRef.current = 0;
      }
      if (tailAxis === "horizontal" && momentum !== true && absX > absY && wheelTailDirectionRef.current !== 0) {
        if (Math.sign(-deltaX) !== wheelTailDirectionRef.current) {
          wheelTailReversalRef.current += absX;
          reversedTailInput = springMotionRef.current?.targetPageDelta === 0
            || wheelTailReversalRef.current >= POINTER_INTENT_PX;
        } else {
          wheelTailReversalRef.current = 0;
        }
      }
      const horizontalStartAfterVertical = tailAxis === "vertical" && momentum !== true && absX > absY;
      // momentum=false also describes physical packets from the original
      // swipe; it cannot by itself identify a new gesture after arrival.
      if (reversedTailInput || horizontalStartAfterVertical || (tailAxis === "vertical" && momentum === false)) {
        clearWheelTailGuard();
        tailAxis = null;
      } else {
        if (tailAxis === "horizontal" && event.cancelable) event.preventDefault();
        startWheelTailGuard(tailAxis, wheelTailDirectionRef.current);
        return;
      }
    }

    let activeGesture = wheelGestureRef.current;
    if (momentum === true) {
      if (!activeGesture) {
        const axis: WheelAxis = absX > absY ? "horizontal" : "vertical";
        if (axis === "horizontal" && event.cancelable) event.preventDefault();
        startWheelTailGuard(axis, 0);
        return;
      }
      if (activeGesture.axis === "horizontal" && event.cancelable) event.preventDefault();
      clearWheelIdleTimer();
      wheelGestureRef.current = null;
      if (activeGesture.axis === "horizontal") {
        const elapsed = Math.max(0, window.performance.now() - activeGesture.lastAt);
        const velocity = activeGesture.velocity * Math.exp(-elapsed / 80);
        const pageDelta = chooseTarget(velocity, activeGesture.returning);
        startSettle(pageDelta, velocity * 1000);
        startWheelTailGuard("horizontal", pageDelta !== 0 ? -pageDelta as -1 | 1 : activeGesture.lastDirection);
      } else {
        startWheelTailGuard(activeGesture.axis, activeGesture.lastDirection);
      }
      return;
    }

    let firstSample = false;
    if (!activeGesture) {
      const axis: WheelAxis = absX > absY ? "horizontal" : "vertical";
      activeGesture = {
        axis,
        lastAt: window.performance.now(),
        velocity: 0,
        lastDirection: 0,
        reversalDistance: 0,
        returning: false,
      };
      wheelGestureRef.current = activeGesture;
      firstSample = true;
      if (axis === "horizontal") {
        stopSpring();
        const pointer = pointerGestureRef.current;
        pointerGestureRef.current = null;
        releasePointerCapture(pointer);
        clearWheelTailGuard();
      }
    }

    const now = window.performance.now();
    if (activeGesture.axis === "horizontal") {
      if (event.cancelable) event.preventDefault();
      if (event.cancelable) {
        const previousOffset = offsetRef.current;
        const currentOffset = advanceOffset(previousOffset, -deltaX);
        const offsetDelta = currentOffset - previousOffset;
        if (!firstSample) {
          const elapsed = Math.max(1, now - activeGesture.lastAt);
          activeGesture.velocity = blendGestureVelocity(activeGesture.velocity, offsetDelta / elapsed, elapsed);
        }
        updateReturnIntent(activeGesture, offsetDelta, currentOffset);
        if (offsetDelta !== 0) {
          writeOffset(currentOffset);
          showMotion();
        }
      }
    }
    activeGesture.lastAt = now;
    scheduleWheelRelease();
  }

  function handlePageButton(pageDelta: -1 | 1) {
    if (pageDelta < 0 && !canPrevious || pageDelta > 0 && !canNext) return;
    startSettle(pageDelta, 0, true);
  }

  const handleWheelEvent = useEffectEvent(handleWheel);
  const cancelInteraction = useEffectEvent(snapToCommittedPage);

  const resetMotionPreference = useEffectEvent((preference: boolean) => {
    reducedMotionRef.current = preference;
    const pointer = pointerGestureRef.current;
    pointerGestureRef.current = null;
    releasePointerCapture(pointer);
    wheelGestureRef.current = null;
    clearInteractionTimers();
    stopSpring();
    writeOffset(0);
  });

  useLayoutEffect(() => {
    resetMotionPreference(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handleWheelEvent, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheelEvent);
      clearWheelIdleTimer();
      clearWheelTailGuard();
    };
  }, []);

  useEffect(() => {
    const cancelToCurrentPage = () => cancelInteraction();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") cancelToCurrentPage();
    };

    window.addEventListener("blur", cancelToCurrentPage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelToCurrentPage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const track = trackRef.current;
    if (!track) return;
    let lastWidth = track.clientWidth;
    const handleResize = (width: number) => {
      if (width === lastWidth) return;
      lastWidth = width;
      cancelInteraction();
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) handleResize(Math.round(entry.contentRect.width));
      });
      observer.observe(track);
      return () => observer.disconnect();
    }

    const onWindowResize = () => handleResize(track.clientWidth);
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  useEffect(() => () => {
    const pointer = pointerGestureRef.current;
    pointerGestureRef.current = null;
    releasePointerCapture(pointer);
    clearWheelIdleTimer();
    clearWheelTailGuard();
    stopSpring();
    if (clickResetTimerRef.current !== null) window.clearTimeout(clickResetTimerRef.current);
    if (trackRef.current) trackRef.current.style.transform = "translate3d(0px, 0, 0)";
  }, []);

  const neighborPages = motionVisible
    ? [
        ...(canPrevious ? [{ page: currentPage - 1, direction: "previous" as const }] : []),
        ...(canNext ? [{ page: currentPage + 1, direction: "next" as const }] : []),
      ]
    : [];

  function renderList(page: number, neighborDirection?: "previous" | "next") {
    const start = page * PRIORITIES_PER_PAGE;
    const pageAssignments = assignments.slice(start, start + PRIORITIES_PER_PAGE);
    const isNeighbor = neighborDirection !== undefined;

    return (
      <ol
        key={isNeighbor ? `neighbor-${neighborDirection}` : "current"}
        id={isNeighbor ? undefined : "dashboard-priority-list"}
        className={`dashboard-focus-list${isNeighbor ? ` dashboard-focus-list--neighbor dashboard-focus-list--${neighborDirection}` : ""}`}
        start={start + 1}
        aria-label="Prioritized assignments"
        aria-hidden={isNeighbor || undefined}
        inert={isNeighbor || undefined}
        data-priority-neighbor={neighborDirection}
      >
        {pageAssignments.map((assignment, index) => {
          const globalIndex = start + index;
          return (
            <li
              key={assignment.id}
              className={globalIndex === 0 ? "dashboard-focus-priority-first" : undefined}
              aria-posinset={globalIndex + 1}
              aria-setsize={assignments.length}
            >
              <button type="button" className="dashboard-focus-item" onClick={() => onSelectAssignment(assignment)}>
                <span className="dashboard-focus-number">{String(globalIndex + 1).padStart(2, "0")}</span>
                <span className="dashboard-focus-label">
                  <strong>{assignment.title}</strong>
                  <small>{courseCodeFor(assignment.courseId)} · {assignment.dateKey ? assignment.due : "No due date"}</small>
                  <span className="dashboard-focus-rationale">{priorityAdvice(assignment)}</span>
                </span>
                {renderStatusBadge(assignment.status)}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div className="dashboard-priority-carousel" data-priority-carousel>
      <div
        ref={viewportRef}
        className="dashboard-focus-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onClickCapture={handleClickCapture}
      >
        <div
          ref={trackRef}
          className={`dashboard-focus-track${motionVisible ? " dashboard-focus-track--moving" : ""}`}
        >
          {renderList(currentPage)}
          {neighborPages.map(({ page, direction }) => renderList(page, direction))}
        </div>
      </div>
      {assignments.length > PRIORITIES_PER_PAGE && (
        <div className="dashboard-focus-pagination" role="group" aria-label="Priority pages">
          <button
            type="button"
            className="dashboard-focus-page-button"
            aria-label="Previous priorities"
            aria-controls="dashboard-priority-list"
            disabled={!canPrevious}
            onClick={() => handlePageButton(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="dashboard-focus-range" aria-live="polite" aria-atomic="true">
            {rangeLabel}
          </span>
          <button
            type="button"
            className="dashboard-focus-page-button"
            aria-label="Next priorities"
            aria-controls="dashboard-priority-list"
            disabled={!canNext}
            onClick={() => handlePageButton(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function PriorityCarousel(props: Props) {
  const sequence = JSON.stringify(props.assignments.map((assignment) => assignment.id));
  return <PriorityCarouselSession key={sequence} {...props} />;
}
