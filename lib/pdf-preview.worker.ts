import { renderPdfPreviewPage } from "./pdf-preview";

const workerScope = self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void };

class PreviewCanvasFactory {
  create(width: number, height: number) {
    if (!(width > 0 && height > 0) || width * height > 5_000_000) throw new Error("PDF canvas is too large.");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { alpha: true }) };
  }
  reset(target: { canvas: OffscreenCanvas }, width: number, height: number) {
    if (!(width > 0 && height > 0) || width * height > 5_000_000) throw new Error("PDF canvas is too large.");
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target: { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null }) {
    if (target.canvas) { target.canvas.width = 0; target.canvas.height = 0; }
    target.canvas = null;
    target.context = null;
  }
}

class PreviewFilterFactory {
  addFilter() { return "none"; }
  addHCMFilter() { return "none"; }
  addAlphaFilter() { return "none"; }
  addLuminosityFilter() { return "none"; }
  addKnockoutFilter() { return "none"; }
  addHighlightHCMFilter() { return "none"; }
  addSelectionHCMFilter() { return "none"; }
  addSelectionFilter() { return "none"; }
  createSelectionStyle() { return null; }
  destroy() {}
}

self.onmessage = async (event: MessageEvent<{ type: string; data: Blob; page: number }>) => {
  if (event.data?.type !== "pdf-preview:render") return;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const pages = await renderPdfPreviewPage(event.data.data, canvas as unknown as HTMLCanvasElement, event.data.page, new AbortController().signal, async () => {
      const pdfjs = await import("unpdf/pdfjs");
      return { getDocument: (options) => pdfjs.getDocument({ ...options, CanvasFactory: PreviewCanvasFactory, FilterFactory: PreviewFilterFactory, ownerDocument: self as unknown as Document, disableFontFace: false }) };
    });
    const bitmap = canvas.transferToImageBitmap();
    workerScope.postMessage({ type: "pdf-preview:result", pages, bitmap }, [bitmap]);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.slice(0, 200) : "PDF rendering failed.";
    workerScope.postMessage({ type: "pdf-preview:result", error: true, reason });
  }
};
