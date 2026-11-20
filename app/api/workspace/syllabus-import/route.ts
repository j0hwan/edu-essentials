import { academicSnapshot } from "../../../../lib/academic-snapshot";
import { validateCourse, validateCourseDetails } from "../../../../lib/academics";
import { apiError, AuthError, requireProfile, requireSameOrigin } from "../../../../lib/auth";
import { mergeCourseworkAssignments } from "../../../../lib/coursework";
import { isFileId } from "../../../../lib/files";
import { readPersistenceJson, PersistenceRequestError, requireAccountScope } from "../../../../lib/persistence-request";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { decodeWorkspaceState, encodeWorkspaceState, type SavedAssignment } from "../../../../lib/workspace-codec";
import { readAcademicWorkspace } from "../../../../lib/workspace-server";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const normalizedCode = (value: string) => value.normalize("NFKC").replace(/[\s-]+/g, "").toLowerCase();

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const profile = await requireProfile();
    requireAccountScope(request, profile.id);
    if (!profile.initialized) throw new PersistenceRequestError("Load your saved workspace before importing a class.", 409);
    return await importSyllabus(profile, await readPersistenceJson(request, 1_048_576));
  } catch (error) {
    if (error instanceof AuthError) return apiError(error);
    if (error instanceof PersistenceRequestError) return json({ error: error.message }, error.status);
    const databaseError = error as { code?: string; message?: string };
    if (databaseError?.code === "23503" && databaseError.message === "Unknown syllabus file") {
      return json({ error: "The original PDF became unavailable. Retry to upload it again.", code: "syllabus-source-unavailable" }, 409);
    }
    if (["23503", "23514", "22023", "23505"].includes(databaseError?.code ?? "")) return json({ error: "The class or coursework is inconsistent. Review the draft and retry." }, 400);
    return json({ error: "The import could not be saved. Your review is still here; please retry." }, 503);
  }
}

async function importSyllabus(profile: Awaited<ReturnType<typeof requireProfile>>, body: Record<string, unknown>) {
  let course, details;
  try { course = validateCourse(body.course); details = validateCourseDetails(body.details); }
  catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Review the imported class."); }
  const fileId = details.syllabusFileId;
  if (!isFileId(course.id) || !fileId || !Array.isArray(body.assignments) || body.assignments.length > 200 || typeof body.allowDuplicate !== "boolean") {
    throw new PersistenceRequestError("The import needs a class, its original PDF, and up to 200 tasks.");
  }
  const db = getSupabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readAcademicWorkspace(profile.id);
    const { workspaces, activeWorkspaceId, notes, data } = decodeWorkspaceState(current.dashboard);
    if (!data) throw new PersistenceRequestError("Reload your saved workspace before importing a class.", 409);
    if (current.courses.some((existing) => existing.id === course.id)) {
      if (data.courseDetails?.[course.id]?.syllabusFileId === fileId) return json({ ok: true, revision: current.revision, alreadySaved: true });
      throw new PersistenceRequestError("This class changed after it was created. Open it in the workspace to review the saved version.", 409);
    }
    if (!body.allowDuplicate && current.courses.some((existing) => normalizedCode(existing.code) === normalizedCode(course.code))) {
      return json({ error: `A class with code ${course.code} already exists.`, code: "duplicate-class" }, 409);
    }
    const source = await db.from("user_files").select("kind,state,mime_type,course_id,assignment_id,trashed_at,deleted_at")
      .eq("profile_id", profile.id).eq("id", fileId).maybeSingle();
    if (source.error) throw source.error;
    const file = source.data;
    if (!file || file.kind !== "syllabus" || file.state !== "ready" || file.mime_type !== "application/pdf" || file.trashed_at || file.deleted_at || file.course_id || file.assignment_id) {
      return json({ error: "The staged PDF became unavailable. Retry to upload your original PDF again.", code: "syllabus-source-unavailable" }, 409);
    }
    let assignments: SavedAssignment[];
    try { assignments = mergeCourseworkAssignments(data.assignments, course.id, body.assignments as SavedAssignment[]); }
    catch (error) { throw new PersistenceRequestError(error instanceof Error ? error.message : "Review the imported tasks."); }
    let next;
    try {
      next = academicSnapshot([...current.courses, course], encodeWorkspaceState(workspaces, activeWorkspaceId, notes, {
        ...data, assignments, courseDetails: { ...data.courseDetails, [course.id]: details },
      }));
    } catch (error) {
      throw new PersistenceRequestError(error instanceof Error ? error.message : "Review the imported class and tasks.");
    }
    const { data: revision, error } = await db.rpc("save_account_workspace", {
      p_profile_id: profile.id, p_auth_user_id: profile.auth_user_id, p_expected_revision: current.revision,
      p_courses: next.courses.map(({ soft, ...saved }) => ({ ...saved, soft_color: soft })), p_dashboard: next.dashboard,
    });
    if (!error) return json({ ok: true, revision }, 201);
    if (error.code !== "PT409" && error.code !== "40001") throw error;
  }
  throw new PersistenceRequestError("Your workspace is changing in another session. Your import is still here. Retry when the other changes finish.", 409);
}
