"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronRight, Circle, CircleCheck, FileText, ImagePlus, Plus, Slash, Trash2, X } from "lucide-react";
import { addDays, assignmentTypes, dateLabel, emptyCourseDetails, isDate, isTime, validateCourse, validateCourseDetails, type Course, type CourseDetails, type Meeting } from "../lib/academics";
import { mergeCourseworkAssignments, validateAssignmentGrading, validateGradingCategories } from "../lib/coursework";
import type { SavedAssignment } from "../lib/workspace-codec";
import { courseIconOptions, DEFAULT_COURSE_ICON } from "../lib/course-icons";
import { courseImageFramingStyle, DEFAULT_COURSE_IMAGE_FRAMING, moveCourseImage, type CourseImageFraming } from "../lib/course-image-framing";
import { MAX_FILE_BYTES } from "../lib/files";
import CourseIcon from "./course-icon";
import LocationInput from "./location-input";
import ClassCardBody from "./class-card-body";
import ClassSetupDocumentPreview from "./class-setup-document-preview";
import ClassCoursework from "./class-coursework";
import ClassGradingCategories from "./class-grading-categories";
import ClassSetupTitle from "./class-setup-title";
import { useSaveProtection } from "./use-save-protection";
import { useClassSetupMotion, type ClassSetupBounds } from "./use-class-setup-motion";
import "./course-icon-picker.css";
import "./class-setup.css";

export type ClassSetupUpload = { file: File; id: string };
export type ClassSetupUploads = { image?: ClassSetupUpload; syllabus?: ClassSetupUpload };
const steps = ["Course information", "Class schedule", "Set up your coursework", "Add assignments", "Make it yours"];
const stepLabels = ["Info", "Schedule", "Categories", "Assignments", "Customize"];
const assignmentDraftJson = (assignments: SavedAssignment[]) => JSON.stringify(assignments, (_key, value: unknown) => typeof value === "number" && !Number.isFinite(value) ? "invalid-number" : value);
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

