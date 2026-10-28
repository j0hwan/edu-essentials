import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { readWorkspaceStylesheets } from "../tests/helpers/workspace-presentation.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const fixtureSource = [
  "import { createElement } from \"react\";",
  "import { createRoot } from \"react-dom/client\";",
  "import DashboardStudyBrief from \"./app/dashboard-study-brief\";",
  "",
  "const root = createRoot(document.getElementById(\"root\"));",
  "const assignments = Array.from({ length: 7 }, (_, index) => ({",
  "  id: \"priority-\" + (index + 1),",
  "  title: \"Assignment \" + (index + 1),",
  "  courseId: \"biology\",",
  "  status: \"overdue\",",
  "  dateKey: \"2026-10-12\",",
  "  due: \"Oct 12, 2026\",",
  "}));",
  "window.configure = ({ count = 7, reducedMotion = false } = {}) => {",
  "  root.render(createElement(\"div\", { className: \"reference-ui\" }, createElement(DashboardStudyBrief, {",
  "    key: String(count) + \"-\" + String(reducedMotion),",
  "    focusAssignments: assignments.slice(0, count),",
  "    reducedMotion,",
  "    overdueCount: count,",
  "    dueTodayCount: 0,",
  "    completedThisWeek: 0,",
  "    courseCount: 1,",
  "    courseCodeFor: () => \"BIO 101\",",
  "    renderStatusBadge: () => null,",
  "    onSelectAssignment: () => { window.selected = true; },",
  "    onAddAssignment: () => {},",
  "    onAddClass: () => {},",
  "    onOpenAssistant: () => {},",
  "    onAskAssistant: () => {},",
  "  })));",
  "};",
  "window.configure();",
].join("\n");
const bundle = await build({
  stdin: { contents: fixtureSource, resolveDir: repoRoot, loader: "tsx" },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": "\"production\"" },
  logLevel: "warning",
});
const { css: styles } = await readWorkspaceStylesheets();
const html = "<!doctype html><html data-theme=\"dark\"><head>"
  + "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
  + "<style>:root { --font-geist-sans: Arial, sans-serif; }" + styles
  + "body { margin: 0; padding: 32px; font-family: Arial, sans-serif; }"
  + "#root { max-width: 1100px; margin: 0 auto; } .reference-ui { min-height: 1900px; }"
  + "</style></head><body><div id=\"root\"></div><script src=\"/fixture.js\"></script></body></html>";
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
const baseUrl = "http://127.0.0.1:" + address.port + "/";

