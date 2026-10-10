export type WidgetAppearance = {
  minWidth: number;
  minHeight: number;
  gap: number;
  radius: number;
  padding: number;
  surface: string;
  surfaceOpacity: number;
  accent: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: "solid" | "dashed" | "none";
  shadow: "none" | "soft" | "lifted" | "crisp";
  blur: number;
  texture: "none" | "dots" | "grid";
  gradient: "none" | "subtle" | "duotone";
  gradientAngle: number;
  textColor: string;
  mutedColor: string;
  fontSize: number;
  titleSize: number;
  titleWeight: 500 | 600 | 700;
  lineHeight: number;
  letterSpacing: number;
  titleAlign: "left" | "center";
  iconStyle: "filled" | "outline" | "minimal";
  iconSize: number;
  showIcons: boolean;
  headerDivider: boolean;
  accentEdge: "none" | "top" | "left";
  hover: "none" | "lift" | "glow";
  transitionMs: number;
  contentMode: "expand" | "scroll";
};

export type WidgetAppearanceState = {
  defaults: WidgetAppearance;
  overrides: Record<string, Partial<WidgetAppearance>>;
};

export type WidgetAppearancePreset = {
  id: string;
  name: string;
  description: string;
  appearance: WidgetAppearance;
};

export const defaultWidgetAppearance: WidgetAppearance = {
  minWidth: 260,
  minHeight: 220,
  gap: 16,
  radius: 14,
  padding: 16,
  surface: "#0d1b30",
  surfaceOpacity: 100,
  accent: "#6674ff",
  borderColor: "#28405f",
  borderWidth: 1,
  borderStyle: "solid",
  shadow: "soft",
  blur: 0,
  texture: "none",
  gradient: "none",
  gradientAngle: 135,
  textColor: "#edf1ff",
  mutedColor: "#a5bbdf",
  fontSize: 14,
  titleSize: 14,
  titleWeight: 600,
  lineHeight: 1.45,
  letterSpacing: 0,
  titleAlign: "left",
  iconStyle: "filled",
  iconSize: 28,
  showIcons: true,
  headerDivider: false,
  accentEdge: "none",
  hover: "lift",
  transitionMs: 180,
  contentMode: "expand",
};

function preset(id: string, name: string, description: string, changes: Partial<WidgetAppearance>): WidgetAppearancePreset {
  return { id, name, description, appearance: { ...defaultWidgetAppearance, ...changes } };
}

export const appearancePresets: WidgetAppearancePreset[] = [
  preset("midnight", "Midnight", "A focused navy surface with a crisp indigo accent.", {}),
  preset("paper", "Paper", "A quiet, bright canvas with clear blue details.", {
    surface: "#f7f8fc", accent: "#365fc7", borderColor: "#d8deeb", shadow: "soft",
    textColor: "#1b2435", mutedColor: "#59677f", headerDivider: true, iconStyle: "outline",
  }),
  preset("graphite", "Graphite", "A restrained charcoal palette with a cool teal accent.", {
    surface: "#20262d", accent: "#54c7b5", borderColor: "#414b56", shadow: "crisp",
    textColor: "#eef2f5", mutedColor: "#abb8c2", radius: 10, iconStyle: "minimal", accentEdge: "left",
  }),
  preset("frost", "Frost", "An airy blue-white surface with a gentle layered finish.", {
    surface: "#e9f3ff", surfaceOpacity: 92, accent: "#4388d4", borderColor: "#b8d0e9",
    textColor: "#1a2d43", mutedColor: "#526d89", gradient: "subtle", texture: "dots", shadow: "lifted",
  }),
  preset("warm", "Warm", "Soft parchment tones paired with a warm amber highlight.", {
    surface: "#fff5e7", accent: "#b96c26", borderColor: "#e7cfb2", shadow: "soft",
    textColor: "#34291f", mutedColor: "#79634e", titleWeight: 700, titleAlign: "center", gradient: "subtle",
  }),
  preset("studio", "Studio", "A polished violet workspace with balanced contrast and texture.", {
    surface: "#251d3b", accent: "#bd91ff", borderColor: "#594477", shadow: "lifted",
    textColor: "#f3edff", mutedColor: "#c1addf", texture: "grid", gradient: "duotone", gradientAngle: 145,
    headerDivider: true, accentEdge: "top", hover: "glow",
  }),
];

const fieldNames = Object.keys(defaultWidgetAppearance) as (keyof WidgetAppearance)[];
const fieldNameSet = new Set<string>(fieldNames);
const dangerousRecordKeys = new Set(["__proto__", "constructor", "prototype"]);

const appearanceRanges: Partial<Record<keyof WidgetAppearance, readonly [number, number]>> = {
  minWidth: [240, 380], minHeight: [180, 360], gap: [8, 32], radius: [0, 28], padding: [10, 28],
  surfaceOpacity: [40, 100], borderWidth: [0, 3], blur: [0, 20], gradientAngle: [0, 360],
  fontSize: [12, 18], titleSize: [12, 20], iconSize: [24, 40], transitionMs: [0, 350],
  lineHeight: [1.3, 1.8], letterSpacing: [-0.02, 0.04],
};

