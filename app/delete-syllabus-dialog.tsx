"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { PrivateFile } from "../lib/files";
import { permanentDeleteTrashItems, trashBrowserItems } from "../lib/files-trash-operations";
import { parseFile, requestOrganization } from "../lib/files-browser-operations";
import { useSaveProtection } from "./use-save-protection";

export function DeleteSyllabusDialog({ profileId, file, fileId, canWrite, onDetach, onRefresh, onDeleted, onClose }: {
  profileId: string;
  file?: PrivateFile;
  fileId?: string;
  canWrite: boolean;
  onDetach: () => Promise<void>;
  onRefresh: (signal: AbortSignal) => Promise<void>;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmChanged, setConfirmChanged] = useState(false);
  const operation = useRef<{ detached: boolean; file?: PrivateFile; deleted: boolean; trashUncertain: boolean; requestId: string }>({ detached: false, file, deleted: false, trashUncertain: false, requestId: crypto.randomUUID() });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  useSaveProtection(busy);

  const remove = async () => {
    if (!canWrite || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError("");
    setConfirmChanged(false);
    try {
      const current = operation.current;
      if (fileId && !current.file) throw new Error("The syllabus file is unavailable. Refresh Files before deleting it.");
      if (!current.detached) {
        await onDetach();
        signal.throwIfAborted();
        current.detached = true;
      }
      if (current.file && !current.deleted) {
        if (current.trashUncertain) {
          const result = await requestOrganization(profileId, "/api/files?view=trash", { signal }) as { files?: unknown[] };
          signal.throwIfAborted();
          if (!Array.isArray(result.files)) throw new Error("Unable to confirm the syllabus Trash state. Retry deletion.");
          const recovered = result.files.find((row) => row && typeof row === "object" && "id" in row && row.id === fileId);
          if (recovered) current.file = parseFile(recovered, profileId, fileId);
          else {
            const active = await requestOrganization(profileId, "/api/files?view=active", { signal }) as { files?: unknown[] };
            signal.throwIfAborted();
            if (!Array.isArray(active.files)) throw new Error("Unable to refresh the syllabus file. Retry deletion.");
            const row = active.files.find((item) => item && typeof item === "object" && "id" in item && item.id === fileId);
            if (!row) throw new Error("The syllabus file is no longer available. Refresh Files to confirm its status.");
            const latest = parseFile(row, profileId, fileId);
            const changed = latest.metadata_revision !== current.file.metadata_revision || latest.content_revision !== current.file.content_revision;
            current.file = latest;
            if (changed) {
              current.trashUncertain = false;
              setConfirmChanged(true);
              throw new Error(`The file changed since deletion was requested. Confirm again to permanently delete the updated file “${latest.name}”.`);
            }
          }
          current.trashUncertain = false;
        }
        if (!current.file.trashed_at) {
          current.trashUncertain = true;
          const result = await trashBrowserItems(profileId, [{ type: "file", id: current.file.id, file: current.file }], { signal });
          signal.throwIfAborted();
          current.file = result.files.find((item) => item.id === fileId)!;
          current.trashUncertain = false;
        }
        await permanentDeleteTrashItems(profileId, [{ type: "file", id: current.file.id, file: current.file }], current.requestId, { signal });
        signal.throwIfAborted();
      }
      current.deleted = true;
      await onRefresh(signal);
      signal.throwIfAborted();
      onDeleted();
    } catch (cause) {
      if (!signal.aborted) {
        const message = cause instanceof Error ? cause.message : "The syllabus could not be deleted. Retry deletion.";
        setError(operation.current.deleted ? `The syllabus was deleted, but Files could not refresh. Retry to refresh. ${message}` : operation.current.detached && fileId ? `The syllabus was detached, but its file has not been permanently deleted. Retry here or finish deleting it from Files. ${message}` : message);
      }
    } finally {
      if (!signal.aborted) { pending.current = null; setBusy(false); }
    }
  };

  return <div className="modal-backdrop"><section className="small-modal" role="dialog" aria-modal="true" aria-label="Delete syllabus">
    <h2>Delete Syllabus?</h2>
    <p>This permanently deletes the attached syllabus file and saved syllabus text. It cannot be undone. Assignments and the class schedule are kept.</p>
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="primary-button" disabled={busy || !canWrite} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />{busy ? "Deleting…" : confirmChanged ? "Delete updated syllabus" : error ? "Retry deletion" : "Delete Syllabus"}</button>
    </div>
  </section></div>;
}
