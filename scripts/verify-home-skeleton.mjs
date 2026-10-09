import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { clientModule } from "../tests/helpers/client-modules.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-home-skeleton");
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const playwright = playwrightModule
  ? await import(pathToFileURL(resolve(playwrightModule)).href)
  : await import("playwright");
const cssFiles = [
  "app/globals.css",
  "app/reference-ui.css",
  "app/auth.css",
  "app/widget-appearance.css",
  "app/widget-block-layout.css",
  "app/widget-reorder.css",
  "app/home-skeleton.css",
];
const css = (await Promise.all(cssFiles.map((file) => readFile(resolve(repoRoot, file), "utf8"))))
  .map((source) => source.replace(/^@import[^;]+;\s*/gm, ""))
  .join("\n");
const ignoreCss = {
  name: "home-skeleton-verify-ignore-css",
  enforce: "pre",
  resolveId(id) { return id.endsWith(".css") ? `\0home-skeleton-css:${id}` : null; },
  load(id) { return id.startsWith("\0home-skeleton-css:") ? "" : null; },
};
const built = await build({
  configFile: false,
  root: repoRoot,
  plugins: [ignoreCss, react()],
  resolve: {
    alias: [
      { find: "next/link", replacement: resolve(repoRoot, "tests/helpers/next-link.mjs") },
      { find: "next/navigation", replacement: resolve(repoRoot, "tests/helpers/next-navigation.mjs") },
    ],
  },
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    write: false,
    cssCodeSplit: false,
    target: "chrome120",
    lib: { entry: resolve(repoRoot, "tests/fixtures/home-skeleton-browser.tsx"), name: "HomeSkeletonFixture", formats: ["iife"] },
  },
  logLevel: "warn",
});
const outputFiles = Array.isArray(built) ? built.flatMap((bundle) => bundle.output) : built.output;
const js = outputFiles.find((file) => file.type === "chunk")?.code;
assert.ok(js, "Vite creates a browser fixture bundle");
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
const baseUrl = `http://127.0.0.1:${address.port}`;
await mkdir(screenshotDir, { recursive: true });

const { DEFAULT_HOME_SKELETON_LAYOUT } = await import(await clientModule("lib/home-skeleton.ts"));
const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
let browser;
const browserErrors = [];
const geometryFailures = [];

function fixtureUrl(path, { account = "home-skeleton-browser-profile", scenario = "matching", hold = true, failFirst = false, accountReduced = false } = {}) {
  const url = new URL(path, baseUrl);
  url.searchParams.set("account", account);
  url.searchParams.set("scenario", scenario);
  if (hold) url.searchParams.set("hold", "true");
  if (failFirst) url.searchParams.set("failFirst", "true");
  if (accountReduced) url.searchParams.set("accountReduced", "true");
  return url.href;
}

function cacheKey(accountId) {
  return `edu-essentials:home-skeleton:v1:${encodeURIComponent(accountId)}`;
}

async function seedCache(page, accountId, layout) {
  await page.addInitScript(({ key, value }) => {
    const marker = `home-skeleton-seeded:${key}`;
    if (sessionStorage.getItem(marker)) return;
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem(marker, "true");
  }, { key: cacheKey(accountId), value: layout });
}

async function waitForFixtureRead(page, expectedCall = 1) {
  await page.waitForFunction((count) => window.__homeSkeletonFixture?.getCalls === count, expectedCall);
}

async function waitForTransitionPhase(page, phase) {
  await page.locator(`.home-load-transition[data-phase="${phase}"]`).waitFor({ state: "attached" });
}

async function holdWebAnimations(page) {
  await page.addInitScript(() => {
    const nativeAnimate = Element.prototype.animate;
    window.__homeSkeletonAnimations = [];
    Element.prototype.animate = function (...args) {
      const animation = nativeAnimate.apply(this, args);
      animation.pause();
      window.__homeSkeletonAnimations.push({ animation, target: this });
      return animation;
    };
  });
}

async function finishAnimationWave(page) {
  await page.evaluate(() => {
    for (const entry of window.__homeSkeletonAnimations ?? []) {
      try { entry.animation.finish(); } catch { /* Canceled animations are already settled. */ }
    }
    window.__homeSkeletonAnimations = [];
  });
  await page.waitForTimeout(40);
}

