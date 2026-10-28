import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readWorkspaceStylesheets } from "../tests/helpers/workspace-presentation.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-files-reference");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE
  ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href)
  : await import("esbuild");

const { css } = await readWorkspaceStylesheets();
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/files-reference-browser.tsx")],
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
assert.doesNotMatch(css, /files-reference-art\.png/i, "the Files stylesheet bundle does not use the screenshot sprite");
const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --font-geist-sans: Arial, sans-serif; } .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const baseUrl = "https://files-reference.test";
const filesLandscape = await readFile(resolve(repoRoot, "public/files-landscape.png"));
const filesEmptyIllustration = await readFile(resolve(repoRoot, "public/files-empty-illustration.png"));
const googleMenuIcons = new Map(await Promise.all(["google-slides.svg", "google-docs.svg", "google-drive.svg"].map(async (name) => [
  `/${name}`,
  await readFile(resolve(repoRoot, "public", name)),
])));
await mkdir(screenshotDir, { recursive: true });

const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";

const errors = [];
const layoutFailures = [];
const servedAssets = [];
const googleServiceRequests = [];
const uploadPosts = [];
const primarySidebarReferences = new WeakMap();
let browser;

function durationMs(value) {
  return Math.max(...value.split(",").map((part) => {
    const duration = Number.parseFloat(part.trim());
    return part.trim().endsWith("ms") ? duration : duration * 1000;
  }));
}

function uploadAck(request) {
  const url = new URL(request.url());
  const headers = request.headers();
  const metadata = JSON.parse(decodeURIComponent(headers["x-file-metadata"]));
  const body = request.postDataBuffer() ?? Buffer.alloc(0);
  const id = url.searchParams.get("id");
  const file = {
    id,
    name: metadata.name,
    mime_type: "application/octet-stream",
    size_bytes: body.byteLength,
    course_id: metadata.courseId || null,
    assignment_id: metadata.assignmentId || null,
    kind: metadata.kind,
    state: "ready",
    created_at: "2026-10-09T12:00:00.000Z",
    updated_at: "2026-10-09T12:00:00.000Z",
    content_sha256: createHash("sha256").update(body).digest("hex"),
    folder_id: metadata.folderId ?? null,
    content_backend: "object",
    metadata_revision: 1,
    content_revision: 1,
    trashed_at: null,
    trash_operation_id: null,
    original_folder_id: null,
  };
  uploadPosts.push({ id, profileId: headers["x-profile-id"] ?? "", metadata, size: body.byteLength });
  return file;
}

async function waitForUploadPosts(count, description) {
  const deadline = Date.now() + 10000;
  while (uploadPosts.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(uploadPosts.length >= count, `Timed out waiting for ${description}; observed ${uploadPosts.length} POST requests`);
}

async function createPage(viewport, scenario, extraQuery = {}, { verifyPrimarySidebarModes = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseUrl) {
      // Keep this harness offline. Third-party requests are satisfied locally and
      // the fixture API owns every workspace and file response.
      if (["https://slides.google.com", "https://docs.google.com", "https://drive.google.com"].includes(url.origin)) {
        googleServiceRequests.push({ url: url.href, method: route.request().method() });
        await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>Offline Google destination</title>" });
        return;
      }
      await route.fulfill({ status: 204, body: "" });
    } else if (url.pathname === "/fixture.js") {
      await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", headers: { "cache-control": "no-store" }, body: js });
    } else if (url.pathname === "/api/files" && route.request().method() === "POST") {
      const file = uploadAck(route.request());
      await route.fulfill({ status: 201, contentType: "application/json; charset=utf-8", body: JSON.stringify({ file }) });
    } else if (url.pathname === "/files-landscape.png") {
      servedAssets.push(url.pathname);
      await route.fulfill({ status: 200, contentType: "image/png", body: filesLandscape });
    } else if (url.pathname === "/files-empty-illustration.png") {
      servedAssets.push(url.pathname);
      await route.fulfill({ status: 200, contentType: "image/png", body: filesEmptyIllustration });
    } else if (googleMenuIcons.has(url.pathname)) {
      servedAssets.push(url.pathname);
      await route.fulfill({ status: 200, contentType: "image/svg+xml; charset=utf-8", body: googleMenuIcons.get(url.pathname) });
    } else if (url.pathname === "/favicon.ico") {
      await route.fulfill({ status: 204, body: "" });
    } else {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "cache-control": "no-store" }, body: html });
    }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(`pageerror at ${viewport.width}px (${scenario}): ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_ABORTED")) {
      errors.push(`console at ${viewport.width}px (${scenario}): ${message.text()}`);
    }
  });
  const search = new URLSearchParams({ scenario, ...extraQuery });
  await page.goto(`${baseUrl}/home?${search}`);
  await page.locator("#workspace-sidebar .main-nav .nav-item").first().waitFor({ state: "visible" });
  await waitForPrimarySidebarMotion(page);
  const primarySidebarReference = verifyPrimarySidebarModes
    ? await capturePrimarySidebarModes(page)
    : { initial: await readPrimarySidebar(page) };
  primarySidebarReferences.set(page, primarySidebarReference);
  await enterFilesView(page);
  return { context, page };
}

async function waitForPrimarySidebarMotion(page) {
  await page.locator("#workspace-sidebar").evaluate(async (sidebar) => {
    await Promise.all(sidebar.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
  });
}

async function setPrimarySidebarCollapsed(page, collapsed) {
  const current = await page.locator(".app-shell").evaluate((shell) => shell.classList.contains("sidebar-collapsed"));
  if (current === collapsed) return;
  const toggle = page.getByRole("button", { name: collapsed ? "Collapse sidebar" : "Expand sidebar", exact: true });
  await toggle.click();
  await page.waitForFunction((expected) => document.querySelector(".app-shell")?.classList.contains("sidebar-collapsed") === expected, collapsed);
  await waitForPrimarySidebarMotion(page);
}

async function readPrimarySidebar(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const sidebar = document.querySelector("#workspace-sidebar");
    if (!shell || !sidebar) return null;
    const rect = (element) => {
      if (!element) return null;
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const brand = sidebar.querySelector(".brand-row");
    const nav = sidebar.querySelector(".main-nav");
    const navItems = [...sidebar.querySelectorAll(".main-nav .nav-item")].map((item) => ({
      label: item.getAttribute("aria-label") || item.textContent?.trim() || "",
      rect: rect(item),
      textDisplay: getComputedStyle(item.querySelector("span") ?? item).display,
      textStyle: (() => {
        const text = item.querySelector("span");
        if (!text) return null;
        const style = getComputedStyle(text);
        return { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing };
      })(),
      icon: rect(item.querySelector("svg")),
      iconStrokeWidth: item.querySelector("svg")?.getAttribute("stroke-width") ?? "",
    }));
    const syllabus = sidebar.querySelector(".syllabus-nav");
    const bottom = sidebar.querySelector(".sidebar-bottom");
    const profile = sidebar.querySelector(".profile-card");
    const style = getComputedStyle(sidebar);
    return {
      collapsed: shell.classList.contains("sidebar-collapsed"),
      sidebar: rect(sidebar),
      brand: rect(brand),
      nav: rect(nav),
      navItems,
      syllabus: rect(syllabus),
      bottom: rect(bottom),
      profile: rect(profile),
      sidebarPosition: style.position,
      sidebarWidth: style.width,
    };
  });
}

async function capturePrimarySidebarModes(page) {
  const initial = await page.locator(".app-shell").evaluate((shell) => shell.classList.contains("sidebar-collapsed"));
  const expanded = await (async () => {
    await setPrimarySidebarCollapsed(page, false);
    return readPrimarySidebar(page);
  })();
  const collapsed = await (async () => {
    await setPrimarySidebarCollapsed(page, true);
    return readPrimarySidebar(page);
  })();
  await setPrimarySidebarCollapsed(page, initial);
  return { expanded, collapsed, initial };
}

function assertPrimarySidebarGeometry(actual, expected, description) {
  const check = (condition, message) => { if (!condition) layoutFailures.push(message); };
  check(Boolean(actual && expected), `${description} both render the shared sidebar`);
  if (!actual || !expected) return;
  check(actual.collapsed === expected.collapsed, `${description} keeps the same expanded or collapsed state`);
  check(actual.sidebarPosition === expected.sidebarPosition, `${description} keeps the primary sidebar positioning`);
  check(Boolean(actual.sidebar && expected.sidebar), `${description} keeps the primary sidebar mounted`);
  if (actual.sidebar && expected.sidebar) {
    for (const field of ["left", "right", "width"]) {
      check(Math.abs(actual.sidebar[field] - expected.sidebar[field]) <= 1,
        `${description} keeps the primary sidebar ${field} unchanged (${expected.sidebar[field]} → ${actual.sidebar[field]}px)`);
    }
  }
  check(Math.abs(parseFloat(actual.sidebarWidth) - parseFloat(expected.sidebarWidth)) <= 1,
    `${description} keeps the primary sidebar CSS width unchanged (${expected.sidebarWidth} → ${actual.sidebarWidth})`);
  for (const part of ["brand", "profile"]) {
    if (!actual[part] || !expected[part]) {
      check(false, `${description} keeps the ${part} area mounted`);
      continue;
    }
    for (const field of ["width", "height"]) {
      check(Math.abs(actual[part][field] - expected[part][field]) <= 1,
        `${description} keeps the ${part} ${field} unchanged (${expected[part][field]} → ${actual[part][field]}px)`);
    }
  }
  check(JSON.stringify(actual.navItems.map((item) => item.label)) === JSON.stringify(expected.navItems.map((item) => item.label)),
    `${description} keeps the same primary route items while Files adds its nested navigation`);
  const expectedItems = new Map(expected.navItems.map((item) => [item.label, item]));
  for (const item of actual.navItems) {
    const referenceItem = expectedItems.get(item.label);
    if (!referenceItem) continue;
    for (const field of ["width", "height"]) {
      check(Boolean(item.rect && referenceItem.rect) && Math.abs(item.rect[field] - referenceItem.rect[field]) <= 1,
        `${description} keeps the ${item.label} primary row ${field} unchanged (${referenceItem.rect?.[field]} → ${item.rect?.[field]}px)`);
    }
    for (const field of ["width", "height"]) {
      check(Boolean(item.icon && referenceItem.icon) && Math.abs(item.icon[field] - referenceItem.icon[field]) <= 1,
        `${description} keeps the ${item.label} primary icon ${field} unchanged (${referenceItem.icon?.[field]} → ${item.icon?.[field]}px)`);
    }
    check(item.iconStrokeWidth === referenceItem.iconStrokeWidth,
      `${description} keeps the ${item.label} primary icon stroke unchanged (${referenceItem.iconStrokeWidth} → ${item.iconStrokeWidth})`);
    check(JSON.stringify(item.textStyle) === JSON.stringify(referenceItem.textStyle),
      `${description} keeps the ${item.label} primary font unchanged (${JSON.stringify(referenceItem.textStyle)} → ${JSON.stringify(item.textStyle)})`);
  }
}

async function assertPrimarySidebarMatchesReference(page, description) {
  await waitForPrimarySidebarMotion(page);
  const reference = primarySidebarReferences.get(page);
  assert.ok(reference, `${description} has a Home-page sidebar reference`);
  const actual = await readPrimarySidebar(page);
  const expected = reference.expanded && reference.collapsed
    ? (actual.collapsed ? reference.collapsed : reference.expanded)
    : reference.initial;
  assertPrimarySidebarGeometry(actual, expected, description);
}

async function enterFilesView(page) {
  if (await page.locator(".files-browser").isVisible()) {
    await page.getByRole("navigation", { name: "File navigation", exact: true }).waitFor({ state: "visible" });
    return;
  }
  const primaryFilesLink = page.getByRole("link", { name: "Files", exact: true });
  if (await isInViewport(primaryFilesLink, page)) await primaryFilesLink.click();
  else {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await primaryFilesLink.click();
  }
  await page.locator(".files-browser").waitFor({ state: "visible" });
  await page.getByRole("navigation", { name: "File navigation", exact: true }).waitFor({ state: "visible" });
}

async function isInViewport(locator, page) {
  if (!(await locator.count())) return false;
  const box = await locator.boundingBox();
  if (!box) return false;
  const viewport = page.viewportSize();
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
}

async function clickPrimaryFileView(page, label) {
  const button = page.locator("#workspace-sidebar .files-primary-navigation").getByRole("button", { name: label, exact: true });
  const sidebar = page.locator("#workspace-sidebar");
  if (page.viewportSize().width <= 820 && !(await sidebar.evaluate((element) => element.classList.contains("open")))) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#workspace-sidebar")?.classList.contains("open"));
  } else if (!(await isInViewport(button, page))) {
    const openNavigation = page.getByRole("button", { name: "Open navigation", exact: true });
    const expandSidebar = page.getByRole("button", { name: "Expand sidebar", exact: true });
    if (await isInViewport(openNavigation, page)) await openNavigation.click();
    else if (await isInViewport(expandSidebar, page)) await expandSidebar.click();
  }
  await button.waitFor({ state: "visible" });
  await button.click();
}

async function fixture(page, expression) {
  return page.evaluate((source) => Function(`return window.__filesReferenceFixture.${source}`)(), expression);
}

async function takeScreenshot(page, name) {
  const viewport = page.viewportSize();
  await page.mouse.move(Math.max(1, viewport.width - 24), Math.max(1, viewport.height - 100));
  await page.screenshot({ path: resolve(screenshotDir, `${name}.png`), animations: "disabled" });
}

async function inspectViewport(page, viewport) {
  await assertPrimarySidebarMatchesReference(page, `the Files view at ${viewport.width}px`);
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const primary = document.querySelector("#workspace-sidebar");
    const filesNavigation = document.querySelector(".files-primary-navigation");
    const secondary = document.querySelector(".files-sidebar");
    const files = document.querySelector(".files-browser");
    const mobileHeader = document.querySelector(".mobile-header");
    const search = document.querySelector(".files-browser-tools");
    const rect = (element) => {
      if (!element) return null;
      const { left, right, width, top, bottom } = element.getBoundingClientRect();
      return { left, right, width, top, bottom };
    };
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      shell: rect(shell),
      primary: rect(primary),
      filesNavigation: rect(filesNavigation),
      filesNavigationCount: document.querySelectorAll(".files-primary-navigation").length,
      legacyFilesSidebarCount: document.querySelectorAll(".files-sidebar").length,
      filesNavigationInPrimary: Boolean(primary && filesNavigation && primary.contains(filesNavigation)),
      files: rect(files),
      mobileHeader: rect(mobileHeader),
      filesSearch: rect(search),
    };
  });
  const check = (condition, message) => { if (!condition) layoutFailures.push(message); };
  check(Boolean(metrics.files), `the Files workspace renders at ${viewport.width}px`);
  check(metrics.document <= viewport.width + 1, `document has no horizontal overflow at ${viewport.width}px (${metrics.document}px)`);
  check(metrics.body <= viewport.width + 1, `body has no horizontal overflow at ${viewport.width}px (${metrics.body}px)`);
  check(metrics.files.left >= -1 && metrics.files.right <= viewport.width + 1, `Files content fits at ${viewport.width}px (${metrics.files.left}–${metrics.files.right})`);
  check(Boolean(metrics.primary), `the actual Workspace sidebar renders at ${viewport.width}px`);
  check(metrics.filesNavigationCount === 1 && Boolean(metrics.filesNavigation), `one Files navigation renders in the shared sidebar at ${viewport.width}px`);
  check(metrics.filesNavigationInPrimary, `Files navigation belongs to the shared sidebar at ${viewport.width}px`);
  check(metrics.legacyFilesSidebarCount === 0, `Files does not render a second sidebar at ${viewport.width}px`);
  if (viewport.width <= 820) {
    check(Boolean(metrics.mobileHeader && metrics.filesSearch), `the mobile header and Files search render at ${viewport.width}px`);
    check(metrics.filesSearch.top >= metrics.mobileHeader.bottom - 1,
      `the Files search starts below the mobile header at ${viewport.width}px (${metrics.filesSearch.top}px vs ${metrics.mobileHeader.bottom}px)`);
  }
  if (viewport.width > 700) {
    const maximumPrimaryWidth = Math.min(360, viewport.width * 0.2);
    check(metrics.primary.width >= 160 && metrics.primary.width <= maximumPrimaryWidth,
      `primary sidebar has a usable desktop width (${metrics.primary.width}px, max ${maximumPrimaryWidth}px)`);
  }
  return metrics;
}

async function inspectFilesAppearance(page, viewport, { expectEmptyArt = false } = {}) {
  const styles = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const backdrop = document.querySelector(".mountain-backdrop");
    const search = document.querySelector(".files-browser-search-control");
    const emptyArt = document.querySelector(".files-empty-art");
    const homeSections = [...document.querySelectorAll(".files-home-sections > section")].map((section) => {
      const style = getComputedStyle(section);
      return {
        label: section.querySelector("h3")?.textContent.trim() ?? "",
        borderStyle: style.borderStyle,
        borderWidth: style.borderWidth,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
      };
    });
    const rgbaAlpha = (value) => [...value.matchAll(/rgba?\(([^)]+)\)/g)].map((match) => {
      const parts = match[1].split(/\s*,\s*/);
      return parts.length === 4 ? Number(parts[3]) : 1;
    });
    const oldSpriteUses = [...document.querySelectorAll("*")].flatMap((element) => {
      const computed = getComputedStyle(element);
      return [computed.backgroundImage, computed.maskImage, computed.webkitMaskImage]
        .filter((value) => value.includes("files-reference-art.png"));
    });
    return {
      viewport: window.innerWidth,
      shellBackground: shell ? getComputedStyle(shell).backgroundColor : "",
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      bodyBackgroundImage: getComputedStyle(document.body).backgroundImage,
      shellBackgroundImage: shell ? getComputedStyle(shell).backgroundImage : "",
      backdropImage: backdrop ? getComputedStyle(backdrop).backgroundImage : "",
      backdropPosition: backdrop ? getComputedStyle(backdrop).backgroundPosition : "",
      searchBackgroundImage: search ? getComputedStyle(search).backgroundImage : "",
      searchBackgroundColor: search ? getComputedStyle(search).backgroundColor : "",
      searchBackdropFilter: search ? getComputedStyle(search).backdropFilter : "",
      searchAlphaStops: search ? rgbaAlpha(getComputedStyle(search).backgroundImage) : [],
      emptyArtBackgroundImage: emptyArt ? getComputedStyle(emptyArt).backgroundImage : "",
      homeSections,
      oldSpriteUses,
    };
  });
  const check = (condition, message) => { if (!condition) layoutFailures.push(message); };
  check(styles.oldSpriteUses.length === 0, `computed CSS contains no files-reference-art source at ${viewport.width}px (${styles.oldSpriteUses.join(", ")})`);
  check(styles.backdropImage.includes("files-landscape.png"), `Files uses the clean landscape banner at ${viewport.width}px (${styles.backdropImage})`);
  if (viewport.width >= 821) check(styles.backdropPosition.includes("-20px"), `the desktop Files landscape is shifted to keep the moon above the search glass at ${viewport.width}px (${styles.backdropPosition})`);
  check(styles.shellBackground !== "rgba(0, 0, 0, 0)" && styles.shellBackground !== "transparent", `Files has a painted workspace background at ${viewport.width}px (${styles.shellBackground})`);
  check(styles.bodyBackground !== "rgba(0, 0, 0, 0)" && styles.bodyBackground !== "transparent", `the document body background is painted at ${viewport.width}px (${styles.bodyBackground})`);
  check(styles.searchBackgroundImage.includes("gradient") && styles.searchAlphaStops.some((alpha) => alpha > 0 && alpha < 1), `Files search has a translucent glass background at ${viewport.width}px (${styles.searchBackgroundImage})`);
  if (styles.homeSections.length) {
    check(JSON.stringify(styles.homeSections.map((section) => section.label)) === JSON.stringify(["Recent files", "All files"]),
      `the Files home shows both glass sections at ${viewport.width}px (${JSON.stringify(styles.homeSections.map((section) => section.label))})`);
    for (const section of styles.homeSections) {
      check(section.borderStyle === "solid" && parseFloat(section.borderWidth) >= 1 && section.borderColor !== "rgba(0, 0, 0, 0)",
        `${section.label} has a visible glass outline at ${viewport.width}px (${JSON.stringify(section)})`);
      check(section.borderRadius !== "0px" && section.backgroundImage.includes("gradient") && /blur\(/.test(section.backdropFilter),
        `${section.label} uses a rounded dark glass surface at ${viewport.width}px (${JSON.stringify(section)})`);
    }
  }
  if (expectEmptyArt) check(styles.emptyArtBackgroundImage.includes("files-empty-illustration.png"), `the empty state uses its standalone illustration at ${viewport.width}px (${styles.emptyArtBackgroundImage})`);
  console.log(`Files appearance at ${viewport.width}px: ${JSON.stringify(styles)}`);
  return styles;
}

async function clickFilesMenuItem(page, label) {
  const menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name: label, exact: true }).click();
}

async function openNewMenu(page) {
  const trigger = page.getByRole("button", { name: "New", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ state: "visible" });
  return menu;
}

async function assertNewMenuGeometry(page, viewport) {
  await page.locator(".files-new-menu").evaluate((menu) => Promise.all(menu.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const geometry = await page.evaluate(() => {
    const trigger = document.querySelector('.files-new-button[aria-haspopup="menu"]');
    const menu = document.querySelector(".files-new-menu");
    const header = document.querySelector(".files-primary-actions .files-browser-header");
    const sidebar = document.querySelector("#workspace-sidebar");
    if (!trigger || !menu || !header || !sidebar) return null;
    const rect = (element) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return { trigger: rect(trigger), menu: rect(menu), header: rect(header), sidebar: rect(sidebar), triggerInHeader: header.contains(trigger) };
  });
  assert.ok(geometry, `the New menu and its actual trigger render at ${viewport.width}px`);
  const { trigger, menu } = geometry;
  assert.equal(geometry.triggerInHeader, true, `the New button remains in the Files primary-actions header at ${viewport.width}px`);
  assert.ok(menu.left >= 0 && menu.right <= viewport.width, `the New menu fits horizontally at ${viewport.width}px (${JSON.stringify(menu)})`);
  assert.ok(menu.width <= 220, `the New menu stays compact at ${viewport.width}px (${menu.width}px)`);
  assert.ok(Math.abs(menu.top - trigger.bottom) <= 1, `the New menu starts at the trigger's bottom edge after its entrance at ${viewport.width}px (${JSON.stringify({ trigger, menu })})`);
  const expectedLeft = Math.max(8, Math.min(trigger.left, viewport.width - menu.width - 8));
  assert.ok(Math.abs(menu.left - expectedLeft) <= 2,
    `the New menu aligns with its trigger's left edge and stays inside the viewport at ${viewport.width}px (${JSON.stringify({ trigger, menu, expectedLeft })})`);
  assert.ok(menu.left >= geometry.sidebar.right - 1,
    `the New menu stays clear of the primary sidebar at ${viewport.width}px (${JSON.stringify({ menu, sidebar: geometry.sidebar })})`);
  return geometry;
}

