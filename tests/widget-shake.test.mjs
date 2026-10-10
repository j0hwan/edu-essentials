import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "Element", "HTMLElement", "MouseEvent", "KeyboardEvent"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => dom.window.close());

const [{ createElement, act }, { createRoot }, { useWidgetShake }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/use-widget-shake.ts")),
]);

const rootNode = document.getElementById("root");
let root;

function Widget({ contextKey, onActivate }) {
  const onPointerDownCapture = useWidgetShake(contextKey, onActivate);
  return createElement("section", { "data-widget-id": "widget-a" },
    createElement("div", { className: "widget-header", onPointerDownCapture },
      createElement("span", { id: "title" }, "Widget"),
      createElement("button", { id: "button" }, "Options"),
      createElement("a", { id: "link", href: "#" }, "Link"),
      createElement("input", { id: "input" }),
      createElement("textarea", { id: "textarea" }),
      createElement("select", { id: "select" }),
      createElement("div", { id: "role-button", role: "button" }, "Action"),
      createElement("div", { id: "editable", contentEditable: true, suppressContentEditableWarning: true }, "Edit")),
    createElement("div", { className: "widget-body" },
      createElement("span", { id: "body" }, "Body"),
      createElement("button", { id: "body-button" }, "Body action")));
}

async function mount(props) {
  rootNode.innerHTML = "";
  root = createRoot(rootNode);
  await act(async () => root.render(createElement(Widget, props)));
  return rootNode.querySelector(".widget-header");
}

async function render(props) {
  await act(async () => root.render(createElement(Widget, props)));
}

async function unmount() {
  if (!root) return;
  await act(async () => root.unmount());
  root = undefined;
  rootNode.innerHTML = "";
}

afterEach(unmount);

function pointerEvent(type, {
  pointerId = 1,
  pointerType = "mouse",
  isPrimary = true,
  button = 0,
  buttons = type === "pointerdown" || type === "pointermove" ? 1 : 0,
  clientX = 100,
  clientY = 100,
  timeStamp = 100,
} = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    buttons,
    clientX,
    clientY,
  });
  for (const [name, value] of Object.entries({ pointerId, pointerType, isPrimary, timeStamp })) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

function dispatch(target, event) {
  act(() => target.dispatchEvent(event));
}

function start(header, options = {}) {
  dispatch(header, pointerEvent("pointerdown", options));
}

function shake(pointerId, { target = rootNode.querySelector("#title"), ...options } = {}) {
  const startTime = options.timeStamp ?? 100;
  const startX = options.clientX ?? 100;
  const startY = options.clientY ?? 100;
  start(target, { ...options, pointerId, clientX: startX, clientY: startY, timeStamp: startTime });
  for (const [index, clientX] of [startX + 18, startX, startX + 18].entries()) {
    dispatch(window, pointerEvent("pointermove", {
      pointerId,
      clientX,
      clientY: startY,
      timeStamp: startTime + (index + 1) * 100,
    }));
  }
  dispatch(window, pointerEvent("pointerup", { pointerId, timeStamp: startTime + 500 }));
}

function move(pointerId, clientX, clientY, timeStamp, buttons = 1) {
  dispatch(window, pointerEvent("pointermove", { pointerId, clientX, clientY, timeStamp, buttons }));
}

function shakePath(pointerId, points, { target = rootNode.querySelector("#title"), startTime = 100, timeStep = 100 } = {}) {
  const [startX, startY] = points[0];
  start(target, { pointerId, clientX: startX, clientY: startY, timeStamp: startTime });
  for (const [index, [clientX, clientY]] of points.slice(1).entries()) {
    move(pointerId, clientX, clientY, startTime + (index + 1) * timeStep);
  }
  dispatch(window, pointerEvent("pointerup", { pointerId, timeStamp: startTime + points.length * timeStep }));
}

function finishShake(pointerId, { startX = 100, startY = 100, startTime = 100, timeStep = 100 } = {}) {
  for (const [index, clientX] of [startX + 18, startX, startX + 18].entries()) {
    move(pointerId, clientX, startY, startTime + (index + 1) * timeStep);
  }
}

test("activates once after three 18px horizontal strokes at inclusive limits", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });
  start(header, { pointerId: 11, clientX: 100, clientY: 100, timeStamp: 100 });
  move(11, 118, 100, 400);
  move(11, 100, 100, 700);
  assert.equal(activations.length, 0, "activation waits until the third stroke");
  move(11, 118, 100, 1300);
  assert.deepEqual(activations, ["activated"], "18px legs and 1200ms duration are accepted");
  move(11, 100, 100, 1400);
  move(11, 118, 100, 1500);
  assert.deepEqual(activations, ["activated"], "continued movement does not activate again");
  assert.equal(rootNode.querySelectorAll("[data-widget-id]").length, 1, "the hook leaves widget structure unchanged");
});

