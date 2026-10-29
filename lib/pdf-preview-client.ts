import PdfPreviewWorker from "./pdf-preview.worker?worker";

export type PdfPreviewResult = { pages: number; image: Blob; width: number; height: number };

export function renderPdfPreviewPage(data: Blob, page: number, signal: AbortSignal, createWorker = () => new PdfPreviewWorker(), timeoutMs = 20_000): Promise<PdfPreviewResult | null> {
  if (signal.aborted) return Promise.resolve(null);
  if (data.size > 20 * 1024 * 1024) return Promise.reject(new Error("PDF is too large to preview."));
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (result: PdfPreviewResult | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish(null, new Error("PDF preview timed out.")), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(null, new Error("PDF preview worker failed."));
    worker.onmessage = (event: MessageEvent<{ type?: string; pages?: number; image?: Blob; width?: number; height?: number; error?: boolean; reason?: string }>) => {
      if (event.data?.type !== "pdf-preview:result") return;
      const { image, pages, width, height, error, reason } = event.data;
      try {
        if (settled) return;
        if (error) throw new Error(typeof reason === "string" ? `PDF could not be rendered: ${reason.slice(0, 200)}` : "PDF could not be rendered.");
        if (!Number.isInteger(pages) || pages! <= 0 || !(image instanceof Blob) || image.type !== "image/png" || image.size <= 0 || !Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0 || width! > 1200 || height! > 1600) throw new Error("PDF could not be rendered.");
        finish({ pages: pages!, image, width: width!, height: height! });
      } catch (cause) { finish(null, cause instanceof Error ? cause : new Error("PDF preview failed.")); }
    };
    try { worker.postMessage({ type: "pdf-preview:render", data, page }); }
    catch { finish(null, new Error("Could not start PDF preview.")); }
  });
}
