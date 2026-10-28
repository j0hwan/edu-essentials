import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { serveWorkspaceReflow } from "./serve-workspace-reflow.mjs";

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const fixture = await serveWorkspaceReflow();
let browser;

async function openDashboard(context, { restored = false } = {}) {
  const page = await context.newPage();
  if (restored) {
    await page.addInitScript(() => localStorage.setItem("edu-dashboard-expanded-course:reflow-preview", "course-0"));
  }
  await page.goto(`${fixture.baseUrl}/dashboard`);
  await page.waitForSelector(".dashboard-page");
  return page;
}

async function getBackgroundTiming(page) {
  await page.waitForFunction(() => document.querySelector(".dashboard-page")?.getAnimations()
    .some((animation) => animation.animationName === "dashboard-restoration-background-in"));
  return page.evaluate(() => {
    const root = document.querySelector(".dashboard-page");
    const animation = root.getAnimations().find((item) => item.animationName === "dashboard-restoration-background-in");
    return {
      currentTime: Number(animation.currentTime),
      startTime: animation.startTime,
      timing: animation.effect.getTiming(),
      opacity: getComputedStyle(root).opacity,
      animationName: getComputedStyle(root).animationName,
      easing: getComputedStyle(root).animationTimingFunction,
    };
  });
}

async function sampleBackgroundAt(page, milliseconds) {
  return page.evaluate((target) => {
    const root = document.querySelector(".dashboard-page");
    const dialog = document.querySelector(".class-card-expansion-dialog");
    const animation = root.getAnimations().find((item) => item.animationName === "dashboard-restoration-background-in");
    const dialogAnimation = dialog?.getAnimations().find((item) => item.animationName === "course-restoration-in");
    // Seek the real CSS animations to the requested timeline instant so frame
    // scheduling jitter cannot move a nominal 220 ms sample into the fade.
    animation.pause();
    animation.currentTime = target;
    if (dialogAnimation) {
      dialogAnimation.pause();
      dialogAnimation.currentTime = Math.min(target, 220);
    }
    return {
      currentTime: Number(animation.currentTime),
      opacity: Number(getComputedStyle(root).opacity),
      dialogOpacity: dialog ? Number(getComputedStyle(dialog).opacity) : null,
      dialogAnimation: dialogAnimation ? { currentTime: Number(dialogAnimation.currentTime), timing: dialogAnimation.effect.getTiming() } : null,
    };
  }, milliseconds);
}

async function waitForLiveBackgroundTime(page, milliseconds) {
  await page.waitForFunction((target) => {
    const animation = document.querySelector(".dashboard-page")?.getAnimations()
      .find((item) => item.animationName === "dashboard-restoration-background-in");
    return animation && Number(animation.currentTime) >= target;
  }, milliseconds);
  return page.evaluate(() => {
    const root = document.querySelector(".dashboard-page");
    const animation = root.getAnimations().find((item) => item.animationName === "dashboard-restoration-background-in");
    return { currentTime: Number(animation.currentTime), opacity: Number(getComputedStyle(root).opacity) };
  });
}

