"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Paperclip, Trash2, Upload, X } from "lucide-react";
import type { Course, CourseDetails } from "../lib/academics";
import type { PrivateFile } from "../lib/files";
import { FileEditor, FilePreview } from "./private-files";
import type { FileStore } from "./use-private-files";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
import "./course-syllabus.css";

export type SyllabusAttachmentValue = {
  syllabusText: string;
  syllabusName: string;
  syllabusFileId?: string;
};

type SyllabusAttachmentProps = {
  courseId: string;
  course: Course;
  details: CourseDetails;
  folderId: string | null;
  store: FileStore;
  canWrite: boolean;
  onSave: (value: SyllabusAttachmentValue) => Promise<void>;
  onClose: () => void;
};

function isCourseSyllabus(file: PrivateFile, courseId: string) {
  return file.course_id === courseId && file.kind === "syllabus" && !file.assignment_id;
}

function isSyllabusFile(file: PrivateFile) {
  return file.kind === "syllabus";
}

function fileUnavailableReason(file: PrivateFile) {
  if (file.trashed_at) return "In Trash";
  if (file.state === "pending") return "Upload pending";
  if (file.state === "deleting") return "Deletion pending";
  return "Ready";
}

export function SyllabusAttachment({ courseId, course, details, folderId, store, canWrite, onSave, onClose }: SyllabusAttachmentProps) {
  const [openedForCourseId] = useState(course.id);
  const [draft, setDraft] = useState(() => ({
    syllabusText: details.syllabusText ?? "",
    syllabusName: details.syllabusName ?? "",
    syllabusFileId: details.syllabusFileId ?? "",
  }));
  const [fileEditorOpen, setFileEditorOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<PrivateFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const courseIdRef = useRef(courseId);
  const requestCloseRef = useRef<() => void>(() => {});
  const dialogRef = useRef<HTMLFormElement>(null);
  const nestedDialogContainerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const nestedTriggerRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [initialDraft] = useState(() => ({
    syllabusText: details.syllabusText ?? "",
    syllabusName: details.syllabusName ?? "",
    syllabusFileId: details.syllabusFileId ?? "",
  }));
  const dirty = draft.syllabusText !== initialDraft.syllabusText
    || draft.syllabusName !== initialDraft.syllabusName
    || draft.syllabusFileId !== initialDraft.syllabusFileId;
  const availableForCourse = courseId === course.id && course.id === openedForCourseId;
  const nestedDialogOpen = fileEditorOpen || Boolean(previewFile);
  const referencedFile = draft.syllabusFileId
    ? store.files.find((file) => file.id === draft.syllabusFileId)
    : undefined;
  const referenceMismatch = Boolean(referencedFile && !isSyllabusFile(referencedFile));
  const sourceFile = referencedFile && !referenceMismatch ? referencedFile : undefined;
  const sourceCanPreview = Boolean(sourceFile && sourceFile.state === "ready" && !sourceFile.trashed_at);

  useSaveProtection(dirty || saving);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (!dirty || window.confirm("Close without saving this syllabus draft? Download the draft first if you want to keep your changes.")) onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => { courseIdRef.current = courseId; }, [courseId]);

  useEffect(() => {
    if (nestedDialogOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = nestedTriggerRef.current;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else closeButtonRef.current?.focus({ preventScroll: true });
    nestedTriggerRef.current = null;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [nestedDialogOpen]);

  useEffect(() => {
    if (!nestedDialogOpen) return;
    const container = nestedDialogContainerRef.current;
    const dialog = container?.querySelector<HTMLElement>("[role='dialog']");
    if (!dialog) return;
    const getFocusable = () => [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])")];
    const closeButton = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => /^Close\b/i.test(button.textContent?.trim() ?? ""));
    (closeButton ?? getFocusable()[0])?.focus({ preventScroll: true });
    const handleNestedKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeButton?.click();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleNestedKey, true);
    return () => document.removeEventListener("keydown", handleNestedKey, true);
  }, [nestedDialogOpen]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !availableForCourse) return;
    if (referenceMismatch) {
      setError("This uploaded file is not marked as a syllabus. Detach it or attach a syllabus file before saving.");
      return;
    }
    setSaving(true);
    setError("");
    const saveCourseId = course.id;
    try {
      const value: SyllabusAttachmentValue = {
        syllabusText: draft.syllabusText,
        syllabusName: draft.syllabusName,
        ...(draft.syllabusFileId ? { syllabusFileId: draft.syllabusFileId } : {}),
      };
      await onSave(value);
      if (mounted.current && courseIdRef.current === saveCourseId) onClose();
    } catch (saveError) {
      if (mounted.current && courseIdRef.current === saveCourseId) {
        setError(saveError instanceof Error && saveError.message ? saveError.message : "The syllabus could not be saved. Your draft is still here; retry when the workspace is ready.");
      }
    } finally {
      if (mounted.current && courseIdRef.current === saveCourseId) setSaving(false);
    }
  };

  const handleFileSaved = (file: PrivateFile) => {
    if (!isCourseSyllabus(file, course.id)) {
      setError("The uploaded file was not saved as a syllabus for this course, so it was left unattached. Upload a syllabus file to attach it.");
      return;
    }
    setDraft((current) => ({ ...current, syllabusFileId: file.id, syllabusName: file.name }));
    setError("");
  };

  const closeButtonLabel = fileEditorOpen ? "Close syllabus upload" : "Close syllabus editor";

  return <>
    <div className="modal-backdrop">
      <form ref={dialogRef} className="add-class-modal academic-editor syllabus-attachment-modal" role="dialog" aria-modal="true" aria-hidden={nestedDialogOpen || undefined} inert={nestedDialogOpen} aria-label={`Attach syllabus for ${course.code || course.name}`} onSubmit={handleSave}>
        <div className="modal-header">
          <div><p>{course.code || "Course"} · {course.name}</p><h2>Course syllabus</h2></div>
          <button ref={closeButtonRef} type="button" className="secondary-button" disabled={saving} onClick={requestClose}>{closeButtonLabel}</button>
        </div>
        <p className="form-hint">Keep syllabus text, an uploaded source file, or both. Uploaded files stay in your private Files library.</p>

        <label className="syllabus-field">Syllabus name
          <input disabled={saving} maxLength={255} value={draft.syllabusName} onChange={(event) => setDraft((current) => ({ ...current, syllabusName: event.target.value }))} placeholder="Course syllabus" />
        </label>
        <label className="syllabus-field">Syllabus text
          <textarea disabled={saving} maxLength={60000} value={draft.syllabusText} onChange={(event) => setDraft((current) => ({ ...current, syllabusText: event.target.value }))} placeholder="Paste syllabus text here…" />
        </label>
        <p className="form-hint">Up to 60,000 characters. Text is stored with this course and is not used to create assignments or edit course details.</p>

        <section className="syllabus-source-card" aria-label="Uploaded syllabus source">
          <div className="syllabus-source-card-copy">
            <Paperclip size={17} aria-hidden="true" />
            <div><strong>{draft.syllabusFileId ? sourceFile?.name ?? "Uploaded syllabus reference" : "No uploaded source file"}</strong>
              <small>{sourceFile ? `${sourceFile.kind} · ${fileUnavailableReason(sourceFile)}` : draft.syllabusFileId ? "The referenced upload is unavailable in this file list." : "Upload an original file to keep it with this course."}</small>
            </div>
          </div>
          <div className="syllabus-source-card-actions">
            {sourceCanPreview && sourceFile && <button type="button" className="secondary-button" disabled={saving} onClick={(event) => { nestedTriggerRef.current = event.currentTarget; setPreviewFile(sourceFile); }}><FileText size={15} /> Preview source</button>}
            {draft.syllabusFileId && <button type="button" className="secondary-button" disabled={saving} onClick={() => { setDraft((current) => ({ ...current, syllabusFileId: "" })); setError(""); }}><Trash2 size={15} /> Detach file</button>}
            <button type="button" className="secondary-button" disabled={saving || !canWrite || store.busy || !availableForCourse} title={!canWrite ? "Uploads are unavailable while workspace changes need to be resolved." : "Upload a new syllabus source"} onClick={(event) => { nestedTriggerRef.current = event.currentTarget; setError(""); setFileEditorOpen(true); }}><Upload size={15} /> {draft.syllabusFileId ? "Replace upload" : "Upload source"}</button>
          </div>
          {referenceMismatch && <p className="syllabus-inline-error" role="alert">The saved file reference is not marked as a syllabus. Detach it or replace it before saving.</p>}
        </section>

        {!availableForCourse && <p className="syllabus-inline-error" role="alert">This editor no longer matches the selected course. Download your draft, then close and reopen the syllabus editor.</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => downloadDraft("eduessentials-syllabus-draft.json", { courseId: openedForCourseId, ...draft })}><Download size={15} /> Download draft</button>
          <button type="submit" className="primary-button" disabled={saving || !availableForCourse}>{saving ? "Saving syllabus…" : "Save syllabus"}</button>
        </div>
      </form>
    </div>

    {fileEditorOpen && <div ref={nestedDialogContainerRef} className="syllabus-nested-dialog">
      <FileEditor
        store={store}
        courses={[course]}
        assignments={[]}
        defaults={{ kind: "syllabus", courseId, assignmentId: "", folderId }}
        onSaved={handleFileSaved}
        canWrite={canWrite}
        onClose={() => setFileEditorOpen(false)}
      />
    </div>}
    {previewFile && <div ref={nestedDialogContainerRef} className="syllabus-nested-dialog"><FilePreview file={previewFile} store={store} onClose={() => setPreviewFile(null)} onEdit={() => {}} canWrite={false} /></div>}
  </>;
}