async function assertUploadPanelGeometry(page, viewport, mainBefore) {
  await page.locator(".files-upload-shell").evaluate((shell) => Promise.all(shell.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector(".files-upload-dialog");
    const shell = document.querySelector(".files-upload-shell");
    const backdrop = document.querySelector(".files-upload-backdrop");
    const body = panel?.querySelector(".files-upload-body");
    const footer = panel?.querySelector(".files-upload-footer");
    const toggle = document.querySelector(".files-upload-panel-toggle");
    const main = document.querySelector(".files-browser-content");
    const rect = (element) => {
      if (!element) return null;
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const style = panel ? getComputedStyle(panel) : null;
    const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
    const bodyStyle = body ? getComputedStyle(body) : null;
    return {
      shell: rect(shell), panel: rect(panel), toggle: rect(toggle), backdrop: rect(backdrop), main: rect(main),
      footer: rect(footer),
      footerControls: [...(footer?.querySelectorAll("button, input") ?? [])].map(rect),
      position: backdropStyle?.position ?? "", borderRadius: [style?.borderTopLeftRadius, style?.borderTopRightRadius, style?.borderBottomRightRadius, style?.borderBottomLeftRadius],
      overflowY: bodyStyle?.overflowY ?? "", maxHeight: style?.maxHeight ?? "", visibility: style?.visibility ?? "",
    };
  });
  console.log(`Upload panel geometry ${viewport.width}px: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panel, `the upload review panel renders at ${viewport.width}px`);
  assert.ok(geometry.shell, `the upload shell renders at ${viewport.width}px`);
  assert.ok(geometry.toggle, `the attached upload arrow renders at ${viewport.width}px`);
  const desktop = viewport.width > 650;
  const tabRightInset = desktop ? 32 : 20;
  assert.ok(Math.abs(geometry.toggle.bottom - geometry.panel.top - 1) <= 1,
    `the raised tab overlaps the panel top by 1px at ${viewport.width}px (${JSON.stringify({ arrow: geometry.toggle, panel: geometry.panel })})`);
  assert.ok(Math.abs(geometry.panel.right - geometry.toggle.right - tabRightInset) <= 1,
    `the raised tab sits ${tabRightInset}px inside the panel's right edge at ${viewport.width}px (${JSON.stringify({ arrow: geometry.toggle, panel: geometry.panel })})`);
  for (const key of ["left", "right", "top", "bottom", "width", "height"]) {
    assert.ok(Math.abs(geometry.shell[key] - geometry.panel[key]) <= 1,
      `the dialog fills its animated shell at ${viewport.width}px (${key}: ${geometry.shell[key]} vs ${geometry.panel[key]})`);
  }
  assert.equal(geometry.position, "fixed", `the upload panel floats over Files at ${viewport.width}px`);
  assert.ok(Math.abs(geometry.panel.bottom - geometry.backdrop.bottom - 18) <= 2,
    `the panel extends 18px below the viewport at ${viewport.width}px (${JSON.stringify({ panel: geometry.panel, backdrop: geometry.backdrop })})`);
  assert.ok(geometry.panel.top >= 0 && geometry.panel.top < viewport.height,
    `the panel rises into view from the bottom at ${viewport.width}px (${JSON.stringify(geometry.panel)})`);
  const maxPanelHeight = viewport.width > 650 ? Math.min(720, viewport.height - 64) : viewport.height - 64;
  assert.ok(Math.abs(Number.parseFloat(geometry.maxHeight) - maxPanelHeight) <= 1,
    `the panel caps its height to the available viewport at ${viewport.width}px (${geometry.maxHeight}, expected ${maxPanelHeight}px)`);
  assert.ok(geometry.panel.height <= maxPanelHeight + 1,
    `the panel fits its height cap at ${viewport.width}px (${geometry.panel.height}px, cap ${maxPanelHeight}px)`);
  if (viewport.width > 650) {
    assert.ok(Math.abs(viewport.width - geometry.panel.right - 72) <= 4, `the desktop panel keeps a 72px right margin to make room for its arrow at ${viewport.width}px (${geometry.panel.right}px)`);
    assert.ok(geometry.panel.width >= 530 && geometry.panel.width <= 550, `the desktop panel stays near 540px wide at ${viewport.width}px (${geometry.panel.width}px)`);
  } else {
    assert.ok(Math.abs(geometry.panel.left - (geometry.backdrop.left + 12)) <= 4 && Math.abs(geometry.panel.right - (geometry.backdrop.right - 42)) <= 4, `the mobile panel keeps 12px left and 42px right insets for its arrow at ${viewport.width}px (${JSON.stringify({ panel: geometry.panel, backdrop: geometry.backdrop })})`);
    assert.ok(geometry.panel.width <= geometry.backdrop.width - 54, `the mobile panel and arrow space fit inside the viewport at ${viewport.width}px (${JSON.stringify({ panel: geometry.panel, backdrop: geometry.backdrop })})`);
  }
  assert.ok(geometry.borderRadius.slice(0, 2).every((radius) => Number.parseFloat(radius) >= 12), `the panel top corners are rounded at ${viewport.width}px (${geometry.borderRadius.join(", ")})`);
  assert.ok(geometry.borderRadius.slice(2).every((radius) => Number.parseFloat(radius) === 0), `the panel bottom corners sit below the viewport at ${viewport.width}px (${geometry.borderRadius.join(", ")})`);
  assert.ok(["auto", "scroll"].includes(geometry.overflowY), `the panel body scrolls independently at ${viewport.width}px (${geometry.overflowY})`);
  assert.ok(geometry.panel.height < viewport.height, `the panel does not become a full-height drawer at ${viewport.width}px (${geometry.panel.height}px)`);
  assert.ok(geometry.footer, `the upload footer renders at ${viewport.width}px`);
  if (geometry.footerControls.length) {
    assert.ok(geometry.footerControls.every((control) => control.top >= 0 && control.bottom <= viewport.height + 1),
      `footer controls remain visible above the panel underlap at ${viewport.width}px (${JSON.stringify(geometry.footerControls)})`);
  }
  if (mainBefore) {
    for (const key of ["left", "right", "top", "bottom", "width", "height"]) {
      assert.ok(Math.abs(geometry.main[key] - mainBefore[key]) <= 1, `opening the upload panel does not reflow Files ${key} at ${viewport.width}px (${mainBefore[key]} → ${geometry.main[key]})`);
    }
  }
  assert.equal(await page.locator(".files-empty-drop-hint, .files-populated-drop-hint").count(), 0, `Files shows no main-page drop hint at ${viewport.width}px`);
  return geometry;
}

async function assertUploadPanelBounce(page, { replay = false, reducedMotion = false } = {}) {
  const animation = await page.locator(".files-upload-shell").evaluate(async (shell) => {
    const style = getComputedStyle(shell);
    const entrance = shell.getAnimations().find((item) => item.animationName === "files-upload-enter");
    const previous = window.__filesUploadPreviousEntrance;
    if (entrance) window.__filesUploadPreviousEntrance = entrance;
    const result = {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      playState: entrance?.playState ?? "none",
      currentTime: entrance?.currentTime ?? null,
      isSameAsPrevious: Boolean(entrance && previous === entrance),
      keyframes: entrance?.effect?.getKeyframes().map((frame) => ({ offset: frame.offset, transform: frame.transform })) ?? [],
      alignmentSamples: [],
    };
    const sample = () => {
      const panel = shell.querySelector(".files-upload-dialog");
      const toggle = shell.querySelector(".files-upload-panel-toggle");
      if (!panel || !toggle) return;
      const panelRect = panel.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const toggleRect = toggle.getBoundingClientRect();
      result.alignmentSamples.push({
        time: entrance?.currentTime ?? null,
        panelTop: panelRect.top,
        panelRight: panelRect.right,
        shellTop: shellRect.top,
        arrowBottom: toggleRect.bottom,
        arrowRight: toggleRect.right,
        panelHeight: panelRect.height,
      });
    };
    if (entrance?.playState === "running") {
      let lastSampleTime = -Infinity;
      let frames = 0;
      while (entrance.playState === "running" && frames < 120) {
        const currentTime = Number(entrance.currentTime ?? 0);
        if (currentTime - lastSampleTime >= 70) {
          sample();
          lastSampleTime = currentTime;
        }
        frames += 1;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      sample();
    }
    return result;
  });
  if (reducedMotion) {
    assert.ok(animation.animationName === "none" || durationMs(animation.animationDuration) <= 0.05,
      `reduced motion removes the upload-panel animation (${animation.animationName}, ${animation.animationDuration})`);
    assert.equal(animation.playState, "none", "reduced motion creates no upload-panel entrance animation");
    return animation;
  }

  assert.match(animation.animationName, /files-upload-enter/, `the upload shell has its bounce entrance animation (${animation.animationName})`);
  assert.ok(durationMs(animation.animationDuration) >= 540 && durationMs(animation.animationDuration) <= 580,
    `the upload-shell entrance has a smooth 560ms duration (${animation.animationDuration})`);
  assert.equal(animation.keyframes.length, 3, `the entrance uses one gentle settle (${JSON.stringify(animation.keyframes)})`);
  assert.deepEqual(animation.keyframes.map((frame) => frame.offset), [0, 0.82, 1],
    `the entrance settles after one small overshoot (${JSON.stringify(animation.keyframes)})`);
  const collapsedOffset = await page.evaluate(() => window.innerWidth > 650 ? 18 : 88);
  assert.match(animation.keyframes[0].transform, new RegExp(`translateY\\(calc\\(100%\\s*-\\s*${collapsedOffset}px\\)\\)`),
    `the upload shell starts at the same ${collapsedOffset}px attached-tab position used while collapsed`);
  for (const y of ["-4px", "0px"]) {
    assert.ok(animation.keyframes.some((frame) => frame.transform.includes(`translateY(${y})`)),
      `the shell settles through translateY(${y})`);
  }
  assert.ok(animation.alignmentSamples.length >= 6,
    `the attached arrow is sampled throughout the shell entrance (${JSON.stringify(animation.alignmentSamples)})`);
  const tabRightInset = await page.evaluate(() => window.innerWidth > 650 ? 32 : 20);
  assert.ok(animation.alignmentSamples.every((sample) => Math.abs(sample.arrowBottom - sample.panelTop - 1) <= 1 &&
    Math.abs(sample.panelRight - sample.arrowRight - tabRightInset) <= 1 &&
    Math.abs(sample.shellTop - sample.panelTop) <= 1),
  `the raised arrow stays joined to the panel throughout its bounce (${JSON.stringify(animation.alignmentSamples)})`);
  if (replay) {
    assert.equal(animation.isSameAsPrevious, false, "reopening creates a fresh entrance animation");
    assert.equal(animation.playState, "running", `the reopened panel is animating again (${animation.playState}, ${animation.currentTime}ms)`);
    assert.ok(animation.currentTime < durationMs(animation.animationDuration),
      `the reopened bounce has restarted before its duration (${animation.currentTime}ms / ${animation.animationDuration})`);
  }
  return animation;
}

async function assertUploadPanelToggleGeometry(page, viewport, label) {
  const toggle = page.getByRole("button", { name: label, exact: true });
  if (label === "Show upload panel") {
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".files-upload-dialog")).visibility === "hidden");
  }
  await toggle.evaluate((button) => Promise.all([
    ...button.getAnimations(),
    ...(button.closest(".files-upload-shell")?.getAnimations() ?? []),
  ].map((animation) => animation.finished.catch(() => {}))));
  const geometry = await toggle.evaluate((button) => {
    const { left, right, top, bottom, width, height } = button.getBoundingClientRect();
    const dialog = document.querySelector(".files-upload-dialog");
    const shell = document.querySelector(".files-upload-shell");
    const backdrop = document.querySelector(".files-upload-backdrop");
    const style = getComputedStyle(button);
    const shellRect = shell?.getBoundingClientRect();
    const panelRect = dialog?.getBoundingClientRect();
    const icon = button.querySelector("svg");
    const path = icon?.querySelector("path");
    const pathLength = path?.getTotalLength() ?? 0;
    const start = pathLength > 0 ? path.getPointAtLength(0) : null;
    const peak = pathLength > 0 ? path.getPointAtLength(pathLength / 2) : null;
    const end = pathLength > 0 ? path.getPointAtLength(pathLength) : null;
    return {
      left, right, top, bottom, width, height,
      shellLeft: shellRect?.left ?? null,
      shellRight: shellRect?.right ?? null,
      shellTop: shellRect?.top ?? null,
      panelLeft: panelRect?.left ?? null,
      panelRight: panelRect?.right ?? null,
      panelTop: panelRect?.top ?? null,
      panelVisibility: getComputedStyle(dialog).visibility,
      layoutRight: backdrop?.getBoundingClientRect().right ?? window.innerWidth,
      inShell: button.parentElement === shell,
      modalOwner: button.closest('[role="dialog"]') === shell,
      shellRole: shell?.getAttribute("role") ?? "",
      shellModal: shell?.getAttribute("aria-modal") ?? "",
      shellLabelledBy: shell?.getAttribute("aria-labelledby") ?? "",
      sectionAriaHidden: dialog?.getAttribute("aria-hidden") ?? "",
      docked: button.classList.contains("is-docked"),
      toggleCount: document.querySelectorAll(".files-upload-panel-toggle").length,
      display: style.display,
      visibility: style.visibility,
      tabIndex: button.tabIndex,
      disabled: button.disabled,
      arrowPointsUp: Boolean(start && peak && end && peak.y < start.y && peak.y < end.y),
      arrowTransform: icon ? getComputedStyle(icon).transform : "missing",
      expanded: button.getAttribute("aria-expanded"),
      controls: button.getAttribute("aria-controls"),
      dialogId: shell?.id ?? "",
    };
  });
  const desktop = viewport.width > 650;
  const expectedSize = desktop ? { width: 108, height: 36 } : { width: 88, height: 32 };
  const expectedPanelRightGap = desktop ? 72 : 42;
  const expectedTabRightInset = desktop ? 32 : 20;
  const expectedVerticalGap = desktop ? 0 : 70;
  assert.ok(Math.abs(geometry.width - expectedSize.width) <= 1 && Math.abs(geometry.height - expectedSize.height) <= 1,
    `${label} uses the attached arrow-tab size at ${viewport.width}px (${JSON.stringify(geometry)})`);
  assert.ok(geometry.top >= 0 && geometry.bottom <= viewport.height + 1,
    `${label} stays inside the viewport at ${viewport.width}px (${JSON.stringify(geometry)})`);
  assert.equal(geometry.inShell, true, `${label} stays attached to the upload shell at ${viewport.width}px`);
  assert.equal(geometry.docked, false, `${label} keeps the same in-shell position model at ${viewport.width}px`);
  assert.equal(geometry.toggleCount, 1, `${label} is the only upload-panel arrow in the DOM at ${viewport.width}px`);
  assert.equal(geometry.display, "grid", `${label} remains rendered and keyboard-accessible at ${viewport.width}px`);
  assert.equal(geometry.visibility, "visible", `${label} remains visible at ${viewport.width}px`);
  assert.equal(geometry.tabIndex, 0, `${label} remains in the keyboard order at ${viewport.width}px`);
  assert.equal(geometry.disabled, false, `${label} remains enabled at ${viewport.width}px`);
  assert.equal(geometry.arrowPointsUp, true, `${label} always points upward at ${viewport.width}px`);
  assert.ok(geometry.arrowTransform === "none" || /^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*-?\d+(?:\.\d+)?\)$/.test(geometry.arrowTransform),
    `${label} arrow only translates on hover and never rotates at ${viewport.width}px`);
  if (label === "Show upload panel") {
    assert.equal(geometry.shellRole, "", "the collapsed shell leaves the dialog navigation scope");
    assert.equal(geometry.shellModal, "", "the collapsed shell is no longer modal");
    assert.equal(geometry.sectionAriaHidden, "true", "the collapsed panel content stays hidden from assistive technology");
    assert.equal(geometry.panelVisibility, "hidden", "the collapsed upload content hides after its slide animation");
    assert.ok(Math.abs(geometry.right - (geometry.panelRight - expectedTabRightInset)) <= 1 &&
      Math.abs(geometry.panelRight - (geometry.layoutRight - expectedPanelRightGap)) <= 1 && geometry.layoutRight <= viewport.width + 1,
      `${label} stays connected to the panel with the expected viewport inset at ${viewport.width}px (${JSON.stringify(geometry)})`);
    assert.ok(Math.abs(geometry.shellTop - (viewport.height - expectedVerticalGap)) <= 1 &&
      Math.abs(geometry.panelTop - (viewport.height - expectedVerticalGap)) <= 1,
      `the collapsed panel rests below the viewport at ${viewport.width}px (${JSON.stringify(geometry)})`);
    assert.ok(Math.abs(geometry.bottom - (geometry.shellTop + 1)) <= 1,
      `${label} remains joined to the shell edge at ${viewport.width}px (${JSON.stringify(geometry)})`);
    assert.ok(Math.abs(geometry.bottom - (viewport.height - expectedVerticalGap + 1)) <= 1,
      `${label} rests ${expectedVerticalGap}px above the viewport bottom at ${viewport.width}px (${JSON.stringify(geometry)})`);
  } else {
    assert.equal(geometry.modalOwner, true, "the open handle belongs to the modal dialog navigation scope");
    assert.equal(geometry.shellRole, "dialog", "the shell owns the open dialog role");
    assert.equal(geometry.shellModal, "true", "the open shell is modal");
    assert.equal(geometry.shellLabelledBy, `${geometry.dialogId}-title`, "the open shell names its heading");
    assert.equal(geometry.sectionAriaHidden, "false", "the open panel content remains exposed");
    assert.ok(Math.abs(geometry.right - (geometry.panelRight - expectedTabRightInset)) <= 1 &&
      Math.abs(geometry.top - (geometry.panelTop - expectedSize.height + 1)) <= 1 &&
      Math.abs(geometry.shellTop - geometry.panelTop) <= 1,
      `the open arrow tab protrudes above the panel at ${viewport.width}px (${JSON.stringify(geometry)})`);
    assert.ok(Math.abs(geometry.layoutRight - geometry.right - expectedPanelRightGap - expectedTabRightInset) <= 2,
      `the raised tab follows the panel's viewport inset at ${viewport.width}px (${JSON.stringify(geometry)})`);
  }
  assert.equal(geometry.controls, geometry.dialogId, `${label} names the upload panel it controls`);
  assert.equal(geometry.expanded, label === "Hide upload panel" ? "true" : "false");
  return toggle;
}

