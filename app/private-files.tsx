"use client";
/* eslint-disable @next/next/no-img-element -- Private authenticated blob URLs cannot use the public image optimizer. */
import { useEffect, useState } from "react";
import { fileKinds, fileMetadata, fileSize, MAX_FILE_BYTES, type FileMetadata, type PrivateFile } from "../lib/files";
import type { Course } from "../lib/academics";
import type { SavedAssignment } from "../lib/workspace-codec";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
import type { FileStore } from "./use-private-files";

export function FileEditor({ store, courses, assignments, initial, defaults, onClose, onSaved, canWrite }: { store: FileStore; courses: Course[]; assignments: SavedAssignment[]; initial?: PrivateFile; defaults?: Partial<FileMetadata>; onClose: () => void; onSaved?: (file: PrivateFile) => void; canWrite: boolean }) {
  const base = { name: initial?.name ?? "", courseId: initial?.course_id ?? "", assignmentId: initial?.assignment_id ?? "", kind: initial?.kind ?? "resource", ...defaults } as FileMetadata;
  const [metadata, setMetadata] = useState(base), [file, setFile] = useState<File | null>(null), [id] = useState(() => initial?.id ?? crypto.randomUUID()), [error, setError] = useState("");
  const [reserved, setReserved] = useState(initial?.state === "pending");
  const upload = !initial || initial.state === "pending", dirty = !!file || JSON.stringify(metadata) !== JSON.stringify(base);
  useSaveProtection(dirty || store.busy);
  return <div className="modal-backdrop"><form className="add-class-modal academic-editor" role="dialog" aria-modal="true" aria-label="File editor" onSubmit={async (e) => {
    e.preventDefault(); if (!canWrite || store.busy) return;
    try {
      if (upload && !file) throw new Error("Choose the original file to upload or retry.");
      fileMetadata(metadata);
      if (upload) setReserved(true);
      const saved = upload ? await store.upload(file!, metadata, id) : await store.edit(initial!, metadata);
      if (saved) onSaved?.(saved); setFile(null); onClose();
    } catch (error) { setError((error as Error).message); }
  }}><div className="modal-header"><h2>{upload ? "Upload private file" : "Edit file details"}</h2><button type="button" className="secondary-button" disabled={store.busy} onClick={() => { if (!dirty || window.confirm("Discard this file selection and unapplied details?")) onClose(); }}>Close file editor</button></div><fieldset disabled={store.busy}>
    {upload && <label>Choose file<input type="file" accept={metadata.kind === "class-image" ? "image/png,image/jpeg,image/gif,image/webp" : undefined} onChange={(e) => { const selected = e.target.files?.[0]; if (selected) { if (selected.size > MAX_FILE_BYTES) { setError("Choose a file up to 25 MiB."); return; } setFile(selected); if (!initial && !reserved) setMetadata({ ...metadata, name: selected.name }); setError(""); } }} /></label>}
    <fieldset disabled={reserved}>
    <label>File name<input required maxLength={255} value={metadata.name} onChange={(e) => setMetadata({ ...metadata, name: e.target.value })} /></label><label>File class<select value={metadata.courseId} onChange={(e) => setMetadata({ ...metadata, courseId: e.target.value, assignmentId: "" })}><option value="">Personal</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label><label>File kind<select value={metadata.kind} onChange={(e) => setMetadata({ ...metadata, kind: e.target.value as FileMetadata["kind"] })}>{fileKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Attached assignment<select value={metadata.assignmentId} onChange={(e) => { const assignment = assignments.find((a) => a.id === e.target.value); setMetadata({ ...metadata, assignmentId: e.target.value, courseId: assignment?.courseId ?? metadata.courseId, kind: assignment ? "attachment" : metadata.kind }); }}><option value="">None</option>{assignments.map((a) => <option key={a.id} value={a.id}>{a.title} · {courses.find((c) => c.id === a.courseId)?.code ?? "Personal"}</option>)}</select></label>
    </fieldset>{reserved && <p className="form-hint">Retry the original file with these reserved details. You can edit its details after the upload finishes. To start over, close this editor and remove any pending upload from Files.</p>}
    <p className="form-hint">Private to your account · maximum 25 MiB per file. Newest class image is used on its class card. Save new classes or assignments before attaching a file.</p>{!canWrite && <p role="alert">Save or resolve pending workspace changes first.</p>}{error && <p role="alert" className="auth-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => downloadDraft("eduessentials-file-details.json", metadata)}>Download file details draft</button><button className="primary-button" disabled={!canWrite || store.busy}>{store.busy ? "Saving file…" : upload ? "Upload / retry file" : "Save file details"}</button></div></fieldset></form></div>;
}

export function PrivateImage({ file, store }: { file: PrivateFile; store: FileStore }) {
  const [url, setUrl] = useState("");
  const blob = store.blob;
  useEffect(() => { const controller = new AbortController(); let owned = ""; void blob(file, controller.signal).then((data) => { if (!controller.signal.aborted) { owned = URL.createObjectURL(data); setUrl(owned); } }).catch(() => {}); return () => { controller.abort(); if (owned) URL.revokeObjectURL(owned); }; }, [file.id, file.updated_at, blob, file]);
  return url ? <img className="private-class-image" src={url} alt={file.name} /> : null;
}
export function FilePreview({ file, store, onClose, onEdit, onReview, canWrite }: { file: PrivateFile; store: FileStore; onClose: () => void; onEdit: () => void; onReview?: (file: PrivateFile, text: string) => void; canWrite: boolean }) {
  const [url, setUrl] = useState(""), [text, setText] = useState(""), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const blob = store.blob;
  useEffect(() => {
    const controller = new AbortController(); let owned = "";
    if (file.state !== "ready") return;
    void blob(file, controller.signal).then(async (data) => { const content = file.mime_type === "text/plain" && data.size <= 1000000 ? await data.text() : ""; if (!controller.signal.aborted) { owned = URL.createObjectURL(data); setUrl(owned); setText(content); setError(""); } }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => { controller.abort(); if (owned) URL.revokeObjectURL(owned); };
  }, [file, blob, attempt]);
  return <div className="modal-backdrop"><section className="add-class-modal academic-editor" role="dialog" aria-modal="true" aria-label="Private file preview"><div className="modal-header"><h2>{file.name}</h2><button className="secondary-button" onClick={onClose}>Close file preview</button></div><p>{fileSize(Number(file.size_bytes))} · {file.kind} · {file.state}</p>
    {file.state !== "ready" ? <p>Upload or deletion is pending. Retry it from Files.</p> : error ? <p role="alert">{error}<button onClick={() => setAttempt((n) => n + 1)}>Retry preview</button></p> : !url ? <p>Loading private preview…</p> : file.mime_type.startsWith("image/") ? <img className="private-preview-image" src={url} alt={file.name} /> : file.mime_type === "application/pdf" ? <iframe title={file.name} className="private-pdf-preview" sandbox="" src={url} /> : file.mime_type === "text/plain" && file.size_bytes <= 1000000 ? <pre className="syllabus-source">{text}</pre> : <p>Download this file to open it in a compatible application.</p>}
    <div className="modal-actions">{file.state === "ready" && <a className="secondary-button" href={store.url(file)} download>Download original file</a>}{url && ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"].includes(file.mime_type) && <a className="secondary-button" href={url} target="_blank" rel="noopener noreferrer">Open preview in new tab</a>}<button className="secondary-button" disabled={!canWrite || store.busy} onClick={onEdit}>Edit / retry file</button>{file.kind === "syllabus" && file.state === "ready" && onReview && <button className="primary-button" disabled={!canWrite} onClick={() => onReview(file, text.slice(0, 60000))}>Review syllabus</button>}</div>
  </section></div>;
}

export function FileList({ files, store, onOpen, onEdit, canWrite }: { files: PrivateFile[]; store: FileStore; onOpen: (file: PrivateFile) => void; onEdit: (file: PrivateFile) => void; canWrite: boolean }) {
  return <ul className="private-file-list">{files.map((file) => <li key={file.id}><button className="text-button" onClick={() => onOpen(file)}>{file.name}</button><span>{fileSize(Number(file.size_bytes))} · {file.kind} · {file.state}</span><button className="secondary-button" disabled={!canWrite || store.busy || file.state === "deleting"} onClick={() => onEdit(file)}>{file.state === "pending" ? "Retry upload" : "Edit file"}</button><button className="secondary-button" disabled={!canWrite || store.busy} onClick={async () => { if (window.confirm(`Delete ${file.name} and its stored bytes?`)) { try { await store.remove(file); } catch { /* The shared file error retains retry controls. */ } } }}>{file.state === "deleting" ? "Retry deletion" : "Delete file"}</button></li>)}{!files.length && <li>No files yet.</li>}</ul>;
}
