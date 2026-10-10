import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-native-documents");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE
  ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href)
  : await import("esbuild");
const cssFiles = [
  "app/globals.css",
  "app/reference-ui.css",
  "app/files-browser.css",
  "app/files-browser-tools.css",
  "app/course-syllabus.css",
  "app/native-document-editor.css",
  "app/auth.css",
];
const cssSources = await Promise.all(cssFiles.map((file) => readFile(resolve(repoRoot, file), "utf8")));
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/native-document-browser.tsx")],
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
const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --font-geist-sans: Arial, sans-serif; }${css}</style></head><body><div class="app-shell reference-ui"><aside class="sidebar" aria-hidden="true"></aside><header class="desktop-topbar" aria-hidden="true"></header><main id="main-content" class="main-content"><div id="root"></div></main></div><script src="/fixture.js"></script></body></html>`;
const baseUrl = "https://native-documents.test";
await mkdir(screenshotDir, { recursive: true });

const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
const errors = [];
let browser;

async function assertViewportFits(page, width, dialogSelector = "") {
  const metrics = await page.evaluate((selector) => {
    const browser = document.querySelector(".files-browser");
    const dialog = selector ? document.querySelector(selector) : null;
    const rect = dialog?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      browser: browser ? { left: browser.getBoundingClientRect().left, right: browser.getBoundingClientRect().right } : null,
      dialog: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
      viewportHeight: window.innerHeight,
    };
  }, dialogSelector);
  assert.ok(metrics.browser, `Files Browser is rendered at ${width}px`);
  assert.ok(metrics.document <= width + 1, `document does not overflow at ${width}px (${metrics.document}px)`);
  assert.ok(metrics.body <= width + 1, `body does not overflow at ${width}px (${metrics.body}px)`);
  assert.ok(metrics.browser.left >= -1 && metrics.browser.right <= width + 1,
    `Files Browser fits at ${width}px (${metrics.browser.left}–${metrics.browser.right})`);
  if (metrics.dialog) {
    assert.ok(metrics.dialog.left >= -1 && metrics.dialog.right <= width + 1,
      `dialog fits horizontally at ${width}px (${metrics.dialog.left}–${metrics.dialog.right})`);
    assert.ok(metrics.dialog.top >= -1 && metrics.dialog.bottom <= metrics.viewportHeight + 1,
      `dialog fits vertically (${metrics.dialog.top}–${metrics.dialog.bottom} of ${metrics.viewportHeight})`);
  }
  return metrics;
}

async function assertDialogTopmost(page, dialogSelector) {
  await page.waitForFunction((selector) => {
    const dialog = document.querySelector(selector);
    const overlay = dialog?.closest(".files-dialog-backdrop, .modal-backdrop");
    return Boolean(dialog && overlay
      && Number(getComputedStyle(dialog).opacity) >= 0.999
      && Number(getComputedStyle(overlay).opacity) >= 0.999);
  }, dialogSelector);
  const evidence = await page.locator(dialogSelector).evaluate((element) => {
    const overlay = element.closest(".files-dialog-backdrop, .modal-backdrop");
    const close = [...element.querySelectorAll("button")].find((button) =>
      /^close\b/i.test(`${button.getAttribute("aria-label") ?? ""} ${button.textContent?.trim() ?? ""}`.trim()));
    const overlayRect = overlay?.getBoundingClientRect();
    const dialogRect = element.getBoundingClientRect();
    const closeRect = close?.getBoundingClientRect();
    const hit = closeRect ? document.elementFromPoint(closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2) : null;
    return {
      overlayOpacity: overlay ? Number(getComputedStyle(overlay).opacity) : 0,
      dialogOpacity: Number(getComputedStyle(element).opacity),
      overlay: overlayRect ? { left: overlayRect.left, top: overlayRect.top, right: overlayRect.right, bottom: overlayRect.bottom } : null,
      dialog: { left: dialogRect.left, top: dialogRect.top, right: dialogRect.right, bottom: dialogRect.bottom },
      closeVisible: Boolean(closeRect?.width && closeRect.height),
      closeIsTopmost: Boolean(close && hit && close.contains(hit)),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  assert.equal(evidence.dialogOpacity, 1, `dialog is fully visible (${JSON.stringify(evidence)})`);
  assert.equal(evidence.overlayOpacity, 1, `dialog backdrop is fully visible (${JSON.stringify(evidence)})`);
  assert.ok(evidence.overlay && Math.abs(evidence.overlay.left) <= 1 && Math.abs(evidence.overlay.top) <= 1
    && Math.abs(evidence.overlay.right - evidence.viewport.width) <= 1
    && Math.abs(evidence.overlay.bottom - evidence.viewport.height) <= 1,
  `dialog backdrop covers the viewport (${JSON.stringify(evidence)})`);
  assert.ok(evidence.closeVisible && evidence.closeIsTopmost,
    `dialog close control is visible and topmost (${JSON.stringify(evidence)})`);
  return evidence;
}

async function fixtureState(page) {
  return page.evaluate(() => ({
    requests: structuredClone(window.__nativeDocumentFixture.requests),
    files: window.__nativeDocumentFixture.getFiles(),
    documents: window.__nativeDocumentFixture.getDocuments(),
  }));
}

async function waitForSaved(page) {
  const status = page.locator(".native-document-status");
  try {
    await page.waitForFunction(() => document.querySelector(".native-document-status")?.textContent?.trim() === "Saved");
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      status: document.querySelector(".native-document-status")?.textContent?.trim() ?? null,
      errors: [...document.querySelectorAll(".native-document-error, [role=alert]")].map((item) => item.textContent?.trim()).filter(Boolean),
      requests: window.__nativeDocumentFixture?.requests.slice(-8) ?? [],
    }));
    throw new Error(`${error.message}; editor=${JSON.stringify(diagnostic)}`);
  }
  assert.equal((await status.innerText()).trim(), "Saved");
  assert.equal(await status.getAttribute("role"), "status", "save state is exposed as a status");
  assert.equal(await status.getAttribute("aria-live"), "polite", "save state is announced politely");
}

async function createFromNewMenu(page, expectedName, expectedFolderId) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menu", { name: "New actions" }).waitFor({ state: "visible" });
  await page.getByRole("menuitem", { name: "New text file", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit text file" });
  await editor.waitFor({ state: "visible" });
  assert.equal(await editor.getAttribute("aria-describedby"), "native-document-help", "the editor links its help as the dialog description");
  const help = page.locator("#native-document-help");
  const helpText = (await help.innerText()).trim();
  assert.match(helpText, /save automatically/i, "the editor description explains autosave");
  assert.match(helpText, /Ctrl\/⌘\+S/i, "the editor description explains the manual save shortcut");
  await page.waitForFunction((name) => window.__nativeDocumentFixture.requests.some((request) =>
    request.path === "/api/file-documents" && request.method === "POST" && request.body?.name === name), expectedName);
  const state = await fixtureState(page);
  const createRequest = state.requests.findLast((request) => request.path === "/api/file-documents" && request.method === "POST" && request.body?.name === expectedName);
  assert.ok(createRequest, `a durable POST creates ${expectedName}`);
  assert.equal(createRequest.body.body, "", "the empty document is persisted before editing begins");
  assert.equal(createRequest.body.folderId, expectedFolderId);
  assert.equal(createRequest.body.courseId, "");
  assert.equal(state.requests.filter((request) => request.path.startsWith("/api/file-documents?") && request.method === "PUT").length, 0,
    "typing has not begun before the empty create is acknowledged");
  assert.equal(await editor.getByRole("textbox", { name: "File name" }).inputValue(), expectedName);
  await waitForSaved(page);
  await page.waitForFunction(() => {
    return document.activeElement?.getAttribute("type") === "text" && document.activeElement?.getAttribute("required") !== null;
  });
  await assertDialogTopmost(page, ".native-document-dialog");
  return { editor, createRequest };
}

async function runAcceptance(page, viewport) {
  page.setDefaultTimeout(10000);
  await page.goto(`${baseUrl}/files?view=my-files&layout=list`);
  await page.getByRole("button", { name: "Open folder: Research" }).waitFor({ state: "visible" });
  await assertViewportFits(page, viewport.width);
  await page.screenshot({ path: resolve(screenshotDir, `${viewport.name}-files.png`), animations: "disabled" });

  // The root New menu should suggest the next non-colliding name and durably
  // create an empty file before the editor accepts its first keystroke.
  const rootCreate = await createFromNewMenu(page, "Untitled (3).txt", null);
  if (viewport.width === 1440) {
    await assertViewportFits(page, viewport.width, ".native-document-dialog");
    await page.screenshot({ path: resolve(screenshotDir, "desktop-editor-empty.png"), animations: "disabled" });
  }
  const nameInput = rootCreate.editor.getByRole("textbox", { name: "File name" });
  const bodyInput = rootCreate.editor.getByRole("textbox", { name: "Text" });
  const unicodeBody = "Résumé — 東京 — 😀 ✓\nSecond line: study notes.";
  await nameInput.fill("My notes.txt");
  await bodyInput.fill(unicodeBody);
  await rootCreate.editor.getByRole("button", { name: "Save", exact: true }).click();
  await waitForSaved(page);
  const afterSave = await fixtureState(page);
  const saved = afterSave.documents.find((document) => document.id === rootCreate.createRequest.body.id);
  assert.ok(saved, "created document remains in the durable fixture store");
  assert.equal(saved.name, "My notes.txt");
  assert.equal(saved.body, unicodeBody);
  assert.equal(saved.contentRevision, 2);
  assert.equal(saved.metadataRevision, 2);
  assert.equal(saved.folderId, null);
  const createIndex = afterSave.requests.findIndex((request) => request.path === "/api/file-documents" && request.method === "POST" && request.body?.id === saved.id);
  const saveIndex = afterSave.requests.findIndex((request) => request.path === `/api/file-documents?id=${saved.id}` && request.method === "PUT");
  assert.ok(createIndex >= 0 && saveIndex > createIndex, "the acknowledged empty POST precedes the Unicode content/name save");
  if (viewport.width === 1440) {
    await assertViewportFits(page, viewport.width, ".native-document-dialog");
    await page.screenshot({ path: resolve(screenshotDir, "desktop-editor-unicode-saved.png"), animations: "disabled" });
  }
  await rootCreate.editor.getByRole("button", { name: "Close editor" }).click();
  await page.locator(".native-document-dialog").waitFor({ state: "detached" });

  // Reopening the saved row must read durable content, preserve the Unicode
  // body, and return keyboard focus to the file row when the editor closes.
  const savedTrigger = page.getByRole("button", { name: "Edit text: My notes.txt" });
  await savedTrigger.waitFor({ state: "visible" });
  const beforeReopen = (await fixtureState(page)).requests.filter((request) => request.path === `/api/file-documents?id=${saved.id}` && request.method === "GET").length;
  await savedTrigger.click();
  const reopened = page.getByRole("dialog", { name: "Edit text file" });
  await reopened.waitFor({ state: "visible" });
  await page.waitForFunction(({ id, previous }) => window.__nativeDocumentFixture.requests.filter((request) =>
    request.path === `/api/file-documents?id=${id}` && request.method === "GET").length > previous,
  { id: saved.id, previous: beforeReopen });
  await waitForSaved(page);
  assert.equal(await reopened.getByRole("textbox", { name: "File name" }).inputValue(), "My notes.txt");
  assert.equal(await reopened.getByRole("textbox", { name: "Text" }).inputValue(), unicodeBody);
  await assertDialogTopmost(page, ".native-document-dialog");
  await assertViewportFits(page, viewport.width, ".native-document-dialog");
  if (viewport.width === 390) await page.screenshot({ path: resolve(screenshotDir, "mobile-editor-reopened.png"), animations: "disabled" });
  const closeEditor = reopened.getByRole("button", { name: "Close editor" });
  await closeEditor.focus();
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Close text editor");
  await page.keyboard.press("Shift+Tab");
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Close editor");
  await closeEditor.click();
  await page.locator(".native-document-dialog").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Edit text: My notes.txt");
  assert.equal(await savedTrigger.evaluate((button) => document.activeElement === button), true,
    "closing the editor restores focus to the file row that opened it");

  // A folder menu creates beside that folder's siblings and retains its UUID.
  await page.getByRole("button", { name: "More options for Research" }).click();
  await page.getByRole("menu", { name: "Research actions" }).waitFor({ state: "visible" });
  await page.getByRole("menuitem", { name: "New text file", exact: true }).click();
  const folderEditor = page.getByRole("dialog", { name: "Edit text file" });
  await folderEditor.waitFor({ state: "visible" });
  await page.waitForFunction(() => window.__nativeDocumentFixture.requests.some((request) =>
    request.path === "/api/file-documents" && request.method === "POST" && request.body?.folderId === "11111111-1111-4111-8111-111111111111"));
  const folderPost = (await fixtureState(page)).requests.findLast((request) => request.method === "POST" && request.path === "/api/file-documents");
  assert.ok(folderPost);
  assert.equal(folderPost.body.name, "Untitled (2).txt", "folder sibling names drive the suggestion");
  assert.equal(folderPost.body.body, "", "folder documents also start from a persisted empty body");
  assert.equal(folderPost.body.folderId, "11111111-1111-4111-8111-111111111111");
  assert.equal(folderPost.body.courseId, "");
  await waitForSaved(page);
  await assertDialogTopmost(page, ".native-document-dialog");
  await folderEditor.getByRole("button", { name: "Close editor" }).click();
  await page.locator(".native-document-dialog").waitFor({ state: "detached" });

  // Dispatch a right-click on the blank content surface to exercise the
  // background creation path separately from the header and folder menus.
  await page.locator(".files-browser-content").evaluate((element) => {
    element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2,
      clientX: Math.min(window.innerWidth - 48, 380), clientY: 280,
    }));
  });
  await page.getByRole("menu", { name: "My files actions" }).waitFor({ state: "visible" });
  await page.getByRole("menuitem", { name: "New text file", exact: true }).click();
  const backgroundEditor = page.getByRole("dialog", { name: "Edit text file" });
  await backgroundEditor.waitFor({ state: "visible" });
  await page.waitForFunction(() => window.__nativeDocumentFixture.requests.filter((request) =>
    request.path === "/api/file-documents" && request.method === "POST").length >= 3);
  const backgroundPost = (await fixtureState(page)).requests.findLast((request) => request.method === "POST" && request.path === "/api/file-documents");
  assert.ok(backgroundPost);
  assert.equal(backgroundPost.body.name, "Untitled (3).txt");
  assert.equal(backgroundPost.body.body, "");
  assert.equal(backgroundPost.body.folderId, null);
  assert.equal(backgroundPost.body.courseId, "");
  await waitForSaved(page);
  await assertDialogTopmost(page, ".native-document-dialog");
  if (viewport.width === 390) {
    await assertViewportFits(page, viewport.width, ".native-document-dialog");
    await page.screenshot({ path: resolve(screenshotDir, "mobile-editor-background-create.png"), animations: "disabled" });
  }
  await backgroundEditor.getByRole("button", { name: "Close editor" }).click();
  await page.locator(".native-document-dialog").waitFor({ state: "detached" });

  // Uploaded text still uses FilePreview's read-only <pre> surface.
  await page.getByRole("button", { name: "Preview file: Uploaded reference.txt" }).click();
  const preview = page.getByRole("dialog", { name: "Private file preview" });
  await preview.waitFor({ state: "visible" });
  await preview.locator(".syllabus-source").waitFor({ state: "visible" });
  assert.match(await preview.locator(".syllabus-source").innerText(), /Uploaded reference text stays read-only: résumé, 中文, ✓/);
  assert.equal(await preview.locator("input,textarea,select").count(), 0, "uploaded text preview has no editable fields");
  assert.equal(await preview.getByText("File name", { exact: true }).count(), 0);
  await assertDialogTopmost(page, '[aria-label="Private file preview"]');
  await assertViewportFits(page, viewport.width, ".add-class-modal");
  await page.screenshot({ path: resolve(screenshotDir, `${viewport.name}-uploaded-text-preview.png`), animations: "disabled" });
  await preview.getByRole("button", { name: "Close file preview" }).click();
  await preview.waitFor({ state: "detached" });

  const finalState = await fixtureState(page);
  const postRequests = finalState.requests.filter((request) => request.path === "/api/file-documents" && request.method === "POST");
  assert.equal(postRequests.length, 3, "New, folder, and background creation each perform one durable POST");
  assert.ok(finalState.requests.some((request) => request.method === "GET" && request.path.includes("/api/file-documents?id=")),
    "reopening the created document reads the durable saved version");
  assert.ok(finalState.requests.some((request) => request.method === "PUT" && request.body?.body === unicodeBody),
    "Unicode content and the renamed file name were saved through PUT");
  const finalMetrics = await assertViewportFits(page, viewport.width);
  console.log(`${viewport.name} (${viewport.width}px): ${JSON.stringify({
    browser: finalMetrics.browser,
    posts: postRequests.map(({ body }) => ({ name: body?.name, folderId: body?.folderId, empty: body?.body === "" })),
    saves: finalState.requests.filter((request) => request.method === "PUT").length,
    reads: finalState.requests.filter((request) => request.method === "GET" && request.path.includes("/api/file-documents?id=")).length,
  })}`);
}

try {
  browser = await playwright.chromium.launch(launchOptions);
  const viewports = [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ];
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      ignoreHTTPSErrors: true,
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== baseUrl) { await route.continue(); return; }
      if (url.pathname === "/fixture.js") {
        await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", headers: { "cache-control": "no-store" }, body: js });
      } else if (url.pathname === "/favicon.ico") {
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "cache-control": "no-store" }, body: html });
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`pageerror at ${viewport.width}px: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console at ${viewport.width}px: ${message.text()}`); });
    page.on("requestfailed", (request) => errors.push(`requestfailed at ${viewport.width}px: ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`));
    await runAcceptance(page, viewport);
    await context.close();
  }
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(`Native document browser verification passed at 1440px and 390px. Screenshots: ${screenshotDir}`);
} finally {
  if (browser) await browser.close();
}
