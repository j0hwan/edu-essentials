"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardList, Plus, Trash2 } from "lucide-react";
import { assignmentStatus, assignmentTypes, dateLabel, isDate, isTime, validateExamSchedule } from "../lib/academics";
import { formatGradingWeight, type GradingCategory } from "../lib/coursework";
import type { SavedAssignment } from "../lib/workspace-codec";
import TaskGradingFields from "./task-grading-fields";

type Props = { courseId: string; today: string; categories: GradingCategory[]; assignments: SavedAssignment[]; onAssignmentsChange: (assignments: SavedAssignment[]) => void; manualEntry?: boolean; disabled?: boolean; showErrors?: boolean; validationAttempt?: number };

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `coursework-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const defaultDueTime = "23:59";
const hasInvalidPoints = (assignment: SavedAssignment) =>
  (assignment.pointsPossible != null && (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0 || assignment.pointsPossible > 1e9)) ||
  (assignment.pointsEarned != null && (!Number.isFinite(assignment.pointsEarned) || assignment.pointsEarned < 0 || assignment.pointsEarned > 1e9 || assignment.pointsPossible == null || assignment.status !== "done"));
const enterGuard = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") event.preventDefault(); };
const invalidExam = (assignment: SavedAssignment) => {
  try { validateExamSchedule(assignment); return false; }
  catch { return true; }
};

export default function ClassCoursework({ courseId, today, categories, assignments, onAssignmentsChange, manualEntry = false, disabled = false, showErrors = false, validationAttempt = 0 }: Props) {
  const prefix = useId();
  const [selected, setSelected] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const pendingControlFocus = useRef<string | null>(null);
  const [handledValidation, setHandledValidation] = useState(-1);
  const courseAssignments = assignments.filter((assignment) => assignment.courseId === courseId);
  const visible = courseAssignments.filter((assignment) => selected === "all" || (selected === "uncategorized" ? !assignment.categoryId : assignment.categoryId === selected));
  const activeTask = manualEntry ? visible.find((assignment) => assignment.id === editingId) ?? visible[0] : undefined;
  const updateAssignment = (id: string, patch: Partial<SavedAssignment>) => onAssignmentsChange(assignments.map((assignment) => assignment.id === id ? { ...assignment, ...patch } : assignment));
  const addTask = () => {
    const id = makeId();
    const assignment: SavedAssignment = { id, title: "", courseId, due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "", type: "Assignment", ...(selected !== "all" && selected !== "uncategorized" ? { categoryId: selected } : {}) };
    onAssignmentsChange([...assignments, assignment]);
    setEditingId(id);
    setRemoveId(null);
    if (manualEntry) pendingControlFocus.current = `title:${id}`;
  };
  const titleMissing = (assignment: SavedAssignment) => !manualEntry && !assignment.title.trim();
  const selectCategory = (id: string) => {
    setSelected(id);
    setRemoveId(null);
  };
  useEffect(() => {
    if (!pendingControlFocus.current) return;
    const target = [...(sectionRef.current?.querySelectorAll<HTMLElement>("[data-coursework-focus]") ?? [])].find((control) => control.dataset.courseworkFocus === pendingControlFocus.current);
    target?.focus();
    pendingControlFocus.current = null;
  });
  if (showErrors && handledValidation !== validationAttempt) {
    setHandledValidation(validationAttempt);
    const invalid = courseAssignments.find((assignment) => titleMissing(assignment) || (assignment.dateKey && !isDate(assignment.dateKey)) ||
      (manualEntry && assignment.dueTime && (!assignment.dateKey || !isTime(assignment.dueTime))) || hasInvalidPoints(assignment) || invalidExam(assignment));
    if (invalid) {
      setSelected("all");
      setEditingId(invalid.id);
    }
  }
  useEffect(() => {
    if (manualEntry) return;
    const title = [...(sectionRef.current?.querySelectorAll<HTMLInputElement>("[data-task-title]") ?? [])].find((input) => input.dataset.taskTitle === editingId);
    title?.focus();
  }, [editingId, manualEntry]);

  const removeTask = (assignment: SavedAssignment) => {
    const remaining = visible.filter((item) => item.id !== assignment.id);
    const next = remaining[Math.min(visible.indexOf(assignment), remaining.length - 1)];
    pendingControlFocus.current = next ? `task:${next.id}` : "add-task";
    onAssignmentsChange(assignments.filter((item) => item.id !== assignment.id));
    setRemoveId(null);
    if (!manualEntry || activeTask?.id === assignment.id) setEditingId(manualEntry ? next?.id ?? null : null);
  };
  const requestRemove = (id: string) => {
    pendingControlFocus.current = `confirm-remove:${id}`;
    setRemoveId(id);
  };
  const removeConfirmation = (assignment: SavedAssignment) => <>
    <span>Remove this task?</span>
    <button type="button" data-coursework-focus={`confirm-remove:${assignment.id}`} disabled={disabled} onClick={() => removeTask(assignment)}>Confirm remove</button>
    <button type="button" onClick={() => { pendingControlFocus.current = `remove-task:${assignment.id}`; setRemoveId(null); }}>Keep task</button>
  </>;

  const renderEditor = (assignment: SavedAssignment) => {
    const edit = (patch: Partial<SavedAssignment>) => updateAssignment(assignment.id, patch);
    const title = <label className="class-coursework-wide">{manualEntry ? "Task Title" : "Assignment title"}<input data-task-title={assignment.id} data-coursework-focus={`title:${assignment.id}`} maxLength={500} value={assignment.title} aria-invalid={showErrors && titleMissing(assignment)} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => edit({ title: event.target.value })} /></label>;
    const description = <label className="class-coursework-wide">{manualEntry ? "Task Description" : "Description"}<textarea maxLength={20000} value={assignment.description} disabled={disabled} onChange={(event) => edit({ description: event.target.value })} /></label>;
    const dueDate = <label>{manualEntry ? "Due Date" : "Due date"}<input type="date" value={assignment.dateKey || ""} aria-invalid={manualEntry && showErrors && Boolean(assignment.dateKey) && !isDate(assignment.dateKey) || undefined} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => {
      const dateKey = event.target.value;
      const dueTime = manualEntry && assignment.type !== "Exam" && !assignment.dateKey ? defaultDueTime : assignment.dueTime;
      edit({ dateKey, due: dateKey && isDate(dateKey) ? dateLabel(dateKey) : "", status: assignment.status === "done" ? "done" : assignmentStatus({ status: "later", dateKey }, today), dueTime: dateKey ? dueTime : "",
        ...(!dateKey ? { examStart: undefined, examEnd: undefined } : {}) });
    }} /></label>;
    const dueTime = <label>{manualEntry ? "Due Time" : "Due time"}<input type="time" value={assignment.dateKey ? assignment.dueTime ?? "" : ""} aria-invalid={manualEntry && showErrors && Boolean(assignment.dateKey && assignment.dueTime) && !isTime(assignment.dueTime ?? "") || undefined} disabled={disabled || !assignment.dateKey} onKeyDown={enterGuard} onChange={(event) => edit({ dueTime: event.target.value || undefined })} /></label>;
    const selectField = (label: string, control: React.ReactNode) => <label>{label}{manualEntry ? <span className="class-coursework-select">
      {control}<ChevronDown size={16} aria-hidden="true" />
    </span> : control}</label>;
    const type = selectField("Type", <select aria-label="Type" value={assignment.type ?? "Assignment"} disabled={disabled} onChange={(event) => {
      const type = event.target.value as SavedAssignment["type"];
      edit({ type, ...(type !== "Exam" ? { examStart: undefined, examEnd: undefined, examLocation: undefined } : {}) });
    }}>
      {assignmentTypes.map((option) => <option key={option}>{option}</option>)}
    </select>);
    const examFields = assignment.type === "Exam" && <>
      <label>Exam starts<input type="time" value={assignment.examStart ?? ""} aria-invalid={showErrors && invalidExam(assignment) || undefined} disabled={disabled || !assignment.dateKey} onKeyDown={enterGuard} onChange={(event) => edit({ examStart: event.target.value || undefined, ...(!event.target.value ? { examEnd: undefined } : {}) })} /></label>
      <label>Exam ends<input type="time" value={assignment.examEnd ?? ""} aria-invalid={showErrors && invalidExam(assignment) || undefined} disabled={disabled || !assignment.examStart} onKeyDown={enterGuard} onChange={(event) => edit({ examEnd: event.target.value || undefined })} /></label>
      <label className="class-coursework-wide">Exam location<input value={assignment.examLocation ?? ""} maxLength={160} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => edit({ examLocation: event.target.value || undefined })} /></label>
    </>;
    const categoryLabel = manualEntry ? "Weight Category" : "Category";
    const category = selectField(categoryLabel, <select aria-label={categoryLabel} value={assignment.categoryId ?? ""} disabled={disabled || (manualEntry && !categories.length)} onChange={(event) => { edit({ categoryId: event.target.value || undefined }); setSelected("all"); }}>
      <option value="">Uncategorized</option>
      {categories.map((item) => <option key={item.id} value={item.id}>{manualEntry ? `${item.name} · ${formatGradingWeight(item.weight)}%` : item.name}</option>)}
    </select>);
    const grading = <TaskGradingFields assignment={assignment} today={today} onChange={edit} disabled={disabled}
      pointsInvalid={showErrors && hasInvalidPoints(assignment)} showEarnedField={manualEntry} onNumericKeyDown={enterGuard} />;

    if (manualEntry) return <div key={assignment.id} className="class-coursework-editor">
      {title}{description}{dueDate}{dueTime}{type}{category}{examFields}
      <div className="class-coursework-grading-fields class-coursework-wide">{grading}</div>
    </div>;

    return <div className="class-coursework-editor" id={`${prefix}-${assignment.id}`}>
      {title}{type}{category}{dueDate}{dueTime}{examFields}{description}{grading}
      <div className="class-coursework-editor-actions">
        <button type="button" onClick={() => { pendingControlFocus.current = `task:${assignment.id}`; setEditingId(null); }}>Done editing</button>
        {removeId === assignment.id ? removeConfirmation(assignment) : <button type="button" data-coursework-focus={`remove-task:${assignment.id}`} disabled={disabled} onClick={() => requestRemove(assignment.id)}>Remove task</button>}
      </div>
    </div>;
  };

  const taskTitle = (assignment: SavedAssignment) => assignment.title.trim() || (manualEntry ? "Untitled task" : "Untitled assignment");
  const taskMetadata = (assignment: SavedAssignment) => {
    if (manualEntry) return [assignment.type ?? "Assignment", isDate(assignment.dateKey) ? dateLabel(assignment.dateKey, { month: "short", day: "numeric" }) : ""].filter(Boolean).join(" · ");
    return [assignment.type && assignment.type !== "Assignment" ? assignment.type : "", isDate(assignment.dateKey) ? dateLabel(assignment.dateKey) : ""].filter(Boolean).join(" · ");
  };
  const taskList = <div className="class-coursework-task-list">{visible.map((assignment) => {
    const isSelected = activeTask?.id === assignment.id;
    const metadata = taskMetadata(assignment);
    return <article className={`class-coursework-task${isSelected ? " is-selected" : ""}`} key={assignment.id}>
      <div className="class-coursework-task-summary">
        <button type="button" data-coursework-focus={`task:${assignment.id}`} className="class-coursework-task-title" disabled={manualEntry && disabled}
          aria-pressed={manualEntry ? isSelected : undefined} aria-expanded={manualEntry ? undefined : editingId === assignment.id}
          aria-controls={manualEntry ? `${prefix}-details` : `${prefix}-${assignment.id}`}
          onClick={() => {
            setEditingId(!manualEntry && editingId === assignment.id ? null : assignment.id);
            setRemoveId(null);
          }}>
          <strong>{taskTitle(assignment)}</strong>
          {metadata && <span>{metadata}</span>}
          {!manualEntry && (assignment.pointsEarned != null || assignment.pointsPossible != null) && <span className="class-coursework-task-score">{assignment.pointsEarned != null ? Number.isFinite(assignment.pointsEarned) ? `${assignment.pointsEarned} / ${assignment.pointsPossible ?? "—"} points · Graded` : "Enter received score" : `${assignment.pointsPossible} points possible`}</span>}
        </button>
        {!manualEntry && assignment.status === "done" && <Check className="class-coursework-complete" size={16} aria-label="Completed" />}
        {manualEntry && <button type="button" className="icon-button class-setup-delete-button class-coursework-task-remove" aria-label={`Remove ${taskTitle(assignment)}`} disabled={disabled} onClick={() => removeTask(assignment)}><Trash2 size={17} aria-hidden="true" /></button>}
      </div>
      {!manualEntry && editingId === assignment.id && renderEditor(assignment)}
    </article>;
  })}</div>;
  const addButton = (className: string) => <button type="button" data-coursework-focus="add-task" className={className} onClick={addTask} disabled={disabled}><Plus size={18} aria-hidden="true" />{manualEntry ? "Add task" : "Add assignment"}</button>;
  const emptyState = <div className="class-coursework-empty-state">
    <span className="class-coursework-empty-icon"><Plus size={24} aria-hidden="true" /></span>
    <h3>{courseAssignments.length ? "No assignments in this category" : "Start with your first assignment"}</h3>
    <p>Add titles, categories, and due dates. You can always build your assignment list later.</p>
    {addButton("primary-button")}
  </div>;

  if (manualEntry) return <section ref={sectionRef} className="class-coursework class-coursework-manual" aria-label="Task setup">
    <div className="class-coursework-main">
      <aside className="class-coursework-sidebar" aria-label="Tasks">
        {activeTask && taskList}
        {addButton("secondary-button class-coursework-add")}
      </aside>
      <section className="class-coursework-details" id={`${prefix}-details`} aria-label="Task details">
        {activeTask ? renderEditor(activeTask) : <div className="class-coursework-no-tasks">
          <ClipboardList size={24} aria-hidden="true" />
          <h3>No tasks yet</h3>
          <p>(You can do this later!)</p>
        </div>}
      </section>
    </div>
  </section>;

  return <section ref={sectionRef} className="class-coursework class-coursework-assignments" aria-label="Task setup">
    <div className="class-coursework-category-summary">
      <h3>{categories.length ? <><Check size={18} aria-hidden="true" />Your grading categories are set</> : "Assignments can be added without categories"}</h3>
      {categories.length > 0 && <div className="class-coursework-pills" aria-label="Filter assignments by category">
        {courseAssignments.length > 0 && <button type="button" data-coursework-focus="all" aria-pressed={selected === "all"} onClick={() => selectCategory("all")}>All assignments <strong>{courseAssignments.length}</strong></button>}
        {categories.map((item) => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => selectCategory(item.id)}>{item.name}<strong>{formatGradingWeight(item.weight)}%</strong></button>)}
        {courseAssignments.some((assignment) => !assignment.categoryId) && <button type="button" aria-pressed={selected === "uncategorized"} onClick={() => selectCategory("uncategorized")}>Uncategorized</button>}
      </div>}
    </div>
    <div className="class-coursework-main">
      {visible.length ? <>{taskList}{addButton("secondary-button class-coursework-add")}</> : emptyState}
      {showErrors && courseAssignments.some(titleMissing) && <p className="class-coursework-error" role="alert">Enter a title for each assignment before continuing.</p>}
    </div>
    <p className="class-coursework-hint">{courseAssignments.length ? "Your assignments will be saved with this class." : "Skipping this step keeps your categories and weights."}</p>
  </section>;
}
