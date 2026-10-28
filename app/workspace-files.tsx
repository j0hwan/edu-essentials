"use client";

import type { ReactNode } from "react";
import FilesBrowser from "./files-browser";
import { FileList } from "./private-files";
import type { Course, CourseDetails } from "../lib/academics";
import { fileSize, type PrivateFile } from "../lib/files";
import type { FilesBrowserPreferences } from "../lib/files-browser";
import type { TrashUndoReceipt } from "../lib/files-trash-operations";
import type { SavedAssignment } from "../lib/workspace-codec";
import type { OrganizationDialogReport } from "./file-organization-dialogs";
import type { FileStore } from "./use-private-files";

export type WorkspaceFilesPageProps = {
  header: ReactNode;
  filesBrowserEnabled: boolean;
  profileId: string;
  courses: Course[];
  assignments: SavedAssignment[];
  courseDetails: Record<string, CourseDetails>;
  store: FileStore;
  preferences: FilesBrowserPreferences;
  layoutMigrationPending: boolean;
  currentTerm: string;
  dataRevision: number;
  fileQuery: string;
  canWrite: boolean;
  legacyCanWrite: boolean;
  onFileQueryChange: (query: string) => void;
  onPrimaryNavigate: () => void;
  onFileOpened: (file: PrivateFile) => void;
  onPreferencesChange: (preferences: FilesBrowserPreferences) => void;
  onLayoutChange: (layout: "list" | "grid") => void;
  onOrganizationSaved: (signal?: AbortSignal) => Promise<void> | void;
  onOrganizationStateChange: (state: OrganizationDialogReport | null) => void;
  onTrashCompleted: (receipt: TrashUndoReceipt) => void;
  onUpload: (folderId: string | null, courseId: string) => void;
  onUploadFolder: (folderId: string | null, courseId: string) => void;
  onUploadFiles: (files: File[], folderId: string | null, courseId: string) => void;
  onNewTextFile: (folderId: string | null, courseId: string, name: string) => void;
  onOpen: (file: PrivateFile, options?: { readOnly?: boolean }) => void;
  onEdit: (file: PrivateFile) => void;
  onAttachSyllabus: (courseId: string, folderId: string | null) => void;
  onSyllabusText: (courseId: string) => void;
  onOpenSyllabus: (file: PrivateFile) => void;
  onRefreshFiles: () => void;
  onLegacyOpen: (file: PrivateFile) => void;
  onLegacyEdit: (file: PrivateFile) => void;
  onLegacyTrashed: (file: PrivateFile) => void;
};

function courseFor(courses: Course[], id: string) {
  return courses.find((course) => course.id === id) ?? { id, code: "Personal", name: "Personal", credits: 0, instructor: "", room: "", color: "#5b63e8", soft: "#eef0ff", initials: "P" };
}

export default function WorkspaceFilesPage({
  header,
  filesBrowserEnabled,
  profileId,
  courses,
  assignments,
  courseDetails,
  store,
  preferences,
  layoutMigrationPending,
  currentTerm,
  dataRevision,
  fileQuery,
  canWrite,
  legacyCanWrite,
  onFileQueryChange,
  onPrimaryNavigate,
  onFileOpened,
  onPreferencesChange,
  onLayoutChange,
  onOrganizationSaved,
  onOrganizationStateChange,
  onTrashCompleted,
  onUpload,
  onUploadFolder,
  onUploadFiles,
  onNewTextFile,
  onOpen,
  onEdit,
  onAttachSyllabus,
  onSyllabusText,
  onOpenSyllabus,
  onRefreshFiles,
  onLegacyOpen,
  onLegacyEdit,
  onLegacyTrashed,
}: WorkspaceFilesPageProps) {
  if (filesBrowserEnabled) return <FilesBrowser
    onPrimaryNavigate={onPrimaryNavigate}
    profileId={profileId} courses={courses} assignments={assignments} courseDetails={courseDetails}
    store={store} layout={preferences.view}
    preferences={preferences} layoutMigrationPending={layoutMigrationPending} currentTerm={currentTerm} onFileOpened={onFileOpened}
    onPreferencesChange={onPreferencesChange}
    onLayoutChange={onLayoutChange}
    onOrganizationSaved={onOrganizationSaved} onOrganizationStateChange={onOrganizationStateChange}
    dataRevision={dataRevision}
    onTrashCompleted={onTrashCompleted}
    onUpload={onUpload}
    onUploadFolder={onUploadFolder}
    onUploadFiles={onUploadFiles}
    onNewTextFile={onNewTextFile}
    onOpen={onOpen}
    onEdit={onEdit}
    canWrite={canWrite}
    onAttachSyllabus={onAttachSyllabus}
    onSyllabusText={onSyllabusText}
    onOpenSyllabus={onOpenSyllabus}
  />;

  const visible = store.files.filter((file) => (preferences.filter === "all" || (preferences.filter === "personal" ? !file.course_id : file.course_id === preferences.filter)) && (!fileQuery || (file.name + " " + file.kind + " " + courseFor(courses, file.course_id ?? "").code).toLowerCase().includes(fileQuery.toLowerCase())));
  return <div className={"page files-page file-view-" + preferences.view}>{header}
    <div className="files-toolbar"><label>Search files<input aria-label="Search files" value={fileQuery} onChange={(event) => onFileQueryChange(event.target.value)} /></label><label>File class filter<select value={preferences.filter} onChange={(event) => onPreferencesChange({ ...preferences, filter: event.target.value })}><option value="all">All classes and personal</option><option value="personal">Personal</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}</select></label><label>File view<select value={preferences.view} onChange={(event) => onLayoutChange(event.target.value as "list" | "grid")}><option value="list">List</option><option value="grid">Grid</option></select></label><button className="secondary-button" disabled={store.busy} onClick={onRefreshFiles}>Refresh files</button></div>
    <p>{fileSize(store.files.filter((file) => file.state === "ready").reduce((sum, file) => sum + Number(file.size_bytes), 0))} in ready files · {store.files.length} / 1,000 files · 25 MiB maximum per file</p>
    {store.loading && <p>Loading files…</p>}<FileList files={visible} store={store} onOpen={onLegacyOpen} onEdit={onLegacyEdit} onTrashed={onLegacyTrashed} canWrite={legacyCanWrite} />
  </div>;
}
