import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const playwright = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright");
const course = {
  id: "browser-course-image",
  code: "HIST 201",
  name: "World History",
  credits: 3,
  instructor: "Dr. Rivera",
  room: "Room 12",
  color: "#5b63e8",
  soft: "#eef0ff",
  initials: "WH",
};
const file = {
  id: "browser-course-image-file",
  name: "World History image.png",
  mime_type: "image/png",
  size_bytes: "68",
  course_id: course.id,
  assignment_id: null,
  kind: "class-image",
  state: "ready",
  created_at: "2026-10-08T11:00:00.000Z",
  updated_at: "2026-10-08T11:00:00.000Z",
  content_sha256: null,
  folder_id: null,
  content_backend: "object",
  metadata_revision: 1,
  content_revision: 1,
  trashed_at: null,
  deleted_at: null,
  trash_operation_id: null,
  original_folder_id: null,
};
const revision = "2026-10-08T12:00:00.000Z";
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `
      import { createRoot } from "react-dom/client";
      import Workspace from "./app/workspace-client";
      import { validateProfile } from "./lib/profile";
      import { encodeWorkspaceState } from "./lib/workspace-codec";
      const profile = {
        ...validateProfile({ display_name: "Browser Fixture", major: "History" }),
        id: "dashboard-image-browser-profile", auth_user_id: "dashboard-image-browser-user",
        email: "browser@example.invalid", avatar_url: null, initialized: true,
        updated_at: "2026-10-08T12:00:00.000Z", onboarding_completed_at: "2026-10-07T00:00:00.000Z",
      };
      const course = ${JSON.stringify(course)};
      const dashboard = encodeWorkspaceState([{ id: "browser-home", name: "Home", widgets: [] }], "browser-home", "", {
        assignments: [], manualEvents: [], dashboardView: "cards",
      });
      window.fixtureWorkspacePayload = { initialized: true, courses: [course], dashboard, revision: profile.updated_at, profile };
      window.localStorage.clear();
      window.fixtureErrors = [];
      window.addEventListener("error", event => window.fixtureErrors.push(event.message));
      window.addEventListener("unhandledrejection", event => window.fixtureErrors.push(String(event.reason)));
      createRoot(document.getElementById("root")).render(<Workspace initialProfile={profile} />);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  loader: { ".css": "empty" },
  alias: {
    "next/link": resolve(root, "tests/helpers/next-link.mjs"),
    "next/navigation": resolve(root, "tests/helpers/next-navigation.mjs"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const cssFiles = [
  "globals", "auth", "reference-ui", "dashboard", "home-skeleton", "courses-skeleton",
  "widget-appearance", "widget-block-layout", "widget-reorder", "class-card-expansion",
];
const css = (await Promise.all(cssFiles.map((name) => readFile(resolve(root, `app/${name}.css`), "utf8"))))
  .map((source) => source.replace(/^@import[^;]+;\s*/gm, ""))
  .join("\n");
const server = createServer(async (request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("content-type", "text/javascript");
    response.end(bundle.outputFiles[0].text);
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const chromium = await playwright.chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE
  ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: "chrome" }) });

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

const workspaceSeen = deferred(), workspaceResponse = deferred();
const filesSeen = deferred(), filesResponse = deferred();
const imageSeen = deferred(), imageResponse = deferred();
let imageRequests = 0;
try {
  const page = await chromium.newPage({ viewport: { width: 1366, height: 900 } });
  await page.addInitScript(() => {
    const nativeDecode = HTMLImageElement.prototype.decode;
    window.__imageDecodeStarted = 0;
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: function () {
        const decoded = nativeDecode.call(this);
        window.__imageDecodeStarted++;
        return Promise.resolve(decoded).then(() => new Promise((resolvePromise) => {
          window.__releaseImageDecode = resolvePromise;
        }));
      },
    });
  });
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ json: { ok: true, revision } });
      return;
    }
    workspaceSeen.resolve();
    await workspaceResponse.promise;
    await route.fulfill({ json: await page.evaluate(() => window.fixtureWorkspacePayload) });
    workspaceResponse.resolve();
  });
  await page.route("**/api/files**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("id")) {
      filesSeen.resolve();
      await filesResponse.promise;
      await route.fulfill({ json: { files: [file] } });
      return;
    }
    imageRequests++;
    imageSeen.resolve();
    await imageResponse.promise;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7i8AAAAASUVORK5CYII=", "base64");
    await route.fulfill({ status: 200, contentType: "image/png", body: png });
  });

  await page.goto(`${baseUrl}/dashboard`);
  await workspaceSeen.promise;
  await filesSeen.promise;
  await page.waitForSelector('.courses-skeleton[aria-label="Loading dashboard"]');
  assert.equal(await page.locator(".dashboard-reflow").count(), 0, "workspace data is required before the live Dashboard mounts");

  workspaceResponse.resolve();
  await page.waitForSelector('[data-course-card-id="browser-course-image"]', { state: "attached" });
  const beforeFiles = await page.evaluate(() => {
    const skeleton = document.querySelector(".courses-skeleton");
    const dashboardRoot = document.querySelector("main > .dashboard-reflow");
    return {
      skeletonVisible: Boolean(skeleton && getComputedStyle(skeleton).display !== "none"),
      cardMounted: Boolean(document.querySelector("[data-course-card-id]")),
      imagesPending: dashboardRoot?.getAttribute("data-images-pending"),
      hidden: getComputedStyle(dashboardRoot).visibility === "hidden",
      height: getComputedStyle(dashboardRoot).height,
      inert: dashboardRoot?.hasAttribute("inert"),
      ariaHidden: dashboardRoot?.getAttribute("aria-hidden"),
      imageCount: document.querySelectorAll(".class-card .private-class-image").length,
    };
  });
  assert.deepEqual(beforeFiles, {
    skeletonVisible: true,
    cardMounted: true,
    imagesPending: "true",
    hidden: true,
    height: "0px",
    inert: true,
    ariaHidden: "true",
    imageCount: 0,
  }, "the live card tree is mounted but hidden and inert until file metadata arrives");

  filesResponse.resolve();
  await imageSeen.promise;
  assert.equal(imageRequests, 1, "one selected class image creates one private blob request");
  imageResponse.resolve();
  await page.waitForFunction(() => {
    const image = document.querySelector(".class-card .private-class-image");
    return image?.complete && image.naturalWidth > 0 && typeof window.__releaseImageDecode === "function";
  });
  const beforeDecodeRelease = await page.evaluate(() => {
    const skeleton = document.querySelector(".courses-skeleton");
    const dashboardRoot = document.querySelector("main > .dashboard-reflow");
    const image = document.querySelector(".class-card .private-class-image");
    return {
      skeletonStillVisible: Boolean(skeleton && getComputedStyle(skeleton).display !== "none"),
      imageComplete: image.complete,
      imageWidth: image.naturalWidth,
      cardOwnsImage: image.closest("[data-course-card-id]")?.getAttribute("data-course-card-id"),
      blobSource: image.currentSrc.startsWith("blob:"),
      imagesPending: dashboardRoot.getAttribute("data-images-pending"),
      dashboardHidden: getComputedStyle(dashboardRoot).visibility === "hidden",
      dashboardHeight: getComputedStyle(dashboardRoot).height,
      imageDecodeStarted: window.__imageDecodeStarted,
    };
  });
  assert.deepEqual(beforeDecodeRelease, {
    skeletonStillVisible: true,
    imageComplete: true,
    imageWidth: 1,
    cardOwnsImage: "browser-course-image",
    blobSource: true,
    imagesPending: "true",
    dashboardHidden: true,
    dashboardHeight: "0px",
    imageDecodeStarted: 1,
  }, "the browser has loaded the card image while the skeleton still covers the zero-height dashboard");

  await page.evaluate(() => {
    window.__revealSamples = [];
    const observer = new MutationObserver(() => {
      if (!document.querySelector(".courses-skeleton")) {
        const dashboardRoot = document.querySelector("main > .dashboard-reflow");
        const image = document.querySelector(".class-card .private-class-image");
        window.__revealSamples.push({
          skeletonGone: true,
          dashboardVisible: getComputedStyle(dashboardRoot).visibility === "visible",
          dashboardHeight: getComputedStyle(dashboardRoot).height,
          imageComplete: image?.complete,
          imageWidth: image?.naturalWidth,
        });
      }
    });
    observer.observe(document.querySelector("main"), { childList: true, subtree: true });
    window.__revealObserver = observer;
  });
  await page.evaluate(() => window.__releaseImageDecode());
  await page.waitForFunction(() => document.querySelector(".courses-skeleton") === null);
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  const afterReveal = await page.evaluate(() => {
    const dashboardRoot = document.querySelector("main > .dashboard-reflow");
    const image = document.querySelector(".class-card .private-class-image");
    window.__revealObserver.disconnect();
    return {
      skeletonCount: document.querySelectorAll(".courses-skeleton").length,
      dashboardVisible: getComputedStyle(dashboardRoot).visibility === "visible",
      dashboardHeight: getComputedStyle(dashboardRoot).height,
      imagesPending: dashboardRoot.getAttribute("data-images-pending"),
      inert: dashboardRoot.hasAttribute("inert"),
      ariaHidden: dashboardRoot.getAttribute("aria-hidden"),
      imageComplete: image.complete,
      imageWidth: image.naturalWidth,
      sourceRequests: window.performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/api/files?id=")).length,
      revealSamples: window.__revealSamples,
      runtimeErrors: window.fixtureErrors,
    };
  });
  assert.equal(afterReveal.skeletonCount, 0);
  assert.equal(afterReveal.dashboardVisible, true);
  assert.notEqual(afterReveal.dashboardHeight, "0px");
  assert.equal(afterReveal.imagesPending, null);
  assert.equal(afterReveal.inert, false);
  assert.equal(afterReveal.ariaHidden, null);
  assert.equal(afterReveal.imageComplete, true);
  assert.equal(afterReveal.imageWidth, 1);
  assert.equal(imageRequests, 1, "reveal uses the already-loaded image without a second file request");
  assert.equal(afterReveal.revealSamples.some((sample) => sample.skeletonGone && sample.dashboardVisible && sample.imageComplete && sample.imageWidth > 0), true,
    "the first observed frame after skeleton removal already has a visible dashboard and decoded image");
  assert.deepEqual(afterReveal.runtimeErrors, []);
  console.log(JSON.stringify({ beforeFiles, beforeDecodeRelease, afterReveal, imageRequests }, null, 2));
} finally {
  await chromium.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
