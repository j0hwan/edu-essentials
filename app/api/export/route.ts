import { fileAccount, fileFailure, fileJson, objectPath, privateStorage } from "../../../lib/private-files-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { hashBytes, type PrivateFile } from "../../../lib/files";
import { zipStream } from "../../../lib/zip";
export const dynamic = "force-dynamic";
const archiveName = (name: string) => [...name].map((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\" ? "_" : c).join("").replace(/[. ]+$/, "") || "file";
export async function GET(request: Request) {
  try {
    const profile = await fileAccount(request);
    const { data, error } = await getSupabaseAdmin().rpc("export_account", { p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id }); if (error) throw error;
    const files = data.files as PrivateFile[];
    if (files.some((f) => f.state !== "ready")) return fileJson({ error: "Finish or remove pending uploads/deletions before exporting the complete account." }, 409);
    const manifest = { format: "eduessentials-account-v1", exportedAt: new Date().toISOString(), profile: data.profile, courses: data.courses, workspace: data.workspace, files: files.map((f) => ({ ...f, archivePath: `files/${f.id}/${archiveName(f.name)}` })) };
    return new Response(zipStream([{ name: "account.json", bytes: async () => new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }, ...manifest.files.map((file) => ({ name: file.archivePath, bytes: async () => {
      const result = await privateStorage().download(objectPath(profile.id, file.id)); if (result.error || !result.data) throw new Error("A file changed during export. Retry the complete download.");
      const bytes = new Uint8Array(await result.data.arrayBuffer());
      if (bytes.length !== Number(file.size_bytes) || (file.content_sha256 && await hashBytes(bytes) !== file.content_sha256)) throw new Error("File verification failed during export.");
      return bytes;
    } }))]), { headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=eduessentials-account.zip", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return fileFailure(error); }
}
