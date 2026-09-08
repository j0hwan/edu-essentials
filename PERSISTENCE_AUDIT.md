# Site persistence audit and implementation checkpoints

Inventory date: September 5, 2026. Last checkpoint update: September 8, 2026.

## Status and evidence

**Steps 1–7 complete. Step 8 localhost verification completed; publication is deferred at the user's request.**

Step 8 reviewed the earlier changes and exercised the signed-in localhost site
against the connected Supabase account. Profile/preferences, workspace/widget/notes,
syllabus approval, courses/assignments/events, timers/goals/grades/history, private
uploads/previews, search and ZIP export were checked. Authentication outages now
report temporary unavailability instead of an expired/cancelled Google callback.
Build, types, lint and all 105 tests pass. See
[PERSISTENCE_VERIFICATION.md](PERSISTENCE_VERIFICATION.md) for evidence, cleanup and
the distinction between live browser coverage and automated coverage. No publication
or deployed verification was requested or performed.

Step 2 reviewed the existing changes, implemented conditional account-owned saves,
bounded request validation, and prepared/tested/applied the foundation migration to
the connected Supabase project. All six live SQL ownership/access checks passed.
Build, type checking, lint, account/API tests, PostgreSQL migration tests, and HTTP
route tests passed. Full details and remaining rollout limitations are recorded in
[PERSISTENCE_FOUNDATION.md](PERSISTENCE_FOUNDATION.md). The inventory below is the
original Step 1 baseline; it is retained to track the remaining feature work.

Step 3 reviewed the earlier changes and completed settings persistence/recovery,
accurate save status, hydration retry, draft retention, sign-out/unload protection,
device-theme updates, and account-switch protection for retries. All 18 editable
settings values round-trip in local PostgreSQL tests. Build, types, lint, and all
52 tests pass. See [PERSISTENCE_SETTINGS.md](PERSISTENCE_SETTINGS.md) for current
behavior and verification limits. No additional live migration or publication was
needed for Step 3; authenticated hosted checks remain in Step 8.

Step 4 reviewed those safeguards and completed workspace operations, stable widget
identities, configuration persistence, independent notes, and safe v1 → v2 layout
upgrades. Existing shared notes are preserved, including notes with no remaining
widget. All 18 widget types, copying, ordering, resizing, deletion, recovery, and
account-owned saves are covered by local tests. Build/types/lint and all 65 tests
pass. See [PERSISTENCE_WORKSPACES.md](PERSISTENCE_WORKSPACES.md). No SQL migration,
live user-data modification, or publication was performed in Step 4.

Step 5 completed course/assignment/event editing, recurring class schedules,
actual calendar views and saved filters, and resumable syllabus reviews with
atomic approval. Complete course/document snapshots now use the installed
account-owned save transaction. Earlier settings/workspace safeguards were
reviewed and regression-tested. Build/types/lint and all 80 tests pass, including
PostgreSQL academic readback, rollback, concurrent-read protection and safe class
removal. See [PERSISTENCE_ACADEMICS.md](PERSISTENCE_ACADEMICS.md). No new migration,
live user-content write, or publication was performed; live hosted checks remain
Step 8, and binary syllabus uploads remain Step 7.

Step 6 completed account-saved timers, goals, study history, and grade inputs,
with real study/grade/task statistics across the widgets, sidebar, dashboard, and
class panels. Timer completion is atomic, pause time is excluded, and earlier
clients cannot erase the new data. Build/types/lint and all 95 tests pass. See
[PERSISTENCE_STUDY.md](PERSISTENCE_STUDY.md) for the exact surfaces, calculation
rules, limits, and local verification. No migration, live user-content modification,
or publication was performed. Files/search/export remain Step 7 and hosted checks
remain Step 8.

Step 7 completed private resources, assignment attachments, class images, actual
previews/downloads, persisted file preferences, syllabus original-file associations,
account search and complete ZIP export. The additive file migration is installed
on the connected database; live metadata/access checks passed. Build/types/lint and
103 tests pass, including previous-step regressions. See
[PERSISTENCE_FILES.md](PERSISTENCE_FILES.md) for exact behavior and limits. No live
user-content upload or publication was performed; hosted acceptance remains Step 8.

