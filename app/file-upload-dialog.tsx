"use client";
import { useEffect, useLayoutEffect, useRef, type ChangeEvent } from "react";
import { fileSize } from "../lib/files";
import { downloadDraft } from "./use-save-protection";
import type { FileUploadDefaults, FileUploadQueue, FileUploadRow } from "./use-file-uploads";
import "./file-upload-dialog.css";

export type FileUploadDialogProps = {
  queue: FileUploadQueue;
  currentProfileId: string;
  defaults: FileUploadDefaults;
  canWrite: boolean;
  onClose: () => void;
};

function statusLabel(row: FileUploadRow, currentProfileId: string): string {
  if (row.status === "uploading") return `Uploading · ${Math.min(99, Math.round(row.progress * 100))}%`;
  if (row.status === "refreshing") return "Upload confirmed · refreshing Files";
  if (row.status === "complete") return "Uploaded and verified";
  if (row.status === "refresh-error") return "Upload confirmed · refresh needs retry";
  if (row.status === "error") return "Upload needs attention";
  if (row.profileId !== currentProfileId) return "Waiting for the original account";
  return "Waiting to upload";
}

function safeDraftName(id: string): string {
  return `eduessentials-upload-${id}.json`;
}

function downloadOriginal(row: FileUploadRow) {
  const url = URL.createObjectURL(row.file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = row.file.name || "original-file";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadRequest(row: FileUploadRow) {
  downloadDraft(safeDraftName(row.id), {
    version: 1,
    id: row.id,
    profileId: row.profileId,
    originalSession: row.originalSession,
    lastAttempt: row.attemptSession,
    file: { name: row.file.name, size: row.file.size, type: row.file.type, lastModified: row.file.lastModified },
    metadata: row.metadata,
    status: row.status,
    progress: row.progress,
    acknowledged: row.acknowledged,
    uploadedFile: row.uploaded ?? null,
    error: row.error,
  });
}

export function FileUploadDialog({ queue, currentProfileId, defaults, canWrite, onClose }: FileUploadDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = inputRef.current?.disabled ? closeButtonRef.current : inputRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      event.stopImmediatePropagation();
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
      )].filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.requestAnimationFrame(() => {
        const visibleAndEnabled = previousFocus && previousFocus !== document.body && previousFocus.isConnected &&
          !previousFocus.matches(":disabled") && previousFocus.getAttribute("aria-hidden") !== "true" &&
          !previousFocus.closest("[inert], [aria-hidden='true']") &&
          getComputedStyle(previousFocus).display !== "none" && getComputedStyle(previousFocus).visibility !== "hidden";
        const fallback = document.querySelector<HTMLElement>(".files-browser .files-new-button:not(:disabled)");
        if (visibleAndEnabled) previousFocus.focus({ preventScroll: true });
        else if (fallback?.isConnected) fallback.focus({ preventScroll: true });
      });
    };
  }, []);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    if (selected.length) queue.enqueue(selected, defaults);
    event.currentTarget.value = "";
  };

  return <div className="files-upload-backdrop">
    <section className="files-upload-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Upload files" tabIndex={-1}>
      <header className="files-upload-header">
        <div><h2>Upload files</h2><p>Each file uploads separately. Failed selections stay here for retry.</p></div>
        <button ref={closeButtonRef} type="button" className="files-upload-close" onClick={onClose} aria-label="Close uploads">×</button>
      </header>

      <label className={`files-upload-picker${canWrite ? "" : " is-disabled"}`}>
        <span>Choose files</span>
        <small>Multiple files · up to 25 MiB each</small>
        <input ref={inputRef} type="file" multiple disabled={!canWrite} onChange={handleFiles} />
      </label>
      {!canWrite && <p className="files-upload-gate" role="status">Uploads are paused while the current workspace change finishes.</p>}

      <div className="files-upload-list" aria-live="polite">
        {queue.rows.map((row) => {
          const inProgress = row.status === "uploading" || row.status === "refreshing";
          const retryableState = row.status === "error" || row.status === "refresh-error";
          const onOriginalAccount = row.profileId === currentProfileId;
          const progressValue = row.status === "complete" ? 100 : Math.min(99, Math.round(row.progress * 100));
          return <article className={`files-upload-row is-${row.status}`} key={row.id} data-upload-id={row.id}>
            <div className="files-upload-row-main">
              <div className="files-upload-file-heading"><strong title={row.file.name}>{row.file.name || "Unnamed file"}</strong><span>{fileSize(row.file.size)}</span></div>
              <p className="files-upload-status" role="status">{statusLabel(row, currentProfileId)}</p>
              {row.error && <p className="files-upload-error">{row.error}</p>}
              {(inProgress || row.status === "error" || row.status === "refresh-error") && <progress aria-label={`${row.file.name} upload progress`} max={100} value={progressValue}>{progressValue}%</progress>}
            </div>
            <div className="files-upload-actions">
              {retryableState && <button type="button" className="secondary-button" disabled={!canWrite || !onOriginalAccount || !row.retryable} title={!onOriginalAccount ? "Return to the account that selected this file." : !canWrite ? "Uploads are temporarily unavailable." : undefined} onClick={() => { void queue.retry(row.id).catch(() => {}); }}>Retry upload</button>}
              <button type="button" className="secondary-button" onClick={() => downloadOriginal(row)}>Download original</button>
              <button type="button" className="secondary-button" onClick={() => downloadRequest(row)}>Download request draft</button>
              <button type="button" className="files-upload-dismiss" disabled={inProgress} onClick={() => queue.dismiss(row.id)} aria-label={`Dismiss upload ${row.file.name}`}>Dismiss</button>
            </div>
          </article>;
        })}
        {!queue.rows.length && <p className="files-upload-empty">No files selected yet.</p>}
      </div>

      <footer className="files-upload-footer">
        <span>{queue.busy ? "Uploading selected files…" : queue.dirty ? "Selections retained until uploaded or dismissed." : "Uploads are verified by the server."}</span>
        <button type="button" className="primary-button" onClick={onClose}>Close uploads</button>
      </footer>
    </section>
  </div>;
}

export default FileUploadDialog;
