import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
for (const name of ["window", "document", "Element", "Node", "HTMLElement", "Event", "MouseEvent"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ locations: [{ latitude: 38.5449, longitude: -121.7405 }] }),
});

const inlinePreviewHarness = `
import { createElement, useEffect, useState } from "react";

export function InlineFilePreview({ file, store, onPreviewSettled }) {
  const [stage, setStage] = useState("loading");
  useEffect(() => {
    let active = true;
    Promise.resolve(store.blob(file)).then(
      () => { if (active) setStage("blob-ready"); },
      () => { if (active) setStage("terminal-error"); },
    );
    return () => { active = false; };
  }, [file, store]);
  if (typeof window !== "undefined") window.__syllabusReadinessCallbacks.push(onPreviewSettled);
  if (stage === "loading") return createElement("span", { "data-pdf-stage": "blob-loading" }, "Loading PDF blob");
  if (stage === "blob-ready") return createElement("div", { "data-pdf-stage": "blob-ready" },
    createElement("span", null, "PDF blob received; page is rendering"),
    createElement("button", { type: "button", "data-pdf-stage": "page-ready", onClick: onPreviewSettled }, "Simulate first PDF page painted"));
  return createElement("div", { role: "alert", "data-pdf-stage": "terminal-error" },
    "PDF preview failed", createElement("button", { type: "button", "data-pdf-stage": "error-settled", onClick: onPreviewSettled }, "Acknowledge terminal PDF error"));
}
`;
const resolvedHarness = inlinePreviewHarness.replaceAll('"react"', JSON.stringify(import.meta.resolve("react")));
const harnessUrl = `data:text/javascript;base64,${Buffer.from(resolvedHarness).toString("base64")}`;
const providerUrl = await clientModule("app/course-preview-reveal.tsx");
const mapUrl = await clientModule("app/meeting-location-preview.tsx");
const syllabusSource = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../app/course-syllabus-preview.tsx"), "utf8");
let syllabusCode = ts.transpileModule(syllabusSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const specifier of ["react", "react/jsx-runtime"]) syllabusCode = syllabusCode.replaceAll(JSON.stringify(specifier), JSON.stringify(import.meta.resolve(specifier)));
syllabusCode = syllabusCode
  .replaceAll('"./course-preview-reveal"', JSON.stringify(providerUrl))
  .replaceAll('"./private-files"', JSON.stringify(harnessUrl));
const syllabusUrl = `data:text/javascript;base64,${Buffer.from(syllabusCode).toString("base64")}`;

const [{ createElement, act }, { createRoot }, { CoursePreviewRevealProvider }, { default: MeetingLocationPreview }, { default: CourseSyllabusPreview }] = await Promise.all([
  import("react"), import("react-dom/client"), import(providerUrl), import(mapUrl), import(syllabusUrl),
]);
const rootNode = document.getElementById("root");
let root;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeFile(id = "syllabus-1") {
  return {
    id, name: "Syllabus.pdf", mime_type: "application/pdf", size_bytes: 512, course_id: "course-1", assignment_id: null,
    kind: "syllabus", state: "ready", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z",
    content_sha256: null, folder_id: null, content_backend: "object", metadata_revision: 1, content_revision: 1,
    trashed_at: null, deleted_at: null, trash_operation_id: null, original_folder_id: null,
  };
}

function renderGroup({ revision = "one", location = "101 College Ave, Davis, California", file = makeFile(), store, participants = [`map-a-${revision}`, `map-b-${revision}`, `syllabus-${revision}`] }) {
  root ??= createRoot(rootNode);
  return act(async () => root.render(createElement(CoursePreviewRevealProvider, { key: revision, participants },
    createElement("main", { "data-revision": revision },
      createElement("div", { id: "map-a" }, createElement(MeetingLocationPreview, { location, previewKey: `map-a-${revision}` })),
      createElement("div", { id: "map-b" }, createElement(MeetingLocationPreview, { location: location.replace("101", "202"), previewKey: `map-b-${revision}` })),
      createElement("section", { id: "syllabus-region" }, createElement(CourseSyllabusPreview, { file, text: "", store, previewKey: `syllabus-${revision}` }))))));
}

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function unmount() { if (root) await act(async () => root.unmount()); root = undefined; rootNode.replaceChildren(); }
afterEach(async () => { await unmount(); window.__syllabusReadinessCallbacks = []; });

function surfaces() {
  return [...rootNode.querySelectorAll(".course-preview-surface")];
}

