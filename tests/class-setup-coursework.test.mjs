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
  if (node.getAttribute("contenteditable") === "plaintext-only") {
    await act(async () => { node.textContent = value; node.dispatchEvent(new window.Event("input", { bubbles: true })); });
    await act(async () => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    return;
  }
  const prototype = node.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
    node.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
async function toCoursework() { await submit(); await click("Monday"); await submit(); }
async function toAssignments() { await toCoursework(); await change("Assignments weight", "100"); await submit(); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; host.replaceChildren(); });

test("ClassSetup separates categories and optional assignments into five steps", async () => {
  await mount();
  assert.deepEqual([...host.querySelectorAll(".class-setup-step-label")].map((node) => node.textContent), ["Info", "Schedule", "Categories", "Assignments", "Customize"]);
  await toCoursework();
  assert.equal(host.querySelector("h2").textContent, "Set up your coursework");
  assert.deepEqual([...host.querySelectorAll("[data-category-name]")].map((input) => input.value), ["Assignments", "Exam", "Attendance"]);
  assert.deepEqual([...host.querySelectorAll('.class-grading-weight input')].map((input) => input.value), ["0", "0", "0"]);
});

test("manual setup flags incomplete allocation on Continue and clears it on a weight edit", async () => {
  await mount(); await toCoursework();
  const continueButton = button("Continue");
  const allocation = host.querySelector(".class-grading-allocation");
  const status = allocation.querySelector("output");
  const marker = allocation.querySelector(".class-setup-required");
  const meter = allocation.querySelector('[role="meter"]');
  assert.equal(marker.textContent.trim(), "*");
  assert.equal(continueButton.disabled, false);
  assert.equal(button("Go to Assignments").disabled, true);
  assert.equal(status.textContent, "100% remaining");

  await change("Exam weight", "1");
  for (const [weight, expected, overAllocated] of [["100", "-1% remaining", true], ["24", "75% remaining", false]]) {
    await change("Assignments weight", weight);
    assert.equal(status.textContent, expected);
    assert.equal(marker.matches(".is-missing"), false);
    assert.equal(status.matches(".is-invalid"), overAllocated);
    assert.equal(meter.matches(".is-invalid"), overAllocated);
    assert.equal(host.querySelector('[role="alert"]'), null);
  }

  await click("Continue");
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(host.querySelector("h2").textContent, "Set up your coursework");
  assert.ok(marker.matches(".is-missing"));
  assert.ok(status.matches(".is-invalid"));
  assert.ok(meter.matches(".is-invalid"));
  assert.equal(continueButton.disabled, false);

  await change("Category name 3", "Participation");
  assert.ok(marker.matches(".is-missing"));

  await change("Assignments weight", "25");
  assert.equal(status.textContent, "74% remaining");
  assert.equal(marker.matches(".is-missing"), false);
  assert.equal(status.matches(".is-invalid"), false);
  assert.equal(meter.matches(".is-invalid"), false);

  await change("Assignments weight", "100");
  assert.equal(status.textContent, "-1% remaining");
  assert.equal(marker.matches(".is-missing"), false);
  assert.ok(status.matches(".is-invalid"));
  assert.ok(meter.matches(".is-invalid"));
  await submit();
  assert.equal(host.querySelector("h2").textContent, "Set up your coursework");
  assert.ok(marker.matches(".is-missing"));

  await change("Assignments weight", "99");
  assert.ok(status.matches(".is-complete"));
  assert.equal(marker.matches(".is-missing"), false);
  assert.equal(continueButton.disabled, false);
  await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
  assert.equal(calls, 0);
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

test("deleted default categories stay deleted through back navigation and save", async () => {
  await mount(); await toCoursework();
  for (const name of ["Assignments", "Exam", "Attendance"]) await click(`Remove ${name} category`);
  await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Set up your coursework");
  await click("Back"); await submit();
  assert.equal(host.querySelectorAll("[data-category-name]").length, 0);
  await click("Add category"); await change("New category weight", "100");
  await submit(); await submit(); await submit();
  assert.deepEqual(saved[1].gradingCategories.map(({ name, weight }) => ({ name, weight })), [{ name: "New category", weight: 100 }]);
});

test("editing a class with no categories preserves its empty grading setup", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [] } });
  await click("Go to Categories");
  assert.equal(host.querySelectorAll("[data-category-name]").length, 0);
  await click("Go to Customize"); await submit();
  assert.deepEqual(saved[1].gradingCategories, []);
});

