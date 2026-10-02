import { getDocumentProxy } from "unpdf";
import { chunkPages } from "./chunks";

export class UnsupportedDocument extends Error {}
export async function extractDocument(bytes: Uint8Array, mime: string) {
  if (bytes.byteLength > 10485760) throw new UnsupportedDocument("AI indexing supports files up to 10 MB.");
  if (["text/plain", "text/markdown"].includes(mime)) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new UnsupportedDocument("Save the text file as UTF-8 before indexing."); }
    if (!text.trim()) throw new UnsupportedDocument("This file has no readable text.");
    return chunkPages([text]);
  }
  if (mime !== "application/pdf") throw new UnsupportedDocument("Only text, Markdown, and selectable-text PDFs are supported.");
  const pdf = await getDocumentProxy(bytes, { useSystemFonts: false, verbosity: 0 });
  try {
    if (pdf.numPages > 100) throw new UnsupportedDocument("AI indexing supports PDFs up to 100 pages.");
    const pages: string[] = [];
    let total = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const documentPage = await pdf.getPage(page), content = await documentPage.getTextContent();
      const text = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
      // Fail closed for image-only pages: do not silently claim complete extraction.
      if (!text.trim()) throw new UnsupportedDocument(`Page ${page} has no extractable text. Scanned or partially scanned PDFs need OCR, which is not enabled.`);
      total += text.length;
      if (total > 1000000) throw new UnsupportedDocument("This PDF exceeds the extracted-text limit.");
      pages.push(text); documentPage.cleanup();
    }
    return chunkPages(pages);
  } finally { await pdf.loadingTask.destroy(); }
}
