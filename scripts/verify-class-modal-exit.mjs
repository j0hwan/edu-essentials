import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readWorkspaceStylesheets } from "../tests/helpers/workspace-presentation.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE
  ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href)
  : await import("esbuild");
const { css } = await readWorkspaceStylesheets();
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/class-modal-exit-browser.tsx")], bundle: true, write: false,
  platform: "browser", format: "iife", target: "chrome120", jsx: "automatic", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
});
const html = `<!doctype html><html data-theme="light" data-motion="full"><head><meta charset="utf-8"><base href="https://edu.example/"><style>:root{--font-geist-sans:Arial,sans-serif}${css}</style></head><body><div id="root"></div></body></html>`;
const launch = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launch.executablePath = process.env.CHROME_EXECUTABLE;
else launch.channel = "chrome";
let browser;
try {
  browser = await playwright.chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1024, height: 800 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || (message.type() === "warning" && /aria-hidden/i.test(message.text()))) errors.push(message.text());
  });
  await page.route("https://edu.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("https://edu.example/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("dialog", { name: "Add a class" }).waitFor();
  assert.equal(await page.locator(".modal-backdrop").count(), 1, "the chooser starts with one backdrop");
  await page.locator(".modal-backdrop").evaluate(async (backdrop) => Promise.all(backdrop.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
  await page.screenshot({ path: "/tmp/class-modal-exit-chooser.png" });

  await page.getByRole("button", { name: "Manual entry" }).click();
  await page.getByRole("dialog", { name: "Course information" }).waitFor();
  assert.equal(await page.locator(".modal-backdrop").count(), 1, "handoff from chooser to ClassSetup keeps a single backdrop");
  assert.equal(await page.locator(".add-class-choice-modal").count(), 0, "the chooser is gone when ClassSetup opens");
  assert.equal(await page.locator(".class-setup").getAttribute("data-morphing-entry"), "true", "chooser bounds are passed into ClassSetup for the handoff");
  await page.locator(".modal-backdrop").evaluate(async (backdrop) => Promise.all(backdrop.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
  await page.screenshot({ path: "/tmp/class-modal-exit-class-setup.png" });

  await page.evaluate(() => { window.__confirmations = 0; window.confirm = () => { window.__confirmations++; return true; }; });
  await page.getByLabel("Class name").fill("Biology advanced");
  await page.keyboard.press("Escape");
  const exiting = page.locator('.modal-backdrop[data-modal-exiting][aria-hidden="true"][inert]');
  await exiting.waitFor();
  assert.equal(await page.locator(".modal-backdrop").count(), 1, "the exiting dialog remains mounted during its fade");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.__confirmations), 1, "the second Escape does not reconfirm while exit is active");

  const samples = await page.evaluate(async () => {
    const backdrop = document.querySelector(".modal-backdrop[data-modal-exiting]");
    const dialog = backdrop?.querySelector('[role="dialog"]');
    if (!backdrop || !dialog) throw new Error("exit nodes disappeared before sampling");
    const read = () => {
      const style = getComputedStyle(backdrop);
      const blur = Number(style.backdropFilter.match(/blur\(([\d.]+)px\)/)?.[1]);
      return { opacity: Number(style.opacity), blur, dialogOpacity: Number(getComputedStyle(dialog).opacity) };
    };
    const values = [read()];
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 45));
      values.push(read());
    }
    return values;
  });
  assert.ok(samples.every((sample) => Number.isFinite(sample.blur)), `backdrop blur is numeric: ${JSON.stringify(samples)}`);
  assert.ok(samples[0].blur > samples[1].blur && samples[1].blur > samples[2].blur, `backdrop blur decreases during exit: ${JSON.stringify(samples)}`);
  assert.ok(samples[0].opacity > samples[1].opacity && samples[1].opacity > samples[2].opacity, `backdrop opacity decreases during exit: ${JSON.stringify(samples)}`);
  assert.ok(samples[0].dialogOpacity > samples[2].dialogOpacity, `dialog fades during exit: ${JSON.stringify(samples)}`);
  await page.screenshot({ path: "/tmp/class-modal-exit-mid-transition.png" });
  await page.locator(".modal-backdrop").waitFor({ state: "detached", timeout: 1200 });
  assert.equal(await page.evaluate(() => window.__confirmations), 1);
  assert.deepEqual(errors, [], `browser emitted no page errors: ${errors.join("; ")}`);

  const chooserClosePage = await context.newPage();
  const chooserCloseErrors = [];
  chooserClosePage.on("pageerror", (error) => chooserCloseErrors.push(error.message));
  chooserClosePage.on("console", (message) => {
    if (message.type() === "error" || (message.type() === "warning" && /aria-hidden/i.test(message.text()))) chooserCloseErrors.push(message.text());
  });
  await chooserClosePage.route("https://edu.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await chooserClosePage.goto("https://edu.example/");
  await chooserClosePage.addScriptTag({ content: bundle.outputFiles[0].text });
  await chooserClosePage.getByRole("dialog", { name: "Add a class" }).waitFor();
  await chooserClosePage.locator(".modal-backdrop").evaluate(async (backdrop) => Promise.all(backdrop.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
  await chooserClosePage.screenshot({ path: "/tmp/class-modal-exit-chooser.png" });
  await chooserClosePage.getByRole("button", { name: "Close chooser" }).click();
  await chooserClosePage.locator('.modal-backdrop[data-modal-exiting]').waitFor();
  assert.equal(await chooserClosePage.locator(".modal-backdrop").count(), 1, "directly closing the chooser retains one backdrop while it exits");
  const chooserSamples = await chooserClosePage.evaluate(async () => {
    const backdrop = document.querySelector(".modal-backdrop[data-modal-exiting]");
    const dialog = backdrop?.querySelector('[role="dialog"]');
    if (!backdrop || !dialog) throw new Error("chooser exit nodes disappeared before sampling");
    const activeTargets = backdrop.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").map((animation) => {
      const target = animation.effect?.target;
      return target === backdrop ? "backdrop" : target === dialog ? "dialog" : target instanceof Element ? target.tagName.toLowerCase() : "unknown";
    });
    const read = () => {
      const style = getComputedStyle(backdrop);
      return { opacity: Number(style.opacity), blur: Number(style.backdropFilter.match(/blur\(([\d.]+)px\)/)?.[1]) };
    };
    const values = [read()];
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 45));
      values.push(read());
    }
    return { activeTargets, values };
  });
  assert.deepEqual(chooserSamples.activeTargets.sort(), ["backdrop", "dialog"], `chooser exit has no child reveal animations: ${JSON.stringify(chooserSamples)}`);
  assert.ok(chooserSamples.values.every((sample) => Number.isFinite(sample.blur)), `chooser blur samples are numeric: ${JSON.stringify(chooserSamples.values)}`);
  assert.ok(chooserSamples.values[0].blur > chooserSamples.values[1].blur && chooserSamples.values[1].blur > chooserSamples.values[2].blur, `chooser blur decreases during exit: ${JSON.stringify(chooserSamples.values)}`);
  assert.ok(chooserSamples.values[0].opacity > chooserSamples.values[1].opacity && chooserSamples.values[1].opacity > chooserSamples.values[2].opacity, `chooser opacity decreases during exit: ${JSON.stringify(chooserSamples.values)}`);
  await chooserClosePage.screenshot({ path: "/tmp/class-modal-exit-chooser-mid-transition.png" });
  await chooserClosePage.locator(".modal-backdrop").waitFor({ state: "detached", timeout: 1200 });
  assert.deepEqual(chooserCloseErrors, [], `chooser exit emitted no browser errors or aria-hidden warning: ${chooserCloseErrors.join("; ")}`);
  await chooserClosePage.close();
  await context.close();

  const reducedContext = await browser.newContext({ viewport: { width: 1024, height: 800 }, reducedMotion: "reduce" });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.route("https://edu.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await reducedPage.goto("https://edu.example/");
  await reducedPage.addScriptTag({ content: bundle.outputFiles[0].text });
  await reducedPage.getByRole("button", { name: "Manual entry" }).click();
  await reducedPage.getByRole("dialog", { name: "Course information" }).waitFor();
  await reducedPage.getByRole("button", { name: "Close class setup" }).click();
  await reducedPage.locator(".modal-backdrop").waitFor({ state: "detached", timeout: 500 });
  assert.equal(await reducedPage.locator('[data-modal-exiting]').count(), 0, "system reduced motion skips the exit animation");
  await reducedContext.close();
  console.log(`Class modal exit browser verification passed: ${JSON.stringify({ samples, chooserSamples, screenshots: ["/tmp/class-modal-exit-chooser.png", "/tmp/class-modal-exit-class-setup.png", "/tmp/class-modal-exit-mid-transition.png", "/tmp/class-modal-exit-chooser-mid-transition.png"] })}`);
} finally { if (browser) await browser.close(); }
