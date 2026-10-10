"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Download, RotateCcw, Trash2, X } from "lucide-react";
import type { FileFolder } from "../lib/file-organization";
import type { BrowserItem } from "../lib/files-browser";
import {
  emptyTrash,
  permanentDeleteTrashItems,
  restoreTrashItems,
  trashBrowserItems,
  type TrashUndoReceipt,
} from "../lib/files-trash-operations";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
import type { OrganizationDialogReport } from "./file-organization-dialogs";
import "./files-trash-dialog.css";

export type TrashDialogAction = "trash" | "restore" | "permanent-delete" | "empty-trash";

export type TrashDialogRequest = {
  action: TrashDialogAction;
  profileId: string;
  items: BrowserItem[];
  folders: FileFolder[];
  requestId?: string;
  count: number;
};

type Props = {
  request: TrashDialogRequest;
  currentProfileId: string;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (profileId: string, signal: AbortSignal) => Promise<void>;
  onRefresh: (profileId: string) => Promise<void>;
  onStateChange: (report: OrganizationDialogReport | null) => void;
  onTrashCompleted: (receipt: TrashUndoReceipt) => void;
  onRestored: (recoveryFolder: FileFolder | null) => void;
};

function itemName(item: BrowserItem) {
  return item.type === "file" ? item.file.name : item.folder.name;
}

function requestItem(item: BrowserItem) {
  return item.type === "file"
    ? { type: "file", id: item.id, name: item.file.name, revision: item.file.metadata_revision, folderId: item.file.folder_id }
    : { type: "folder", id: item.id, name: item.folder.name, revision: item.folder.revision, parentId: item.folder.parent_id };
}

