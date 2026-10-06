import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-widget-layout");

// Optional browser QA. Set PLAYWRIGHT_MODULE to a bundled playwright/index.mjs
// if Playwright is not installed in this repository; set CHROME_EXECUTABLE if
// Chrome is installed outside Playwright's standard "chrome" channel lookup.
// PowerShell example: $env:PLAYWRIGHT_MODULE = 'C:/path/to/playwright/index.mjs'; node scripts/verify-widget-layout.mjs
const [globalCss, referenceCss, widgetAppearanceCss, widgetBlockLayoutCss, playwright] = await Promise.all([
  readFile(resolve(repoRoot, "app/globals.css"), "utf8"),
  readFile(resolve(repoRoot, "app/reference-ui.css"), "utf8"),
  readFile(resolve(repoRoot, "app/widget-appearance.css"), "utf8"),
  readFile(resolve(repoRoot, "app/widget-block-layout.css"), "utf8"),
  (async () => {
    try {
      return process.env.PLAYWRIGHT_MODULE
        ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
        : await import("playwright");
    } catch (error) {
      throw new Error("Playwright is unavailable. Install it outside this script or set PLAYWRIGHT_MODULE to a bundled playwright/index.mjs path.", { cause: error });
    }
  })(),
]);

const longText = "An intentionally long fictional dashboard entry exercises content overflow without account data. ".repeat(70);
async function renderActualWidgetMarkup() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://layout.example.invalid/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  for (const name of ["HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent"]) globalThis[name] = dom.window[name];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.confirm = () => true;

  const { clientModule } = await import("../tests/helpers/client-modules.mjs");
  const [{ createElement, act }, { createRoot }, { default: Workspace }, { validateProfile }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import(await clientModule("app/workspace-client.tsx")),
    import(await clientModule("lib/profile.ts")),
  ]);
  const sizeByType = new Map([[12, 0], [4, 0], [6, 0], [16, 0], [15, 2], [5, 0], [17, 0], [11, 1], [8, 1]]);
  const idByType = new Map([[12, "notes"], [4, "alerts"], [6, "timer"], [16, "quote"], [15, "overview"], [5, "calendar"], [17, "spacer"], [11, "links"], [8, "completion"], [2, "upcoming"]]);
  const typeOrder = [12, 4, 6, 16, 15, 5, 17, 11, 8, 0, 1, 2, 3, 7, 9, 10, 13, 14];
  const widgets = typeOrder.map((type) => [type, sizeByType.get(type) ?? 0, idByType.get(type) ?? `widget-${type}`, ...(type === 12 ? [0] : [])]);
  const courses = Array.from({ length: 4 }, (_, index) => ({
    id: `course-${index + 1}`,
    code: `HIST ${200 + index}`,
    name: `Advanced fictional archival methods and historical interpretation ${index + 1}`,
    credits: 3,
    instructor: "Example Instructor",
    room: "Example Hall",
    color: ["#6376ff", "#38b8d4", "#51b883", "#d9923c"][index],
    soft: "#6376ff20",
    initials: `H${index + 1}`,
  }));
  const assignments = Array.from({ length: 8 }, (_, index) => ({
    id: `assignment-${index + 1}`,
    title: `A carefully prepared fictional archive analysis and annotated primary source review ${index + 1} `.repeat(3),
    courseId: courses[index % courses.length].id,
    due: "2099-10-08",
    dateKey: `2099-10-${String(8 + index).padStart(2, "0")}`,
    status: "later",
    progress: 20 + index * 5,
    description: longText,
    weight: "",
    type: index % 2 ? "Assignment" : "Exam",
  }));
  const dashboard = { v: 2, a: "fixture", w: [["fixture", "Fictional", widgets]], t: [longText], d: { assignments, manualEvents: [], dashboardView: "cards", calendarView: "month" } };
  const updatedAt = "2026-10-01T00:00:00.000Z";
  const profile = { ...validateProfile({ display_name: "Alex" }), id: "fixture-profile", auth_user_id: "fixture-user", email: "alex@example.invalid", avatar_url: null, initialized: true, updated_at: updatedAt, onboarding_completed_at: updatedAt };
  globalThis.fetch = async (url) => String(url).startsWith("/api/files")
    ? Response.json({ files: [] })
    : Response.json({ initialized: true, courses, dashboard, revision: updatedAt, profile });
  const rootNode = document.getElementById("root");
  const root = createRoot(rootNode);
  await act(async () => {
    root.render(createElement(Workspace, { initialProfile: profile }));
    await new Promise((done) => setTimeout(done, 0));
  });
  const grid = rootNode.querySelector(".widget-grid");
  assert.ok(grid, "actual Workspace component should render the widget grid");
  assert.equal(grid.querySelectorAll(".widget-card").length, 18, "fixture should render every production widget type");
  const markup = grid.innerHTML;
  await act(async () => root.unmount());
  dom.window.close();
  return markup;
}

