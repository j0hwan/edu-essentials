"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSaveProtection } from "./use-save-protection";
import type { FileMetadata, PrivateFile } from "../lib/files";

export function usePrivateFiles(profileId: string) {
  const [files, setFiles] = useState<PrivateFile[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  useSaveProtection(busy);
  const generation = useRef(0);
  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(120000), headers: { ...Object.fromEntries(new Headers(init.headers)), "x-profile-id": profileId } });
    if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(response.status === 401 ? "Sign in to the original account in a new tab, then retry. Your file selection is still here." : body.error || "File request failed. Please retry."); }
    return response;
  }, [profileId]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++generation.current;
    await Promise.resolve();
    if (signal?.aborted) return;
    setLoading(true);
    try { const data = await (await request("/api/files", { signal })).json() as { files?: PrivateFile[] }; if (!Array.isArray(data.files)) throw new Error("Unable to load your file list."); if (!signal?.aborted && version === generation.current) { setFiles(data.files); setError(""); } }
    catch (error) { if (!signal?.aborted && version === generation.current) setError((error as Error).message); }
    finally { if (!signal?.aborted && version === generation.current) setLoading(false); }
  }, [request]);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => refresh(controller.signal)); return () => controller.abort(); }, [refresh]);
  const blob = useCallback(async (file: PrivateFile, signal?: AbortSignal) => (await request(`/api/files?id=${file.id}`, { signal })).blob(), [request]);
  const mutate = async (work: () => Promise<Response>, removeId?: string) => {
    ++generation.current;
    setBusy(true); setError("");
    try { const result = await (await work()).json() as { file: PrivateFile }; setFiles((current) => removeId ? current.filter((f) => f.id !== removeId) : [result.file, ...current.filter((f) => f.id !== result.file.id)]); return result.file; }
    catch (error) { setError((error as Error).message); throw error; }
    finally { ++generation.current; setBusy(false); setLoading(false); }
  };
  return { files, error, loading, busy, refresh,
    upload: (file: File, metadata: FileMetadata, id: string) => mutate(() => request(`/api/files?id=${id}`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-file-metadata": encodeURIComponent(JSON.stringify(metadata)) }, body: file })),
    edit: (file: PrivateFile, metadata: FileMetadata) => mutate(() => request(`/api/files?id=${file.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...metadata, baseRevision: file.updated_at }) })),
    remove: (file: PrivateFile) => mutate(() => request(`/api/files?id=${file.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRevision: file.updated_at }) }), file.id),
    blob,
    url: (file: PrivateFile) => `/api/files?id=${file.id}&account=${encodeURIComponent(profileId)}`,
  };
}
export type FileStore = ReturnType<typeof usePrivateFiles>;
