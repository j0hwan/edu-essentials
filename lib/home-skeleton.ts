import { calculateWidgetPlacements, widgetSizes, type WidgetSize } from "./widget-layout";
import type { Workspace } from "./workspace-codec";

export type HomeSkeletonWidget = {
  size: WidgetSize;
  startsNewMiniBlock: boolean;
};

/** A visual-only snapshot of a Home workspace. It never contains widget data or IDs. */
export type HomeSkeletonLayout = {
  version: 1;
  widgets: HomeSkeletonWidget[];
  todayHidden: boolean;
  gap: number;
  /** Omitted for the common three-section Today layout. */
  todaySectionCount?: 1 | 2 | 3;
  /** Measured live chrome for an exact same-viewport hint; never authoritative. */
  geometry?: HomeSkeletonGeometry;
};

export type HomeSkeletonGeometry = {
  viewportWidth: number;
  contentWidth: number;
  todayHeight: number;
  toolbarHeight: number;
};

export type HomeSkeletonLayoutRead = {
  layout: HomeSkeletonLayout | null;
  readable: boolean;
};

/** Used for a brand new account or a browser with no valid local snapshot. */
export const DEFAULT_HOME_SKELETON_LAYOUT: HomeSkeletonLayout = {
  version: 1,
  widgets: [
    { size: "small", startsNewMiniBlock: false },
    { size: "mini", startsNewMiniBlock: false },
    { size: "mini", startsNewMiniBlock: false },
    { size: "medium", startsNewMiniBlock: false },
    { size: "small", startsNewMiniBlock: false },
    { size: "medium", startsNewMiniBlock: false },
    { size: "mini", startsNewMiniBlock: false },
    { size: "mini", startsNewMiniBlock: false },
    { size: "small", startsNewMiniBlock: false },
  ],
  todayHidden: false,
  gap: 16,
};

const cacheKeyPrefix = "edu-essentials:home-skeleton:v1:";
const validWidgetSizes = new Set<string>(widgetSizes);
const maxCachedWidgets = 100;

export type HomeSkeletonPlacement = ReturnType<typeof calculateWidgetPlacements>[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isHomeSkeletonLayout(value: unknown): value is HomeSkeletonLayout {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["version", "widgets", "todayHidden", "gap", "todaySectionCount", "geometry"])
    || value.version !== 1
    || !Array.isArray(value.widgets)
    || value.widgets.length > maxCachedWidgets
    || typeof value.todayHidden !== "boolean"
    || typeof value.gap !== "number"
    || !Number.isFinite(value.gap)
    || value.gap < 8
    || value.gap > 32) return false;

  if (value.todaySectionCount !== undefined
    && (typeof value.todaySectionCount !== "number"
      || !Number.isInteger(value.todaySectionCount)
      || value.todaySectionCount < 1
      || value.todaySectionCount > 3)) return false;
  if (value.geometry !== undefined) {
    const geometry = value.geometry;
    if (!isRecord(geometry)
      || !hasOnlyKeys(geometry, ["viewportWidth", "contentWidth", "todayHeight", "toolbarHeight"])
      || typeof geometry.viewportWidth !== "number"
      || !Number.isFinite(geometry.viewportWidth)
      || geometry.viewportWidth < 180
      || geometry.viewportWidth > 10000
      || typeof geometry.contentWidth !== "number"
      || !Number.isFinite(geometry.contentWidth)
      || geometry.contentWidth < 180
      || geometry.contentWidth > 10000
      || typeof geometry.todayHeight !== "number"
      || !Number.isFinite(geometry.todayHeight)
      || geometry.todayHeight < 0
      || geometry.todayHeight > 2000
      || typeof geometry.toolbarHeight !== "number"
      || !Number.isFinite(geometry.toolbarHeight)
      || geometry.toolbarHeight < 0
      || geometry.toolbarHeight > 500) return false;
  }

  for (const widget of value.widgets) {
    if (!isRecord(widget)
      || !hasOnlyKeys(widget, ["size", "startsNewMiniBlock"])
      || typeof widget.size !== "string"
      || !validWidgetSizes.has(widget.size)
      || typeof widget.startsNewMiniBlock !== "boolean"
      || (widget.size !== "mini" && widget.startsNewMiniBlock !== false)) return false;
  }
  return true;
}