function safeTextFilename(name: string, course: Course) {
  const replaceUnsafe = (value: string) => [...value].map((character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code < 32 || code === 127 ? "-" : character;
  }).join("");
  const fallback = replaceUnsafe(course.code || course.name || "syllabus").trim() || "syllabus";
  const cleaned = replaceUnsafe(name || fallback).replace(/[. ]+$/, "").trim();
  const stem = cleaned.replace(/\.[^.]*$/, "").trim() || fallback;
  return `${stem.slice(0, 240)}.txt`;
}

export function SyllabusTextPreview({ course, text, name, onClose }: { course: Course; text: string; name: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeCallbackRef = useRef(onClose);
  const urlsRef = useRef(new Set<string>());
  const timersRef = useRef(new Set<number>());

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const urls = urlsRef.current;
    const timers = timersRef.current;
    closeRef.current?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCallbackRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => { closeCallbackRef.current = onClose; }, [onClose]);

  const downloadText = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    urlsRef.current.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeTextFilename(name, course);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(url);
      timersRef.current.delete(timer);
    }, 1000);
    timersRef.current.add(timer);
  };

  return <div className="modal-backdrop">
    <section ref={dialogRef} className="add-class-modal academic-editor syllabus-text-preview" role="dialog" aria-modal="true" aria-labelledby="syllabus-preview-title" tabIndex={-1}>
      <div className="modal-header"><div><p>{course.code || "Course"} · {course.name}</p><h2 id="syllabus-preview-title">{name || "Syllabus text"}</h2></div><button ref={closeRef} type="button" className="secondary-button" onClick={onClose}><X size={15} /> Close preview</button></div>
      <pre className="syllabus-text-preview-content">{text}</pre>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={downloadText}><Download size={15} /> Download .txt</button></div>
    </section>
  </div>;
}

