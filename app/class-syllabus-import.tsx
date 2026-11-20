"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { FileText, X } from "lucide-react";
import { emptyCourse } from "../lib/academics";
import { MAX_SYLLABUS_IMPORT_BYTES, MAX_SYLLABUS_IMPORT_MIB } from "../lib/files";
import type { SyllabusImportDraft } from "../lib/syllabus-import";
import ClassSetup, { type ClassSetupUpload } from "./class-setup";
import { getClassSetupBounds, useClassSetupMotion, type ClassSetupBounds } from "./use-class-setup-motion";
import { useSaveProtection } from "./use-save-protection";
import "./course-syllabus-upload.css";

const pendingCourse = emptyCourse("");

export default function ClassSyllabusImport({ profileId, canImport, initialBounds, review, today, canUpload, onReview, onSave, onClose, onBack }: {
  profileId: string;
  canImport: boolean;
  initialBounds?: ClassSetupBounds;
  review?: SyllabusImportDraft;
  today: string;
  canUpload: boolean;
  onReview: (draft: SyllabusImportDraft) => void;
  onSave: ComponentProps<typeof ClassSetup>["onSave"];
  onClose: () => void;
  onBack: (bounds?: ClassSetupBounds) => void;
}) {
  const [scan, setScan] = useState<{ upload: ClassSetupUpload; bounds?: ClassSetupBounds }>();
  const [uploadBounds, setUploadBounds] = useState(initialBounds);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const analyze = async (file: File, bounds?: ClassSetupBounds) => {
    if (!canImport || active.current) return;
    if (!scan) setScan({ upload: { file, id: crypto.randomUUID() }, bounds });
    const controller = new AbortController();
    active.current = controller;
    setError("");
    try {
      const response = await fetch("/api/ai/syllabus-import", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "content-type": "application/pdf", "x-profile-id": profileId }, body: file,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
      });
      const draft = await response.json() as SyllabusImportDraft & { error?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) throw new Error("Sign in to the original account in a new tab, then retry.");
      if (!response.ok || !draft.course || !draft.details || !Array.isArray(draft.assignments)) throw new Error(draft.error || "The syllabus could not be read. Try again or continue manually.");
      onReview(draft);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error && error.name !== "TimeoutError"
        ? error.message : "Reading took too long. Try again or continue manually.");
    } finally {
      if (active.current === controller) active.current = null;
    }
  };

  if (!scan) return <SyllabusUploadDialog canImport={canImport} initialBounds={uploadBounds} onRead={analyze} onBack={onBack} />;
  return <ClassSetup
    initial={review?.course ?? pendingCourse}
    initialDetails={review?.details}
    initialAssignments={review?.assignments}
    initialSyllabus={scan.upload}
    initialBounds={scan.bounds}
    review={review}
    analysis={review ? undefined : {
      error,
      canRetry: Boolean(error && canImport),
      onRetry: () => { void analyze(scan.upload.file); },
      onChooseAnother: (bounds) => {
        setUploadBounds(bounds);
        setScan(undefined);
        setError("");
      },
      onCancel: (bounds) => {
        active.current?.abort();
        onBack(bounds);
      },
    }}
    today={today}
    canUpload={canUpload}
    onSave={onSave}
    onClose={onClose}
  />;
}

function SyllabusUploadDialog({ canImport, initialBounds, onRead, onBack }: {
  canImport: boolean;
  initialBounds?: ClassSetupBounds;
  onRead: (file: File, bounds?: ClassSetupBounds) => void;
  onBack: (bounds?: ClassSetupBounds) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const transition = useClassSetupMotion(form, null, initialBounds);
  const fileInput = useRef<HTMLInputElement>(null);
  const close = () => transition(onBack);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useSaveProtection(Boolean(file));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = form.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? form.current?.querySelector("button");
    target?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = form.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (!form.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return <div className="modal-backdrop"><form className="small-modal course-syllabus-upload class-syllabus-import" ref={form}
    data-morphing-entry={initialBounds ? true : undefined}
    role="dialog" aria-modal="true" aria-labelledby="class-syllabus-import-title"
    onSubmit={(event) => {
      event.preventDefault();
      if (file && canImport && !form.current?.hasAttribute("inert")) onRead(file, form.current ? getClassSetupBounds(form.current) : undefined);
    }}>
    <div className="modal-header">
      <h2 id="class-syllabus-import-title">Scan Syllabus</h2>
      <button className="icon-button" type="button" aria-label="Close syllabus scan" onClick={close}><X size={20} /></button>
    </div>
    <div className={`class-setup-syllabus-upload${file ? " has-file" : ""}`}>
      <label className="class-setup-syllabus-upload-surface">
        <FileText size={24} aria-hidden="true" />
        <span className="class-setup-syllabus-upload-details" role="status" aria-atomic="true">
          <strong className="class-setup-syllabus-upload-title">{file ? "Upload Successful" : "Upload your syllabus"}</strong>
          <small id="class-syllabus-import-file-detail">{file?.name ?? `PDF only · Up to ${MAX_SYLLABUS_IMPORT_MIB} MiB`}</small>
        </span>
        <input ref={fileInput} type="file" accept=".pdf,application/pdf" disabled={!canImport}
          aria-label="Upload your syllabus" aria-describedby="class-syllabus-import-file-detail"
          title={file?.name ?? "Choose a syllabus PDF"} onChange={(event) => {
            const next = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!next) return;
            setError("");
            setFile(null);
            if (!next.size || next.size > MAX_SYLLABUS_IMPORT_BYTES) { setError(`Choose a nonempty PDF up to ${MAX_SYLLABUS_IMPORT_MIB} MiB.`); return; }
            if (next.type !== "application/pdf" && !/\.pdf$/i.test(next.name)) { setError("Choose a PDF syllabus."); return; }
            setFile(next);
          }} />
      </label>
      {file && <button type="button" className="class-setup-syllabus-remove" aria-label="Remove syllabus"
        title="Remove syllabus" disabled={!canImport} onClick={() => {
          setFile(null);
          setError("");
          fileInput.current?.focus();
        }}><X size={14} aria-hidden="true" /></button>}
    </div>
    {!canImport && <p className="form-hint">Automatic import is unavailable in this workspace.</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    <div className="modal-actions">
      <button type="button" className="secondary-button" onClick={close}>Back</button>
      <button type="submit" className="primary-button" disabled={!file || !canImport}>Read syllabus</button>
    </div>
  </form></div>;
}
