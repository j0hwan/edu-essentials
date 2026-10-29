"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { assignmentStatus, assignmentTypes, dateLabel, isDate, isTime, type Course } from "../lib/academics";
import type { SavedAssignment } from "../lib/workspace-codec";
import { useSaveProtection } from "./use-save-protection";
import "./add-task-form.css";

export default function AddTaskForm({ initial, course, today, onApply, onClose }: {
  initial: SavedAssignment;
  course: Course;
  today: string;
  onApply: (value: { assignment: SavedAssignment }) => boolean;
  onClose: () => void;
}) {
  const [assignment, setAssignment] = useState(initial);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(assignment) !== JSON.stringify(initial);
  useSaveProtection(dirty);

  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const titleId = useId();
  const descriptionId = useId();
  const dueDateId = useId();
  const dueTimeId = useId();
  const typeId = useId();
  const weightCategoryId = useId();
  const errorId = useId();

  const close = () => {
    if (!dirty || window.confirm("Discard these task edits?")) onClose();
  };

  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    titleRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        formRef.current?.focus({ preventScroll: true });
      } else if (event.shiftKey && (document.activeElement === first || !formRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || !formRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const change = (patch: Partial<SavedAssignment>) => {
    setAssignment((current) => ({ ...current, ...patch }));
    setError("");
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const invalidControl = formRef.current?.querySelector<HTMLElement>(":invalid");
    if (!assignment.title.trim()) {
      setError("Enter a task title.");
      titleRef.current?.focus();
      return;
    }
    if (!isDate(assignment.dateKey)) {
      setError("Enter a valid due date.");
      dateRef.current?.focus();
      return;
    }
    if (!isTime(assignment.dueTime ?? "")) {
      setError("Enter a valid due time.");
      timeRef.current?.focus();
      return;
    }
    if (invalidControl) {
      setError("Complete the required fields before adding this task.");
      invalidControl.focus();
      return;
    }

    const ready = {
      ...assignment,
      title: assignment.title.trim(),
      due: dateLabel(assignment.dateKey),
      status: assignmentStatus(assignment, today),
    } satisfies SavedAssignment;
    if (!onApply({ assignment: ready })) setError("This task could not be saved. Check the workspace message and keep this form open.");
  };

  return <div className="modal-backdrop add-task-backdrop"><form ref={formRef} className="add-class-modal academic-editor add-task-form" role="dialog" aria-modal="true" aria-labelledby={`${titleId}-heading`} onSubmit={submit}>
    <div className="modal-header add-task-form-header">
      <div>
        <h2 id={`${titleId}-heading`}>Add Task</h2>
        <p className="add-task-course-context">{course.code} · {course.name}</p>
      </div>
      <button type="button" className="secondary-button" aria-label="Close Add Task" onClick={close}><X size={18} aria-hidden="true" /></button>
    </div>

    <div className="settings-form-grid add-task-fields">
      <label className="add-task-field add-task-field-wide" htmlFor={titleId}>Task Title
        <input ref={titleRef} id={titleId} type="text" required maxLength={500} value={assignment.title} aria-describedby={error ? errorId : undefined} onChange={(event) => change({ title: event.target.value })} />
      </label>
      <label className="add-task-field add-task-field-wide" htmlFor={descriptionId}>Task Description
        <textarea id={descriptionId} maxLength={20000} value={assignment.description} onChange={(event) => change({ description: event.target.value })} />
      </label>
      <label className="add-task-field" htmlFor={dueDateId}>Due Date
        <input ref={dateRef} id={dueDateId} type="date" required value={assignment.dateKey} aria-describedby={error ? errorId : undefined} onChange={(event) => change({ dateKey: event.target.value })} />
      </label>
      <label className="add-task-field" htmlFor={dueTimeId}>Due Time
        <input ref={timeRef} id={dueTimeId} type="time" required value={assignment.dueTime ?? ""} aria-describedby={error ? errorId : undefined} onChange={(event) => change({ dueTime: event.target.value })} />
      </label>
      <label className="add-task-field" htmlFor={typeId}>Type
        <select id={typeId} aria-label="Type" value={assignment.type ?? "Assignment"} onChange={(event) => change({ type: event.target.value as SavedAssignment["type"] })}>
          {assignmentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <label className="add-task-field" htmlFor={weightCategoryId}>Weight Category
        <select id={weightCategoryId} value="Coming soon" disabled aria-label="Weight Category">
          <option value="Coming soon">Coming soon</option>
        </select>
      </label>
    </div>

    {error && <p id={errorId} role="alert" className="auth-error add-task-error">{error}</p>}
    <div className="modal-actions add-task-actions">
      <button type="button" className="secondary-button" onClick={close}>Cancel</button>
      <button type="submit" className="primary-button">Add Task</button>
    </div>
  </form></div>;
}
