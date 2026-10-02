import { addDays, weekStart } from "./academics";

export type CalendarView = "month" | "week" | "day";
export function calendarDays(anchor: string, view: CalendarView, monday: boolean): string[] {
  const first = anchor.slice(0, 7) + "-01";
  const start = view === "month" ? weekStart(first, monday) : view === "week" ? weekStart(anchor, monday) : anchor;
  const last = new Date(first + "T12:00:00Z");
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const count = view === "month" ? Math.ceil((Math.round((last.getTime() - new Date(start + "T12:00:00Z").getTime()) / 86400000) + 1) / 7) * 7 : view === "week" ? 7 : 1;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
export function timeMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
export function calendarTime(time: string): string {
  if (!time) return "All day";
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

/** Partition connected overlap groups into lanes; adjacent meetings share a lane. */
export function placeCalendarItems<T extends { id: string; start: number; end: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const result: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [], ends: number[] = [], groupEnd = -1;
  const flush = () => { group.forEach((item) => result.push({ ...item, lanes: ends.length })); group = []; ends = []; };
  for (const item of sorted) {
    if (item.start >= groupEnd) flush();
    let lane = ends.findIndex((end) => end <= item.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.end;
    groupEnd = group.length ? Math.max(groupEnd, item.end) : item.end;
    group.push({ ...item, lane, lanes: 1 });
  }
  flush();
  return result;
}
