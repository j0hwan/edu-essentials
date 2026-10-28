"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import type { Dispatch, MouseEvent, RefObject, SetStateAction } from "react";
import { ArrowRight, Bell, BookOpen, CalendarDays, CheckCircle2, FlaskConical, Flame, FolderOpen, House, Menu, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Settings, Upload, X } from "lucide-react";
import { durationLabel } from "../lib/study";
import type { ExperimentalDensity } from "../lib/experimental-data";

export type PageId = "home" | "dashboard" | "calendar" | "tasks" | "search" | "files" | "settings" | "assistant";

const navItems: { id: PageId; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "dashboard", label: "Dashboard", icon: BookOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "tasks", label: "Tasks", icon: CheckCircle2 },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "assistant", label: "Ask Edu", icon: MessageSquare },
];


type WorkspaceNavigationProps = {
  page: PageId;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  courseCount: number;
  studentName: string;
  profileMajor: string;
  streak: number;
  dailyMinutes: number;
  dailySeconds: number;
  dailyPercent: number;
  ready: boolean;
  dirty: boolean;
  profilePending: boolean;
  filesBusy: boolean;
  aiApplying: boolean;
  experimentalMode: ExperimentalDensity | null;
  experimentalMenuOpen: boolean;
  experimentalRestoring: boolean;
  appShellElement: HTMLDivElement | null;
  experimentalControlRef: RefObject<HTMLDivElement | null>;
  experimentalTriggerRef: RefObject<HTMLButtonElement | null>;
  experimentalMenuRef: RefObject<HTMLDivElement | null>;
  onToggleSidebar: () => void;
  onCloseNavigation: () => void;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, page: PageId) => void;
  onExperimentalMenuChange: Dispatch<SetStateAction<boolean>>;
  onApplyExperimentalData: (density: ExperimentalDensity) => void;
  onExitExperimentalMode: () => void;
  onOnboardingTest: () => void;
  onNewReview: () => void;
  onOpenStudy: () => void;
};

