"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { renderPdfPreviewPage } from "../lib/pdf-preview-client";

type PreviewProps = { data: Blob; name: string; downloadUrl?: string };
type RenderQueue = { current: Promise<void> };

function PdfPageCanvas({ data, name, downloadUrl, page, queueRef, onReady }: PreviewProps & {
  page: number; queueRef: RenderQueue; onReady: (pages: number, ratio: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; error?: string } | null>(null);
  const autoRecoveryRef = useRef(false);
  const current = result?.attempt === attempt ? result : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    let disposed = false;
    const onContextLost = () => {
      if (disposed || controller.signal.aborted) return;
      controller.abort();
      if (autoRecoveryRef.current) {
        setResult({ attempt, error: "This PDF could not be previewed. Its canvas context was lost. Download the original file to open it." });
      } else {
        autoRecoveryRef.current = true;
        setAttempt((previous) => previous + 1);
      }
    };
    canvas.addEventListener("contextlost", onContextLost);
    queueRef.current = queueRef.current.then(async () => {
      if (controller.signal.aborted) return;
      try {
        const pages = await renderPdfPreviewPage(data, canvas, page, controller.signal);
        if (!controller.signal.aborted) {
          setResult({ attempt });
          onReady(pages, canvas.width / canvas.height);
        }
      } catch (cause) {
        const detail = cause instanceof Error ? ` ${cause.message}` : "";
        if (!controller.signal.aborted) setResult({ attempt, error: `This PDF could not be previewed.${detail} Download the original file to open it.` });
      }
    });
    return () => {
      disposed = true;
      canvas.removeEventListener("contextlost", onContextLost);
      controller.abort();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [data, page, attempt, queueRef, onReady]);

  const retry = () => {
    autoRecoveryRef.current = false;
    setAttempt((previous) => previous + 1);
  };

  return <>
    {!current && <p role="status">Rendering PDF preview…</p>}
    {current?.error && <p role="alert">{current.error} <button type="button" onClick={retry}>Retry PDF preview</button> {downloadUrl && <a href={downloadUrl} download={name}>Download original PDF</a>}</p>}
    <canvas key={attempt} ref={canvasRef} hidden={!current || Boolean(current.error)} role="img" aria-label={`${name}, page ${page}`} />
  </>;
}

function PdfPage({ page, root, queueRef, onDocumentReady, ...props }: PreviewProps & {
  page: number; root: HTMLDivElement | null; queueRef: RenderQueue; onDocumentReady: (pages: number) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(page === 1 || typeof IntersectionObserver === "undefined");
  const [ratio, setRatio] = useState(0.75);
  const onReady = useCallback((pages: number, pageRatio: number) => {
    if (Number.isFinite(pageRatio) && pageRatio > 0) setRatio(pageRatio);
    onDocumentReady(pages);
  }, [onDocumentReady]);

  useEffect(() => {
    const element = pageRef.current;
    if (!root || !element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), { root, rootMargin: "800px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  return <div ref={pageRef} className="pdf-preview-page" style={{ aspectRatio: ratio }} data-page={page}>
    {nearby && <PdfPageCanvas {...props} page={page} queueRef={queueRef} onReady={onReady} />}
  </div>;
}

function PdfDocument(props: PreviewProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [pages, setPages] = useState(1);
  const queueRef = useRef(Promise.resolve());

  return <div ref={setRoot} className="private-pdf-preview" role="region" aria-label="PDF preview">
    {Array.from({ length: pages }, (_, index) => <PdfPage key={index + 1} {...props} page={index + 1} root={root} queueRef={queueRef} onDocumentReady={setPages} />)}
  </div>;
}

export function PdfPreview(props: PreviewProps) {
  const [document, setDocument] = useState({ data: props.data, revision: 0 });
  if (document.data !== props.data) setDocument({ data: props.data, revision: document.revision + 1 });
  return <PdfDocument key={document.revision} {...props} />;
}