const cardsMarkup = await renderActualWidgetMarkup();

// This opt-in browser fixture combines actual Workspace markup with production CSS.
const documentHtml = `<!doctype html><html data-theme="dark" data-motion="reduced" style='--font-geist-sans:"Segoe UI";--font-geist-mono:Consolas,monospace'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
${globalCss.replace(/^@import[^;]+;\s*/m, "")}
${referenceCss}
${widgetAppearanceCss}
${widgetBlockLayoutCss}
</style></head><body><div class="app-shell reference-ui" id="app">
  <aside class="sidebar"><div class="brand-row"><div class="brand-mark">E</div><div class="brand-copy"><strong>EduEssentials</strong><span>Fictional workspace</span></div><button class="sidebar-toggle" aria-label="Collapse sidebar">≡</button></div><nav class="main-nav"><a class="nav-item active"><span>Home</span></a><a class="nav-item"><span>Courses</span></a></nav><div class="sidebar-bottom"><div class="profile-card"><span class="avatar">F</span><span><strong>Fictional profile</strong><small>example.invalid</small></span></div></div></aside>
  <main class="main-content"><div class="page home-page"><header class="home-greeting"><h1>Good morning, Alex</h1><p>A local layout fixture with fictional records.</p></header><section class="workspace-section"><div class="workspace-bar"><div class="workspace-tabs"><button class="active">My Day</button></div><div class="workspace-actions"><button class="secondary-button">Customize</button><button class="secondary-button add-widget-control">Add widget</button></div></div><div class="widget-grid" aria-label="My Day widgets">${cardsMarkup}</div></section><div class="fixture-footer" style="min-height:620px;padding:30px"><h2>Long page area</h2><p>Scroll content to verify the widget menu remains on top.</p></div></div></main>
</div><script>
document.querySelector(".sidebar-toggle").addEventListener("click", () => {
  const app = document.querySelector("#app");
  const collapsed = app.classList.toggle("sidebar-collapsed");
  document.querySelector(".sidebar-toggle").setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
});
document.querySelectorAll(".widget-header .menu-wrap > button").forEach((trigger) => trigger.addEventListener("click", () => {
  const card = trigger.closest(".widget-card");
  const current = card.querySelector(".widget-menu");
  if (current) { current.remove(); return; }
  document.querySelectorAll(".widget-menu").forEach((menu) => menu.remove());
  const menu = document.createElement("div");
  menu.className = "popover widget-menu";
  menu.innerHTML = '<p>Widget size</p><div class="size-options"><button data-size="mini" aria-label="Mini widget">Mini</button><button data-size="small" aria-label="Small widget">Small</button><button data-size="medium" aria-label="Medium horizontal widget">Medium horizontal</button><button data-size="medium-vertical" aria-label="Medium vertical widget">Medium vertical</button><button data-size="large" aria-label="Large widget">Large</button></div><button data-move="-1">Move earlier</button><button data-move="1">Move later</button>';
  const placeMenu = () => {
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const width = menu.offsetWidth || Math.min(240, viewportWidth * .85);
    const anchorRect = trigger.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchorRect.right - width, viewportWidth - width - 12));
    menu.style.left = String(left - cardRect.left - card.clientLeft) + "px";
    menu.style.right = "auto";
    menu.style.top = String(anchorRect.bottom - cardRect.top - card.clientTop + 4) + "px";
  };
  const cleanup = () => {
    window.removeEventListener("resize", placeMenu);
    card.removeEventListener("scroll", placeMenu, true);
  };
  menu.querySelectorAll("[data-size]").forEach((button) => button.addEventListener("click", () => {
    card.dataset.size = button.dataset.size;
    cleanup();
    menu.remove();
  }));
  menu.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => {
    const sibling = Number(button.dataset.move) < 0 ? card.previousElementSibling : card.nextElementSibling;
    if (sibling) sibling.insertAdjacentElement(Number(button.dataset.move) < 0 ? "beforebegin" : "afterend", card);
    cleanup();
    menu.remove();
  }));
  card.append(menu);
  placeMenu();
  window.addEventListener("resize", placeMenu);
  card.addEventListener("scroll", placeMenu, true);
}));
</script></body></html>`;

