import { fileAccount, fileColumns, fileFailure, fileId, fileJson, fileMutation, objectPath, ownedFile, ownedFolder, privateStorage, publicFile } from "../../../lib/private-files-server";
import { detectedMime, downloadFileName, fileMetadata, hashBytes, readFileBytes, rejectOwnershipFields } from "../../../lib/files";
import { PersistenceRequestError, readPersistenceJson, requireSaveRevision } from "../../../lib/persistence-request";
import { requireNumericRevision, safeFileItemName } from "../../../lib/file-organization";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { readFileContent } from "../../../lib/file-content";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const profile = await fileAccount(request);
    if (new URL(request.url).searchParams.has("id")) {
      const id = fileId(request), file = await ownedFile(profile.id, id);
      if (file.state !== "ready") return fileJson({ error: "This file is not ready. Retry its upload or deletion." }, 409);
      const bytes = await readFileContent(getSupabaseAdmin(), profile.id, file);
      const name = downloadFileName(file);
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      return new Response(body, { headers: { "content-type": file.mime_type, "content-length": String(bytes.byteLength), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
    }
    const { data, error } = await getSupabaseAdmin().from("user_files").select(fileColumns).eq("profile_id", profile.id).is("deleted_at", null).order("created_at", { ascending: false }).range(0, 1000);
    if (error) throw error;
    const view = new URL(request.url).searchParams.get("view");
    if (view && view !== "trash" && view !== "active") throw new PersistenceRequestError("Invalid file view.");
    const files = (data ?? []).filter((file) => view === "trash" ? file.trashed_at != null : file.trashed_at == null);
    const { data: activities, error: activityError } = await getSupabaseAdmin().from("file_activity").select("file_id,starred_at,last_opened_at").eq("profile_id", profile.id);
    if (activityError) throw activityError;
    return fileJson({ files, activities: { files: activities ?? [] } });
  } catch (error) { return fileFailure(error); }
}
export async function POST(request: Request) {
  try {
    const profile = await fileAccount(request, true), id = fileId(request);
    let metadata, bytes;
    try { metadata = fileMetadata(JSON.parse(decodeURIComponent(request.headers.get("x-file-metadata") ?? ""))); bytes = await readFileBytes(request); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Invalid upload.";
      throw new PersistenceRequestError(message, message.includes("25 MiB or smaller") ? 413 : 400);
    }
    const mime = detectedMime(bytes, metadata.name), sha256 = await hashBytes(bytes);
    if (metadata.kind === "class-image" && !mime.startsWith("image/")) throw new PersistenceRequestError("Choose a PNG, JPEG, GIF, or WebP class image.");
    if (metadata.folderId) await ownedFolder(profile.id, metadata.folderId);
    const reservation = await fileMutation(profile, id, "reserve", null, { ...metadata, mime, sha256, size: bytes.length });
    // A stable upload ID makes a retry after a lost response idempotent. Do not
    // overwrite or re-read storage for a file that has already been confirmed.
    if (reservation.state === "ready") return fileJson({ file: reservation }, 201);
    const path = objectPath(profile.id, id), storage = privateStorage();
    // Immutable keys plus a stable client ID make retries safe after lost responses.
    await storage.upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "0" });
    const readback = await storage.download(path);
    if (readback.error || !readback.data) throw readback.error ?? new Error("Upload not confirmed");
    if (readback.data.size !== bytes.length || await hashBytes(new Uint8Array(await readback.data.arrayBuffer())) !== sha256) throw new PersistenceRequestError("Stored bytes did not match. Delete this pending upload and try again.", 409);
    try { return fileJson({ file: await fileMutation(profile, id, "ready") }, 201); }
    catch (error) {
      // A competing Trash mutation must retain bytes. Clean up only when a
      // permanent/pending cleanup has actually moved this row out of ready.
      if (["40001", "P0002"].includes((error as { code: string })?.code)) {
        let current;
        try { current = await ownedFile(profile.id, id, { includeTrashed: true }); }
        catch (readError) {
          if (readError instanceof PersistenceRequestError && readError.status === 404) await storage.remove([path]);
          else throw readError;
        }
        if (current && current.state === "deleting" && current.trashed_at === null) await storage.remove([path]);
      }
      throw error;
    }
  } catch (error) { return fileFailure(error); }
}
export async function PUT(request: Request) {
  try {
    const profile = await fileAccount(request, true), id = fileId(request), body = await readPersistenceJson(request, 8192);
    if (body.action === "rename") {
      try { rejectOwnershipFields(body); }
      catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid account fields."); }
      const allowedFields = new Set(["action", "name", "baseMetadataRevision"]);
      if (Object.keys(body).some((key) => !allowedFields.has(key))) throw new PersistenceRequestError("Unsupported rename field.");
      let name: string;
      try { name = safeFileItemName(body.name); }
      catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid file name."); }
      let metadataRevision: number;
      try { metadataRevision = requireNumericRevision(body.baseMetadataRevision, "metadata revision"); }
      catch (error) {
        throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid metadata revision.", body.baseMetadataRevision === undefined ? 428 : 400);
      }
      const { data, error } = await getSupabaseAdmin().rpc("rename_account_file", {
        p_profile_id: profile.id,
        p_auth_user_id: profile.auth_user_id,
        p_file_id: id,
        p_expected_metadata_revision: metadataRevision,
        p_name: name,
      });
      if (error) throw error;
      return fileJson({ file: publicFile(data, profile.id) });
    }
    const revision = requireSaveRevision(body.baseRevision);
    let metadata; try { metadata = fileMetadata(body); } catch (error) { throw new PersistenceRequestError((error as Error).message); }
    const existing = await ownedFile(profile.id, id);
    if (metadata.folderId) await ownedFolder(profile.id, metadata.folderId);
    if (metadata.kind === "class-image" && !existing.mime_type.startsWith("image/")) throw new PersistenceRequestError("This file cannot be used as a class image.");
    return fileJson({ file: await fileMutation(profile, id, "edit", revision, metadata) });
  } catch (error) { return fileFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const profile = await fileAccount(request, true), id = fileId(request), body = await readPersistenceJson(request, 4096);
    const file = await fileMutation(profile, id, "deleting", requireSaveRevision(body.baseRevision));
    // Ready-file DELETE is always recoverable, including repeated requests.
    // Permanent cleanup starts only through the explicit actions endpoint.
    if (file.trashed_at != null) return fileJson({ ok: true, file });
    if (file.state !== "deleting") throw new PersistenceRequestError("The file could not be moved to Trash.", 409);
    const { error } = await privateStorage().remove([objectPath(profile.id, id)]); if (error) throw error;
    const removed = await fileMutation(profile, id, "removed"); return fileJson({ ok: true, file: removed });
  } catch (error) { return fileFailure(error); }
}
