// Verify the logical-conflict response without writing user content. A null
// expected revision must fail before any course/file/dashboard mutation.
const { SUPABASE_URL: origin, SUPABASE_SECRET_KEY: secret } = process.env;
if (!origin || !secret) throw new Error("Supabase server configuration is incomplete.");
const headers = { apikey: secret, ...(secret.startsWith("eyJ") ? { Authorization: `Bearer ${secret}` } : {}) };
const profiles = await fetch(new URL("/rest/v1/app_profiles?select=id,auth_user_id&initialized=eq.true&onboarding_completed_at=not.is.null&auth_user_id=not.is.null&limit=1", origin), {
  headers, signal: AbortSignal.timeout(10000),
});
if (!profiles.ok) throw new Error(`Profile metadata lookup failed (${profiles.status}).`);
const [profile] = await profiles.json();
if (!profile) throw new Error("No initialized account is available for the conflict probe.");
const start = performance.now();
const response = await fetch(new URL("/rest/v1/rpc/save_account_workspace", origin), {
  method: "POST", headers: { ...headers, "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
  body: JSON.stringify({ p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id, p_expected_revision: null, p_courses: [], p_dashboard: {} }),
});
const result = await response.json();
const passed = response.status === 409 && result.code === "PT409";
console.log(JSON.stringify({ passed, httpStatus: response.status, code: result.code, durationMs: Math.round(performance.now() - start) }, null, 2));
if (!passed) process.exitCode = 1;
