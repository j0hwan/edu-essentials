"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, ChevronRight, Circle, CircleCheck, FileText, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { addDays, emptyCourseDetails, validateCourse, validateCourseDetails, type Course, type CourseDetails, type Meeting } from "../lib/academics";
import { courseIconOptions, DEFAULT_COURSE_ICON } from "../lib/course-icons";
import { courseImageFramingStyle, DEFAULT_COURSE_IMAGE_FRAMING, moveCourseImage, type CourseImageFraming } from "../lib/course-image-framing";
import { MAX_FILE_BYTES } from "../lib/files";
import CourseIcon from "./course-icon";
import LocationInput from "./location-input";
import ClassCardBody from "./class-card-body";
import ClassSetupDocumentPreview from "./class-setup-document-preview";
import { useSaveProtection } from "./use-save-protection";
import { useClassSetupMotion, type ClassSetupBounds } from "./use-class-setup-motion";
import "./course-icon-picker.css";
import "./class-setup.css";

export type ClassSetupUpload = { file: File; id: string };
export type ClassSetupUploads = { image?: ClassSetupUpload; syllabus?: ClassSetupUpload };
const steps = ["Course information", "Class schedule", "Make it yours"];
const stepLabels = ["Info", "Schedule", "Customize"];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const formatMeetingTime = (time: string) => {
  if (!time) return "Set time";
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
};
const isMeetingComplete = (meeting: Meeting) => {
  try { validateCourseDetails({ officeHours: "", meetings: [meeting] }); return true; }
  catch { return false; }
};
const hasMissingMeetingFields = (meeting: Meeting) => !meeting.days.length || [meeting.start, meeting.end, meeting.from, meeting.until, ...(meeting.excludedDates ?? [])].some((value) => !value.trim());

