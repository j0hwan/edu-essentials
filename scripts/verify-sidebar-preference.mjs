import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clientModule } from "../tests/helpers/client-modules.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const referenceCssPath = process.env.SIDEBAR_REFERENCE_CSS
  ? resolve(process.env.SIDEBAR_REFERENCE_CSS)
  : resolve(repoRoot, "app/reference-ui.css");
const [{ SIDEBAR_COLLAPSED_BOOTSTRAP, SIDEBAR_COLLAPSED_STORAGE_KEY }, globalCss, referenceCss, widgetCss] = await Promise.all([
  import(await clientModule("lib/sidebar-preference.ts")),
  readFile(resolve(repoRoot, "app/globals.css"), "utf8"),
  readFile(referenceCssPath, "utf8"),
  readFile(resolve(repoRoot, "app/widget-block-layout.css"), "utf8"),
]);
const css = [globalCss, referenceCss, widgetCss].map((source) => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>:root { --font-geist-sans: Arial, sans-serif; }${css}</style>
    <script id="sidebar-preference-bootstrap">${SIDEBAR_COLLAPSED_BOOTSTRAP}</script>
  </head>
  <body>
    <div class="app-shell reference-ui">
      <aside class="sidebar" aria-label="Primary navigation">
        <div class="sidebar-scroll-region">
        <div class="brand-row">
          <div class="brand-copy"><strong>EduEssentials</strong></div>
          <button class="icon-button sidebar-toggle" aria-label="Collapse sidebar"><svg aria-hidden="true" width="19" height="19"></svg></button>
          <button class="icon-button sidebar-close" aria-label="Close navigation"><svg aria-hidden="true" width="20" height="20"></svg></button>
        </div>
        <nav class="main-nav">
          <a class="nav-item active" href="/home" aria-label="Home"><svg aria-hidden="true" width="20" height="20"></svg><span>Home</span></a>
          <a class="nav-item" href="/dashboard" aria-label="Courses"><svg aria-hidden="true" width="20" height="20"></svg><span>Courses</span></a>
          <a class="nav-item" href="/calendar" aria-label="Calendar"><svg aria-hidden="true" width="20" height="20"></svg><span>Calendar</span></a>
          <a class="nav-item" href="/tasks" aria-label="Tasks"><svg aria-hidden="true" width="20" height="20"></svg><span>Tasks</span></a>
          <a class="nav-item" href="/files" aria-label="Files"><svg aria-hidden="true" width="20" height="20"></svg><span>Files</span></a>
          <a class="nav-item" href="/assistant" aria-label="Ask Edu"><svg aria-hidden="true" width="20" height="20"></svg><span>Ask Edu</span></a>
          <div class="experimental-control"><button class="nav-item experimental-trigger" type="button" aria-label="Experimental mode" aria-expanded="false" aria-controls="experimental-options"><svg aria-hidden="true" width="16" height="16"></svg><span>Experimental mode</span><span class="experimental-badge">TEMP</span></button></div>
        </nav>
        <button class="nav-item syllabus-nav" aria-label="Upload syllabus"><svg aria-hidden="true" width="22" height="22"></svg><span>Upload syllabus</span></button>
        <div class="sidebar-focus-card"><div class="focus-card-top"><span>2 day streak</span><strong>No target</strong></div><div class="tiny-progress"><span></span></div><p>Set your study targets.</p><button>Study &amp; grades</button></div>
        </div>
        <div class="sidebar-bottom">
          <a class="nav-item" href="/settings" aria-label="Settings"><svg aria-hidden="true" width="20" height="20"></svg><span>Settings</span></a>
          <a class="profile-card" href="/profile" aria-label="Alexandria Montgomery-Harrington — profile settings" title="Alexandria Montgomery-Harrington — profile settings"><span class="avatar">A</span><span><strong>Alexandria Montgomery-Harrington</strong><small>Computer Engineering and Applied Data Systems</small></span><svg aria-hidden="true" width="18" height="18"></svg></a>
        </div>
      </aside>
      <div class="experimental-menu" id="experimental-options" hidden>
        <p>Fake preview data</p>
        <button type="button" aria-label="Load Clear experimental data"><span><strong>Clear</strong><small>0 classes · 0 tasks</small></span></button>
        <button type="button" aria-label="Load Light experimental data"><span><strong>Light</strong><small>2 classes · 6 tasks</small></span></button>
        <button type="button" aria-label="Load Medium experimental data"><span><strong>Medium</strong><small>4 classes · 14 tasks</small></span></button>
        <button type="button" aria-label="Load Packed experimental data"><span><strong>Packed</strong><small>6 classes · 28 tasks</small></span></button>
        <button type="button"><strong>Onboard test</strong></button>
        <small>Your saved workspace stays untouched.</small>
      </div>
      <div class="mountain-backdrop" aria-hidden="true"></div>
      <header class="mobile-header"><button class="mobile-open" aria-label="Open navigation">Menu</button><strong>EduEssentials</strong></header>
      <header class="desktop-topbar" aria-label="Workspace toolbar">
        <div class="topbar-context"><span>STUDENT WORKSPACE</span><strong>Home</strong></div>
        <label class="topbar-search"><input aria-label="Search" placeholder="Search your workspace"></label>
        <div class="topbar-actions"><button class="topbar-date"><span><small>TODAY</small><strong>Wednesday, October 7</strong></span></button><button class="topbar-icon" aria-label="Notifications">N</button></div>
      </header>
      <main class="main-content"><div class="page">
        <section class="home-greeting"><h1>Good morning, Alex</h1><p>Wednesday, October 7 · A good day to make progress.</p></section>
        <section class="home-today-panel" aria-label="Today">
          <header class="today-panel-header"><h2>Today</h2><div class="today-panel-actions"><button class="today-panel-link">View schedule</button></div></header>
          <div class="today-panel-grid">
            <section class="today-panel-section"><div class="today-section-heading"><span class="today-heading-icon">S</span><h2>Study goal</h2></div><div class="today-task-list"><p class="today-empty">Keep building your streak.</p></div></section>
            <section class="today-panel-section"><div class="today-section-heading"><span class="today-heading-icon">T</span><h2>Tasks</h2></div><div class="today-task-list"><p class="today-empty">Two tasks are due today.</p></div></section>
            <section class="today-panel-section today-schedule"><div class="today-section-heading"><span class="today-heading-icon">C</span><h2>Schedule</h2></div><div class="today-schedule-list"><p class="today-empty">No events yet.</p></div></section>
          </div>
        </section>
        <section class="workspace-section">
          <div class="workspace-bar"><div class="workspace-tabs" role="tablist" aria-label="Workspaces"><button class="active">My workspace</button><button>Classes</button></div><div class="workspace-actions"><button class="widget-customization-trigger">Widget customization</button><button>Customize</button><button class="add-widget-control">Add widget</button></div></div>
          <div class="widget-grid" aria-label="Workspace widgets">
            <article class="widget-card" data-size="small" data-widget-id="goal"><div class="widget-frame"><div class="widget-header"><span class="widget-icon">G</span><h2>Daily Study Goal</h2></div><div class="widget-body">Study for 30 minutes</div></div></article>
            <article class="widget-card" data-size="large" data-widget-id="notes"><div class="widget-frame"><div class="widget-header"><span class="widget-icon">N</span><h2>Quick Notes</h2></div><div class="widget-body">Remember to review notes</div></div></article>
            <article class="widget-card" data-size="small" data-widget-id="timer"><div class="widget-frame"><div class="widget-header"><span class="widget-icon">T</span><h2>Pomodoro</h2></div><div class="widget-body">25:00</div></div></article>
          </div>
        </section>
      </div></main>
      <button class="sidebar-scrim" style="display:none" aria-label="Close navigation overlay"></button>
    </div>
    <script>
      const shell = document.querySelector('.app-shell');
      document.querySelector('.sidebar-toggle').addEventListener('click', () => {
        const collapsed = !shell.classList.contains('sidebar-collapsed');
        shell.classList.toggle('sidebar-collapsed', collapsed);
        document.documentElement.dataset.sidebarCollapsed = String(collapsed);
      });
      const sidebar = document.querySelector('.sidebar');
      const scrim = document.querySelector('.sidebar-scrim');
      const experimentalTrigger = document.querySelector('.experimental-trigger');
      const experimentalMenu = document.querySelector('#experimental-options');
      const positionExperimentalMenu = () => {
        const triggerRect = experimentalTrigger.getBoundingClientRect();
        const controlRect = document.querySelector('.experimental-control').getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        experimentalMenu.hidden = false;
        experimentalMenu.style.position = 'fixed';
        experimentalMenu.style.visibility = 'hidden';
        const menuRect = experimentalMenu.getBoundingClientRect();
        const gap = 8;
        const menuWidth = Math.min(menuRect.width, Math.max(0, viewportWidth - gap * 2));
        const collapsedRail = document.documentElement.dataset.sidebarCollapsed === 'true' && window.matchMedia('(min-width: 821px)').matches;
        let left = collapsedRail ? triggerRect.right + gap : controlRect.left;
        if (collapsedRail && left + menuWidth > viewportWidth - gap) left = triggerRect.left - menuWidth - gap;
        left = Math.max(gap, Math.min(left, viewportWidth - menuWidth - gap));
        const maxHeight = Math.max(80, viewportHeight - gap * 2);
        let top = triggerRect.bottom + gap;
        if (top + menuRect.height > viewportHeight - gap) top = triggerRect.top - menuRect.height - gap;
        top = Math.max(gap, Math.min(top, viewportHeight - Math.min(menuRect.height, maxHeight) - gap));
        experimentalMenu.style.left = left + 'px';
        experimentalMenu.style.top = top + 'px';
        experimentalMenu.style.maxHeight = maxHeight + 'px';
        experimentalMenu.style.overflowY = 'auto';
        experimentalMenu.style.visibility = '';
      };
      const closeExperimentalMenu = (restoreFocus = false) => {
        experimentalTrigger.setAttribute('aria-expanded', 'false');
        experimentalMenu.hidden = true;
        if (restoreFocus) experimentalTrigger.focus();
      };
      const openExperimentalMenu = () => {
        experimentalTrigger.setAttribute('aria-expanded', 'true');
        positionExperimentalMenu();
        experimentalMenu.querySelector('button:not(:disabled)')?.focus();
      };
      experimentalTrigger.addEventListener('click', () => {
        if (experimentalTrigger.getAttribute('aria-expanded') === 'true') closeExperimentalMenu();
        else openExperimentalMenu();
      });
      experimentalTrigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' && experimentalTrigger.getAttribute('aria-expanded') !== 'true') {
          event.preventDefault();
          openExperimentalMenu();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && experimentalTrigger.getAttribute('aria-expanded') === 'true') {
          event.preventDefault();
          closeExperimentalMenu(true);
        }
      });
      window.addEventListener('resize', () => {
        if (experimentalTrigger.getAttribute('aria-expanded') === 'true') positionExperimentalMenu();
      });
      window.addEventListener('scroll', () => {
        if (experimentalTrigger.getAttribute('aria-expanded') === 'true') positionExperimentalMenu();
      }, true);
      document.querySelector('.mobile-open').addEventListener('click', () => { sidebar.classList.add('open'); scrim.style.display = ''; });
      const closeSidebar = () => { sidebar.classList.remove('open'); scrim.style.display = 'none'; };
      document.querySelector('.sidebar-close').addEventListener('click', closeSidebar);
      scrim.addEventListener('click', closeSidebar);
    </script>
  </body>