export function PinnedSyllabus({ course, details, file, onOpen, onText, onAttach, canWrite }: { course: Course; details: CourseDetails; file?: PrivateFile; onOpen: (file: PrivateFile) => void; onText: () => void; onAttach: () => void; canWrite: boolean }) {
  const hasReference = Boolean(details.syllabusFileId);
  const referenceMatches = Boolean(file && file.id === details.syllabusFileId && isSyllabusFile(file));
  const available = Boolean(referenceMatches && file && file.state === "ready" && !file.trashed_at);
  const hasText = Boolean(details.syllabusText);
  const matchedFile = referenceMatches ? file : undefined;
  const unavailableStatus = matchedFile ? fileUnavailableReason(matchedFile) : "Referenced upload unavailable";

  return <article className="files-item files-syllabus-pin" role="listitem" aria-label={`${course.code || course.name} syllabus`}>
    <div className="files-syllabus-pin-main">
      <span className="files-syllabus-pin-icon" aria-hidden="true"><FileText size={18} /></span>
      <div className="files-syllabus-pin-copy">
        <strong>Syllabus</strong>
        {available && matchedFile
          ? <><span title={matchedFile.name}>{matchedFile.name}</span><small>Uploaded file · Ready</small></>
          : hasReference
            ? <><span title={matchedFile?.name}>{matchedFile?.name ?? "Uploaded syllabus reference"}</span><small className="is-unavailable">{unavailableStatus}</small></>
            : hasText
              ? <><span>{details.syllabusName || "Saved syllabus text"}</span><small>Text only · Read-only</small></>
              : <><span>No syllabus attached</span><small>Upload a file or save syllabus text for this course.</small></>}
      </div>
    </div>
    <div className="files-syllabus-pin-actions">
      {available && matchedFile && <button type="button" className="files-secondary-button" onClick={() => onOpen(matchedFile)}>View uploaded file</button>}
      {hasText && <button type="button" className={available ? "files-secondary-button" : "files-new-button"} onClick={onText}>{available ? "View text" : "View syllabus text"}</button>}
      {hasReference || hasText ? <button type="button" className="files-secondary-button" disabled={!canWrite} title={!canWrite ? "Uploads are unavailable in this folder or workspace." : "Replace the syllabus upload"} onClick={onAttach}>{hasReference ? "Replace upload" : "Add uploaded file"}</button> : <button type="button" className="files-secondary-button" disabled={!canWrite} title={!canWrite ? "Uploads are unavailable in this folder or workspace." : "Upload a syllabus"} onClick={onAttach}><Upload size={15} /> Upload syllabus</button>}
    </div>
  </article>;
}
