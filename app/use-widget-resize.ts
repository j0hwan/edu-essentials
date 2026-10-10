"use client";

import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { WidgetInstance } from "../lib/workspace-codec";
import { getWidgetSizeFootprint, type WidgetSize } from "../lib/widget-layout";
import { getWidgetResizeSize } from "../lib/widget-resize";

type WidgetResizePreview = { widgetId: string; size: WidgetSize };

type UseWidgetResizeOptions = {
  host: RefObject<HTMLDivElement | null>;
  items: readonly WidgetInstance[];
  enabled: boolean;
  contextKey: string;
  onResize?: (id: string, size: WidgetSize) => boolean;
  onResizeStart?: () => void;
};

type ResizeSession = {
  pointerId: number;
  captureTarget: HTMLDivElement;
  source: HTMLElement;
  widgetId: string;
  contextKey: string;
  itemsSnapshot: string;
  originalSize: WidgetSize;
  currentSize: WidgetSize;
  startX: number;
  startY: number;
  width: number;
  height: number;
  unit: number;
  gap: number;
  activated: boolean;
  finish: (resetPreview?: boolean) => void;
};

function getItemsSnapshot(items: readonly WidgetInstance[]) {
  return JSON.stringify(items) ?? "";
}

function measureGridUnit(grid: HTMLElement) {
  const gridStyle = window.getComputedStyle(grid);
  const parsedGap = Number.parseFloat(gridStyle.columnGap);
  const parsedFallbackGap = Number.parseFloat(gridStyle.getPropertyValue("--widget-gap"));
  const gap = Number.isFinite(parsedGap)
    ? parsedGap
    : Number.isFinite(parsedFallbackGap) ? parsedFallbackGap : 16;
  const configuredColumns = Number.parseInt(gridStyle.getPropertyValue("--widget-columns"), 10);
  const columns: 2 | 4 = configuredColumns === 2 || configuredColumns === 4
    ? configuredColumns
    : window.innerWidth <= 600 ? 2 : 4;
  const configuredUnit = Number.parseFloat(gridStyle.getPropertyValue("--widget-unit"));
  const gridWidth = grid.getBoundingClientRect().width || grid.clientWidth;
  const unit = configuredUnit > 0
    ? configuredUnit
    : Math.max(0, (gridWidth - gap * (columns - 1)) / columns);
  return { unit, gap };
}

function releasePointerCapture(target: HTMLDivElement, pointerId: number) {
  try {
    target.releasePointerCapture?.(pointerId);
  } catch {
    return;
  }
}

function setPointerCapture(target: HTMLDivElement, pointerId: number) {
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    return;
  }
}

