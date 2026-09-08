import { createAuthClient, ensureProfile } from "../../../lib/auth";
import { isAuthUnavailable, isGoogleUser } from "../../../lib/auth-policy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  let destination = "/login?error=callback";
  try {
    const code = url.searchParams.get("code");
    if (code && !url.searchParams.has("error")) {
      const auth = await createAuthClient();
      const { data, error } = await auth.auth.exchangeCodeForSession(code);
      if (error) {
        if (isAuthUnavailable(error)) destination = "/login?error=unavailable";
        console.error("Supabase OAuth exchange failed", {
          name: error.name,
          message: error.message,
          status: error.status,
          code: error.code,
        });
      } else if (data.user && isGoogleUser(data.user)) {
        const profile = await ensureProfile(data.user);
        destination = profile.onboarding_completed_at ? "/" : "/onboarding";
      }
    }
  } catch (error) {
    console.error("OAuth callback profile setup failed", error instanceof Error ? error.message : "Unknown error");
    destination = "/login?error=profile";
  }
  return new Response(null, { status: 303, headers: { location: destination, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
