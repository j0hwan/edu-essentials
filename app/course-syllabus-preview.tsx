"use client";

import { useEffect } from "react";
import type { PrivateFile } from "../lib/files";
import { CoursePreviewPlaceholder, useCoursePreviewReveal } from "./course-preview-reveal";
import { InlineFilePreview } from "./private-files";
import type { FileStore } from "./use-private-files";

export default function CourseSyllabusPreview({ file, text, store, previewKey }: {
  file?: PrivateFile;
  text: string;
  store: FileStore;
  previewKey: string;
}) {
  const { revealed, settle } = useCoursePreviewReveal(previewKey);

  useEffect(() => {
    if (!file) settle();
  }, [file, settle]);

  return <div className={`course-syllabus-preview course-preview-surface${revealed ? " is-revealed" : ""}`} aria-busy={!revealed}>
    <CoursePreviewPlaceholder kind="syllabus" />
    {!revealed && <span className="course-preview-status" role="status">Loading Syllabus</span>}
    <div className={`course-preview-content private-class-image-fade${revealed ? " is-ready" : ""}`} aria-hidden={!revealed} inert={!revealed}>
      {file
        ? <InlineFilePreview file={file} store={store} loadingFallback={<></>} onPreviewSettled={settle} />
        : <pre className="syllabus-source">{text}</pre>}
    </div>
  </div>;
}
