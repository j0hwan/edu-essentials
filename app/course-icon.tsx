import { Atom, BookOpen, Brain, BriefcaseBusiness, Calculator, ChartNoAxesCombined, Code, Cog, Dna, Drama, Dumbbell, FlaskConical, Globe, GraduationCap, HeartPulse, Landmark, Languages, Leaf, Microscope, Music, Palette, Pencil, Scale, type LucideProps } from "lucide-react";
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
  brain: Brain,
  scale: Scale,
  "briefcase-business": BriefcaseBusiness,
  "heart-pulse": HeartPulse,
  leaf: Leaf,
  cog: Cog,
  drama: Drama,
} satisfies Record<Exclude<CourseIconId, "none">, typeof BookOpen>;

export default function CourseIcon({ icon, ...props }: LucideProps & { icon?: string }) {
  const iconId = isCourseIconId(icon) ? icon : DEFAULT_COURSE_ICON;
  if (iconId === "none") return null;
  const Icon = courseIcons[iconId];
  return <Icon {...props} />;
}
