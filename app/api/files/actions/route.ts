import { fileAccount, fileFailure, fileJson, fileMutation, objectPath, ownedFolder, privateStorage, publicFile, publicFolder } from "../../../../lib/private-files-server";
import { isFileId, rejectOwnershipFields, type PrivateFile } from "../../../../lib/files";
import { PersistenceRequestError, readPersistenceJson } from "../../../../lib/persistence-request";
import { requireNumericRevision, type FileItemAction } from "../../../../lib/file-organization";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
const actions: FileItemAction[] = ["move", "trash", "restore", "star", "unstar", "open", "permanent-delete", "empty-trash"];

type ActionItem = { type: "file" | "folder"; id: string; revision: number };
type ActionResult = {
  files?: unknown[];
  folders?: unknown[];
  activities?: { files?: unknown[]; folders?: unknown[] };
  recoveryFolder?: unknown;
};

function checkedRevision(value: unknown) {
  try { return requireNumericRevision(value, "item revision"); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid item revision.", value === undefined ? 428 : 400); }
}

function publicActivity(value: unknown, idKey: "file_id" | "folder_id", expectedProfileId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Item activity is unavailable.");
  const row = value as Record<string, unknown>;
  if (row.profile_id !== undefined && row.profile_id !== expectedProfileId) throw new Error("Item activity ownership did not match the signed-in account.");
  return { [idKey]: row[idKey], starred_at: row.starred_at ?? null, last_opened_at: row.last_opened_at ?? null };
}

function publicActionResult(value: unknown, profileId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("File action result is unavailable.");
  const result = value as ActionResult;
  return {
    files: (result.files ?? []).map((row) => publicFile(row, profileId)),
    folders: (result.folders ?? []).map((row) => publicFolder(row, profileId)),
    activities: {
      files: (result.activities?.files ?? []).map((row) => publicActivity(row, "file_id", profileId)),
      folders: (result.activities?.folders ?? []).map((row) => publicActivity(row, "folder_id", profileId)),
    },
    recoveryFolder: result.recoveryFolder ? publicFolder(result.recoveryFolder, profileId) : null,
  };
}

function publicPurgeResult(value: unknown, profileId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("File purge result is unavailable.");
  const result = value as { files?: unknown[]; removed?: { files?: unknown[]; folders?: unknown[] } };
  return {
    files: (result.files ?? []).map((row) => publicFile(row, profileId)),
    removed: {
      files: (result.removed?.files ?? []).map((id) => {
        if (typeof id !== "string" || !isFileId(id)) throw new Error("Purge file manifest is unavailable.");
        return id;
      }),
      folders: (result.removed?.folders ?? []).map((id) => {
        if (typeof id !== "string" || !isFileId(id)) throw new Error("Purge folder manifest is unavailable.");
        return id;
      }),
    },
  };
}

function checkedRequestId(value: unknown, required: boolean) {
  if (value === undefined && !required) return crypto.randomUUID();
  if (typeof value !== "string" || !isFileId(value)) throw new PersistenceRequestError("A valid purge request ID is required.");
  return value;
}

export async function POST(request: Request) {
  try {
    const profile = await fileAccount(request, true), body = await readPersistenceJson(request, 128 * 1024);
    try { rejectOwnershipFields(body); }
    catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid account fields."); }
    if (typeof body.action !== "string" || !actions.includes(body.action as FileItemAction)) throw new PersistenceRequestError("Invalid item action.");
    const isPurge = body.action === "permanent-delete" || body.action === "empty-trash";
    if (body.action === "empty-trash") {
      if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length !== 0)) {
        throw new PersistenceRequestError("Empty Trash does not accept a selected item list.");
      }
    } else if (!Array.isArray(body.items) || body.items.length < 1) {
      throw new PersistenceRequestError("Choose at least one item.");
    }
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length > 1000) throw new PersistenceRequestError("Choose no more than 1000 items.", 413);
    const items: ActionItem[] = rawItems.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new PersistenceRequestError("Invalid item selection.");
      const item = value as Record<string, unknown>;
      try { rejectOwnershipFields(item); }
      catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid account fields."); }
      if ((item.type !== "file" && item.type !== "folder") || typeof item.id !== "string" || !isFileId(item.id)) throw new PersistenceRequestError("Invalid item selection.");
      return { type: item.type, id: item.id, revision: checkedRevision(item.revision) };
    });
    const requestId = body.action === "permanent-delete" || body.action === "empty-trash"
      ? checkedRequestId(body.requestId, body.action === "empty-trash") : null;
    if (body.requestId !== undefined && !isPurge) throw new PersistenceRequestError("A purge request ID is only valid for permanent deletion or Empty Trash.");
    let destinationId: string | null = null;
    const destinationProvided = Object.prototype.hasOwnProperty.call(body, "destinationId");
    if (destinationProvided && body.action !== "move" && body.action !== "restore") throw new PersistenceRequestError("A destination is only valid for move or restore.");
    if (isPurge && destinationProvided) throw new PersistenceRequestError("A destination is not valid for permanent deletion.");
    if (body.action === "move" || body.action === "restore") {
      if (body.action === "move" && !Object.prototype.hasOwnProperty.call(body, "destinationId")) throw new PersistenceRequestError("Choose a destination folder.");
      if (body.destinationId !== undefined && body.destinationId !== null && body.destinationId !== "") {
        if (typeof body.destinationId !== "string" || !isFileId(body.destinationId)) throw new PersistenceRequestError("Invalid destination folder ID.");
        destinationId = body.destinationId;
        await ownedFolder(profile.id, destinationId);
      }
    }

    if (isPurge) {
      const { data: purgeData, error: purgeError } = await getSupabaseAdmin().rpc("begin_account_file_purge", {
        p_profile_id: profile.id,
        p_auth_user_id: profile.auth_user_id,
        p_request_id: requestId,
        p_items: items,
        p_empty: body.action === "empty-trash",
      });
      if (purgeError) throw purgeError;
      const purge = publicPurgeResult(purgeData, profile.id);
      const removedFiles: PrivateFile[] = [];
      for (const file of purge.files) {
        if (file.state !== "deleting" || file.trashed_at == null || file.deleted_at != null) {
          throw new Error("Permanent deletion was not started for a trashed file.");
        }
        if (file.content_backend === "object") {
          const { error: storageError } = await privateStorage().remove([objectPath(profile.id, file.id)]);
          if (storageError) throw storageError;
        }
        removedFiles.push(await fileMutation(profile, file.id, "removed"));
      }
      const { data: finalizeData, error: finalizeError } = await getSupabaseAdmin().rpc("finalize_account_file_purge", {
        p_profile_id: profile.id,
        p_auth_user_id: profile.auth_user_id,
        p_request_id: requestId,
      });
      if (finalizeError) throw finalizeError;
      if (!finalizeData || typeof finalizeData !== "object" || Array.isArray(finalizeData)) throw new Error("File purge finalization is unavailable.");
      const finalized = finalizeData as { folders?: unknown[] };
      return fileJson({
        ok: true,
        files: removedFiles,
        folders: (finalized.folders ?? []).map((row) => publicFolder(row, profile.id)),
        removed: purge.removed,
        requestId,
      });
    }

    const { data, error } = await getSupabaseAdmin().rpc("mutate_account_files_action", {
      p_profile_id: profile.id,
      p_auth_user_id: profile.auth_user_id,
      p_action: body.action,
      p_items: items,
      p_destination_id: destinationId,
      p_destination_provided: body.action === "restore" && destinationProvided,
    });
    if (error) throw error;
    return fileJson(publicActionResult(data, profile.id));
  } catch (error) { return fileFailure(error); }
}
