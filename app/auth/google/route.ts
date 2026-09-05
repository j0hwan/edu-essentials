import { apiError, AuthError, createAuthClient, requireSameOrigin } from "../../../lib/auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const auth = await createAuthClient();
    const { data, error } = await auth.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: new URL("/auth/callback", request.url).href, scopes: "openid email profile", queryParams: { prompt: "select_account" }, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new Error("Google sign-in unavailable");
    return new Response(null, { status: 303, headers: { location: data.url, "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthError) return apiError(error);
    return new Response(null, { status: 303, headers: { location: "/login?error=unavailable", "cache-control": "no-store" } });
  }
}
