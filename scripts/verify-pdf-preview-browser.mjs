import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(projectRoot, "tests/fixtures/pdf-preview-browser.tsx");
const sourceMode = process.env.PDF_PREVIEW_SOURCE ?? process.argv.find((arg) => arg.startsWith("--source="))?.slice("--source=".length) ?? "current";
if (!new Set(["current", "head"]).has(sourceMode)) throw new Error("Choose --source=current or --source=head.");

const cycleCount = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative integer.`);
  return value;
};
const stableCycles = cycleCount("PDF_PREVIEW_STABLE_CYCLES", 10);
const cancelCycles = cycleCount("PDF_PREVIEW_CANCEL_CYCLES", 10);

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const workerDirectory = join(projectRoot, "dist/client/_next/static");
const workerCandidates = (await readdir(workerDirectory))
  .filter((name) => /^pdf-preview\.worker-.+\.js$/.test(name))
  .map(async (name) => ({ path: join(workerDirectory, name), modified: (await stat(join(workerDirectory, name))).mtimeMs }));
const workers = await Promise.all(workerCandidates);
workers.sort((left, right) => right.modified - left.modified);
if (workers.length === 0) throw new Error(`No built pdf-preview worker found in ${workerDirectory}. Build the app first.`);
const workerBytes = await readFile(workers[0].path);

function getSource(relativePath) {
  if (sourceMode === "head") {
    return execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: projectRoot, encoding: "utf8" });
  }
  return readFile(join(projectRoot, relativePath), "utf8");
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "pdf-preview-browser-"));
const compiledFixture = join(temporaryDirectory, "fixture.js");
await build({
  absWorkingDir: projectRoot,
  entryPoints: [fixturePath],
  outfile: compiledFixture,
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  target: ["chrome120"],
  plugins: [{
    name: "pdf-preview-browser-fixture",
    setup(esbuild) {
      esbuild.onResolve({ filter: /^\.\.\/\.\.\/app\/pdf-preview$/ }, () => ({ path: "preview", namespace: "pdf-preview-source" }));
      esbuild.onResolve({ filter: /^\.\.\/lib\/pdf-preview-client$/ }, (args) => args.namespace === "pdf-preview-source"
        ? { path: "client", namespace: "pdf-preview-source" }
        : undefined);
      esbuild.onLoad({ filter: /^(preview|client)$/, namespace: "pdf-preview-source" }, async (args) => {
        const isClient = args.path === "client";
        return {
          contents: await getSource(isClient ? "lib/pdf-preview-client.ts" : "app/pdf-preview.tsx"),
          loader: isClient ? "ts" : "tsx",
          resolveDir: join(projectRoot, isClient ? "lib" : "app"),
        };
      });
      esbuild.onResolve({ filter: /\?worker$/ }, () => ({ path: "worker-shim", namespace: "pdf-preview-worker-shim" }));
      esbuild.onLoad({ filter: /.*/, namespace: "pdf-preview-worker-shim" }, () => ({
        contents: "export default class PdfPreviewWorker extends Worker { constructor() { super('/worker.js'); } }",
        loader: "js",
      }));
    },
  }],
});
const fixtureBytes = await readFile(compiledFixture);
const html = "<!doctype html><html><head><meta charset=\"utf-8\"><style>body{margin:0}.private-pdf-preview{width:300px}canvas{display:block}canvas[hidden]{display:none}</style></head><body><div id=\"app\"></div><script src=\"/fixture.js\"></script></body></html>";
const server = createServer((request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  } else if (request.url === "/fixture.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(fixtureBytes);
  } else if (request.url === "/worker.js") {
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    response.end(workerBytes);
  } else if (request.url === "/favicon.ico") {
    response.writeHead(204);
    response.end();
  } else {
    response.writeHead(404);
    response.end("Not found");
  }
});

let browser;
let serverAddress;
try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  serverAddress = server.address();
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: resolve(process.env.CHROME_EXECUTABLE) } : { channel: "chrome" }),
  };
  browser = await playwright.chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 360, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) pageErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${serverAddress.port}`);
  await page.waitForFunction(() => typeof window.__mountPdfPreview === "function");

  const waitForPages = () => page.waitForFunction(() => {
    const canvases = [...document.querySelectorAll('#app canvas[role="img"]:not([hidden])')];
    return canvases.length >= 2 && canvases.every((canvas) => canvas.width > 0 && canvas.height > 0);
  }, undefined, { timeout: 10_000 });
  const samplePixels = () => page.evaluate(() => {
    const pagePixels = (pageNumber) => {
      const canvas = document.querySelector(`canvas[aria-label$="page ${pageNumber}"]`);
      if (!canvas || canvas.width === 0 || canvas.height === 0) return { missing: true };
      const context = canvas.getContext("2d");
      const pixel = (x, y) => [...context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data];
      return {
        size: [canvas.width, canvas.height],
        center: pixel(0.5, 0.5),
        patchA: pixel(0.16, 0.875),
        patchB: pixel(0.75, 0.3),
      };
    };
    return { page1: pagePixels(1), page2: pagePixels(2) };
  });
  const isExpected = (pixels) => {
    const near = (actual, expected) => Array.isArray(actual) && actual.length === 4
      && actual.slice(0, 3).every((channel, index) => Math.abs(channel - expected[index]) < 15);
    return pixels.page1?.size?.[0] > 0 && pixels.page2?.size?.[0] > 0
      && near(pixels.page1.center, [255, 255, 255])
      && near(pixels.page1.patchA, [0, 0, 255])
      && near(pixels.page1.patchB, [255, 0, 0])
      && near(pixels.page2.center, [255, 255, 255])
      && near(pixels.page2.patchA, [0, 204, 0])
      && near(pixels.page2.patchB, [255, 204, 0]);
  };
  const mountAndCheck = async () => {
    await page.evaluate(() => window.__mountPdfPreview());
    try {
      await waitForPages();
    } catch (cause) {
      const state = await page.evaluate(() => ({
        bodyText: document.body.innerText,
        canvases: [...document.querySelectorAll('#app canvas[role="img"]')].map((canvas) => ({
          label: canvas.getAttribute("aria-label"),
          hidden: canvas.hidden,
          size: [canvas.width, canvas.height],
        })),
      }));
      throw new Error(`PDF preview pages did not become ready: ${JSON.stringify({ state, pageErrors })}`, { cause });
    }
    return samplePixels();
  };

  let stableBad = 0;
  let cancelRemountBad = 0;
  let firstPixels;
  for (let index = 0; index < stableCycles; index += 1) {
    const pixels = await mountAndCheck();
    firstPixels ??= pixels;
    if (!isExpected(pixels)) stableBad += 1;
    await page.evaluate(() => window.__unmountPdfPreview());
  }

  const delaysMs = [0, 1, 3, 8, 18];
  for (let index = 0; index < cancelCycles; index += 1) {
    await page.evaluate(() => window.__mountPdfPreview());
    const delayMs = delaysMs[index % delaysMs.length];
    if (delayMs > 0) await page.waitForTimeout(delayMs);
    await page.evaluate(() => window.__unmountPdfPreview());
    await page.waitForTimeout(1);
    const pixels = await mountAndCheck();
    if (!isExpected(pixels)) cancelRemountBad += 1;
    await page.evaluate(() => window.__unmountPdfPreview());
  }

  const beforeLossPixels = await mountAndCheck();
  const loss = await page.evaluate(() => {
    const pageOne = document.querySelector('canvas[aria-label$="page 1"]');
    const pageTwo = document.querySelector('canvas[aria-label$="page 2"]');
    if (!pageOne || !pageTwo) throw new Error("Both pages must be rendered before the controlled canvas loss.");
    window.__lostPdfCanvas = pageOne;
    window.__pageTwoBeforeLoss = pageTwo;
    const width = pageOne.width;
    const height = pageOne.height;
    pageOne.width = width;
    const context = pageOne.getContext("2d", { alpha: false });
    const clearedCenter = [...context.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data];
    const eventDispatched = pageOne.dispatchEvent(new Event("contextlost", { cancelable: true }));
    return { dimensions: [width, height], clearedCenter, eventDispatched };
  });

  let recoveryWaitPassed = false;
  try {
    await page.waitForFunction(() => {
      const pageOne = document.querySelector('canvas[aria-label$="page 1"]');
      const pageTwo = document.querySelector('canvas[aria-label$="page 2"]');
      if (!pageOne || !pageTwo || pageOne.hidden || pageTwo.hidden || pageOne === window.__lostPdfCanvas || pageTwo !== window.__pageTwoBeforeLoss) return false;
      const sample = (canvas, x, y) => [...canvas.getContext("2d").getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data];
      const near = (actual, expected) => actual.slice(0, 3).every((channel, index) => Math.abs(channel - expected[index]) < 15);
      if (pageOne.width === 0 || pageTwo.width === 0) return false;
      return near(sample(pageOne, 0.5, 0.5), [255, 255, 255])
        && near(sample(pageOne, 0.16, 0.875), [0, 0, 255])
        && near(sample(pageOne, 0.75, 0.3), [255, 0, 0])
        && near(sample(pageTwo, 0.5, 0.5), [255, 255, 255])
        && near(sample(pageTwo, 0.16, 0.875), [0, 204, 0])
        && near(sample(pageTwo, 0.75, 0.3), [255, 204, 0]);
    }, undefined, { timeout: 10_000 });
    recoveryWaitPassed = true;
  } catch {
    await page.waitForTimeout(100);
  }
  const afterLossPixels = await samplePixels();
  const recoveryState = await page.evaluate(() => ({
    pageOneCanvasReplaced: document.querySelector('canvas[aria-label$="page 1"]') !== window.__lostPdfCanvas,
    pageTwoCanvasRetained: document.querySelector('canvas[aria-label$="page 2"]') === window.__pageTwoBeforeLoss,
  }));
  await page.evaluate(() => window.__unmountPdfPreview());

  const failures = [];
  if (stableBad > 0) failures.push(`${stableBad} stable mount cycles had incorrect page pixels.`);
  if (cancelRemountBad > 0) failures.push(`${cancelRemountBad} cancel/remount cycles had incorrect page pixels.`);
  if (!isExpected(beforeLossPixels)) failures.push("Pre-loss page pixels were incorrect.");
  if (loss.clearedCenter[0] !== 0 || loss.clearedCenter[1] !== 0 || loss.clearedCenter[2] !== 0) failures.push("The controlled opaque-canvas reset did not produce a black center pixel.");
  if (!loss.eventDispatched) failures.push("The controlled contextlost event was unexpectedly canceled.");
  if (!recoveryWaitPassed || !recoveryState.pageOneCanvasReplaced || !recoveryState.pageTwoCanvasRetained || !isExpected(afterLossPixels)) {
    failures.push(`Context-loss recovery did not replace page 1 with correct pixels while preserving page 2 (source=${sourceMode}).`);
  }
  if (pageErrors.length > 0) failures.push(`${pageErrors.length} browser page errors occurred.`);

  console.log(JSON.stringify({
    sourceMode,
    worker: basename(workers[0].path),
    workerBytes: workerBytes.length,
    pdfBytes: await page.evaluate(() => window.__pdfPreviewSize).catch(() => undefined),
    stableCycles,
    stableBad,
    cancelRemountCycles: cancelCycles,
    cancelRemountBad,
    firstPixels,
    controlledLoss: {
      dimensions: loss.dimensions,
      pixelsBeforeLoss: beforeLossPixels,
      blackPixelAfterBackingStoreReset: loss.clearedCenter,
      eventDispatched: loss.eventDispatched,
      pageOneCanvasReplaced: recoveryState.pageOneCanvasReplaced,
      pageTwoCanvasRetained: recoveryState.pageTwoCanvasRetained,
      recoveryWaitPassed,
      pixelsAfterLoss: afterLossPixels,
    },
    pageErrors,
    failures,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