try {
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: "chrome" }),
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const restored = await openDashboard(context, { restored: true });
  await restored.waitForSelector('.class-card-expansion-dialog[data-restored="true"]');
  await restored.waitForFunction(() => document.querySelector(".dashboard-page")?.dataset.restoredCourse === "true");

  const timing = await getBackgroundTiming(restored);
  assert.equal(timing.timing.delay, 220, "the restored dashboard background waits 220 ms");
  assert.equal(timing.timing.duration, 360, "the background fade lasts 360 ms");
  assert.equal(timing.timing.fill, "both");
  assert.equal(timing.animationName, "dashboard-restoration-background-in");
  assert.equal(timing.easing, "ease-out", "the background fade uses ease-out timing");

  const live110 = await waitForLiveBackgroundTime(restored, 110);
  const live260 = await waitForLiveBackgroundTime(restored, 260);
  const live580 = await waitForLiveBackgroundTime(restored, 580);
  assert.equal(live110.opacity, 0, "natural playback stays hidden before the 220 ms delay ends");
  assert.ok(live260.opacity > 0 && live260.opacity < 1, "natural playback is fading after the delay");
  assert.ok(live580.opacity >= 0.99, "natural playback finishes after 580 ms");

  const samples = {};
  for (const milliseconds of [0, 110, 220, 400, 580]) {
    samples[milliseconds] = await sampleBackgroundAt(restored, milliseconds);
  }
  for (const milliseconds of [0, 110, 220]) {
    assert.equal(samples[milliseconds].opacity, 0, `background remains hidden at ${milliseconds} ms`);
  }
  assert.ok(samples[400].opacity > 0 && samples[400].opacity < 1, `background is partway visible at 400 ms (opacity ${samples[400].opacity})`);
  assert.ok(samples[580].opacity >= 0.99, `background is visible at 580 ms (opacity ${samples[580].opacity})`);
  assert.equal(samples[220].dialogOpacity, 1, "the restored course dialog has finished its 220 ms entrance before the background starts fading");
  assert.ok(samples[110].dialogOpacity > 0 && samples[110].dialogOpacity < 1, "the course dialog is entering during the background delay");
  assert.deepEqual(await restored.evaluate(() => window.fixtureErrors), [], "the restored fixture has no browser errors");
  console.log("Restored course samples:", JSON.stringify({ timing, live: { live110, live260, live580 }, samples }));

  await restored.getByRole("button", { name: "Close class" }).click();
  await restored.waitForSelector(".class-card-expansion-dialog", { state: "detached" });
  assert.equal(await restored.locator(".dashboard-page").getAttribute("data-restored-course"), "true", "the fade marker remains latched after closing the restored course");
  await restored.locator(".nav-item").filter({ hasText: "Home" }).click();
  await restored.waitForSelector(".dashboard-page", { state: "detached" });
  assert.equal(await restored.evaluate(() => localStorage.getItem("edu-dashboard-expanded-course:reflow-preview")), null, "explicit close clears the saved course before navigation");
  await restored.locator(".nav-item").filter({ hasText: "Dashboard" }).click();
  await restored.waitForSelector(".dashboard-page");
  await restored.waitForTimeout(30);
  const returnedAfterClose = await restored.evaluate(() => ({
    marker: document.querySelector(".dashboard-page")?.dataset.restoredCourse ?? null,
    animation: getComputedStyle(document.querySelector(".dashboard-page")).animationName,
    delay: getComputedStyle(document.querySelector(".dashboard-page")).animationDelay,
  }));
  assert.equal(returnedAfterClose.marker, null, "navigating back after explicit close starts a fresh dashboard");
  assert.equal(returnedAfterClose.delay, "0s", "explicit close followed by navigation has no delayed background fade");
  console.log("Close then navigation:", JSON.stringify(returnedAfterClose));
  await restored.close();
  await context.close();

  const plainContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const plain = await openDashboard(plainContext);
  const plainTiming = await plain.evaluate(() => {
    const root = document.querySelector(".dashboard-page");
    return {
      marker: root.dataset.restoredCourse ?? null,
      animationName: getComputedStyle(root).animationName,
      delay: getComputedStyle(root).animationDelay,
      restorationAnimations: root.getAnimations().filter((animation) => animation.animationName === "dashboard-restoration-background-in").length,
    };
  });
  assert.equal(plainTiming.marker, null);
  assert.equal(plainTiming.delay, "0s", "plain dashboard entrance starts without delay");
  assert.equal(plainTiming.restorationAnimations, 0);
  await plain.locator('.class-card[data-course-card-id="course-0"]').click();
  await plain.waitForSelector(".class-card-expansion-dialog");
  const manual = await plain.evaluate(() => ({
    marker: document.querySelector(".dashboard-page")?.dataset.restoredCourse ?? null,
    dialogRestored: document.querySelector(".class-card-expansion-dialog")?.dataset.restored ?? null,
    delay: getComputedStyle(document.querySelector(".dashboard-page")).animationDelay,
    restorationAnimations: document.querySelector(".dashboard-page").getAnimations()
      .filter((animation) => animation.animationName === "dashboard-restoration-background-in").length,
  }));
  assert.equal(manual.marker, null, "manually opening a course does not opt the dashboard into the restored fade");
  assert.equal(manual.dialogRestored, null, "manual course opening keeps its normal entrance");
  assert.equal(manual.delay, "0s");
  assert.equal(manual.restorationAnimations, 0);
  console.log("Plain dashboard and manual open:", JSON.stringify({ plainTiming, manual }));
  await plainContext.close();

  const reducedContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const reduced = await openDashboard(reducedContext, { restored: true });
  await reduced.waitForSelector('.class-card-expansion-dialog[data-restored="true"]');
  const systemReduced = await reduced.evaluate(() => ({
    marker: document.querySelector(".dashboard-page")?.dataset.restoredCourse,
    animationName: getComputedStyle(document.querySelector(".dashboard-page")).animationName,
    opacity: getComputedStyle(document.querySelector(".dashboard-page")).opacity,
    dialogOpacity: getComputedStyle(document.querySelector(".class-card-expansion-dialog")).opacity,
  }));
  assert.equal(systemReduced.marker, "true");
  assert.equal(systemReduced.animationName, "none", "system reduced motion removes the delayed fade");
  assert.equal(systemReduced.opacity, "1", "system reduced motion displays the dashboard immediately");
  assert.equal(systemReduced.dialogOpacity, "1", "system reduced motion displays the course dialog immediately");
  await reduced.emulateMedia({ reducedMotion: "no-preference" });
  await reduced.evaluate(() => { document.documentElement.dataset.motion = "reduced"; });
  const profileRootReduced = await reduced.evaluate(() => ({
    animationName: getComputedStyle(document.querySelector(".dashboard-page")).animationName,
    opacity: getComputedStyle(document.querySelector(".dashboard-page")).opacity,
    systemReduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  assert.equal(profileRootReduced.animationName, "none", "the profile motion preference removes the delayed fade");
  assert.equal(profileRootReduced.opacity, "1");
  assert.equal(profileRootReduced.systemReduced, false, "the profile preference works without system reduced motion");
  await reduced.evaluate(() => {
    document.documentElement.dataset.motion = "full";
    document.querySelector(".dashboard-page").dataset.reducedMotion = "true";
  });
  const profilePropReduced = await reduced.evaluate(() => ({
    animationName: getComputedStyle(document.querySelector(".dashboard-page")).animationName,
    opacity: getComputedStyle(document.querySelector(".dashboard-page")).opacity,
    systemReduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  assert.equal(profilePropReduced.animationName, "none", "the dashboard reduced-motion prop removes the delayed fade");
  assert.equal(profilePropReduced.opacity, "1");
  assert.equal(profilePropReduced.systemReduced, false);
  console.log("Reduced motion:", JSON.stringify({ systemReduced, profileRootReduced, profilePropReduced }));
  await reducedContext.close();
} finally {
  await browser?.close();
  await fixture.close();
}
