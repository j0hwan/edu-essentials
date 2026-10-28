import PdfPreviewWorker from "./pdf-preview.worker?worker";

export function renderPdfPreviewPage(data: Blob, canvas: HTMLCanvasElement, page: number, signal: AbortSignal, createWorker = () => new PdfPreviewWorker(), timeoutMs = 20_000): Promise<number> {
  if (signal.aborted) return Promise.resolve(0);
  if (data.size > 20 * 1024 * 1024) return Promise.reject(new Error("PDF is too large to preview."));
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (pages: number, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(pages);
    };
    const abort = () => finish(0);
    const timer = setTimeout(() => finish(0, new Error("PDF preview timed out.")), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(0, new Error("PDF preview worker failed."));
    worker.onmessage = (event: MessageEvent<{ type?: string; pages?: number; bitmap?: ImageBitmap; error?: boolean; reason?: string }>) => {
      if (event.data?.type !== "pdf-preview:result") return;
      const { bitmap, pages, error, reason } = event.data;
      try {
        if (settled) return;
        if (error) throw new Error(typeof reason === "string" ? `PDF could not be rendered: ${reason.slice(0, 200)}` : "PDF could not be rendered.");
        if (!bitmap || !pages || bitmap.width > 1200 || bitmap.height > 1600) throw new Error("PDF could not be rendered.");
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable.");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        context.drawImage(bitmap, 0, 0);
        finish(pages);
      } catch (cause) { finish(0, cause instanceof Error ? cause : new Error("PDF preview failed.")); }
      finally { bitmap?.close(); }
    };
    try { worker.postMessage({ type: "pdf-preview:render", data, page }); }
    catch { finish(0, new Error("Could not start PDF preview.")); }
  });
}
