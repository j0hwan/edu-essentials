import { fileAccount, fileFailure, fileJson, ownedFolder, publicFile, publicFolder } from "../../../lib/private-files-server";
import { isFileId, rejectOwnershipFields } from "../../../lib/files";
import { PersistenceRequestError, readPersistenceJson } from "../../../lib/persistence-request";
import { requireNumericRevision, safeFileItemName, type FileFolder } from "../../../lib/file-organization";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function requiredFolderId(value: unknown) {
  if (typeof value !== "string" || !isFileId(value)) throw new PersistenceRequestError("Invalid folder ID.");
  return value;
}

function checkedName(value: unknown, maxLength = 255) {
  try { return safeFileItemName(value, maxLength); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid folder name."); }
}

function checkedRevision(value: unknown) {
  try { return requireNumericRevision(value, "folder revision"); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid folder revision.", value === undefined ? 428 : 400); }
}

function checkOwnershipFields(body: Record<string, unknown>) {
  try { rejectOwnershipFields(body); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid account fields."); }
}

async function mutateFolder(
  profile: { id: string; auth_user_id: string },
  operation: string,
  id: string | null,
  revision: number | null,
  metadata: Record<string, unknown> = {},
) {
  const { data, error } = await getSupabaseAdmin().rpc("mutate_account_folder", {
    p_profile_id: profile.id,
    p_auth_user_id: profile.auth_user_id,
    p_operation: operation,
    p_folder_id: id,
    p_expected_revision: revision,
    p_metadata: metadata,
  });
  if (error) throw error;
  return data;
}

function publicActivity(value: unknown, idKey: "file_id" | "folder_id", expectedProfileId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Folder activity is unavailable.");
  const row = value as Record<string, unknown>;
  if (row.profile_id !== undefined && row.profile_id !== expectedProfileId) throw new Error("Folder activity ownership did not match the signed-in account.");
  return { [idKey]: row[idKey], starred_at: row.starred_at ?? null, last_opened_at: row.last_opened_at ?? null };
}

export async function GET(request: Request) {
  try {
    const profile = await fileAccount(request), url = new URL(request.url), view = url.searchParams.get("view") ?? "active";
    if (!["active", "trash", "archives"].includes(view)) throw new PersistenceRequestError("Invalid folder view.");
    const hasParent = url.searchParams.has("parentId"), rawParent = url.searchParams.get("parentId");
    if (rawParent && !isFileId(rawParent)) throw new PersistenceRequestError("Invalid parent folder ID.");
    const { data, error } = await getSupabaseAdmin().rpc("read_account_file_browser", {
      p_profile_id: profile.id,
      p_auth_user_id: profile.auth_user_id,
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Folder snapshot is unavailable.");
    const snapshot = data as Record<string, unknown>;
    if (!Array.isArray(snapshot.folders) || !Array.isArray(snapshot.activities)) throw new Error("Folder snapshot is unavailable.");
    const folders = snapshot.folders.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).profile_id !== profile.id) {
        throw new Error("Folder ownership did not match the signed-in account.");
      }
      return publicFolder(value, profile.id);
    }) as FileFolder[];
    const activities = snapshot.activities.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).profile_id !== profile.id) {
        throw new Error("Folder activity ownership did not match the signed-in account.");
      }
      return publicActivity(value, "folder_id", profile.id);
    });
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const hasArchivedAncestor = (folder: FileFolder) => {
      let current: FileFolder | undefined = folder;
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        if (current.archived_at != null) return true;
        visited.add(current.id);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
      return false;
    };
    const visible = folders.filter((folder) => {
      if (view === "trash" ? folder.trashed_at == null : folder.trashed_at != null) return false;
      if (folder.purge_pending_at != null && view !== "trash") return false;
      if (view === "active" && hasArchivedAncestor(folder)) return false;
      if (view === "archives" && !hasArchivedAncestor(folder)) return false;
      if (hasParent) return folder.parent_id === (rawParent || null);
      return true;
    });
    return fileJson({ folders: visible, activities: { folders: activities } });
  } catch (error) { return fileFailure(error); }
}

export async function POST(request: Request) {
  try {
    const profile = await fileAccount(request, true), body = await readPersistenceJson(request, 8192);
    checkOwnershipFields(body);
    const id = body.id === undefined ? null : requiredFolderId(body.id);
    const name = checkedName(body.name);
    const parentId = body.parentId === undefined || body.parentId === null || body.parentId === "" ? null : requiredFolderId(body.parentId);
    if (parentId) await ownedFolder(profile.id, parentId);
    if (body.kind !== undefined && body.kind !== "custom") throw new PersistenceRequestError("Managed course folders are created with their course.");
    const folder = publicFolder(await mutateFolder(profile, "create", id, null, { name, ...(parentId ? { parentId } : {}) }), profile.id);
    return fileJson({ folder }, 201);
  } catch (error) { return fileFailure(error); }
}

export async function PUT(request: Request) {
  try {
    const profile = await fileAccount(request, true), body = await readPersistenceJson(request, 8192);
    checkOwnershipFields(body);
    const id = requiredFolderId(body.id), action = body.action;
    if (typeof action !== "string") throw new PersistenceRequestError("Choose a folder action.");
    const revision = checkedRevision(body.revision);
    let operation = action;
    const metadata: Record<string, unknown> = {};
    if (action === "name" || action === "rename") {
      operation = "rename";
      metadata.name = checkedName(body.name);
    } else if (action === "move") {
      if (!Object.prototype.hasOwnProperty.call(body, "parentId")) throw new PersistenceRequestError("Choose a destination folder.");
      if (body.parentId !== null && body.parentId !== "" && !isFileId(String(body.parentId))) throw new PersistenceRequestError("Invalid destination folder ID.");
      metadata.parentId = body.parentId || "";
      if (body.parentId) await ownedFolder(profile.id, body.parentId as string);
    } else if (action === "archive") {
      metadata.semesterLabel = checkedName(body.semesterLabel, 120);
    } else if (!["unarchive", "star", "unstar", "open"].includes(action)) {
      throw new PersistenceRequestError("Invalid folder action.");
    }
    const result = await mutateFolder(profile, operation, id, revision, metadata);
    if (["star", "unstar", "open"].includes(operation)) return fileJson({ activity: publicActivity(result, "folder_id", profile.id) });
    return fileJson({ folder: publicFolder(result, profile.id) });
  } catch (error) { return fileFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const profile = await fileAccount(request, true), url = new URL(request.url), id = requiredFolderId(url.searchParams.get("id"));
    const body = await readPersistenceJson(request, 4096), revision = checkedRevision(body.revision);
    checkOwnershipFields(body);
    const { data, error } = await getSupabaseAdmin().rpc("mutate_account_files_action", {
      p_profile_id: profile.id,
      p_auth_user_id: profile.auth_user_id,
      p_action: "trash",
      p_items: [{ type: "folder", id, revision }],
      p_destination_id: null,
      p_destination_provided: false,
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Folder action result is unavailable.");
    const result = data as { files?: unknown[]; folders?: unknown[]; recoveryFolder?: unknown };
    const files = (result.files ?? []).map((row) => publicFile(row, profile.id));
    const folders = (result.folders ?? []).map((row) => publicFolder(row, profile.id));
    const folder = folders.find((row) => row.id === id);
    if (!folder) throw new Error("Folder action did not return the selected folder.");
    return fileJson({ folder, files, folders, recoveryFolder: result.recoveryFolder ? publicFolder(result.recoveryFolder, profile.id) : null });
  } catch (error) { return fileFailure(error); }
}