</html>`;

const server = createServer((request, response) => {
  if (request.url?.startsWith("/favicon.ico")) { response.writeHead(204); response.end(); return; }
  if (request.url?.startsWith("/mountain-header.png")) { response.writeHead(204); response.end(); return; }
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
const errors = [];

async function openPage({ value = undefined, blocked = false, width = 1440, height = 1000, rootFontSize = null, reducedMotion = "no-preference", accountMotion = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  await context.addInitScript(({ key, value, blocked }) => {
    if (blocked) {
      Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
    } else if (value !== undefined) {
      window.localStorage.setItem(key, value);
    }
  }, { key: SIDEBAR_COLLAPSED_STORAGE_KEY, value, blocked });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.goto(baseUrl, { waitUntil: "load" });
  if (rootFontSize) await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, rootFontSize);
  if (accountMotion) await page.evaluate(() => { document.documentElement.dataset.motion = "reduced"; });
  return { context, page };
}

async function metrics(page) {
  return page.locator(".app-shell").evaluate((shell) => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    const sidebar = shell.querySelector(".sidebar");
    const scrollRegion = shell.querySelector(".sidebar-scroll-region");
    const sidebarBottom = shell.querySelector(".sidebar-bottom");
    const profile = shell.querySelector(".profile-card");
    const label = shell.querySelector(".nav-item > span");
    const widgetGrid = shell.querySelector(".widget-grid");
    const widgetCards = [...shell.querySelectorAll(".widget-card")];
    return {
      rootValue: document.documentElement.getAttribute("data-sidebar-collapsed"),
      sidebarWidth: sidebar.getBoundingClientRect().width,
      sidebarLeft: sidebar.getBoundingClientRect().left,
      sidebar: rect(sidebar),
      sidebarPaddingLeft: parseFloat(getComputedStyle(sidebar).paddingLeft),
      sidebarPaddingTop: parseFloat(getComputedStyle(sidebar).paddingTop),
      sidebarPaddingRight: parseFloat(getComputedStyle(sidebar).paddingRight),
      sidebarPaddingBottom: parseFloat(getComputedStyle(sidebar).paddingBottom),
      sidebarClientLeft: sidebar.clientLeft,
      sidebarClientWidth: sidebar.clientWidth,
      sidebarClientHeight: sidebar.clientHeight,
      sidebarBorderTop: parseFloat(getComputedStyle(sidebar).borderTopWidth),
      sidebarBorderBottom: parseFloat(getComputedStyle(sidebar).borderBottomWidth),
      sidebarBottom: rect(sidebarBottom),
      settingsNav: rect(sidebarBottom.querySelector(".nav-item")),
      scrollRegion: rect(scrollRegion),
      scrollHeight: scrollRegion.scrollHeight,
      clientHeight: scrollRegion.clientHeight,
      scrollTop: scrollRegion.scrollTop,
      profile: rect(profile),
      avatar: rect(profile.querySelector(".avatar")),
      profileLabelDisplay: getComputedStyle(profile.querySelector("span:not(.avatar)")).display,
      profileText: [...profile.querySelectorAll("strong, small")].map((element) => {
        const style = getComputedStyle(element);
        return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
      }),
      navLinkCount: shell.querySelectorAll(".main-nav > a").length,
      brandCopy: rect(shell.querySelector(".brand-copy")),
      brandDisplay: getComputedStyle(shell.querySelector(".brand-copy")).display,
      brandRow: rect(shell.querySelector(".brand-row")),
      toggleLeft: shell.querySelector(".sidebar-toggle").getBoundingClientRect().left,
      navIconLeft: shell.querySelector(".nav-item svg").getBoundingClientRect().left,
      experimentalIconWidth: shell.querySelector(".experimental-trigger > svg").getBoundingClientRect().width,
      experimentalHeight: rect(shell.querySelector(".experimental-trigger")).height,
      experimentalLabelDisplay: getComputedStyle(shell.querySelector(".experimental-trigger > span")).display,
      syllabusIconLeft: shell.querySelector(".syllabus-nav > svg").getBoundingClientRect().left,
      labelDisplay: getComputedStyle(label).display,
      contentLeft: shell.querySelector(".main-content").getBoundingClientRect().left,
      contentWidth: shell.querySelector(".main-content").getBoundingClientRect().width,
      contentOffset: getComputedStyle(shell).getPropertyValue("--content-offset").trim(),
      topbar: rect(shell.querySelector(".desktop-topbar")),
      backdrop: rect(shell.querySelector(".mountain-backdrop")),
      greeting: rect(shell.querySelector(".home-greeting")),
      today: rect(shell.querySelector(".home-today-panel")),
      controls: rect(shell.querySelector(".workspace-bar")),
      grid: rect(widgetGrid),
      widgets: widgetCards.map(rect),
      dateVisible: getComputedStyle(shell.querySelector(".topbar-date")).display !== "none",
    };
  });
}

const shellTrackNames = ["sidebarWidth", "toggleLeft", "navIconLeft", "experimentalIconWidth", "experimentalHeight", "syllabusIconLeft", "contentLeft", "topbarLeft", "topbarWidth", "backdropLeft"];

function shellTrackValues(snapshot) {
  return {
    sidebarWidth: snapshot.sidebarWidth,
    toggleLeft: snapshot.toggleLeft,
    navIconLeft: snapshot.navIconLeft,
    experimentalIconWidth: snapshot.experimentalIconWidth,
    experimentalHeight: snapshot.experimentalHeight,
    syllabusIconLeft: snapshot.syllabusIconLeft,
    contentLeft: snapshot.contentLeft,
    topbarLeft: snapshot.topbar.left,
    topbarWidth: snapshot.topbar.width,
    backdropLeft: snapshot.backdrop.left,
  };
}

function assertSquareWidgets(snapshot, context) {
  assert.ok(snapshot.widgets.length >= 3, `${context}: fixture contains representative widgets`);
  for (const [index, widget] of snapshot.widgets.entries()) {
    assert.ok(widget.width > 0 && widget.height > 0, `${context}: widget ${index} has a rendered footprint`);
    assert.ok(Math.abs(widget.width - widget.height) <= 1.5, `${context}: widget ${index} remains square (${widget.width.toFixed(2)}×${widget.height.toFixed(2)})`);
  }
}

async function captureSidebarScreenshot(page, name) {
  const directory = process.env.SIDEBAR_FIT_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: false });
  await page.locator(".sidebar").screenshot({ path: join(directory, `${name}-sidebar.png`) });
}

function assertProfileContained(snapshot, context, { collapsed = false, mobile = false } = {}) {
  const innerLeft = snapshot.sidebar.left + snapshot.sidebarClientLeft + snapshot.sidebarPaddingLeft;
  const innerRight = snapshot.sidebar.left + snapshot.sidebarClientLeft + snapshot.sidebarClientWidth - snapshot.sidebarPaddingRight;
  const innerTop = snapshot.sidebar.top + snapshot.sidebarBorderTop + parseFloat(snapshot.sidebarPaddingTop ?? 0);
  const innerBottom = snapshot.sidebar.top + snapshot.sidebarBorderTop + snapshot.sidebarClientHeight - snapshot.sidebarPaddingBottom;
  assert.ok(snapshot.profile.width > 0 && snapshot.profile.height > 0, `${context}: profile card has a rendered footprint`);
  assert.ok(snapshot.sidebarBottom.left >= innerLeft - 1, `${context}: footer begins inside the sidebar's horizontal padding`);
  assert.ok(snapshot.sidebarBottom.left + snapshot.sidebarBottom.width <= innerRight + 1, `${context}: footer ends inside the sidebar's horizontal padding`);
  assert.ok(snapshot.sidebarBottom.top >= innerTop - 1, `${context}: footer stays below the sidebar's top padding`);
  assert.ok(snapshot.sidebarBottom.top + snapshot.sidebarBottom.height <= innerBottom + 1, `${context}: footer stays above the sidebar's bottom edge`);
  assert.ok(snapshot.settingsNav.left >= innerLeft - 1 && snapshot.settingsNav.left + snapshot.settingsNav.width <= innerRight + 1, `${context}: Settings stays inside the sidebar's horizontal padding`);
  assert.ok(snapshot.settingsNav.top >= snapshot.sidebarBottom.top - 1 && snapshot.settingsNav.top + snapshot.settingsNav.height <= snapshot.profile.top + 1, `${context}: Settings stays above the profile card inside the pinned footer`);
  assert.ok(snapshot.profile.left >= innerLeft - 1, `${context}: profile card stays inside the sidebar's left padding`);
  assert.ok(snapshot.profile.left + snapshot.profile.width <= innerRight + 1, `${context}: profile card stays inside the sidebar's right padding`);
  assert.ok(snapshot.profile.top >= snapshot.sidebarBottom.top - 1, `${context}: profile card stays within its footer`);
  assert.ok(snapshot.profile.top + snapshot.profile.height <= snapshot.sidebarBottom.top + snapshot.sidebarBottom.height + 1, `${context}: profile card stays within its footer height`);
  assert.ok(snapshot.avatar.left >= snapshot.profile.left - 1 && snapshot.avatar.left + snapshot.avatar.width <= snapshot.profile.left + snapshot.profile.width + 1, `${context}: avatar stays within the profile card horizontally`);
  assert.ok(snapshot.avatar.top >= snapshot.profile.top - 1 && snapshot.avatar.top + snapshot.avatar.height <= snapshot.profile.top + snapshot.profile.height + 1, `${context}: avatar stays within the profile card vertically`);
  assert.equal(snapshot.navLinkCount, 6, `${context}: fixture has the six regular production navigation links`);
  assert.ok(snapshot.profileText.every(({ textOverflow, whiteSpace }) => textOverflow === "ellipsis" && whiteSpace === "nowrap"), `${context}: long profile name and major are ellipsized on one line`);
  assert.equal(snapshot.profileLabelDisplay === "none", collapsed && !mobile, `${context}: profile text visibility matches the desktop collapse state`);
  if (collapsed && !mobile) {
    const usableCenter = innerLeft + (innerRight - innerLeft) / 2;
    const avatarCenter = snapshot.avatar.left + snapshot.avatar.width / 2;
    assert.ok(Math.abs(avatarCenter - usableCenter) <= 1.5, `${context}: collapsed avatar is centered in the sidebar rail (${avatarCenter.toFixed(1)} vs ${usableCenter.toFixed(1)})`);
  }
}

