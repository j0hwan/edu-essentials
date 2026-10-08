"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clock3,
  GraduationCap, MapPin, Search, Sparkles, UserRound, X,
} from "lucide-react";
import {
  birthdayAge, createOnboardingDraft, getAcademicStanding,
} from "../lib/onboarding";
import {
  editableProfile, validateProfile, type Profile,
} from "../lib/profile";
import { useSaveProtection } from "./use-save-protection";
import "./onboarding-flow.css";

type Step = "about" | "school" | "location" | "major" | "graduation" | "syllabus";
type School = { id: string; name: string; location: string };
type Editable = ReturnType<typeof editableProfile>;
type Validated = ReturnType<typeof validateProfile>;
type FailureKind = "session" | "conflict" | "error";

class SaveError extends Error {
  constructor(message: string, readonly kind: FailureKind) {
    super(message);
    this.name = "SaveError";
  }
}

const collegeSteps: Step[] = ["about", "school", "location", "major", "graduation", "syllabus"];
const schoolSteps: Step[] = ["about", "school", "location", "graduation", "syllabus"];
const onboardingFields: Array<keyof Editable> = [
  "display_name", "last_name", "birthday", "age", "timezone", "study_goal",
  "school_type", "university", "major", "graduation_year", "program_length", "academic_year",
];
const timeZones = [
  ["America/Los_Angeles", "Pacific time"],
  ["America/Denver", "Mountain time"],
  ["America/Chicago", "Central time"],
  ["America/New_York", "Eastern time"],
  ["America/Anchorage", "Alaska time"],
  ["Pacific/Honolulu", "Hawaii time"],
  ["America/Halifax", "Atlantic time"],
  ["America/St_Johns", "Newfoundland time"],
  ["Europe/London", "United Kingdom"],
  ["Europe/Paris", "Central Europe"],
  ["Asia/Kolkata", "India"],
  ["Asia/Tokyo", "Japan"],
  ["Australia/Sydney", "Eastern Australia"],
  ["UTC", "UTC"],
] as const;

function makeDraft(profile: Profile, preview: boolean): Editable {
  const editable = editableProfile(createOnboardingDraft(profile, preview));
  if (!editable.program_length) return { ...editable, program_length: "4" };
  return editable;
}

