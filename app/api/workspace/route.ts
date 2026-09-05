import { apiError, AuthError, requireProfile, requireSameOrigin } from "../../../lib/auth";
import { decodeWorkspaceState, type CompactWorkspaceState } from "../../../lib/workspace-codec";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";


type CourseInput = {
  id: string;
  code: string;
  name: string;
  credits: number;
  instructor: string;
  room: string;
  color: string;
  soft: string;
  initials: string;
};

type CourseRow = {
  id: string;
  code: string;
  name: string;
  credits: number;
  instructor: string;
  room: string;
  color: string;
  soft_color: string;
  initials: string;
};

export async function GET(request: Request) {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    const profile = await requireProfile();
    const session = { profileId: profile.id };
    const supabase = getSupabaseAdmin();


    if (!profile.initialized) {
      return jsonWithSession({ initialized: false });
    }

    const [coursesResult, dashboardResult] = await Promise.all([
      supabase
        .from("courses")
        .select("id,code,name,credits,instructor,room,color,soft_color,initials")
        .eq("profile_id", session.profileId)
        .order("created_at", { ascending: true }),
      supabase
        .from("dashboard_state")
        .select("payload")
        .eq("profile_id", session.profileId)
        .maybeSingle(),
    ]);

    if (coursesResult.error) throw coursesResult.error;
    if (dashboardResult.error) throw dashboardResult.error;

    return jsonWithSession(
      {
        initialized: true,
        courses: (coursesResult.data as CourseRow[]).map(courseFromRow),
        dashboard: dashboardResult.data?.payload ?? null,
      },
    );
  } catch (error) {
    return workspaceError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    const profile = await requireProfile();
    const session = { profileId: profile.id };
    const body = await readJson(request);
    const action = typeof body.action === "string" ? body.action : "";
    const supabase = getSupabaseAdmin();

    if (action === "initialize") {
      if (!Array.isArray(body.courses)) throw new RequestError("courses must be an array");
      const courses = body.courses.map(validateCourse);
      if (courses.length > 100) throw new RequestError("Too many courses");
      const dashboard = validateDashboard(body.dashboard);

      const { error } = await supabase.rpc("initialize_account_workspace", {
        p_profile_id: profile.id,
        p_courses: courses.map((course) => courseToRow(course, profile.id)),
        p_dashboard: dashboard,
      });
      if (error) throw error;

      return jsonWithSession({ ok: true }, 201);
    }

    if (action === "create-course") {
      const course = validateCourse(body.course);
      const { data, error } = await supabase
        .from("courses")
        .insert(courseToRow(course, session.profileId))
        .select("id,code,name,credits,instructor,room,color,soft_color,initials")
        .single();
      if (error) throw error;
      return jsonWithSession({ course: courseFromRow(data as CourseRow) }, 201);
    }

    throw new RequestError("Unknown action");
  } catch (error) {
    return workspaceError(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    const profile = await requireProfile();
    const session = { profileId: profile.id };
    const body = await readJson(request);
    const dashboard = validateDashboard(body.dashboard);
    const supabase = getSupabaseAdmin();

    const { error } = await supabase.from("dashboard_state").upsert(
      { profile_id: session.profileId, payload: dashboard, updated_at: new Date().toISOString() },
      { onConflict: "profile_id" },
    );
    if (error) throw error;

    return jsonWithSession({ ok: true });
  } catch (error) {
    return workspaceError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    const profile = await requireProfile();
    const session = { profileId: profile.id };
    const id = new URL(request.url).searchParams.get("courseId") ?? "";
    if (!id || id.length > 120) throw new RequestError("Invalid course ID");

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("profile_id", session.profileId)
      .eq("id", id);
    if (error) throw error;

    return jsonWithSession({ ok: true });
  } catch (error) {
    return workspaceError(error);
  }
}

function validateCourse(value: unknown): CourseInput {
  if (!isRecord(value)) throw new RequestError("Invalid course");

  const course: CourseInput = {
    id: boundedString(value.id, "course ID", 120),
    code: boundedString(value.code, "course code", 30),
    name: boundedString(value.name, "course name", 160),
    credits: Number(value.credits),
    instructor: boundedString(value.instructor, "instructor", 160),
    room: boundedString(value.room, "room", 160),
    color: boundedString(value.color, "color", 20),
    soft: boundedString(value.soft, "soft color", 20),
    initials: boundedString(value.initials, "initials", 8),
  };

  if (!Number.isInteger(course.credits) || course.credits < 0 || course.credits > 30) {
    throw new RequestError("Invalid course credits");
  }
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(course.color) || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(course.soft)) {
    throw new RequestError("Invalid course color");
  }

  return course;
}

function validateDashboard(value: unknown): CompactWorkspaceState {
  // Decode performs all bounds, tuple, widget-code, and version validation.
  try { decodeWorkspaceState(value); } catch (error) { throw new RequestError(error instanceof Error ? error.message : "Invalid dashboard"); }
  return value as CompactWorkspaceState;
}

function courseToRow(course: CourseInput, profileId: string) {
  return {
    profile_id: profileId,
    id: course.id,
    code: course.code,
    name: course.name,
    credits: course.credits,
    instructor: course.instructor,
    room: course.room,
    color: course.color,
    soft_color: course.soft,
    initials: course.initials,
  };
}

function courseFromRow(course: CourseRow): CourseInput {
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    credits: course.credits,
    instructor: course.instructor,
    room: course.room,
    color: course.color,
    soft: course.soft_color,
    initials: course.initials,
  };
}

function jsonWithSession(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function workspaceError(error: unknown) {
  if (error instanceof AuthError) return apiError(error);
  if (error instanceof RequestError) {
    return jsonWithSession({ error: error.message }, 400);
  }

  const details = errorDetails(error);
  const setupRequired = /app_profiles|courses|dashboard_state|schema cache|does not exist/i.test(details);
  console.error("Workspace persistence error:", details);
  return jsonWithSession(
    {
      error: setupRequired
        ? "Supabase tables are not installed. Apply the migration in supabase/migrations first."
        : "Workspace persistence is temporarily unavailable.",
      setupRequired,
    },
    setupRequired ? 503 : 500,
  );
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!isRecord(error)) return String(error);

  return [error.code, error.message, error.details, error.hint]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError("Invalid JSON body");
  }
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new RequestError(`Invalid ${label}`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class RequestError extends Error {}
