import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { readWorkspaceStylesheets } from "../tests/helpers/workspace-presentation.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(repoRoot, "tests/fixtures/class-syllabus-browser.tsx");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");

const workerDirectory = join(repoRoot, "dist/client/_next/static");
const workerCandidates = (await readdir(workerDirectory))
  .filter((name) => /^pdf-preview\.worker-.+\.js$/.test(name))
  .map(async (name) => ({ path: join(workerDirectory, name), modified: (await stat(join(workerDirectory, name))).mtimeMs }));
const workers = await Promise.all(workerCandidates);
workers.sort((left, right) => right.modified - left.modified);
assert.ok(workers.length, `No built PDF preview worker found in ${workerDirectory}; build the app first.`);
const workerBytes = await readFile(workers[0].path);

const { css } = await readWorkspaceStylesheets();
const bundle = await build({
  absWorkingDir: repoRoot,
  entryPoints: [fixturePath],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  plugins: [{
    name: "class-syllabus-pdf-worker",
    setup(esbuild) {
      esbuild.onResolve({ filter: /\?worker$/ }, () => ({ path: "worker-shim", namespace: "class-syllabus-worker-shim" }));
      esbuild.onLoad({ filter: /.*/, namespace: "class-syllabus-worker-shim" }, () => ({
        contents: "export default class PdfPreviewWorker extends Worker { constructor() { super('/worker.js'); } }",
        loader: "js",
      }));
    },
  }],
});

