"use client";
import { useEffect } from "react";

// Kept outside forms so onboarding's and Settings' sign-out buttons are covered.
export function useSaveProtection(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guardSignout = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && new URL(form.action, window.location.href).pathname === "/auth/signout") {
        event.preventDefault(); event.stopImmediatePropagation();
        window.alert("You have unsaved changes. Save them before signing out, or download a copy and discard the edits using Reset to saved or Load latest saved settings. Workspace edits can be discarded with Reload saved workspace.");
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("submit", guardSignout, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("submit", guardSignout, true); };
  }, [unsaved]);
}

export function downloadDraft(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