test("task and category drafts are saved as the fourth argument and in course details", async () => {
  await mount(); await toCoursework();
  await change("Category name 1", "Labs");
  const categoryWeight = host.querySelector('[aria-label="Labs weight"]');
  assert.ok(categoryWeight, "category weight control renders");
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(categoryWeight, "25"); categoryWeight.dispatchEvent(new window.Event("input", { bubbles: true })); categoryWeight.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await change("Exam weight", "75");
  await submit();
  await click("Add assignment");
  await change("Assignment title", "Microscope lab");
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
  assert.deepEqual(saved[1].gradingCategories.map(({ name, weight }) => ({ name, weight })), [{ name: "Labs", weight: 25 }, { name: "Exam", weight: 75 }, { name: "Attendance", weight: 0 }]);
  assert.equal(saved[3].length, 1);
  assert.equal(saved[3][0].title, "Microscope lab");
  assert.equal(saved[3][0].categoryId, saved[1].gradingCategories[0].id);
});

test("Back from Customize retains coursework task and category drafts", async () => {
  await mount(); await toCoursework(); await change("Category name 1", "Labs"); await change("Labs weight", "100"); await submit();
  await click("Add assignment"); await change("Assignment title", "Reading quiz"); await submit();
  await click("Back");
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
  await act(async () => host.querySelector(".class-coursework-task-title").click());
  assert.equal([...host.querySelectorAll("label")].find((item) => item.textContent.trim() === "Assignment title").control.value, "Reading quiz");
  assert.match(host.querySelector(".class-coursework-pills").textContent, /Labs/);
});

test("an untitled assignment blocks Continue on the assignments step", async () => {
  await mount(); await toAssignments(); await click("Add assignment"); await submit();
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
  assert.ok([...host.querySelectorAll("label")].find((item) => item.textContent.trim() === "Assignment title").control.matches('[aria-invalid="true"]'));
  assert.equal(host.querySelector('[role="alert"]')?.textContent, "Enter a title for each assignment before continuing.");
  assert.equal(calls, 0);
});

test("completed but ungraded is distinct from zero earned points", async () => {
  const task = { id: "quiz", title: "Quiz", courseId: "bio", due: "", dateKey: "", status: "done", progress: 100, description: "", weight: "", pointsPossible: 10, pointsEarned: null };
  await mount({ initialAssignments: [task] }); await toAssignments();
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
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
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
    await mount(); await toAssignments(); await click("Add assignment"); await change("Assignment title", "Draft only");
    await click("Close class setup");
    assert.equal(confirms, 1);
    assert.equal(host.querySelector("h2").textContent, "Add assignments");
    assert.equal(calls, 0);
  } finally { window.confirm = originalConfirm; }
});

test("Edit Class initializes saved assignments and allows direct assignment navigation", async () => {
  const task = { id: "saved-task", title: "Saved exam", courseId: "bio", due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "", type: "Exam" };
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "exam", name: "Exams", weight: 100 }] }, initialAssignments: [task] });
  await click("Go to Assignments");
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
  assert.ok(host.textContent.includes("Saved exam"));
});

test("saving a deleted category preserves its tasks without the removed category reference", async () => {
  const task = { id: "saved-task", title: "Saved exam", courseId: "bio", due: "", dateKey: "", status: "later", progress: 0, description: "Keep this", weight: "", type: "Exam", categoryId: "exam" };
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "exam", name: "Exams", weight: 100 }] }, initialAssignments: [task] });
  await click("Go to Categories");
  await click("Remove Exams category");
  assert.equal(host.querySelectorAll("[data-category-name]").length, 0);
  await click("Go to Assignments");
  assert.ok(host.textContent.includes("Saved exam"));
  await click("Go to Customize");
  await submit();
  assert.equal(calls, 1);
  assert.deepEqual(saved[1].gradingCategories, []);
  assert.deepEqual(saved[3], [{ ...task, categoryId: undefined }]);
});

test("save errors preserve coursework drafts for retry", async () => {
  let attempts = 0;
  await mount({ onSave: async (...args) => { calls++; attempts++; saved = args; if (attempts === 1) throw new Error("Temporary save failure"); } });
  await toAssignments(); await click("Add assignment"); await change("Assignment title", "Retryable task");
  await submit(); await submit();
  assert.equal(calls, 1);
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
  await submit();
  assert.equal(calls, 2);
  assert.equal(saved[3][0].title, "Retryable task");
});

