import { apiError, requireProfile, requireSameOrigin } from "../../../lib/auth";
import { editableProfile, validateProfile } from "../../../lib/profile";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { readPersistenceJson, PersistenceRequestError, requireSaveRevision, nextSaveRevision, saveConflict, requireAccountScope } from "../../../lib/persistence-request";
export const dynamic = "force-dynamic";
export async function GET(request?: Request) {
  try { const profile = await requireProfile(false); requireAccountScope(request, profile.id); return Response.json({ profile }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return profileError(error); }
}
export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    const profile = await requireProfile(false);
    requireAccountScope(request, profile.id);
    const body = await readPersistenceJson(request, 16_384);
    const baseRevision = requireSaveRevision(body.baseRevision);
    let details;
    try { details = validateProfile({ ...editableProfile(profile), ...body }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile." }, { status: 400 }); }
    // A lost response can be retried safely if the exact requested values landed.
    if (profile.onboarding_completed_at && baseRevision !== profile.updated_at && JSON.stringify(details) === JSON.stringify(validateProfile(profile))) {
      return Response.json({ profile }, { headers: { "cache-control": "no-store" } });
    }
    const { data, error } = await getSupabaseAdmin().from("app_profiles").update({
      ...details, onboarding_completed_at: profile.onboarding_completed_at ?? new Date().toISOString(), updated_at: nextSaveRevision(baseRevision),
    }).eq("id", profile.id).eq("auth_user_id", profile.auth_user_id).eq("updated_at", baseRevision).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return saveConflict();
    return Response.json({ profile: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return profileError(error);
  }
}

function profileError(error: unknown) {
  if (error instanceof PersistenceRequestError) return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
  return apiError(error);
}
