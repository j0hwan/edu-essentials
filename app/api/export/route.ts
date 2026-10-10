import { fileAccount, fileFailure, fileJson, publicFile, publicFolder } from "../../../lib/private-files-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { downloadFileName, type PrivateFile } from "../../../lib/files";
import { readFileContent } from "../../../lib/file-content";
import { zipStream } from "../../../lib/zip";
export const dynamic = "force-dynamic";
const archiveName = (name: string) => [...name].map((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\" ? "_" : c).join("").replace(/[. ]+$/, "") || "file";
export async function GET(request: Request) {
  try {
    const profile = await fileAccount(request);
    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc("export_account", { p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id }); if (error) throw error;
    const files: PrivateFile[] = data.files.map((row: unknown) => publicFile(row, profile.id));
    if (files.some((f) => f.state !== "ready")) return fileJson({ error: "Finish or remove pending uploads/deletions before exporting the complete account." }, 409);
    // Native bodies and revisions were captured together under the account lock.
    // Keep those bodies in the content entries rather than duplicating them in JSON.
    const documents = new Map<string, { file_id: string; body: string; content_revision: number }>(
      (data.documents ?? []).map((document: { file_id: string; body: string; content_revision: number }) => [document.file_id, document]),
    );
    const manifest = {
      format: "eduessentials-account-v1", exportedAt: new Date().toISOString(),
      profile: data.profile, courses: data.courses, workspace: data.workspace,
      assistant: data.assistant ?? null, folders: (data.folders ?? []).map((row: unknown) => publicFolder(row, profile.id)),
      activity: {
        files: (data.activity?.files ?? []).map((item: { file_id: string; starred_at: string | null; last_opened_at: string | null }) => ({ file_id: item.file_id, starred_at: item.starred_at, last_opened_at: item.last_opened_at })),
        folders: (data.activity?.folders ?? []).map((item: { folder_id: string; starred_at: string | null; last_opened_at: string | null }) => ({ folder_id: item.folder_id, starred_at: item.starred_at, last_opened_at: item.last_opened_at })),
      },
      files: files.map((f) => ({ ...f, archivePath: `files/${f.id}/${archiveName(downloadFileName(f))}` })),
    };
    return new Response(zipStream([{ name: "account.json", bytes: async () => new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }, ...manifest.files.map((file) => ({ name: file.archivePath, bytes: async () => {
      const nativeSnapshot = documents.get(file.id);
      if (file.content_backend === "native-text" && !nativeSnapshot) throw new Error("The document snapshot is incomplete. Retry the complete download.");
      return readFileContent(db, profile.id, file, { allowTrashed: true, nativeSnapshot });
    } }))]), { headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=eduessentials-account.zip", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return fileFailure(error); }
}
