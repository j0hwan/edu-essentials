import { apiError, AuthError, requireProfile, requireSameOrigin } from "../../../lib/auth";
import { academicSnapshot } from "../../../lib/academic-snapshot";
import type { Course } from "../../../lib/academics";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { readPersistenceJson, PersistenceRequestError, requireSaveRevision, saveConflict, requireAccountScope } from "../../../lib/persistence-request";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const upgrade = () => json({ error: "Reload the updated app before saving. Download your pending edits first." }, 426);
type CourseRow = Omit<Course, "soft"> & { soft_color: string };
const fromRow = ({ soft_color, ...course }: CourseRow): Course => ({ ...course, soft: soft_color });
const toRow = ({ soft, ...course }: Course) => ({ ...course, soft_color: soft });
export async function GET(request: Request) {
  try {
    const profile = await requireProfile(); requireAccountScope(request, profile.id);
    if (!profile.initialized) return json({ initialized: false });
    const db = getSupabaseAdmin();
    // Read around the class query to avoid combining two committed revisions.
    for (let attempt = 0; attempt < 3; attempt++) {
      const dashboard = await db.from("dashboard_state").select("payload,updated_at").eq("profile_id", profile.id).maybeSingle();
      if (dashboard.error) throw dashboard.error;
      const courses = await db.from("courses").select("id,code,name,credits,instructor,room,color,soft_color,initials").eq("profile_id", profile.id).order("id", { ascending: true });
      if (courses.error) throw courses.error;
      const check = await db.from("dashboard_state").select("updated_at").eq("profile_id", profile.id).maybeSingle();
      if (check.error) throw check.error;
      if (check.data?.updated_at === dashboard.data?.updated_at) return json({ initialized: true, profile, courses: (courses.data as CourseRow[]).map(fromRow), dashboard: dashboard.data?.payload ?? null, revision: dashboard.data?.updated_at ?? null });
    }
    return json({ error: "Your workspace is being updated in another session. Retry loading." }, 503);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const profile = await requireProfile(); requireAccountScope(request, profile.id);
    const body = await readPersistenceJson(request, 1_048_576);
    if (body.action !== "initialize") return upgrade();
    if (profile.initialized) return json({ ok: true }, 201);
    const snapshot = validate(body.courses, body.dashboard);
    const { error } = await getSupabaseAdmin().rpc("initialize_account_workspace", { p_profile_id: profile.id, p_courses: snapshot.courses.map((c) => ({ ...toRow(c), profile_id: profile.id })), p_dashboard: snapshot.dashboard });
    if (error) throw error;
    return json({ ok: true }, 201);
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    requireSameOrigin(request); const profile = await requireProfile(); requireAccountScope(request, profile.id);
    const body = await readPersistenceJson(request, 1_048_576);
    const revision = requireSaveRevision(body.baseRevision);
    if (body.courses === undefined) return upgrade();
    const snapshot = validate(body.courses, body.dashboard);
    const incoming = body.dashboard as { v?: number; b?: unknown; h?: unknown; ts?: unknown; rp?: unknown; d?: { study?: unknown; filePreferences?: unknown; widgetAppearance?: unknown } };
    if (incoming?.v === 1 || incoming?.b === undefined || incoming?.h === undefined || incoming?.ts === undefined || incoming?.rp === undefined || incoming?.d?.study === undefined || incoming?.d?.filePreferences === undefined || incoming?.d?.widgetAppearance === undefined) {
      const current = await getSupabaseAdmin().from("dashboard_state").select("payload").eq("profile_id", profile.id).maybeSingle();
      if (current.error) throw current.error;
      if (incoming?.v === 1 && current.data?.payload?.v === 2) return upgrade();
      if (incoming?.b === undefined && current.data?.payload?.b?.length > 0) return upgrade();
      if (incoming?.h === undefined && current.data?.payload?.h?.length > 0) return upgrade();
      if (incoming?.ts === undefined && current.data?.payload?.ts?.length > 0) return upgrade();
      if (incoming?.rp === undefined && current.data?.payload?.rp?.length > 0) return upgrade();
      if (incoming?.d?.study === undefined && current.data?.payload?.d?.study !== undefined) return upgrade();
      if (incoming?.d?.filePreferences === undefined && current.data?.payload?.d?.filePreferences !== undefined) return upgrade();
      if (incoming?.d?.widgetAppearance === undefined && current.data?.payload?.d?.widgetAppearance !== undefined) return upgrade();
    }
    const { data, error } = await getSupabaseAdmin().rpc("save_account_workspace", { p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id, p_expected_revision: revision, p_courses: snapshot.courses.map(toRow), p_dashboard: snapshot.dashboard });
    if (error) throw error;
    return json({ ok: true, revision: data });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try { requireSameOrigin(request); const profile = await requireProfile(); requireAccountScope(request, profile.id); return upgrade(); }
  catch (error) { return failure(error); }
}
function validate(courses: unknown, dashboard: unknown) {
  try { return academicSnapshot(courses, dashboard); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Invalid academic data."); }
}
function failure(error: unknown) {
  if (error instanceof AuthError) return apiError(error);
  if (error instanceof PersistenceRequestError) return json({ error: error.message }, error.status);
  const databaseError = error as { code?: string; message?: string };
  const code = databaseError?.code;
  if (code === "PT409" || code === "40001") return saveConflict();
  if (code === "P0001" && databaseError.message?.startsWith("PRESERVE_SYLLABUS_REPLACEMENT:")) {
    return json({ error: "This change could not be saved because the previous syllabus could not be preserved. Restore its course folder if it is in Trash, free file capacity, or shorten the syllabus text, then retry. Your workspace draft has been kept.", code: "syllabus-preservation" }, 409);
  }
  if (code === "P0001" && databaseError.message?.startsWith("PRESERVE_COURSE_SYLLABUS:")) {
    return json({ error: "This course could not be deleted because its syllabus could not be preserved. Free file capacity, keep the course, or shorten its syllabus text before deleting. Your workspace draft has been kept.", code: "syllabus-preservation" }, 409);
  }
  if (code === "23503" || code === "23514" || code === "22023") return json({ error: "The class or assignment data is inconsistent. Review your changes before retrying." }, 400);
  return json({ error: "Workspace persistence is temporarily unavailable. Your edits have been kept; please retry." }, 503);
}
