import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
import { econSyllabusExtraction } from "./fixtures/econ-syllabus-extraction.mjs";

const { buildSyllabusDraft, syllabusExtractionSchema } = await import(await clientModule("lib/syllabus-import.ts"));
const { extractSyllabusDraft, inspectSyllabusPdf, readSyllabusDocument } = await import(await clientModule("lib/ai/syllabus-import.ts"));
const { GeminiProvider, ProviderError } = await import(await clientModule("lib/ai/provider.ts"));
const { academicSnapshot } = await import(await clientModule("lib/academic-snapshot.ts"));
const { encodeWorkspaceState, decodeWorkspaceState } = await import(await clientModule("lib/workspace-codec.ts"));

const today = "2026-09-20";
const convert = (fixture = econSyllabusExtraction) => buildSyllabusDraft(syllabusExtractionSchema.parse(fixture), 6, today);

test("Econ 1 prefill preserves the five section options, exact deadlines, and exam windows", () => {
  const draft = convert();
  assert.equal(draft.course.code, "ECON 1");
  assert.equal(draft.course.name, "Principles of Microeconomics");
  assert.equal(draft.creditsUnknown, true);
  assert.equal(draft.details.syllabusTerm, "Fall Quarter 2026");
  assert.match(draft.details.officeHours, /Canvas/);
  assert.match(draft.details.syllabusNotes, /42%/);
  assert.equal(draft.details.meetings.length, 1);
  const [lecture] = draft.details.meetings;
  assert.deepEqual(lecture.days, [1, 3, 5]);
  assert.equal(lecture.from, "");
  assert.equal(lecture.until, "");
  assert.equal(draft.alternatives.length, 5);
  assert.ok(draft.alternatives.every(({ timing }) => timing === "Starts in week 2"));
  assert.deepEqual(draft.details.gradingCategories.map(({ weight }) => weight), [3, 10, 20, 20, 47]);
  assert.equal(draft.assignments.length, 12);
  assert.deepEqual(draft.assignments.filter(({ type }) => type === "Exam").map(({ dateKey, examStart, examEnd }) =>
    [dateKey, examStart, examEnd]), [["2026-10-16", "10:00", "10:50"], ["2026-11-13", "10:00", "10:50"], ["2026-12-11", "08:00", "10:59"]]);
  const groups = ["2026-10-16", "2026-10-16", "2026-11-13", "2026-11-13", ...Array(4).fill("2026-12-07")];
  const sets = draft.assignments.filter((assignment) => assignment.title.startsWith("Problem Set"));
  assert.deepEqual(sets.map(({ dateKey }) => dateKey), groups);
  assert.ok(sets.every(({ dueTime, categoryId }) => dueTime === "23:59" && categoryId === draft.details.gradingCategories[1].id));
  assert.deepEqual(draft.sources.tasks, [3, 4, 5, 6]);

  // The reviewed data round-trips through the same snapshot codec used by workspace saves and reloads.
  draft.course.credits = 4;
  draft.details.meetings[0] = { ...lecture, from: "2026-09-25", until: "2026-12-04" };
  draft.details.syllabusFileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const snapshot = academicSnapshot([draft.course], encodeWorkspaceState([{ id: "my-day", name: "My Day", widgets: [] }], "my-day", "", {
    assignments: draft.assignments, manualEvents: [], dashboardView: "cards", courseDetails: { [draft.course.id]: draft.details },
  }));
  const saved = decodeWorkspaceState(JSON.parse(JSON.stringify(snapshot.dashboard))).data;
  assert.equal(saved.courseDetails[draft.course.id].syllabusFileId, draft.details.syllabusFileId);
  assert.equal(saved.assignments.find(({ examEnd }) => examEnd === "10:59").dateKey, "2026-12-11");
  assert.equal(saved.manualEvents.length, 0);
});

test("conflicting exam dates and weekday or term mismatches remain open for review", () => {
  const fixture = structuredClone(econSyllabusExtraction);
  fixture.tasks.push(
    { title: "Midterm 1", type: "Exam", date: "2026-10-23", pages: [4] },
    { title: "Weekday conflict", type: "Assignment", date: "2026-10-20", weekday: 5, pages: [1] },
    { title: "Unexpected year", type: "Assignment", date: "2028-10-01", pages: [1] },
    { title: "Explicit future date", type: "Assignment", date: "2027-01-10", explicitYear: true, pages: [1] },
  );
  const draft = convert(fixture);
  assert.equal(draft.assignments.find(({ title }) => title === "Midterm Exam 1").dateKey, "");
  assert.equal(draft.assignments.find(({ title }) => title === "Weekday conflict").dateKey, "");
  assert.equal(draft.assignments.find(({ title }) => title === "Unexpected year").dateKey, "");
  assert.equal(draft.assignments.find(({ title }) => title === "Explicit future date").dateKey, "2027-01-10");
  assert.ok(draft.warnings.some(({ message }) => /conflicting dates/.test(message)));
});

