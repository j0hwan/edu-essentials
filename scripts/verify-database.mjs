// Read-only metadata probe. Never logs credentials or reads application records.
const { SUPABASE_URL: origin, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: publishable } = process.env;
if (!origin || !secret || !publishable) throw new Error("Supabase configuration is incomplete.");
async function read(path, key = secret) {
  const response = await fetch(new URL(path, origin), { headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
const schema = await read("/rest/v1/");
const tables = ["app_profiles", "courses", "dashboard_state", "user_files"];
const report = { schemaStatus: schema.status, tables: {}, functions: Object.keys(schema.body.paths ?? {}).filter((path) => path.startsWith("/rpc/")) };
for (const table of tables) {
  const definition = schema.body.definitions?.[table];
  const access = await read(`/rest/v1/${table}?select=*&limit=0`, publishable);
  report.tables[table] = { installed: !!definition, columns: Object.keys(definition?.properties ?? {}), anonymousReadStatus: access.status };
}
const settings = await read("/auth/v1/settings", publishable);
report.googleEnabled = settings.body.external?.google ?? null;
const bucket = await read("/storage/v1/bucket/eduessentials-private");
report.privateBucket = { status: bucket.status, exists: bucket.status === 200, error: bucket.body.error ?? null, public: bucket.body.public ?? null, fileSizeLimit: bucket.body.file_size_limit ?? null };
console.log(JSON.stringify(report, null, 2));
