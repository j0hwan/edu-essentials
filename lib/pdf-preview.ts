type PdfLoader = typeof import("unpdf/pdfjs");

export async function renderPdfPreviewPage(data: Blob, canvas: HTMLCanvasElement, pageNumber: number, signal: AbortSignal, loadPdf: () => Promise<Pick<PdfLoader, "getDocument">> = () => import("unpdf/pdfjs")) {
  if (data.size > 20 * 1024 * 1024) throw new Error("PDF is too large to preview.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (signal.aborted) return 0;
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new Error("Invalid PDF header.");
  const pdfjs = await loadPdf();
  if (signal.aborted) return 0;
  const loading = pdfjs.getDocument({ data: bytes, enableXfa: false, useSystemFonts: true, useWasm: false, maxImageSize: 5_000_000, stopAtErrors: true });
  let renderTask: { cancel: () => void } | undefined;
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; void loading.destroy().catch(() => {}); } };
  const cancel = () => { renderTask?.cancel(); dispose(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const pdf = await loading.promise;
    if (signal.aborted) return 0;
    const page = await pdf.getPage(pageNumber);
    if (signal.aborted) return 0;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1200 / base.width, 1600 / base.height, 2);
    const viewport = page.getViewport({ scale });
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error("Invalid PDF page dimensions.");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is unavailable.");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const rendering = page.render({ canvas, canvasContext: context, viewport });
    renderTask = rendering;
    await rendering.promise;
    if (!signal.aborted && context.isContextLost?.()) throw new Error("Canvas context was lost.");
    return signal.aborted ? 0 : pdf.numPages;
  } finally {
    signal.removeEventListener("abort", cancel);
    dispose();
  }
}
