"use client";

import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Copy,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties, FormEvent, ReactNode, RefObject } from "react";
import type { Course } from "../lib/academics";
import type { SaveStatus } from "../lib/autosave";
import type { TodaySectionId } from "../lib/today-sections";
import type { WidgetResizePriority } from "../lib/widget-layout";
import { resolveWidgetAppearance, widgetAppearanceStyle, type WidgetAppearanceState } from "../lib/widget-appearance";
import type { HomeSkeletonGreeting } from "./home-skeleton";
import { HomeGreeting } from "./home-skeleton";
import { MAX_WORKSPACES, MAX_WIDGETS_PER_WORKSPACE, type SavedAssignment, type SavedEvent, type WidgetInstance, type WidgetType, type Workspace } from "../lib/workspace-codec";
import ReorderableWidgetGrid from "./reorderable-widget-grid";
import WorkspaceSaveStatus from "./workspace-save-status";
import { HomeTodayPresentation, WorkspaceWidget, type WidgetActions, type WidgetBodyData, type WidgetFrameData } from "./workspace-widget";
import type { WidgetTemplate } from "./workspace-widget-catalog";
import { widgetTemplates } from "./workspace-widget-catalog";

type RemoveDragState = { active: boolean; over: boolean; near: boolean };

export type WorkspaceHomeProps = {
  data: {
    greeting: HomeSkeletonGreeting;
    activeWorkspace: Workspace;
    activeWorkspaceId: string;
    workspaces: Workspace[];
    notes: string;
    customizing: boolean;
    widgetEditingEnabled: boolean;
    widgetGridCanCustomize: boolean;
    workspaceMenuOpen: boolean;
    workspaceSaveStatus: SaveStatus;
    workspaceSaveMessage: string;
    workspaceError: boolean;
    workspacePending: boolean;
    saveReady: boolean;
    sidebarCollapsed: boolean;
    experimentalMode: boolean;
    widgetAppearance?: WidgetAppearanceState;
    todayRemoveDragState: RemoveDragState;
    dailyPercent: number;
    localTime: string;
    widgetBody: WidgetBodyData;
    widgetFrame: Pick<WidgetFrameData, "openWidgetMenu" | "closingWidgetMenu">;
  };
  customizeButtonRef: RefObject<HTMLButtonElement | null>;
  workspaceOptionsButtonRef: RefObject<HTMLButtonElement | null>;
  todayOptionsButtonRef: RefObject<HTMLButtonElement | null>;
  todayRemoveTargetRef: RefObject<HTMLDivElement | null>;
  todayRemoveHitRef: RefObject<HTMLDivElement | null>;
  widgetMenuRef: RefObject<HTMLDivElement | null>;
  actions: {
    onActiveWorkspaceChange: (workspaceId: string) => void;
    onNewWorkspace: () => void;
    onAppearanceOpen: () => void;
    onCustomizingToggle: () => void;
    onWidgetPickerOpen: () => void;
    onWorkspaceMenuToggle: () => void;
    onRenameWorkspace: () => void;
    onDuplicateWorkspace: () => void;
    onMoveWorkspace: (direction: -1 | 1) => void;
    onDeleteWorkspace: () => void;
    onRestoreToday: () => void;
    onRecoverNotes: () => void;
    onDownloadRecoveredNotes: () => void;
    onResizeWidget: (widgetId: string, size: WidgetInstance["size"], priority?: WidgetResizePriority) => boolean;
    onRemoveWidget: (widgetId: string) => boolean;
    onRemoveDragStateChange: (active: boolean, over: boolean, near: boolean) => void;
    onReorderStart: () => void;
    onFinishCustomize: () => void;
    onGridCustomize: () => void;
    onReorder: (ids: string[], miniBlockChange?: { widgetId: string; startsNewMiniBlock: boolean }) => boolean;
    onTodayHiddenChange: (hidden: boolean) => boolean;
    onTodaySectionsChange: (sections: TodaySectionId[]) => boolean;
    onTodayOptionsOpen: () => void;
    onSelectClass: (course: Course) => void;
    onSelectAssignment: (assignment: SavedAssignment) => void;
    onEditEvent: (event: SavedEvent) => void;
    onCalendar: () => void;
    onStudyOpen: () => void;
    onNavigateTasks: () => void;
  };
  widgetActions: WidgetActions;
  renderStatusBadge: (status: SavedAssignment["status"], compact?: boolean) => ReactNode;
  renderCourseStamp: (course: Course, small?: boolean) => ReactNode;
  recoveryActions: ReactNode;
};

