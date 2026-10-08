import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-widget-reorder");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const [globalCss, referenceCss, appearanceCss, blockLayoutCss, reorderCss] = await Promise.all([
  "app/globals.css", "app/reference-ui.css", "app/widget-appearance.css", "app/widget-block-layout.css", "app/widget-reorder.css",
].map((file) => readFile(resolve(repoRoot, file), "utf8")));
const bundle = await build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/widget-reorder-browser.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  loader: { ".css": "empty" },
  alias: {
    "next/link": resolve(repoRoot, "tests/helpers/next-link.mjs"),
    "next/navigation": resolve(repoRoot, "tests/helpers/next-navigation.mjs"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = bundle.outputFiles[0].text;
const css = [globalCss, referenceCss, appearanceCss, blockLayoutCss, reorderCss]
  .map((source) => source.replace(/^@import[^;]+;\s*/gm, ""))
  .join("\n");
const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --font-geist-sans: Arial, sans-serif; }${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  if (request.url?.startsWith("/fixture.js")) {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(js);
    return;
  }
  if (request.url?.startsWith("/favicon.ico")) { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
});
await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}/`;
await mkdir(screenshotDir, { recursive: true });

const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
const browser = await playwright.chromium.launch(launchOptions);
const consoleErrors = [];
function observeErrors(page) {
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`); });
}
async function loadPage({ width = 1440, height = 1200, reducedMotion = "no-preference", touch = false, query = "" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  observeErrors(page);
  await page.goto(`${baseUrl}${query}`);
  await page.waitForFunction(() => document.querySelector(".widget-grid")?.style.getPropertyValue("--widget-unit"));
  await page.getByRole("button", { name: "Customize" }).click();
  await page.locator("[data-widget-reorder-handle]").first().waitFor({ state: "visible" });
  assert.ok(await page.locator(".widget-grid > [data-widget-id]").evaluateAll((cards) =>
    cards.every((card) => getComputedStyle(card).animationName === "none" && getComputedStyle(card).rotate === "none"),
  ), "widgets remain still in customize mode");
  return { context, page };
}
async function liveIds(page) {
  return page.locator(".widget-grid > [data-widget-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-widget-id")));
}
async function beginMouseDrag(page, widgetId, destinationIndex) {
  const card = page.locator(`.widget-grid > [data-widget-id="${widgetId}"]`);
  const handle = card.locator("[data-widget-reorder-handle]");
  await handle.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  const handleBox = await handle.boundingBox();
  assert.ok(cardBox && handleBox, `Expected visible widget handle for ${widgetId}`);
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const target = await page.evaluate(({ id, index, offsetX, offsetY }) => window.__widgetFixture.targetFor(id, index, offsetX, offsetY), {
    id: widgetId, index: destinationIndex, offsetX: startX - cardBox.x, offsetY: startY - cardBox.y,
  });
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 9, startY + 8, { steps: 2 });
  await page.waitForSelector(".widget-reorder-overlay", { state: "attached", timeout: 3000 }).catch(async (error) => {
    const diagnostics = await page.evaluate(({ x, y }) => ({
      pointerTypes: window.__widgetFixture.pointerTypes,
      pointerEvents: window.__widgetFixture.pointerEvents,
      sourceClasses: document.querySelector('.widget-grid [data-widget-id="notes-main"]')?.className,
      hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 240),
      handles: [...document.querySelectorAll("[data-widget-reorder-handle]")].map((node) => ({ rect: node.getBoundingClientRect().toJSON(), parent: node.parentElement?.outerHTML.slice(0, 240) })),
      customizeText: [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Customize"))?.textContent,
      bodyClasses: document.body.className,
    }), { x: startX, y: startY });
    throw new Error(`Mouse reorder did not activate: ${JSON.stringify(diagnostics)}; ${error.message}`);
  });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  return { candidate: target.candidate };
}
async function assertNoBrowserErrors() {
  assert.deepEqual(consoleErrors, [], "browser console and page errors are empty");
}

