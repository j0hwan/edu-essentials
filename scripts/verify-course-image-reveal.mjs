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
  await page.evaluate(() => {
    const header = document.getElementById("header");
    new MutationObserver(() => {
      const image = header.querySelector("img.is-ready");
      if (!image) return;
      void getComputedStyle(image).maskPosition;
      window.revealAnimations = image.getAnimations();
      for (const animation of window.revealAnimations) {animation.pause(); animation.currentTime = 0;}
    }).observe(header, {attributes: true, childList: true, subtree: true});
    window.releaseImage();
  });
  await page.waitForFunction(() => window.revealAnimations?.length >= 2);
  const frames = [];
  for (const time of [0, 150, 300, 450, 600]) {
    await page.evaluate(time => {for (const animation of window.revealAnimations) animation.currentTime = time;}, time);
    frames.push({time, pixels: await samples()});
  }
  assert.equal(frames[0].pixels[0], 0, "decoded image begins hidden");
  assert.ok(frames[1].pixels[0] < 40, "the image must not finish revealing in its first 150ms");
  assert.ok(frames[2].pixels[0] > 50 && frames[2].pixels[0] < 205, "the middle frame shows a soft partially revealed image");
  assert.ok(frames[2].pixels[1] > frames[2].pixels[2] + 100, "the bottom-left reveals before the top-right");
  assert.ok(frames[3].pixels[0] > 210, "the center is revealed late in the sweep");
  assert.ok(frames[4].pixels.every(value => value > 250), "the complete image is visible at the end");
  for (const reduced of ["profile", "system"]) {
    await page.evaluate(() => {for (const animation of window.revealAnimations) animation.cancel();});
    if (reduced === "profile") await page.evaluate(() => document.documentElement.dataset.motion = "reduced");
    else {
      await page.evaluate(() => delete document.documentElement.dataset.motion);
      await page.emulateMedia({reducedMotion: "reduce"});
    }
    assert.ok(await page.locator("img").evaluate(image => getComputedStyle(image).transitionDuration.split(",").every(value => Number.parseFloat(value) <= 0.00001)));
    assert.ok((await samples()).every(value => value > 250), "reduced motion keeps the full image visible");
  }
  console.log(JSON.stringify({frames, reducedMotion: "profile and system passed"}, null, 2));
} finally {await browser.close();}