const html = `<!doctype html><html data-theme="light" data-motion="full"><head><meta charset="utf-8"><base href="https://edu.example/"><style>:root{--font-geist-sans:Arial,sans-serif}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const fixtureBytes = Buffer.from(bundle.outputFiles[0].contents);
async function routeFixture(page) {
  await page.route("https://edu.example/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    if (pathname === "/fixture.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: fixtureBytes });
    if (pathname === "/worker.js") return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "cache-control": "no-store" }, body: workerBytes });
    if (pathname === "/favicon.ico") return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 404, body: "Not found" });
  });
}

const launchOptions = {
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: resolve(process.env.CHROME_EXECUTABLE) } : { channel: "chrome" }),
};
const viewports = [
  { name: "desktop", width: 1366, height: 900 },
  { name: "short", width: 1024, height: 650 },
  { name: "mobile", width: 390, height: 844 },
];
const longPdfName = `${"Syllabus 2026 department and catalog materials ".repeat(5)}final.pdf`;
const longTextName = `${"Required readings and course policies ".repeat(5)}revised.txt`;
assert.ok(longPdfName.length <= 255 && longTextName.length <= 255, "long filename fixtures fit the application filename limit");
const pdfSource = makeTwoPagePdf();
const longText = Array.from({ length: 100 }, (_, index) =>
  `Week ${index + 1}: Required reading, lecture notes, assignment dates, and course policies. ${"This line checks that saved and uploaded text remains inside its own preview scroll area. ".repeat(2)}`,
).join("\n");
let browser;
const outcomes = [];

function makeTwoPagePdf() {
  const firstPage = "1 1 1 rg 0 0 300 400 re f\n0 0 1 rg 30 30 100 100 re f\n1 0 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Page 1) Tj ET\n";
  const secondPage = "1 1 1 rg 0 0 300 400 re f\n0 0.8 0 rg 30 30 100 100 re f\n1 0.8 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Page 2) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${firstPage.length} >>\nstream\n${firstPage}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${secondPage.length} >>\nstream\n${secondPage}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function assertSameBoxes(before, after, context) {
  for (const key of ["dialog", "header", "body", "customize", "card", "icons", "syllabus", "upload", "preview", "footer"]) {
    assert.ok(before[key], `${context}: baseline ${key} box exists`);
    assert.ok(after[key], `${context}: updated ${key} box exists`);
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(before[key][dimension] - after[key][dimension]) <= 1.5,
        `${context}: ${key}.${dimension} stayed stable (${before[key][dimension]} -> ${after[key][dimension]})`);
    }
  }
  assert.equal(after.separateFilenameRows, 0, `${context}: no separate filename row remains`);
  assert.ok(Math.abs(before.preview.width / before.preview.height - 8.5 / 11) < 0.02,
    `${context}: preview is portrait letter aspect (${before.preview.width}x${before.preview.height})`);
  assert.ok(Math.abs(after.preview.width / after.preview.height - 8.5 / 11) < 0.02,
    `${context}: preview remains portrait letter aspect (${after.preview.width}x${after.preview.height})`);
}

async function settle(page) {
  await page.locator(".class-setup").evaluate(async (form) => {
    const animations = form.getAnimations({ subtree: true });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
  });
  await page.waitForTimeout(40);
}

async function getGeometry(page) {
  await page.locator(".class-setup").evaluate((form) => { form.scrollTop = 0; });
  return page.locator(".class-setup").evaluate((form) => {
    const box = (selector) => {
      const element = form.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, Math.round(rect[key] * 10) / 10]));
    };
    const separateFilenameRows = form.querySelectorAll(".class-setup-syllabus-file").length;
    return {
      dialog: (() => {
        const rect = form.getBoundingClientRect();
        return Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, Math.round(rect[key] * 10) / 10]));
      })(),
      header: box(".class-setup-header"),
      body: box(".class-setup-body"),
      customize: box(".class-setup-customize"),
      card: box(".class-setup-card"),
      icons: box(".class-setup-icon-picker"),
      syllabus: box(".class-setup-syllabus"),
      upload: box(".class-setup-syllabus-upload"),
      preview: box(".class-setup-document-preview"),
      footer: box(".class-setup-actions"),
      separateFilenameRows,
      formScrollHeight: form.scrollHeight,
    };
  });
}

async function enterCustomize(page) {
  await routeFixture(page);
  await page.goto("https://edu.example/");
  await page.getByRole("dialog", { name: "Course information" }).waitFor();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: "Class schedule" }).waitFor();
  await settle(page);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await settle(page);
}

async function compareAndAssert(page, baseline, context) {
  const next = await getGeometry(page);
  assertSameBoxes(baseline, next, context);
  assert.equal(next.formScrollHeight, baseline.formScrollHeight, `${context}: form content height remains stable`);
  return next;
}

async function assertSuccessfulUploadBox(page, filename) {
  const box = page.locator(".class-setup-syllabus-upload");
  assert.equal(await box.locator(".class-setup-syllabus-upload-title").innerText(), "Upload Successful");
  assert.equal(await box.locator(".class-setup-syllabus-upload-name").innerText(), filename);
  assert.equal(await box.locator(".class-setup-syllabus-upload-name").getAttribute("title"), filename);
  const expectedColor = (variable) => box.evaluate((element, name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    element.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
  assert.equal(await box.locator(".class-setup-syllabus-upload-title").evaluate((node) => getComputedStyle(node).color), await expectedColor("--green"));
  const remove = box.getByRole("button", { name: "Remove syllabus" });
  await remove.hover();
  await page.waitForTimeout(180);
  assert.equal(await remove.evaluate((node) => getComputedStyle(node).color), await expectedColor("--red"), "remove X turns red on hover");
}

async function verifyUploadsForViewport(page, viewport) {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) browserErrors.push(message.text());
  });
  await enterCustomize(page);
  const baseline = await getGeometry(page);
  assert.equal(baseline.separateFilenameRows, 0, `${viewport.name}: no empty filename row`);

  await page.getByLabel("Syllabus (optional)").setInputFiles({ name: longPdfName, mimeType: "application/pdf", buffer: Buffer.from(pdfSource) });
  await page.getByRole("region", { name: "PDF preview" }).waitFor({ timeout: 15_000 });
  await page.locator(".class-setup-document-preview img[aria-label$='page 1']:visible").waitFor({ timeout: 15_000 });
  const pdfGeometry = await compareAndAssert(page, baseline, `${viewport.name} after PDF upload`);
  const filenameText = await page.locator(".class-setup-syllabus-upload-name").innerText();
  assert.ok(filenameText.includes("final.pdf"), `${viewport.name}: long PDF filename is present`);
  await assertSuccessfulUploadBox(page, longPdfName);
  const filenameOverflow = await page.locator(".class-setup-syllabus-upload-name").evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    overflow: getComputedStyle(node).overflow,
    textOverflow: getComputedStyle(node).textOverflow,
    whiteSpace: getComputedStyle(node).whiteSpace,
  }));
  assert.ok(filenameOverflow.scrollWidth > filenameOverflow.clientWidth, `${viewport.name}: long filename is clipped (${JSON.stringify(filenameOverflow)})`);
  assert.equal(filenameOverflow.overflow, "hidden", `${viewport.name}: filename overflow is contained`);
  assert.equal(filenameOverflow.textOverflow, "ellipsis", `${viewport.name}: filename uses ellipsis`);
  assert.equal(filenameOverflow.whiteSpace, "nowrap", `${viewport.name}: filename does not wrap into a taller row`);
  const pdfAspect = await page.locator(".class-setup-document-preview img[aria-label$='page 1']").evaluate((image) => image.naturalWidth / image.naturalHeight);
  assert.ok(Math.abs(pdfAspect - 0.75) < 0.02, `${viewport.name}: rendered PDF page preserves portrait 3:4 aspect (${pdfAspect})`);

  const preview = page.locator(".private-pdf-preview");
  await preview.scrollIntoViewIfNeeded();
  const formBeforeWheel = await page.locator(".class-setup").evaluate((form) => form.scrollTop);
  await page.mouse.move((await preview.boundingBox()).x + 80, (await preview.boundingBox()).y + 100);
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => document.querySelector(".private-pdf-preview")?.scrollTop > 0, undefined, { timeout: 3000 });
  const pdfScroll = await page.evaluate(() => ({
    preview: document.querySelector(".private-pdf-preview")?.scrollTop ?? 0,
    form: document.querySelector(".class-setup")?.scrollTop ?? 0,
    window: window.scrollY,
  }));
  assert.ok(pdfScroll.preview > 0, `${viewport.name}: wheel scroll advances the PDF's internal scroller`);
  assert.equal(pdfScroll.form, formBeforeWheel, `${viewport.name}: PDF wheel does not scroll the class form`);
  assert.equal(pdfScroll.window, 0, `${viewport.name}: PDF wheel does not scroll the page`);
  await page.locator(".class-setup").evaluate((form) => { form.scrollTop = 0; });

  await page.getByLabel("Syllabus (optional)").setInputFiles({ name: longTextName, mimeType: "text/plain", buffer: Buffer.from(longText) });
  await page.locator(".class-setup-document-content pre").waitFor();
  await page.waitForFunction(() => document.querySelector(".class-setup-document-content pre")?.scrollHeight > 300);
  const textGeometry = await compareAndAssert(page, baseline, `${viewport.name} after text replacement`);
  const textPreview = page.locator(".class-setup-document-content pre");
  await textPreview.scrollIntoViewIfNeeded();
  const formBeforeTextWheel = await page.locator(".class-setup").evaluate((form) => form.scrollTop);
  const textBox = await textPreview.boundingBox();
  await page.mouse.move(textBox.x + 50, textBox.y + 60);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.querySelector(".class-setup-document-content pre")?.scrollTop > 0, undefined, { timeout: 3000 });
  const textScroll = await page.evaluate(() => ({
    preview: document.querySelector(".class-setup-document-content pre")?.scrollTop ?? 0,
    form: document.querySelector(".class-setup")?.scrollTop ?? 0,
    window: window.scrollY,
  }));
  assert.ok(textScroll.preview > 0, `${viewport.name}: long text scrolls inside its preview`);
  assert.equal(textScroll.form, formBeforeTextWheel, `${viewport.name}: text wheel does not scroll the class form`);
  assert.equal(textScroll.window, 0, `${viewport.name}: text wheel does not scroll the page`);
  await page.locator(".class-setup").evaluate((form) => { form.scrollTop = 0; });

  if (viewport.name === "desktop") {
    await textPreview.evaluate((pre) => { pre.scrollTop = 0; });
    await page.screenshot({ path: "/tmp/class-syllabus-desktop.png" });
  }
  if (viewport.name === "mobile") {
    await textPreview.evaluate((pre) => { pre.scrollTop = 0; });
    await page.locator(".class-setup-document-preview").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/class-syllabus-mobile.png", fullPage: true });
  }

  let fileChooserOpened = false;
  const onFileChooser = () => { fileChooserOpened = true; };
  page.on("filechooser", onFileChooser);
  await page.getByRole("button", { name: "Remove syllabus" }).click();
  page.off("filechooser", onFileChooser);
  assert.equal(fileChooserOpened, false, `${viewport.name}: removing does not open the file picker`);
  assert.ok((await page.locator(".class-setup-syllabus-upload").innerText()).startsWith("Upload your syllabus"));
  await settle(page);
  const removedGeometry = await compareAndAssert(page, baseline, `${viewport.name} after removing upload`);
  assert.equal(await page.locator(".class-setup-document-empty").count(), 1, `${viewport.name}: empty preview remains mounted after remove`);
  assert.equal(browserErrors.length, 0, `${viewport.name}: no browser errors (${browserErrors.join("; ")})`);
  return { viewport: viewport.name, baseline, pdf: pdfGeometry, text: textGeometry, removed: removedGeometry, pdfScroll, textScroll };
}

