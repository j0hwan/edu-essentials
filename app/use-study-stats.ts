"use client";
import { useMemo } from "react";
import { studyStats, type StudySession } from "../lib/study";

// Recalculate day totals when records or calendar settings change, not per tick.
export function useStudyStats(sessions: StudySession[], today: string, timezone: string, monday: boolean) {
  return useMemo(() => studyStats(sessions, today, timezone, monday), [sessions, today, timezone, monday]);
}