test("clearing a category weight restores zero and saves a valid weight", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "labs", name: "Labs", weight: 100 }] } });
  await click("Go to Categories");
  await change("Labs weight", "");
  const field = host.querySelector('[aria-label="Labs weight"]');
  assert.ok(field);
  assert.equal(field.value, "0");
  assert.equal(field.getAttribute("aria-invalid"), "false");
  assert.equal(host.querySelector(".class-grading-allocation output").textContent, "100% remaining");
  await click("Go to Customize"); await submit();
  assert.equal(saved[1].gradingCategories[0].weight, 0);
});

test("category weights above 100 are capped before they enter the saved class", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "labs", name: "Labs", weight: 50 }] } });
  await click("Go to Categories");
  for (const value of ["101", "1000", "999"]) {
    await change("Labs weight", value);
    assert.equal(host.querySelector('[aria-label="Labs weight"]').value, "100");
    assert.equal(host.querySelector(".class-grading-allocation output").textContent, "0% remaining");
  }
  await click("Go to Customize"); await submit();
  assert.equal(saved[1].gradingCategories[0].weight, 100);
});

test("typing replaces zero and leading zeros are removed even when the numeric value is unchanged", async () => {
  await mount(); await toCoursework();
  const field = host.querySelector('[aria-label="Assignments weight"]');
  const key = new window.KeyboardEvent("keydown", { key: "9", bubbles: true, cancelable: true });
  await act(async () => field.dispatchEvent(key));
  assert.equal(key.defaultPrevented, true);
  assert.equal(field.value, "9");
  await change("Assignments weight", "09");
  assert.equal(field.value, "9");
  await change("Assignments weight", "092");
  assert.equal(field.value, "92");
  await change("Assignments weight", "0092");
  assert.equal(field.value, "92");
  await change("Assignments weight", "");
  assert.equal(field.value, "0");
  await act(async () => field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "2", bubbles: true, cancelable: true })));
  assert.equal(field.value, "2");
  await change("Exam weight", "98");
  await submit(); await submit(); await submit();
  assert.equal(saved[1].gradingCategories[0].weight, 2);
});

test("weight entry blocks signs, letters, decimals, and invalid pasted numbers", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "labs", name: "Labs", weight: 50 }] } });
  await click("Go to Categories");
  const field = host.querySelector('[aria-label="Labs weight"]');
  for (const key of ["+", "-", "e", "E", ".", "a"]) {
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true, `${key} is blocked`);
  }
  for (const options of [{ key: "1" }, { key: "Backspace" }, { key: "ArrowUp" }, { key: "ArrowDown" }, { key: "a", ctrlKey: true }, { key: "v", metaKey: true }]) {
    const event = new window.KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false, `${options.key} remains usable`);
  }
  for (const value of ["-5", "+5", "1e2", "25.5", "abc"]) {
    const event = new window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => value } });
    await act(async () => field.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
    assert.equal(field.value, "50");
  }
  for (const value of ["-5", "1e2", "25.5"]) {
    await change("Labs weight", value);
    assert.equal(field.value, "50", "the input change guard also rejects non-digit formats");
  }
});

test("duplicate category validation focuses the category name for correction", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "labs", name: "Labs", weight: 50 }, { id: "exam", name: "Exams", weight: 50 }] } });
  await click("Go to Categories");
  await change("Category name 1", "Exams");
  await submit();
  const field = host.querySelector('[aria-label="Category name 1"]');
  assert.ok(field);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, field);
  await change("Category name 1", "Projects");
  await submit();
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
});

test("the total weight meter uses shorter transitions for larger changes in either direction", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "labs", name: "Labs", weight: 20 }] } });
  await click("Go to Categories");
  const meter = host.querySelector('[role="meter"]');
  const fill = meter.firstElementChild;
  assert.equal(fill.style.width, "20%");

  let stepDuration;
  for (const [weight, isSingleStep] of [[21, true], [20, true], [80, false], [20, false]]) {
    await change("Labs weight", String(weight));
    assert.equal(fill.style.width, `${weight}%`);
    assert.equal(meter.getAttribute("aria-valuenow"), String(weight));
    const duration = Number.parseFloat(fill.style.transitionDuration);
    assert.ok(duration > 0);
    if (isSingleStep) {
      stepDuration ??= duration;
      assert.equal(duration, stepDuration);
    } else {
      assert.ok(duration < stepDuration);
    }
  }
});

