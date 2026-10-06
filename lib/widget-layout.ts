export const widgetSizes = ["small", "medium", "large", "mini", "medium-vertical"] as const;

export type WidgetSize = (typeof widgetSizes)[number];

export type WidgetSizeFootprint = {
  width: number;
  height: number;
};

const widgetSizeFootprints: Record<WidgetSize, WidgetSizeFootprint> = {
  small: { width: 1, height: 1 },
  medium: { width: 2, height: 1 },
  large: { width: 2, height: 2 },
  mini: { width: 1, height: 0.5 },
  "medium-vertical": { width: 1, height: 2 },
};

export const widgetSizeOptions: readonly {
  value: WidgetSize;
  label: string;
  footprint: WidgetSizeFootprint;
}[] = [
  { value: "mini", label: "Mini", footprint: widgetSizeFootprints.mini },
  { value: "small", label: "Small", footprint: widgetSizeFootprints.small },
  { value: "medium", label: "Medium horizontal", footprint: widgetSizeFootprints.medium },
  { value: "medium-vertical", label: "Medium vertical", footprint: widgetSizeFootprints["medium-vertical"] },
  { value: "large", label: "Large", footprint: widgetSizeFootprints.large },
];

export function getWidgetSizeFootprint(size: WidgetSize): WidgetSizeFootprint {
  return widgetSizeFootprints[size];
}
