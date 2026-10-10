"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { safeFileItemName, type FileFolder } from "../lib/file-organization";
import { archiveFolder, unarchiveFolder } from "../lib/files-browser-activity";
import { BrowserOrganizationFailure } from "../lib/files-browser-operations";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
import type { OrganizationDialogReport } from "./file-organization-dialogs";
import "./file-archive-dialog.css";

export type ArchiveDialogRequest =
  | { action: "archive"; profileId: string; folder: FileFolder; defaultLabel: string }
  | { action: "unarchive"; profileId: string; folder: FileFolder };

type ArchiveAttempt = {
  action: ArchiveDialogRequest["action"];
  profileId: string;
  folder: FileFolder;
  label: string;
};

type Props = {
  request: ArchiveDialogRequest;
  currentProfileId: string;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (profileId: string, signal: AbortSignal) => Promise<void>;
  onRefresh: (profileId: string, signal: AbortSignal) => Promise<void>;
  onStateChange: (report: OrganizationDialogReport | null) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "The archive change could not be saved. Please retry.";
}

export default function FileArchiveDialog({ request, currentProfileId, canWrite, onClose, onSaved, onRefresh, onStateChange }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef({ profileId: currentProfileId, version: 0 });
  const [label, setLabel] = useState(request.action === "archive" ? request.defaultLabel : "");
  const [attempt, setAttempt] = useState<ArchiveAttempt | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const profileChanged = currentProfileId !== request.profileId;
  const defaultLabel = request.action === "archive" ? request.defaultLabel : "";
  const dirty = Boolean(attempt || committed || (request.action === "archive" && label !== defaultLabel) || error);
  const draft = useMemo(() => ({
    capturedProfileId: request.profileId,
    action: request.action,
    folder: {
      id: request.folder.id,
      name: request.folder.name,
      revision: request.folder.revision,
      parentId: request.folder.parent_id,
      kind: request.folder.kind,
    },
    ...(request.action === "archive" ? { semesterLabel: attempt?.label ?? label } : {}),
    committed,
  }), [attempt, committed, label, request]);
  useSaveProtection(busy || dirty);

  useEffect(() => {
    onStateChange({ busy, dirty, draft });
  }, [busy, dirty, draft, onStateChange]);
  useEffect(() => () => onStateChange(null), [onStateChange]);

  useLayoutEffect(() => {
    if (sessionRef.current.profileId !== currentProfileId) {
      sessionRef.current = { profileId: currentProfileId, version: sessionRef.current.version + 1 };
      abortRef.current?.abort(new DOMException("The active account changed.", "AbortError"));
    }
  }, [currentProfileId]);

  useLayoutEffect(() => {
    window.requestAnimationFrame(() => {
      if (dialogRef.current?.closest("[hidden]")) return;
      if (request.action === "archive") labelInputRef.current?.focus({ preventScroll: true });
      else dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    });
  }, [request]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const ancestors: HTMLElement[] = [];
    let ancestor = dialog.parentElement;
    while (ancestor) { ancestors.push(ancestor); ancestor = ancestor.parentElement; }
    const focusWhenVisible = () => {
      if (dialog.closest("[hidden]")) return;
      const target = request.action === "archive" ? labelInputRef.current : dialog.querySelector<HTMLElement>("button:not(:disabled)");
      target?.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(focusWhenVisible);
    for (const element of ancestors) observer.observe(element, { attributes: true, attributeFilter: ["hidden"] });
    return () => observer.disconnect();
  }, [request]);

  useEffect(() => {
    if (!profileChanged) return;
    abortRef.current?.abort(new DOMException("The active account changed.", "AbortError"));
  }, [profileChanged]);

  useEffect(() => {
    if (!busy) return;
    const controller = abortRef.current;
    return () => controller?.abort();
  }, [busy]);

  const close = useCallback((force = false) => {
    if (busy) return;
    if (!force && dirty && !window.confirm("Discard this Files change? Download a draft first if you want to keep it.")) return;
    onClose();
  }, [busy, dirty, onClose]);

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (!dialogRef.current || dialogRef.current.closest("[hidden]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
      )];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [close]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !canWrite || profileChanged) return;

    let captured: ArchiveAttempt;
    try {
      captured = attempt ?? {
        action: request.action,
        profileId: request.profileId,
        folder: { ...request.folder },
        label: request.action === "archive" ? safeFileItemName(label, 120) : "",
      };
    } catch (cause) {
      setError(errorMessage(cause));
      setConflict(false);
      return;
    }
    if (!committed && !attempt) {
      setAttempt(captured);
      setLabel(captured.label);
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const sessionVersion = sessionRef.current.version;
    const isCurrentSession = () => !controller.signal.aborted && currentProfileId === request.profileId && sessionRef.current.version === sessionVersion;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      if (committed) {
        await onRefresh(request.profileId, controller.signal);
      } else {
        if (captured.action === "archive") await archiveFolder(captured.profileId, captured.folder, captured.label, { signal: controller.signal });
        else await unarchiveFolder(captured.profileId, captured.folder, { signal: controller.signal });
        if (!isCurrentSession()) return;
        setCommitted(true);
        await onSaved(request.profileId, controller.signal);
      }
      if (isCurrentSession()) onClose();
    } catch (cause) {
      if (!isCurrentSession()) return;
      const failure = cause instanceof BrowserOrganizationFailure ? cause : null;
      setError(errorMessage(cause));
      setConflict(failure?.kind === "conflict");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const refreshFiles = async () => {
    if (busy || profileChanged) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const sessionVersion = sessionRef.current.version;
    const isCurrentSession = () => !controller.signal.aborted && currentProfileId === request.profileId && sessionRef.current.version === sessionVersion;
    setBusy(true);
    setError("");
    try {
      await onRefresh(request.profileId, controller.signal);
      if (!isCurrentSession()) return;
      if (committed) onClose();
    } catch (cause) {
      if (isCurrentSession()) setError(errorMessage(cause));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const title = request.action === "archive" ? "Archive folder" : "Unarchive folder";
  const actionLabel = request.action === "archive" ? "Archive folder" : "Unarchive folder";
  const shownLabel = attempt?.label ?? label;

  return <div className="files-dialog-backdrop file-archive-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) close();
  }}>
    <section ref={dialogRef} className="files-details-dialog file-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="file-archive-title" aria-describedby="file-archive-description">
      <div className="files-details-heading">
        <div><p>Files</p><h2 id="file-archive-title">{title}</h2></div>
        <button type="button" className="files-icon-button" aria-label="Close Files dialog" disabled={busy} onClick={() => close()}><X size={18} /></button>
      </div>
      <p id="file-archive-description" className="file-archive-intro">
        {request.action === "archive"
          ? `Archive “${request.folder.name}” under a semester label. Its files stay available in Archives, and academic records remain unchanged.`
          : `Return “${request.folder.name}” to My files. Its files and folder hierarchy stay together.`}
      </p>
      <form onSubmit={(event) => void save(event)}>
        {profileChanged && <p className="file-archive-error" role="alert">The active account changed. This draft is saved for the previous account.</p>}
        {request.action === "archive" && <label className="file-archive-field">
          <span>Semester label</span>
          <input ref={labelInputRef} autoComplete="off" maxLength={120} value={shownLabel} onChange={(event) => setLabel(event.currentTarget.value)} disabled={busy || profileChanged || Boolean(attempt) || committed} aria-label="Semester label" required />
        </label>}
        {request.action === "unarchive" && <p className="file-archive-note">This folder will be available from My files after the change is saved.</p>}
        {committed && <p className="file-archive-note" role="status">The folder change was saved. Refresh Files to confirm the latest view.</p>}
        {error && <p className="file-archive-error" role="alert">{error}{conflict ? " The saved folder revision changed. Refresh Files, then close and reopen this action to use the latest folder." : attempt ? " The captured folder, account, and label are kept for retry." : " Correct the label and try again."}</p>}
        <div className="file-archive-actions">
          <button type="button" className="files-secondary-button" disabled={busy} onClick={() => downloadDraft("eduessentials-file-archive-draft.json", draft)}><Download size={15} /> Download draft</button>
          <button type="button" className="files-secondary-button" disabled={busy || profileChanged} onClick={() => void refreshFiles()}><RefreshCw size={14} /> Refresh Files</button>
          <button type="button" className="files-secondary-button" disabled={busy} onClick={() => close()}>{dirty ? "Discard draft…" : "Cancel"}</button>
          <button type="submit" className="files-new-button" disabled={busy || !canWrite || profileChanged || (request.action === "archive" && (!shownLabel.trim() || shownLabel.trim().length > 120))}>
            {busy ? "Saving…" : committed ? "Retry refresh" : actionLabel}
          </button>
        </div>
      </form>
      {busy && <p className="file-archive-pending" role="status" aria-live="polite">Saving this Files change… The dialog will stay open until the request finishes.</p>}
    </section>
  </div>;
}
