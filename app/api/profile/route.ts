import { apiError, requireProfile, requireSameOrigin } from "../../../lib/auth";
import { validateProfile } from "../../../lib/profile";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ profile: await requireProfile(false) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    const profile = await requireProfile(false);
    let details;
    try { details = validateProfile(await request.json()); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile." }, { status: 400 }); }
    const { data, error } = await getSupabaseAdmin().from("app_profiles").update({
      ...details, onboarding_completed_at: profile.onboarding_completed_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", profile.id).eq("auth_user_id", profile.auth_user_id).select("*").single();
    if (error) throw error;
    return Response.json({ profile: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
