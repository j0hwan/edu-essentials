import { isFileId, type PrivateFile } from "./files";

export type DocumentDraft = { name: string; body: string };

export type NativeDocumentCreate = {
  id: string;
  name: string;
  body: string;
  folderId: string | null;
  courseId: string;
};

export type NativeDocumentResult = {
  file: PrivateFile;
  document: { file_id: string; body: string; content_revision: number };
  requestId?: string;
  acknowledgedContentRevision?: number;
};

export type DocumentFailureKind = "save-error" | "conflict" | "session-error";

export class DocumentSaveFailure extends Error {
  constructor(message: string, public kind: DocumentFailureKind = "save-error") {
    super(message);
    this.name = "DocumentSaveFailure";
  }
}

const DOCUMENT_BYTES_LIMIT = 1_048_576;
const FILE_NAME_LIMIT = 255;
const REQUEST_TIMEOUT_MS = 120_000;
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const nativeDocumentKinds = new Set(["resource", "syllabus", "attachment"]);

function fail(message: string, kind: DocumentFailureKind = "save-error"): never {
  throw new DocumentSaveFailure(message, kind);
}

function safeName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > FILE_NAME_LIMIT ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\")) {
    return fail("Use a document name of 1–255 characters without path separators.");
  }
  return value.trim();
}

function safeBody(value: unknown): { body: string; bytes: Uint8Array } {
  if (typeof value !== "string" || value.includes("\0")) return fail("Document text must be a valid plain-text string.");
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fail("Document text contains invalid Unicode.");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return fail("Document text contains invalid Unicode.");
    }
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > DOCUMENT_BYTES_LIMIT) return fail("Text documents are limited to 1 MiB of UTF-8 content.");
  return { body: value, bytes };
}

function safeRevision(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return fail(`The server returned an invalid ${label}.`, "conflict");
  }
  return value;
}

function checkProfileId(profileId: string): void {
  if (typeof profileId !== "string" || !profileId.trim()) {
    return fail("The signed-in account is unavailable. Sign in again before opening this document.", "session-error");
  }
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function requestDocument(profileId: string, path: string, init: RequestInit = {}, write = false): Promise<unknown> {
  checkProfileId(profileId);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      signal: requestSignal(init.signal ?? undefined),
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        "x-profile-id": profileId,
      },
    });
  } catch (error) {
    if (error instanceof DocumentSaveFailure) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? "The document request was interrupted. Your draft is still here; retry the save."
      : "The document service could not be reached. Your draft is still here; retry the save.";
    throw new DocumentSaveFailure(message, "save-error");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DocumentSaveFailure("The document service returned an unreadable response.", response.status === 409 ? "conflict" : "save-error");
  }
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message = typeof body.error === "string" ? body.error : "The document could not be saved.";
    const kind: DocumentFailureKind = response.status === 401 || response.status === 403
      ? "session-error"
      : response.status === 409 || (write && response.status === 404)
        ? "conflict"
        : "save-error";
    throw new DocumentSaveFailure(message, kind);
  }
  return payload;
}

function assertAccountMatch(raw: Record<string, unknown>, profileId: string): void {
  for (const key of ["profile_id", "profileId", "account_id", "accountId", "owner_id", "ownerId", "user_id", "userId"]) {
    const returnedProfileId = raw[key];
    if (returnedProfileId !== undefined && returnedProfileId !== profileId) {
      return fail("The document belongs to a different signed-in account. Reload the Files page before continuing.", "session-error");
    }
  }
}

