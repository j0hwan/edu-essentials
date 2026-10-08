import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-calendar-layout");
const [globalCss, referenceCss, calendarCss, playwright] = await Promise.all([
  readFile(resolve(repoRoot, "app/globals.css"), "utf8"),
  readFile(resolve(repoRoot, "app/reference-ui.css"), "utf8"),
  readFile(resolve(repoRoot, "app/calendar.css"), "utf8"),
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

const today = "2026-10-07";
const longTitle = "Fictional seminar portfolio: a deliberately long, descriptive title for checking how calendar details wrap without widening the page. ".repeat(3);
const courses = [{
  id: "fictional-course",
  code: "LIT 240",
  name: "Fictional long-form seminar in literary archives and source interpretation",
  color: "#55b8ff",
  room: "Example Hall",
}];
const assignments = Array.from({ length: 16 }, (_, index) => ({
  id: `fictional-deadline-${index + 1}`,
  title: `${longTitle}Part ${index + 1}`,
  courseId: "fictional-course",
  dateKey: today,
  dueTime: `${String(8 + index % 12).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
  status: "later",
}));
const events = Array.from({ length: 5 }, (_, index) => ({
  id: `fictional-event-${index + 1}`,
  dateKey: `2026-10-${String(8 + index).padStart(2, "0")}`,
  title: `Fictional study event ${index + 1}: ${longTitle}`,
  courseId: "fictional-course",
  time: `${String(10 + index).padStart(2, "0")}:00`,
  durationMinutes: 60,
  type: "Study",
}));
const details = {
  "fictional-course": {
    meetings: [{ id: "fictional-meeting", days: [3], from: "2026-10-01", until: "2026-12-31", start: "14:00", end: "15:15", location: "Example Hall, Room 204" }],
  },
};

async function renderCalendarMarkup() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://calendar-layout.example.invalid/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  for (const name of ["HTMLElement", "MouseEvent"]) globalThis[name] = dom.window[name];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { clientModule } = await import("../tests/helpers/client-modules.mjs");
  const [{ createElement, act }, { createRoot }, { default: AcademicCalendar }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import(await clientModule("app/academic-calendar.tsx")),
  ]);
  const props = {
    courses, assignments, events, details, today, monday: true,
    timezone: "America/Argentina/Buenos_Aires", filter: "all",
    onFilter() {}, onAssignment() {}, onEvent() {}, onCourse() {}, onAdd() {},
  };
  const rootNode = document.getElementById("root");
  const root = createRoot(rootNode);
  await act(async () => root.render(createElement(AcademicCalendar, props)));
  const output = { visible: {}, hidden: {}, empty: {} };
  const clickLabel = async (label) => {
    const button = [...rootNode.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent.trim() === label);
    assert.ok(button, `actual AcademicCalendar markup contains ${label}`);
    await act(async () => button.click());
  };
  for (const view of ["week", "month", "day"]) {
    if (view !== "week") await clickLabel(view[0].toUpperCase() + view.slice(1));
    output.visible[view] = rootNode.innerHTML;
    await clickLabel("Hide day details");
    output.hidden[view] = rootNode.innerHTML;
    await clickLabel("Show day details");
  }
  await clickLabel("Week");
  await act(async () => root.render(createElement(AcademicCalendar, {
    ...props, courses: [], assignments: [], events: [], details: {},
  })));
  for (const view of ["week", "month", "day"]) {
    if (view !== "week") await clickLabel(view[0].toUpperCase() + view.slice(1));
    output.empty[view] = rootNode.innerHTML;
  }
  await clickLabel("Week");
  await act(async () => root.render(createElement(AcademicCalendar, props)));
  await clickLabel("Filter calendar items");
  output.filterOpenWeek = rootNode.innerHTML;
  await act(async () => root.unmount());
  dom.window.close();
  return output;
}

const markup = await renderCalendarMarkup();
const removedCalendarMarkup = /class="(?:[^"]*\s)?planner-(?:date-control|zone|details-close|footnote)(?:\s|")|Go to date|Close day details|Los Angeles|Buenos Aires|A little room to breathe\.|Select a day for details/i;
for (const view of ["week", "month", "day"]) {
  assert.match(markup.visible[view], /planner-toolbar/, `${view} fixture comes from AcademicCalendar`);
  assert.match(markup.visible[view], /planner-details/, `${view} fixture includes the production day details`);
  assert.doesNotMatch(markup.hidden[view], /class="planner-details"/, `${view} hidden fixture exercises the production no-details state`);
  assert.doesNotMatch(markup.visible[view], removedCalendarMarkup, `${view} fixture omits removed controls and helper copy`);
  assert.match(markup.empty[view], /Nothing scheduled\./, `${view} empty fixture includes the actual day-empty state`);
  assert.doesNotMatch(markup.empty[view], removedCalendarMarkup, `${view} empty fixture omits removed controls and helper copy`);
}
assert.match(markup.filterOpenWeek, /planner-filter-popover/, "filter popover fixture comes from the actual open Calendar state");

const css = `${globalCss.replace(/^@import[^;]+;\s*/m, "")}\n${referenceCss}\n${calendarCss}`;
function shellDocument(calendarMarkup) {
  return `<!doctype html><html data-theme="dark" data-motion="reduced"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --font-geist-sans: Arial; }${css}</style></head><body>
    <div id="app" class="app-shell reference-ui">
      <aside class="sidebar"><div class="brand-row"><div class="brand-mark">E</div><div class="brand-copy"><strong>EduEssentials</strong><span>Fictional workspace</span></div><button class="sidebar-toggle" aria-label="Collapse sidebar">≡</button></div><nav class="main-nav"><a class="nav-item active"><span>Calendar</span></a></nav><div class="sidebar-bottom"><div class="profile-card"><span class="avatar">F</span><span><strong>Fictional profile</strong><small>example.invalid</small></span></div></div></aside>
      <main class="main-content">${calendarMarkup}</main>
    </div>
    <script>
      (() => {
      document.querySelector(".sidebar-toggle").addEventListener("click", () => {
        const app = document.querySelector("#app");
        const collapsed = app.classList.toggle("sidebar-collapsed");
        document.querySelector(".sidebar-toggle").setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      });
      document.querySelectorAll(".planner-toolbar button[aria-label='Hide day details'], .planner-toolbar button[aria-label='Show day details']").forEach((trigger) => trigger.addEventListener("click", () => {
        const layout = document.querySelector(".planner-layout");
        const current = layout.querySelector(".planner-details");
        const control = document.querySelector(".planner-toolbar button[aria-controls='calendar-day-details']");
        if (current) { current.remove(); layout.classList.remove("has-details"); control?.setAttribute("aria-label", "Show day details"); }
        else { location.reload(); }
      }));
      // Static markup cannot retain the component's browser layout effect.
      // Re-run its anchor calculation for this static CSS fixture.
      // Runtime React effects require a separate live component check.
      const filterAnchor = document.querySelector(".planner-toolbar button[aria-label='Filter calendar items']");
      const filterPopover = document.querySelector(".planner-filter-popover");
      const controlsRegion = document.querySelector(".planner-toolbar-scroll");
      const positionFilter = () => {
        if (!filterAnchor || !filterPopover) return;
        const anchorRect = filterAnchor.getBoundingClientRect();
        const toolbarRect = document.querySelector(".planner-toolbar").getBoundingClientRect();
        const popoverRect = filterPopover.getBoundingClientRect();
        const width = popoverRect.width || 210;
        const height = popoverRect.height || 220;
        filterPopover.style.left = Math.max(8, Math.min(anchorRect.left, document.documentElement.clientWidth - width - 8)) - toolbarRect.left + "px";
        filterPopover.style.top = Math.max(8, Math.min(anchorRect.bottom + 8, document.documentElement.clientHeight - height - 8)) - toolbarRect.top + "px";
      };
      if (filterPopover) {
        positionFilter();
        window.addEventListener("resize", positionFilter);
        window.addEventListener("scroll", positionFilter, true);
        controlsRegion?.addEventListener("scroll", positionFilter);
        if (typeof ResizeObserver !== "undefined") {
          const observer = new ResizeObserver(positionFilter);
          if (controlsRegion) observer.observe(controlsRegion);
          observer.observe(filterAnchor);
          observer.observe(filterPopover);
        }
      }
      })();
    </script>
  </body></html>`;
}

const browserPath = process.env.CHROME_EXECUTABLE;
const browser = await playwright.chromium.launch({
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox", "--disable-features=OverlayScrollbar"],
  ...(browserPath ? { executablePath: browserPath } : { channel: process.env.BROWSER_CHANNEL ?? "chrome" }),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await mkdir(screenshotDir, { recursive: true });
const failures = [];
const reports = [];
page.on("pageerror", (error) => failures.push(`Browser fixture error: ${error.message}`));
const near = (actual, expected, tolerance = 2) => Math.abs(actual - expected) <= tolerance;
const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

async function inspect(label, { desktop = true, requireDetails = true, screenshot } = {}) {
  await settle();
  const metrics = await page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
    };
    const calendar = document.querySelector(".planner-calendar");
    const details = document.querySelector(".planner-details");
    const toolbar = document.querySelector(".planner-toolbar");
    const controlsRegion = document.querySelector(".planner-toolbar-scroll");
    const navigation = document.querySelector(".planner-navigation");
    const actions = document.querySelector(".planner-actions");
    const view = document.querySelector(".planner-view-toggle [aria-pressed='true']")?.textContent.trim().toLowerCase();
    const columns = view === "month"
      ? [...document.querySelectorAll(".planner-weekdays > span")]
      : view === "week" ? [...document.querySelectorAll(".planner-time-date")] : [...document.querySelectorAll(".planner-time-date")];
    const colRects = columns.map(rect);
    const calendarRect = rect(calendar);
    const layoutRect = rect(document.querySelector(".planner-layout"));
    const toolbarRect = rect(toolbar);
    const navigationRect = rect(navigation);
    const actionsRect = rect(actions);
    const visibleDays = view === "month"
      ? [...document.querySelectorAll(".planner-month-day")].slice(0, 7).map((day) => day.getAttribute("aria-label"))
      : [...document.querySelectorAll(".planner-time-date")].map((day) => day.getAttribute("aria-label"));
    const allToolbarControls = [...document.querySelectorAll(".planner-navigation > *, .planner-actions > *")].map(rect);
    const controlLeft = allToolbarControls.length ? Math.min(...allToolbarControls.map((item) => item.x)) : 0;
    const controlRight = allToolbarControls.length ? Math.max(...allToolbarControls.map((item) => item.right)) : 0;
    const documentOverflowElements = [...document.body.querySelectorAll("*")].flatMap((element) => {
      if (element.closest(".planner-calendar, .planner-toolbar-scroll")) return [];
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.right <= innerWidth + 1) return [];
      return [{ tag: element.tagName.toLowerCase(), className: String(element.className?.baseVal ?? element.className ?? ""), right: Math.round(bounds.right), overflowX: getComputedStyle(element).overflowX }];
    });
    return {
      view, viewportWidth: innerWidth, documentScrollWidth: document.documentElement.scrollWidth,
      documentOverflowElements,
      toolbar: toolbarRect, toolbarClientWidth: controlsRegion?.clientWidth ?? 0, toolbarScrollWidth: controlsRegion?.scrollWidth ?? 0,
      toolbarOverflowX: controlsRegion ? getComputedStyle(controlsRegion).overflowX : "missing",
      navigation: navigationRect, actions: actionsRect,
      naturalToolbarWidth: navigationRect && actionsRect ? navigationRect.width + actionsRect.width + 10 : 0,
      navigationWidth: navigationRect?.width ?? 0, actionsWidth: actionsRect?.width ?? 0,
      toolbarOuterWidth: toolbarRect?.width ?? 0, toolbarControlLeft: controlLeft, toolbarControlRight: controlRight,
      mainContentWidth: document.querySelector(".main-content")?.clientWidth ?? 0,
      navigationActionsSameRow: !!navigationRect && !!actionsRect && Math.abs(navigationRect.y - actionsRect.y) <= 2,
      calendar: calendarRect, calendarClientWidth: calendar?.clientWidth ?? 0, calendarScrollWidth: calendar?.scrollWidth ?? 0,
      calendarOverflowX: calendar ? getComputedStyle(calendar).overflowX : "missing",
      calendarHasDetails: !!details, details: rect(details), layout: layoutRect,
      columns: colRects, visibleDays,
      firstColumnWidth: colRects[0]?.width ?? 0,
      longContentFitsDetails: details ? details.scrollWidth <= details.clientWidth + 1 : true,
    };
  });
  metrics.label = label;
  reports.push(metrics);
  const fail = (condition, message) => { if (!condition) failures.push(`${label}: ${message}`); };
  fail(metrics.documentScrollWidth <= metrics.viewportWidth + 1, `document horizontal overflow ${metrics.documentScrollWidth}px > ${metrics.viewportWidth}px; outside local scrollers: ${metrics.documentOverflowElements.slice(0, 6).map((item) => `${item.tag}.${item.className || "(no class)"}@${item.right}px`).join(", ")}`);
  fail(metrics.calendar.width > 0, "calendar has a measurable width");
  fail(metrics.columns.length === (metrics.view === "day" ? 1 : 7), `expected ${metrics.view === "day" ? 1 : 7} calendar columns; found ${metrics.columns.length}`);
  if (!desktop) {
    fail(metrics.navigationActionsSameRow, "mobile toolbar groups moved onto separate rows");
    fail(metrics.calendarHasDetails, "mobile day details panel is missing");
    fail(metrics.details && near(metrics.details.y, metrics.calendar.y, 3) && metrics.details.x >= metrics.calendar.right - 1, "mobile day details moved below the calendar");
    fail(metrics.longContentFitsDetails, "mobile day details overflow horizontally");
  }
  if (desktop) {
    fail(metrics.navigationActionsSameRow, "navigation and actions are on separate toolbar rows");
    if (metrics.toolbarScrollWidth > metrics.toolbarClientWidth + 1) {
      fail(["auto", "scroll"].includes(metrics.toolbarOverflowX), `toolbar needs horizontal scrolling but overflow-x is ${metrics.toolbarOverflowX}`);
      const reachesBothEnds = await page.locator(".planner-toolbar-scroll").evaluate((toolbar) => {
        const first = toolbar.querySelector(".planner-today");
        const last = toolbar.querySelector(".planner-add");
        if (!first || !last) return false;
        const bounds = toolbar.getBoundingClientRect();
        toolbar.scrollLeft = 0;
        const startRect = first.getBoundingClientRect();
        const startReachable = startRect.left >= bounds.left - 1 && startRect.right <= bounds.right + 1;
        toolbar.scrollLeft = toolbar.scrollWidth;
        const endRect = last.getBoundingClientRect();
        const endReachable = endRect.left >= bounds.left - 1 && endRect.right <= bounds.right + 1;
        toolbar.scrollLeft = 0;
        return startReachable && endReachable;
      });
      fail(reachesBothEnds, "toolbar local scrolling does not expose both first and last controls");
    }
    if (requireDetails) fail(metrics.calendarHasDetails, "day details panel is missing");
    else fail(!metrics.calendarHasDetails, "day details panel is present in the hidden-details state");
    if (metrics.details && metrics.calendar) {
      fail(near(metrics.details.y, metrics.calendar.y, 3), "day details panel is below the calendar");
      fail(metrics.details.x >= metrics.calendar.right - 1, "day details panel is not to the right of the calendar");
    }
    if (metrics.view !== "day") {
      fail(metrics.calendarScrollWidth <= metrics.calendarClientWidth + 1, `seven columns need horizontal calendar scrolling (${metrics.calendarScrollWidth}px > ${metrics.calendarClientWidth}px)`);
      fail(metrics.columns.every((column) => column.x >= metrics.calendar.x - 1 && column.right <= metrics.calendar.right + 1), "one or more calendar columns are clipped at the calendar edges");
      fail(metrics.firstColumnWidth >= 34, `calendar columns are too narrow to read (${metrics.firstColumnWidth.toFixed(1)}px)`);
    }
    fail(metrics.longContentFitsDetails, "long selected-day text widens or overflows the details panel");
  }
  if (screenshot) await page.screenshot({ path: resolve(screenshotDir, screenshot), fullPage: true });
  return metrics;
}

async function loadFixture(source, width, height = 1100) {
  await page.setViewportSize({ width, height });
  await page.setContent(shellDocument(source), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await settle();
}

async function checkFilterPopover(source, width, collapsed) {
  await loadFixture(source, width);
  if (collapsed) {
    await page.locator(".sidebar-toggle").click();
    await page.waitForTimeout(330);
    await settle();
  }
  const trigger = page.locator(".planner-toolbar button[aria-label='Filter calendar items']");
  await trigger.scrollIntoViewIfNeeded();
  await page.locator(".planner-toolbar-scroll").evaluate((region) => { region.scrollLeft = region.scrollWidth; });
  await settle();
  const result = await page.evaluate(() => {
    const trigger = document.querySelector(".planner-toolbar button[aria-label='Filter calendar items']");
    const popover = document.querySelector(".planner-filter-popover");
    if (!trigger || !popover) return { found: false };
    const box = popover.getBoundingClientRect();
    const toolbar = document.querySelector(".planner-toolbar");
    const clippingParents = [];
    for (let node = popover.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX) || ["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
        const parent = node.getBoundingClientRect();
        if (box.x < parent.left - 1 || box.right > parent.right + 1 || box.y < parent.top - 1 || box.bottom > parent.bottom + 1) clippingParents.push(node.className || node.tagName);
      }
    }
    // Sample inside rounded borders and outside the native scrollbar area.
    const points = [[box.left + 12, box.top + 12], [box.right - 24, box.top + 12], [box.left + 12, box.bottom - 12], [box.right - 24, box.bottom - 12]];
    const cornersHit = points.map(([x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === popover || popover.contains(hit)); });
    const toolbarRect = toolbar.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    return {
      found: true, x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
      viewportWidth: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight, toolbar: { x: toolbarRect.x, y: toolbarRect.y, right: toolbarRect.right, bottom: toolbarRect.bottom },
      trigger: { x: triggerRect.x, y: triggerRect.y, right: triggerRect.right, bottom: triggerRect.bottom },
      clippingParents, cornersHit,
      anchorAligned: Math.abs(box.x - Math.max(8, Math.min(triggerRect.left, document.documentElement.clientWidth - box.width - 8))) <= 2
        && Math.abs(box.y - Math.max(8, Math.min(triggerRect.bottom + 8, document.documentElement.clientHeight - box.height - 8))) <= 2,
      labelsClickable: [...popover.querySelectorAll("label")].every((label) => { const r = label.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + Math.min(12, r.width / 2), r.top + r.height / 2); return !!hit && (hit === label || label.contains(hit)); }),
    };
  });
  const label = `${width}px ${collapsed ? "collapsed" : "expanded"} filter popover`;
  if (!result.found) failures.push(`${label}: actual open calendar filter popover is missing`);
  else {
    if (result.x < -1 || result.right > result.viewportWidth + 1) failures.push(`${label}: popover falls outside the viewport (${result.x}–${result.right}px)`);
    if (result.y < -1 || result.bottom > result.viewportHeight + 1) failures.push(`${label}: popover falls outside the viewport vertically`);
    if (result.clippingParents.length) failures.push(`${label}: popover is clipped by ${result.clippingParents.join(", ")}`);
    if (!result.cornersHit.every(Boolean)) failures.push(`${label}: popover corners are covered or clipped (${result.cornersHit.join(", ")})`);
    if (!result.labelsClickable) failures.push(`${label}: one or more filter labels are covered or clipped`);
    if (!result.anchorAligned) failures.push(`${label}: filter popover is not positioned beside its trigger (${JSON.stringify({ trigger: result.trigger, popover: { x: result.x, y: result.y, width: result.width, height: result.height } })})`);
  }
  reports.push({ label, ...result });
}

try {
  const desktopWidths = [1024, 1280, 1440, 1920];
  for (const view of ["week", "month", "day"]) {
    for (const width of desktopWidths) {
      await loadFixture(markup.visible[view], width);
      const expanded = await inspect(`${view} ${width}px expanded sidebar`, { screenshot: width === 1440 ? `${view}-expanded-1440.png` : undefined });
      if (width === 1440) await page.locator(".planner-calendar").screenshot({ path: resolve(screenshotDir, `${view}-calendar-1440.png`) });

      await page.locator(".sidebar-toggle").click();
      await page.waitForTimeout(330);
      await settle();
      const collapsed = await inspect(`${view} ${width}px collapsed sidebar`, { screenshot: width === 1440 ? `${view}-collapsed-1440.png` : undefined });
      if (width === 1440) await page.locator(".planner-calendar").screenshot({ path: resolve(screenshotDir, `${view}-calendar-collapsed-1440.png`) });
      if (collapsed.calendar.width <= expanded.calendar.width + 10) failures.push(`${view} ${width}px: collapsing the shell sidebar did not give the calendar more room (${expanded.calendar.width}px → ${collapsed.calendar.width}px)`);

      await loadFixture(markup.hidden[view], width);
      const noDetails = await inspect(`${view} ${width}px hidden day details`, { requireDetails: false });
      if (noDetails.calendarHasDetails) failures.push(`${view} ${width}px: hidden details fixture still shows the panel`);
      if (noDetails.calendar.width <= expanded.calendar.width + 10) failures.push(`${view} ${width}px: hiding day details did not expand the calendar (${expanded.calendar.width}px → ${noDetails.calendar.width}px)`);
      if (noDetails.visibleDays.join("|") !== expanded.visibleDays.join("|")) failures.push(`${view} ${width}px: hiding details changed the calendar's day order`);
    }
  }

  for (const width of [390, 600]) {
    for (const view of ["week", "month", "day"]) {
      await loadFixture(markup.visible[view], width, 900);
      const mobile = await inspect(`${view} ${width}px mobile`, { desktop: false, screenshot: width === 390 && view === "week" ? "week-mobile-390.png" : undefined });
      if (view !== "day" && mobile.calendarScrollWidth > mobile.calendarClientWidth + 1) {
        const scrollable = ["auto", "scroll"].includes(mobile.calendarOverflowX);
        if (!scrollable) failures.push(`${view} ${width}px: calendar overflows horizontally without a local scroller`);
        const scrollCheck = await page.locator(".planner-calendar").evaluate((node) => {
          node.scrollLeft = node.scrollWidth;
          return { scrollLeft: node.scrollLeft, max: node.scrollWidth - node.clientWidth };
        });
        if (scrollCheck.max > 1 && scrollCheck.scrollLeft < scrollCheck.max - 1) failures.push(`${view} ${width}px: calendar's controlled horizontal scroll cannot reach the final column`);
      }
    }
  }

  for (const width of [1024, 1280, 1440]) {
    await checkFilterPopover(markup.filterOpenWeek, width, false);
    await checkFilterPopover(markup.filterOpenWeek, width, true);
  }
  for (const width of [390, 600]) await checkFilterPopover(markup.filterOpenWeek, width, false);

  console.log("Calendar browser layout metrics:");
  console.table(reports.map(({ label, view, viewportWidth, calendar, details, navigationActionsSameRow, navigationWidth, actionsWidth, naturalToolbarWidth, toolbarOuterWidth, mainContentWidth, calendarScrollWidth, calendarClientWidth, toolbarScrollWidth, toolbarClientWidth, firstColumnWidth }) => ({
    label, view, viewportWidth,
    calendarWidth: calendar?.width?.toFixed?.(1), detailsX: details?.x?.toFixed?.(1),
    navWidth: navigationWidth?.toFixed?.(1), actionsWidth: actionsWidth?.toFixed?.(1), naturalToolbarWidth: naturalToolbarWidth?.toFixed?.(1), toolbarWidth: toolbarOuterWidth?.toFixed?.(1),
    workspace: mainContentWidth,
    toolbarOneRow: navigationActionsSameRow, toolbarOverflow: toolbarScrollWidth > toolbarClientWidth,
    calendarOverflow: calendarScrollWidth > calendarClientWidth,
    firstColumnWidth: firstColumnWidth?.toFixed?.(1),
  })));
  if (failures.length) {
    console.error(`\n${failures.length} calendar layout assertion(s) failed:\n- ${failures.join("\n- ")}`);
    assert.fail(`${failures.length} calendar layout assertion(s) failed; screenshots are in .vinext/verify-calendar-layout/`);
  }
  console.log(`\nCalendar layout checks passed. Screenshots: ${screenshotDir}`);
} finally {
  await browser.close();
}
