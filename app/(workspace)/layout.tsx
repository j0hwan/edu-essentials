import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AuthError, requireProfile } from "../../lib/auth";
import EduEssentialsApp from "../workspace-client";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const profile = await requireProfile(false).catch((error) => {
    if (error instanceof AuthError) redirect("/login");
    redirect("/login?error=profile");
  });
  if (!profile.onboarding_completed_at) redirect("/onboarding");
  return <EduEssentialsApp initialProfile={profile}>{children}</EduEssentialsApp>;
}
