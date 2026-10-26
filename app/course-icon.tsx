import { Atom, BookOpen, Calculator, ChartNoAxesCombined, Code, Dna, Dumbbell, FlaskConical, Globe, GraduationCap, Landmark, Languages, Microscope, Music, Palette, Pencil, type LucideProps } from "lucide-react";
import { DEFAULT_COURSE_ICON, isCourseIconId, type CourseIconId } from "../lib/course-icons";

const courseIcons = {
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  calculator: Calculator,
  atom: Atom,
  "flask-conical": FlaskConical,
  microscope: Microscope,
  dna: Dna,
  globe: Globe,
  landmark: Landmark,
  languages: Languages,
  code: Code,
  palette: Palette,
  music: Music,
  pencil: Pencil,
  "chart-no-axes-combined": ChartNoAxesCombined,
  dumbbell: Dumbbell,
} satisfies Record<CourseIconId, typeof BookOpen>;

export default function CourseIcon({ icon, ...props }: LucideProps & { icon?: string }) {
  const Icon = courseIcons[isCourseIconId(icon) ? icon : DEFAULT_COURSE_ICON];
  return <Icon {...props} />;
}
