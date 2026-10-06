import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
const { encodeWorkspaceState: encode, decodeWorkspaceState: decode, widgetTypes, widgetSizes, MAX_WORKSPACE_BYTES } = await import(await clientModule("lib/workspace-codec.ts"));
const { widgetSizeOptions } = await import(await clientModule("lib/widget-layout.ts"));
const pack = (state) => encode(state.workspaces, state.activeWorkspaceId, state.notes, state.data);
const legacy = { v: 1, a: "second", w: [["first", "First", widgetTypes.map((_, i) => [i, i % 3])], ["second", "Second", [[12, 2], [12, 0]]]], n: "Shared legacy text\nKeep every line." };

test("v1 migration preserves every layout and note, with deterministic persistent identities", () => {
  const source = structuredClone(legacy), loaded = decode(source);
  const upgraded = pack(loaded);
  assert.equal(upgraded.v, 2); assert.deepEqual(source, legacy);
  assert.deepEqual(decode(source), loaded); assert.deepEqual(decode(upgraded), loaded);
  assert.equal(loaded.activeWorkspaceId, "second"); assert.equal(loaded.notes, "");
  assert.deepEqual(loaded.workspaces[0].widgets.map((widget) => widget.type), widgetTypes);
  assert.deepEqual(widgetSizes, ["small", "medium", "large", "mini", "medium-vertical"]);
  assert.deepEqual(loaded.workspaces[0].widgets.slice(0, 3).map((widget) => widget.size), ["small", "medium", "large"]);
  for (const workspace of loaded.workspaces) for (const widget of workspace.widgets) if (widget.type === "notes") assert.equal(widget.note, legacy.n);
  assert.equal(upgraded.t.length, 1);
  assert.equal(new Set(loaded.workspaces.flatMap((w) => w.widgets.map((v) => v.instanceId))).size, 20);
});

test("all widget types round-trip with all five stable size indices", () => {
  const widgets = widgetTypes.flatMap((type) => widgetSizes.map((size) => ({
    instanceId: `${type}-${size}`,
    type,
    size,
    ...(type === "notes" ? { note: `Text for ${size}` } : {}),
  })));
  const data = { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month" };
  const compact = encode([{ id: "all", name: "All sizes", widgets }], "all", "Standalone notes", data);
  const loaded = decode(compact);

  assert.equal(compact.v, 2);
  assert.deepEqual(compact.w[0][2].map((widget) => widget[1]), Array.from({ length: widgetTypes.length }, () => [0, 1, 2, 3, 4]).flat());
  assert.deepEqual(loaded.workspaces[0].widgets, widgets);
  assert.equal(loaded.notes, "Standalone notes");
  assert.deepEqual(loaded.data, data);
  assert.equal(new Set(loaded.workspaces[0].widgets.map((widget) => widget.instanceId)).size, 18 * 5);
  assert.deepEqual(loaded.workspaces[0].widgets.map((widget) => widgetSizes.indexOf(widget.size)), widgets.map((widget) => widgetSizes.indexOf(widget.size)));
});

test("widget size options expose the five labeled block footprints", () => {
  assert.deepEqual(widgetSizeOptions, [
    { value: "mini", label: "Mini", footprint: { width: 1, height: 0.5 } },
    { value: "small", label: "Small", footprint: { width: 1, height: 1 } },
    { value: "medium", label: "Medium horizontal", footprint: { width: 2, height: 1 } },
    { value: "medium-vertical", label: "Medium vertical", footprint: { width: 1, height: 2 } },
    { value: "large", label: "Large", footprint: { width: 2, height: 2 } },
  ]);
});

test("compact workspace decoder rejects size indices outside the five supported values", () => {
  const good = pack(decode(legacy));
  for (const size of [-1, 5, 0.5, "mini", null]) {
    const broken = structuredClone(good);
    broken.w[0][2][0][1] = size;
    assert.throws(() => decode(broken), /widget layout/);
  }
});

test("independent edits, copies, clearing, deletion and reorder survive repeated reloads", () => {
  const loaded = decode(pack(decode(legacy))), original = loaded.workspaces[1].widgets[0];
  const copy = { ...original, instanceId: "new-copy" };
  loaded.workspaces[1].widgets.push(copy); copy.note = "Only the copy"; copy.size = "medium";
  loaded.workspaces[1].widgets[1].note = "";
  loaded.workspaces.reverse(); loaded.workspaces[0].widgets.reverse();
  loaded.workspaces[0].name = "Renamed";
  const saved = decode(pack(loaded));
  assert.deepEqual(saved, loaded);
  assert.equal(saved.workspaces[0].widgets[0].note, "Only the copy");
  assert.equal(saved.workspaces[0].widgets[1].note, "");
  assert.equal(saved.workspaces[0].widgets[2].note, legacy.n);
  saved.workspaces[0].widgets.shift();
  assert.ok(!pack(saved).t.includes("Only the copy"));
});

test("legacy notes without a widget stay recoverable until explicitly placed", () => {
  const loaded = decode({ v: 1, a: "a", w: [["a", "Empty", []]], n: legacy.n });
  assert.equal(decode(pack(loaded)).notes, legacy.n);
  loaded.workspaces[0].widgets.push({ instanceId: "restored", type: "notes", size: "large", note: loaded.notes }); loaded.notes = "";
  const saved = decode(pack(loaded)); assert.equal(saved.notes, ""); assert.equal(saved.workspaces[0].widgets[0].note, legacy.n);
});

test("maximum legacy layout does not multiply shared note storage during migration", () => {
  const old = { v: 1, a: "w0", w: Array.from({ length: 20 }, (_, i) => [`w${i}`, `Workspace ${i}`, Array.from({ length: 100 }, () => [12, 1])]), n: "漢".repeat(20000) };
  const migrated = pack(decode(old));
  assert.equal(migrated.t.length, 1);
  assert.ok(new TextEncoder().encode(JSON.stringify(migrated)).byteLength < MAX_WORKSPACE_BYTES);
  assert.equal(decode(migrated).workspaces[19].widgets[99].note, old.n);
});

test("duplicate identities, bad note references, excess counts and UTF-8 payloads are rejected", () => {
  const good = pack(decode(legacy));
  const broken = structuredClone(good); broken.w[1][2][0][2] = broken.w[0][2][0][2];
  assert.throws(() => decode(broken), /duplicate widget ID/);
  for (const reference of [-1, 1, 0.5, "0", null]) { const value = structuredClone(good); value.w[1][2][0][3] = reference; assert.throws(() => decode(value), /note reference/); }
  assert.throws(() => decode({ ...good, t: ["x".repeat(20001)] }), /note content/);
  assert.throws(() => decode({ ...good, t: {} }), /note content/);
  assert.throws(() => decode({ ...good, w: Array.from({ length: 21 }, (_, i) => [`w${i}`, "Title", []]) }), /count/);
  assert.throws(() => encode([{ id: "a", name: "A", widgets: Array.from({ length: 101 }, (_, i) => ({ instanceId: `${i}`, type: "spacer", size: "small" })) }], "a", ""), /100 widgets/);
  const tooBig = [{ id: "a", name: "A", widgets: Array.from({ length: 30 }, (_, i) => ({ instanceId: `${i}`, type: "notes", size: "large", note: `${i}${"漢".repeat(19995)}` })) }];
  assert.throws(() => encode(tooBig, "a", ""), /storage limit/);
});