export function useWidgetResize({
  host,
  items,
  enabled,
  contextKey,
  onResize,
  onResizeStart,
}: UseWidgetResizeOptions) {
  const [preview, setPreview] = useState<WidgetResizePreview | null>(null);
  const activeSessionRef = useRef<ResizeSession | null>(null);
  const clickCleanupRef = useRef<(() => void) | null>(null);
  const itemsSnapshot = getItemsSnapshot(items);
  const latestRef = useRef({ host, items, itemsSnapshot, enabled, contextKey, onResize, onResizeStart });
  const canResize = enabled && Boolean(onResize);

  useLayoutEffect(() => {
    latestRef.current = { host, items, itemsSnapshot, enabled, contextKey, onResize, onResizeStart };
  }, [host, items, itemsSnapshot, enabled, contextKey, onResize, onResizeStart]);

  useLayoutEffect(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    if (!canResize || session.contextKey !== contextKey || session.itemsSnapshot !== itemsSnapshot) {
      session.finish();
    }
  }, [canResize, contextKey, itemsSnapshot]);

  useLayoutEffect(() => () => {
    activeSessionRef.current?.finish(false);
    clickCleanupRef.current?.();
  }, []);

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>("[data-widget-resize-handle]");
    const captureTarget = host.current;
    if (!handle || !captureTarget || !captureTarget.contains(handle)) return false;

    if (!canResize || event.button !== 0 || !event.isPrimary) return true;

    const source = handle.closest<HTMLElement>("[data-widget-id]");
    if (!source || !captureTarget.contains(source)) return true;
    const widgetId = source.dataset.widgetId;
    const item = widgetId ? items.find((candidate) => candidate.instanceId === widgetId) : undefined;
    const grid = captureTarget.querySelector<HTMLElement>(".widget-grid");
    if (!widgetId || !item || !grid) return true;

    const { unit, gap } = measureGridUnit(grid);
    if (unit <= 0) return true;
    const footprint = getWidgetSizeFootprint(item.size);

    activeSessionRef.current?.finish();
    clickCleanupRef.current?.();

    let clickTimeout: number | undefined;
    const cleanupClick = () => {
      window.removeEventListener("click", suppressClick, true);
      window.removeEventListener("pointerdown", cleanupClick, true);
      window.removeEventListener("pointerup", guardRelease, true);
      window.removeEventListener("pointercancel", guardRelease, true);
      window.clearTimeout(clickTimeout);
      clickCleanupRef.current = null;
    };
    const suppressClick = (clickEvent: MouseEvent) => {
      if (clickEvent.detail === 0) return;
      const matchesPointer = !("pointerId" in clickEvent) || clickEvent.pointerId === event.pointerId;
      const target = clickEvent.target;
      const matchesTarget = target instanceof window.Node && (target === captureTarget || source.contains(target));
      cleanupClick();
      if (!matchesPointer || !matchesTarget) return;
      clickEvent.preventDefault();
      clickEvent.stopImmediatePropagation();
    };
    const guardRelease = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      window.clearTimeout(clickTimeout);
      clickTimeout = window.setTimeout(cleanupClick, 500);
    };
    clickCleanupRef.current = cleanupClick;
    window.addEventListener("click", suppressClick, true);
    window.addEventListener("pointerdown", cleanupClick, true);
    window.addEventListener("pointerup", guardRelease, true);
    window.addEventListener("pointercancel", guardRelease, true);

    const session: ResizeSession = {
      pointerId: event.pointerId,
      captureTarget,
      source,
      widgetId,
      contextKey,
      itemsSnapshot,
      originalSize: item.size,
      currentSize: item.size,
      startX: event.clientX,
      startY: event.clientY,
      width: footprint.width * unit + (footprint.width - 1) * gap,
      height: footprint.height * unit + (footprint.height - 1) * gap,
      unit,
      gap,
      activated: false,
      finish: () => undefined,
    };

    const isSessionValid = () => {
      const latest = latestRef.current;
      return latest.enabled
        && Boolean(latest.onResize)
        && latest.host.current === session.captureTarget
        && latest.contextKey === session.contextKey
        && latest.itemsSnapshot === session.itemsSnapshot
        && session.captureTarget.contains(session.source)
        && session.source.isConnected
        && latest.items.some((candidate) => candidate.instanceId === session.widgetId
          && candidate.size === session.originalSize);
    };

    const updateSize = (pointerEvent: PointerEvent, preventDefault: boolean) => {
      const deltaX = pointerEvent.clientX - session.startX;
      const deltaY = pointerEvent.clientY - session.startY;
      if (!session.activated) {
        if (Math.hypot(deltaX, deltaY) < 5) return;
        session.activated = true;
        setPreview({ widgetId: session.widgetId, size: session.originalSize });
      }
      if (preventDefault && pointerEvent.cancelable) pointerEvent.preventDefault();

      const nextSize = getWidgetResizeSize({
        width: session.width + deltaX,
        height: session.height + deltaY,
        unit: session.unit,
        gap: session.gap,
        previousSize: session.currentSize,
      });
      if (nextSize === session.currentSize) return;
      session.currentSize = nextSize;
      setPreview({ widgetId: session.widgetId, size: nextSize });
    };

    const removeListeners = () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("blur", onBlur, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onWindowResize, true);
      captureTarget.removeEventListener("lostpointercapture", onLostPointerCapture, true);
      releasePointerCapture(captureTarget, session.pointerId);
      if (activeSessionRef.current === session) activeSessionRef.current = null;
    };

    const finish = (commit = false, resetPreview = true) => {
      if (activeSessionRef.current !== session) return;
      const valid = commit && session.activated && session.currentSize !== session.originalSize && isSessionValid();
      const finalSize = session.currentSize;
      removeListeners();
      if (resetPreview) setPreview(null);
      if (valid) latestRef.current.onResize?.(session.widgetId, finalSize);
    };
    session.finish = (resetPreview = true) => finish(false, resetPreview);

    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== session.pointerId) return;
      if (typeof pointerEvent.buttons === "number" && pointerEvent.buttons === 0 || !isSessionValid()) {
        finish();
        return;
      }
      updateSize(pointerEvent, true);
    };
    const onPointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== session.pointerId) return;
      if (!isSessionValid()) {
        finish();
        return;
      }
      updateSize(pointerEvent, false);
      const openSizeChoices = !session.activated;
      finish(true);
      if (openSizeChoices && handle.isConnected) handle.click();
    };
    const onPointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === session.pointerId) finish();
    };
    const onLostPointerCapture = (pointerEvent: PointerEvent) => {
      if (pointerEvent.target === session.captureTarget && pointerEvent.pointerId === session.pointerId) finish();
    };
    const onBlur = () => finish();
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        finish();
      }
    };
    const onWindowResize = () => finish();

    activeSessionRef.current = session;
    event.preventDefault();
    latestRef.current.onResizeStart?.();
    if (activeSessionRef.current !== session || !isSessionValid()) {
      if (activeSessionRef.current === session) finish();
      return true;
    }
    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("blur", onBlur, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onWindowResize, true);
    captureTarget.addEventListener("lostpointercapture", onLostPointerCapture, true);
    setPointerCapture(captureTarget, session.pointerId);
    return true;
  };

  const cancelResize = useCallback(() => {
    if (activeSessionRef.current) activeSessionRef.current.finish();
    else setPreview(null);
  }, []);

  return { preview, beginResize, cancelResize, isResizing: Boolean(preview) };
}
