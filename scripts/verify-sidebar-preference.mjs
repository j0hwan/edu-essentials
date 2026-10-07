import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clientModule } from "../tests/helpers/client-modules.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const [{ SIDEBAR_COLLAPSED_BOOTSTRAP, SIDEBAR_COLLAPSED_STORAGE_KEY }, globalCss, referenceCss] = await Promise.all([
  import(await clientModule("lib/sidebar-preference.ts")),
  readFile(resolve(repoRoot, "app/globals.css"), "utf8"),
  readFile(resolve(repoRoot, "app/reference-ui.css"), "utf8"),
]);
const css = [globalCss, referenceCss].map((source) => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
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
        <div class="brand-row">
          <div class="brand-mark">E</div>
          <div class="brand-copy"><strong>EduEssentials</strong><span>Student workspace</span></div>
          <button class="icon-button sidebar-toggle" aria-label="Collapse sidebar">Toggle</button>
        </div>
        <nav class="main-nav"><a class="nav-item" href="/home"><span>Home</span></a></nav>
        <div class="sidebar-bottom"><a class="profile-card" href="/settings"><span class="avatar">A</span><span><strong>Alex</strong><small>Student workspace</small></span></a></div>
      </aside>
      <main class="main-content"><div class="page"><h1>Home</h1></div></main>
    </div>
  </body>
</html>`;

const server = createServer((request, response) => {
  if (request.url?.startsWith("/favicon.ico")) { response.writeHead(204); response.end(); return; }
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

async function openPage({ value = undefined, blocked = false, width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
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
  return { context, page };
}

async function metrics(page) {
  return page.locator(".app-shell").evaluate((shell) => {
    const sidebar = shell.querySelector(".sidebar");
    const label = shell.querySelector(".nav-item > span");
    return {
      rootValue: document.documentElement.getAttribute("data-sidebar-collapsed"),
      sidebarWidth: sidebar.getBoundingClientRect().width,
      labelDisplay: getComputedStyle(label).display,
      contentLeft: shell.querySelector(".main-content").getBoundingClientRect().left,
      contentOffset: getComputedStyle(shell).getPropertyValue("--content-offset").trim(),
    };
  });
}

try {
  browser = await playwright.chromium.launch(launchOptions);
  let collapsedDesktop;
  const { context: collapsedContext, page: collapsedPage } = await openPage({ value: "true" });
  try {
    const initial = await metrics(collapsedPage);
    collapsedDesktop = initial;
    assert.equal(initial.rootValue, "true", "the before-hydration bootstrap sees the saved collapsed preference");
    assert.ok(initial.sidebarWidth < 100, `desktop sidebar is collapsed on first render (${initial.sidebarWidth}px)`);
    assert.equal(initial.labelDisplay, "none", "collapsed navigation labels are hidden before hydration");
  } finally { await collapsedContext.close(); }

  const { context: expandedContext, page: expandedPage } = await openPage({ value: "false" });
  try {
    const initial = await metrics(expandedPage);
    assert.equal(initial.rootValue, "false", "false is represented explicitly by the early script");
    assert.ok(initial.sidebarWidth > 200, `desktop sidebar remains expanded (${initial.sidebarWidth}px)`);
    assert.notEqual(initial.labelDisplay, "none", "expanded navigation labels remain visible");
    assert.ok(collapsedDesktop.contentLeft < initial.contentLeft, "desktop content reflows to use the space released by the collapsed sidebar");
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
  } finally { await mobileContext.close(); }

  assert.deepEqual(errors, [], "browser console and page errors are empty");
  console.log("Sidebar first-paint browser QA passed: collapsed, expanded, fallback, and mobile geometry.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}
