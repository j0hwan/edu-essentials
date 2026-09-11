"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, GraduationCap, MapPin, SlidersHorizontal, UserRound } from "lucide-react";
import { editableProfile, validateProfile, type Profile, type ProfileDetails, type Preferences } from "../lib/profile";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
import { usePreferences } from "./use-preferences";

const UNIVERSITY_SUGGESTIONS = [
  "California State University",
  "Community college",
  "New York University",
  "Stanford University",
  "University of California, Berkeley",
  "University of California, Los Angeles",
  "University of Southern California",
];

const MAJOR_SUGGESTIONS = [
  "Accounting",
  "Biology",
  "Business Administration",
  "Chemistry",
  "Computer Science",
  "Economics",
  "Education",
  "Engineering",
  "English",
  "Finance",
  "History",
  "Mathematics",
  "Nursing",
  "Political Science",
  "Psychology",
  "Sociology",
];

const TERM_SUGGESTIONS = ["Fall term", "Winter term", "Spring term", "Summer term"];
const TIMEZONE_SUGGESTIONS = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

type TextProfileKey = Exclude<keyof ProfileDetails, "age">;

export default function ProfileEditor({ initialProfile, onboarding = false, onSaved, onDraftChange }: { initialProfile: Profile; onboarding?: boolean; onSaved?: (profile: Profile) => void; onDraftChange?: (draft: Profile, pending: boolean, busy: boolean) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialProfile);
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const automaticTimezone = "your device time zone";
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [failureKind, setFailureKind] = useState<"error" | "conflict" | "session" | null>(null);
  const [lastSkip, setLastSkip] = useState(false);
  const busyRef = useRef(false);
  const dirty = JSON.stringify(editableProfile(draft)) !== JSON.stringify(editableProfile(savedProfile));

  useSaveProtection(!openingWorkspace && (dirty || busy || failureKind !== null));
  usePreferences(savedProfile.preferences);

  useEffect(() => {
    onDraftChange?.(draft, dirty || busy || failureKind !== null, busy);
  }, [draft, dirty, busy, failureKind, onDraftChange]);

  const edited = () => {
    if (!failureKind) {
      setMessage("");
      setFailed(false);
    }
  };
  const change = (key: keyof ProfileDetails, value: string | number | null) => {
    edited();
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const preference = (key: keyof Preferences, value: string | boolean) => {
    edited();
    setDraft((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  };
  function accept(profile: Profile) {
    setSavedProfile(profile);
    setDraft(profile);
    onSaved?.(profile);
    setFailureKind(null);
    setFailed(false);
  }
  function openWorkspace() {
    setOpeningWorkspace(true);
    setMessage("You’re all set. Opening your workspace…");
    router.replace("/home");
    window.setTimeout(() => {
      if (window.location.pathname === "/onboarding") window.location.replace("/home");
    }, 1_200);
  }
  async function reloadSaved() {
    if (busyRef.current || !window.confirm("Replace this settings draft with the latest saved settings? Download your draft first if you want to keep a copy.")) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/profile", { cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { "x-profile-id": initialProfile.id } });
      if (response.status === 401) {
        setFailureKind("session");
        throw new Error("Sign in to the same account in a new tab, then retry. Your draft is still here.");
      }
      const data = await response.json() as { profile: Profile; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load saved settings.");
      if (data.profile.id !== initialProfile.id) throw new Error("The signed-in account changed. Reload this page before editing that account.");
      accept(data.profile);
      setMessage("Latest saved settings loaded.");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Unable to load saved settings.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function save(skip = false) {
    if (busyRef.current || failureKind === "conflict") return;
    setLastSkip(skip);
    setMessage("");
    setFailed(false);
    try {
      const source = skip ? { ...savedProfile, display_name: draft.display_name, last_name: draft.last_name } : draft;
      const details = validateProfile(source);
      busyRef.current = true;
      setBusy(true);
      const response = await fetch("/api/profile", {
        method: "PUT",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "x-profile-id": initialProfile.id },
        body: JSON.stringify({ ...details, baseRevision: savedProfile.updated_at }),
      });
      if (response.status === 401) {
        setFailureKind("session");
        throw new Error("Your session ended or the account changed. Sign in to the same account in a new tab, then retry. Your draft is still here.");
      }
      if (response.status === 409) {
        setFailureKind("conflict");
        throw new Error("Settings changed in another session. Download your draft before loading the latest saved settings.");
      }
      const data = await response.json() as { profile: Profile; error?: string };
      if (!response.ok) {
        setFailureKind("error");
        throw new Error(data.error || "Your profile could not be saved.");
      }
      if (data.profile.id !== initialProfile.id) throw new Error("The saved account did not match. Your draft has been kept.");
      accept(data.profile);
      if (onboarding) openWorkspace();
      else setMessage("Your profile and preferences are saved.");
    } catch (error) {
      if (busyRef.current) setFailureKind((kind) => kind ?? "error");
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const textField = (key: TextProfileKey, label: string, { required = false, suggestions = [], placeholder = "", hint = "", wide = false }: { required?: boolean; suggestions?: string[]; placeholder?: string; hint?: string; wide?: boolean } = {}) => {
    const listId = suggestions.length ? `profile-${key}-options` : undefined;
    return <label className={wide ? "field-wide" : undefined}>
      <span className="field-heading">{label}{!required && <small>Optional</small>}</span>
      <input
        required={required}
        maxLength={key === "study_goal" ? 500 : 160}
        value={draft[key]}
        onChange={(event) => change(key, event.target.value)}
        autoComplete={key === "display_name" ? "given-name" : key === "last_name" ? "family-name" : "off"}
        list={listId}
        placeholder={placeholder}
      />
      {suggestions.length > 0 && <datalist id={listId}>{suggestions.map((option) => <option key={option} value={option} />)}</datalist>}
      {hint && <span className="field-hint">{hint}</span>}
    </label>;
  };
  const choiceField = (key: TextProfileKey, label: string, options: string[], customLabel: string, customPrefix = "Other: ") => {
    const value = draft[key];
    const fallbackValue = customPrefix.slice(0, -2);
    const custom = value === fallbackValue || value.startsWith(customPrefix);
    const customValue = value.startsWith(customPrefix) ? value.slice(customPrefix.length) : "";
    return <div className="profile-choice-field">
      <label>
        <span className="field-heading">{label}<small>Optional</small></span>
        <select value={custom ? "__custom__" : value} onChange={(event) => change(key, event.target.value === "__custom__" ? fallbackValue : event.target.value)}>
          <option value="">Choose later</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
          <option value="__custom__">{fallbackValue}</option>
        </select>
      </label>
      {custom && <label className="profile-custom-field">
        <span className="field-heading">{customLabel}<small>Optional</small></span>
        <input maxLength={145} value={customValue} placeholder="Type your answer" onChange={(event) => change(key, event.target.value ? `${customPrefix}${event.target.value}` : fallbackValue)} />
      </label>}
    </div>;
  };
  const timezoneField = <div className="timezone-field field-wide">
    <label>
      <span className="field-heading">Time zone<small>Optional</small></span>
      <div className="input-with-action">
        <MapPin size={17} aria-hidden="true" />
        <input
          maxLength={160}
          value={draft.timezone}
          onChange={(event) => change("timezone", event.target.value)}
          list="profile-timezone-options"
          placeholder={`Automatic — ${automaticTimezone}`}
          aria-describedby="timezone-help"
        />
        <button type="button" onClick={() => change("timezone", "")}>Use automatic</button>
      </div>
      <datalist id="profile-timezone-options">{TIMEZONE_SUGGESTIONS.map((option) => <option key={option} value={option} />)}</datalist>
      <span className="field-hint" id="timezone-help">{draft.timezone ? `Using ${draft.timezone}` : `Automatic: ${automaticTimezone}`}. Start typing to search common time zones.</span>
    </label>
  </div>;

  const schoolFields = <div className="settings-form-grid">
    {textField("university", "College or university", { suggestions: UNIVERSITY_SUGGESTIONS, placeholder: "Start typing your school" })}
    {textField("major", "Major or program", { suggestions: MAJOR_SUGGESTIONS, placeholder: "Start typing your major" })}
    {choiceField("academic_year", "Academic year", ["Freshman", "Sophomore", "Junior", "Senior", "Graduate"], "Your academic year")}
    <label>
      <span className="field-heading">Age<small>Optional</small></span>
      <input type="number" min="1" max="120" inputMode="numeric" placeholder="e.g. 20" value={draft.age ?? ""} onChange={(event) => change("age", event.target.value === "" ? null : Number(event.target.value))} />
    </label>
  </div>;
  const planningFields = <div className="settings-form-grid">
    {textField("study_goal", "Study goal", { placeholder: "e.g. Stay ahead of deadlines", wide: true })}
    {textField("current_term", "Current term", { suggestions: TERM_SUGGESTIONS, placeholder: "Start typing a term" })}
    {choiceField("academic_structure", "Academic structure", ["Quarter", "Semester", "Trimester"], "Your academic structure")}
    {choiceField("gpa_system", "GPA system", ["4.0 scale", "Percentage"], "Your GPA system", "Custom: ")}
    <label>
      <span className="field-heading">Week starts on<small>Optional</small></span>
      <select value={draft.week_starts_on} onChange={(event) => change("week_starts_on", event.target.value)}>
        <option value="">Use calendar default</option>
        <option value="Monday">Monday</option>
        <option value="Sunday">Sunday</option>
      </select>
    </label>
    {timezoneField}
  </div>;
  const preferenceFields = <div className="profile-preferences">
    <label>
      <span className="field-heading">Theme</span>
      <select value={draft.preferences.theme} onChange={(event) => preference("theme", event.target.value)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">Match my device</option>
      </select>
    </label>
    {([["deadlineReminders", "Deadline reminders"], ["dailyStudyPlan", "Daily study plan"], ["streakNudges", "Study streak nudges"], ["reducedMotion", "Reduce motion"], ["highContrast", "High-contrast status labels"]] as const).map(([key, label]) => <label className="profile-toggle" key={key}><span>{label}</span><input type="checkbox" checked={draft.preferences[key]} onChange={(event) => preference(key, event.target.checked)} /></label>)}
    <p className="form-hint">Notification preferences are saved for when reminders are available.</p>
  </div>;

  return <form className="profile-editor" onSubmit={(event) => {
    event.preventDefault();
    if (onboarding && step === 0) {
      if (draft.display_name.trim()) {
        setStep(1);
        setMessage("");
      } else {
        setFailed(true);
        setMessage("Please enter your name.");
      }
    } else void save();
  }}>
    {onboarding && <ol className="profile-steps" aria-label="Onboarding progress">
      <li className={step === 0 ? "active" : "complete"}><span>{step === 0 ? "1" : <Check size={13} />}</span><div><strong>Your profile</strong><small>Name and account</small></div></li>
      <li className={step === 1 ? "active" : ""}><span>2</span><div><strong>Study setup</strong><small>Optional preferences</small></div></li>
    </ol>}
    <fieldset disabled={busy || openingWorkspace}>
      {(!onboarding || step === 0) && <section className="settings-card profile-primary-card">
        <div className="settings-card-title"><span><UserRound size={20} /></span><div><h2>{onboarding ? "What should we call you?" : "Your profile"}</h2><p>{onboarding ? "Confirm the name connected to your Google account." : "Your Google account and personal details."}</p></div></div>
        <label className="account-email"><span className="field-heading">Google account</span><input value={initialProfile.email} readOnly type="email" /></label>
        <div className="settings-form-grid">{textField("display_name", "Display name", { required: true, placeholder: "Your name" })}{textField("last_name", "Last name", { placeholder: "Optional" })}</div>
      </section>}
      {(!onboarding || step === 1) && <>
        <section className="settings-card">
          <div className="settings-card-title"><span><GraduationCap size={20} /></span><div><h2>School basics</h2><p>Type to see suggestions, or enter your own answer.</p></div></div>
          {schoolFields}
        </section>
        {onboarding ? <details className="settings-card onboarding-more">
          <summary><span><SlidersHorizontal size={18} /></span><div><strong>More ways to personalize</strong><small>Term, grading, calendar, theme, and reminders</small></div><ChevronDown size={18} /></summary>
          <div className="onboarding-more-content"><h3>Planning defaults</h3>{planningFields}<h3>Preferences</h3>{preferenceFields}</div>
        </details> : <>
          <section className="settings-card"><div className="settings-card-title"><span><MapPin size={20} /></span><div><h2>Planning defaults</h2><p>Used for your calendar, study tools, and grades.</p></div></div>{planningFields}</section>
          <section className="settings-card"><h2>Preferences</h2>{preferenceFields}</section>
        </>}
      </>}
    </fieldset>
    <p className="profile-save-state" role="status">{openingWorkspace ? "Opening your workspace…" : busy ? "Saving your setup…" : dirty ? "Your changes are ready to save" : failureKind ? "Your setup needs attention" : "Your setup is saved"}</p>
    {message && <p className={failed ? "auth-error" : "profile-success"} role={failed ? "alert" : "status"}>{message}</p>}
    <div className="profile-recovery">
      {(dirty || failed || failureKind) && <button type="button" className="secondary-button" onClick={() => downloadDraft("eduessentials-settings-draft.json", { account: initialProfile.email, settings: editableProfile(draft) })}>Download settings draft</button>}
      {failureKind && <button type="button" className="secondary-button" disabled={busy} onClick={() => void reloadSaved()}>Load latest saved settings</button>}
      {failureKind === "session" && <a className="secondary-button" href="/login?error=session" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a>}
      {dirty && !failureKind && !onboarding && <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (window.confirm("Discard these settings edits and reset to the saved values?")) { setDraft(savedProfile); setMessage(""); setFailed(false); } }}>Reset to saved</button>}
      {failed && failureKind !== "conflict" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void save(lastSkip)}>Retry settings save</button>}
    </div>
    <div className="profile-actions">
      {onboarding && step === 1 && <>
        <button type="button" className="secondary-button" disabled={busy || openingWorkspace} onClick={() => setStep(0)}>Back</button>
        <button type="button" className="skip-details" disabled={busy || openingWorkspace || failureKind === "conflict"} onClick={() => void save(true)}>Skip optional details</button>
      </>}
      <button className="primary-button" disabled={busy || openingWorkspace || failureKind === "conflict" || (!onboarding && !dirty && !failed)}>
        {openingWorkspace ? "Opening…" : busy ? "Saving…" : onboarding ? step === 0 ? "Continue" : "Save and open workspace" : "Save changes"}
        {onboarding ? <ArrowRight size={16} /> : <Check size={16} />}
      </button>
    </div>
  </form>;
}
