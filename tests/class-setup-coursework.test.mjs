import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<button id="opener">Add class</button><div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLTextAreaElement", "FileReader"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ClassSetup } = await import(await clientModule("app/class-setup.tsx"));
const { emptyCourse } = await import(await clientModule("lib/academics.ts"));
const host = document.getElementById("root");
let root;
let saved;
let calls;

async function mount(overrides = {}) {
  saved = undefined;
  calls = 0;
  root = createRoot(host);
  await act(async () => root.render(createElement(ClassSetup, {
    initial: { ...emptyCourse("bio"), code: "BIO 101", name: "Biology" },
    today: "2026-10-26", canUpload: true,
    onSave: async (...args) => { calls++; saved = args; }, onClose() {},
    ...overrides,
  })));
}
const button = (text) => [...host.querySelectorAll("button")].find((node) => node.textContent.trim() === text || node.getAttribute("aria-label") === text);
async function click(text) { assert.ok(button(text), `Missing button ${text}`); await act(async () => button(text).click()); }
async function submit() { await act(async () => host.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); }
async function change(label, value) {
  const node = [...host.querySelectorAll("label")].find((item) => item.textContent.trim() === label)?.control ?? host.querySelector(`[aria-label="${label}"]`);
  assert.ok(node, `Missing field ${label}`);
  const prototype = node.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
    node.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
async function toCoursework() { await submit(); await click("Monday"); await submit(); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; host.replaceChildren(); });

test("ClassSetup steps are Info, Schedule, Coursework, Customize", async () => {
  await mount();
  assert.deepEqual([...host.querySelectorAll(".class-setup-step-label")].map((node) => node.textContent), ["Info", "Schedule", "Coursework", "Customize"]);
  await toCoursework();
  assert.equal(host.querySelector("h2").textContent, "Categories & tasks");
});

test("the modal recovers keyboard focus when it is outside the form", async () => {
  await mount();
  const controls = [...host.querySelectorAll('button:not(:disabled), input:not(:disabled):not(.class-setup-hidden-input), select:not(:disabled), textarea:not(:disabled), iframe, a[href], [tabindex="0"]')];
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    for (const shiftKey of [false, true]) {
      outside.focus();
      const event = new window.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(document.activeElement, shiftKey ? controls.at(-1) : controls[0]);
    }
  } finally {
    outside.remove();
  }
});

test("task and category drafts are saved as the fourth argument and in course details", async () => {
  await mount(); await toCoursework();
  await click("Add category");
  const categoryFields = () => host.querySelectorAll(".class-coursework-category-editor input");
  await change("New category name", "Labs");
  const categoryWeight = categoryFields()[1];
  assert.ok(categoryWeight, "category weight control renders");
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(categoryWeight, "25"); categoryWeight.dispatchEvent(new window.Event("input", { bubbles: true })); categoryWeight.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await act(async () => host.querySelector('[data-coursework-focus="all"]').click());
  await click("Add task");
  await change("Task title", "Microscope lab");
  const categorySelect = host.querySelectorAll(".class-coursework-editor select")[1];
  assert.ok(categorySelect);
  await act(async () => { categorySelect.value = categorySelect.querySelector('option:not([value=""])').value; categorySelect.dispatchEvent(new window.Event("change", { bubbles: true })); });
  assert.equal(calls, 0, "Continue does not save");
  await submit();
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
  assert.equal(calls, 0, "moving to Customize does not save");
  await submit();
  assert.equal(calls, 1);
  assert.equal(saved.length, 4);
  assert.deepEqual(saved[1].gradingCategories.map(({ name, weight }) => ({ name, weight })), [{ name: "Labs", weight: 25 }]);
  assert.equal(saved[3].length, 1);
  assert.equal(saved[3][0].title, "Microscope lab");
  assert.equal(saved[3][0].categoryId, saved[1].gradingCategories[0].id);
});

