"use client";

import { useEffect, useState } from "react";
import { PdfPreview } from "./pdf-preview";

export function useSyllabusPreviewUrl(file?: File) {
  const [asset, setAsset] = useState<{ file: File; url: string }>();
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file.slice(0, file.size, "application/pdf"));
    let active = true;
    queueMicrotask(() => { if (active) setAsset({ file, url }); });
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [file]);
  return asset?.file === file ? asset?.url ?? "" : "";
}

export default function SyllabusSourcePane({ file, url }: { file: File; url: string }) {
  return <section className="syllabus-source-pane" aria-label="Uploaded syllabus">
    {url && <PdfPreview data={file} name={file.name} downloadUrl={url} focusable />}
  </section>;
}
