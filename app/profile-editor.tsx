"use client";
import { useState } from "react";
import { ArrowRight, Check, GraduationCap, UserRound } from "lucide-react";
import { validateProfile, type Profile, type ProfileDetails, type Preferences } from "../lib/profile";

export default function ProfileEditor({ initialProfile, onboarding = false, onSaved }: { initialProfile: Profile; onboarding?: boolean; onSaved?: (profile: Profile) => void }) {
  const [draft, setDraft] = useState(initialProfile);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const change = (key: keyof ProfileDetails, value: string | number | null) => setDraft((current) => ({ ...current, [key]: value }));
  const preference = (key: keyof Preferences, value: string | boolean) => setDraft((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  async function save(skip = false) {
    setMessage(""); setFailed(false);
    try {
      const source = skip ? { ...initialProfile, display_name: draft.display_name, last_name: draft.last_name } : draft;
      const details = validateProfile(source);
      setBusy(true);
      const response = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(details) });
      if (response.status === 401) { window.location.assign("/login?error=session"); return; }
      const data = await response.json() as { profile: Profile; error?: string };
      if (!response.ok) throw new Error(data.error || "Your profile could not be saved.");
      if (onboarding) { window.location.assign("/"); return; }
      setDraft(data.profile); onSaved?.(data.profile); setMessage("Your profile and preferences are saved.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const textField = (key: Exclude<keyof ProfileDetails, "age">, label: string, required = false) => <label>{label}{!required && <small>Optional</small>}<input required={required} maxLength={key === "study_goal" ? 500 : 160} value={draft[key]} onChange={(event) => change(key, event.target.value)} autoComplete={key === "display_name" ? "given-name" : key === "last_name" ? "family-name" : "off"} /></label>;
  const selectField = (key: Exclude<keyof ProfileDetails, "age">, label: string, options: string[]) => <label>{label}<small>Optional</small><select value={draft[key]} onChange={(event) => change(key, event.target.value)}><option value="">Skip for now</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
  return <form className="profile-editor" onSubmit={(event) => {
    event.preventDefault();
    if (onboarding && step === 0) { if (draft.display_name.trim()) { setStep(1); setMessage(""); } else { setFailed(true); setMessage("Please enter your name."); } }
    else void save();
  }}>
    {onboarding && <div className="profile-steps"><span className={step === 0 ? "active" : ""}>1 · Your name</span><span className={step === 1 ? "active" : ""}>2 · Make it yours</span></div>}
    <fieldset disabled={busy}>
      {(!onboarding || step === 0) && <section className="settings-card"><div className="settings-card-title"><span><UserRound size={20} /></span><div><h2>{onboarding ? "What should we call you?" : "Your profile"}</h2><p>{onboarding ? "We found this name on your Google account. You can edit it." : "Your Google account and personal details."}</p></div></div><label className="account-email">Google account<input value={initialProfile.email} readOnly type="email" /></label><div className="settings-form-grid">{textField("display_name", "Display name", true)}{textField("last_name", "Last name")}</div></section>}
      {(!onboarding || step === 1) && <><section className="settings-card"><div className="settings-card-title"><span><GraduationCap size={20} /></span><div><h2>School & study</h2><p>Everything here is optional. You can add it later in Settings.</p></div></div><div className="settings-form-grid">
        {textField("university", "College or university")}{textField("major", "Major")}{selectField("academic_year", "Academic year", ["Freshman", "Sophomore", "Junior", "Senior", "Graduate", "Other"])}<label>Age<small>Optional</small><input type="number" min="1" max="120" value={draft.age ?? ""} onChange={(event) => change("age", event.target.value === "" ? null : Number(event.target.value))} /></label>{textField("study_goal", "Study goal")}{textField("current_term", "Current term")}{selectField("academic_structure", "Academic structure", ["Quarter", "Semester", "Trimester", "Other"])}{selectField("gpa_system", "GPA system", ["4.0 scale", "Percentage", "Custom"])}{selectField("week_starts_on", "Week starts on", ["Monday", "Sunday"])}{textField("timezone", "Time zone (e.g. America/Los_Angeles)")}
      </div></section><section className="settings-card"><h2>Preferences</h2><label>Theme<select value={draft.preferences.theme} onChange={(event) => preference("theme", event.target.value)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Match my device</option></select></label>
        {([["deadlineReminders", "Deadline reminders"], ["dailyStudyPlan", "Daily study plan"], ["streakNudges", "Study streak nudges"], ["reducedMotion", "Reduce motion"], ["highContrast", "High-contrast status labels"]] as const).map(([key, label]) => <label className="profile-toggle" key={key}><span>{label}</span><input type="checkbox" checked={draft.preferences[key]} onChange={(event) => preference(key, event.target.checked)} /></label>)}<p className="form-hint">Notification preferences are saved for when reminders are available.</p>
      </section></>}
    </fieldset>
    {message && <p className={failed ? "auth-error" : "profile-success"} role={failed ? "alert" : "status"}>{message}</p>}
    <div className="profile-actions">{onboarding && step === 1 && <><button type="button" className="secondary-button" disabled={busy} onClick={() => setStep(0)}>Back</button><button type="button" className="skip-details" disabled={busy} onClick={() => void save(true)}>Skip optional details</button></>}<button className="primary-button" disabled={busy}>{busy ? "Saving…" : onboarding ? step === 0 ? "Continue" : "Open my workspace" : "Save changes"}{onboarding ? <ArrowRight size={16} /> : <Check size={16} />}</button></div>
  </form>;
}
