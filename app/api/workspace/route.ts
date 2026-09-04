import { decodeWorkspaceState, type CompactWorkspaceState } from "../../../lib/workspace-codec";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const PROFILE_COOKIE = "eduessentials_profile";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const session = anonymousSession(request);

  try {
    const supabase = getSupabaseAdmin();
    const profile = await getOrCreateProfile(supabase, session.profileId);

    if (!profile.initialized) {
      return jsonWithSession({ initialized: false }, session);
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
      session,
    );
  } catch (error) {
    return workspaceError(error, session);
  }
}

export async function POST(request: Request) {
  const session = anonymousSession(request);

  try {
    const body = await readJson(request);
    const action = typeof body.action === "string" ? body.action : "";
    const supabase = getSupabaseAdmin();
    await getOrCreateProfile(supabase, session.profileId);

    if (action === "initialize") {
      if (!Array.isArray(body.courses)) throw new RequestError("courses must be an array");
      const courses = body.courses.map(validateCourse);
      if (courses.length > 100) throw new RequestError("Too many courses");
      const dashboard = validateDashboard(body.dashboard);

      if (courses.length) {
        const { error } = await supabase.from("courses").upsert(
          courses.map((course) => courseToRow(course, session.profileId)),
          { onConflict: "profile_id,id" },
        );
        if (error) throw error;
      }

      const { error: dashboardError } = await supabase.from("dashboard_state").upsert(
        { profile_id: session.profileId, payload: dashboard, updated_at: new Date().toISOString() },
        { onConflict: "profile_id" },
      );
      if (dashboardError) throw dashboardError;

      const { error: profileError } = await supabase
        .from("app_profiles")
        .update({ initialized: true, updated_at: new Date().toISOString() })
        .eq("id", session.profileId);
      if (profileError) throw profileError;

      return jsonWithSession({ ok: true }, session, 201);
    }

    if (action === "create-course") {
      const course = validateCourse(body.course);
      const { data, error } = await supabase
        .from("courses")
        .insert(courseToRow(course, session.profileId))
        .select("id,code,name,credits,instructor,room,color,soft_color,initials")
        .single();
      if (error) throw error;
      return jsonWithSession({ course: courseFromRow(data as CourseRow) }, session, 201);
    }

    throw new RequestError("Unknown action");
  } catch (error) {
    return workspaceError(error, session);
  }
}

export async function PUT(request: Request) {
  const session = anonymousSession(request);

  try {
    const body = await readJson(request);
    const dashboard = validateDashboard(body.dashboard);
    const supabase = getSupabaseAdmin();
    await getOrCreateProfile(supabase, session.profileId);

    const { error } = await supabase.from("dashboard_state").upsert(
      { profile_id: session.profileId, payload: dashboard, updated_at: new Date().toISOString() },
      { onConflict: "profile_id" },
    );
    if (error) throw error;

    return jsonWithSession({ ok: true }, session);
  } catch (error) {
    return workspaceError(error, session);
  }
}

export async function DELETE(request: Request) {
  const session = anonymousSession(request);

  try {
    const id = new URL(request.url).searchParams.get("courseId") ?? "";
    if (!id || id.length > 120) throw new RequestError("Invalid course ID");

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("profile_id", session.profileId)
      .eq("id", id);
    if (error) throw error;

    return jsonWithSession({ ok: true }, session);
  } catch (error) {
    return workspaceError(error, session);
  }
}

async function getOrCreateProfile(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profileId: string,
): Promise<{ initialized: boolean }> {
  const { data, error } = await supabase
    .from("app_profiles")
    .select("initialized")
    .eq("id", profileId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data as { initialized: boolean };

  const { data: created, error: createError } = await supabase
    .from("app_profiles")
    .insert({ id: profileId })
    .select("initialized")
    .single();

  if (createError) {
    // Two simultaneous first-load requests may race to create the same profile.
    if (createError.code === "23505") return getOrCreateProfile(supabase, profileId);
    throw createError;
  }

  return created as { initialized: boolean };
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
  decodeWorkspaceState(value);
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

function anonymousSession(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const existing = cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === PROFILE_COOKIE)?.[1];

  if (existing && UUID_PATTERN.test(existing)) {
    return { profileId: existing, setCookie: false, secure: new URL(request.url).protocol === "https:" };
  }

  return { profileId: crypto.randomUUID(), setCookie: true, secure: new URL(request.url).protocol === "https:" };
}

function jsonWithSession(
  body: unknown,
  session: ReturnType<typeof anonymousSession>,
  status = 200,
) {
  const headers = new Headers({ "cache-control": "no-store" });
  if (session.setCookie) {
    headers.set(
      "set-cookie",
      `${PROFILE_COOKIE}=${session.profileId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${session.secure ? "; Secure" : ""}`,
    );
  }
  return Response.json(body, { status, headers });
}

function workspaceError(error: unknown, session: ReturnType<typeof anonymousSession>) {
  if (error instanceof RequestError) {
    return jsonWithSession({ error: error.message }, session, 400);
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
    session,
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