async function assertUploadPanelExitAnimation(page, initialTop, description) {
  await page.waitForFunction(() => {
    const shell = document.querySelector(".files-upload-shell");
    return shell?.classList.contains("is-collapsed") && getComputedStyle(shell).animationName.includes("files-upload-exit");
  });
  const animation = await page.locator(".files-upload-shell").evaluate(async (shell) => {
    const exit = shell.getAnimations().find((item) => item.animationName === "files-upload-exit");
    const result = {
      name: exit?.animationName ?? "none",
      duration: exit?.effect?.getTiming().duration ?? 0,
      playState: exit?.playState ?? "none",
      samples: [],
    };
    const sample = () => {
      const panel = shell.querySelector(".files-upload-dialog");
      const toggle = shell.querySelector(".files-upload-panel-toggle");
      const icon = toggle?.querySelector("svg");
      const path = icon?.querySelector("path");
      const pathLength = path?.getTotalLength() ?? 0;
      const start = pathLength > 0 ? path.getPointAtLength(0) : null;
      const peak = pathLength > 0 ? path.getPointAtLength(pathLength / 2) : null;
      const end = pathLength > 0 ? path.getPointAtLength(pathLength) : null;
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      const toggleRect = toggle?.getBoundingClientRect();
      if (!panelRect || !toggleRect) return;
      result.samples.push({
        time: exit?.currentTime ?? null,
        shellTop: shellRect.top,
        panelTop: panelRect.top,
        arrowBottom: toggleRect.bottom,
        arrowPointsUp: Boolean(start && peak && end && peak.y < start.y && peak.y < end.y),
      });
    };
    if (exit?.playState === "running") {
      let lastTime = -Infinity;
      let frames = 0;
      while (exit.playState === "running" && frames < 90) {
        const time = Number(exit.currentTime ?? 0);
        if (time - lastTime >= 35) {
          sample();
          lastTime = time;
        }
        frames += 1;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      sample();
    }
    return result;
  });
  assert.equal(animation.name, "files-upload-exit", `${description} plays the shell exit animation`);
  assert.equal(animation.playState, "running", `${description} starts while the shell remains mounted`);
  assert.ok(Math.abs(Number(animation.duration) - 320) <= 2, `${description} uses the 320ms close motion (${animation.duration}ms)`);
  assert.ok(animation.samples.length >= 3, `${description} moves through several visible animation frames (${JSON.stringify(animation.samples)})`);
  const first = animation.samples[0];
  const last = animation.samples.at(-1);
  assert.ok(first && last && last.shellTop - first.shellTop > 40,
    `${description} slides down instead of disappearing immediately (${JSON.stringify(animation.samples)})`);
  assert.ok(Math.abs(first.shellTop - initialTop) <= 8,
    `${description} starts from the panel's current position (${first.shellTop}px vs ${initialTop}px)`);
  assert.ok(animation.samples.every((sample) => Math.abs(sample.arrowBottom - sample.panelTop - 1) <= 1 && sample.arrowPointsUp),
    `${description} keeps the upward arrow attached throughout the close motion (${JSON.stringify(animation.samples)})`);
  return animation;
}

async function dismissUploadPanel(panel, description = "closing the upload panel") {
  const page = panel.page();
  const shell = page.locator(".files-upload-shell");
  const initialTop = await shell.evaluate((element) => element.getBoundingClientRect().top);
  const shouldAnimate = await page.evaluate(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "reduced");
  await panel.locator(".files-upload-close").click();
  if (shouldAnimate) await assertUploadPanelExitAnimation(page, initialTop, description);
  else {
    await page.waitForFunction(() => !document.querySelector(".files-upload-shell")?.getAnimations().some((animation) => animation.animationName === "files-upload-exit"));
  }
  await shell.waitFor({ state: "detached" });
}

async function assertMobileUploadToggleClearOfClose(page) {
  const geometry = await page.evaluate(() => {
    const toggle = document.querySelector(".files-upload-panel-toggle")?.getBoundingClientRect();
    const close = document.querySelector(".files-upload-close")?.getBoundingClientRect();
    if (!toggle || !close) return null;
    return {
      toggle: { left: toggle.left, right: toggle.right, top: toggle.top, bottom: toggle.bottom },
      close: { left: close.left, right: close.right, top: close.top, bottom: close.bottom },
    };
  });
  assert.ok(geometry, "the mobile arrow tab and panel close control both render");
  const overlaps = geometry.toggle.left < geometry.close.right && geometry.toggle.right > geometry.close.left &&
    geometry.toggle.top < geometry.close.bottom && geometry.toggle.bottom > geometry.close.top;
  assert.equal(overlaps, false, `the mobile arrow tab clears the header close control (${JSON.stringify(geometry)})`);
}

async function assertUploadPanelArrowKeyboardWrap(page) {
  const toggle = page.locator(".files-upload-panel-toggle");
  await toggle.focus();
  await page.keyboard.press("Shift+Tab");
  const result = await page.locator(".files-upload-shell").evaluate((dialog) => {
    const selector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";
    const focusable = [...dialog.querySelectorAll(selector)].filter((element) => {
      if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    const last = focusable.at(-1);
    return { wrapped: Boolean(last && document.activeElement === last), lastLabel: last?.getAttribute("aria-label") || last?.textContent.trim() || "" };
  });
  assert.ok(result.wrapped, `Shift+Tab from the arrow reaches the last dialog control (${result.lastLabel})`);
  return result;
}

async function assertUploadFooterFits(panel, description) {
  const geometry = await panel.locator(".files-upload-footer").evaluate((footer) => {
    const rect = (element) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      footer: rect(footer),
      clientWidth: footer.clientWidth,
      scrollWidth: footer.scrollWidth,
      controls: [...footer.querySelectorAll('[aria-label="Do not show again"], button')].map((control) => ({ label: control.getAttribute("aria-label") || control.textContent.trim(), ...rect(control) })),
    };
  });
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `${description} has no horizontal overflow (${JSON.stringify(geometry)})`);
  for (const control of geometry.controls) {
    assert.ok(control.left >= geometry.footer.left - 1 && control.right <= geometry.footer.right + 1, `${description} keeps ${control.label} within the footer (${JSON.stringify(geometry)})`);
  }
  assert.deepEqual(geometry.controls.map((control) => control.label), ["Do not show again", "Cancel selection", "Upload files"], `${description} keeps every staged-file action visible`);
  console.log(`${description}: ${JSON.stringify(geometry)}`);
}

async function readMainContentRect(page) {
  return page.locator(".files-browser-content").evaluate((element) => {
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  });
}

async function assertNewMenuVisualTreatment(page, motionMode) {
  const styles = await page.evaluate(() => {
    const menu = document.querySelector(".files-new-menu");
    const primarySidebar = document.querySelector("#workspace-sidebar");
    const content = document.querySelector(".files-browser-content");
    const trigger = document.querySelector('.files-new-button[aria-haspopup="menu"]');
    const header = document.querySelector(".files-primary-actions .files-browser-header");
    if (!menu || !header || !trigger) return null;
    return {
      menuAnimationName: getComputedStyle(menu).animationName,
      menuAnimationDuration: getComputedStyle(menu).animationDuration,
      menuBackdropFilter: getComputedStyle(menu).backdropFilter,
      headerContainsTrigger: header.contains(trigger),
      primaryFilter: primarySidebar ? getComputedStyle(primarySidebar).filter : "missing",
      contentFilter: content ? getComputedStyle(content).filter : "missing",
      plusTransform: getComputedStyle(trigger.querySelector("svg")).transform,
      plusTransitionDuration: getComputedStyle(trigger.querySelector("svg")).transitionDuration,
      plusTransitionProperty: getComputedStyle(trigger.querySelector("svg")).transitionProperty,
      legacySidebarCount: document.querySelectorAll(".files-sidebar").length,
    };
  });
  assert.ok(styles, "the New menu treatment renders in the Files primary-actions header");
  assert.match(styles.menuBackdropFilter, /blur\(/, `the menu uses frosted glass (${styles.menuBackdropFilter})`);
  assert.equal(styles.headerContainsTrigger, true, "the New button stays in the primary-actions header");
  assert.equal(styles.legacySidebarCount, 0, "opening New does not restore the removed Files sidebar");
  assert.equal(styles.primaryFilter, "none", "the primary sidebar remains readable");
  assert.equal(styles.contentFilter, "none", "the Files page remains readable");

  if (motionMode === "normal") {
    assert.match(styles.menuAnimationName, /files-new-menu-enter/, `the New menu has an entry animation (${styles.menuAnimationName})`);
    assert.ok(durationMs(styles.menuAnimationDuration) > 0, `the New menu animation has a visible duration (${styles.menuAnimationDuration})`);
    assert.ok(durationMs(styles.plusTransitionDuration) > 0, `the New icon rotates with the menu (${styles.plusTransitionDuration})`);
    assert.notEqual(styles.plusTransform, "none", "the New plus icon rotates while the menu is open");
  } else {
    assert.ok(styles.menuAnimationName === "none" || durationMs(styles.menuAnimationDuration) === 0,
      `reduced motion removes the menu animation (${styles.menuAnimationName}, ${styles.menuAnimationDuration})`);
    assert.ok(durationMs(styles.plusTransitionDuration) <= 0.05 && styles.plusTransitionProperty === "none",
      `reduced motion removes the plus transition (${styles.plusTransitionProperty}, ${styles.plusTransitionDuration})`);
  }
  return styles;
}

async function closeDialog(page, name) {
  const dialog = page.getByRole("dialog", { name });
  if (name === "Upload files") {
    await dismissUploadPanel(dialog, "closing the upload panel with its X button");
    return;
  }
  await dialog.getByRole("button", { name: /close/i }).first().click();
  await dialog.waitFor({ state: "detached" });
}

async function assertSidebarIdentity(page) {
  const sidebar = page.locator("#workspace-sidebar");
  if (!(await isInViewport(sidebar.getByText("Johan", { exact: true }), page))) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await sidebar.getByText("Johan", { exact: true }).waitFor({ state: "visible" });
  await sidebar.getByText("comp eng", { exact: true }).waitFor({ state: "visible" });
  const closeNavigation = page.getByRole("button", { name: "Close navigation" });
  const sidebarOpen = await sidebar.evaluate((element) => element.classList.contains("open"));
  if (page.viewportSize().width <= 820) {
    if (sidebarOpen) {
      await page.getByRole("button", { name: "Close navigation overlay" }).evaluate((button) => button.click());
      await page.waitForFunction(() => !document.querySelector("#workspace-sidebar")?.classList.contains("open"));
    }
  } else if (await isInViewport(closeNavigation, page)) {
    await closeNavigation.click();
  }
  const filesNavigation = page.locator("#workspace-sidebar .files-primary-navigation");
  await filesNavigation.getByRole("button", { name: "All files", exact: true }).waitFor({ state: "visible" });
  await filesNavigation.getByRole("button", { name: "Recent", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.locator(".files-primary-navigation").count(), 1, "the Files navigation has one primary-sidebar instance");
  assert.equal(await page.locator(".files-sidebar").count(), 0, "Files has no secondary sidebar");
  assert.equal(await page.getByRole("button", { name: "Recent", exact: true }).count(), 1, "Recent appears once in primary navigation");
  assert.equal(await page.locator(".files-workspace-controls").getByRole("button", { name: "Recent", exact: true }).count(), 0,
    "Recent is not duplicated above Your files");
}

async function exerciseEmptyWorkspace() {
  const viewport = { width: 1672, height: 941 };
  const { context, page } = await createPage(viewport, "empty", {}, { verifyPrimarySidebarModes: true });
  try {
    await assertSidebarIdentity(page);
    assert.equal(await fixture(page, "scenario"), "empty");
    assert.equal((await fixture(page, "files")).length, 0, "the empty fixture has no files");
    assert.equal((await fixture(page, "folders")).length, 0, "the empty fixture has no folders");
    await inspectViewport(page, viewport);
    await inspectFilesAppearance(page, viewport, { expectEmptyArt: true });
    await takeScreenshot(page, "desktop-empty");

    const homeLink = page.getByRole("link", { name: "Home", exact: true });
    await homeLink.click();
    await page.locator(".home-page").waitFor({ state: "visible" });
    await page.locator(".files-primary-navigation").waitFor({ state: "detached" });
    await assertPrimarySidebarMatchesReference(page, "returning from Files to Home with the expanded sidebar");
    await setPrimarySidebarCollapsed(page, true);
    await assertPrimarySidebarMatchesReference(page, "collapsing the shared sidebar on Home");
    await page.getByRole("link", { name: "Files", exact: true }).click();
    await page.locator(".files-browser").waitFor({ state: "visible" });
    await page.locator("#workspace-sidebar .files-primary-navigation").waitFor({ state: "attached" });
    await assertPrimarySidebarMatchesReference(page, "switching from Home to Files with the collapsed sidebar");
    await setPrimarySidebarCollapsed(page, false);
    await page.locator("#workspace-sidebar .files-primary-navigation").waitFor({ state: "visible" });
    await assertPrimarySidebarMatchesReference(page, "expanding the shared sidebar on Files");

    const locationBeforeMenu = await page.evaluate(() => window.location.href);
    const fixtureRequestsBeforeMenu = await fixture(page, "requests");
    const writesBeforeMenu = await fixture(page, "workspaceWrites");
    const menu = await openNewMenu(page);
    await assertNewMenuGeometry(page, viewport);
    const menuStyles = await assertNewMenuVisualTreatment(page, "normal");
    const menuLabels = await menu.getByRole("menuitem").allTextContents().then((labels) => labels.map((label) => label.trim()));
    assert.deepEqual(menuLabels, ["Upload files", "Create new folder", "Text document", "Google Slides", "Google Docs", "Google Drive"]);
    assert.equal(await menu.getByRole("separator").count(), 0, "the New menu has no divider rows");
    await menu.locator("img.files-new-menu-logo").evaluateAll((icons) => Promise.all(icons.map((icon) => icon.decode())));
    const expectedGoogleLinks = [
      ["Google Slides", "https://slides.google.com/"],
      ["Google Docs", "https://docs.google.com/"],
      ["Google Drive", "https://drive.google.com/"],
    ];
    for (const [label, href] of expectedGoogleLinks) {
      const link = menu.locator('a[role="menuitem"]').filter({ hasText: label });
      assert.equal(await link.getAttribute("href"), href);
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    }
    assert.deepEqual(googleServiceRequests, [], "opening the New menu does not request Google services");
    assert.deepEqual(await fixture(page, "requests"), fixtureRequestsBeforeMenu, "opening the New menu does not call the Files API");
    assert.equal(await fixture(page, "workspaceWrites"), writesBeforeMenu, "opening the New menu does not write workspace preferences");
    assert.equal(await page.evaluate(() => window.location.href), locationBeforeMenu, "opening the New menu does not navigate away");
    console.log(`New menu motion and glass: ${JSON.stringify(menuStyles)}`);
    await takeScreenshot(page, "desktop-new-menu");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const slidesLink = menu.locator('a[role="menuitem"]').filter({ hasText: "Google Slides" });
    assert.equal(await slidesLink.evaluate((link) => document.activeElement === link), true, "ArrowDown keyboard navigation reaches the first external link");
    const popupPromise = context.waitForEvent("page");
    await page.keyboard.press("Enter");
    const popup = await popupPromise;
    await popup.waitForURL("https://slides.google.com/");
    assert.equal(await popup.evaluate(() => window.opener), null, "the external tab has no opener");
    await menu.waitFor({ state: "detached" });
    assert.deepEqual(googleServiceRequests, [{ url: "https://slides.google.com/", method: "GET" }], "only activating Slides requests its destination");
    await popup.close();

    const outsideClickMenu = await openNewMenu(page);
    await assertNewMenuGeometry(page, viewport);
    await page.mouse.click(viewport.width - 12, viewport.height / 2);
    await outsideClickMenu.waitFor({ state: "detached" });
    assert.equal(await page.locator('.files-new-button[aria-haspopup="menu"]').getAttribute("aria-expanded"), "false",
      "clicking outside the New menu closes it");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedPreferenceMenu = await openNewMenu(page);
    await assertNewMenuVisualTreatment(page, "reduced");
    await page.keyboard.press("Escape");
    await reducedPreferenceMenu.waitFor({ state: "detached" });

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => { document.documentElement.dataset.motion = "reduced"; });
    const reducedSettingMenu = await openNewMenu(page);
    await assertNewMenuVisualTreatment(page, "reduced");
    await page.keyboard.press("Escape");
    await reducedSettingMenu.waitFor({ state: "detached" });
    await page.evaluate(() => { delete document.documentElement.dataset.motion; });

    const mainBeforeUpload = await readMainContentRect(page);
    const uploadPostsBeforeOpen = uploadPosts.length;
    await openNewMenu(page);
    await clickFilesMenuItem(page, "Upload files");
    const uploadDialog = page.getByRole("dialog", { name: "Upload files" });
    await uploadDialog.waitFor({ state: "visible" });
    const uploadInput = uploadDialog.locator('input[type="file"]');
    await uploadInput.waitFor({ state: "attached" });
    const multipleFiles = await uploadInput.evaluate((input) => input.multiple);
    assert.equal(multipleFiles, true, "the Upload files panel accepts more than one file");
    await assertUploadPanelGeometry(page, viewport, mainBeforeUpload);
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "opening the chooser does not POST files");
    await takeScreenshot(page, "desktop-upload-files");
    await closeDialog(page, "Upload files");

    await openNewMenu(page);
    await clickFilesMenuItem(page, "Create new folder");
    const folderDialog = page.getByRole("dialog", { name: "Create folder" });
    await folderDialog.waitFor({ state: "visible" });
    await folderDialog.getByLabel("Folder name").fill("Lab notebook");
    await takeScreenshot(page, "desktop-new-folder");
    await folderDialog.getByRole("button", { name: "Create folder", exact: true }).click();
    await page.getByRole("button", { name: "Open folder: Lab notebook" }).waitFor({ state: "visible" });
    assert.ok((await fixture(page, "folders")).some((folder) => folder.name === "Lab notebook"), "folder creation reaches only the local fixture backend");
    await takeScreenshot(page, "desktop-folder-created");

    await openNewMenu(page);
    await clickFilesMenuItem(page, "Text document");
    const editor = page.getByRole("dialog").filter({ has: page.getByLabel("Text") });
    await editor.waitFor({ state: "visible" });
    const editorTitle = await editor.getByRole("heading").innerText();
    assert.match(editorTitle, /text|document/i, `the text sheet title follows the text creation action (${editorTitle})`);
    await editor.getByLabel("File name").waitFor({ state: "visible" });
    await takeScreenshot(page, "desktop-text-document");
    assert.ok((await fixture(page, "files")).some((file) => file.content_backend === "native-text"), "text document creation uses the local API fixture");
    await editor.getByRole("button", { name: "Close text editor" }).click();
    await editor.waitFor({ state: "detached" });

    const finalMetrics = await inspectViewport(page, viewport);
    const requests = await fixture(page, "requests");
    const profileId = await fixture(page, "profile").then((item) => item.id);
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.profileId === "" || request.profileId === profileId), "all authenticated mock requests stay scoped to Johan's profile");
    console.log(`Desktop empty flow: ${JSON.stringify(finalMetrics)}`);
  } finally {
    await context.close();
  }
}