test("two maps and a syllabus reveal together only after both map frames and the PDF first page are ready", async () => {
  await unmount();
  window.__syllabusReadinessCallbacks = [];
  const pdfBlob = deferred();
  const store = { blob: () => pdfBlob.promise };
  await renderGroup({ store });
  await flush();

  assert.equal(surfaces().length, 3, "both maps and the syllabus are coordinated surfaces");
  assert.equal(rootNode.querySelectorAll(".course-preview-placeholder").length, 3, "each preview starts with its own placeholder");
  assert.equal(rootNode.querySelectorAll(".course-preview-content.is-ready").length, 0, "all real previews remain covered initially");

  const mapFrames = [...rootNode.querySelectorAll("iframe[title^='Map preview']")];
  assert.equal(mapFrames.length, 2, "both map frames have loaded their coordinates");
  assert.equal(rootNode.querySelector('[data-pdf-stage="blob-loading"]')?.textContent, "Loading PDF blob");

  await act(async () => pdfBlob.resolve(new Blob(["two-page PDF"] , { type: "application/pdf" })));
  await flush();
  assert.equal(rootNode.querySelector('[data-pdf-stage="blob-ready"]')?.textContent, "PDF blob received; page is renderingSimulate first PDF page painted");
  assert.equal(rootNode.querySelectorAll(".course-preview-content.is-ready").length, 0, "receiving the PDF blob does not release the reveal barrier");

  await act(async () => mapFrames[0].dispatchEvent(new Event("load")));
  assert.equal(rootNode.querySelectorAll(".course-preview-content.is-ready").length, 0, "one completed map cannot reveal any preview");
  await act(async () => mapFrames[1].dispatchEvent(new Event("load")));
  assert.equal(rootNode.querySelectorAll(".course-preview-content.is-ready").length, 0, "the syllabus must still finish its first page");

  await act(async () => rootNode.querySelector('[data-pdf-stage="page-ready"]').click());
  const ready = rootNode.querySelectorAll(".course-preview-content.is-ready");
  assert.equal(ready.length, 3, "the final completion reveals all surfaces in the same React update");
  assert.equal(rootNode.querySelector('[aria-label="Open Google Maps for 101 College Ave, Davis, California"]')?.classList.contains("is-revealed"), true);
  assert.equal(rootNode.querySelector('[aria-label="Open Google Maps for 202 College Ave, Davis, California"]')?.classList.contains("is-revealed"), true);
  assert.equal(rootNode.querySelector(".course-syllabus-preview")?.getAttribute("aria-busy"), "false");
  assert.equal(rootNode.querySelectorAll(".course-preview-placeholder").length, 3, "placeholders remain under the animation while the real previews fade in");
});

test("a callback from an unmounted resource group cannot reveal its replacement", async () => {
  await unmount();
  window.__syllabusReadinessCallbacks = [];
  const staleBlob = deferred();
  await renderGroup({ revision: "old", location: "303 College Ave, Davis, California", file: makeFile("old-syllabus"), store: { blob: () => staleBlob.promise } });
  await flush();
  const staleSettle = window.__syllabusReadinessCallbacks.at(-1);
  assert.equal(typeof staleSettle, "function");

  const currentBlob = deferred();
  await renderGroup({ revision: "new", location: "404 College Ave, Davis, California", file: makeFile("new-syllabus"), store: { blob: () => currentBlob.promise } });
  await flush();
  assert.equal(rootNode.querySelector('[data-revision="new"] .course-preview-content.is-ready'), null);

  await act(async () => staleSettle());
  assert.equal(rootNode.querySelector('[data-revision="new"] .course-preview-content.is-ready'), null, "old callbacks are scoped to the unmounted provider");
  assert.equal(rootNode.querySelector('[data-revision="new"] .course-syllabus-preview')?.getAttribute("aria-busy"), "true");
});

test("unsupported locations and a terminal PDF error settle so the group cannot deadlock", async () => {
  await unmount();
  window.__syllabusReadinessCallbacks = [];
  const store = { blob: async () => { throw new Error("unavailable"); } };
  await renderGroup({ revision: "failure", location: "https://127.0.0.1/private", file: makeFile("failure-syllabus"), store,
    participants: ["map-a-failure", "map-b-failure", "syllabus-failure"] });
  await flush();

  assert.equal(rootNode.querySelectorAll(".meeting-location-preview-fallback").length, 2, "unsupported map locations show readable fallbacks");
  assert.equal(rootNode.querySelectorAll('[data-pdf-stage="terminal-error"]').length, 1, "the PDF reaches a terminal error state");
  await act(async () => rootNode.querySelector('[data-pdf-stage="error-settled"]').click());
  assert.equal(rootNode.querySelectorAll(".course-preview-content.is-ready").length, 3, "terminal failures count as settled and release the full group");
});
