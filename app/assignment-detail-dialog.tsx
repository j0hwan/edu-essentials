"use client";

import { assignmentStatus, dateLabel, type Course } from "../lib/academics";
import type { PrivateFile } from "../lib/files";
import type { SavedAssignment } from "../lib/workspace-codec";
import { FileList } from "./private-files";
import type { FileStore } from "./use-private-files";
import { StatusBadge } from "./assignment-table";

export type AssignmentDetailDialogProps = {
  assignment: SavedAssignment;
  storedAssignments: SavedAssignment[];
  today: string;
  courseFor: (courseId: string) => Course;
  store: FileStore;
  canWriteFiles: boolean;
  onClose: () => void;
  onAttachFile: (assignment: SavedAssignment) => void;
  onOpenFile: (file: PrivateFile) => void;
  onEditFile: (file: PrivateFile) => void;
  onFileTrashed: (file: PrivateFile) => void;
  onEditAssignment: (assignment: SavedAssignment) => void;
  onToggleComplete: (assignmentId: string) => void;
  onDeleteAssignment: (assignment: SavedAssignment) => void;
};

export default function AssignmentDetailDialog({
  assignment,
  storedAssignments,
  today,
  courseFor,
  store,
  canWriteFiles,
  onClose,
  onAttachFile,
  onOpenFile,
  onEditFile,
  onFileTrashed,
  onEditAssignment,
  onToggleComplete,
  onDeleteAssignment,
}: AssignmentDetailDialogProps) {
  const current = storedAssignments.find((item) => item.id === assignment.id) ?? assignment;
  const course = courseFor(current.courseId);
  return <div className="modal-backdrop"><section className="assignment-modal academic-editor" role="dialog" aria-modal="true" aria-label="Assignment details"><div className="modal-header"><div><p>{course.code} · {current.type ?? "Assignment"}</p><h2>{current.title}</h2></div><button className="secondary-button" onClick={onClose}>Close assignment</button></div><p>Due {dateLabel(current.dateKey)} {current.dueTime ?? ""}</p><StatusBadge status={assignmentStatus(current, today)} /><p>{current.description || "No description entered."}</p><p>Weight: {current.weight || "Not entered"} · Progress: {current.progress}%</p><h3>Attachments</h3><button className="secondary-button" disabled={!canWriteFiles} onClick={() => onAttachFile(current)}>Attach file</button><FileList files={store.files.filter((file) => file.assignment_id === current.id)} store={store} onOpen={onOpenFile} onEdit={onEditFile} onTrashed={onFileTrashed} canWrite={canWriteFiles} /><h3>Notes</h3><p className="syllabus-source">{current.notes || "No notes yet."}</p><ul>{["Review instructions and rubric", "Complete first draft", "Proofread and submit"].map((label, index) => <li key={label}>{current.checklist?.[index] ? "✓" : "○"} {label}</li>)}</ul><div className="modal-actions"><button className="primary-button" onClick={() => onEditAssignment(current)}>Edit assignment</button><button className="secondary-button" onClick={() => onToggleComplete(current.id)}>{current.status === "done" ? "Mark incomplete" : "Mark complete"}</button><button className="secondary-button" onClick={() => { if (window.confirm("Delete this assignment and its notes?")) onDeleteAssignment(current); }}>Delete assignment</button></div></section></div>;
}
