import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const fixtureSource = `
  import { createElement } from "react";
  import { createRoot } from "react-dom/client";
  import DashboardStudyBrief from "./app/dashboard-study-brief";

  const root = createRoot(document.getElementById("root"));
  const assignments = Array.from({ length: 7 }, (_, index) => ({
    id: "priority-" + (index + 1),
    title: "Assignment " + (index + 1),
    courseId: "biology",
    status: "overdue",
    dateKey: "2026-10-12",
    due: "Oct 12, 2026",
  }));
  window.configure = ({ count = 7, reducedMotion = false } = {}) => {
    root.render(createElement("div", { className: "reference-ui" }, createElement(DashboardStudyBrief, {
      key: String(count) + "-" + String(reducedMotion),
      focusAssignments: assignments.slice(0, count),
      reducedMotion,
      overdueCount: count,
      dueTodayCount: 0,
      completedThisWeek: 0,
      courseCount: 1,
      courseCodeFor: () => "BIO 101",
      renderStatusBadge: () => null,
      onSelectAssignment: () => { window.selected = true; },
      onAddAssignment: () => {},
      onAddClass: () => {},
      onOpenAssistant: () => {},
      onAskAssistant: () => {},
    })));
  };
  window.configure();
`;
const bundle = await build({
  stdin: { contents: fixtureSource, resolveDir: repoRoot, loader: "tsx" },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const [globalCss, referenceCss, dashboardCss] = await Promise.all([
  "app/globals.css",
  "app/reference-ui.css",
  "app/dashboard.css",
].map((file) => readFile(resolve(repoRoot, file), "utf8")));
const html = `<!doctype html>
  <html data-theme="dark">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>:root { --font-geist-sans: Arial, sans-serif; }
        ${[globalCss, referenceCss, dashboardCss].map((css) => css.replace(/^@import[^;]+;\s*/gm, "")).join("\n")}
        body { margin: 0; padding: 32px; font-family: Arial, sans-serif; }
        #root { max-width: 1100px; margin: 0 auto; }
        .reference-ui { min-height: 1900px; }
      </style>
    </head>
    <body><div id="root"></div><script src="/fixture.js"></script></body>
  </html>`;
const server = createServer((request, response) => {
  if (request.url?.startsWith("/fixture.js")) {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(bundle.outputFiles[0].text);
    return;
  }
  if (request.url?.startsWith("/favicon.ico")) {
    response.writeHead(204);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
});
await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}/`;

const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
let browser;
try {
  browser = await playwright.chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl);
  await page.waitForFunction(() => typeof window.configure === "function" && document.querySelector(".dashboard-focus-viewport"));
  const viewport = page.locator(".dashboard-focus-viewport");
  await viewport.scrollIntoViewIfNeeded();
  await viewport.evaluate((element) => {
    window.__priorityWheelEvents = [];
    window.addEventListener("scroll", () => {
      (window.__priorityScrollEvents ??= []).push(window.scrollY);
    }, { passive: true });
    element.addEventListener("wheel", (event) => {
      window.__priorityWheelEvents.push({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        prevented: event.defaultPrevented,
      });
    }, { passive: true });
  });

  const state = () => page.evaluate(() => {
    const track = document.querySelector(".dashboard-focus-track");
    const viewportElement = document.querySelector(".dashboard-focus-viewport");
    const transform = getComputedStyle(track).transform;
    const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
    return {
      offset,
      range: document.querySelector(".dashboard-focus-range")?.textContent,
      scrollY: window.scrollY,
      trackWidth: track.clientWidth,
      touchAction: getComputedStyle(viewportElement).touchAction,
      lastWheel: window.__priorityWheelEvents?.at(-1) ?? null,
    };
  });
  const viewportBox = await viewport.boundingBox();
  assert.ok(viewportBox);
  await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2);

  const scrollBeforeHorizontal = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(40, 0);
  await page.waitForTimeout(15);
  const afterHorizontal = await state();
  assert.ok(afterHorizontal.offset < -5, `horizontal wheel tracks immediately (offset ${afterHorizontal.offset})`);
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(30);
  const afterDiagonal = await state();
  assert.equal(afterDiagonal.scrollY, scrollBeforeHorizontal, "a y-dominant packet during a horizontal swipe does not scroll the page");
  assert.equal(afterDiagonal.lastWheel?.prevented, true, "the latched horizontal burst prevents the diagonal wheel packet");
  assert.equal(afterDiagonal.range, "1–2 of 7");
  await page.waitForTimeout(300);

  const beforeVertical = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(10);
  const laterHorizontalPrevented = await viewport.evaluate((element) => {
    const event = new WheelEvent("wheel", { deltaX: 80, deltaY: 0, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await page.waitForTimeout(30);
  const afterVerticalStart = await state();
  assert.ok(afterVerticalStart.scrollY > beforeVertical, "a vertical-start wheel burst remains native page scrolling");
  assert.equal(laterHorizontalPrevented, false, "a following horizontal wheel packet stays in the active vertical burst");
  assert.equal(afterVerticalStart.offset, 0, "later horizontal motion cannot turn the same vertical burst into a swipe");
  assert.equal(afterVerticalStart.range, "1–2 of 7");
  assert.equal(afterVerticalStart.lastWheel?.prevented, false);
  await page.waitForTimeout(240);

  await viewport.scrollIntoViewIfNeeded();
  const edgeViewportBox = await viewport.boundingBox();
  assert.ok(edgeViewportBox);
  await page.mouse.move(edgeViewportBox.x + edgeViewportBox.width / 2, edgeViewportBox.y + edgeViewportBox.height / 2);

  await page.mouse.wheel(-1000, 0);
  await page.waitForTimeout(15);
  const edgePull = await state();
  assert.ok(edgePull.offset > 0 && edgePull.offset <= 24, `first-page edge travel is capped at 24px (got ${edgePull.offset})`);
  await page.mouse.wheel(1, 0);
  await page.waitForTimeout(15);
  const edgeReversal = await state();
  assert.ok(edgeReversal.offset < edgePull.offset, "a 1px reverse wheel delta immediately moves inward from the edge");
  const edgeReturn = await page.evaluate(async () => {
    const samples = [];
    const startedAt = performance.now();
    for (let frame = 0; frame < 40; frame += 1) {
      await new Promise(requestAnimationFrame);
      const transform = getComputedStyle(document.querySelector(".dashboard-focus-track")).transform;
      const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
      samples.push(offset);
      if (Math.abs(offset) <= 0.5) {
        return { elapsedMs: performance.now() - startedAt, samples, finalOffset: offset };
      }
    }
    return { elapsedMs: performance.now() - startedAt, samples, finalOffset: samples.at(-1) };
  });
  assert.ok(edgeReturn.finalOffset !== undefined && Math.abs(edgeReturn.finalOffset) <= 0.5, "edge spring returns to the page origin");
  assert.ok(edgeReturn.elapsedMs < 400, `edge return completes promptly including idle wait (${edgeReturn.elapsedMs.toFixed(1)}ms)`);
  assert.ok(edgeReturn.samples.every((offset) => offset >= -0.5 && offset <= edgeReversal.offset + 0.5), "edge return does not overshoot or travel farther outward");
  await page.waitForTimeout(220);

  const beforeLongSwipe = await state();
  const maxTravelPx = beforeLongSwipe.trackWidth + 8;
  await page.mouse.wheel(1000, 0);
  await page.waitForTimeout(20);
  const longSwipe = await state();
  assert.ok(Math.abs(longSwipe.offset) <= maxTravelPx + 1, `one wheel gesture cannot exceed one page plus its gap (${longSwipe.offset}px vs ${maxTravelPx}px)`);
  assert.ok(Math.abs(longSwipe.offset) >= maxTravelPx - 1, `large input reaches the adjacent-page limit (${longSwipe.offset}px vs ${maxTravelPx}px)`);
  assert.equal(longSwipe.range, "1–2 of 7", "the adjacent page changes only after release");
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-range")?.textContent === "3–4 of 7", undefined, { timeout: 2500 });
  const afterLongSwipe = await state();
  assert.equal(afterLongSwipe.range, "3–4 of 7", "a large gesture can commit only one adjacent page");

  const dispatchTailPackets = async (deltaX) => viewport.evaluate((element, packetDeltaX) => {
    const packets = [undefined, false, true].map((momentum) => {
      const event = new WheelEvent("wheel", { deltaX: packetDeltaX, bubbles: true, cancelable: true });
      if (momentum !== undefined) Object.defineProperty(event, "momentum", { value: momentum });
      element.dispatchEvent(event);
      return { momentum: momentum ?? "unknown", prevented: event.defaultPrevented };
    });
    return packets;
  }, deltaX);
  const lateForwardPackets = await dispatchTailPackets(120);
  assert.ok(lateForwardPackets.every((packet) => packet.prevented), "late forward packets stay captured after the destination arrives");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterLateForwardPackets = await state();
  assert.equal(afterLateForwardPackets.offset, 0, "late forward packets cannot pull or advance the committed page");
  assert.equal(afterLateForwardPackets.range, "3–4 of 7");

  await page.waitForTimeout(220);
  await page.mouse.wheel(-1000, 0);
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-range")?.textContent === "1–2 of 7", undefined, { timeout: 2500 });
  const afterBackwardSwipe = await state();
  const lateBackwardPackets = await dispatchTailPackets(-120);
  assert.ok(lateBackwardPackets.every((packet) => packet.prevented), "late backward packets stay captured after the destination arrives");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterLateBackwardPackets = await state();
  assert.equal(afterLateBackwardPackets.offset, 0, "late backward packets cannot pull or advance the committed page");
  assert.equal(afterLateBackwardPackets.range, "1–2 of 7");

  await page.evaluate(() => window.configure({ count: 5, reducedMotion: true }));
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-range")?.textContent === "1–2 of 5");
  await page.mouse.wheel(160, 0);
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-range")?.textContent === "3–4 of 5");
  assert.equal((await state()).offset, 0, "reduced motion changes pages without a translated intermediate frame");

  await page.evaluate(() => window.configure({ count: 5, reducedMotion: false }));
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-range")?.textContent === "1–2 of 5");
  await viewport.scrollIntoViewIfNeeded();
  const touchAction = await viewport.evaluate((element) => getComputedStyle(element).touchAction);
  assert.equal(touchAction, "pan-y", "the carousel leaves vertical touch scrolling to the browser");
  await viewport.evaluate((element) => {
    window.__priorityPointerEvents = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"]) {
      element.addEventListener(type, (event) => window.__priorityPointerEvents.push({ type, x: event.clientX, y: event.clientY }));
    }
  });
  let box = await viewport.boundingBox();
  assert.ok(box);
  const client = await context.newCDPSession(page);
  const verticalX = box.x + box.width * 0.7;
  const verticalY = box.y + Math.min(120, box.height / 2);
  const scrollBeforeTouch = await page.evaluate(() => window.scrollY);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: verticalX, y: verticalY }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: verticalX - 2, y: verticalY - 50 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: verticalX - 100, y: verticalY - 50 }] });
  await page.waitForTimeout(40);
  const verticalTouch = await state();
  assert.ok(verticalTouch.scrollY > scrollBeforeTouch, "vertical-first touch remains a browser page scroll");
  assert.equal(verticalTouch.range, "1–2 of 5");
  assert.equal(verticalTouch.offset, 0, "later horizontal motion cannot convert the same vertical touch into a carousel swipe");
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);

  box = await viewport.boundingBox();
  assert.ok(box);
  const touchX = box.x + box.width * 0.75;
  const touchY = box.y + 30;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY }] });
  for (let step = 1; step <= 5; step += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: touchX - (120 * step) / 5, y: touchY + 2 }],
    });
    await page.waitForTimeout(15);
  }
  const touchPreview = await state();
  assert.ok(touchPreview.offset < -50, `horizontal touch moves the carousel before release (offset ${touchPreview.offset})`);
  assert.equal(touchPreview.range, "1–2 of 5");
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-range")?.textContent === "3–4 of 5", undefined, { timeout: 2500 });
  assert.equal(await page.evaluate(() => Boolean(window.selected)), false, "swiping does not open an assignment");
  await page.locator("#dashboard-priority-list .dashboard-focus-item").first().click();
  assert.equal(await page.evaluate(() => window.selected), true, "intentional clicks remain available after swiping");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "the carousel creates no horizontal page overflow");
  assert.deepEqual(errors, [], "browser console and page errors are empty");

  const result = {
    browser: await browser.version(),
    diagonalWheel: {
      scrollYBefore: scrollBeforeHorizontal,
      scrollYAfter: afterDiagonal.scrollY,
      prevented: afterDiagonal.lastWheel?.prevented,
      trackedOffset: afterHorizontal.offset,
    },
    verticalStart: { scrollYBefore: beforeVertical, scrollYAfter: afterVerticalStart.scrollY, range: afterVerticalStart.range },
    edge: { maxObservedPx: edgePull.offset, reversedPx: edgeReversal.offset, returnElapsedMs: Number(edgeReturn.elapsedMs.toFixed(1)) },
    adjacentPage: { maxTravelPx, observedTravelPx: Math.abs(longSwipe.offset), committedRange: afterLongSwipe.range },
    arrivalGuard: {
      forwardPackets: lateForwardPackets,
      forwardRange: afterLateForwardPackets.range,
      backwardStartRange: afterBackwardSwipe.range,
      backwardPackets: lateBackwardPackets,
      backwardRange: afterLateBackwardPackets.range,
    },
    touch: { touchAction, verticalScrollY: verticalTouch.scrollY, horizontalPreviewPx: Math.abs(touchPreview.offset) },
    reducedMotion: true,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
}