test("Back from Customize retains coursework task and category drafts", async () => {
  await mount(); await toCoursework(); await click("Add category"); await change("New category name", "Labs");
  await click("Add task"); await change("Task title", "Reading quiz"); await submit();
  await click("Back");
  assert.equal(host.querySelector("h2").textContent, "Categories & tasks");
  await act(async () => host.querySelector(".class-coursework-task-title").click());
  assert.equal([...host.querySelectorAll("label")].find((item) => item.textContent.trim() === "Task title").control.value, "Reading quiz");
  assert.match(host.querySelector(".class-coursework-category-select").textContent, /Labs/);
});

test("an untitled task blocks Continue and returns focus to Coursework", async () => {
  await mount(); await toCoursework(); await click("Add task"); await submit();
  assert.equal(host.querySelector("h2").textContent, "Categories & tasks");
  assert.ok([...host.querySelectorAll("label")].find((item) => item.textContent.trim() === "Task title").control.matches('[aria-invalid="true"]'));
  assert.equal(host.querySelector('[role="alert"]')?.textContent, "Enter a title for each task before continuing.");
  assert.equal(calls, 0);
});

test("completed but ungraded is distinct from zero earned points", async () => {
  const task = { id: "quiz", title: "Quiz", courseId: "bio", due: "", dateKey: "", status: "done", progress: 100, description: "", weight: "", pointsPossible: 10, pointsEarned: null };
  await mount({ initialAssignments: [task] }); await toCoursework();
  await act(async () => host.querySelector(".class-coursework-task-title").click());
  const grade = host.querySelector(".class-coursework-grade-check input");
  assert.ok(grade);
  assert.equal(grade.checked, false);
  assert.equal(host.querySelectorAll('.class-coursework-editor label input[type="number"]').length, 1, "ungraded tasks do not show a score input");
  await act(async () => grade.click());
  assert.equal(grade.checked, true);
  const earned = [...host.querySelectorAll(".class-coursework-editor label")].find((item) => item.textContent.trim() === "Points earned")?.querySelector("input");
  assert.ok(earned);
  assert.equal(Number.isNaN(earned.valueAsNumber), true);
  await submit();
  assert.equal(host.querySelector("h2").textContent, "Categories & tasks");
  assert.match(host.querySelector('[role="alert"]').textContent, /points earned/i);
  await change("Points earned", "0");
  assert.equal(earned.value, "0");
  await submit();
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
});

test("task-only changes trigger the unsaved-changes guard", async () => {
  const originalConfirm = window.confirm;
  let confirms = 0;
  window.confirm = () => { confirms++; return false; };
  try {
    await mount(); await toCoursework(); await click("Add task"); await change("Task title", "Draft only");
    await click("Close class setup");
    assert.equal(confirms, 1);
    assert.equal(host.querySelector("h2").textContent, "Categories & tasks");
    assert.equal(calls, 0);
  } finally { window.confirm = originalConfirm; }
});

test("Edit Class initializes saved tasks and allows direct Coursework navigation", async () => {
  const task = { id: "saved-task", title: "Saved exam", courseId: "bio", due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "", type: "Exam" };
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "exam", name: "Exams", weight: 100 }] }, initialAssignments: [task] });
  await click("Go to Coursework");
  assert.equal(host.querySelector("h2").textContent, "Categories & tasks");
  assert.ok(host.textContent.includes("Saved exam"));
});

test("save errors preserve coursework drafts for retry", async () => {
  let attempts = 0;
  await mount({ onSave: async (...args) => { calls++; attempts++; saved = args; if (attempts === 1) throw new Error("Temporary save failure"); } });
  await toCoursework(); await click("Add task"); await change("Task title", "Retryable task");
  await submit(); await submit();
  assert.equal(calls, 1);
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
  await submit();
  assert.equal(calls, 2);
  assert.equal(saved[3][0].title, "Retryable task");
});

test("validation reveals a collapsed category editor and focuses its invalid field", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "labs", name: "Labs", weight: 100 }] } });
  await click("Go to Coursework");
  await act(async () => host.querySelector(".class-coursework-category-select").click());
  await click("Edit Labs category");
  await change("Labs name", "");
  await click("Done editing category");
  assert.equal(host.querySelector(".class-coursework-category-editor"), null);
  await submit();
  const field = host.querySelector('[data-category-name="labs"]');
  assert.ok(field);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, field);
  assert.equal(calls, 0);
});