function MeetingTitle({ title, onRename }: { title: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const selectTitle = useRef(false);
  const preservedSelection = useRef<Range | null>(null);
  const activeEdit = useRef(false);
  const updateCaret = useCallback(() => {
    const heading = titleRef.current;
    const selection = window.getSelection();
    if (!heading || !selection?.rangeCount || !selection.isCollapsed || !heading.contains(selection.focusNode)) { setCaretAtEnd(false); return; }
    const prefix = document.createRange();
    prefix.selectNodeContents(heading);
    prefix.setEnd(selection.focusNode!, selection.focusOffset);
    if (typeof prefix.getClientRects === "function") {
      const rect = [...prefix.getClientRects()].at(-1);
      const box = heading.getBoundingClientRect();
      if (rect?.height) {
        heading.style.setProperty("--meeting-caret-left", `${rect.right - box.left + 2}px`);
        heading.style.setProperty("--meeting-caret-top", `${rect.top - box.top}px`);
        heading.style.setProperty("--meeting-caret-height", `${rect.height}px`);
      } else {
        for (const property of ["--meeting-caret-left", "--meeting-caret-top", "--meeting-caret-height"]) heading.style.removeProperty(property);
      }
    }
    setCaretAtEnd(prefix.toString().length === heading.textContent?.length);
  }, []);
  useEffect(() => {
    if (editing) {
      const heading = titleRef.current;
      if (!heading) return;
      heading.focus();
      const range = preservedSelection.current ?? document.createRange();
      if (!preservedSelection.current) {
        range.selectNodeContents(heading);
        if (!selectTitle.current) range.collapse(false);
      }
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener("selectionchange", updateCaret);
      const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateCaret) : undefined;
      observer?.observe(heading);
      return () => { document.removeEventListener("selectionchange", updateCaret); observer?.disconnect(); };
    }
    else if (restoreFocus.current) { pencilRef.current?.focus(); restoreFocus.current = false; }
  }, [editing, updateCaret]);
  const beginEditing = (highlight: boolean) => {
    const selection = window.getSelection();
    preservedSelection.current = highlight && selection?.rangeCount && !selection.isCollapsed && titleRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0).cloneRange() : null;
    activeEdit.current = true;
    selectTitle.current = highlight; setCaretAtEnd(!highlight); setEditing(true);
  };
  const finishEditing = (save: boolean, focus = false) => {
    if (!activeEdit.current) return;
    activeEdit.current = false;
    const heading = titleRef.current;
    const name = heading?.textContent?.trim() ?? "";
    if (heading) heading.textContent = save ? name || title : title;
    if (save) onRename(name);
    restoreFocus.current = focus;
    setPreviewName(null);
    setEditing(false);
  };
  const handleEditingKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (editing && !event.nativeEvent.isComposing && (event.key === "Escape" || (event.key === "Enter" && event.currentTarget === titleRef.current))) {
      event.preventDefault(); event.stopPropagation();
      finishEditing(event.key === "Enter", true);
    }
  };
  return <div ref={editorRef} className="class-setup-section-heading" onBlur={(event) => { if (editing && !editorRef.current?.contains(event.relatedTarget)) finishEditing(true); }}>
    <h3><span ref={titleRef} className="class-setup-meeting-title" contentEditable={editing ? "plaintext-only" : false} suppressContentEditableWarning role={editing ? "textbox" : undefined} aria-label={editing ? "Meeting name" : undefined} aria-multiline={editing ? false : undefined} tabIndex={editing ? 0 : undefined} spellCheck={false} data-caret-at-end={caretAtEnd} data-preview={editing ? previewName ?? undefined : undefined} onDoubleClick={() => { if (!editing) beginEditing(true); }} onInput={(event) => {
      setPreviewName(null);
      const heading = event.currentTarget;
      const text = (heading.textContent ?? "").replace(/[\r\n]+/g, " ").slice(0, 160);
      if (text !== heading.textContent) {
        heading.textContent = text;
        const range = document.createRange();
        range.selectNodeContents(heading); range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges(); selection?.addRange(range);
      }
      updateCaret();
    }} onKeyUp={updateCaret} onMouseUp={updateCaret} onKeyDown={handleEditingKey}>{title}</span></h3>
    {editing && <div className="class-setup-meeting-presets" role="group" aria-label="Meeting name presets">{["Lecture", "Lab", "Discussion", "Office Hours"].map((name) => <button key={name} type="button" onMouseEnter={() => setPreviewName(name)} onMouseLeave={() => setPreviewName(null)} onFocus={() => setPreviewName(name)} onBlur={() => setPreviewName(null)} onPointerDown={(event) => event.preventDefault()} onKeyDown={handleEditingKey} onClick={() => {
      if (titleRef.current) titleRef.current.textContent = name;
      finishEditing(true, true);
    }}>{name}</button>)}</div>}
    {!editing && <button ref={pencilRef} type="button" className="class-setup-meeting-rename" aria-label={`Rename ${title}`} onClick={() => beginEditing(false)}><Pencil size={17} aria-hidden="true" /></button>}
  </div>;
}

