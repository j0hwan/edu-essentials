import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/tasks" });
for (const name of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: AcademicEditor } = await import(await clientModule("app/academic-editor.tsx"));
const host = document.getElementById("root");
const course = { id: "bio", code: "BIO", name: "Biology", credits: 3, instructor: "", room: "", color: "#112233", soft: "#11223318", initials: "BI" };
const assignment = { id: "quiz", title: "Quiz", courseId: "bio", categoryId: "labs", due: "", dateKey: "2026-11-05", dueTime: "14:00", status: "done", progress: 100, progressBeforeCompletion: 20, description: "", weight: "", pointsPossible: 10, pointsEarned: 0 };
let root;
let saved;

async function mount() {
  saved = undefined;
  root = createRoot(host);
  await act(async () => root.render(createElement(AcademicEditor, {
    initial: { assignment }, courses: [course, { ...course, id: "chem", code: "CHEM" }], today: "2026-11-05",
    onApply(value) { saved = value.assignment; return true; }, onClose() {},
  })));
}
async function save() { await act(async () => host.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); }
async function change(control, value) {
  await act(async () => {
    const prototype = control.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(control, value);
    control.dispatchEvent(new window.Event("input", { bubbles: true }));
    control.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; host.replaceChildren(); });
after(() => dom.window.close());

test("moving a coursework task to another course clears only its category reference", async () => {
  await mount();
  await change(host.querySelector("select"), "chem");
  await save();
  assert.equal(saved.courseId, "chem");
  assert.equal(saved.categoryId, undefined);
  assert.equal(saved.pointsEarned, 0);
  assert.equal(saved.pointsPossible, 10);
});

test("marking a graded task incomplete requires confirmation before clearing its score", async () => {
  await mount();
  const completed = host.querySelector('input[type="checkbox"]');
  let confirmations = 0;
  window.confirm = () => { confirmations++; return false; };
  await act(async () => completed.click());
  await save();
  assert.equal(confirmations, 1);
  assert.equal(saved.status, "done");
  assert.equal(saved.pointsEarned, 0);
  window.confirm = () => true;
  await act(async () => completed.click());
  await save();
  assert.notEqual(saved.status, "done");
  assert.equal(saved.pointsEarned, null);
  assert.equal(saved.pointsPossible, 10);
  assert.equal(saved.progress, 20);
});

test("clearing a coursework due date clears the time without clearing the score", async () => {
  await mount();
  const date = host.querySelector('input[type="date"]');
  assert.equal(date.required, false);
  await change(date, "");
  await save();
  assert.equal(saved.dateKey, "");
  assert.equal(saved.dueTime, "");
  assert.equal(saved.pointsEarned, 0);
});
