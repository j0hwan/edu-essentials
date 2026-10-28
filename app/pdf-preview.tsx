"use client";

import { useEffect, useRef, useState } from "react";
import { renderPdfPreviewPage } from "../lib/pdf-preview-client";

export function PdfPreview({ data, name, downloadUrl }: { data: Blob; name: string; downloadUrl?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ data: Blob; page: number; attempt: number; pages?: number; error?: string } | null>(null);
  const [documentInfo, setDocumentInfo] = useState<{ data: Blob; pages: number } | null>(null);
  const current = result?.data === data && result.page === page && result.attempt === attempt ? result : null;
  const pages = documentInfo?.data === data ? documentInfo.pages : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    void renderPdfPreviewPage(data, canvas, page, controller.signal).then((pages) => {
      if (!controller.signal.aborted) { setResult({ data, page, attempt, pages }); setDocumentInfo({ data, pages }); }
    }).catch((cause) => {
      const detail = cause instanceof Error ? ` ${cause.message}` : "";
      if (!controller.signal.aborted) setResult({ data, page, attempt, error: `This PDF could not be previewed.${detail} Download the original file to open it.` });
    });
    return () => { controller.abort(); canvas.width = 0; canvas.height = 0; };
  }, [data, page, attempt]);

  return <div className="private-pdf-preview">
    {!current && <p role="status">Rendering PDF preview…</p>}
    {current?.error && <p role="alert">{current.error} <button type="button" onClick={() => setAttempt((previous) => previous + 1)}>Retry PDF preview</button> {downloadUrl && <a href={downloadUrl} download={name}>Download original PDF</a>}</p>}
    <canvas key={`${page}:${attempt}`} ref={canvasRef} hidden={!current?.pages} role="img" aria-label={`${name}, page ${page}`} />
    {pages && <div className="pdf-preview-controls"><button type="button" disabled={page <= 1} onClick={() => setPage((previous) => previous - 1)}>Previous page</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((previous) => previous + 1)}>Next page</button></div>}
  </div>;
}
