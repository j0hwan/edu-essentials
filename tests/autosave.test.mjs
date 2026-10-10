import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
const { Autosave, SaveFailure, canonicalJson } = await import(await clientModule("lib/autosave.ts"));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("hydration and failed-load retry never write default or unchanged data", async () => {
  const writes = [];
  const save = new Autosave(async (value) => { writes.push(value); return "r2"; }, 100000);
  save.change("default"); await save.flush(); assert.deepEqual(writes, []);
  save.loadFailed(new Error("offline")); assert.equal(save.getSnapshot().status, "load-error");
  save.loading(); save.hydrate("saved notes", "r1"); save.change("saved notes"); await save.flush();
  assert.deepEqual(writes, []); assert.equal(save.getSnapshot().dirty, false); save.stop();
});

test("edits during a write are coalesced and use its returned revision", async () => {
  const first = deferred(), writes = [];
  const save = new Autosave(async (snapshot, revision) => { writes.push([snapshot, revision]); return writes.length === 1 ? first.promise : "r3"; }, 100000);
  save.hydrate("initial", "r1"); save.change("first");
  assert.equal(save.getSnapshot().status, "dirty"); assert.equal(save.getSnapshot().dirty, true);
  const writing = save.flush(); save.change("second"); save.change("latest");
  await save.flush(); assert.equal(writes.length, 1);
  first.resolve("r2"); await writing;
  assert.equal(save.getSnapshot().dirty, true);
  await save.flush(); assert.deepEqual(writes, [["first", "r1"], ["latest", "r2"]]);
  assert.equal(save.getSnapshot().status, "saved"); save.stop();
});

test("flushLatest waits for the active write and the latest coalesced revision", async () => {
  const first = deferred(), second = deferred(), secondStarted = deferred(), writes = [];
  const save = new Autosave(async (snapshot, revision) => {
    writes.push([snapshot, revision]);
    if (writes.length === 1) return first.promise;
    secondStarted.resolve();
    return second.promise;
  }, 100000);
  save.hydrate("initial", "r1"); save.change("first");
  const writing = save.flush(); save.change("latest");
  let settled = false;
  const latestFlush = save.flushLatest().then(() => { settled = true; });

  first.resolve("r2"); await secondStarted.promise; await writing;
  assert.equal(settled, false);
  assert.deepEqual(writes, [["first", "r1"], ["latest", "r2"]]);
  second.resolve("r3"); await latestFlush;
  assert.equal(settled, true);
  assert.equal(save.getSnapshot().status, "saved"); assert.equal(save.getSnapshot().dirty, false);
  save.stop();
});

test("flushLatest stops after a failed write and leaves the latest edits dirty", async () => {
  const pending = deferred(), writes = [];
  const save = new Autosave(async (snapshot, revision) => { writes.push([snapshot, revision]); return pending.promise; }, 100000);
  save.hydrate("initial", "r1"); save.change("first");
  const latestFlush = save.flushLatest(); save.change("latest");
  pending.reject(new Error("offline"));
  await latestFlush;

  assert.deepEqual(writes, [["first", "r1"]]);
  assert.equal(save.getSnapshot().status, "save-error"); assert.equal(save.getSnapshot().dirty, true);
  save.stop();
});

test("flushLatest retries the latest snapshot only when explicitly requested", async () => {
  const failedWrite = deferred(), writes = [];
  const save = new Autosave(async (snapshot, revision) => {
    writes.push([snapshot, revision]);
    return writes.length === 1 ? failedWrite.promise : "r2";
  }, 100000);
  save.hydrate("initial", "r1"); save.change("first");
  const initialFlush = save.flushLatest(); save.change("latest");
  failedWrite.reject(new Error("offline")); await initialFlush;
  assert.equal(save.getSnapshot().status, "save-error"); assert.equal(save.getSnapshot().dirty, true);

  await save.flushLatest(true);
  assert.deepEqual(writes, [["first", "r1"], ["latest", "r1"]]);
  assert.equal(save.getSnapshot().status, "saved"); assert.equal(save.getSnapshot().dirty, false);
  save.stop();
});

test("flushLatest(true) explicitly retries a session error", async () => {
  let signedIn = false; const writes = [];
  const save = new Autosave(async (snapshot, revision) => {
    writes.push([snapshot, revision]);
    if (!signedIn) throw new SaveFailure("sign in", "session-error");
    return "r2";
  }, 100000);
  save.hydrate("initial", "r1"); save.change("draft");
  await save.flushLatest();
  assert.equal(save.getSnapshot().status, "session-error"); assert.equal(save.getSnapshot().dirty, true);

  signedIn = true; await save.flushLatest(true);
  assert.deepEqual(writes, [["draft", "r1"], ["draft", "r1"]]);
  assert.equal(save.getSnapshot().status, "saved"); assert.equal(save.getSnapshot().dirty, false);
  save.stop();
});

