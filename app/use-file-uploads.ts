"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fileMetadata, hashBytes, isFileId, MAX_FILE_BYTES, type FileMetadata, type PrivateFile } from "../lib/files";
import type { FileStore } from "./use-private-files";
import { useSaveProtection } from "./use-save-protection";

export type FileUploadSession = { profileId: string; generation: number };
export type FileUploadDefaults = { folderId: string | null; courseId: string };
export type FileUploadStatus = "queued" | "uploading" | "refreshing" | "complete" | "error" | "refresh-error";

export type FileUploadRow = {
  id: string;
  /** The original selected File object is retained for exact retries. */
  file: File;
  /** Captured once at selection time and reused unchanged for every retry. */
  metadata: FileMetadata;
  profileId: string;
  originalSession: FileUploadSession;
  attemptSession: FileUploadSession;
  status: FileUploadStatus;
  progress: number;
  error: string;
  acknowledged: boolean;
  uploaded?: PrivateFile;
  retryable: boolean;
};

export type FileUploadDraft = {
  version: 1;
  uploads: Array<{
    id: string;
    profileId: string;
    originalGeneration: number;
    lastAttempt: FileUploadSession;
    name: string;
    size: number;
    type: string;
    lastModified: number;
    metadata: FileMetadata;
    status: FileUploadStatus;
    progress: number;
    error: string;
    acknowledged: boolean;
    uploadedFile: null | Pick<PrivateFile, "id" | "name" | "size_bytes" | "content_sha256" | "folder_id" | "course_id" | "assignment_id" | "kind">;
  }>;
};

export type FileUploadQueue = {
  rows: FileUploadRow[];
  busy: boolean;
  dirty: boolean;
  draft: FileUploadDraft;
  enqueue: (files: readonly File[], defaults: FileUploadDefaults) => void;
  retry: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
};

type FileUploadStore = Pick<FileStore, "upload">;
type RowPatch = Partial<Omit<FileUploadRow, "id" | "file" | "metadata" | "profileId" | "originalSession">>;
type ActiveAttempt = { id: string; session: FileUploadSession; controller: AbortController };

function copySession(session: FileUploadSession): FileUploadSession {
  return { profileId: session.profileId, generation: session.generation };
}

function sameSession(left: FileUploadSession, right: FileUploadSession): boolean {
  return left.profileId === right.profileId && left.generation === right.generation;
}

function getError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function abortError(message: string): Error {
  return new DOMException(message, "AbortError");
}

function validateAck(
  file: PrivateFile,
  id: string,
  selectedFile: File,
  metadata: FileMetadata,
  expectedHash: string,
): void {
  const expectedCourse = metadata.courseId || null;
  const expectedAssignment = metadata.assignmentId || null;
  const expectedFolder = metadata.folderId ?? null;
  if (!file || file.id !== id || !isFileId(file.id) || file.state !== "ready" || file.trashed_at !== null ||
      file.name !== metadata.name || Number(file.size_bytes) !== selectedFile.size ||
      file.content_sha256?.toLowerCase() !== expectedHash || file.course_id !== expectedCourse ||
      file.assignment_id !== expectedAssignment || file.kind !== metadata.kind || file.folder_id !== expectedFolder ||
      file.content_backend !== "object" || !Number.isSafeInteger(file.metadata_revision) || file.metadata_revision < 1 ||
      !Number.isSafeInteger(file.content_revision) || file.content_revision < 1) {
    throw new Error("The server did not confirm the selected file and its saved details. Retry the same selection to check its upload.");
  }
}

async function digestFile(file: File): Promise<string> {
  return hashBytes(new Uint8Array(await file.arrayBuffer()));
}

