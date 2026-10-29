import { createRoot } from "react-dom/client";
import ClassSetup from "../../app/class-setup";
import { InlineFilePreview } from "../../app/private-files";
import { emptyCourse, emptyCourseDetails } from "../../lib/academics";
import type { PrivateFile } from "../../lib/files";
import type { FileStore } from "../../app/use-private-files";

const longText = Array.from({ length: 100 }, (_, index) =>
  `Week ${index + 1}: Required reading, lecture notes, assignment dates, and course policies. ${"This line checks that saved and uploaded text remains inside its own preview scroll area. ".repeat(2)}`,
).join("\n");

function makeTwoPagePdf() {
  const firstPage = "1 1 1 rg 0 0 300 400 re f\n0 0 1 rg 30 30 100 100 re f\n1 0 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Page 1) Tj ET\n";
  const secondPage = "1 1 1 rg 0 0 300 400 re f\n0 0.8 0 rg 30 30 100 100 re f\n1 0.8 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Page 2) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${firstPage.length} >>\nstream\n${firstPage}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${secondPage.length} >>\nstream\n${secondPage}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

const savedPdf = makeTwoPagePdf();

function savedFileFor(mode: string): PrivateFile {
  const pdf = mode === "inline-pdf";
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: pdf ? "Saved inline syllabus.pdf" : "Saved inline syllabus.txt",
    mime_type: pdf ? "application/pdf" : "text/plain",
    size_bytes: pdf ? savedPdf.size : longText.length,
    course_id: "browser-course",
    assignment_id: null,
    kind: "syllabus",
    state: "ready",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    content_sha256: null,
    folder_id: null,
    content_backend: pdf ? "object" : "native-text",
    metadata_revision: 1,
    content_revision: 1,
    trashed_at: null,
    trash_operation_id: null,
    original_folder_id: null,
  };
}

const savedStore = {
  busy: false,
  blob: async (file: PrivateFile) => file.mime_type === "application/pdf" ? savedPdf : new Blob([longText], { type: "text/plain" }),
  url: () => "/unused-file-url",
} as unknown as FileStore;

function Fixture() {
  const savedMode = new URLSearchParams(window.location.search).get("saved");
  const savedFile = savedMode ? savedFileFor(savedMode) : undefined;
  const course = { ...emptyCourse("browser-course"), code: "BIO 101", name: "Biology" };
  const details = {
    ...emptyCourseDetails(),
    ...(savedFile ? { syllabusName: savedFile.name } : {}),
    ...(savedMode?.startsWith("inline") && savedFile ? { syllabusFileId: savedFile.id } : {}),
    ...(savedMode === "text" ? { syllabusText: longText } : {}),
  };

  return <ClassSetup
    initial={course}
    initialDetails={details}
    today="2026-10-26"
    canUpload={true}
    savedSyllabusPreview={savedFile && savedMode?.startsWith("inline") ? <InlineFilePreview file={savedFile} store={savedStore} /> : undefined}
    onSave={async () => {}}
    onClose={() => {}}
  />;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
