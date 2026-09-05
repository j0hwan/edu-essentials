import { BookOpen, ArrowUpRight, LayoutGrid, ShieldCheck } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient, ensureProfile } from "../../lib/auth";
import { isGoogleUser } from "../../lib/auth-policy";
import "../auth.css";
export const dynamic = "force-dynamic";
const messages: Record<string, string> = {
  callback: "Sign-in was cancelled or the link expired. Please try again.",
  session: "Your session has ended. Sign in again to continue.",
  unavailable: "Google sign-in is temporarily unavailable. Please try again shortly.",
  profile: "We couldn’t finish setting up your account. Please try signing in again.",
};
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  let destination: string | null = null;
  if (!params.error && (await cookies()).getAll().some(({ name }) => name.includes("auth-token"))) {
    try {
      const auth = await createAuthClient();
      const { data: { user } } = await auth.auth.getUser();
      if (user && isGoogleUser(user)) destination = (await ensureProfile(user)).onboarding_completed_at ? "/" : "/onboarding";
    } catch { /* The public login page remains available during outages. */ }
  }
  if (destination) redirect(destination);
  return <main className="auth-shell">
    <header className="auth-header"><a className="auth-brand" href="/login"><span className="brand-mark"><BookOpen size={21} /></span>EduEssentials</a><a className="auth-overview" href="/overview">App overview <ArrowUpRight size={16} /></a></header>
    <div className="auth-layout">
      <section className="auth-intro"><span className="auth-kicker">YOUR STUDENT WORKSPACE</span><h1>A little more focus.<br /><span>A lot less juggling.</span></h1><p>Your classes, plans, and study tools.<br />Together in a workspace that feels like yours.</p><div className="auth-feature"><LayoutGrid size={22} /><span>Pick your widgets.<br /><strong>Make room for what matters.</strong></span></div></section>
      <section className="auth-card" aria-labelledby="login-title"><span className="auth-card-icon"><BookOpen size={25} /></span><h2 id="login-title">Welcome to EduEssentials</h2><p>Sign in or create your account with Google.</p>
        {params.error && <div className="auth-error" role="alert">{messages[params.error] ?? messages.callback}</div>}
        <form action="/auth/google" method="post" target="_top"><button className="google-button" type="submit"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.6-4.13H3.05v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.92A6 6 0 0 1 6.09 12c0-.67.11-1.32.31-1.92V7.49H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.51l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.88-2.88A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.35 2.59C7.2 7.71 9.4 5.95 12 5.95Z"/></svg>Continue with Google</button></form>
        <div className="auth-divider" /><div className="auth-security"><ShieldCheck size={20} /><p>Your password stays with Google. We use your name, email, and profile photo to set up your account.</p></div><p className="auth-footnote">New here? You’ll personalize your profile next.</p>
      </section>
    </div><footer className="auth-footer">College, organized around you.</footer>
  </main>;
}