export function WorkspaceHome({ data, customizeButtonRef, workspaceOptionsButtonRef, todayOptionsButtonRef, todayRemoveTargetRef, todayRemoveHitRef, widgetMenuRef, actions, widgetActions, renderStatusBadge, renderCourseStamp, recoveryActions }: WorkspaceHomeProps) {
  const { greeting, activeWorkspace, activeWorkspaceId, workspaces, notes, customizing, widgetEditingEnabled, widgetGridCanCustomize, workspaceMenuOpen, workspaceSaveStatus, workspaceSaveMessage, workspaceError, workspacePending, saveReady, sidebarCollapsed, experimentalMode, widgetAppearance, todayRemoveDragState, dailyPercent, localTime, widgetBody, widgetFrame } = data;

  return (
    <div className="page home-page">
      <HomeGreeting {...greeting} />
      <HomeTodayPresentation
        data={{ ...widgetBody, localTime, dailyPercent }}
        workspace={activeWorkspace}
        customizing={customizing}
        widgetAppearance={widgetAppearance}
        todayRemoveDragState={todayRemoveDragState}
        todayRemoveTargetRef={todayRemoveTargetRef}
        todayRemoveHitRef={todayRemoveHitRef}
        todayOptionsButtonRef={todayOptionsButtonRef}
        workspaceOptionsButtonRef={workspaceOptionsButtonRef}
        customizeButtonRef={customizeButtonRef}
        actions={{
          onHiddenChange: actions.onTodayHiddenChange,
          onSectionsChange: actions.onTodaySectionsChange,
          onCalendar: actions.onCalendar,
          onOptionsOpen: actions.onTodayOptionsOpen,
          onSelectClass: actions.onSelectClass,
          onSelectAssignment: actions.onSelectAssignment,
          onEditEvent: actions.onEditEvent,
          onStudyOpen: actions.onStudyOpen,
          onNavigateTasks: actions.onNavigateTasks,
        }}
      />

      <section className="workspace-section">
        <div className="workspace-bar">
          <div className="workspace-tabs" role="tablist" aria-label="Home workspaces">
            {workspaces.map((workspace) => <button key={workspace.id} role="tab" aria-selected={activeWorkspaceId === workspace.id} className={activeWorkspaceId === workspace.id ? "active" : ""} onClick={() => actions.onActiveWorkspaceChange(workspace.id)}>{workspace.name}</button>)}
            <button className="add-tab" disabled={workspaces.length >= MAX_WORKSPACES} title={`Up to ${MAX_WORKSPACES} workspaces`} onClick={actions.onNewWorkspace} aria-label="Add workspace">More <ChevronDown size={14} /></button>
          </div>
          <div className="workspace-actions">
            {saveReady && !experimentalMode && <WorkspaceSaveStatus
              status={workspaceSaveStatus}
              message={workspaceSaveMessage}
              popupMessage={workspaceError ? workspaceSaveMessage || "Something went wrong while saving your workspace." : workspacePending ? (workspaceSaveStatus === "saving" ? "Saving workspace…" : "Workspace changes are waiting to save.") : ""}
              actions={recoveryActions}
            />}
            <button className="secondary-button widget-customization-trigger" aria-haspopup="dialog" onClick={actions.onAppearanceOpen}><SlidersHorizontal size={17} /> Widget customization</button>
            <button ref={customizeButtonRef} className="secondary-button" aria-pressed={customizing} onClick={actions.onCustomizingToggle}><LayoutGrid size={17} />{customizing ? "Done customizing" : "Customize"}</button>
            <button className="secondary-button add-widget-control" onClick={actions.onWidgetPickerOpen}><Plus size={16} /> Add widget</button>
            <div className="menu-wrap">
              <button ref={workspaceOptionsButtonRef} className="icon-button" onClick={actions.onWorkspaceMenuToggle} aria-label="Workspace options"><MoreHorizontal size={19} /></button>
              {workspaceMenuOpen && <div className="popover workspace-menu">
                {customizing && activeWorkspace.todayHidden && <button type="button" aria-label="Restore Today section" onClick={actions.onRestoreToday}><Sun size={15} /> Restore Today</button>}
                <button onClick={actions.onRenameWorkspace}><Pencil size={15} /> Rename</button>
                <button disabled={workspaces.length >= MAX_WORKSPACES} onClick={actions.onDuplicateWorkspace}><Copy size={15} /> Duplicate</button>
                <button disabled={workspaces[0].id === activeWorkspaceId} onClick={() => actions.onMoveWorkspace(-1)}><ArrowLeft size={15} /> Move left</button>
                <button disabled={workspaces[workspaces.length - 1].id === activeWorkspaceId} onClick={() => actions.onMoveWorkspace(1)}><ArrowRight size={15} /> Move right</button>
                <button className="danger" disabled={workspaces.length === 1} onClick={actions.onDeleteWorkspace}><Trash2 size={15} /> Delete</button>
              </div>}
            </div>
          </div>
        </div>

        {notes && <div className="workspace-save-bar"><span>Your earlier shared note is saved and available to restore.</span><button disabled={activeWorkspace.widgets.length >= MAX_WIDGETS_PER_WORKSPACE} onClick={actions.onRecoverNotes}>Add saved note here</button><button onClick={actions.onDownloadRecoveredNotes}>Download saved note</button></div>}
        {activeWorkspace.widgets.length === 0 ? (
          <div className="empty-workspace">
            <div className="empty-icon"><LayoutGrid size={26} /></div>
            <h2>Make this space yours</h2>
            <p>Add study tools, deadlines, charts, notes, and timers—then arrange them exactly how you like.</p>
            <button className="primary-button" onClick={actions.onWidgetPickerOpen}><Plus size={17} /> Browse widgets</button>
          </div>
        ) : (
          <ReorderableWidgetGrid
            items={activeWorkspace.widgets}
            workspaceId={activeWorkspace.id}
            label={`${activeWorkspace.name} widgets`}
            style={widgetAppearanceStyle(resolveWidgetAppearance(widgetAppearance)) as CSSProperties}
            layoutKey={`${activeWorkspace.id}:${sidebarCollapsed}:${JSON.stringify(widgetAppearance)}`}
            reflowKey={String(sidebarCollapsed)}
            enabled={widgetEditingEnabled}
            removeTargetRef={activeWorkspace.todayHidden && !customizing ? undefined : todayRemoveTargetRef}
            removeTargetHitRef={activeWorkspace.todayHidden ? todayRemoveHitRef : undefined}
            removeTargetNearEnabled={Boolean(activeWorkspace.todayHidden && customizing)}
            onRemove={actions.onRemoveWidget}
            onRemoveDragStateChange={actions.onRemoveDragStateChange}
            onResize={actions.onResizeWidget}
            resizePriorities={activeWorkspace.resizePriorities}
            onReorderStart={actions.onReorderStart}
            onFinishCustomize={widgetEditingEnabled ? actions.onFinishCustomize : undefined}
            onCustomize={widgetGridCanCustomize ? actions.onGridCustomize : undefined}
            onReorder={actions.onReorder}
            renderWidget={(widget, index, isDragged, isResizing) => <WorkspaceWidget
              key={widget.instanceId}
              widget={widget}
              index={index}
              isDragged={isDragged}
              isResizing={isResizing}
              bodyData={widgetBody}
              frameData={{
                ...widgetFrame,
                activeWorkspace,
                widgetAppearance,
                widgetEditingEnabled,
              }}
              actions={widgetActions}
              widgetMenuRef={widgetMenuRef}
              renderStatusBadge={renderStatusBadge}
              renderCourseStamp={renderCourseStamp}
            />}
            addTile={<button className="add-widget-tile" onClick={actions.onWidgetPickerOpen}><Plus size={22} /><span>Add widget</span></button>}
          />
        )}
      </section>
    </div>
  );
}

