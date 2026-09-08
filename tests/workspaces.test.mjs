import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
const { encodeWorkspaceState: encode, decodeWorkspaceState: decode, widgetTypes, MAX_WORKSPACE_BYTES } = await import(await clientModule("lib/workspace-codec.ts"));
const pack = (state) => encode(state.workspaces, state.activeWorkspaceId, state.notes, state.data);
const legacy = { v: 1, a: "second", w: [["first", "First", widgetTypes.map((_, i) => [i, i % 3])], ["second", "Second", [[12, 2], [12, 0]]]], n: "Shared legacy text\nKeep every line." };

test("v1 migration preserves every layout and note, with deterministic persistent identities", () => {
  const source = structuredClone(legacy), loaded = decode(source);
  const upgraded = pack(loaded);
  assert.equal(upgraded.v, 2); assert.deepEqual(source, legacy);
  assert.deepEqual(decode(source), loaded); assert.deepEqual(decode(upgraded), loaded);
  assert.equal(loaded.activeWorkspaceId, "second"); assert.equal(loaded.notes, "");
  assert.deepEqual(loaded.workspaces[0].widgets.map((widget) => widget.type), widgetTypes);
  for (const workspace of loaded.workspaces) for (const widget of workspace.widgets) if (widget.type === "notes") assert.equal(widget.note, legacy.n);
  assert.equal(upgraded.t.length, 1);
  assert.equal(new Set(loaded.workspaces.flatMap((w) => w.widgets.map((v) => v.instanceId))).size, 20);
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