export default function ClassSetup({ initial, initialDetails: savedDetails, initialAssignments = [], editing = false, savedImageId, savedImageUrl, savedSyllabusPreview, today, canUpload, onSave, onClose, onDelete, initialBounds }: {
  initial: Course; today: string; canUpload: boolean;
  initialDetails?: CourseDetails;
  initialAssignments?: SavedAssignment[];
  editing?: boolean;
  savedImageId?: string;
  savedImageUrl?: string;
  savedSyllabusPreview?: ReactNode;
  onSave: (course: Course, details: CourseDetails, uploads: ClassSetupUploads, assignments: SavedAssignment[]) => Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
  initialBounds?: ClassSetupBounds;
}) {
  const creditsId = useId();
  const skipDatePickerId = useId();
  const [course, setCourse] = useState(initial);
  const [initialDetails] = useState<CourseDetails>(() => {
    const draft = savedDetails ?? { ...emptyCourseDetails(), meetings: [{ id: crypto.randomUUID(), days: [], start: "09:00", end: "10:00", from: today, until: addDays(today, 90), location: initial.room }] };
    return editing || draft.gradingCategories !== undefined ? draft : {
      ...draft,
      gradingCategories: ["Assignments", "Exam", "Attendance"].map((name) => ({ id: crypto.randomUUID(), name, weight: 0 })),
    };
  });
  const [details, setDetails] = useState<CourseDetails>(initialDetails);
  const [originalAssignments] = useState(() => initialAssignments.filter((assignment) => assignment.courseId === initial.id));
  const [assignments, setAssignments] = useState(originalAssignments);
  const [selectedMeetingId, setSelectedMeetingId] = useState(initialDetails.meetings[0]?.id ?? "");
  const [skipDatePickerFallback, setSkipDatePickerFallback] = useState(false);
  const [step, setStep] = useState(0);
  const [checkedCategoryAllocation, setCheckedCategoryAllocation] = useState(false);
  const gradingCategories = details.gradingCategories ?? [];
  const categoryWeightTotal = gradingCategories.reduce((sum, category) => sum + category.weight, 0);
  const categoryAllocationMissing = !editing && categoryWeightTotal !== 100;
  const showCategoryAllocationError = checkedCategoryAllocation && categoryAllocationMissing;
  const [uploads, setUploads] = useState<ClassSetupUploads>({});
  const [imagePreview, setImagePreview] = useState("");
  const currentImagePreview = uploads.image ? imagePreview : savedImageUrl ?? "";
  const currentImageId = uploads.image?.id ?? savedImageId;
  const currentImageFraming = details.imageFraming && (!currentImageId || details.imageFraming.fileId === currentImageId)
    ? details.imageFraming : currentImageId ? { ...DEFAULT_COURSE_IMAGE_FRAMING, fileId: currentImageId } : undefined;
  const imageUrlRef = useRef("");
  const [syllabusPreview, setSyllabusPreview] = useState("");
  const syllabusUrlRef = useRef("");
  const hasSavedSyllabus = !details.syllabusDeleted && Boolean(savedSyllabusPreview || details.syllabusFileId || details.syllabusText || details.syllabusName);
  const hasCurrentSyllabus = Boolean(uploads.syllabus || hasSavedSyllabus);
  const currentSyllabusName = uploads.syllabus?.file.name ?? (details.syllabusDeleted ? undefined : details.syllabusName ?? (hasSavedSyllabus ? "Saved syllabus" : undefined));
  const imageInputRef = useRef<HTMLInputElement>(null);
  const skipDatePickerRef = useRef<HTMLInputElement>(null);
  const skipDateFocusRef = useRef<{ meetingId: string; index: number | null } | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [draggingImage, setDraggingImage] = useState(false);
  const imageDragRef = useRef<{ pointerId: number; startX: number; startY: number; width: number; height: number; framing: CourseImageFraming } | null>(null);
  const suppressImageClickRef = useRef(false);
  const [error, setError] = useState("");
  const [checkedSteps, setCheckedSteps] = useState<number[]>([]);
  const [courseworkValidationAttempt, setCourseworkValidationAttempt] = useState(0);
  const focusMissingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const transition = useClassSetupMotion(formRef, step, initialBounds);
  const meetingFocusRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const dirty = JSON.stringify(course) !== JSON.stringify(initial) || JSON.stringify(details) !== JSON.stringify(initialDetails) || assignmentDraftJson(assignments) !== assignmentDraftJson(originalAssignments) || Boolean(uploads.image || uploads.syllabus);
  useSaveProtection(dirty || busy);
  const close = () => { if (!formRef.current?.closest("[data-modal-exiting]") && !saving.current && (!dirty || window.confirm("Discard this class setup? Selected files have not been uploaded unless you already tried saving."))) onClose(); };
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not(.class-setup-hidden-input), select:not(:disabled), textarea:not(:disabled), iframe, a[href], [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); formRef.current?.focus(); return; }
      if (!formRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); last?.focus(); }
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
    (invalid?.matches('input, select, textarea, [contenteditable="plaintext-only"]') ? invalid : invalid?.querySelector<HTMLElement>("button"))?.focus();
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
    if (!currentImagePreview) return;
    const image = new window.Image();
    image.onload = () => setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = currentImagePreview;
    return () => { image.onload = null; };
  }, [currentImagePreview]);

  const changeCourse = (patch: Partial<Course>) => setCourse((current) => ({ ...current, ...patch }));
  const changeMeeting = (id: string, patch: Partial<Meeting>) => setDetails((current) => ({ ...current, meetings: current.meetings.map((meeting) => meeting.id === id ? { ...meeting, ...patch } : meeting) }));
  const selectedMeeting = details.meetings.find((meeting) => meeting.id === selectedMeetingId) ?? details.meetings[0];
  const selectedMeetingIndex = details.meetings.findIndex((meeting) => meeting.id === selectedMeeting?.id);
  useEffect(() => {
    const pending = skipDateFocusRef.current;
    if (!pending) return;
    if (pending.meetingId !== selectedMeeting?.id) { skipDateFocusRef.current = null; return; }
    const buttons = [...(formRef.current?.querySelectorAll<HTMLButtonElement>(".class-setup-skip-chip-remove") ?? [])];
    (pending.index === null ? formRef.current?.querySelector<HTMLButtonElement>(".class-setup-skip-toggle") : buttons[pending.index])?.focus();
    skipDateFocusRef.current = null;
  }, [selectedMeeting?.id, selectedMeeting?.excludedDates]);
  useEffect(() => {
    if (skipDatePickerFallback) skipDatePickerRef.current?.focus();
  }, [skipDatePickerFallback]);
  const openSkipDatePicker = () => {
    if (!selectedMeeting || (selectedMeeting.excludedDates?.length ?? 0) >= 100) return;
    const input = skipDatePickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    if (skipDatePickerFallback) { input.focus(); return; }
    if (typeof input.showPicker !== "function") {
      setSkipDatePickerFallback(true);
      return;
    }
    try { input.showPicker(); }
    catch {
      setSkipDatePickerFallback(true);
    }
  };
  const addSkipDate = (date: string) => {
    if (!selectedMeeting || !date || !isDate(date) || date < selectedMeeting.from || date > selectedMeeting.until) return;
    const dates = selectedMeeting.excludedDates ?? [];
    if (dates.includes(date) || dates.length >= 100) return;
    changeMeeting(selectedMeeting.id, { excludedDates: [...dates, date].sort() });
  };
  const removeSkipDate = (index: number) => {
    if (!selectedMeeting) return;
    const dates = selectedMeeting.excludedDates ?? [];
    skipDateFocusRef.current = { meetingId: selectedMeeting.id, index: dates.length <= 1 ? null : index === dates.length - 1 ? index - 1 : index };
    changeMeeting(selectedMeeting.id, { excludedDates: dates.filter((_, currentIndex) => currentIndex !== index) });
  };
  const removeMeeting = (id: string) => {
    const index = details.meetings.findIndex((meeting) => meeting.id === id);
    const meetings = details.meetings.filter((meeting) => meeting.id !== id);
    setDetails((current) => ({ ...current, meetings }));
    const nextSelectedId = selectedMeeting?.id === id ? meetings[Math.min(index, meetings.length - 1)]?.id ?? "" : selectedMeeting?.id ?? "";
    setSelectedMeetingId(nextSelectedId);
    meetingFocusRef.current = nextSelectedId;
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
    if (!currentImagePreview || !currentImageFraming || !imageSize || busy || attemptedSave || event.button !== 0 || event.isPrimary === false || (event.target as HTMLElement).closest(".class-setup-image-affordance")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    imageDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: bounds.width, height: bounds.height, framing: currentImageFraming };
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
    const framing = currentImageFraming;
    if (!currentImagePreview || !framing || busy || attemptedSave || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
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
    if (kind === "syllabus" && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { setError("Choose a PDF syllabus."); return; }
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
  const removeSyllabus = () => {
    if (!canUpload || busy || attemptedSave) return;
    if (syllabusUrlRef.current) URL.revokeObjectURL(syllabusUrlRef.current);
    syllabusUrlRef.current = "";
    setSyllabusPreview("");
    setUploads((current) => ({ ...current, syllabus: undefined }));
    if (hasSavedSyllabus || details.syllabusDeleted) {
      setDetails((current) => ({ ...current, syllabusDeleted: true, syllabusText: undefined, syllabusName: undefined, syllabusFileId: undefined }));
    }
  };
  const validateCourseDraft = () => validateCourse({
    ...course,
    initials: editing && course.code === initial.code ? initial.initials : course.code.slice(0, 2).toUpperCase(),
    soft: editing && course.color === initial.color ? initial.soft : `${course.color}18`,
  });
  const validateSchedule = () => validateCourseDetails({ ...details, gradingCategories: undefined });
  const validateAssignments = (categories: typeof gradingCategories) => {
    const categoryIds = new Set(categories.map((category) => category.id));
    for (const assignment of assignments) {
      if (!assignment.title.trim() || assignment.title.length > 500) throw new Error("Enter a task title of up to 500 characters.");
      if (assignment.description.length > 20000) throw new Error(`Shorten the description for ${assignment.title}.`);
      if ((assignment.dateKey && !isDate(assignment.dateKey)) || (assignment.dueTime && (!assignment.dateKey || !isTime(assignment.dueTime)))) throw new Error(`Set a valid due date and time for ${assignment.title}, or leave both blank.`);
      if (assignment.type !== undefined && !assignmentTypes.includes(assignment.type)) throw new Error(`Choose a task type for ${assignment.title}.`);
      if (assignment.categoryId && !categoryIds.has(assignment.categoryId)) throw new Error(`Choose a category for ${assignment.title}, or leave it uncategorized.`);
      if (assignment.status === "done" && assignment.progress !== 100) throw new Error(`Completed tasks must have 100% progress: ${assignment.title}.`);
      validateAssignmentGrading(assignment);
    }
    mergeCourseworkAssignments([], course.id, assignments);
  };
  const canAdvance = () => {
    try {
      validateCourseDraft();
      if (step >= 1) validateSchedule();
      if (step >= 2) {
        if (categoryAllocationMissing) return false;
        const categories = validateGradingCategories(gradingCategories);
        if (step === 3) validateAssignments(categories);
      }
      return true;
    } catch {
      return false;
    }
  };
  const isFinalStep = step === steps.length - 1;
  const highlightSubmit = editing || isFinalStep || canAdvance();
  const advanceLabel = step === 3 && !assignments.length ? "Skip for now"
    : editing ? (step === 3 ? "Continue to Customize" : "Continue") : "Next";
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
      const validated = validateCourseDraft();
      if (step >= 1) {
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
        validateSchedule();
      }
      let validatedDetails = details;
      let categories = gradingCategories;
      if (step >= 2) {
        if (categoryAllocationMissing) {
          setCheckedCategoryAllocation(true);
          setStep(2);
          return;
        }
        setCheckedCategoryAllocation(false);
        try {
          categories = validateGradingCategories(categories);
          validatedDetails = { ...details, ...(details.gradingCategories !== undefined ? { gradingCategories: categories } : {}) };
        } catch (failure) {
          setCheckedSteps((current) => current.includes(2) ? current : [...current, 2]);
          setStep(2);
          focusMissingRef.current = true;
          throw failure;
        }
      }
      if (step >= 3) {
        setCourseworkValidationAttempt((current) => current + 1);
        try {
          validateAssignments(categories);
        } catch (failure) {
          setCheckedSteps((current) => current.includes(3) ? current : [...current, 3]);
          setStep(3);
          focusMissingRef.current = true;
          throw failure;
        }
      }
      if (!isFinalStep) { transition(() => setStep(step + 1)); return; }
      saving.current = true; setBusy(true); setAttemptedSave(true);
      const preview = formRef.current?.querySelector<HTMLElement>(".class-setup-image-button");
      const bounds = preview?.getBoundingClientRect();
      const imageFraming = details.imageFraming && imageSize && bounds && bounds.width > 0 && bounds.height > 0
        ? { ...details.imageFraming, imageAspectRatio: imageSize.width / imageSize.height, frameAspectRatio: bounds.width / bounds.height } : details.imageFraming;
      await onSave(validated, { ...validatedDetails, imageFraming }, uploads, assignments);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this class. Your setup is still here; please retry."); }
    finally { saving.current = false; setBusy(false); }
  };

  return <div className="modal-backdrop"><form ref={formRef} noValidate data-morphing-entry={initialBounds ? true : undefined} className={`add-class-modal academic-editor class-setup${step === 1 ? " class-setup-schedule-step" : (step === 2 || step === 3) ? " class-setup-coursework-step" : step === 4 ? " class-setup-customize-step" : ""}`} role="dialog" aria-modal="true" aria-labelledby="class-setup-title" aria-busy={busy} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h2 className="class-setup-accessible-title" id="class-setup-title" ref={headingRef} tabIndex={-1}>{steps[step]}</h2>
    <div className="modal-header class-setup-header">
      <ol className="class-setup-progress" aria-label="Class setup progress">{steps.map((label, index) => <li key={label} aria-label={`${label}${index < step ? ", completed" : ""}`} aria-current={step === index ? "step" : undefined} className={index < step ? "is-complete" : undefined}>
        <button type="button" className="class-setup-step-button" aria-label={`Go to ${stepLabels[index]}`} disabled={busy || (!editing && index > step)} onClick={() => { if (index !== step) transition(() => { setStep(index); setError(""); }); }}>
          {index < step ? <CircleCheck className="class-setup-step-indicator" size={18} aria-hidden="true" /> : <Circle className="class-setup-step-indicator" size={18} aria-hidden="true" />}
          <span className="class-setup-step-label">{stepLabels[index]}</span>
        </button>
        {index < steps.length - 1 && <ChevronRight className="class-setup-step-separator" size={18} aria-hidden="true" />}
      </li>)}</ol>
      <button type="button" className="secondary-button" disabled={busy} aria-label="Close class setup" onClick={close}><X size={18} /></button>
    </div>
    <div className="class-setup-scroll"><fieldset className="class-setup-body" disabled={busy}>
      {step === 0 && <div className="settings-form-grid class-setup-info-grid">{field("Course code", course.code, (code) => changeCourse({ code }), "text", true, 30, "ECON001")}{field("Class name", course.name, (name) => changeCourse({ name }), "text", true, 160, "Principles of Microeconomics")}<div className="class-setup-credits-field"><label htmlFor={creditsId}>Credits</label><input id={creditsId} type="number" min={0} max={30} step={1} value={course.credits} onChange={(event) => changeCourse({ credits: Number(event.target.value) })} /></div>{field("Instructor", course.instructor, (instructor) => changeCourse({ instructor }), "text", false, 160, "Dr. John Smith")}<label className="class-setup-meeting-notes">Meeting Notes<input type="text" maxLength={2000} value={details.meetingNotes ?? ""} onChange={(event) => setDetails({ ...details, meetingNotes: event.target.value })} /></label></div>}
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
              <button type="button" className="icon-button class-setup-delete-button class-setup-meeting-delete" aria-label={`Delete meeting ${index + 1}`} onClick={() => removeMeeting(meeting.id)}><Trash2 size={17} aria-hidden="true" /></button>
            </div>)}
          </div>
          <button type="button" className="secondary-button class-setup-add-meeting" disabled={details.meetings.length >= 30} onClick={addMeeting}><Plus size={18} aria-hidden="true" />Add meeting</button>
        </aside>
        {selectedMeeting ? <section className="class-setup-meeting" id="class-setup-meeting-editor" key={selectedMeeting.id} aria-label={selectedMeeting.name || `Meeting ${selectedMeetingIndex + 1}`}>
          <ClassSetupTitle presets={["Lecture", "Lab", "Discussion", "Office Hours"]} title={selectedMeeting.name || `Meeting ${selectedMeetingIndex + 1}`} onRename={(name) => changeMeeting(selectedMeeting.id, { name: name || undefined })} />
          <div className="class-setup-week" role="group" aria-label={`Weekdays for meeting ${selectedMeetingIndex + 1}`} aria-invalid={checkedSteps.includes(1) && !selectedMeeting.days.length ? true : undefined}>{weekdays.map((day, dayIndex) => <button type="button" key={day} aria-label={day} aria-pressed={selectedMeeting.days.includes(dayIndex)} onClick={() => changeMeeting(selectedMeeting.id, { days: selectedMeeting.days.includes(dayIndex) ? selectedMeeting.days.filter((value) => value !== dayIndex) : [...selectedMeeting.days, dayIndex].sort() })}>{day.slice(0, 3)}</button>)}</div>
          <div className="settings-form-grid class-setup-meeting-fields">
            {field("Start time", selectedMeeting.start, (start) => changeMeeting(selectedMeeting.id, { start }), "time", true)}
            {field("End time", selectedMeeting.end, (end) => changeMeeting(selectedMeeting.id, { end }), "time", true)}
            {field("Classes start", selectedMeeting.from, (from) => changeMeeting(selectedMeeting.id, { from }), "date", true)}
            {field("Classes end", selectedMeeting.until, (until) => changeMeeting(selectedMeeting.id, { until }), "date", true)}
            <LocationInput value={selectedMeeting.location} label="Meeting location" onChange={(location) => changeMeeting(selectedMeeting.id, { location })} />
          </div>
          <div className="class-setup-skip-dates">
            <button type="button" className="secondary-button class-setup-skip-toggle" aria-label={`Skip dates (${selectedMeeting.excludedDates?.length ?? 0})`} disabled={(selectedMeeting.excludedDates?.length ?? 0) >= 100} onClick={openSkipDatePicker} />
            <div className="class-setup-skip-content">
              <CalendarDays size={18} aria-hidden="true" />
              <span className="class-setup-skip-label">Skip dates ({selectedMeeting.excludedDates?.length ?? 0})</span>
              <div className="class-setup-skip-chips" role="group" aria-label="Skip date chips">
                {(selectedMeeting.excludedDates ?? []).map((date, skipDateIndex) => {
                  const label = isDate(date) ? dateLabel(date) : date || "missing date";
                  return <span className="class-setup-skip-chip" key={`${date}-${skipDateIndex}`}><span>{label}</span><button type="button" className="class-setup-skip-chip-remove" aria-label={`Remove skip date ${label}`} onClick={() => removeSkipDate(skipDateIndex)}><X size={13} aria-hidden="true" /></button></span>;
                })}
              </div>
              <input ref={skipDatePickerRef} id={skipDatePickerId} className={skipDatePickerFallback ? "class-setup-skip-date-fallback" : "class-setup-hidden-input class-setup-skip-date-input"} tabIndex={skipDatePickerFallback ? 0 : -1} aria-label="Add skip date" type="date" min={selectedMeeting.from} max={selectedMeeting.until} disabled={(selectedMeeting.excludedDates?.length ?? 0) >= 100} onChange={(event) => {
                const date = event.currentTarget.value;
                if (!date || !isDate(date) || date < selectedMeeting.from || date > selectedMeeting.until) return;
                addSkipDate(date);
                event.currentTarget.value = "";
              }} />
            </div>
          </div>
        </section> : <section className="class-setup-schedule-empty" id="class-setup-meeting-editor"><CalendarDays size={32} aria-hidden="true" /><h3>No scheduled meetings</h3><p>Add a meeting for live classes, or continue without one for an asynchronous course.</p></section>}
      </div>}
      {step === 3 && <header className="class-coursework-intro">
        <p className="class-coursework-eyebrow">{editing ? "Edit class" : "Add class"} · {course.code}</p>
        <h3>{steps[step]}<span className="class-coursework-optional">Optional</span></h3>
        <p>Know what’s coming up? Add it now, or skip ahead and do this later.</p>
      </header>}
      {step === 2 && <ClassGradingCategories
        categories={gradingCategories}
        weightTotal={categoryWeightTotal}
        requireFullAllocation={!editing}
        showAllocationError={showCategoryAllocationError}
        onChange={(gradingCategories) => setDetails((current) => ({ ...current, gradingCategories }))}
        onWeightEdit={() => setCheckedCategoryAllocation(false)}
        onRemove={(category) => {
          setDetails((current) => ({ ...current, gradingCategories: current.gradingCategories?.filter((item) => item.id !== category.id) }));
          setAssignments((current) => current.map((assignment) => assignment.categoryId === category.id ? { ...assignment, categoryId: undefined } : assignment));
        }}
        disabled={busy}
        showErrors={checkedSteps.includes(2)}
      />}
      {step === 3 && <ClassCoursework courseId={course.id} today={today} categories={gradingCategories} assignments={assignments} onAssignmentsChange={setAssignments} disabled={busy} showErrors={checkedSteps.includes(3)} validationAttempt={courseworkValidationAttempt} />}
      {step === 4 && <>
        <div className="class-setup-customize">
          <section className="class-setup-appearance" aria-label="Class appearance">
            <p className="class-setup-panel-title">Live card preview</p>
            <div className="class-setup-card-controls">
              <div className="class-setup-card-column">
                <div className="class-card class-setup-card" aria-label="Class card preview">
                  <button type="button" className={`class-card-visual class-setup-image-button${currentImagePreview ? " has-image" : ""}`} data-dragging={draggingImage || undefined} aria-label={currentImagePreview ? "Change class image" : "Add class image"} title={currentImagePreview ? "Drag to position the image, or use the arrow keys. Click to replace it." : "Choose a class image"} disabled={!canUpload || busy || attemptedSave} onPointerDown={startImageDrag} onPointerMove={moveImageDrag} onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag} onLostPointerCapture={finishImageDrag} onKeyDown={moveImageWithKeyboard} onClick={() => { if (suppressImageClickRef.current) { suppressImageClickRef.current = false; return; } imageInputRef.current?.click(); }}>
                    <div className="class-setup-card-media" style={{ background: `linear-gradient(135deg, ${course.color}18, color-mix(in srgb, ${course.color} 18%, white))` }}>
                      {currentImagePreview && <div className="class-setup-cover" role="img" aria-label="Selected class cover" style={{ backgroundImage: `url(${currentImagePreview})`, ...courseImageFramingStyle(currentImageFraming) }} />}
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
                    <label><span>Image zoom <output>{Math.round((currentImageFraming?.zoom ?? 1) * 100)}%</output></span><input aria-label="Image zoom" type="range" min="1" max="3" step="0.01" value={currentImageFraming?.zoom ?? 1} disabled={!currentImagePreview || !currentImageFraming || attemptedSave || busy} onChange={(event) => { const zoom = Number(event.target.value); setDetails((current) => currentImageFraming ? { ...current, imageFraming: { ...currentImageFraming, zoom } } : current); }} /></label>
                    {uploads.image && <button type="button" className="text-button" disabled={attemptedSave} onClick={() => { if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = ""; setImagePreview(""); setImageSize(null); setDetails((current) => ({ ...current, imageFraming: initialDetails.imageFraming })); setUploads((current) => ({ ...current, image: undefined })); }}>Remove image</button>}
                  </div>
                </div>
              </div>
              <fieldset className="course-icon-picker class-setup-icon-picker"><legend>Class icon</legend><div className="course-icon-options">{courseIconOptions.map((option) => <button key={option.id} type="button" title={option.label} aria-label={option.label} aria-pressed={(details.icon ?? DEFAULT_COURSE_ICON) === option.id} onClick={() => setDetails((current) => ({ ...current, icon: option.id }))}>{option.id === "none" ? <Slash size={24} style={{ color: course.color }} aria-hidden="true" /> : <CourseIcon icon={option.id} size={24} style={{ color: course.color }} aria-hidden="true" />}</button>)}</div></fieldset>
            </div>
          </section>
          <fieldset className="class-setup-syllabus" disabled={attemptedSave}>
            <legend>Syllabus <span>(optional)</span></legend>
            <div className={`class-setup-syllabus-upload${hasCurrentSyllabus ? " has-file" : ""}`}>
              <label className="class-setup-syllabus-upload-surface">
                <FileText size={24} aria-hidden="true" />
                {hasCurrentSyllabus
                  ? <span className="class-setup-syllabus-upload-details"><strong className="class-setup-syllabus-upload-title">Upload Successful</strong><small className="class-setup-syllabus-upload-name" title={currentSyllabusName}>{currentSyllabusName}</small></span>
                  : <span className="class-setup-syllabus-upload-details"><strong className="class-setup-syllabus-upload-title">Upload your syllabus</strong><small>PDF only · Up to 25 MiB</small></span>}
                <input aria-label="Syllabus (optional)" type="file" accept=".pdf,application/pdf" disabled={!canUpload || busy} onChange={(event) => { selectFile("syllabus", event.target.files?.[0]); event.target.value = ""; }} />
              </label>
              {hasCurrentSyllabus && <button type="button" className="class-setup-syllabus-remove" aria-label="Remove syllabus" title="Remove syllabus" disabled={!canUpload || busy || attemptedSave} onClick={(event) => { event.preventDefault(); event.stopPropagation(); removeSyllabus(); }}><X size={14} aria-hidden="true" /></button>}
            </div>
            <div className="class-setup-document-preview" role="region" aria-label="Syllabus preview">
              {uploads.syllabus ? <ClassSetupDocumentPreview key={uploads.syllabus.id} file={uploads.syllabus.file} url={syllabusPreview} />
                : !details.syllabusDeleted && (savedSyllabusPreview || details.syllabusText) ? <div className="class-setup-document-content">{savedSyllabusPreview ?? <pre>{details.syllabusText}</pre>}</div>
                  : <div className="class-setup-document-empty"><FileText size={36} aria-hidden="true" /><p>{!details.syllabusDeleted && details.syllabusFileId ? "Saved syllabus unavailable" : <>Your document preview<br />appears here</>}</p>{!details.syllabusDeleted && details.syllabusFileId && <span>Your attachment is preserved. Upload a replacement to change it.</span>}</div>}
            </div>
            <p className="form-hint">Storage only. Uploading will not affect course</p>
          </fieldset>
        </div>
        {!canUpload && <p className="form-hint">File uploads are unavailable until your workspace is saved. You can still {editing ? "save" : "create"} this class and attach files later.</p>}
      </>}
    </fieldset></div>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {attemptedSave && !busy && error && <p className="form-hint">Selected files are locked for safe retries because some attachments may already be saved. Retry to finish, or close setup and manage saved attachments from the class files.</p>}
    <div className="modal-actions class-setup-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (step) { transition(() => { setStep(step - 1); setError(""); }); } else close(); }}>{step ? <><ArrowLeft size={16} />Back</> : "Cancel"}</button>
      <span className="class-setup-step-count">{step + 1} / {steps.length}</span>
      {onDelete && <button type="button" className="secondary-button" aria-label="Delete class" title="Delete class" disabled={busy || attemptedSave} onClick={onDelete}><Trash2 size={18} aria-hidden="true" /></button>}
      <button type="submit" className={highlightSubmit ? "primary-button" : "secondary-button"} data-class-setup-advance={!editing && !isFinalStep ? true : undefined} disabled={busy}>
        {busy ? "Saving class…" : isFinalStep ? (editing ? "Save class" : "Create class") : <>{advanceLabel}<ArrowRight size={16} /></>}
      </button>
    </div>
  </form></div>;
}