try {
  const { context, page } = await loadPage();
  try {
    const before = await liveIds(page);
    const writesBefore = await page.evaluate(() => window.__widgetFixture.writes);
    const scrollState = await page.evaluate(() => window.__widgetFixture.setTextareaScrollToEnd());
    assert.ok(scrollState.scrollHeight > scrollState.clientHeight, "fixture note content overflows its textarea");
    assert.ok(scrollState.before > 0, "source note textarea scrolls before it is lifted");

    const drag = await beginMouseDrag(page, "notes-main", before.length - 1);
    await page.waitForFunction((candidate) => {
      const current = [...document.querySelectorAll(".widget-grid > [data-widget-id]")].map((card) => card.getAttribute("data-widget-id"));
      return current.every((id, index) => id === candidate[index]);
    }, drag.candidate);
    const preview = await page.evaluate(() => {
      const overlay = document.querySelector(".widget-reorder-overlay");
      const clone = overlay?.querySelector(".widget-card");
      const textarea = clone?.querySelector("textarea");
      const source = document.querySelector('.widget-grid [data-widget-id="notes-main"] textarea');
      const rect = overlay?.getBoundingClientRect();
      return {
        placeholder: document.querySelector('.widget-grid [data-widget-id="notes-main"]')?.classList.contains("widget-reorder-placeholder"),
        inert: overlay?.hasAttribute("inert"), hidden: overlay?.getAttribute("aria-hidden"),
        duplicateIdentityCount: overlay?.querySelectorAll("[id], [data-widget-id], [data-widget-reorder-handle]").length,
        sourceScrollTop: source?.scrollTop, cloneScrollTop: textarea?.scrollTop,
        cloneNoteLength: textarea?.value.length, rect: rect && { x: rect.x, y: rect.y },
      };
    });
    assert.equal(preview.placeholder, true);
    assert.equal(preview.inert, true);
    assert.equal(preview.hidden, "true");
    assert.equal(preview.duplicateIdentityCount, 0);
    assert.ok(Math.abs(preview.cloneScrollTop - scrollState.before) <= 4, "Chrome clone preserves the note textarea scroll offset captured before lift");
    assert.ok(preview.cloneNoteLength > 1000, "full widget notes content remains in the floating preview");
    await page.waitForTimeout(450);
    assert.deepEqual(await liveIds(page), drag.candidate, "the projected order remains while the pointer is stationary");
    await page.screenshot({ path: resolve(screenshotDir, "mouse-hover-preview.png"), fullPage: false });
    assert.equal(await page.locator(".widget-reorder-overlay").count(), 1, "taking the viewport screenshot leaves the active preview mounted");
    assert.deepEqual(await liveIds(page), drag.candidate, "the screenshot captures the projected order before release");
    await page.waitForTimeout(850);
    assert.equal(await page.evaluate(() => window.__widgetFixture.writes), writesBefore, "hover preview remains ephemeral beyond the autosave delay");
    assert.deepEqual((await page.evaluate(() => window.__widgetFixture.dashboard)).w[0][2].map((widget) => widget[2]), before);

    await page.keyboard.press("Escape");
    await page.waitForFunction((order) => [...document.querySelectorAll(".widget-grid > [data-widget-id]")].map((card) => card.getAttribute("data-widget-id")).join("|") === order.join("|"), before);
    await page.waitForFunction((top) => document.querySelector('.widget-grid [data-widget-id="notes-main"] textarea')?.scrollTop === top, scrollState.before);
    // Start a different widget immediately while the prior inert preview fades.
    const redrag = await beginMouseDrag(page, "timer-main", 0);
    await page.mouse.up();
    await page.waitForFunction(() => window.__widgetFixture.writes === 1);
    await page.getByText("Workspace saved").waitFor();
    const committedScroll = await page.evaluate(() => {
      const textarea = document.querySelector('.widget-grid [data-widget-id="notes-main"] textarea');
      return { top: textarea?.scrollTop, scrollHeight: textarea?.scrollHeight, clientHeight: textarea?.clientHeight };
    });
    assert.equal(committedScroll.top, scrollState.before, `committed note scroll position restores: ${JSON.stringify({ expected: scrollState.before, ...committedScroll })}`);
    const saved = await page.evaluate(() => window.__widgetFixture.dashboard);
    assert.deepEqual(saved.w[0][2].map((widget) => widget[2]), redrag.candidate);
    const savedWidgets = saved.w[0][2];
    const note = savedWidgets.find((widget) => widget[0] === 12);
    assert.equal(note[1], 1, "notes widget size is preserved after reorder");
    const noteLength = await page.evaluate(() => window.__widgetFixture.noteLength);
    assert.equal(saved.t[note[3]].length, noteLength, "the saved note payload is unchanged");
    await page.screenshot({ path: resolve(screenshotDir, "mouse-committed-board.png"), fullPage: true });
  } finally { await context.close(); }

  const { context: touchContext, page: touchPage } = await loadPage({ width: 390, height: 844, touch: true });
  try {
    const drag = await beginTouchDrag(touchPage, "timer-main", 0);
    await touchPage.waitForFunction((candidate) => [...document.querySelectorAll(".widget-grid > [data-widget-id]")].map((card) => card.getAttribute("data-widget-id")).join("|") === candidate.join("|"), drag.candidate);
    await drag.session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touchPage.waitForFunction(() => window.__widgetFixture.writes === 1);
    assert.ok(await touchPage.evaluate(() => window.__widgetFixture.pointerTypes.includes("touch")), "the browser delivered a touch PointerEvent to the live Workspace");
    assert.deepEqual((await touchPage.evaluate(() => window.__widgetFixture.dashboard)).w[0][2].map((widget) => widget[2]), drag.candidate);
    await touchPage.screenshot({ path: resolve(screenshotDir, "touch-committed-board.png"), fullPage: true });
    await drag.session.detach();
  } finally { await touchContext.close(); }

  const { context: reducedContext, page: reducedPage } = await loadPage({ reducedMotion: "reduce" });
  try {
    const startAnimation = await reducedPage.locator(".widget-grid > [data-widget-id]").first().evaluate((card) => getComputedStyle(card).animationName);
    assert.equal(startAnimation, "none", "widgets also remain still with reduced motion");
    const before = await liveIds(reducedPage);
    const drag = await beginMouseDrag(reducedPage, "timer-main", before.length - 1);
    const liftTransform = await reducedPage.locator(".widget-reorder-overlay .widget-card").evaluate((card) => getComputedStyle(card).transform);
    assert.equal(liftTransform, "none", "reduced motion keeps the pointer preview without lift scaling");
    await reducedPage.mouse.up();
    await reducedPage.waitForFunction(() => window.__widgetFixture.writes === 1);
    assert.deepEqual((await reducedPage.evaluate(() => window.__widgetFixture.dashboard)).w[0][2].map((widget) => widget[2]), drag.candidate);
  } finally { await reducedContext.close(); }

  const { context: edgeContext, page: edgePage } = await loadPage({ width: 1280, height: 760, query: "?long=1" });
  try {
    await edgePage.evaluate(() => window.scrollTo(0, 0));
    const source = edgePage.locator('.widget-grid > [data-widget-id="notes-main-0"]');
    const handle = source.locator("[data-widget-reorder-handle]");
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    assert.ok(box);
    const startScroll = await edgePage.evaluate(() => window.scrollY);
    await edgePage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await edgePage.mouse.down();
    await edgePage.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 8, { steps: 2 });
    await edgePage.waitForSelector(".widget-reorder-overlay");
    await edgePage.mouse.move(900, 752, { steps: 2 });
    await edgePage.waitForFunction((initial) => window.scrollY > initial + 60, startScroll, { timeout: 3000 });
    const scrolled = await edgePage.evaluate(() => window.scrollY);
    assert.ok(scrolled > startScroll + 60, "a stationary pointer held at the viewport edge scrolls the live board");
    await edgePage.screenshot({ path: resolve(screenshotDir, "edge-scroll-preview.png"), fullPage: false });
    assert.ok(await edgePage.locator(".widget-reorder-overlay").count(), "viewport screenshot does not cancel edge-scroll preview");
    await edgePage.keyboard.press("Escape");
    await edgePage.waitForFunction(() => !document.querySelector(".widget-reorder-placeholder"));
    assert.equal(await edgePage.evaluate(() => window.__widgetFixture.writes), 0, "edge scrolling and cancel do not save a reorder");
  } finally { await edgeContext.close(); }

  await assertNoBrowserErrors();
  console.log(`Widget reorder browser QA passed. Screenshots: ${screenshotDir}`);
} finally {
  await browser.close();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

async function beginTouchDrag(page, widgetId, destinationIndex) {
  const source = page.locator(`.widget-grid > [data-widget-id="${widgetId}"]`);
  await source.locator("[data-widget-reorder-handle]").scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const handleBox = await source.locator("[data-widget-reorder-handle]").boundingBox();
  assert.ok(sourceBox && handleBox);
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const target = await page.evaluate(({ id, index, offsetX, offsetY }) => window.__widgetFixture.targetFor(id, index, offsetX, offsetY), {
    id: widgetId, index: destinationIndex, offsetX: startX - sourceBox.x, offsetY: startY - sourceBox.y,
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: startX, y: startY, radiusX: 2, radiusY: 2, force: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: startX + 10, y: startY + 8, radiusX: 2, radiusY: 2, force: 1 }] });
  await page.waitForSelector(".widget-reorder-overlay");
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: target.x, y: target.y, radiusX: 2, radiusY: 2, force: 1 }] });
  return { candidate: target.candidate, session };
}
