import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/assistant" });
for (const name of ["window", "document", "HTMLElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: AcademicAssistant } = await import(await clientModule("app/academic-assistant.tsx"));
const node = document.getElementById("root");

test("dashboard follow-up loads its conversation and sends exactly once without creating another chat", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const consumed = [];
  const firstMessage = { id: "first", question: "First question", status: "complete", created_at: "2026-10-14T12:00:00Z", result: { answer: { blocks: [{ kind: "general", text: "First answer", citations: [] }] }, citations: [], proposalId: null } };
  let followUp;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/access")) return Response.json({ eligible: true, enabled: true });
    if (url.endsWith("/conversations")) {
      assert.notEqual(init?.method, "POST");
      return Response.json({ conversations: [{ id: "conversation-one", title: "First question" }] });
    }
    if (url.includes("messages?conversationId=conversation-one")) return Response.json({ messages: followUp ? [firstMessage, followUp] : [firstMessage] });
    if (url.endsWith("/messages") && init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.conversationId, "conversation-one");
      assert.equal(body.message, "Follow-up question");
      followUp = { id: body.requestId, question: body.message, status: "complete", created_at: "2026-10-14T12:01:00Z", result: { answer: { blocks: [{ kind: "general", text: "Follow-up answer", citations: [] }] }, citations: [], proposalId: null } };
      return Response.json(followUp);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const root = createRoot(node);
  const props = { profileId: "profile-one", prepare: async () => {}, apply: async () => {}, experimental: false, initialPrompt: { id: "handoff", question: "Follow-up question", send: true, conversationId: "conversation-one" }, onPromptConsumed: (id) => consumed.push(id) };
  try {
    await act(async () => root.render(createElement(AcademicAssistant, props)));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.match(node.textContent, /First question/);
    assert.match(node.textContent, /First answer/);
    assert.match(node.textContent, /Follow-up answer/);
    assert.deepEqual(consumed, ["handoff"]);
    await act(async () => root.render(createElement(AcademicAssistant, { ...props, initialPrompt: { ...props.initialPrompt } })));
    assert.equal(requests.filter(({ init }) => init?.method === "POST").length, 1);
    assert.ok(requests.findIndex(({ url }) => url.includes("messages?")) < requests.findIndex(({ init }) => init?.method === "POST"));
  } finally {
    await act(async () => root.unmount());
    node.replaceChildren();
    globalThis.fetch = originalFetch;
  }
});
