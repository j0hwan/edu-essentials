"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { assignmentStatus, dateLabel, isDate } from "../lib/academics";
import type { GradingCategory } from "../lib/coursework";
import type { SavedAssignment } from "../lib/workspace-codec";
import "./class-coursework.css";

type Props = { courseId: string; today: string; categories: GradingCategory[]; assignments: SavedAssignment[]; onAssignmentsChange: (assignments: SavedAssignment[]) => void; disabled?: boolean; showErrors?: boolean; validationAttempt?: number };

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `coursework-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function ClassCoursework({ courseId, today, categories, assignments, onAssignmentsChange, disabled = false, showErrors = false, validationAttempt = 0 }: Props) {
  const prefix = useId();
  const [selected, setSelected] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const pendingControlFocus = useRef<string | null>(null);
  const [handledValidation, setHandledValidation] = useState(-1);
  const formatWeight = (weight: number) => Number.isFinite(weight) ? weight.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
  const courseAssignments = assignments.filter((assignment) => assignment.courseId === courseId);
  const visible = courseAssignments.filter((assignment) => selected === "all" || (selected === "uncategorized" ? !assignment.categoryId : assignment.categoryId === selected));
  const updateAssignment = (id: string, patch: Partial<SavedAssignment>) => onAssignmentsChange(assignments.map((assignment) => assignment.id === id ? { ...assignment, ...patch } : assignment));
  const addTask = () => {
    const id = makeId();
    const assignment: SavedAssignment = { id, title: "", courseId, due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "", type: "Assignment", ...(selected !== "all" && selected !== "uncategorized" ? { categoryId: selected } : {}) };
    onAssignmentsChange([...assignments, assignment]);
    setEditingId(id);
  };
  const edit = (assignment: SavedAssignment, patch: Partial<SavedAssignment>) => updateAssignment(assignment.id, patch);
  const titleError = (assignment: SavedAssignment) => showErrors && !assignment.title.trim();
  const pointsInvalid = (assignment: SavedAssignment) => showErrors && ((assignment.pointsPossible != null && (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0 || assignment.pointsPossible > 1e9)) || (assignment.pointsEarned != null && (!Number.isFinite(assignment.pointsEarned) || assignment.pointsEarned < 0 || assignment.pointsEarned > 1e9 || assignment.pointsPossible == null || assignment.status !== "done")));
  const enterGuard = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") event.preventDefault(); };
  const selectCategory = (id: string) => {
    setSelected(id);
    setRemoveId(null);
  };
  useEffect(() => {
    if (!pendingControlFocus.current) return;
    const target = [...(sectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-coursework-focus]") ?? [])].find((button) => button.dataset.courseworkFocus === pendingControlFocus.current);
    target?.focus();
    pendingControlFocus.current = null;
  });
  if (showErrors && handledValidation !== validationAttempt) {
    setHandledValidation(validationAttempt);
    const invalid = assignments.find((assignment) => assignment.courseId === courseId && (!assignment.title.trim() || (assignment.dateKey && !isDate(assignment.dateKey)) || (assignment.pointsPossible != null && (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0 || assignment.pointsPossible > 1e9)) || (assignment.pointsEarned != null && (!Number.isFinite(assignment.pointsEarned) || assignment.pointsEarned < 0 || assignment.pointsEarned > 1e9 || assignment.pointsPossible == null || assignment.status !== "done"))));
    if (invalid) { setSelected("all"); setEditingId(invalid.id); }
  }
  useEffect(() => {
    const title = [...(sectionRef.current?.querySelectorAll<HTMLInputElement>("[data-task-title]") ?? [])].find((input) => input.dataset.taskTitle === editingId);
    title?.focus();
  }, [editingId]);

  return <section ref={sectionRef} className="class-coursework class-coursework-assignments" aria-label="Assignments setup">
    <div className="class-coursework-category-summary">
      <h3>{categories.length ? <><Check size={18} aria-hidden="true" />Your grading categories are set</> : "Assignments can be added without categories"}</h3>
      {categories.length > 0 && <div className="class-coursework-pills" aria-label="Filter assignments by category">
        {courseAssignments.length > 0 && <button type="button" data-coursework-focus="all" aria-pressed={selected === "all"} onClick={() => selectCategory("all")}>All assignments <strong>{courseAssignments.length}</strong></button>}
        {categories.map((category) => <button type="button" key={category.id} aria-pressed={selected === category.id} onClick={() => selectCategory(category.id)}>{category.name}<strong>{formatWeight(category.weight)}%</strong></button>)}
        {courseAssignments.some((assignment) => !assignment.categoryId) && <button type="button" aria-pressed={selected === "uncategorized"} onClick={() => selectCategory("uncategorized")}>Uncategorized</button>}
      </div>}
    </div>
    <div className="class-coursework-main">
      {!visible.length ? <div className="class-coursework-empty-state">
        <span className="class-coursework-empty-icon"><Plus size={24} aria-hidden="true" /></span>
        <h3>{courseAssignments.length ? "No assignments in this category" : "Start with your first assignment"}</h3>
        <p>Add titles, categories, and due dates. You can always build your assignment list later.</p>
        <button type="button" data-coursework-focus="add-task" className="primary-button" onClick={addTask} disabled={disabled}><Plus size={16} aria-hidden="true" />Add assignment</button>
      </div> : <div className="class-coursework-task-list">{visible.map((assignment) => <article className="class-coursework-task" key={assignment.id}>
        <div className="class-coursework-task-summary"><button type="button" data-coursework-focus={`task:${assignment.id}`} className="class-coursework-task-title" aria-expanded={editingId === assignment.id} aria-controls={`${prefix}-${assignment.id}`} onClick={() => { setEditingId(editingId === assignment.id ? null : assignment.id); setRemoveId(null); }}>
          <strong>{assignment.title.trim() || "Untitled assignment"}</strong>
          {(assignment.type && assignment.type !== "Assignment" || assignment.dateKey && isDate(assignment.dateKey)) && <span>{[assignment.type && assignment.type !== "Assignment" ? assignment.type : "", assignment.dateKey && isDate(assignment.dateKey) ? dateLabel(assignment.dateKey) : ""].filter(Boolean).join(" · ")}</span>}
          {(assignment.pointsEarned != null || assignment.pointsPossible != null) && <span className="class-coursework-task-score">{assignment.pointsEarned != null ? Number.isFinite(assignment.pointsEarned) ? `${assignment.pointsEarned} / ${assignment.pointsPossible ?? "—"} points · Graded` : "Enter received score" : `${assignment.pointsPossible} points possible`}</span>}
        </button>{assignment.status === "done" && <Check className="class-coursework-complete" size={18} aria-label="Completed" />}</div>
        {editingId === assignment.id && <div className="class-coursework-editor" id={`${prefix}-${assignment.id}`}>
          <label className="class-coursework-wide">Assignment title<input data-task-title={assignment.id} maxLength={500} value={assignment.title} aria-invalid={titleError(assignment)} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => edit(assignment, { title: event.target.value })} /></label>
          <label>Type<select value={assignment.type ?? "Assignment"} disabled={disabled} onChange={(event) => edit(assignment, { type: event.target.value as SavedAssignment["type"] })}><option>Assignment</option><option>Exam</option><option>Project</option></select></label>
          <label>Category<select value={assignment.categoryId ?? ""} disabled={disabled} onChange={(event) => { edit(assignment, { categoryId: event.target.value || undefined }); setSelected("all"); }}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Due date<input type="date" value={assignment.dateKey || ""} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => { const dateKey = event.target.value; edit(assignment, { dateKey, due: dateKey && isDate(dateKey) ? dateLabel(dateKey) : "", status: assignment.status === "done" ? "done" : assignmentStatus({ status: "later", dateKey }, today), dueTime: dateKey ? assignment.dueTime : "" }); }} /></label>
          <label>Due time<input type="time" value={assignment.dateKey ? assignment.dueTime ?? "" : ""} disabled={disabled || !assignment.dateKey} onKeyDown={enterGuard} onChange={(event) => edit(assignment, { dueTime: event.target.value || undefined })} /></label>
          <label className="class-coursework-wide">Description<textarea maxLength={20000} value={assignment.description} disabled={disabled} onChange={(event) => edit(assignment, { description: event.target.value })} /></label>
          <div className="class-coursework-completion class-coursework-wide">
            <label className="class-coursework-done"><input type="checkbox" checked={assignment.status === "done"} disabled={disabled} onChange={(event) => edit(assignment, event.target.checked ? { status: "done", completedAt: new Date().toISOString(), progressBeforeCompletion: assignment.progress, progress: 100 } : { status: assignmentStatus({ status: "later", dateKey: assignment.dateKey }, today), completedAt: null, progress: assignment.progressBeforeCompletion ?? 0, pointsEarned: null })} />Done</label>
            <label className="class-coursework-grade-check"><input type="checkbox" checked={assignment.pointsEarned != null} disabled={disabled || assignment.status !== "done"} onChange={(event) => edit(assignment, { pointsEarned: event.target.checked ? Number.NaN : null })} />Grade received</label>
          </div>
          <label>Points possible<input type="number" min="0" max="1000000000" step="any" value={Number.isFinite(assignment.pointsPossible) ? assignment.pointsPossible! : ""} aria-invalid={pointsInvalid(assignment)} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => edit(assignment, { pointsPossible: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          {assignment.pointsEarned != null && <label>Points earned<input type="number" min="0" max="1000000000" step="any" value={Number.isFinite(assignment.pointsEarned) ? assignment.pointsEarned : ""} aria-invalid={pointsInvalid(assignment)} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => edit(assignment, { pointsEarned: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></label>}
          {assignment.pointsEarned != null && assignment.pointsPossible != null && assignment.pointsEarned > assignment.pointsPossible && <p className="class-coursework-warning" role="status">Earned points exceed possible points (extra credit).</p>}
          <div className="class-coursework-editor-actions">
            <button type="button" onClick={() => { pendingControlFocus.current = `task:${assignment.id}`; setEditingId(null); }}>Done editing</button>
            {removeId === assignment.id ? <>
              <span>Remove this task?</span>
              <button type="button" data-coursework-focus={`confirm-remove:${assignment.id}`} disabled={disabled} onClick={() => {
                const remaining = visible.filter((item) => item.id !== assignment.id);
                const next = remaining[Math.min(visible.indexOf(assignment), remaining.length - 1)];
                pendingControlFocus.current = next ? `task:${next.id}` : "add-task";
                onAssignmentsChange(assignments.filter((item) => item.id !== assignment.id));
                setEditingId(null);
                setRemoveId(null);
              }}>Confirm remove</button>
              <button type="button" onClick={() => { pendingControlFocus.current = `remove-task:${assignment.id}`; setRemoveId(null); }}>Keep task</button>
            </> : <button type="button" data-coursework-focus={`remove-task:${assignment.id}`} disabled={disabled} onClick={() => { pendingControlFocus.current = `confirm-remove:${assignment.id}`; setRemoveId(assignment.id); }}>Remove task</button>}
          </div>
        </div>}
      </article>)}</div>}
      {visible.length > 0 && <button type="button" data-coursework-focus="add-task" className="secondary-button class-coursework-add" onClick={addTask} disabled={disabled}><Plus size={18} aria-hidden="true" />Add assignment</button>}
      {showErrors && courseAssignments.some(titleError) && <p className="class-coursework-error" role="alert">Enter a title for each assignment before continuing.</p>}
    </div>
    <p className="class-coursework-hint">{courseAssignments.length ? "Your assignments will be saved with this class." : "Skipping this step keeps your categories and weights."}</p>
  </section>;
}
