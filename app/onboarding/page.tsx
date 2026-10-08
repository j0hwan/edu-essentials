import { redirect } from "next/navigation";
import { AuthError, requireProfile } from "../../lib/auth";
import OnboardingFlow from "../onboarding-flow";
export const dynamic = "force-dynamic";
export default async function Onboarding() {
  const profile = await requireProfile(false).catch((error) => {
    if (error instanceof AuthError) redirect("/login");
    redirect("/login?error=profile");
  });
  if (profile.onboarding_completed_at) redirect("/home");
  return <OnboardingFlow initialProfile={profile} />;
}
