import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readWorkspaceStylesheets } from "../tests/helpers/workspace-presentation.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(projectRoot, "tests/fixtures/course-preview-reveal-browser.tsx");
const screenshotDir = resolve(projectRoot, ".vinext/verify-course-preview-reveal");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE
  ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href)
  : await import("esbuild");
const [{ css }, workerDirectoryEntries] = await Promise.all([
  readWorkspaceStylesheets(),
  readdir(join(projectRoot, "dist/client/_next/static")),
]);
const workerFiles = await Promise.all(workerDirectoryEntries
  .filter((name) => /^pdf-preview\.worker-.+\.js$/.test(name))
  .map(async (name) => ({ path: join(projectRoot, "dist/client/_next/static", name), modified: (await stat(join(projectRoot, "dist/client/_next/static", name))).mtimeMs })));
workerFiles.sort((left, right) => right.modified - left.modified);
assert.ok(workerFiles.length, "Build the app first so its real PDF preview worker is available.");
const workerBytes = await readFile(workerFiles[0].path);

const bundle = await esbuild.build({
  entryPoints: [fixturePath],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  loader: { ".css": "empty" },
  alias: {
    "next/link": resolve(projectRoot, "tests/helpers/next-link.mjs"),
    "next/navigation": resolve(projectRoot, "tests/helpers/next-navigation.mjs"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "course-preview-browser-worker",
    setup(build) {
      build.onResolve({ filter: /\?worker$/ }, () => ({ path: "worker-shim", namespace: "course-preview-worker-shim" }));
      build.onLoad({ filter: /.*/, namespace: "course-preview-worker-shim" }, () => ({
        contents: `export default class PdfPreviewWorker extends Worker {
          constructor() {
            super('/worker.js');
            this.addEventListener('message', (event) => {
              if (event.data?.type !== 'pdf-preview:result' || window.__coursePreviewAllowPdfResult) return;
              event.stopImmediatePropagation();
              const data = event.data;
              const worker = this;
              window.__coursePreviewPdfWorkerResultAvailable = true;
              window.__releaseCoursePreviewPdfWorkerResult = () => {
                window.__coursePreviewAllowPdfResult = true;
                worker.dispatchEvent(new MessageEvent('message', { data }));
                window.__coursePreviewAllowPdfResult = false;
              };
            });
          }
        }`,
        loader: "js",
      }));
    },
  }],
  logLevel: "warning",
});
const fixtureBytes = bundle.outputFiles[0].text;
const placeholderAssets = new Map(await Promise.all(["map-1.png", "map-2.png", "syllabus-blurred.png"].map(async (name) => [
  `/preview-placeholders/${name}`,
  await readFile(join(projectRoot, "public/preview-placeholders", name)),
])));
const style = `
  :root { --font-geist-sans: Arial, sans-serif; }
  body { min-width: 320px; background: #f1f3f7; }
  .course-preview-fixture { width: min(1160px, calc(100% - 48px)); margin: 36px auto; }
  .course-preview-fixture > header { margin-bottom: 24px; }
  .course-preview-fixture > header p { margin: 0 0 6px; color: #5969db; font-size: 11px; font-weight: 750; letter-spacing: .12em; }
  .course-preview-fixture > header h1 { margin: 0 0 4px; font-size: 28px; }
  .course-preview-fixture > header span { color: #697386; }
  .course-preview-fixture-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
  .course-preview-fixture-card { padding: 18px; border: 1px solid #dce1e9; border-radius: 14px; background: white; box-shadow: 0 8px 24px rgb(24 32 50 / 8%); }
  .course-preview-fixture-card h2 { margin: 0 0 8px; font-size: 15px; }
  .course-preview-fixture-card > p { margin: 8px 0 0; color: #697386; font-size: 12px; }
  .course-preview-fixture-card .meeting-location-preview { margin-top: 0; }
  .course-preview-fixture-syllabus { grid-column: 1 / -1; }
  .course-preview-fixture-syllabus-frame { position: relative; height: 420px; overflow: hidden; border: 1px solid #dce1e9; border-radius: 10px; }
  .course-syllabus-preview { position: absolute; inset: 0; }
  @media (max-width: 760px) { .course-preview-fixture-grid { grid-template-columns: minmax(0, 1fr); } .course-preview-fixture-syllabus { grid-column: auto; } }
`;
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${style}</style><script>
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(element) { this.element = element; this.callback([{ target: element, isIntersecting: Number(element.dataset.page) === 1 }]); }
    unobserve() {}
    disconnect() {}
  };
