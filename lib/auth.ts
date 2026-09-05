import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin, getSupabaseAuthConfig } from "./supabase-server";
import { isGoogleUser, isSameOrigin } from "./auth-policy";
import { defaultPreferences, type Profile } from "./profile";
import type { User } from "@supabase/supabase-js";

export async function createAuthClient() {
  const store = await cookies();
  const { url, key } = getSupabaseAuthConfig();
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        // Middleware refreshes cookies for read-only Server Component renders.
        try { items.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only render */ }
      },
    },
  });
}

export class AuthError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function authenticatedUser() {
  const auth = await createAuthClient();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user || !isGoogleUser(user)) throw new AuthError("Please sign in with Google.", 401);
  return user;
}

export async function ensureProfile(user: User): Promise<Profile> {
  const db = getSupabaseAdmin();
  const { data: existing, error } = await db.from("app_profiles").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (error) throw error;
  if (existing) return { ...existing, preferences: { ...defaultPreferences, ...existing.preferences } } as Profile;
  const metadata = user.user_metadata;
  const name = String(metadata.full_name ?? metadata.name ?? "").slice(0, 160);
  // Never claim a profile using the legacy, unsigned anonymous cookie.
  const { error: insertError } = await db.from("app_profiles").upsert({
    id: crypto.randomUUID(), auth_user_id: user.id, email: user.email ?? "",
    display_name: name, avatar_url: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
  }, { onConflict: "auth_user_id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data, error: readError } = await db.from("app_profiles").select("*").eq("auth_user_id", user.id).single();
  if (readError) throw readError;
  return { ...data, preferences: { ...defaultPreferences, ...data.preferences } } as Profile;
}

export async function requireProfile(onboarded = true) {
  const profile = await ensureProfile(await authenticatedUser());
  if (onboarded && !profile.onboarding_completed_at) throw new AuthError("Complete your profile first.", 403);
  return profile;
}

export function requireSameOrigin(request: Request) {
  if (!isSameOrigin(request)) throw new AuthError("This request must come from your workspace.", 403);
}

export function apiError(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
  console.error("Account operation failed", error instanceof Error ? error.message : "Database operation failed");
  return Response.json({ error: "Your account could not be loaded or saved. Please try again." }, { status: 503, headers: { "cache-control": "no-store" } });
}
