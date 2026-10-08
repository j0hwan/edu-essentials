import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clientModule } from "../tests/helpers/client-modules.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-home-skeleton");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE
  ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href)
  : await import("esbuild");
const [globalCss, referenceCss, authCss, homeSkeletonCss, appearanceCss, blockLayoutCss, reorderCss] = await Promise.all([
  "app/globals.css",
  "app/reference-ui.css",
  "app/auth.css",
  "app/home-skeleton.css",
  "app/widget-appearance.css",
  "app/widget-block-layout.css",
  "app/widget-reorder.css",
].map((file) => readFile(resolve(repoRoot, file), "utf8")));
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/home-skeleton-browser.tsx")],
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
const css = [globalCss, referenceCss, authCss, appearanceCss, blockLayoutCss, reorderCss, homeSkeletonCss]
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
const baseUrl = `http://127.0.0.1:${address.port}`;
await mkdir(screenshotDir, { recursive: true });

const { HOME_SKELETON_PRESETS, chooseHomeSkeletonPreset, getHomeSkeletonPlacements } = await import(await clientModule("lib/home-skeleton.ts"));
const ids = HOME_SKELETON_PRESETS.map(({ id }) => id);
const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
let browser;
const browserErrors = [];

function presetUrl(path, preset, options = {}) {
  const url = new URL(path, baseUrl);
  url.searchParams.set("preset", preset);
  if (options.hold) url.searchParams.set("hold", "true");
  if (options.failFirst) url.searchParams.set("failFirst", "true");
  if (options.accountReduced) url.searchParams.set("accountReduced", "true");
  if (options.scenario) url.searchParams.set("scenario", options.scenario);
  return url.href;
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
      window.__homeSkeletonAnimations.push(animation);
      return animation;
    };
  });
}

