import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { PdfPreview } from "../../app/pdf-preview";

declare global {
  interface Window {
    __mountPdfPreview: () => void;
    __unmountPdfPreview: () => void;
    __pdfPreviewSize: number;
  }
}

function makeTwoPagePdf() {
  const firstPage = "1 1 1 rg 0 0 300 400 re f\n0 0 1 rg 30 30 100 100 re f\n1 0 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Page 1) Tj ET\n";
  const secondPage = "1 1 1 rg 0 0 300 400 re f\n0 0.8 0 rg 30 30 100 100 re f\n1 0.8 0 rg 200 250 80 100 re f\nBT /F1 32 Tf 20 200 Td (Page 2) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${firstPage.length} >>\nstream\n${firstPage}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${secondPage.length} >>\nstream\n${secondPage}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

const pdf = new Blob([makeTwoPagePdf()], { type: "application/pdf" });
window.__pdfPreviewSize = pdf.size;
let root: Root | undefined;

window.__mountPdfPreview = () => {
  root = createRoot(document.getElementById("app")!);
  root.render(React.createElement(PdfPreview, { data: pdf, name: "two-page-colors.pdf" }));
};

window.__unmountPdfPreview = () => {
  root?.unmount();
  root = undefined;
  document.getElementById("app")?.replaceChildren();
};
