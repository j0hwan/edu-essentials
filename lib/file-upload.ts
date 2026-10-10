import type { FileMetadata, PrivateFile } from "./files";

export type FileUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
};

const UPLOAD_TIMEOUT_MS = 120_000;

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException("The upload was interrupted.", "AbortError");
}

function responseMessage(status: number, responseText: string): string {
  if (status === 401) return "Sign in to the original account in a new tab, then retry. Your file selection is still here.";
  try {
    const payload = JSON.parse(responseText) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  } catch {
    // Use the status-based message when the server did not return JSON.
  }
  return "File upload failed. Please retry.";
}

/** Upload through XHR so callers that request progress can observe byte transfer. */
export function uploadFileWithProgress(
  profileId: string,
  id: string,
  file: File,
  metadata: FileMetadata,
  options: FileUploadOptions,
): Promise<PrivateFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = () => {
      try { xhr.abort(); } catch { /* The request may already have completed. */ }
      finish(() => reject(abortError(options.signal)));
    };

    if (options.signal?.aborted) {
      finish(() => reject(abortError(options.signal)));
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.open("POST", `/api/files?id=${encodeURIComponent(id)}`);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-file-metadata", encodeURIComponent(JSON.stringify(metadata)));
    xhr.setRequestHeader("x-profile-id", profileId);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      try { options.onProgress?.(event.loaded, event.total); } catch { /* Progress reporting must not interrupt the upload. */ }
    };
    xhr.onload = () => finish(() => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(responseMessage(xhr.status, xhr.responseText)));
        return;
      }
      try {
        const payload = JSON.parse(xhr.responseText) as { file?: unknown };
        if (!payload.file || typeof payload.file !== "object" || Array.isArray(payload.file)) {
          throw new Error("The server returned incomplete upload data.");
        }
        resolve(payload.file as PrivateFile);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("The server returned invalid upload data."));
      }
    });
    xhr.onerror = () => finish(() => reject(new Error("Network error while uploading the file. Please retry.")));
    xhr.ontimeout = () => finish(() => reject(new Error("The upload timed out. Retry the original file.")));
    xhr.onabort = () => finish(() => reject(abortError(options.signal)));
    try { xhr.send(file); }
    catch (error) { finish(() => reject(error instanceof Error ? error : new Error("File upload failed. Please retry."))); }
  });
}
