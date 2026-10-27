import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href) : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href) : await import("esbuild");
const css = await Promise.all(["app/globals.css", "app/auth.css", "app/class-setup.css"].map((file) => readFile(resolve(repoRoot, file), "utf8")));
const sourceOverride = process.env.CLASS_SETUP_SOURCE;
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/class-credits-focus-browser.tsx")], bundle: true, write: false,
  platform: "browser", format: "iife", target: "chrome120", jsx: "automatic", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
  plugins: sourceOverride ? [{ name: "class-setup-source-override", setup(build) {
    build.onLoad({ filter: /class-setup\.tsx$/ }, async () => ({ contents: await readFile(resolve(sourceOverride), "utf8"), loader: "tsx", resolveDir: resolve(repoRoot, "app") }));
  } }] : [],
});
const styles = css.map((source) => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
const html = `<!doctype html><html data-theme="light" data-motion="reduced"><head><meta charset="utf-8"><base href="https://edu.example/"><style>:root{--font-geist-sans:Arial,sans-serif}${styles}</style></head><body><div id="root"></div></body></html>`;
const launch = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launch.executablePath = process.env.CHROME_EXECUTABLE;
else launch.channel = "chrome";
let browser;
try {
  browser = await playwright.chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://edu.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("https://edu.example/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  try { await page.waitForSelector('input[type="number"]', { timeout: 2000 }); }
  catch (error) { console.log(`Mount diagnostics: ${JSON.stringify({ errors, root: await page.locator("#root").innerText(), html: (await page.locator("#root").innerHTML()).slice(0, 1000) })}`); throw error; }
  const credits = page.getByRole("spinbutton", { name: "Credits" });
  assert.equal(await credits.count(), 1, "Credits is an accessible number input");
  assert.deepEqual(await credits.evaluate((input) => ({ min: input.getAttribute("min"), max: input.getAttribute("max"), step: input.getAttribute("step") })), { min: "0", max: "30", step: "1" }, "number constraints are preserved");
  await page.getByText("Credits", { exact: true }).click();
  assert.equal(await credits.evaluate((input) => document.activeElement === input), true, "clicking Credits focuses the input");
  await credits.fill("4");
  assert.equal(await credits.inputValue(), "4", "number editing updates the controlled input");
  const gap = await credits.evaluate((input) => {
    const label = input.labels[0];
    const walker = document.createTreeWalker(label ?? input.parentElement, NodeFilter.SHOW_TEXT);
    let textNode;
    while (walker.nextNode()) if (walker.currentNode.textContent?.includes("Credits")) { textNode = walker.currentNode; break; }
    const range = document.createRange(); range.selectNodeContents(textNode);
    const text = range.getBoundingClientRect(), rect = input.getBoundingClientRect();
    const x = rect.left + rect.width * 0.65, y = (text.bottom + rect.top) / 2, target = document.elementFromPoint(x, y);
    window.__creditsFocusEvents = [];
    input.addEventListener("focus", () => window.__creditsFocusEvents.push("focus"));
    input.addEventListener("blur", () => window.__creditsFocusEvents.push("blur"));
    return { x, y, hitLabel: Boolean(target?.closest("label")), hitTag: target?.tagName };
  });
  await page.mouse.click(gap.x, gap.y);
  await page.waitForTimeout(60);
  const afterGap = await credits.evaluate((input) => ({ focused: document.activeElement === input, value: input.value, events: window.__creditsFocusEvents }));
  console.log(`Credits gap click: ${JSON.stringify({ ...gap, ...afterGap })}`);
  assert.equal(gap.hitLabel, false, "the visual gap above Credits is outside the label hit target");
  assert.equal(afterGap.focused, false, "clicking the visual gap leaves Credits unfocused");
  assert.equal(afterGap.value, "4", "the entered number persists after blur");
  assert.deepEqual(afterGap.events, ["blur"], "gap click blurs once without label refocus");
  await page.getByText("Credits", { exact: true }).click();
  assert.equal(await credits.evaluate((input) => document.activeElement === input), true, "clicking label text still focuses Credits");
  assert.equal(await credits.inputValue(), "4", "refocusing the field preserves its edited value");
  assert.deepEqual(errors, [], `browser emitted no page errors: ${errors.join("; ")}`);
  console.log("ClassSetup Credits browser verification passed.");
} finally { if (browser) await browser.close(); }
