"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent as ReactDragEvent, type SetStateAction } from "react";
import { ChevronUp, Folder, FolderOpen, Link2, Settings2, ShieldCheck, Upload, X } from "lucide-react";
import { folderCourseId, folderDestinationReason } from "../lib/files-browser-operations";
import type { FileFolder } from "../lib/file-organization";
import type { Course } from "../lib/academics";
import { fileMetadata, fileSize, MAX_FILE_BYTES, type PrivateFile } from "../lib/files";
import { downloadDraft } from "./use-save-protection";
import type { FileUploadDefaults, FileUploadQueue, FileUploadRow } from "./use-file-uploads";
import { useFilesBrowserData } from "./use-files-browser";
import { buildFolderUploadPlan, ensureFolderUploadHierarchy, type FolderUploadPlan } from "../lib/files-folder-upload";
import LocalFilePreview from "./local-file-preview";
import "./file-upload-dialog.css";

const UPLOAD_PANEL_EXIT_FALLBACK_MS = 380;

function prefersReducedUploadMotion(): boolean {
  if (document.documentElement.dataset.motion === "reduced") return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type PendingFolderUpload = FolderUploadPlan & {
  status: "ready" | "creating" | "error";
  error: string;
};

export type FileUploadDialogProps = {
  queue: FileUploadQueue;
  currentProfileId: string;
  currentSessionGeneration?: number;
  defaults: FileUploadDefaults & { profileId?: string; generation?: number };
  mode?: "files" | "folder";
  courses?: Course[];
  changeToken?: readonly PrivateFile[];
  folderUpload?: PendingFolderUpload | null;
  onFolderUploadChange?: Dispatch<SetStateAction<PendingFolderUpload | null>>;
  initialFiles?: File[];
  confirmUploads?: boolean;
  onConfirmUploadsChange?: (enabled: boolean) => void;
  canWrite: boolean;
  onClose: () => void;
};

type LocalFileSelection = {
  id: string;
  file: File;
  profileId: string;
  generation: number;
  error: string;
  autoQueueWhenReady: boolean;
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

function downloadFolderOriginal(entry: PendingFolderUpload["files"][number]) {
  const url = URL.createObjectURL(entry.file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = entry.relativePath.split("/").join(" — ");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function relativeFileName(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return path || file.name || "Unnamed file";
}

function folderLabel(folderId: string | null, folders: readonly FileFolder[]): string {
  if (!folderId) return "My files";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = byId.get(currentId);
    if (!folder) return "Unavailable folder";
    segments.unshift(folder.name);
    currentId = folder.parent_id;
  }
  if (currentId) return "Unavailable folder";
  return `My files / ${segments.join(" / ")}`;
}

function activeFolders(folders: readonly FileFolder[]): FileFolder[] {
  return folders.filter((folder) => folderDestinationReason(folder.id, folders) === "");
}

function folderDepth(folder: FileFolder, folders: readonly FileFolder[]): number {
  let currentId = folder.parent_id;
  let depth = 1;
  const byId = new Map(folders.map((candidate) => [candidate.id, candidate]));
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = byId.get(currentId);
    if (!parent) break;
    depth += 1;
    currentId = parent.parent_id;
  }
  return depth;
}

function isActiveDestination(folderId: string | null, folders: readonly FileFolder[], loading: boolean, error: string): boolean {
  if (folderId === null) return true;
  if (loading || error) return false;
  return folders.some((folder) => folder.id === folderId && folderDestinationReason(folder.id, folders) === "");
}

export function FileUploadDialog({
  queue,
  currentProfileId,
  currentSessionGeneration = 0,
  defaults,
  mode = "files",
  courses = [],
  changeToken,
  folderUpload = null,
  onFolderUploadChange,
  initialFiles = [],
  confirmUploads,
  onConfirmUploadsChange,
  canWrite,
  onClose,
}: FileUploadDialogProps) {
  const dialogId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const localPreviewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const panelOpenRef = useRef(true);
  const fullDismissalPendingRef = useRef(false);
  const dismissalTimerRef = useRef<number | null>(null);
  const activeFolderUploadRef = useRef<AbortController | null>(null);
  const currentStateRef = useRef({ currentProfileId, currentSessionGeneration, canWrite });
  const [capturedContext] = useState(() => ({
    profileId: defaults.profileId ?? currentProfileId,
    generation: defaults.generation ?? currentSessionGeneration,
  }));
  const capturedProfileId = capturedContext.profileId;
  const capturedGeneration = capturedContext.generation;
  const [destinationId, setDestinationId] = useState<string | null>(defaults.folderId);
  const [courseId, setCourseId] = useState(defaults.courseId);
  const [appliedDefaultsRequest, setAppliedDefaultsRequest] = useState(defaults);
  const [courseWasChosen, setCourseWasChosen] = useState(false);
  const [showDestinationPicker, setShowDestinationPicker] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [folderSelectionError, setFolderSelectionError] = useState("");
  const [localFiles, setLocalFiles] = useState<LocalFileSelection[]>([]);
  const localFilesRef = useRef<LocalFileSelection[]>([]);
  const [localPreviewId, setLocalPreviewId] = useState("");
  const [hideConfirmationForFuture, setHideConfirmationForFuture] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  const [panelOpen, setPanelOpenState] = useState(true);
  const [localConfirmUploads, setLocalConfirmUploads] = useState(confirmUploads ?? true);
  const effectiveConfirmUploads = confirmUploads ?? localConfirmUploads;
  const initialBatchesRef = useRef(new WeakSet<File[]>());
  const browserData = useFilesBrowserData(capturedProfileId, changeToken);
  const folders = activeFolders(browserData.data.folders);
  const uploadMode = folderUpload ? "folder" : mode;
  const planBusy = folderUpload?.status === "creating";
  const folderHasCreated = Boolean(folderUpload?.directories.some((directory) => directory.created));
  const destinationValid = isActiveDestination(destinationId, folders, browserData.loading, browserData.error);
  const courseValid = !courseId || courses.some((course) => course.id === courseId);
  const destinationLabel = destinationId ? folderLabel(destinationId, folders) : "Files";
  const capturedSessionCurrent = currentProfileId === capturedProfileId && currentSessionGeneration === capturedGeneration;
  const preferenceChangeAllowed = canWrite && capturedSessionCurrent;
  const uploadScopeReady = appliedDefaultsRequest === defaults;

  const setPanelOpen = useCallback((open: boolean) => {
    if (open && fullDismissalPendingRef.current) return;
    const shell = dialogRef.current?.parentElement;
    if (open) {
      shell?.style.removeProperty("--files-upload-exit-start");
    } else {
      const currentTransform = shell ? window.getComputedStyle(shell).transform : "";
      shell?.style.setProperty("--files-upload-exit-start", currentTransform && currentTransform !== "none" ? currentTransform : "translateY(0)");
    }
    panelOpenRef.current = open;
    setPanelOpenState(open);
    if (!open) {
      settingsOpenRef.current = false;
      setSettingsOpen(false);
    }
  }, []);

  const finishFullDismissal = useCallback(() => {
    if (!fullDismissalPendingRef.current) return;
    if (dismissalTimerRef.current !== null) {
      window.clearTimeout(dismissalTimerRef.current);
      dismissalTimerRef.current = null;
    }
    fullDismissalPendingRef.current = false;
    onCloseRef.current();
  }, []);

  const cancelFullDismissal = useCallback(() => {
    if (dismissalTimerRef.current !== null) {
      window.clearTimeout(dismissalTimerRef.current);
      dismissalTimerRef.current = null;
    }
    fullDismissalPendingRef.current = false;
  }, []);

  const requestFullDismissal = useCallback(() => {
    if (fullDismissalPendingRef.current) return;
    fullDismissalPendingRef.current = true;
    setPanelOpen(false);
    if (prefersReducedUploadMotion()) {
      finishFullDismissal();
      return;
    }
    dismissalTimerRef.current = window.setTimeout(finishFullDismissal, UPLOAD_PANEL_EXIT_FALLBACK_MS);
  }, [finishFullDismissal, setPanelOpen]);

  useLayoutEffect(() => { currentStateRef.current = { currentProfileId, currentSessionGeneration, canWrite }; }, [canWrite, currentProfileId, currentSessionGeneration]);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => { settingsOpenRef.current = settingsOpen; }, [settingsOpen]);

  useLayoutEffect(() => {
    panelOpenRef.current = panelOpen;
    const frame = window.requestAnimationFrame(() => {
      if (panelOpen) {
        const focusTarget = chooseButtonRef.current?.disabled ? closeButtonRef.current : chooseButtonRef.current;
        focusTarget?.focus({ preventScroll: true });
      } else if (fullDismissalPendingRef.current) {
        const returnFocusTarget = document.querySelector<HTMLElement>(".files-browser .files-new-button:not(:disabled)");
        if (returnFocusTarget) returnFocusTarget.focus({ preventScroll: true });
        else if (document.activeElement instanceof HTMLElement && dialogRef.current?.contains(document.activeElement)) document.activeElement.blur();
      } else {
        panelToggleRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panelOpen]);

  useEffect(() => () => {
    if (dismissalTimerRef.current !== null) window.clearTimeout(dismissalTimerRef.current);
    activeFolderUploadRef.current?.abort(new DOMException("The folder upload panel was closed.", "AbortError"));
  }, []);

  useLayoutEffect(() => {
    inputRef.current?.toggleAttribute("webkitdirectory", uploadMode === "folder");
    inputRef.current?.toggleAttribute("directory", uploadMode === "folder");
  }, [uploadMode]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!panelOpenRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (settingsOpenRef.current) {
          settingsOpenRef.current = false;
          setSettingsOpen(false);
          window.requestAnimationFrame(() => settingsButtonRef.current?.focus({ preventScroll: true }));
          return;
        }
        requestFullDismissal();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      event.stopImmediatePropagation();
      const focusable = [...(panelToggleRef.current ? [panelToggleRef.current] : []), ...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
      )].filter((element) => {
        if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const focusIsInLoop = activeElement instanceof HTMLElement && focusable.includes(activeElement);
      if (event.shiftKey && (activeElement === first || !focusIsInLoop)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !focusIsInLoop)) {
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
  }, [requestFullDismissal]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || settingsMenuRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [settingsOpen]);

  useEffect(() => {
    const containOutsideFileDrop = (event: DragEvent) => {
      if (!panelOpenRef.current) return;
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
      const target = event.target;
      const insidePanel = target instanceof Node && Boolean(dialogRef.current?.contains(target));
      if (event.type === "drop" && !insidePanel) event.stopPropagation();
    };
    document.addEventListener("dragover", containOutsideFileDrop, true);
    document.addEventListener("drop", containOutsideFileDrop, true);
    return () => {
      document.removeEventListener("dragover", containOutsideFileDrop, true);
      document.removeEventListener("drop", containOutsideFileDrop, true);
    };
  }, []);

  const setLocalSelections = (next: LocalFileSelection[] | ((current: LocalFileSelection[]) => LocalFileSelection[])) => {
    const value = typeof next === "function" ? next(localFilesRef.current) : next;
    localFilesRef.current = value;
    setLocalFiles(value);
    if (value.length && !value.some((candidate) => candidate.id === localPreviewId)) setLocalPreviewId(value[0].id);
    else if (!value.length) setLocalPreviewId("");
  };

  const preservePendingFilesForReview = useCallback(() => {
    const current = localFilesRef.current;
    if (!current.some((candidate) => candidate.autoQueueWhenReady)) return;
    const next = current.map((candidate) => candidate.autoQueueWhenReady ? { ...candidate, autoQueueWhenReady: false } : candidate);
    localFilesRef.current = next;
    setLocalFiles(next);
  }, []);

  const scrollLocalPreviewIntoView = useCallback(() => {
    const body = bodyRef.current;
    const preview = localPreviewRef.current;
    if (!body || !preview) return;
    const bodyRect = body.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const visibleTop = bodyRect.top + 8;
    const visibleBottom = bodyRect.bottom - 8;
    if (previewRect.bottom > visibleBottom) body.scrollTop += previewRect.bottom - visibleBottom;
    else if (previewRect.top < visibleTop) body.scrollTop -= visibleTop - previewRect.top;
  }, []);

  const canAdmitForCapturedContext = () => {
    const current = currentStateRef.current;
    return current.canWrite && current.currentProfileId === capturedProfileId && current.currentSessionGeneration === capturedGeneration;
  };

  const capturedContextMatches = () => {
    const current = currentStateRef.current;
    return current.currentProfileId === capturedProfileId && current.currentSessionGeneration === capturedGeneration;
  };

  const validateLocalFile = useCallback((file: File, folderId = destinationId, course = courseId): string => {
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("Choose a file up to 25 MiB.");
      fileMetadata({ name: file.name, courseId: course, assignmentId: "", kind: "resource", folderId });
      return "";
    } catch (error) {
      return error instanceof Error && error.message ? error.message : "Choose a valid file name and destination.";
    }
  }, [courseId, destinationId]);

  useLayoutEffect(() => {
    if (appliedDefaultsRequest === defaults) return;
    const scopeChanged = destinationId !== defaults.folderId || courseId !== defaults.courseId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconcile a new request before its passive file-drop and admission effects run.
    setAppliedDefaultsRequest(defaults);
    cancelFullDismissal();
    setPanelOpen(true);
    if (!scopeChanged) return;
    setDestinationId(defaults.folderId);
    setCourseId(defaults.courseId);
    setCourseWasChosen(false);
    setShowDestinationPicker(false);
    setPickerError("");
    setFolderSelectionError("");
    const revalidated = localFilesRef.current.map((candidate) => ({
      ...candidate,
      autoQueueWhenReady: false,
      error: validateLocalFile(candidate.file, defaults.folderId, defaults.courseId),
    }));
    localFilesRef.current = revalidated;
    setLocalFiles(revalidated);
  }, [appliedDefaultsRequest, cancelFullDismissal, courseId, defaults, destinationId, setPanelOpen, validateLocalFile]);

  const enqueueFiles = (files: readonly File[]) => {
    if (!files.length) return;
    if (!uploadScopeReady || !capturedContextMatches() || !currentStateRef.current.canWrite || !destinationValid || !courseValid) {
      setPickerError(!capturedContextMatches()
        ? "This selection belongs to a previous account session. Cancel it, close this panel, and reopen it to choose the files again."
        : !uploadScopeReady ? "The upload destination is changing. Review the new destination, then retry the upload."
        : !currentStateRef.current.canWrite ? "Uploads are paused. Return to the account that selected these files, then retry."
          : !destinationValid ? "Choose an active Files destination first." : "Choose an active course for this upload.");
      return;
    }
    queue.enqueue(files, { folderId: destinationId, courseId });
  };

  const addLocalFiles = (selected: File[], autoQueueWhenReady = false, folderId = destinationId, course = courseId) => {
    if (!selected.length) return;
    setPickerError("");
    setFolderSelectionError("");
    const current = currentStateRef.current;
    const added = selected.map((file): LocalFileSelection => ({
      id: crypto.randomUUID(),
      file,
      profileId: capturedProfileId,
      generation: capturedGeneration,
      error: validateLocalFile(file, folderId, course),
      autoQueueWhenReady,
    }));
    setLocalSelections((previous) => [...previous, ...added]);
    if (current.currentProfileId !== capturedProfileId || current.currentSessionGeneration !== capturedGeneration) {
      setPickerError("This selection belongs to a previous account session. Cancel it, close this panel, and reopen it to choose the files again.");
    } else if (!current.canWrite) {
      setPickerError("Uploads are paused. Return to the account that selected these files, then retry.");
    }
  };

  useEffect(() => {
    if (uploadMode !== "files" || !initialFiles.length) return;
    if (initialBatchesRef.current.has(initialFiles)) return;
    initialBatchesRef.current.add(initialFiles);
    setPanelOpen(true);
    addLocalFiles(initialFiles, !effectiveConfirmUploads, defaults.folderId, defaults.courseId);
  });

  useEffect(() => {
    if (!effectiveConfirmUploads) return;
    preservePendingFilesForReview();
  }, [effectiveConfirmUploads, preservePendingFilesForReview]);

  useEffect(() => {
    if (effectiveConfirmUploads) return;
    const eligible = localFilesRef.current.filter((candidate) => candidate.autoQueueWhenReady);
    if (!eligible.length || !uploadScopeReady || browserData.loading || browserData.error || !destinationValid || !courseValid || !canAdmitForCapturedContext()) return;
    const ready = eligible.filter((candidate) => candidate.profileId === capturedProfileId && candidate.generation === capturedGeneration);
    if (!ready.length) return;
    const ids = new Set(ready.map((candidate) => candidate.id));
    setLocalSelections((current) => current.filter((candidate) => !ids.has(candidate.id)));
    enqueueFiles(ready.map((candidate) => candidate.file));
  });

  useEffect(() => {
    if (!localFiles.length || !localPreviewId) return;
    const frame = window.requestAnimationFrame(scrollLocalPreviewIntoView);
    return () => window.cancelAnimationFrame(frame);
  }, [localFiles.length, localPreviewId, scrollLocalPreviewIntoView]);

  const acceptFiles = (selected: File[]) => {
    if (!selected.length) return;
    setPickerError("");
    setFolderSelectionError("");
    if (uploadMode === "folder") {
      if (!canAdmitForCapturedContext()) {
        setPickerError("This selection belongs to a previous account session. Cancel it, close this panel, and reopen it to choose the folder again.");
        return;
      }
      if (!destinationValid || !courseValid) {
        setPickerError(!destinationValid ? "Choose an active Files destination first." : "Choose an active course for this upload.");
        return;
      }
      try {
        const plan = buildFolderUploadPlan(selected, {
          profileId: capturedProfileId,
          sessionGeneration: capturedGeneration,
          folderId: destinationId,
          courseId,
        });
        onFolderUploadChange?.({ ...plan, status: "ready", error: "" });
      } catch (error) {
        setFolderSelectionError(error instanceof Error ? error.message : "Choose a folder with supported relative paths.");
      }
      return;
    }
    if (effectiveConfirmUploads) addLocalFiles(selected);
    else enqueueFiles(selected);
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  };

  const handleUploadDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canWrite) return;
    acceptFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const selectDestination = (value: string) => {
    const nextDestination = value || null;
    const nextCourse = !courseWasChosen ? folderCourseId(nextDestination, folders) : courseId;
    setDestinationId(nextDestination);
    if (!courseWasChosen) setCourseId(nextCourse);
    setPickerError("");
    if (uploadMode === "files") setLocalSelections((current) => current.map((candidate) => ({ ...candidate, error: validateLocalFile(candidate.file, nextDestination, nextCourse) })));
  };

  const selectCourse = (value: string) => {
    setCourseWasChosen(true);
    setCourseId(value);
    setPickerError("");
    if (uploadMode === "files") setLocalSelections((current) => current.map((candidate) => ({ ...candidate, error: validateLocalFile(candidate.file, destinationId, value) })));
  };

  const setConfirmationPreference = (enabled: boolean) => {
    if (!canAdmitForCapturedContext()) return;
    if (enabled) preservePendingFilesForReview();
    setLocalConfirmUploads(enabled);
    onConfirmUploadsChange?.(enabled);
  };

  const removeLocalFile = (id: string) => {
    setLocalSelections((current) => current.filter((candidate) => candidate.id !== id));
  };

  const confirmLocalFiles = () => {
    const selected = localFilesRef.current;
    if (!selected.length) return;
    if (!uploadScopeReady) {
      setPickerError("The upload destination is changing. Review the new destination, then retry the upload.");
      return;
    }
    const current = currentStateRef.current;
    const selectionIsStale = current.currentProfileId !== capturedProfileId || current.currentSessionGeneration !== capturedGeneration ||
      selected.some((candidate) => candidate.profileId !== capturedProfileId || candidate.generation !== capturedGeneration);
    if (selectionIsStale || !current.canWrite || !destinationValid || !courseValid) {
      setPickerError(selectionIsStale
        ? "This selection belongs to a previous account session. Cancel it, close this panel, and reopen it to choose the files again."
        : !current.canWrite ? "Uploads are paused. Return to the account that selected these files, then retry."
          : !destinationValid ? "Choose an active Files destination first." : "Choose an active course for this upload.");
      return;
    }
    const valid = selected.filter((candidate) => !candidate.error);
    if (!valid.length) return;
    const ids = new Set(valid.map((candidate) => candidate.id));
    setLocalSelections((currentFiles) => currentFiles.filter((candidate) => !ids.has(candidate.id)));
    enqueueFiles(valid.map((candidate) => candidate.file));
    if (hideConfirmationForFuture) setConfirmationPreference(false);
    setHideConfirmationForFuture(false);
  };

  const dismissLocalFiles = () => {
    setLocalSelections([]);
    setHideConfirmationForFuture(false);
    setPickerError("");
  };

  const updatePlan = (id: string, patch: Partial<PendingFolderUpload>) => {
    onFolderUploadChange?.((current) => current?.id === id ? { ...current, ...patch } : current);
  };

  const downloadFolderPlan = () => {
    if (!folderUpload) return;
    downloadDraft("eduessentials-folder-upload-draft.json", {
      version: 1,
      planId: folderUpload.id,
      profileId: folderUpload.profileId,
      sessionGeneration: folderUpload.sessionGeneration,
      folderId: folderUpload.folderId,
      courseId: folderUpload.courseId,
      files: folderUpload.files.map(({ file, relativePath, targetPath }) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        relativePath,
        targetPath,
      })),
      directories: folderUpload.directories.map(({ id, path, name, parentPath, created }) => ({ id, path, name, parentPath, created })),
      status: folderUpload.status,
      error: folderUpload.error,
    });
  };

  const dismissFolderUpload = () => {
    if (!folderUpload || planBusy) return;
    if (folderHasCreated && !window.confirm("Remove this folder selection? Folders already created in Files will stay in place.")) return;
    onFolderUploadChange?.(null);
  };

  const runFolderUpload = async () => {
    if (!folderUpload || planBusy || !onFolderUploadChange) return;
    const current = currentStateRef.current;
    if (!current.canWrite || current.currentProfileId !== folderUpload.profileId) return;
    const attempt: PendingFolderUpload = {
      ...folderUpload,
      sessionGeneration: current.currentSessionGeneration,
      status: "creating",
      error: "",
    };
    onFolderUploadChange(attempt);
    const controller = new AbortController();
    activeFolderUploadRef.current?.abort();
    activeFolderUploadRef.current = controller;
    const isCurrent = (profileId: string, sessionGeneration: number) => {
      const latest = currentStateRef.current;
      return !controller.signal.aborted && latest.canWrite && latest.currentProfileId === profileId && latest.currentSessionGeneration === sessionGeneration;
    };
    try {
      const folderIds = await ensureFolderUploadHierarchy(attempt.profileId, attempt, {
        signal: controller.signal,
        isCurrent,
        onCreated: (directory) => {
          onFolderUploadChange((previous) => previous?.id === attempt.id
            ? { ...previous, directories: previous.directories.map((candidate) => candidate.path === directory.path ? { ...candidate, created: true } : candidate) }
            : previous);
        },
      });
      if (!isCurrent(attempt.profileId, attempt.sessionGeneration)) throw new DOMException("The account session changed before the folder upload could continue.", "AbortError");
      const byDestination = new Map<string | null, File[]>();
      for (const entry of attempt.files) {
        let targetFolderId: string | null;
        if (entry.targetPath === null) targetFolderId = attempt.folderId;
        else {
          const resolvedFolderId = folderIds.get(entry.targetPath);
          if (!resolvedFolderId) throw new Error(`The folder ${entry.targetPath} could not be confirmed. Retry folder setup before uploading files.`);
          targetFolderId = resolvedFolderId;
        }
        const group = byDestination.get(targetFolderId) ?? [];
        group.push(entry.file);
        byDestination.set(targetFolderId, group);
      }
      for (const [folderId, files] of byDestination) queue.enqueue(files, { folderId, courseId: attempt.courseId ?? "" });
      onFolderUploadChange((previous) => previous?.id === attempt.id ? null : previous);
    } catch (error) {
      const latest = currentStateRef.current;
      const sessionPaused = latest.currentProfileId !== attempt.profileId || latest.currentSessionGeneration !== attempt.sessionGeneration || error instanceof Error && error.name === "AbortError";
      updatePlan(attempt.id, {
        status: "error",
        error: sessionPaused
          ? "Folder setup paused after the account session changed. Return to the original account and retry; created folder IDs and selected files are kept."
          : error instanceof Error && error.message ? error.message : "The folder structure could not be created. Retry to continue with this selection.",
      });
    } finally {
      if (activeFolderUploadRef.current === controller) activeFolderUploadRef.current = null;
    }
  };

  const activeLocalPreview = localFiles.find((candidate) => candidate.id === localPreviewId);
  const localValidCount = localFiles.filter((candidate) => !candidate.error).length;
  const canConfirmLocalFiles = localFiles.length > 0 && localValidCount > 0 && canWrite && capturedSessionCurrent && uploadScopeReady && destinationValid && courseValid;

  return <div
    className={`files-upload-backdrop${panelOpen ? "" : " is-collapsed"}`}
    onClickCapture={(event) => {
      if (!panelOpenRef.current || event.button !== 0 || event.target !== event.currentTarget) return;
      event.preventDefault();
      event.stopPropagation();
      setPanelOpen(false);
    }}
  >
    <div
      id={dialogId}
      className={`files-upload-shell${panelOpen ? "" : " is-collapsed"}`}
      role={panelOpen ? "dialog" : undefined}
      aria-modal={panelOpen ? true : undefined}
      aria-labelledby={`${dialogId}-title`}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "files-upload-exit") finishFullDismissal();
      }}
    >
      <button
        ref={panelToggleRef}
        type="button"
        className="files-upload-panel-toggle"
        aria-controls={dialogId}
        aria-expanded={panelOpen}
        aria-label={panelOpen ? "Hide upload panel" : "Show upload panel"}
        onClick={() => setPanelOpen(!panelOpen)}
      >
        <ChevronUp size={24} aria-hidden="true" />
      </button>
      <section
      className={`files-upload-dialog${uploadMode === "folder" ? " is-folder-upload" : ""}`}
      ref={dialogRef}
      aria-hidden={!panelOpen}
      inert={!panelOpen}
      tabIndex={-1}
    >
      <header className="files-upload-header">
        <div><h2 id={`${dialogId}-title`}>{uploadMode === "folder" ? "Upload folder" : "Upload files"}</h2><p>Add files to your library.</p></div>
        <div className="files-upload-header-tools">
          <div className="files-upload-settings-wrap">
            <button ref={settingsButtonRef} type="button" className="files-upload-settings-trigger" aria-haspopup="menu" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
              <Settings2 size={15} aria-hidden="true" /> Upload settings
            </button>
            <div ref={settingsMenuRef} className="files-upload-settings-menu" role="menu" aria-label="Upload settings" hidden={!settingsOpen}>
              <label><input type="checkbox" role="menuitemcheckbox" aria-checked={effectiveConfirmUploads} aria-label="Confirm before uploading" checked={effectiveConfirmUploads} disabled={!preferenceChangeAllowed} onChange={(event) => setConfirmationPreference(event.currentTarget.checked)} /> Confirm before uploading</label>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="files-upload-close" onClick={requestFullDismissal} aria-label="Close upload panel"><X size={22} /></button>
        </div>
      </header>

      <div className="files-upload-body" ref={bodyRef}>
        <div
          className={`files-upload-dropzone${canWrite ? "" : " is-disabled"}`}
          onDragOver={(event) => { event.preventDefault(); }}
          onDrop={handleUploadDrop}
          aria-label={uploadMode === "folder" ? "Folder upload dropzone" : "File upload dropzone"}
        >
          <Upload size={54} strokeWidth={1.8} aria-hidden="true" />
          <strong>{uploadMode === "folder" ? "Choose a folder to upload" : "Drop files here"}</strong>
          <span className="files-upload-drop-divider">or</span>
          <button ref={chooseButtonRef} type="button" className="files-upload-choose" disabled={!preferenceChangeAllowed || Boolean(folderUpload && (planBusy || folderHasCreated))} onClick={() => inputRef.current?.click()}>
            {uploadMode === "folder" ? "Choose folder" : "Choose files"}
          </button>
          <small>{uploadMode === "folder" ? "Folder structure stays intact · up to 25 MiB per file" : "Multiple files · up to 25 MiB each"}</small>
          <input
            ref={inputRef}
            type="file"
            multiple={uploadMode === "files"}
            disabled={!preferenceChangeAllowed || Boolean(folderUpload && (planBusy || folderHasCreated))}
            onChange={handleFiles}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
        {!canWrite && <p className="files-upload-gate" role="status">Uploads are paused. Return to the account that selected these files, then retry.</p>}
        {!capturedSessionCurrent && <p className="files-upload-gate" role="status">This upload panel belongs to a previous account session. Cancel any local selection, close this panel, and reopen it to choose files again.</p>}

        <section className="files-upload-destination" aria-label="Upload destination">
          <span className="files-upload-control-label">Destination</span>
          <div className="files-upload-destination-card">
            <Folder size={19} aria-hidden="true" />
            <span><strong>{destinationLabel}</strong>{(destinationId || browserData.loading || browserData.error) && <small>{browserData.loading ? "Loading active folders…" : browserData.error ? "Folder list unavailable" : "Active folder"}</small>}</span>
            <button type="button" disabled={!preferenceChangeAllowed || planBusy || Boolean(folderUpload)} onClick={() => setShowDestinationPicker((visible) => !visible)}>{showDestinationPicker ? "Done" : "Change"}</button>
          </div>
          {showDestinationPicker && <label className="files-upload-select-wrap"><span>Choose a destination folder</span>
            <select aria-label="Destination folder" value={destinationId ?? ""} disabled={!preferenceChangeAllowed || browserData.loading || Boolean(browserData.error) || Boolean(folderUpload)} onChange={(event) => selectDestination(event.currentTarget.value)}>
              <option value="">Files</option>
              {folders.slice().sort((left, right) => folderLabel(left.id, folders).localeCompare(folderLabel(right.id, folders))).map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(Math.min(8, folderDepth(folder, folders) - 1))}{folderLabel(folder.id, folders)}</option>)}
            </select>
          </label>}
          {browserData.error && destinationId !== null && <p className="files-upload-error" role="alert">{browserData.error} Retry from Files to refresh available destinations.</p>}
          {!destinationValid && <p className="files-upload-error" role="alert">This destination is no longer active. Choose My files or another active folder.</p>}
        </section>

        <section className="files-upload-course" aria-label="Optional course link">
          <label className="files-upload-select-wrap"><span>Course link (optional)</span>
            <span className="files-upload-course-card"><Link2 size={19} aria-hidden="true" />
              <select aria-label="Course link" value={courseId} disabled={!preferenceChangeAllowed || Boolean(folderUpload)} onChange={(event) => selectCourse(event.currentTarget.value)}>
                <option value="">Add after upload</option>
                {courseId && !courseValid && <option value={courseId} disabled>Course unavailable</option>}
                {courses.map((course) => <option key={course.id} value={course.id}>{course.code || course.name}</option>)}
              </select>
              <span aria-hidden="true">›</span>
            </span>
          </label>
        </section>

        {localFiles.length > 0 && <section className="files-upload-review" aria-label="Files ready for upload">
          <header><div><strong>Review files before upload</strong><small>Selected files stay on this device until you upload them.</small></div><span>{localFiles.length} {localFiles.length === 1 ? "file" : "files"}</span></header>
          <div className="files-upload-review-list">
            {localFiles.map((candidate) => <article className="files-upload-review-row" key={candidate.id} data-local-file-id={candidate.id}>
              <div className="files-upload-review-main">
                <strong title={candidate.file.name}>{candidate.file.name || "Unnamed file"}</strong>
                <small>{candidate.file.type || "Unknown type"} · {fileSize(candidate.file.size)}</small>
                <span className={candidate.error ? "has-error" : "is-ready"}>{candidate.error ? "Not uploaded · Needs attention" : "Not uploaded · Ready to upload"}</span>
                {candidate.error && <p className="files-upload-error" role="alert">{candidate.error}</p>}
              </div>
              <div className="files-upload-review-actions">
                <button type="button" className="files-upload-secondary" aria-label={`Preview ${candidate.file.name} locally`} aria-pressed={localPreviewId === candidate.id} onClick={() => {
                  setLocalPreviewId(candidate.id);
                  window.requestAnimationFrame(scrollLocalPreviewIntoView);
                }}>Preview</button>
                <button type="button" className="files-upload-dismiss" aria-label={`Remove ${candidate.file.name}`} onClick={() => removeLocalFile(candidate.id)}>Remove</button>
              </div>
            </article>)}
          </div>
          {activeLocalPreview && <div className="files-upload-preview-anchor" ref={localPreviewRef}><LocalFilePreview key={activeLocalPreview.id} file={activeLocalPreview.file} /></div>}
          {capturedSessionCurrent && !canWrite && <p className="files-upload-gate" role="status">Uploads are paused. Cancel or close this selection, then return to the account that selected it.</p>}
        </section>}

        {(pickerError || folderSelectionError) && <p className="files-upload-error" role="alert">{folderSelectionError || pickerError}</p>}

        {folderUpload && <section className={`files-folder-upload-plan is-${folderUpload.status}`} aria-live="polite">
          <div className="files-folder-upload-heading"><FolderOpen size={18} aria-hidden="true" /><div><strong>{folderUpload.files[0]?.relativePath.split("/")[0] || "Selected folder"}</strong><small>{folderUpload.files.length} {folderUpload.files.length === 1 ? "file" : "files"} · {folderUpload.directories.filter((directory) => directory.created).length} / {folderUpload.directories.length} folders ready</small></div></div>
          {folderUpload.status === "creating" && <p role="status">Preparing the folder structure…</p>}
          {folderUpload.error && <p className="files-upload-error" role="alert">{folderUpload.error}</p>}
          <div className="files-folder-upload-actions">
            <button type="button" className="files-upload-choose" disabled={!canWrite || currentProfileId !== folderUpload.profileId || planBusy} onClick={() => void runFolderUpload()}>
              {folderUpload.status === "error" ? "Retry folder setup" : folderUpload.directories.some((directory) => directory.created) ? "Continue folder upload" : "Upload folder"}
            </button>
            {!planBusy && <button type="button" className="files-upload-dismiss" onClick={dismissFolderUpload}>Dismiss selection</button>}
          </div>
          <div className="files-folder-upload-recovery">
            <button type="button" className="files-upload-secondary" disabled={planBusy} onClick={downloadFolderPlan}>Download folder plan</button>
            <button type="button" className="files-upload-secondary" disabled={planBusy} onClick={() => folderUpload.files.forEach(downloadFolderOriginal)}>Download selected files individually</button>
          </div>
          <small className="files-folder-upload-disclaimer">Individual downloads do not include the folder structure. The plan keeps each original path. Dismissing this selection leaves created folders in Files.</small>
          {currentProfileId !== folderUpload.profileId && <p className="files-upload-gate" role="status">This folder belongs to the account that selected it.</p>}
        </section>}

        {!queue.rows.length && !folderUpload && !localFiles.length && <p className="files-upload-empty">No files selected yet.</p>}
        <div className="files-upload-list" aria-live="polite">
          {queue.rows.map((row) => {
            const inProgress = row.status === "uploading" || row.status === "refreshing";
            const retryableState = row.status === "error" || row.status === "refresh-error";
            const onOriginalAccount = row.profileId === currentProfileId;
            const progressValue = row.status === "complete" ? 100 : Math.min(99, Math.round(row.progress * 100));
            const displayName = relativeFileName(row.file);
            return <article className={`files-upload-row is-${row.status}`} key={row.id} data-upload-id={row.id}>
              <div className="files-upload-row-main">
                <div className="files-upload-file-heading"><strong title={displayName}>{displayName}</strong><span>{fileSize(row.file.size)}</span></div>
                <p className="files-upload-status" role="status">{statusLabel(row, currentProfileId)}</p>
                {row.error && <p className="files-upload-error">{row.error}</p>}
                {(inProgress || row.status === "error" || row.status === "refresh-error") && <progress aria-label={`${displayName} upload progress`} max={100} value={progressValue}>{progressValue}%</progress>}
              </div>
              <div className="files-upload-actions">
                {retryableState && <button type="button" className="files-upload-secondary" disabled={!canWrite || !onOriginalAccount || !row.retryable} title={!onOriginalAccount ? "Return to the account that selected this file." : !canWrite ? "Uploads are temporarily unavailable." : undefined} onClick={() => { void queue.retry(row.id).catch(() => {}); }}>Retry upload</button>}
                <button type="button" className="files-upload-secondary" onClick={() => downloadOriginal(row)}>Download original</button>
                <button type="button" className="files-upload-secondary" onClick={() => downloadRequest(row)}>Download request draft</button>
                <button type="button" className="files-upload-dismiss" disabled={inProgress} onClick={() => queue.dismiss(row.id)} aria-label={`Dismiss upload ${displayName}`}>Dismiss</button>
              </div>
            </article>;
          })}
        </div>
      </div>

      <footer className="files-upload-footer">
        <span><ShieldCheck size={16} aria-hidden="true" /> Your files stay private.</span>
        <div className="files-upload-footer-actions">
          {localFiles.length > 0 && <>
            <label className="files-upload-opt-out"><input type="checkbox" aria-label="Do not show again" checked={hideConfirmationForFuture} disabled={!preferenceChangeAllowed} onChange={(event) => setHideConfirmationForFuture(event.currentTarget.checked)} /> Do not show again</label>
            <button type="button" className="files-upload-cancel-review" onClick={dismissLocalFiles}>Cancel selection</button>
            <button type="button" className="files-upload-close-action files-upload-confirm" disabled={!canConfirmLocalFiles} onClick={confirmLocalFiles}>Upload files</button>
          </>}
          {(queue.rows.length > 0 || folderUpload) && <button type="button" className="files-upload-close-action" onClick={requestFullDismissal}>Close</button>}
        </div>
      </footer>
      </section>
    </div>
  </div>;
}

export default FileUploadDialog;
