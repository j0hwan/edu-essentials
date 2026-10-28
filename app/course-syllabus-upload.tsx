"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { CloudUpload, FileText, X } from "lucide-react";
import type { Course } from "../lib/academics";
import { MAX_FILE_BYTES, fileSize } from "../lib/files";
import type { SyllabusAttachmentValue } from "./course-syllabus";
import type { FileStore } from "./use-private-files";
import { useFileUploads, type FileUploadSession } from "./use-file-uploads";
import "./course-syllabus-upload.css";

export function CourseSyllabusUpload({ session, course, store, canWrite, onSave, onClose }: {
  session: FileUploadSession;
  course: Course;
  store: FileStore;
  canWrite: boolean;
  onSave: (value: SyllabusAttachmentValue) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeRequest = useRef<() => void>(() => {});
  const selectionLocked = useRef(false);
  const attached = useRef<string | null>(null);
  const uploads = useFileUploads(session, store, async (file, signal) => {
    signal.throwIfAborted();
    if (attached.current !== file.id) {
      await onSave({ syllabusText: "", syllabusName: file.name, syllabusFileId: file.id });
      signal.throwIfAborted();
      attached.current = file.id;
    }
    await store.refresh(signal, true);
    signal.throwIfAborted();
  }, canWrite);
  const row = uploads.rows[0];
  const busy = uploads.busy || row?.status === "queued";
  const disabled = !canWrite || busy || Boolean(row);
  const requestClose = useCallback(() => {
    if (row && row.status !== "complete" && !window.confirm("Close this unfinished import? Any file already uploaded will remain in Files.")) return;
    onClose();
  }, [row, onClose]);

  useEffect(() => { closeRequest.current = requestClose; }, [requestClose]);
  useEffect(() => { if (row?.status === "complete") onClose(); }, [row?.status, onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRequest.current(); }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      const controls = [...dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex='0']") ?? []];
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => { document.removeEventListener("keydown", handleKey, true); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  const selectFiles = (files: readonly File[]) => {
    if (!canWrite || selectionLocked.current) return;
    if (files.length !== 1) { setError("Choose one syllabus file at a time."); return; }
    if (files[0].size > MAX_FILE_BYTES) { setError("Choose a file up to 25 MiB."); return; }
    setError("");
    selectionLocked.current = true;
    uploads.enqueue(files, { courseId: course.id, folderId: null, kind: "syllabus" });
  };
  const dragFiles = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return false;
    event.preventDefault(); event.stopPropagation();
    return true;
  };

  return <div className="modal-backdrop"><section className="small-modal course-syllabus-upload" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Import syllabus" tabIndex={-1}>
    <div className="modal-header"><div><h2>Import syllabus</h2><p>{course.code} · {course.name}</p></div><button type="button" className="icon-button" ref={closeRef} aria-label="Close syllabus import" onClick={requestClose}><X size={20} /></button></div>
    <div className="course-syllabus-dropzone" data-dragging={dragging || undefined} aria-busy={busy}
      onDragEnter={(event) => { if (dragFiles(event) && !disabled) { dragDepth.current++; setDragging(true); } }}
      onDragOver={(event) => { if (dragFiles(event)) event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
      onDragLeave={(event) => { if (dragFiles(event)) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); } }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false); if (!disabled) selectFiles(Array.from(event.dataTransfer.files)); }}>
      <span className="course-syllabus-upload-icon"><CloudUpload size={34} strokeWidth={1.5} aria-hidden="true" /></span>
      <p className="course-syllabus-dropzone-title">{dragging ? "Drop your syllabus here" : "Choose a file or drag & drop it here"}</p>
      <p className="course-syllabus-dropzone-hint">PDFs, documents, images & text · up to 25 MiB</p>
      <input ref={inputRef} type="file" hidden aria-label="Choose syllabus file" disabled={disabled} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (files.length) selectFiles(files); }} />
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => inputRef.current?.click()}>Browse File</button>
    </div>
    {row && <div className="course-syllabus-upload-status" role="status" aria-live="polite"><FileText size={20} aria-hidden="true" /><div><strong>{row.file.name}</strong><span>{fileSize(row.file.size)} · {busy ? row.acknowledged ? "Saving syllabus…" : `Uploading ${Math.round(row.progress * 100)}%` : row.status === "complete" ? "Imported" : "Import paused"}</span>{busy && <progress max={100} value={Math.round(row.progress * 100)} aria-label="Syllabus upload progress" />}</div>{(row.status === "error" || row.status === "refresh-error") && <button type="button" className="secondary-button" disabled={!canWrite || !row.retryable} onClick={() => { setError(""); void uploads.retry(row.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Retry the import.")); }}>Retry import</button>}</div>}
    {(error || row?.error) && <p className="course-syllabus-upload-error" role="alert">{error || row?.error}</p>}
    {!canWrite && <p className="course-syllabus-upload-error" role="alert">Save or resolve pending workspace changes before importing.</p>}
  </section></div>;
}