No application code, database records, migrations, or deployments were changed during the original inventory. The existing account/API suite then passed all 11 tests (`node --test tests/accounts.test.mjs`). The original inventory below describes that baseline, not the completed implementation above.

The findings below describe the original Step 1 source. “Connected” means a save and load path exists in code, not that a live round trip has been verified. Later checkpoint reports above supersede completed items.

## Site map and existing database path

The signed-in application is at `/`, in `app/workspace-client.tsx`. Home, Dashboard, Calendar, Search, Files, and Settings are client-side sections of that route, not separate implemented page routes. Mobile navigation uses the same data and handlers.

Other pages: `/login` (`app/login/page.tsx`), `/onboarding` (`app/onboarding/page.tsx`), and `/overview` (`app/overview/page.tsx`, currently a public placeholder).

The actual persistence provider is Supabase. The empty `db/schema.ts`, `db/index.ts`, and `examples/d1/` are starter/example D1 infrastructure, not the application's current saved-data path.

Ownership path: verified Google identity in Supabase Auth → `app_profiles.auth_user_id` → profile ID → scoped `courses` rows and `dashboard_state` row. Server helpers are `lib/auth.ts` and `lib/supabase-server.ts`; middleware is `middleware.ts`. Both current private APIs independently verify identity. Browser table access is revoked and RLS enabled; the server service role bypasses RLS, so every server query must retain account scoping.

Current schema definitions: `supabase/migrations/20260903000000_workspace_persistence.sql` and `supabase/migrations/20260904000000_google_accounts.sql`. Their installation in the connected project has not been verified in this checkpoint.

## Feature inventory: account and settings

| Feature / exact values | Where users find it | Source / database path | Current status and required work |
|---|---|---|---|
| Google account identity, email, profile image | Login; profile account email; account header | Auth routes, `lib/auth.ts`; Supabase Auth and `app_profiles` | Connected in source; verify real sign-in, returning accounts, profile creation, and identity synchronization. App headers currently use initials rather than the saved Google image. No custom avatar uploader exists. |
| Display name, last name | Onboarding → Your name; Settings → Your profile | `app/profile-editor.tsx`; `PUT /api/profile` → `app_profiles` | Explicit Save changes path exists; verify reload, navigation with unsaved edits, errors, and different accounts. |
| College/university, major, academic year, age | Onboarding → Make it yours; Settings → School & study | Same editor/API/table | Connected in source. All optional. |
| Study goal text, current term, academic structure, GPA system | Same School & study section | Same editor/API/table | Connected in source; text study goal is separate from the fake numeric daily/weekly widget targets. Connect relevant displays to saved academic settings. |
| Week starts on, time zone | Same School & study section | Same editor/API/table | Saved in source, but calendar and many date displays ignore them. |
| Theme: light, dark, device | Settings / onboarding → Preferences | `app_profiles.preferences`; root theme effect in workspace client | Saved in source; device theme is evaluated when effect runs, without subscribing to device theme changes. Verify saved preference application. |
| Reduce motion; high-contrast status labels | Preferences | `app_profiles.preferences`; workspace root attributes / CSS | Connected in source; verify save/reload and application. |
| Deadline reminders; daily study plan; study streak nudges | Preferences | `app_profiles.preferences` | Saved in source. Delivery is explicitly unavailable. Saving toggles must remain distinct from sending notifications. |
| Onboarding completion, optional-details skip, workspace initialization | Onboarding finish / first workspace load | `app_profiles.onboarding_completed_at`, `initialized`; initialization RPC | Connected; initialization is transactional. Verify skip does not erase saved values and subsequent loads do not reinitialize saved data. |
| Export data | Settings → Account & data | Client-generated JSON in `renderSettings` | Exports current in-memory profile/course/dashboard state. Must include all newly persisted entities and distinguish saved data from pending edits; currently no actual file export. |
| Sign out / expired session | Settings; onboarding; auth middleware | `POST /auth/signout`, auth routes | Connected; verify pending edits are protected before sign-out and account switching never reuses another user's data. |

Settings editor: `app/profile-editor.tsx`; schema/validation: `lib/profile.ts`; profile API: `app/api/profile/route.ts`.

## Feature inventory: workspaces and notes

