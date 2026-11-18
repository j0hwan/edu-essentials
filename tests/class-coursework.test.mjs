import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/course" });
Object.defineProperty(dom.window, "AnimationEvent", { configurable: true, value: class extends dom.window.Event {
  constructor(type, options = {}) { super(type, options); this.animationName = options.animationName ?? ""; }
} });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Event", "KeyboardEvent"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const [{ createElement, act }, { createRoot }, { default: ClassCoursework }] = await Promise.all([import("react"), import("react-dom/client"), import(await clientModule("app/class-coursework.tsx"))]);
let root;
let categories;
let assignments;
const host = document.getElementById("root");
function render() { root.render(createElement("form", null, createElement(ClassCoursework, { courseId: "bio", today: "2026-11-05", categories, assignments, onAssignmentsChange: (next) => { assignments = next; render(); } }))); }
async function setup(seedCategories = [{ id: "lab", name: "Labs", weight: 30 }], seedAssignments = []) { categories = seedCategories; assignments = seedAssignments; root = createRoot(host); await act(async () => render()); }
async function click(text) { const button = [...host.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === text || item.textContent.trim() === text || item.textContent.trim().startsWith(text)); assert.ok(button, `Missing button ${text}`); await act(async () => button.click()); }
async function change(selector, value) { const node = typeof selector === "string" ? host.querySelector(selector) : selector; assert.ok(node, "Missing control"); await act(async () => { if (node.getAttribute("contenteditable") === "plaintext-only") { node.textContent = value; node.dispatchEvent(new Event("input", { bubbles: true })); return; } const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true })); }); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; host.innerHTML = ""; });
after(() => dom.window.close());

test("adds categorized assignment drafts without nesting forms", async () => {
  await setup();
  await click("Labs");
  await click("Add assignment");
  assert.equal(assignments[0].categoryId, "lab");
  await change('input[maxlength="500"]', "Research paper");
  await change('.class-coursework-editor select', "Project");
  assert.equal(assignments[0].title, "Research paper");
  assert.equal(assignments[0].type, "Project");
  assert.equal(host.querySelectorAll("form").length, 1);
});

test("closing and removing task editors restores focus to surviving controls", async () => {
  await setup();
  await click("Add assignment");
  await change('input[maxlength="500"]', "First task");
  const doneEditing = () => [...host.querySelectorAll("button")].find((item) => item.textContent === "Done editing");
  doneEditing().focus();
  await click("Done editing");
  assert.equal(document.activeElement, host.querySelector(".class-coursework-task-title"));
  await click("First task");
  await click("Add assignment");
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
  assert.equal(document.activeElement.textContent, "Add assignment");
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

test("Enter in task inputs never submits the containing class form", async () => {
  await setup([]);
  await click("Add assignment");
  const input = host.querySelector('input[maxlength="500"]');
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { input.dispatchEvent(event); });
  assert.equal(event.defaultPrevented, true);
  await change(input, "Unscheduled work");
  assert.equal(assignments[0].dateKey, "");
  assert.equal(host.querySelector('input[type="time"]').disabled, true);
});

test("long lists keep a single task editor open without losing drafts", async () => {
  const tasks = Array.from({ length: 40 }, (_, index) => ({ id: `task-${index}`, title: `Task ${index} ${"long title ".repeat(20)}`, courseId: "bio", due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "" }));
  await setup(Array.from({ length: 50 }, (_, index) => ({ id: `category-${index}`, name: `Category ${index}`, weight: 2 })), tasks);
  assert.equal(host.querySelectorAll(".class-coursework-pills button").length, 52);
  await click("Task 0 ");
  await change('input[maxlength="500"]', "Edited first task");
  await click("Task 39 ");
  assert.equal(host.querySelectorAll(".class-coursework-editor").length, 1);
  assert.equal(assignments[0].title, "Edited first task");
  assert.equal(document.activeElement.dataset.taskTitle, "task-39");
});