export function useFileUploads(
  session: FileUploadSession,
  store: FileUploadStore,
  onUploaded: (file: PrivateFile, signal: AbortSignal) => Promise<void>,
  enabled = true,
): FileUploadQueue {
  const [rows, setRows] = useState<FileUploadRow[]>([]);
  const rowsRef = useRef(rows);
  const sessionRef = useRef(session);
  const enabledRef = useRef(enabled);
  const storeRef = useRef(store);
  const onUploadedRef = useRef(onUploaded);
  const activeRef = useRef<ActiveAttempt | null>(null);
  const pumpRef = useRef<Promise<void> | null>(null);
  const scheduleRef = useRef<() => Promise<void>>(async () => {});
  const lastContextRef = useRef({ session: copySession(session) });

  const replaceRows = useCallback((next: FileUploadRow[] | ((current: FileUploadRow[]) => FileUploadRow[])) => {
    const value = typeof next === "function" ? next(rowsRef.current) : next;
    rowsRef.current = value;
    setRows(value);
  }, []);

  const updateRow = useCallback((id: string, patch: RowPatch) => {
    replaceRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }, [replaceRows]);

  const findRow = useCallback((id: string) => rowsRef.current.find((row) => row.id === id), []);
  const hasEligibleRow = useCallback(() => {
    const currentSession = sessionRef.current;
    return enabledRef.current && rowsRef.current.some((row) => row.status === "queued" &&
      row.profileId === currentSession.profileId && sameSession(row.attemptSession, currentSession));
  }, []);

  const processRow = useCallback(async (row: FileUploadRow) => {
    const attemptSession = copySession(row.attemptSession);
    const controller = new AbortController();
    activeRef.current = { id: row.id, session: attemptSession, controller };
    const isCurrentAttempt = () => enabledRef.current && !controller.signal.aborted && sameSession(sessionRef.current, attemptSession);
    const pausedMessage = () => row.acknowledged
      ? "The upload was confirmed, but refreshing Files was paused. Return to the original account and retry the refresh."
      : "The upload was paused before confirmation. Return to the original account and retry the same file.";
    updateRow(row.id, { status: row.acknowledged && row.uploaded ? "refreshing" : "uploading", progress: row.acknowledged ? 0.99 : 0, error: "" });

    try {
      let uploaded = row.uploaded;
      if (!row.acknowledged || !uploaded) {
        const expectedHash = await digestFile(row.file);
        if (!isCurrentAttempt()) throw abortError(pausedMessage());
        uploaded = await storeRef.current.upload(row.file, row.metadata, row.id, {
          signal: controller.signal,
          onProgress: (loaded, total) => {
            if (!isCurrentAttempt()) return;
            const ratio = total > 0 ? Math.max(0, Math.min(0.99, loaded / total)) : 0;
            updateRow(row.id, { progress: ratio });
          },
        });
        if (!isCurrentAttempt()) throw abortError(pausedMessage());
        validateAck(uploaded, row.id, row.file, row.metadata, expectedHash);
        updateRow(row.id, { acknowledged: true, uploaded, progress: 0.99, status: "refreshing" });
      }

      if (!isCurrentAttempt()) throw abortError(pausedMessage());
      await onUploadedRef.current(uploaded, controller.signal);
      if (!isCurrentAttempt()) throw abortError(pausedMessage());
      updateRow(row.id, { status: "complete", progress: 1, error: "", retryable: false });
    } catch (error) {
      const latest = findRow(row.id);
      const acknowledged = Boolean(latest?.acknowledged && latest.uploaded);
      const stale = !isCurrentAttempt();
      updateRow(row.id, {
        status: acknowledged ? "refresh-error" : "error",
        error: stale ? pausedMessage() : getError(error, acknowledged ? "Upload saved, but Files could not refresh. Retry the refresh." : "Upload failed. Retry the original file."),
        retryable: latest?.retryable !== false,
      });
    } finally {
      if (activeRef.current?.controller === controller) activeRef.current = null;
    }
  }, [findRow, updateRow]);

  const drain = useCallback(async () => {
    while (enabledRef.current) {
      const currentSession = sessionRef.current;
      const row = rowsRef.current.find((candidate) => candidate.status === "queued" &&
        candidate.profileId === currentSession.profileId && sameSession(candidate.attemptSession, currentSession));
      if (!row) return;
      await processRow(row);
    }
  }, [processRow]);

  const schedule = useCallback((): Promise<void> => {
    if (pumpRef.current) return pumpRef.current;
    if (!hasEligibleRow()) return Promise.resolve();
    const running = drain().finally(() => {
      if (pumpRef.current === running) pumpRef.current = null;
      if (hasEligibleRow()) queueMicrotask(() => { void scheduleRef.current(); });
    });
    pumpRef.current = running;
    return running;
  }, [drain, hasEligibleRow]);

  useLayoutEffect(() => {
    sessionRef.current = session;
    enabledRef.current = enabled;
    storeRef.current = store;
    onUploadedRef.current = onUploaded;
    scheduleRef.current = schedule;
  }, [enabled, onUploaded, schedule, session, session.generation, session.profileId, store]);

  const enqueue = useCallback((files: readonly File[], defaults: FileUploadDefaults) => {
    const originalSession = copySession(sessionRef.current);
    const added = Array.from(files, (file): FileUploadRow => {
      const id = crypto.randomUUID();
      let metadata: FileMetadata;
      let validationError = "";
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error("Choose a file up to 25 MiB.");
        metadata = fileMetadata({ name: file.name, courseId: defaults.courseId, assignmentId: "", kind: "resource", folderId: defaults.folderId });
        Object.freeze(metadata);
      } catch (error) {
        validationError = getError(error, "Choose a valid file name and destination.");
        metadata = Object.freeze({ name: file.name, courseId: defaults.courseId, assignmentId: "", kind: "resource", folderId: defaults.folderId });
      }
      return {
        id,
        file,
        metadata,
        profileId: originalSession.profileId,
        originalSession,
        attemptSession: copySession(originalSession),
        status: validationError ? "error" : "queued",
        progress: 0,
        error: validationError,
        acknowledged: false,
        retryable: !validationError,
      };
    });
    if (added.length) {
      replaceRows((current) => [...current, ...added]);
      void scheduleRef.current();
    }
  }, [replaceRows]);

  const retry = useCallback(async (id: string) => {
    const row = findRow(id);
    if (!row) throw new Error("This upload is no longer in the queue.");
    if (row.status === "complete") return;
    if (row.status === "uploading" || row.status === "refreshing") return;
    if (!row.retryable) throw new Error(row.error || "This selection cannot be retried. Choose the original file again.");
    const currentSession = copySession(sessionRef.current);
    if (!enabledRef.current) throw new Error("Uploads are unavailable until the current workspace change finishes.");
    if (!currentSession.profileId || currentSession.profileId !== row.profileId) {
      throw new Error("Sign in to the original account before retrying this selection.");
    }
    updateRow(id, { status: "queued", attemptSession: currentSession, progress: row.acknowledged ? 0.99 : 0, error: "" });
    for (;;) {
      await scheduleRef.current();
      const latest = findRow(id);
      if (!latest || latest.status !== "queued") return;
      if (!enabledRef.current || !sameSession(latest.attemptSession, sessionRef.current)) return;
    }
  }, [findRow, updateRow]);

  const dismiss = useCallback((id: string) => {
    if (activeRef.current?.id === id) return;
    replaceRows((current) => current.filter((row) => row.id !== id));
  }, [replaceRows]);

  useLayoutEffect(() => {
    const active = activeRef.current;
    if (active && (!enabled || !sameSession(active.session, session))) active.controller.abort();
    const previous = lastContextRef.current;
    if (!sameSession(previous.session, session)) {
      queueMicrotask(() => replaceRows((current) => current.map((row) => row.status === "queued" && !sameSession(row.attemptSession, session)
        ? { ...row, status: "error", error: row.profileId === session.profileId
          ? "The account session changed before this upload started. Retry it explicitly to continue."
          : "This selection belongs to another account. Switch back to that account and retry it explicitly.", retryable: row.retryable }
        : row)));
    }
    lastContextRef.current = { session: copySession(session) };
  }, [enabled, session, session.generation, session.profileId, replaceRows]);

  useEffect(() => {
    if (enabled) queueMicrotask(() => { void scheduleRef.current(); });
  }, [enabled, session.profileId, session.generation]);

  useEffect(() => () => activeRef.current?.controller.abort(), []);

  const busy = rows.some((row) => row.status === "uploading" || row.status === "refreshing");
  const dirty = rows.some((row) => row.status !== "complete");
  useSaveProtection(busy || dirty);

  const draft = useMemo<FileUploadDraft>(() => ({
    version: 1,
    uploads: rows.filter((row) => row.status !== "complete").map((row) => ({
      id: row.id,
      profileId: row.profileId,
      originalGeneration: row.originalSession.generation,
      lastAttempt: copySession(row.attemptSession),
      name: row.file.name,
      size: row.file.size,
      type: row.file.type,
      lastModified: row.file.lastModified,
      metadata: { ...row.metadata },
      status: row.status,
      progress: row.progress,
      error: row.error,
      acknowledged: row.acknowledged,
      uploadedFile: row.uploaded ? {
        id: row.uploaded.id,
        name: row.uploaded.name,
        size_bytes: row.uploaded.size_bytes,
        content_sha256: row.uploaded.content_sha256,
        folder_id: row.uploaded.folder_id,
        course_id: row.uploaded.course_id,
        assignment_id: row.uploaded.assignment_id,
        kind: row.uploaded.kind,
      } : null,
    })),
  }), [rows]);

  return { rows, busy, dirty, draft, enqueue, retry, dismiss };
}