| Feature | Where | Current persistence | Required work |
|---|---|---|---|
| Create, rename, duplicate, delete workspaces | Home → workspace tabs / options | `dashboard_state.payload.w` via `/api/workspace` | Existing autosave; verify each operation and enforce limits before accepting edits. |
| Workspace tab order and selected workspace | Home → Move left / tab selection | Payload `w` order and `a` | Existing autosave; fix shortcuts that assume deleted default workspace IDs still exist. |
| Widget add, duplicate, remove | Home → Add widget / widget options | Widget tuples inside each workspace | Existing autosave; round-trip all 18 types. |
| Widget size, drag order, Move earlier/later | Home → widget options / drag handle | Tuple size and widget array order | Existing autosave. Layout is ordered responsive grid placement, not arbitrary x/y coordinates. Color/style follows widget type; no independent style editor exists. |
| Widget identity and instance-specific settings | Home → repeated widgets across workspaces | Instance IDs regenerated on load; no instance data persisted | Preserve stable identity where needed for independent notes, timers, and goals, with backward-compatible migration. |
| Quick notes text and clear action | Home → Quick notes widget; Search → Notes | One shared payload `n` for every notes widget | Existing autosave, but every notes widget shares one scratchpad. Introduce per-widget notes without losing existing text. Enforce the existing 20,000-character bound in UI. |
| Assignment notes and three checklist items | Dashboard / widgets / Calendar → assignment dialog | Payload `d.assignments[].notes/checklist` | Existing autosave; verify clear, edit, completion, refresh, and failure retry. |
| Save status, retry, unsaved edits | Notes status; global failure banner | Hydration/save effects in workspace client | Failed hydration cannot be retried by the current Retry save button. Edits can occur before hydration and be overwritten. Debounced changes can still show Saved. Differentiate loading/dirty/saving/saved/load-error/save-error and protect edits. |

Save/load codec: `lib/workspace-codec.ts`. API: `app/api/workspace/route.ts`. The current document is v1 and must remain readable after changes. Limits currently include 20 workspaces, 100 widgets per workspace, and 20,000 quick-note characters; UI operations can exceed some limits and make the entire save fail.

## All 18 widgets

All widget types, sizes, placement order, and workspace membership have a database save path. Their content varies:

| Widget | Current content | Intended durable data or derived result |
|---|---|---|
| Daily study goal | Fixed 67%, 2 hours, 3-hour goal; Adjust goal only displays a toast | Saved numeric target and study sessions; calculate today's progress. |
| Weekly study goal | Fixed totals, target, and bars | Saved weekly target and study sessions; calculate the user's week. |
| Upcoming assignments | Account assignment array; not sorted by actual deadline | Saved assignments, sorted and classified by current date. |
| Stoplight assignments | Counts from stored assignment status | Derive urgency from due date and completion so it stays current. |
| Red-light alerts | Account assignments plus fixed “One is already overdue” text | Derive counts and copy from actual assignments. |
| Mini calendar | Fixed August 2026 dates and dots | Current date, saved week-start/time-zone preference, account deadlines/events. |
| Pomodoro timer | One shared in-memory 25-minute timer; resets on refresh | Persist timer settings, running/paused state, timing timestamps, completed study sessions. |
| Focus timer | Fixed 45:00; Begin only displays a toast | Real persisted timer and session history, with reliable resume/completion behavior. |
| Task completion | Fixed 18/24, 75%, weekly trend | Derive from saved assignment completion and completion timestamps. |
| Assignment pie chart | Fixed total, chart, per-course counts | Calculate distribution from account assignments and courses. |
| GPA tracker | Fixed 3.82 and +0.14 | Persist actual grade inputs; calculate using supported saved GPA settings. Display an empty state without inputs. |
| Class quick links | Account courses | Existing account data; verify navigation and removed-class handling. |
| Quick notes | One shared saved note | Independent persistent widget notes with legacy content preserved. |
| Upcoming exams | Two fixed sample exams | Actual saved exam type/date/course; remove sample results. |
| Study streak | Fixed current/longest streak and dots | Derive from saved study sessions in the user's time zone. |
| Today at a glance | Fixed task and agenda; opens `assignments[1]` | Actual current-day account tasks, events, and schedules, with safe empty states. |
| Daily motivation | Fixed read-only quote | No new user record required; widget placement already persists. |
| Empty spacer | Read-only spacer | Only existing saved size and position are required. |

