import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

test("course preview reveal waits for every listed participant and ignores stale keys", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
  for (const name of ["window", "document", "HTMLElement", "Element", "Node", "Event"]) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const [{ createElement, useRef, act }, { createRoot }, revealModule] = await Promise.all([
    import("react"), import("react-dom/client"), import(await clientModule("app/course-preview-reveal.tsx")),
  ]);
  const { CoursePreviewPlaceholder, CoursePreviewRevealProvider, MAP_PREVIEW_PLACEHOLDERS, SYLLABUS_PREVIEW_PLACEHOLDER, useCoursePreviewReveal } = revealModule;
  const rootNode = document.getElementById("root");
  const root = createRoot(rootNode);

  function Probe({ participantKey }) {
    const { revealed, settle, coordinated } = useCoursePreviewReveal(participantKey);
    const firstSettle = useRef(settle);
    return createElement("div", {
      "data-participant": participantKey ?? "observer",
      "data-revealed": String(revealed),
      "data-coordinated": String(coordinated),
      "data-settle-stable": String(firstSettle.current === settle),
    }, createElement("button", { onClick: settle }, "Settle"));
  }

  function Fixture({ participants, mounted, group }) {
    return createElement(CoursePreviewRevealProvider, { key: group, participants }, createElement("section", null,
      ...mounted.map((key) => createElement(Probe, { key, participantKey: key })),
      createElement(Probe, { key: "unknown", participantKey: "removed-participant" }),
      createElement(CoursePreviewPlaceholder, { kind: "map" }),
      createElement(CoursePreviewPlaceholder, { kind: "syllabus" }),
    ));
  }

  let group = "first";
  const render = (participants, mounted = participants, nextGroup = group) => {
    group = nextGroup;
    return act(async () => root.render(createElement(Fixture, { participants, mounted, group })));
  };
  const revealFor = (key) => rootNode.querySelector(`[data-participant="${key}"]`).getAttribute("data-revealed");
  const settleFor = (key) => rootNode.querySelector(`[data-participant="${key}"] button`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });

  await render(["alpha", "beta"], ["alpha"]);
  assert.equal(revealFor("alpha"), "false", "a listed participant that has not mounted still blocks reveal");
  const mapPlaceholderSrc = rootNode.querySelector(".course-preview-placeholder").getAttribute("src");
  assert.ok(MAP_PREVIEW_PLACEHOLDERS.includes(mapPlaceholderSrc), "the randomized map placeholder uses one of the server-safe assets");
  assert.equal(rootNode.querySelectorAll(".course-preview-placeholder")[1].getAttribute("src"), SYLLABUS_PREVIEW_PLACEHOLDER);

  await act(async () => settleFor("removed-participant"));
  await act(async () => settleFor("alpha"));
  await act(async () => settleFor("alpha"));
  assert.equal(revealFor("alpha"), "false", "settlement is idempotent and unknown keys cannot release the group");
  assert.equal(rootNode.querySelector('[data-participant="alpha"]').getAttribute("data-settle-stable"), "true", "the participant callback stays stable as barrier state changes");
  assert.equal(rootNode.querySelector(".course-preview-placeholder").getAttribute("src"), mapPlaceholderSrc, "a mounted map keeps its chosen placeholder during rerenders");

  await render(["beta", "alpha"], ["alpha", "beta"], "second");
  assert.equal(revealFor("alpha"), "false");
  await act(async () => settleFor("beta"));
  assert.equal(revealFor("alpha"), "false", "the group remains hidden until alpha also settles");
  await act(async () => settleFor("alpha"));
  assert.equal(revealFor("alpha"), "true", "participants can settle in any order");

  await render(["alpha", "beta"], ["alpha", "beta"], "third");
  await act(async () => settleFor("alpha"));
  assert.equal(revealFor("alpha"), "false");
  await render(["alpha"], ["alpha"], "third");
  assert.equal(revealFor("alpha"), "true", "removing a blocked participant releases the remaining settled participants");

  await render([], [], "fourth");
  assert.equal(revealFor("removed-participant"), "true", "an empty explicit participant list is immediately ready");
  assert.ok(MAP_PREVIEW_PLACEHOLDERS.includes(rootNode.querySelector(".course-preview-placeholder").getAttribute("src")), "the mounted map placeholder remains one of the randomized options");
});

test("preview hooks outside a provider remain uncoordinated and immediately revealed", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
  for (const name of ["window", "document", "HTMLElement", "Element", "Node", "Event"]) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const [{ createElement }, { createRoot }, { useCoursePreviewReveal }] = await Promise.all([
    import("react"), import("react-dom/client"), import(await clientModule("app/course-preview-reveal.tsx")),
  ]);
  const rootNode = document.getElementById("root");
  const root = createRoot(rootNode);
  function Probe() {
    const state = useCoursePreviewReveal("not-coordinated");
    return createElement("span", { "data-revealed": String(state.revealed), "data-coordinated": String(state.coordinated) }, "Ready");
  }

  try {
    await import("react").then(({ act }) => act(async () => root.render(createElement(Probe))));
    assert.equal(rootNode.querySelector("span").getAttribute("data-revealed"), "true");
    assert.equal(rootNode.querySelector("span").getAttribute("data-coordinated"), "false");
  } finally {
    await import("react").then(({ act }) => act(async () => root.unmount()));
    dom.window.close();
  }
});
