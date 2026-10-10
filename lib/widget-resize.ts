import { getWidgetSizeFootprint, widgetSizes, type WidgetSize } from "./widget-layout";

type WidgetResizeInput = {
  width: number;
  height: number;
  unit: number;
  gap: number;
  previousSize: WidgetSize;
  hysteresisPx?: number;
};

const widgetSizeSet = new Set<string>(widgetSizes);

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
