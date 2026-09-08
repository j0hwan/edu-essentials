# Step 5: courses, assignments, calendar, and syllabus review

Completed locally on September 7, 2026. Awaiting permission for Step 6.

Reviewed the earlier account/revision safeguards, settings recovery, workspace
codec upgrades, independent notes, and autosave protections. The current API now
uses the account-owned transaction installed in Step 2. No migration was changed
or reapplied, no live user content was modified, and the application was not
published during Step 5.

## Completed surfaces

| Where | Saved values and behavior |
|---|---|
| Dashboard → Add class → Manual entry; class panel → Edit class | Code, name, credits, instructor, location/meeting notes, color, and derived initials; create, edit, and confirmed removal |
| Class editor → Office hours / Class schedule | Office-hours text and recurring meetings: stable ID, weekdays, start/end times, first/last dates, location |
| Dashboard / class panel → Add assignment; assignment → Edit | Title, class or Personal, date, optional time, Assignment/Exam/Project type, description, weight, notes, three checklist values, and progress |
| Assignment → Mark complete / incomplete | Completion timestamp, 100% completed progress, and previous progress restored on reopening; urgency derives from the actual due date |
| Assignment editor / detail → Delete | Confirmed deletion, including notes/checklist; attached file metadata is detached by the database transaction |
| Calendar → Add event; event → editor | Title, class or Personal, date, optional time (blank means all day), type, description; create, edit, and confirmed deletion |
| Calendar → Month / Week / Day / Class filter | Saved view and class/personal filter; each view displays the same assignments, events, and recurring meetings |
| Calendar → Today / previous / next / Go to date | Actual dates and month/year navigation; browsing position remains transient; saved week start and time zone apply |
| Home → Today; mini calendar; topbar date | Current dates and actual due/overdue tasks and today's schedule; mini calendar shows the current week |
| Dashboard → Import syllabus / Resume; Add class → Import syllabus | Account-saved review draft, complete pasted/read source text, source filename, editable course fields and review rows |
| Syllabus review → Suggest dated items / Add / Remove | Suggestions from explicit YYYY-MM-DD dates in the actual source; editable title, date, type, description, and weight; incomplete review rows may be saved for later |
| Syllabus review → Approve class and items | Validated course, typed assignments, and retained source text commit together; the review draft is consumed in that same save |
| Save bar / Settings → Export data | Academic changes share save/retry/conflict protection; unsaved-work downloads and current JSON exports include schedules and review drafts |

## Storage and ownership

`GET/PUT /api/workspace` resolves the signed-in Google user's profile independently
of client-supplied ownership fields. Course columns live in `courses`; academic
records and preferences live in `dashboard_state.payload.d`:

- `assignments` includes type, optional due time, completion timestamp, previous
  progress, notes, and checklist alongside the existing fields.
- `manualEvents` includes description and supports an empty `courseId` for Personal.
- `courseDetails` maps owned course IDs to office hours, schedules, and approved
  syllabus source text/name.
- `syllabusDrafts` retains source text/name, editable course fields, and review rows.
- `calendarFilter`, `calendarView`, and `dashboardView` retain chosen views/filters.

Every save submits the complete course list plus dashboard document and the loaded
revision to `save_account_workspace`. The existing function checks both identity
IDs, locks the account/document, rejects stale revisions, and commits courses,
related record changes, and the new document revision in one transaction. GET
checks the document revision around its course query and retries if a concurrent
commit would otherwise produce a mixed read.

Class removal deletes that class's assignments and recurring schedule, resets a
matching calendar filter, and retains its manual events as Personal. Database
file metadata survives with class/assignment links cleared. Removing or moving an
assignment detaches file links that no longer match the assignment's class.

The old standalone course POST/DELETE paths and dashboard-only PUT requests return
426 with instructions to preserve drafts and reload. This prevents older clients
from overwriting a newer complete academic snapshot. Missing revisions still return
428; stale revisions return 409. Matching complete readback acknowledges a lost
response, including syllabus approval, without inserting duplicates.

## Validation and recovery

The shared validators enforce course ownership references, unique IDs, real dates,
24-hour times, supported item types, meeting date/time ranges, completion/progress
consistency, and size/count limits. Limits include 100 courses, 2,000 assignments,
2,000 events, 30 meeting schedules per class, 10 reviews, 200 rows per review, and
60,000 characters per syllabus source. Existing workspace/note limits still apply.

Academic forms retain unapplied drafts after validation errors and protect leaving
or signing out. Close asks before discarding edited form fields; drafts can be
downloaded. Accepted edits remain marked pending until the account save succeeds;
offline errors, expired sessions, conflicts, and lost responses retain edits and
use the existing explicit retry/recovery controls.

Older references to deleted/nonexistent courses load as Personal. The old calendar
default `12:00 PM` is converted to `12:00` without changing its meaning. Loading
alone does not rewrite saved records. Older assignments with missing/invalid dates
remain visible and can be repaired individually; autosave remains blocked until
all records are valid. No replacement due dates are invented and no content is
silently discarded.

## Verification

Final checks passed:

- `npm test`: production Worker build and **all 80 tests**, including account/API,
  HTTP route, autosave, codec, PostgreSQL, and actual React editor tests in JSDOM.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.

The PostgreSQL tests run the actual migrations and save RPC in isolated PGlite.
They cover complete academic draft/approval readback, other-account preservation,
invalid saves, stale revisions, transactional rollback, concurrent-read retry,
legacy-write rejection, and file metadata retention through the new API.

React interaction tests cover course/schedule create-edit-reload and offline retry;
assignment fields, checklist, completion/reopening/deletion; event CRUD, filters,
all calendar views and recurring dates; syllabus source/review resume and approval
after a lost response; class removal; and legacy-date repairs. Earlier settings,
widget, independent-note, account-switch, and recovery tests also pass.

These are local automated checks, not a claimed live authenticated browser round
trip. The required RPC was installed and verified in Step 2. Hosted sign-in,
cross-device persistence, visual/browser checks, and deployed verification remain
Step 8. Existing Vinext/Node deprecation notices did not fail the build.

## Remaining checkpoints

- Step 6: timers, targets, study history, grades, and calculated statistics/widget
  content. Remaining sample metrics are not part of this completion claim.
- Step 7: private binary syllabus/files, class images, assignment attachments,
  actual downloads/previews, full search and export. The review currently accepts
  pasted text or `.txt` files; it does not claim PDF/image extraction or AI parsing.
- Step 8: whole-site live verification and permitted publication. Preserve the
  existing Sites project identifier and resolve its recorded hosting access issue
  before deployment.