async function captureWideEmptyAndUpload(viewport, screenshotPrefix) {
  const { context, page } = await createPage(viewport, "empty");
  try {
    await assertSidebarIdentity(page);
    assert.equal((await fixture(page, "files")).length, 0, "the wide empty fixture has no files");
    await inspectViewport(page, viewport);
    await inspectFilesAppearance(page, viewport, { expectEmptyArt: true });
    await takeScreenshot(page, `${screenshotPrefix}-empty`);
    const menu = await openNewMenu(page);
    await assertNewMenuGeometry(page, viewport);
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents().then((labels) => labels.map((label) => label.trim())), [
      "Upload files", "Create new folder", "Text document", "Google Slides", "Google Docs", "Google Drive",
    ]);
    assert.equal(await menu.getByRole("separator").count(), 0);
    await menu.locator("img.files-new-menu-logo").evaluateAll((icons) => Promise.all(icons.map((icon) => icon.decode())));
    await takeScreenshot(page, `${screenshotPrefix}-new-menu`);
    const mainBeforeUpload = await readMainContentRect(page);
    const uploadPostsBeforeOpen = uploadPosts.length;
    await clickFilesMenuItem(page, "Upload files");
    const uploadDialog = page.getByRole("dialog", { name: "Upload files" });
    await uploadDialog.waitFor({ state: "visible" });
    assert.equal(await uploadDialog.locator('input[type="file"]').evaluate((input) => input.multiple), true);
    await assertUploadPanelGeometry(page, viewport, mainBeforeUpload);
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "opening the wide chooser does not POST files");
    await takeScreenshot(page, `${screenshotPrefix}-upload-files`);
  } finally {
    await context.close();
  }
}

