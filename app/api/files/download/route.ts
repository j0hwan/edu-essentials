import {
  fileAccount,
  fileFailure,
  fileJson,
  publicFile,
  publicFolder,
} from "../../../../lib/private-files-server";
import { readPersistenceJson } from "../../../../lib/persistence-request";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { readFileContent } from "../../../../lib/file-content";
import { zipStream } from "../../../../lib/zip";
import {
  MAX_SELECTED_DOWNLOAD_BODY_BYTES,
  planSelectedDownload,
  SelectedDownloadError,
  validateSelectedDownloadItems,
  type SelectedDownloadFile,
  type SelectedDownloadFolder,
  type SelectedDownloadSnapshot,
} from "../../../../lib/files-selected-download";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const profile = await fileAccount(request, true);
    const body = await readPersistenceJson(request, MAX_SELECTED_DOWNLOAD_BODY_BYTES);
    const items = validateSelectedDownloadItems(body);
    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc("snapshot_account_file_selection", {
      p_profile_id: profile.id,
      p_auth_user_id: profile.auth_user_id,
      p_items: items,
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The selected files could not be prepared for download.");

    const raw = data as Record<string, unknown>;
    if (!Array.isArray(raw.files) || !Array.isArray(raw.folders) || !Array.isArray(raw.documents)) {
      throw new Error("The selected files could not be prepared for download.");
    }
    const snapshot: SelectedDownloadSnapshot = {
      files: raw.files.map((value) => {
        const row = value as Record<string, unknown>;
        return {
          ...publicFile(row, profile.id),
          download_root_type: row.download_root_type as "file" | "folder",
          download_root_id: row.download_root_id as string,
          download_root_ordinal: row.download_root_ordinal as number,
        } as SelectedDownloadFile;
      }),
      folders: raw.folders.map((value) => {
        const row = value as Record<string, unknown>;
        return {
          ...publicFolder(row, profile.id),
          download_root_type: row.download_root_type as "folder",
          download_root_id: row.download_root_id as string,
          download_root_ordinal: row.download_root_ordinal as number,
        } as SelectedDownloadFolder;
      }),
      documents: raw.documents as SelectedDownloadSnapshot["documents"],
    };
    const planned = planSelectedDownload(items, snapshot);
    const responseBody = zipStream(planned.map((entry) => entry.type === "directory"
      ? { name: entry.name, bytes: async () => new Uint8Array() }
      : {
          name: entry.name,
          bytes: async (signal?: AbortSignal) => {
            if (signal?.aborted) throw signal.reason ?? new DOMException("The download was interrupted.", "AbortError");
            const bytes = await readFileContent(db, profile.id, entry.file, {
              ...(entry.nativeSnapshot ? { nativeSnapshot: entry.nativeSnapshot } : {}),
              ...(signal ? { signal } : {}),
            });
            if (signal?.aborted) throw signal.reason ?? new DOMException("The download was interrupted.", "AbortError");
            return bytes;
          },
        }), { signal: request.signal });

    return new Response(responseBody, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": "attachment; filename=eduessentials-selected-files.zip",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof SelectedDownloadError) return fileJson({ error: error.message }, error.status);
    return fileFailure(error);
  }
}
