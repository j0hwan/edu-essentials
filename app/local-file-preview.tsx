"use client";

/* eslint-disable @next/next/no-img-element -- These previews render files selected locally in this dialog. */
import { useEffect, useState } from "react";
import "./local-file-preview.css";

type LocalFilePreviewProps = { file: File };

function previewKind(file: File): "image" | "pdf" | "text" | "unsupported" {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("text/") || /\.(txt|md|markdown|csv|json|log|html|xml)$/i.test(name)) return "text";
  return "unsupported";
}

export default function LocalFilePreview({ file }: LocalFilePreviewProps) {
  const kind = previewKind(file);
  const pdfTooLarge = kind === "pdf" && file.size > 20 * 1024 * 1024;
  const textTooLarge = kind === "text" && file.size > 1024 * 1024;
  const [objectUrl, setObjectUrl] = useState("");
  const [pdfImage, setPdfImage] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState("");

  useEffect(() => {
    if (kind === "image") {
      const url = URL.createObjectURL(file);
      let active = true;
      queueMicrotask(() => { if (active) setObjectUrl(url); });
      return () => { active = false; URL.revokeObjectURL(url); };
    }
    if (kind === "pdf") {
      const controller = new AbortController();
      let loadingTask: { destroy: () => Promise<void> } | null = null;
      let cancelRender: (() => void) | null = null;
      const disposePdfTask = () => {
        const task = loadingTask;
        loadingTask = null;
        if (task) void task.destroy().catch(() => {});
      };
      if (pdfTooLarge) return;
      void (async () => {
        try {
          const pdfjs = await import("unpdf/pdfjs");
          if (controller.signal.aborted) return;
          const data = new Uint8Array(await file.arrayBuffer());
          if (controller.signal.aborted) return;
          const task = pdfjs.getDocument({ data, useSystemFonts: true, useWasm: false, maxImageSize: 5_000_000 });
          loadingTask = task;
          const pdf = await task.promise;
          const page = await pdf.getPage(1);
          if (controller.signal.aborted) return;
          const canvas = document.createElement("canvas");
          try {
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(440 / base.width, 1.4, 600 / base.height);
            const viewport = page.getViewport({ scale });
            const outputScale = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.ceil(viewport.width * outputScale);
            canvas.height = Math.ceil(viewport.height * outputScale);
            const renderTask = page.render({ canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
            cancelRender = () => renderTask.cancel();
            await renderTask.promise;
            cancelRender = null;
            if (!controller.signal.aborted) setPdfImage(canvas.toDataURL("image/png"));
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch {
          if (!controller.signal.aborted) setPdfError("This local file could not be rendered as a PDF.");
        } finally {
          disposePdfTask();
        }
      })();
      return () => {
        controller.abort();
        cancelRender?.();
        disposePdfTask();
      };
    }
    if (kind !== "text") return;
    let active = true;
    if (textTooLarge) return () => { active = false; };
    void file.text().then((value) => {
      if (active) setText(value);
    }).catch(() => {
      if (active) setTextError("This local file could not be read for preview.");
    });
    return () => { active = false; };
  }, [file, kind, pdfTooLarge, textTooLarge]);

  return <section className="files-local-preview" aria-label="Local file preview">
    <header className="files-local-preview-header">
      <div><strong>Local preview</strong><span>Not uploaded · Ready to upload</span></div>
      <span>{file.type || "File"}</span>
    </header>
    {kind === "image" && objectUrl && <div className="files-local-preview-image"><img src={objectUrl} alt={`Preview of ${file.name}`} /></div>}
    {kind === "pdf" && <div className="files-local-preview-pdf">{pdfTooLarge ? <span>This PDF is too large to preview here.</span> : pdfImage ? <img src={pdfImage} alt={`First page of ${file.name}`} /> : <span>{pdfError || "Rendering local PDF preview…"}</span>}</div>}
    {kind === "text" && <pre className="files-local-preview-text">{textTooLarge ? "This text file is too large to preview here." : textError || text || "Loading local preview…"}</pre>}
    {kind === "unsupported" && <div className="files-local-preview-unavailable">Preview is unavailable for this file type. The original file stays on this device until you upload it.</div>}
  </section>;
}
