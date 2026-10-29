import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import type { PrivateFile } from "../../lib/files";
import type { FileStore } from "../../app/use-private-files";
import { CoursePreviewRevealProvider as RevealProvider } from "../../app/course-preview-reveal";
import ExpandedCourseSkeleton from "../../app/expanded-course-skeleton";
import MeetingLocationPreview from "../../app/meeting-location-preview";
import CourseSyllabusPreview from "../../app/course-syllabus-preview";
import ExpandedCourseImage from "../../app/expanded-course-image";

declare global {
  interface Window {
    __coursePreviewFixture: {
      resolveLocation: (address: string) => void;
      locationRequests: string[];
      releaseSyllabusBlob: () => void;
      pageCount: number;
      blobDelivered: boolean;
      releaseWorkspace?: () => void;
      releaseHeaderImage: () => void;
    };
    __startCourseRestoration?: boolean;
    __unmountCoursePreviewFixture: () => void;
  }
}

function makeTwoPagePdf() {
  const firstPage = "1 1 1 rg 0 0 300 400 re f\n0 0 1 rg 30 30 100 100 re f\n1 0 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Syllabus Page 1) Tj ET\n";
  const secondPage = "1 1 1 rg 0 0 300 400 re f\n0 0.8 0 rg 30 30 100 100 re f\n1 0.8 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Syllabus Page 2) Tj ET\n";
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
  return pdf;
}

const originalFetch = window.fetch.bind(window);
const locationWaiters = new Map<string, Array<(response: Response) => void>>();
const locationRequests: string[] = [];
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), window.location.href);
  if (url.pathname !== "/api/locations") return originalFetch(input, init);
  const address = url.searchParams.get("q") ?? "";
  locationRequests.push(address);
  return new Promise<Response>((resolve) => {
    const waiters = locationWaiters.get(address) ?? [];
    waiters.push(resolve);
    locationWaiters.set(address, waiters);
  });
}) as typeof fetch;

const syllabusPdf = new Blob([makeTwoPagePdf()], { type: "application/pdf" });
let releaseSyllabusBlob: (() => void) | undefined;
const syllabusBlob = new Promise<Blob>((resolve) => { releaseSyllabusBlob = () => resolve(syllabusPdf); });
const syllabus: PrivateFile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Course syllabus.pdf",
  mime_type: "application/pdf",
  size_bytes: syllabusPdf.size,
  course_id: "course-preview-fixture",
  assignment_id: null,
  kind: "syllabus",
  state: "ready",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-08T00:00:00.000Z",
  content_sha256: null,
  folder_id: null,
  content_backend: "object",
  metadata_revision: 1,
  content_revision: 1,
  trashed_at: null,
  deleted_at: null,
  trash_operation_id: null,
  original_folder_id: null,
};
const store = {
  blob: (file: PrivateFile) => file.kind === "class-image" ? headerBlob : syllabusBlob.then((blob) => {
    window.__coursePreviewFixture.blobDelivered = true;
    return blob;
  }),
  url: () => "/private/syllabus.pdf",
} as unknown as FileStore;

const headerImage: PrivateFile = { ...syllabus, id: "22222222-2222-4222-8222-222222222222", kind: "class-image", name: "Course image.png", mime_type: "image/png" };
let releaseHeaderImage: () => void;
const headerBlob = new Promise<Blob>((resolve) => {
  releaseHeaderImage = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#5678ab";
    context.fillRect(0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => resolve(blob!), "image/png");
  };
});

window.__coursePreviewFixture = {
  resolveLocation(address) {
    const resolve = locationWaiters.get(address)?.shift();
    if (!resolve) throw new Error(`No pending location lookup for ${address}.`);
    const coordinates = address.startsWith("202")
      ? { latitude: 38.5365, longitude: -121.747 }
      : { latitude: 38.5449, longitude: -121.7405 };
    resolve({ ok: true, json: async () => ({ locations: [coordinates] }) } as Response);
  },
  locationRequests,
  releaseSyllabusBlob() {
    if (!releaseSyllabusBlob) throw new Error("The syllabus PDF promise is already unavailable.");
    releaseSyllabusBlob();
    releaseSyllabusBlob = undefined;
  },
  pageCount: 2,
  blobDelivered: false,
  releaseHeaderImage: () => releaseHeaderImage(),
};

import { useCoursePreviewPlaceholders } from "../../app/use-course-preview-placeholders";

const participants = ["map-one", "map-two", "syllabus"];
let root: Root | undefined;

function Fixture() {
  const [loading, setLoading] = useState(window.__startCourseRestoration === true);
  useEffect(() => {
    window.__coursePreviewFixture.releaseWorkspace = () => setLoading(false);
  }, []);
  const placeholderAssets = useCoursePreviewPlaceholders(window.__startCourseRestoration === true, "fixture-restoration");
  if (loading || !placeholderAssets.ready) return <ExpandedCourseSkeleton />;
  return <RevealProvider participants={window.__startCourseRestoration ? [...participants, "header"] : participants}>
    <main className="course-preview-fixture">
      <header><p>COURSE PREVIEW</p><h1>Shared reveal</h1><span>Map snapshots and the course syllabus become visible together.</span></header>
      {window.__startCourseRestoration && <div style={{ position: "relative", height: 160 }} data-preview-name="header">
        <div className="course-image-frame" style={{ objectPosition: "25% 65%" }}>
          <ExpandedCourseImage profileId="fixture-profile" courseId="course-preview-fixture" file={headerImage} store={store} filesReady restored cacheEnabled={false} previewKey="header" />
        </div>
      </div>}
      <div className="course-preview-fixture-grid">
        <section className="course-preview-fixture-card" data-preview-name="map-one">
          <h2>Weekly meeting</h2>
          <MeetingLocationPreview location="101 College Ave, Davis, California" previewKey="map-one" />
          <p>101 College Ave, Davis, California</p>
        </section>
        <section className="course-preview-fixture-card" data-preview-name="map-two">
          <h2>Laboratory meeting</h2>
          <MeetingLocationPreview location="202 College Ave, Davis, California" previewKey="map-two" />
          <p>202 College Ave, Davis, California</p>
        </section>
        <section className="course-preview-fixture-card course-preview-fixture-syllabus" data-preview-name="syllabus">
          <h2>Syllabus</h2>
          <div className="course-preview-fixture-syllabus-frame">
            <CourseSyllabusPreview file={syllabus} text="" store={store} previewKey="syllabus" />
          </div>
        </section>
      </div>
    </main>
  </RevealProvider>;
}

root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);

window.__unmountCoursePreviewFixture = () => {
  root?.unmount();
  root = undefined;
  document.getElementById("root")?.replaceChildren();
};