test("hands the original press and current pointer to activation after releasing header capture", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: (startEvent, currentEvent) => {
    assert.equal(captured, false, "header capture is released before handoff");
    activations.push({ startEvent, currentEvent });
  } });
  let captured = false;
  header.setPointerCapture = () => { captured = true; };
  header.hasPointerCapture = () => captured;
  header.releasePointerCapture = () => { captured = false; };
  const title = header.querySelector("#title");
  const press = pointerEvent("pointerdown", { pointerId: 90, clientX: 100, clientY: 110 });
  dispatch(title, press);
  move(90, 120, 130, 200);
  move(90, 100, 110, 300);
  const activation = pointerEvent("pointermove", { pointerId: 90, clientX: 120, clientY: 130, timeStamp: 400 });
  dispatch(window, activation);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].startEvent, press);
  assert.equal(activations[0].currentEvent, activation);
  assert.equal(activations[0].startEvent.target, title);
});

test("detects vertical, diagonal, leftward, upward, and mixed-heading shakes", async () => {
  const activations = [];
  await mount({ contextKey: "workspace-a", onActivate: () => activations.push(activations.length) });
  const paths = [
    ["vertical", [[100, 100], [100, 118], [100, 100], [100, 118]]],
    ["vertical excursion beyond 48px", [[100, 100], [100, 160], [100, 100], [100, 160]]],
    ["down-right diagonal", [[100, 100], [118, 118], [100, 100], [118, 118]]],
    ["up-right diagonal", [[100, 118], [118, 100], [100, 118], [118, 100]]],
    ["non-45-degree diagonal", [[100, 100], [118, 136], [100, 100], [118, 136]]],
    ["leftward initial movement", [[100, 100], [82, 100], [100, 100], [82, 100]]],
    ["upward initial movement", [[100, 100], [100, 82], [100, 100], [100, 82]]],
    ["mixed-heading backtracking", [[100, 100], [120, 100], [100, 112], [114, 94]]],
  ];

  for (const [index, [description, points]] of paths.entries()) {
    shakePath(index + 30, points, { startTime: 1000 + index * 1000 });
    assert.equal(activations.length, index + 1, `${description} should activate`);
  }
});

test("ignores controls, widget body, and unsupported pointer presses", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });
  const ignoredTargets = [
    ["button", rootNode.querySelector("#button"), {}],
    ["link", rootNode.querySelector("#link"), {}],
    ["input", rootNode.querySelector("#input"), {}],
    ["textarea", rootNode.querySelector("#textarea"), {}],
    ["select", rootNode.querySelector("#select"), {}],
    ["role button", rootNode.querySelector("#role-button"), {}],
    ["editable content", rootNode.querySelector("#editable"), {}],
    ["widget body", rootNode.querySelector("#body"), {}],
    ["body button", rootNode.querySelector("#body-button"), {}],
    ["touch", header.querySelector("#title"), { pointerType: "touch" }],
    ["pen", header.querySelector("#title"), { pointerType: "pen" }],
    ["non-primary pointer", header.querySelector("#title"), { isPrimary: false }],
    ["secondary mouse button", header.querySelector("#title"), { button: 2 }],
  ];

  for (const [index, [description, target, options]] of ignoredTargets.entries()) {
    shake(index + 20, { target, ...options });
    assert.equal(activations.length, 0, `${description} must not activate`);
  }
});

test("requires 18px per leg and cancels excessive elapsed time", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });

  start(header, { pointerId: 40, timeStamp: 100 });
  for (const [index, clientX] of [117, 100, 117, 100].entries()) move(40, clientX, 100, 200 + index * 100);
  assert.equal(activations.length, 0, "17px legs do not count toward the shake");

  start(header, { pointerId: 42, timeStamp: 2000 });
  move(42, 118, 100, 2300);
  move(42, 100, 100, 2600);
  move(42, 118, 100, 3201);
  assert.equal(activations.length, 0, "a shake taking more than 1200ms is canceled");
});

test("ignores 2D jitter and one-way movement", async () => {
  const activations = [];
  await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });

  shakePath(47, [[100, 100], [118, 118], [136, 136], [118, 154], [154, 154], [136, 172], [172, 172]]);
  assert.equal(activations.length, 0, "orthogonal 2D jitter is not counted as directional reversal");

  shakePath(48, [[100, 100], [118, 100], [136, 118], [154, 136], [172, 154], [190, 172]]);
  assert.equal(activations.length, 0, "curved one-way 2D movement has no reversals");
});

