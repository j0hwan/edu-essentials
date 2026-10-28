import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://edu.example.invalid/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
after(() => dom.window.close());

let canvasBehavior;
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value() {
    if (canvasBehavior.getContextError) throw canvasBehavior.getContextError;
    if (!canvasBehavior.contextAvailable) return null;
    return {
      drawImage(image, x, y, width, height) {
        canvasBehavior.draws.push({ image, x, y, width, height });
      },
    };
  },
});
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "toDataURL", {
  configurable: true,
  value(type, quality) {
    canvasBehavior.encodes.push({ type, quality });
    return canvasBehavior.encode({ type, quality });
  },
});

const thumbnail = await import(await clientModule("lib/course-image-thumbnail.ts"));
const cacheKey = (profileId) => `edu-dashboard-course-thumbnail:${profileId}`;
const expansionKey = (profileId) => `edu-dashboard-expanded-course:${profileId}`;
const file = (patch = {}) => ({
  id: "file-one",
  content_revision: 3,
  updated_at: "2026-10-25T18:20:00.000Z",
  ...patch,
});
const image = (width = 640, height = 320) => {
  const result = document.createElement("img");
  Object.defineProperties(result, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  return result;
};
const validJpeg = "data:image/jpeg;base64,/9j/2Q==";

function resetCanvas(overrides = {}) {
  canvasBehavior = {
    contextAvailable: true,
    getContextError: null,
    encode: () => validJpeg,
    draws: [],
    encodes: [],
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  resetCanvas();
});

test("writes only for the expanded course and stores a small revision-matched JPEG", () => {
  resetCanvas();
  assert.equal(thumbnail.courseExpansionStorageKey("account-a"), expansionKey("account-a"));
  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null);
  assert.equal(canvasBehavior.encodes.length, 0, "compact-card loads do not create cached thumbnails");

  window.localStorage.setItem(expansionKey("account-a"), "course-a");
  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-b", file(), image()), null, "a different expanded course cannot authorize this write");
  assert.equal(canvasBehavior.encodes.length, 0, "a mismatched course is rejected before canvas work");
  const record = thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image());
  assert.deepEqual(record, {
    version: 1,
    courseId: "course-a",
    fileId: "file-one",
    contentRevision: 3,
    updatedAt: "2026-10-25T18:20:00.000Z",
    dataUrl: validJpeg,
    width: 32,
    height: 16,
  });
  assert.deepEqual(
    { width: canvasBehavior.draws[0].width, height: canvasBehavior.draws[0].height },
    { width: 32, height: 16 },
    "the canvas preserves the source aspect ratio while fitting within 32 pixels",
  );
  assert.equal(canvasBehavior.encodes[0].type, "image/jpeg");
  assert.equal(canvasBehavior.encodes[0].quality, 0.35);
  assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-a")?.fileId, "file-one");
  assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-b"), null, "another course cannot retrieve this thumbnail");
  assert.equal(thumbnail.readCourseImageThumbnail("account-b", "course-a"), null, "another account cannot retrieve this thumbnail");
  assert.equal(thumbnail.matchesCourseImageThumbnail(record, file()), true);
  assert.equal(thumbnail.matchesCourseImageThumbnail(record, file({ id: "file-two" })), false);
  assert.equal(thumbnail.matchesCourseImageThumbnail(record, file({ content_revision: 4 })), false);
  assert.equal(thumbnail.matchesCourseImageThumbnail(record, file({ updated_at: "2026-10-26T00:00:00.000Z" })), false);
  assert.ok(window.localStorage.getItem(cacheKey("account-a")).length <= 16 * 1024 + 1024);
});

