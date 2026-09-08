export const FILE_BUCKET = "eduessentials-private";
export const MAX_FILE_BYTES = 26_214_400;
export const fileKinds = ["resource", "syllabus", "class-image", "attachment"] as const;
export type FileKind = typeof fileKinds[number];
export type PrivateFile = { id: string; name: string; mime_type: string; size_bytes: number; course_id: string | null; assignment_id: string | null; kind: FileKind; state: "pending" | "ready" | "deleting"; created_at: string; updated_at: string; content_sha256: string | null };
export type FileMetadata = { name: string; courseId: string; assignmentId: string; kind: FileKind };
export const isFileId = (id: string) => /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(id);
export function fileMetadata(value: unknown): FileMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid file details.");
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 255 || [...v.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\")) throw new Error("Use a file name of 1–255 characters without path separators.");
  for (const key of ["courseId", "assignmentId"]) if (typeof v[key] !== "string" || v[key].length > 500) throw new Error("Invalid file association.");
  if (!fileKinds.includes(v.kind as FileKind)) throw new Error("Invalid file type.");
  if (v.kind === "class-image" && !v.courseId) throw new Error("Choose a class for its image.");
  return { name: v.name.trim(), courseId: v.courseId as string, assignmentId: v.assignmentId as string, kind: v.kind as FileKind };
}
export async function readFileBytes(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error("Files must be 25 MiB or smaller.");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Choose a file to upload.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_FILE_BYTES) { await reader.cancel(); throw new Error("Files must be 25 MiB or smaller."); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export function detectedMime(bytes: Uint8Array, name: string) {
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (starts(255, 216, 255)) return "image/jpeg";
  const head = new TextDecoder().decode(bytes.subarray(0, 16));
  if (/^GIF8[79]a/.test(head)) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  if (head.startsWith("%PDF-")) return "application/pdf";
  if (/\.(txt|md|csv|json|log)$/i.test(name)) { try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return "text/plain"; } catch { /* Binary resources download as bytes. */ } }
  return "application/octet-stream";
}
export const hashBytes = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