async function finishAnimationWave(page) {
  await page.evaluate(() => {
    for (const animation of window.__homeSkeletonAnimations ?? []) {
      try { animation.finish(); } catch { /* A canceled animation is already complete. */ }
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

async function inspectPreset(page, preset, width) {
  const columns = width <= 600 ? 2 : 4;
  const expected = getHomeSkeletonPlacements(preset)[columns === 2 ? "phone" : "desktop"];
  const metrics = await page.evaluate(({ expectedPlacements, columnCount }) => {
    const root = document.querySelector(".home-skeleton");
    const grid = root?.querySelector(".home-skeleton__grid");
    const today = root?.querySelector(".home-skeleton__today");
    const toolbar = root?.querySelector(".home-skeleton__toolbar");
    if (!root || !grid || !today || !toolbar) return null;
    const rootRect = root.getBoundingClientRect();
    const todayRect = today.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const actionPlaceholders = Array.from(root.querySelectorAll(".home-skeleton__actions > *"));
    const gridRect = grid.getBoundingClientRect();
    const gridStyle = getComputedStyle(grid);
    const paddingLeft = Number.parseFloat(gridStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(gridStyle.paddingRight) || 0;
    const paddingTop = Number.parseFloat(gridStyle.paddingTop) || 0;
    const columnGap = Number.parseFloat(gridStyle.columnGap) || 0;
    const rowGap = Number.parseFloat(gridStyle.rowGap) || 0;
    const rowUnit = Number.parseFloat(gridStyle.gridAutoRows) || 0;
    const trackWidth = (gridRect.width - paddingLeft - paddingRight - columnGap * (columnCount - 1)) / columnCount;
    const mode = columnCount === 2 ? "phone" : "desktop";
    const cards = Array.from(grid.querySelectorAll(".home-skeleton__card"));
    const cardData = cards.map((card, index) => {
      const style = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const item = expectedPlacements[index];
      const actualVariables = {
        column: Number.parseInt(style.getPropertyValue(`--${mode}-column`), 10),
        columnSpan: Number.parseInt(style.getPropertyValue(`--${mode}-column-span`), 10),
        row: Number.parseInt(style.getPropertyValue(`--${mode}-row`), 10),
        rowSpan: Number.parseInt(style.getPropertyValue(`--${mode}-row-span`), 10),
      };
      return {
        childCount: card.childElementCount,
        size: card.getAttribute("data-size"),
        presetPlacement: item,
        actualVariables,
        gridColumnStart: style.gridColumnStart,
        gridColumnEnd: style.gridColumnEnd,
        gridRowStart: style.gridRowStart,
        gridRowEnd: style.gridRowEnd,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        expectedRect: {
          x: gridRect.x + paddingLeft + (item.column - 1) * (trackWidth + columnGap),
          y: gridRect.y + paddingTop + (item.row - 1) * (rowUnit + rowGap),
          width: trackWidth * item.columnSpan + columnGap * (item.columnSpan - 1),
          height: rowUnit * item.rowSpan + rowGap * (item.rowSpan - 1),
        },
      };
    });
    return {
      preset: root.getAttribute("data-preset"),
      grid: { x: gridRect.x, y: gridRect.y, width: gridRect.width, height: gridRect.height, columns: gridStyle.gridTemplateColumns },
      root: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
      today: {
        x: todayRect.x, y: todayRect.y, width: todayRect.width, height: todayRect.height,
        right: todayRect.right, bottom: todayRect.bottom,
        childCount: today.childElementCount, text: today.textContent.trim(),
        ariaHidden: Boolean(today.closest('[aria-hidden="true"]')), inert: Boolean(today.closest("[inert]")),
        controls: today.querySelectorAll("button, a, input, select, textarea").length,
        precedesToolbar: Boolean(today.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING),
        uiUnit: getComputedStyle(root).getPropertyValue("--ui-unit").trim(),
      },
      toolbar: { x: toolbarRect.x, y: toolbarRect.y, width: toolbarRect.width, height: toolbarRect.height },
      actions: actionPlaceholders.map((action) => {
        const rect = action.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, text: action.textContent.trim(), childCount: action.childElementCount };
      }),
      cards: cardData,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      widgetIds: root.querySelectorAll("[data-widget-id]").length,
      controls: root.querySelectorAll("button, a, input, select, textarea").length,
      accessibleStatusCount: document.querySelectorAll('.home-skeleton[role="status"][aria-label="Loading Home workspace"][aria-busy="true"]').length,
      forbiddenSkeletonDetails: root.querySelectorAll(".home-skeleton__card-header, .home-skeleton__card-icon, .home-skeleton__card-title, .home-skeleton__card-menu, .home-skeleton__body, .home-skeleton__bar, .home-skeleton__list-mark, .home-skeleton__note-pin, .home-skeleton__calendar-day").length,
    };
  }, { expectedPlacements: expected, columnCount: columns });

  assert.ok(metrics, `skeleton grid renders at ${width}px`);
  assert.equal(metrics.preset, preset.id, `the server-selected preset ID renders unchanged at ${width}px`);
  assert.equal(metrics.cards.length, preset.widgets.length, `all ${preset.widgets.length} curated cards render at ${width}px`);
  assert.equal(metrics.accessibleStatusCount, 1, "one accessible loading status is exposed");
  assert.equal(metrics.forbiddenSkeletonDetails, 0, "empty skeleton boxes do not contain card decoration");
  assert.equal(metrics.widgetIds, 0, "skeleton cards never impersonate saved widgets");
  assert.equal(metrics.controls, 0, "the skeleton contains no fake interactive controls");
  assert.equal(metrics.today.ariaHidden, true, "the pending Today placeholder is decorative");
  assert.equal(metrics.today.inert, true, "the pending Today placeholder is inert");
  assert.equal(metrics.today.childCount, 0, "the pending Today placeholder is an empty outline");
  assert.equal(metrics.today.text, "", "the pending Today placeholder contains no text");
  assert.equal(metrics.today.controls, 0, "the pending Today placeholder has no fake controls");
  assert.ok(metrics.today.precedesToolbar, "the Today placeholder appears before the toolbar");
  assert.notEqual(metrics.today.uiUnit, "", "the Today placeholder inherits the workspace UI unit");
  assert.ok(metrics.today.height > 40 && metrics.today.height < width * 1.5, `Today placeholder has a responsive, non-square footprint at ${width}px`);
  assert.ok(metrics.today.x >= metrics.root.x - 1 && metrics.today.right <= metrics.root.x + metrics.root.width + 1, `Today placeholder fits within the Home skeleton at ${width}px`);
  assert.ok(metrics.today.bottom <= metrics.toolbar.y + 1, `Today placeholder reserves space before the toolbar at ${width}px`);
  assert.equal(metrics.actions.length, 3, "the toolbar reserves its three real actions");
  for (const [index, action] of metrics.actions.entries()) {
    assert.equal(action.childCount, 0, `toolbar action ${index} is an empty outline`);
    assert.equal(action.text, "", `toolbar action ${index} has no fake text`);
    assert.ok(action.width > action.height && action.width >= 60, `toolbar action ${index} is a wide button placeholder at ${width}px`);
    assert.ok(action.x >= metrics.root.x - 1 && action.right <= metrics.root.x + metrics.root.width + 1, `toolbar action ${index} fits within the Home skeleton at ${width}px`);
  }
  assert.ok(metrics.documentWidth <= width + 1, `page does not overflow horizontally at ${width}px (${metrics.documentWidth}px)`);

  for (const [index, card] of metrics.cards.entries()) {
    const expectedPlacement = card.presetPlacement;
    assert.equal(card.childCount, 0, `${preset.id} card ${index} is an empty footprint at ${width}px`);
    assert.deepEqual(card.actualVariables, expectedPlacement, `${preset.id} card ${index} uses the curated ${columns}-column footprint`);
    assert.equal(card.gridColumnStart, String(expectedPlacement.column));
    assert.equal(card.gridColumnEnd, `span ${expectedPlacement.columnSpan}`);
    assert.equal(card.gridRowStart, String(expectedPlacement.row));
    assert.equal(card.gridRowEnd, `span ${expectedPlacement.rowSpan}`);
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(card.rect[dimension] - card.expectedRect[dimension]) <= 3,
        `${preset.id} card ${index} ${dimension} follows its grid footprint at ${width}px (${card.rect[dimension]} vs ${card.expectedRect[dimension]})`);
    }
    assert.ok(card.rect.x >= metrics.grid.x - 1 && card.rect.right <= metrics.grid.x + metrics.grid.width + 1, `${preset.id} card ${index} stays within the grid at ${width}px`);
    assert.ok(card.rect.y >= metrics.grid.y - 1 && card.rect.bottom <= metrics.grid.y + metrics.grid.height + 1, `${preset.id} card ${index} stays within the grid height at ${width}px`);
  }
  for (let first = 0; first < metrics.cards.length; first++) {
    for (let second = first + 1; second < metrics.cards.length; second++) {
      const a = metrics.cards[first].rect;
      const b = metrics.cards[second].rect;
      assert.ok(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1,
        `${preset.id} cards ${first} and ${second} do not overlap at ${width}px`);
    }
  }
}

try {
  browser = await playwright.chromium.launch(launchOptions);
  const geometryWidths = [320, 390, 1280, 1915];
  const presetIndex = new Map(HOME_SKELETON_PRESETS.map((preset, index) => [preset.id, index]));
  for (const preset of HOME_SKELETON_PRESETS) {
    for (const width of geometryWidths) {
      const context = await browser.newContext({ viewport: { width, height: 1040 }, reducedMotion: "no-preference" });
      const page = await context.newPage();
      page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
      await page.goto(presetUrl("/home", preset.id, { hold: true }));
      await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
      await waitForFixtureRead(page);
      await waitForTransitionPhase(page, "pending");
      assert.equal(await page.locator(".home-skeleton__today").count(), 1, "pending loading always reserves space for Today");
      assert.equal(await page.locator(".home-load-transition__today-outline").count(), 0, "pending loading has no saved-visibility transition overlay yet");
      assert.equal(await page.locator(".home-today-panel").count(), 0, "pending loading has not rendered Today from default client state");
      assert.equal(await page.evaluate(() => window.__homeSkeletonFixture.writes), 0, "the held Home read causes no snapshot write");
      await page.waitForTimeout(650);
      await inspectPreset(page, preset, width);
      if (presetIndex.get(preset.id) === 0 && width === 320) await page.locator(".home-skeleton").screenshot({ path: resolve(screenshotDir, `phone-${preset.id}.png`) });
      if (presetIndex.get(preset.id) === 0 && width === 1280) await page.locator(".home-skeleton").screenshot({ path: resolve(screenshotDir, `desktop-${preset.id}.png`) });
      await context.close();
    }
  }

  for (const motionCase of [
    { name: "standard", system: "no-preference", accountReduced: false, reduced: false },
    { name: "system reduced", system: "reduce", accountReduced: false, reduced: true },
    { name: "account reduced", system: "no-preference", accountReduced: true, reduced: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: motionCase.system });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    await page.goto(presetUrl("/home", HOME_SKELETON_PRESETS[0].id, { hold: true, accountReduced: motionCase.accountReduced }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await page.waitForFunction((motion) => document.documentElement.dataset.motion === motion, motionCase.accountReduced ? "reduced" : "full");
    const motion = await page.evaluate(() => {
      const card = document.querySelector(".home-skeleton__card");
      return {
        rootClass: document.querySelector(".home-skeleton")?.className,
        cardSweep: getComputedStyle(card, "::after").animationName,
      };
    });
    if (motionCase.reduced) {
      assert.match(motion.rootClass, /home-skeleton--reduced|home-skeleton/, `${motionCase.name} remains a presentational loading view`);
      assert.equal(motion.cardSweep, "none", `${motionCase.name} disables shimmer sweep`);
    } else {
      assert.notEqual(motion.cardSweep, "none", "standard motion preserves the gentle card shimmer");
    }
    if (motionCase.accountReduced) assert.match(motion.rootClass, /home-skeleton--reduced/, "account motion preference reaches the skeleton component");
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    await holdWebAnimations(page);
    await page.goto(presetUrl("/home", HOME_SKELETON_PRESETS[0].id, { hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    const freshPreset = chooseHomeSkeletonPreset(() => 0.91).id;
    await page.evaluate((id) => window.__homeSkeletonFixture.setPresetForReload(id), freshPreset);
    await page.reload();
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-skeleton").getAttribute("data-preset"), freshPreset, "reload renders the freshly selected server preset ID");
    assert.ok(ids.includes(await page.locator(".home-skeleton").getAttribute("data-preset")), "reload selection remains inside the finite curated library");
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    await holdWebAnimations(page);
    await page.goto(presetUrl("/home", HOME_SKELETON_PRESETS[0].id, { hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    const pendingTodayRect = await page.locator(".home-skeleton__today").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    assert.equal(await page.locator("[data-widget-id]").count(), 0);
    assert.equal(await page.evaluate(() => window.__homeSkeletonFixture.writes), 0);
    await page.evaluate(() => {
      window.__homeSkeletonFixture.setHoldReads(false);
      window.__homeSkeletonFixture.releaseNextSuccess();
    });
    await waitForTransitionPhase(page, "animating");
    const duringTransition = await page.evaluate(() => {
      const transition = document.querySelector('.home-load-transition[data-phase="animating"]');
      const host = transition?.querySelector(".home-load-transition__host");
      const content = transition?.querySelector(".home-load-transition__content");
      const skeleton = transition?.querySelector(".home-load-transition__skeleton");
      const notes = host?.querySelector('[data-widget-id="saved-notes"]');
      const today = transition?.querySelector(".home-load-transition__today-outline");
      const todayAnimation = window.__homeSkeletonAnimations?.find((animation) => animation.effect?.target === today);
      const todayFrames = todayAnimation?.effect?.getKeyframes().map((frame) => ({
        opacity: frame.opacity === undefined ? null : Number(frame.opacity),
        transform: frame.transform ?? null,
      })) ?? [];
      const todayRect = today?.getBoundingClientRect();
      const targetSurfaces = Array.from(transition?.querySelectorAll(".home-load-transition__surface[data-transition-target-id]") ?? []);
      return {
        contentHidden: content?.getAttribute("aria-hidden") === "true" && content?.hasAttribute("inert"),
        contentNotRevealed: !!content && (getComputedStyle(content).visibility === "hidden" || Number(getComputedStyle(content).opacity) < 0.05),
        sourceHidden: !!skeleton && (getComputedStyle(skeleton).visibility === "hidden" || getComputedStyle(skeleton).display === "none"),
        notesMeasured: !!notes && notes.getBoundingClientRect().width > 0 && notes.getBoundingClientRect().height > 0,
        todayOutline: !!today,
        todayIsDecoration: today?.getAttribute("aria-hidden") === "true" && today?.hasAttribute("inert"),
        todayRect: todayRect ? { x: todayRect.x, y: todayRect.y, width: todayRect.width, height: todayRect.height } : null,
        todayFrames,
        targetSurfaces: targetSurfaces.map((surface) => ({ id: surface.getAttribute("data-transition-target-id"), size: surface.getAttribute("data-size") })),
        notesSize: notes?.getAttribute("data-size"),
      };
    });
    assert.equal(duringTransition.contentHidden, true, "real saved Home children are inert and hidden from assistive technology while their layout is measured");
    assert.equal(duringTransition.contentNotRevealed, true, "real widget content remains visually hidden until its outlines move");
    assert.equal(duringTransition.sourceHidden, true, "the original skeleton footprints are hidden once their moving outlines launch");
    assert.equal(duringTransition.notesMeasured, true, "the real saved widget has measurable geometry before reveal");
    assert.equal(duringTransition.todayOutline, true, "a saved visible Today section receives a transition outline");
    assert.equal(duringTransition.todayIsDecoration, true, "the Today transition outline is decorative and inert");
    assert.ok(duringTransition.todayRect, "the Today outline begins as a measurable transition surface");
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(duringTransition.todayRect[dimension] - pendingTodayRect[dimension]) <= 2, `Today begins at its pending placeholder ${dimension}`);
    }
    assert.ok(duringTransition.todayFrames.length >= 2, "Today has a direct source-to-target animation");
    assert.ok(duringTransition.todayFrames.every((frame) => frame.opacity === null || frame.opacity >= 0.99), "Today stays fully visible through its morph without an opacity popup");
    assert.ok(!String(duringTransition.todayFrames[0].transform ?? "").includes("scale(.96)"), "Today does not pop in from an independent scale effect");
    assert.ok(duringTransition.targetSurfaces.some((surface) => surface.id === "saved-notes" && surface.size === duringTransition.notesSize), "a moving outline targets the saved widget identity and footprint");
    await page.locator(".home-load-transition").screenshot({ path: resolve(screenshotDir, "desktop-morph.png") });
    await finishAnimationWave(page);
    await waitForTransitionPhase(page, "revealing");
    const aligned = await page.evaluate(() => {
      const transition = document.querySelector('.home-load-transition[data-phase="revealing"]');
      const host = transition?.querySelector(".home-load-transition__host");
      const content = transition?.querySelector(".home-load-transition__content");
      const rect = (node) => {
        if (!node) return null;
        const value = node.getBoundingClientRect();
        return { x: value.x, y: value.y, width: value.width, height: value.height };
      };
      const appearance = (node) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return { background: style.background, border: style.border, borderRadius: style.borderRadius, boxShadow: style.boxShadow };
      };
      const widgets = new Map(Array.from(host?.querySelectorAll("[data-widget-id]") ?? []).map((node) => [node.getAttribute("data-widget-id"), node]));
      const surfaces = Array.from(transition?.querySelectorAll(".home-load-transition__surface[data-transition-target-id]") ?? []);
      const today = transition?.querySelector(".home-load-transition__today-outline");
      const panel = host?.querySelector(".home-today-panel");
      return {
        contentHidden: content?.getAttribute("aria-hidden") === "true" && content?.hasAttribute("inert"),
        contentOpacity: content ? Number(getComputedStyle(content).opacity) : null,
        widgetPairs: surfaces.map((surface) => ({ id: surface.getAttribute("data-transition-target-id"), surface: rect(surface), target: rect(widgets.get(surface.getAttribute("data-transition-target-id"))), appearance: appearance(surface), targetAppearance: appearance(widgets.get(surface.getAttribute("data-transition-target-id"))) })),
        today: today ? rect(today) : null,
        todayTarget: panel ? rect(panel) : null,
      };
    });
    assert.equal(aligned.contentHidden, true, "content remains inert until the outline movement is complete");
    assert.ok(aligned.contentOpacity === null || aligned.contentOpacity <= 0.05, "contents stay visually hidden until their fade-in begins after movement");
    assert.ok(aligned.widgetPairs.some(({ id }) => id === "saved-notes"), "the movement phase retains the saved widget target");
    for (const pair of aligned.widgetPairs) {
      assert.ok(pair.target, `the ${pair.id} transition surface resolves to saved content`);
      for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(pair.surface[dimension] - pair.target[dimension]) <= 2, `the ${pair.id} outline lands on the saved ${dimension}`);
      }
      assert.deepEqual(pair.appearance, pair.targetAppearance, `the ${pair.id} outline adopts saved widget appearance`);
    }
    assert.ok(aligned.today && aligned.todayTarget, "visible Today has both transition and saved rectangles");
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(aligned.today[dimension] - aligned.todayTarget[dimension]) <= 2, `Today outline lands on the saved ${dimension}`);
    }
    await page.locator(".home-load-transition").screenshot({ path: resolve(screenshotDir, "desktop-morph-targets.png") });
    await finishWebAnimations(page);
    await waitForTransitionPhase(page, "done");
    await page.locator('[data-widget-id="saved-notes"] textarea').waitFor({ state: "visible" });
    await page.locator(".home-skeleton").waitFor({ state: "detached" });
    assert.equal(await page.locator(".home-load-transition__today-outline").count(), 0, "the decorative Today outline is removed when real content is revealed");
    assert.equal(await page.locator('[data-widget-id="saved-notes"]').evaluate((node) => node.closest(".home-load-transition__content")?.getAttribute("aria-hidden")), null, "saved widget content becomes accessible after the transition");
    const homeRectBeforeQuietPeriod = await page.locator(".home-page").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, animation: getComputedStyle(node).animationName };
    });
    assert.equal(homeRectBeforeQuietPeriod.animation, "none", "Home's generic page entrance animation stays disabled after reveal");
    await page.waitForTimeout(300);
    const homeRectAfterQuietPeriod = await page.locator(".home-page").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(homeRectBeforeQuietPeriod[dimension] - homeRectAfterQuietPeriod[dimension]) <= 0.5, `Home does not jiggle after completion (${dimension})`);
    }
    await page.waitForTimeout(760);
    assert.equal(await page.evaluate(() => window.__homeSkeletonFixture.writes), 0, "the successful unchanged snapshot exits loading without an autosave");
    await page.getByRole("link", { name: "Tasks" }).click();
    await page.waitForFunction(() => window.location.pathname === "/tasks");
    assert.equal(await page.locator(".home-load-transition").count(), 0, "leaving Home unmounts its completed transition boundary");
    await page.getByRole("link", { name: "Home" }).click();
    await page.waitForFunction(() => window.location.pathname === "/home");
    await page.locator(".home-page").waitFor({ state: "visible" });
    await waitForTransitionPhase(page, "done");
    assert.equal(await page.locator(".home-skeleton, .home-load-transition__surface").count(), 0, "navigating back when data is already ready bypasses the loading morph");
    await context.close();
  }

  for (const scenario of ["today-hidden", "empty", "empty-hidden", "count-mismatch", "appearance", "mini-blocks"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror (${scenario}): ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console (${scenario}): ${message.text()}`); });
    await holdWebAnimations(page);
    await page.goto(presetUrl("/home", HOME_SKELETON_PRESETS[1].id, { hold: true, scenario }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    await waitForTransitionPhase(page, "pending");
    assert.equal(await page.locator(".home-skeleton__today").count(), 1, `${scenario}: pending state always contains the empty Today placeholder`);
    assert.equal(await page.locator(".home-load-transition__today-outline").count(), 0, `${scenario}: pending state does not guess Today visibility`);
    const pendingTodayRect = await page.locator(".home-skeleton__today").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.evaluate(() => {
      window.__homeSkeletonFixture.setHoldReads(false);
      window.__homeSkeletonFixture.releaseNextSuccess();
    });
    await waitForTransitionPhase(page, "animating");
    const during = await page.evaluate(() => {
      const transition = document.querySelector('.home-load-transition[data-phase="animating"]');
      const host = transition?.querySelector(".home-load-transition__host");
      const content = transition?.querySelector(".home-load-transition__content");
      const widgets = Array.from(host?.querySelectorAll("[data-widget-id]") ?? []);
      const today = transition?.querySelector(".home-load-transition__today-outline");
      const todayAnimation = window.__homeSkeletonAnimations?.find((animation) => animation.effect?.target === today);
      const todayFrames = todayAnimation?.effect?.getKeyframes().map((frame) => ({
        opacity: frame.opacity === undefined ? null : Number(frame.opacity),
        transform: frame.transform ?? null,
      })) ?? [];
      const todayRect = today?.getBoundingClientRect();
      return {
        contentHidden: content?.getAttribute("aria-hidden") === "true" && content?.hasAttribute("inert"),
        widgetIds: widgets.map((widget) => widget.getAttribute("data-widget-id")),
        today: !!today,
        todayRect: todayRect ? { x: todayRect.x, y: todayRect.y, width: todayRect.width, height: todayRect.height } : null,
        todayFrames,
        hiddenToday: today?.getAttribute("data-hidden-today") === "true",
        actualToday: !!host?.querySelector(".home-today-panel"),
      };
    });
    assert.equal(during.contentHidden, true, `${scenario}: saved children stay inert until reveal`);
    assert.equal(during.today, true, `${scenario}: the pending Today placeholder morphs or fades during handoff`);
    assert.ok(during.todayRect, `${scenario}: Today transition surface is measurable`);
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(during.todayRect[dimension] - pendingTodayRect[dimension]) <= 2, `${scenario}: Today transition starts from its placeholder ${dimension}`);
    }
    assert.ok(during.todayFrames.length >= 2, `${scenario}: Today has an explicit handoff animation`);
    if (scenario === "today-hidden" || scenario === "empty-hidden") {
      assert.equal(during.hiddenToday, true, `${scenario}: saved hidden Today uses its source fade`);
      assert.equal(during.todayFrames[0].opacity, 1, `${scenario}: hidden Today starts fully visible`);
      assert.equal(during.todayFrames.at(-1).opacity, 0, `${scenario}: hidden Today fades out`);
    } else {
      assert.equal(during.hiddenToday, false, `${scenario}: visible Today morphs to its saved panel`);
      assert.ok(during.todayFrames.every((frame) => frame.opacity === null || frame.opacity >= 0.99), `${scenario}: visible Today stays opaque through its morph`);
    }
    const hasToday = scenario !== "today-hidden" && scenario !== "empty-hidden";
    assert.equal(during.actualToday, hasToday, `${scenario}: Today rendering follows saved visibility`);

    const expectedWidgetIds = scenario === "empty" || scenario === "empty-hidden" ? [] : scenario === "count-mismatch"
      ? ["saved-notes", "saved-upcoming", "saved-mini"] : scenario === "mini-blocks"
        ? ["saved-mini-a", "saved-mini-b", "saved-mini-c", "saved-notes"]
        : ["saved-notes", "saved-upcoming", "saved-mini-a", "saved-mini-b"];
    assert.deepEqual(during.widgetIds, expectedWidgetIds, `${scenario}: the transition measures the actual saved widget count and identity`);
    await finishAnimationWave(page);
    await waitForTransitionPhase(page, "revealing");
    const landing = await page.evaluate(() => {
      const transition = document.querySelector('.home-load-transition[data-phase="revealing"]');
      const host = transition?.querySelector(".home-load-transition__host");
      const content = transition?.querySelector(".home-load-transition__content");
      const rect = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const appearance = (node) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return { background: style.background, border: style.border, borderRadius: style.borderRadius, boxShadow: style.boxShadow };
      };
      const widgets = new Map(Array.from(host?.querySelectorAll("[data-widget-id]") ?? []).map((node) => [node.getAttribute("data-widget-id"), node]));
      const surfaces = Array.from(transition?.querySelectorAll(".home-load-transition__surface[data-transition-target-id]") ?? []);
      const today = transition?.querySelector(".home-load-transition__today-outline");
      const panel = host?.querySelector(".home-today-panel");
      const grid = host?.querySelector(".widget-grid");
      const savedNotes = host?.querySelector('[data-widget-id="saved-notes"]');
      const savedUpcoming = host?.querySelector('[data-widget-id="saved-upcoming"]');
      const miniStart = host?.querySelector('[data-widget-id="saved-mini-b"]');
      return {
        contentHidden: content?.getAttribute("aria-hidden") === "true" && content?.hasAttribute("inert"),
        contentOpacity: content ? Number(getComputedStyle(content).opacity) : null,
        widgetPairs: surfaces.map((surface) => ({ id: surface.getAttribute("data-transition-target-id"), size: surface.getAttribute("data-size"), surface: rect(surface), target: rect(widgets.get(surface.getAttribute("data-transition-target-id"))), appearance: appearance(surface), targetAppearance: appearance(widgets.get(surface.getAttribute("data-transition-target-id"))) })),
        today: rect(today), todayTarget: rect(panel), todayAppearance: appearance(today), todayTargetAppearance: appearance(panel),
        gap: grid ? getComputedStyle(grid).gap : null,
        notesPadding: savedNotes ? getComputedStyle(savedNotes).padding : null,
        upcomingPadding: savedUpcoming ? getComputedStyle(savedUpcoming).padding : null,
        miniStartsNewBlock: miniStart?.getAttribute("data-mini-start"),
      };
    });
    assert.equal(landing.contentHidden, true, `${scenario}: real content stays inaccessible during its reveal animation`);
    assert.ok(landing.contentOpacity === null || landing.contentOpacity <= 0.05, `${scenario}: content does not fade in until outlines reach their targets`);
    assert.equal(landing.widgetPairs.length, expectedWidgetIds.length, `${scenario}: a matching outline is produced for every saved widget, including zero/short counts`);
    for (const pair of landing.widgetPairs) {
      assert.ok(pair.target, `${scenario}: outline ${pair.id} resolves to a saved widget`);
      assert.equal(pair.size, await page.locator(`[data-widget-id="${pair.id}"]`).getAttribute("data-size"), `${scenario}: the outline preserves ${pair.id}'s saved size`);
      for (const dimension of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(pair.surface[dimension] - pair.target[dimension]) <= 2, `${scenario}: ${pair.id} outline lands on saved ${dimension}`);
      }
      assert.deepEqual(pair.appearance, pair.targetAppearance, `${scenario}: ${pair.id} outline matches saved surface styling`);
    }
    if (scenario === "today-hidden" || scenario === "empty-hidden") {
      assert.ok(landing.today, `${scenario}: the fading Today source remains until the handoff reveal`);
      assert.equal(landing.todayTarget, null, "saved hidden Today is absent from the real host");
    } else {
      assert.ok(landing.today && landing.todayTarget, `${scenario}: visible Today has matching transition and saved rectangles`);
      for (const dimension of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(landing.today[dimension] - landing.todayTarget[dimension]) <= 2, `${scenario}: Today outline lands on saved ${dimension}`);
      }
    }
    if (scenario === "appearance") {
      assert.equal(landing.gap, "28px", "the transition measures saved widget spacing from custom appearance");
      assert.equal(landing.notesPadding, "24px", "the transition measures the saved default card dimensions");
      assert.equal(landing.upcomingPadding, "20px", "the transition measures per-widget appearance overrides");
    }
    if (scenario === "mini-blocks") assert.equal(landing.miniStartsNewBlock, "true", "saved mini-block starts survive the transition");

    await finishWebAnimations(page);
    await waitForTransitionPhase(page, "done");
    assert.deepEqual(await page.locator("[data-widget-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-widget-id"))), expectedWidgetIds, `${scenario}: only actual saved widget nodes remain after completion`);
    assert.equal(await page.locator(".home-load-transition__surface").count(), 0, `${scenario}: transition surfaces are removed at completion`);
    assert.equal(await page.evaluate(() => window.__homeSkeletonFixture.writes), 0, `${scenario}: loading and reveal never write the saved snapshot`);
    if (scenario === "empty" || scenario === "empty-hidden") await page.locator(".empty-workspace").waitFor({ state: "visible" });
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror (resize): ${error.message}`));
    await holdWebAnimations(page);
    await page.goto(presetUrl("/home", HOME_SKELETON_PRESETS[2].id, { hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    await page.evaluate(() => {
      window.__homeSkeletonFixture.setHoldReads(false);
      window.__homeSkeletonFixture.releaseNextSuccess();
    });
    await waitForTransitionPhase(page, "animating");
    await page.setViewportSize({ width: 390, height: 900 });
    await waitForTransitionPhase(page, "done");
    await page.locator('[data-widget-id="saved-notes"] textarea').waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-load-transition__surface, .home-load-transition__today-outline").count(), 0, "resizing cancels measured overlays and reveals the real Home directly");
    assert.equal(await page.locator(".home-load-transition__content").getAttribute("aria-hidden"), null, "resize cleanup restores access to content");
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror (route cleanup): ${error.message}`));
    await holdWebAnimations(page);
    await page.goto(presetUrl("/home", HOME_SKELETON_PRESETS[3].id, { hold: true }));
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page);
    await page.evaluate(() => {
      window.__homeSkeletonFixture.setHoldReads(false);
      window.__homeSkeletonFixture.releaseNextSuccess();
    });
    await waitForTransitionPhase(page, "animating");
    await page.getByRole("link", { name: "Tasks" }).click();
    await page.waitForFunction(() => window.location.pathname === "/tasks");
    assert.equal(await page.locator(".home-load-transition").count(), 0, "routing away during the morph unmounts its transition boundary");
    assert.equal(await page.locator(".home-load-transition__surface, .home-load-transition__today-outline").count(), 0, "route cleanup removes all measured overlays");
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    await page.goto(presetUrl("/home", HOME_SKELETON_PRESETS[0].id, { hold: true, failFirst: true }));
    await page.locator(".workspace-loading h1").waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-skeleton").count(), 0, "errors retain the existing retry view");
    await page.getByRole("button", { name: "Retry loading" }).click();
    await page.getByRole("status", { name: "Loading Home workspace" }).waitFor({ state: "visible" });
    await waitForFixtureRead(page, 2);
    assert.equal(await page.evaluate(() => window.__homeSkeletonFixture.writes), 0);
    await page.evaluate(() => {
      window.__homeSkeletonFixture.setHoldReads(false);
      window.__homeSkeletonFixture.releaseNextSuccess();
    });
    await waitForTransitionPhase(page, "done");
    assert.equal(await page.locator('.home-load-transition[data-phase="animating"], .home-load-transition[data-phase="revealing"]').count(), 0, "reduced motion bypasses both transition stages");
    await page.locator('[data-widget-id="saved-notes"] textarea').waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.__homeSkeletonFixture.writes), 0, "a successful retry only hydrates saved content");
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    await page.goto(presetUrl("/calendar", HOME_SKELETON_PRESETS[0].id, { hold: true }));
    await page.locator(".workspace-loading.is-pending").waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-skeleton").count(), 0, "other routes keep the original pending loader");
    await page.evaluate(() => {
      window.__homeSkeletonFixture.setHoldReads(false);
      window.__homeSkeletonFixture.releaseNextSuccess();
    });
    await page.locator(".workspace-loading.is-pending").waitFor({ state: "detached" });
    await context.close();
  }

  assert.deepEqual(browserErrors, [], "the fixture runs without browser runtime errors");
  console.log(`Verified ${HOME_SKELETON_PRESETS.length} Home skeleton presets at ${geometryWidths.join(", ")}px plus hydration, morph landing/reveal, saved Today visibility, empty/count-mismatch/appearance/mini-block layouts, reduced motion, reload/retry, resize/route cleanup, and non-Home cases.`);
  console.log(`Visual review screenshots: ${screenshotDir}`);
} finally {
  await browser?.close();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}
