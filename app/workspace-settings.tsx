"use client";

import type { MouseEvent, ReactNode } from "react";
import ProfileEditor from "./profile-editor";
import type { Profile } from "../lib/profile";

export type WorkspaceSettingsPageProps = {
  profile: Profile;
  accountId: string;
  header: ReactNode;
  accountActionBlocked: boolean;
  onProfileSaved: (profile: Profile) => void;
  onProfileDraftChange: (draft: Profile, pending: boolean, busy: boolean) => void;
  onDownloadDrafts: () => void;
  onExportClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export default function WorkspaceSettingsPage({ profile, accountId, header, accountActionBlocked, onProfileSaved, onProfileDraftChange, onDownloadDrafts, onExportClick }: WorkspaceSettingsPageProps) {
  return <div className="page settings-page">
    {header}
    <ProfileEditor initialProfile={profile} onSaved={onProfileSaved} onDraftChange={onProfileDraftChange} />
    <section className="settings-card"><h2>Account & data</h2><div className="data-actions">
      <a className="secondary-button" aria-disabled={accountActionBlocked} onClick={onExportClick} href={"/api/export?account=" + encodeURIComponent(accountId)} target="_blank" rel="noopener noreferrer">Export saved account (.zip)</a>
      <button className="secondary-button" onClick={onDownloadDrafts}>Download current drafts (.json)</button>
      <form action="/auth/signout" method="post"><button className="secondary-button" disabled={accountActionBlocked}>Sign out</button></form>
    </div>{accountActionBlocked && <p className="form-hint">Save or discard pending edits before signing out. Download a draft first if you want to keep a copy.</p>}</section>
  </div>;
}
