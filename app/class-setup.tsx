"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, ImagePlus, Plus, X } from "lucide-react";
import { addDays, emptyCourseDetails, validateCourse, validateCourseDetails, type Course, type CourseDetails, type Meeting } from "../lib/academics";
import { courseIconOptions, DEFAULT_COURSE_ICON } from "../lib/course-icons";
import { MAX_FILE_BYTES } from "../lib/files";
import CourseIcon from "./course-icon";
import { useSaveProtection } from "./use-save-protection";
import "./course-icon-picker.css";
import "./class-setup.css";

export type ClassSetupUpload = { file: File; id: string };
export type ClassSetupUploads = { image?: ClassSetupUpload; syllabus?: ClassSetupUpload };
const steps = ["Course information", "Class schedule", "Make it yours"];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function ClassSetup({ initial, today, canUpload, onSave, onClose }: {
  initial: Course; today: string; canUpload: boolean;
  onSave: (course: Course, details: CourseDetails, uploads: ClassSetupUploads) => Promise<void>;
  onClose: () => void;
}) {
  const [course, setCourse] = useState(initial);
  const [initialDetails] = useState<CourseDetails>(() => ({ ...emptyCourseDetails(), meetings: [{ id: crypto.randomUUID(), days: [], start: "09:00", end: "10:00", from: today, until: addDays(today, 90), location: initial.room }] }));
  const [details, setDetails] = useState<CourseDetails>(initialDetails);
  const [step, setStep] = useState(0);
  const [uploads, setUploads] = useState<ClassSetupUploads>({});
  const [imagePreview, setImagePreview] = useState("");
  const imageUrlRef = useRef("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const dirty = JSON.stringify(course) !== JSON.stringify(initial) || JSON.stringify(details) !== JSON.stringify(initialDetails) || Boolean(uploads.image || uploads.syllabus);
  useSaveProtection(dirty || busy);
  const close = () => { if (!saving.current && (!dirty || window.confirm("Discard this class setup? Selected files have not been uploaded unless you already tried saving."))) onClose(); };
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); formRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => () => { if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current); }, []);

  const changeCourse = (patch: Partial<Course>) => setCourse((current) => ({ ...current, ...patch }));
  const changeMeeting = (id: string, patch: Partial<Meeting>) => setDetails((current) => ({ ...current, meetings: current.meetings.map((meeting) => meeting.id === id ? { ...meeting, ...patch } : meeting) }));
  const field = (label: string, value: string | number, onChange: (value: string) => void, type = "text", required = false, maxLength = 160) => <label><span>{label}{required && <span aria-hidden="true"> *</span>}</span><input type={type} value={value} required={required} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} {...(type === "number" ? { min: 0, max: 30, step: 1 } : {})} /></label>;
  const selectFile = (kind: keyof ClassSetupUploads, file?: File) => {
    setError("");
    if (!file) return;
    if (!file.size || file.size > MAX_FILE_BYTES) { setError("Choose a nonempty file of 25 MiB or smaller."); return; }
    if (kind === "image" && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { setError("Choose a PNG, JPEG, WebP, or GIF class image."); return; }
    if (kind === "image") {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = URL.createObjectURL(file);
      setImagePreview(imageUrlRef.current);
    }
    setUploads((current) => ({ ...current, [kind]: { file, id: crypto.randomUUID() } }));
  };
  const submit = async () => {
    if (saving.current) return;
    setError("");
    try {
      const validated = validateCourse({ ...course, initials: course.code.slice(0, 2).toUpperCase(), soft: `${course.color}18` });
      if (step === 1 || step === 2) validateCourseDetails(details);
      if (step < 2) { setStep(step + 1); return; }
      saving.current = true; setBusy(true); setAttemptedSave(true);
      await onSave(validated, details, uploads);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this class. Your setup is still here; please retry."); }
    finally { saving.current = false; setBusy(false); }
  };

  return <div className="modal-backdrop"><form ref={formRef} className="add-class-modal academic-editor class-setup" role="dialog" aria-modal="true" aria-labelledby="class-setup-title" aria-busy={busy} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="modal-header"><div><h2 id="class-setup-title" ref={headingRef} tabIndex={-1}>{steps[step]}</h2></div><button type="button" className="secondary-button" disabled={busy} aria-label="Close class setup" onClick={close}><X size={18} /></button></div>
    <ol className="class-setup-progress" aria-label="Class setup progress">{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={index <= step ? "is-active" : ""}><span>{index < step ? <Check size={14} /> : index + 1}</span><small>{label}</small></li>)}</ol>
    <fieldset className="class-setup-body" disabled={busy}>
      {step === 0 && <><div className="settings-form-grid">{field("Course code", course.code, (code) => changeCourse({ code }), "text", true, 30)}{field("Class name", course.name, (name) => changeCourse({ name }), "text", true)}{field("Credits", course.credits, (value) => changeCourse({ credits: Number(value) }), "number")}{field("Instructor", course.instructor, (instructor) => changeCourse({ instructor }))}{field("Location / meeting notes", course.room, (room) => changeCourse({ room }))}<label>Office hours (Zoom link, location, etc.)<textarea maxLength={2000} value={details.officeHours} onChange={(event) => setDetails({ ...details, officeHours: event.target.value })} /></label></div></>}
      {step === 1 && <>{details.meetings.map((meeting, index) => <section className="class-setup-meeting" key={meeting.id} aria-label={`Meeting ${index + 1}`}><div className="class-setup-section-heading"><h3>Meeting {index + 1}</h3><button className="text-button" type="button" onClick={() => setDetails({ ...details, meetings: details.meetings.filter((current) => current.id !== meeting.id) })}>Remove meeting {index + 1}</button></div><p className="class-setup-week-label">Meeting days <span aria-hidden="true">*</span></p><div className="class-setup-week" role="group" aria-label={`Weekdays for meeting ${index + 1}`}>{weekdays.map((day, dayIndex) => <button type="button" key={day} aria-label={day} aria-pressed={meeting.days.includes(dayIndex)} onClick={() => changeMeeting(meeting.id, { days: meeting.days.includes(dayIndex) ? meeting.days.filter((value) => value !== dayIndex) : [...meeting.days, dayIndex].sort() })}><small>{day.slice(0, 3)}</small><span>{day.slice(0, 1)}</span><Check size={14} aria-hidden="true" /></button>)}</div><div className="settings-form-grid">{field("Start time", meeting.start, (start) => changeMeeting(meeting.id, { start }), "time", true)}{field("End time", meeting.end, (end) => changeMeeting(meeting.id, { end }), "time", true)}{field("Classes start", meeting.from, (from) => changeMeeting(meeting.id, { from }), "date", true)}{field("Classes end", meeting.until, (until) => changeMeeting(meeting.id, { until }), "date", true)}{field("Meeting location", meeting.location, (location) => changeMeeting(meeting.id, { location }))}</div><h4>Exceptions · no class on these dates</h4>{(meeting.excludedDates ?? []).map((date, exceptionIndex) => <div className="class-setup-exception" key={exceptionIndex}><label><span>Exception date {exceptionIndex + 1}<span aria-hidden="true"> *</span></span><input type="date" required min={meeting.from} max={meeting.until} value={date} onChange={(event) => changeMeeting(meeting.id, { excludedDates: meeting.excludedDates!.map((current, currentIndex) => currentIndex === exceptionIndex ? event.target.value : current) })} /></label><button type="button" className="secondary-button" aria-label={`Remove exception ${exceptionIndex + 1}`} onClick={() => changeMeeting(meeting.id, { excludedDates: meeting.excludedDates!.filter((_, currentIndex) => currentIndex !== exceptionIndex) })}><X size={16} /></button></div>)}<button type="button" className="secondary-button" disabled={(meeting.excludedDates?.length ?? 0) >= 100} onClick={() => changeMeeting(meeting.id, { excludedDates: [...(meeting.excludedDates ?? []), ""] })}><Plus size={14} />Add exception</button></section>)}<button type="button" className="secondary-button" disabled={details.meetings.length >= 30} onClick={() => setDetails({ ...details, meetings: [...details.meetings, { id: crypto.randomUUID(), days: [], start: "09:00", end: "10:00", from: today, until: addDays(today, 90), location: course.room }] })}><Plus size={16} />Add meeting</button></>}
      {step === 2 && <><div className="class-setup-preview" style={{ borderColor: course.color, backgroundColor: `${course.color}18` }}>{uploads.image && imagePreview ? <div className="class-setup-cover" role="img" aria-label="Selected class cover" style={{ backgroundImage: `url(${imagePreview})` }} /> : <CourseIcon icon={details.icon} size={36} style={{ color: course.color }} />}<div><strong>{course.code}</strong><span>{course.name}</span></div></div>{field("Class color", course.color, (color) => changeCourse({ color }), "color")}<fieldset className="course-icon-picker"><legend>Class icon</legend><div className="course-icon-options">{courseIconOptions.map((option) => <button key={option.id} type="button" aria-label={option.label} aria-pressed={(details.icon ?? DEFAULT_COURSE_ICON) === option.id} onClick={() => setDetails({ ...details, icon: option.id })}><CourseIcon icon={option.id} size={24} style={{ color: course.color }} />{(details.icon ?? DEFAULT_COURSE_ICON) === option.id && <Check className="course-icon-selected" size={14} />}</button>)}</div></fieldset><fieldset className="class-setup-uploads" disabled={attemptedSave}><legend className="class-setup-upload-legend">Optional files</legend>{(["image", "syllabus"] as const).map((kind) => <section key={kind}>{kind === "image" ? <ImagePlus size={22} /> : <FileText size={22} />}<label>{kind === "image" ? "Class image (optional)" : "Syllabus (optional)"}<input type="file" disabled={!canUpload || busy} accept={kind === "image" ? "image/png,image/jpeg,image/webp,image/gif" : undefined} onChange={(event) => { selectFile(kind, event.target.files?.[0]); event.target.value = ""; }} /></label><p className="form-hint">{kind === "image" ? "PNG, JPEG, WebP, or GIF. Up to 25 MiB." : "Storage only. Uploading will not change your course, schedule, or assignments."}</p>{uploads[kind] && <div className="class-setup-file"><span>{uploads[kind]!.file.name}</span><button type="button" className="text-button" onClick={() => setUploads((current) => ({ ...current, [kind]: undefined }))}>Remove {kind}</button></div>}</section>)}</fieldset>{!canUpload && <p className="form-hint">File uploads are unavailable until your workspace is saved. You can still create this class and attach files later.</p>}</>}
    </fieldset>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {attemptedSave && !busy && error && <p className="form-hint">Selected files are locked for safe retries because some attachments may already be saved. Retry to finish, or close setup and manage saved attachments from the class files.</p>}
    <div className="modal-actions class-setup-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { if (step) { setStep(step - 1); setError(""); } else close(); }}>{step ? <><ArrowLeft size={16} />Back</> : "Cancel"}</button><span>{step + 1} / 3</span><button className="primary-button" disabled={busy}>{busy ? "Saving class…" : step === 2 ? "Create class" : <>Continue<ArrowRight size={16} /></>}</button></div>
  </form></div>;
}
