import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { act, createElement as element } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>');
for (const name of ["window", "document", "HTMLElement", "SVGElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: Transition, CourseEditTransitionContext: Context, CourseEditTransitionList: TransitionList } = await import(await clientModule("app/course-edit-transition.tsx"));
const { default: MeetingLocationPreview } = await import(await clientModule("app/meeting-location-preview.tsx"));
const container = document.getElementById("root");
let root;
let animations = [];

HTMLElement.prototype.animate = function (frames, options) {
  const animation = { onfinish: null, cancelled: false, cancel() { this.cancelled = true; } };
  animations.push({ target: this, frames, options, animation });
  return animation;
};

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  animations = [];
  delete document.documentElement.dataset.motion;
  delete window.matchMedia;
});
after(() => dom.window.close());

async function render({ name = "Biology", instructor = "Dr. Ada", paused = false, enabled = true } = {}) {
  root ??= createRoot(container);
  await act(async () => root.render(element(Context.Provider, { value: enabled ? paused : null },
    element("section", null,
      element(Transition, { revision: name }, element("span", { "data-field": "name" }, name)),
      element(Transition, { revision: instructor }, element("span", { "data-field": "instructor" }, instructor)),
      element("button", null, "Edit class"),
    ),
  )));
}

test("only a changed field fades out before the new content fades in", async () => {
  await render();
  const section = container.firstElementChild;
  const name = container.querySelector('[data-field="name"]');
  const instructor = container.querySelector('[data-field="instructor"]');
  const button = container.querySelector("button");
  await render({ name: "Chemistry" });
  assert.equal(name.textContent, "Biology");
  assert.equal(animations.length, 1);
  assert.equal(animations[0].target, name);
  assert.deepEqual(animations[0].frames, [{ opacity: 1 }, { opacity: 0 }]);
  await act(async () => animations[0].animation.onfinish());
  assert.equal(name.textContent, "Chemistry");
  assert.equal(animations.length, 2);
  assert.deepEqual(animations[1].frames, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(animations[1].target, name);
  assert.equal(container.firstElementChild, section);
  assert.equal(container.querySelector('[data-field="instructor"]'), instructor);
  assert.equal(container.querySelector("button"), button);
});

test("saving and retrying under the overlay holds the original content until setup closes", async () => {
  await render();
  await render({ paused: true });
  await render({ name: "Chemistry", paused: true });
  await render({ name: "Physics", paused: true });
  assert.equal(container.querySelector('[data-field="name"]').textContent, "Biology");
  assert.equal(animations.length, 0);
  await render({ name: "Physics" });
  assert.equal(animations.length, 1);
  await act(async () => animations[0].animation.onfinish());
  assert.equal(container.querySelector('[data-field="name"]').textContent, "Physics");
});

test("canceling without changes does not fade any content", async () => {
  await render();
  await render({ paused: true });
  await render();
  assert.equal(animations.length, 0);
});

test("a newer edit cancels the stale fade and displays only the latest content", async () => {
  await render();
  await render({ name: "Chemistry" });
  const stale = animations[0].animation;
  await render({ name: "Physics" });
  assert.equal(stale.cancelled, true);
  await act(async () => stale.onfinish());
  assert.equal(container.querySelector('[data-field="name"]').textContent, "Biology");
  await act(async () => animations[1].animation.onfinish());
  assert.equal(container.querySelector('[data-field="name"]').textContent, "Physics");
});

for (const preference of ["app", "system"]) test(`${preference} reduced motion replaces content immediately`, async () => {
  if (preference === "app") document.documentElement.dataset.motion = "reduced";
  else window.matchMedia = () => ({ matches: true });
  await render();
  await render({ name: "Chemistry" });
  assert.equal(container.querySelector('[data-field="name"]').textContent, "Chemistry");
  assert.equal(animations.length, 0);
});

test("cards outside an expanded course update without animations", async () => {
  await render({ enabled: false });
  await render({ enabled: false, name: "Chemistry" });
  assert.equal(container.querySelector('[data-field="name"]').textContent, "Chemistry");
  assert.equal(animations.length, 0);
});

for (const support of ["missing", "throwing"]) test(`${support} animation APIs do not prevent saved content from appearing`, async () => {
  const animate = HTMLElement.prototype.animate;
  if (support === "missing") delete HTMLElement.prototype.animate;
  else HTMLElement.prototype.animate = () => { throw new Error("Animations unavailable"); };
  try {
    await render();
    await render({ name: "Chemistry" });
    assert.equal(container.querySelector('[data-field="name"]').textContent, "Chemistry");
  } finally { HTMLElement.prototype.animate = animate; }
});

test("the fallback completes when an animation never emits finish", async () => {
  await render();
  await render({ name: "Chemistry" });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 260)));
  assert.equal(container.querySelector('[data-field="name"]').textContent, "Chemistry");
});

