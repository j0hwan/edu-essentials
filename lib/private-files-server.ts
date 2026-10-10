import { apiError, AuthError, requireProfile, requireSameOrigin } from "./auth";
import { getSupabaseAdmin } from "./supabase-server";
import { PersistenceRequestError, requireAccountScope } from "./persistence-request";
import { FILE_BUCKET, isFileId, type PrivateFile } from "./files";
import type { FileFolder } from "./file-organization";
export const fileColumns = "id,name,mime_type,size_bytes,course_id,assignment_id,kind,state,created_at,updated_at,content_sha256,folder_id,content_backend,metadata_revision,content_revision,trashed_at,trash_operation_id,original_folder_id,original_location_path,deleted_at";
export const folderColumns = "id,parent_id,name,kind,course_id,course_code,revision,created_at,updated_at,archived_at,semester_label,course_name_snapshot,course_color_snapshot,trashed_at,trash_operation_id,original_parent_id,deleted_at,purge_pending_at,original_location_path";
export const fileJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export function publicFile(value: unknown, expectedProfileId?: string): PrivateFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("File metadata is unavailable.");
  const row = value as Record<string, unknown>;
  if (expectedProfileId && row.profile_id !== undefined && row.profile_id !== expectedProfileId) throw new Error("File ownership did not match the signed-in account.");
  return Object.fromEntries(fileColumns.split(",").map((key) => [key, row[key]])) as PrivateFile;
}
export function publicFolder(value: unknown, expectedProfileId?: string): FileFolder {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Folder metadata is unavailable.");
  const row = value as Record<string, unknown>;
  if (expectedProfileId && row.profile_id !== undefined && row.profile_id !== expectedProfileId) throw new Error("Folder ownership did not match the signed-in account.");
  return Object.fromEntries(folderColumns.split(",").map((key) => [key, row[key]])) as FileFolder;
}
export async function fileAccount(request: Request, write = false) {
  if (write) requireSameOrigin(request);
  const profile = await requireProfile(); requireAccountScope(request, profile.id);
  const account = new URL(request.url).searchParams.get("account");
  if (account && account !== profile.id) throw new PersistenceRequestError("The signed-in account changed.", 401);
  return profile;
}
export function fileId(request: Request) { const id = new URL(request.url).searchParams.get("id") ?? ""; if (!isFileId(id)) throw new PersistenceRequestError("Invalid file ID."); return id; }
export async function ownedFile(profileId: string, id: string, options: { includeTrashed?: boolean } = {}) {
  const { data, error } = await getSupabaseAdmin().from("user_files").select(fileColumns).eq("profile_id", profileId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!data || (!options.includeTrashed && data.trashed_at != null)) throw new PersistenceRequestError("File not found.", 404);
  return data as PrivateFile;
}
export async function ownedFolder(profileId: string, id: string, options: { includeTrashed?: boolean } = {}) {
  const { data, error } = await getSupabaseAdmin().from("file_folders").select(folderColumns).eq("profile_id", profileId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at != null || data.purge_pending_at != null || (!options.includeTrashed && data.trashed_at != null)) throw new PersistenceRequestError("Folder not found.", 404);
  return data as FileFolder;
}
export async function fileMutation(profile: { id: string; auth_user_id: string }, id: string, operation: string, revision: string | null = null, metadata = {}) {
  const { data, error } = await getSupabaseAdmin().rpc("mutate_account_file", { p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id, p_file_id: id, p_operation: operation, p_expected_revision: revision, p_metadata: metadata });
  if (error) throw error;
  return publicFile(data, profile.id);
}
export const privateStorage = () => getSupabaseAdmin().storage.from(FILE_BUCKET);
export const objectPath = (profileId: string, id: string) => `${profileId}/${id}`;
export function fileFailure(error: unknown) {
  if (error instanceof AuthError) return apiError(error);
  if (error instanceof PersistenceRequestError) return fileJson({ error: error.message }, error.status);
  const code = (error as { code?: string })?.code;
  if (code === "PT409" || code === "40001") return fileJson({ error: "This file changed or was deleted. Reload files before retrying your edit." }, 409);
  if (code === "P0002") return fileJson({ error: "File not found." }, 404);
  if (code === "23505") return fileJson({ error: "This ID is already in use. Reload the latest saved data before retrying." }, 409);
  if (code === "42501") return fileJson({ error: "This account is not available for file operations." }, 403);
  if (code === "23503" && String((error as { message?: string }).message).startsWith("Detach the syllabus")) return fileJson({ error: "Detach this syllabus source from its class or review, save the workspace, then retry the file operation." }, 409);
  if (code === "23503" && String((error as { message?: string }).message).startsWith("SYLLABUS_BLOCKER:")) {
    return fileJson({ error: String((error as { message?: string }).message).slice("SYLLABUS_BLOCKER:".length).trim() }, 409);
  }
  if (["23503", "23514", "22023"].includes(code ?? "")) return fileJson({ error: "File details are invalid or the class/assignment changed. Save your workspace and review the association." }, 400);
  return fileJson({ error: "Private file storage is temporarily unavailable. Your selection has been kept; retry the operation." }, 503);
}
