import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const {
  appearancePresets,
  defaultWidgetAppearance,
  resolveWidgetAppearance,
  validateWidgetAppearanceState,
  widgetAppearanceStyle,
} = await import(await clientModule("lib/widget-appearance.ts"));

test("appearance state fills defaults and accepts legacy partial appearances", () => {
  assert.deepEqual(validateWidgetAppearanceState({}), { defaults: defaultWidgetAppearance, overrides: {} });
  assert.deepEqual(validateWidgetAppearanceState({ surface: "#abcdef", gap: 20 }), {
    defaults: { ...defaultWidgetAppearance, surface: "#abcdef", gap: 20 },
    overrides: {},
  });
  assert.deepEqual(validateWidgetAppearanceState({ defaults: { radius: 22 } }), {
    defaults: { ...defaultWidgetAppearance, radius: 22 },
    overrides: {},
  });
});

test("partial per-widget overrides inherit defaults and full states round-trip", () => {
  const input = {
    defaults: { surface: "#123456", accent: "#abcdef", contentMode: "scroll" },
    overrides: { "widget-1": { accent: "#ff8800", padding: 20 }, "widget-2": { showIcons: false } },
  };
  const state = validateWidgetAppearanceState(input);
  assert.deepEqual(resolveWidgetAppearance(state, "widget-1"), {
    ...defaultWidgetAppearance, ...input.defaults, ...input.overrides["widget-1"],
  });
  assert.deepEqual(resolveWidgetAppearance(state, "missing"), { ...defaultWidgetAppearance, ...input.defaults });
  assert.deepEqual(resolveWidgetAppearance(undefined), defaultWidgetAppearance);
  assert.deepEqual(validateWidgetAppearanceState(JSON.parse(JSON.stringify(state))), state);
});

test("validation rejects invalid fields, ranges, injection, prototypes, and oversized records", () => {
  const rejects = (value) => assert.throws(() => validateWidgetAppearanceState(value), /Invalid widget appearance/);
  rejects({ surface: "red; background: url(https://example.invalid)" });
  rejects({ radius: 29 });
  rejects({ lineHeight: Number.NaN });
  rejects({ transitionMs: Infinity });
  rejects({ borderStyle: "double" });
  rejects({ invented: true });
  rejects({ defaults: [], overrides: {} });
  rejects(Object.assign(Object.create({ polluted: true }), { defaults: {} }));
  rejects({ overrides: { "__proto__": { surface: "#ffffff" } } });
  rejects(JSON.parse('{"overrides":{"constructor":{"gap":20}}}'));
  rejects(JSON.parse('{"overrides":{"prototype":{"gap":20}}}'));
  rejects({ overrides: { " ": { gap: 20 } } });
  rejects({ overrides: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`widget-${i}`, {}])) });
});

test("CSS variables keep opacity on backgrounds and derive safe visual values", () => {
  const appearance = {
    ...defaultWidgetAppearance,
    surface: "#123456",
    surfaceOpacity: 40,
    texture: "grid",
    gradient: "duotone",
    gradientAngle: 90,
    blur: 6,
    transitionMs: 0,
  };
  const style = widgetAppearanceStyle(appearance);
  assert.equal(style["--wa-surface"], "rgba(18, 52, 86, 0.4)");
  assert.equal(style["--wa-surface-opacity"], "40%");
  assert.equal(style["--wa-text-color"], "#edf1ff");
  assert.equal(style["--wa-blur"], "6px");
  assert.equal(style["--wa-transition-ms"], "0ms");
  assert.match(style["--wa-texture"], /^linear-gradient\(/);
  assert.match(style["--wa-background"], /linear-gradient\(90deg/);
  assert.match(style["--wa-background"], /rgba\(18, 52, 86, 0\.4\)/);
  assert.doesNotMatch(style["--wa-text-color"], /rgba|opacity/i);
});

test("safe none values produce a transparent-free surface and six distinct presets", () => {
  const style = widgetAppearanceStyle({
    ...defaultWidgetAppearance,
    borderStyle: "none",
    shadow: "none",
    texture: "none",
    gradient: "none",
    hover: "none",
    accentEdge: "none",
  });
  assert.equal(style["--wa-border-style"], "none");
  assert.equal(style["--wa-shadow"], "none");
  assert.equal(style["--wa-texture"], "none");
  assert.equal(style["--wa-background"], "rgba(13, 27, 48, 1)");
  assert.deepEqual(appearancePresets.map(({ id }) => id), ["midnight", "paper", "graphite", "frost", "warm", "studio"]);
  assert.equal(appearancePresets[0].name, "Midnight");
  assert.ok(appearancePresets.every(({ description }) => description.length > 0));
  assert.equal(new Set(appearancePresets.map(({ appearance }) => JSON.stringify(appearance))).size, 6);
});
