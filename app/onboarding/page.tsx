import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { AuthError, requireProfile } from "../../lib/auth";
import ProfileEditor from "../profile-editor";
import "../auth.css";
export const dynamic = "force-dynamic";
export default async function Onboarding() {
  const profile = await requireProfile(false).catch((error) => {
    if (error instanceof AuthError) redirect("/login");
    redirect("/login?error=profile");
  });
  if (profile.onboarding_completed_at) redirect("/home");
  return <main className="auth-shell onboarding-page"><header className="auth-header"><span className="auth-brand"><span className="brand-mark"><BookOpen size={21} /></span>EduEssentials</span><form action="/auth/signout" method="post"><button className="secondary-button">Sign out</button></form></header><div className="onboarding-content"><p className="auth-kicker">WELCOME TO YOUR WORKSPACE</p><h1>Let’s make it yours.</h1><ProfileEditor initialProfile={profile} onboarding /></div></main>;
}
