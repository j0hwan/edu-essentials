import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const { default: ClassMeetingWeek } = await import(await clientModule("app/class-meeting-week.tsx"));

function meeting(id, name, days, overrides = {}) {
  return {
    id,
    name,
    days,
    start: "09:00",
    end: "10:00",
    from: "2026-01-01",
    until: "2027-12-31",
    location: "Room 1",
    ...overrides,
  };
}

function renderWeek(today, meetings) {
  const html = renderToStaticMarkup(createElement(ClassMeetingWeek, { meetings, today }));
  const dom = new JSDOM(html);
  const root = dom.window.document.querySelector(".expanded-class-weekdays");
  assert.ok(root, "renders the expanded class week list");
  assert.equal(root.querySelector('[role="tooltip"]'), null, "server rendered markup has no tooltip");
  return { dom, root, days: [...root.querySelectorAll(":scope > li")] };
}

async function renderInteractiveWeek(today, meetings) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const previous = Object.fromEntries(["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const rootNode = dom.window.document.getElementById("root");
  const root = createRoot(rootNode);
  await act(async () => root.render(createElement(ClassMeetingWeek, { meetings, today })));
  return {
    dom,
    rootNode,
    async update(today, meetings) {
      await act(async () => root.render(createElement(ClassMeetingWeek, { meetings, today })));
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("renders the current Sunday through Saturday, with matching meetings in order", () => {
  const { dom, days } = renderWeek("2026-11-04", [
    meeting("sun", "Sunday class", [0]),
    meeting("wed", "Wednesday class", [3]),
    meeting("sat", "Saturday class", [6]),
  ]);

  assert.equal(days.length, 7);
  assert.deepEqual(days.map((day) => day.querySelector("time")?.getAttribute("datetime")), [
    "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07",
  ]);
  assert.deepEqual(days.map((day) => [...day.querySelectorAll(".expanded-class-weekday-meeting")].map((item) => item.textContent)), [
    ["Sunda"], [], [], ["Wedne"], [], [], ["Satur"],
  ]);
  for (const day of days) assert.ok(day.querySelector("time"), "each tile exposes its ISO date through time[datetime]");
  dom.window.close();
});

test("marks exactly today's tile, including empty days and month or year boundaries", () => {
  for (const today of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2027-01-01", "2028-02-29"]) {
    const { dom, root } = renderWeek(today, []);
    const highlighted = root.querySelectorAll('li[aria-current="date"]');
    assert.equal(highlighted.length, 1, `exactly one day is highlighted for ${today}`);
    assert.equal(highlighted[0].querySelector("time").getAttribute("datetime"), today);
    assert.equal(root.querySelectorAll("li:not([aria-current])").length, 6);
    dom.window.close();
  }
});

test("moves the current-day highlight when the local date changes", async () => {
  const view = await renderInteractiveWeek("2026-11-04", []);
  try {
    const previous = view.rootNode.querySelector('li[aria-current="date"]');
    await view.update("2026-11-05", []);
    assert.equal(previous.hasAttribute("aria-current"), false);
    assert.equal(view.rootNode.querySelectorAll('li[aria-current="date"]').length, 1);
    assert.equal(view.rootNode.querySelector('li[aria-current="date"] time').getAttribute("datetime"), "2026-11-05");
  } finally {
    await view.close();
  }
});

test("shows multiple meetings per day, truncates by Unicode codepoint, and labels full names", () => {
  const { dom, days } = renderWeek("2026-11-04", [
    meeting("one", " A ", [3]),
    meeting("two", "ABCDE", [3]),
    meeting("three", "Longer meeting name", [3]),
    meeting("four", "😀😃😄😁😆😅", [3]),
  ]);
  const entries = days[3].querySelectorAll(".expanded-class-weekday-meeting");
  assert.equal(entries.length, 4);
  assert.deepEqual([...entries].map((item) => item.textContent), ["A", "ABCDE", "Longe", "😀😃😄😁😆"]);
  assert.deepEqual([...entries].map((item) => item.getAttribute("title")), [null, null, null, null]);
  assert.deepEqual([...entries].map((item) => item.getAttribute("aria-label")), ["A", "ABCDE", "Longer meeting name", "😀😃😄😁😆😅"]);
  dom.window.close();
});

test("uses indexed fallbacks for blank or missing names", () => {
  const { dom, days } = renderWeek("2026-11-04", [
    meeting("blank", "  \t ", [3]),
    meeting("missing", undefined, [3]),
  ]);
  const entries = days[3].querySelectorAll(".expanded-class-weekday-meeting");
  assert.deepEqual([...entries].map((item) => item.textContent), ["Meet1", "Meet2"]);
  assert.deepEqual([...entries].map((item) => item.getAttribute("title")), [null, null]);
  assert.deepEqual([...entries].map((item) => item.getAttribute("aria-label")), ["Meeting 1", "Meeting 2"]);
  dom.window.close();
});

test("abbreviates explicit default names without treating custom meeting names as defaults", () => {
  const { dom, days } = renderWeek("2026-11-04", [
    meeting("default", "Meeting 2", [3]),
    meeting("custom", "Meeting notes", [3]),
  ]);
  const entries = [...days[3].querySelectorAll(".expanded-class-weekday-meeting")];
  assert.deepEqual(entries.map((entry) => entry.textContent), ["Meet2", "Meeti"]);
  assert.equal(entries[0].getAttribute("title"), null);
  assert.equal(entries[0].getAttribute("aria-label"), "Meeting 2");
  dom.window.close();
});

test("shows tooltip content on hover only and leaves Escape behavior unchanged", async () => {
  const view = await renderInteractiveWeek("2026-11-04", [
    meeting("repeat", "A longer meeting name", [3, 4]),
  ]);
  const { rootNode, dom } = view;
  const wrappers = [...rootNode.querySelectorAll(".expanded-class-weekday-meeting-anchor")];
  const labels = [...rootNode.querySelectorAll(".expanded-class-weekday-meeting")];
  assert.equal(labels.length, 2, "the same meeting appears on both scheduled days");
  for (const label of labels) {
    assert.equal(label.tagName, "SPAN");
    assert.equal(label.textContent, "A lon");
    assert.equal(label.getAttribute("aria-label"), "A longer meeting name");
    assert.equal(label.hasAttribute("title"), false);
    assert.equal(label.getAttribute("aria-describedby"), null);
  }
  assert.equal(rootNode.querySelector('[role="tooltip"]'), null, "tooltips start hidden in the client render");

  const [first, second] = labels;
  const [firstWrapper, secondWrapper] = wrappers;
  let bubbledEscape = false;
  dom.window.document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") bubbledEscape = true;
  });
  const dispatch = async (target, event) => act(async () => target.dispatchEvent(event));
  const tooltip = (wrapper) => wrapper.querySelector('[role="tooltip"]');
  const showByHover = async () => dispatch(firstWrapper, new dom.window.MouseEvent("mouseover", { bubbles: true }));
  const leaveByHover = async () => dispatch(firstWrapper, new dom.window.MouseEvent("mouseout", { bubbles: true }));
  try {
    await showByHover();
    assert.equal(tooltip(firstWrapper)?.textContent, "A longer meeting name");
    const firstTooltipId = tooltip(firstWrapper).id;
    assert.ok(firstTooltipId);
    assert.equal(first.getAttribute("aria-describedby"), firstTooltipId);
    await leaveByHover();
    assert.equal(tooltip(firstWrapper), null);
    assert.equal(first.getAttribute("aria-describedby"), null);

    await act(async () => first.focus());
    assert.equal(tooltip(firstWrapper), null, "focus does not open a hover-only tooltip");
    await dispatch(first, new dom.window.MouseEvent("click", { bubbles: true }));
    assert.equal(tooltip(firstWrapper), null, "click does not open a hover-only tooltip");
    await showByHover();
    await dispatch(first, new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(tooltip(firstWrapper)?.textContent, "A longer meeting name");
    assert.equal(bubbledEscape, true, "Escape is not intercepted by the hover tooltip");
    await leaveByHover();
    assert.equal(tooltip(firstWrapper), null);

    await dispatch(firstWrapper, new dom.window.MouseEvent("mouseover", { bubbles: true }));
    await dispatch(secondWrapper, new dom.window.MouseEvent("mouseover", { bubbles: true }));
    const ids = [tooltip(firstWrapper)?.id, tooltip(secondWrapper)?.id];
    assert.ok(ids.every(Boolean));
    assert.notEqual(ids[0], ids[1], "repeated meetings receive distinct tooltip ids");
    assert.equal(first.getAttribute("aria-describedby"), ids[0]);
    assert.equal(second.getAttribute("aria-describedby"), ids[1]);
  } finally {
    await view.close();
  }
});

test("honors date exceptions, future starts, inclusive range bounds, and expired schedules", () => {
  const { dom, days } = renderWeek("2026-11-04", [
    meeting("excluded", "Excluded this date", [3], { excludedDates: ["2026-11-04"] }),
    meeting("future", "Starts later this week", [4], { from: "2026-11-05" }),
    meeting("inclusive", "Inclusive endpoints", [0, 6], { from: "2026-11-01", until: "2026-11-07" }),
    meeting("expired", "Ended earlier this week", [2], { from: "2026-11-01", until: "2026-11-03" }),
  ]);

  assert.deepEqual([...days[0].querySelectorAll(".expanded-class-weekday-meeting")].map((item) => item.textContent), ["Inclu"]);
  assert.deepEqual([...days[2].querySelectorAll(".expanded-class-weekday-meeting")], [], "an expired meeting stays hidden even on a date it otherwise occurred earlier this week");
  assert.deepEqual([...days[3].querySelectorAll(".expanded-class-weekday-meeting")], [], "excluded dates are omitted");
  assert.deepEqual([...days[4].querySelectorAll(".expanded-class-weekday-meeting")].map((item) => item.textContent), ["Start"]);
  assert.deepEqual([...days[6].querySelectorAll(".expanded-class-weekday-meeting")].map((item) => item.textContent), ["Inclu"]);
  dom.window.close();
});

test("keeps the requested week stable across month and year boundaries", () => {
  const { dom, days } = renderWeek("2026-12-30", []);
  assert.deepEqual(days.map((day) => day.querySelector("time")?.getAttribute("datetime")), [
    "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02",
  ]);
  dom.window.close();
});

test("hides meetings outside their range and keeps the final scheduled day inclusive", () => {
  const { dom, days } = renderWeek("2026-11-04", [
    meeting("future", "Future", [0, 1, 2, 3, 4, 5, 6], { from: "2026-11-08" }),
    meeting("ended", "Ended", [0, 1, 2, 3, 4, 5, 6], { until: "2026-10-31" }),
    meeting("last-day", "Final", [3, 4], { from: "2026-11-04", until: "2026-11-04" }),
  ]);
  assert.deepEqual(days.map((day) => [...day.querySelectorAll(".expanded-class-weekday-meeting")].map((entry) => entry.textContent)), [[], [], [], ["Final"], [], [], []]);
  dom.window.close();
});
