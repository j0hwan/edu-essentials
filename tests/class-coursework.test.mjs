import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/course" });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Event", "KeyboardEvent"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const [{ createElement, act }, { createRoot }, { default: ClassCoursework }] = await Promise.all([import("react"), import("react-dom/client"), import(await clientModule("app/class-coursework.tsx"))]);
let root;
let categories;
let assignments;
const host = document.getElementById("root");
function render() { root.render(createElement("form", null, createElement(ClassCoursework, { courseId: "bio", today: "2026-11-05", categories, assignments, onCategoriesChange: (next) => { categories = next; render(); }, onAssignmentsChange: (next) => { assignments = next; render(); } }))); }
async function setup(seedCategories = [{ id: "lab", name: "Labs", weight: 30 }], seedAssignments = []) { categories = seedCategories; assignments = seedAssignments; root = createRoot(host); await act(async () => render()); }
async function click(text) { const button = [...host.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === text || item.textContent.trim() === text || item.textContent.trim().startsWith(text)); assert.ok(button, `Missing button ${text}`); await act(async () => button.click()); }
async function change(selector, value) { const node = typeof selector === "string" ? host.querySelector(selector) : selector; assert.ok(node, "Missing control"); await act(async () => { const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true })); }); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; host.innerHTML = ""; });
after(() => dom.window.close());

test("edits category and task fields as controlled drafts without nesting forms", async () => {
  await setup();
  await click("Labs");
  await click("Edit Labs category");
  await change('[aria-label="Labs name"]', "Projects");
  assert.equal(categories[0].name, "Projects");
  await click("Add task");
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].title, "");
  await change('input[maxlength="500"]', "Research paper");
  assert.equal(assignments[0].title, "Research paper");
  await change('.class-coursework-editor select', "Project");
  assert.equal(assignments[0].type, "Project");
  await change('input[type="date"]', "");
  assert.equal(assignments[0].dateKey, "");
  assert.equal(host.querySelectorAll("form").length, 1);
  assert.ok(host.querySelectorAll("button[type=button]").length > 0);
});

test("closing and removing task editors restores focus to surviving controls", async () => {
  await setup();
  await click("Add task");
  await change('input[maxlength="500"]', "First task");
  const doneEditing = () => [...host.querySelectorAll("button")].find((item) => item.textContent === "Done editing");
  doneEditing().focus();
  await click("Done editing");
  assert.equal(document.activeElement, host.querySelector(".class-coursework-task-title"));
  await click("First task");
  await click("Add task");
  await change('input[maxlength="500"]', "Second task");
  await click("Remove task");
  assert.equal(document.activeElement.textContent, "Confirm remove");
  await click("Keep task");
  assert.equal(document.activeElement.textContent, "Remove task");
  await click("Remove task");
  await click("Confirm remove");
  assert.equal(document.activeElement, host.querySelector(".class-coursework-task-title"));
  await click("First task");
  await click("Remove task");
  await click("Confirm remove");
  assert.equal(document.activeElement.textContent, "Add task");
});

test("category removal and cancellation preserve keyboard focus", async () => {
  await setup();
  await click("Remove Labs category");
  assert.equal(document.activeElement.textContent, "Move tasks & remove");
  await click("Keep category");
  assert.equal(document.activeElement.getAttribute("aria-label"), "Remove Labs category");
  await click("Remove Labs category");
  await click("Move tasks & remove");
  assert.equal(document.activeElement.dataset.courseworkFocus, "all");
});

test("keeps blank scores distinct from zero and supports grade completion toggles", async () => {
  const task = { id: "a", title: "Quiz", courseId: "bio", due: "", dateKey: "", status: "later", progress: 20, description: "keep me", weight: "", categoryId: "lab", pointsPossible: 10, pointsEarned: null, type: "Exam", notes: "preserve", checklist: [true] };
  await setup([{ id: "lab", name: "Labs", weight: 30 }], [task]);
  await click("Quiz");
  const done = [...host.querySelectorAll("label")].find((label) => label.textContent.trim().startsWith("Done"))?.querySelector("input");
  await act(async () => { done.click(); });
  assert.equal(assignments[0].status, "done");
  assert.equal(assignments[0].progress, 100);
  const received = [...host.querySelectorAll("label")].find((label) => label.textContent.includes("Grade received"))?.querySelector("input");
  assert.ok(received);
  await act(async () => { received.click(); });
  assert.ok(Number.isNaN(assignments[0].pointsEarned));
  const earned = () => [...host.querySelectorAll("label")].find((label) => label.textContent.trim() === "Points earned")?.control;
  assert.ok(earned());
  assert.equal(earned().value, "");
  await change(earned(), "0");
  assert.equal(assignments[0].pointsEarned, 0);
  assert.match(host.textContent, /0 \/ 10 points · Graded/);
  await change(earned(), "");
  assert.ok(Number.isNaN(assignments[0].pointsEarned));
  await act(async () => { received.click(); });
  assert.equal(assignments[0].pointsEarned, null);
  assert.equal(assignments[0].notes, "preserve");
  assert.deepEqual(assignments[0].checklist, [true]);
  const reopenedDone = [...host.querySelectorAll("label")].find((label) => label.textContent.trim().startsWith("Done"))?.querySelector("input");
  await act(async () => { reopenedDone.click(); });
  assert.equal(assignments[0].status, "later");
  assert.equal(assignments[0].progress, 20);
  assert.equal(assignments[0].pointsEarned, null);
});

