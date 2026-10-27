import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const esbuild = process.env.ESBUILD_MODULE
  ? await import(pathToFileURL(resolve(process.env.ESBUILD_MODULE)).href)
  : await import("esbuild");
const [globalCss, authCss, locationCss] = await Promise.all([
  "app/globals.css", "app/auth.css", "app/location-input.css",
].map((file) => readFile(resolve(repoRoot, file), "utf8")));
const bundle = await esbuild.build({
  entryPoints: [resolve(repoRoot, "tests/fixtures/location-input-browser.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = bundle.outputFiles[0].text;
const css = [globalCss, authCss, locationCss]
  .map((source) => source.replace(/^@import[^;]+;\s*/gm, ""))
  .join("\n");
const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><base href="https://edu.example/"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { --font-geist-sans: Arial, sans-serif; }${css}.location-browser-fixture { width: min(850px, 94vw); margin: 24px auto; background: var(--surface); }</style></head><body><div id="root"></div></body></html>`;
const suggestions = [
  { id: "san-francisco", address: "San Francisco, CA" },
  { id: "san-jose", address: "San Jose, CA" },
];
const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
else launchOptions.channel = "chrome";
let browser;
const browserErrors = [];

async function visualMetrics(input) {
  return input.evaluate((element) => {
    const field = element.closest(".location-field");
    const label = element.labels?.[0] ?? field?.querySelector("label");
    const textWalker = document.createTreeWalker(label ?? field, NodeFilter.SHOW_TEXT);
    let locationText = null;
    while (textWalker.nextNode()) {
      const node = textWalker.currentNode;
      if (node.textContent?.includes("Location")) { locationText = node; break; }
    }
    let labelText = null;
    if (locationText) {
      const range = document.createRange();
      range.selectNodeContents(locationText);
      labelText = range.getBoundingClientRect().toJSON();
    }
    const rect = (node) => node ? node.getBoundingClientRect().toJSON() : null;
    const style = getComputedStyle(element);
    return {
      input: rect(element),
      field: rect(field),
      label: rect(label),
      labelText,
      typography: {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        padding: style.padding,
      },
      outerLabelTypography: label ? {
        fontFamily: getComputedStyle(label).fontFamily,
        fontSize: getComputedStyle(label).fontSize,
        fontWeight: getComputedStyle(label).fontWeight,
        lineHeight: getComputedStyle(label).lineHeight,
      } : null,
    };
  });
}

try {
  browser = await playwright.chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
  await page.setContent(html);
  await page.evaluate((seedSuggestions) => {
    let releaseDelayedResponse;
    const state = {
      delayedRequestSeen: false,
      releaseDelayedResponse() { releaseDelayedResponse?.(); },
    };
    window.__locationBrowser = state;
    window.fetch = async (input) => {
      const query = new URL(String(input), "https://edu.example/").searchParams.get("q") ?? "";
      if (query === "Oakland Campus") {
        state.delayedRequestSeen = true;
        await new Promise((resolvePromise) => { releaseDelayedResponse = resolvePromise; });
      }
      return Response.json({ locations: seedSuggestions });
    };
  }, suggestions);
  await page.addScriptTag({ content: js });
  const input = page.getByRole("combobox", { name: "Location" });
  const listbox = page.getByRole("listbox", { name: "Address suggestions" });
  assert.equal(await input.count(), 1, "Location has an accessible combobox name");
  const inputStyle = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, padding: style.padding };
  });
  assert.deepEqual(inputStyle, { fontSize: "14px", fontWeight: "650", lineHeight: "20.3px", padding: "10px" }, "input typography and padding match its original styling");
  const originalVisuals = await visualMetrics(input);
  console.log(`Location input styles and bounds: ${JSON.stringify(originalVisuals)}`);

  await page.getByText("Location", { exact: true }).click();
  assert.equal(await input.evaluate((element) => document.activeElement === element), true, "the visible Location label focuses its associated input");
  await input.fill("San Francisco");
  await listbox.waitFor({ state: "visible" });
  const openedGeometry = await page.evaluate(() => {
    const input = document.querySelector('[role="combobox"]');
    const listbox = document.querySelector('[role="listbox"]');
    const inputRect = input.getBoundingClientRect();
    const listRect = listbox.getBoundingClientRect();
    return { inputBottom: inputRect.bottom, listTop: listRect.top, gap: listRect.top - inputRect.bottom };
  });
  console.log(`Open dropdown anchor: ${JSON.stringify(openedGeometry)}`);

  const gapInteraction = await page.evaluate(() => {
    const input = document.querySelector('[role="combobox"]');
    const field = input.closest(".location-field");
    const label = input.labels?.[0] ?? field.querySelector("label");
    const walker = document.createTreeWalker(label ?? field, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) if (walker.currentNode.textContent?.includes("Location")) { node = walker.currentNode; break; }
    const range = document.createRange();
    range.selectNodeContents(node);
    const textRect = range.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const x = inputRect.left + Math.min(16, inputRect.width / 3);
    const y = (textRect.bottom + inputRect.top) / 2;
    const target = document.elementFromPoint(x, y);
    window.__locationGapEvents = [];
    input.addEventListener("focus", () => window.__locationGapEvents.push("focus"));
    input.addEventListener("blur", () => window.__locationGapEvents.push("blur"));
    const observer = new MutationObserver(() => window.__locationGapEvents.push(`listbox:${!document.querySelector('[role="listbox"]').hidden}`));
    observer.observe(document.querySelector('[role="listbox"]'), { attributes: true, attributeFilter: ["hidden"] });
    return {
      x, y, textRect: textRect.toJSON(), inputRect: inputRect.toJSON(),
      hitTag: target?.tagName, hitLabel: Boolean(target?.closest("label")),
      hitInput: target === input,
    };
  });
  await page.mouse.click(gapInteraction.x, gapInteraction.y);
  await page.waitForTimeout(80);
  const gapResult = await page.evaluate(() => {
    const input = document.querySelector('[role="combobox"]');
    return {
      activeElement: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
      expanded: input.getAttribute("aria-expanded"),
      focused: document.activeElement === input,
      events: window.__locationGapEvents,
    };
  });
  console.log(`Adjacent label gap click: ${JSON.stringify({ ...gapInteraction, ...gapResult })}`);

  assert.equal(gapInteraction.hitLabel, false, "the visual gap between label and input is outside the label hit target");
  assert.equal(gapResult.focused, false, "clicking the visual gap blurs the input");
  assert.deepEqual(gapResult.events, ["blur", "listbox:false"], "gap click closes suggestions once without label refocus");
  assert.equal(await listbox.isHidden(), true, "clicking the visual gap between Location and its input dismisses suggestions");
  assert.ok(Math.abs(openedGeometry.gap) <= 1, `suggestion list is anchored directly below the input (${JSON.stringify(openedGeometry)})`);

  await input.click();
  await listbox.waitFor({ state: "visible" });
  await page.mouse.click(8, 8);
  await listbox.waitFor({ state: "hidden" });
  assert.equal(await input.evaluate((element) => document.activeElement === element), false, "clicking outside the editor leaves suggestions dismissed");
  await input.click();
  await listbox.waitFor({ state: "visible" });
  await page.getByRole("option", { name: "San Jose, CA" }).click();
  assert.equal(await input.inputValue(), "San Jose, CA", "mouse selection stores the chosen address");
  await listbox.waitFor({ state: "hidden" });

  await input.fill("San Francisco");
  await listbox.waitFor({ state: "visible" });
  await input.press("ArrowDown");
  await input.press("Enter");
  assert.equal(await input.inputValue(), "San Francisco, CA", "ArrowDown and Enter select an address");
  await listbox.waitFor({ state: "hidden" });

  await input.fill("Oakland Campus");
  await page.waitForFunction(() => window.__locationBrowser?.delayedRequestSeen === true);
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.getAttribute("aria-busy") === "true");
  await page.locator(".location-loading-spinner").waitFor({ state: "visible" });
  const loadingVisuals = await visualMetrics(input);
  const spinnerBounds = await page.locator(".location-loading-spinner").boundingBox();
  assert.ok(spinnerBounds.x >= loadingVisuals.labelText.right, "the loading circle sits beside the label text");
  assert.ok(spinnerBounds.y >= loadingVisuals.label.top && spinnerBounds.y + spinnerBounds.height <= loadingVisuals.label.bottom, "the loading circle stays within the label line");
  for (const key of ["field", "input", "label", "labelText"]) {
    assert.deepEqual(loadingVisuals[key], originalVisuals[key], `${key} does not move or resize when searching starts`);
  }
  assert.equal(await page.locator(".location-field > small").innerText(), "", "search progress does not add a visible text row");
  await page.getByRole("textbox", { name: "Office hours" }).click();
  await listbox.waitFor({ state: "hidden" });
  await page.evaluate(() => window.__locationBrowser?.releaseDelayedResponse());
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.getAttribute("aria-busy") !== "true");
  await page.locator(".location-loading-spinner").waitFor({ state: "hidden" });
  const completedVisuals = await visualMetrics(input);
  for (const key of ["field", "input", "label", "labelText"]) {
    assert.deepEqual(completedVisuals[key], originalVisuals[key], `${key} does not move or resize when searching finishes`);
  }
  assert.equal(await listbox.isHidden(), true, "a response arriving after blur does not reopen suggestions");
  assert.equal(await page.getByRole("textbox", { name: "Office hours" }).evaluate((element) => document.activeElement === element), true);
  assert.deepEqual(browserErrors, [], `browser emitted no errors: ${browserErrors.join("; ")}`);
  console.log("LocationInput browser verification passed.");
} finally {
  if (browser) await browser.close();
}
