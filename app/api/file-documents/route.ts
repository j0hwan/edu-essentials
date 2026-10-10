import { fileAccount, fileFailure, fileJson, ownedFile, ownedFolder, publicFile } from "../../../lib/private-files-server";
import { isFileId, rejectOwnershipFields, type FileKind } from "../../../lib/files";
import { readFileContent } from "../../../lib/file-content";
import { requireNumericRevision, safeFileItemName, validateDocumentBody } from "../../../lib/file-organization";
import { PersistenceRequestError, readPersistenceJson } from "../../../lib/persistence-request";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
const documentKinds: FileKind[] = ["resource", "syllabus", "attachment"];

function documentFileId(request: Request, body?: Record<string, unknown>) {
  const id = new URL(request.url).searchParams.get("id") ?? body?.id;
  if (typeof id !== "string" || !isFileId(id)) throw new PersistenceRequestError("Invalid document ID.");
  return id;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
}

function checkedBody(value: unknown) {
  try { return validateDocumentBody(value); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Invalid document text.";
    throw new PersistenceRequestError(message, message.includes("limited to 1 MiB") ? 413 : 400);
  }
}

function checkedRevision(value: unknown) {
  try { return requireNumericRevision(value, "content revision"); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid content revision.", value === undefined ? 428 : 400); }
}

function checkedMetadataRevision(value: unknown) {
  try { return requireNumericRevision(value, "metadata revision"); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid metadata revision.", value === undefined ? 428 : 400); }
}

function checkedName(value: unknown) {
  try { return safeFileItemName(value); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid document name."); }
}

function checkOwnershipFields(body: Record<string, unknown>) {
  try { rejectOwnershipFields(body); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid account fields."); }
}

async function mutateDocument(
  profile: { id: string; auth_user_id: string },
  id: string,
  operation: "create" | "update_content",
  revision: number | null,
  document: Record<string, unknown>,
) {
  const { data, error } = await getSupabaseAdmin().rpc("mutate_account_document", {
    p_profile_id: profile.id,
    p_auth_user_id: profile.auth_user_id,
    p_file_id: id,
    p_operation: operation,
    p_expected_content_revision: revision,
    p_document: document,
  });
  if (error) throw error;
  const result = data as { file?: unknown; document?: unknown } | null;
  if (!result?.file || !result.document) throw new Error("Document metadata is unavailable.");
  const rawFile = result.file as Record<string, unknown>, rawDocument = result.document as Record<string, unknown>;
  if (rawDocument.profile_id !== undefined && rawDocument.profile_id !== profile.id) throw new Error("Document ownership did not match the signed-in account.");
  const file = publicFile(rawFile, profile.id), savedDocument = rawDocument;
  if (savedDocument.file_id !== file.id || typeof savedDocument.body !== "string") throw new Error("Document content is unavailable.");
  return { file, document: { file_id: file.id, body: savedDocument.body, content_revision: file.content_revision } };
}

async function mutateDocumentRequest(
  profile: { id: string; auth_user_id: string },
  id: string,
  requestId: string,
  revision: number,
  document: Record<string, unknown>,
  name: string | null,
  metadataRevision: number | null,
) {
  const { data, error } = await getSupabaseAdmin().rpc("mutate_account_document_request", {
    p_profile_id: profile.id,
    p_auth_user_id: profile.auth_user_id,
    p_file_id: id,
    p_request_id: requestId,
    p_expected_content_revision: revision,
    p_document: document,
    p_name: name,
    p_expected_metadata_revision: metadataRevision,
  });
  if (error) throw error;
  const result = data as { file?: unknown; document?: unknown; requestId?: unknown; acknowledgedContentRevision?: unknown } | null;
  const acknowledgedContentRevision = result?.acknowledgedContentRevision;
  if (!result?.file || !result.document || result.requestId !== requestId
      || typeof acknowledgedContentRevision !== "number" || !Number.isSafeInteger(acknowledgedContentRevision)
      || acknowledgedContentRevision < 1) {
    throw new Error("Document save receipt is unavailable.");
  }
  const rawFile = result.file as Record<string, unknown>, rawDocument = result.document as Record<string, unknown>;
  if (rawDocument.profile_id !== undefined && rawDocument.profile_id !== profile.id) throw new Error("Document ownership did not match the signed-in account.");
  const file = publicFile(rawFile, profile.id), savedDocument = rawDocument;
  if (savedDocument.file_id !== file.id || typeof savedDocument.body !== "string") throw new Error("Document content is unavailable.");
  return {
    file,
    document: { file_id: file.id, body: savedDocument.body, content_revision: file.content_revision },
    requestId,
    acknowledgedContentRevision,
  };
}

export async function GET(request: Request) {
  try {
    const profile = await fileAccount(request), id = documentFileId(request), file = await ownedFile(profile.id, id);
    if (file.content_backend !== "native-text") throw new PersistenceRequestError("This file is not an editable text document.", 404);
    if (file.state !== "ready") throw new PersistenceRequestError("This document is not ready.", 409);
    const bytes = await readFileContent(getSupabaseAdmin(), profile.id, file);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return fileJson({ file, document: { file_id: file.id, body, content_revision: file.content_revision } });
  } catch (error) { return fileFailure(error); }
}

export async function POST(request: Request) {
  try {
    const profile = await fileAccount(request, true), body = await readPersistenceJson(request, 6 * 1024 * 1024 + 16 * 1024);
    checkOwnershipFields(body);
    const id = documentFileId(request, body);
    const name = body.name;
    if (typeof name !== "string" || !name.trim() || name.length > 255 || [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\")) {
      throw new PersistenceRequestError("Use a document name of 1–255 characters without path separators.");
    }
    const kind = body.kind === undefined ? "resource" : body.kind;
    if (!documentKinds.includes(kind as FileKind)) throw new PersistenceRequestError("Invalid text document type.");
    for (const key of ["courseId", "assignmentId"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > 500)) throw new PersistenceRequestError("Invalid document association.");
    }
    if (body.folderId !== undefined && body.folderId !== null && body.folderId !== "" && (typeof body.folderId !== "string" || !isFileId(body.folderId))) {
      throw new PersistenceRequestError("Invalid folder location.");
    }
    if (typeof body.folderId === "string" && body.folderId) await ownedFolder(profile.id, body.folderId);
    const content = checkedBody(body.body);
    const result = await mutateDocument(profile, id, "create", null, {
      name: name.trim(), kind: kind as FileKind, courseId: body.courseId ?? "", assignmentId: body.assignmentId ?? "",
      ...(body.folderId === undefined ? {} : { folderId: body.folderId ?? "" }), body: content.body,
    });
    return fileJson(result, 201);
  } catch (error) { return fileFailure(error); }
}

export async function PUT(request: Request) {
  try {
    const profile = await fileAccount(request, true), body = await readPersistenceJson(request, 6 * 1024 * 1024 + 16 * 1024);
    checkOwnershipFields(body);
    const id = documentFileId(request, body);
    if (body.action !== "update_content") throw new PersistenceRequestError("Invalid document action.");
    const revision = checkedRevision(body.baseContentRevision), content = checkedBody(body.body);
    if (body.requestId === undefined) {
      if (body.name !== undefined || body.baseMetadataRevision !== undefined) {
        throw new PersistenceRequestError("A save request ID is required when renaming a document.");
      }
      const result = await mutateDocument(profile, id, "update_content", revision, { body: content.body });
      return fileJson(result);
    }
    const saveRequestId = body.requestId;
    if (!isUuid(saveRequestId)) throw new PersistenceRequestError("Invalid document save request ID.");
    const hasName = body.name !== undefined;
    const hasMetadataRevision = body.baseMetadataRevision !== undefined;
    if (hasName !== hasMetadataRevision) throw new PersistenceRequestError("A document name and metadata revision must be provided together.");
    const name = hasName ? checkedName(body.name) : null;
    const metadataRevision = hasMetadataRevision ? checkedMetadataRevision(body.baseMetadataRevision) : null;
    const result = await mutateDocumentRequest(profile, id, saveRequestId.toLowerCase(), revision, { body: content.body }, name, metadataRevision);
    return fileJson(result);
  } catch (error) { return fileFailure(error); }
}
