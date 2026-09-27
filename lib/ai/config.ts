import { env } from "cloudflare:workers";
export function aiConfig() {
  const values = env as unknown as Record<string, string | undefined>;
  const get = (key: string, fallback = "") => values[key] ?? process.env[key] ?? fallback;
  const positive = (key: string, fallback: number) => { const n = Number(get(key, String(fallback))); return Number.isFinite(n) && n > 0 ? n : fallback; };
  return {
    enabled: get("AI_ENABLED") === "true", mode: get("AI_DATA_MODE", "synthetic"),
    apiKey: get("GEMINI_API_KEY"), model: get("AI_CHAT_MODEL", "gemini-3.8-flash"),
    embeddingModel: get("AI_EMBEDDING_MODEL", "gemini-embedding-2"),
    allowlist: get("AI_ALLOWED_PROFILE_IDS").split(",").map((s) => s.trim()).filter(Boolean),
    userDaily: positive("AI_USER_DAILY_REQUESTS", 30), projectDaily: positive("AI_PROJECT_DAILY_REQUESTS", 100),
    projectRpm: positive("AI_PROJECT_RPM", 10), projectTpm: positive("AI_PROJECT_TPM", 300000),
    monthlyUsd: positive("AI_MONTHLY_BUDGET_USD", 25),
    inputUsd: positive("AI_INPUT_USD_PER_MILLION", 1.5), outputUsd: positive("AI_OUTPUT_USD_PER_MILLION", 7.5),
  };
}