export default function OnboardingFlow({
  initialProfile,
  preview = false,
  onExit,
}: {
  initialProfile: Profile;
  preview?: boolean;
  onExit?: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Editable>(() => makeDraft(initialProfile, preview));
  const [step, setStep] = useState<Step>("about");
  const [finishedPreview, setFinishedPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [message, setMessage] = useState("");
  const [failureKind, setFailureKind] = useState<FailureKind | null>(null);
  const [pendingDetails, setPendingDetails] = useState<Validated | null>(null);
  const [saveBaseRevision, setSaveBaseRevision] = useState(initialProfile.updated_at);
  const [latestProfile, setLatestProfile] = useState(initialProfile);
  const busyRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [schoolQuery, setSchoolQuery] = useState(draft.university);
  const [schoolSelected, setSchoolSelected] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolSearchOpen, setSchoolSearchOpen] = useState(false);
  const [schoolSearchLoading, setSchoolSearchLoading] = useState(false);
  const [schoolSearchMessage, setSchoolSearchMessage] = useState("");
  const [activeSchoolIndex, setActiveSchoolIndex] = useState(-1);
  const [locationWait, setLocationWait] = useState(0);

  const steps = draft.school_type === "college" ? collegeSteps : schoolSteps;
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isCollege = draft.school_type === "college";
  const isDirty = JSON.stringify(draft) !== JSON.stringify(editableProfile(initialProfile));
  const standing = getAcademicStanding(draft.graduation_year, draft.program_length, new Date());

  useSaveProtection(!preview && !openingWorkspace && isDirty);

  // Preview is an isolated, read-only flow; it must not change the host page's theme.
  useEffect(() => {
    if (preview) return;
    const { theme, reducedMotion, highContrast } = initialProfile.preferences;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      root.style.colorScheme = root.dataset.theme;
      root.dataset.motion = reducedMotion ? "reduced" : "full";
      root.dataset.contrast = highContrast ? "high" : "normal";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preview, initialProfile.preferences]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step, finishedPreview]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onExit?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview, onExit]);

  useEffect(() => {
    if (step !== "location") return;
    const first = window.setTimeout(() => setLocationWait(1), 1000);
    const second = window.setTimeout(() => setLocationWait(0), 2000);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [step]);

  useEffect(() => {
    const query = schoolQuery.trim();
    if (step !== "school" || !draft.school_type || query.length < 2 || schoolSelected) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, type: draft.school_type });
    const timer = window.setTimeout(async () => {
      setSchoolSearchLoading(true);
      setSchoolSearchMessage("");
      try {
        const response = await fetch(`/api/schools?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as { schools?: School[]; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(data.error || "School search is unavailable.");
        if (!Array.isArray(data.schools)) throw new Error("School search returned an invalid response.");
        setSchools(data.schools);
        setActiveSchoolIndex(-1);
        setSchoolSearchOpen(true);
        setSchoolSearchMessage(data.schools.length ? "" : "No schools found. You can keep your answer.");
      } catch (error) {
        if (controller.signal.aborted) return;
        setSchools([]);
        setSchoolSearchOpen(false);
        setSchoolSearchMessage(error instanceof Error ? error.message : "School search is unavailable.");
      } finally {
        if (!controller.signal.aborted) setSchoolSearchLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.school_type, schoolQuery, schoolSelected, step]);

  function clearSaveMessage() {
    setMessage("");
    setFailureKind(null);
    setPendingDetails(null);
  }

  function change(key: keyof Editable, value: string | number | null) {
    clearSaveMessage();
    if (key === "birthday") {
      const birthday = String(value ?? "");
      setDraft((current) => ({ ...current, birthday, age: birthdayAge(birthday) }));
      return;
    }
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function changeSchoolType(value: "high-school" | "college") {
    clearSaveMessage();
    setSchools([]);
    setSchoolSearchOpen(false);
    setSchoolSearchLoading(false);
    setSchoolSearchMessage("");
    setDraft((current) => ({
      ...current,
      school_type: value,
      program_length: "4",
      ...(value !== "college" ? { major: "" } : {}),
    }));
    setSchoolSelected(false);
  }

  function selectSchool(school: School) {
    change("university", school.name);
    setSchoolQuery(school.name);
    setSchoolSelected(true);
    setSchools([]);
    setSchoolSearchOpen(false);
    setActiveSchoolIndex(-1);
    inputRef.current?.focus();
  }

  function schoolKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && schools.length) {
      event.preventDefault();
      setSchoolSearchOpen(true);
      setActiveSchoolIndex((current) => (current + 1) % schools.length);
    } else if (event.key === "ArrowUp" && schools.length) {
      event.preventDefault();
      setSchoolSearchOpen(true);
      setActiveSchoolIndex((current) => (current <= 0 ? schools.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (schoolSearchOpen && activeSchoolIndex >= 0 && schools[activeSchoolIndex]) {
        selectSchool(schools[activeSchoolIndex]);
      } else {
        setSchoolSearchOpen(false);
      }
    } else if (event.key === "Escape") {
      if (schoolSearchOpen) {
        event.preventDefault();
        event.stopPropagation();
        setSchoolSearchOpen(false);
        setActiveSchoolIndex(-1);
      }
    }
  }

  function nextStep() {
    if (step === "about" && !preview && !draft.display_name.trim()) {
      setMessage("Please enter your first name, or skip setup.");
      setFailureKind(null);
      return;
    }
    setMessage("");
    const next = steps[stepIndex + 1];
    if (next) {
      if (step === "school") {
        setSchools([]);
        setSchoolSearchLoading(false);
        setSchoolSearchMessage("");
        setSchoolSearchOpen(false);
      }
      if (next === "location") setLocationWait(2);
      setStep(next);
    }
  }

  function previousStep() {
    const previous = steps[stepIndex - 1];
    if (previous) {
      if (step === "school") {
        setSchools([]);
        setSchoolSearchLoading(false);
        setSchoolSearchMessage("");
        setSchoolSearchOpen(false);
      }
      if (previous === "location") setLocationWait(2);
      setStep(previous);
    }
  }

  async function putProfile(details: Validated, revision: string): Promise<Profile> {
    let response: Response;
    try {
      response = await fetch("/api/profile", {
        method: "PUT",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "content-type": "application/json",
          "x-profile-id": initialProfile.id,
        },
        body: JSON.stringify({ ...details, baseRevision: revision }),
      });
    } catch {
      throw new SaveError("Your setup could not be saved. Your answers are still here; try again.", "error");
    }
    if (response.status === 401) {
      throw new SaveError("Your session ended or the account changed. Sign in to the same account, then retry. Your answers are still here.", "session");
    }
    if (response.status === 409) {
      throw new SaveError("Your profile changed in another session. Load the latest revision and retry with your answers.", "conflict");
    }
    let data: { profile?: Profile; error?: string };
    try {
      data = await response.json() as { profile?: Profile; error?: string };
    } catch {
      throw new SaveError("Your profile could not be saved. Your answers are still here; try again.", "error");
    }
    if (!response.ok) throw new SaveError(data.error || "Your profile could not be saved. Your answers are still here; try again.", "error");
    if (!data.profile || data.profile.id !== initialProfile.id) {
      throw new SaveError("The saved account did not match. Your answers are still here.", "error");
    }
    return data.profile;
  }

  function mergeOnboardingDetails(details: Validated, latest: Profile): Validated {
    const originalEditable = editableProfile(initialProfile);
    const latestEditable = editableProfile(latest);
    const merged: Editable = { ...latestEditable };
    for (const key of onboardingFields) {
      if (details[key] !== originalEditable[key]) Object.assign(merged, { [key]: details[key] });
    }
    return validateProfile(merged);
  }

  function handleSaveFailure(error: unknown) {
    const saveError = error instanceof SaveError ? error : new SaveError(error instanceof Error ? error.message : "Please try again.", "error");
    setFailureKind(saveError.kind);
    setMessage(saveError.message);
  }

  function completeNormally() {
    setFailureKind(null);
    setMessage("Your setup is saved. Opening your workspace…");
    setOpeningWorkspace(true);
    router.replace("/home");
  }

  async function persist(details: Validated, revision = saveBaseRevision) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let mergedDetails: Validated;
    // Keep the submitted local answers separate from values fetched during retries.
    setPendingDetails(details);
    setMessage("");
    setFailureKind(null);
    try {
      mergedDetails = mergeOnboardingDetails(details, latestProfile);
      await putProfile(mergedDetails, revision);
      completeNormally();
    } catch (error) {
      handleSaveFailure(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function finish(skip = false) {
    if (busyRef.current) return;
    if (preview) {
      setFinishedPreview(true);
      return;
    }

    const fallbackName = skip ? draft.display_name.trim() || initialProfile.display_name : draft.display_name;
    let details: Validated;
    try {
      details = validateProfile({
        ...draft,
        display_name: fallbackName,
        academic_year: standing?.academicYear ?? draft.academic_year,
      });
    } catch (error) {
      if (!skip) {
        clearSaveMessage();
        setMessage(error instanceof Error ? error.message : "Please check your answers.");
        return;
      }
      // A malformed optional answer should not prevent a quick finish. Keep the names
      // and fall back to the clean provider profile for optional fields.
      try {
        const clean = editableProfile(createOnboardingDraft(initialProfile, false));
        details = validateProfile({
          ...clean,
          display_name: fallbackName,
          last_name: draft.last_name.length <= 160 ? draft.last_name : initialProfile.last_name,
          program_length: clean.program_length || "4",
        });
      } catch (fallbackError) {
        clearSaveMessage();
        setMessage(fallbackError instanceof Error ? fallbackError.message : "Please check your profile before finishing.");
        return;
      }
    }
    await persist(details);
  }

  async function loadLatestAndRetry() {
    if (busyRef.current || !pendingDetails) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("Checking the latest saved revision…");
    try {
      const response = await fetch("/api/profile", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: { "x-profile-id": initialProfile.id },
      });
      if (response.status === 401) {
        throw new SaveError("Your session ended or the account changed. Sign in to the same account, then retry. Your answers are still here.", "session");
      }
      let data: { profile?: Profile; error?: string };
      try {
        data = await response.json() as { profile?: Profile; error?: string };
      } catch {
        throw new SaveError("The latest profile could not be loaded. Your answers are still here.", "error");
      }
      if (!response.ok) throw new SaveError(data.error || "The latest profile could not be loaded.", "error");
      if (!data.profile || data.profile.id !== initialProfile.id || !data.profile.updated_at) {
        throw new SaveError("The signed-in account changed. Reload onboarding before editing that account.", "session");
      }
      const mergedDetails = mergeOnboardingDetails(pendingDetails, data.profile);
      setLatestProfile(data.profile);
      setSaveBaseRevision(data.profile.updated_at);
      setMessage("");
      await putProfile(mergedDetails, data.profile.updated_at);
      completeNormally();
    } catch (error) {
      handleSaveFailure(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function restartPreview() {
    setDraft(makeDraft(initialProfile, true));
    setStep("about");
    setFinishedPreview(false);
    setMessage("");
    setFailureKind(null);
    setPendingDetails(null);
    setSchoolQuery("");
  }

  const progress = steps.length > 1 ? (stepIndex / (steps.length - 1)) * 100 : 100;
  const isFinalStep = step === "syllabus";
  const locationLocked = step === "location" && locationWait > 0;

  const schoolResults = useMemo(() => schoolSearchOpen && schools.length > 0, [schoolSearchOpen, schools.length]);

  return <main className="ee-onboarding">
    <div className="ee-onboarding-shell">
      <header className="ee-onboarding-header">
        <div className="ee-onboarding-brand">
          <span className="ee-onboarding-mark" aria-hidden="true"><BookOpen size={19} strokeWidth={2.2} /></span>
          <span>EduEssentials</span>
        </div>
        {!finishedPreview && <div className="ee-onboarding-time"><Clock3 size={14} aria-hidden="true" /><span>About 1 minute</span></div>}
        {preview ? <button className="ee-onboarding-exit" type="button" aria-label="Exit onboarding test" title="Exit onboarding test" onClick={() => onExit?.()}><X size={19} /></button> : <button className="ee-onboarding-skip-all" type="button" disabled={busy || openingWorkspace || locationLocked || failureKind === "conflict"} onClick={() => void finish(true)}>Skip setup</button>}
      </header>

      {finishedPreview ? <section className="ee-onboarding-success" aria-labelledby="ee-success-heading">
        <span className="ee-onboarding-success-mark" aria-hidden="true"><Check size={28} /></span>
        <p className="ee-onboarding-eyebrow">READY TO GO</p>
        <h1 id="ee-success-heading" tabIndex={-1} ref={headingRef}>Your setup is complete</h1>
        <p className="ee-onboarding-success-copy">Your preview session is ready.</p>
        <button className="ee-onboarding-primary" type="button" onClick={restartPreview}>Restart preview <ArrowRight size={16} /></button>
      </section> : <>
        <section className="ee-onboarding-progress" aria-label="Onboarding progress">
          <div className="ee-onboarding-progress-copy"><span>GETTING STARTED</span><strong>Step {stepIndex + 1} of {steps.length}</strong></div>
          <div className="ee-onboarding-progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        </section>

        <section className="ee-onboarding-card" aria-labelledby="ee-step-heading">
          <div className="ee-onboarding-card-top">
            <span className="ee-onboarding-step-icon" aria-hidden="true">{step === "about" ? <UserRound /> : step === "school" ? <GraduationCap /> : step === "location" ? <MapPin /> : step === "major" ? <Sparkles /> : step === "graduation" ? <Clock3 /> : <BookOpen />}</span>
            {step !== "syllabus" && <span className="ee-onboarding-card-step">{stepIndex + 1}<span>/</span>{steps.length}</span>}
          </div>

          <fieldset className="ee-onboarding-answers" disabled={busy || openingWorkspace}>
          {step === "about" && <div className="ee-onboarding-step-content">
            <p className="ee-onboarding-eyebrow">ABOUT YOU</p>
            <h1 id="ee-step-heading" tabIndex={-1} ref={headingRef}>Let’s get to know you.</h1>
            <div className="ee-onboarding-fields ee-onboarding-about-fields">
              <label className="ee-onboarding-field"><span>First name{!preview && <b>Required</b>}</span><input autoComplete="given-name" maxLength={160} value={draft.display_name} onChange={(event) => change("display_name", event.target.value)} placeholder="Your first name" /></label>
              <label className="ee-onboarding-field"><span>Last name <small>Optional</small></span><input autoComplete="family-name" maxLength={160} value={draft.last_name} onChange={(event) => change("last_name", event.target.value)} placeholder="Your last name" /></label>
              <label className="ee-onboarding-field"><span>Birthday <small>Optional</small></span><input type="date" autoComplete="bday" value={draft.birthday} onChange={(event) => change("birthday", event.target.value)} /></label>
              <label className="ee-onboarding-field"><span>Time zone <small>Optional</small></span><span className="ee-onboarding-timezone-control"><select value={draft.timezone} onChange={(event) => change("timezone", event.target.value)}><option value="">Choose time zone</option>{draft.timezone && !timeZones.some(([value]) => value === draft.timezone) && <option value={draft.timezone}>{draft.timezone}</option>}{timeZones.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={() => change("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "")}>Use device</button></span></label>
              <label className="ee-onboarding-field ee-onboarding-field-wide"><span>Study goal <small>Optional</small></span><input maxLength={500} value={draft.study_goal} onChange={(event) => change("study_goal", event.target.value)} placeholder="What would you like help staying on top of?" /></label>
            </div>
          </div>}

          {step === "school" && <div className="ee-onboarding-step-content">
            <p className="ee-onboarding-eyebrow">SCHOOL</p>
            <h1 id="ee-step-heading" tabIndex={-1} ref={headingRef}>Where do you study?</h1>
            <div className="ee-onboarding-school-types" role="group" aria-label="School type">
              <button type="button" className={draft.school_type === "high-school" ? "selected" : ""} aria-pressed={draft.school_type === "high-school"} onClick={() => changeSchoolType("high-school")}><span className="ee-onboarding-school-type-icon"><BookOpen size={19} /></span><strong>High school</strong><small>Secondary school</small>{draft.school_type === "high-school" && <Check className="ee-onboarding-selected-check" size={17} />}</button>
              <button type="button" className={draft.school_type === "college" ? "selected" : ""} aria-pressed={draft.school_type === "college"} onClick={() => changeSchoolType("college")}><span className="ee-onboarding-school-type-icon"><GraduationCap size={20} /></span><strong>College</strong><small>College or university</small>{draft.school_type === "college" && <Check className="ee-onboarding-selected-check" size={17} />}</button>
            </div>
            <label className="ee-onboarding-field ee-onboarding-school-field"><span>Your school <small>Optional</small></span><div className="ee-onboarding-school-input"><Search size={17} aria-hidden="true" /><input ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={schoolResults} aria-controls="ee-school-results" aria-activedescendant={activeSchoolIndex >= 0 ? `ee-school-option-${activeSchoolIndex}` : undefined} value={schoolQuery} onChange={(event) => { setSchoolSelected(false); setSchoolSearchOpen(false); setSchools([]); setSchoolSearchLoading(false); setSchoolSearchMessage(""); setSchoolQuery(event.target.value); change("university", event.target.value); setActiveSchoolIndex(-1); }} onFocus={() => { if (schools.length) setSchoolSearchOpen(true); }} onKeyDown={schoolKeyDown} autoComplete="off" placeholder={draft.school_type ? "Search or enter a school" : "Choose a school type first"} maxLength={160} /></div>
              {schoolSearchLoading && <span className="ee-onboarding-search-status" role="status">Searching schools…</span>}
              {schoolSearchMessage && <span className="ee-onboarding-search-status" role="status">{schoolSearchMessage}</span>}
              {schoolResults && <div className="ee-onboarding-school-results-wrap">
                <ul id="ee-school-results" className="ee-onboarding-school-results" role="listbox" aria-label="School suggestions">
                  {schools.map((school, index) => <li key={school.id} id={`ee-school-option-${index}`} role="option" aria-selected={index === activeSchoolIndex}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectSchool(school)}><strong>{school.name}</strong>{school.location && <small>{school.location}</small>}</button></li>)}
                </ul>
                <a className="ee-onboarding-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Schools · © OpenStreetMap</a>
              </div>}
            </label>
          </div>}

          {step === "location" && <div className="ee-onboarding-step-content">
            <p className="ee-onboarding-eyebrow">YOUR CAMPUS</p>
            <h1 id="ee-step-heading" tabIndex={-1} ref={headingRef}>Schools near you</h1>
            <div className="ee-onboarding-coming-card" aria-label="Campus discovery coming soon">
              <div className="ee-onboarding-skeleton-pin"><MapPin size={21} /></div>
              <div className="ee-onboarding-skeleton-lines" aria-hidden="true"><i /><i /><i /></div>
              <button className="ee-onboarding-location-action" type="button" disabled aria-label="Use my location, coming soon"><MapPin size={14} />Use my location</button>
              <span className="ee-onboarding-coming-soon">Coming soon</span>
            </div>
            <p className="ee-onboarding-timer-note" role="status">{locationWait > 0 ? `Ready in ${locationWait}…` : ""}</p>
          </div>}

          {step === "major" && isCollege && <div className="ee-onboarding-step-content">
            <p className="ee-onboarding-eyebrow">YOUR PROGRAM</p>
            <h1 id="ee-step-heading" tabIndex={-1} ref={headingRef}>What are you studying?</h1>
            <label className="ee-onboarding-field"><span>Major or program <small>Optional</small></span><input autoComplete="off" maxLength={160} value={draft.major} onChange={(event) => change("major", event.target.value)} placeholder="e.g. Biology" /></label>
          </div>}

          {step === "graduation" && <div className="ee-onboarding-step-content">
            <p className="ee-onboarding-eyebrow">YOUR TIMELINE</p>
            <h1 id="ee-step-heading" tabIndex={-1} ref={headingRef}>When do you expect to graduate?</h1>
            <div className="ee-onboarding-fields ee-onboarding-timeline-fields">
              <label className="ee-onboarding-field"><span>Graduation year <small>Optional</small></span><input inputMode="numeric" pattern="[0-9]*" maxLength={4} value={draft.graduation_year} onChange={(event) => { if (/^\d{0,4}$/.test(event.target.value)) change("graduation_year", event.target.value); }} placeholder="e.g. 2028" /></label>
              {isCollege && <label className="ee-onboarding-field"><span>Program length <small>Optional</small></span><span className="ee-onboarding-select-wrap"><select value={draft.program_length || "4"} onChange={(event) => change("program_length", event.target.value)}><option value="2">2 years</option><option value="3">3 years</option><option value="4">4 years</option><option value="5">5 years</option><option value="6">6 years</option></select><ChevronDown size={16} aria-hidden="true" /></span></label>}
            </div>
            <span className="ee-onboarding-assumption-label">Spring graduation · academic year starts in August</span>
            <div className="ee-onboarding-standing" aria-live="polite"><span>Academic standing</span><strong>{standing?.label || "Add a graduation year"}</strong></div>
          </div>}

          {step === "syllabus" && <div className="ee-onboarding-step-content">
            <p className="ee-onboarding-eyebrow">CLASS DETAILS</p>
            <h1 id="ee-step-heading" tabIndex={-1} ref={headingRef}>Add a syllabus</h1>
            <div className="ee-onboarding-upload-card">
              <span className="ee-onboarding-upload-icon"><BookOpen size={21} /></span>
              <strong>Upload your syllabus</strong>
              <button type="button" disabled aria-label="Upload syllabus, coming soon">Coming soon</button>
            </div>
          </div>}

          </fieldset>
          {message && <p className={`ee-onboarding-message ${failureKind ? "is-error" : ""}`} role={failureKind ? "alert" : "status"}>{message}</p>}
          <div className="ee-onboarding-actions">
            <div className="ee-onboarding-actions-left">{stepIndex > 0 && <button type="button" className="ee-onboarding-back" disabled={busy || openingWorkspace} onClick={previousStep}><ArrowLeft size={16} /> Back</button>}</div>
            <div className="ee-onboarding-actions-right">
              {step !== "about" && !isFinalStep && <button type="button" className="ee-onboarding-text-action" disabled={busy || openingWorkspace || locationLocked} onClick={nextStep}>{locationLocked ? `Wait ${locationWait}s` : "Skip this step"}</button>}
              {isFinalStep && <button type="button" className="ee-onboarding-text-action" disabled={busy || openingWorkspace || (failureKind === "conflict")} onClick={() => void finish(true)}>Skip syllabus</button>}
              {failureKind === "conflict" && pendingDetails && <button type="button" className="ee-onboarding-secondary" disabled={busy || openingWorkspace} onClick={() => void loadLatestAndRetry()}>{busy ? "Loading…" : "Load latest & retry"}</button>}
              {failureKind && failureKind !== "conflict" && pendingDetails && <button type="button" className="ee-onboarding-secondary" disabled={busy || openingWorkspace} onClick={() => void persist(pendingDetails)}>{busy ? "Saving…" : "Retry"}</button>}
              {isFinalStep ? <button type="button" className="ee-onboarding-primary" disabled={busy || openingWorkspace || failureKind === "conflict"} onClick={() => void finish(false)}>{busy ? "Saving…" : preview ? "Finish preview" : "Finish setup"}<ArrowRight size={16} /></button> : <button type="button" className="ee-onboarding-primary" disabled={busy || openingWorkspace || locationLocked} onClick={nextStep}>{locationLocked ? `Wait ${locationWait}s` : "Continue"}<ArrowRight size={16} /></button>}
            </div>
          </div>
        </section>

      </>}
    </div>
  </main>;
}
