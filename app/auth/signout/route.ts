import { apiError, createAuthClient, requireSameOrigin } from "../../../lib/auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const auth = await createAuthClient();
    const { error } = await auth.auth.signOut({ scope: "local" });
    if (error) throw error;
    return new Response(null, { status: 303, headers: { location: "/login", "cache-control": "no-store", "clear-site-data": '"cache"' } });
  } catch (error) { return apiError(error); }
}