Widget definitions: `widgetTemplates`; rendering: `renderWidget` and `renderWidgetBody` in `app/workspace-client.tsx`.

## Feature inventory: academics, calendar, files, and search

| Feature / values | Where | Current behavior and required work |
|---|---|---|
| Class code, name, credits, instructor, meeting/location text, color, initials | Dashboard → Add class → Manual entry | Saved to scoped `courses` rows. Class edits have no general update flow. Verify create/delete and support correcting durable fields. |
| Optional class image | Add class → Add a class image | File input is ignored. Add private storage plus account/course-owned metadata and display retrieval. |
| Class detail / schedule / instructor office hours | Dashboard → class panel | Saved course details mixed with fixed office hours. Meeting/location is one string, not a recurring schedule. Model actual schedule data needed by calendar; do not present invented office hours. |
| Class grade and study time | Class panel; Dashboard summaries; sidebar | Fixed 84%, 6.5 hours, 18 completed, goal/streak values, sidebar class count. Replace with account data or honest empty states. |
| Instructor Message | Class panel | Toast only; no draft or message exists. Do not claim a draft was saved/opened. Sending messages is outside this persistence pass. |
| Course removal and related records | Class panel → Remove class | Course DELETE and assignment document update happen separately. Manual events are not removed. Make related changes consistent and define attachment/session retention. |
| Syllabus file / pasted text | Add class → Import syllabus | Input is not consumed; extraction is a timeout leading to fixed SOCI 130 data. Store actual source files/text and use real extraction or a truthful manual review workflow. No configured AI extraction service was identified. |
| Reviewed course, item type/title/date, add/remove review rows | Import syllabus → review → Approve | Editable rows feed assignments but type is discarded. Course is fixed; Edit button is inert. Course and assignments save separately. Persist approved input consistently and keep review drafts safe until approval. |
| Assignment title, course, due date, description, weight | Dashboard / imported items → assignment detail | Most fields survive JSON document save, but no normal manual assignment creation/edit/delete flow exists. Complete minimal data-entry paths for existing assignment functionality. |
| Assignment status, progress, notes, checklist | Assignment detail | Saved in document. Completion lacks a timestamp; reopening forces arbitrary progress/status. Keep completion and urgency consistent and support real weekly totals. |
| Assignment brief / download | Assignment detail → attachment card | Fixed filename and size; download has no handler. Connect actual private attachments and account ownership checks. |
| Calendar event title, date, time, type, associated class | Calendar → Add event | Saved in document. Empty class selection falls back to nonexistent `math`; personal events need a valid unassociated state. Add edit/delete paths for corrections. |
| Calendar month/week/day view preference | Calendar toolbar | Preference is saved, but week/day content is fixed sample data. All views must read the same account records. |
| Calendar class filter | Calendar → Filter | In-memory only. Persist as a user preference and handle class deletion. |
| Calendar period and Today behavior | Calendar toolbar; topbar; mini calendar | Anchored to August 12, 2026. Current date and navigation should be computed; transient browsed date need not be a database record. Honor time zone and week start. |
| Home Today task/schedule panel | Home → Today | Uses saved arrays but takes first items without filtering/sorting for today. Derive actual current-day content. |
| Uploads, file name/type/size/date, class association | Files → Upload file / table | Upload only flashes success; list is sample data keyed to default courses. Add actual file storage and database metadata scoped to owner. |
| File preview, download, open full screen | Files / Search → file preview | Generated sample document and toast-only actions. Serve the actual authorized file. |
| Storage usage | Files → storage card | Fixed 2.4 GB/10 GB. Derive real usage and show a quota only if configured/enforced. |
| File search, class filter, view | Files toolbar | Text search filters sample list; class filter and List buttons inert. Search actual metadata and persist meaningful filter/view choices. |
| Global search | Topbar / Search section | Courses, assignments, shared notes use loaded account state. Files are hardcoded; events and assignment notes omitted despite broad search wording. Search only the user's persisted entities and fix default-workspace note links. |
| Notifications / read state | Topbar and mobile bell | Fixed dot; desktop toast and mobile no handler. No notification inbox exists. Use actual actionable account reminders or clearly indicate availability; if an inbox is implemented, persist dismissal/read state. Notification delivery remains separate. |
| Public overview, login copy, icons, static quote, branding | Public pages / shared shell | Read-only site content; no per-user database rows needed. |

