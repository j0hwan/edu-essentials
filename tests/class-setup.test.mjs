import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<button id="opener">Add class</button><div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLTextAreaElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ClassSetup } = await import(await clientModule("app/class-setup.tsx"));
const { default: AcademicEditor } = await import(await clientModule("app/academic-editor.tsx"));
const { emptyCourse } = await import(await clientModule("lib/academics.ts"));
const host = document.getElementById("root");
let root;
let saved;
let calls;
let closed;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => "blob:class-cover";
URL.revokeObjectURL = () => {};

async function mount(overrides = {}) {
  saved = undefined; calls = 0; closed = 0;
  document.getElementById("opener").focus();
  root = createRoot(host);
  await act(async () => root.render(createElement(ClassSetup, {
    initial: { ...emptyCourse("new-course"), code: "BIO 101", name: "Biology" }, today: "2026-10-26", canUpload: true,
    onSave: async (...args) => { calls++; saved = args; }, onClose: () => { closed++; }, ...overrides,
  })));
}
const button = (text) => [...host.querySelectorAll("button")].find((node) => node.textContent === text || node.getAttribute("aria-label") === text);
async function click(text) { assert.ok(button(text), `Missing button ${text}`); await act(async () => button(text).click()); }
async function submit() { await act(async () => host.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); }
async function change(label, value) {
  const node = [...host.querySelectorAll("label")].find((item) => item.textContent.replace(/\s*\*$/, "").trim() === label)?.querySelector("input,textarea");
  assert.ok(node, `Missing field ${label}`);
  const prototype = node.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
    node.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
async function appearance() { await submit(); await click("Monday"); await submit(); }
async function file(kind, value) {
  const input = host.querySelectorAll('input[type="file"]')[kind === "image" ? 0 : 1];
  Object.defineProperty(input, "files", { configurable: true, value: [value] });
  await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; });
after(() => { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; dom.window.close(); });

test("required fields have visible asterisks and setup omits the removed introductory copy", async () => {
  await mount();
  const removedCopy = /NEW CLASS|Start with the essentials|Meeting times use your saved time zone|Add holidays, breaks|Give your class a look of its own/;
  const verifyLabels = () => {
    assert.doesNotMatch(host.textContent, removedCopy);
    for (const input of host.querySelectorAll("input")) {
      const marker = input.closest("label")?.querySelector('[aria-hidden="true"]');
      assert.equal(Boolean(marker), input.required, `${input.closest("label")?.textContent} marks only required inputs`);
      if (marker) assert.equal(marker.textContent.trim(), "*");
    }
  };
  verifyLabels();
  assert.deepEqual([...host.querySelectorAll("input:required")].map((input) => input.closest("label").textContent.trim()), ["Course code *", "Class name *"]);
  await submit(); verifyLabels();
  assert.match(host.querySelector(".class-setup-week-label").textContent, /Meeting days \*/);
  await click("Monday"); await click("Add exception"); verifyLabels();
  await change("Exception date 1", "2026-11-02");
  await submit(); verifyLabels();
  assert.match(host.textContent, /Storage only/);
});

test("larger progress replaces the visible title and preserves accessible step names and completed states", async () => {
  await mount();
  const header = host.querySelector(".class-setup-header");
  const progress = header.querySelector(".class-setup-progress");
  assert.equal(header.children.length, 2);
  assert.equal(header.children[0], progress);
  assert.equal(header.children[1], button("Close class setup"));
  assert.equal(header.querySelector("h2"), null);
  const accessibleTitle = host.querySelector(".class-setup-accessible-title");
  assert.equal(host.querySelector('[role="dialog"]').getAttribute("aria-labelledby"), accessibleTitle.id);
  assert.equal(accessibleTitle.textContent, "Course information");
  assert.equal(host.querySelectorAll(".class-setup-progress").length, 1);
  assert.deepEqual([...progress.querySelectorAll("li > span")].map((node) => node.textContent), ["Info", "Schedule", "Customize"]);
  assert.equal(progress.querySelectorAll(".class-setup-step-separator").length, 2);
  assert.equal(progress.querySelector(".class-setup-step-separator").getAttribute("width"), "18");
  assert.equal(progress.querySelector('[aria-current="step"]').getAttribute("aria-label"), "Course information");
  assert.equal(progress.querySelectorAll(".is-complete").length, 0);
  await submit();
  assert.equal(progress.querySelector('[aria-current="step"]').getAttribute("aria-label"), "Class schedule");
  assert.equal(progress.querySelectorAll(".is-complete").length, 1);
  assert.ok(progress.querySelector(".is-complete svg"));
  await click("Monday"); await submit();
  assert.equal(progress.querySelector('[aria-current="step"]').getAttribute("aria-label"), "Make it yours");
  assert.equal(progress.querySelectorAll(".is-complete").length, 2);
  await click("Back");
  assert.equal(progress.querySelectorAll(".is-complete").length, 1);
});