async function verifySavedPreview(page, mode, viewport) {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) browserErrors.push(message.text());
  });
  await routeFixture(page);
  await page.goto(`https://edu.example/?saved=${mode}`);
  await page.getByRole("dialog", { name: "Course information" }).waitFor();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: "Class schedule" }).waitFor();
  await settle(page);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await settle(page);
  const isSavedPdf = mode === "inline-pdf";
  if (mode === "inline") await page.locator(".class-setup-document-content .inline-file-preview pre").waitFor({ timeout: 5000 });
  else if (isSavedPdf) {
    await page.locator(".class-setup-document-content .inline-file-preview .private-pdf-preview").waitFor();
    await page.locator(".class-setup-document-content .inline-file-preview img[aria-label$='page 1']:visible").waitFor({ timeout: 15_000 });
  } else await page.locator(".class-setup-document-content > pre").waitFor();
  const geometry = await getGeometry(page);
  assert.equal(geometry.separateFilenameRows, 0, `${viewport.name} saved ${mode}: no separate filename row`);
  assert.ok(Math.abs(geometry.preview.width / geometry.preview.height - 8.5 / 11) < 0.02,
    `${viewport.name} saved ${mode}: preview is portrait letter ratio`);

  if (isSavedPdf) {
    const nestedPdf = page.locator(".class-setup-document-content .inline-file-preview .private-pdf-preview");
    const dimensions = await page.evaluate(() => {
      const frame = document.querySelector(".class-setup-document-preview");
      const pdf = document.querySelector(".class-setup-document-content .inline-file-preview .private-pdf-preview");
      if (!frame || !pdf) return null;
      return { frame: frame.getBoundingClientRect().height, pdf: pdf.getBoundingClientRect().height, scrollHeight: pdf.scrollHeight, clientHeight: pdf.clientHeight };
    });
    assert.ok(dimensions && Math.abs(dimensions.frame - dimensions.pdf) <= 2,
      `${viewport.name} saved inline PDF fills the persistent preview frame (${JSON.stringify(dimensions)})`);
    const imageAspect = await page.locator(".class-setup-document-content .inline-file-preview img[aria-label$='page 1']").evaluate((image) => image.naturalWidth / image.naturalHeight);
    assert.ok(Math.abs(imageAspect - 0.75) < 0.02, `${viewport.name} saved inline PDF preserves page aspect`);
    await nestedPdf.scrollIntoViewIfNeeded();
    const formBefore = await page.locator(".class-setup").evaluate((form) => form.scrollTop);
    const box = await nestedPdf.boundingBox();
    await page.mouse.move(box.x + 80, box.y + 100);
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => document.querySelector(".class-setup-document-content .inline-file-preview .private-pdf-preview")?.scrollTop > 0, undefined, { timeout: 3000 });
    const scroll = await page.evaluate(() => ({
      preview: document.querySelector(".class-setup-document-content .inline-file-preview .private-pdf-preview")?.scrollTop ?? 0,
      form: document.querySelector(".class-setup")?.scrollTop ?? 0,
      window: window.scrollY,
    }));
    assert.ok(scroll.preview > 0, `${viewport.name} saved inline PDF scrolls inside its PDF viewer`);
    assert.equal(scroll.form, formBefore, `${viewport.name} saved inline PDF wheel does not scroll the form`);
    assert.equal(scroll.window, 0, `${viewport.name} saved inline PDF wheel does not scroll the page`);
    assert.equal(browserErrors.length, 0, `${viewport.name} saved inline PDF emitted no browser errors (${browserErrors.join("; ")})`);
    return { viewport: viewport.name, saved: mode, geometry, dimensions, scroll };
  }

  const textPreview = page.locator(".class-setup-document-content pre").first();
  await page.waitForFunction(() => [...document.querySelectorAll(".class-setup-document-content pre")].some((pre) => pre.scrollHeight > pre.clientHeight));
  await textPreview.scrollIntoViewIfNeeded();
  const formBefore = await page.locator(".class-setup").evaluate((form) => form.scrollTop);
  const box = await textPreview.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => [...document.querySelectorAll(".class-setup-document-content pre")].some((pre) => pre.scrollTop > 0));
  const scroll = await page.evaluate(() => ({
    preview: Math.max(...[...document.querySelectorAll(".class-setup-document-content pre")].map((pre) => pre.scrollTop)),
    form: document.querySelector(".class-setup")?.scrollTop ?? 0,
    window: window.scrollY,
  }));
  assert.ok(scroll.preview > 0, `${viewport.name} saved ${mode}: internal text preview scrolls`);
  assert.equal(scroll.form, formBefore, `${viewport.name} saved ${mode}: wheel does not scroll the form`);
  assert.equal(scroll.window, 0, `${viewport.name} saved ${mode}: wheel does not scroll the page`);
  assert.equal(browserErrors.length, 0, `${viewport.name} saved ${mode} emitted no browser errors (${browserErrors.join("; ")})`);
  return { viewport: viewport.name, saved: mode, geometry, scroll };
}

