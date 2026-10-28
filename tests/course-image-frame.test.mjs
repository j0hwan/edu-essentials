import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div><button data-course-card-id="biology"><div class="class-card-media"><img></div></button>');
for (const name of ["window", "document", "HTMLElement", "Element", "Node", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const [{ createElement, act }, { createRoot }, { default: CourseImageFrame, refreshCourseImageFrames }] = await Promise.all([
  import("react"), import("react-dom/client"), import(await clientModule("app/course-image-frame.tsx")),
]);
let resize;
let disconnected = false;
globalThis.ResizeObserver = class {
  constructor(callback) { resize = callback; }
  observe() {}
  disconnect() { disconnected = true; }
};
let width = 838;
Object.defineProperties(HTMLElement.prototype, {
  clientWidth: { configurable: true, get() { return this.className === "class-card-media" ? 300 : width; } },
  clientHeight: { configurable: true, get() { return this.className === "class-card-media" ? 132 : 190; } },
});
const image = document.querySelector("img");
Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });

test("expanded framing preserves the saved preview center, resizes, and supports legacy covers", async () => {
  const root = createRoot(document.getElementById("root"));
  const framing = { fileId: "cover", x: 25, y: 80, zoom: 2, imageAspectRatio: 1.5, frameAspectRatio: 300 / 132 };
  const render = async (saved = framing, expanded = true) => act(async () => root.render(createElement("div", null,
    createElement(CourseImageFrame, { framing: saved, fileId: "cover", courseId: "biology", expanded }, createElement("img")),
  )));
  const center = () => {
    const frame = document.querySelector("#root .course-image-frame");
    const position = parseFloat(frame.style.objectPosition.split(" ")[1]) / 100;
    const height = Math.max(1, width / 190 / 1.5);
    return 0.5 + (position - 0.5) * (1 - 1 / height);
  };
  const expected = 0.5 + 0.3 * (1 - 1 / (300 / 132 / 1.5 * 2));
  try {
    await render();
    assert.ok(Math.abs(center() - expected) < 1e-10);
    width = 700;
    refreshCourseImageFrames(document.getElementById("root"));
    assert.ok(Math.abs(center() - expected) < 1e-10, "pinned morph layouts update synchronously before animation");
    width = 1000;
    await act(async () => resize());
    assert.ok(Math.abs(center() - expected) < 1e-10);
    await render({ fileId: "cover", x: 25, y: 80, zoom: 2 });
    assert.ok(Math.abs(center() - expected) < 1e-10, "legacy covers use decoded source geometry");
    document.querySelector("[data-course-card-id]").remove();
    await render();
    assert.ok(Math.abs(center() - expected) < 1e-10, "saved preview geometry also works without a dashboard source card");
    await render(framing, false);
    const frame = document.querySelector("#root .course-image-frame");
    assert.equal(frame.style.objectPosition, "25% 80%");
    assert.equal(frame.style.transform, "scale(2)");
    assert.equal(disconnected, true);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
