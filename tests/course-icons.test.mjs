import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/" });
for (const name of ["window", "document", "HTMLElement", "HTMLFormElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: AcademicEditor } = await import(await clientModule("app/academic-editor.tsx"));
const { default: CourseIcon } = await import(await clientModule("app/course-icon.tsx"));
const { courseIconOptions } = await import(await clientModule("lib/course-icons.ts"));
const { emptyCourse, emptyCourseDetails, validateCourseDetails } = await import(await clientModule("lib/academics.ts"));
const { academicSnapshot } = await import(await clientModule("lib/academic-snapshot.ts"));
const { decodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));

const course = { ...emptyCourse("biology"), code: "BIO 101", name: "Biology", initials: "BI" };
const dashboard = { v: 2, a: "day", w: [["day", "Day", []]], d: { assignments: [], manualEvents: [], dashboardView: "cards", calendarView: "month" } };

test("the picker exposes all 24 icon choices, including the explicit no-icon choice", () => {
  assert.equal(courseIconOptions.length, 24);
  assert.deepEqual(courseIconOptions.slice(-8), [
    { id: "landmark", label: "History" },
    { id: "scale", label: "Law" },
    { id: "briefcase-business", label: "Business" },
    { id: "heart-pulse", label: "Health" },
    { id: "leaf", label: "Environmental science" },
    { id: "cog", label: "Engineering" },
    { id: "drama", label: "Theater" },
    { id: "brain", label: "Psychology" },
  ]);
});

test("class icons survive snapshot storage without changing course initials or legacy details", () => {
  assert.deepEqual(validateCourseDetails(emptyCourseDetails()), emptyCourseDetails());
  for (const { id } of courseIconOptions) {
    const details = { ...emptyCourseDetails(), icon: id, syllabusText: "Saved syllabus" };
    const saved = academicSnapshot([course], { ...dashboard, d: { ...dashboard.d, courseDetails: { biology: details } } });
    assert.deepEqual(decodeWorkspaceState(JSON.parse(JSON.stringify(saved.dashboard))).data.courseDetails.biology, details);
    assert.equal(saved.courses[0].initials, "BI");
  }
  for (const icon of ["unknown", "", null, 42, {}, "__proto__"]) {
    assert.throws(() => validateCourseDetails({ ...emptyCourseDetails(), icon }), /Invalid class icon/);
  }
});

test("every selectable icon renders except none, and missing or unknown selections fall back to the book", () => {
  const book = renderToStaticMarkup(createElement(CourseIcon));
  assert.match(book, /lucide-book-open/);
  assert.equal(renderToStaticMarkup(createElement(CourseIcon, { icon: "unknown" })), book);
  for (const { id } of courseIconOptions) {
    const markup = renderToStaticMarkup(createElement(CourseIcon, { icon: id, size: 44, "data-course-morph": "icon", "aria-hidden": true }));
    if (id === "none") {
      assert.equal(markup, "");
    } else {
      assert.match(markup, new RegExp(`lucide-${id}`));
      assert.match(markup, /width="44"/);
      assert.match(markup, /data-course-morph="icon"/);
      assert.match(markup, /aria-hidden="true"/);
    }
  }
});

test("Add and Edit Class share a selectable icon picker that preserves other details", async () => {
  const host = document.getElementById("root");
  const root = createRoot(host);
  let applied;
  const renderEditor = async (initial, key) => act(async () => root.render(createElement(AcademicEditor, {
    key, initial, courses: [course], today: "2026-10-25", onApply: (value) => { applied = value; return true; }, onClose() {},
  })));
  const select = async (label) => act(async () => host.querySelector(`.course-icon-options [aria-label="${label}"]`).click());
  const save = async () => act(async () => host.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  try {
    await renderEditor({ course }, "add");
    assert.equal(host.querySelectorAll(".course-icon-options button").length, 24);
    for (const button of host.querySelectorAll(".course-icon-options button")) {
      assert.ok(button.getAttribute("aria-label"), "icon choices retain accessible names");
    }
    assert.equal(host.querySelector('[aria-label="No icon"]').textContent, "", "the empty choice remains icon-only");
    assert.ok(host.querySelector('[aria-label="No icon"] .lucide-slash'), "a slash identifies the no-icon choice");
    assert.equal(host.querySelectorAll('.course-icon-options button[aria-pressed="true"]').length, 1);
    assert.equal(host.querySelector('[aria-label="Book"]').getAttribute("aria-pressed"), "true");
    await select("Biology");
    assert.equal(applied, undefined, "picking an icon does not submit the form");
    await save();
    assert.equal(applied.details.icon, "dna");
    assert.equal(applied.course.initials, "BI");

    const initial = { ...applied, details: { ...applied.details, officeHours: "Monday 10 AM", syllabusText: "Keep this syllabus" } };
    await renderEditor(initial, "edit");
    assert.equal(host.querySelector('[aria-label="Biology"]').getAttribute("aria-pressed"), "true");
    assert.equal(host.querySelector('[aria-label="Biology"] .course-icon-selected'), null);
    await select("Calculator");
    await save();
    assert.deepEqual(applied.details, { ...initial.details, icon: "calculator" });
    await renderEditor(applied, "reopen");
    assert.equal(host.querySelector('[aria-label="Calculator"]').getAttribute("aria-pressed"), "true");
    await save();
    assert.equal(applied.details.icon, "calculator");
    await select("Book");
    await save();
    assert.equal(applied.details.icon, "book-open");
    const preserved = { ...applied, details: { ...applied.details, officeHours: "Tuesday 2 PM", syllabusText: "Preserve this" } };
    await renderEditor(preserved, "none");
    await select("No icon");
    await save();
    assert.deepEqual(applied.details, { ...preserved.details, icon: "none" });
    await renderEditor(applied, "none-reopen");
    assert.equal(host.querySelector('[aria-label="No icon"]').getAttribute("aria-pressed"), "true");
    await save();
    assert.deepEqual(applied.details, { ...preserved.details, icon: "none" });
  } finally {
    await act(async () => root.unmount());
  }
});
