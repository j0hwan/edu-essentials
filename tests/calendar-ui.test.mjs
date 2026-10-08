import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";
const dom = new JSDOM('<div id="root"></div>');
for (const name of ["window", "document", "HTMLElement", "MouseEvent"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Calendar } = await import(await clientModule("app/academic-calendar.tsx"));
const course = { id: "cs", name: "Circuit Analysis", code: "EE305", room: "Lab 4", color: "#4cb8ff" };
const assignment = { id: "due", dateKey: "2026-09-17", title: "Lab report", courseId: "cs", dueTime: "23:59", status: "today" };
const event = { id: "study", dateKey: "2026-09-17", title: "Study group", courseId: "", time: "16:00", type: "Personal" };
const props = { today: "2026-09-17", monday: true, timezone: "America/Los_Angeles", filter: "all", courses: [course], assignments: [assignment], events: [event], details: { cs: { meetings: [{ id: "lecture", days: [4], from: "2026-09-01", until: "2026-12-01", start: "14:00", end: "15:15", location: "Lab 4" }] } }, onFilter() {}, onAssignment() {}, onEvent() {}, onCourse() {}, onAdd() {} };
const node = document.getElementById("root");
let root;
async function mount(overrides = {}) { root = createRoot(node); await act(async () => root.render(createElement(Calendar, { ...props, ...overrides }))); }
async function click(text) { const button = [...node.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === text || b.textContent.trim() === text); assert.ok(button, `Missing ${text}`); await act(async () => button.click()); }
test("calendar interactions", async (t) => {
  t.afterEach(async () => { await act(async () => root.unmount()); });
  await t.test("starts in Week with day details and correctly placed classes and deadlines", async () => {
    await mount();
    assert.equal(node.querySelector('.planner-view-toggle [aria-pressed="true"]').textContent, "Week");
    assert.equal(node.querySelectorAll(".planner-time-day").length, 7);
    assert.ok(node.querySelector(".planner-details"));
    assert.match(node.querySelector(".planner-deadlines").textContent, /Lab report.*11:59 PM/);
    assert.equal(node.querySelectorAll(".planner-time-event").length, 2);
    const lecture = [...node.querySelectorAll(".planner-time-event")].find((n) => n.textContent.includes("Circuit Analysis"));
    assert.ok(Math.abs(parseFloat(lecture.style.top) - (6 / 13 * 100)) < .01);
    assert.match(lecture.textContent, /2:00 PM.*3:15 PM/);
  });
  await t.test("removed calendar controls and helper copy are absent while the toolbar sidebar toggle works", async () => {
    await mount({ assignments: [], events: [], courses: [], details: {} });
    assert.equal(node.querySelector('input[type="date"], [aria-label="Go to date"], [aria-label="Close day details"], .planner-zone, .planner-footnote'), null);
    assert.doesNotMatch(node.textContent, /A little room to breathe|Times shown in|Select a day for details/);
    assert.equal(node.querySelector(".planner-day-agenda").textContent, "Nothing scheduled.");
    assert.equal(node.querySelector(".planner-upcoming h3").textContent, "Upcoming");
    assert.equal(node.querySelector(".planner-upcoming-empty span").textContent, "No items in the next 30 days.");
    assert.equal(node.querySelector(".planner-course-chevron").getAttribute("aria-hidden"), "true");
    await click("Hide day details");
    assert.equal(node.querySelector(".planner-details"), null);
    await click("Show day details");
    assert.ok(node.querySelector(".planner-details"));
  });
  await t.test("month tabs, selected-day details, sidebar collapse and prefilled add date work", async () => {
    let addDate;
    await mount({ onAdd: (date) => { addDate = date; } });
    await click("Month");
    assert.equal(node.querySelectorAll(".planner-month-day").length, 35);
    await click("Select Sep 22, 2026");
    assert.match(node.querySelector(".planner-details h2").textContent, /Tuesday, September 22/);
    await click("Hide day details"); assert.equal(node.querySelector(".planner-details"), null);
    await click("Show day details"); await click("Add to this day"); assert.equal(addDate, "2026-09-22");
    await click("Day"); assert.equal(node.querySelectorAll(".planner-time-day").length, 1);
    await click("Today"); assert.match(node.querySelector(".planner-details h2").textContent, /Thursday, September 17/);
  });
  await t.test("week empty timed and all-day areas select the date used for new events", async () => {
    let addDate;
    await mount({ onAdd: (date) => { addDate = date; } });
    const column = node.querySelector('.planner-time-day[aria-label="2026-09-18"]');
    await act(async () => column.querySelector(".planner-day-hit-area").click());
    assert.match(node.querySelector(".planner-details h2").textContent, /Friday, September 18/);
    assert.equal(column.querySelector(".planner-day-hit-area").getAttribute("aria-pressed"), "true");
    await click("Add event"); assert.equal(addDate, "2026-09-18");
    const allDay = node.querySelector('.planner-deadlines .planner-day-hit-area[aria-label="Select Sep 19, 2026"]');
    await act(async () => allDay.click());
    assert.match(node.querySelector(".planner-details h2").textContent, /Saturday, September 19/);
    await click("Add to this day"); assert.equal(addDate, "2026-09-19");
  });
  await t.test("item content clicks open editors without selecting the underlying day", async () => {
    const opened = [];
    await mount({ onCourse: (item) => opened.push(item), onEvent: (item) => opened.push(item), onAssignment: (item) => opened.push(item) });
    await click("Select Sep 18, 2026");
    for (const button of node.querySelectorAll(".calendar-chip")) {
      await act(async () => button.querySelector("span, strong").click());
      assert.match(node.querySelector(".planner-details h2").textContent, /Friday, September 18/);
    }
    assert.deepEqual(new Set(opened), new Set([course, event, assignment]));
    opened.length = 0;
    await click("Month");
    for (const button of node.querySelectorAll(".calendar-chip")) {
      await act(async () => button.querySelector("span").click());
      assert.match(node.querySelector(".planner-details h2").textContent, /Friday, September 18/);
    }
    assert.deepEqual(new Set(opened), new Set([course, event, assignment]));
  });
  await t.test("classes, events and deadlines keep their original editor callbacks", async () => {
    const opened = [];
    await mount({ onCourse: (item) => opened.push(item), onEvent: (item) => opened.push(item), onAssignment: (item) => opened.push(item) });
    for (const button of node.querySelectorAll(".calendar-chip")) await act(async () => button.click());
    assert.deepEqual(new Set(opened), new Set([course, event, assignment]));
    await click("Filter calendar items");
    const checkbox = [...node.querySelectorAll(".planner-filter-popover label")].find((n) => n.textContent === "Deadlines / exams").querySelector("input");
    await act(async () => checkbox.click());
    assert.equal(node.querySelector(".planner-deadline"), null);
    assert.ok(!node.querySelector(".planner-details").textContent.includes("Lab report"));
  });
  await t.test("crowded month cells expose every item through the details sidebar", async () => {
    await mount({ events: Array.from({ length: 5 }, (_, i) => ({ ...event, id: `event-${i}`, title: `Event ${i}` })) });
    await click("Month"); await click("Hide day details");
    const day = node.querySelector('[aria-label="2026-09-17"]');
    assert.equal(day.querySelectorAll(".calendar-chip").length, 3);
    await click("4 more");
    assert.equal(node.querySelectorAll(".planner-day-agenda .planner-agenda-item").length, 7);
  });
  await t.test("early and late timed exams expand the hours instead of disappearing into the deadline row", async () => {
    await mount({ events: [{ ...event, id: "early", title: "Early exam", type: "Exam", time: "06:30" }, { ...event, id: "late", title: "Late study", time: "23:30" }] });
    assert.match(node.querySelector(".planner-hours").textContent, /6 AM/);
    assert.match(node.querySelector(".planner-hours").textContent, /11 PM/);
    assert.match(node.querySelector(".planner-time-body").textContent, /Early exam/);
    assert.ok(!node.querySelector(".planner-deadlines").textContent.includes("Early exam"));
    for (const block of node.querySelectorAll(".planner-time-event")) assert.ok(parseFloat(block.style.top) + parseFloat(block.style.height) <= 100.001);
  });
  await t.test("saved event durations control block height and remain editable in both views", async () => {
    const durationEvent = { ...event, durationMinutes: 135 };
    let opened;
    await mount({ events: [durationEvent], onEvent: (item) => { opened = item; } });
    const block = [...node.querySelectorAll(".planner-time-event")].find((n) => n.textContent.includes("Study group"));
    assert.ok(Math.abs(parseFloat(block.style.height) - 135 / (13 * 60) * 100) < .01);
    assert.match(block.textContent, /4:00 PM.*6:15 PM/);
    await act(async () => block.click()); assert.equal(opened, durationEvent);
    await click("Month");
    const monthItem = [...node.querySelectorAll(".planner-month-item")].find((n) => n.textContent.includes("Study group"));
    assert.match(monthItem.title, /6:15 PM/);
    await act(async () => monthItem.click()); assert.equal(opened.durationMinutes, 135);
  });
});