async function exercisePopulatedWorkspace(viewport, screenshotPrefix) {
  const { context, page } = await createPage(viewport, "populated");
  try {
    await assertSidebarIdentity(page);
    assert.equal((await fixture(page, "files")).length, 2, "the populated fixture has sample file content");
    await page.locator(".files-item").first().waitFor({ state: "visible" });
    await inspectViewport(page, viewport);
    await inspectFilesAppearance(page, viewport);
    await takeScreenshot(page, `${screenshotPrefix}-populated`);

    const selectionControls = page.locator(".files-item-select");
    const selectionOpacity = () => selectionControls.evaluateAll((controls) => controls.map((control) => getComputedStyle(control).opacity));
    const visibleItemCount = await page.locator(".files-item").count();
    assert.equal(await selectionControls.count(), visibleItemCount, "each visible folder or file has a selection control");
    assert.deepEqual(await selectionOpacity(), Array(visibleItemCount).fill("0"), "selection controls stay visually hidden until an item is selected");
    await page.getByRole("button", { name: "Actions for My files", exact: true }).click();
    await page.getByRole("menuitem", { name: "Select visible", exact: true }).click();
    const bulkActions = page.getByRole("group", { name: "Bulk file actions" });
    await bulkActions.waitFor({ state: "visible" });
    assert.deepEqual(await selectionOpacity(), Array(visibleItemCount).fill("1"), "selecting visible reveals every visible item checkbox");
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await bulkActions.waitFor({ state: "detached" });
    await page.mouse.move(viewport.width - 24, viewport.height - 100);
    assert.deepEqual(await selectionOpacity(), Array(visibleItemCount).fill("0"), "clearing selection hides the checkboxes again");

    await page.getByRole("button", { name: "Open folder: CPE 281", exact: true }).click();
    await page.getByRole("button", { name: "Open folder: FPGA lab", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Open folder: FPGA lab", exact: true }).click();
    await page.locator(".files-breadcrumbs").getByRole("button", { name: "FPGA lab", exact: true }).waitFor({ state: "visible" });
    await page.locator(".files-breadcrumbs").getByRole("button", { name: "My files", exact: true }).click();
    await page.getByRole("button", { name: "Open folder: CPE 281", exact: true }).waitFor({ state: "visible" });

    await clickPrimaryFileView(page, "Recent");
    await page.waitForFunction(() => new URL(window.location.href).searchParams.get("view") === "recent");
    await clickPrimaryFileView(page, "All files");
    await page.waitForFunction(() => new URL(window.location.href).searchParams.get("view") === "my-files");

    const search = page.getByRole("searchbox", { name: "Search files", exact: true });
    const notesRow = page.locator(".files-item").filter({ hasText: "Digital systems notes.txt" }).first();
    await search.fill("Digital systems notes");
    await notesRow.locator(".files-item-main").waitFor({ state: "visible" });
    await search.fill("no matching file in this fixture");
    await page.getByText(/No files match your search|No matching files|No results found/i).waitFor({ state: "visible" });
    await search.fill("");

    await notesRow.locator(".files-item-main").click();
    const preview = page.getByRole("dialog", { name: "Private file preview" });
    await preview.waitFor({ state: "visible" });
    await preview.locator(".syllabus-source").waitFor({ state: "visible" });
    const body = await preview.locator(".syllabus-source").innerText();
    assert.match(body, /Week 4: finite state machines/);
    assert.match(body, /Verify reset behavior before testing transitions/);
    await takeScreenshot(page, `${screenshotPrefix}-preview`);
    await closeDialog(page, "Private file preview");
    await page.locator(".files-workspace-controls").getByRole("button", { name: "Home", exact: true }).click();
    await page.locator(".files-home-sections").waitFor({ state: "visible" });
    await page.locator(".files-all-section .files-item.is-file").first().waitFor({ state: "visible" });
    if (viewport.width <= 430) {
      const compactFolder = page.locator(".files-all-section .files-item.is-folder").filter({ hasText: "CPE 281" }).first();
      await compactFolder.waitFor({ state: "visible" });
      await compactFolder.scrollIntoViewIfNeeded();
      const folderCardGeometry = await compactFolder.evaluate((card) => {
        const title = card.querySelector(".files-item-title strong");
        const count = card.querySelector(".files-item-title small");
        const bounds = (element) => {
          if (!element) return null;
          const { left, right, width, height } = element.getBoundingClientRect();
          return { left, right, width, height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
        };
        return { width: card.getBoundingClientRect().width, title: bounds(title), count: bounds(count) };
      });
      assert.ok(folderCardGeometry.width >= 155, `the compact mobile folder card keeps its minimum width (${JSON.stringify(folderCardGeometry)})`);
      assert.equal(folderCardGeometry.title?.scrollWidth <= folderCardGeometry.title?.clientWidth,
        true, `CPE 281 remains visible in the compact mobile folder card (${JSON.stringify(folderCardGeometry)})`);
      assert.equal(folderCardGeometry.count?.scrollWidth <= folderCardGeometry.count?.clientWidth,
        true, `the 0 files count remains visible in the compact mobile folder card (${JSON.stringify(folderCardGeometry)})`);
      await takeScreenshot(page, `${screenshotPrefix}-home-folder-card`);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const compactPreviewGeometry = await page.locator(".files-all-section .files-item.is-file").first().evaluate((card) => {
      const bounds = (selector) => {
        const element = card.querySelector(selector);
        if (!element) return null;
        const { top, bottom, height } = element.getBoundingClientRect();
        return { top, bottom, height };
      };
      const cardRect = card.getBoundingClientRect();
      return {
        card: { top: cardRect.top, bottom: cardRect.bottom, height: cardRect.height },
        preview: bounds(".files-card-preview"),
        metadata: bounds(".files-item-main"),
      };
    });
    assert.ok(compactPreviewGeometry.preview && compactPreviewGeometry.metadata,
      `the compact All files preview and metadata render (${JSON.stringify(compactPreviewGeometry)})`);
    assert.ok(compactPreviewGeometry.preview.height <= 140,
      `the compact All files preview fits its short card track (${JSON.stringify(compactPreviewGeometry)})`);
    assert.ok(compactPreviewGeometry.preview.bottom <= compactPreviewGeometry.metadata.top + 1,
      `the compact preview does not overlap file metadata (${JSON.stringify(compactPreviewGeometry)})`);
    assert.ok(compactPreviewGeometry.metadata.bottom <= compactPreviewGeometry.card.bottom + 1,
      `file metadata stays inside the compact card (${JSON.stringify(compactPreviewGeometry)})`);
    await takeScreenshot(page, `${screenshotPrefix}-home-recent-all`);
    const recentPreview = page.getByRole("button", { name: "Open recently opened file: Digital systems notes.txt", exact: true });
    await recentPreview.waitFor({ state: "visible" });
    const recentPreviewGeometry = await recentPreview.evaluate((card) => {
      const bounds = (selector) => {
        const element = card.querySelector(selector);
        if (!element) return null;
        const { top, bottom, height } = element.getBoundingClientRect();
        return { top, bottom, height };
      };
      const cardRect = card.getBoundingClientRect();
      return {
        card: { top: cardRect.top, bottom: cardRect.bottom },
        preview: bounds(".files-recent-card-preview"),
        name: bounds(".files-recent-card-name"),
        metadata: bounds(".files-recent-card-kind"),
      };
    });
    assert.ok(recentPreviewGeometry.preview && recentPreviewGeometry.name && recentPreviewGeometry.metadata,
      `the Recent card preview and metadata render (${JSON.stringify(recentPreviewGeometry)})`);
    assert.ok(recentPreviewGeometry.preview.bottom <= recentPreviewGeometry.name.top + 1,
      `the Recent preview stays above the filename (${JSON.stringify(recentPreviewGeometry)})`);
    assert.ok(recentPreviewGeometry.name.bottom <= recentPreviewGeometry.metadata.top + 1,
      `the filename stays above Recent metadata (${JSON.stringify(recentPreviewGeometry)})`);
    assert.ok(recentPreviewGeometry.metadata.bottom <= recentPreviewGeometry.card.bottom + 1,
      `Recent metadata stays inside its preview card (${JSON.stringify(recentPreviewGeometry)})`);
    const previewIdentity = await recentPreview.evaluate((button) => ({
      isStandaloneButton: button.tagName === "BUTTON" && !button.closest(".files-item"),
      selectionControls: button.querySelectorAll(".files-item-select,input[type=checkbox]").length,
      draggableRows: button.querySelectorAll("[draggable=true]").length,
      cardClass: button.classList.contains("files-recent-card"),
    }));
    assert.deepEqual(previewIdentity, { isStandaloneButton: true, selectionControls: 0, draggableRows: 0, cardClass: true },
      "a Recent preview is a dedicated button without a bulk-selection or drag row");
    await recentPreview.click();
    await page.getByRole("dialog", { name: "Private file preview" }).waitFor({ state: "visible" });
    await closeDialog(page, "Private file preview");
    await inspectViewport(page, viewport);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function exerciseRichGridWorkspace(viewport, screenshotPrefix) {
  const { context, page } = await createPage(viewport, "rich-grid");
  try {
    await assertSidebarIdentity(page);
    const files = await fixture(page, "files");
    const folders = await fixture(page, "folders");
    assert.equal(files.length, 6, "the rich grid fixture contains six real preview files");
    assert.equal(folders.filter((folder) => folder.parent_id === null).length, 3, "the rich grid fixture contains three top-level folder strips");
    assert.equal(folders.length, 4, "the CPE course path retains its nested FPGA lab folder");
    await page.locator(".files-items.is-grid").waitFor({ state: "visible" });
    assert.equal(await page.locator('.files-layout-toggle button[aria-label="Grid view"]').getAttribute("aria-pressed"), "true", "the rich grid scenario opens in grid layout");
    await page.locator(".files-item.is-file").first().waitFor({ state: "visible" });
    assert.equal(await page.locator(".files-item.is-file").count(), 6, "all six file cards render in the grid");
    assert.equal(await page.locator(".files-item.is-folder").count(), 3, "the three root folders render as cards");
    await inspectViewport(page, viewport);
    await inspectFilesAppearance(page, viewport);

    const cardFor = (name) => page.locator(".files-item.is-file").filter({ hasText: name });
    const textCard = cardFor("Digital systems notes.txt");
    await textCard.scrollIntoViewIfNeeded();
    const textPreview = textCard.locator(".files-card-preview-content pre");
    await textPreview.waitFor({ state: "visible" });
    assert.match(await textPreview.innerText(), /Week 4: finite state machines/);

    const imageCard = cardFor("FSM transition diagram.svg");
    await imageCard.scrollIntoViewIfNeeded();
    const previewImage = imageCard.locator(".files-card-preview-content img");
    await previewImage.waitFor({ state: "visible" });
    const imageEvidence = await previewImage.evaluate((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, source: image.currentSrc }));
    assert.ok(imageEvidence.complete && imageEvidence.naturalWidth >= 640 && imageEvidence.naturalHeight >= 360, `the image card renders its real diagram bytes (${JSON.stringify(imageEvidence)})`);

    const pdfCard = cardFor("Logic design review.pdf");
    await pdfCard.scrollIntoViewIfNeeded();
    const pdfThumbnail = pdfCard.locator(".files-card-preview-content img.files-card-pdf-preview");
    await pdfThumbnail.waitFor({ state: "visible" });
    const pdfThumbnailEvidence = await pdfThumbnail.evaluate(async (image) => {
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not inspect the rendered PDF thumbnail pixels.");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let inkPixels = 0;
      let topInk = canvas.height;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] < 220 && pixels[offset + 1] < 220 && pixels[offset + 2] < 220) {
          inkPixels += 1;
          topInk = Math.min(topInk, Math.floor(offset / 4 / canvas.width));
        }
      }
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        aspectRatio: image.naturalWidth / image.naturalHeight,
        source: image.currentSrc.slice(0, 22),
        inkPixels,
        topInkRatio: topInk / canvas.height,
      };
    });
    assert.ok(pdfThumbnailEvidence.width >= 160 && pdfThumbnailEvidence.height >= 200, `the PDF card renders a usable thumbnail at its actual grid width (${JSON.stringify(pdfThumbnailEvidence)})`);
    assert.ok(Math.abs(pdfThumbnailEvidence.aspectRatio - 612 / 792) < 0.02, `the PDF thumbnail keeps the complete page's aspect ratio (${JSON.stringify(pdfThumbnailEvidence)})`);
    assert.ok(pdfThumbnailEvidence.inkPixels > 20, `the PDF thumbnail contains rendered document content instead of a blank page (${JSON.stringify(pdfThumbnailEvidence)})`);
    assert.ok(pdfThumbnailEvidence.topInkRatio < 0.3, `the first-page text appears near the top of the thumbnail (${JSON.stringify(pdfThumbnailEvidence)})`);
    assert.ok(pdfThumbnailEvidence.source.startsWith("data:image/png"), "the PDF page is rendered locally from the authenticated document bytes");
    const pdfId = files.find((file) => file.name === "Logic design review.pdf").id;
    const pdfBytes = await page.evaluate(async (id) => {
      const response = await fetch(`/api/files?id=${encodeURIComponent(id)}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, type: response.headers.get("content-type"), signature: new TextDecoder().decode(bytes.slice(0, 8)), eof: new TextDecoder().decode(bytes.slice(-8)) };
    }, pdfId);
    assert.equal(pdfBytes.status, 200);
    assert.equal(pdfBytes.type, "application/pdf");
    assert.equal(pdfBytes.signature, "%PDF-1.4");
    assert.match(pdfBytes.eof, /%%EOF/);
    assert.equal(pdfThumbnailEvidence.source, "data:image/png;base64,", "the PDF thumbnail is rendered from the actual PDF document");

    const officeCard = cardFor("Lab checklist.docx");
    await officeCard.scrollIntoViewIfNeeded();
    const officeMetadata = files.find((file) => file.name === "Lab checklist.docx");
    assert.equal(officeMetadata.mime_type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "the Office card keeps its truthful MIME type");
    const officeFallback = officeCard.locator(".files-card-preview-fallback");
    await officeFallback.waitFor({ state: "visible" });
    const requestsBeforeOfficeProof = await fixture(page, "requests");
    assert.equal(requestsBeforeOfficeProof.some((request) => request.url === `/api/files?id=${officeMetadata.id}`), false, "an unsupported Office document stays on its honest icon fallback without reading the bytes for preview");
    const officeBytes = await page.evaluate(async (id) => {
      const response = await fetch(`/api/files?id=${encodeURIComponent(id)}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, type: response.headers.get("content-type"), signature: [...bytes.slice(0, 4)] };
    }, officeMetadata.id);
    assert.equal(officeBytes.status, 200);
    assert.equal(officeBytes.type, officeMetadata.mime_type);
    assert.deepEqual(officeBytes.signature, [0x50, 0x4b, 0x03, 0x04], "the Office fallback is backed by a real OOXML zip document");

    const requests = await fixture(page, "requests");
    for (const name of ["Digital systems notes.txt", "FSM transition diagram.svg", "Logic design review.pdf"]) {
      const file = files.find((item) => item.name === name);
      assert.ok(requests.some((request) => request.url === `/api/files?id=${file.id}`), `${name} loads from the local authenticated fixture`);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await takeScreenshot(page, `${screenshotPrefix}-populated`);

    await pdfCard.locator(".files-card-preview").click();
    const pdfDialog = page.getByRole("dialog", { name: "Private file preview" });
    await pdfDialog.waitFor({ state: "visible" });
    const openedPdf = pdfDialog.locator("iframe.private-pdf-preview");
    await openedPdf.waitFor({ state: "visible" });
    assert.match(await openedPdf.getAttribute("src"), /^blob:/, "activating a card opens the real PDF in the file preview dialog");
    await closeDialog(page, "Private file preview");

    await page.getByRole("button", { name: "List view", exact: true }).click();
    await page.locator(".files-items.is-list").waitFor({ state: "visible" });
    const notesRow = cardFor("Digital systems notes.txt").locator(".files-item-main");
    await notesRow.click();
    const textDialog = page.getByRole("dialog", { name: "Private file preview" });
    await textDialog.waitFor({ state: "visible" });
    const openedText = textDialog.locator(".syllabus-source");
    await openedText.waitFor({ state: "visible" });
    assert.match(await openedText.innerText(), /Verify reset behavior before testing transitions/);
    await takeScreenshot(page, `${screenshotPrefix}-row-preview`);
    await closeDialog(page, "Private file preview");
  } finally {
    await context.close();
  }
}

async function exercisePreferenceAppearanceMigration() {
  const viewport = { width: 1672, height: 941 };
  const { context, page } = await createPage(viewport, "legacy-list", { layout: "list" });
  try {
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("layout", "list");
      window.history.replaceState(window.history.state, "", url);
    });
    await page.waitForFunction(() => new URL(window.location.href).searchParams.get("layout") === "list");
    const legacyPreferences = await fixture(page, "dashboard.d.filePreferences");
    assert.deepEqual(legacyPreferences, { filter: "all", view: "list", sortBy: "name" }, "the fixture starts with a pre-appearance-version saved list preference");
    assert.equal(await page.locator('.files-layout-toggle button[aria-label="Grid view"]').getAttribute("aria-pressed"), "true", "legacy list preferences upgrade to the new grid default");
    assert.equal(await fixture(page, "workspaceWrites"), 0, "displaying the in-memory migration does not autosave it");
    await takeScreenshot(page, "preference-migration-grid");

    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("File type", { exact: true }).selectOption("pdf");
    await page.waitForFunction(() => {
      const fixture = window.__filesReferenceFixture;
      return fixture.workspaceWrites > 0 && fixture.dashboard.d.filePreferences?.appearanceVersion === 2;
    });
    const migratedPreferences = await fixture(page, "dashboard.d.filePreferences");
    assert.equal(migratedPreferences.view, "grid", "the first preference edit persists the upgraded grid default");
    assert.equal(migratedPreferences.sortBy, "modified");
    assert.equal(migratedPreferences.sortDirection, "desc");
    assert.equal(migratedPreferences.fileType, "pdf", "the first preference edit keeps the user's filter change");
    assert.equal(migratedPreferences.appearanceVersion, 2);
    assert.equal(new URL(page.url()).searchParams.get("layout"), "grid", "the first preference edit normalizes the old URL layout to grid");

    await page.locator('.files-layout-toggle button[aria-label="List view"]').click();
    await page.locator(".files-items.is-list").waitFor({ state: "visible" });
    await page.waitForFunction(() => window.__filesReferenceFixture.dashboard.d.filePreferences?.view === "list");
    const explicitList = await fixture(page, "dashboard.d.filePreferences");
    assert.equal(explicitList.view, "list");
    assert.equal(explicitList.appearanceVersion, 2, "an explicit List choice carries the new appearance marker");
    assert.equal(new URL(page.url()).searchParams.get("layout"), "list");

    await page.goto(`${baseUrl}/home?scenario=legacy-list`);
    await enterFilesView(page);
    assert.equal(await page.locator('.files-layout-toggle button[aria-label="List view"]').getAttribute("aria-pressed"), "true", "an explicit List choice remains after a full browser reload");
    await page.locator(".files-items.is-list").waitFor({ state: "visible" });
    const savedAfterReload = await fixture(page, "dashboard.d.filePreferences");
    assert.equal(savedAfterReload.view, "list");
    assert.equal(savedAfterReload.appearanceVersion, 2);
    assert.equal(await fixture(page, "workspaceWrites"), 0, "reloading an explicitly saved List choice does not write another revision");

  } finally {
    await context.close();
  }
}

