import type { Metadata } from "next";
import { MAP_PREVIEW_PLACEHOLDERS, SYLLABUS_PREVIEW_PLACEHOLDER } from "../../../lib/course-preview-placeholders";

export const metadata: Metadata = {
  title: "Dashboard | EduEssentials",
  description: "Review your classes, assignments, deadlines, and progress.",
};

export default function DashboardPage() {
  return <>
    {MAP_PREVIEW_PLACEHOLDERS.map((src) => <link key={src} rel="preload" as="image" href={src} />)}
    <link rel="preload" as="image" href={SYLLABUS_PREVIEW_PLACEHOLDER} />
  </>;
}