async function assertKeyboardNavigation(page, context) {
  await page.locator(".sidebar-toggle").focus();
  const expectedLabels = ["Home", "Courses", "Calendar", "Tasks", "Files", "Ask Edu", "Experimental mode", "Upload syllabus"];
  for (const expected of expectedLabels) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      const region = document.querySelector(".sidebar-scroll-region");
      const stickyBrand = document.querySelector(".brand-row");
      const box = element.getBoundingClientRect();
      const viewport = region.getBoundingClientRect();
      return {
        label: element.getAttribute("aria-label"),
        rect: { top: box.top, bottom: box.bottom },
        viewport: { top: viewport.top, bottom: viewport.bottom },
        stickyBottom: stickyBrand.getBoundingClientRect().bottom,
        scrollTop: region.scrollTop,
      };
    });
    assert.equal(focused.label, expected, `${context}: Tab reaches ${expected}`);
    assert.ok(focused.rect.top >= focused.viewport.top - 2.5 && focused.rect.bottom <= focused.viewport.bottom + 2.5, `${context}: focused ${expected} control scrolls into the visible sidebar region (control ${focused.rect.top.toFixed(1)}–${focused.rect.bottom.toFixed(1)}, region ${focused.viewport.top.toFixed(1)}–${focused.viewport.bottom.toFixed(1)}, scrollTop ${focused.scrollTop})`);
    assert.ok(focused.rect.top >= focused.stickyBottom - 1, `${context}: focused ${expected} control is not hidden under the sticky brand row`);
    if (expected === "Ask Edu" || expected === "Upload syllabus") {
      assert.ok(focused.scrollTop > 0, `${context}: short sidebar scrolls its navigation to reveal ${expected}`);
    }
  }
  for (const expected of ["Experimental mode", "Ask Edu", "Files", "Tasks", "Calendar", "Courses", "Home"]) {
    await page.keyboard.press("Shift+Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      const region = document.querySelector(".sidebar-scroll-region");
      const box = element.getBoundingClientRect();
      const viewport = region.getBoundingClientRect();
      return {
        label: element.getAttribute("aria-label"),
        rect: { top: box.top, bottom: box.bottom },
        viewport: { top: viewport.top, bottom: viewport.bottom },
        stickyBottom: document.querySelector(".brand-row").getBoundingClientRect().bottom,
      };
    });
    assert.equal(focused.label, expected, `${context}: Shift+Tab reaches ${expected}`);
    assert.ok(focused.rect.top >= focused.viewport.top - 2.5 && focused.rect.bottom <= focused.viewport.bottom + 2.5, `${context}: reverse-focused ${expected} stays within the visible navigation region`);
    assert.ok(focused.rect.top >= focused.stickyBottom - 1, `${context}: reverse-focused ${expected} stays clear of the sticky brand row`);
  }
}

