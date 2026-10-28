import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-files-charcoal");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE
  ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href)
  : await import("esbuild");

const cssFiles = [
  "app/globals.css", "app/reference-ui.css", "app/auth.css", "app/home-skeleton.css",
  "app/widget-appearance.css", "app/widget-block-layout.css", "app/widget-reorder.css",
  "app/files-browser.css", "app/files-browser-tools.css", "app/files-card-preview.css",
  "app/file-organization-dialogs.css", "app/files-trash-dialog.css", "app/file-archive-dialog.css",
  "app/file-upload-dialog.css", "app/local-file-preview.css", "app/native-document-editor.css", "app/course-syllabus.css",
];
const css = (await Promise.all(cssFiles.map((name) => readFile(resolve(repoRoot, name), "utf8"))))
  .map((source) => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/files-reference-browser.tsx")],
  bundle: true, write: false, platform: "browser", format: "iife", target: "chrome120", jsx: "automatic",
  loader: { ".css": "empty" },
  alias: {
    "next/link": resolve(repoRoot, "tests/helpers/next-link.mjs"),
    "next/navigation": resolve(repoRoot, "tests/helpers/next-navigation.mjs"),
  },
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
});
const js = bundle.outputFiles[0].text;
const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --font-geist-sans: Arial, sans-serif; } .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0; }${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const baseUrl = "https://files-charcoal.test";
const googleIcons = new Map(await Promise.all(["google-slides.svg", "google-docs.svg", "google-drive.svg"].map(async (name) => [
  `/${name}`, await readFile(resolve(repoRoot, "public", name)),
])));
const uploadPosts = [];
const errors = [];
await mkdir(screenshotDir, { recursive: true });

function uploadAck(request) {
  const headers = request.headers();
  const metadata = JSON.parse(decodeURIComponent(headers["x-file-metadata"]));
  const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
  const file = {
    id: new URL(request.url()).searchParams.get("id"), name: metadata.name, mime_type: "text/plain",
    size_bytes: bytes.byteLength, course_id: metadata.courseId || null, assignment_id: metadata.assignmentId || null,
    kind: metadata.kind, state: "ready", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    content_sha256: createHash("sha256").update(bytes).digest("hex"), folder_id: metadata.folderId ?? null,
    content_backend: "object", metadata_revision: 1, content_revision: 1, trashed_at: null,
    trash_operation_id: null, original_folder_id: null,
  };
  uploadPosts.push({ file, profileId: headers["x-profile-id"] ?? "", metadata });
  return file;
}

async function waitForUploadPosts(count) {
  const deadline = Date.now() + 10000;
  while (uploadPosts.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(uploadPosts.length >= count, `confirmed upload should POST file bytes; observed ${uploadPosts.length}`);
}

async function settleVisiblePreviews(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll(".files-card-preview-content.is-loading")].every((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    return !visible;
  }), null, { timeout: 15000 });
  await page.evaluate(async () => {
    const visibleImages = [...document.querySelectorAll(".files-card-preview img")].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    });
    await Promise.all(visibleImages.map((image) => image.decode().catch(() => {})));
  });
}

async function waitForShellTransitions(page) {
  await page.evaluate(async () => {
    const elements = [document.querySelector("#workspace-sidebar"), document.querySelector("#main-content")].filter(Boolean);
    const transitions = elements.flatMap((element) => element.getAnimations());
    await Promise.all(transitions.map((transition) => transition.finished.catch(() => {})));
  });
}

