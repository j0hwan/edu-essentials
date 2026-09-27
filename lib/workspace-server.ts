import type { Course } from "./academics";
import { getSupabaseAdmin } from "./supabase-server";

/** One committed revision across courses and the dashboard. Shared with AI reads. */
export async function readAcademicWorkspace(profileId: string) {
  const db = getSupabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt++) {
    const dashboard = await db.from("dashboard_state").select("payload,updated_at").eq("profile_id", profileId).single();
    if (dashboard.error) throw dashboard.error;
    const courses = await db.from("courses").select("id,code,name,credits,instructor,room,color,soft_color,initials").eq("profile_id", profileId).order("id");
    if (courses.error) throw courses.error;
    const check = await db.from("dashboard_state").select("updated_at").eq("profile_id", profileId).single();
    if (check.error) throw check.error;
    if (check.data.updated_at === dashboard.data.updated_at) return {
      courses: courses.data.map(({ soft_color, ...c }) => ({ ...c, soft: soft_color })) as Course[],
      dashboard: dashboard.data.payload,
      revision: dashboard.data.updated_at as string,
    };
  }
  throw new Error("Workspace changed during loading. Retry shortly.");
}
