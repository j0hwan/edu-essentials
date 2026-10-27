import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { courseImageFramingStyle, moveCourseImage } = await import(await clientModule("lib/course-image-framing.ts"));
const framing = { fileId: "cover", x: 50, y: 50, zoom: 2 };

test("preview and saved images share zoom and position with a centered default", () => {
  assert.deepEqual(courseImageFramingStyle(framing, "cover"), { backgroundPosition: "50% 50%", objectPosition: "50% 50%", transform: "scale(2)", transformOrigin: "50% 50%" });
  assert.equal(courseImageFramingStyle(undefined).transform, "scale(1)");
  assert.equal(courseImageFramingStyle(framing, "replacement").transform, "scale(1)");
  assert.equal(courseImageFramingStyle({ ...framing, x: 0, y: 100 }).transformOrigin, "0% 100%");
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
