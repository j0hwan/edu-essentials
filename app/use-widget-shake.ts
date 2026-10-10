"use client";

import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export function useWidgetShake(contextKey: string, onActivate?: (start: PointerEvent, current: PointerEvent) => void) {
  const activateRef = useRef(onActivate);
  const cleanupRef = useRef<(() => void) | null>(null);
  const available = Boolean(onActivate);

  useLayoutEffect(() => {
    activateRef.current = onActivate;
  }, [onActivate]);

  useLayoutEffect(() => () => {
    cleanupRef.current?.();
  }, [available, contextKey]);

  return (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activateRef.current || event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary) return;
    const target = event.target instanceof Element ? event.target : null;
    const header = target?.closest<HTMLElement>(".widget-header");
    if (!header || !event.currentTarget.contains(header) || !header.closest("[data-widget-id]")) return;
    if (target?.closest("button, a, input, textarea, select, [role='button'], [contenteditable]:not([contenteditable='false'])")) return;

    cleanupRef.current?.();
    const startEvent = event.nativeEvent;
    const pointerId = event.pointerId;
    const startedAt = event.timeStamp;
    let extremeX = event.clientX;
    let extremeY = event.clientY;
    let directionX = 0;
    let directionY = 0;
    let reversals = 0;

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("keydown", keyDown);
      header.removeEventListener("lostpointercapture", end);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
      if (header.hasPointerCapture?.(pointerId)) header.releasePointerCapture(pointerId);
    };
    const move = (nativeEvent: PointerEvent) => {
      if (nativeEvent.pointerId !== pointerId) return;
      if (!(nativeEvent.buttons & 1) || nativeEvent.timeStamp - startedAt > 1200
        || !header.isConnected) {
        cleanup();
        return;
      }
      const deltaX = nativeEvent.clientX - extremeX;
      const deltaY = nativeEvent.clientY - extremeY;
      const distance = Math.hypot(deltaX, deltaY);
      const hasDirection = directionX !== 0 || directionY !== 0;
      const projection = deltaX * directionX + deltaY * directionY;
      if (hasDirection && projection > 0) {
        extremeX = nativeEvent.clientX;
        extremeY = nativeEvent.clientY;
        return;
      }
      if (distance < 18 || hasDirection && projection / distance > -0.5) return;
      if (hasDirection) reversals += 1;
      directionX = deltaX / distance;
      directionY = deltaY / distance;
      extremeX = nativeEvent.clientX;
      extremeY = nativeEvent.clientY;
      if (reversals < 2) return;
      cleanup();
      activateRef.current?.(startEvent, nativeEvent);
    };
    const end = (nativeEvent: PointerEvent) => {
      if (nativeEvent.pointerId === pointerId) cleanup();
    };
    const keyDown = (nativeEvent: KeyboardEvent) => {
      if (nativeEvent.key === "Escape") cleanup();
    };

    event.preventDefault();
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", cleanup);
    window.addEventListener("keydown", keyDown);
    header.addEventListener("lostpointercapture", end);
    try {
      header.setPointerCapture?.(pointerId);
    } catch {
      cleanup();
    }
  };
}