async function assertExperimentalMenuReachable(page, context) {
  await page.locator(".experimental-trigger").click();
  const menu = page.locator(".experimental-menu");
  await menu.waitFor({ state: "visible" });
  const initial = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      parentIsShell: element.parentElement === document.querySelector(".app-shell"),
      position: style.position,
      zIndex: Number(style.zIndex),
      maxHeight: parseFloat(style.maxHeight),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  assert.equal(initial.parentIsShell, true, `${context}: Experimental menu is portaled outside the scroll-clipped navigation region`);
  assert.equal(initial.position, "fixed", `${context}: Experimental menu is viewport-positioned`);
  assert.ok(initial.zIndex >= 80, `${context}: Experimental menu paints above the sidebar rail`);
  assert.ok(initial.rect.left >= 0 && initial.rect.right <= initial.viewportWidth + 1, `${context}: Experimental menu remains within the viewport horizontally`);
  assert.ok(initial.rect.top >= 0 && initial.rect.bottom <= initial.viewportHeight + 1, `${context}: Experimental menu remains within the viewport vertically`);
  assert.ok(initial.rect.bottom - initial.rect.top <= initial.maxHeight + 1, `${context}: menu stays within its viewport-derived maximum height`);
  const menuLabels = ["Load Clear experimental data", "Load Light experimental data", "Load Medium experimental data", "Load Packed experimental data", "Onboard test"];
  const openedFocus = await page.evaluate(() => ({
    label: document.activeElement.getAttribute("aria-label"),
    insideMenu: document.querySelector(".experimental-menu").contains(document.activeElement),
  }));
  assert.equal(openedFocus.label, menuLabels[0], `${context}: opening Experimental mode focuses its first option`);
  assert.equal(openedFocus.insideMenu, true, `${context}: keyboard focus enters the portaled Experimental menu when it opens`);
  for (const expected of menuLabels.slice(1)) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      const menuElement = document.querySelector(".experimental-menu");
      const rect = element.getBoundingClientRect();
      const menuRect = menuElement.getBoundingClientRect();
      return {
        label: element.getAttribute("aria-label") || element.querySelector("strong")?.textContent,
        insideMenu: menuElement.contains(element),
        rect: { top: rect.top, bottom: rect.bottom },
        menuRect: { top: menuRect.top, bottom: menuRect.bottom },
        scrollTop: menuElement.scrollTop,
      };
    });
    assert.equal(focused.label, expected, `${context}: Tab reaches ${expected} in the Experimental menu`);
    assert.equal(focused.insideMenu, true, `${context}: keyboard focus enters the portaled Experimental menu`);
    assert.ok(focused.rect.top >= focused.menuRect.top - 1 && focused.rect.bottom <= focused.menuRect.bottom + 1, `${context}: focused ${expected} option scrolls into the visible menu region`);
  }
  const lastOption = await menu.locator("button").last().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const menuRect = element.closest(".experimental-menu").getBoundingClientRect();
    const menu = element.closest(".experimental-menu");
    return { top: rect.top, bottom: rect.bottom, menuTop: menuRect.top, menuBottom: menuRect.bottom, scrollTop: menu.scrollTop };
  });
  assert.ok(lastOption.top >= lastOption.menuTop - 1 && lastOption.bottom <= lastOption.menuBottom + 1, `${context}: last Experimental option can be brought into the menu viewport`);
  if (initial.scrollHeight > initial.clientHeight) assert.ok(lastOption.scrollTop > 0, `${context}: long Experimental menu scrolls to reveal its final option`);

  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => ({
    expanded: document.querySelector(".experimental-trigger").getAttribute("aria-expanded"),
    hidden: document.querySelector(".experimental-menu").hidden,
    focusRestored: document.activeElement === document.querySelector(".experimental-trigger"),
  }));
  assert.equal(closed.expanded, "false", `${context}: Escape closes Experimental mode`);
  assert.equal(closed.hidden, true, `${context}: closed Experimental menu is removed from view`);
  assert.equal(closed.focusRestored, true, `${context}: Escape restores focus to the Experimental trigger`);

  await page.keyboard.press("ArrowDown");
  const reopenedFocus = await page.evaluate(() => ({
    expanded: document.querySelector(".experimental-trigger").getAttribute("aria-expanded"),
    firstOptionFocused: document.activeElement === document.querySelector(".experimental-menu button"),
    hidden: document.querySelector(".experimental-menu").hidden,
  }));
  assert.equal(reopenedFocus.expanded, "true", `${context}: ArrowDown opens Experimental mode from its trigger`);
  assert.equal(reopenedFocus.firstOptionFocused, true, `${context}: ArrowDown places focus on the first menu option`);
  assert.equal(reopenedFocus.hidden, false, `${context}: ArrowDown reveals the portaled menu`);
  await page.keyboard.press("Escape");
}

