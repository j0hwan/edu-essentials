"use client";
/* eslint-disable @next/next/no-img-element -- Private authenticated blob URLs cannot use the public image optimizer. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

type PrivateImageSource = {
  fileId: string;
  updatedAt: string;
  contentRevision: number;
  trashedAt: string | null;
  deletedAt: string | null;
  blob: FileStore["blob"];
};

type LoadedPrivateImage = PrivateImageSource & { url: string; ready: boolean };

function samePrivateImageSource(first: PrivateImageSource, second: PrivateImageSource): boolean {
  return first.fileId === second.fileId
    && first.updatedAt === second.updatedAt
    && first.contentRevision === second.contentRevision
    && first.trashedAt === second.trashedAt
    && first.deletedAt === second.deletedAt
    && first.blob === second.blob;
}

export function PrivateImage({ file, store, fadeIn = false }: { file: PrivateFile; store: FileStore; fadeIn?: boolean }) {
  const [loadedImage, setLoadedImage] = useState<LoadedPrivateImage | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef(file);
  const blob = store.blob;
  const source = useMemo<PrivateImageSource>(() => ({
    fileId: file.id,
    updatedAt: file.updated_at,
    contentRevision: file.content_revision,
    trashedAt: file.trashed_at,
    deletedAt: file.deleted_at ?? null,
    blob,
  }), [file.id, file.updated_at, file.content_revision, file.trashed_at, file.deleted_at, blob]);
  const sourceRef = useRef(source);
  useLayoutEffect(() => { fileRef.current = file; }, [file]);
  useLayoutEffect(() => { sourceRef.current = source; }, [source]);

  useEffect(() => {
    const requestedSource = sourceRef.current;
    if (requestedSource.trashedAt || requestedSource.deletedAt) {
      setLoadedImage(null);
      return;
    }
    const controller = new AbortController();
    let owned = "";
    setLoadedImage(null);
    void blob(fileRef.current, controller.signal).then((data) => {
      if (controller.signal.aborted || !samePrivateImageSource(sourceRef.current, requestedSource)) return;
      owned = URL.createObjectURL(data);
      setLoadedImage({ ...requestedSource, url: owned, ready: !fadeIn });
    }).catch(() => {});
    return () => {
      controller.abort();
      if (owned) {
        URL.revokeObjectURL(owned);
        setLoadedImage((current) => current?.url === owned ? null : current);
      }
    };
  }, [file.id, file.updated_at, file.content_revision, file.trashed_at, file.deleted_at, blob, fadeIn]);

  const currentImage = loadedImage && samePrivateImageSource(loadedImage, source) ? loadedImage : null;
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!fadeIn || !currentImage || currentImage.ready || !image) return;
    const src = currentImage.url;
    let cancelled = false;
    const reveal = () => {
      if (cancelled || imageRef.current !== image || image.src !== src || !samePrivateImageSource(sourceRef.current, currentImage)) return;
      setLoadedImage((current) => current?.url === src ? { ...current, ready: true } : current);
    };
    const decode = () => {
      if (cancelled || imageRef.current !== image || image.src !== src || !samePrivateImageSource(sourceRef.current, currentImage)) return;
      if (typeof image.decode === "function") void image.decode().then(reveal, reveal);
      else reveal();
    };
    if (image.complete) {
      if (image.naturalWidth > 0) decode();
    } else {
      image.addEventListener("load", decode);
    }
    return () => {
      cancelled = true;
      image.removeEventListener("load", decode);
    };
  }, [fadeIn, currentImage]);

  if (!currentImage || file.trashed_at || file.deleted_at) return null;
  const className = `private-class-image${fadeIn ? ` private-class-image-fade${currentImage.ready ? " is-ready" : ""}` : ""}`;
  return <img ref={imageRef} className={className} src={currentImage.url} alt={file.name} />;
}
export function FilePreview({ file, store, onClose, onEdit, onReview, onOpened, canWrite }: { file: PrivateFile; store: FileStore; onClose: () => void; onEdit: () => void; onReview?: (file: PrivateFile, text: string) => void; onOpened?: (file: PrivateFile) => void; canWrite: boolean }) {
  const [url, setUrl] = useState(""), [text, setText] = useState(""), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const blob = store.blob;
  const openedRef = useRef(onOpened), fileRef = useRef(file);
  useLayoutEffect(() => { openedRef.current = onOpened; fileRef.current = file; }, [file, onOpened]);
  useEffect(() => {
    const controller = new AbortController(); let owned = "";
    const captured = fileRef.current;
    if (captured.state !== "ready" || captured.trashed_at || captured.deleted_at) return;
    setUrl(""); setText(""); setError("");
    void blob(captured, controller.signal).then(async (data) => { const content = captured.mime_type === "text/plain" && data.size <= 1000000 ? await data.text() : ""; if (!controller.signal.aborted) { owned = URL.createObjectURL(data); setUrl(owned); setText(content); setError(""); openedRef.current?.(captured); } }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => { controller.abort(); if (owned) URL.revokeObjectURL(owned); };
  }, [file.id, file.updated_at, file.metadata_revision, file.content_revision, file.state, file.trashed_at, file.deleted_at, blob, attempt]);
  return <div className="modal-backdrop"><section className="add-class-modal academic-editor" role="dialog" aria-modal="true" aria-label="Private file preview"><div className="modal-header"><h2>{file.name}</h2><button className="secondary-button" onClick={onClose}>Close file preview</button></div><p>{fileSize(Number(file.size_bytes))} · {file.kind} · {file.state}</p>
    {file.state !== "ready" ? <p>Upload or deletion is pending. Retry it from Files.</p> : error ? <p role="alert">{error}<button onClick={() => setAttempt((n) => n + 1)}>Retry preview</button></p> : !url ? <p>Loading private preview…</p> : file.mime_type.startsWith("image/") ? <img className="private-preview-image" src={url} alt={file.name} /> : file.mime_type === "application/pdf" ? <iframe title={file.name} className="private-pdf-preview" sandbox="" src={url} /> : file.mime_type === "text/plain" && file.size_bytes <= 1000000 ? <pre className="syllabus-source">{text}</pre> : <p>Download this file to open it in a compatible application.</p>}
    <div className="modal-actions">{file.state === "ready" && <a className="secondary-button" href={store.url(file)} download>Download original file</a>}{url && ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"].includes(file.mime_type) && <a className="secondary-button" href={url} target="_blank" rel="noopener noreferrer">Open preview in new tab</a>}<button className="secondary-button" disabled={!canWrite || store.busy} onClick={onEdit}>Edit / retry file</button>{file.kind === "syllabus" && file.state === "ready" && onReview && <button className="primary-button" disabled={!canWrite} onClick={() => onReview(file, text.slice(0, 60000))}>Review syllabus</button>}</div>
  </section></div>;
}

export function FileList({ files, store, onOpen, onEdit, onTrashed, canWrite }: { files: PrivateFile[]; store: FileStore; onOpen: (file: PrivateFile) => void; onEdit: (file: PrivateFile) => void; onTrashed?: (file: PrivateFile) => void; canWrite: boolean }) {
  const activeFiles = files.filter((file) => !file.trashed_at);
  return <ul className="private-file-list">{activeFiles.map((file) => <li key={file.id}><button className="text-button" onClick={() => onOpen(file)}>{file.name}</button><span>{fileSize(Number(file.size_bytes))} · {file.kind} · {file.state}</span><button className="secondary-button" disabled={!canWrite || store.busy || file.state === "deleting"} onClick={() => onEdit(file)}>{file.state === "pending" ? "Retry upload" : "Edit file"}</button><button className="secondary-button" disabled={!canWrite || store.busy} onClick={async () => { if (window.confirm(file.state === "ready" ? `Move ${file.name} to Trash?` : `Cancel ${file.name} and remove its stored bytes?`)) { try { const saved = await store.remove(file); if (saved?.trashed_at && saved.state === "ready") onTrashed?.(saved); } catch { /* The shared file error retains retry controls. */ } } }}>{file.state === "deleting" ? "Retry deletion" : file.state === "pending" ? "Cancel upload" : "Move to Trash"}</button></li>)}{!activeFiles.length && <li>No files yet.</li>}</ul>;
}
