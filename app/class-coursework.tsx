"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { assignmentStatus, dateLabel, isDate } from "../lib/academics";
import type { GradingCategory } from "../lib/coursework";
import type { SavedAssignment } from "../lib/workspace-codec";
import "./class-coursework.css";

type Props = { courseId: string; today: string; categories: GradingCategory[]; assignments: SavedAssignment[]; onCategoriesChange: (categories: GradingCategory[]) => void; onAssignmentsChange: (assignments: SavedAssignment[]) => void; disabled?: boolean; showErrors?: boolean; validationAttempt?: number };

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `coursework-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function ClassCoursework({ courseId, today, categories, assignments, onCategoriesChange, onAssignmentsChange, disabled = false, showErrors = false, validationAttempt = 0 }: Props) {
  const prefix = useId();
  const [selected, setSelected] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removingCategory, setRemovingCategory] = useState<string | null>(null);
  const [reassignment, setReassignment] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  const pendingCategoryFocus = useRef<string | null>(null);
  const pendingControlFocus = useRef<string | null>(null);
  const [handledValidation, setHandledValidation] = useState(-1);
  const categoryTotal = Math.round(categories.reduce((total, category) => total + category.weight, 0) * 10000) / 10000;
  const formatWeight = (weight: number) => Number.isFinite(weight) ? weight.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
  const courseAssignments = assignments.filter((assignment) => assignment.courseId === courseId);
  const visible = courseAssignments.filter((assignment) => selected === "all" || (selected === "uncategorized" ? !assignment.categoryId : assignment.categoryId === selected));
  const selectedCategory = categories.find((category) => category.id === selected);
  const updateAssignment = (id: string, patch: Partial<SavedAssignment>) => onAssignmentsChange(assignments.map((assignment) => assignment.id === id ? { ...assignment, ...patch } : assignment));
  const updateCategory = (id: string, patch: Partial<GradingCategory>) => onCategoriesChange(categories.map((category) => category.id === id ? { ...category, ...patch } : category));
  const addCategory = () => {
    let name = "New category";
    let suffix = 2;
    while (categories.some((category) => category.name.trim().toLowerCase() === name.toLowerCase())) name = `New category ${suffix++}`;
    const category = { id: makeId(), name, weight: 0 };
    pendingCategoryFocus.current = category.id;
    onCategoriesChange([...categories, category]);
    setSelected(category.id);
    setEditingId(null);
    setEditingCategoryId(category.id);
    setRemovingCategory(null);
  };
  const addTask = () => {
    const id = makeId();
    const assignment: SavedAssignment = { id, title: "", courseId, due: "", dateKey: "", status: "later", progress: 0, description: "", weight: "", type: "Assignment", ...(selected !== "all" && selected !== "uncategorized" ? { categoryId: selected } : {}) };
    onAssignmentsChange([...assignments, assignment]);
    setEditingCategoryId(null);
    setEditingId(id);
  };
  const removeCategory = (category: GradingCategory, reassignment: string) => {
    pendingControlFocus.current = "all";
    onCategoriesChange(categories.filter((item) => item.id !== category.id));
    onAssignmentsChange(assignments.map((assignment) => assignment.courseId === courseId && assignment.categoryId === category.id ? { ...assignment, ...(reassignment ? { categoryId: reassignment } : { categoryId: undefined }) } : assignment));
    setSelected("all");
    setRemovingCategory(null);
    setEditingCategoryId(null);
  };
  const edit = (assignment: SavedAssignment, patch: Partial<SavedAssignment>) => updateAssignment(assignment.id, patch);
  const titleError = (assignment: SavedAssignment) => showErrors && !assignment.title.trim();
  const categoryNameInvalid = (category: GradingCategory) => showErrors && (!category.name.trim() || categories.some((item) => item.id !== category.id && item.name.trim().toLocaleLowerCase() === category.name.trim().toLocaleLowerCase()));
  const weightInvalid = (category: GradingCategory) => showErrors && (!Number.isFinite(category.weight) || category.weight < 0 || category.weight > 100);
  const pointsInvalid = (assignment: SavedAssignment) => showErrors && ((assignment.pointsPossible != null && (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0 || assignment.pointsPossible > 1e9)) || (assignment.pointsEarned != null && (!Number.isFinite(assignment.pointsEarned) || assignment.pointsEarned < 0 || assignment.pointsEarned > 1e9 || assignment.pointsPossible == null || assignment.status !== "done")));
  const enterGuard = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") event.preventDefault(); };
  const selectCategory = (id: string) => {
    setSelected(id);
    setEditingCategoryId(null);
    setRemovingCategory(null);
    setRemoveId(null);
  };
  useEffect(() => {
    if (!pendingControlFocus.current) return;
    const target = [...(sectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-coursework-focus]") ?? [])].find((button) => button.dataset.courseworkFocus === pendingControlFocus.current);
    target?.focus();
    pendingControlFocus.current = null;
  });
  useEffect(() => {
    if (pendingCategoryFocus.current) {
      const field = [...(sectionRef.current?.querySelectorAll<HTMLInputElement>("[data-category-name]") ?? [])].find((input) => input.dataset.categoryName === pendingCategoryFocus.current);
      field?.focus();
      field?.select();
      pendingCategoryFocus.current = null;
    }
  }, [categories, editingCategoryId]);
  if (showErrors && handledValidation !== validationAttempt) {
    setHandledValidation(validationAttempt);
    const invalidCategory = categories.find((category) => categoryNameInvalid(category) || weightInvalid(category));
    if (invalidCategory) {
      setSelected(invalidCategory.id);
      setEditingId(null);
      setEditingCategoryId(invalidCategory.id);
    }
    const invalid = assignments.find((assignment) => assignment.courseId === courseId && (!assignment.title.trim() || (assignment.dateKey && !isDate(assignment.dateKey)) || (assignment.pointsPossible != null && (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0 || assignment.pointsPossible > 1e9)) || (assignment.pointsEarned != null && (!Number.isFinite(assignment.pointsEarned) || assignment.pointsEarned < 0 || assignment.pointsEarned > 1e9 || assignment.pointsPossible == null || assignment.status !== "done"))));
    if (invalid && !invalidCategory) { setSelected("all"); setEditingId(invalid.id); }
  }
  useEffect(() => {
    const title = [...(sectionRef.current?.querySelectorAll<HTMLInputElement>("[data-task-title]") ?? [])].find((input) => input.dataset.taskTitle === editingId);
    title?.focus();
  }, [editingId]);

  return <section ref={sectionRef} className="class-coursework" aria-label="Coursework setup">
    <aside className="class-coursework-rail" aria-label="Grading categories">
      <div className="class-coursework-category-list">
        <button type="button" data-coursework-focus="all" className={`class-coursework-filter${selected === "all" ? " is-selected" : ""}`} aria-pressed={selected === "all"} onClick={() => selectCategory("all")}>All tasks <span>{courseAssignments.length}</span></button>
        {categories.map((category) => <div className={`class-coursework-category${selected === category.id ? " is-selected" : ""}`} key={category.id}>
          <button type="button" className="class-coursework-category-select" aria-pressed={selected === category.id} onClick={() => selectCategory(category.id)}>
            <strong>{category.name || "Unnamed category"}</strong><span>{formatWeight(category.weight)}%</span>
          </button>
          <button type="button" data-coursework-focus={`remove-category:${category.id}`} className="class-coursework-icon-button class-coursework-category-delete" aria-label={`Remove ${category.name || "category"} category`} title="Remove category" disabled={disabled} onClick={() => {
            setSelected(category.id);
            setEditingId(null);
            setEditingCategoryId(null);
            setRemovingCategory(category.id);
            setReassignment("");
            pendingControlFocus.current = `confirm-category:${category.id}`;
          }}><Trash2 size={17} aria-hidden="true" /></button>
        </div>)}
        {courseAssignments.some((assignment) => !assignment.categoryId) && <button type="button" className={`class-coursework-filter${selected === "uncategorized" ? " is-selected" : ""}`} aria-pressed={selected === "uncategorized"} onClick={() => selectCategory("uncategorized")}>Uncategorized <span>{courseAssignments.filter((item) => !item.categoryId).length}</span></button>}
      </div>
      <button type="button" className="secondary-button class-coursework-add" aria-label="Add category" onClick={addCategory} disabled={disabled || categories.length >= 50}><Plus size={18} aria-hidden="true" />Add category</button>
      {categories.length > 0 && <output className="class-coursework-allocation" aria-live="polite" title="Category weights can be finished later">{Number.isFinite(categoryTotal) ? `${formatWeight(categoryTotal)}% allocated` : "Check category weights"}{categoryTotal > 100 && <span> · {formatWeight(categoryTotal - 100)}% over</span>}</output>}
    </aside>
    <div className="class-coursework-main">
      <header className="class-coursework-main-heading">
        <h3>{selected === "all" ? "All tasks" : selected === "uncategorized" ? "Uncategorized" : selectedCategory?.name || "Tasks"}</h3>
        {selectedCategory && <button type="button" data-coursework-focus={`edit-category:${selectedCategory.id}`} className="class-coursework-icon-button" aria-label={`Edit ${selectedCategory.name || "category"} category`} title="Edit category" aria-expanded={editingCategoryId === selectedCategory.id} aria-controls={`${prefix}-category`} disabled={disabled} onClick={() => {
          const opening = editingCategoryId !== selectedCategory.id;
          setEditingCategoryId(opening ? selectedCategory.id : null);
          if (opening) setEditingId(null);
          setRemovingCategory(null);
          if (opening) pendingCategoryFocus.current = selectedCategory.id;
        }}><Pencil size={17} aria-hidden="true" /></button>}
      </header>
      {selectedCategory && editingCategoryId === selectedCategory.id && <div className="class-coursework-category-editor" id={`${prefix}-category`}>
        <label>Name<input data-category-name={selectedCategory.id} aria-label={`${selectedCategory.name || "Category"} name`} maxLength={100} value={selectedCategory.name} aria-invalid={categoryNameInvalid(selectedCategory)} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => updateCategory(selectedCategory.id, { name: event.target.value })} /></label>
        <label>Weight (%)<input aria-label={`${selectedCategory.name || "Category"} weight`} type="number" min="0" max="100" step="any" value={Number.isFinite(selectedCategory.weight) ? selectedCategory.weight : ""} aria-invalid={weightInvalid(selectedCategory)} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => updateCategory(selectedCategory.id, { weight: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></label>
        <button type="button" className="secondary-button" onClick={() => { pendingControlFocus.current = `edit-category:${selectedCategory.id}`; setEditingCategoryId(null); }}>Done editing category</button>
      </div>}
      {selectedCategory && removingCategory === selectedCategory.id && <div className="class-coursework-category-removal">
        <label>Move tasks to<select aria-label={`Reassign ${selectedCategory.name || "category"} tasks before removing`} value={reassignment} disabled={disabled} onChange={(event) => setReassignment(event.target.value)}><option value="">Uncategorized</option>{categories.filter((item) => item.id !== selectedCategory.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="class-coursework-confirm-actions"><button type="button" data-coursework-focus={`confirm-category:${selectedCategory.id}`} className="secondary-button" disabled={disabled} onClick={() => removeCategory(selectedCategory, reassignment)}>Move tasks & remove</button><button type="button" className="secondary-button" disabled={disabled} onClick={() => { pendingControlFocus.current = `remove-category:${selectedCategory.id}`; setRemovingCategory(null); }}>Keep category</button></div>
      </div>}
      {!visible.length ? <p className="class-coursework-empty">No tasks yet</p> : <div className="class-coursework-task-list">{visible.map((assignment) => <article className="class-coursework-task" key={assignment.id}>
        <div className="class-coursework-task-summary"><button type="button" data-coursework-focus={`task:${assignment.id}`} className="class-coursework-task-title" aria-expanded={editingId === assignment.id} aria-controls={`${prefix}-${assignment.id}`} onClick={() => { setEditingId(editingId === assignment.id ? null : assignment.id); setEditingCategoryId(null); setRemoveId(null); }}>
          <strong>{assignment.title.trim() || "Untitled task"}</strong>
          {(assignment.type && assignment.type !== "Assignment" || assignment.dateKey && isDate(assignment.dateKey)) && <span>{[assignment.type && assignment.type !== "Assignment" ? assignment.type : "", assignment.dateKey && isDate(assignment.dateKey) ? dateLabel(assignment.dateKey) : ""].filter(Boolean).join(" · ")}</span>}
          {(assignment.pointsEarned != null || assignment.pointsPossible != null) && <span className="class-coursework-task-score">{assignment.pointsEarned != null ? Number.isFinite(assignment.pointsEarned) ? `${assignment.pointsEarned} / ${assignment.pointsPossible ?? "—"} points · Graded` : "Enter received score" : `${assignment.pointsPossible} points possible`}</span>}
        </button>{assignment.status === "done" && <Check className="class-coursework-complete" size={18} aria-label="Completed" />}</div>
        {editingId === assignment.id && <div className="class-coursework-editor" id={`${prefix}-${assignment.id}`}>
          <label className="class-coursework-wide">Task title<input data-task-title={assignment.id} maxLength={500} value={assignment.title} aria-invalid={titleError(assignment)} disabled={disabled} onKeyDown={enterGuard} onChange={(event) => edit(assignment, { title: event.target.value })} /></label>
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
      <button type="button" data-coursework-focus="add-task" className="secondary-button class-coursework-add" onClick={addTask} disabled={disabled}><Plus size={18} aria-hidden="true" />Add task</button>
      {showErrors && courseAssignments.some(titleError) && <p className="class-coursework-error" role="alert">Enter a title for each task before continuing.</p>}
    </div>
  </section>;
}
