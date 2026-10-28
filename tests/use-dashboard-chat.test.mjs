import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useDashboardChat } = await import(await clientModule("app/use-dashboard-chat.ts"));
const node = document.getElementById("root");
let root;
let latest;

function Harness({ profileId = "profile-one", prepare = async () => {}, experimental = false }) {
  latest = useDashboardChat({ profileId, prepare, experimental });
  return createElement("div", null, JSON.stringify(latest.messages));
}
async function mount(props) {
  root = createRoot(node);
  await act(async () => root.render(createElement(Harness, props)));
}
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = null;
  node.replaceChildren();
}

test("aborts a pending request and discards its reply when the profile changes", async () => {
  let releaseAccess;
  let signal;
  globalThis.fetch = async (_url, init) => {
    signal = init.signal;
    return new Promise((resolve) => { releaseAccess = () => resolve(Response.json({ eligible: true, enabled: true })); });
  };
  try {
    await mount();
    await act(async () => { assert.equal(latest.send("Private question"), true); assert.equal(latest.send("Duplicate"), false); });
    assert.equal(latest.messages.length, 1);
    await act(async () => root.render(createElement(Harness, { profileId: "profile-two" })));
    assert.equal(signal.aborted, true);
    assert.deepEqual(latest.messages, []);
    assert.equal(latest.busy, false);
    await act(async () => releaseAccess());
    await settle();
    assert.deepEqual(latest.messages, []);
  } finally { await unmount(); }
});

test("polls a running reply to completion and aborts outstanding work on unmount", async () => {
  let requestId;
  let requestSignal;
  globalThis.fetch = async (url, init) => {
    requestSignal = init.signal;
    if (url.endsWith("/access")) return Response.json({ eligible: true, enabled: true });
    if (url.endsWith("/conversations")) return Response.json({ id: "conversation-one" });
    if (url.endsWith("/messages")) {
      requestId = JSON.parse(init.body).requestId;
      return Response.json({ id: requestId, status: "running" });
    }
    return Response.json({ messages: [{ id: requestId, status: "complete", result: { answer: { blocks: [{ kind: "general", text: "Ready", citations: [] }] }, citations: [], proposalId: null } }] });
  };
  try {
    await mount();
    await act(async () => latest.send("Help me study"));
    await settle();
    assert.equal(latest.messages[0].result.answer.blocks[0].text, "Ready");
    assert.equal(latest.busy, false);
    globalThis.fetch = async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(() => {});
    };
    await act(async () => latest.send("Follow-up"));
    await unmount();
    assert.equal(requestSignal.aborted, true);
  } finally { await unmount(); }
});

test("entering experimental mode clears real chat and aborts the pending reply", async () => {
  let signal;
  globalThis.fetch = async (_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  };
  try {
    await mount();
    await act(async () => latest.send("Real account question"));
    await act(async () => root.render(createElement(Harness, { experimental: true })));
    assert.equal(signal.aborted, true);
    assert.deepEqual(latest.messages, []);
    assert.equal(latest.busy, false);
  } finally { await unmount(); }
});

test("accepts a turn synchronously, gates on enabled access, and keeps failures inline", async () => {
  const requests = [];
  let prepared = 0;
  let releaseAccess;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Promise((resolve) => { releaseAccess = () => resolve(Response.json({ eligible: true, enabled: false, mode: "synthetic" })); });
  };
  try {
    await mount({ prepare: async () => { prepared += 1; } });
    let accepted;
    await act(async () => { accepted = latest.send("  What is due?  "); });
    assert.equal(accepted, true);
    assert.equal(latest.messages[0].status, "running");
    await act(async () => releaseAccess());
    await settle();
    assert.equal(prepared, 0);
    assert.equal(requests.length, 1);
    assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), "profile-one");
    assert.equal(latest.messages[0].status, "failed");
    assert.match(latest.messages[0].error, /not enabled/i);
  } finally { await unmount(); }
});

test("creates a conversation and maps completed messages into the assistant result shape", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/access")) return Response.json({ eligible: true, enabled: true, mode: "paid" });
    if (url.endsWith("/conversations")) return Response.json({ id: "conversation-one", title: "Question" });
    if (url.endsWith("/messages")) {
      const body = JSON.parse(init.body);
      assert.equal(body.conversationId, "conversation-one");
      assert.equal(body.message, "Question");
      return Response.json({ id: body.requestId, status: "complete", result: {
        answer: { blocks: [{ kind: "fact", text: "Answer", citations: ["source-one"] }] },
        citations: [{ id: "source-one", label: "Course notes", text: "Excerpt", kind: "record" }],
        proposalId: null,
      } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await mount({ prepare: async () => {} });
    let accepted;
    await act(async () => { accepted = latest.send("Question"); });
    assert.equal(accepted, true);
    await settle();
    const [message] = latest.messages;
    assert.equal(message.status, "complete");
    assert.equal(message.result.answer.blocks[0].text, "Answer");
    assert.equal(message.result.citations[0].label, "Course notes");
    assert.equal(message.result.proposalId, null);
    assert.deepEqual(requests.map(({ url }) => url), ["/api/ai/access", "/api/ai/conversations", "/api/ai/messages"]);
  } finally { await unmount(); }
});

test("experimental mode accepts a visible explanatory error without making API requests", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("Unexpected request"); };
  try {
    await mount({ experimental: true });
    let accepted;
    await act(async () => { accepted = latest.send("Question"); });
    assert.equal(accepted, true);
    assert.equal(latest.messages[0].status, "failed");
    assert.match(latest.messages[0].error, /experimental mode/i);
    assert.equal(requests, 0);
  } finally { await unmount(); }
});
