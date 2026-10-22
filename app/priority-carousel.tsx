import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { SavedAssignment } from "../lib/workspace-codec";
import {
  PriorityCarouselController,
  type PriorityCarouselSnapshot,
} from "../lib/priority-carousel-controller";

const PRIORITIES_PER_PAGE = 2;
const PAGE_GAP_PX = 8;

type Props = {
  assignments: SavedAssignment[];
  courseCodeFor: (courseId: string) => string;
  renderStatusBadge: (status: SavedAssignment["status"]) => ReactNode;
  onSelectAssignment: (assignment: SavedAssignment) => void;
  reducedMotion: boolean;
};

function priorityAdvice(assignment: SavedAssignment) {
  if (assignment.status === "overdue") return "Clear this first to get back on track.";
  if (assignment.status === "today") return "Make time for this before the day ends.";
  return "Get a head start on your next deadline.";
}

function releasePointerCapture(viewport: HTMLDivElement | null, pointerId: number) {
  if (!viewport) return;
  try {
    if (viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
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
  const pageCount = Math.max(1, Math.ceil(assignments.length / PRIORITIES_PER_PAGE));
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<PriorityCarouselController | null>(null);
  const [snapshot, setSnapshot] = useState<PriorityCarouselSnapshot>({
    page: 0,
    selectedPage: 0,
    phase: { type: "idle" },
    motionVisible: false,
  });

  useLayoutEffect(() => {
    const track = trackRef.current;
    const width = Math.max(1, track?.clientWidth ?? viewportRef.current?.clientWidth ?? 1);
    const instance = new PriorityCarouselController({
      pageCount,
      width,
      pageGap: PAGE_GAP_PX,
      reducedMotion: false,
      now: () => window.performance.now(),
      requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
      cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
      onSnapshot: (nextSnapshot, atomicCommit) => {
        if (atomicCommit) flushSync(() => setSnapshot(nextSnapshot));
        else setSnapshot(nextSnapshot);
      },
      onOffset: (offset) => {
        const track = trackRef.current;
        if (track) track.style.transform = `translate3d(${offset}px, 0, 0)`;
      },
    });
    controllerRef.current = instance;
    setSnapshot(instance.getSnapshot());
    return () => {
      releasePointerIds(instance.destroy());
      if (controllerRef.current === instance) controllerRef.current = null;
      if (track) track.style.transform = "translate3d(0px, 0, 0)";
    };
  }, [pageCount]);

  const currentPage = Math.min(snapshot.page, pageCount - 1);
  const selectedPage = Math.min(snapshot.selectedPage, pageCount - 1);
  const phase = snapshot.phase.type;
  const isTransitioning = phase === "settling";
  const motionVisible = snapshot.motionVisible && !reducedMotion;
  const canPrevious = currentPage > 0;
  const canNext = currentPage < pageCount - 1;

  function releasePointerIds(pointerIds: number[]) {
    for (const pointerId of pointerIds) releasePointerCapture(viewportRef.current, pointerId);
  }

  function capturePointer(pointerId: number) {
    const viewport = viewportRef.current;
    if (!viewport) return false;
    try {
      viewport.setPointerCapture(pointerId);
      return true;
    } catch {
      return false;
    }
  }

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    const activeController = controllerRef.current;
    if (!activeController) return;
    const result = activeController.pointerDown({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      isPrimary: event.isPrimary,
      pointerType: event.pointerType,
      button: event.button,
    });
    if (result.capturePointer && !capturePointer(event.pointerId)) {
      // Keep the gesture quarantined even when pointer capture is unavailable.
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const activeController = controllerRef.current;
    if (!activeController) return;
    const result = activeController.pointerMove({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    if (result.capturePointer && !capturePointer(event.pointerId)) {
      releasePointerIds([activeController.pointerCancel(event.pointerId).releasePointerId ?? event.pointerId]);
      return;
    }
    if (result.preventDefault && event.cancelable) event.preventDefault();
  }

  function handlePointerUpCapture(event: ReactPointerEvent<HTMLDivElement>) {
    const activeController = controllerRef.current;
    if (!activeController) return;
    const result = activeController.pointerUp({ pointerId: event.pointerId, x: event.clientX });
    if (result.releasePointerId !== null) releasePointerCapture(viewportRef.current, result.releasePointerId);
  }

  function handlePointerCancelCapture(event: ReactPointerEvent<HTMLDivElement>) {
    const activeController = controllerRef.current;
    if (!activeController) return;
    const result = activeController.pointerCancel(event.pointerId);
    if (result.releasePointerId !== null) releasePointerCapture(viewportRef.current, result.releasePointerId);
  }

  function handleLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    // A child button may release its implicit capture when the viewport takes
    // over a horizontal drag. That bubbled event is not a viewport cancellation.
    if (event.target !== event.currentTarget) return;
    const activeController = controllerRef.current;
    if (!activeController) return;
    const result = activeController.lostPointerCapture(event.pointerId);
    if (result.releasePointerId !== null) releasePointerCapture(viewportRef.current, result.releasePointerId);
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    const activeController = controllerRef.current;
    if (!activeController?.shouldSuppressClick(event.detail)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  const handleWheel = useEffectEvent((event: WheelEvent) => {
    const activeController = controllerRef.current;
    if (!activeController) return;
    if (event.ctrlKey) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const lineScale = event.deltaMode === 1 ? 16 : 1;
    const pageScaleX = event.deltaMode === 2 ? trackRef.current?.clientWidth || 1 : lineScale;
    const pageScaleY = event.deltaMode === 2 ? viewport.clientHeight || 1 : lineScale;
    const wheelEvent = event as WheelEvent & { momentum?: boolean };
    const momentum = "momentum" in event && typeof wheelEvent.momentum === "boolean"
      ? wheelEvent.momentum
      : undefined;
    const result = activeController.wheel({
      deltaX: event.deltaX * pageScaleX,
      deltaY: event.deltaY * pageScaleY,
      cancelable: event.cancelable,
      momentum,
    });
    releasePointerIds(result.releasePointerIds);
    if (result.preventDefault && event.cancelable) event.preventDefault();
  });

  const cancelInteraction = useEffectEvent(() => {
    const activeController = controllerRef.current;
    if (activeController) releasePointerIds(activeController.cancel());
  });

  useLayoutEffect(() => {
    const activeController = controllerRef.current;
    if (!activeController) return;
    const pointerIds = activeController.setReducedMotion(reducedMotion);
    releasePointerIds(pointerIds);
    const width = Math.max(1, trackRef.current?.clientWidth ?? viewportRef.current?.clientWidth ?? 1);
    releasePointerIds(activeController.setGeometry({ pageCount, width }));
  }, [pageCount, reducedMotion]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") cancelInteraction();
    };
    window.addEventListener("blur", cancelInteraction);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelInteraction);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    const activeController = controllerRef.current;
    if (!track || !activeController) return;
    let lastWidth = track.clientWidth;
    const handleResize = (width: number) => {
      if (width === lastWidth) return;
      lastWidth = width;
      releasePointerIds(activeController.setGeometry({ pageCount, width }));
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
  }, [pageCount]);

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
    <div
      className="dashboard-priority-carousel"
      data-priority-carousel
      data-committed-page={currentPage + 1}
      data-transitioning={isTransitioning ? "true" : "false"}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onPointerCancelCapture={handlePointerCancelCapture}
      onClickCapture={handleClickCapture}
    >
      <div
        ref={viewportRef}
        className="dashboard-focus-viewport"
        onPointerMove={handlePointerMove}
        onLostPointerCapture={handleLostPointerCapture}
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
            disabled={!canPrevious || phase !== "idle"}
            onClick={() => {
              const activeController = controllerRef.current;
              if (activeController) releasePointerIds(activeController.navigate(-1).releasePointerIds);
            }}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <div
            className="dashboard-focus-page-dots"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-page={selectedPage + 1}
            data-page-count={pageCount}
          >
            <span className="sr-only">Page {selectedPage + 1} of {pageCount}</span>
            {Array.from({ length: pageCount }, (_, page) => (
              <span
                key={page}
                className={`dashboard-focus-page-dot${page === selectedPage ? " dashboard-focus-page-dot--active" : ""}`}
                aria-hidden="true"
              />
            ))}
          </div>
          <button
            type="button"
            className="dashboard-focus-page-button"
            aria-label="Next priorities"
            aria-controls="dashboard-priority-list"
            disabled={!canNext || phase !== "idle"}
            onClick={() => {
              const activeController = controllerRef.current;
              if (activeController) releasePointerIds(activeController.navigate(1).releasePointerIds);
            }}
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
