import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { clientModule } from "../tests/helpers/client-modules.mjs";

// Uses the actual component and CSS with a disposable account fixture.
// PLAYWRIGHT_MODULE and CHROME_EXECUTABLE can point to an external browser runtime.
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import("playwright");
const dom = new JSDOM('<div id="root"></div>', { url: "https://onboarding.example.invalid/home" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
let writes = 0;
globalThis.fetch = async (_url, options) => {
  if (options?.method && options.method !== "GET") writes++;
  return Response.json({ schools: [] });
};
const [{ createElement, act }, { createRoot }, { default: Flow }, { validateProfile }] = await Promise.all([
  import("react"), import("react-dom/client"), import(await clientModule("app/onboarding-flow.tsx")),
  import(await clientModule("lib/profile.ts")),
]);
const profile = {
  ...validateProfile({ display_name: "Saved Person", university: "Saved University" }),
  id: "preview-profile", auth_user_id: "preview-user", email: "preview@example.invalid",
  avatar_url: null, onboarding_completed_at: "2026-10-08T00:00:00Z", initialized: true,
  updated_at: "2026-10-08T00:00:00Z",
};
const root = createRoot(document.getElementById("root"));
const output = resolve(".vinext/verify-onboarding");
await mkdir(output, { recursive: true });
const css = (await Promise.all(["app/globals.css", "app/onboarding-flow.css"].map((file) => readFile(file, "utf8")))).join("\n");
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: "chrome" }),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const captures = [];
async function click(label) {
  const button = [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === label);
  assert.ok(button, `Button ${label} exists`);
  assert.equal(button.disabled, false, `Button ${label} is enabled`);
  await act(async () => button.click());
}
async function capture(name, theme = "dark", width = 1440) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  // React's select value is a DOM property; serialize it into the screenshot fixture.
  for (const select of document.querySelectorAll("select")) {
    for (const option of select.options) option.toggleAttribute("selected", option.value === select.value);
  }
  await page.setContent(`<html data-theme="${theme}" data-motion="reduced"><head><style>${css}\n:root { --font-geist-sans: "Segoe UI"; color-scheme: ${theme}; }</style></head><body>${document.body.innerHTML}</body></html>`);
  assert.ok(await page.locator(".ee-onboarding").isVisible());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, `${name}: no horizontal overflow`);
  const exit = page.getByRole("button", { name: "Exit onboarding test" });
  const box = await exit.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width, `${name}: exit is visible`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  captures.push(name);
}
try {
  await act(async () => root.render(createElement(Flow, { initialProfile: profile, preview: true, onExit() {} })));
  assert.equal(document.querySelector("input").value, "", "Preview starts blank");
  await capture("about-dark");
  await capture("about-light", "light");
  await capture("about-phone", "dark", 390);
  await click("Continue");
  await click("CollegeCollege or university");
  await capture("school-dark");
  await click("Continue");
  await capture("location-phone", "dark", 390);
  await act(async () => new Promise((done) => setTimeout(done, 2050)));
  await click("Continue");
  await capture("major-dark");
  await click("Continue");
  const input = document.querySelector('input[inputmode="numeric"]');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setValue.call(input, "2030");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await capture("graduation-dark");
  await capture("graduation-phone", "dark", 390);
  await click("Continue");
  await capture("syllabus-dark");
  await click("Finish preview");
  await capture("complete-phone", "dark", 390);
  assert.equal(writes, 0, "Preview never sends mutations");
  console.log(JSON.stringify({ result: "PASS", screenshots: captures.map((name) => resolve(output, `${name}.png`)), writes }, null, 2));
} finally {
  await act(async () => root.unmount());
  await browser.close();
  dom.window.close();
}