export type WidgetPickerProps = {
  activeWorkspace: Workspace;
  search: string;
  onSearchChange: (value: string) => void;
  onAdd: (type: WidgetType) => void;
  onCloseAndResetSearch: () => void;
  onDone: () => void;
  templates?: WidgetTemplate[];
};

export function WidgetPicker({ activeWorkspace, search, onSearchChange, onAdd, onCloseAndResetSearch, onDone, templates = widgetTemplates }: WidgetPickerProps) {
  const filtered = templates.filter((template) => `${template.title} ${template.description}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="modal-backdrop"><div className="widget-picker-modal" role="dialog" aria-modal="true" aria-labelledby="widget-picker-title"><div className="modal-header"><div><p className="eyebrow">Customize {activeWorkspace.name}</p><h2 id="widget-picker-title">Add a widget</h2><p>Choose a study tile, then move and resize it on your grid.</p></div><button className="icon-button" onClick={onCloseAndResetSearch} aria-label="Close widget picker"><X size={20} /></button></div><div className="picker-search"><Search size={17} /><input aria-label="Search widgets" placeholder="Search 18 widgets…" value={search} onChange={(event) => onSearchChange(event.target.value)} /></div><div className="widget-picker-grid">{filtered.map((template) => { const Icon = template.icon; return <button key={template.type} disabled={activeWorkspace.widgets.length >= MAX_WIDGETS_PER_WORKSPACE} onClick={() => onAdd(template.type)}><span className={`picker-icon tone-${template.color}`}><Icon size={20} /></span><span><strong>{template.title}</strong><small>{template.description}</small></span><Plus size={18} /></button>; })}</div><div className="picker-footer"><span>{activeWorkspace.widgets.length} / {MAX_WIDGETS_PER_WORKSPACE} widgets · Drag or use Move earlier/later</span><button className="primary-button" onClick={onDone}>Done</button></div></div></div>;
}

export type WorkspaceDialogProps = {
  mode: "new" | "rename";
  nameDraft: string;
  onNameDraftChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function WorkspaceDialog({ mode, nameDraft, onNameDraftChange, onClose, onSubmit }: WorkspaceDialogProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return <div className="modal-backdrop"><form className="small-modal" onSubmit={handleSubmit}><div className="modal-header"><div><p className="eyebrow">Home workspace</p><h2>{mode === "new" ? "Create a new workspace" : "Rename workspace"}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div><label>Workspace name<input required maxLength={80} value={nameDraft} onChange={(event) => onNameDraftChange(event.target.value)} placeholder="e.g. Finals Prep" /></label><p className="form-hint">New workspaces start empty so you can build them exactly how you want.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{mode === "new" ? "Create workspace" : "Save name"}</button></div></form></div>;
}