test("replaces the prior course snapshot, keeps accounts separate, and scopes course-specific clearing", () => {
  resetCanvas();
  window.localStorage.setItem(expansionKey("account-a"), "course-a");
  const courseARecord = thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image());
  assert.ok(courseARecord);

  window.localStorage.setItem(expansionKey("account-a"), "course-b");
  const courseBRecord = thumbnail.writeCourseImageThumbnail("account-a", "course-b", file({ id: "file-b" }), image(128, 64));
  assert.ok(courseBRecord);
  assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-a"), null);
  assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-b")?.fileId, "file-b");
  assert.equal([...Array(window.localStorage.length)].filter((_, index) => window.localStorage.key(index) === cacheKey("account-a")).length, 1);

  window.localStorage.setItem(expansionKey("account-b"), "course-b");
  const accountBRecord = thumbnail.writeCourseImageThumbnail("account-b", "course-b", file({ id: "account-b-file" }), image());
  assert.ok(accountBRecord);
  assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-b")?.fileId, "file-b");
  assert.equal(thumbnail.readCourseImageThumbnail("account-b", "course-b")?.fileId, "account-b-file");

  thumbnail.clearCourseImageThumbnail("account-a", "course-a");
  assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-b")?.fileId, "file-b", "clearing an older course leaves the current snapshot intact");
  thumbnail.clearCourseImageThumbnail("account-a", "course-b");
  assert.equal(window.localStorage.getItem(cacheKey("account-a")), null);
  assert.equal(thumbnail.readCourseImageThumbnail("account-b", "course-b")?.fileId, "account-b-file", "clearing one account leaves another account's cache intact");
  thumbnail.clearCourseImageThumbnail("account-b");
  assert.equal(window.localStorage.getItem(cacheKey("account-b")), null, "omitting courseId clears that account's snapshot");
});

test("does not persist a late decode after the expanded-course storage value is cleared", () => {
  window.localStorage.setItem(expansionKey("account-a"), "course-a");
  resetCanvas({
    encode: () => {
      window.localStorage.removeItem(expansionKey("account-a"));
      return validJpeg;
    },
  });

  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null);
  assert.equal(window.localStorage.getItem(cacheKey("account-a")), null, "the final expansion check prevents a late cache write");
});

test("ignores corrupt, oversized, invalid, and dimension-out-of-range cache records", () => {
  const key = cacheKey("account-a");
  const validRecord = {
    version: 1,
    courseId: "course-a",
    fileId: "file-one",
    contentRevision: 3,
    updatedAt: "2026-10-25T18:20:00.000Z",
    dataUrl: validJpeg,
    width: 32,
    height: 16,
  };
  const malformed = [
    "{not-json",
    "x".repeat(16 * 1024 + 1025),
    JSON.stringify({ ...validRecord, version: 2 }),
    JSON.stringify({ ...validRecord, dataUrl: "data:image/png;base64,AAAA" }),
    JSON.stringify({ ...validRecord, dataUrl: "data:image/jpeg;base64," }),
    JSON.stringify({ ...validRecord, unrecognized: true }),
    JSON.stringify({ ...validRecord, dataUrl: `data:image/jpeg;base64,${"A".repeat(16 * 1024)}` }),
    JSON.stringify({ ...validRecord, width: 33 }),
    JSON.stringify({ ...validRecord, height: 0 }),
  ];
  for (const value of malformed) {
    window.localStorage.setItem(key, value);
    assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-a"), null);
  }

  window.localStorage.removeItem(key);
  window.localStorage.setItem(expansionKey("account-a"), "course-a");
  resetCanvas({ encode: () => `data:image/jpeg;base64,${"A".repeat(16 * 1024)}` });
  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null, "an oversized generated image is discarded");
  assert.equal(window.localStorage.getItem(key), null, "an oversized image does not replace cache data");
});

test("storage and canvas failures return safely without breaking callers", () => {
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
    assert.equal(thumbnail.readCourseImageThumbnail("account-a", "course-a"), null);
    assert.doesNotThrow(() => thumbnail.clearCourseImageThumbnail("account-a"));
    assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(window, "localStorage", localStorageDescriptor);
  }

  const storage = window.localStorage;
  const blockedStorage = {
    getItem(key) { return key === expansionKey("account-a") ? "course-a" : null; },
    setItem() { throw new Error("Storage full"); },
    removeItem() { throw new Error("Storage blocked"); },
  };
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, value: blockedStorage });
    resetCanvas();
    assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null);
    assert.doesNotThrow(() => thumbnail.clearCourseImageThumbnail("account-a"));
  } finally {
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  }

  window.localStorage.setItem(expansionKey("account-a"), "course-a");
  resetCanvas({ contextAvailable: false });
  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null);
  resetCanvas({ getContextError: new Error("Canvas blocked") });
  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null);
  resetCanvas({ encode: () => { throw new Error("Canvas encoding failed"); } });
  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image()), null);
  assert.equal(window.localStorage.getItem(cacheKey("account-a")), null);

  assert.equal(thumbnail.writeCourseImageThumbnail("account-a", "course-a", file(), image(0, 12)), null, "an image without loaded natural dimensions is ignored");
});
