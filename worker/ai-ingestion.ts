import { getSupabaseAdmin } from "../lib/supabase-server";
import { aiConfig } from "../lib/ai/config";
import { extractDocument, UnsupportedDocument } from "../lib/ai/extract";
import { chunkPages } from "../lib/ai/chunks";
import { hashBytes, FILE_BUCKET } from "../lib/files";

/** Durable DB jobs, leases, and version checks make restarts and duplicate ticks safe. */
export async function ingestTick() {
  const config = aiConfig(), db = getSupabaseAdmin();
  const cleanup = await db.rpc("ai_cleanup"); if (cleanup.error) throw new Error("AI cleanup failed.");
  if (!config.enabled || !config.apiKey || !config.allowlist.length) return;
  for (let i = 0; i < 2; i++) {
    const claimed = await db.rpc("ai_claim_source", { p_allowed: config.allowlist, p_synthetic: config.mode !== "paid" });
    if (claimed.error) throw new Error("AI job claim failed.");
    const source = claimed.data; if (!source) break;
    try {
      let chunks;
      if (source.file_id) {
        const file = await db.from("user_files").select("mime_type,size_bytes,content_sha256").eq("profile_id", source.profile_id).eq("id", source.file_id).eq("state", "ready").is("deleted_at", null).single();
        if (file.error || !file.data) throw new Error("Source file unavailable.");
        if (file.data.size_bytes > 10485760) throw new UnsupportedDocument("AI indexing supports files up to 10 MB.");
        const downloaded = await db.storage.from(FILE_BUCKET).download(`${source.profile_id}/${source.file_id}`);
        if (downloaded.error || !downloaded.data) throw new Error("Source download failed.");
        const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
        if (bytes.length !== Number(file.data.size_bytes) || await hashBytes(bytes) !== source.version) throw new Error("Source verification failed.");
        chunks = await extractDocument(bytes, file.data.mime_type);
      } else chunks = chunkPages([source.body ?? ""]);
      const published = await db.rpc("ai_publish_source", { p_profile_id: source.profile_id, p_id: source.id, p_version: source.version, p_lease: source.lease_id, p_chunks: chunks });
      if (published.error) throw new Error("Index publication failed.");
    } catch (error) {
      const unsupported = error instanceof UnsupportedDocument;
      await db.from("ai_sources").update({ state: unsupported ? "unsupported" : source.attempts >= 5 ? "failed" : "queued", error: unsupported ? error.message : "Indexing could not finish. It will retry, or you can retry from Manage sources.", lease_id: null, lease_until: null, available_at: new Date(Date.now() + Math.min(3600, 60 * 2 ** source.attempts) * 1000).toISOString() }).eq("profile_id", source.profile_id).eq("id", source.id).eq("version", source.version).eq("lease_id", source.lease_id);
    }
  }
  // A small embedding batch per tick leaves quota for interactive questions.
  for (const profileId of config.allowlist) {
    const access = await db.from("ai_access").select("*").eq("profile_id", profileId).eq("enabled", true).eq("adult_confirmed", true).maybeSingle();
    if (!access.data || (config.mode !== "paid" && !access.data.synthetic_confirmed)) continue;
    const sources = await db.from("ai_sources").select("id,version").eq("profile_id", profileId).eq("enabled", true).eq("state", "ready");
    if (!sources.data?.length) continue;
    const missing = await db.from("ai_chunks").select("source_id,version,ordinal,body").eq("profile_id", profileId).in("source_id", sources.data.map((s) => s.id)).is("embedding", null).limit(8);
    const rows = (missing.data ?? []).filter((c) => sources.data!.some((s) => s.id === c.source_id && s.version === c.version));
    if (!rows.length) continue;
    const tokens = rows.reduce((sum, c) => sum + c.body.length + 100, 0);
    const reserved = await db.rpc("ai_reserve", { p_profile_id: profileId, p_user_daily: config.userDaily, p_project_daily: config.projectDaily, p_rpm: config.projectRpm, p_tpm: config.projectTpm, p_monthly_usd: config.monthlyUsd, p_tokens: tokens, p_usd: tokens * 0.2 / 1000000 });
    if (reserved.error) return;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.embeddingModel)}:batchEmbedContents`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ requests: rows.map((c) => ({ model: `models/${config.embeddingModel}`, content: { parts: [{ text: `Represent this document for retrieval: ${c.body}` }] }, outputDimensionality: 768 })) }),
    });
    if (!response.ok) return; // Keyword retrieval remains usable; retry next tick.
    const data = await response.json() as { embeddings?: { values: number[] }[] };
    if (data.embeddings?.length !== rows.length) return;
    for (let i = 0; i < rows.length; i++) {
      const values = data.embeddings[i].values, row = rows[i];
      if (values.length !== 768 || values.some((v) => !Number.isFinite(v))) continue;
      await db.from("ai_chunks").update({ embedding: JSON.stringify(values), embedding_model: config.embeddingModel }).eq("profile_id", profileId).eq("source_id", row.source_id).eq("version", row.version).eq("ordinal", row.ordinal);
    }
    return;
  }
}
export default {
  async scheduled() { await ingestTick(); },
  fetch() { return new Response("AI ingestion worker. No public endpoints.", { status: 404 }); },
};