test("the total weight meter reflects the total before clamping its fill", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [
    { id: "labs", name: "Labs", weight: 99.5 }, { id: "exams", name: "Exams", weight: 0 },
  ] } });
  await click("Go to Categories");
  const meter = host.querySelector('[role="meter"]');
  assert.ok(meter.matches(".is-invalid"), "99.5 is outside the blue range");
  await change("Labs weight", "99");
  assert.ok(meter.matches(":not(.is-complete, .is-invalid)"));
  await change("Exams weight", "1");
  assert.ok(meter.matches(".is-complete"));
  await change("Exams weight", "2");
  assert.ok(meter.matches(".is-invalid"));
  assert.equal(meter.firstElementChild.style.width, "100%");
  await change("Exams weight", "1");
  assert.ok(meter.matches(".is-complete"));
  await change("Exams weight", "0");
  await change("Labs weight", "0");
  assert.ok(meter.matches(":not(.is-complete, .is-invalid)"));
});

test("the categories table and meter lead to optional assignments without tabs", async () => {
  await mount(); await toCoursework();
  for (const name of ["Assignments", "Exam", "Attendance"]) await click(`Remove ${name} category`);
  assert.equal(host.querySelector('[role="tablist"]'), null);
  assert.equal(host.querySelector(".class-coursework-editor"), null);
  await click("Add category");
  assert.equal(document.activeElement, host.querySelector('[aria-label="Category name 1"]'));
  await change("Category name 1", "Writing milestones");
  await change("Writing milestones weight", "40");
  await click("Add category");
  await change("Category name 2", "Exams");
  await change("Exams weight", "60");
  assert.equal(host.querySelector('[role="meter"]').getAttribute("aria-valuenow"), "100");
  assert.equal(host.querySelector(".class-grading-allocation output").textContent, "0% remaining");
  assert.ok(host.querySelector(".class-grading-allocation output.is-complete"));
  await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
  assert.equal(host.querySelector(".class-setup-step-count").textContent, "4 / 5");
  assert.equal(host.querySelector(".class-coursework-optional").textContent, "Optional");
  assert.equal(host.querySelectorAll(".class-coursework-pills button").length, 2);
  assert.ok(button("Skip for now"));
  assert.equal(calls, 0);
  await click("Skip for now");
  assert.equal(host.querySelector("h2").textContent, "Make it yours");
  await submit();
  assert.deepEqual(saved[1].gradingCategories.map(({ name, weight }) => ({ name, weight })), [{ name: "Writing milestones", weight: 40 }, { name: "Exams", weight: 60 }]);
  assert.deepEqual(saved[3], []);
});

test("assignment drafts survive returning to Categories and reallocating weights", async () => {
  await mount(); await toCoursework();
  await change("Category name 1", "Labs"); await change("Labs weight", "25"); await change("Exam weight", "75");
  await submit();
  await click("Add assignment"); await change("Assignment title", "Reading quiz");
  await click("Back");
  assert.equal(host.querySelector('[aria-label="Labs weight"]').value, "25");
  assert.equal(host.querySelector(".class-coursework-task-list"), null);
  await change("Labs weight", "50");
  assert.equal(host.querySelector('[role="alert"]'), null);
  await click("Continue");
  assert.equal(host.querySelector("h2").textContent, "Set up your coursework");
  assert.ok(host.querySelector('.class-grading-allocation .class-setup-required.is-missing'));
  await change("Exam weight", "50");
  await submit();
  assert.ok(host.textContent.includes("Reading quiz"));
  assert.ok(host.querySelector(".class-coursework-pills").textContent.includes("50%"));
  assert.ok(button("Continue to Customize"));
  await submit(); await submit();
  assert.equal(saved[3][0].title, "Reading quiz");
  assert.equal(saved[1].gradingCategories[0].weight, 50);
});

test("final save routes invalid categories and assignments to their own steps", async () => {
  await mount({ editing: true, initialDetails: { officeHours: "", meetings: [], gradingCategories: [{ id: "labs", name: "", weight: 0 }] }, initialAssignments: [{ id: "draft", title: "", courseId: "bio", due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "" }] });
  await click("Go to Customize"); await submit();
  assert.equal(host.querySelector("h2").textContent, "Set up your coursework");
  assert.equal(document.activeElement, host.querySelector('[aria-label="Category name 1"]'));
  await change("Category name 1", "Labs"); await submit();
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
  await click("Go to Customize"); await submit();
  assert.equal(host.querySelector("h2").textContent, "Add assignments");
  assert.ok(host.querySelector('[data-task-title="draft"][aria-invalid="true"]'));
  assert.equal(calls, 0);
});
