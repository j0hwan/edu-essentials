"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSaveProtection } from "./use-save-protection";
import type { FileMetadata, PrivateFile } from "../lib/files";
import { uploadFileWithProgress, type FileUploadOptions } from "../lib/file-upload";

type ProfileSession = { profileId: string; generation: number };
type KeyedValue<T> = { key: string; value: T };
type BusyValue = { key: string; count: number };

function sessionKey(session: ProfileSession): string {
  return `${session.generation}:${session.profileId}`;
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

export function usePrivateFiles(profileId: string) {
  const [storedSession, setStoredSession] = useState<ProfileSession>(() => ({ profileId, generation: 0 }));
  let currentSession = storedSession;
  if (storedSession.profileId !== profileId) {
    currentSession = { profileId, generation: storedSession.generation + 1 };
    setStoredSession(currentSession);
  }
  const currentKey = sessionKey(currentSession);
  const [filesState, setFilesState] = useState<KeyedValue<PrivateFile[]>>(() => ({ key: currentKey, value: [] }));
  const [errorState, setErrorState] = useState<KeyedValue<string>>(() => ({ key: currentKey, value: "" }));
  const [loadingState, setLoadingState] = useState<KeyedValue<boolean>>(() => ({ key: currentKey, value: true }));
  const [busyState, setBusyState] = useState<BusyValue>(() => ({ key: currentKey, count: 0 }));
  const versions = useRef(new Map<string, number>());
  const activeMutations = useRef(new Map<string, number>());
  const currentSessionRef = useRef(currentSession);
  const files = filesState.key === currentKey ? filesState.value : [];
  const error = errorState.key === currentKey ? errorState.value : "";
  const loading = loadingState.key === currentKey ? loadingState.value : true;
  const busy = busyState.key === currentKey && busyState.count > 0;
  useSaveProtection(busy);

  useLayoutEffect(() => { currentSessionRef.current = currentSession; }, [currentKey, currentSession]);

  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(120000), headers: { ...Object.fromEntries(new Headers(init.headers)), "x-profile-id": profileId } });
    if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(response.status === 401 ? "Sign in to the original account in a new tab, then retry. Your file selection is still here." : body.error || "File request failed. Please retry."); }
    return response;
  }, [profileId]);

  const refresh = useCallback(async (signal?: AbortSignal, throwOnError = false) => {
    const captured = currentSession;
    const key = currentKey;
    const isCurrent = () => {
      const active = currentSessionRef.current;
      return active.profileId === captured.profileId && active.generation === captured.generation;
    };
    if (!isCurrent()) return;
    const version = (versions.current.get(key) ?? 0) + 1;
    versions.current.set(key, version);
    await Promise.resolve();
    if (signal?.aborted || !isCurrent()) {
      if (throwOnError) throw signal?.reason ?? abortError("The Files refresh was interrupted.");
      return;
    }
    setLoadingState((current) => isCurrent() ? { key, value: true } : current);
    try {
      const data = await (await request("/api/files", { signal })).json() as { files?: PrivateFile[] };
      if (!Array.isArray(data.files)) throw new Error("Unable to load your file list.");
      if (!signal?.aborted && isCurrent() && versions.current.get(key) === version) {
        setFilesState((current) => isCurrent() ? { key, value: data.files! } : current);
        setErrorState((current) => isCurrent() ? { key, value: "" } : current);
      } else if (throwOnError) throw abortError("The Files refresh was interrupted.");
    } catch (error) {
      if (!signal?.aborted && isCurrent() && versions.current.get(key) === version) {
        setErrorState((current) => isCurrent() ? { key, value: (error as Error).message } : current);
      }
      if (throwOnError) throw error;
    } finally {
      if (!signal?.aborted && isCurrent() && versions.current.get(key) === version) {
        setLoadingState((current) => isCurrent() ? { key, value: false } : current);
      }
    }
  }, [currentKey, currentSession, request]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);

  const blob = useCallback(async (file: PrivateFile, signal?: AbortSignal) => (await request(`/api/files?id=${file.id}`, { signal })).blob(), [request]);
  const mutate = async (work: () => Promise<PrivateFile>, removeId?: string) => {
    const captured = currentSession;
    const key = currentKey;
    const isCurrent = () => {
      const active = currentSessionRef.current;
      return active.profileId === captured.profileId && active.generation === captured.generation;
    };
    if (!isCurrent()) throw abortError("The file operation belongs to a previous account session.");
    versions.current.set(key, (versions.current.get(key) ?? 0) + 1);
    const count = (activeMutations.current.get(key) ?? 0) + 1;
    activeMutations.current.set(key, count);
    setBusyState((current) => isCurrent() ? { key, count } : current);
    setErrorState((current) => isCurrent() ? { key, value: "" } : current);
    try {
      const file = await work();
      if (!isCurrent()) throw abortError("The file operation completed in a previous account session. Retry it from the original account.");
      setFilesState((current) => {
        if (!isCurrent()) return current;
        const currentFiles = current.key === key ? current.value : [];
        return { key, value: removeId
          ? currentFiles.filter((item) => item.id !== removeId)
          : [file, ...currentFiles.filter((item) => item.id !== file.id)] };
      });
      if (!isCurrent()) throw abortError("The file operation completed in a previous account session. Retry it from the original account.");
      return file;
    } catch (error) {
      if (isCurrent()) setErrorState((current) => isCurrent() ? { key, value: (error as Error).message } : current);
      throw error;
    } finally {
      const remaining = Math.max(0, (activeMutations.current.get(key) ?? 1) - 1);
      if (remaining) activeMutations.current.set(key, remaining);
      else activeMutations.current.delete(key);
      if (isCurrent()) {
        versions.current.set(key, (versions.current.get(key) ?? 0) + 1);
        setBusyState((current) => isCurrent() ? { key, count: remaining } : current);
        setLoadingState((current) => isCurrent() ? { key, value: false } : current);
      }
    }
  };
  const readSavedFile = async (response: Response) => (await response.json() as { file: PrivateFile }).file;
  return { files, error, loading, busy, refresh,
    upload: (file: File, metadata: FileMetadata, id: string, options: FileUploadOptions = {}) => mutate(() => options.onProgress
      ? uploadFileWithProgress(profileId, id, file, metadata, options)
      : request(`/api/files?id=${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-file-metadata": encodeURIComponent(JSON.stringify(metadata)) }, body: file, signal: options.signal }).then(readSavedFile)),
    edit: (file: PrivateFile, metadata: FileMetadata) => mutate(() => request(`/api/files?id=${file.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...metadata, baseRevision: file.updated_at }) }).then(readSavedFile)),
    remove: (file: PrivateFile) => mutate(() => request(`/api/files?id=${file.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRevision: file.updated_at }) }).then(readSavedFile), file.id),
    blob,
    url: (file: PrivateFile) => `/api/files?id=${file.id}&account=${encodeURIComponent(profileId)}`,
  };
}
export type FileStore = ReturnType<typeof usePrivateFiles>;
