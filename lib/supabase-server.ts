import { env } from "cloudflare:workers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

let client: SupabaseClient | undefined;

export function getSupabaseAuthConfig() {
  const workerEnv = env as unknown as SupabaseEnvironment;
  const url = workerEnv.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = workerEnv.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase authentication is not configured.");
  return { url, key };
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const workerEnv = env as unknown as SupabaseEnvironment;
  const url = workerEnv.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const secretKey = workerEnv.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase server environment is not configured.");
  }

  client = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return client;
}