const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"], channel: "chrome" };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
const browser = await playwright.chromium.launch(launchOptions);
try {
  const pageMetrics = [];
  for (const viewport of [{ width: 1672, height: 941 }, { width: 2560, height: 1440 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, acceptDownloads: true });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== baseUrl) return route.fulfill({ status: 204, body: "" });
      if (url.pathname === "/fixture.js") return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: js });
      if (url.pathname === "/api/files" && route.request().method() === "POST") {
        const file = uploadAck(route.request());
        return route.fulfill({ status: 201, contentType: "application/json; charset=utf-8", body: JSON.stringify({ file }) });
      }
      if (googleIcons.has(url.pathname)) return route.fulfill({ status: 200, contentType: "image/svg+xml; charset=utf-8", body: googleIcons.get(url.pathname) });
      if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(`${viewport.width}px pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("net::ERR_ABORTED")) errors.push(`${viewport.width}px console: ${message.text()}`); });
    await page.goto(`${baseUrl}/home?scenario=charcoal`);
    const workspaceSidebar = page.locator("#workspace-sidebar");
    if (!(await page.locator(".files-browser").isVisible())) {
      if (viewport.width <= 820) {
        const mobileNav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
        await mobileNav.waitFor({ state: "visible" });
        const mobileNavBounds = await mobileNav.boundingBox();
        assert.ok(mobileNavBounds && mobileNavBounds.y + mobileNavBounds.height >= viewport.height - 2, `the mobile bottom navigation reaches the viewport bottom (${JSON.stringify(mobileNavBounds)})`);
        await mobileNav.getByRole("link", { name: "Courses", exact: true }).click();
        await page.waitForFunction(() => location.pathname === "/dashboard", null, { timeout: 12000 });
        await mobileNav.getByRole("link", { name: "Home", exact: true }).click();
        await page.waitForFunction(() => location.pathname === "/home", null, { timeout: 12000 });

        await page.getByRole("button", { name: "Open navigation", exact: true }).click();
        const drawer = page.locator("#workspace-sidebar.open");
        await drawer.waitFor({ state: "visible" });
        await page.waitForFunction(() => (document.querySelector("#workspace-sidebar")?.getBoundingClientRect().left ?? -1) >= 0);
        const drawerBounds = await drawer.boundingBox();
        assert.ok(drawerBounds && drawerBounds.x >= 0 && drawerBounds.x + drawerBounds.width < viewport.width,
          `the mobile primary navigation opens inside the viewport (${JSON.stringify(drawerBounds)})`);
        const overlay = page.getByRole("button", { name: "Close navigation overlay", exact: true });
        await overlay.waitFor({ state: "visible" });
        await overlay.click({ position: { x: viewport.width - 40, y: Math.floor(viewport.height / 2) } });
        await page.waitForFunction(() => !document.querySelector("#workspace-sidebar")?.classList.contains("open"));
        assert.equal(await page.locator(".sidebar-scrim").count(), 0, "the mobile overlay closes the navigation drawer");
        await page.getByRole("button", { name: "Open navigation", exact: true }).click();
        await workspaceSidebar.getByRole("link", { name: "Files", exact: true }).click();
      } else {
        await workspaceSidebar.getByRole("link", { name: "Files", exact: true }).click();
      }
    }
    await page.locator(".files-browser.files-revamp").waitFor({ state: "visible" });
    const nav = page.getByRole("navigation", { name: "File navigation", exact: true });
    await nav.waitFor({ state: "visible" });
    const labels = await nav.locator(".files-revamp-nav-link span").allTextContents();
    assert.deepEqual(labels.map((label) => label.trim()), ["Files", "Starred", "Pinned", "Courses", "Archives", "Trash"], "the top Files navigation order matches the design");
    let workspaceSidebarGeometry = null;
    if (viewport.width > 820) {
      await waitForShellTransitions(page);
      const expandedSidebar = await workspaceSidebar.boundingBox();
      let expandedMain = await page.locator("#main-content").boundingBox();
      const expandedMainX = expandedMain?.x;
      assert.ok(expandedSidebar && expandedMain && expandedSidebar.width > 200 && expandedSidebar.x >= 0 && expandedSidebar.x + expandedSidebar.width <= viewport.width,
        `the expanded primary sidebar has normal desktop geometry (${JSON.stringify({ sidebar: expandedSidebar, main: expandedMain })})`);
      assert.ok(expandedMain.x >= expandedSidebar.x + expandedSidebar.width - 2, `Files content starts after the expanded primary sidebar (${JSON.stringify({ sidebar: expandedSidebar, main: expandedMain })})`);
      if (viewport.width === 1672) {
        await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
        await waitForShellTransitions(page);
        await page.waitForFunction(() => {
          const sidebar = document.querySelector("#workspace-sidebar");
          const main = document.querySelector("#main-content");
          return sidebar && main && sidebar.getBoundingClientRect().width < 140 && main.getBoundingClientRect().left < 180;
        });
        const collapsedSidebar = await workspaceSidebar.boundingBox();
        const collapsedMain = await page.locator("#main-content").boundingBox();
        assert.ok(collapsedSidebar && collapsedMain && collapsedSidebar.width < expandedSidebar.width - 100 && collapsedMain.x < expandedMain.x - 100,
          `collapsing the primary sidebar releases matching Files canvas width (${JSON.stringify({ expandedSidebar, expandedMain, collapsedSidebar, collapsedMain })})`);
        assert.equal(await nav.isVisible(), true, "Files navigation remains reachable with the primary sidebar collapsed");
        await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
        await waitForShellTransitions(page);
        await page.waitForFunction((expected) => {
          const sidebar = document.querySelector("#workspace-sidebar");
          const main = document.querySelector("#main-content");
          return sidebar && main && sidebar.getBoundingClientRect().width >= expected.width - 1 && main.getBoundingClientRect().left >= expected.mainLeft - 1;
        }, { width: expandedSidebar.width, mainLeft: expandedMainX });
        workspaceSidebarGeometry = await workspaceSidebar.boundingBox();
        expandedMain = await page.locator("#main-content").boundingBox();
        assert.ok(workspaceSidebarGeometry && expandedMain && expandedMainX !== undefined && Math.abs(workspaceSidebarGeometry.width - expandedSidebar.width) < 2 && Math.abs(expandedMain.x - expandedMainX) < 2,
          `expanding restores the normal desktop sidebar and canvas geometry (${JSON.stringify({ expandedSidebar, restoredSidebar: workspaceSidebarGeometry, expandedMain })})`);
      } else workspaceSidebarGeometry = expandedSidebar;
    } else {
      assert.equal(await page.locator("#workspace-sidebar.open").count(), 0, "the mobile drawer closes after Files navigation");
      const mobileBottomNav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
      const mobileBottomBounds = await mobileBottomNav.boundingBox();
      assert.ok(mobileBottomBounds && mobileBottomBounds.y + mobileBottomBounds.height >= viewport.height - 2 && await mobileBottomNav.isVisible(),
        `the mobile bottom navigation stays reachable on Files (${JSON.stringify(mobileBottomBounds)})`);
    }
    if (viewport.width > 700) {
      await page.locator(".files-recent-activity").waitFor({ state: "visible" });
      assert.equal(await page.locator(".files-recent-activity-item").count(), 6, "recent activity is backed by real opened-file records");
      assert.deepEqual(await page.locator(".files-recent-activity-group h3").allTextContents(), ["Today", "Yesterday", "This week", "Earlier"], "recent files group by actual last-opened dates");
    } else {
      assert.equal(await page.locator(".files-recent-activity").isVisible(), false, "the desktop activity rail gives way to the compact mobile control");
      await page.getByRole("button", { name: "See recently opened files", exact: true }).waitFor({ state: "visible" });
    }
    await page.locator(".files-items.is-grid").waitFor({ state: "visible" });
    await page.locator(".files-item.is-file").first().waitFor({ state: "visible" });
    await settleVisiblePreviews(page);
    assert.equal(await page.locator(".files-item.is-file").count(), 6, "the grid uses six fixture files with real source content");
    const brand = page.locator(".files-revamp-brand");
    assert.equal(await brand.getAttribute("href"), "/", "the brand returns to the workspace home");
    const navGeometry = await nav.boundingBox();
    const gridGeometry = await page.locator(".files-items.is-grid").boundingBox();
    const activityGeometry = await page.locator(".files-recent-activity").boundingBox();
    const pageGeometry = await page.evaluate(() => ({
      width: innerWidth, docWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      shellBackground: getComputedStyle(document.querySelector(".files-browser")).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      cardBackground: getComputedStyle(document.querySelector(".files-item")).backgroundColor,
      cards: [...document.querySelectorAll(".files-items.is-grid > .files-item")].map((item) => {
        const rect = item.getBoundingClientRect();
        return { name: item.querySelector(".files-item-title")?.textContent?.trim(), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      }),
      previews: [...document.querySelectorAll(".files-item.is-file .files-card-preview")].map((item) => ({
        text: item.textContent.trim().slice(0, 45), image: item.querySelector("img")?.currentSrc?.slice(0, 35) ?? "",
        bounds: (() => { const r = item.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),
      })),
      bodyScrollHeight: document.documentElement.scrollHeight,
    }));
    assert.ok(navGeometry && gridGeometry && (activityGeometry || viewport.width <= 700), "top navigation, activity control, and cards have rendered geometry");
    assert.ok(pageGeometry.docWidth <= viewport.width + 1 && pageGeometry.bodyWidth <= viewport.width + 1, `no horizontal overflow at ${viewport.width}px (${JSON.stringify(pageGeometry)})`);
    const screenshotName = `${viewport.width}x${viewport.height}`;
    if (viewport.width === 1672) {
      await page.getByRole("checkbox", { name: "Select Digital systems notes.txt in My files", exact: true }).check();
      const selectionBar = page.locator(".files-revamp-selection-bar");
      await selectionBar.waitFor({ state: "visible" });
      const selectionBarGeometry = await selectionBar.evaluate((bar) => {
        const rect = bar.getBoundingClientRect();
        return { position: getComputedStyle(bar).position, top: rect.top, bottom: rect.bottom, height: rect.height, text: bar.textContent.trim() };
      });
      assert.equal(selectionBarGeometry.position, "fixed", `selection actions stay fixed to the viewport (${JSON.stringify(selectionBarGeometry)})`);
      assert.ok(selectionBarGeometry.bottom >= viewport.height - 2 && /1 item selected/.test(selectionBarGeometry.text),
        `the fixed selection bar is visible at the viewport bottom (${JSON.stringify(selectionBarGeometry)})`);
    }
    await page.screenshot({ path: resolve(screenshotDir, `${screenshotName}.png`), animations: "disabled" });
    pageMetrics.push({ viewport, workspaceSidebar: workspaceSidebarGeometry, nav: navGeometry, activity: activityGeometry, grid: gridGeometry, ...pageGeometry });

    if (viewport.width === 1672) {
      assert.ok(pageGeometry.cards.filter((card) => card.y === pageGeometry.cards[0]?.y).length >= 3, "the desktop card grid is compact and horizontal");
      const pdfCard = page.locator(".files-item.is-file").filter({ hasText: "Logic design review.pdf" });
      const pdfThumbnail = pdfCard.locator("img.files-card-pdf-preview");
      await pdfThumbnail.waitFor({ state: "visible" });
      await pdfThumbnail.evaluate((image) => image.decode());
      const pdfImageEvidence = await pdfThumbnail.evaluate((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF thumbnail pixels could not be inspected.");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let inkPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 220 && pixels[offset + 1] < 220 && pixels[offset + 2] < 220) inkPixels += 1;
        return { source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, inkPixels };
      });
      assert.ok(pdfImageEvidence.source.startsWith("data:image/png;base64,"), `the card shows a locally rendered PDF page (${JSON.stringify(pdfImageEvidence)})`);
      assert.ok(pdfImageEvidence.width >= 80 && pdfImageEvidence.height >= 100 && pdfImageEvidence.inkPixels > 5,
        `the PDF preview shows page content at its compact card width (${JSON.stringify(pdfImageEvidence)})`);
      const horizontalCard = await pdfCard.evaluate((card) => {
        const bounds = (selector) => {
          const element = card.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { x: rect.x, right: rect.right, width: rect.width, display: getComputedStyle(element).display };
        };
        return {
          preview: bounds(".files-card-preview"), title: bounds(".files-item-title strong"),
          summary: bounds(".files-revamp-card-summary"), legacyMetadata: bounds(".files-card-metadata"),
        };
      });
      const overlayGeometry = await page.locator(".files-item.is-file").filter({ hasText: "Digital systems notes.txt" }).evaluate((card) => {
        const bounds = (element) => {
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          return { x: Math.round(rect.left - cardRect.left), y: Math.round(rect.top - cardRect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        };
        return {
          checkbox: bounds(card.querySelector(".files-item-select")),
          preview: bounds(card.querySelector(".files-card-preview")),
          star: bounds(card.querySelector(".files-item-star-trigger")),
          menu: bounds(card.querySelector(".files-item-menu-trigger")),
        };
      });
      assert.ok(overlayGeometry.checkbox && overlayGeometry.preview && overlayGeometry.star && overlayGeometry.menu,
        `the file-card overlays and thumbnail are mounted (${JSON.stringify(overlayGeometry)})`);
      assert.ok(overlayGeometry.checkbox.y < 40 && overlayGeometry.checkbox.x < overlayGeometry.preview.x,
        `selection stays at the preview's upper-left edge without covering it (${JSON.stringify(overlayGeometry)})`);
      assert.ok(overlayGeometry.star.y < 20 && overlayGeometry.menu.y < 20,
        `star and overflow actions stay at the card's upper-right edge (${JSON.stringify(overlayGeometry)})`);
      assert.ok(horizontalCard.preview?.width >= 80 && horizontalCard.title?.x > horizontalCard.preview.right,
        `the document preview sits to the left of the card details (${JSON.stringify(horizontalCard)})`);
      assert.ok(horizontalCard.summary?.display !== "none" && horizontalCard.summary.width > 0,
        `size and modified date share a visible summary line (${JSON.stringify(horizontalCard)})`);
      assert.equal(horizontalCard.legacyMetadata?.display, "none", "the card does not show a second date/size line");
      await page.getByRole("button", { name: "Clear selection", exact: true }).click();

      await page.getByRole("button", { name: "See history", exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "recent");
      await nav.getByRole("button", { name: "Files", exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "my-files");
      await nav.getByRole("button", { name: "Show pinned folders", exact: true }).click();
      await page.getByRole("group", { name: "Pinned folders" }).waitFor({ state: "visible" });
      await page.getByRole("group", { name: "Pinned folders" }).getByRole("button", { name: "CPE 281", exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("folder") === "b3000000-0000-4000-8000-000000000001");
      await nav.getByRole("button", { name: "Show course folders", exact: true }).click();
      await page.getByRole("group", { name: "Course folders" }).waitFor({ state: "visible" });
      await page.getByRole("group", { name: "Course folders" }).getByRole("button", { name: "CPE 281", exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("folder") === "b3000000-0000-4000-8000-000000000001");
      await nav.getByRole("button", { name: "Show archived files", exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "archives");
      assert.ok(await page.locator(".files-items, .files-state-panel").count() > 0, "Archives remains usable from the new navigation");
      await nav.getByRole("button", { name: "Files", exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "my-files");
      await page.getByRole("button", { name: "List view", exact: true }).click();
      await page.locator(".files-items.is-list").waitFor({ state: "visible" });

      const requestsBeforeChooser = uploadPosts.length;
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Upload files", exact: true }).click();
      const uploadDialog = page.getByRole("dialog", { name: "Upload files", exact: true });
      await uploadDialog.waitFor({ state: "visible" });
      const uploadInput = uploadDialog.locator('input[type="file"]').first();
      await uploadInput.setInputFiles({ name: "charcoal-upload.txt", mimeType: "text/plain", buffer: Buffer.from("charcoal upload preview") });
      await uploadDialog.locator('[aria-label="Files ready for upload"]').waitFor({ state: "visible" });
      assert.equal(uploadPosts.length, requestsBeforeChooser, "opening the chooser and previewing a staged file send no POST before confirmation");
      await uploadDialog.getByRole("checkbox", { name: "Do not show again", exact: true }).check();
      assert.equal(uploadPosts.length, requestsBeforeChooser, "editing the opt-out remains a draft until confirmation");
      await uploadDialog.getByRole("button", { name: "Upload files", exact: true }).click();
      await waitForUploadPosts(requestsBeforeChooser + 1);
      assert.equal(uploadPosts.length, requestsBeforeChooser + 1, "explicit confirmation submits exactly one staged file");
    }
    await context.close();
  }
  for (const viewport of [{ width: 1672, height: 941 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, acceptDownloads: true });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== baseUrl) return route.fulfill({ status: 204, body: "" });
      if (url.pathname === "/fixture.js") return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: js });
      if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(`empty ${viewport.width}px pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("net::ERR_ABORTED")) errors.push(`empty ${viewport.width}px console: ${message.text()}`); });
    await page.goto(`${baseUrl}/home?scenario=empty`);
    const workspaceSidebar = page.locator("#workspace-sidebar");
    if (viewport.width <= 820) {
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      await page.locator(".sidebar-scrim").waitFor({ state: "visible" });
      assert.ok(await page.locator("#workspace-sidebar.open").isVisible(), `the empty mobile scenario can open its primary navigation (${viewport.width}px)`);
      await workspaceSidebar.getByRole("link", { name: "Files", exact: true }).click();
    } else {
      await workspaceSidebar.getByRole("link", { name: "Files", exact: true }).click();
    }
    await page.locator(".files-browser.files-revamp").waitFor({ state: "visible" });
    const emptyWelcome = page.locator(".files-empty-home");
    await emptyWelcome.waitFor({ state: "visible" });
    await waitForShellTransitions(page);
    assert.equal(await emptyWelcome.locator("h3").textContent(), "A home for every file.", `the empty root welcome appears at ${viewport.width}px`);
    assert.equal(await emptyWelcome.locator(".files-empty-home-art").getAttribute("aria-hidden"), "true", "empty-library art is decorative");
    assert.equal(await page.locator(".files-item").count(), 0, "the empty scenario contains no file or folder rows");
    assert.ok(await page.getByRole("button", { name: "Upload files", exact: true }).isVisible(), "the root welcome exposes the upload flow");
    assert.ok(await page.getByRole("button", { name: "Create folder", exact: true }).isVisible(), "the root welcome exposes the folder flow");
    assert.equal(await page.locator(".files-empty-home-features").isVisible(), true, "the root welcome keeps its feature list visible");
    if (viewport.width > 700) {
      assert.match(await page.locator(".files-recent-empty").textContent(), /Files you open will appear here/, "empty recent history explains how activity will appear");
    } else {
      assert.ok(await page.getByRole("button", { name: "See recently opened files", exact: true }).isVisible(), "mobile history navigation remains available without activity");
    }

    const nav = page.getByRole("navigation", { name: "File navigation", exact: true });
    await nav.waitFor({ state: "visible" });
    const heading = page.locator(".files-content-heading h2");
    await heading.waitFor({ state: "visible" });
    assert.match(await heading.textContent(), /All files/, `the empty Files page keeps a clear location heading (${viewport.width}px)`);
    const shellMetrics = await page.evaluate(() => {
      const bounds = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: Math.round(rect.left), y: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      return {
        width: innerWidth,
        docWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        main: bounds("#main-content"),
        sidebar: bounds("#workspace-sidebar"),
        mobileHeader: bounds(".mobile-header"),
        filesTopbar: bounds(".files-revamp-topbar"),
        heading: bounds(".files-content-heading"),
        welcome: bounds(".files-empty-home"),
      };
    });
    assert.ok(shellMetrics.docWidth <= viewport.width + 1 && shellMetrics.bodyWidth <= viewport.width + 1,
      `the empty Files page has no horizontal overflow at ${viewport.width}px (${JSON.stringify(shellMetrics)})`);
    assert.ok(shellMetrics.welcome && shellMetrics.welcome.width > 0 && shellMetrics.welcome.x >= 0 && shellMetrics.welcome.right <= viewport.width + 1,
      `the empty welcome fits the viewport at ${viewport.width}px (${JSON.stringify(shellMetrics)})`);

    if (viewport.width > 820) {
      const expandedSidebar = await workspaceSidebar.boundingBox();
      const expandedMain = await page.locator("#main-content").boundingBox();
      assert.ok(expandedSidebar && expandedMain && expandedSidebar.width > 200 && expandedMain.x >= expandedSidebar.x + expandedSidebar.width - 2,
        `the empty desktop page uses the normal expanded workspace sidebar (${JSON.stringify({ sidebar: expandedSidebar, main: expandedMain })})`);
      const filesLink = workspaceSidebar.getByRole("link", { name: "Files", exact: true });
      assert.equal(await filesLink.getAttribute("href"), "/files", "Files stays a normal sidebar link");
      assert.equal(await filesLink.getAttribute("aria-current"), "page", "Files stays highlighted on its page");
      assert.equal(await workspaceSidebar.getByRole("button", { name: "Files", exact: true }).count(), 0, "Files has no sidebar dropdown toggle");
      assert.equal(await page.locator("#files-primary-navigation-slot").count(), 0, "Files adds no nested sidebar navigation");
      const screenshotName = `empty-${viewport.width}x${viewport.height}`;
      await page.screenshot({ path: resolve(screenshotDir, `${screenshotName}.png`), animations: "disabled" });

      await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      await waitForShellTransitions(page);
      await page.waitForFunction(() => {
        const sidebar = document.querySelector("#workspace-sidebar");
        const main = document.querySelector("#main-content");
        return sidebar && main && sidebar.getBoundingClientRect().width < 140 && main.getBoundingClientRect().left < 180;
      });
      const collapsedMetrics = await page.evaluate(() => ({
        width: innerWidth,
        docWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        sidebarWidth: document.querySelector("#workspace-sidebar")?.getBoundingClientRect().width ?? 0,
        mainLeft: document.querySelector("#main-content")?.getBoundingClientRect().left ?? 0,
      }));
      assert.ok(collapsedMetrics.docWidth <= viewport.width + 1 && collapsedMetrics.bodyWidth <= viewport.width + 1,
        `the collapsed empty desktop layout has no horizontal overflow (${JSON.stringify(collapsedMetrics)})`);
      assert.ok(collapsedMetrics.sidebarWidth < expandedSidebar.width - 100 && collapsedMetrics.mainLeft < expandedMain.x - 100,
        `the empty Files canvas follows the collapsed primary sidebar (${JSON.stringify({ expandedSidebar, expandedMain, collapsedMetrics })})`);
      assert.equal(await emptyWelcome.isVisible(), true, "collapsing the sidebar keeps the empty root welcome visible");

      await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      await waitForShellTransitions(page);
      await page.waitForFunction((expected) => {
        const sidebar = document.querySelector("#workspace-sidebar");
        const main = document.querySelector("#main-content");
        return sidebar && main && sidebar.getBoundingClientRect().width >= expected.width - 1 && main.getBoundingClientRect().left >= expected.mainLeft - 1;
      }, { width: expandedSidebar.width, mainLeft: expandedMain.x });
      const restoredSidebar = await workspaceSidebar.boundingBox();
      assert.ok(restoredSidebar && Math.abs(restoredSidebar.width - expandedSidebar.width) < 2,
        `expanding restores the desktop sidebar width (${JSON.stringify({ expandedSidebar, restoredSidebar })})`);

      await workspaceSidebar.getByRole("link", { name: "Home", exact: true }).click();
      await page.locator(".home-page").waitFor({ state: "visible" });
      await page.locator("#files-primary-navigation-slot").waitFor({ state: "detached" });
      const homeSidebar = await workspaceSidebar.boundingBox();
      assert.ok(homeSidebar && Math.abs(homeSidebar.width - expandedSidebar.width) < 2,
        `the normal sidebar width survives the return to Home (${JSON.stringify({ expandedSidebar, homeSidebar })})`);
      await workspaceSidebar.getByRole("link", { name: "Files", exact: true }).click();
      await emptyWelcome.waitFor({ state: "visible" });
      await filesLink.waitFor({ state: "visible" });
      assert.equal(await page.locator("#workspace-sidebar").evaluate((side) => side.classList.contains("sidebar-collapsed")), false,
        "returning from Home keeps the primary sidebar expanded");
    } else {
      const mobileHeader = page.locator(".mobile-header");
      const mobileBottomNav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
      const courseFilter = page.locator('select[aria-label="Course filter"]');
      const fileTypeFilter = page.locator('select[aria-label="File type"]');
      const courseFilterBounds = await courseFilter.boundingBox();
      const fileTypeFilterBounds = await fileTypeFilter.boundingBox();
      assert.ok(courseFilterBounds && courseFilterBounds.width > 100 && await courseFilter.isVisible(),
        `the course filter stays readable on mobile (${JSON.stringify(courseFilterBounds)})`);
      assert.ok(fileTypeFilterBounds && fileTypeFilterBounds.width > 100 && await fileTypeFilter.isVisible(),
        `the file-type filter stays readable on mobile (${JSON.stringify(fileTypeFilterBounds)})`);
      assert.equal(await page.locator('label:has(select[aria-label="Course filter"]) > span').textContent(), "Course filter",
        "the course filter keeps its visible label on mobile");
      assert.equal(await page.locator('label:has(select[aria-label="File type"]) > span').textContent(), "File type",
        "the file-type filter keeps its visible label on mobile");
      assert.equal((await courseFilter.locator("option:checked").textContent())?.trim(), "All courses",
        "the course filter selection stays legible on mobile");
      assert.equal((await fileTypeFilter.locator("option:checked").textContent())?.trim(), "All file types",
        "the file-type filter selection stays legible on mobile");
      const mobileHeaderBounds = await mobileHeader.boundingBox();
      const filesTopbarBounds = await page.locator(".files-revamp-topbar").boundingBox();
      const mobileBottomBounds = await mobileBottomNav.boundingBox();
      assert.ok(mobileHeaderBounds && filesTopbarBounds && mobileHeaderBounds.y >= 0 && mobileHeaderBounds.y + mobileHeaderBounds.height <= filesTopbarBounds.y + 2,
        `the Files title row begins below the shared mobile header (${JSON.stringify({ mobileHeaderBounds, filesTopbarBounds })})`);
      assert.ok(mobileBottomBounds && mobileBottomBounds.y + mobileBottomBounds.height >= viewport.height - 2 && await mobileBottomNav.isVisible(),
        `the mobile navigation bar remains visible beside the empty welcome (${JSON.stringify(mobileBottomBounds)})`);
      assert.equal(await page.locator("#workspace-sidebar.open").count(), 0, "the mobile drawer closes after entering the empty Files view");
      await page.screenshot({ path: resolve(screenshotDir, `empty-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
    }
    await context.close();
  }
  assert.deepEqual(errors, [], "the charcoal Files views have no browser errors");
  console.log(`Charcoal Files verification passed. Screenshots: ${screenshotDir}`);
  console.log(JSON.stringify(pageMetrics, null, 2));
  console.log(`Upload POSTs after explicit confirmation: ${uploadPosts.length}`);
} finally {
  await browser.close();
}