function near(actual, expected, message, tolerance = 1.5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} ± ${tolerance}px, received ${actual}px`);
}

async function snapshotLayout(page) {
  // Container-query styles and their dependent tracks settle during rendering.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const grid = document.querySelector(".widget-grid").getBoundingClientRect();
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const cards = [...document.querySelectorAll(".widget-card")].map((card) => {
      const rect = card.getBoundingClientRect();
      return { id: card.dataset.widgetId, type: [...card.classList].find((name) => name.startsWith("widget-") && name !== "widget-card"), size: card.dataset.size, x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, right: rect.right + scrollX, bottom: rect.bottom + scrollY };
    });
    return { grid: { x: grid.x + scrollX, y: grid.y + scrollY, width: grid.width, height: grid.height, right: grid.right + scrollX, bottom: grid.bottom + scrollY }, cards, workspaceWidth: document.querySelector(".main-content").clientWidth, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
}

async function settleLayout(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function assertGridLayout(layout, label) {
  assert.ok(layout.grid.width > 0, `${label}: widget grid has a measurable width`);
  assert.ok(layout.cards.length > 0, `${label}: widget grid contains cards`);
  for (const card of layout.cards) {
    assert.ok(card.x >= layout.grid.x - 1.5, `${label}: ${card.id} stays inside the grid's left edge`);
    assert.ok(card.right <= layout.grid.right + 1.5, `${label}: ${card.id} stays inside the grid's right edge`);
    assert.ok(card.y >= layout.grid.y - 1.5, `${label}: ${card.id} stays inside the grid's top edge`);
    assert.ok(card.bottom <= layout.grid.bottom + 1.5, `${label}: ${card.id} stays inside the grid's bottom edge`);
  }
  for (let i = 0; i < layout.cards.length; i++) {
    for (let j = i + 1; j < layout.cards.length; j++) {
      const left = layout.cards[i], right = layout.cards[j];
      const overlapWidth = Math.min(left.right, right.right) - Math.max(left.x, right.x);
      const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y);
      assert.ok(overlapWidth <= 1 || overlapHeight <= 1, `${label}: ${left.id} and ${right.id} overlap by ${overlapWidth}×${overlapHeight}px`);
    }
  }
  return layout.cards;
}

function assertBlockRatios(layout, gaps, label) {
  const bySize = new Map();
  for (const size of ["mini", "small", "medium", "medium-vertical", "large"]) {
    const card = layout.cards.find((item) => item.size === size);
    assert.ok(card, `${label}: mixed fixture includes a ${size} widget`);
    bySize.set(size, card);
  }
  const mini = bySize.get("mini"), small = bySize.get("small"), medium = bySize.get("medium");
  const vertical = bySize.get("medium-vertical"), large = bySize.get("large");
  near(medium.width, 2 * small.width + gaps.column, `${label}: medium spans two small columns and their gap`, 2);
  near(vertical.width, small.width, `${label}: medium vertical shares the small width`, 2);
  near(large.width, medium.width, `${label}: large shares the medium width`, 2);
  near(small.height, 2 * mini.height + gaps.row, `${label}: two mini blocks and their gap equal one small block`, 2);
  near(medium.height, small.height, `${label}: medium and small use the same height`, 2);
  near(vertical.height, 2 * small.height + gaps.row, `${label}: medium vertical is two small blocks and their gap`, 2);
  near(large.height, 2 * small.height + gaps.row, `${label}: large is two small blocks and their gap`, 2);
  return { mini, small, medium, vertical, large };
}

async function readGridGaps(page) {
  return page.locator(".widget-grid").evaluate((grid) => {
    const style = getComputedStyle(grid);
    return {
      column: Number.parseFloat(style.columnGap),
      row: Number.parseFloat(style.rowGap),
      columns: style.gridTemplateColumns.trim().split(/\s+/).length,
    };
  });
}

