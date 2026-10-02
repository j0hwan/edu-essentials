import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";
const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/assistant" });
for (const name of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Assistant } = await import(await clientModule("app/academic-assistant.tsx"));
const node = document.getElementById("root");
async function click(label) {
  const button = [...node.querySelectorAll("button")].find(b => b.textContent.trim() === label);
  assert.ok(button, `Missing ${label}`); await act(async () => button.click());
}
test("assistant previews require an explicit Apply and display only confirmed receipts", async () => {
  let applied = 0, fail = true;
  const proposal = { id: "proposal", status: "pending", preview: { timezone: "America/Los_Angeles", warnings: [], courseLabels: { calc: "Calculus II" }, changes: [{ after: { title: "Practice", courseId: "calc", dateKey: "2026-09-24", time: "13:00", durationMinutes: 60 } }] } };
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers["x-profile-id"], "test-profile");
    if (url.endsWith("/access")) return Response.json({ eligible: true, enabled: true, mode: "synthetic" });
    if (url.endsWith("/conversations")) return Response.json({ conversations: [{ id: "conv", title: "Synthetic plan" }] });
    if (url.includes("messages?")) return Response.json({ messages: [{ id: "message", question: "Plan study", status: "complete", created_at: "2026-09-18T12:00:00Z", result: { answer: { blocks: [{ kind: "recommendation", text: "Review this proposed study block.", citations: [] }] }, citations: [], proposalId: "proposal" } }] });
    if (url.includes("proposals?")) return Response.json(proposal);
    throw new Error(`Unexpected request ${url}`);
  };
  const root = createRoot(node);
  try {
    await act(async () => root.render(createElement(Assistant, { profileId: "test-profile", experimental: false, prepare: async () => {}, apply: async () => { applied++; if (fail) throw new Error("Workspace changed. Request a new preview."); proposal.status = "applied"; proposal.receipt = { appliedAt: "2026-09-18T12:01:00Z" }; } })));
    await click("Synthetic plan"); await click("Review proposed changes");
    assert.equal(applied, 0); assert.match(node.textContent, /Calculus II/); assert.match(node.textContent, /60 minutes/);
    await click("Apply changes"); assert.equal(applied, 1);
    assert.match(node.textContent, /Workspace changed/); assert.doesNotMatch(node.textContent, /Saved successfully/);
    fail = false; await click("Apply changes");
    assert.equal(applied, 2); assert.match(node.textContent, /Saved successfully/);
    assert.ok(![...node.querySelectorAll("button")].some(b => b.textContent === "Apply changes"));
  } finally { await act(async () => root.unmount()); }
});
test("failed workspace flush preserves the question and never sends it to the assistant", async () => {
  let posts = 0;
  globalThis.fetch = async (url, init) => { if (init.method === "POST") posts++; return Response.json(url.endsWith("/access") ? { eligible: true, enabled: true, mode: "synthetic" } : { conversations: [] }); };
  const root = createRoot(node);
  try {
    await act(async () => root.render(createElement(Assistant, { profileId: "test-profile", experimental: false, prepare: async () => { throw new Error("Save your workspace first."); }, apply: async () => {} })));
    await click("What assignments are due this week?"); await click("Send");
    assert.equal(posts, 0); assert.match(node.textContent, /Save your workspace first/);
    assert.equal(node.querySelector("textarea").value, "What assignments are due this week?");
  } finally { await act(async () => root.unmount()); }
});
test("pilot consent explains synthetic-only use and requires both attestations", async () => {
  let payload;
  globalThis.fetch = async (url, init) => { if (init.method === "POST") payload = JSON.parse(init.body); return Response.json(url.endsWith("/access") ? { eligible: true, enabled: false, mode: "synthetic" } : { conversations: [] }); };
  const root = createRoot(node);
  try {
    await act(async () => root.render(createElement(Assistant, { profileId: "test-profile", experimental: false, prepare: async () => {}, apply: async () => {} })));
    assert.match(node.textContent, /fictional academic data/);
    const boxes = [...node.querySelectorAll('input[type="checkbox"]')];
    assert.equal(boxes.length, 2); assert.ok(boxes.every(b => b.required));
    await click("Enable assistant"); assert.equal(payload, undefined);
    await act(async () => boxes.forEach(b => b.click())); await click("Enable assistant");
    assert.deepEqual(payload, { enabled: true, adultConfirmed: true, syntheticConfirmed: true });
  } finally { await act(async () => root.unmount()); }
});
