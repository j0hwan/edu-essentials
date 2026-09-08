"use client";
import { useState } from "react";
import { assignmentTypes, suggestSyllabusItems, type SyllabusDraft } from "../lib/academics";
import { downloadDraft, useSaveProtection } from "./use-save-protection";
export default function SyllabusReview({ draft, onChange, onApprove, onClose, onDelete, onUpload, onFile }: { draft: SyllabusDraft; onChange: (draft: SyllabusDraft) => void; onApprove: () => boolean; onClose: () => void; onDelete: () => void; onUpload?: () => void; onFile?: () => void }) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  useSaveProtection(reading);
  const course = draft.course;
  return <div className="modal-backdrop"><section className="add-class-modal academic-editor" role="dialog" aria-modal="true" aria-label="Syllabus review">
    <div className="modal-header"><h2>Review your syllabus</h2><button className="secondary-button" disabled={reading} onClick={onClose}>Close review</button></div>
    <fieldset disabled={reading}>
    <p>Your review draft saves to your account. Approval adds the class and reviewed assignments together.</p>
    {onUpload && <button className="secondary-button" onClick={onUpload}>Upload private syllabus source</button>}{draft.sourceFileId && <><button className="secondary-button" onClick={onFile}>Open saved source file</button><button className="secondary-button" onClick={() => { const next = { ...draft }; delete next.sourceFileId; onChange(next); }}>Detach source file</button></>}
    <label>Syllabus text<textarea aria-label="Paste syllabus text" maxLength={60000} value={draft.sourceText} onChange={(e) => onChange({ ...draft, sourceText: e.target.value })} /></label>
    <label>Read a text file (.txt)<input type="file" accept=".txt,text/plain" onChange={async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      setReading(true);
      try {
        if (!/\.txt$/i.test(file.name) || file.size > 240000) throw new Error("Choose a .txt file up to 240 KB, or paste text from your syllabus.");
        const sourceText = await file.text(); if (sourceText.length > 60000) throw new Error("Syllabus text is limited to 60,000 characters.");
        onChange({ ...draft, sourceText, sourceName: file.name.slice(0, 255) }); setError("");
      } catch (err) { setError(err instanceof Error ? err.message : "Unable to read this file."); }
      finally { setReading(false); }
    }} /></label><p className="form-hint">For PDFs or images, paste the text here. Suggestions recognize dates written as YYYY-MM-DD; review the full source for dates in other formats.</p>
    <button className="secondary-button" onClick={() => { if (!draft.items.length || window.confirm("Replace the current review rows with suggestions from this text?")) { const items = suggestSyllabusItems(draft.sourceText, () => crypto.randomUUID()); onChange({ ...draft, items }); setError(items.length ? "" : "No YYYY-MM-DD dates found. Add review items manually below."); } }}>Suggest dated items</button>
    <div className="settings-form-grid">{([ ["code", "Course code"], ["name", "Class name"], ["instructor", "Instructor"], ["room", "Location / meeting notes"] ] as const).map(([key, label]) => <label key={key}>{label}<input maxLength={key === "code" ? 30 : 160} value={course[key]} onChange={(e) => onChange({ ...draft, course: { ...course, [key]: e.target.value } })} /></label>)}<label>Credits<input type="number" min="0" max="30" value={course.credits} onChange={(e) => onChange({ ...draft, course: { ...course, credits: Number(e.target.value) } })} /></label><label>Class color<input type="color" value={course.color} onChange={(e) => onChange({ ...draft, course: { ...course, color: e.target.value, soft: `${e.target.value}18` } })} /></label></div>
    <h3>Assignments and exams to approve</h3>
    {draft.items.map((item, index) => { const change = (patch: Partial<typeof item>) => onChange({ ...draft, items: draft.items.map((row) => row.id === item.id ? { ...row, ...patch } : row) }); return <fieldset className="meeting-editor" key={item.id}><legend>Review item {index + 1}</legend><div className="settings-form-grid"><label>Item title<input maxLength={500} value={item.title} onChange={(e) => change({ title: e.target.value })} /></label><label>Item date<input type="date" value={item.date} onChange={(e) => change({ date: e.target.value })} /></label><label>Item type<select value={item.type} onChange={(e) => change({ type: e.target.value as typeof item.type })}>{assignmentTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>Item weight<input maxLength={100} value={item.weight} onChange={(e) => change({ weight: e.target.value })} /></label></div><label>Item description<textarea maxLength={20000} value={item.description} onChange={(e) => change({ description: e.target.value })} /></label><button className="secondary-button" onClick={() => onChange({ ...draft, items: draft.items.filter((row) => row.id !== item.id) })}>Remove review item</button></fieldset>; })}
    <button className="secondary-button" disabled={draft.items.length >= 200} onClick={() => onChange({ ...draft, items: [...draft.items, { id: crypto.randomUUID(), title: "", date: "", type: "Assignment", description: "", weight: "" }] })}>Add review item</button>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="secondary-button" onClick={() => downloadDraft("eduessentials-syllabus-review.json", draft)}>Download review draft</button><button className="secondary-button danger" onClick={onDelete}>Discard review</button><button className="primary-button" onClick={() => { if (!onApprove()) setError("Enter a course code, class name, and valid titles and dates for every item. Review the workspace message for details."); }}>Approve class and items</button></div>
    </fieldset>
  </section></div>;
}
