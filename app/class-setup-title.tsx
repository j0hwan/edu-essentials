"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Pencil } from "lucide-react";

type Props = {
  title: string;
  onRename: (name: string) => void;
  label?: string;
  maxLength?: number;
  presets?: string[];
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
};

export default function ClassSetupTitle({ title, onRename, label = "Meeting name", maxLength = 30, presets = [], editing: controlledEditing, onEditingChange, disabled = false, invalid = false, className = "" }: Props) {
  const [localEditing, setLocalEditing] = useState(false);
  const editing = controlledEditing ?? localEditing;
  const setEditing = (value: boolean) => { setLocalEditing(value); onEditingChange?.(value); };
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const selectTitle = useRef(true);
  const preservedSelection = useRef<Range | null>(null);
  const activeEdit = useRef(false);
  const flashLimit = useCallback(() => {
    const heading = titleRef.current;
    if (!heading) return;
    heading.removeAttribute("data-limit-flash");
    // Restart the pulse for each attempt, including repeated keystrokes.
    void heading.offsetWidth;
    heading.setAttribute("data-limit-flash", "true");
  }, []);
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
      activeEdit.current = true;
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
      const beforeInput = (event: InputEvent) => {
        if (event.isComposing || !event.inputType.startsWith("insert") || !event.data) return;
        const selection = window.getSelection();
        const selectedLength = selection?.rangeCount && heading.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.toString().length : 0;
        if ((heading.textContent?.length ?? 0) - selectedLength >= maxLength) {
          event.preventDefault();
          flashLimit();
        }
      };
      heading.addEventListener("beforeinput", beforeInput);
      document.addEventListener("selectionchange", updateCaret);
      const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateCaret) : undefined;
      observer?.observe(heading);
      return () => { heading.removeEventListener("beforeinput", beforeInput); document.removeEventListener("selectionchange", updateCaret); observer?.disconnect(); };
    }
    else if (restoreFocus.current) { pencilRef.current?.focus(); restoreFocus.current = false; }
  }, [editing, updateCaret, flashLimit, maxLength]);
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
    heading?.removeAttribute("data-limit-flash");
    const name = (heading?.textContent ?? "").replace(/[\r\n]+/g, " ").slice(0, maxLength).trim();
    if (heading) heading.textContent = save ? name || title : title;
    if (save && !disabled) onRename(name);
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
  return <div ref={editorRef} className={`class-setup-section-heading ${className}`} onBlur={(event) => { if (editing && !editorRef.current?.contains(event.relatedTarget)) finishEditing(true); }}>
    <h3><span ref={titleRef} className="class-setup-meeting-title" contentEditable={editing && !disabled ? "plaintext-only" : false} suppressContentEditableWarning role={editing ? "textbox" : undefined} aria-label={editing ? label : undefined} aria-invalid={invalid || undefined} aria-disabled={disabled || undefined} aria-multiline={editing ? false : undefined} tabIndex={editing ? 0 : undefined} spellCheck={false} data-caret-at-end={caretAtEnd} data-preview={editing ? previewName ?? undefined : undefined} onDoubleClick={() => { if (!editing && !disabled) beginEditing(true); }} onInput={(event) => {
      setPreviewName(null);
      const heading = event.currentTarget;
      const rawText = (heading.textContent ?? "").replace(/[\r\n]+/g, " ");
      if (rawText.length > maxLength) flashLimit();
      const text = rawText.slice(0, maxLength);
      // Browsers leave a <br> in an emptied contenteditable, adding a blank line.
      if (text !== heading.textContent || (!text && heading.hasChildNodes())) {
        heading.textContent = text;
        const range = document.createRange();
        range.selectNodeContents(heading); range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges(); selection?.addRange(range);
      }
      updateCaret();
    }} onAnimationEnd={(event) => { if (event.animationName === "class-setup-name-limit") event.currentTarget.removeAttribute("data-limit-flash"); }} onKeyUp={updateCaret} onMouseUp={updateCaret} onKeyDown={handleEditingKey}>{title}</span></h3>
    {editing && presets.length > 0 && <div className="class-setup-meeting-presets" role="group" aria-label={`${label} presets`}>{presets.map((name) => <button key={name} type="button" onMouseEnter={() => setPreviewName(name)} onMouseLeave={() => setPreviewName(null)} onFocus={() => setPreviewName(name)} onBlur={() => setPreviewName(null)} onPointerDown={(event) => event.preventDefault()} onKeyDown={handleEditingKey} onClick={() => {
      if (titleRef.current) titleRef.current.textContent = name;
      finishEditing(true, true);
    }}>{name}</button>)}</div>}
    {!editing && <button ref={pencilRef} type="button" className="class-setup-meeting-rename" aria-label={`Rename ${title}`} disabled={disabled} onClick={() => beginEditing(false)}><Pencil size={17} aria-hidden="true" /></button>}
  </div>;
}
