import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/dashboard" });
for (const name of ["window", "document", "HTMLElement", "HTMLFormElement", "HTMLInputElement"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ClassSyllabusImport } = await import(await clientModule("app/class-syllabus-import.tsx"));
const host = document.querySelector("#root");
const draft = { course: { code: "ECON 1" }, details: { meetings: [] }, assignments: [] };
const response = () => Response.json(draft);
const selected = () => new window.File(["%PDF-1.4 fictional"], "Econ1.pdf", { type: "application/pdf" });

async function setup(t, fetcher) {
  const previousFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  globalThis.fetch = fetcher;
  URL.createObjectURL = () => "blob:syllabus-preview";
  URL.revokeObjectURL = () => {};
  const root = createRoot(host);
  const reviews = [];
  let returned = false;
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = previousFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
  await act(async () => root.render(createElement(ClassSyllabusImport, {
    profileId: "account-test", canImport: true, canUpload: true, today: "2026-11-20",
    onReview: (review) => reviews.push(review), onBack: () => { returned = true; },
    onSave: () => assert.fail("A scan should not save the class"), onClose: () => assert.fail("The review is not shown in this fixture"),
  })));
  return { reviews, returned: () => returned };
}
const button = (name) => [...host.querySelectorAll("button")].find((element) => element.textContent === name);
const upload = async (file) => {
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
};

test("the upload card confirms a valid PDF and lets the user remove it", async (t) => {
  await setup(t, () => assert.fail("Choosing a PDF should never start extraction"));
  const input = host.querySelector('input[type="file"]');
  const status = host.querySelector('[role="status"]');
  assert.equal(document.activeElement, input);
  assert.match(status.textContent, /Upload your syllabus.*PDF only · Up to 12 MiB/);
  assert.deepEqual(host.querySelector('[role="dialog"]').textContent.match(/\d+ MiB/g), ["12 MiB"]);
  assert.deepEqual([...host.querySelectorAll(".modal-actions button")].map((action) => action.textContent), ["Back", "Read syllabus"]);

  await upload(new window.File(["notes"], "notes.txt", { type: "text/plain" }));
  assert.match(host.querySelector('[role="alert"]').textContent, /Choose a PDF syllabus/);
  assert.equal(button("Read syllabus").disabled, true);

  const file = selected();
  await upload(file);
  assert.match(status.textContent, /Upload Successful.*Econ1\.pdf/);
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(button("Read syllabus").disabled, false);

  const remove = host.querySelector('[aria-label="Remove syllabus"]');
  remove.focus();
  await act(async () => remove.click());
  assert.equal(document.activeElement, input);
  assert.match(status.textContent, /Upload your syllabus/);
  assert.equal(button("Read syllabus").disabled, true);
});

test("the importer accepts PDFs up to 12 MiB and rejects anything larger", async (t) => {
  await setup(t, () => assert.fail("No PDF should be sent for extraction"));
  const limit = 12 * 1024 * 1024;
  const contents = new Uint8Array(limit + 1);
  await upload(new window.File([contents], "large.pdf", { type: "application/pdf" }));
  assert.match(host.querySelector('[role="alert"]').textContent, /up to 12 MiB/);
  assert.equal(button("Read syllabus").disabled, true);

  await upload(new window.File([contents.subarray(0, limit)], "syllabus.pdf", { type: "application/pdf" }));
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(button("Read syllabus").disabled, false);
});

test("a failed extraction keeps the local source for retry and disables duplicate submissions", async (t) => {
  const file = selected();
  let calls = 0, complete;
  const { reviews } = await setup(t, async (url, init) => {
    calls++;
    assert.equal(url, "/api/ai/syllabus-import");
    assert.equal(init.headers["x-profile-id"], "account-test");
    assert.equal(init.body, file);
    if (calls === 1) return Response.json({ error: "Gemini quota exhausted." }, { status: 429 });
    return new Promise((resolve) => { complete = resolve; });
  });
  assert.equal(button("Read syllabus").disabled, true);
  await upload(file);
  assert.equal(calls, 0);
  await act(async () => button("Read syllabus").click());
  assert.match(host.querySelector('.syllabus-analysis [role="alert"]').textContent, /quota/);
  const source = host.querySelector('[aria-label="Uploaded syllabus"]');
  assert.equal(source.firstElementChild.getAttribute("aria-label"), "PDF preview");
  assert.equal(source.querySelector('a[target="_blank"]'), null);
  await act(async () => {
    const retry = button("Retry import");
    retry.click();
    retry.click();
  });
  assert.equal(calls, 2);
  const dialog = host.querySelector('[aria-busy="true"]');
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.ok(dialog.classList.contains("syllabus-review-modal"));
  assert.equal(dialog.querySelector('[aria-label="Uploaded syllabus"]'), source);
  assert.match(source.nextElementSibling.querySelector('[aria-label="Syllabus analysis"]').textContent, /Analyzing your syllabus/);
  assert.equal(dialog.querySelector('input[type="file"]'), null);
  await act(async () => complete(response()));
  assert.deepEqual(reviews, [draft]);
});

test("cancel stops pending extraction and ignores a late response", async (t) => {
  let complete, signal;
  const { reviews, returned } = await setup(t, async (_url, init) => {
    signal = init.signal;
    return new Promise((resolve) => { complete = resolve; });
  });
  await upload(selected());
  await act(async () => button("Read syllabus").click());
  await act(async () => button("Cancel").click());
  assert.equal(returned(), true);
  assert.equal(signal.aborted, true);
  await act(async () => complete(response()));
  assert.deepEqual(reviews, []);
});