</script></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;

const server = createServer(async (request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  } else if (request.url === "/fixture.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(fixtureBytes);
  } else if (request.url === "/worker.js") {
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    response.end(workerBytes);
  } else if (placeholderAssets.has(request.url)) {
    response.writeHead(200, { "content-type": request.url.endsWith(".svg") ? "image/svg+xml" : "image/png", "cache-control": "no-store" });
    response.end(placeholderAssets.get(request.url));
  } else if (request.url === "/favicon.ico") {
    response.writeHead(204);
    response.end();
  } else {
    response.writeHead(404);
    response.end("Not found");
  }
});

let browser;
await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const serverAddress = server.address();
assert.ok(serverAddress && typeof serverAddress === "object");
await import("node:fs/promises").then(({ mkdir }) => mkdir(screenshotDir, { recursive: true }));

function waitUntil(predicate, message, timeoutMs = 10_000) {
  const start = Date.now();
  return new Promise((resolveWait, rejectWait) => {
    const check = () => {
      if (predicate()) return resolveWait();
      if (Date.now() - start >= timeoutMs) return rejectWait(new Error(message));
      setTimeout(check, 10);
    };
    check();
  });
}

async function runScenario(reducedMotion = false) {
  console.log(`Starting ${reducedMotion ? "reduced-motion" : "standard-motion"} browser scenario.`);
  const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = resolve(process.env.CHROME_EXECUTABLE);
  else launchOptions.channel = "chrome";
  const page = await browser.newPage({ viewport: { width: 1120, height: 1280 }, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  const capture = async (name, options = {}) => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: resolve(screenshotDir, name), ...options });
  };
  const pageErrors = [];
  const pendingMapRoutes = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("favicon.ico")) pageErrors.push(message.text()); });
  await page.route("https://maps.google.com/**", (route) => {
    pendingMapRoutes.push({ route, coordinateQuery: new URL(route.request().url()).searchParams.get("q") });
  });
  await page.goto(`http://127.0.0.1:${serverAddress.port}`);
  await page.waitForFunction(() => typeof window.__coursePreviewFixture?.releaseSyllabusBlob === "function");
  await page.waitForFunction(() => [...document.querySelectorAll(".course-preview-placeholder")].length === 3
    && [...document.querySelectorAll(".course-preview-placeholder")].every((image) => image.complete && image.naturalWidth > 0));
  const before = await page.evaluate(() => ({
    placeholders: [...document.querySelectorAll(".course-preview-placeholder")].map((image) => ({
      src: new URL(image.src).pathname,
      filter: getComputedStyle(image).filter,
    })),
    readySurfaces: document.querySelectorAll(".course-preview-content.is-ready").length,
    locationRequests: window.__coursePreviewFixture.locationRequests.slice(),
  }));
  assert.equal(before.placeholders.length, 3);
  assert.deepEqual(before.placeholders.map(({ filter }) => filter), ["blur(16.5px)", "blur(16.5px)", "none"]);
  assert.ok(before.placeholders.slice(0, 2).every(({ src }) => ["/preview-placeholders/map-1.png", "/preview-placeholders/map-2.png"].includes(src)), JSON.stringify(before.placeholders));
  assert.equal(before.placeholders[2].src, "/preview-placeholders/syllabus-blurred.png");
  assert.equal(before.readySurfaces, 0);
  if (!reducedMotion) await capture("01-before-ready.png", { animations: "disabled" });

  await page.waitForFunction(() => window.__coursePreviewFixture.locationRequests.includes("101 College Ave, Davis, California")
    && window.__coursePreviewFixture.locationRequests.includes("202 College Ave, Davis, California"));
  await page.evaluate(() => {
    window.__coursePreviewFixture.resolveLocation("101 College Ave, Davis, California");
    window.__coursePreviewFixture.resolveLocation("202 College Ave, Davis, California");
  });
  await page.waitForFunction(() => document.querySelectorAll("iframe[title^='Map preview']").length === 2);
  await waitUntil(() => pendingMapRoutes.length === 2, "Both controlled map iframe requests should be waiting at the route gate.");
  console.log("Both map iframe routes are held; releasing map one.");

  await page.locator('[data-preview-name="map-one"] iframe').evaluate((frame) => {
    window.__coursePreviewMapLoads ??= [];
    frame.addEventListener("load", () => window.__coursePreviewMapLoads.push("map-one"), { once: true });
  });
  const mapOneRouteIndex = pendingMapRoutes.findIndex(({ coordinateQuery }) => coordinateQuery === "38.5449,-121.7405");
  assert.notEqual(mapOneRouteIndex, -1, `Map one route should use its distinct coordinate query (${JSON.stringify(pendingMapRoutes.map(({ coordinateQuery }) => coordinateQuery))}).`);
  const [mapOnePending] = pendingMapRoutes.splice(mapOneRouteIndex, 1);
  await mapOnePending.route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body style='margin:0;background:#e5edf4'><div style='padding:22px;font:16px Arial'>North Campus · Davis</div></body></html>" });
  await page.waitForFunction(() => window.__coursePreviewMapLoads?.includes("map-one"));
  console.log("Map one loaded; waiting for the first PDF page.");

  await page.evaluate(() => window.__coursePreviewFixture.releaseSyllabusBlob());
  await page.waitForFunction(() => window.__coursePreviewFixture.blobDelivered);
  const blobDelivered = await page.evaluate(() => ({
    blobDelivered: window.__coursePreviewFixture.blobDelivered,
    workerResultAvailable: window.__coursePreviewPdfWorkerResultAvailable === true,
    readySurfaces: document.querySelectorAll(".course-preview-content.is-ready").length,
    pdfPreviewState: document.querySelector(".private-pdf-preview")?.textContent?.trim() ?? null,
  }));
  assert.equal(blobDelivered.blobDelivered, true);
  assert.equal(blobDelivered.readySurfaces, 0, "the completed blob read is not a reveal-ready event");
  await page.waitForFunction(() => window.__coursePreviewPdfWorkerResultAvailable === true, undefined, { timeout: 20_000 });
  const heldPdfResult = await page.evaluate(() => ({
    blobDelivered: window.__coursePreviewFixture.blobDelivered,
    readySurfaces: document.querySelectorAll(".course-preview-content.is-ready").length,
    visibleImages: document.querySelectorAll(".private-pdf-preview img:not([hidden])").length,
  }));
  assert.equal(heldPdfResult.readySurfaces, 0, "the barrier remains closed while the real worker result has not reached the component");
  assert.equal(heldPdfResult.visibleImages, 0, "the PDF image is still hidden before the first page is decoded");
  if (!reducedMotion) await capture("02-pdf-worker-result-held.png", { animations: "disabled" });
  await page.evaluate(() => window.__releaseCoursePreviewPdfWorkerResult());
  await page.waitForFunction(() => {
    const image = document.querySelector('img[aria-label="Course syllabus.pdf, page 1"]');
    return Boolean(image && !image.hidden && image.naturalWidth > 0 && image.naturalHeight > 0);
  }, undefined, { timeout: 20_000 });
  const during = await page.evaluate(() => {
    const image = document.querySelector('img[aria-label="Course syllabus.pdf, page 1"]');
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return {
      readySurfaces: document.querySelectorAll(".course-preview-content.is-ready").length,
      pageOne: { width: image.naturalWidth, height: image.naturalHeight, firstPixel: [...pixel] },
      pageTwoImage: Boolean(document.querySelector('[data-page="2"] img')),
      placeholderFilters: [...document.querySelectorAll(".course-preview-placeholder")].map((image) => getComputedStyle(image).filter),
    };
  });
  assert.equal(during.readySurfaces, 0, "two ready participants remain masked while the second map is pending");
  assert.ok(during.pageOne?.width && during.pageOne.height);
  assert.ok(during.pageOne.firstPixel && during.pageOne.firstPixel[0] > 220, "the actual PDF worker painted the first page");
  assert.equal(during.pageTwoImage, false, "page 2 is kept outside the viewport and is not rendered");
  assert.deepEqual(during.placeholderFilters, ["blur(16.5px)", "blur(16.5px)", "none"]);
  if (!reducedMotion) await capture("03-first-page-ready-still-waiting.png", { animations: "disabled" });
  console.log(`PDF page one painted; one map remains pending (${pendingMapRoutes.length} route held).`);

  await page.evaluate(() => {
    window.__coursePreviewRevealStarts = [];
    const root = document.getElementById("root");
    new MutationObserver((records) => {
      const time = performance.now();
      for (const record of records) {
        if (record.target instanceof HTMLElement && record.target.matches(".course-preview-content") && record.target.classList.contains("is-ready")) {
          window.__coursePreviewRevealStarts.push({ name: record.target.closest("[data-preview-name]")?.getAttribute("data-preview-name") ?? "unknown", time });
        }
      }
    }).observe(root, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await page.locator('[data-preview-name="map-two"] iframe').evaluate((frame) => {
    window.__coursePreviewMapLoads ??= [];
    frame.addEventListener("load", () => window.__coursePreviewMapLoads.push("map-two"), { once: true });
  });
  console.log(`Releasing map two, with ${pendingMapRoutes.length} route held.`);
  const mapTwoRouteIndex = pendingMapRoutes.findIndex(({ coordinateQuery }) => coordinateQuery === "38.5365,-121.747");
  assert.notEqual(mapTwoRouteIndex, -1, `Map two route should use its distinct coordinate query (${JSON.stringify(pendingMapRoutes.map(({ coordinateQuery }) => coordinateQuery))}).`);
  const [mapTwoPending] = pendingMapRoutes.splice(mapTwoRouteIndex, 1);
  await mapTwoPending.route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body style='margin:0;background:#f5ecdb'><div style='padding:22px;font:16px Arial'>Science Hall · Davis</div></body></html>" });
  await page.waitForFunction(() => window.__coursePreviewMapLoads?.includes("map-two"));
  console.log("Map two loaded; waiting for the provider reveal commit.");
  await page.waitForFunction(() => document.querySelectorAll(".course-preview-content.is-ready").length === 3);
  await page.waitForTimeout(45);
  const revealed = await page.evaluate(() => {
    const contents = [...document.querySelectorAll(".course-preview-content")];
    return {
      names: contents.map((element) => element.closest("[data-preview-name]")?.getAttribute("data-preview-name")),
      opacity: contents.map((element) => getComputedStyle(element).opacity),
      animationNames: contents.map((element) => getComputedStyle(element).animationName),
      animationStartTimes: contents.map((element) => element.getAnimations().map((animation) => animation.startTime).filter((time) => time !== null)),
      starts: window.__coursePreviewRevealStarts,
      pageTwoImage: Boolean(document.querySelector('[data-page="2"] img')),
    };
  });
  assert.deepEqual(revealed.names, ["map-one", "map-two", "syllabus"]);
  assert.ok(revealed.starts.length >= 3, JSON.stringify(revealed.starts));
  const startTimes = revealed.starts.slice(0, 3).map((start) => start.time);
  assert.ok(Math.max(...startTimes) - Math.min(...startTimes) < 8, `All surfaces should start together: ${JSON.stringify(revealed.starts)}`);
  assert.equal(revealed.pageTwoImage, false, "page 2 is not required for the shared reveal");
  if (!reducedMotion) {
    assert.ok(revealed.animationNames.every((name) => name === "course-image-gradient-in" || name === "course-image-fade-in"), JSON.stringify(revealed.animationNames));
    const cssStartTimes = revealed.animationStartTimes.map((times) => times[0]).filter((time) => time !== undefined);
    assert.equal(cssStartTimes.length, 3, JSON.stringify(revealed.animationStartTimes));
    assert.ok(Math.max(...cssStartTimes) - Math.min(...cssStartTimes) < 8, `CSS animations should start in one frame: ${JSON.stringify(cssStartTimes)}`);
    await capture("04-shared-reveal-animation.png");
    await page.waitForTimeout(300);
  } else {
    assert.ok(revealed.animationNames.every((name) => name === "none"), JSON.stringify(revealed.animationNames));
  }
  const after = await page.evaluate(() => ({
    opacity: [...document.querySelectorAll(".course-preview-content")].map((element) => getComputedStyle(element).opacity),
    placeholders: [...document.querySelectorAll(".course-preview-placeholder")].map((image) => ({ filter: getComputedStyle(image).filter, loaded: image.complete && image.naturalWidth > 0 })),
    pageOnePixels: (() => {
      const image = document.querySelector('img[aria-label="Course syllabus.pdf, page 1"]');
      if (!image) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
      const sample = (x, y) => [...canvas.getContext("2d").getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data];
      return { white: sample(0.5, 0.5), blue: sample(0.16, 0.875), red: sample(0.75, 0.3) };
    })(),
  }));
  assert.ok(after.opacity.every((opacity) => Number(opacity) === 1), JSON.stringify(after.opacity));
  assert.ok(after.placeholders.every((placeholder) => placeholder.loaded));
  assert.deepEqual(after.placeholders.map((placeholder) => placeholder.filter), ["blur(16.5px)", "blur(16.5px)", "none"]);
  assert.ok(after.pageOnePixels?.blue?.[2] > 230 && after.pageOnePixels.red[0] > 230, JSON.stringify(after.pageOnePixels));
  if (!reducedMotion) await capture("05-after-reveal.png", { animations: "disabled" });
  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  await page.close();
  return { reducedMotion, before, blobDelivered, heldPdfResult, during, revealed, after, pageErrors };
}

async function runRestorationScenario(imageLast = true, reducedMotion = false) {
  const page = await browser.newPage({ viewport: { width: 1120, height: 1280 } });
  const errors = [];
  const heldAssets = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mapRoutes = [];
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.route("https://maps.google.com/**", (route) => { mapRoutes.push(route); });
  await page.route("**/preview-placeholders/*", (route) => { heldAssets.push(route); });
  await page.addInitScript(() => { window.__startCourseRestoration = true; });
  await page.goto(`http://127.0.0.1:${serverAddress.port}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__coursePreviewFixture?.releaseWorkspace === "function");
  await page.waitForSelector(".expanded-course-skeleton");
  assert.equal(await page.locator(".expanded-course-skeleton img").count(), 0, "skeleton has no preview images");
  await page.evaluate(() => window.__coursePreviewFixture.releaseWorkspace());
  await page.waitForFunction(() => document.querySelector(".expanded-course-skeleton") !== null);
  assert.equal(await page.locator(".course-preview-fixture").count(), 0, "workspace readiness cannot outrun placeholder assets");
  assert.equal(heldAssets.length, 3, "all public placeholder variants are requested");
  const fulfillAsset = (route) => route.fulfill({ status: 200, contentType: "image/png", body: placeholderAssets.get(new URL(route.request().url()).pathname) });
  await Promise.all(heldAssets.slice(0, 2).map(fulfillAsset));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator(".course-preview-fixture").count(), 0, "one outstanding asset still holds the skeleton");
  await fulfillAsset(heldAssets[2]);
  await page.waitForSelector(".course-preview-fixture");
  const restored = await page.evaluate(() => ({
    placeholders: [...document.querySelectorAll(".course-preview-placeholder")].map((image) => ({ src: new URL(image.src).pathname, complete: image.complete, width: image.naturalWidth })),
    readySurfaces: document.querySelectorAll(".course-preview-content.is-ready").length,
    skeletonPresent: document.querySelector(".expanded-course-skeleton") !== null,
  }));
  assert.equal(restored.placeholders.length, 3);
  assert.ok(restored.placeholders.every((image) => image.complete && image.width > 0), "actual placeholders are available at handoff");
  assert.equal(restored.readySurfaces, 0, "placeholder handoff does not reveal pending real content");
  assert.equal(restored.skeletonPresent, false);
  await page.evaluate(() => {
    window.__restoredRevealStarts = [];
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof HTMLElement && record.target.matches(".course-preview-content.is-ready, .expanded-course-image-reveal.is-ready")) {
          window.__restoredRevealStarts.push(performance.now());
        }
      }
    }).observe(document.getElementById("root"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  if (!imageLast) {
    await page.evaluate(() => window.__coursePreviewFixture.releaseHeaderImage());
    await page.waitForFunction(() => document.querySelector(".expanded-course-image-reveal img")?.naturalWidth > 0);
    assert.equal(await page.locator(".expanded-course-image-reveal.is-ready").count(), 0, "a loaded header waits for maps and syllabus");
  }
  await page.waitForFunction(() => window.__coursePreviewFixture.locationRequests.length === 2);
  await page.evaluate(() => {
    window.__coursePreviewFixture.resolveLocation("101 College Ave, Davis, California");
    window.__coursePreviewFixture.resolveLocation("202 College Ave, Davis, California");
    window.__coursePreviewFixture.releaseSyllabusBlob();
  });
  await waitUntil(() => mapRoutes.length === 2, "Restored maps should request frames");
  await Promise.all(mapRoutes.map((route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>Course map</p>" })));
  await page.waitForFunction(() => window.__coursePreviewPdfWorkerResultAvailable === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__releaseCoursePreviewPdfWorkerResult());
  await page.waitForFunction(() => document.querySelector('.private-pdf-preview [data-page="1"] img')?.naturalWidth > 0);
  if (imageLast) {
    assert.equal(await page.locator(".course-preview-content.is-ready").count(), 0, "maps and syllabus wait for the header");
    await page.evaluate(() => window.__coursePreviewFixture.releaseHeaderImage());
  }
  await page.waitForFunction(() => document.querySelectorAll(".course-preview-content.is-ready, .expanded-course-image-reveal.is-ready").length === 4);
  const starts = await page.evaluate(() => window.__restoredRevealStarts);
  assert.equal(starts.length, 4, "every restored media surface joins the shared reveal");
  assert.ok(Math.max(...starts) - Math.min(...starts) < 16, "header, maps, and syllabus start revealing in the same frame");
  assert.equal(await page.locator(".expanded-course-image-reveal img").evaluate((image) => getComputedStyle(image).objectPosition), "25% 65%", "the coordinated wrapper preserves the saved image framing");
  assert.deepEqual(errors, []);
  await page.close();
  return { imageLast, reducedMotion, restored, starts, errors };
}

try {
  browser = await playwright.chromium.launch((() => {
    const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
    if (process.env.CHROME_EXECUTABLE) options.executablePath = resolve(process.env.CHROME_EXECUTABLE);
    else options.channel = "chrome";
    return options;
  })());
  const standard = await runScenario(false);
  const reduced = await runScenario(true);
  const restoration = await runRestorationScenario();
  const restorationImageFirst = await runRestorationScenario(false);
  const restorationReduced = await runRestorationScenario(true, true);
  console.log(JSON.stringify({ worker: basename(workerFiles[0].path), workerBytes: workerBytes.length, standard, reduced, restoration, restorationImageFirst, restorationReduced, screenshots: screenshotDir }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