async function verifySidebarFit({ width, height, collapsed = false, rootFontSize = null, openMobileDrawer = false, keyboard = false, menu = false, screenshot = null }) {
  const description = `${width}×${height}${rootFontSize ? ` at ${rootFontSize}px text scale` : ""} ${collapsed ? "collapsed" : "expanded"}`;
  const { context, page } = await openPage({ width, height, value: String(collapsed), rootFontSize });
  try {
    if (openMobileDrawer) {
      await page.locator(".mobile-open").click();
      await page.waitForTimeout(230);
    } else {
      await page.waitForTimeout(35);
    }
    if (screenshot) await captureSidebarScreenshot(page, screenshot);
    const snapshot = await metrics(page);
    assertProfileContained(snapshot, description, { collapsed, mobile: width <= 820 });
    assert.ok(snapshot.scrollRegion.top >= snapshot.sidebar.top + snapshot.sidebarBorderTop - 1, `${description}: scroll region stays inside the sidebar`);
    assert.ok(snapshot.scrollRegion.top + snapshot.scrollRegion.height <= snapshot.sidebarBottom.top + 1, `${description}: scroll region ends before the pinned footer`);
    if (height <= 480 || rootFontSize) {
      assert.ok(snapshot.scrollHeight > snapshot.clientHeight, `${description}: compact navigation has a usable vertical scroll region (${snapshot.scrollHeight}px content / ${snapshot.clientHeight}px viewport)`);
    }
    if (keyboard) await assertKeyboardNavigation(page, description);
    if (menu) await assertExperimentalMenuReachable(page, description);
  } finally {
    await context.close();
  }
}

