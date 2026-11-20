"use client";

import { assignmentStatus } from "../lib/academics";
import type { SavedAssignment } from "../lib/workspace-codec";
import "./class-coursework.css";

type Props = {
  assignment: SavedAssignment;
  today: string;
  onChange: (patch: Partial<SavedAssignment>) => void;
  disabled?: boolean;
  pointsInvalid?: boolean;
  showEarnedField?: boolean;
  onNumericKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
};

export default function TaskGradingFields({ assignment, today, onChange, disabled, pointsInvalid, showEarnedField = true, onNumericKeyDown }: Props) {
  const done = assignment.status === "done";
  const gradeReceived = assignment.pointsEarned != null;
  const earnedScore = Number.isFinite(assignment.pointsEarned) ? assignment.pointsEarned! : "";
  const toggleDone = (completed: boolean) => {
    if (completed) {
      onChange({ status: "done", completedAt: new Date().toISOString(), progressBeforeCompletion: assignment.progress, progress: 100 });
    } else {
      onChange({
        status: assignmentStatus({ status: "later", dateKey: assignment.dateKey }, today),
        completedAt: null,
        progress: assignment.progressBeforeCompletion ?? 0,
        pointsEarned: null,
      });
    }
  };

  return <>
    <div className="class-coursework-completion class-coursework-wide">
      <label className="class-coursework-done"><input type="checkbox" checked={done} disabled={disabled} onChange={(event) => toggleDone(event.target.checked)} />Done</label>
      <label className="class-coursework-grade-check"><input type="checkbox" checked={gradeReceived} disabled={disabled || !done} onChange={(event) => onChange({ pointsEarned: event.target.checked ? Number.NaN : null })} />Grade received</label>
    </div>
    <label>Points possible<input type="number" min="0" max="1000000000" step="any" value={Number.isFinite(assignment.pointsPossible) ? assignment.pointsPossible! : ""} aria-invalid={pointsInvalid} disabled={disabled} onKeyDown={onNumericKeyDown} onChange={(event) => onChange({ pointsPossible: event.target.value === "" ? null : Number(event.target.value) })} /></label>
    {(showEarnedField || gradeReceived) && <label>Points earned<input type={gradeReceived ? "number" : "text"} min="0" max="1000000000" step="any"
      value={gradeReceived ? earnedScore : "N/A"} aria-invalid={gradeReceived && pointsInvalid} disabled={disabled || !gradeReceived}
      onKeyDown={onNumericKeyDown} onChange={(event) => onChange({ pointsEarned: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></label>}
    {assignment.pointsEarned != null && assignment.pointsPossible != null && assignment.pointsEarned > assignment.pointsPossible && <p className="class-coursework-warning" role="status">Earned points exceed possible points (extra credit).</p>}
  </>;
}