try {
  browser = await playwright.chromium.launch(launchOptions);

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    outcomes.push(await verifyUploadsForViewport(page, viewport));
    await page.close();
    if (viewport.name !== "short") {
      const savedModes = viewport.name === "desktop" ? ["text", "inline", "inline-pdf"] : ["text", "inline"];
      for (const mode of savedModes) outcomes.push(await verifySavedPreview(await context.newPage(), mode, viewport));
    }
    await context.close();
  }
  const compactBoxes = (snapshot) => Object.fromEntries(["dialog", "preview", "card", "icons", "footer"].map((key) => [key, [snapshot[key].width, snapshot[key].height]]));
  const compactOutcomes = outcomes.map((outcome) => outcome.baseline
    ? {
      viewport: outcome.viewport,
      stableGeometry: true,
      boxes: compactBoxes(outcome.baseline),
      separateFilenameRows: outcome.baseline.separateFilenameRows,
      formScrollHeight: outcome.baseline.formScrollHeight,
      pdfScroll: outcome.pdfScroll,
      textScroll: outcome.textScroll,
    }
    : {
      viewport: outcome.viewport,
      saved: outcome.saved,
      boxes: compactBoxes(outcome.geometry),
      ...(outcome.dimensions ? { nestedPdf: outcome.dimensions } : {}),
      scroll: outcome.scroll,
    });
  console.log(JSON.stringify({
    worker: basename(workers[0].path),
    workerBytes: workerBytes.length,
    viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
    outcomes: compactOutcomes,
    screenshots: ["/tmp/class-syllabus-desktop.png", "/tmp/class-syllabus-mobile.png"],
  }, null, 2));
} finally {
  await browser?.close();
}