test("flushLatest releases its waiter on hydration and ignores the old write result", async () => {
  const pending = deferred(), started = deferred(), writes = [];
  const save = new Autosave(async (snapshot, revision) => {
    writes.push([snapshot, revision]); started.resolve();
    return writes.length === 1 ? pending.promise : "r10";
  }, 100000);
  save.hydrate("initial", "r1"); save.change("draft");
  const latestFlush = save.flushLatest(); await started.promise;

  save.loading(); save.hydrate("server copy", "r9");
  await latestFlush;
  pending.resolve("r2"); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(writes, [["draft", "r1"]]);
  assert.deepEqual(save.getSnapshot(), { status: "saved", ready: true, dirty: false, message: "" });
  save.change("after hydration"); await save.flush();
  assert.deepEqual(writes, [["draft", "r1"], ["after hydration", "r9"]]);
  save.stop();
});

test("flushLatest releases its waiter on stop and ignores the late write result", async () => {
  const pending = deferred(), started = deferred();
  const save = new Autosave(async () => { started.resolve(); return pending.promise; }, 100000);
  save.hydrate("initial", "r1"); save.change("draft");
  const latestFlush = save.flushLatest(); await started.promise;
  const stateAtStop = save.getSnapshot();

  save.stop(); await latestFlush;
  pending.resolve("r2"); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(save.getSnapshot(), stateAtStop);
});

test("reverting an edit while a write is running still saves that revert", async () => {
  const first = deferred(), writes = [];
  const save = new Autosave(async (snapshot) => { writes.push(snapshot); return writes.length === 1 ? first.promise : "r3"; }, 100000);
  save.hydrate("old", "r1"); save.change("new"); const writing = save.flush();
  save.change("old"); assert.equal(save.getSnapshot().dirty, true);
  first.resolve("r2"); await writing; await save.flush();
  assert.deepEqual(writes, ["new", "old"]); assert.equal(save.getSnapshot().dirty, false); save.stop();
});

test("network failure retains edits, pauses automatic saves, and retries latest content", async () => {
  let fail = true; const writes = [];
  const save = new Autosave(async (snapshot) => { writes.push(snapshot); if (fail) throw new Error("offline"); return "r2"; }, 100000);
  save.hydrate("old", "r1"); save.change("new"); await save.flush();
  save.change("latest"); await save.flush(); assert.deepEqual(writes, ["new"]);
  assert.equal(save.getSnapshot().status, "save-error"); assert.equal(save.getSnapshot().dirty, true);
  fail = false; save.retry(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(writes, ["new", "latest"]); assert.equal(save.getSnapshot().status, "saved"); save.stop();
});

test("an ambiguous failed write stays unsaved even after reverting locally", async () => {
  const save = new Autosave(async () => { throw new Error("response lost"); }, 100000);
  save.hydrate("old", "r1"); save.change("new"); await save.flush(); save.change("old");
  assert.equal(save.getSnapshot().dirty, true); assert.equal(save.getSnapshot().status, "save-error"); save.stop();
});

test("conflicts never retry automatically or adopt a newer revision", async () => {
  let writes = 0;
  const save = new Autosave(async () => { writes++; throw new SaveFailure("conflict", "conflict"); }, 100000);
  save.hydrate("old", "r1"); save.change("new"); await save.flush();
  save.change("more edits"); save.retry(); await save.flush(); await save.flushLatest(true);
  assert.equal(writes, 1); assert.equal(save.getSnapshot().status, "conflict");
  save.loading(); save.hydrate("latest database", "r3"); assert.equal(save.getSnapshot().dirty, false); save.stop();
});

test("session expiry retains edits and permits an explicit retry", async () => {
  let signedIn = false;
  const save = new Autosave(async () => { if (!signedIn) throw new SaveFailure("sign in", "session-error"); return "r2"; }, 100000);
  save.hydrate("old", "r1"); save.change("draft"); await save.flush();
  assert.equal(save.getSnapshot().status, "session-error"); assert.equal(save.getSnapshot().dirty, true);
  signedIn = true; save.retry(); await Promise.resolve(); await Promise.resolve();
  assert.equal(save.getSnapshot().status, "saved"); save.stop();
});

test("invalid content cancels a pending save and unmount ignores late results", async () => {
  const pending = deferred(); let writes = 0;
  const save = new Autosave(async () => { writes++; return pending.promise; }, 100000);
  save.hydrate("old", "r1"); save.change("draft"); save.invalidate("too long"); await save.flush(); assert.equal(writes, 0);
  save.change("valid"); const writing = save.flush(); save.loading(); pending.resolve("r2"); await writing;
  assert.equal(save.getSnapshot().status, "loading"); assert.equal(save.getSnapshot().ready, false); save.stop();
});

test("JSONB key order does not make identical content look different", () => {
  assert.equal(canonicalJson({ d: { b: 2, a: 1 }, w: [1, 2] }), canonicalJson({ w: [1, 2], d: { a: 1, b: 2 } }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});
