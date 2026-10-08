import { calculateWidgetPlacements, type WidgetSize } from "./widget-layout";

export type HomeSkeletonPresetId =
  | "study-overview"
  | "study-rhythm"
  | "calendar-focus"
  | "notes-board"
  | "weekly-pulse";

export type HomeSkeletonWidget = {
  size: WidgetSize;
};

export type HomeSkeletonPreset = {
  id: HomeSkeletonPresetId;
  widgets: readonly HomeSkeletonWidget[];
};

/** A small library of balanced, hand-authored Home layouts for the loading state. */
export const homeSkeletonPresets: readonly HomeSkeletonPreset[] = [
  {
    id: "study-overview",
    widgets: [
      { size: "small" },
      { size: "small" },
      { size: "medium" },
      { size: "large" },
      { size: "medium-vertical" },
      { size: "small" },
      { size: "mini" },
      { size: "mini" },
    ],
  },
  {
    id: "study-rhythm",
    widgets: [
      { size: "medium" },
      { size: "medium" },
      { size: "large" },
      { size: "medium-vertical" },
      { size: "small" },
      { size: "mini" },
      { size: "mini" },
    ],
  },
  {
    id: "calendar-focus",
    widgets: [
      { size: "medium-vertical" },
      { size: "medium" },
      { size: "small" },
      { size: "large" },
      { size: "small" },
      { size: "mini" },
      { size: "mini" },
      { size: "small" },
    ],
  },
  {
    id: "notes-board",
    widgets: [
      { size: "large" },
      { size: "small" },
      { size: "small" },
      { size: "medium" },
      { size: "medium" },
      { size: "small" },
      { size: "mini" },
      { size: "mini" },
    ],
  },
  {
    id: "weekly-pulse",
    widgets: [
      { size: "medium" },
      { size: "small" },
      { size: "small" },
      { size: "medium-vertical" },
      { size: "large" },
      { size: "small" },
      { size: "mini" },
      { size: "mini" },
    ],
  },
];

export const HOME_SKELETON_PRESETS = homeSkeletonPresets;

/** Selects from the finite curated library; callers can inject a seeded random source. */
export function chooseHomeSkeletonPreset(random: () => number = Math.random): HomeSkeletonPreset {
  const sample = random();
  const index = Number.isFinite(sample)
    ? Math.min(homeSkeletonPresets.length - 1, Math.max(0, Math.floor(sample * homeSkeletonPresets.length)))
    : 0;
  return homeSkeletonPresets[index];
}

/** Unknown or stale preset ids resolve to the first stable layout. */
export function getHomeSkeletonPreset(id: unknown): HomeSkeletonPreset {
  return homeSkeletonPresets.find((preset) => preset.id === id) ?? homeSkeletonPresets[0];
}

export type HomeSkeletonPlacement = ReturnType<typeof calculateWidgetPlacements>[number];

/** Uses the live widget placement rules for both supported responsive column counts. */
export function getHomeSkeletonPlacements(preset: HomeSkeletonPreset) {
  const sizes = preset.widgets.map((widget) => widget.size);
  return {
    desktop: calculateWidgetPlacements(sizes, 4),
    phone: calculateWidgetPlacements(sizes, 2),
  };
}