const enumValues: Partial<Record<keyof WidgetAppearance, readonly unknown[]>> = {
  borderStyle: ["solid", "dashed", "none"],
  shadow: ["none", "soft", "lifted", "crisp"],
  texture: ["none", "dots", "grid"],
  gradient: ["none", "subtle", "duotone"],
  titleWeight: [500, 600, 700],
  titleAlign: ["left", "center"],
  iconStyle: ["filled", "outline", "minimal"],
  accentEdge: ["none", "top", "left"],
  hover: ["none", "lift", "glow"],
  contentMode: ["expand", "scroll"],
};

function invalid(label: string): never {
  throw new Error(`Invalid widget appearance ${label}.`);
}

type DataRecord = { [key: string]: unknown };

// Only accept ordinary JSON-shaped records. Reading descriptors avoids invoking
// caller-supplied getters while validating data from JavaScript callers.
function dataRecord(value: unknown, label: string): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(label);
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return invalid(label);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: DataRecord = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return invalid(label);
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) return invalid(label);
      Object.defineProperty(record, key, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
    }
    return record;
  } catch {
    return invalid(label);
  }
}

function assertOnlyKeys(record: DataRecord, allowed: Set<string>, label: string): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) invalid(label);
}

function validWidgetId(id: string): boolean {
  return id.length > 0 && id.length <= 120 && id.trim().length > 0 && !dangerousRecordKeys.has(id) &&
    Array.from(id).every((character) => {
      const code = character.codePointAt(0)!;
      return code >= 32 && code !== 127;
    });
}