test("unmount cancels an in-flight edit transition", async () => {
  await render();
  await render({ name: "Chemistry" });
  const animation = animations[0].animation;
  await act(async () => root.unmount());
  root = undefined;
  assert.equal(animation.cancelled, true);
  await act(async () => animation.onfinish());
  assert.equal(container.textContent, "");
});

test("a preview entering from null fades in on its new DOM node", async () => {
  root = createRoot(container);
  const renderPreview = async (visible) => act(async () => root.render(element(Context.Provider, { value: false },
    element(Transition, { revision: String(visible) }, element(MeetingLocationPreview, { location: visible ? "https://example.com" : "" })),
  )));
  await renderPreview(false);
  await renderPreview(true);
  assert.equal(container.querySelector("a").href, "https://example.com/");
  assert.equal(animations.length, 1);
  assert.equal(animations[0].target, container.firstElementChild);
  assert.deepEqual(animations[0].frames, [{ opacity: 0 }, { opacity: 1 }]);
});

test("meeting additions and removals leave retained meetings visible while their edited fields transition", async () => {
  root = createRoot(container);
  const renderMeetings = async (meetings, paused = false) => act(async () => root.render(element(Context.Provider, { value: paused },
    element("section", null, element(TransitionList, null, meetings.map(([id, name]) => element("article", { key: id, "data-id": id },
      element(Transition, { revision: name }, element("h3", null, name)),
    )))),
  )));
  await renderMeetings([["lecture", "Original"], ["lab", "Unchanged"], ["removed", "Removed"]]);
  const lecture = container.querySelector('[data-id="lecture"]');
  const lab = container.querySelector('[data-id="lab"]');
  await renderMeetings([["lecture", "Updated"], ["lab", "Unchanged"], ["new", "Added"]], true);
  assert.equal(animations.length, 0);
  assert.equal(container.querySelector('[data-id="new"]'), null);
  await renderMeetings([["lecture", "Updated"], ["lab", "Unchanged"], ["new", "Added"]]);
  assert.equal(animations.length, 3);
  assert.equal(animations.some(({ target }) => target === lecture || target === lab || lab.contains(target)), false);
  const changed = animations.find(({ target }) => target === lecture.querySelector("h3"));
  const removed = animations.find(({ target }) => target.dataset.id === "removed");
  const added = animations.find(({ target }) => target.dataset.id === "new");
  assert.deepEqual(added.frames, [{ opacity: 0 }, { opacity: 1 }]);
  await act(async () => { changed.animation.onfinish(); removed.animation.onfinish(); });
  assert.equal(lecture.textContent, "Updated");
  assert.equal(container.querySelector('[data-id="removed"]'), null);
  assert.equal(container.querySelector('[data-id="lab"]'), lab);
});

test("an individual weekly meeting label changes without fading the other labels", async () => {
  root = createRoot(container);
  const renderLabels = async (name) => act(async () => root.render(element(Context.Provider, { value: false },
    element("div", null, element(TransitionList, { revisions: { lecture: name, lab: "Lab" } }, [
      element("span", { key: "lecture" }, name), element("span", { key: "lab" }, "Lab"),
    ])),
  )));
  await renderLabels("Lecture");
  const [lecture, lab] = container.querySelectorAll("span");
  await renderLabels("Seminar");
  assert.equal(animations.length, 1);
  assert.equal(animations[0].target, lecture);
  assert.equal(lab.textContent, "Lab");
  await act(async () => animations[0].animation.onfinish());
  assert.equal(lecture.textContent, "Seminar");
  assert.equal(animations.length, 2);
  assert.equal(animations[1].target, lecture);
});