async function exerciseMobileEmptyWorkspace() {
  const viewport = { width: 390, height: 844 };
  const { context, page } = await createPage(viewport, "empty");
  try {
    await assertSidebarIdentity(page);
    assert.equal((await fixture(page, "files")).length, 0, "the mobile empty fixture has no files");
    assert.equal((await fixture(page, "folders")).length, 0, "the mobile empty fixture has no folders");
    await inspectViewport(page, viewport);
    await takeScreenshot(page, "mobile-390-empty");
    const trigger = page.getByRole("button", { name: "New", exact: true });
    const menu = await openNewMenu(page);
    await assertNewMenuGeometry(page, viewport);
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents().then((labels) => labels.map((label) => label.trim())), [
      "Upload files", "Create new folder", "Text document", "Google Slides", "Google Docs", "Google Drive",
    ]);
    await menu.locator("img.files-new-menu-logo").evaluateAll((icons) => Promise.all(icons.map((icon) => icon.decode())));
    await takeScreenshot(page, "mobile-390-new-menu");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate((button) => document.activeElement === button), true, "Escape restores focus to New on mobile");
    const mainBeforeUpload = await readMainContentRect(page);
    const uploadPostsBeforeOpen = uploadPosts.length;
    await openNewMenu(page);
    await clickFilesMenuItem(page, "Upload files");
    const uploadDialog = page.getByRole("dialog", { name: "Upload files" });
    await uploadDialog.waitFor({ state: "visible" });
    const persistentToggle = page.locator(".files-upload-panel-toggle");
    await persistentToggle.evaluate((button) => { window.__filesUploadPersistentToggle = button; });
    await assertUploadPanelBounce(page);
    await assertUploadPanelToggleGeometry(page, viewport, "Hide upload panel");
    const initialPanelGeometry = await assertUploadPanelGeometry(page, viewport, mainBeforeUpload);
    await assertMobileUploadToggleClearOfClose(page);
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "opening the mobile chooser does not POST files");
    await takeScreenshot(page, "mobile-390-upload-panel");
    const mobileFile = { name: "mobile-preview.txt", mimeType: "text/plain", buffer: Buffer.from("This mobile preview stays on this device until confirmation.") };
    await uploadDialog.locator('input[type="file"]').setInputFiles([mobileFile]);
    await uploadDialog.locator(".files-local-preview-text").waitFor({ state: "visible" });
    await page.getByText("This mobile preview stays on this device until confirmation.", { exact: true }).waitFor({ state: "visible" });
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "staging a mobile File and rendering its preview still sends no POST");
    const previewPanelGeometry = await assertUploadPanelGeometry(page, viewport, mainBeforeUpload);
    assert.ok(previewPanelGeometry.panel.height > initialPanelGeometry.panel.height + 20,
      `adding the local preview changes panel height at ${viewport.width}px (${initialPanelGeometry.panel.height}px → ${previewPanelGeometry.panel.height}px)`);
    assert.ok(Math.abs(previewPanelGeometry.toggle.bottom - previewPanelGeometry.panel.top - 1) <= 1,
      `the raised arrow stays connected after the preview changes the panel height at ${viewport.width}px (${JSON.stringify({ arrow: previewPanelGeometry.toggle, panel: previewPanelGeometry.panel })})`);
    await assertUploadFooterFits(uploadDialog, "mobile staged-upload footer");
    await takeScreenshot(page, "mobile-390-staged-local-preview");

    const settingsButton = uploadDialog.getByRole("button", { name: "Upload settings", exact: true });
    await settingsButton.click();
    const settingsMenu = uploadDialog.getByRole("menu", { name: "Upload settings" });
    await settingsMenu.waitFor({ state: "visible" });
    assert.equal(await settingsButton.getAttribute("aria-expanded"), "true", "the settings control opens without collapsing the upload panel");
    assert.equal(await page.locator(".files-upload-dialog").getAttribute("aria-hidden"), "false");
    await settingsButton.click();
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "opening and closing upload settings does not POST the staged file");

    await page.mouse.click(viewport.width / 2, 10);
    await page.waitForFunction(() => document.querySelector(".files-upload-dialog")?.getAttribute("aria-hidden") === "true");
    const collapsedByOutsideClick = await assertUploadPanelToggleGeometry(page, viewport, "Show upload panel");
    assert.equal(await collapsedByOutsideClick.evaluate((button) => button === window.__filesUploadPersistentToggle), true,
      "outside click keeps the same arrow button in the DOM");
    const collapsedStagedRow = page.locator(".files-upload-dialog [data-local-file-id]");
    assert.equal(await collapsedStagedRow.count(), 1, "outside click keeps the staged File mounted for a later confirmation");
    assert.equal(await page.locator(".files-upload-dialog").evaluate((panel) => getComputedStyle(panel).visibility), "hidden",
      "the closed mobile panel hides its content while the small handle stays above the navigation area");
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "outside click collapses without POSTing the staged file");
    await takeScreenshot(page, "mobile-390-upload-panel-collapsed-outside-click");

    await collapsedByOutsideClick.click();
    await uploadDialog.waitFor({ state: "visible" });
    await assertUploadPanelBounce(page, { replay: true });
    await assertUploadPanelToggleGeometry(page, viewport, "Hide upload panel");
    assert.equal(await persistentToggle.evaluate((button) => button === window.__filesUploadPersistentToggle), true,
      "reopening keeps the original arrow button");
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "reopening after outside click keeps the staged File local");

    const hide = await assertUploadPanelToggleGeometry(page, viewport, "Hide upload panel");
    const panelTopBeforeHide = await page.locator(".files-upload-shell").evaluate((shell) => shell.getBoundingClientRect().top);
    await hide.click();
    await page.waitForFunction(() => document.querySelector(".files-upload-dialog")?.getAttribute("aria-hidden") === "true");
    await assertUploadPanelExitAnimation(page, panelTopBeforeHide, "hiding the upload panel with its arrow");
    await assertUploadPanelToggleGeometry(page, viewport, "Show upload panel");
    await page.waitForFunction(() => document.activeElement === document.querySelector('[aria-label="Show upload panel"]'));
    assert.equal(await page.locator(".files-upload-dialog [data-local-file-id]").count(), 1, "the staged mobile File remains mounted while the panel is collapsed");
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "hiding the mobile panel does not POST the staged File");
    await takeScreenshot(page, "mobile-390-upload-panel-collapsed");

    await page.keyboard.press("Space");
    await uploadDialog.waitFor({ state: "visible" });
    await assertUploadPanelBounce(page, { replay: true });
    await assertUploadPanelGeometry(page, viewport, mainBeforeUpload);
    await page.waitForFunction(() => document.activeElement === document.querySelector(".files-upload-choose"));
    await page.getByText("This mobile preview stays on this device until confirmation.", { exact: true }).waitFor({ state: "visible" });
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "reopening the mobile panel keeps the staged File local");
    await takeScreenshot(page, "mobile-390-upload-panel-reopened");

    await assertUploadPanelArrowKeyboardWrap(page);
    const hideByKeyboard = await assertUploadPanelToggleGeometry(page, viewport, "Hide upload panel");
    await hideByKeyboard.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".files-upload-dialog")?.getAttribute("aria-hidden") === "true" && document.activeElement?.getAttribute("aria-label") === "Show upload panel");
    await page.keyboard.press("Space");
    await uploadDialog.waitFor({ state: "visible" });
    await assertUploadPanelBounce(page, { replay: true });
    await assertUploadPanelGeometry(page, viewport, mainBeforeUpload);
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "keyboard hide and reopen leave the staged mobile File local");
    await page.getByText("This mobile preview stays on this device until confirmation.", { exact: true }).waitFor({ state: "visible" });
    await dismissUploadPanel(uploadDialog, "closing the mobile upload panel with its X button");
    assert.equal(uploadPosts.length, uploadPostsBeforeOpen, "closing the mobile review drops no upload request");
  } finally {
    await context.close();
  }
}