function readAppearanceFields(value: unknown, label: string, requireAll = false): Partial<WidgetAppearance> {
  const input = dataRecord(value, label);
  assertOnlyKeys(input, fieldNameSet, label);
  const output: Partial<WidgetAppearance> = {};
  for (const key of fieldNames) {
    if (!Object.hasOwn(input, key)) {
      if (requireAll) invalid(key);
      continue;
    }
    const field = input[key];
    const range = appearanceRanges[key];
    if (range) {
      if (typeof field !== "number" || !Number.isFinite(field) || field < range[0] || field > range[1]) invalid(key);
    } else if (key === "surface" || key === "accent" || key === "borderColor" || key === "textColor" || key === "mutedColor") {
      if (typeof field !== "string" || !/^#[0-9a-fA-F]{6}$/.test(field)) invalid(key);
    } else if (key === "showIcons" || key === "headerDivider") {
      if (typeof field !== "boolean") invalid(key);
    } else if (enumValues[key]) {
      if (!enumValues[key]!.includes(field)) invalid(key);
    } else invalid(key);
    Object.defineProperty(output, key, { value: field, enumerable: true, configurable: true, writable: true });
  }
  return output;
}

function completeAppearance(partial: Partial<WidgetAppearance>): WidgetAppearance {
  return { ...defaultWidgetAppearance, ...partial };
}

function normalizedAppearance(value: unknown, label: string): WidgetAppearance {
  return completeAppearance(readAppearanceFields(value, label, true));
}

function readState(value: unknown): { defaults: WidgetAppearance; overrides: Record<string, Partial<WidgetAppearance>> } {
  const input = dataRecord(value, "state");
  const hasStateShape = Object.hasOwn(input, "defaults") || Object.hasOwn(input, "overrides");

  if (!hasStateShape) {
    // Before per-widget overrides, the saved value was a single appearance.
    assertOnlyKeys(input, fieldNameSet, "state");
    const defaults = completeAppearance(readAppearanceFields(input, "defaults"));
    return { defaults, overrides: {} };
  }

  assertOnlyKeys(input, new Set(["defaults", "overrides"]), "state");
  const defaults = Object.hasOwn(input, "defaults")
    ? completeAppearance(readAppearanceFields(input.defaults, "defaults"))
    : { ...defaultWidgetAppearance };

  const rawOverrides = Object.hasOwn(input, "overrides") ? dataRecord(input.overrides, "overrides") : {};
  const ids = Object.keys(rawOverrides);
  if (ids.length > 2000) invalid("overrides");
  const overrides: Record<string, Partial<WidgetAppearance>> = {};
  for (const id of ids) {
    if (!validWidgetId(id)) invalid("override ID");
    const partial = readAppearanceFields(rawOverrides[id], `override ${id}`);
    Object.defineProperty(overrides, id, { value: partial, enumerable: true, configurable: true, writable: true });
  }
  return { defaults, overrides };
}

/** Validate saved appearance data and return a complete, safe, normalized state. */
export function validateWidgetAppearanceState(value: unknown): WidgetAppearanceState {
  return readState(value);
}

/** Resolve a widget's appearance by applying its optional partial override. */
export function resolveWidgetAppearance(state?: WidgetAppearanceState, id?: string): WidgetAppearance {
  if (state === undefined) return { ...defaultWidgetAppearance };
  const input = dataRecord(state, "state");
  assertOnlyKeys(input, new Set(["defaults", "overrides"]), "state");
  const defaults = Object.hasOwn(input, "defaults")
    ? completeAppearance(readAppearanceFields(input.defaults, "defaults"))
    : { ...defaultWidgetAppearance };
  if (id === undefined || !Object.hasOwn(input, "overrides")) return defaults;
  if (typeof id !== "string" || !validWidgetId(id)) invalid("widget ID");
  const overrides = dataRecord(input.overrides, "overrides");
  if (!Object.hasOwn(overrides, id)) return defaults;
  return { ...defaults, ...readAppearanceFields(overrides[id], `override ${id}`) };
}

function hexChannels(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function rgba(hex: string, alpha: number): string {
  const [red, green, blue] = hexChannels(hex);
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`;
}

function densityLength(value: number): string {
  return `calc(${value} * var(--desktop-density-unit, 1px))`;
}

function textureImage(appearance: WidgetAppearance): string {
  const opacity = appearance.surfaceOpacity / 100;
  const dot = rgba(appearance.accent, 0.2 * opacity);
  const line = rgba(appearance.accent, 0.12 * opacity);
  if (appearance.texture === "dots") return `radial-gradient(${dot} ${densityLength(1)}, transparent ${densityLength(1)})`;
  if (appearance.texture === "grid") return `linear-gradient(${line} ${densityLength(1)}, transparent ${densityLength(1)}), linear-gradient(90deg, ${line} ${densityLength(1)}, transparent ${densityLength(1)})`;
  return "none";
}

function backgroundValue(appearance: WidgetAppearance, texture: string): string {
  const surface = rgba(appearance.surface, appearance.surfaceOpacity / 100);
  const layers: string[] = [];
  if (texture !== "none") layers.push(texture);
  if (appearance.gradient === "subtle") {
    layers.push(`linear-gradient(${appearance.gradientAngle}deg, ${surface}, ${rgba(appearance.accent, appearance.surfaceOpacity / 100 * 0.14)})`);
  } else if (appearance.gradient === "duotone") {
    layers.push(`linear-gradient(${appearance.gradientAngle}deg, ${rgba(appearance.surface, appearance.surfaceOpacity / 100)}, ${rgba(appearance.accent, appearance.surfaceOpacity / 100 * 0.3)})`);
  } else {
    layers.push(surface);
  }
  return layers.join(", ");
}

function shadowValue(shadow: WidgetAppearance["shadow"]): string {
  switch (shadow) {
    case "soft": return `0 ${densityLength(8)} ${densityLength(24)} rgba(3, 10, 22, 0.22)`;
    case "lifted": return `0 ${densityLength(14)} ${densityLength(34)} rgba(3, 10, 22, 0.3)`;
    case "crisp": return `0 ${densityLength(2)} ${densityLength(8)} rgba(3, 10, 22, 0.28)`;
    default: return "none";
  }
}

const pxFields = ["minWidth", "minHeight", "gap", "radius", "padding", "borderWidth", "blur", "fontSize", "titleSize", "iconSize"] as const;
const styleNames: Record<typeof fieldNames[number], string> = Object.fromEntries(fieldNames.map((key) => [key, `--wa-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`])) as Record<typeof fieldNames[number], string>;

/** Convert the typed model to CSS custom properties without accepting CSS input. */
export function widgetAppearanceStyle(appearance: WidgetAppearance): Record<string, string> {
  const safe = normalizedAppearance(appearance, "style");
  const style: Record<string, string> = {};
  for (const key of pxFields) style[styleNames[key]] = densityLength(safe[key]);
  style[styleNames.surface] = rgba(safe.surface, safe.surfaceOpacity / 100);
  style[styleNames.surfaceOpacity] = `${safe.surfaceOpacity}%`;
  style[styleNames.accent] = safe.accent;
  style[styleNames.borderColor] = safe.borderColor;
  style[styleNames.borderStyle] = safe.borderStyle;
  style[styleNames.shadow] = shadowValue(safe.shadow);
  style[styleNames.texture] = textureImage(safe);
  style["--wa-background"] = backgroundValue(safe, style[styleNames.texture]);
  style[styleNames.gradient] = safe.gradient;
  style[styleNames.gradientAngle] = `${safe.gradientAngle}deg`;
  style[styleNames.textColor] = safe.textColor;
  style[styleNames.mutedColor] = safe.mutedColor;
  style[styleNames.titleWeight] = `${safe.titleWeight}`;
  style[styleNames.lineHeight] = `${safe.lineHeight}`;
  style[styleNames.letterSpacing] = `${safe.letterSpacing}em`;
  style[styleNames.titleAlign] = safe.titleAlign;
  style[styleNames.iconStyle] = safe.iconStyle;
  style[styleNames.showIcons] = `${safe.showIcons}`;
  style[styleNames.headerDivider] = `${safe.headerDivider}`;
  style[styleNames.accentEdge] = safe.accentEdge;
  style[styleNames.hover] = safe.hover;
  style[styleNames.transitionMs] = `${safe.transitionMs}ms`;
  style[styleNames.contentMode] = safe.contentMode;
  return style;
}
