import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLImageElement", "HTMLCanvasElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.localStorage = window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const nativeCreateObjectURL = globalThis.URL.createObjectURL;
const nativeRevokeObjectURL = globalThis.URL.revokeObjectURL;
const nativeImageComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
const nativeNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");
const nativeNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalHeight");
const nativeDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
const nativeGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
const nativeToDataURL = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "toDataURL");
let objectUrlId = 0;
globalThis.URL.createObjectURL = () => `blob:expanded-course-${++objectUrlId}`;
globalThis.URL.revokeObjectURL = () => {};
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
dom.window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;
Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 64 });
Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 48 });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({ drawImage() {} }) });
Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", { configurable: true, value: () => "data:image/jpeg;base64,YQ==" });

const [{ createElement, act }, { createRoot }, { default: ExpandedCourseImage }, { PrivateImage }, { CoursePreviewRevealProvider, useCoursePreviewReveal }] = await Promise.all([
  import("react"), import("react-dom/client"), import(await clientModule("app/expanded-course-image.tsx")),
  import(await clientModule("app/private-files.tsx")), import(await clientModule("app/course-preview-reveal.tsx")),
]);

const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE_A = "course-biology";
const COURSE_B = "course-history";
const FILE_A = "11111111-1111-4111-8111-111111111111";
const FILE_B = "22222222-2222-4222-8222-222222222222";
const thumbnailKey = (profileId) => `edu-dashboard-course-thumbnail:${profileId}`;
const expandedKey = (profileId) => `edu-dashboard-expanded-course:${profileId}`;
const rootNode = document.getElementById("root");
let root;
let nextDecode;
let decodeCalls;

const file = (id = FILE_A, overrides = {}) => ({
  id, name: "Course photo.png", mime_type: "image/png", size_bytes: 100,
  course_id: COURSE_A, assignment_id: null, kind: "class-image", state: "ready",
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z",
  content_sha256: null, folder_id: null, content_backend: "object", metadata_revision: 1,
  content_revision: 5, trashed_at: null, deleted_at: null, trash_operation_id: null, original_folder_id: null,
  ...overrides,
});

function cachedRecord(courseId = COURSE_A, currentFile = file()) {
  return {
    version: 1, courseId, fileId: currentFile.id, contentRevision: currentFile.content_revision,
    updatedAt: currentFile.updated_at, dataUrl: "data:image/jpeg;base64,YQ==", width: 32, height: 24,
  };
}

function reset() {
  window.localStorage.clear();
  rootNode.replaceChildren();
  root = createRoot(rootNode);
  nextDecode = null;
  decodeCalls = [];
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value() { decodeCalls.push(this.src); return nextDecode?.promise ?? Promise.resolve(); },
  });
}

async function render(props) {
  await act(async () => root.render(createElement(ExpandedCourseImage, props)));
}

async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
  rootNode.replaceChildren();
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function RevealProbe({ participant }) {
  const { revealed, settle } = useCoursePreviewReveal(participant);
  return createElement("button", {
    type: "button", "data-participant": participant, "data-revealed": String(revealed),
    onClick: settle,
  }, participant);
}

function coordinatedImage(participants, imageProps, ...siblings) {
  return createElement(CoursePreviewRevealProvider, { participants },
    createElement(ExpandedCourseImage, { ...imageProps, previewKey: "header" }),
    ...siblings,
  );
}

function setCached(profileId = PROFILE_A, courseId = COURSE_A, currentFile = file()) {
  window.localStorage.setItem(thumbnailKey(profileId), JSON.stringify(cachedRecord(courseId, currentFile)));
}

function props(overrides = {}) {
  return {
    profileId: PROFILE_A, courseId: COURSE_A, file: undefined, filesReady: false, restored: true,
    cacheEnabled: true, store: { blob: async () => new Blob(["private image"], { type: "image/png" }) },
    ...overrides,
  };
}