export default function WorkspaceNavigation({ page, sidebarOpen, sidebarCollapsed, courseCount, studentName, profileMajor, streak, dailyMinutes, dailySeconds, dailyPercent, ready, dirty, profilePending, filesBusy, aiApplying, experimentalMode, experimentalMenuOpen, experimentalRestoring, appShellElement, experimentalControlRef, experimentalTriggerRef, experimentalMenuRef, onToggleSidebar, onCloseNavigation, onNavigate, onExperimentalMenuChange, onApplyExperimentalData, onExitExperimentalMode, onOnboardingTest, onNewReview, onOpenStudy }: WorkspaceNavigationProps) {
  return <>
      <aside id="workspace-sidebar" className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-scroll-region">
        <div className="brand-row">
          <div className="brand-copy"><strong>EduEssentials</strong></div>
          <button className="icon-button sidebar-toggle" onClick={onToggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar">{sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
          <button className="icon-button sidebar-close" onClick={onCloseNavigation} aria-label="Close navigation"><X size={20} /></button>
        </div>

        <nav className="main-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.id} href={`/${item.id}`} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={(event) => onNavigate(event, item.id)} aria-label={item.label} title={item.label} aria-current={page === item.id ? "page" : undefined}>
                <Icon size={19} strokeWidth={2.1} />
                <span>{item.label}</span>
                {item.id === "dashboard" && <span className="nav-count">{courseCount}</span>}
              </Link>
            );
          })}
          <div className="experimental-control" ref={experimentalControlRef}>
            <button
              ref={experimentalTriggerRef}
              className={`nav-item experimental-trigger ${experimentalMode ? "active" : ""}`}
              type="button"
              aria-label="Experimental mode"
              title="Experimental mode"
              aria-expanded={experimentalMenuOpen}
              aria-controls="experimental-options"
              onClick={() => onExperimentalMenuChange((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onExperimentalMenuChange(true);
                }
              }}
            >
              <FlaskConical size={19} strokeWidth={2.1} />
              <span>Experimental mode</span>
              <span className="experimental-badge">TEMP</span>
            </button>
          </div>
        </nav>

        <button className="nav-item syllabus-nav" disabled={!ready} onClick={onNewReview} aria-label="Upload syllabus" title="Upload syllabus"><Upload size={22} /><span>Upload syllabus</span></button>
        <div className="sidebar-focus-card">
          <div className="focus-card-top"><span><Flame size={15} /> {streak} day streak</span><strong>{dailyMinutes ? `${dailyPercent}%` : "No target"}</strong></div>
          <div className="tiny-progress"><span style={{ width: `${dailyPercent}%` }} /></div>
          <p>{dailyMinutes ? `${durationLabel(Math.max(0, dailyMinutes * 60 - dailySeconds))} left toward today’s target.` : "Set your study targets."}</p>
          <button disabled={!ready} onClick={onOpenStudy}>Study & grades <ArrowRight size={14} /></button>
        </div>
        </div>

        <div className="sidebar-bottom">
          <Link href="/settings" className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={(event) => onNavigate(event, "settings")} aria-label="Settings" title="Settings" aria-current={page === "settings" ? "page" : undefined}><Settings size={19} /><span>Settings</span></Link>
          <Link href="/settings" className="profile-card" onClick={(event) => onNavigate(event, "settings")} aria-label={`${studentName} — profile settings`} title={`${studentName} — profile settings`}>
            <span className="avatar">{studentName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{studentName}</strong><small>{profileMajor || "Student workspace"}</small></span>
            <MoreHorizontal size={18} />
          </Link>
        </div>
      </aside>

      {experimentalMenuOpen && appShellElement && createPortal(<div
        ref={experimentalMenuRef}
        className="experimental-menu"
        id="experimental-options"
        tabIndex={-1}
        style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
      >
        <p>Fake preview data</p>
        {([
          ["clear", "Clear", "0 classes · 0 tasks"],
          ["light", "Light", "2 classes · 6 tasks"],
          ["medium", "Medium", "4 classes · 14 tasks"],
          ["packed", "Packed", "6 classes · 28 tasks"],
        ] as const).map(([value, label, detail]) => <button key={value} type="button" aria-label={`Load ${label} experimental data`} className={experimentalMode === value ? "selected" : ""} disabled={!ready || dirty || profilePending || filesBusy || experimentalRestoring} onClick={() => onApplyExperimentalData(value)}><span><strong>{label}</strong><small>{detail}</small></span>{experimentalMode === value && <CheckCircle2 size={15} />}</button>)}
        <button type="button" disabled={!ready || dirty || profilePending || filesBusy || experimentalRestoring || aiApplying} onClick={onOnboardingTest}><strong>Onboard test</strong></button>
        {experimentalMode && <button className="experimental-exit" type="button" disabled={experimentalRestoring} onClick={onExitExperimentalMode}>{experimentalRestoring ? "Restoring…" : "Exit experimental mode"}</button>}
        <small>Your saved workspace stays untouched.</small>
      </div>, appShellElement)}
      {sidebarOpen && <button className="sidebar-scrim" onClick={onCloseNavigation} aria-label="Close navigation overlay" />}

  </>;
}

export function WorkspaceMobileHeader({ onOpenNavigation, onNotifications }: { onOpenNavigation: () => void; onNotifications: () => void }) {
  return (        <header className="mobile-header">
          <button className="icon-button" onClick={onOpenNavigation} aria-label="Open navigation"><Menu size={22} /></button>
          <span className="mobile-brand"><span className="brand-mark small"><BookOpen size={16} /></span> EduEssentials</span>
          <button className="icon-button" aria-label="Notifications" onClick={onNotifications}><Bell size={20} /></button>
        </header>);
}

export function WorkspaceMobileNavigation({ page }: { page: PageId }) {
  return (      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return <Link key={item.id} href={`/${item.id}`} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined}><Icon size={19} /><span>{item.label}</span></Link>;
        })}
        <Link href="/settings" className={page === "settings" ? "active" : ""} aria-current={page === "settings" ? "page" : undefined}><Settings size={19} /><span>Settings</span></Link>
      </nav>);
}