test("ignores one-way movement, unrelated pointer IDs, and moves after buttons are released", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });

  start(header, { pointerId: 43, timeStamp: 100 });
  for (const [index, clientX] of [118, 136, 154, 172].entries()) move(43, clientX, 100, 200 + index * 100);
  assert.equal(activations.length, 0, "one-way movement has no reversals");
  dispatch(window, pointerEvent("pointerup", { pointerId: 43, timeStamp: 600 }));

  start(header, { pointerId: 44, timeStamp: 1000 });
  for (const [index, clientX] of [118, 100, 118, 100].entries()) move(45, clientX, 100, 1100 + index * 100);
  assert.equal(activations.length, 0, "moves from a different pointer ID are ignored");
  dispatch(window, pointerEvent("pointerup", { pointerId: 44, timeStamp: 1600 }));

  start(header, { pointerId: 46, timeStamp: 2000 });
  move(46, 118, 100, 2100, 0);
  move(46, 100, 100, 2200);
  move(46, 118, 100, 2300);
  move(46, 100, 100, 2400);
  assert.equal(activations.length, 0, "a move with no pressed buttons cancels the gesture");
});

test("cancels on pointer release, cancellation, capture loss, blur, and Escape", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });
  const cancellations = [
    ["pointer release", (pointerId) => dispatch(window, pointerEvent("pointerup", { pointerId, timeStamp: 1100 }))],
    ["pointer cancellation", (pointerId) => dispatch(window, pointerEvent("pointercancel", { pointerId, timeStamp: 1100 }))],
    ["lost capture", (pointerId) => dispatch(header, pointerEvent("lostpointercapture", { pointerId, timeStamp: 1100 }))],
    ["window blur", () => dispatch(window, new window.Event("blur"))],
    ["Escape", () => dispatch(window, new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
  ];

  for (const [index, [description, cancel]] of cancellations.entries()) {
    const pointerId = index + 50;
    start(header, { pointerId, timeStamp: 1000 });
    cancel(pointerId);
    finishShake(pointerId, { startTime: 1100 });
    assert.equal(activations.length, 0, `${description} must prevent activation`);
  }
});

test("sets pointer capture and releases it on cancellation and activation", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });
  const heldPointers = new Set();
  const setCalls = [];
  const releaseCalls = [];
  header.setPointerCapture = (pointerId) => { setCalls.push(pointerId); heldPointers.add(pointerId); };
  header.hasPointerCapture = (pointerId) => heldPointers.has(pointerId);
  header.releasePointerCapture = (pointerId) => { releaseCalls.push(pointerId); heldPointers.delete(pointerId); };

  start(header, { pointerId: 80, timeStamp: 100 });
  assert.deepEqual(setCalls, [80]);
  assert.equal(heldPointers.has(80), true);
  dispatch(window, pointerEvent("pointercancel", { pointerId: 80, timeStamp: 110 }));
  assert.deepEqual(releaseCalls, [80]);
  assert.equal(heldPointers.has(80), false);

  start(header, { pointerId: 81, timeStamp: 1000 });
  assert.deepEqual(setCalls, [80, 81]);
  finishShake(81, { startTime: 1000 });
  assert.deepEqual(activations, ["activated"]);
  assert.deepEqual(releaseCalls, [80, 81]);
  assert.equal(heldPointers.has(81), false);
});

test("cancels an active gesture when context or callback availability changes", async () => {
  const activations = [];
  const callback = () => activations.push("activated");
  const initial = { contextKey: "workspace-a", onActivate: callback };
  let header = await mount(initial);

  start(header, { pointerId: 60, timeStamp: 100 });
  await render({ ...initial, contextKey: "workspace-b" });
  finishShake(60);
  assert.equal(activations.length, 0, "changing context cancels an in-progress gesture");

  header = rootNode.querySelector(".widget-header");
  start(header, { pointerId: 61, timeStamp: 1000 });
  await render({ contextKey: "workspace-b" });
  finishShake(61, { startTime: 1100 });
  assert.equal(activations.length, 0, "removing the callback cancels an in-progress gesture");

  shake(62, { target: rootNode.querySelector("#title") });
  assert.equal(activations.length, 0, "a missing callback cannot start a gesture");

  await render({ contextKey: "workspace-b", onActivate: callback });
  shake(63);
  assert.deepEqual(activations, ["activated"], "a gesture can activate after the callback becomes available again");
});

test("unmount cancels an active gesture", async () => {
  const activations = [];
  const header = await mount({ contextKey: "workspace-a", onActivate: () => activations.push("activated") });
  start(header, { pointerId: 70, timeStamp: 100 });
  await unmount();
  finishShake(70);
  assert.equal(activations.length, 0);
});
