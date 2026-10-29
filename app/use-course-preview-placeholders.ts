"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAP_PREVIEW_PLACEHOLDERS,
  SYLLABUS_PREVIEW_PLACEHOLDER,
} from "../lib/course-preview-placeholders";

const PLACEHOLDER_TIMEOUT_MS = 8_000;
const PLACEHOLDER_IMAGES = [...MAP_PREVIEW_PLACEHOLDERS, SYLLABUS_PREVIEW_PLACEHOLDER];

export function useCoursePreviewPlaceholders(enabled: boolean, scopeKey: string) {
  const [retryCount, setRetryCount] = useState(0);
  const attempt = useMemo(() => ({ enabled, scopeKey, retryCount }), [enabled, scopeKey, retryCount]);
  const [result, setResult] = useState<{ attempt: typeof attempt; status: "ready" | "failed" } | null>(null);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let finished = false;
    let remaining = PLACEHOLDER_IMAGES.length;
    const images: HTMLImageElement[] = [];
    const decoding = new Set<HTMLImageElement>();
    const finish = (status: "ready" | "failed") => {
      if (!active || finished) return;
      finished = true;
      clearTimeout(timeout);
      setResult({ attempt, status });
    };
    const settleOne = () => {
      if (!active || finished) return;
      remaining -= 1;
      if (remaining === 0) finish("ready");
    };
    const decoded = (image: HTMLImageElement) => {
      if (!active || finished || decoding.has(image)) return;
      decoding.add(image);
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        finish("failed");
        return;
      }
      if (typeof image.decode !== "function") {
        settleOne();
        return;
      }
      Promise.resolve().then(() => image.decode()).then(settleOne, () => finish("failed"));
    };
    const timeout = setTimeout(() => finish("failed"), PLACEHOLDER_TIMEOUT_MS);

    for (const src of PLACEHOLDER_IMAGES) {
      const image = new window.Image();
      images.push(image);
      image.onload = () => decoded(image);
      image.onerror = () => finish("failed");
      image.src = src;
      if (image.complete) {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) decoded(image);
        else finish("failed");
      }
    }

    return () => {
      active = false;
      clearTimeout(timeout);
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [enabled, attempt]);

  return {
    ready: !enabled || (result?.attempt === attempt && result.status === "ready"),
    failed: enabled && result?.attempt === attempt && result.status === "failed",
    retry,
  };
}