async function finishWebAnimations(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await page.locator('.home-load-transition[data-phase="done"]').count()) return;
    await finishAnimationWave(page);
  }
  await waitForTransitionPhase(page, "done");
}

async function readCachedLayout(page, accountId) {
  return await page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value === null ? null : JSON.parse(value);
  }, cacheKey(accountId));
}

async function readSkeleton(page) {
  return await page.evaluate(() => {
    const root = document.querySelector(".home-skeleton");
    const grid = root?.querySelector(".home-skeleton__grid");
    if (!root || !grid) return null;
    const rect = (node) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height, right: box.right + window.scrollX, bottom: box.bottom + window.scrollY };
    };
    const style = (node) => {
      if (!node) return null;
      const computed = getComputedStyle(node);
      return {
        minHeight: computed.minHeight,
        height: computed.height,
        paddingTop: computed.paddingTop,
        paddingBottom: computed.paddingBottom,
        boxSizing: computed.boxSizing,
        gap: computed.gap,
        flexDirection: computed.flexDirection,
      };
    };
    return {
      phase: document.querySelector(".home-load-transition")?.getAttribute("data-phase"),
      restored: document.querySelector(".home-load-transition")?.getAttribute("data-layout-restored"),
      match: document.querySelector(".home-load-transition")?.getAttribute("data-layout-match"),
      todayHidden: root.getAttribute("data-today-hidden"),
      todaySections: Number(root.getAttribute("data-today-sections") ?? "3"),
      todayCount: root.querySelectorAll(".home-skeleton__today").length,
      today: rect(root.querySelector(".home-skeleton__today")),
      intro: rect(root.querySelector(".home-skeleton__intro")),
      introStyle: style(root.querySelector(".home-skeleton__intro")),
      toolbar: rect(root.querySelector(".home-skeleton__toolbar")),
      toolbarStyle: style(root.querySelector(".home-skeleton__toolbar")),
      tabs: rect(root.querySelector(".home-skeleton__tabs")),
      actions: [...root.querySelectorAll(".home-skeleton__actions > *")].map((node) => ({ rect: rect(node), style: style(node), control: node.getAttribute("data-control") })),
      gridRect: rect(grid),
      gap: getComputedStyle(grid).columnGap,
      cards: [...grid.querySelectorAll(".home-skeleton__card")].map((card) => ({
        size: card.getAttribute("data-size"),
        miniStart: card.getAttribute("data-mini-start") === "true",
        rect: rect(card),
      })),
    };
  });
}

