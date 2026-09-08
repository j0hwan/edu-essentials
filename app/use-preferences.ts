"use client";
import { useEffect } from "react";
import type { Preferences } from "../lib/profile";

export function usePreferences(preferences: Preferences) {
  const { theme, reducedMotion, highContrast } = preferences;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      root.style.colorScheme = root.dataset.theme;
      root.dataset.motion = reducedMotion ? "reduced" : "full";
      root.dataset.contrast = highContrast ? "high" : "normal";
    };
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, reducedMotion, highContrast]);
}
