import { z, ZodError } from "zod";
import { AuthError, requireProfile, requireSameOrigin } from "../auth";
import { readPersistenceJson, requireAccountScope, PersistenceRequestError } from "../persistence-request";
import { getSupabaseAdmin } from "../supabase-server";
import { readAcademicWorkspace } from "../workspace-server";
import { academicSnapshot } from "../academic-snapshot";
import type { Profile } from "../profile";
import { aiConfig } from "./config";
import { AI_MAX_INPUT_CHARS, AI_MAX_OUTPUT_TOKENS, AI_PROMPT_VERSION, AnswerValidationError, messageSchema, proposalRequestSchema, type Citation } from "./contracts";
import { GeminiProvider, ProviderError, type Content } from "./provider";
import { runAssistant } from "./runner";
import { buildProposal, type AcademicContext } from "./academic-tools";
import { searchAcademicDocuments } from "./retrieval";

const uuid = z.string().uuid();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
function fail(message: string, status = 400): never { throw new PersistenceRequestError(message, status); }
function check(error: unknown) { if (error) throw error; }
async function access(profile: Profile) {
  const config = aiConfig();
  if (!config.enabled || !config.apiKey || !config.allowlist.includes(profile.id)) fail("The assistant is not enabled for this account yet.", 403);
  if (profile.age !== null && profile.age < 18) fail("The assistant is available to adults only.", 403);
  const result = await getSupabaseAdmin().from("ai_access").select("*").eq("profile_id", profile.id).maybeSingle(); check(result.error);
  if (!result.data?.enabled || !result.data.adult_confirmed || (config.mode !== "paid" && !result.data.synthetic_confirmed)) fail("Enable the assistant and confirm eligibility first.", 403);
  return config;
}
async function reserve(profileId: string, tokens = AI_MAX_INPUT_CHARS, usd?: number) {
  const config = aiConfig();
  const result = await getSupabaseAdmin().rpc("ai_reserve", { p_profile_id: profileId, p_user_daily: config.userDaily, p_project_daily: config.projectDaily, p_rpm: config.projectRpm, p_tpm: config.projectTpm, p_monthly_usd: config.monthlyUsd, p_tokens: tokens, p_usd: usd ?? (tokens * config.inputUsd + AI_MAX_OUTPUT_TOKENS * config.outputUsd) / 1000000 });
  if (result.error?.code === "P0001") fail("The AI usage budget is currently exhausted. Try later.", 429);
  check(result.error);
}
async function citationsCurrent(profileId: string, citations: Citation[]) {
  const noteKeys = citations.filter((c) => c.kind === "record" && c.recordId && /^(note:|syllabus:|legacy-note)/.test(c.recordId)).map((c) => c.recordId!);
  if (noteKeys.length) {
    const excluded = await getSupabaseAdmin().from("ai_sources").select("id").eq("profile_id", profileId).in("source_key", noteKeys).eq("enabled", false); check(excluded.error);
    if (excluded.data?.length) return false;
  }
  const ids = citations.filter((c) => c.kind === "document").map((c) => c.sourceId!);
  if (!ids.length) return true;
  const db = getSupabaseAdmin();
  const sources = await db.from("ai_sources").select("id,version,enabled,state,file_id,file_available")
    .eq("profile_id", profileId).in("id", ids); check(sources.error);
  const documents = citations.filter((c) => c.kind === "document");
  if (!documents.every((c) => sources.data?.some((s) => s.id === c.sourceId && s.version === c.version
      && s.enabled && s.state === "ready" && s.file_available))) return false;
  const fileIds = [...new Set((sources.data ?? []).map((s) => s.file_id).filter((id): id is string => !!id))];
  if (!fileIds.length) return true;
  const files = await db.from("user_files").select("id,content_sha256,state,deleted_at,trashed_at")
    .eq("profile_id", profileId).in("id", fileIds); check(files.error);
  const currentFiles = new Map((files.data ?? []).map((file) => [file.id, file]));
  return documents.every((citation) => {
    const source = sources.data?.find((row) => row.id === citation.sourceId);
    if (!source?.file_id) return true;
    const file = currentFiles.get(source.file_id);
    return !!file && file.state === "ready" && file.deleted_at === null && file.trashed_at === null
      && file.content_sha256 === citation.version;
  });
}

