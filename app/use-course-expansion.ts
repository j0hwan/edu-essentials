"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Course } from "../lib/academics";
import { clearCourseImageThumbnail, courseExpansionStorageKey } from "../lib/course-image-thumbnail";

export function useCourseExpansion({ profileId, page, courses, ready, persist = true }: {
  profileId: string;
  page: string;
  courses: Course[];
  ready: boolean;
  persist?: boolean;
}) {
  const storageKey = courseExpansionStorageKey(profileId);
  const [selection, setSelection] = useState<{ profileId: string; page: string; course: Course; restored: boolean } | null>(null);
  const [reloadProfileId, setReloadProfileId] = useState<string | null | undefined>(undefined);
  const previousContext = useRef<string | null>(null);

  useLayoutEffect(() => {
    const context = JSON.stringify([profileId, page, ready, persist]);
    // Course edits must not reopen a course that the user explicitly closed.
    if (previousContext.current === context) return;
    if (previousContext.current === null) {
      let pendingProfileId: string | null = null;
      if (!ready && page === "dashboard" && persist) {
        try {
          const navigation = window.performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
          if (navigation?.type === "reload" && window.localStorage.getItem(storageKey)) pendingProfileId = profileId;
        } catch { /* Use the regular dashboard loader when browser storage is unavailable. */ }
      }
      // Resolve browser-only restoration before paint; the server cannot choose a skeleton yet.
      setReloadProfileId(pendingProfileId);
    } else if (ready || page !== "dashboard" || !persist) {
      setReloadProfileId(null);
    }
    previousContext.current = context;
    let nextSelection = ready && selection?.profileId === profileId && selection.page === page ? selection : null;
    if (!nextSelection && page === "dashboard" && ready && persist) {
      try {
        const courseId = window.localStorage.getItem(storageKey);
        const course = courses.find((item) => item.id === courseId);
        if (course) nextSelection = { profileId, page, course, restored: true };
        if (!course) {
          if (courseId) window.localStorage.removeItem(storageKey);
          clearCourseImageThumbnail(profileId);
        }
      } catch { /* Course navigation remains available without browser storage. */ }
    }
    setSelection(nextSelection);
  }, [profileId, page, courses, ready, persist, storageKey, selection]);

  const clearSavedCourse = useCallback(() => {
    if (!persist) return;
    clearCourseImageThumbnail(profileId);
    if (page !== "dashboard") return;
    try { window.localStorage.removeItem(storageKey); }
    catch { /* Closing remains available without browser storage. */ }
  }, [profileId, page, persist, storageKey]);

  const setSelectedClass = useCallback((course: Course | null) => {
    setSelection(course ? { profileId, page, course, restored: false } : null);
    if (!course) { clearSavedCourse(); return; }
    if (page !== "dashboard" || !persist) return;
    try {
      if (window.localStorage.getItem(storageKey) !== course.id) clearCourseImageThumbnail(profileId);
      window.localStorage.setItem(storageKey, course.id);
    } catch { /* Keep course controls usable if browser storage is unavailable. */ }
  }, [profileId, page, persist, storageKey, clearSavedCourse]);

  const openDashboardCourse = useCallback((course: Course) => {
    setSelection({ profileId, page: "dashboard", course, restored: false });
    if (!persist) return;
    try {
      if (window.localStorage.getItem(storageKey) !== course.id) clearCourseImageThumbnail(profileId);
      window.localStorage.setItem(storageKey, course.id);
    }
    catch { /* The requested course can still open without browser storage. */ }
  }, [profileId, persist, storageKey]);

  // Navigation and workspace reloads hide the detail without treating that as an explicit close.
  const resetSelectedClass = useCallback(() => setSelection(null), []);
  const selectedClass = selection?.profileId === profileId && selection.page === page ? courses.find((course) => course.id === selection.course.id) ?? selection.course : null;
  const skipOpeningAnimation = selectedClass !== null && selection?.restored === true;
  const restoringCourseOnReload = reloadProfileId === profileId && page === "dashboard" && persist;
  return { selectedClass, setSelectedClass, resetSelectedClass, clearSavedCourse, openDashboardCourse, skipOpeningAnimation, restoringCourseOnReload, restorationChecked: reloadProfileId !== undefined };
}
