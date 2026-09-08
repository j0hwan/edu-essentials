export class PersistenceRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function requireAccountScope(request: Request | undefined, profileId: string) {
  const expected = request?.headers.get("x-profile-id");
  if (expected && expected !== profileId) throw new PersistenceRequestError("The signed-in account changed. Sign in to the original account before retrying.", 401);
}

// Count bytes as the body arrives, including chunked requests without a length.
export async function readPersistenceJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new PersistenceRequestError("Use application/json.", 415);
  }
  const tooLarge = () => new PersistenceRequestError("The save is too large.", 413);
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new PersistenceRequestError("Invalid JSON body.");
  let length = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw tooLarge(); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PersistenceRequestError) throw error;
    throw new PersistenceRequestError("Invalid JSON body.");
  } finally { reader.releaseLock(); }
}

export function requireSaveRevision(value: unknown, allowMissingRow = false): string | null {
  if (value === null && allowMissingRow) return null;
  if (value === undefined) throw new PersistenceRequestError("Reload the latest saved data before saving.", 428);
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new PersistenceRequestError("Invalid save revision.");
  }
  return value;
}

// Existing Postgres timestamps are opaque comparison tokens. A successful write
// advances by at least a millisecond, even with a slow clock or same-ms writes.
export function nextSaveRevision(previous: string | null): string {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}

export function saveConflict() {
  return Response.json({ error: "This data was changed in another session. Your edits are still here; export or copy them before reloading the latest saved version.", code: "save_conflict" }, { status: 409, headers: { "cache-control": "no-store" } });
}
