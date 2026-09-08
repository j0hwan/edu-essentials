import { fileAccount, fileColumns, fileFailure, fileId, fileJson, fileMutation, objectPath, ownedFile, privateStorage } from "../../../lib/private-files-server";
import { detectedMime, fileMetadata, hashBytes, readFileBytes } from "../../../lib/files";
import { PersistenceRequestError, readPersistenceJson, requireSaveRevision } from "../../../lib/persistence-request";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const profile = await fileAccount(request);
    if (new URL(request.url).searchParams.has("id")) {
      const id = fileId(request), file = await ownedFile(profile.id, id);
      if (file.state !== "ready") return fileJson({ error: "This file is not ready. Retry its upload or deletion." }, 409);
      const { data, error } = await privateStorage().download(objectPath(profile.id, id)); if (error || !data) throw error ?? new Error("Missing file");
      return new Response(data, { headers: { "content-type": file.mime_type, "content-length": String(data.size), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
    }
    const { data, error } = await getSupabaseAdmin().from("user_files").select(fileColumns).eq("profile_id", profile.id).is("deleted_at", null).order("created_at", { ascending: false }).range(0, 1000);
    if (error) throw error;
    return fileJson({ files: data });
  } catch (error) { return fileFailure(error); }
}
export async function POST(request: Request) {
  try {
    const profile = await fileAccount(request, true), id = fileId(request);
    let metadata, bytes;
    try { metadata = fileMetadata(JSON.parse(decodeURIComponent(request.headers.get("x-file-metadata") ?? ""))); bytes = await readFileBytes(request); }
    catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid upload."); }
    const mime = detectedMime(bytes, metadata.name), sha256 = await hashBytes(bytes);
    if (metadata.kind === "class-image" && !mime.startsWith("image/")) throw new PersistenceRequestError("Choose a PNG, JPEG, GIF, or WebP class image.");
    await fileMutation(profile, id, "reserve", null, { ...metadata, mime, sha256, size: bytes.length });
    const path = objectPath(profile.id, id), storage = privateStorage();
    // Immutable keys plus a stable client ID make retries safe after lost responses.
    await storage.upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "0" });
    const readback = await storage.download(path);
    if (readback.error || !readback.data) throw readback.error ?? new Error("Upload not confirmed");
    if (readback.data.size !== bytes.length || await hashBytes(new Uint8Array(await readback.data.arrayBuffer())) !== sha256) throw new PersistenceRequestError("Stored bytes did not match. Delete this pending upload and try again.", 409);
    try { return fileJson({ file: await fileMutation(profile, id, "ready") }, 201); }
    catch (error) {
      // A concurrent delete wins. Clean up bytes from an upload that finished late.
      if (["40001", "P0002"].includes((error as { code: string })?.code)) await storage.remove([path]);
      throw error;
    }
  } catch (error) { return fileFailure(error); }
}
export async function PUT(request: Request) {
  try {
    const profile = await fileAccount(request, true), id = fileId(request), body = await readPersistenceJson(request, 8192), revision = requireSaveRevision(body.baseRevision);
    let metadata; try { metadata = fileMetadata(body); } catch (error) { throw new PersistenceRequestError((error as Error).message); }
    const existing = await ownedFile(profile.id, id);
    if (metadata.kind === "class-image" && !existing.mime_type.startsWith("image/")) throw new PersistenceRequestError("This file cannot be used as a class image.");
    return fileJson({ file: await fileMutation(profile, id, "edit", revision, metadata) });
  } catch (error) { return fileFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const profile = await fileAccount(request, true), id = fileId(request), body = await readPersistenceJson(request, 4096);
    await fileMutation(profile, id, "deleting", requireSaveRevision(body.baseRevision));
    const { error } = await privateStorage().remove([objectPath(profile.id, id)]); if (error) throw error;
    await fileMutation(profile, id, "removed"); return fileJson({ ok: true });
  } catch (error) { return fileFailure(error); }
}
