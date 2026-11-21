"use client";
import { useEffect } from "react";
import type { Preferences } from "../lib/profile";

export function usePreferences(preferences: Preferences, enabled = true) {
  const { reducedMotion, highContrast } = preferences;
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.dataset.motion = reducedMotion ? "reduced" : "full";
    root.dataset.contrast = highContrast ? "high" : "normal";
  }, [enabled, reducedMotion, highContrast]);
}
