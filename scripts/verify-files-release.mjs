// Read-only structural preflight. Never fetches user rows or prints credentials.
// A passing metadata probe does not satisfy the authenticated release gates.
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const requiredFileTables = {
  user_files: ["folder_id", "content_backend", "metadata_revision", "content_revision", "trashed_at", "original_location_path"],
  file_folders: ["id", "profile_id", "parent_id", "revision", "archived_at", "trashed_at", "deleted_at", "purge_pending_at"],
  native_file_documents: ["profile_id", "file_id", "body"],
  file_activity: ["profile_id", "file_id", "starred_at", "last_opened_at"],
  folder_activity: ["profile_id", "folder_id", "starred_at", "last_opened_at"],
};
export const requiredFileRpcs = [
  "mutate_account_file", "mutate_account_folder", "mutate_account_document",
  "mutate_account_document_request", "read_account_file_content", "mutate_account_files_action",
  "rename_account_file", "begin_account_file_purge", "finalize_account_file_purge",
  "snapshot_account_file_selection", "read_account_file_browser", "export_account",
];
export const requiredAiRpcs = ["ai_finish_message", "mutate_account_ai_source"];

export function evaluateFileReleaseMetadata({ schema, anonymousSchema, anonymousAccess, bucket }) {
  const definitions = schema.status === 200 ? schema.body?.definitions ?? {} : {};
  const privatePaths = schema.status === 200 ? schema.body?.paths ?? {} : {};
  const anonymousPaths = anonymousSchema.status === 200 ? anonymousSchema.body?.paths ?? {} : {};
  const aiInstalled = Object.hasOwn(privatePaths, "/rpc/ai_begin_message") ||
    Object.hasOwn(privatePaths, "/rpc/ai_finish_message") || Object.hasOwn(definitions, "ai_sources");
  const requiredRpcs = [...requiredFileRpcs, ...(aiInstalled ? requiredAiRpcs : [])];
  const tables = Object.fromEntries(Object.entries(requiredFileTables).map(([name, columns]) => {
    const properties = definitions[name]?.properties ?? {};
    const missingColumns = columns.filter((column) => !Object.hasOwn(properties, column));
    const status = anonymousAccess[name]?.status ?? null;
    return [name, {
      installed: Object.hasOwn(definitions, name), missingColumns,
      anonymousReadStatus: status, anonymousReadDenied: status === 401 || status === 403,
    }];
  }));
  const missingRpcs = requiredRpcs.filter((name) => !Object.hasOwn(privatePaths, `/rpc/${name}`));
  const anonymousRpcs = [...requiredFileRpcs, ...requiredAiRpcs].filter((name) => Object.hasOwn(anonymousPaths, `/rpc/${name}`));
  const privateBucket = {
    status: bucket.status, private: bucket.status === 200 && bucket.body?.public === false,
    fileSizeLimit: bucket.body?.file_size_limit ?? null,
  };
  const anonymousMetadataStatusAccepted = [200, 401, 403].includes(anonymousSchema.status);
  const structuralPrerequisitesPassed = schema.status === 200 && anonymousMetadataStatusAccepted &&
    Object.values(tables).every((table) => table.installed && !table.missingColumns.length && table.anonymousReadDenied) &&
    !missingRpcs.length && !anonymousRpcs.length && privateBucket.private && privateBucket.fileSizeLimit === 26_214_400;
  return {
    status: structuralPrerequisitesPassed ? "metadata-passed" : "metadata-blocked",
    structuralPrerequisitesPassed,
    releaseReady: false,
    schemaStatus: schema.status, anonymousSchemaStatus: anonymousSchema.status, aiInstalled,
    anonymousRpcVisibilityVerified: anonymousSchema.status === 200,
    tables, missingRpcs, anonymousRpcs, privateBucket,
    outstandingGates: [
      "Confirm exact migration versions, SQL grants and the AI finalization fence in the deployment database.",
      "Verify two authenticated accounts and real private-storage isolation.",
      "Verify multi-session PostgreSQL contention and deployed end-to-end navigation.",
      "Verify supported browsers and large-ZIP memory/load behavior.",
      "Deploy compatible APIs before enabling FILES_BROWSER_ENABLED.",
    ],
  };
}

export async function probeFileReleaseMetadata(env = process.env) {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_PUBLISHABLE_KEY) throw new Error("Supabase configuration is incomplete.");
  const origin = new URL(SUPABASE_URL);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("A clean HTTPS Supabase origin is required.");
  }
  async function read(path, key = SUPABASE_SECRET_KEY) {
    const response = await fetch(new URL(path, origin), {
      method: "GET", redirect: "error", cache: "no-store",
      headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    let body = null;
    try { body = await response.json(); } catch { /* Only fixed metadata fields are reported. */ }
    return { status: response.status, body };
  }
  const [schema, anonymousSchema, bucket, accesses] = await Promise.all([
    read("/rest/v1/"), read("/rest/v1/", SUPABASE_PUBLISHABLE_KEY),
    read("/storage/v1/bucket/eduessentials-private"),
    Promise.all(Object.keys(requiredFileTables).map(async (table) => [table,
      await read(`/rest/v1/${table}?select=*&limit=0`, SUPABASE_PUBLISHABLE_KEY)])),
  ]);
  const report = evaluateFileReleaseMetadata({ schema, anonymousSchema, bucket, anonymousAccess: Object.fromEntries(accesses) });
  const migrationOrder = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((name) => /^\d{14}_[a-z_]+\.sql$/.test(name)).sort();
  return { ...report, migrationOrder };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await probeFileReleaseMetadata();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.structuralPrerequisitesPassed ? 0 : 2;
  } catch {
    // Do not print transport errors or server bodies, which can contain secrets.
    process.stderr.write(`${JSON.stringify({ status: "probe-failed", releaseReady: false, error: "Release metadata could not be verified. Check local configuration and connectivity." })}\n`);
    process.exitCode = 1;
  }
}