const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
let browser;
try {
  browser = await playwright.chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
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
    const carousel = document.querySelector("[data-priority-carousel]");
    const viewportElement = document.querySelector(".dashboard-focus-viewport");
    const transform = getComputedStyle(track).transform;
    const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
    const pageDots = document.querySelector(".dashboard-focus-page-dots");
    const list = document.querySelector("#dashboard-priority-list");
    return {
      offset,
      page: Number(pageDots?.dataset.page),
      pageCount: Number(pageDots?.dataset.pageCount),
      committedPage: Number(carousel?.dataset.committedPage),
      transitioning: carousel?.dataset.transitioning === "true",
      numbers: [...(list?.querySelectorAll(".dashboard-focus-number") ?? [])].map((element) => element.textContent),
      titles: [...(list?.querySelectorAll("strong") ?? [])].map((element) => element.textContent),
      scrollY: window.scrollY,
      trackWidth: track.clientWidth,
      touchAction: getComputedStyle(viewportElement).touchAction,
      lastWheel: window.__priorityWheelEvents?.at(-1) ?? null,
    };
  });
  const assertPageDots = async (pageNumber, pageCount) => {
    const status = await page.evaluate(() => {
      const element = document.querySelector(".dashboard-focus-page-dots");
      if (!element) return null;
      const dots = [...element.querySelectorAll(".dashboard-focus-page-dot")];
      return {
        page: Number(element.dataset.page),
        pageCount: Number(element.dataset.pageCount),
        role: element.getAttribute("role"),
        live: element.getAttribute("aria-live"),
        atomic: element.getAttribute("aria-atomic"),
        label: element.querySelector(".sr-only")?.textContent,
        dotCount: dots.length,
        activeIndex: dots.findIndex((dot) => dot.classList.contains("dashboard-focus-page-dot--active")) + 1,
        dotsAreHiddenSpans: dots.every((dot) => dot.tagName === "SPAN" && dot.getAttribute("aria-hidden") === "true"),
        hasInteractiveDot: Boolean(element.querySelector("button, a, [role=button], [tabindex]")),
        visibleRange: document.querySelector(".dashboard-focus-range"),
      };
    });
    assert.ok(status, "page status is present");
    assert.equal(status.page, pageNumber);
    assert.equal(status.pageCount, pageCount);
    assert.equal(status.role, "status");
    assert.equal(status.live, "polite");
    assert.equal(status.atomic, "true");
    assert.equal(status.label, "Page " + pageNumber + " of " + pageCount);
    assert.equal(status.dotCount, pageCount);
    assert.equal(status.activeIndex, pageNumber);
    assert.equal(status.dotsAreHiddenSpans, true);
    assert.equal(status.hasInteractiveDot, false);
    assert.equal(status.visibleRange, null);
  };
  const dispatchWheel = (deltaX, deltaY = 0, momentum) => viewport.evaluate((element, options) => {
    const event = new WheelEvent("wheel", {
      deltaX: options.deltaX,
      deltaY: options.deltaY,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "momentum", {
      value: options.momentum === "unknown" ? undefined : options.momentum,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, { deltaX, deltaY, momentum: momentum === undefined ? "unknown" : momentum });
  const waitForCommittedPage = async (pageNumber) => {
    await page.waitForFunction(
      (expected) => {
        const carousel = document.querySelector("[data-priority-carousel]");
        return carousel?.dataset.committedPage === String(expected) && carousel.dataset.transitioning === "false";
      },
      pageNumber,
      { timeout: 3000 },
    );
  };

  await assertPageDots(1, 4);
  const beforeVerticalBurst = await state();
  const verticalStartPrevented = await dispatchWheel(2, 30);
  const laterHorizontalPrevented = await dispatchWheel(80, 0);
  assert.equal(verticalStartPrevented, false);
  assert.equal(laterHorizontalPrevented, false, "a vertical-start wheel burst remains page scrolling");
  assert.equal((await state()).offset, 0);
  await page.waitForTimeout(100);
  const afterVerticalBurst = await state();
  assert.equal(afterVerticalBurst.page, 1);
  assert.equal(afterVerticalBurst.committedPage, 1);

  await dispatchWheel(40, 0, false);
  const horizontalPreview = await state();
  assert.equal(horizontalPreview.offset, -40);
  const diagonalPrevented = await dispatchWheel(0, 160);
  assert.equal(diagonalPrevented, true, "a horizontal wheel burst owns later diagonal packets");
  assert.equal((await state()).offset, -40);
  await page.waitForTimeout(350);
  assert.equal((await state()).offset, 0, "subthreshold horizontal motion returns to the current page");

  const slideRun = await page.evaluate(async () => {
    const read = () => {
      const track = document.querySelector(".dashboard-focus-track");
      const transform = getComputedStyle(track).transform;
      const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
      const pageDots = document.querySelector(".dashboard-focus-page-dots");
      const carousel = document.querySelector("[data-priority-carousel]");
      const list = document.querySelector("#dashboard-priority-list");
      return {
        at: performance.now(),
        offset,
        page: Number(pageDots?.dataset.page),
        pageDotStatus: pageDots ? {
          role: pageDots.getAttribute("role"),
          live: pageDots.getAttribute("aria-live"),
          atomic: pageDots.getAttribute("aria-atomic"),
          label: pageDots.querySelector(".sr-only")?.textContent,
          activeIndex: [...pageDots.querySelectorAll(".dashboard-focus-page-dot")]
            .findIndex((dot) => dot.classList.contains("dashboard-focus-page-dot--active")) + 1,
        } : null,
        committedPage: Number(carousel?.dataset.committedPage),
        transitioning: carousel?.dataset.transitioning === "true",
        trackWidth: track.clientWidth,
        logicalOffset: offset - (Number(carousel?.dataset.committedPage ?? 1) - 1) * (track.clientWidth + 8),
        numbers: [...(list?.querySelectorAll(".dashboard-focus-number") ?? [])].map((element) => element.textContent),
        titles: [...(list?.querySelectorAll("strong") ?? [])].map((element) => element.textContent),
      };
    };
    const dispatchWheel = (deltaX, momentum, deltaY = 0) => {
      const event = new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, cancelable: true });
      Object.defineProperty(event, "momentum", { value: momentum === "unknown" ? undefined : momentum });
      document.querySelector(".dashboard-focus-viewport").dispatchEvent(event);
      return event.defaultPrevented;
    };
    const dispatchPointer = (type, x) => {
      const event = new PointerEvent(type, {
        pointerId: 77,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: 100,
      });
      document.querySelector(".dashboard-focus-viewport").dispatchEvent(event);
      return event.defaultPrevented;
    };
    const initial = read();
    const startedAt = performance.now();
    const accepted = dispatchWheel(10000, false);
    const inputState = read();
    const samples = [{ elapsedMs: inputState.at - startedAt, ...inputState }];
    const afterInput = await new Promise((resolve, reject) => {
      const check = (frameTimestamp) => {
        const current = read();
        samples.push({ elapsedMs: (frameTimestamp ?? current.at) - startedAt, ...current });
        if (current.page === 2) {
          resolve(current);
          return;
        }
        if (current.at - startedAt > 100) {
          reject(new Error("destination dot did not update within 100ms of accepted input"));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
    const acceptedAt = afterInput.at;
    const pageDistance = initial.trackWidth + 8;
    const previewLimit = Math.min(64, pageDistance / 4);
    const targetOffset = -pageDistance;
    const inputOffset = inputState.logicalOffset;
    const expectedDurationMs = Math.max(70, Math.ceil(1.5 * Math.abs(targetOffset - inputOffset) / 12));
    const probes = [];
    const dispatchSpam = (atMs) => {
      const before = read();
      const prevented = [dispatchWheel(100, false), dispatchWheel(-50, false)];
      dispatchPointer("pointerdown", 200);
      dispatchPointer("pointermove", 40);
      dispatchPointer("pointerup", 40);
      dispatchPointer("pointercancel", 40);
      dispatchPointer("lostpointercapture", 40);
      document.querySelector('[aria-label="Previous priorities"]').click();
      document.querySelector('[aria-label="Next priorities"]').click();
      const after = read();
      probes.push({ atMs, before, after, prevented });
    };
    const waitUntil = async (elapsedMs) => {
      const remaining = startedAt + elapsedMs - performance.now();
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    };

    let lastKeepAliveAt = performance.now();
    const sampleRun = new Promise((resolve, reject) => {
      const sample = (frameTimestamp) => {
        const now = performance.now();
        if (document.querySelector("[data-priority-carousel]")?.dataset.transitioning === "true" && now - lastKeepAliveAt >= 30) {
          dispatchWheel(1, false);
          lastKeepAliveAt = performance.now();
        }
        const current = read();
        samples.push({ elapsedMs: frameTimestamp - startedAt, ...current });
        if (!current.transitioning) {
          resolve({ elapsedMs: current.at - startedAt, ...current });
          return;
        }
        if (current.at - startedAt > expectedDurationMs + 1000) {
          reject(new Error("eased slide did not commit the pending destination"));
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    dispatchSpam(0);
    for (const elapsedMs of [25, 55]) {
      await waitUntil(elapsedMs);
      dispatchSpam(elapsedMs);
    }

    const stalePointer = new PointerEvent("pointerdown", {
      pointerId: 99,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 100,
    });
    document.querySelector(".dashboard-focus-viewport").dispatchEvent(stalePointer);

    const landed = await sampleRun;

    const staleMove = new PointerEvent("pointermove", {
      pointerId: 99,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: 80,
      clientY: 100,
    });
    const staleUp = new PointerEvent("pointerup", {
      pointerId: 99,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: 80,
      clientY: 100,
    });
    document.querySelector(".dashboard-focus-viewport").dispatchEvent(staleMove);
    document.querySelector(".dashboard-focus-viewport").dispatchEvent(staleUp);
    const staleAfterArrival = read();
    const yDominantTailPrevented = dispatchWheel(0, false, 40);
    const afterYDominantTail = read();
    const sameBurstTailPrevented = dispatchWheel(10000, false);
    const afterSameBurstTail = read();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const delayedIgnoredTailPrevented = dispatchWheel(10000, false);
    const afterDelayedIgnoredTail = read();
    await new Promise((resolve) => setTimeout(resolve, 75));
    const freshAfterQuietPrevented = dispatchWheel(10000, false);
    const freshAfterQuietInput = read();
    const afterFreshAfterQuiet = await new Promise((resolve) => {
      const deadline = performance.now() + 100;
      const check = () => {
        const current = read();
        if (current.page === 3 || performance.now() >= deadline) resolve(current);
        else requestAnimationFrame(check);
      };
      check();
    });

    return {
      startedAt,
      accepted,
      acceptedAt,
      dotLatencyMs: acceptedAt - startedAt,
      initial,
      inputState,
      afterInput,
      inputOffset,
      previewLimit,
      pageDistance,
      targetOffset,
      expectedDurationMs,
      probes,
      samples,
      landed,
      staleAfterArrival,
      yDominantTailPrevented,
      afterYDominantTail,
      sameBurstTailPrevented,
      afterSameBurstTail,
      delayedIgnoredTailPrevented,
      afterDelayedIgnoredTail,
      freshAfterQuietPrevented,
      freshAfterQuietInput,
      afterFreshAfterQuiet,
    };
  });
  assert.equal(slideRun.accepted, true);
  assert.ok(slideRun.dotLatencyMs < 100, `pending dot updates in ${slideRun.dotLatencyMs.toFixed(1)}ms`);
  assert.equal(slideRun.afterInput.page, 2, "the destination dot updates on accepted input");
  assert.equal(slideRun.afterInput.committedPage, 1);
  assert.equal(slideRun.afterInput.transitioning, true);
  assert.deepEqual(slideRun.afterInput.numbers, ["01", "02"], "the source cards remain rendered during the slide");
  assert.ok(Math.abs(slideRun.inputOffset) <= slideRun.previewLimit + 1, "a large packet stays within the preview cap");
  assert.deepEqual(slideRun.afterInput.pageDotStatus, {
    role: "status",
    live: "polite",
    atomic: "true",
    label: "Page 2 of 4",
    activeIndex: 2,
  });
  assert.equal(slideRun.probes.length, 3);
  for (const probe of slideRun.probes) {
    assert.equal(probe.before.page, 2);
    assert.equal(probe.before.committedPage, 1);
    assert.equal(probe.before.transitioning, true);
    assert.equal(probe.after.page, 2);
    assert.deepEqual(probe.before.numbers, ["01", "02"]);
    assert.deepEqual(probe.after.numbers, ["01", "02"]);
    assert.deepEqual(probe.after.titles, ["Assignment 1", "Assignment 2"]);
    assert.ok(Math.abs(probe.after.offset - probe.before.offset) < 0.1, "spam does not retarget the in-flight slide");
  }

  assert.ok(slideRun.expectedDurationMs >= 70);
  assert.ok(slideRun.landed.elapsedMs >= slideRun.expectedDurationMs - 2, "settling lasts for the full duration derived from travel distance");
  assert.ok(slideRun.landed.elapsedMs <= slideRun.expectedDurationMs + 80, "the slide commits on the first animation frame after its deadline");
  assert.ok(slideRun.samples.length >= 3, `the browser recorded animation samples across the slide (${slideRun.samples.length} over ${slideRun.landed.elapsedMs.toFixed(1)}ms)`);
  let maxSampledSpeed = 0;
  for (let index = 1; index < slideRun.samples.length; index += 1) {
    const previous = slideRun.samples[index - 1];
    const current = slideRun.samples[index];
    const elapsed = current.at - previous.at;
    if (elapsed > 0) maxSampledSpeed = Math.max(maxSampledSpeed, Math.abs(current.logicalOffset - previous.logicalOffset) / elapsed);
    assert.ok(current.logicalOffset <= previous.logicalOffset + 0.5, "the forward path never reverses or overshoots");
    assert.ok(current.logicalOffset >= slideRun.targetOffset - 0.5, "the forward path stays above its target");
    if (current.transitioning) {
      assert.equal(current.committedPage, 1);
      assert.deepEqual(current.numbers, ["01", "02"]);
    }
  }
  assert.ok(maxSampledSpeed <= 12.1, `sampled peak speed is ${maxSampledSpeed.toFixed(3)}px/ms`);
  const progressAt = (sample) => (sample.logicalOffset - slideRun.inputOffset) / (slideRun.targetOffset - slideRun.inputOffset);
  const earlySample = slideRun.samples.find((sample) => sample.elapsedMs / slideRun.expectedDurationMs >= 0.1 && sample.elapsedMs / slideRun.expectedDurationMs < 0.5);
  const lateSample = slideRun.samples.find((sample) => sample.elapsedMs / slideRun.expectedDurationMs > 0.5 && sample.elapsedMs / slideRun.expectedDurationMs <= 0.9);
  if (earlySample) assert.ok(progressAt(earlySample) < earlySample.elapsedMs / slideRun.expectedDurationMs, "an observed early sample eases in below a linear trajectory");
  if (lateSample) assert.ok(progressAt(lateSample) > lateSample.elapsedMs / slideRun.expectedDurationMs, "an observed late sample eases out above a linear trajectory");
  assert.equal(slideRun.landed.page, 2);
  assert.equal(slideRun.landed.committedPage, 2);
  assert.equal(slideRun.landed.transitioning, false);
  assert.equal(slideRun.landed.offset, 0);
  assert.deepEqual(slideRun.landed.numbers, ["03", "04"]);
  assert.deepEqual(slideRun.landed.titles, ["Assignment 3", "Assignment 4"]);
  assert.equal(slideRun.staleAfterArrival.offset, 0, "a pointerdown ignored during settling cannot resume after arrival");
  assert.equal(slideRun.staleAfterArrival.committedPage, 2);
  assert.deepEqual(slideRun.staleAfterArrival.numbers, ["03", "04"]);
  assert.equal(slideRun.yDominantTailPrevented, true, "the accepted physical burst remains blocked through arrival for y-dominant packets");
  assert.equal(slideRun.afterYDominantTail.offset, 0);
  assert.equal(slideRun.afterYDominantTail.committedPage, 2);
  assert.equal(slideRun.sameBurstTailPrevented, true);
  assert.equal(slideRun.afterSameBurstTail.offset, 0, "the accepted physical burst cannot advance a second page");
  assert.equal(slideRun.afterSameBurstTail.page, 2);
  assert.equal(slideRun.afterSameBurstTail.committedPage, 2);
  assert.equal(slideRun.delayedIgnoredTailPrevented, true);
  assert.equal(slideRun.afterDelayedIgnoredTail.offset, 0, "a rejected swipe stays ignored across a 50ms packet gap after arrival");
  assert.equal(slideRun.afterDelayedIgnoredTail.page, 2);
  assert.equal(slideRun.afterDelayedIgnoredTail.committedPage, 2);
  assert.equal(slideRun.freshAfterQuietPrevented, true);
  assert.ok(Math.abs(slideRun.freshAfterQuietInput.offset) <= slideRun.previewLimit + 1, "the next accepted packet also starts with a bounded preview");
  assert.equal(slideRun.afterFreshAfterQuiet.page, 3);
  assert.equal(slideRun.afterFreshAfterQuiet.committedPage, 2);
  await assertPageDots(3, 4);

  const immediateNext = await state();
  assert.equal(immediateNext.page, 3);
  assert.equal(immediateNext.committedPage, 2);
  assert.equal(immediateNext.transitioning, true);
  assert.ok(Math.abs(immediateNext.offset) <= immediateNext.trackWidth + 8, "the next animation remains within its adjacent page bounds");
  await waitForCommittedPage(3);
  const thirdPage = await state();
  assert.deepEqual(thirdPage.numbers, ["05", "06"]);
  await assertPageDots(3, 4);
  assert.equal(await dispatchWheel(1, 0, true), true, "the prior physical swipe ends before the reverse burst begins");

  const unknownTailRun = await page.evaluate(async () => {
    const read = () => {
      const track = document.querySelector(".dashboard-focus-track");
      const transform = getComputedStyle(track).transform;
      const dots = document.querySelector(".dashboard-focus-page-dots");
      const carousel = document.querySelector("[data-priority-carousel]");
      const list = document.querySelector("#dashboard-priority-list");
      return {
        offset: transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41,
        page: Number(dots?.dataset.page),
        committedPage: Number(carousel?.dataset.committedPage),
        transitioning: carousel?.dataset.transitioning === "true",
        numbers: [...(list?.querySelectorAll(".dashboard-focus-number") ?? [])].map((element) => element.textContent),
      };
    };
    const dispatchWheel = (deltaX, momentum) => {
      const event = new WheelEvent("wheel", { deltaX, bubbles: true, cancelable: true });
      Object.defineProperty(event, "momentum", { value: momentum === "unknown" ? undefined : momentum });
      document.querySelector(".dashboard-focus-viewport").dispatchEvent(event);
      return event.defaultPrevented;
    };
    const startedAt = performance.now();
    const accepted = dispatchWheel(-10000, false);
    const pending = await new Promise((resolve, reject) => {
      const check = () => {
        const current = read();
        if (current.page === 2) {
          resolve(current);
          return;
        }
        if (performance.now() - startedAt > 100) {
          reject(new Error("reverse destination dot did not update within 100ms"));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
    let lastPacketAt = performance.now();
    const arrived = await new Promise((resolve, reject) => {
      const sample = () => {
        const now = performance.now();
        if (document.querySelector("[data-priority-carousel]")?.dataset.transitioning === "true" && now - lastPacketAt >= 30) {
          dispatchWheel(-1, "unknown");
          lastPacketAt = performance.now();
        }
        const current = read();
        if (!current.transitioning) {
          resolve(current);
          return;
        }
        if (now - startedAt > 2000) {
          reject(new Error("unmarked wheel slide did not commit"));
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const tailPrevented = dispatchWheel(-100, "unknown");
    return { accepted, pending, arrived, tailPrevented, afterTail: read() };
  });
  assert.equal(unknownTailRun.accepted, true);
  assert.equal(unknownTailRun.pending.page, 2, JSON.stringify(unknownTailRun));
  assert.equal(unknownTailRun.pending.committedPage, 3);
  assert.equal(unknownTailRun.pending.transitioning, true);
  assert.equal(unknownTailRun.arrived.page, 2);
  assert.equal(unknownTailRun.arrived.committedPage, 2);
  assert.deepEqual(unknownTailRun.arrived.numbers, ["03", "04"]);
  assert.equal(unknownTailRun.tailPrevented, true, "a continuing unmarked burst cannot cross arrival and advance another page");
  assert.equal(unknownTailRun.afterTail.offset, 0);
  assert.equal(unknownTailRun.afterTail.page, 2);
  assert.equal(unknownTailRun.afterTail.committedPage, 2);
  await assertPageDots(2, 4);
  assert.equal(await dispatchWheel(-1, 0, true), true, "the reverse physical swipe ends before the subthreshold burst begins");

  const subthresholdPreviewPrevented = await dispatchWheel(20, 0, false);
  assert.equal(subthresholdPreviewPrevented, true);
  assert.equal((await state()).offset, -20);
  const subthresholdEndPrevented = await dispatchWheel(1, 0, true);
  assert.equal(subthresholdEndPrevented, true);
  assert.equal((await state()).transitioning, true, "the end marker starts a return slide for a below-threshold gesture");
  const freshVerticalPrevented = await dispatchWheel(2, 30, false);
  const freshMixedPrevented = await dispatchWheel(80, 30, false);
  assert.equal(freshVerticalPrevented, false, "a fresh vertical burst after the end marker remains native during return");
  assert.equal(freshMixedPrevented, false, "horizontal-dominant follow-up cannot relatch a vertical-first burst");
  await page.waitForTimeout(60);
  assert.equal(await dispatchWheel(2, 30, false), false);
  await page.waitForTimeout(55);
  assert.equal(await dispatchWheel(80, 30, false), false, "the vertical axis remains native near return arrival");
  await waitForCommittedPage(2);
  assert.equal(await dispatchWheel(80, 30, false), false, "the vertical burst remains native immediately after arrival");
  const afterReturn = await state();
  assert.equal(afterReturn.page, 2);
  assert.equal(afterReturn.committedPage, 2);
  assert.equal(afterReturn.offset, 0);

  await page.locator('[aria-label="Next priorities"]').click();
  await waitForCommittedPage(3);
  const freshButtonAfterIgnoredClick = await state();
  assert.deepEqual(freshButtonAfterIgnoredClick.numbers, ["05", "06"], "a fresh button click works after its earlier click was ignored during settling");
  await assertPageDots(3, 4);

  await page.evaluate(() => window.configure({ count: 6 }));
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-page-dots")?.dataset.pageCount === "3");
  await page.evaluate(() => window.configure({ count: 7 }));
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-page-dots")?.dataset.pageCount === "4");
  const fallbackMomentum = await page.evaluate(async () => {
    const viewport = document.querySelector(".dashboard-focus-viewport");
    const dispatch = (deltaX) => {
      const event = new WheelEvent("wheel", { deltaX, bubbles: true, cancelable: true });
      Object.defineProperty(event, "momentum", { value: undefined });
      viewport.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const read = () => ({
      page: Number(document.querySelector(".dashboard-focus-page-dots")?.dataset.page),
      committedPage: Number(document.querySelector("[data-priority-carousel]")?.dataset.committedPage),
      transitioning: document.querySelector("[data-priority-carousel]")?.dataset.transitioning === "true",
    });
    dispatch(160);
    for (const delta of [90, 60, 35, 18]) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      dispatch(delta);
    }
    await new Promise((resolve) => setTimeout(resolve, 90));
    const lateTailPrevented = dispatch(8);
    const afterLateTail = read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const renewedImpulsePrevented = dispatch(160);
    const afterRenewedImpulse = await new Promise((resolve) => {
      const deadline = performance.now() + 100;
      const check = () => {
        const current = read();
        if (current.page === 3 || performance.now() >= deadline) resolve(current);
        else requestAnimationFrame(check);
      };
      check();
    });
    return { lateTailPrevented, afterLateTail, renewedImpulsePrevented, afterRenewedImpulse };
  });
  assert.equal(fallbackMomentum.lateTailPrevented, true);
  assert.deepEqual(fallbackMomentum.afterLateTail, { page: 2, committedPage: 2, transitioning: false }, "unmarked decaying momentum cannot advance again after a quiet gap");
  assert.equal(fallbackMomentum.renewedImpulsePrevented, true);
  assert.equal(fallbackMomentum.afterRenewedImpulse.page, 3, "a deliberate renewed impulse works without waiting for the old momentum stream to stop");
  await waitForCommittedPage(3);
  await assertPageDots(3, 4);

  await page.setViewportSize({ width: 360, height: 900 });
  await page.locator("[data-priority-carousel]").screenshot({ path: "/private/tmp/priority-page-dots.png" });
  await page.evaluate(() => window.configure({ count: 5, reducedMotion: true }));
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-page-dots")?.dataset.page === "1");
  await assertPageDots(1, 3);
  await dispatchWheel(160, 0, false);
  await waitForCommittedPage(2);
  assert.equal((await state()).offset, 0, "reduced motion changes page without a translated intermediate frame");
  await assertPageDots(2, 3);

  await page.evaluate(() => window.configure({ count: 5, reducedMotion: false }));
  await page.waitForFunction(() => document.querySelector(".dashboard-focus-page-dots")?.dataset.page === "1");
  await assertPageDots(1, 3);
  await viewport.scrollIntoViewIfNeeded();
  const touchAction = await viewport.evaluate((element) => getComputedStyle(element).touchAction);
  assert.equal(touchAction, "pan-y", "the carousel leaves vertical touch scrolling to the browser");

  const client = await context.newCDPSession(page);
  const box = await viewport.boundingBox();
  assert.ok(box);
  const verticalX = box.x + box.width * 0.7;
  const verticalY = box.y + Math.min(120, box.height / 2);
  const scrollBeforeTouch = await page.evaluate(() => window.scrollY);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: verticalX, y: verticalY }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: verticalX - 2, y: verticalY - 50 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: verticalX - 100, y: verticalY - 50 }] });
  await page.waitForTimeout(40);
  const verticalTouch = await state();
  assert.ok(verticalTouch.scrollY > scrollBeforeTouch, "vertical-first touch remains a browser page scroll");
  assert.equal(verticalTouch.page, 1);
  assert.equal(verticalTouch.offset, 0);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);

  const touchBox = await viewport.boundingBox();
  assert.ok(touchBox);
  const touchX = touchBox.x + touchBox.width * 0.75;
  const touchY = touchBox.y + 30;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY }] });
  for (let step = 1; step <= 5; step += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: touchX - (120 * step) / 5, y: touchY + 2 }],
    });
    await page.waitForTimeout(15);
  }
  const touchPreview = await state();
  assert.ok(touchPreview.offset < -10, "horizontal touch moves the carousel before release");
  assert.ok(Math.abs(touchPreview.offset) <= Math.min(64, (touchPreview.trackWidth + 8) / 4) + 1, "touch preview remains capped");
  assert.equal(touchPreview.page, 1);
  assert.equal(touchPreview.committedPage, 1);
  assert.equal(touchPreview.transitioning, false);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await waitForCommittedPage(2);
  await assertPageDots(2, 3);
  assert.equal(await page.evaluate(() => Boolean(window.selected)), false, "swiping does not open an assignment");
  await page.locator("#dashboard-priority-list .dashboard-focus-item").first().click();
  assert.equal(await page.evaluate(() => window.selected), true, "intentional clicks remain available after swiping");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "the carousel creates no horizontal page overflow");
  assert.deepEqual(errors, [], "browser console and page errors are empty");

  const result = {
    browser: await browser.version(),
    verticalWheel: {
      scrollYBefore: beforeVerticalBurst.scrollY,
      scrollYAfter: afterVerticalBurst.scrollY,
      page: afterVerticalBurst.page,
    },
    horizontalWheel: {
      initialOffset: horizontalPreview.offset,
      diagonalPrevented,
      finalOffset: (await state()).offset,
    },
    easedSlide: {
      samples: slideRun.probes.map((probe) => ({
        elapsedMs: probe.atMs,
        offset: Number(probe.after.offset.toFixed(2)),
        page: probe.after.page,
      })),
      commitElapsedMs: Number(slideRun.landed.elapsedMs.toFixed(1)),
      expectedDurationMs: slideRun.expectedDurationMs,
      animationSampleCount: slideRun.samples.length,
      dotLatencyMs: Number(slideRun.dotLatencyMs.toFixed(1)),
      maxSampledSpeedPxPerMs: Number(maxSampledSpeed.toFixed(3)),
      easingSamples: {
        early: earlySample ? {
          progress: Number(progressAt(earlySample).toFixed(3)),
          linearProgress: Number((earlySample.elapsedMs / slideRun.expectedDurationMs).toFixed(3)),
        } : null,
        late: lateSample ? {
          progress: Number(progressAt(lateSample).toFixed(3)),
          linearProgress: Number((lateSample.elapsedMs / slideRun.expectedDurationMs).toFixed(3)),
        } : null,
      },
      previewLimitPx: slideRun.previewLimit,
      initialPreviewPx: Number(slideRun.afterInput.offset.toFixed(2)),
      committedPage: slideRun.landed.committedPage,
      committedNumbers: slideRun.landed.numbers,
      stalePointerOffset: slideRun.staleAfterArrival.offset,
      immediatePhysicalOffset: immediateNext.offset,
      screenshot: "/private/tmp/priority-page-dots.png",
    },
    fallbackMomentum,
    touch: {
      touchAction,
      verticalScrollY: verticalTouch.scrollY,
      horizontalPreviewPx: Math.abs(touchPreview.offset),
    },
    reducedMotion: true,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
}
