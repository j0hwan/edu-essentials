import type { SupabaseClient } from "@supabase/supabase-js";
import { FILE_BUCKET, hashBytes, type PrivateFile } from "./files";

export type NativeDocumentSnapshot = {
  file_id: string;
  body: string;
  content_revision: number | string;
};

export type FileContentMetadata = Omit<PrivateFile, "size_bytes" | "content_revision"> & {
  size_bytes: number | string;
  content_revision: number | string;
  profile_id?: string;
  deleted_at?: string | null;
  trashed_at?: string | null;
};

export type FileContentReadOptions = {
  allowTrashed?: boolean;
  nativeSnapshot?: NativeDocumentSnapshot;
  signal?: AbortSignal;
};

function contentError(message = "File content is unavailable or changed.", code = "FCONT") {
  return Object.assign(new Error(message), { code });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The file read was interrupted.", "AbortError");
}

async function verifyBytes(file: FileContentMetadata, bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength !== Number(file.size_bytes)) throw contentError("Stored file content verification failed: size does not match its saved metadata.");
  if (file.content_sha256 && (await hashBytes(bytes)) !== file.content_sha256) {
    throw contentError("Stored file content verification failed: digest does not match its saved metadata.");
  }
  return bytes;
}

/**
 * Reads and verifies a file's content without owning authentication or the
 * server-client singleton. Native bodies are read with their content revision
 * in one database snapshot; callers such as export may provide that snapshot.
 */
export async function readFileContent(
  db: SupabaseClient,
  profileId: string,
  file: FileContentMetadata,
  options: FileContentReadOptions = {},
): Promise<Uint8Array> {
  throwIfAborted(options.signal);
  if (!profileId || (file.profile_id !== undefined && file.profile_id !== profileId) || file.deleted_at != null ||
      file.state !== "ready" || (file.trashed_at != null && !options.allowTrashed)) {
    throw contentError("File is unavailable.", "P0002");
  }
  const expectedRevision = Number(file.content_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw contentError("File content revision is invalid.");

  if (file.content_backend === "native-text") {
    let document = options.nativeSnapshot;
    if (document) {
      if (document.file_id !== file.id || Number(document.content_revision) !== expectedRevision) {
        throw contentError("The exported document snapshot does not match its file revision.", "40001");
      }
    } else {
      const query = db.rpc("read_account_file_content", {
        p_profile_id: profileId,
        p_file_id: file.id,
        p_expected_content_revision: expectedRevision,
        p_allow_trashed: options.allowTrashed ?? false,
      });
      const { data, error } = await (options.signal ? query.abortSignal(options.signal) : query);
      throwIfAborted(options.signal);
      if (error) throw error;
      const result = data as { file?: Record<string, unknown>; document?: NativeDocumentSnapshot | null } | null;
      const readFile = result?.file;
      document = result?.document ?? undefined;
      if (!readFile || readFile.id !== file.id || Number(readFile.content_revision) !== expectedRevision ||
          readFile.content_backend !== "native-text" || readFile.state !== "ready" ||
          (readFile.profile_id !== undefined && readFile.profile_id !== profileId) || readFile.deleted_at != null ||
          (readFile.trashed_at != null && !options.allowTrashed) || !document) {
        throw contentError("The document changed while it was being read.", "40001");
      }
      if (document.file_id !== file.id || Number(document.content_revision) !== expectedRevision) {
        throw contentError("The document changed while it was being read.", "40001");
      }
    }
    if (!document || typeof document.body !== "string" || document.body.includes("\0") || Number(document.content_revision) !== expectedRevision) throw contentError();
    return verifyBytes(file, new TextEncoder().encode(document.body));
  }

  if (options.nativeSnapshot) throw contentError("A native document snapshot was supplied for an uploaded file.");
  const { data, error } = await db.storage.from(FILE_BUCKET).download(
    `${profileId}/${file.id}`,
    {},
    options.signal ? { signal: options.signal } : undefined,
  );
  throwIfAborted(options.signal);
  if (error || !data) throw error ?? contentError();
  return verifyBytes(file, new Uint8Array(await data.arrayBuffer()));
}