function itemCountCopy(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function actionTitle(action: TrashDialogAction, item: BrowserItem | undefined) {
  if (action === "trash") return "Move to Trash";
  if (action === "restore") return "Restore from Trash";
  if (action === "empty-trash") return "Empty Trash";
  return item?.type === "folder" ? "Delete folder permanently" : "Delete permanently";
}

function actionLabel(action: TrashDialogAction, retry: boolean) {
  if (action === "trash") return retry ? "Retry move to Trash" : "Move to Trash";
  if (action === "restore") return retry ? "Retry restore" : "Restore";
  if (action === "empty-trash") return retry ? "Retry Empty Trash" : "Empty Trash";
  return retry ? "Retry permanent deletion" : "Delete permanently";
}

export default function FilesTrashDialog({
  request,
  currentProfileId,
  canWrite,
  onClose,
  onSaved,
  onRefresh,
  onStateChange,
  onTrashCompleted,
  onRestored,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const profileIdRef = useRef(currentProfileId);
  const stateCallbackRef = useRef(onStateChange);
  const trashReceiptRef = useRef<TrashUndoReceipt | null>(null);
  const recoveryFolderRef = useRef<FileFolder | null>(null);
  const actionSavedRef = useRef(false);
  const completionCallbackCalledRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionSaved, setActionSaved] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const profileChanged = currentProfileId !== request.profileId;
  const target = request.items[0];
  const multipleTargets = request.items.length > 1;
  const title = multipleTargets
    ? request.action === "trash" ? "Move selected items to Trash"
      : request.action === "restore" ? "Restore selected items"
        : request.action === "permanent-delete" ? "Delete selected items permanently" : actionTitle(request.action, target)
    : actionTitle(request.action, target);
  const headingName = target ? itemName(target) : "all items in Trash";
  const selectionNames = request.items.map(itemName);
  const selectedCountCopy = itemCountCopy(request.items.length);
  const draft = useMemo(() => ({
    capturedProfileId: request.profileId,
    action: request.action,
    items: request.items.map(requestItem),
    folders: request.folders.map((folder) => ({ id: folder.id, parentId: folder.parent_id, originalParentId: folder.original_parent_id, name: folder.name, revision: folder.revision })),
    ...(request.requestId ? { requestId: request.requestId } : {}),
    count: request.count,
    acknowledged: actionSaved,
  }), [actionSaved, request]);

  useLayoutEffect(() => {
    profileIdRef.current = currentProfileId;
    stateCallbackRef.current = onStateChange;
  }, [currentProfileId, onStateChange]);

  useSaveProtection(true);

  useEffect(() => {
    stateCallbackRef.current?.({ busy, dirty: true, draft });
  }, [busy, draft, onStateChange]);

  useEffect(() => () => stateCallbackRef.current?.(null), []);

  useLayoutEffect(() => {
    window.requestAnimationFrame(() => {
      if (dialogRef.current?.closest("[hidden]")) return;
      dialogRef.current?.querySelector<HTMLElement>(".files-trash-submit:not(:disabled)")?.focus({ preventScroll: true });
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
      dialog.querySelector<HTMLElement>(".files-trash-submit:not(:disabled)")?.focus({ preventScroll: true });
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

  const close = useCallback(() => {
    if (busy) return;
    if ((request.action === "permanent-delete" || request.action === "empty-trash") && error && !actionSaved && !profileChanged) {
      setShowCloseWarning(true);
      return;
    }
    onClose();
  }, [actionSaved, busy, error, onClose, profileChanged, request.action]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!dialogRef.current || dialogRef.current.closest("[hidden]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
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
    if (busy || !canWrite || profileChanged || profileIdRef.current !== request.profileId) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    setShowCloseWarning(false);
    const stillCurrent = () => !controller.signal.aborted && profileIdRef.current === request.profileId;
    try {
      if (!actionSavedRef.current) {
        if (request.action === "trash") {
          const result = await trashBrowserItems(request.profileId, request.items, { folders: request.folders, signal: controller.signal });
          if (!stillCurrent()) return;
          trashReceiptRef.current = result.undo;
        } else if (request.action === "restore") {
          const result = await restoreTrashItems(request.profileId, request.items, { folders: request.folders, signal: controller.signal });
          if (!stillCurrent()) return;
          recoveryFolderRef.current = result.recoveryFolder ?? null;
        } else if (request.action === "permanent-delete") {
          await permanentDeleteTrashItems(request.profileId, request.items, request.requestId!, { signal: controller.signal });
          if (!stillCurrent()) return;
        } else {
          await emptyTrash(request.profileId, request.requestId!, { signal: controller.signal });
          if (!stillCurrent()) return;
        }
        actionSavedRef.current = true;
        setActionSaved(true);
      }
      if (!stillCurrent()) return;
      await onSaved(request.profileId, controller.signal);
      if (!stillCurrent()) return;
      if (request.action === "trash" && trashReceiptRef.current && !completionCallbackCalledRef.current) {
        completionCallbackCalledRef.current = true;
        onTrashCompleted(trashReceiptRef.current);
      }
      if (request.action === "restore") onRestored(recoveryFolderRef.current);
      if (stillCurrent()) onClose();
    } catch (cause) {
      if (controller.signal.aborted || profileIdRef.current !== request.profileId) return;
      setError(actionSavedRef.current
        ? "The server saved this change, but the Files refresh did not finish. Retry to finish syncing the browser."
        : cause instanceof Error && cause.message ? cause.message : "The Trash change could not be saved. Please retry.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const retry = Boolean(error) && !actionSaved;
  const retryRefresh = actionSaved;
  const permanentlyRemoving = request.action === "permanent-delete" || request.action === "empty-trash";
  const disableAction = busy || !canWrite || profileChanged;

  return <div className="files-dialog-backdrop files-trash-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) close();
  }}>
    <section ref={dialogRef} className="files-details-dialog files-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="files-trash-title" aria-describedby="files-trash-description">
      <div className="files-details-heading">
        <div><p>Files · {request.action === "restore" ? "Restore" : permanentlyRemoving ? "Permanent deletion" : "Trash"}</p><h2 id="files-trash-title">{title}</h2></div>
        <button type="button" className="files-icon-button" aria-label="Close Trash dialog" disabled={busy} onClick={close}><X size={18} /></button>
      </div>

      {profileChanged && <p className="files-trash-error" role="alert">The active account changed. This request belongs to the previous account; its saved details are available to download.</p>}
      <p id="files-trash-description" className="files-trash-intro">{request.action === "trash"
        ? multipleTargets
          ? `Move ${selectedCountCopy} (${itemCountCopy(request.count)} including folder contents) to Trash? You can restore them later. A protected syllabus reference may block the entire selection; any blocker will be named and nothing will move.`
          : target?.type === "folder"
          ? `Move “${headingName}” and its contents (${itemCountCopy(request.count)}) to Trash? You can restore them later. A protected syllabus reference may block the entire folder operation; any blocker will be named and nothing will move.`
          : `Move “${headingName}” to Trash? You can restore it later. A protected syllabus reference may block the operation; any blocker will be named.`
        : request.action === "restore"
          ? multipleTargets
            ? `Restore ${selectedCountCopy} (${itemCountCopy(request.count)} including folder contents) to their original locations when available. Items whose locations are gone will be placed in the visible Restored files folder.`
            : `Restore “${headingName}” to its original location when it is available. If that location is gone, the item will be placed in the visible Restored files folder.`
          : request.action === "permanent-delete"
            ? multipleTargets
              ? `Permanently delete ${selectedCountCopy} (${itemCountCopy(request.count)} including folder contents)? This action cannot be undone.`
              : target?.type === "folder"
              ? `Permanently delete “${headingName}” and its contents (${itemCountCopy(request.count)})? This action cannot be undone.`
              : `Permanently delete “${headingName}”? This action cannot be undone.`
            : `Permanently delete all ${itemCountCopy(request.count)} in Trash? The server captures the Trash contents when you confirm. This action cannot be undone.`}</p>

      {(request.action === "trash" || request.action === "permanent-delete" || (request.action === "restore" && multipleTargets)) && target && <div className="files-trash-target">
        <strong>{multipleTargets ? `${selectedCountCopy} selected` : headingName}</strong>
        {multipleTargets ? <>
          <span>{itemCountCopy(request.count)} total, including folder contents</span>
          <ul className="files-trash-selection-list">{selectionNames.map((name, index) => <li key={`${request.items[index].type}:${request.items[index].id}`}>{name}</li>)}</ul>
        </> : <span>{target.type === "file" ? "File" : target.folder.kind === "course" ? "Course folder" : "Folder"} · {itemCountCopy(request.count)}</span>}
      </div>}
      {request.action === "empty-trash" && <p className="files-trash-target"><strong>{itemCountCopy(request.count)} in Trash</strong><span>Includes trashed files and folders, including nested items.</span></p>}

      {!profileChanged && !canWrite && <p className="files-trash-note" role="note">Files changes are unavailable while this workspace is read-only.</p>}
      {!profileChanged && actionSaved && !error && <p className="files-trash-pending" role="status">The server saved this change. Refresh Files to finish syncing the browser; the action itself will not be repeated.</p>}
      {error && <p className="files-trash-error" role="alert">{error}{retryRefresh ? " The saved action will not be repeated." : permanentlyRemoving ? " The request ID and item snapshot are kept for an exact retry." : " The captured item revisions are kept for an exact retry. If a protected syllabus reference blocked this action, the message above identifies it."}</p>}

      {showCloseWarning && <div className="files-trash-close-warning" role="alert" aria-labelledby="files-trash-close-title">
        <strong id="files-trash-close-title">Deletion is still unresolved.</strong>
        <p>The server may still have permanent deletion work pending. This Trash item cannot be restored while cleanup is pending. Download this request to keep the exact retry details before closing.</p>
        <div className="files-trash-actions">
          <button type="button" className="files-secondary-button" onClick={() => setShowCloseWarning(false)}>Keep this request open</button>
          <button type="button" className="files-secondary-button" onClick={() => downloadDraft("eduessentials-trash-deletion-request.json", draft)}><Download size={15} /> Download request</button>
          <button type="button" className="files-trash-danger" onClick={onClose}>Close anyway</button>
        </div>
      </div>}

      <form onSubmit={(event) => void save(event)}>
        {busy && <p className="files-trash-pending" role="status" aria-live="polite">{request.action === "restore" ? "Restoring from Trash…" : permanentlyRemoving ? "Deleting permanently…" : "Moving to Trash…"} The dialog will stay open until the request finishes.</p>}
        <div className="files-trash-actions">
          <button type="button" className="files-secondary-button" disabled={busy} onClick={close}>Close</button>
          <button type="button" className="files-secondary-button" disabled={busy || profileChanged} onClick={() => void onRefresh(request.profileId)}>Refresh Files</button>
          <button type="button" className="files-secondary-button" onClick={() => downloadDraft("eduessentials-trash-request.json", draft)}><Download size={15} /> Download request</button>
          <button type="submit" className={permanentlyRemoving && !retryRefresh ? "files-trash-danger files-trash-submit" : "files-new-button files-trash-submit"} disabled={disableAction || showCloseWarning}>
            {retryRefresh ? <RotateCcw size={15} /> : request.action === "restore" ? <RotateCcw size={15} /> : <Trash2 size={15} />}
            {retryRefresh ? "Retry Files refresh" : actionLabel(request.action, retry)}
          </button>
        </div>
      </form>
      {busy && <p className="files-trash-pending" role="status"><AlertTriangle size={14} /> Do not close or switch accounts until the request finishes.</p>}
    </section>
  </div>;
}