export async function aiRoute(request: Request, resource: string): Promise<Response> {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    const profile = await requireProfile(); requireAccountScope(request, profile.id);
    const db = getSupabaseAdmin(), config = aiConfig(), url = new URL(request.url);
    if (resource === "access") {
      if (request.method === "GET") {
        const eligible = config.enabled && !!config.apiKey && config.allowlist.includes(profile.id) && (profile.age === null || profile.age >= 18);
        if (!eligible) return json({ eligible: false, enabled: false, mode: config.mode });
        const result = await db.from("ai_access").select("enabled,adult_confirmed,synthetic_confirmed").eq("profile_id", profile.id).maybeSingle(); check(result.error);
        return json({ eligible, mode: config.mode, ...result.data });
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const body = z.object({ enabled: z.boolean(), adultConfirmed: z.boolean(), syntheticConfirmed: z.boolean() }).strict().parse(await readPersistenceJson(request, 2048));
      if (body.enabled && (!config.enabled || !config.allowlist.includes(profile.id) || !body.adultConfirmed || (profile.age !== null && profile.age < 18) || (config.mode !== "paid" && !body.syntheticConfirmed))) fail("This account is not eligible for AI access.", 403);
      const result = await db.from("ai_access").upsert({ profile_id: profile.id, enabled: body.enabled, adult_confirmed: body.adultConfirmed, synthetic_confirmed: body.syntheticConfirmed, updated_at: new Date().toISOString() }); check(result.error);
      return json({ ok: true });
    }
    await access(profile);
    if (resource === "conversations") {
      if (request.method === "GET") {
        const result = await db.from("ai_conversations").select("id,title,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(100); check(result.error); return json({ conversations: result.data });
      }
      const body = await readPersistenceJson(request, 2048);
      if (request.method === "POST") {
        const title = z.string().trim().min(1).max(120).parse(body.title ?? "New conversation");
        const result = await db.from("ai_conversations").insert({ profile_id: profile.id, title }).select("id,title,created_at").single(); check(result.error); return json(result.data, 201);
      }
      if (request.method === "DELETE") { const result = await db.from("ai_conversations").delete().eq("profile_id", profile.id).eq("id", uuid.parse(body.id)); check(result.error); return json({ ok: true }); }
    }
    if (resource === "messages") {
      if (request.method === "GET") {
        const conversationId = uuid.parse(url.searchParams.get("conversationId"));
        const result = await db.from("ai_messages").select("id,question,status,result,error,created_at").eq("profile_id", profile.id).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(100); check(result.error);
        return json({ messages: (result.data ?? []).reverse().map((m) => m.status === "running" && Date.parse(m.created_at) < Date.now() - 300000 ? { ...m, status: "failed", error: "The request was interrupted. Send a new message to retry." } : m) });
      }
      if (request.method === "POST") return await sendMessage(request, profile);
    }
    if (resource === "proposals") {
      if (request.method === "GET") {
        const result = await db.from("ai_proposals").select("id,status,preview,receipt,expires_at").eq("profile_id", profile.id).eq("id", uuid.parse(url.searchParams.get("id"))).maybeSingle(); check(result.error); if (!result.data) fail("Proposal unavailable.", 404); return json(result.data);
      }
      if (request.method === "POST") {
        const body = proposalRequestSchema.parse(await readPersistenceJson(request, 2048));
        if (body.action === "dismiss") { const result = await db.from("ai_proposals").update({ status: "dismissed" }).eq("profile_id", profile.id).eq("id", body.id).eq("status", "pending"); check(result.error); return json({ ok: true }); }
        const saved = await db.from("ai_proposals").select("snapshot,status").eq("profile_id", profile.id).eq("id", body.id).single(); check(saved.error);
        if (!saved.data) fail("Proposal unavailable.", 404);
        if (saved.data.status === "pending") academicSnapshot(saved.data.snapshot.courses.map(({ soft_color, ...c }: Record<string, unknown>) => ({ ...c, soft: soft_color })), saved.data.snapshot.dashboard);
        const result = await db.rpc("ai_apply_proposal", { p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id, p_id: body.id }); check(result.error); return json({ receipt: result.data });
      }
    }
    if (resource === "sources") {
      if (request.method === "GET") { const result = await db.from("ai_sources").select("id,label,state,error,enabled,file_id,file_available,updated_at").eq("profile_id", profile.id).order("updated_at", { ascending: false }).limit(1000); check(result.error); return json({ sources: result.data }); }
      if (request.method === "POST") {
        const body = z.object({ id: uuid, action: z.enum(["retry", "exclude", "include"]) }).strict().parse(await readPersistenceJson(request, 2048));
        const result = await db.rpc("mutate_account_ai_source", { p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id, p_id: body.id, p_action: body.action }); check(result.error); return json({ ok: true });
      }
    }
    if (resource === "citations" && request.method === "GET") {
      const message = await db.from("ai_messages").select("result").eq("profile_id", profile.id).eq("id", uuid.parse(url.searchParams.get("messageId"))).single(); check(message.error);
      const citation = (message.data?.result?.citations as Citation[] | undefined)?.find((c) => c.id === url.searchParams.get("id"));
      if (!citation) fail("Source unavailable.", 404);
      if (!await citationsCurrent(profile.id, [citation])) return json({ unavailable: true, message: "This source was removed, excluded, or changed." });
      const current = citation.kind === "record" ? await readAcademicWorkspace(profile.id) : null;
      return json({ ...citation, historical: !!current && current.revision !== citation.version });
    }
    if (resource === "export" && request.method === "GET") {
      const conversations = await db.from("ai_conversations").select("*").eq("profile_id", profile.id); check(conversations.error);
      const messages = await db.from("ai_messages").select("*").eq("profile_id", profile.id); check(messages.error);
      return json({ exportedAt: new Date().toISOString(), conversations: conversations.data, messages: messages.data });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) { return aiFailure(error); }
}

async function sendMessage(request: Request, profile: Profile) {
  const body = messageSchema.parse(await readPersistenceJson(request, 40000)), config = aiConfig(), db = getSupabaseAdmin();
  const begun = await db.rpc("ai_begin_message", { p_profile_id: profile.id, p_conversation_id: body.conversationId, p_id: body.requestId, p_question: body.message, p_model: config.model, p_prompt_version: AI_PROMPT_VERSION }); check(begun.error);
  if (!begun.data.created) return json(begun.data.message, begun.data.message.status === "running" ? 202 : 200);
  try {
    const workspace = await readAcademicWorkspace(profile.id);
    const context: AcademicContext = { ...workspace, profile: { timezone: profile.timezone, major: profile.major, academic_year: profile.academic_year, study_goal: profile.study_goal, current_term: profile.current_term, gpa_system: profile.gpa_system, week_starts_on: profile.week_starts_on }, now: new Date() };
    const old = await db.from("ai_messages").select("question,result").eq("profile_id", profile.id).eq("conversation_id", body.conversationId).eq("status", "complete").order("created_at", { ascending: false }).limit(4); check(old.error);
    const history: Content[] = (old.data ?? []).reverse().flatMap((m) => [{ role: "user" as const, parts: [{ text: m.question.slice(0, 2000) }] }, { role: "model" as const, parts: [{ text: JSON.stringify(m.result?.answer ?? {}).slice(0, 4000) }] }]);
    let start = Date.now();
    const result = await runAssistant(context, body.message, history, {
      provider: new GeminiProvider(config.apiKey, config.model),
      search: (query, courseId) => searchAcademicDocuments(profile.id, context, query, courseId, (tokens, usd) => reserve(profile.id, tokens, usd)),
      reserve: async () => { await access(profile); await reserve(profile.id); start = Date.now(); },
      usage: async (usage) => { const logged = await db.from("ai_metrics").insert({ profile_id: profile.id, request_id: body.requestId, model: config.model, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, latency_ms: Date.now() - start }); check(logged.error); },
    });
    await access(profile);
    const fresh = await readAcademicWorkspace(profile.id);
    if (fresh.revision !== context.revision || !await citationsCurrent(profile.id, result.citations)) fail("Your academic context changed during this answer. Please ask again.", 409);
    const built = result.operations.length ? buildProposal(context, result.operations) : null;
    const proposalId = built ? crypto.randomUUID() : null;
    const proposal = built ? { id: proposalId, revision: context.revision, profileRevision: profile.updated_at, snapshot: { courses: built.snapshot.courses.map(({ soft, ...c }) => ({ ...c, soft_color: soft })), dashboard: built.snapshot.dashboard }, preview: { changes: built.changes, warnings: built.warnings, timezone: built.timezone, courseLabels: Object.fromEntries(context.courses.map((c) => [c.id, `${c.code} · ${c.name}`])) } } : null;
    const output = { answer: result.answer, citations: result.citations, proposalId, revision: context.revision };
    const finished = await db.rpc("ai_finish_message", { p_profile_id: profile.id, p_id: body.requestId, p_result: output, p_proposal: proposal }); check(finished.error);
    return json({ id: body.requestId, status: "complete", result: output });
  } catch (error) {
    const response = aiFailure(error), failure = await response.clone().json() as { error: string };
    await db.from("ai_messages").update({ status: "failed", error: failure.error, finished_at: new Date().toISOString() }).eq("profile_id", profile.id).eq("id", body.requestId).eq("status", "running");
    return response;
  }
}
function aiFailure(error: unknown) {
  if (error instanceof AnswerValidationError) {
    console.warn("AI answer validation failed", { code: error.code });
    return json({ error: error.code === "invalid_format" ? "Gemini returned an incorrectly formatted answer. Please try again." : "Gemini returned an answer without verifiable sources. Please try again. No academic changes were made." }, 502);
  }
  if (error instanceof ProviderError) console.warn("AI provider request failed", { status: error.status, upstreamStatus: error.upstreamStatus, retryable: error.retryable });
  if (error instanceof AuthError || error instanceof PersistenceRequestError || error instanceof ProviderError) return json({ error: error.message }, error.status);
  if (error instanceof ZodError) return json({ error: "Invalid assistant request. Review the fields and try again." }, 400);
  const databaseError = error as { code?: string; message?: string };
  const code = databaseError?.code;
  if (code === "PT409" || code === "40001") return json({ error: "Your workspace or proposal changed. Refresh and request a new preview." }, 409);
  if (code === "P0001" && (databaseError.message?.startsWith("PRESERVE_COURSE_SYLLABUS:") || databaseError.message?.startsWith("PRESERVE_SYLLABUS_REPLACEMENT:"))) {
    return json({ error: "This proposal could not be applied because the course syllabus could not be preserved. Free file capacity, keep the course, or shorten its syllabus text before applying the proposal again. No academic changes were committed." }, 409);
  }
  if (code === "P0002" || code === "PGRST116") return json({ error: "This item is unavailable in your account." }, 404);
  if (code === "42P01" || code === "PGRST202" || code === "PGRST205") return json({ error: "AI database setup is not installed yet." }, 503);
  return json({ error: "The assistant could not verify a complete response. No academic changes were made. Try a narrower question." }, 503);
}
