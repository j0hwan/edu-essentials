import { decodeWorkspaceState } from "../workspace-codec";
import type { AcademicContext } from "./academic-tools";
import type { Citation } from "./contracts";
import { getSupabaseAdmin } from "../supabase-server";
import { aiConfig } from "./config";
import { embedText } from "./provider";
import { chunkPages } from "./chunks";

export async function searchAcademicDocuments(profileId: string, context: AcademicContext, query: string, courseId: string | undefined, reserve: (tokens: number, usd: number) => Promise<void>) {
  const db = getSupabaseAdmin(), config = aiConfig();
  let status = "hybrid", embedding: number[] | null = null;
  try { await reserve(1000, 0.0002); embedding = await embedText(config.apiKey, config.embeddingModel, query, true); } catch { status = "keyword-only: semantic retrieval unavailable"; }
  let rows = embedding ? await db.rpc("ai_hybrid_search", { p_profile_id: profileId, p_query: query, p_embedding: JSON.stringify(embedding), p_model: config.embeddingModel, p_course_id: courseId ?? null }) : await db.rpc("ai_keyword_search", { p_profile_id: profileId, p_query: query, p_course_id: courseId ?? null });
  if (rows.error && embedding) { status = "keyword-only: semantic retrieval unavailable"; rows = await db.rpc("ai_keyword_search", { p_profile_id: profileId, p_query: query, p_course_id: courseId ?? null }); }
  if (rows.error) throw rows.error;
  const citations: Citation[] = (rows.data ?? []).map((r: { source_id: string; version: string; ordinal: number; page: number; label: string; body: string }) => ({ id: `document:${r.source_id}:${r.ordinal}`, kind: "document", sourceId: r.source_id, version: r.version, page: r.page, label: `${r.label} · page/section ${r.page}`, text: r.body }));
  // Fresh notes are searchable immediately, even before their background index is ready.
  const decoded = decodeWorkspaceState(context.dashboard);
  const notes = [
    ...decoded.workspaces.flatMap((w) => w.widgets.filter((n) => n.type === "notes").map((n) => ({ id: `note:${n.instanceId}`, label: `Note in ${w.name}`, body: n.note ?? "", course: undefined as string | undefined }))),
    { id: "legacy-note", label: "Legacy notes", body: decoded.notes, course: undefined as string | undefined },
    ...Object.entries(decoded.data?.courseDetails ?? {}).map(([id, d]) => ({ id: `syllabus:${id}`, label: d.syllabusName || "Pasted syllabus", body: d.syllabusText ?? "", course: id })),
  ];
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const excluded = await db.from("ai_sources").select("source_key").eq("profile_id", profileId).eq("enabled", false);
  if (excluded.error) throw excluded.error;
  const excludedKeys = new Set((excluded.data ?? []).map((s) => s.source_key));
  const fresh = notes.filter((n) => !excludedKeys.has(n.id) && (courseId === undefined || n.course === courseId)).flatMap((n) => chunkPages([n.body]).map((chunk) => ({ ...n, ...chunk, score: words.reduce((s, word) => s + (chunk.body.toLowerCase().includes(word) ? 1 : 0), 0) }))).filter((n) => n.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  for (const n of fresh) citations.unshift({ id: `record:${n.id}:${n.ordinal}`, kind: "record", recordId: n.id, version: context.revision, label: n.label, text: n.body });
  const pending = await db.from("ai_sources").select("id", { count: "exact", head: true })
    .eq("profile_id", profileId).eq("enabled", true).eq("file_available", true).neq("state", "ready");
  return { citations: citations.slice(0, 8), status: `${status}; ${pending.count ?? 0} sources are not indexed. Absence of a search result does not prove a fact is absent.` };
}