function parseResult(value: unknown, profileId: string, expectedFileId?: string): NativeDocumentResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("The document service returned invalid data.", "conflict");
  const payload = value as Record<string, unknown>;
  assertAccountMatch(payload, profileId);
  if (!payload.file || typeof payload.file !== "object" || Array.isArray(payload.file) ||
      !payload.document || typeof payload.document !== "object" || Array.isArray(payload.document)) {
    return fail("The document service returned incomplete data.", "conflict");
  }

  const rawFile = payload.file as Record<string, unknown>;
  const rawDocument = payload.document as Record<string, unknown>;
  assertAccountMatch(rawFile, profileId);
  const id = rawFile.id;
  if (typeof id !== "string" || !isFileId(id) || (expectedFileId && id !== expectedFileId) || rawDocument.file_id !== id) {
    return fail("The document ID changed while it was being saved. Reload the latest saved version.", "conflict");
  }
  if (rawFile.content_backend !== "native-text" || rawFile.state !== "ready") {
    return fail("This file is not an active native text document.", "conflict");
  }
  const name = safeName(rawFile.name);
  if (rawFile.name !== name || rawFile.mime_type !== "text/plain" || !nativeDocumentKinds.has(String(rawFile.kind))) {
    return fail("The server returned an unexpected document type.", "conflict");
  }
  if (rawFile.trashed_at != null || rawFile.deleted_at != null) {
    return fail("This document is no longer active. Reload Files before continuing.", "conflict");
  }
  const contentRevision = safeRevision(rawFile.content_revision, "content revision");
  const metadataRevision = safeRevision(rawFile.metadata_revision, "metadata revision");
  const documentRevision = safeRevision(rawDocument.content_revision, "document content revision");
  if (documentRevision !== contentRevision || typeof rawDocument.body !== "string") {
    return fail("The saved text and document revision do not match. Reload the latest saved version.", "conflict");
  }
  const body = safeBody(rawDocument.body).body;
  const sizeBytes = rawFile.size_bytes;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes !== new TextEncoder().encode(body).byteLength) {
    return fail("The saved document size does not match its text. Reload the latest saved version.", "conflict");
  }
  if (typeof rawFile.created_at !== "string" || typeof rawFile.updated_at !== "string" ||
      !(rawFile.content_sha256 === null || typeof rawFile.content_sha256 === "string") ||
      !(rawFile.course_id === null || typeof rawFile.course_id === "string") ||
      !(rawFile.assignment_id === null || typeof rawFile.assignment_id === "string") ||
      !(rawFile.folder_id === null || (typeof rawFile.folder_id === "string" && isFileId(rawFile.folder_id))) ||
      !(rawFile.trashed_at === null || typeof rawFile.trashed_at === "string") ||
      !(rawFile.trash_operation_id === null || typeof rawFile.trash_operation_id === "string") ||
      !(rawFile.original_folder_id === null || (typeof rawFile.original_folder_id === "string" && isFileId(rawFile.original_folder_id)))) {
    return fail("The server returned invalid document metadata. Reload Files before continuing.", "conflict");
  }
  if (payload.requestId !== undefined && (typeof payload.requestId !== "string" || !uuidPattern.test(payload.requestId))) {
    return fail("The server returned an invalid save request ID.", "conflict");
  }
  if (payload.acknowledgedContentRevision !== undefined) {
    safeRevision(payload.acknowledgedContentRevision, "acknowledged content revision");
  }

  const file = {
    id,
    name,
    mime_type: "text/plain",
    size_bytes: sizeBytes,
    course_id: typeof rawFile.course_id === "string" ? rawFile.course_id : rawFile.course_id === null ? null : fail("The server returned invalid course metadata.", "conflict"),
    assignment_id: typeof rawFile.assignment_id === "string" ? rawFile.assignment_id : rawFile.assignment_id === null ? null : fail("The server returned invalid assignment metadata.", "conflict"),
    kind: rawFile.kind as PrivateFile["kind"],
    state: "ready",
    created_at: rawFile.created_at,
    updated_at: rawFile.updated_at,
    content_sha256: rawFile.content_sha256,
    folder_id: typeof rawFile.folder_id === "string" ? rawFile.folder_id : rawFile.folder_id === null ? null : fail("The server returned invalid folder metadata.", "conflict"),
    content_backend: "native-text",
    metadata_revision: metadataRevision,
    content_revision: contentRevision,
    trashed_at: rawFile.trashed_at,
    trash_operation_id: rawFile.trash_operation_id,
    original_folder_id: rawFile.original_folder_id,
  } as PrivateFile;

  return {
    file,
    document: { file_id: id, body, content_revision: documentRevision },
    ...(payload.requestId === undefined ? {} : { requestId: payload.requestId as string }),
    ...(payload.acknowledgedContentRevision === undefined ? {} : { acknowledgedContentRevision: payload.acknowledgedContentRevision as number }),
  };
}

function assertWritableFile(file: PrivateFile): void {
  if (!file || typeof file !== "object" || !isFileId(file.id) || file.content_backend !== "native-text" || file.state !== "ready") {
    return fail("This file is not an active native text document.", "conflict");
  }
  safeName(file.name);
  safeRevision(file.content_revision, "content revision");
  safeRevision(file.metadata_revision, "metadata revision");
}

