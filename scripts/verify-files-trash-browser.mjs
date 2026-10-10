import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(repoRoot, ".vinext/verify-files-trash");
const FOLDER_ID = {
  root: "11111111-1111-4111-8111-111111111111",
  child: "22222222-2222-4222-8222-222222222222",
  deep: "33333333-3333-4333-8333-333333333333",
  independent: "77777777-7777-4777-8777-777777777777",
};
const FILE_ID = { notes: "44444444-4444-4444-8444-444444444444", source: "55555555-5555-4555-8555-555555555555" };
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
  "app/file-archive-dialog.css",
  "app/file-organization-dialogs.css",
  "app/files-trash-dialog.css",
  "app/course-syllabus.css",
  "app/auth.css",
];
const cssSources = await Promise.all(cssFiles.map((file) => readFile(resolve(repoRoot, file), "utf8")));
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/files-trash-browser.tsx")],
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
const baseUrl = "https://files-trash.test";
await mkdir(screenshotDir, { recursive: true });
const responsiveFailures = [];

const launchOptions = {
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
};
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
const errors = [];
let browser;

async function preparePage(viewport, query) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, ignoreHTTPSErrors: true });
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
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(`pageerror at ${viewport.width}px: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console at ${viewport.width}px: ${message.text()}`); });
  await page.goto(`${baseUrl}/files?${query}`);
  await page.locator(".files-view-nav").getByRole("button", { name: "Trash", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => Boolean(window.__filesTrashFixture?.getFiles));
  await page.getByRole("button", { name: "More options for Project Phoenix" }).waitFor({ state: "visible" });
  return { context, page };
}

async function fixture(page, method, ...args) {
  return page.evaluate(({ methodName, values }) => window.__filesTrashFixture[methodName](...values), { methodName: method, values: args });
}

async function mutations(page) { return await fixture(page, "getMutationRequests"); }
async function settle(page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations({ subtree: true })) animation.finish();
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function inspectBrowser(page, width) {
  const metrics = await page.evaluate(() => {
    const browserElement = document.querySelector(".files-browser");
    const content = document.querySelector(".files-browser-content");
    const rect = browserElement?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      browser: rect ? { left: rect.left, right: rect.right } : null,
      content: contentRect ? { left: contentRect.left, right: contentRect.right } : null,
    };
  });
  assert.ok(metrics.browser, `Trash Files Browser renders at ${width}px`);
  assert.ok(metrics.document <= width + 1, `document does not overflow at ${width}px (${metrics.document}px)`);
  assert.ok(metrics.body <= width + 1, `body does not overflow at ${width}px (${metrics.body}px)`);
  assert.ok(metrics.browser.left >= -1 && metrics.browser.right <= width + 1,
    `Files Browser fits at ${width}px (${metrics.browser.left}–${metrics.browser.right})`);
  assert.ok(metrics.content?.left >= -1 && metrics.content.right <= width + 1, `Trash content fits at ${width}px`);
  return metrics;
}

async function assertDialogTopmost(page, dialog, width) {
  await settle(page);
  const close = dialog.getByRole("button", { name: "Close Trash dialog" });
  await close.scrollIntoViewIfNeeded();
  const evidence = await dialog.evaluate((element) => {
    const backdrop = element.closest(".files-trash-backdrop");
    const closeButton = element.querySelector(".files-details-heading button");
    const dialogRect = element.getBoundingClientRect();
    const backdropRect = backdrop?.getBoundingClientRect();
    const closeRect = closeButton?.getBoundingClientRect();
    const hit = closeRect ? document.elementFromPoint(closeRect.left + closeRect.width / 2, closeRect.top + closeRect.height / 2) : null;
    return {
      dialogOpacity: Number(getComputedStyle(element).opacity),
      backdropOpacity: backdrop ? Number(getComputedStyle(backdrop).opacity) : 0,
      dialog: { left: dialogRect.left, top: dialogRect.top, right: dialogRect.right, bottom: dialogRect.bottom },
      backdrop: backdropRect ? { left: backdropRect.left, top: backdropRect.top, right: backdropRect.right, bottom: backdropRect.bottom } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      close: closeRect ? { left: closeRect.left, top: closeRect.top, right: closeRect.right, bottom: closeRect.bottom, width: closeRect.width, height: closeRect.height } : null,
      closeIsTopmost: Boolean(closeButton && hit && closeButton.contains(hit)),
    };
  });
  assert.ok(evidence.dialogOpacity >= 0.99, `Trash dialog is opaque (${JSON.stringify(evidence)})`);
  assert.ok(evidence.backdropOpacity >= 0.99, `Trash backdrop is opaque (${JSON.stringify(evidence)})`);
  assert.ok(evidence.backdrop && Math.abs(evidence.backdrop.left) <= 1 && Math.abs(evidence.backdrop.top) <= 1 &&
    Math.abs(evidence.backdrop.right - width) <= 1 && Math.abs(evidence.backdrop.bottom - evidence.viewport.height) <= 1,
  `Trash backdrop covers the viewport (${JSON.stringify(evidence)})`);
  assert.ok(evidence.dialog.left >= -1 && evidence.dialog.right <= width + 1 &&
    evidence.dialog.top >= -1 && evidence.dialog.bottom <= evidence.viewport.height + 1,
  `Trash dialog fits in the viewport (${JSON.stringify(evidence)})`);
  assert.ok(evidence.close && evidence.close.width > 0 && evidence.close.height > 0 &&
    evidence.close.top >= -1 && evidence.close.bottom <= evidence.viewport.height + 1 && evidence.closeIsTopmost,
  `Trash dialog close control is visible and topmost (${JSON.stringify(evidence)})`);
  return evidence;
}