function pdf(content) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = source.length;
    source += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

test("PDF ingestion preserves layout-order rows and falls back to Gemini vision for image-only input", async () => {
  const bytes = pdf("BT /F1 12 Tf 1 0 0 1 420 650 Tm (30%) Tj 1 0 0 1 90 650 Tm (Homework category) Tj 1 0 0 1 90 730 Tm (Sample fictional syllabus with grading weights and assignments) Tj ET");
  const parsed = await inspectSyllabusPdf(bytes);
  assert.equal(parsed.pageCount, 1);
  assert.match(parsed.parts[0].text, /^\[Page 1\].*fictional syllabus.*Homework category.*30%/s);
  const scan = await inspectSyllabusPdf(pdf("0 0 150 150 re S"));
  assert.equal(scan.parts[0].inlineData.mimeType, "application/pdf");
  assert.match(atob(scan.parts[0].inlineData.data), /^%PDF/);
  await assert.rejects(readSyllabusDocument(new Request("https://edu.example/api/ai/syllabus-import", {
    method: "POST", body: "pretend", headers: { "content-type": "application/pdf" },
  })), (error) => error.status === 415);
  await assert.rejects(inspectSyllabusPdf(new TextEncoder().encode("%PDF-1.4\ninvalid")), (error) => error.status === 422);
});

test("syllabus ingestion rejects more than 12 MiB before PDF parsing", async () => {
  const url = "https://edu.example/api/ai/syllabus-import";
  const limit = 12 * 1024 * 1024;
  const headers = { "content-type": "application/pdf" };
  const tooLarge = (error) => error.status === 413 && /12 MiB/.test(error.message);
  await assert.rejects(readSyllabusDocument(new Request(url, {
    method: "POST", body: "oversized", headers: { ...headers, "content-length": String(limit + 1) },
  })), tooLarge);

  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readSyllabusDocument(new Request(url, { method: "POST", headers, body, duplex: "half" })), tooLarge);
  assert.equal(cancelled, true);
});

test("Gemini uses a bounded structured extraction request, surfaces quota, and rejects malformed output", async () => {
  const document = { pageCount: 6, parts: [{ text: "[Page 1] An example syllabus" }], inputTokens: 1000 };
  const provider = new GeminiProvider("placeholder-key", "configured-test-model", async (url, request) => {
    assert.match(url, /configured-test-model:generateContent$/);
    assert.equal(request.headers["x-goog-api-key"], "placeholder-key");
    const body = JSON.parse(request.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.ok(body.generationConfig.responseJsonSchema.properties.tasks);
    assert.ok(!("tools" in body));
    return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: "internal" }, { text: JSON.stringify(econSyllabusExtraction) }] } }] });
  });
  assert.equal((await extractSyllabusDraft(provider, document, today)).assignments.length, 12);
  const quota = new GeminiProvider("placeholder-key", "configured-test-model", async () => new Response(null, { status: 429 }));
  await assert.rejects(extractSyllabusDraft(quota, document, today), (error) => error instanceof ProviderError && error.status === 429);
  await assert.rejects(extractSyllabusDraft({ generateDocument: async () => ({ content: { parts: [{ text: '{"tasks":7}' }] } }) }, document, today),
    (error) => error instanceof ProviderError && error.status === 502);
});

test("the supplied Econ 1 PDF retains the grading table and dated deadlines in extracted pages", { skip: !process.env.ECON_SYLLABUS_TEST_PDF }, async () => {
  const document = await inspectSyllabusPdf(new Uint8Array(await readFile(process.env.ECON_SYLLABUS_TEST_PDF)));
  assert.equal(document.pageCount, 6);
  const text = document.parts[0].text;
  assert.match(text, /Syllabus Quiz \(10\/4\)\s+3%/);
  assert.match(text, /Problem Sets\s+10%/);
  assert.match(text, /Comprehensive Final Exam \(12\/11\)\s+47%/);
  assert.match(text, /004-005.*Center Hall Room 214/);
  assert.match(text, /Problem Sets 5&6&7&8 due Monday \(12\/7\) at 11:59 pm/);
});
