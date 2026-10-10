import { getWidgetSizeFootprint, widgetSizes, type WidgetSize } from "./widget-layout";

type WidgetResizeInput = {
  width: number;
  height: number;
  unit: number;
  gap: number;
  previousSize: WidgetSize;
  hysteresisPx?: number;
};

export type WidgetResizeGeometry = { width: number; height: number; blurPx: number };

const widgetSizeSet = new Set<string>(widgetSizes);

export function getWidgetResizeContentFilter(blurPx: number): string {
  const amount = Number.isFinite(blurPx) ? Math.min(8, Math.max(0, blurPx)) : 0;
  return `blur(${amount}px) saturate(${1 + amount * 0.03}) brightness(${1 + amount * 0.0125})`;
}

function isWidgetSize(size: string): size is WidgetSize {
  return widgetSizeSet.has(size);
}

function getPhysicalSize(size: WidgetSize, unit: number, gap: number) {
  const footprint = getWidgetSizeFootprint(size);
  return {
    width: footprint.width * unit + (footprint.width - 1) * gap,
    height: footprint.height * unit + (footprint.height - 1) * gap,
  };
}

function distance(width: number, height: number, otherWidth: number, otherHeight: number) {
  return Math.hypot(width - otherWidth, height - otherHeight);
}

export function getWidgetResizeSize({
  width,
  height,
  unit,
  gap,
  previousSize,
  hysteresisPx = 14,
}: WidgetResizeInput): WidgetSize {
  if (!isWidgetSize(previousSize)
    || ![width, height, unit, gap, hysteresisPx].every(Number.isFinite)
    || unit <= 0
    || gap < 0
    || gap >= unit) return previousSize;

  const requestedWidth = Math.max(0, width);
  const requestedHeight = Math.max(0, height);
  let bestSize: WidgetSize = widgetSizes[0];
  let bestDistance = Infinity;
  let previousDistance = Infinity;

  for (const size of widgetSizes) {
    const dimensions = getPhysicalSize(size, unit, gap);
    const candidateDistance = distance(requestedWidth, requestedHeight, dimensions.width, dimensions.height);
    if (size === previousSize) previousDistance = candidateDistance;
    if (candidateDistance < bestDistance) {
      bestSize = size;
      bestDistance = candidateDistance;
    }
  }

  return previousDistance <= bestDistance + Math.max(0, hysteresisPx) ? previousSize : bestSize;
}

export function getWidgetPointerResizeSize({
  width,
  height,
  deltaX,
  deltaY,
  ...input
}: WidgetResizeInput & { deltaX: number; deltaY: number }): WidgetSize {
  return getWidgetResizeSize({
    ...input,
    width: width + deltaX,
    height: height + deltaY,
  });
}

function getRubberBandedDimension(
  original: number,
  delta: number,
  minimum: number,
  maximum: number,
  unit: number,
) {
  const effectiveMinimum = Math.min(minimum, original);
  const effectiveMaximum = Math.max(maximum, original);
  const maximumResistance = unit * 0.15;
  const requested = original + delta;
  if (!Number.isFinite(requested)) {
    return delta < 0 ? effectiveMinimum - Math.min(maximumResistance, effectiveMinimum) : effectiveMaximum + maximumResistance;
  }
  if (requested < effectiveMinimum) {
    const resistance = Math.min(maximumResistance, effectiveMinimum);
    const overshoot = effectiveMinimum - requested;
    return effectiveMinimum - Math.min(resistance, resistance * -Math.expm1(-overshoot / resistance));
  }
  if (requested > effectiveMaximum) {
    const overshoot = requested - effectiveMaximum;
    return effectiveMaximum + Math.min(maximumResistance, maximumResistance * -Math.expm1(-overshoot / maximumResistance));
  }
  return requested;
}

export function getWidgetPointerResizeGeometry({
  width,
  height,
  deltaX,
  deltaY,
  unit,
  gap,
  previousSize,
  hysteresisPx = 14,
}: WidgetResizeInput & { deltaX: number; deltaY: number }): WidgetResizeGeometry {
  const original = { width, height, blurPx: 0 };
  if (!isWidgetSize(previousSize)
    || ![width, height, deltaX, deltaY, unit, gap, hysteresisPx].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || unit <= 0
    || gap < 0
    || gap >= unit) return original;

  const minimumHeight = (unit - gap) / 2;
  const maximumDimension = unit * 2 + gap;
  const maximumResistance = unit * 0.15;
  if (![minimumHeight, maximumDimension, maximumDimension + maximumResistance].every(Number.isFinite)) return original;

  const nextWidth = getRubberBandedDimension(width, deltaX, unit, maximumDimension, unit);
  const nextHeight = getRubberBandedDimension(height, deltaY, minimumHeight, maximumDimension, unit);
  const blurPx = Math.min(8, Math.hypot(nextWidth - width, nextHeight - height) / unit * 8);
  if (![nextWidth, nextHeight, blurPx].every(Number.isFinite)) return original;
  return { width: nextWidth, height: nextHeight, blurPx };
}

export function getWidgetKeyboardResizeSize(size: WidgetSize, key: string): WidgetSize {
  if (!isWidgetSize(size)) return size;

  const footprint = getWidgetSizeFootprint(size);
  let targetWidth = footprint.width;
  let targetHeight = footprint.height;

  if (key === "ArrowRight") {
    if (footprint.width >= 2) return size;
    targetWidth = 2;
  } else if (key === "ArrowLeft") {
    if (footprint.width <= 1) return size;
    targetWidth = 1;
  } else if (key === "ArrowDown") {
    if (footprint.height >= 2) return size;
    targetHeight = footprint.height === 0.5 ? 1 : 2;
  } else if (key === "ArrowUp") {
    if (footprint.height <= 0.5) return size;
    targetHeight = footprint.height === 2 ? 1 : 0.5;
  } else {
    return size;
  }

  let nearestSize = size;
  let nearestDistance = Infinity;
  for (const candidate of widgetSizes) {
    const candidateFootprint = getWidgetSizeFootprint(candidate);
    const candidateDistance = distance(targetWidth, targetHeight, candidateFootprint.width, candidateFootprint.height);
    if (candidateDistance < nearestDistance) {
      nearestSize = candidate;
      nearestDistance = candidateDistance;
    }
  }

  return nearestSize;
}
