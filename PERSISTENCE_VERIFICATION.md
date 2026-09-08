# Step 8 — localhost verification

Completed September 8, 2026, for the user-requested local scope. The site runs at
http://127.0.0.1:3000 against the connected Supabase project. No publication,
hosting changes, commits or pushes were performed. Deployed-environment acceptance
is deferred; the user explicitly requested localhost verification only.

## Review and correction

Reviewed the earlier checkpoint reports and working changes, then ran the complete
regression suite covering Steps 1–7. The development server initially could not
reach Supabase from its restricted environment. Once the server had network access,
the user successfully signed in with Google and browser verification continued
using that real account.

The failed OAuth exchange exposed misleading cancellation/expired-link feedback.
`isAuthUnavailable` now distinguishes retryable transport failures and server
outages from invalid sessions. The OAuth callback sends outages to the existing
temporary-unavailability page; middleware and private API authentication return
503 for those outages. Invalid sessions still fail closed with 401. Two regression
tests cover the distinction and ensure an outage does not reach account data.

## Live signed-in browser checks

These checks used the localhost UI, actual authenticated server routes and the
connected database/storage. Each temporary item was identifiable as verification
data. Save completion was checked before reload/readback.

| Surface | Evidence |
|---|---|
| Profile, school/study and preferences | Major, study-goal text, GPA system and theme saved and survived reload. Restored original values and verified another reload. |
| Workspaces, widget configuration and notes | Created a workspace, added a Quick notes widget, changed its size to large and entered independent text. Workspace, configuration and note survived reload. |
| Syllabus review | Uploaded the original text file; saved course fields and a proposed dated assignment; closed, reloaded and resumed the review with source association intact. Approval created the course and assignment and removed the draft. |
| Courses and assignments | Approved course and assignment appeared in account views. Assignment completion survived reopening; class progress reflected 1/1 complete. |
| Calendar | Personal all-day event and description survived reload and appeared in the home schedule. Search opened its editor. |
| Study goals and timers | Daily/weekly targets survived reload. Focus timer remained running after reload; pause/finish recorded one session and updated history/streak. |
| Grades and statistics | Saved course grade survived reload; completion, study and grade views used the saved account inputs. Removal cleared the related statistics. |
| Private files and images | Uploaded a syllabus original, assignment attachment and class image. Metadata and associations persisted; private image rendered successfully and text preview displayed the original content. |
| Search | Saved classes, assignments, file metadata, events, syllabus text, grades, history and independent notes appeared in the relevant groups. A verification query narrowed results and opened real record/file views. |
| Export | Downloaded a saved-account ZIP through Settings. An independent .NET ZipArchive reader verified the account identity, expected records and all three original files; SHA-256 hashes matched their manifest entries. |
| Cleanup | Removed only temporary records through the UI. Reloaded and exported again to independently verify the resulting saved account. |

The cleanup export downloaded at 02:32 local time has zero courses, files, assignments, events, syllabus drafts,
grades and sessions, matching the initial account. Daily/weekly targets are zero,
no timer is active, and timer defaults remain 25/45 minutes. The three original
workspaces and their widget layouts remain, My Day is selected, and the original
note is preserved. Original profile/preferences are restored. No verification
marker remains in the exported account. File deletion tombstones may remain as
designed for safe retry/audit; they are not active files or exported content.

At the later continuation, the previous development process had stopped. Restarted
localhost with Supabase network access and confirmed the existing Google session
loaded successfully. The account then contained newer user-created content and
preferences; those were left intact. The desktop Home view reached Workspace saved
with no browser console errors. The cleanup export is evidence of the earlier
cleanup, not an instruction to erase subsequent user activity.

## Automated verification

- Final read-only live Supabase probe: schema returned 200, all four account
  tables and required RPCs are installed, all four anonymous table reads returned
  401, Google sign-in is enabled, and the storage bucket is private with its
  26,214,400-byte per-file limit.
- `npm test`: production build succeeded; **105 passed, 0 failed, 0 skipped**.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- HTTP tests reused the running localhost server and covered public pages,
  Google-only sign-in initiation, anonymous private-route/API denial and origin checks.
- PostgreSQL/PGlite tests executed the real schema/functions for ownership,
  revision conflicts, transactions, retries, migration preservation and export.
- React/JSDOM and domain tests covered the full settings fields, all 18 widget
  types, workspace operations, academic/calendar editing, timer/statistic rules,
  save/load failure recovery, account-switch protection and file retry behavior.

## Scope and remaining deployment checks

Live browser verification used one Google account and the available in-app browser
viewport. Two-account isolation and adverse save/retry cases are covered by the
automated database/API/component suites; a second real Google-account browser
session was not exercised. No claim is made of every browser/device combination,
live PDF rendering or large-account export load testing. Text and PNG uploads and
a small real ZIP export were exercised end to end.

If publication is requested later, verify the target runtime's environment,
OAuth origins/callback allowlist, private storage and deployed save/reload/export
flows, including a second account and representative large files. There is no
deployed result to verify now. The localhost server remains running for the user.