function validateAcknowledgement(result: NativeDocumentResult, expectedBody: string, requestId: string, baseFile: PrivateFile, intendedName?: string): void {
  if (result.requestId !== undefined && result.requestId !== requestId) {
    return fail("The server acknowledged a different save request. Reload the latest saved version.", "conflict");
  }
  const acknowledgement = result.acknowledgedContentRevision;
  if (acknowledgement === undefined || !Number.isSafeInteger(acknowledgement) || acknowledgement < 1 ||
      result.document.content_revision !== acknowledgement || acknowledgement < baseFile.content_revision) {
    return fail("The server could not confirm which document revision this save produced. Reload the latest saved version.", "conflict");
  }
  if (result.document.body !== expectedBody) {
    return fail("The document changed while this save was in progress. Your draft is still here; reload the latest saved version.", "conflict");
  }
  if (result.file.metadata_revision < baseFile.metadata_revision || result.file.content_revision < baseFile.content_revision) {
    return fail("The server returned an older document revision. Reload the latest saved version.", "conflict");
  }
  if (intendedName !== undefined && result.file.name !== intendedName) {
    return fail("The document name changed while this save was in progress. Your draft is still here; reload the latest saved version.", "conflict");
  }
}

export async function readNativeDocument(
  profileId: string,
  fileId: string,
  options: { signal?: AbortSignal } = {},
): Promise<NativeDocumentResult> {
  if (!isFileId(fileId)) return fail("Invalid document ID.", "conflict");
  const payload = await requestDocument(profileId, `/api/file-documents?id=${encodeURIComponent(fileId)}`, {
    method: "GET",
    signal: options.signal,
  });
  return parseResult(payload, profileId, fileId);
}

export async function createNativeDocument(
  profileId: string,
  input: NativeDocumentCreate,
  options: { signal?: AbortSignal } = {},
): Promise<NativeDocumentResult> {
  if (!input || !isFileId(input.id)) return fail("Invalid document ID.");
  const name = safeName(input.name), body = safeBody(input.body).body;
  if (typeof input.courseId !== "string" || input.courseId.length > 500 ||
      (input.folderId !== null && !isFileId(input.folderId))) return fail("Invalid document location or course.");
  const payload = await requestDocument(profileId, "/api/file-documents", {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: input.id, name, kind: "resource", courseId: input.courseId, assignmentId: "", folderId: input.folderId, body }),
  }, true);
  const result = parseResult(payload, profileId, input.id);
  const expectedCourseId = input.courseId || null;
  if (result.file.name !== name || result.document.body !== body || result.file.kind !== "resource" ||
      result.file.course_id !== expectedCourseId || result.file.assignment_id !== null || result.file.folder_id !== input.folderId) {
    return fail("The created document did not match the requested draft. Reload Files before continuing.", "conflict");
  }
  return result;
}

export async function saveNativeDocument(
  profileId: string,
  file: PrivateFile,
  draft: DocumentDraft,
  requestId: string,
  options: { signal?: AbortSignal } = {},
): Promise<NativeDocumentResult> {
  assertWritableFile(file);
  if (!uuidPattern.test(requestId)) return fail("Invalid save request ID.");
  const body = safeBody(draft.body).body;
  const name = safeName(draft.name);
  const renamed = name !== file.name;
  const metadata = renamed ? { name, baseMetadataRevision: safeRevision(file.metadata_revision, "metadata revision") } : {};
  const payload = await requestDocument(profileId, `/api/file-documents?id=${encodeURIComponent(file.id)}`, {
    method: "PUT",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "update_content",
      requestId,
      body,
      baseContentRevision: safeRevision(file.content_revision, "content revision"),
      ...metadata,
    }),
  }, true);
  const result = parseResult(payload, profileId, file.id);
  validateAcknowledgement(result, body, requestId, file, renamed ? name : undefined);
  if (renamed && result.file.metadata_revision <= file.metadata_revision) {
    return fail("The document name revision did not advance. Reload the latest saved version.", "conflict");
  }
  return result;
}

export function suggestedTextFileName(existingNames: Iterable<string | Pick<PrivateFile, "name">> = []): string {
  const names = new Set<string>();
  for (const item of existingNames) {
    const name = typeof item === "string" ? item : item?.name;
    if (typeof name === "string") names.add(name.toLowerCase());
  }
  if (!names.has("untitled.txt")) return "Untitled.txt";
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = `Untitled (${suffix}).txt`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return fail("A safe document name could not be generated.");
}

export function downloadTextDraft(draft: DocumentDraft): void {
  if (!draft || typeof draft.body !== "string") return fail("Document text must be a plain-text string.");
  let name: string;
  try {
    name = safeName(draft.name);
  } catch {
    name = "Untitled";
  }
  const fileName = name.toLowerCase().endsWith(".txt") ? name : `${name}.txt`;
  const blob = new Blob([draft.body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.documentElement.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