async function exerciseUploadPanelReducedMotion() {
  const viewport = { width: 390, height: 844 };
  const { context, page } = await createPage(viewport, "empty");
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openNewMenu(page);
    await clickFilesMenuItem(page, "Upload files");
    const osReducedPanel = page.getByRole("dialog", { name: "Upload files" });
    await osReducedPanel.waitFor({ state: "visible" });
    await assertUploadPanelBounce(page, { reducedMotion: true });
    await assertUploadPanelGeometry(page, viewport);
    await closeDialog(page, "Upload files");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => { document.documentElement.dataset.motion = "reduced"; });
    await openNewMenu(page);
    await clickFilesMenuItem(page, "Upload files");
    const savedReducedPanel = page.getByRole("dialog", { name: "Upload files" });
    await savedReducedPanel.waitFor({ state: "visible" });
    await assertUploadPanelBounce(page, { reducedMotion: true });
    await assertUploadPanelGeometry(page, viewport);
  } finally {
    await context.close();
  }
}

async function fixtureFileBuffer(page, exactName) {
  const file = (await fixture(page, "files")).find((item) => item.name === exactName);
  assert.ok(file, `the local reference fixture includes ${exactName}`);
  const bytes = await page.evaluate(async (id) => {
    const response = await fetch(`/api/files?id=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Fixture bytes for ${id} returned ${response.status}`);
    return [...new Uint8Array(await response.arrayBuffer())];
  }, file.id);
  return { name: exactName, mimeType: file.mime_type, buffer: Buffer.from(bytes) };
}

