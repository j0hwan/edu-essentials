"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

export default function ClassSetupDocumentPreview({ file, url, onEscape }: { file: File; url: string; onEscape: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const image = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
  const plainText = file.type.startsWith("text/") || /\.(txt|md|csv)$/i.test(file.name);

  useEffect(() => {
    const reader = plainText ? new FileReader() : null;
    if (reader) {
      reader.onload = () => setText(String(reader.result ?? ""));
      reader.onerror = () => setFailed(true);
      reader.readAsText(file);
    }
    return () => {
      if (reader?.readyState === FileReader.LOADING) reader.abort();
    };
  }, [file, plainText]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let frameDocument: Document | null = null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    };
    const bind = () => {
      frameDocument?.removeEventListener("keydown", keydown);
      frameDocument = frame.contentDocument;
      frameDocument?.addEventListener("keydown", keydown);
    };
    frame.addEventListener("load", bind);
    bind();
    return () => {
      frame.removeEventListener("load", bind);
      frameDocument?.removeEventListener("keydown", keydown);
    };
  }, [url, onEscape]);

  return <div className="class-setup-document-preview" aria-label="Syllabus preview">
    {pdf && url ? <iframe ref={frameRef} title={`Syllabus preview: ${file.name}`} src={url} />
      : image && url ? <div role="img" aria-label={file.name} className="class-setup-document-image" style={{ backgroundImage: `url(${url})` }} />
        : plainText && !failed ? text === null ? <p role="status">Loading preview…</p> : <pre>{text}</pre>
          : <div className="class-setup-document-fallback"><FileText size={32} aria-hidden="true" /><strong>{file.name}</strong><p>{failed ? "This file could not be previewed." : "Preview is available for PDF, text, and image files. This document will still be attached to your class."}</p>{url && <a href={url} download={file.name}>Download document</a>}</div>}
  </div>;
}
