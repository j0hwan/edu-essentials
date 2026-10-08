import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-widget-menu");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const cssFiles = [
  "app/globals.css",
  "app/reference-ui.css",
  "app/widget-appearance.css",
  "app/widget-block-layout.css",
  "app/widget-reorder.css",
];
const cssSources = await Promise.all(cssFiles.map((file) => readFile(resolve(repoRoot, file), "utf8")));
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
const css = cssSources.map((source) => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
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
async function loadPage({ width = 1440, height = 900, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  observeErrors(page);
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector(".widget-grid")?.style.getPropertyValue("--widget-unit"));
  await page.locator(".widget-grid > [data-widget-id] .menu-wrap > button").first().waitFor({ state: "visible" });
  return { context, page };
}
const cardSelector = (id) => `.widget-grid > [data-widget-id="${id}"]`;
async function pageDimensions(page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
  }));
}
async function menuState(page, id) {
  return page.evaluate((widgetId) => {
    const card = document.querySelector(`.widget-grid > [data-widget-id="${widgetId}"]`);
    const anchor = card?.querySelector(".widget-header .menu-wrap > button");
    const menu = card?.querySelector(".widget-menu");
    if (!anchor || !menu) throw new Error(`Missing open widget menu for ${widgetId}`);
    const toObject = (rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height });
    const style = getComputedStyle(menu);
    const cardRect = card.getBoundingClientRect();
    const gridRect = menu.closest(".widget-grid")?.getBoundingClientRect();
    const header = document.querySelector(".mobile-header");
    const nav = document.querySelector(".mobile-bottom-nav");
    const headerRect = header?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const headerVisible = !!header && getComputedStyle(header).visibility !== "hidden" && getComputedStyle(header).display !== "none" && headerRect.width > 0 && headerRect.top <= 0 && headerRect.bottom > 0;
    const navVisible = !!nav && getComputedStyle(nav).visibility !== "hidden" && getComputedStyle(nav).display !== "none" && navRect.width > 0 && navRect.top < innerHeight && navRect.bottom >= innerHeight;
    return {
      anchor: toObject(anchor.getBoundingClientRect()),
      menu: toObject(menu.getBoundingClientRect()),
      card: toObject(cardRect),
      grid: gridRect ? toObject(gridRect) : null,
      viewport: { clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight, innerWidth, innerHeight, scrollY },
      position: style.position,
      topStyle: menu.style.top,
      leftStyle: menu.style.left,
      offsetHeight: menu.offsetHeight,
      maxHeight: Number.parseFloat(style.maxHeight),
      overflowY: style.overflowY,
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
      scrollTop: menu.scrollTop,
      usable: {
        top: headerVisible ? headerRect.bottom + 12 : 12,
        bottom: navVisible ? navRect.top - 12 : innerHeight - 12,
      },
    };
  }, id);
}
function assertWithinViewport(state, width, height, label) {
  const detail = JSON.stringify({ menu: state.menu, anchor: state.anchor, viewport: { width, height } });
  assert.ok(state.menu.left >= 11, `${label}: menu clears the left viewport edge: ${detail}`);
  assert.ok(state.menu.right <= width - 11, `${label}: menu clears the right viewport edge: ${detail}`);
  assert.ok(state.menu.top >= state.usable.top - 1, `${label}: menu clears fixed chrome at the top: ${JSON.stringify({ ...state, viewport: { width, height } })}`);
  assert.ok(state.menu.bottom <= state.usable.bottom + 1, `${label}: menu clears fixed chrome at the bottom: ${JSON.stringify({ ...state, viewport: { width, height } })}`);
  assert.ok(state.maxHeight <= state.usable.bottom - state.usable.top + 1, `${label}: max-height fits the usable viewport`);
  assert.equal(state.overflowY, "auto", `${label}: menu scrolls within itself`);
}
async function openMenu(page, id, { programmatic = false } = {}) {
  const trigger = page.locator(`${cardSelector(id)} .widget-header .menu-wrap > button`);
  if (programmatic) await trigger.evaluate((button) => button.click());
  else await trigger.click();
  await page.waitForFunction((widgetId) => {
    const menu = document.querySelector(`.widget-grid > [data-widget-id="${widgetId}"] .widget-menu`);
    return menu && !menu.classList.contains("is-closing");
  }, id);
  await page.waitForTimeout(180);
}
function assertDimensionsUnchanged(before, after, label) {
  assert.equal(after.documentWidth, before.documentWidth, `${label}: opening the menu does not widen the document`);
  assert.equal(after.documentHeight, before.documentHeight, `${label}: opening the menu does not lengthen the document`);
  assert.equal(after.bodyWidth, before.bodyWidth, `${label}: opening the menu does not widen the body`);
  assert.equal(after.bodyHeight, before.bodyHeight, `${label}: opening the menu does not lengthen the body`);
}
async function verifyDesktopAlignment() {
  const { context, page } = await loadPage();
  try {
    const dimensionsBefore = await pageDimensions(page);
    const candidates = await page.locator(".widget-grid > [data-widget-id]").evaluateAll((cards) => cards.flatMap((card) => {
      const button = card.querySelector(".widget-header .menu-wrap > button");
      if (!button) return [];
      const rect = button.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return [{ id: card.dataset.widgetId, left: rect.left, right: rect.right, center: cardRect.left + cardRect.width / 2 }];
    }));
    const grid = await page.locator(".widget-grid").boundingBox();
    assert.ok(grid);
    const center = grid.x + grid.width / 2;
    const left = candidates.filter((candidate) => candidate.center < center && candidate.left + 240 <= dimensionsBefore.clientWidth - 12).sort((a, b) => b.center - a.center)[0];
    const right = candidates.filter((candidate) => candidate.center >= center && candidate.right - 240 >= 12).sort((a, b) => a.center - b.center)[0];
    assert.ok(left, "desktop fixture has a left-half trigger with room to open right");
    assert.ok(right, "desktop fixture has a right-half trigger with room to open left");

    await openMenu(page, left.id);
    let state = await menuState(page, left.id);
    assertWithinViewport(state, dimensionsBefore.clientWidth, dimensionsBefore.clientHeight, "desktop left menu");
    assert.ok(Math.abs(state.menu.left - state.anchor.left) <= 2, "left-half trigger aligns the menu to its left edge");
    assertDimensionsUnchanged(dimensionsBefore, await pageDimensions(page), "desktop left menu");
    await page.screenshot({ path: resolve(screenshotDir, "desktop-left.png") });

    await openMenu(page, right.id);
    state = await menuState(page, right.id);
    assertWithinViewport(state, dimensionsBefore.clientWidth, dimensionsBefore.clientHeight, "desktop right menu");
    assert.ok(Math.abs(state.menu.right - state.anchor.right) <= 2, `right-half trigger aligns the menu to its right edge: ${JSON.stringify({ candidate: right, anchor: state.anchor, menu: state.menu })}`);
    assertDimensionsUnchanged(dimensionsBefore, await pageDimensions(page), "desktop right menu");

    await page.setViewportSize({ width: 820, height: 520 });
    await page.waitForTimeout(100);
    state = await menuState(page, right.id);
    assertWithinViewport(state, 820, 520, "resized desktop menu");
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForTimeout(100);
    state = await menuState(page, right.id);
    assertWithinViewport(state, 820, 520, "scrolled desktop menu");
    console.log(`desktop alignment/resize/scroll passed: left trigger x=${left.left}, right trigger x=${right.left}`);
  } finally { await context.close(); }
}
async function verifyMobileClamp() {
  const { context, page } = await loadPage({ width: 390, height: 844, touch: true });
  try {
    const candidates = await page.locator(".widget-grid > [data-widget-id]").evaluateAll((cards) => cards.flatMap((card) => {
      const button = card.querySelector(".widget-header .menu-wrap > button");
      if (!button) return [];
      const rect = button.getBoundingClientRect();
      return [{ id: card.dataset.widgetId, left: rect.left, center: rect.left + rect.width / 2 }];
    }));
    const left = candidates.find((candidate) => candidate.center < 195);
    const target = left ?? candidates[0];
    assert.ok(target, "mobile fixture has a widget trigger");
    const before = await pageDimensions(page);
    await openMenu(page, target.id);
    const state = await menuState(page, target.id);
    assertWithinViewport(state, 390, 844, "mobile menu");
    assertDimensionsUnchanged(before, await pageDimensions(page), "mobile menu");
    await page.screenshot({ path: resolve(screenshotDir, "mobile-menu.png") });
    console.log(`mobile clamp passed: trigger x=${state.anchor.left}, menu x=${state.menu.left}`);
  } finally { await context.close(); }
}
async function verifyBottomFlipAndScrollableAction() {
  const { context, page } = await loadPage({ width: 390, height: 900, touch: true });
  try {
    const cards = await page.locator(".widget-grid > [data-widget-id]").evaluateAll((nodes) => nodes.map((node) => ({ id: node.dataset.widgetId, top: node.getBoundingClientRect().top })));
    const last = cards.sort((a, b) => b.top - a.top)[0];
    assert.ok(last, "fixture has a last widget");
    const trigger = page.locator(`${cardSelector(last.id)} .widget-header .menu-wrap > button`);
    await trigger.evaluate((button) => button.scrollIntoView({ block: "end", inline: "nearest" }));
    const before = await pageDimensions(page);
    const anchorBefore = await trigger.boundingBox();
    assert.ok(anchorBefore && anchorBefore.y + anchorBefore.height > before.clientHeight - 40, "bottom widget trigger is near the viewport bottom");
    await trigger.evaluate((button) => button.click());
    await page.waitForFunction((widgetId) => !!document.querySelector(`.widget-grid > [data-widget-id="${widgetId}"] .widget-menu`), last.id);
    await page.waitForTimeout(180);
    let state = await menuState(page, last.id);
    assertWithinViewport(state, before.clientWidth, before.clientHeight, "bottom menu");
    assert.ok(state.menu.bottom <= state.anchor.top + 1, "menu flips above the trigger near the bottom edge");
    assertDimensionsUnchanged(before, await pageDimensions(page), "bottom menu");

    await page.setViewportSize({ width: 390, height: 320 });
    await page.waitForTimeout(100);
    await trigger.evaluate((button) => button.click());
    await page.waitForFunction((widgetId) => !document.querySelector(`.widget-grid > [data-widget-id="${widgetId}"] .widget-menu`), last.id);
    const beforeShortOpen = await pageDimensions(page);
    await openMenu(page, last.id, { programmatic: true });
    assertDimensionsUnchanged(beforeShortOpen, await pageDimensions(page), "short viewport open menu");
    state = await menuState(page, last.id);
    assertWithinViewport(state, 390, 320, "short viewport menu");
    assert.ok(state.scrollHeight > state.clientHeight, "short viewport menu has internal overflow");
    await page.screenshot({ path: resolve(screenshotDir, "short-viewport-menu.png") });

    await page.locator(`${cardSelector(last.id)} .widget-menu`).evaluate((menu) => { menu.scrollTop = menu.scrollHeight; });
    const remove = page.locator(`${cardSelector(last.id)} .widget-menu > button.danger`);
    const reachability = await remove.evaluate((button) => {
      const menu = button.closest(".widget-menu");
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const hit = document.elementFromPoint((buttonRect.left + buttonRect.right) / 2, (buttonRect.top + buttonRect.bottom) / 2);
      return { buttonTop: buttonRect.top, buttonBottom: buttonRect.bottom, menuTop: menuRect.top, menuBottom: menuRect.bottom, scrollTop: menu.scrollTop, receivesPointer: !!hit && button.contains(hit), hit: hit?.tagName ?? null };
    });
    assert.ok(reachability.scrollTop > 0, "short menu scroll position advances");
    assert.ok(reachability.buttonTop >= reachability.menuTop - 1 && reachability.buttonBottom <= reachability.menuBottom + 1, "the final Remove action is reachable inside the scroll menu");
    assert.ok(reachability.receivesPointer, `the final Remove action receives a pointer hit instead of being covered: ${JSON.stringify(reachability)}`);
    await page.screenshot({ path: resolve(screenshotDir, "short-viewport-remove-visible.png") });
    await remove.click();
    await page.locator(cardSelector(last.id)).waitFor({ state: "detached" });
    console.log(`bottom flip/short viewport scrolling passed: max-height=${state.maxHeight}px, final action y=${reachability.buttonTop}`);
  } finally { await context.close(); }
}

try {
  await verifyDesktopAlignment();
  await verifyMobileClamp();
  await verifyBottomFlipAndScrollableAction();
  assert.deepEqual(consoleErrors, [], `browser console stays clean: ${JSON.stringify(consoleErrors)}`);
  console.log(`Widget menu browser QA passed. Screenshots: ${screenshotDir}`);
} finally {
  await browser.close();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}
