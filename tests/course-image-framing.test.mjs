import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { courseImageFramingStyle, moveCourseImage, expandedCourseImageY } = await import(await clientModule("lib/course-image-framing.ts"));
const framing = { fileId: "cover", x: 50, y: 50, zoom: 2 };

test("expanded crops preserve the preview's vertical center across image shapes and zoom levels", () => {
  for (const imageRatio of [0.5, 1, 1.5, 3, 6]) {
    for (const zoom of [1, 1.5, 2, 3]) {
      for (const positionY of [0, 20, 50, 80, 100]) {
        const sourceRatio = 300 / 132;
        const targetRatio = 838 / 190;
        const targetY = expandedCourseImageY(positionY, zoom, imageRatio, sourceRatio, targetRatio);
        const sourceHeight = Math.max(1, sourceRatio / imageRatio) * zoom;
        const targetHeight = Math.max(1, targetRatio / imageRatio);
        const sourceCenter = 0.5 + (positionY / 100 - 0.5) * (1 - 1 / sourceHeight);
        const targetCenter = 0.5 + (targetY / 100 - 0.5) * (1 - 1 / targetHeight);
        const reachableMin = 0.5 / targetHeight;
        const reachableMax = 1 - reachableMin;
        assert.ok(Math.abs(targetCenter - Math.max(reachableMin, Math.min(reachableMax, sourceCenter))) < 1e-10);
        assert.ok(targetY >= 0 && targetY <= 100);
      }
    }
  }
});

test("expanded center compensation is scoped to the selected cover and valid geometry", () => {
  const saved = { ...framing, y: 80, imageAspectRatio: 1.5, frameAspectRatio: 300 / 132 };
  const expected = expandedCourseImageY(80, 2, 1.5, 300 / 132, 838 / 190);
  assert.equal(courseImageFramingStyle(saved, "cover", true, 838 / 190).objectPosition, `50% ${expected}%`);
  assert.equal(courseImageFramingStyle(saved, "cover", false, 838 / 190).objectPosition, "50% 80%");
  assert.equal(courseImageFramingStyle(saved, "replacement", true, 838 / 190).objectPosition, "50% 50%");
  assert.equal(expandedCourseImageY(80, 2, 0, 2, 4), 80);
  assert.equal(expandedCourseImageY(80, 2, 1, 2, Infinity), 80);
});

test("preview and saved images share zoom and position with a centered default", () => {
  assert.deepEqual(courseImageFramingStyle(framing, "cover"), { backgroundPosition: "50% 50%", objectPosition: "50% 50%", transform: "scale(2)", transformOrigin: "50% 50%" });
  assert.equal(courseImageFramingStyle(undefined).transform, "scale(1)");
  assert.equal(courseImageFramingStyle(framing, "replacement").transform, "scale(1)");
  assert.equal(courseImageFramingStyle({ ...framing, x: 0, y: 100 }).transformOrigin, "0% 100%");
});

test("expanded images remove all extra zoom without zooming out below the base fit", () => {
  for (const zoom of [1, 1.5, 2, 2.5, 3]) {
    const saved = { ...framing, x: 25, y: 70, zoom };
    const expanded = courseImageFramingStyle(saved, "cover", true);
    assert.equal(expanded.transform, "scale(1)");
    assert.equal(expanded.transformOrigin, "25% 70%");
    assert.equal(expanded.objectPosition, "25% 70%");
    assert.equal(courseImageFramingStyle(saved, "cover").transform, `scale(${zoom})`);
  }
  assert.equal(courseImageFramingStyle(undefined, undefined, true).transform, "scale(1)");
  assert.equal(courseImageFramingStyle(framing, "replacement", true).transform, "scale(1)");
});

test("dragging follows the pointer and clamps both edges without uncovering the frame", () => {
  const moved = moveCourseImage(framing, 30, 20, 300, 132, 1200, 800);
  assert.equal(moved.x, 40);
  assert.ok(Math.abs(moved.y - (50 - 20 / 268 * 100)) < 0.001);
  assert.equal(moved.fileId, framing.fileId);
  assert.deepEqual(moveCourseImage(framing, 10000, -10000, 300, 132, 1200, 800), { ...framing, x: 0, y: 100 });
  assert.deepEqual(moveCourseImage(framing, -10000, 10000, 300, 132, 1200, 800), { ...framing, x: 100, y: 0 });
});

test("unzoomed covers only pan along cropped axes, and empty measurements stay safe", () => {
  const unzoomed = { ...framing, zoom: 1 };
  assert.equal(moveCourseImage(unzoomed, 40, 10, 300, 132, 1200, 800).x, 50);
  assert.equal(moveCourseImage(unzoomed, 40, 10, 300, 132, 800, 1200).x, 50);
  assert.equal(moveCourseImage(unzoomed, 10, 40, 300, 132, 2400, 400).y, 50);
  assert.deepEqual(moveCourseImage(framing, 10, 20, 0, 132, 1200, 800), framing);
  assert.deepEqual(moveCourseImage(framing, 10, 20, 300, 132, 0, 0), framing);
});