test("manual setup separates information, seven-day schedule, and appearance; Back preserves fields", async () => {
  await mount();
  assert.equal(host.querySelector("h2").textContent, "Course information");
  assert.ok(host.textContent.includes("Office hours (Zoom link, location, etc.)"));
  assert.equal(host.querySelector('input[type="color"]'), null);
  await change("Instructor", "Dr. Moss");
  await change("Office hours (Zoom link, location, etc.)", "Tuesday · Zoom");
  await submit();
  assert.equal(calls, 0);
  assert.equal(host.querySelectorAll(".class-setup-week button").length, 7);
  await click("Monday"); await click("Wednesday");
  await click("Add exception"); await change("Exception date 1", "2026-11-02");
  await submit();
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
  assert.equal(calls, 0);
  await click("Biology"); await change("Class color", "#b23b53");
  await click("Back");
  assert.equal(button("Wednesday").getAttribute("aria-pressed"), "true");
  await click("Back");
  assert.equal(host.querySelectorAll("input")[3].value, "Dr. Moss");
  await submit(); await submit(); await submit();
  assert.equal(calls, 1);
  assert.equal(saved[0].color, "#b23b53");
  assert.equal(saved[0].soft, "#b23b5318");
  assert.equal(saved[1].officeHours, "Tuesday · Zoom");
  assert.deepEqual(saved[1].meetings[0].days, [1, 3]);
  assert.deepEqual(saved[1].meetings[0].excludedDates, ["2026-11-02"]);
});

test("schedule validation blocks advancement, and asynchronous classes can remove meetings", async () => {
  await mount(); await submit(); await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /weekdays/);
  assert.equal(host.querySelector("h2").textContent, "Class schedule");
  await click("Monday"); await change("End time", "08:00"); await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /end must be after/);
  await click("Remove meeting 1"); await submit(); await submit();
  assert.deepEqual(saved[1].meetings, []);
});

test("syllabus and image stay local until final save; syllabus is storage-only and retry IDs are stable", async () => {
  let attempts = 0;
  const payloads = [];
  await mount({ onSave: async (...args) => { attempts++; payloads.push(args); if (attempts === 1) throw new Error("Upload failed; retry"); } });
  await appearance();
  const syllabus = new window.File(["Exam 2026-11-05"], "syllabus.txt", { type: "text/plain" });
  const image = new window.File(["image"], "biology.png", { type: "image/png" });
  await file("syllabus", syllabus); await file("image", image);
  assert.equal(attempts, 0);
  assert.match(host.querySelector('[aria-label="Selected class cover"]').style.backgroundImage, /blob:class-cover/);
  await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /Upload failed/);
  assert.equal(button("Remove image").matches(":disabled"), true);
  assert.equal(button("Remove syllabus").matches(":disabled"), true);
  await submit();
  assert.equal(attempts, 2);
  assert.equal(payloads[0][2].syllabus.id, payloads[1][2].syllabus.id);
  assert.equal(payloads[0][2].image.file, image);
  assert.equal(payloads[0][2].syllabus.file, syllabus);
  assert.equal(payloads[0][1].syllabusText, undefined);
  assert.equal(payloads[0][1].meetings.length, 1);
  assert.match(host.textContent, /Storage only/);
});

test("invalid files are rejected and unavailable uploads do not block class creation", async () => {
  await mount(); await appearance();
  await file("image", new window.File(["bad"], "image.svg", { type: "image/svg+xml" }));
  assert.match(host.querySelector('[role="alert"]').textContent, /PNG, JPEG/);
  await submit(); assert.equal(saved[2].image, undefined);
  await act(async () => root.unmount()); root = undefined;
  await mount({ canUpload: false }); await appearance();
  assert.ok([...host.querySelectorAll('input[type="file"]')].every((node) => node.disabled));
  await submit(); assert.equal(calls, 1);
});

test("saving locks navigation and duplicate submissions; focus returns to the opener", async () => {
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  await mount({ onSave: () => { calls++; return pending; } }); await appearance();
  await act(async () => { host.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
  assert.equal(button("Back").disabled, true);
  assert.equal(button("Close class setup").disabled, true);
  await submit(); assert.equal(calls, 1);
  await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(closed, 0);
  await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, host.querySelector("form"));
  await act(async () => resolveSave());
  await act(async () => root.unmount()); root = undefined;
  assert.equal(document.activeElement.id, "opener");
});

test("existing class edits can remove exceptions when the semester range changes", async () => {
  root = createRoot(host);
  let applied;
  await act(async () => root.render(createElement(AcademicEditor, {
    initial: { course: { ...emptyCourse("saved"), code: "BIO 101", name: "Biology" }, details: { officeHours: "", meetings: [{ id: "meeting", days: [1], start: "09:00", end: "10:00", from: "2026-10-26", until: "2026-12-15", location: "", excludedDates: ["2026-12-01"] }] } },
    courses: [], today: "2026-10-26", onApply: (value) => { applied = value; return true; }, onClose() {},
  })));
  await change("Last date", "2026-11-30"); await submit();
  assert.match(host.querySelector('[role="alert"]').textContent, /excluded dates/);
  await click("Remove exception 1"); await submit();
  assert.equal(applied.details.meetings[0].until, "2026-11-30");
  assert.deepEqual(applied.details.meetings[0].excludedDates, []);
});
