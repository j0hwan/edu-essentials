import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://edu.example.invalid/dashboard",
  pretendToBeVisual: true,
});
for (const name of ["window", "document", "Element", "HTMLElement", "Node"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const [{ createElement, act }, { createRoot }, { default: DashboardLoadTransition, courseImageLoadKey }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import(await clientModule("app/dashboard-load-transition.tsx")),
]);

const rootNode = document.getElementById("root");
let root;
let latestSettlement;

function reset() {
  rootNode.replaceChildren();
  root = createRoot(rootNode);
  latestSettlement = undefined;
}

function transitionProps(overrides = {}) {
  return {
    ready: true,
    imagesListed: true,
    imageKeys: [],
    ...overrides,
    children: (onImageSettled, imagesPending) => {
      latestSettlement = onImageSettled;
      return createElement("div", {
        id: "dashboard-content",
        "data-images-pending": String(imagesPending),
      }, "Dashboard content");
    },
  };
}

async function render(overrides = {}) {
  await act(async () => root.render(createElement(DashboardLoadTransition, transitionProps(overrides))));
}

async function settle(key, callback = latestSettlement) {
  assert.equal(typeof callback, "function", "dashboard content mounted with an image-settlement callback");
  await act(async () => callback(key));
}

async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
  rootNode.replaceChildren();
}

afterEach(async () => {
  await unmount();
  latestSettlement = undefined;
});

test("keeps the dashboard skeleton until workspace, file metadata, and both images settle", async () => {
  reset();
  await render({ ready: false, imagesListed: false, imageKeys: ["image-a", "image-b"] });
  assert.ok(rootNode.querySelector(".courses-skeleton"), "workspace loading renders the CoursesSkeleton");
  assert.equal(rootNode.querySelector("#dashboard-content"), null, "the dashboard is not mounted before workspace readiness");

  await render({ ready: true, imagesListed: false, imageKeys: [] });
  assert.ok(rootNode.querySelector(".courses-skeleton"), "the skeleton remains while private-file metadata is loading");
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "true", "the live dashboard mounts so private images can load");

  await render({ ready: true, imagesListed: true, imageKeys: ["image-a", "image-b"] });
  assert.ok(rootNode.querySelector(".courses-skeleton"), "the skeleton remains while both image decodes are pending");
  await settle("image-a");
  assert.ok(rootNode.querySelector(".courses-skeleton"), "one decoded image does not reveal a dashboard with another pending image");
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "true");

  // The same settlement callback is used after either decode success or failure.
  await settle("image-b");
  assert.equal(rootNode.querySelector(".courses-skeleton"), null, "a failed image also settles and unblocks the dashboard");
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "false");
});

test("a stale image source settlement cannot unlock a newer source key", async () => {
  reset();
  await render({ imageKeys: ["file-a:revision-1"] });
  const oldSourceCallback = latestSettlement;

  await render({ imageKeys: ["file-a:revision-2"] });
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "true");
  await settle("file-a:revision-1", oldSourceCallback);
  await settle("file-a:revision-1");
  assert.ok(rootNode.querySelector(".courses-skeleton"), "an old source key cannot settle the current image");

  await settle("file-a:revision-2");
  assert.equal(rootNode.querySelector(".courses-skeleton"), null);

  const file = { id: "file-a", content_revision: 2, updated_at: "2026-10-26T12:00:00.000Z" };
  assert.equal(courseImageLoadKey(file), JSON.stringify([file.id, file.content_revision, file.updated_at]));
  assert.notEqual(courseImageLoadKey(file), courseImageLoadKey({ ...file, content_revision: 3 }), "a content revision creates a new image source key");
});

test("keeps already-settled image keys when the current list adds another image", async () => {
  reset();
  await render({ imagesListed: false, imageKeys: ["image-a"] });
  await settle("image-a");
  assert.ok(rootNode.querySelector(".courses-skeleton"), "the pending file listing still holds the skeleton");

  await render({ imagesListed: true, imageKeys: ["image-a", "image-b"] });
  assert.ok(rootNode.querySelector(".courses-skeleton"), "the newly listed image remains pending while the settled image stays settled");
  await settle("image-b");
  assert.equal(rootNode.querySelector(".courses-skeleton"), null, "adding image B does not make decoded image A wait for another settlement");
});

test("reveals immediately once an empty image list is confirmed", async () => {
  reset();
  await render({ imagesListed: true, imageKeys: [] });
  assert.equal(rootNode.querySelector(".courses-skeleton"), null, "a confirmed empty image list has no artificial wait");
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "false");
});

test("does not restore the full-page skeleton for file changes after reveal", async () => {
  reset();
  await render({ imageKeys: ["file-a:revision-1"] });
  await settle("file-a:revision-1");
  assert.equal(rootNode.querySelector(".courses-skeleton"), null);
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "false");

  await render({ imageKeys: ["file-a:revision-2"] });
  assert.equal(rootNode.querySelector(".courses-skeleton"), null, "a live file edit never replaces the revealed dashboard with the skeleton");
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "false", "the dashboard remains visible while the edited image loads");
});

test("ignores an old settlement after unmount and starts a fresh pending boundary on remount", async () => {
  reset();
  await render({ imageKeys: ["image-a"] });
  const oldMountCallback = latestSettlement;
  await unmount();

  await act(async () => oldMountCallback("image-a"));
  reset();
  await render({ imageKeys: ["image-a"] });
  assert.ok(rootNode.querySelector(".courses-skeleton"), "a previous mount cannot leak settled state into a new mount");
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "true");
});

test("reduced motion keeps the accessible skeleton while pending and reveals immediately on settlement", async () => {
  reset();
  await render({ reducedMotion: true, imageKeys: ["image-a"] });
  const skeleton = rootNode.querySelector(".courses-skeleton[role='status']");
  assert.ok(skeleton, "the reduced-motion option retains the loading skeleton");
  assert.ok(skeleton.classList.contains("courses-skeleton--reduced"));
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "true");

  await settle("image-a");
  assert.equal(rootNode.querySelector(".courses-skeleton"), null, "settlement reveals immediately without an animation delay");
  assert.equal(rootNode.querySelector("#dashboard-content")?.dataset.imagesPending, "false");
});