## State that should stay transient

Open menus/modals, selected detail panel, sidebar visibility, drag-in-progress, toast messages, loading flags, search queries, widget-picker search, and current calendar browsing position do not themselves require durable database records. Preserve substantive unsaved form/import text until saved or deliberately discarded. Saved view/filter choices, content, preferences, timer sessions, and widget configuration do require account persistence.

Calculated counts, charts, date labels, storage usage, and streaks should derive from authoritative records rather than saving independent copies that can disagree. Files should use private object storage with account-owned metadata in the database, not binary blobs inside the dashboard layout document.

## Cross-cutting gaps and verification requirements

1. Verify connected Supabase schema, RPC installation, account linkage, and private storage configuration without dumping credentials or unrelated user records.
2. Fix hydration retry and prevent edits from being overwritten during initial load or silently left unsavable after loading fails.
3. Preserve edits on save errors, accurately signal pending changes, and handle reload/navigation/sign-out with pending changes.
4. Make class/assignment/event changes consistent; a course request and a document request must not produce orphaned or missing records.
5. Add revision/conflict handling. Current serialized saves protect only one browser tab; separate tabs/devices use last-write-wins for the whole dashboard document.
6. Validate IDs, dates, types, references, request size, and limits; reject invalid data before it compromises saving the rest of the account.
7. Preserve v1 workspaces and existing profile/course data during schema/codec upgrades, including existing shared quick notes.
8. Test reads and writes as two different accounts, including forged owner IDs, another account's course/file IDs, private download paths, and expired sessions.
9. Distinguish a displayed toast, a successful API write, and a verified database readback; declare success only at the appropriate point.
10. Verify saved school and preference values affect the relevant features, especially calendar dates, goal inputs, and GPA display.

## Sequential implementation checkpoints

Each step ends with a completion acknowledgment, evidence/results, and a permission request before the next step. This is the user's requested stopping-point workflow.

| Step | Scope | Completion evidence | Status |
|---|---|---|---|
| 1 | Inventory every site surface, editable value, data source, and placeholder; record gaps and plan | This report; existing 11 account/API tests pass | COMPLETE |
| 2 | Database/account foundation: verify live setup, settle schema/storage changes, ownership validation, safe migrations and conflict strategy | Live migration installed; six live ownership/access checks pass; conditional saves and PostgreSQL rollback/isolation tests pass; see foundation report | COMPLETE |
| 3 | Profile, school/study, preferences, save status/retry and unsaved-edit protection | Every settings field round-trips; preferences apply; drafts survive errors/navigation; build/types/lint and 52 tests passed at this checkpoint; see settings report | COMPLETE |
| 4 | Workspaces, all widget configurations, independent notes, migration of existing layouts | All 18 types; create/rename/duplicate/delete/reorder/resize/reload tests; v1 migration and independent note recovery; build/types/lint and 65 tests passed at that checkpoint | COMPLETE |
| 5 | Courses, assignments, calendar events, real syllabus review data and related-record consistency | Atomic account-owned snapshots; full editing and review approval; recurring/date views; safe removal; build/types/lint and 80 tests passed at that checkpoint; see academics report | COMPLETE |
| 6 | Study targets, both timers, session history, grades, and all derived widget/dashboard/sidebar content | Account-owned timer/goal/history/grade saves, atomic completion, real metrics and date/scale calculations; build/types/lint and 95 tests pass; see study report | COMPLETE |
| 7 | Private files, class images, assignment attachments, real previews/downloads, search and complete export | Connected APIs/UI; migration applied; live metadata/access checks; original ZIP bytes verified independently; build/types/lint and 103 tests pass; see files report | COMPLETE — awaiting permission for Step 8 |
| 8 | Whole-site verification against the connected database, migrations/release readiness, and production verification after permitted publication | Build/type/lint/tests; authenticated save→reload→second-session checks; two-account isolation; report every remaining blocker honestly | Pending |

If live provider access, a real sign-in, or a production publication approval is needed, prepare all independent work first and request only the missing action. Do not report unverified live behavior as completed. Any newly discovered persistence surface is added to this checklist before it is changed.