afterEach(async () => { await unmount(); });
after(() => {
  dom.window.close();
  if (nativeCreateObjectURL) globalThis.URL.createObjectURL = nativeCreateObjectURL; else delete globalThis.URL.createObjectURL;
  if (nativeRevokeObjectURL) globalThis.URL.revokeObjectURL = nativeRevokeObjectURL; else delete globalThis.URL.revokeObjectURL;
  if (nativeImageComplete) Object.defineProperty(HTMLImageElement.prototype, "complete", nativeImageComplete); else delete HTMLImageElement.prototype.complete;
  if (nativeNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", nativeNaturalWidth); else delete HTMLImageElement.prototype.naturalWidth;
  if (nativeNaturalHeight) Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", nativeNaturalHeight); else delete HTMLImageElement.prototype.naturalHeight;
  if (nativeDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", nativeDecode); else delete HTMLImageElement.prototype.decode;
  if (nativeGetContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", nativeGetContext); else delete HTMLCanvasElement.prototype.getContext;
  if (nativeToDataURL) Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", nativeToDataURL); else delete HTMLCanvasElement.prototype.toDataURL;
});

test("restored expansion keeps its blurred thumbnail beneath a held high-resolution image", async () => {
  reset();
  setCached();
  const bytes = deferred(), decoded = deferred();
  nextDecode = decoded;
  const currentFile = file();
  await render(props({ file: undefined, filesReady: false }));
  assert.ok(rootNode.querySelector("img.private-class-image-thumbnail"), "the cached thumbnail appears while the file list is pending");
  await render(props({ file: currentFile, filesReady: true, store: { blob: async () => bytes.promise } }));
  assert.ok(rootNode.querySelector("img.private-class-image-thumbnail"), "the matching cached thumbnail stays visible while the private blob loads");
  assert.equal(rootNode.querySelector("img.private-class-image-fade"), null);

  await act(async () => { bytes.resolve(new Blob(["high-resolution image"], { type: "image/png" })); await bytes.promise; });
  const highResolution = rootNode.querySelector("img.private-class-image-fade");
  assert.ok(highResolution);
  assert.equal(highResolution.classList.contains("is-ready"), false, "the full image remains transparent until decode settles");
  assert.ok(rootNode.querySelector("img.private-class-image-thumbnail"), "the blurred image stays beneath the full-resolution fade");
  await act(async () => { decoded.resolve(); await decoded.promise; await Promise.resolve(); });
  assert.equal(highResolution.classList.contains("is-ready"), true);
  assert.ok(rootNode.querySelector("img.private-class-image-thumbnail"), "the thumbnail may remain under the opaque full image until unmount");
});

test("thumbnail writes happen only after the expanded image decodes and while that course is active", async () => {
  reset();
  const decodedWithoutActiveCourse = deferred();
  nextDecode = decodedWithoutActiveCourse;
  const currentFile = file();
  await render(props({ file: currentFile, filesReady: true, restored: false }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(decodeCalls.length, 1, "the manually opened image is also observed after decode");
  assert.equal(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null, "no thumbnail is written before the active expansion guard passes");
  window.localStorage.setItem(expandedKey(PROFILE_A), COURSE_B);
  await act(async () => { decodedWithoutActiveCourse.resolve(); await decodedWithoutActiveCourse.promise; await Promise.resolve(); });
  assert.equal(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null, "a closed or different expanded course cannot receive this image");

  await unmount();
  reset();
  const decodedWithActiveCourse = deferred();
  nextDecode = decodedWithActiveCourse;
  window.localStorage.setItem(expandedKey(PROFILE_A), COURSE_A);
  await render(props({ file: currentFile, filesReady: true, restored: false }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null, "the cache is still empty while decode is held");
  await act(async () => { decodedWithActiveCourse.resolve(); await decodedWithActiveCourse.promise; await Promise.resolve(); });
  const saved = JSON.parse(window.localStorage.getItem(thumbnailKey(PROFILE_A)));
  assert.equal(saved.courseId, COURSE_A);
  assert.equal(saved.fileId, FILE_A);
  assert.equal(saved.width, 32);
});

test("a known replacement or deletion invalidates immediately, while an unresolved file list retains the thumbnail", async () => {
  reset();
  setCached();
  await render(props({ file: undefined, filesReady: false }));
  assert.ok(rootNode.querySelector("img.private-class-image-thumbnail"));
  assert.ok(window.localStorage.getItem(thumbnailKey(PROFILE_A)), "pending file discovery leaves the cached image untouched");

  const replacement = file(FILE_B, { content_revision: 6, updated_at: "2026-10-09T00:00:00.000Z" });
  await render(props({ file: replacement, filesReady: false }));
  assert.equal(rootNode.querySelector("img.private-class-image-thumbnail"), null, "a known new file hides the stale cached image before list completion");
  assert.equal(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null, "the stale cached image is removed");

  await unmount();
  reset();
  setCached();
  await render(props({ file: undefined, filesReady: false }));
  assert.ok(rootNode.querySelector("img.private-class-image-thumbnail"));
  await render(props({ file: undefined, filesReady: true }));
  assert.equal(rootNode.querySelector("img.private-class-image-thumbnail"), null, "a completed list with no course image clears the placeholder");
  assert.equal(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null);
});

test("cached thumbnails are isolated by account and course", async () => {
  reset();
  setCached(PROFILE_A, COURSE_A);
  await render(props({ profileId: PROFILE_B, courseId: COURSE_B, file: undefined, filesReady: false }));
  assert.equal(rootNode.querySelector("img.private-class-image-thumbnail"), null);
  assert.notEqual(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null, "another account's cache remains isolated");

  await render(props({ profileId: PROFILE_A, courseId: COURSE_B, file: undefined, filesReady: false }));
  assert.equal(rootNode.querySelector("img.private-class-image-thumbnail"), null, "a different course cannot display the prior course's thumbnail");
});

test("manual expansions still invalidate stale snapshots, while disabled cache contexts never read them", async () => {
  reset();
  setCached();
  const replacement = file(FILE_B, { content_revision: 6, updated_at: "2026-10-09T00:00:00.000Z" });
  await render(props({ file: replacement, filesReady: false, restored: false }));
  assert.equal(rootNode.querySelector("img.private-class-image-thumbnail"), null, "a manual open does not display a cached placeholder");
  assert.equal(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null, "the manual open still checks and removes a known stale version");

  await unmount();
  reset();
  setCached();
  await render(props({ file: undefined, filesReady: false, restored: true, cacheEnabled: false }));
  assert.equal(rootNode.querySelector("img.private-class-image-thumbnail"), null);
  assert.notEqual(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null, "disabled profile/demo contexts do not inspect or remove the cached preview");
});

test("a decode that settles after close cannot recreate the thumbnail cache", async () => {
  reset();
  const decoded = deferred();
  nextDecode = decoded;
  window.localStorage.setItem(expandedKey(PROFILE_A), COURSE_A);
  await render(props({ file: file(), filesReady: true, restored: false }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(decodeCalls.length, 1);
  window.localStorage.removeItem(expandedKey(PROFILE_A));
  await unmount();
  await act(async () => { decoded.resolve(); await decoded.promise; await Promise.resolve(); });
  assert.equal(window.localStorage.getItem(thumbnailKey(PROFILE_A)), null);
});

test("PrivateImage notifies an optional observer once per URL when fadeIn is disabled", async () => {
  reset();
  const decoded = deferred(), currentFile = file();
  nextDecode = decoded;
  const noticed = [];
  const store = { blob: async () => new Blob(["manual image"], { type: "image/png" }) };
  await act(async () => root.render(createElement(PrivateImage, {
    file: currentFile, store,
    onDecoded: (image) => noticed.push(image.src),
  })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const image = rootNode.querySelector("img.private-class-image");
  assert.ok(image, "manual expanded images keep their original non-fade rendering");
  assert.deepEqual(noticed, []);
  await act(async () => { decoded.resolve(); await decoded.promise; await Promise.resolve(); });
  assert.deepEqual(noticed, [image.src]);
  await act(async () => root.render(createElement(PrivateImage, {
    file: currentFile, store,
    onDecoded: (source) => noticed.push(source.src),
  })));
  assert.deepEqual(noticed, [image.src], "rerendering the same source does not notify twice");
});

test("restored course image joins the shared reveal barrier in either settlement order", async () => {
  for (const headerFirst of [true, false]) {
    reset();
    setCached();
    const decoded = deferred();
    nextDecode = decoded;
    const currentFile = file();
    const renderCoordinated = () => act(async () => root.render(coordinatedImage(
      ["header", "map", "syllabus"], props({ file: currentFile, filesReady: true }),
      createElement(RevealProbe, { key: "map", participant: "map" }),
      createElement(RevealProbe, { key: "syllabus", participant: "syllabus" }),
    )));
    await renderCoordinated();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const wrapper = rootNode.querySelector(".expanded-course-image-reveal.private-class-image-fade");
    assert.ok(wrapper, "the restored image has a coordinated reveal wrapper");
    assert.equal(wrapper.classList.contains("is-ready"), false);
    assert.equal(rootNode.querySelector("img.private-class-image-fade"), null, "the inner image does not run an independent fade");
    assert.ok(rootNode.querySelector("img.private-class-image-thumbnail"), "the cached blurred thumbnail remains below the coordinated wrapper");

    const settle = async (key) => act(async () => {
      rootNode.querySelector(`[data-participant="${key}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    if (headerFirst) {
      await act(async () => { decoded.resolve(); await decoded.promise; await Promise.resolve(); });
      assert.equal(rootNode.querySelector(".expanded-course-image-reveal").classList.contains("is-ready"), false, "header completion alone cannot release maps and syllabus");
      await settle("map");
      assert.equal(rootNode.querySelector(".expanded-course-image-reveal").classList.contains("is-ready"), false);
      await settle("syllabus");
    } else {
      await settle("map");
      await settle("syllabus");
      assert.equal(rootNode.querySelector(".expanded-course-image-reveal").classList.contains("is-ready"), false, "other previews cannot reveal the header before its image settles");
      await act(async () => { decoded.resolve(); await decoded.promise; await Promise.resolve(); });
    }
    assert.equal(rootNode.querySelector(".expanded-course-image-reveal").classList.contains("is-ready"), true);
    await unmount();
  }
});

test("a completed metadata lookup with no eligible image settles the coordinated header fallback", async () => {
  reset();
  const renderCoordinated = (imageProps) => act(async () => root.render(coordinatedImage(
    ["header", "map", "syllabus"], props(imageProps),
    createElement(RevealProbe, { key: "map", participant: "map" }),
    createElement(RevealProbe, { key: "syllabus", participant: "syllabus" }),
  )));
  await renderCoordinated({ file: undefined, filesReady: false });
  assert.equal(rootNode.querySelector(".expanded-course-image-reveal").classList.contains("is-ready"), false, "pending metadata cannot settle the header participant");
  await renderCoordinated({ file: undefined, filesReady: true });
  assert.equal(rootNode.querySelector(".expanded-course-image-reveal").classList.contains("is-ready"), false, "the empty state settles the header but remains gated by other participants");
  const map = rootNode.querySelector('[data-participant="map"]');
  const syllabus = rootNode.querySelector('[data-participant="syllabus"]');
  assert.equal(map.getAttribute("data-revealed"), "false", "the fallback only settles the header participant");
  await act(async () => map.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(rootNode.querySelector('[data-participant="map"]').getAttribute("data-revealed"), "false");
  await act(async () => syllabus.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(rootNode.querySelector('[data-participant="map"]').getAttribute("data-revealed"), "true", "the completed no-image fallback lets the other participants release the group");
});

test("a coordinated image error settles its header participant", async () => {
  reset();
  const currentFile = file();
  const store = { blob: async () => new Blob(["broken image"], { type: "image/png" }) };
  await act(async () => root.render(coordinatedImage(
    ["header", "map"], props({ file: currentFile, filesReady: true, store }),
    createElement(RevealProbe, { key: "map", participant: "map" }),
  )));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const wrapper = rootNode.querySelector(".expanded-course-image-reveal.private-class-image-fade");
  assert.ok(wrapper);
  assert.equal(wrapper.classList.contains("is-ready"), false);
  const image = rootNode.querySelector("img.private-class-image");
  assert.ok(image);
  Object.defineProperty(image, "complete", { configurable: true, value: false });
  await act(async () => image.dispatchEvent(new dom.window.Event("error")));
  assert.equal(rootNode.querySelector(".expanded-course-image-reveal.private-class-image-fade").classList.contains("is-ready"), false, "the error settles only the header; the map still blocks the shared barrier");
  await act(async () => rootNode.querySelector('[data-participant="map"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(rootNode.querySelector(".expanded-course-image-reveal.private-class-image-fade").classList.contains("is-ready"), true);
});