await mkdir(screenshotDir, { recursive: true });
const launchOptions = { headless: true, args: ["--no-sandbox"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = process.env.BROWSER_CHANNEL ?? "chrome";
const browser = await playwright.chromium.launch(launchOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  await page.setContent(documentHtml, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const sizeSequence = ["mini", "small", "medium", "medium-vertical", "large"];
  const sizeLabel = { mini: "Mini", small: "Small", medium: "Medium horizontal", "medium-vertical": "Medium vertical", large: "Large" };
  let layout = await snapshotLayout(page);
  assert.ok(layout.workspaceWidth > 960, "wide fixture should exceed 60rem, got " + layout.workspaceWidth + "px");
  assertGridLayout(layout, "wide workspace");
  assert.equal(layout.cards.length, 18, "the browser fixture uses all 18 actual production widgets");
  assert.equal(new Set(layout.cards.map((card) => card.type)).size, 18, "each production widget type is represented");
  const gridDisplay = await page.locator(".widget-grid").evaluate((grid) => getComputedStyle(grid).display);
  assert.equal(gridDisplay, "grid", "production widget layout uses CSS grid");
  assert.ok((await readGridGaps(page)).columns >= 2, "wide workspace has at least two fluid columns");

  // Give every production type each canonical size in turn.
  const sizeGeometry = {};
  const originalOrder = layout.cards.map((card) => card.id);
  for (const size of sizeSequence) {
    await page.locator(".widget-grid").evaluate((grid, size) => grid.querySelectorAll(".widget-card").forEach((card) => { card.dataset.size = size; }), size);
    await settleLayout(page);
    layout = await snapshotLayout(page);
    assertGridLayout(layout, "all widget types at " + size);
    assert.deepEqual(layout.cards.map((card) => card.id), originalOrder, "testing " + size + " keeps every widget in the fixture");
    const reference = layout.cards[0];
    for (const card of layout.cards) {
      near(card.width, reference.width, card.type + " " + size + " width matches the shared footprint", 2);
      near(card.height, reference.height, card.type + " " + size + " height matches the shared footprint", 2);
    }
    sizeGeometry[size] = { width: reference.width, height: reference.height };
  }

  // A mixed set proves the five footprints coexist and pack without collision.
  await page.locator(".widget-grid").evaluate((grid, sizes) => grid.querySelectorAll(".widget-card").forEach((card, index) => { card.dataset.size = sizes[index % sizes.length]; }), sizeSequence);
  await settleLayout(page);
  layout = await snapshotLayout(page);
  assertGridLayout(layout, "mixed widget sizes");
  const initialMixedLayout = layout;
  const gaps = await readGridGaps(page);
  const mixedFootprints = assertBlockRatios(layout, gaps, "mixed widget sizes");
  for (const card of layout.cards) {
    near(card.width, sizeGeometry[card.size].width, card.type + " " + card.size + " preserves its measured width", 2);
    near(card.height, sizeGeometry[card.size].height, card.type + " " + card.size + " preserves its measured height", 2);
  }

  // Long content stays inside fixed card blocks and remains reachable by scrolling.
  await page.evaluate((copy) => {
    for (const card of document.querySelectorAll(".widget-card")) {
      const paragraph = document.createElement("p");
      paragraph.className = "fixture-overflow-copy";
      paragraph.textContent = copy;
      card.querySelector(".widget-body").append(paragraph);
    }
  }, longText);
  await settleLayout(page);
  let contentLayout = await snapshotLayout(page);
  assertGridLayout(contentLayout, "long content in fixed blocks");
  for (const card of contentLayout.cards) {
    near(card.height, sizeGeometry[card.size].height, card.id + " height stays fixed when content grows", 2);
    near(card.width, sizeGeometry[card.size].width, card.id + " width stays fixed when content grows", 2);
  }
  const overflowReport = await page.evaluate(() => [...document.querySelectorAll(".widget-card")].map((card) => {
    const frame = card.querySelector(".widget-frame");
    const body = card.querySelector(".widget-body");
    const copy = body.querySelector(".fixture-overflow-copy");
    const bounds = frame.getBoundingClientRect();
    frame.scrollTop = 0;
    const first = body.firstElementChild && body.firstElementChild.getBoundingClientRect();
    const header = card.querySelector(".widget-header").getBoundingClientRect();
    frame.scrollTop = frame.scrollHeight;
    const bottomBounds = frame.getBoundingClientRect();
    const trailing = copy.getBoundingClientRect();
    return {
      id: card.dataset.widgetId,
      frameOverflowY: getComputedStyle(frame).overflowY,
      frameScrollHeight: frame.scrollHeight,
      frameClientHeight: frame.clientHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyFlexGrow: getComputedStyle(body).flexGrow,
      bodyFlexShrink: getComputedStyle(body).flexShrink,
      headerReachable: header.top >= bounds.top - 2 && header.bottom <= bounds.bottom + 2,
      firstReachable: Boolean(first && first.bottom > bounds.top && first.top < bounds.bottom),
      lastReachable: trailing.bottom <= bottomBounds.bottom + 2 && trailing.bottom > bottomBounds.top,
    };
  }));
  for (const result of overflowReport) {
    assert.equal(result.frameOverflowY, "auto", result.id + " uses the shared widget frame as its scroll viewport");
    assert.ok(result.frameScrollHeight > result.frameClientHeight, result.id + " frame has real overflow in the long-content fixture");
    assert.equal(result.bodyOverflowY, "visible", result.id + " body does not create a nested scroll trap");
    assert.equal(result.bodyFlexGrow, "1", result.id + " body grows naturally inside the frame");
    assert.equal(result.bodyFlexShrink, "0", result.id + " body keeps its natural content height");
    assert.ok(result.headerReachable, result.id + " header remains reachable at the start of the frame");
    assert.ok(result.firstReachable, result.id + " leading content remains reachable");
    assert.ok(result.lastReachable, result.id + " trailing content remains reachable at the end of the shared frame");
  }

  // Board controls set the common block unit and gap. Per-widget overrides must
  // not alter a card's shared grid footprint.
  await page.locator(".widget-grid").evaluate((grid) => {
    grid.style.setProperty("--wa-min-width", "320px");
    grid.style.setProperty("--wa-min-height", "260px");
    grid.style.setProperty("--wa-gap", "22px");
  });
  await settleLayout(page);
  layout = await snapshotLayout(page);
  assertGridLayout(layout, "board appearance controls");
  const boardGaps = await readGridGaps(page);
  near(boardGaps.column, 22, "board horizontal gap setting applies to the grid");
  near(boardGaps.row, 22, "board vertical gap setting applies to the grid");
  const boardFootprints = assertBlockRatios(layout, boardGaps, "board appearance controls");
  near(boardFootprints.small.height, 260, "board minimum height is the small block height", 2);

  // Stress the smallest blocks with the largest supported appearance values.
  await page.locator(".widget-grid").evaluate((grid) => {
    grid.style.setProperty("--wa-min-height", "180px");
    grid.style.setProperty("--wa-gap", "32px");
    for (const card of grid.querySelectorAll(".widget-card")) {
      card.style.setProperty("--wa-padding", "28px");
      card.style.setProperty("--wa-icon-size", "40px");
      card.style.setProperty("--wa-title-size", "20px");
      card.style.setProperty("--wa-line-height", "1.8");
    }
  });
  await settleLayout(page);
  layout = await snapshotLayout(page);
  assertGridLayout(layout, "maximum content styling at 180px block height");
  const compactGaps = await readGridGaps(page);
  const compactFootprints = assertBlockRatios(layout, compactGaps, "maximum content styling");
  near(compactGaps.row, 32, "maximum gap setting applies to the row grid");
  near(compactFootprints.small.height, 180, "minimum board height remains the small block height", 2);
  const compactBodies = await page.evaluate(() => [...document.querySelectorAll(".widget-card")].map((card) => ({
    id: card.dataset.widgetId,
    size: card.dataset.size,
    height: card.querySelector(".widget-body").getBoundingClientRect().height,
  })));
  for (const body of compactBodies) {
    assert.ok(body.height > 0, body.id + " " + body.size + " keeps a visible body under maximum appearance styling");
  }
  const compactReachability = await page.evaluate(() => [...document.querySelectorAll(".widget-card")].map((card) => {
    const frame = card.querySelector(".widget-frame");
    const body = card.querySelector(".widget-body");
    const header = card.querySelector(".widget-header h2");
    frame.scrollTop = 0;
    const frameBounds = frame.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const menuButton = card.querySelector(".widget-header .menu-wrap > button");
    const menuButtonBounds = menuButton.getBoundingClientRect();
    const firstAtFrameStart = body.firstElementChild?.getBoundingClientRect();
    frame.scrollTop = Math.max(0, menuButtonBounds.top + menuButtonBounds.height / 2 - frameBounds.top - frame.clientHeight / 2);
    const alignedMenuButton = menuButton.getBoundingClientRect();
    const triggerCenter = alignedMenuButton.top + alignedMenuButton.height / 2;
    frame.scrollTop = Math.max(0, firstAtFrameStart.top - frameBounds.top - Math.max(0, (frame.clientHeight - Math.min(frame.clientHeight, firstAtFrameStart.height)) / 2));
    const alignedFirst = body.firstElementChild?.getBoundingClientRect();
    const firstReachable = Boolean(alignedFirst && alignedFirst.bottom > frameBounds.top && alignedFirst.top < frameBounds.bottom);
    frame.scrollTop = frame.scrollHeight;
    const endBounds = frame.getBoundingClientRect();
    const trailing = body.querySelector(".fixture-overflow-copy").getBoundingClientRect();
    const result = {
      id: card.dataset.widgetId,
      size: card.dataset.size,
      frameOverflowY: getComputedStyle(frame).overflowY,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyFlexGrow: getComputedStyle(body).flexGrow,
      bodyFlexShrink: getComputedStyle(body).flexShrink,
      titleWhiteSpace: getComputedStyle(header).whiteSpace,
      frameBounds: { top: frameBounds.top, bottom: frameBounds.bottom },
      titleBounds: { top: headerBounds.top, bottom: headerBounds.bottom },
      titleVisibleAtFrameStart: headerBounds.bottom > frameBounds.top && headerBounds.top < frameBounds.bottom,
      triggerCenterReachable: triggerCenter >= frameBounds.top && triggerCenter <= frameBounds.bottom,
      firstReachable,
      lastReachable: trailing.bottom <= endBounds.bottom + 2 && trailing.bottom > endBounds.top,
      frameScrollHeight: frame.scrollHeight,
      frameClientHeight: frame.clientHeight,
    };
    frame.scrollTop = 0;
    return result;
  }));
  for (const result of compactReachability) {
    assert.equal(result.frameOverflowY, "auto", result.id + " uses one shared frame viewport under maximum content styling");
    assert.equal(result.bodyOverflowY, "visible", result.id + " body does not become a nested scroll container");
    assert.equal(result.bodyFlexGrow, "1", result.id + " body grows naturally under maximum content styling");
    assert.equal(result.bodyFlexShrink, "0", result.id + " body retains its content height under maximum content styling");
    assert.equal(result.titleWhiteSpace, "nowrap", result.id + " title remains a single-line header");
    assert.ok(result.frameScrollHeight > result.frameClientHeight, result.id + " frame remains scrollable at maximum content styling");
    assert.ok(result.titleVisibleAtFrameStart, result.id + " title begins in the shared frame at maximum content styling: " + JSON.stringify(result));
    assert.ok(result.triggerCenterReachable, result.id + " menu trigger can be exposed by scrolling the shared frame");
    assert.ok(result.firstReachable, result.id + " leading content remains reachable under maximum content styling");
    assert.ok(result.lastReachable, result.id + " trailing content remains reachable under maximum content styling");
  }

  const timerBeforeOverride = layout.cards.find((card) => card.id === "timer");
  await page.locator('[data-widget-id="timer"]').evaluate((card) => {
    card.style.setProperty("--wa-min-width", "410px");
    card.style.setProperty("--wa-min-height", "390px");
    card.style.setProperty("--wa-gap", "37px");
  });
  await settleLayout(page);
  const perWidgetOverrideLayout = await snapshotLayout(page);
  assertGridLayout(perWidgetOverrideLayout, "per-widget appearance overrides");
  const timerAfterOverride = perWidgetOverrideLayout.cards.find((card) => card.id === "timer");
  near(timerAfterOverride.width, timerBeforeOverride.width, "per-widget minimum width cannot change its grid footprint", 2);
  near(timerAfterOverride.height, timerBeforeOverride.height, "per-widget minimum height cannot change its grid footprint", 2);
  const overrideGaps = await readGridGaps(page);
  near(overrideGaps.column, 32, "per-widget gap cannot change the board column gap");
  near(overrideGaps.row, 32, "per-widget gap cannot change the board row gap");
  await page.locator(".widget-grid").evaluate((grid) => {
    for (const card of grid.querySelectorAll(".widget-card")) {
      for (const property of ["--wa-padding", "--wa-icon-size", "--wa-title-size", "--wa-line-height"]) card.style.removeProperty(property);
    }
    for (const property of ["--wa-min-width", "--wa-min-height", "--wa-gap"]) grid.style.removeProperty(property);
  });

  // Reordering and repeated menu resizes keep mixed blocks in bounds and clear.
  const orderBeforeMove = (await snapshotLayout(page)).cards.map((card) => card.id);
  await page.locator('[data-widget-id="timer"] .widget-header .menu-wrap > button').click();
  await page.getByRole("button", { name: "Move later" }).click();
  await page.mouse.move(2, 2);
  layout = await snapshotLayout(page);
  assertGridLayout(layout, "after reorder");
  const reorderedIds = layout.cards.map((card) => card.id);
  assert.equal(reorderedIds.indexOf("timer"), orderBeforeMove.indexOf("timer") + 1, "Move later advances the selected widget in DOM order");
  const orderAfterMove = [...reorderedIds];
  const originalTimerSize = initialMixedLayout.cards.find((card) => card.id === "timer").size;
  for (const size of sizeSequence) {
    await page.locator('[data-widget-id="timer"] .widget-header .menu-wrap > button').click();
    await page.getByRole("button", { name: sizeLabel[size] + " widget" }).click();
    await page.mouse.move(2, 2);
    layout = await snapshotLayout(page);
    assertGridLayout(layout, "timer resized to " + size);
    assert.deepEqual(layout.cards.map((card) => card.id), orderAfterMove, "resizing to " + size + " preserves reordered DOM order");
  }
  await page.locator('[data-widget-id="timer"] .widget-header .menu-wrap > button').click();
  await page.getByRole("button", { name: sizeLabel[originalTimerSize] + " widget" }).click();
  await page.mouse.move(2, 2);
  layout = await snapshotLayout(page);
  assertGridLayout(layout, "restored timer size");

  // Sidebar collapse releases width and the block grid reflows without overlap.
  await page.setViewportSize({ width: 1160, height: 980 });
  layout = await snapshotLayout(page);
  assertGridLayout(layout, "expanded-sidebar workspace");
  const expandedSidebarColumns = (await readGridGaps(page)).columns;
  await page.locator(".sidebar-toggle").click();
  const collapsedLayout = await snapshotLayout(page);
  assert.ok(collapsedLayout.workspaceWidth > layout.workspaceWidth, "sidebar collapse releases content width");
  assertGridLayout(collapsedLayout, "sidebar-collapsed workspace");
  assert.ok((await readGridGaps(page)).columns >= expandedSidebarColumns, "released width preserves or adds grid columns");
  await page.locator("#app").evaluate((app) => app.classList.remove("sidebar-collapsed"));

  // Phone widths retain two fluid columns and all five footprints.
  const phoneMenus = [];
  const phoneBodyHeights = [];
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    layout = await snapshotLayout(page);
    assertGridLayout(layout, width + "px phone workspace");
    const phoneGaps = await readGridGaps(page);
    assert.ok(phoneGaps.columns >= 2, width + "px phone should keep at least two columns, got " + phoneGaps.columns);
    assert.ok(layout.grid.width <= layout.viewportWidth, width + "px phone board exceeds the viewport width: " + layout.grid.width + "px > " + layout.viewportWidth + "px");
    assert.ok(layout.scrollWidth <= layout.viewportWidth, width + "px phone page overflows horizontally: " + layout.scrollWidth + "px > " + layout.viewportWidth + "px");
    assertBlockRatios(layout, phoneGaps, width + "px phone footprints");
    const bodyReports = await page.evaluate(() => [...document.querySelectorAll(".widget-card")].map((card) => ({
      id: card.dataset.widgetId,
      size: card.dataset.size,
      height: card.querySelector(".widget-body").getBoundingClientRect().height,
      frameOverflowY: getComputedStyle(card.querySelector(".widget-frame")).overflowY,
      bodyOverflowY: getComputedStyle(card.querySelector(".widget-body")).overflowY,
    })));
    for (const body of bodyReports) {
      assert.ok(body.height > 0, body.id + " " + body.size + " body remains visible at " + width + "px");
      assert.equal(body.frameOverflowY, "auto", body.id + " has one usable scroll viewport at " + width + "px");
      assert.equal(body.bodyOverflowY, "visible", body.id + " has no nested scroll viewport at " + width + "px");
    }
    phoneBodyHeights.push({ width, bodies: bodyReports });

    const firstColumnId = await page.evaluate(() => {
      const grid = document.querySelector(".widget-grid").getBoundingClientRect();
      const card = [...document.querySelectorAll(".widget-card")].find((item) => Math.abs(item.getBoundingClientRect().left - grid.left) < 2);
      return card?.dataset.widgetId;
    });
    assert.ok(firstColumnId, width + "px phone fixture has a card at the first column edge");
    const trigger = page.locator('[data-widget-id="' + firstColumnId + '"] .widget-header .menu-wrap > button');
    await trigger.click();
    const phoneMenu = await page.locator('[data-widget-id="' + firstColumnId + '"] .widget-menu').evaluate((menu) => {
      const rect = menu.getBoundingClientRect();
      const options = [...menu.querySelectorAll("[data-size]")].map((button) => {
        const buttonRect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2)?.closest("button");
        return { value: button.dataset.size, hitValue: hit?.dataset.size };
      });
      return { left: rect.left, right: rect.right, viewportWidth: innerWidth, options };
    });
    assert.ok(phoneMenu.left >= 0 && phoneMenu.right <= phoneMenu.viewportWidth, "first-column menu stays inside the " + width + "px phone viewport: " + JSON.stringify(phoneMenu));
    assert.deepEqual(phoneMenu.options.map((option) => option.hitValue), sizeSequence, width + "px first-column popup exposes five hit-testable size options");
    phoneMenus.push({ width, ...phoneMenu });
    await trigger.click();

    await page.evaluate(() => {
      document.querySelectorAll(".widget-frame").forEach((frame) => { frame.scrollTop = 0; });
      window.scrollTo(0, 0);
    });
    if (width === 320) await page.screenshot({ path: resolve(screenshotDir, "phone.png"), fullPage: true });
  }
  // Desktop menu stays in the viewport and receives pointer hit-testing.
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopMenuWidgetId = await page.evaluate(() => {
    const grid = document.querySelector(".widget-grid").getBoundingClientRect();
    return [...document.querySelectorAll(".widget-card")].find((card) => Math.abs(card.getBoundingClientRect().left - grid.left) < 2)?.dataset.widgetId;
  });
  assert.ok(desktopMenuWidgetId, "desktop fixture has a first-column widget for popup testing");
  const desktopTrigger = page.locator('[data-widget-id="' + desktopMenuWidgetId + '"] .widget-header .menu-wrap > button');
  const desktopMenu = page.locator('[data-widget-id="' + desktopMenuWidgetId + '"] .widget-menu');
  await desktopTrigger.scrollIntoViewIfNeeded();
  await desktopTrigger.click();
  await desktopMenu.waitFor({ state: "visible" });
  await settleLayout(page);
  const desktopPopup = await desktopMenu.evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const options = [...menu.querySelectorAll("[data-size]")].map((button) => {
      const buttonRect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2)?.closest("button");
      return { value: button.dataset.size, hitValue: hit?.dataset.size };
    });
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, options };
  });
  assert.ok(desktopPopup.left >= 0 && desktopPopup.right <= desktopPopup.viewportWidth, "first-column popup stays inside the desktop viewport horizontally: " + JSON.stringify(desktopPopup));
  assert.ok(desktopPopup.top >= 0 && desktopPopup.bottom <= desktopPopup.viewportHeight, "first-column popup stays inside the desktop viewport vertically: " + JSON.stringify(desktopPopup));
  assert.deepEqual(desktopPopup.options.map((option) => option.value), sizeSequence, "first-column popup presents all five sizes in canonical order");
  assert.deepEqual(desktopPopup.options.map((option) => option.hitValue), sizeSequence, "all five size options receive pointer hit-testing above sibling cards");

  const sizeButtonHitTests = [];
  for (const size of sizeSequence) {
    if (!(await desktopMenu.count())) {
      await desktopTrigger.click();
      await desktopMenu.waitFor({ state: "visible" });
    }
    await desktopMenu.locator('[data-size="' + size + '"]').click();
    assert.equal(await page.locator('[data-widget-id="' + desktopMenuWidgetId + '"]').getAttribute("data-size"), size, "real size option click applies " + size);
    sizeButtonHitTests.push(size);
    await page.mouse.move(2, 2);
  }
  const originalDesktopSize = initialMixedLayout.cards.find((card) => card.id === desktopMenuWidgetId).size;
  await desktopTrigger.click();
  await desktopMenu.waitFor({ state: "visible" });
  await desktopMenu.locator('[data-size="' + originalDesktopSize + '"]').click();
  assert.equal(await page.locator('[data-widget-id="' + desktopMenuWidgetId + '"]').getAttribute("data-size"), originalDesktopSize, "restore the first-column widget's initial size after menu hit tests");
  await desktopTrigger.click();
  await desktopMenu.waitFor({ state: "visible" });
  await settleLayout(page);
  const readMenu = () => page.locator('[data-widget-id="' + desktopMenuWidgetId + '"] .widget-menu').evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const button = menu.querySelector('[data-size="large"]');
    const buttonRect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2)?.closest("button");
    return { menuLeft: rect.left, menuRight: rect.right, menuTop: rect.top, menuBottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, hitLabel: hit?.getAttribute("aria-label"), hitText: hit?.textContent };
  });
  const menuBeforeScroll = await readMenu();
  await page.evaluate(() => window.scrollBy({ top: 40, behavior: "instant" }));
  const menuAfterScroll = await readMenu();
  const menuState = { ...menuAfterScroll, before: menuBeforeScroll };
  assert.ok(menuState.menuLeft >= 0 && menuState.menuRight <= menuState.viewportWidth, "widget menu remains horizontally in viewport: " + JSON.stringify(menuState));
  assert.ok(menuState.menuTop >= 0 && menuState.menuBottom <= menuState.viewportHeight, "widget menu remains vertically in viewport after body scroll: " + JSON.stringify(menuState));
  assert.ok(menuState.hitLabel === "Large widget" || menuState.hitText.includes("Large"), "widget menu receives pointer hit-testing above sibling cards: " + JSON.stringify(menuState));
  near(menuState.menuTop, menuBeforeScroll.menuTop - 40, "open menu remains anchored while the page scrolls", 2);
  await desktopTrigger.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.querySelectorAll(".widget-frame").forEach((frame) => { frame.scrollTop = 0; }));
  await page.screenshot({ path: resolve(screenshotDir, "desktop.png"), fullPage: true });

  console.log(JSON.stringify({
    result: "PASS",
    fixture: "actual app/globals.css, app/reference-ui.css, app/widget-appearance.css, app/widget-block-layout.css, and all 18 production widget types",
    screenshots: [".vinext/verify-widget-layout/desktop.png", ".vinext/verify-widget-layout/phone.png"],
    sizeGeometry,
    mixedFootprints,
    overflowReport,
    compactReachability,
    phoneBodyHeights,
    phoneMenus,
    desktopPopup,
    sizeButtonHitTests,
    menuState,
    allWidgetSnapshots: await page.evaluate(() => [...document.querySelectorAll(".widget-card")].map((card) => {
      const rect = card.getBoundingClientRect();
      return { id: card.dataset.widgetId, type: [...card.classList].find((name) => name.startsWith("widget-") && name !== "widget-card"), size: card.dataset.size, width: rect.width, height: rect.height, top: rect.top };
    })),
    finalLayout: (await snapshotLayout(page)).cards,
  }, null, 2));
} finally {
  await browser.close();
}
