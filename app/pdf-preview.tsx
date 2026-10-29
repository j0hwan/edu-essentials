"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderPdfPreviewPage } from "../lib/pdf-preview-client";

type PreviewProps = { data: Blob; name: string; downloadUrl?: string; onSettled?: () => void };
type DocumentProps = Omit<PreviewProps, "onSettled"> & { onDocumentSettled: (data: Blob) => void };
type RenderQueue = { current: Promise<void> };

function decodePageImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new Error("PDF page image decoding was aborted."));
    const timer = setTimeout(() => finish(new Error("PDF page image decoding timed out.")), 20_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.decode().then(() => finish(), finish);
  });
}

function PdfPageImage({ data, name, downloadUrl, page, queueRef, onReady, onDocumentSettled }: DocumentProps & {
  page: number; queueRef: RenderQueue; onReady: (pages: number, ratio: number) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; error?: string } | null>(null);
  const current = result?.attempt === attempt ? result : null;

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const controller = new AbortController();
    let imageUrl: string | undefined;
    queueRef.current = queueRef.current.then(async () => {
      if (controller.signal.aborted) return;
      try {
        const rendered = await renderPdfPreviewPage(data, page, controller.signal);
        if (!rendered || controller.signal.aborted) return;
        imageUrl = URL.createObjectURL(rendered.image);
        image.width = rendered.width;
        image.height = rendered.height;
        image.src = imageUrl;
        await decodePageImage(image, controller.signal);
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("PDF page image is unavailable.");
        if (!controller.signal.aborted) {
          setResult({ attempt });
          onReady(rendered.pages, rendered.width / rendered.height);
          if (page === 1) onDocumentSettled(data);
        }
      } catch (cause) {
        const detail = cause instanceof Error ? ` ${cause.message}` : "";
        if (!controller.signal.aborted) {
          image.removeAttribute("src");
          if (imageUrl) URL.revokeObjectURL(imageUrl);
          imageUrl = undefined;
          setResult({ attempt, error: `This PDF could not be previewed.${detail} Download the original file to open it.` });
          if (page === 1) onDocumentSettled(data);
        }
      }
    });
    return () => {
      controller.abort();
      image.removeAttribute("src");
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [data, page, attempt, queueRef, onReady, onDocumentSettled]);

  const retry = () => {
    setAttempt((previous) => previous + 1);
  };

  return <>
    {!current && <p role="status">Rendering PDF preview…</p>}
    {current?.error && <p role="alert">{current.error} <button type="button" onClick={retry}>Retry PDF preview</button> {downloadUrl && <a href={downloadUrl} download={name}>Download original PDF</a>}</p>}
    <img key={attempt} ref={imageRef} hidden={!current || Boolean(current.error)} alt={`${name}, page ${page}`} aria-label={`${name}, page ${page}`} />
  </>;
}

function PdfPage({ page, root, queueRef, onDocumentReady, ...props }: DocumentProps & {
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
    {nearby && <PdfPageImage {...props} page={page} queueRef={queueRef} onReady={onReady} />}
  </div>;
}

function PdfDocument(props: DocumentProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [pages, setPages] = useState(1);
  const queueRef = useRef(Promise.resolve());

  return <div ref={setRoot} className="private-pdf-preview" role="region" aria-label="PDF preview">
    {Array.from({ length: pages }, (_, index) => <PdfPage key={index + 1} {...props} page={index + 1} root={root} queueRef={queueRef} onDocumentReady={setPages} />)}
  </div>;
}

export function PdfPreview(props: PreviewProps) {
  const [document, setDocument] = useState({ data: props.data, revision: 0 });
  const onSettledRef = useRef(props.onSettled);
  const mountedRef = useRef(false);
  const settlementRef = useRef({ data: props.data, settled: false, notified: false });
  const notify = useCallback((settlement: typeof settlementRef.current) => {
    if (!mountedRef.current || !settlement.settled || settlement.notified || !onSettledRef.current) return;
    settlement.notified = true;
    try { onSettledRef.current(); } catch { /* An optional settlement observer cannot interrupt PDF rendering. */ }
  }, []);
  const onDocumentSettled = useCallback((data: Blob) => {
    const settlement = settlementRef.current;
    if (!mountedRef.current || settlement.data !== data) return;
    settlement.settled = true;
    notify(settlement);
  }, [notify]);
  useLayoutEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useLayoutEffect(() => {
    if (settlementRef.current.data !== props.data) settlementRef.current = { data: props.data, settled: false, notified: false };
    onSettledRef.current = props.onSettled;
    if (settlementRef.current.data === props.data) notify(settlementRef.current);
  }, [props.data, props.onSettled, notify]);
  if (document.data !== props.data) setDocument({ data: props.data, revision: document.revision + 1 });
  const documentProps = { data: props.data, name: props.name, downloadUrl: props.downloadUrl };
  return <PdfDocument key={document.revision} {...documentProps} onDocumentSettled={onDocumentSettled} />;
}