function normalizedGap(gap: number): number {
  return Number.isFinite(gap) ? Math.min(32, Math.max(8, gap)) : DEFAULT_HOME_SKELETON_LAYOUT.gap;
}

function cacheKey(accountId: string): string | null {
  if (!accountId.trim() || accountId.length > 200) return null;
  return `${cacheKeyPrefix}${encodeURIComponent(accountId)}`;
}

/** Convert an active live workspace to its content-free loading silhouette. */
export function createHomeSkeletonLayout(
  workspace: Pick<Workspace, "widgets" | "todayHidden" | "todaySections">,
  gap: number,
): HomeSkeletonLayout {
  const todaySectionCount = Math.max(1, Math.min(3, workspace.todaySections?.length ?? 3)) as 1 | 2 | 3;
  return {
    version: 1,
    widgets: workspace.widgets.map((widget) => ({
      size: widget.size,
      startsNewMiniBlock: widget.size === "mini" && Boolean(widget.startsNewMiniBlock),
    })),
    todayHidden: Boolean(workspace.todayHidden),
    gap: normalizedGap(gap),
    ...(todaySectionCount === 3 ? {} : { todaySectionCount }),
  };
}

/** Validate untrusted local storage and distinguish an empty cache from a failed read. */
export function readHomeSkeletonLayout(accountId: string): HomeSkeletonLayoutRead {
  const key = cacheKey(accountId);
  if (!key || typeof window === "undefined") return { layout: null, readable: false };

  let stored: string | null;
  try {
    stored = window.localStorage.getItem(key);
  } catch {
    return { layout: null, readable: false };
  }
  if (stored === null) return { layout: null, readable: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    // The storage read itself succeeded, so the malformed cache can be healed
    // after the server supplies the authoritative live shape.
    return { layout: null, readable: true };
  }
  return { layout: isHomeSkeletonLayout(parsed) ? parsed : null, readable: true };
}

/** Write only a validated shape under the signed-in account's own cache key. */
export function writeHomeSkeletonLayout(accountId: string, layout: HomeSkeletonLayout): boolean {
  const key = cacheKey(accountId);
  if (!key || typeof window === "undefined" || !isHomeSkeletonLayout(layout)) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

/** Uses the same placement rules as the live widget grid at both breakpoints. */
export function getHomeSkeletonPlacements(layout: HomeSkeletonLayout) {
  const sizes = layout.widgets.map((widget) => widget.size);
  const miniStarts = layout.widgets.map((widget) => widget.startsNewMiniBlock);
  return {
    desktop: calculateWidgetPlacements(sizes, 4, miniStarts),
    phone: calculateWidgetPlacements(sizes, 2, miniStarts),
  };
}

/** Compare every cached visual property while ignoring live-only widget identity and content. */
export function layoutsMatch(left: HomeSkeletonLayout, right: HomeSkeletonLayout): boolean {
  return left.version === right.version
    && left.todayHidden === right.todayHidden
    && (left.todaySectionCount ?? 3) === (right.todaySectionCount ?? 3)
    && left.gap === right.gap
    && left.widgets.length === right.widgets.length
    && left.widgets.every((widget, index) => widget.size === right.widgets[index].size
      && widget.startsNewMiniBlock === right.widgets[index].startsNewMiniBlock);
}

/** Include viewport-specific measurements when deciding whether to refresh storage. */
export function cacheLayoutsMatch(left: HomeSkeletonLayout, right: HomeSkeletonLayout): boolean {
  const geometryMatches = left.geometry === undefined && right.geometry === undefined
    || left.geometry !== undefined && right.geometry !== undefined
      && Math.abs(left.geometry.viewportWidth - right.geometry.viewportWidth) <= 1
      && Math.abs(left.geometry.contentWidth - right.geometry.contentWidth) <= 1
      && Math.abs(left.geometry.todayHeight - right.geometry.todayHeight) <= 1
      && Math.abs(left.geometry.toolbarHeight - right.geometry.toolbarHeight) <= 1;
  return geometryMatches && layoutsMatch(left, right);
}