test("category removal reassigns existing tasks without deleting them", async () => {
  await setup([{ id: "lab", name: "Labs", weight: 30 }, { id: "exam", name: "Exams", weight: 70 }], [{ id: "a", title: "Quiz", courseId: "bio", due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "", categoryId: "lab" }]);
  await click("Remove Labs category");
  await change('[aria-label="Reassign Labs tasks before removing"]', "exam");
  assert.equal(categories.length, 2);
  assert.equal(assignments[0].categoryId, "lab");
  await click("Move tasks & remove");
  assert.equal(categories.some((category) => category.id === "lab"), false);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].categoryId, "exam");
});

test("new categories have unique names and receive keyboard focus", async () => {
  await setup([]);
  await click("Add category");
  assert.equal(categories[0].name, "New category");
  assert.equal(document.activeElement, host.querySelector('[aria-label="New category name"]'));
  await click("Add category");
  assert.equal(categories[1].name, "New category 2");
  assert.equal(document.activeElement, host.querySelector('[aria-label="New category 2 name"]'));
});

test("Enter in task inputs never submits the containing class form", async () => {
  await setup([]);
  await click("Add task");
  const input = host.querySelector('input[maxlength="500"]');
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { input.dispatchEvent(event); });
  assert.equal(event.defaultPrevented, true);
  await change(input, "Unscheduled work");
  assert.equal(assignments[0].dateKey, "");
  assert.equal(host.querySelector('input[type="time"]').disabled, true);
});

test("category cards stay compact and add controls follow their lists", async () => {
  await setup([{ id: "lab", name: "Labs", weight: 30 }, { id: "exam", name: "Exams", weight: 70 }]);
  assert.equal(host.querySelectorAll(".class-coursework-category input").length, 0);
  assert.equal(host.querySelector(".class-coursework-category-editor"), null);
  assert.equal(host.querySelector(".class-coursework-rail > .class-coursework-add").previousElementSibling.className, "class-coursework-category-list");
  assert.equal(host.querySelector(".class-coursework-main > .class-coursework-add").previousElementSibling.className, "class-coursework-empty");
  assert.doesNotMatch(host.textContent, /Weights are unfinished|No points set|No due date|as setup drafts/);
  await click("Labs"); await click("Edit Labs category");
  assert.equal(host.querySelectorAll(".class-coursework-category-editor").length, 1);
  await change('[aria-label="Labs weight"]', "40");
  await click("Exams");
  assert.equal(host.querySelector(".class-coursework-category-editor"), null);
  await click("Labs"); await click("Edit Labs category");
  assert.equal(host.querySelector('[aria-label="Labs weight"]').value, "40");
  await click("Add task");
  assert.equal(host.querySelector(".class-coursework-category-editor"), null);
  assert.equal(host.querySelectorAll(".class-coursework-editor").length, 1);
  assert.equal(host.querySelector(".class-coursework-main > .class-coursework-add").previousElementSibling.className, "class-coursework-task-list");
});

test("long lists keep a single task editor open without losing drafts", async () => {
  const tasks = Array.from({ length: 40 }, (_, index) => ({ id: `task-${index}`, title: `Task ${index} ${"long title ".repeat(20)}`, courseId: "bio", due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "" }));
  await setup(Array.from({ length: 50 }, (_, index) => ({ id: `category-${index}`, name: `Category ${index}`, weight: 2 })), tasks);
  assert.equal(host.querySelectorAll(".class-coursework-category").length, 50);
  await click("Task 0 ");
  await change('input[maxlength="500"]', "Edited first task");
  await click("Task 39 ");
  assert.equal(host.querySelectorAll(".class-coursework-editor").length, 1);
  assert.equal(assignments[0].title, "Edited first task");
  assert.equal(document.activeElement.dataset.taskTitle, "task-39");
});
