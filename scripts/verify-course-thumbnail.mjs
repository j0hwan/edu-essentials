import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const playwright = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright");
const courseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#e9f3ff"/><rect x="0" y="0" width="400" height="200" fill="#ed3429"/><rect x="400" y="200" width="400" height="200" fill="#168b53"/><circle cx="600" cy="100" r="75" fill="#ffd43b"/></svg>`;
const compactSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="white"/><circle cx="150" cy="75" r="50" fill="#5b4bca"/></svg>`;

const bundle = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import { createElement, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { PrivateImage } from "./app/private-files";
    import ExpandedCourseImage from "./app/expanded-course-image";
    import { useCourseExpansion } from "./app/use-course-expansion";

    declare global {
      interface Window {
        openCourse: (id: string) => void;
        navigateHome: () => void;
        returnDashboard: () => void;
        setFilesReady: (ready: boolean) => void;
        setProfile: (profileId: string) => void;
        closeIntent: () => void;
        endClose: () => void;
        remountExpanded: () => void;
        expandedRequests: string[];
        releaseExpanded: (index?: number) => void;
      }
    }

    const courses = [
      {id: "course-one", name: "Course One", code: "ONE", credits: 3, color: "#355eac", soft: "#e9f3ff", initials: "CO"},
      {id: "course-two", name: "Course Two", code: "TWO", credits: 3, color: "#a64835", soft: "#fff0e9", initials: "CT"},
    ];
    const files = {
      "course-one": {id: "image-one", name: "Course image", updated_at: "2026-10-26T00:00:00Z", created_at: "2026-10-26T00:00:00Z", content_revision: 7, trashed_at: null, deleted_at: null, course_id: "course-one", kind: "class-image", state: "ready", mime_type: "image/svg+xml"},
      "course-two": {id: "image-two", name: "Other course image", updated_at: "2026-10-25T00:00:00Z", created_at: "2026-10-25T00:00:00Z", content_revision: 2, trashed_at: null, deleted_at: null, course_id: "course-two", kind: "class-image", state: "ready", mime_type: "image/svg+xml"},
    };
    const imageBytes = ${JSON.stringify(courseSvg)};
    const compactBytes = ${JSON.stringify(compactSvg)};
    const compactStore = {blob: async () => new Blob([compactBytes], {type: "image/svg+xml"})};
    const expandedStore = {blob: (file, signal) => new Promise((resolve, reject) => {
      const index = window.expandedRequests.push(file.id) - 1;
      const onAbort = () => reject(new DOMException("aborted", "AbortError"));
      signal?.addEventListener("abort", onAbort, {once: true});
      window.releaseExpanded = (requestedIndex = index) => {
        if (requestedIndex !== index) return;
        signal?.removeEventListener("abort", onAbort);
        resolve(new Blob([imageBytes], {type: "image/svg+xml"}));
      };
    })};
    window.expandedRequests = [];

    function Fixture() {
      const [page, setPage] = useState("dashboard");
      const [filesReady, setReady] = useState(true);
      const [profileId, setProfileId] = useState("profile-one");
      const [mountKey, setMountKey] = useState(0);
      const {selectedClass, openDashboardCourse, clearSavedCourse, setSelectedClass, skipOpeningAnimation} = useCourseExpansion({profileId, page, courses, ready: true});
      window.openCourse = (id) => openDashboardCourse(courses.find((course) => course.id === id));
      window.navigateHome = () => setPage("home");
      window.returnDashboard = () => setPage("dashboard");
      window.setFilesReady = setReady;
      window.setProfile = setProfileId;
      window.closeIntent = clearSavedCourse;
      window.endClose = () => setSelectedClass(null);
      window.remountExpanded = () => setMountKey((key) => key + 1);
      const file = filesReady && selectedClass ? files[selectedClass.id] : undefined;
      return <main>
        <div id="compact" style={{position: "relative", width: 300, height: 150}}>
          <PrivateImage file={files["course-one"]} store={compactStore} />
        </div>
        {selectedClass && <div id="expanded" data-course-id={selectedClass.id} style={{position: "relative", width: 800, height: 400}}>
          <ExpandedCourseImage key={mountKey} profileId={profileId} courseId={selectedClass.id} file={file} store={expandedStore} filesReady={filesReady} restored={skipOpeningAnimation} />
        </div>}
        <output id="fixture-state" data-profile={profileId} data-page={page} data-course={selectedClass?.id ?? ""} data-files-ready={String(filesReady)} />
      </main>;
    }
    createRoot(document.getElementById("root")).render(<Fixture />);
  ` },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  alias: {"next/navigation": resolve(root, "tests/helpers/next-navigation.mjs")},
  define: {"process.env.NODE_ENV": '"production"'},
});

