import {
  AlertOctagon,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileSearch,
  Flame,
  GraduationCap,
  List,
  Maximize2,
  PieChart,
  SlidersHorizontal,
  StickyNote,
  Sun,
  Target,
  TimerReset,
  Quote as QuoteIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WidgetType, WidgetSize, Workspace } from "../lib/workspace-codec";

export type WidgetTemplate = {
  type: WidgetType;
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  defaultSize: WidgetSize;
};

export const widgetTemplates: WidgetTemplate[] = [
  { type: "daily-goal", title: "Daily study goal", description: "Progress ring and time remaining", icon: Target, color: "indigo", defaultSize: "medium" },
  { type: "weekly-goal", title: "Weekly study goal", description: "Seven-day progress overview", icon: BarChart3, color: "sky", defaultSize: "medium" },
  { type: "upcoming", title: "Upcoming assignments", description: "Your next deadlines in order", icon: List, color: "violet", defaultSize: "large" },
  { type: "stoplight", title: "Stoplight assignments", description: "Work grouped by urgency", icon: SlidersHorizontal, color: "coral", defaultSize: "medium" },
  { type: "red-alerts", title: "Red-light alerts", description: "Overdue and due today only", icon: AlertOctagon, color: "red", defaultSize: "medium" },
  { type: "mini-calendar", title: "Mini calendar", description: "A compact look at your week", icon: CalendarDays, color: "blue", defaultSize: "medium" },
  { type: "pomodoro", title: "Pomodoro timer", description: "Focused 25-minute sessions", icon: TimerReset, color: "tomato", defaultSize: "small" },
  { type: "focus-timer", title: "Focus timer", description: "Minimal countdown for deep work", icon: Clock3, color: "navy", defaultSize: "small" },
  { type: "task-completion", title: "Task completion", description: "Track work across all classes", icon: CheckCircle2, color: "green", defaultSize: "medium" },
  { type: "assignment-pie", title: "Assignment pie chart", description: "Workload split by class", icon: PieChart, color: "purple", defaultSize: "medium" },
  { type: "gpa", title: "GPA tracker", description: "Current GPA and term trend", icon: GraduationCap, color: "gold", defaultSize: "small" },
  { type: "class-links", title: "Class quick links", description: "Jump into your courses", icon: BookOpen, color: "teal", defaultSize: "medium" },
  { type: "notes", title: "Quick notes", description: "An editable scratchpad", icon: StickyNote, color: "yellow", defaultSize: "medium" },
  { type: "exams", title: "Upcoming exams", description: "Countdowns for important tests", icon: FileSearch, color: "rose", defaultSize: "medium" },
  { type: "streak", title: "Study streak", description: "Keep your momentum going", icon: Flame, color: "orange", defaultSize: "small" },
  { type: "today", title: "Today at a glance", description: "Agenda, classes, and deadlines", icon: Sun, color: "blue", defaultSize: "large" },
  { type: "quote", title: "Daily motivation", description: "A calm reminder to keep going", icon: QuoteIcon, color: "lilac", defaultSize: "medium" },
  { type: "spacer", title: "Empty spacer", description: "Create breathing room in your layout", icon: Maximize2, color: "neutral", defaultSize: "small" },
];

export const defaultWorkspaces: Workspace[] = [
  {
    id: "my-day",
    name: "My Day",
    widgets: [
      { instanceId: "w1", type: "daily-goal", size: "medium" },
      { instanceId: "w2", type: "today", size: "large" },
      { instanceId: "w3", type: "red-alerts", size: "medium" },
      { instanceId: "w4", type: "pomodoro", size: "small" },
      { instanceId: "w5", type: "mini-calendar", size: "medium" },
      { instanceId: "w6", type: "task-completion", size: "medium" },
      { instanceId: "w7", type: "notes", size: "medium" },
    ],
  },
  {
    id: "study-mode",
    name: "Study Mode",
    widgets: [
      { instanceId: "w8", type: "pomodoro", size: "medium" },
      { instanceId: "w9", type: "upcoming", size: "large" },
      { instanceId: "w10", type: "weekly-goal", size: "medium" },
      { instanceId: "w11", type: "class-links", size: "medium" },
      { instanceId: "w12", type: "quote", size: "medium" },
    ],
  },
  {
    id: "finals-week",
    name: "Finals Week",
    widgets: [
      { instanceId: "w13", type: "exams", size: "medium" },
      { instanceId: "w14", type: "stoplight", size: "large" },
      { instanceId: "w15", type: "assignment-pie", size: "medium" },
      { instanceId: "w16", type: "streak", size: "small" },
    ],
  },
];