async function assertDialogFocusTrap(page, dialog) {
  const focusable = dialog.locator("button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])");
  const handles = await focusable.elementHandles();
  assert.ok(handles.length > 1, "Trash dialog has multiple focusable controls");
  await handles[0].focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate((element) => document.activeElement === element, handles.at(-1)), true,
    "Shift+Tab wraps from the first Trash dialog control to the last enabled control");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate((element) => document.activeElement === element, handles[0]), true,
    "Tab wraps from the last Trash dialog control to the first");
}

async function openItemMenu(page, itemName) {
  await page.getByRole("button", { name: `More options for ${itemName}` }).click();
  const menu = page.getByRole("menu", { name: `${itemName} actions` });
  await menu.waitFor({ state: "visible" });
  return menu;
}

async function screenshot(page, name, fullPage = false) {
  await settle(page);
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage, animations: "disabled" });
}

async function responsiveTrashViewport(viewport) {
  const { context, page } = await preparePage(viewport, "scenario=layout&view=trash&layout=list");
  try {
    const metrics = await inspectBrowser(page, viewport.width);
    const emptyTrigger = page.locator(".files-trash-empty-button");
    assert.equal(await emptyTrigger.innerText(), "Empty Trash (7)", `all trashed rows count at ${viewport.width}px`);
    assert.equal(await mutations(page).then((records) => records.length), 0, "Trash does not delete items automatically on load");

    const rootItem = page.getByRole("listitem").filter({ hasText: "Project Phoenix" });
    const rootCopy = await rootItem.innerText();
    assert.match(rootCopy, /Project Phoenix/, `Trash shows the root item's original path at ${viewport.width}px`);
    const deletedTitle = await rootItem.locator(".files-item-modified").getAttribute("title");
    assert.ok(deletedTitle && deletedTitle.includes("2026") && Number.isFinite(Date.parse(deletedTitle)),
      `Trash exposes a valid deleted time at ${viewport.width}px (${deletedTitle})`);
    await rootItem.getByRole("button", { name: "Open folder: Project Phoenix" }).click();
    await page.getByRole("button", { name: "Open folder: Working copy" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Open folder: Working copy" }).click();
    await page.getByRole("button", { name: "More options for Numbers.txt" }).waitFor({ state: "visible" });
    await assertNoHorizontalOverflowInTree(page, viewport.width);
    await screenshot(page, `trash-tree-${viewport.name}.png`, true);

    await openItemMenu(page, "Numbers.txt");
    await page.getByRole("menuitem", { name: "Details", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Numbers.txt" });
    await details.waitFor({ state: "visible" });
    const rows = await details.locator(".files-details-list > div").evaluateAll((elements) =>
      Object.fromEntries(elements.map((element) => [element.children[0]?.textContent?.trim(), element.children[1]?.textContent?.trim()])),
    );
    assert.equal(rows["Original location"], "Project Phoenix/Working copy/Numbers.txt",
      `file details preserve the full original path at ${viewport.width}px`);
    assert.ok(rows.Deleted && rows.Deleted.includes("2026"), `file details show the deletion time at ${viewport.width}px`);
    await assertNoHorizontalOverflowInTree(page, viewport.width);

    await details.getByRole("button", { name: "Close details" }).click();
    await details.waitFor({ state: "detached" });
    await page.locator(".files-breadcrumbs").getByRole("button", { name: "Trash", exact: true }).click();
    await screenshot(page, `trash-list-${viewport.name}.png`, true);
    const triggerHandle = await emptyTrigger.elementHandle();
    await emptyTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Empty Trash" });
    await dialog.waitFor({ state: "visible" });
    assert.match(await dialog.innerText(), /7 items in Trash/);
    assert.match(await dialog.innerText(), /Includes trashed files and folders, including nested items\./);
    await assertDialogTopmost(page, dialog, viewport.width);
    await assertDialogFocusTrap(page, dialog);
    assert.equal(await mutations(page).then((records) => records.length), 0, "opening Empty Trash requires no mutation");
    await screenshot(page, `empty-trash-dialog-${viewport.name}.png`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction((trigger) => document.activeElement === trigger, triggerHandle);
    await inspectBrowser(page, viewport.width);
    assert.deepEqual(await mutations(page), [], "cancelling Empty Trash leaves all rows untouched");
    console.log(`${viewport.width}px Trash layout: ${JSON.stringify(metrics)}`);
  } finally {
    await context.close();
  }
}

async function assertNoHorizontalOverflowInTree(page, width) {
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    items: document.querySelector(".files-items")?.getBoundingClientRect().right ?? 0,
    offenders: [...document.querySelectorAll("body *")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, className: typeof element.className === "string" ? element.className : "", text: element.textContent?.trim().slice(0, 60) ?? "", left: rect.left, right: rect.right, width: rect.width };
    }).filter((rect) => rect.right > window.innerWidth + 1).slice(0, 12),
  }));
  if (!(dimensions.document <= width + 1 && dimensions.body <= width + 1 && dimensions.items <= width + 1)) {
    responsiveFailures.push(`Trash tree stays within ${width}px (${JSON.stringify(dimensions)})`);
  }
}