const css = (await Promise.all(["globals", "auth", "reference-ui", "dashboard", "class-card-expansion"]
  .map((name) => readFile(resolve(root, `app/${name}.css`), "utf8"))))
  .map((source) => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
const browser = await playwright.chromium.launch({headless: true, ...(process.env.CHROME_EXECUTABLE
  ? {executablePath: process.env.CHROME_EXECUTABLE} : {channel: "chrome"})});

const thumbnailKey = "edu-dashboard-course-thumbnail:profile-one";
const expandedKey = "edu-dashboard-expanded-course:profile-one";
const browserChecks = [];
try {
  const page = await browser.newPage({viewport: {width: 1000, height: 600}});
  await page.route("https://course-thumbnail.example/", (route) => route.fulfill({contentType: "text/html", body:
    `<style>${css}\nbody{margin:0;background:#fff}#root{padding:8px}#expanded{margin-top:8px}</style><div id="root"></div>`}));
  await page.goto("https://course-thumbnail.example/");
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  await page.waitForFunction(() => typeof window.openCourse === "function");
  await page.waitForFunction(() => document.querySelector("#compact img")?.complete && document.querySelector("#compact img")?.naturalWidth > 0);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), thumbnailKey), null,
    "the compact PrivateImage load does not create a thumbnail cache");
  browserChecks.push("compact PrivateImage loaded without writing a thumbnail");

  await page.evaluate(() => window.openCourse("course-one"));
  await page.waitForFunction(() => window.expandedRequests.length === 1);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), thumbnailKey), null,
    "an expanded image that has not decoded does not write a thumbnail");
  await page.evaluate(() => window.releaseExpanded(0));
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, thumbnailKey);
  const firstRecord = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), thumbnailKey);
  assert.deepEqual({version: firstRecord.version, courseId: firstRecord.courseId, fileId: firstRecord.fileId,
    contentRevision: firstRecord.contentRevision, updatedAt: firstRecord.updatedAt}, {
    version: 1, courseId: "course-one", fileId: "image-one", contentRevision: 7, updatedAt: "2026-10-26T00:00:00Z",
  }, "the expanded decode writes revision-scoped metadata for its course and account");
  assert.match(firstRecord.dataUrl, /^data:image\/jpeg;base64,/, "the cache stores browser-encoded JPEG bytes");
  assert.ok(firstRecord.dataUrl.length <= 16 * 1024, "the cached JPEG data URL stays within the 16 KiB limit");
  assert.ok(firstRecord.width >= 1 && firstRecord.width <= 32 && firstRecord.height >= 1 && firstRecord.height <= 32,
    "the browser canvas encodes both dimensions at 32 pixels or less");
  const decodedThumbnail = await page.evaluate(async (dataUrl) => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    return {width: image.naturalWidth, height: image.naturalHeight};
  }, firstRecord.dataUrl);
  assert.deepEqual([decodedThumbnail.width, decodedThumbnail.height], [firstRecord.width, firstRecord.height],
    "the stored data URL decodes as the recorded real JPEG dimensions");
  browserChecks.push("expanded decode wrote a <=32px browser JPEG with matching file revision");

  await page.evaluate(() => window.navigateHome());
  await page.waitForFunction(() => document.querySelector("#fixture-state")?.dataset.page === "home");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), thumbnailKey), JSON.stringify(firstRecord),
    "dashboard navigation keeps the account thumbnail");
  await page.evaluate(() => window.setFilesReady(false));
  await page.evaluate(() => window.returnDashboard());
  await page.waitForFunction(() => document.querySelector("#fixture-state")?.dataset.course === "course-one"
    && document.querySelector("#fixture-state")?.dataset.filesReady === "false");
  await page.waitForSelector("#expanded img.private-class-image-thumbnail");
  const restoredBeforeFiles = await page.locator("#expanded img.private-class-image-thumbnail").evaluate((image) => ({
    src: image.getAttribute("src"), filter: getComputedStyle(image).filter,
  }));
  assert.equal(restoredBeforeFiles.src, firstRecord.dataUrl,
    "the matching cache is visible immediately on restore before file metadata loads");
  assert.ok(restoredBeforeFiles.filter.includes("blur("), "the restored low-resolution image remains blurred before file loading");
  assert.equal(await page.evaluate(() => window.expandedRequests.length), 1,
    "the full-resolution private blob is not requested until file metadata is ready");
  browserChecks.push("navigating away preserves the cache; restored course shows it before file metadata loads");

  await page.evaluate(() => window.setFilesReady(true));
  await page.waitForFunction(() => window.expandedRequests.length === 2);
  assert.equal(await page.locator("#expanded img.private-class-image-thumbnail").count(), 1,
    "the cached placeholder remains visible while the restored full-resolution blob is held");
  await page.evaluate(() => window.releaseExpanded(1));
  await page.waitForFunction(() => {
    const image = document.querySelector("#expanded img.private-class-image-fade.is-ready");
    return image?.getAnimations().some((animation) => animation.animationName === "course-image-gradient-in");
  });
  const reveal = await page.evaluate(() => {
    const image = document.querySelector("#expanded img.private-class-image-fade.is-ready");
    const animation = image.getAnimations().find((item) => item.animationName === "course-image-gradient-in");
    animation.pause(); animation.currentTime = 0;
    return {duration: animation.effect.getTiming().duration, placeholderCount: document.querySelectorAll("#expanded img.private-class-image-thumbnail").length,
      highResolutionCount: document.querySelectorAll("#expanded img.private-class-image-fade.is-ready").length};
  });
  assert.equal(reveal.duration, 240, "the full-resolution layer reveals over 240ms");
  assert.equal(reveal.placeholderCount, 1, "the low-resolution layer remains under the full-resolution reveal");
  assert.equal(reveal.highResolutionCount, 1, "the decoded full-resolution layer is overlaid on the placeholder");
  browserChecks.push("restored full-resolution image overlays its cached placeholder with the 240ms reveal");

  await page.evaluate(() => window.navigateHome());
  await page.waitForFunction(() => document.querySelector("#fixture-state")?.dataset.page === "home");
  await page.evaluate(() => {
    localStorage.setItem("edu-dashboard-expanded-course:profile-two", "course-one");
    window.setProfile("profile-two");
    window.setFilesReady(false);
    window.returnDashboard();
  });
  await page.waitForFunction(() => document.querySelector("#fixture-state")?.dataset.profile === "profile-two"
    && document.querySelector("#fixture-state")?.dataset.course === "course-one");
  assert.equal(await page.locator("#expanded img.private-class-image-thumbnail").count(), 0,
    "an account without its own cache never displays another account's thumbnail");
  assert.notEqual(await page.evaluate((key) => localStorage.getItem(key), thumbnailKey), null,
    "testing another account leaves the first account's cache isolated");
  browserChecks.push("a second account cannot display the first account's thumbnail");

  await page.evaluate(() => {
    window.setProfile("profile-one");
    window.returnDashboard();
  });
  await page.waitForFunction(() => document.querySelector("#fixture-state")?.dataset.profile === "profile-one"
    && document.querySelector("#fixture-state")?.dataset.course === "course-one");
  await page.waitForSelector("#expanded img.private-class-image-thumbnail");
  await page.evaluate(() => window.setFilesReady(true));
  await page.waitForFunction(() => window.expandedRequests.length === 3);
  await page.evaluate(() => window.closeIntent());
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), thumbnailKey), null,
    "close intent deletes the thumbnail before the expanded view finishes closing");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), expandedKey), null,
    "close intent deletes the saved expanded-course key immediately");
  await page.evaluate(() => window.releaseExpanded(2));
  await page.waitForFunction(() => document.querySelector("#expanded img.private-class-image-fade.is-ready")?.complete);
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), thumbnailKey), null,
    "a private image decoded after close intent cannot repopulate the thumbnail");
  await page.evaluate(() => window.endClose());
  await page.waitForFunction(() => document.querySelector("#expanded") === null);
  browserChecks.push("close intent clears storage before unmount; a late decoded image cannot recreate the cache");

  await page.evaluate(() => {
    localStorage.setItem("edu-dashboard-expanded-course:profile-one", "course-one");
    localStorage.setItem("edu-dashboard-course-thumbnail:profile-one", JSON.stringify({
      version: 1, courseId: "course-one", fileId: "image-one", contentRevision: 7,
      updatedAt: "2026-10-26T00:00:00Z", dataUrl: "data:image/jpeg;base64,AA==", width: 1, height: 1,
    }));
    window.openCourse("course-two");
  });
  await page.waitForFunction(() => document.querySelector("#fixture-state")?.dataset.course === "course-two");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), thumbnailKey), null,
    "opening another course clears the previous course's thumbnail");
  assert.equal(await page.locator("#expanded img.private-class-image-thumbnail").count(), 0,
    "a different course never displays a stale placeholder from the previous course");
  browserChecks.push("selecting another course clears the old course placeholder");

  console.log(JSON.stringify({browser: "Chrome", checks: browserChecks, thumbnail: {
    version: firstRecord.version, courseId: firstRecord.courseId, fileId: firstRecord.fileId,
    width: firstRecord.width, height: firstRecord.height, dataUrlLength: firstRecord.dataUrl.length,
    restoredRevealDurationMs: reveal.duration,
  }}, null, 2));
} finally {
  await browser.close();
}