async function readHandoffGeometry(page) {
  return await page.evaluate(() => {
    const transition = document.querySelector(".home-load-transition");
    const skeleton = transition?.querySelector(".home-load-transition__skeleton");
    const sourceGrid = skeleton?.querySelector(".home-skeleton__grid");
    const content = transition?.querySelector(".home-load-transition__content");
    const liveGrid = content?.querySelector(".widget-grid");
    const sourceToday = skeleton?.querySelector(".home-skeleton__today");
    const liveToday = content?.querySelector(".home-today-panel");
    const sourceToolbar = skeleton?.querySelector(".home-skeleton__toolbar");
    const liveToolbar = content?.querySelector(".workspace-bar");
    const rect = (node) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height, right: box.right + window.scrollX, bottom: box.bottom + window.scrollY };
    };
    const style = (node) => {
      if (!node) return null;
      const computed = getComputedStyle(node);
      return {
        minHeight: computed.minHeight,
        height: computed.height,
        paddingTop: computed.paddingTop,
        paddingBottom: computed.paddingBottom,
        boxSizing: computed.boxSizing,
        gap: computed.gap,
        flexDirection: computed.flexDirection,
      };
    };
    const cards = (parent, selector) => [...(parent?.querySelectorAll(selector) ?? [])].map((card) => ({
      size: card.getAttribute("data-size"),
      miniStart: card.getAttribute("data-mini-start") === "true",
      rect: rect(card),
    }));
    return {
      phase: transition?.getAttribute("data-phase"),
      restored: transition?.getAttribute("data-layout-restored"),
      match: transition?.getAttribute("data-layout-match"),
      skeletonGap: sourceGrid ? getComputedStyle(sourceGrid).columnGap : null,
      liveGap: liveGrid ? getComputedStyle(liveGrid).columnGap : null,
      todaySkeleton: skeleton?.querySelectorAll(".home-skeleton__today").length ?? 0,
      todayLive: content?.querySelectorAll(".home-today-panel").length ?? 0,
      todaySections: Number(skeleton?.querySelector(".home-skeleton")?.getAttribute("data-today-sections") ?? "3"),
      todayLiveSections: liveToday?.querySelectorAll(".today-panel-grid > *").length ?? 0,
      todaySkeletonRect: rect(sourceToday),
      todayLiveRect: rect(liveToday),
      introRect: rect(skeleton?.querySelector(".home-skeleton__intro")),
      introStyle: style(skeleton?.querySelector(".home-skeleton__intro")),
      greetingRect: rect(content?.querySelector(".home-greeting")),
      greetingStyle: style(content?.querySelector(".home-greeting")),
      toolbarRect: rect(sourceToolbar),
      toolbarStyle: style(sourceToolbar),
      tabsRect: rect(skeleton?.querySelector(".home-skeleton__tabs")),
      liveToolbarRect: rect(liveToolbar),
      liveToolbarStyle: style(liveToolbar),
      liveTabsRect: rect(content?.querySelector(".workspace-tabs")),
      skeletonActions: [...(skeleton?.querySelectorAll(".home-skeleton__actions > *") ?? [])].map((node) => ({ rect: rect(node), style: style(node), control: node.getAttribute("data-control") })),
      liveActions: [...(content?.querySelectorAll(".workspace-actions > *") ?? [])].map((node) => ({ rect: rect(node), style: style(node), className: node.className })),
      gridRect: rect(sourceGrid),
      liveGridRect: rect(liveGrid),
      contentHidden: content?.getAttribute("aria-hidden") === "true" && content?.hasAttribute("inert"),
      skeletonCards: cards(sourceGrid, ".home-skeleton__card"),
      liveCards: cards(liveGrid, ".widget-card[data-widget-id]"),
      morphOverlayCount: transition?.querySelectorAll(".home-load-transition__surface, .home-load-transition__today-outline").length ?? 0,
    };
  });
}

function recordClose(actual, expected, label, tolerance = 3) {
  if (Math.abs(actual - expected) > tolerance) geometryFailures.push(`${label}: ${actual.toFixed(2)}px vs ${expected.toFixed(2)}px (tolerance ${tolerance}px)`);
}