export default function ClassSetup({ initial, today, canUpload, onSave, onClose, initialBounds }: {
  initial: Course; today: string; canUpload: boolean;
  onSave: (course: Course, details: CourseDetails, uploads: ClassSetupUploads) => Promise<void>;
  onClose: () => void;
  initialBounds?: ClassSetupBounds;
}) {
  const creditsId = useId();
  const [course, setCourse] = useState(initial);
  const [initialDetails] = useState<CourseDetails>(() => ({ ...emptyCourseDetails(), meetings: [{ id: crypto.randomUUID(), days: [], start: "09:00", end: "10:00", from: today, until: addDays(today, 90), location: initial.room }] }));
  const [details, setDetails] = useState<CourseDetails>(initialDetails);
  const [selectedMeetingId, setSelectedMeetingId] = useState(initialDetails.meetings[0].id);
  const [expandedSkipDates, setExpandedSkipDates] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [uploads, setUploads] = useState<ClassSetupUploads>({});
  const [imagePreview, setImagePreview] = useState("");
  const imageUrlRef = useRef("");
  const [syllabusPreview, setSyllabusPreview] = useState("");
  const syllabusUrlRef = useRef("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [draggingImage, setDraggingImage] = useState(false);
  const imageDragRef = useRef<{ pointerId: number; startX: number; startY: number; width: number; height: number; framing: CourseImageFraming } | null>(null);
  const suppressImageClickRef = useRef(false);
  const [error, setError] = useState("");
  const [checkedSteps, setCheckedSteps] = useState<number[]>([]);
  const focusMissingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const transition = useClassSetupMotion(formRef, step, initialBounds);
  const meetingFocusRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const dirty = JSON.stringify(course) !== JSON.stringify(initial) || JSON.stringify(details) !== JSON.stringify(initialDetails) || Boolean(uploads.image || uploads.syllabus);
  useSaveProtection(dirty || busy);
  const close = () => { if (!formRef.current?.closest("[data-modal-exiting]") && !saving.current && (!dirty || window.confirm("Discard this class setup? Selected files have not been uploaded unless you already tried saving."))) onClose(); };
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not(.class-setup-hidden-input), textarea:not(:disabled), iframe, a[href], [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); formRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    if (!focusMissingRef.current) return;
    focusMissingRef.current = false;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid?.matches("input") ? invalid : invalid?.querySelector<HTMLElement>("button"))?.focus();
  });
  useEffect(() => {
    if (meetingFocusRef.current === null) return;
    const target = [...(formRef.current?.querySelectorAll<HTMLButtonElement>(".class-setup-meeting-select") ?? [])].find((button) => button.dataset.meetingId === meetingFocusRef.current);
    (target ?? formRef.current?.querySelector<HTMLButtonElement>(".class-setup-add-meeting"))?.focus();
    meetingFocusRef.current = null;
  }, [details.meetings]);
  useEffect(() => () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    if (syllabusUrlRef.current) URL.revokeObjectURL(syllabusUrlRef.current);
  }, []);
  useEffect(() => {
    if (!imagePreview) return;
    const image = new window.Image();
    image.onload = () => setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = imagePreview;
    return () => { image.onload = null; };
  }, [imagePreview]);

  const changeCourse = (patch: Partial<Course>) => setCourse((current) => ({ ...current, ...patch }));
  const changeMeeting = (id: string, patch: Partial<Meeting>) => setDetails((current) => ({ ...current, meetings: current.meetings.map((meeting) => meeting.id === id ? { ...meeting, ...patch } : meeting) }));
  const selectedMeeting = details.meetings.find((meeting) => meeting.id === selectedMeetingId) ?? details.meetings[0];
  const selectedMeetingIndex = details.meetings.findIndex((meeting) => meeting.id === selectedMeeting?.id);
  const removeMeeting = (id: string) => {
    const index = details.meetings.findIndex((meeting) => meeting.id === id);
    const meetings = details.meetings.filter((meeting) => meeting.id !== id);
    setDetails((current) => ({ ...current, meetings }));
    const nextSelectedId = selectedMeeting?.id === id ? meetings[Math.min(index, meetings.length - 1)]?.id ?? "" : selectedMeeting?.id ?? "";
    setSelectedMeetingId(nextSelectedId);
    meetingFocusRef.current = nextSelectedId;
    setExpandedSkipDates((current) => current.filter((meetingId) => meetingId !== id));
    setError("");
  };
  const addMeeting = () => {
    const meeting = { id: crypto.randomUUID(), days: [], start: "09:00", end: "10:00", from: today, until: addDays(today, 90), location: course.room };
    setDetails((current) => ({ ...current, meetings: [...current.meetings, meeting] }));
    setSelectedMeetingId(meeting.id);
    setError("");
  };
  const isMissing = (value: string | number) => checkedSteps.includes(step) && !String(value).trim();
  const requiredMarker = (missing: boolean) => <span aria-hidden="true" className={missing ? "class-setup-required is-missing" : "class-setup-required"}> *</span>;
  const field = (label: string, value: string | number, onChange: (value: string) => void, type = "text", required = false, maxLength = 160, placeholder?: string) => <label><span>{label}{required && requiredMarker(isMissing(value))}</span><input type={type} value={value} placeholder={placeholder} required={required} aria-invalid={required && isMissing(value) ? true : undefined} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} {...(type === "number" ? { min: 0, max: 30, step: 1 } : {})} /></label>;
  const startImageDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    suppressImageClickRef.current = false;
    if (!uploads.image || !details.imageFraming || !imageSize || busy || attemptedSave || event.button !== 0 || event.isPrimary === false || (event.target as HTMLElement).closest(".class-setup-image-affordance")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    imageDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: bounds.width, height: bounds.height, framing: details.imageFraming };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingImage(true);
  };
  const moveImageDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !imageSize || busy || attemptedSave) return;
    const deltaX = event.clientX - drag.startX, deltaY = event.clientY - drag.startY;
    if (Math.hypot(deltaX, deltaY) < 3 && !suppressImageClickRef.current) return;
    suppressImageClickRef.current = true;
    const imageFraming = moveCourseImage(drag.framing, deltaX, deltaY, drag.width, drag.height, imageSize.width, imageSize.height);
    setDetails((current) => ({ ...current, imageFraming }));
  };
  const finishImageDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (imageDragRef.current?.pointerId !== event.pointerId) return;
    imageDragRef.current = null;
    setDraggingImage(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const moveImageWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const framing = details.imageFraming;
    if (!uploads.image || !framing || busy || attemptedSave || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const delta = event.shiftKey ? 10 : 2;
    const x = Math.max(0, Math.min(100, framing.x + (event.key === "ArrowLeft" ? delta : event.key === "ArrowRight" ? -delta : 0)));
    const y = Math.max(0, Math.min(100, framing.y + (event.key === "ArrowUp" ? delta : event.key === "ArrowDown" ? -delta : 0)));
    setDetails((current) => ({ ...current, imageFraming: { ...framing, x, y } }));
  };
  const selectFile = (kind: keyof ClassSetupUploads, file?: File) => {
    setError("");
    if (!file) return;
    if (!file.size || file.size > MAX_FILE_BYTES) { setError("Choose a nonempty file of 25 MiB or smaller."); return; }
    if (kind === "image" && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { setError("Choose a PNG, JPEG, WebP, or GIF class image."); return; }
    const id = crypto.randomUUID();
    if (kind === "image") {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = URL.createObjectURL(file);
      setImagePreview(imageUrlRef.current);
      setImageSize(null);
      setDetails((current) => ({ ...current, imageFraming: { ...DEFAULT_COURSE_IMAGE_FRAMING, fileId: id } }));
    } else {
      if (syllabusUrlRef.current) URL.revokeObjectURL(syllabusUrlRef.current);
      syllabusUrlRef.current = URL.createObjectURL(/\.pdf$/i.test(file.name) ? file.slice(0, file.size, "application/pdf") : file);
      setSyllabusPreview(syllabusUrlRef.current);
    }
    setUploads((current) => ({ ...current, [kind]: { file, id } }));
  };
  const submit = async () => {
    if (saving.current || formRef.current?.closest("[data-modal-exiting]")) return;
    setError("");
    setCheckedSteps((current) => current.includes(step) ? current : [...current, step]);
    if (!course.code.trim() || !course.name.trim()) {
      setCheckedSteps((current) => current.includes(0) ? current : [...current, 0]);
      setStep(0);
      focusMissingRef.current = true;
      return;
    }
    try {
      const validated = validateCourse({ ...course, initials: course.code.slice(0, 2).toUpperCase(), soft: `${course.color}18` });
      if (step === 1 || step === 2) {
        const missingMeeting = details.meetings.find(hasMissingMeetingFields);
        const invalidMeeting = missingMeeting ?? details.meetings.find((meeting) => !isMeetingComplete(meeting));
        if (invalidMeeting) {
          setSelectedMeetingId(invalidMeeting.id);
          setStep(1);
        }
        if (missingMeeting) {
          setCheckedSteps((current) => current.includes(1) ? current : [...current, 1]);
          focusMissingRef.current = true;
          return;
        }
        validateCourseDetails(details);
      }
      if (step < 2) { transition(() => setStep(step + 1)); return; }
      saving.current = true; setBusy(true); setAttemptedSave(true);
      const preview = formRef.current?.querySelector<HTMLElement>(".class-setup-image-button");
      const bounds = preview?.getBoundingClientRect();
      const imageFraming = details.imageFraming && imageSize && bounds && bounds.width > 0 && bounds.height > 0
        ? { ...details.imageFraming, imageAspectRatio: imageSize.width / imageSize.height, frameAspectRatio: bounds.width / bounds.height } : details.imageFraming;
      await onSave(validated, { ...details, imageFraming }, uploads);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this class. Your setup is still here; please retry."); }
    finally { saving.current = false; setBusy(false); }
  };

  return <div className="modal-backdrop"><form ref={formRef} noValidate data-morphing-entry={initialBounds ? true : undefined} className={`add-class-modal academic-editor class-setup${step === 1 ? " class-setup-schedule-step" : step === 2 ? " class-setup-customize-step" : ""}`} role="dialog" aria-modal="true" aria-labelledby="class-setup-title" aria-busy={busy} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h2 className="class-setup-accessible-title" id="class-setup-title" ref={headingRef} tabIndex={-1}>{steps[step]}</h2>
    <div className="modal-header class-setup-header">
      <ol className="class-setup-progress" aria-label="Class setup progress">{steps.map((label, index) => <li key={label} aria-label={`${label}${index < step ? ", completed" : ""}`} aria-current={step === index ? "step" : undefined} className={index < step ? "is-complete" : undefined}>
        {index < step ? <CircleCheck className="class-setup-step-indicator" size={18} aria-hidden="true" /> : <Circle className="class-setup-step-indicator" size={18} aria-hidden="true" />}
        <span>{stepLabels[index]}</span>
        {index < steps.length - 1 && <ChevronRight className="class-setup-step-separator" size={18} aria-hidden="true" />}
      </li>)}</ol>
      <button type="button" className="secondary-button" disabled={busy} aria-label="Close class setup" onClick={close}><X size={18} /></button>
    </div>
    <fieldset className="class-setup-body" disabled={busy}>
      {step === 0 && <div className="settings-form-grid class-setup-info-grid">{field("Course code", course.code, (code) => changeCourse({ code }), "text", true, 30, "ECON001")}{field("Class name", course.name, (name) => changeCourse({ name }), "text", true, 160, "Principles of Microeconomics")}<div className="class-setup-credits-field"><label htmlFor={creditsId}>Credits</label><input id={creditsId} type="number" min={0} max={30} step={1} value={course.credits} onChange={(event) => changeCourse({ credits: Number(event.target.value) })} /></div>{field("Instructor", course.instructor, (instructor) => changeCourse({ instructor }), "text", false, 160, "Dr. John Smith")}<LocationInput value={course.room} onChange={(room) => changeCourse({ room })} placeholder="Enter an address or meeting link" />{field("Office hours (Zoom link, location, etc.)", details.officeHours, (officeHours) => setDetails({ ...details, officeHours }), "text", false, 2000)}<label className="class-setup-meeting-notes">Meeting Notes<input type="text" maxLength={2000} value={details.meetingNotes ?? ""} onChange={(event) => setDetails({ ...details, meetingNotes: event.target.value })} /></label></div>}
      {step === 1 && <div className="class-setup-schedule">
        <aside className="class-setup-meetings" aria-label="Class meetings">
          <div className="class-setup-meeting-list">
            {details.meetings.map((meeting, index) => <div className={`class-setup-meeting-card${selectedMeeting?.id === meeting.id ? " is-selected" : ""}`} key={meeting.id}>
              <button type="button" className="class-setup-meeting-select" data-meeting-id={meeting.id} aria-label={`Select meeting ${index + 1}`} aria-describedby={`meeting-name-${meeting.id} meeting-days-${meeting.id} meeting-time-${meeting.id} meeting-status-${meeting.id}`} aria-pressed={selectedMeeting?.id === meeting.id} aria-controls="class-setup-meeting-editor" onClick={() => setSelectedMeetingId(meeting.id)}>
                <strong id={`meeting-name-${meeting.id}`}>{meeting.name || `Meeting ${index + 1}`}</strong>
                <span id={`meeting-days-${meeting.id}`}>{meeting.days.length ? meeting.days.map((day) => weekdays[day].slice(0, 3)).join(", ") : "Choose meeting days"}</span>
                <span id={`meeting-time-${meeting.id}`}>{formatMeetingTime(meeting.start)} – {formatMeetingTime(meeting.end)}</span>
                <span id={`meeting-status-${meeting.id}`} className="class-setup-accessible-title">{isMeetingComplete(meeting) ? "Complete" : "Incomplete"}</span>
                {isMeetingComplete(meeting) && <CircleCheck className="class-setup-meeting-complete" size={18} aria-label="Complete" />}
              </button>
              <button type="button" className="class-setup-meeting-delete" aria-label={`Delete meeting ${index + 1}`} onClick={() => removeMeeting(meeting.id)}><Trash2 size={17} aria-hidden="true" /></button>
            </div>)}
          </div>
          <button type="button" className="secondary-button class-setup-add-meeting" disabled={details.meetings.length >= 30} onClick={addMeeting}><Plus size={18} aria-hidden="true" />Add meeting</button>
        </aside>
        {selectedMeeting ? <section className="class-setup-meeting" id="class-setup-meeting-editor" key={selectedMeeting.id} aria-label={selectedMeeting.name || `Meeting ${selectedMeetingIndex + 1}`}>
          <MeetingTitle title={selectedMeeting.name || `Meeting ${selectedMeetingIndex + 1}`} onRename={(name) => changeMeeting(selectedMeeting.id, { name: name || undefined })} />
          <div className="class-setup-week" role="group" aria-label={`Weekdays for meeting ${selectedMeetingIndex + 1}`} aria-invalid={checkedSteps.includes(1) && !selectedMeeting.days.length ? true : undefined}>{weekdays.map((day, dayIndex) => <button type="button" key={day} aria-label={day} aria-pressed={selectedMeeting.days.includes(dayIndex)} onClick={() => changeMeeting(selectedMeeting.id, { days: selectedMeeting.days.includes(dayIndex) ? selectedMeeting.days.filter((value) => value !== dayIndex) : [...selectedMeeting.days, dayIndex].sort() })}>{day.slice(0, 3)}</button>)}</div>
          <div className="settings-form-grid class-setup-meeting-fields">
            {field("Start time", selectedMeeting.start, (start) => changeMeeting(selectedMeeting.id, { start }), "time", true)}
            {field("End time", selectedMeeting.end, (end) => changeMeeting(selectedMeeting.id, { end }), "time", true)}
            {field("Classes start", selectedMeeting.from, (from) => changeMeeting(selectedMeeting.id, { from }), "date", true)}
            {field("Classes end", selectedMeeting.until, (until) => changeMeeting(selectedMeeting.id, { until }), "date", true)}
            {field("Meeting location", selectedMeeting.location, (location) => changeMeeting(selectedMeeting.id, { location }))}
          </div>
          <div className="class-setup-skip-dates">
            <button type="button" className="secondary-button class-setup-skip-toggle" aria-expanded={expandedSkipDates.includes(selectedMeeting.id)} aria-controls="class-setup-skip-content" onClick={() => setExpandedSkipDates((current) => current.includes(selectedMeeting.id) ? current.filter((id) => id !== selectedMeeting.id) : [...current, selectedMeeting.id])}><CalendarDays size={19} aria-hidden="true" /><span>Skip dates ({selectedMeeting.excludedDates?.length ?? 0})</span><ChevronDown size={19} aria-hidden="true" /></button>
            {expandedSkipDates.includes(selectedMeeting.id) && <div className="class-setup-skip-content" id="class-setup-skip-content">
              <p className="form-hint">No class on these dates.</p>
              {(selectedMeeting.excludedDates ?? []).map((date, exceptionIndex) => <div className="class-setup-exception" key={exceptionIndex}><label><span>Exception date {exceptionIndex + 1}{requiredMarker(isMissing(date))}</span><input type="date" required aria-invalid={isMissing(date) ? true : undefined} min={selectedMeeting.from} max={selectedMeeting.until} value={date} onChange={(event) => changeMeeting(selectedMeeting.id, { excludedDates: selectedMeeting.excludedDates!.map((current, currentIndex) => currentIndex === exceptionIndex ? event.target.value : current) })} /></label><button type="button" className="secondary-button" aria-label={`Remove exception ${exceptionIndex + 1}`} onClick={() => changeMeeting(selectedMeeting.id, { excludedDates: selectedMeeting.excludedDates!.filter((_, currentIndex) => currentIndex !== exceptionIndex) })}><X size={16} aria-hidden="true" /></button></div>)}
              <button type="button" className="secondary-button" disabled={(selectedMeeting.excludedDates?.length ?? 0) >= 100} onClick={() => changeMeeting(selectedMeeting.id, { excludedDates: [...(selectedMeeting.excludedDates ?? []), ""] })}><Plus size={14} aria-hidden="true" />Add exception</button>
            </div>}
          </div>
        </section> : <section className="class-setup-schedule-empty" id="class-setup-meeting-editor"><CalendarDays size={32} aria-hidden="true" /><h3>No scheduled meetings</h3><p>Add a meeting for live classes, or continue without one for an asynchronous course.</p></section>}
      </div>}
      {step === 2 && <>
        <div className="class-setup-customize">
          <section className="class-setup-appearance" aria-label="Class appearance">
            <p className="class-setup-panel-title">Live card preview</p>
            <div className="class-setup-card-controls">
              <div className="class-setup-card-column">
                <div className="class-card class-setup-card" aria-label="Class card preview">
                  <button type="button" className={`class-card-visual class-setup-image-button${uploads.image ? " has-image" : ""}`} data-dragging={draggingImage || undefined} aria-label={uploads.image ? "Change class image" : "Add class image"} title={uploads.image ? "Drag to position the image, or use the arrow keys. Click to replace it." : "Choose a class image"} disabled={!canUpload || busy || attemptedSave} onPointerDown={startImageDrag} onPointerMove={moveImageDrag} onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag} onLostPointerCapture={finishImageDrag} onKeyDown={moveImageWithKeyboard} onClick={() => { if (suppressImageClickRef.current) { suppressImageClickRef.current = false; return; } imageInputRef.current?.click(); }}>
                    <div className="class-setup-card-media" style={{ background: `linear-gradient(135deg, ${course.color}18, color-mix(in srgb, ${course.color} 18%, white))` }}>
                      {uploads.image && imagePreview && <div className="class-setup-cover" role="img" aria-label="Selected class cover" style={{ backgroundImage: `url(${imagePreview})`, ...courseImageFramingStyle(details.imageFraming) }} />}
                    </div>
                    <span className="course-watermark" aria-hidden="true">{course.code.slice(0, 2).toUpperCase()}</span>
                    <span className="course-pill" style={{ color: course.color }}>{course.code}</span>
                    <CourseIcon icon={details.icon} size={34} style={{ color: course.color }} aria-hidden="true" />
                    <span className="class-setup-image-affordance"><ImagePlus size={14} />Change image</span>
                  </button>
                  <ClassCardBody course={course} />
                </div>
                <input ref={imageInputRef} className="class-setup-hidden-input" aria-label="Class image (optional)" type="file" disabled={!canUpload || busy || attemptedSave} accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { selectFile("image", event.target.files?.[0]); event.target.value = ""; }} />
                <div className="class-setup-color-row">
                  <label className="class-setup-color"><span>Class color</span><input aria-label="Class color" type="color" value={course.color} onChange={(event) => changeCourse({ color: event.target.value })} /></label>
                  <div className="class-setup-zoom">
                    <label><span>Image zoom <output>{Math.round((details.imageFraming?.zoom ?? 1) * 100)}%</output></span><input aria-label="Image zoom" type="range" min="1" max="3" step="0.01" value={details.imageFraming?.zoom ?? 1} disabled={!uploads.image || attemptedSave || busy} onChange={(event) => { const zoom = Number(event.target.value); setDetails((current) => current.imageFraming ? { ...current, imageFraming: { ...current.imageFraming, zoom } } : current); }} /></label>
                    {uploads.image && <button type="button" className="text-button" disabled={attemptedSave} onClick={() => { if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = ""; setImagePreview(""); setImageSize(null); setDetails((current) => ({ ...current, imageFraming: undefined })); setUploads((current) => ({ ...current, image: undefined })); }}>Remove image</button>}
                  </div>
                </div>
              </div>
              <fieldset className="course-icon-picker class-setup-icon-picker"><legend>Class icon</legend><div className="course-icon-options">{courseIconOptions.map((option) => <button key={option.id} type="button" title={option.label} aria-label={option.label} aria-pressed={(details.icon ?? DEFAULT_COURSE_ICON) === option.id} onClick={() => setDetails((current) => ({ ...current, icon: option.id }))}><CourseIcon icon={option.id} size={24} style={{ color: course.color }} />{(details.icon ?? DEFAULT_COURSE_ICON) === option.id && <Check className="course-icon-selected" size={11} />}</button>)}</div></fieldset>
            </div>
          </section>
          <fieldset className="class-setup-syllabus" disabled={attemptedSave}>
            <legend>Syllabus <span>(optional)</span></legend>
            <label className={`class-setup-syllabus-upload${uploads.syllabus ? " has-file" : ""}`}>
              <FileText size={24} aria-hidden="true" /><span>{uploads.syllabus ? "Replace syllabus" : "Upload your syllabus"}<small>PDF, text, images, or other documents · Up to 25 MiB</small></span>
              <input aria-label="Syllabus (optional)" type="file" disabled={!canUpload || busy} onChange={(event) => { selectFile("syllabus", event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            {uploads.syllabus ? <><div className="class-setup-file"><span>{uploads.syllabus.file.name}</span><button type="button" className="text-button" onClick={() => { if (syllabusUrlRef.current) URL.revokeObjectURL(syllabusUrlRef.current); syllabusUrlRef.current = ""; setSyllabusPreview(""); setUploads((current) => ({ ...current, syllabus: undefined })); }}>Remove syllabus</button></div><ClassSetupDocumentPreview key={uploads.syllabus.id} file={uploads.syllabus.file} url={syllabusPreview} onEscape={() => closeRef.current()} /></> : <div className="class-setup-document-empty"><FileText size={36} aria-hidden="true" /><p>Your document preview appears here</p><span>Upload a syllabus to see it before saving.</span></div>}
            <p className="form-hint">Storage only. Uploading will not change your course, schedule, or assignments.</p>
          </fieldset>
        </div>
        {!canUpload && <p className="form-hint">File uploads are unavailable until your workspace is saved. You can still create this class and attach files later.</p>}
      </>}
    </fieldset>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {attemptedSave && !busy && error && <p className="form-hint">Selected files are locked for safe retries because some attachments may already be saved. Retry to finish, or close setup and manage saved attachments from the class files.</p>}
    <div className="modal-actions class-setup-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { if (step) { transition(() => { setStep(step - 1); setError(""); }); } else close(); }}>{step ? <><ArrowLeft size={16} />Back</> : "Cancel"}</button><span>{step + 1} / 3</span><button className="primary-button" disabled={busy}>{busy ? "Saving class…" : step === 2 ? "Create class" : <>Continue<ArrowRight size={16} /></>}</button></div>
  </form></div>;
}
