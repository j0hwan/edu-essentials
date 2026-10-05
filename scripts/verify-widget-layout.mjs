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
const [globalCss, referenceCss, playwright] = await Promise.all([
  readFile(resolve(repoRoot, "app/globals.css"), "utf8"),
  readFile(resolve(repoRoot, "app/reference-ui.css"), "utf8"),
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

// This opt-in browser fixture uses the real styles and the same card class/data-size
// contract as Workspace. Existing settings-ui tests cover the React control/state path.
const documentHtml = `<!doctype html><html data-theme="dark" style='--font-geist-sans:"Segoe UI";--font-geist-mono:Consolas,monospace'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
${globalCss.replace(/^@import[^;]+;\s*/m, "")}
${referenceCss}
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
  menu.innerHTML = '<p>Widget size</p><div class="size-options"><button data-size="small" aria-label="small widget">S</button><button data-size="medium" aria-label="medium widget">M</button><button data-size="large" aria-label="large widget">L</button></div><button>Move earlier</button><button>Move later</button>';
  menu.querySelectorAll("[data-size]").forEach((button) => button.addEventListener("click", () => { card.dataset.size = button.dataset.size; menu.remove(); }));
  card.querySelector(".menu-wrap").append(menu);
}));
</script></body></html>`;

function near(actual, expected, message, tolerance = 1.5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} ± ${tolerance}px, received ${actual}px`);
}

async function snapshotLayout(page) {
  return page.evaluate(() => {
    const grid = document.querySelector(".widget-grid").getBoundingClientRect();
    const cards = [...document.querySelectorAll(".widget-card")].map((card) => {
      const rect = card.getBoundingClientRect();
      return { id: card.dataset.widgetId, size: card.dataset.size, x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    });
    return { grid: { x: grid.x, y: grid.y, width: grid.width, right: grid.right }, cards, workspaceWidth: document.querySelector(".main-content").clientWidth, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
}

function assertRows(layout, label) {
  const rows = [];
  for (const card of layout.cards) {
    let row = rows.find((candidate) => Math.abs(candidate.y - card.y) <= 1.5);
    if (!row) { row = { y: card.y, cards: [] }; rows.push(row); }
    row.cards.push(card);
  }
  rows.sort((a, b) => a.y - b.y);
  const visualOrder = rows.flatMap((row) => row.cards.sort((a, b) => a.x - b.x).map((card) => card.id));
  assert.deepEqual(visualOrder, layout.cards.map((card) => card.id), `${label}: visual order must match saved/DOM order`);
  for (const [index, row] of rows.entries()) {
    row.cards.sort((a, b) => a.x - b.x);
    for (const card of row.cards) near(card.height, row.cards[0].height, `${label} row ${index + 1} card heights`);
    near(row.cards[0].x, layout.grid.x, `${label} row ${index + 1} starts at grid edge`);
    near(row.cards.at(-1).right, layout.grid.right, `${label} row ${index + 1} fills grid width`);
    for (let i = 1; i < row.cards.length; i++) {
      assert.ok(row.cards[i].x >= row.cards[i - 1].right, `${label} row ${index + 1} cards overlap`);
    }
  }
  return rows;
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
  await page.evaluate((copy) => {
    for (const id of ["quote", "spacer"]) {
      const paragraph = document.createElement("p");
      paragraph.className = "fixture-overflow-copy";
      paragraph.textContent = copy;
      document.querySelector(`[data-widget-id="${id}"] .widget-body`).append(paragraph);
    }
  }, longText);

  // Wide container: small cards occupy quarter rows; medium/large cards use half rows.
  let layout = await snapshotLayout(page);
  assert.ok(layout.workspaceWidth > 960, `wide fixture should exceed 60rem, got ${layout.workspaceWidth}px`);
  let rows = assertRows(layout, "wide workspace");
  const fourSmallRow = rows.find((row) => row.cards.some((card) => card.id === "notes"));
  assert.equal(fourSmallRow.cards.length, 4, "four fitting small cards should share one wide row");
  for (const card of fourSmallRow.cards) near(card.width, fourSmallRow.cards[0].width, "same-size small cards have equal width");
  const mixedRow = rows.find((row) => row.cards.some((card) => card.id === "overview"));
  assert.equal(mixedRow.cards.length, 3, "large plus two small cards should fill a wide mixed row");
  near(mixedRow.cards.find((card) => card.id === "overview").width, 2 * mixedRow.cards.find((card) => card.id === "calendar").width, "large cards keep twice the preferred width of small cards", 20);

  const beforeShortNote = await page.locator('[data-widget-id="notes"]').evaluate((card) => card.getBoundingClientRect().height);
  await page.locator('[data-widget-id="notes"] textarea').fill("Short note");
  const afterShortNote = await page.locator('[data-widget-id="notes"]').evaluate((card) => card.getBoundingClientRect().height);
  near(afterShortNote, beforeShortNote, "textarea content does not resize its row");
  await page.locator('[data-widget-id="notes"] textarea').fill(longText);
  const noteOverflow = await page.locator('[data-widget-id="notes"] textarea').evaluate((area) => ({ scrollHeight: area.scrollHeight, clientHeight: area.clientHeight }));
  const afterLongNote = await page.locator('[data-widget-id="notes"]').evaluate((card) => card.getBoundingClientRect().height);
  near(afterLongNote, beforeShortNote, "long notes do not resize their row");
  assert.ok(noteOverflow.scrollHeight > noteOverflow.clientHeight, "long note fixture should exercise textarea overflow");

  const scrollReachability = await page.evaluate(() => ["quote", "spacer"].map((id) => {
    const body = document.querySelector(`[data-widget-id="${id}"] .widget-body`);
    const copy = body.querySelector(".fixture-overflow-copy");
    const before = { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowY: getComputedStyle(body).overflowY };
    const bounds = body.getBoundingClientRect();
    body.scrollTop = 0;
    const firstRect = copy.getBoundingClientRect();
    const firstY = Math.max(bounds.top + 2, Math.min(firstRect.top + 6, bounds.bottom - 2));
    const firstTarget = document.elementFromPoint(firstRect.x + firstRect.width / 2, firstY);
    const visibleTop = firstRect.top >= bounds.top - 1 && firstRect.top < bounds.bottom && copy.contains(firstTarget);
    body.scrollTop = body.scrollHeight;
    const bodyRect = body.getBoundingClientRect(), copyRect = copy.getBoundingClientRect();
    const lastY = Math.max(bodyRect.top + 2, Math.min(copyRect.bottom - 4, bodyRect.bottom - 2));
    const lastTarget = document.elementFromPoint(copyRect.x + copyRect.width / 2, lastY);
    return { id, ...before, scrollTop: body.scrollTop, visibleTop, visibleBottom: copyRect.bottom <= bodyRect.bottom + 1 && copy.contains(lastTarget) };
  }));
  for (const result of scrollReachability) {
    assert.ok(result.scrollHeight > result.clientHeight, `${result.id} body should contain overflow`);
    assert.ok(result.scrollTop > 0, `${result.id} body should be scrollable`);
    assert.ok(result.visibleTop, `${result.id} leading content should be hit-testable at the top`);
    assert.ok(result.visibleBottom, `${result.id} trailing content should be reachable by scrolling to the bottom`);
  }
  const populatedWidgetReachability = [];
  for (const [id, selector] of [
    ["upcoming", ".compact-assignment"],
    ["links", ".class-link-grid > button"],
    ["widget-13", ".exam-list > button"],
  ]) {
    await page.locator(`[data-widget-id="${id}"]`).scrollIntoViewIfNeeded();
    const result = await page.locator(`[data-widget-id="${id}"] .widget-body`).evaluate((body, selector) => {
      document.documentElement.style.scrollBehavior = "auto";
      const entries = [...body.querySelectorAll(selector)];
      body.scrollTop = 0;
      const first = entries[0]?.getBoundingClientRect();
      const bounds = body.getBoundingClientRect();
      const firstY = first && Math.max(bounds.top + 2, Math.min(first.bottom - 2, bounds.bottom - 2));
      const firstTarget = first && document.elementFromPoint(first.x + first.width / 2, firstY);
      const firstHit = firstTarget?.closest("button") === entries[0] && first.bottom > bounds.top && first.top < bounds.bottom;
      body.scrollTop = body.scrollHeight;
      const bottomBounds = body.getBoundingClientRect();
      const last = entries.at(-1)?.getBoundingClientRect();
      const lastY = last && Math.max(bottomBounds.top + 2, Math.min(last.bottom - 2, bottomBounds.bottom - 2));
      const lastHit = last && document.elementFromPoint(last.x + last.width / 2, lastY)?.closest("button") === entries.at(-1) && last.bottom > bottomBounds.top && last.top < bottomBounds.bottom;
      return { entries: entries.length, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowY: getComputedStyle(body).overflowY, firstReachable: Boolean(firstHit), lastReachable: Boolean(lastHit), scrollTop: body.scrollTop, firstRect: first && { top: first.top, bottom: first.bottom }, lastRect: last && { top: last.top, bottom: last.bottom }, bodyRect: { top: bottomBounds.top, bottom: bottomBounds.bottom } };
    }, selector);
    populatedWidgetReachability.push({ id, ...result });
  }
  for (const result of populatedWidgetReachability) {
    assert.ok(result.entries >= 3, `${result.id} should render multiple populated fixture items`);
    assert.ok(result.scrollHeight > result.clientHeight, `${result.id} should exercise card body scrolling`);
    assert.ok(result.firstReachable, `${result.id} first item should be reachable at scrollTop 0: ${JSON.stringify(result)}`);
    assert.ok(result.lastReachable, `${result.id} last item should be hit-testable after scrolling to the bottom: ${JSON.stringify(result)}`);
  }

  // Repeated size changes use the same data-size DOM contract as the real controls.
  const originalOrder = layout.cards.map((card) => card.id);
  for (const size of ["medium", "large", "small", "large", "medium"]) {
    await page.locator('[data-widget-id="timer"] .widget-header .menu-wrap > button').click();
    await page.getByRole("button", { name: `${size} widget` }).click();
    const current = await snapshotLayout(page);
    assertRows(current, `after timer resize to ${size}`);
    assert.deepEqual(current.cards.map((card) => card.id), originalOrder, "resizing preserves DOM order");
  }
  await page.locator('[data-widget-id="timer"] .widget-header .menu-wrap > button').click();
  await page.getByRole("button", { name: "small widget" }).click();
  layout = await snapshotLayout(page);
  assertRows(layout, "restored default sizes");

  // At 1160px the expanded sidebar leaves a sub-60rem workspace; collapsing it
  // crosses the container breakpoint while the viewport remains unchanged.
  await page.setViewportSize({ width: 1160, height: 980 });
  layout = await snapshotLayout(page);
  assert.ok(layout.workspaceWidth <= 960, `expanded workspace should be at or below 60rem, got ${layout.workspaceWidth}px`);
  rows = assertRows(layout, "two-column workspace");
  const notesWidthNarrow = layout.cards.find((card) => card.id === "notes").width;
  const narrowGap = layout.cards[1].x - layout.cards[0].right;
  near(notesWidthNarrow, (layout.grid.width - narrowGap) / 2, "small cards use half the two-column workspace", 3);
  await page.locator(".sidebar-toggle").click();
  const collapsedLayout = await snapshotLayout(page);
  assert.ok(collapsedLayout.workspaceWidth > layout.workspaceWidth, "sidebar collapse releases content width");
  assert.ok(collapsedLayout.workspaceWidth > 960, `collapsed workspace should cross 60rem, got ${collapsedLayout.workspaceWidth}px`);
  rows = assertRows(collapsedLayout, "sidebar-collapsed wide workspace");
  const wideGap = collapsedLayout.cards[1].x - collapsedLayout.cards[0].right;
  near(collapsedLayout.cards.find((card) => card.id === "notes").width, (collapsedLayout.grid.width - 3 * wideGap) / 4, "small cards return to quarter width after sidebar collapse", 3);
  await page.locator("#app").evaluate((app) => app.classList.remove("sidebar-collapsed"));

  // Phone: container query makes every tier full width, with no page overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  layout = await snapshotLayout(page);
  assert.ok(layout.workspaceWidth <= 608, `phone workspace should be below 38rem, got ${layout.workspaceWidth}px`);
  rows = assertRows(layout, "phone workspace");
  for (const card of layout.cards) near(card.width, layout.grid.width, `phone ${card.id} uses full width`, 1.5);
  assert.ok(layout.scrollWidth <= layout.viewportWidth, `phone page overflows horizontally: ${layout.scrollWidth}px > ${layout.viewportWidth}px`);

  await page.evaluate(() => document.querySelectorAll(".widget-body").forEach((body) => { body.scrollTop = 0; }));
  await page.screenshot({ path: resolve(screenshotDir, "phone.png"), fullPage: true });

  // Desktop menu: scroll it into view and ensure its actual size button receives hit testing.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-widget-id="upcoming"] .widget-header .menu-wrap > button').scrollIntoViewIfNeeded();
  await page.locator('[data-widget-id="upcoming"] .widget-header .menu-wrap > button').click();
  await page.locator('[data-widget-id="upcoming"] .widget-menu [data-size="large"]').scrollIntoViewIfNeeded();
  const readMenu = () => page.locator('[data-widget-id="upcoming"] .widget-menu').evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const button = menu.querySelector('[data-size="large"]');
    const buttonRect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2);
    return { menuTop: rect.top, menuBottom: rect.bottom, viewportHeight: innerHeight, hitLabel: hit?.getAttribute("aria-label"), hitText: hit?.textContent };
  });
  const menuBeforeScroll = await readMenu();
  await page.evaluate(() => window.scrollBy({ top: 40, behavior: "instant" }));
  const menuAfterScroll = await readMenu();
  const menuState = { ...menuAfterScroll, before: menuBeforeScroll };
  assert.ok(menuState.menuTop >= 0 && menuState.menuBottom <= menuState.viewportHeight, `widget menu should remain in viewport after body scroll: ${JSON.stringify(menuState)}`);
  assert.ok(menuState.hitLabel === "large widget" || menuState.hitText === "L", `widget menu should receive pointer hit-testing above sibling cards: ${JSON.stringify(menuState)}`);
  near(menuState.menuTop, menuBeforeScroll.menuTop - 40, "open menu remains anchored while the page scrolls", 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.querySelectorAll(".widget-body").forEach((body) => { body.scrollTop = 0; }));
  await page.screenshot({ path: resolve(screenshotDir, "desktop.png"), fullPage: true });

  console.log(JSON.stringify({
    result: "PASS",
    fixture: "actual app/globals.css and app/reference-ui.css with Workspace-matching widget class/data-size markup",
    screenshots: [".vinext/verify-widget-layout/desktop.png", ".vinext/verify-widget-layout/phone.png"],
    noteOverflow,
    scrollReachability,
    populatedWidgetReachability,
    menuState,
    allWidgetSnapshots: await page.evaluate(() => [...document.querySelectorAll(".widget-card")].map((card) => {
      const rect = card.getBoundingClientRect();
      return { id: card.dataset.widgetId, type: [...card.classList].find((name) => name.startsWith("widget-") && name !== "widget-card"), size: card.dataset.size, width: rect.width, height: rect.height, top: rect.top };
    })),
    wideRows: assertRows(await page.evaluate(() => {
      const grid = document.querySelector(".widget-grid").getBoundingClientRect();
      const cards = [...document.querySelectorAll(".widget-card")].map((card) => { const r = card.getBoundingClientRect(); return { id: card.dataset.widgetId, size: card.dataset.size, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
      return { grid: { x: grid.x, y: grid.y, width: grid.width, right: grid.right }, cards, workspaceWidth: document.querySelector(".main-content").clientWidth, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    }), "final desktop screenshot").map((row) => row.cards.map((card) => card.id)),
  }, null, 2));
} finally {
  await browser.close();
}
