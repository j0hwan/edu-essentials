import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serveWorkspaceReflow } from "./serve-workspace-reflow.mjs";

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const fixture = await serveWorkspaceReflow();
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: "chrome" }) });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(`${fixture.baseUrl}/dashboard`);
  await page.waitForSelector(".class-card");
  await page.waitForTimeout(2800);
  const motion = await page.evaluate(async () => {
    const targets = [...document.querySelectorAll(".dashboard-study-brief, .dashboard-classes-heading, .class-card, .dashboard-upcoming")];
    const frames = [];
    const initial = targets.map((element) => element.getBoundingClientRect().toJSON());
    document.querySelector(".sidebar-toggle").click();
    await new Promise((resolvePromise) => {
      const start = performance.now();
      function tick(time) {
        frames.push(targets.map((element) => element.getBoundingClientRect().toJSON()));
        if (time - start < 420) requestAnimationFrame(tick);
        else resolvePromise();
      }
      requestAnimationFrame(tick);
    });
    return { initial, frames };
  });
  for (let index = 0; index < motion.initial.length; index++) {
    const widths = new Set(motion.frames.map((frame) => frame[index].width.toFixed(1)));
    assert.ok(widths.size > 4, `dashboard block ${index} has intermediate sizes`);
    const final = motion.frames.at(-1)[index];
    assert.ok(Math.abs(final.width - motion.initial[index].width) > 1);
  }
  await page.evaluate(async () => {
    const toggle = document.querySelector(".sidebar-toggle");
    toggle.click();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 90));
    toggle.click();
  });
  await page.waitForTimeout(450);
  assert.equal(await page.locator(".dashboard-reflow").evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running" && animation.effect?.getKeyframes().some((frame) => frame.scale)).length), 0);
  for (const [width, columns] of [[1920, 4], [1366, 4], [1280, 4], [1100, 3], [900, 2], [820, 2], [620, 2], [520, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    const count = await page.locator(".class-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    assert.equal(count, columns, `${width}px course column count`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px horizontal overflow`);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator(".sidebar-toggle").click();
  await page.waitForTimeout(60);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator(".dashboard-reflow").evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getKeyframes().some((frame) => frame.scale)).length), 0);
  await page.locator(".sidebar-toggle").click();
  assert.equal(await page.locator(".dashboard-reflow").evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getKeyframes().some((frame) => frame.scale)).length), 0);
  assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
  console.log("Dashboard reflow: intermediate block sizes, rapid reversal, responsive columns, reduced motion, and runtime errors checked at 4× CPU.");
} finally {
  await browser?.close();
  await fixture.close();
}