async function captureToggle(page, duration = 380) {
  return page.evaluate(async (duration) => {
    const shell = document.querySelector(".app-shell");
    const snapshot = () => {
      const box = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, width: rect.width, height: rect.height };
      };
      const sidebar = shell.querySelector(".sidebar");
      const main = shell.querySelector(".main-content");
      return {
        at: performance.now(),
        sidebarWidth: sidebar.getBoundingClientRect().width,
        toggleLeft: shell.querySelector(".sidebar-toggle").getBoundingClientRect().left,
        navIconLeft: shell.querySelector(".nav-item svg").getBoundingClientRect().left,
        experimentalIconWidth: shell.querySelector(".experimental-trigger > svg").getBoundingClientRect().width,
        experimentalHeight: box(shell.querySelector(".experimental-trigger")).height,
        syllabusIconLeft: shell.querySelector(".syllabus-nav > svg").getBoundingClientRect().left,
        brandRow: box(shell.querySelector(".brand-row")),
        contentLeft: main.getBoundingClientRect().left,
        topbar: box(shell.querySelector(".desktop-topbar")),
        backdrop: box(shell.querySelector(".mountain-backdrop")),
        widgets: [...shell.querySelectorAll(".widget-card")].map((card) => {
          const rect = card.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
        activeTransitions: [sidebar, shell.querySelector(".sidebar-toggle"), shell.querySelector(".nav-item"), shell.querySelector(".experimental-trigger"), shell.querySelector(".syllabus-nav"), main, shell.querySelector(".desktop-topbar"), shell.querySelector(".mountain-backdrop")]
          .flatMap((element) => element.getAnimations().filter((animation) => animation.playState === "running" || animation.playState === "pending")
            .map((animation) => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration, easing: animation.effect.getTiming().easing }))),
      };
    };
    const before = snapshot();
    const startedAt = performance.now();
    document.querySelector(".sidebar-toggle").click();
    const frames = [];
    return await new Promise((resolve) => {
      const sample = () => {
        frames.push(snapshot());
        if (performance.now() - startedAt >= duration) resolve({ before, frames });
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  }, duration);
}

function assertSynchronizedMotion(before, after, frames, direction) {
  const from = shellTrackValues(before);
  const to = shellTrackValues(after);
  const movingNames = shellTrackNames.filter((name) => Math.abs(to[name] - from[name]) > 1);
  assert.deepEqual(movingNames, shellTrackNames, "sidebar, main, topbar, and backdrop all change geometry");
  const progressAt = (frame, name) => (shellTrackValues(frame)[name] - from[name]) / (to[name] - from[name]);
  const intermediate = frames.find((frame) => {
    const progresses = movingNames.map((name) => progressAt(frame, name));
    return progresses.every((progress) => progress > 0.08 && progress < 0.94);
  });
  assert.ok(intermediate, `${direction}: browser sampled an intermediate frame for every shell element (${movingNames.map((name) => `${name}=${frames.map((frame) => progressAt(frame, name).toFixed(2)).join("/")}`).join("; ")})`);

  const activeFrames = frames.filter((frame) => {
    const progresses = movingNames.map((name) => progressAt(frame, name));
    return progresses.every((progress) => progress > 0.03 && progress < 0.97);
  });
  assert.ok(activeFrames.length >= 3, `${direction}: multiple actual rendered frames overlap the active transition interval`);
  for (const frame of activeFrames) {
    const progresses = movingNames.map((name) => progressAt(frame, name));
    assert.ok(progresses.every((progress) => progress >= -0.02 && progress <= 1.02), `${direction}: frame remains between the start and destination geometry`);
    assert.ok(Math.max(...progresses) - Math.min(...progresses) < 0.025, `${direction}: shell geometry shares one eased progress (${progresses.map((progress) => progress.toFixed(3)).join(", ")})`);
  }
  for (const frame of frames) {
    const progresses = ["sidebarWidth", "contentLeft", "topbarLeft", "topbarWidth", "backdropLeft"].map((name) => progressAt(frame, name));
    assert.ok(progresses.every((progress) => progress >= -0.02 && progress <= 1.02), `${direction}: shell bounce stays within 2% of the destination`);
    assert.ok(Math.abs(frame.brandRow.height - before.brandRow.height) < 0.75, `${direction}: brand row keeps a stable height (${before.brandRow.height.toFixed(2)} → ${frame.brandRow.height.toFixed(2)})`);
  }
  assert.ok(frames.some((frame) => progressAt(frame, "sidebarWidth") > 1.003), `${direction}: sidebar gently overshoots before settling`);
  for (const frame of frames) assertSquareWidgets(frame, `${direction} at ${Math.round(frame.at - frames[0].at)}ms`);

  const transitionSamples = frames.flatMap((frame) => frame.activeTransitions);
  const properties = new Set(transitionSamples.map(({ property }) => property));
  for (const property of ["width", "margin-left", "left"]) {
    assert.ok(properties.has(property), `${direction}: browser reports a running ${property} transition`);
  }
  assert.ok(transitionSamples.every(({ duration, easing }) => duration === 320 && easing === "cubic-bezier(0.22, 1, 0.36, 1.06)"), `${direction}: all active CSS transitions use the shared 320ms bounce easing`);
}

async function shellAnimations(page) {
  return page.evaluate(() => [".sidebar", ".sidebar-toggle", ".nav-item", ".experimental-trigger", ".syllabus-nav", ".main-content", ".desktop-topbar", ".mountain-backdrop"]
    .flatMap((selector) => [...document.querySelector(selector).getAnimations()]
      .filter((animation) => animation.playState === "running" || animation.playState === "pending")
      .map((animation) => ({ selector, property: animation.transitionProperty }))));
}

async function assertStaticLanding(page, expectedCollapsed, description) {
  await page.waitForTimeout(35);
  const settled = await metrics(page);
  assert.equal(settled.sidebarWidth < 100, expectedCollapsed, `${description}: sidebar reaches the requested endpoint`);
  assert.deepEqual(await shellAnimations(page), [], `${description}: no shell transition remains active`);
  assertSquareWidgets(settled, description);
  return settled;
}

function assertReversalStartsSmoothly(before, firstFrame) {
  const start = shellTrackValues(before);
  const next = shellTrackValues(firstFrame);
  for (const name of shellTrackNames) {
    assert.ok(Math.abs(next[name] - start[name]) < 18, `rapid reversal keeps ${name} continuous (${start[name].toFixed(2)} → ${next[name].toFixed(2)})`);
  }
}

try {
  browser = await playwright.chromium.launch(launchOptions);
  for (const width of [1280, 1440]) {
    for (const height of [320, 480, 768]) {
      for (const collapsed of [false, true]) {
        await verifySidebarFit({
          width,
          height,
          collapsed,
          keyboard: width === 1280 && height === 320,
          menu: width === 1280 && height === 320,
          screenshot: width === 1280 && height === 320 ? `desktop-${collapsed ? "collapsed" : "expanded"}-1280x320` : null,
        });
      }
    }
  }
  await verifySidebarFit({ width: 1440, height: 480, rootFontSize: 20, keyboard: true, menu: true, screenshot: "desktop-text-scale-20px-1440x480" });
  await verifySidebarFit({ width: 1280, height: 600, rootFontSize: 20, collapsed: true, keyboard: true, screenshot: "desktop-text-scale-20px-collapsed-1280x600" });
  await verifySidebarFit({ width: 390, height: 320, openMobileDrawer: true, menu: true, screenshot: "mobile-drawer-390x320" });
  await verifySidebarFit({ width: 390, height: 844, openMobileDrawer: true, screenshot: "mobile-drawer-390x844" });

  let collapsedDesktop;
  const { context: collapsedContext, page: collapsedPage } = await openPage({ value: "true" });
  try {
    const initial = await metrics(collapsedPage);
    collapsedDesktop = initial;
    assert.equal(initial.rootValue, "true", "the before-hydration bootstrap sees the saved collapsed preference");
    assert.ok(initial.sidebarWidth < 100, `desktop sidebar is collapsed on first render (${initial.sidebarWidth}px)`);
    assert.equal(initial.labelDisplay, "none", "collapsed navigation labels are hidden before hydration");
    assertSquareWidgets(initial, "saved collapsed first paint");
    assert.deepEqual(await shellAnimations(collapsedPage), [], "saved collapsed preference does not animate the shell on first paint");
  } finally { await collapsedContext.close(); }

  const { context: expandedContext, page: expandedPage } = await openPage({ value: "false" });
  try {
    const initial = await metrics(expandedPage);
    assert.equal(initial.rootValue, "false", "false is represented explicitly by the early script");
    assert.ok(initial.sidebarWidth > 200, `desktop sidebar remains expanded (${initial.sidebarWidth}px)`);
    assert.notEqual(initial.labelDisplay, "none", "expanded navigation labels remain visible");
    assert.ok(collapsedDesktop.contentLeft < initial.contentLeft, "desktop content reflows to use the space released by the collapsed sidebar");
    assert.ok(initial.dateVisible, "the desktop date control is present");
    assert.notEqual(initial.brandDisplay, "none", "the brand text is visible in the expanded sidebar");
    assert.ok(Math.abs(initial.brandCopy.left - initial.navIconLeft) < 1, "header text aligns with the navigation icon inset without reserving logo space");
    assert.notEqual(initial.experimentalLabelDisplay, "none", "expanded experimental navigation label is visible");
    assert.ok(initial.greeting.width > 0 && initial.today.width > 0 && initial.controls.width > 0, "greeting, Today panel, and workspace controls render in the fixture");
    assertSquareWidgets(initial, "saved expanded first paint");
    assert.deepEqual(await shellAnimations(expandedPage), [], "saved expanded preference does not animate the shell on first paint");

    const collapsedTransition = await captureToggle(expandedPage);
    const collapsed = await metrics(expandedPage);
    assert.equal(collapsed.rootValue, "true", "collapse updates the same root preference used by production CSS");
    assert.equal(collapsed.labelDisplay, "none", "collapsed navigation labels keep their existing display behavior");
    assert.equal(collapsed.experimentalLabelDisplay, "none", "collapsed experimental label remains hidden");
    assert.equal(collapsed.brandDisplay, "none", "the brand text keeps its collapsed display behavior");
    assertSynchronizedMotion(collapsedTransition.before, collapsed, collapsedTransition.frames, "collapse");
    assert.ok(collapsed.greeting.width > initial.greeting.width && collapsed.today.width > initial.today.width, "page content expands into the space released by the sidebar");
    assert.ok(collapsed.controls.width > initial.controls.width, "workspace controls follow the wider main content");

    const expandedTransition = await captureToggle(expandedPage);
    const expandedAgain = await metrics(expandedPage);
    assert.equal(expandedAgain.rootValue, "false", "expansion restores the saved preference state");
    assert.notEqual(expandedAgain.labelDisplay, "none", "expanded navigation labels return");
    assert.notEqual(expandedAgain.brandDisplay, "none", "the brand text returns with the expanded sidebar");
    assert.notEqual(expandedAgain.experimentalLabelDisplay, "none", "the experimental label returns with the expanded sidebar");
    assertSynchronizedMotion(expandedTransition.before, expandedAgain, expandedTransition.frames, "expansion");

    const interruptedCollapse = await captureToggle(expandedPage, 75);
    const interruptedProgress = (interruptedCollapse.frames.at(-1).sidebarWidth - initial.sidebarWidth)
      / (collapsed.sidebarWidth - initial.sidebarWidth);
    assert.ok(interruptedProgress > 0.05 && interruptedProgress < 0.98, "rapid reversal starts while collapse is visibly in flight");
    const reversal = await captureToggle(expandedPage);
    assertReversalStartsSmoothly(reversal.before, reversal.frames[0]);
    const settledExpanded = await assertStaticLanding(expandedPage, false, "rapid reversal");
    for (const name of shellTrackNames) {
      assert.ok(Math.abs(shellTrackValues(settledExpanded)[name] - shellTrackValues(initial)[name]) < 0.5, `rapid reversal settles back to expanded ${name}`);
    }
  } finally { await expandedContext.close(); }

  for (const options of [{}, { value: "unexpected" }, { blocked: true }]) {
    const { context, page } = await openPage(options);
    try {
      const initial = await metrics(page);
      assert.equal(initial.rootValue, null, "missing, invalid, and blocked storage leave the default root state unset");
      assert.ok(initial.sidebarWidth > 200, `default desktop sidebar remains expanded (${initial.sidebarWidth}px)`);
    } finally { await context.close(); }
  }

  const { context: mobileContext, page: mobilePage } = await openPage({ value: "true", width: 390 });
  try {
    const initial = await metrics(mobilePage);
    assert.equal(initial.rootValue, "true", "the preference is still available on mobile");
    assert.ok(initial.sidebarWidth >= 219 && initial.sidebarWidth <= 221, `mobile drawer keeps its normal width (${initial.sidebarWidth}px)`);
    assert.notEqual(initial.labelDisplay, "none", "mobile navigation labels remain visible");
    assert.equal(initial.contentLeft, 0, "mobile main content begins at the viewport edge");
    assert.equal(initial.backdrop.left, 0, "mobile backdrop stays anchored to the viewport");
    const drawerFrames = await mobilePage.evaluate(async () => {
      document.querySelector(".mobile-open").click();
      const frames = [];
      const startedAt = performance.now();
      return await new Promise((resolve) => {
        const sample = () => {
          frames.push({
            contentLeft: document.querySelector(".main-content").getBoundingClientRect().left,
            backdropLeft: document.querySelector(".mountain-backdrop").getBoundingClientRect().left,
          });
          if (performance.now() - startedAt >= 380) resolve(frames);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });
    assert.ok(drawerFrames.length >= 8, "mobile drawer was sampled across its rendered opening frames");
    assert.ok(drawerFrames.every(({ contentLeft, backdropLeft }) => Math.abs(contentLeft) < 0.1 && Math.abs(backdropLeft) < 0.1), "mobile drawer overlays without shifting the main content or backdrop");
    await mobilePage.locator(".sidebar-close").click();
    await mobilePage.waitForTimeout(380);
    assert.ok(Math.abs((await metrics(mobilePage)).contentLeft) < 0.1, "closing the mobile drawer still does not shift content");
  } finally { await mobileContext.close(); }

  for (const options of [{ accountMotion: true }, { reducedMotion: "reduce" }]) {
    const { context, page } = await openPage({ value: "false", ...options });
    try {
      assert.deepEqual(await shellAnimations(page), [], "reduced-motion preference has no initial shell transition");
      const reducedTransition = await captureToggle(page, 45);
      assert.ok(reducedTransition.frames.length >= 1, "reduced-motion toggle was sampled in the browser");
      assert.ok(reducedTransition.frames.every((frame) => frame.activeTransitions.every(({ duration }) => duration <= 0.01)), `${options.accountMotion ? "account" : "OS"} reduced-motion reduces shell transitions to at most 0.01ms`);
      const settled = await assertStaticLanding(page, true, options.accountMotion ? "account reduced motion" : "OS reduced motion");
      assert.ok(reducedTransition.frames.every((frame) => Math.min(
        Math.abs(frame.sidebarWidth - reducedTransition.before.sidebarWidth),
        Math.abs(frame.sidebarWidth - settled.sidebarWidth),
      ) < 1.5), "reduced-motion frames stay at the starting or destination geometry without a visible in-between size");
      assert.equal(settled.labelDisplay, "none", "reduced motion still applies the collapsed layout and labels");
    } finally { await context.close(); }
  }

  assert.deepEqual(errors, [], "browser console and page errors are empty");
  console.log("Sidebar browser QA passed: profile/footer containment, compact scrolling and keyboard navigation, Experimental menu reachability, synchronized collapse/expansion, reversal, saved first paint, reduced motion, mobile drawer, and square widgets.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}