async function chooseLocalPreview(page, panel, fileName, selector, evidence) {
  const row = panel.locator("[data-local-file-id]").filter({ hasText: fileName }).first();
  await row.waitFor({ state: "visible" });
  await row.getByRole("button", { name: /Preview/i }).click();
  const preview = panel.locator(selector);
  await preview.waitFor({ state: "visible" });
  if (evidence === "image") {
    await page.waitForFunction(() => {
      const image = document.querySelector(".files-local-preview img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
    const imageEvidence = await preview.evaluate((image) => ({ src: image.getAttribute("src"), width: image.naturalWidth, height: image.naturalHeight }));
    assert.match(imageEvidence.src, /^blob:/, `the image preview comes from the local File (${JSON.stringify(imageEvidence)})`);
    assert.ok(imageEvidence.width > 0 && imageEvidence.height > 0, `the local image decodes in the browser (${JSON.stringify(imageEvidence)})`);
  } else if (evidence === "pdf") {
    const image = preview;
    await page.waitForFunction(() => {
      const node = document.querySelector(".files-local-preview-pdf img");
      return node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0;
    });
    const imageEvidence = await image.evaluate((node) => ({ src: node.getAttribute("src"), width: node.naturalWidth, height: node.naturalHeight }));
    assert.match(imageEvidence.src, /^data:image\/png;base64,/, `the PDF preview is rendered from local bytes to a canvas data URL (${JSON.stringify(imageEvidence)})`);
    assert.ok(imageEvidence.width > 0 && imageEvidence.height > 0, `the first PDF page rendered locally (${JSON.stringify(imageEvidence)})`);
  } else {
    assert.match(await preview.innerText(), /Verify reset behavior before testing transitions/, "the text preview reads the selected local file bytes");
  }
  const visibility = await preview.evaluate((node) => {
    const scroller = node.closest(".files-upload-body");
    const scrollerRect = scroller.getBoundingClientRect();
    const previewRect = node.getBoundingClientRect();
    const visibleTop = scrollerRect.top + scroller.clientTop;
    const visibleBottom = visibleTop + scroller.clientHeight;
    const visibleHeight = Math.max(0, Math.min(previewRect.bottom, visibleBottom) - Math.max(previewRect.top, visibleTop));
    return { visibleHeight, previewHeight: previewRect.height, visibleTop, visibleBottom, previewTop: previewRect.top, previewBottom: previewRect.bottom };
  });
  assert.ok(visibility.visibleHeight >= Math.min(40, visibility.previewHeight), `the selected local preview is visible in the panel scroll viewport (${JSON.stringify(visibility)})`);
}

async function exerciseUploadConfirmationAndLocalPreview() {
  const viewport = { width: 1672, height: 941 };
  const { context, page } = await createPage(viewport, "rich-grid");
  try {
    const pdf = await fixtureFileBuffer(page, "Logic design review.pdf");
    const image = await fixtureFileBuffer(page, "FSM transition diagram.svg");
    const text = await fixtureFileBuffer(page, "Digital systems notes.txt");
    const uploadPostsBefore = uploadPosts.length;
    await page.evaluate(() => {
      const created = [];
      const revoked = [];
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { const url = create(blob); created.push(url); return url; };
      URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
      window.__localPreviewUrlStats = { created, revoked };
    });

    await openNewMenu(page);
    const mainBeforePanel = await readMainContentRect(page);
    await clickFilesMenuItem(page, "Upload files");
    const panel = page.getByRole("dialog", { name: "Upload files" });
    await panel.waitFor({ state: "visible" });
    await assertUploadPanelBounce(page);
    await assertUploadPanelToggleGeometry(page, viewport, "Hide upload panel");
    await assertUploadPanelGeometry(page, viewport, mainBeforePanel);
    await takeScreenshot(page, "desktop-1672-upload-panel-bottom");
    const input = panel.locator('input[type="file"]');
    await input.setInputFiles([pdf, image, text]);
    await panel.locator('[aria-label="Local file preview"]').waitFor({ state: "visible" });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-local-file-id]")].length === 3);
    assert.deepEqual(uploadPosts.slice(uploadPostsBefore), [], "file selection and local PDF/image/text reads do not POST bytes");
    const statuses = await panel.locator("[data-local-file-id]").allTextContents();
    assert.equal(statuses.length, 3);
    assert.ok(statuses.every((status) => status.includes("Not uploaded")), `all reviewed files remain local (${statuses.join(" | ")})`);
    await assertUploadFooterFits(panel, "540px staged-upload footer");

    await chooseLocalPreview(page, panel, pdf.name, ".files-local-preview-pdf img", "pdf");
    await takeScreenshot(page, "desktop-1672-staged-pdf-preview");
    await chooseLocalPreview(page, panel, image.name, ".files-local-preview-image img", "image");
    await takeScreenshot(page, "desktop-1672-staged-image-preview");
    await chooseLocalPreview(page, panel, text.name, ".files-local-preview-text", "text");
    assert.deepEqual(uploadPosts.slice(uploadPostsBefore), [], "previewing local files still makes no upload POST");

    const desktopToggle = await assertUploadPanelToggleGeometry(page, viewport, "Hide upload panel");
    const desktopPanelTop = await page.locator(".files-upload-shell").evaluate((shell) => shell.getBoundingClientRect().top);
    await desktopToggle.click();
    await page.waitForFunction(() => document.querySelector(".files-upload-dialog")?.getAttribute("aria-hidden") === "true");
    await assertUploadPanelExitAnimation(page, desktopPanelTop, "hiding the desktop upload panel with its arrow");
    const collapsedDesktopToggle = await assertUploadPanelToggleGeometry(page, viewport, "Show upload panel");
    await takeScreenshot(page, "desktop-1672-upload-panel-collapsed");
    await collapsedDesktopToggle.click();
    await panel.waitFor({ state: "visible" });
    await assertUploadPanelBounce(page, { replay: true });
    await assertUploadPanelToggleGeometry(page, viewport, "Hide upload panel");
    await assertUploadPanelGeometry(page, viewport, mainBeforePanel);
    assert.equal(await panel.locator("[data-local-file-id]").count(), 3, "closing and reopening the desktop panel preserves reviewed files");
    assert.deepEqual(uploadPosts.slice(uploadPostsBefore), [], "closing and reopening the desktop panel leaves reviewed files local");

    const optOut = panel.getByRole("checkbox", { name: "Do not show again", exact: true });
    await optOut.check();
    assert.equal(await fixture(page, "workspaceWrites"), 0, "the opt-out remains a draft until confirmation");
    assert.deepEqual(uploadPosts.slice(uploadPostsBefore), [], "checking the opt-out does not upload the reviewed batch");
    await chooseLocalPreview(page, panel, pdf.name, ".files-local-preview-pdf img", "pdf");
    await dismissUploadPanel(panel, "closing the upload panel with staged previews");
    const cleanup = await page.evaluate(() => window.__localPreviewUrlStats);
    assert.ok(cleanup.created.length >= 1, `the image preview created a blob URL for its local File (${JSON.stringify(cleanup)})`);
    assert.deepEqual([...cleanup.revoked].sort(), [...cleanup.created].sort(), "changing and closing local previews revokes every object URL");
    assert.deepEqual(uploadPosts.slice(uploadPostsBefore), [], "closing an unconfirmed selection sends no files");

    await openNewMenu(page);
    await clickFilesMenuItem(page, "Upload files");
    const optedOutPanel = page.getByRole("dialog", { name: "Upload files" });
    await optedOutPanel.waitFor({ state: "visible" });
    const optedOutInput = optedOutPanel.locator('input[type="file"]');
    await optedOutInput.setInputFiles([text]);
    await optedOutPanel.locator('[aria-label="Files ready for upload"]').waitFor({ state: "visible" });
    assert.equal(uploadPosts.length, uploadPostsBefore, "the opt-out only bypasses later selections after explicit confirmation");
    const confirmOptOut = optedOutPanel.getByRole("checkbox", { name: "Do not show again", exact: true });
    await confirmOptOut.check();
    assert.equal(await fixture(page, "workspaceWrites"), 0, "the browser fixture does not persist a draft opt-out");
    assert.equal(uploadPosts.length, uploadPostsBefore, "checking the opt-out leaves the current batch in local review");
    await optedOutPanel.getByRole("button", { name: "Upload files", exact: true }).click();
    await waitForUploadPosts(uploadPostsBefore + 1, "the first confirmed opt-out upload");
    await page.waitForFunction(() => window.__filesReferenceFixture.dashboard.d.filePreferences?.confirmUploads === false);
    assert.equal(await optedOutPanel.locator("[aria-label='Local file preview']").count(), 0, "future uploads bypass review after the setting is saved");
    assert.equal(uploadPosts[uploadPostsBefore].metadata.name, text.name);
    assert.ok(uploadPosts[uploadPostsBefore].size > 0, "the local fixture received the real selected text bytes only after opt-out fast upload");

    const fastFile = { name: "opted-out-next.txt", mimeType: "text/plain", buffer: Buffer.from("A later selected file bypasses confirmation.") };
    await optedOutInput.setInputFiles([fastFile]);
    await waitForUploadPosts(uploadPostsBefore + 2, "the subsequent opt-out fast upload");
    assert.equal(uploadPosts[uploadPostsBefore + 1].metadata.name, fastFile.name);
    assert.equal(await fixture(page, "dashboard.d.filePreferences.confirmUploads"), false);

    const settingsButton = optedOutPanel.getByRole("button", { name: "Upload settings", exact: true });
    await settingsButton.click();
    const restoreToggle = page.getByRole("menuitemcheckbox", { name: "Confirm before uploading", exact: true });
    assert.equal(await restoreToggle.getAttribute("aria-checked"), "false", "the upload settings menu reflects the saved opt-out");
    await restoreToggle.click();
    await page.waitForFunction(() => window.__filesReferenceFixture.dashboard.d.filePreferences?.confirmUploads === true);
    await dismissUploadPanel(optedOutPanel, "closing the upload panel after restoring confirmation settings");
    await page.reload();
    await enterFilesView(page);
    await openNewMenu(page);
    await clickFilesMenuItem(page, "Upload files");
    const reloadedPanel = page.getByRole("dialog", { name: "Upload files" });
    await reloadedPanel.waitFor({ state: "visible" });
    const reloadedSettings = reloadedPanel.getByRole("button", { name: "Upload settings", exact: true });
    await reloadedSettings.click();
    const restoredToggle = page.getByRole("menuitemcheckbox", { name: "Confirm before uploading", exact: true });
    assert.equal(await restoredToggle.getAttribute("aria-checked"), "true", "restoring confirmation persists through a page reload");
    await dismissUploadPanel(reloadedPanel, "closing the reloaded upload panel");
    const mainBeforeDrop = await readMainContentRect(page);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["Dropped from Files root"], "main-drop.txt", { type: "text/plain" }));
      const target = document.querySelector(".files-browser-content");
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    const mainDropPanel = page.getByRole("dialog", { name: "Upload files" });
    await mainDropPanel.waitFor({ state: "visible" });
    await page.getByText("main-drop.txt", { exact: true }).waitFor({ state: "visible" });
    await assertUploadPanelGeometry(page, viewport, mainBeforeDrop);
    assert.equal(uploadPosts.length, uploadPostsBefore + 2, "dropping onto the Files main page stages a raw File without a POST");
    await dismissUploadPanel(mainDropPanel, "closing the panel after dropping a local file");
  } finally {
    await context.close();
  }
}

try {
  browser = await playwright.chromium.launch(launchOptions);
  const mobileOnly = process.argv.includes("--mobile-only");
  if (mobileOnly) {
    for (const viewport of [
      { width: 430, height: 932 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      const run = await exercisePopulatedWorkspace(viewport, `mobile-${viewport.width}`);
      await run.context.close();
    }
  } else {
    await exerciseEmptyWorkspace();
    for (const viewport of [
      { width: 2560, height: 1440 },
      { width: 3440, height: 1440 },
    ]) await captureWideEmptyAndUpload(viewport, `wide-${viewport.width}`);
    await exerciseMobileEmptyWorkspace();
    await exerciseUploadPanelReducedMotion();
    await exerciseUploadConfirmationAndLocalPreview();
    await exercisePreferenceAppearanceMigration();
    const populatedDesktop = await exercisePopulatedWorkspace({ width: 1672, height: 941 }, "desktop");
    await populatedDesktop.context.close();

    for (const viewport of [
      { width: 1672, height: 941 },
      { width: 2560, height: 1440 },
      { width: 3440, height: 1440 },
    ]) await exerciseRichGridWorkspace(viewport, `wide-${viewport.width}`);

    for (const viewport of [
      { width: 430, height: 932 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      const run = await exercisePopulatedWorkspace(viewport, `mobile-${viewport.width}`);
      await run.context.close();
    }
  }

  assert.deepEqual(errors, [], errors.join("\n"));
  assert.deepEqual(layoutFailures, [], layoutFailures.join("\n"));
  if (!mobileOnly) {
    assert.ok(servedAssets.includes("/files-landscape.png"), "the Files landscape asset was served by the offline harness");
    assert.ok(servedAssets.includes("/files-empty-illustration.png"), "the standalone Files illustration was served by the offline harness");
    for (const path of ["/google-slides.svg", "/google-docs.svg", "/google-drive.svg"]) {
      assert.ok(servedAssets.includes(path), `the offline harness served the local ${path} icon`);
    }
    assert.deepEqual(googleServiceRequests, [{ url: "https://slides.google.com/", method: "GET" }], "Google receives a request only after the Slides link is activated");
    assert.equal(servedAssets.includes("/files-reference-art.png"), false, "the screenshot sprite is never routed or used");
  }
  console.log(`Files reference ${mobileOnly ? "mobile-only " : ""}browser verification passed. Screenshots: ${screenshotDir}`);
} finally {
  await browser?.close();
}