try {
  browser = await playwright.chromium.launch(launchOptions);

  // Check both Today states and the phone width where action rows can wrap.
  const geometryWidgets = [
    { size: "small", startsNewMiniBlock: false },
    { size: "mini", startsNewMiniBlock: false },
    { size: "mini", startsNewMiniBlock: true },
    { size: "medium", startsNewMiniBlock: false },
  ];
  const geometryCases = [
    { width: 1280, todayHidden: true, sections: 3 },
    { width: 450, todayHidden: true, sections: 3 },
    { width: 390, todayHidden: true, sections: 3 },
    { width: 1280, todayHidden: false, sections: 3 },
    { width: 450, todayHidden: false, sections: 3 },
    { width: 390, todayHidden: false, sections: 3 },
    { width: 390, todayHidden: false, sections: 1 },
  ];
  for (const { width, todayHidden, sections } of geometryCases) {
    const account = `geometry-${width}-${todayHidden ? "hidden" : "visible"}-${sections}`;
    const geometryLayout = { version: 1, widgets: geometryWidgets, todayHidden, gap: 28 };
    const scenario = todayHidden ? "geometry" : sections === 1 ? "geometry-one-section" : "geometry-visible";
    const context = await browser.newContext({ viewport: { width, height: 980 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`geometry ${width}: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`geometry ${width}: ${message.text()}`); });
    await holdWebAnimations(page);
    await page.goto(fixtureUrl("/home", { account, scenario, hold: false }));
    await page.locator('[data-widget-id="geo-small"]').waitFor({ state: "visible" });
    await finishWebAnimations(page);
    await page.waitForFunction(({ key, expected, width }) => {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      return value?.widgets?.length === expected.widgets.length
        && value?.todayHidden === expected.todayHidden
        && value?.gap === expected.gap
        && (value?.todaySectionCount ?? 3) === expected.sections
        && value?.geometry?.viewportWidth === width
        && value?.geometry?.contentWidth > 0;
    }, { key: cacheKey(account), expected: { ...geometryLayout, sections }, width });
    const writtenLayout = await readCachedLayout(page, account);
    assert.deepEqual(
      { widgets: writtenLayout.widgets, todayHidden: writtenLayout.todayHidden, gap: writtenLayout.gap },
      { widgets: geometryLayout.widgets, todayHidden: geometryLayout.todayHidden, gap: geometryLayout.gap },
      `${width}px: completed visit records the current server silhouette`,
    );
    assert.equal(writtenLayout.todaySectionCount ?? 3, sections, `${width}px: completed visit records the Today section count`);
    assert.ok(writtenLayout.geometry, `${width}px: completed visit records exact viewport geometry`);
    assert.equal(writtenLayout.geometry.viewportWidth, width, `${width}px: cache geometry is scoped to the viewport width`);
    assert.ok(writtenLayout.geometry.contentWidth > 0 && writtenLayout.geometry.toolbarHeight > 0, `${width}px: cache records usable content and toolbar measurements`);
    await page.goto(fixtureUrl("/home", { account, scenario, hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    const before = await readSkeleton(page);
    assert.equal(before.restored, "true", `${width}px: cached layout is restored before the skeleton is shown`);
    assert.equal(before.phase, "pending");
    assert.equal(before.match, "false", "the pending read does not claim a server match");
    assert.equal(before.gap, "28px", `${width}px: cached custom gap is rendered`);
    assert.equal(before.todayHidden, String(todayHidden));
    assert.equal(before.todaySections, sections, `${width}px: cached section count is restored before the skeleton is shown`);
    assert.equal(before.todayCount, todayHidden ? 0 : 1, `${width}px: cached Today visibility is reflected in the skeleton`);
    assert.deepEqual(before.cards.map(({ size, miniStart }) => ({ size, startsNewMiniBlock: miniStart })), geometryLayout.widgets, `${width}px: cached widget order and mini split render`);
    if (width === 1280 && todayHidden) await page.locator(".home-skeleton").screenshot({ path: resolve(screenshotDir, "desktop-cached-home-hidden-today.png") });
    if (width === 450 && !todayHidden && sections === 3) await page.locator(".home-skeleton").screenshot({ path: resolve(screenshotDir, "phone-cached-home-visible-today.png") });

    await page.evaluate(() => window.__homeSkeletonFixture.releaseNextSuccess());
    await waitForTransitionPhase(page, "fading-out");
    const during = await readHandoffGeometry(page);
    const deltaY = (source, target) => source && target ? Number((target.y - source.y).toFixed(2)) : null;
    const deltaHeight = (source, target) => source && target ? Number((target.height - source.height).toFixed(2)) : null;
    console.log(`Home geometry ${width}px Today=${todayHidden ? "hidden" : `visible-${sections}`}: ${JSON.stringify({
      greeting: { y: deltaY(before.intro, during.greetingRect), height: deltaHeight(before.intro, during.greetingRect) },
      tabs: { skeletonHeight: before.tabs?.height, liveHeight: during.liveTabsRect?.height },
      toolbar: { y: deltaY(before.toolbar, during.liveToolbarRect), height: deltaHeight(before.toolbar, during.liveToolbarRect) },
      today: { y: deltaY(during.todaySkeletonRect, during.todayLiveRect), height: deltaHeight(during.todaySkeletonRect, during.todayLiveRect) },
      grid: { y: deltaY(before.gridRect, during.liveGridRect), height: deltaHeight(before.gridRect, during.liveGridRect) },
      firstCard: { y: deltaY(before.cards[0]?.rect, during.liveCards[0]?.rect), height: deltaHeight(before.cards[0]?.rect, during.liveCards[0]?.rect) },
    })}`);
    assert.equal(during.match, "true", `${width}px: same server shape is recognized`);
    assert.equal(during.contentHidden, true, `${width}px: content stays inert until the fade-in phase`);
    assert.equal(during.skeletonGap, "28px");
    assert.equal(during.liveGap, "28px", `${width}px: custom gap reaches the live grid`);
    assert.equal(during.todaySkeleton, todayHidden ? 0 : 1, `${width}px: Today visibility stays consistent in the cached skeleton`);
    assert.equal(during.todayLive, todayHidden ? 0 : 1, `${width}px: Today visibility stays consistent in server content`);
    assert.equal(during.todaySections, sections, `${width}px: cached Today section count stays consistent`);
    if (!todayHidden) assert.equal(during.todayLiveSections, sections, `${width}px: live Today section count stays consistent`);
    assert.equal(during.skeletonCards.length, geometryLayout.widgets.length);
    assert.equal(during.liveCards.length, geometryLayout.widgets.length);
    assert.deepEqual(during.skeletonCards.map(({ size, miniStart }) => ({ size, startsNewMiniBlock: miniStart })), during.liveCards.map(({ size, miniStart }) => ({ size, startsNewMiniBlock: miniStart })));
    for (const [index, source] of during.skeletonCards.entries()) {
      const target = during.liveCards[index];
      for (const dimension of ["x", "y", "width", "height"]) {
        recordClose(source.rect[dimension], target.rect[dimension], `${width}px Today ${todayHidden ? "hidden" : `visible-${sections}`} widget ${index} ${dimension}`);
        recordClose(before.cards[index].rect[dimension], source.rect[dimension], `${width}px widget ${index} cached stability ${dimension}`, 1);
      }
    }
    for (const [source, target, label] of [
      [before.intro, during.greetingRect, `${width}px greeting`],
      [before.toolbar, during.liveToolbarRect, `${width}px workspace toolbar`],
      [before.gridRect, during.liveGridRect, `${width}px widget grid`],
    ]) {
      if (!source || !target) {
        geometryFailures.push(`${label}: missing skeleton or live rectangle`);
        continue;
      }
      for (const dimension of ["x", "y", "width", "height"]) recordClose(source[dimension], target[dimension], `${label} ${dimension}`, 5);
    }
    if (!todayHidden) {
      if (!during.todaySkeletonRect || !during.todayLiveRect) geometryFailures.push(`${width}px Today visible-${sections}: missing source or target rectangle`);
      else for (const dimension of ["x", "y", "width", "height"]) recordClose(during.todaySkeletonRect[dimension], during.todayLiveRect[dimension], `${width}px Today visible-${sections} ${dimension}`, 5);
    }
    await finishWebAnimations(page);
    await page.locator('[data-widget-id="geo-small"]').waitFor({ state: "visible" });
    assert.equal((await readCachedLayout(page, account)).gap, 28, `${width}px: successful hydration preserves the matching cache`);
    await context.close();
  }

  // A cache measured at desktop width must use the responsive Today fallback
  // after a resize into the tablet band, where one/two sections share one row.
  for (const sections of [1, 2]) {
    const account = `tablet-fallback-${sections}`;
    const context = await browser.newContext({ viewport: { width: 1000, height: 980 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`tablet fallback ${sections}: ${error.message}`));
    await holdWebAnimations(page);
    const cachedLayout = {
      version: 1, widgets: geometryWidgets, todayHidden: false, gap: 28, todaySectionCount: sections,
      geometry: { viewportWidth: 1280, contentWidth: 975, todayHeight: 600, toolbarHeight: 300 },
    };
    await seedCache(page, account, cachedLayout);
    await page.goto(fixtureUrl("/home", { account, scenario: sections === 1 ? "geometry-one-section" : "geometry-two-sections", hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    assert.equal(await page.locator(".home-skeleton").evaluate((node) => node.style.getPropertyValue("--home-skeleton-measured-today-height")), "", "a different viewport discards the old Today measurement");
    await page.evaluate(() => window.__homeSkeletonFixture.releaseNextSuccess());
    await waitForTransitionPhase(page, "fading-out");
    const during = await readHandoffGeometry(page);
    assert.equal(during.todaySections, sections);
    assert.equal(during.todayLiveSections, sections);
    assert.ok(during.todaySkeletonRect && during.todayLiveRect);
    recordClose(during.todaySkeletonRect.height, during.todayLiveRect.height, `tablet ${sections}-section Today fallback height`, 2);
    assert.ok(during.todaySkeletonRect.height < 220, "one/two tablet sections retain a single-row footprint");
    await finishWebAnimations(page);
    await context.close();
  }

  // A stale cache fades out and the actual server content fades in using opacity only.
  {
    const account = "browser-mismatch";
    const stale = { version: 1, widgets: [{ size: "medium", startsNewMiniBlock: false }], todayHidden: true, gap: 16 };
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`mismatch: ${error.message}`));
    await holdWebAnimations(page);
    await seedCache(page, account, stale);
    await page.goto(fixtureUrl("/home", { account, scenario: "mismatch", hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    const pending = await readSkeleton(page);
    assert.deepEqual(pending.cards.map(({ size }) => size), ["medium"], "stale cache remains the pending skeleton");
    assert.deepEqual(await readCachedLayout(page, account), stale, "held read leaves stale storage unchanged");
    assert.equal(await page.evaluate(() => window.__homeSkeletonFixture.writes + window.__homeSkeletonFixture.posts), 0, "loading does not write workspace state");

    await page.evaluate(() => window.__homeSkeletonFixture.releaseNextSuccess());
    await waitForTransitionPhase(page, "fading-out");
    assert.equal(await page.locator(".home-load-transition").getAttribute("data-layout-match"), "false");
    assert.equal(await page.locator(".home-load-transition__surface, .home-load-transition__today-outline").count(), 0, "mismatch transition has no measured geometry overlays");
    const opacityOnly = await page.evaluate(() => (window.__homeSkeletonAnimations ?? [])
      .filter(({ target }) => target.classList.contains("home-load-transition__skeleton"))
      .map(({ animation }) => animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame).filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key)))));
    assert.deepEqual(opacityOnly, [["opacity", "opacity"]], "the mismatch skeleton animation changes opacity only");
    const refreshedCache = await readCachedLayout(page, account);
    assert.deepEqual({
      version: refreshedCache.version,
      widgets: refreshedCache.widgets,
      todayHidden: refreshedCache.todayHidden,
      gap: refreshedCache.gap,
    }, {
      version: 1,
      widgets: [{ size: "large", startsNewMiniBlock: false }, { size: "small", startsNewMiniBlock: false }],
      todayHidden: false,
      gap: 24,
    }, "successful server data replaces the stale cache");
    assert.ok(refreshedCache.geometry?.contentWidth > 0, "the refreshed cache also records the server layout's measurements");
    await finishWebAnimations(page);
    await page.locator('[data-widget-id="server-large"]').waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-skeleton").count(), 0);
    await context.close();
  }

  // Missing local storage uses the mixed first-account layout; a later account never reads it.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`first account: ${error.message}`));
    await holdWebAnimations(page);
    await page.goto(fixtureUrl("/home", { account: "new-account", scenario: "matching", hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    const firstAccount = await readSkeleton(page);
    assert.deepEqual(firstAccount.cards.map(({ size }) => size), DEFAULT_HOME_SKELETON_LAYOUT.widgets.map(({ size }) => size));
    assert.equal(firstAccount.todayHidden, "false");
    await page.evaluate(() => window.__homeSkeletonFixture.releaseNextSuccess());
    await waitForTransitionPhase(page, "done");
    assert.equal(await page.evaluate(() => window.__homeSkeletonAnimations.length), 0, "reduced motion skips WAAPI transitions");
    await page.locator('[data-widget-id="geo-small"]').waitFor({ state: "visible" });
    await context.close();
  }

  // A malformed cache is kept through a failed read and repaired only after a successful retry.
  {
    const account = "browser-retry";
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`retry: ${error.message}`));
    await holdWebAnimations(page);
    await page.addInitScript(({ key }) => {
      const marker = `malformed-seeded:${key}`;
      if (!sessionStorage.getItem(marker)) {
        localStorage.setItem(key, "{malformed");
        sessionStorage.setItem(marker, "true");
      }
    }, { key: cacheKey(account) });
    await page.goto(fixtureUrl("/home", { account, scenario: "matching", hold: true, failFirst: true }));
    await page.locator(".workspace-loading h1").waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-skeleton").count(), 0, "errors keep the retry view visible");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), cacheKey(account)), "{malformed", "failed read leaves malformed JSON untouched");
    await page.getByRole("button", { name: "Retry loading" }).click();
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page, 2);
    assert.deepEqual((await readSkeleton(page)).cards.map(({ size }) => size), DEFAULT_HOME_SKELETON_LAYOUT.widgets.map(({ size }) => size), "retry uses the default fallback while the read is held");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), cacheKey(account)), "{malformed", "held retry does not overwrite malformed JSON");
    await page.evaluate(() => window.__homeSkeletonFixture.releaseNextSuccess());
    await waitForTransitionPhase(page, "fading-out");
    assert.deepEqual((await readCachedLayout(page, account)).widgets.map(({ size }) => size), ["small", "mini", "mini", "medium"], "successful retry heals storage from the server snapshot");
    await finishWebAnimations(page);
    await context.close();
  }

  // Active workspace changes, size edits, and Today visibility update the cached silhouette.
  {
    const account = "browser-workspace-switch";
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`workspace switch: ${error.message}`));
    await page.goto(fixtureUrl("/home", { account, scenario: "workspace-switch", hold: false }));
    await page.locator('[data-widget-id="geo-small"]').waitFor({ state: "visible" });
    const secondaryTab = page.getByRole("tab", { name: "Secondary" });
    await secondaryTab.click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.widgets?.[0]?.size === "large", cacheKey(account));
    assert.equal((await readCachedLayout(page, account)).todayHidden, true, "workspace switch refreshes hidden Today");

    await page.locator('[data-widget-id="secondary-note"] button[aria-label$="options"]').click();
    await page.getByRole("button", { name: "Medium horizontal widget" }).click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.widgets?.[0]?.size === "medium", cacheKey(account));
    const customizeButton = page.getByRole("button", { name: "Customize", exact: true });
    if (await customizeButton.count()) await customizeButton.click();
    await page.getByRole("button", { name: "Restore Today section" }).click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.todayHidden === false, cacheKey(account));

    await page.getByRole("tab", { name: "Saved Home" }).click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.widgets?.[0]?.size === "small", cacheKey(account));
    assert.equal((await readCachedLayout(page, account)).todayHidden, false, "switching back restores the first workspace silhouette to storage");
    await context.close();
  }

  // A different signed-in profile in the same browser does not see account A's shape.
  {
    const accountA = "cache-account-a";
    const accountB = "cache-account-b";
    const accountALayout = { version: 1, widgets: [{ size: "large", startsNewMiniBlock: false }], todayHidden: true, gap: 20 };
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await seedCache(page, accountA, accountALayout);
    await page.goto(fixtureUrl("/home", { account: accountA, scenario: "matching", hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    assert.deepEqual((await readSkeleton(page)).cards.map(({ size }) => size), ["large"]);

    await page.goto(fixtureUrl("/home", { account: accountB, scenario: "matching", hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    assert.deepEqual((await readSkeleton(page)).cards.map(({ size }) => size), DEFAULT_HOME_SKELETON_LAYOUT.widgets.map(({ size }) => size), "account B gets its own fallback rather than account A's cached layout");
    assert.deepEqual(await readCachedLayout(page, accountA), accountALayout, "account B restoration leaves account A's key intact");
    await context.close();
  }

  assert.deepEqual(browserErrors, [], "browser fixture completed without runtime or console errors");
  assert.deepEqual(geometryFailures, [], `cached skeleton geometry matches the live Home layout within tolerance: ${geometryFailures.join("; ")}`);
  console.log("Home skeleton browser QA passed: cached desktop/phone geometry, custom gap, hidden Today, mismatch opacity-only handoff, new-account fallback, reduced motion, malformed-cache retry recovery, workspace edits/switching, and account isolation.");
  console.log(`Visual review screenshots: ${screenshotDir}`);
} finally {
  await browser?.close();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}