async function verifyReadonly() {
  const viewport = { name: "readonly", width: 1024, height: 900 };
  const { context, page } = await preparePage(viewport, "scenario=readonly&view=trash&layout=list&readonly=1");
  try {
    assert.match(await page.locator(".files-readonly-note").innerText(), /Trash is read-only/);
    const empty = page.locator(".files-trash-empty-button");
    assert.equal(await empty.isDisabled(), true, "Empty Trash is disabled when the workspace is read-only");
    const menu = await openItemMenu(page, "Project Phoenix");
    assert.equal(await menu.getByRole("menuitem", { name: "Restore", exact: true }).isDisabled(), true);
    assert.equal(await menu.getByRole("menuitem", { name: "Delete permanently", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");

    await fixture(page, "setReadonly", false);
    const itemMenu = await openItemMenu(page, "Project Phoenix");
    await itemMenu.getByRole("menuitem", { name: "Restore", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Restore from Trash" });
    await dialog.waitFor({ state: "visible" });
    await fixture(page, "setReadonly", true);
    await dialog.getByRole("note").filter({ hasText: "Files changes are unavailable while this workspace is read-only." }).waitFor({ state: "visible" });
    assert.equal(await dialog.getByRole("button", { name: "Restore", exact: true }).isDisabled(), true,
      "the open Restore dialog disables its submit control when access becomes read-only");
    assert.deepEqual(await mutations(page), [], "read-only browsing and dialogs never mutate Trash");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  } finally {
    await context.close();
  }
}

async function verifyRecursiveTrashUndoAndFallback() {
  const viewport = { name: "trash-flow", width: 1440, height: 1000 };
  const { context, page } = await preparePage(viewport, "scenario=main&view=my-files&layout=list");
  try {
    const menu = await openItemMenu(page, "Project Phoenix");
    await menu.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Move to Trash" });
    await dialog.waitFor({ state: "visible" });
    const text = await dialog.innerText();
    assert.match(text, /Project Phoenix/);
    assert.match(text, /5 items/);
    assert.match(text, /You can restore them later/);
    assert.deepEqual(await mutations(page), [], "Move to Trash is confirmation-gated");
    await assertDialogTopmost(page, dialog, viewport.width);
    await assertDialogFocusTrap(page, dialog);
    await screenshot(page, "move-to-trash-confirmation.png");
    await dialog.getByRole("button", { name: "Move to Trash", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const undoReceipt = await fixture(page, "getUndoReceipt");
    assert.ok(undoReceipt, "the root fixture receives the Trash completion callback");
    assert.ok(undoReceipt.label.includes("Project Phoenix"), `Undo notification names the trashed folder (${undoReceipt.label})`);
    await page.getByRole("status").filter({ hasText: undoReceipt.label }).waitFor({ state: "visible" });
    const trashRequest = (await mutations(page))[0];
    assert.equal(trashRequest.body.action, "trash");
    assert.deepEqual(trashRequest.body.items, [{ type: "folder", id: FOLDER_ID.root, revision: 1 }]);
    const stateAfterTrash = await fixture(page, "getFiles");
    const foldersAfterTrash = await fixture(page, "getFolders");
    assert.equal(foldersAfterTrash.filter((item) => item.trash_operation_id === trashRequest.body.items[0].id).length, 0,
      "the server response, not the selected item ID, carries the recursive operation ID");
    assert.deepEqual(foldersAfterTrash.filter((item) => item.trash_operation_id).map((item) => item.id).sort(),
      [FOLDER_ID.root, FOLDER_ID.child, FOLDER_ID.deep, FOLDER_ID.independent].sort(), "recursive Trash includes active descendants and keeps independent Trash rows");
    assert.deepEqual(stateAfterTrash.filter((item) => item.trashed_at && item.trash_operation_id === "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1").map((item) => item.id).sort(),
      [FILE_ID.notes, FILE_ID.source].sort(), "recursive Trash moves both nested files");

    const undoButton = page.getByRole("button", { name: "Undo", exact: true });
    await undoButton.waitFor({ state: "visible" });
    await undoButton.click();
    await page.getByRole("button", { name: "Open folder: Project Phoenix" }).waitFor({ state: "visible" });
    const afterUndo = await fixture(page, "getFolders");
    const independentlyTrashed = afterUndo.find((item) => item.id === FOLDER_ID.independent);
    assert.ok(independentlyTrashed?.trashed_at, "Undo restores only the confirmed folder operation and leaves an independent child in Trash");
    assert.equal(independentlyTrashed?.trash_operation_id, "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2");
    assert.equal((await mutations(page)).filter((record) => record.body.action === "restore").length, 1,
      "Undo calls the restore operation once");

    await page.locator(".files-view-nav").getByRole("button", { name: "Trash", exact: true }).click();
    await page.getByRole("button", { name: "More options for Lost item.txt" }).waitFor({ state: "visible" });
    await openItemMenu(page, "Lost item.txt");
    await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
    const fallbackDialog = page.getByRole("dialog", { name: "Restore from Trash" });
    await fallbackDialog.waitFor({ state: "visible" });
    assert.match(await fallbackDialog.innerText(), /visible Restored files folder/);
    await fallbackDialog.getByRole("button", { name: "Restore", exact: true }).click();
    await fallbackDialog.waitFor({ state: "detached" });
    await page.getByRole("status").filter({ hasText: "Restored to Restored files because the original location was unavailable." }).waitFor({ state: "visible" });
    const restored = (await fixture(page, "getFiles")).find((item) => item.id === "88888888-8888-4888-8888-888888888888");
    assert.equal(restored?.folder_id, "99999999-9999-4999-8999-999999999999");
    assert.equal(restored?.trashed_at, null);
    const stillInTrash = await fixture(page, "getFolders");
    assert.ok(stillInTrash.find((item) => item.id === FOLDER_ID.independent)?.trashed_at,
      "restoring an unrelated file does not restore the independently trashed child folder");
    console.log("Recursive Trash, Undo, independent child, and restore fallback passed.");
  } finally {
    await context.close();
  }
}

async function verifyPermanentDeleteRetry() {
  const viewport = { name: "permanent-delete", width: 1440, height: 1000 };
  const { context, page } = await preparePage(viewport, "scenario=retry&view=trash&layout=list");
  try {
    const menu = await openItemMenu(page, "Project Phoenix");
    await menu.getByRole("menuitem", { name: "Delete permanently", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete folder permanently" });
    await dialog.waitFor({ state: "visible" });
    const text = await dialog.innerText();
    assert.match(text, /Permanently delete “Project Phoenix” and its contents \(5 items\)\?/);
    assert.match(text, /This action cannot be undone\./);
    await assertDialogTopmost(page, dialog, viewport.width);
    await assertDialogFocusTrap(page, dialog);
    assert.deepEqual(await mutations(page), [], "permanent deletion requires explicit confirmation");
    await screenshot(page, "permanent-delete-confirmation.png");
    await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
    const errorAlert = dialog.getByRole("alert").filter({ hasText: "Mock physical object cleanup failed." });
    await errorAlert.waitFor({ state: "visible" });
    assert.match(await errorAlert.innerText(), /kept for an exact retry/);
    const failedRows = await mutations(page);
    assert.equal(failedRows.length, 1, "the physical cleanup failure produces one request without auto-retrying");
    const firstRequest = failedRows[0];
    assert.equal(firstRequest.body.action, "permanent-delete");
    assert.match(firstRequest.body.requestId, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
    assert.deepEqual(firstRequest.body.items, [{ type: "folder", id: FOLDER_ID.root, revision: 2 }]);
    const pendingFiles = await fixture(page, "getFiles");
    assert.equal(pendingFiles.filter((item) => item.state === "deleting").length, 2,
      "failed physical cleanup leaves rows pending for explicit retry");
    const pendingFolders = await fixture(page, "getFolders");
    assert.equal(pendingFolders.filter((item) => item.purge_pending_at).length, 3);
    await page.waitForTimeout(500);
    assert.equal((await mutations(page)).length, 1, "the dialog never retries permanent deletion automatically");
    await dialog.getByRole("button", { name: "Retry permanent deletion", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const attempts = await mutations(page);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].body.requestId, firstRequest.body.requestId, "retry reuses the original UUID");
    assert.deepEqual(attempts[1].body.items, firstRequest.body.items, "retry reuses the exact item snapshot");
    assert.equal((await fixture(page, "getFiles")).length, 0);
    assert.equal((await fixture(page, "getFolders")).length, 0);
    await page.getByRole("heading", { name: "Trash is empty" }).waitFor({ state: "visible" });
    console.log(`Permanent deletion failure retried with request UUID ${firstRequest.body.requestId}.`);
  } finally {
    await context.close();
  }
}

async function verifyEmptyTrash() {
  const viewport = { name: "empty-trash", width: 1024, height: 900 };
  const { context, page } = await preparePage(viewport, "scenario=empty&view=trash&layout=list");
  try {
    const trigger = page.locator(".files-trash-empty-button");
    assert.equal(await trigger.innerText(), "Empty Trash (7)");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Empty Trash" });
    await dialog.waitFor({ state: "visible" });
    assert.match(await dialog.innerText(), /Permanently delete all 7 items in Trash\?/);
    assert.match(await dialog.innerText(), /including nested items/);
    assert.match(await dialog.innerText(), /This action cannot be undone\./);
    assert.deepEqual(await mutations(page), [], "opening Empty Trash does not delete any rows");
    await dialog.getByRole("button", { name: "Empty Trash", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const action = (await mutations(page))[0];
    assert.equal(action.body.action, "empty-trash");
    assert.equal(action.body.items, undefined, "Empty Trash asks the server to capture the current full Trash set");
    assert.match(action.body.requestId, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
    const manifest = (await fixture(page, "getPurgeManifests"))[0];
    assert.equal(manifest.requestId, action.body.requestId);
    assert.equal(manifest.files.length + manifest.folders.length, 7, "server captures root, nested, and independent trashed rows");
    await page.getByRole("heading", { name: "Trash is empty" }).waitFor({ state: "visible" });
    assert.equal(await trigger.isDisabled(), true, "Empty Trash is disabled after every trashed row is removed");
    assert.deepEqual(await fixture(page, "getFiles"), []);
    assert.deepEqual(await fixture(page, "getFolders"), []);
    console.log("Empty Trash captured and removed all 7 trashed rows, including nested children.");
  } finally {
    await context.close();
  }
}

try {
  if (!process.env.CHROME_EXECUTABLE) throw new Error("Set CHROME_EXECUTABLE to the installed Chrome executable for actualChrome verification.");
  browser = await playwright.chromium.launch(launchOptions);
  const viewports = [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "compact-desktop", width: 1024, height: 900 },
    { name: "tablet", width: 820, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ];
  for (const viewport of viewports) await responsiveTrashViewport(viewport);
  await verifyReadonly();
  await verifyRecursiveTrashUndoAndFallback();
  await verifyPermanentDeleteRetry();
  await verifyEmptyTrash();
  assert.deepEqual(errors, [], errors.join("\n"));
  assert.deepEqual(responsiveFailures, [], responsiveFailures.join("\n"));
  console.log(`Files Trash browser verification passed at ${viewports.map(({ width }) => `${width}px`).join(", ")}. Screenshots: ${screenshotDir}`);
} finally {
  if (browser) await browser.close();
}
