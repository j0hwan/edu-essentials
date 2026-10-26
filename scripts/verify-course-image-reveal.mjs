import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const playwright = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright");
const bundle = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import { createElement, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { PrivateImage } from "./app/private-files";
    import { useCourseExpansion } from "./app/use-course-expansion";
    const courses = [{id: "course", name: "Course"}];
    const file = {id: "image", name: "Course image", updated_at: "2026-10-26", content_revision: 1, trashed_at: null};
    const store = {blob: () => new Promise(resolve => {window.releaseImage = () => resolve(new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="200"><rect width="1000" height="200" fill="white"/></svg>'
    ], {type: "image/svg+xml"}));})};
    localStorage.setItem("edu-dashboard-expanded-course:fixture", "course");
    function Fixture() {
      const [page, setPage] = useState("home");
      window.navigateFixture = setPage;
      const {selectedClass, skipOpeningAnimation} = useCourseExpansion({profileId: "fixture", page, courses, ready: true});
      return <div id="header">{selectedClass && <PrivateImage file={file} store={store} fadeIn={skipOpeningAnimation} />}</div>;
    }
    createRoot(document.getElementById("root")).render(<Fixture />);
  ` },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  alias: { "next/navigation": resolve(root, "tests/helpers/next-navigation.mjs") },
  define: { "process.env.NODE_ENV": '"production"' },
});
const css = (await Promise.all(["globals", "auth", "reference-ui", "dashboard", "class-card-expansion"]
  .map(name => readFile(resolve(root, `app/${name}.css`), "utf8"))))
  .map(source => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE
  ? {executablePath: process.env.CHROME_EXECUTABLE} : {channel: "chrome"}) });
try {
  const page = await browser.newPage({viewport: {width: 1000, height: 200}});
  await page.route("https://course-reveal.example/", route => route.fulfill({contentType: "text/html", body:
    `<style>${css}body{margin:0;background:#000}#header{position:relative;width:1000px;height:200px;background:#000}</style><div id="root"></div>`}));
  await page.goto("https://course-reveal.example/");
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  await page.waitForFunction(() => typeof window.navigateFixture === "function");
  const samples = async () => {
    const screenshot = await page.screenshot();
    return page.evaluate(async data => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1000; canvas.height = 200;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return [ctx.getImageData(500, 100, 1, 1).data[0], ctx.getImageData(50, 180, 1, 1).data[0], ctx.getImageData(950, 20, 1, 1).data[0]];
    }, screenshot.toString("base64"));
  };
  await page.evaluate(() => window.navigateFixture("dashboard"));
  await page.waitForFunction(() => typeof window.releaseImage === "function");
  assert.equal(await page.locator("img").count(), 0, "held image bytes leave the header placeholder visible");
  await page.evaluate(() => window.releaseImage());
  await page.waitForFunction(() => {
    const image = document.querySelector("img.private-class-image-fade.is-ready");
    return image?.getAnimations().some(animation => animation.animationName === "course-image-gradient-in");
  });
  const animationInfo = await page.evaluate(() => {
    const image = document.querySelector("img.private-class-image-fade.is-ready");
    const animations = image.getAnimations().filter(animation => animation.animationName === "course-image-gradient-in");
    window.revealAnimation = animations[0];
    window.revealAnimation.pause();
    window.revealAnimation.currentTime = 0;
    const timing = window.revealAnimation.effect.getTiming();
    return {count: animations.length, name: window.revealAnimation.animationName, duration: timing.duration, delay: timing.delay};
  });
  assert.equal(animationInfo.count, 1, "the directional reveal is a single CSS animation");
  assert.equal(animationInfo.name, "course-image-gradient-in");
  assert.equal(animationInfo.duration, 240, "the reveal completes in 240ms");
  assert.equal(animationInfo.delay, 0, "the reveal starts as soon as decoding completes");
  const frames = [];
  for (const time of [0, 40, 100, 180, 240]) {
    await page.evaluate(time => {window.revealAnimation.currentTime = time;}, time);
    frames.push({time, pixels: await samples()});
  }
  assert.ok(frames[0].pixels.every(value => value === 0), "the decoded image starts fully masked");
  assert.ok(frames[1].pixels.every(value => value > 0), "all sampled positions begin appearing by 40ms");
  assert.ok(frames[2].pixels[1] > frames[2].pixels[2], "the bottom-left reveals before the top-right");
  for (let frame = 1; frame < frames.length; frame++) {
    for (let pixel = 0; pixel < frames[frame].pixels.length; pixel++) {
      assert.ok(frames[frame].pixels[pixel] >= frames[frame - 1].pixels[pixel],
        `sample ${pixel} is monotonic from ${frames[frame - 1].time}ms to ${frames[frame].time}ms`);
    }
  }
  assert.ok(frames.at(-1).pixels.every(value => value > 250), "the complete image is visible at 240ms");

  await page.evaluate(() => {
    window.revealAnimation.currentTime = 40;
    document.documentElement.dataset.motion = "reduced";
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector("img.is-ready")).animationName === "none");
  const profileReducedPixels = await samples();
  assert.ok(profileReducedPixels.every(value => value > 250), "profile reduced motion immediately shows the full image");

  await page.evaluate(() => {delete document.documentElement.dataset.motion;});
  await page.waitForFunction(() => {
    const image = document.querySelector("img.is-ready");
    return image?.getAnimations().some(animation => animation.animationName === "course-image-gradient-in" && animation.playState === "running");
  });
  await page.evaluate(() => {
    const image = document.querySelector("img.is-ready");
    window.revealAnimation = image.getAnimations().find(animation => animation.animationName === "course-image-gradient-in");
    window.revealAnimation.pause();
    window.revealAnimation.currentTime = 40;
  });
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.waitForFunction(() => getComputedStyle(document.querySelector("img.is-ready")).animationName === "none");
  const systemReducedPixels = await samples();
  assert.ok(systemReducedPixels.every(value => value > 250), "system reduced motion immediately shows the full image");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion ?? ""), "", "the system check runs independently of the profile setting");

  console.log(JSON.stringify({animationInfo, frames, reducedMotion: {profile: profileReducedPixels, system: systemReducedPixels}}, null, 2));
} finally {await browser.close();}
