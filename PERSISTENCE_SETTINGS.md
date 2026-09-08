# Step 3: settings persistence and save/retry protection

Completed locally on September 6, 2026. Step 4 requires the user's permission.

## Scope and review of earlier changes

Reviewed the inventory, Step 2 APIs, auth/account resolution, revision checks,
validators, installed migration, client loading/saving, and existing tests. Preserved
the current Supabase project, account ownership model, and v1 dashboard format.
The already-installed foundation migration was neither changed nor reapplied.

The settings API already had a database write path. This checkpoint completes its
field coverage, safe retry behavior, draft retention, and preference application.
The shared workspace save machinery is also covered here because it supplies the
save-status, hydration, retry, and sign-out protection required by later features.

## Settings and exact locations

All editable settings use `PUT /api/profile`, then `GET /api/profile` or workspace
hydration, and the authenticated user's `app_profiles` row.

| Location | Values | Storage |
|---|---|---|
| Settings → Your profile; onboarding → Your name | Display name, last name | `display_name`, `last_name` |
| Settings → School & study; onboarding → Make it yours | College/university, major, academic year, age | `university`, `major`, `academic_year`, `age` |
| Same School & study section | Study goal text, current term, academic structure, GPA system | `study_goal`, `current_term`, `academic_structure`, `gpa_system` |
| Same School & study section | Week starts on, time zone | `week_starts_on`, `timezone` |
| Settings / onboarding → Preferences | Theme, reduce motion, high-contrast status labels | `preferences.theme`, `reducedMotion`, `highContrast` |
| Same Preferences section | Deadline reminders, daily study plan, study streak nudges | `preferences.deadlineReminders`, `dailyStudyPlan`, `streakNudges` |

These are 12 profile/school values and six preferences. Optional text can be cleared,
age can be reset to null, and false toggles stay false. Partial profile API requests
preserve omitted fields. The Google email remains read-only; identity fields are
resolved on the server and cannot be reassigned through a settings payload.

Saved theme/accessibility preferences apply to the workspace and onboarding. Device
theme now subscribes to device changes and updates native controls' color scheme.
Notification choices are stored; the UI continues to state that delivery is pending.
Calendar use of week-start/time-zone belongs to Step 5, and numeric study targets,
GPA calculations, and study history belong to Step 6. Saving those school fields
does not imply these later consumers are finished.

## Completed save and recovery behavior

- Settings remain mounted when switching app sections, so navigating Home → Settings
  does not discard a draft. The global save bar flags pending settings outside Settings.
- A successful server response updates both saved values and the revision. Validation,
  network failure, timeout, expired session, and conflicting edits retain the draft.
  Requests time out after 15 seconds so an unresponsive save can be retried.
- Settings offer retry, draft download, reset, and confirmed reload of saved values.
  Conflicts cannot be overwritten by repeatedly clicking Save. Onboarding skip keeps
  existing optional details, and a failed skip retries the same intended values.
- A lost profile-save response can be acknowledged on retry when the stored editable
  values match exactly and onboarding is already complete. Different content still
  receives a conflict; retries never silently obtain permission to overwrite it.
- Workspace loading has its own retry action and gates editing until saved state is
  hydrated. Initialization uses fixed empty defaults and the existing atomic RPC.
  Initial loading and unchanged hydration do not issue autosaves.
- `lib/autosave.ts` distinguishes loading, saved, dirty, saving, load error, save error,
  conflict, and session error. Edits become dirty before debounce. One write runs at
  a time; subsequent edits are coalesced and use the successful write's revision.
  Even reverting an in-flight edit remains pending until the revert is confirmed.
- Failed saves pause automatic writes and retain current data until explicit retry.
  Ambiguous failures remain pending even when the user reverts to the old baseline.
  A workspace conflict can acknowledge an identical database readback, comparing
  canonical content so PostgreSQL JSONB key order does not cause false conflicts.
- Download unsaved work includes current workspace values and the settings draft,
  including data that failed local validation. Reloading saved work requires an
  explicit discard confirmation and is disabled while a save is active.
- Pending settings, dashboard changes, and current course requests block sign-out
  and register the browser's unload warning. Sign-in recovery opens a separate tab
  so expiry does not automatically navigate away from edits. All client requests
  include an expected profile ID; APIs reject a mismatch before reading/writing.
  This header only restricts a request: authenticated server identity still owns it.

Drafts are held in the open page, with explicit JSON downloads for a durable copy.
They are not automatically saved into shared browser storage. An intentional reload
after accepting the browser's warning can discard unconfirmed edits.

## Validation and practical limits

Passed on the final application source:

- `npm test`: production build and all 52 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.

Coverage includes all settings values saved/read/cleared through the real API handlers
and actual PostgreSQL queries in isolated PGlite, preservation of omitted fields,
lost-response retries, stale-edit rejection, two-account ownership, and account-switch
rejection on profile/workspace reads and writes. Previous migration, RLS, rollback,
legacy layout, auth, CSRF, and anonymous HTTP route tests still pass.

JSDOM tests mount the actual React editor and workspace with simulated API responses.
They exercise all form controls, theme changes, navigation with a draft, sign-out and
unload protection, onboarding skip retry, validation errors, session expiry, conflict
download/reload, failed hydration, and lost-response readback. Separate save-controller
tests exercise coalescing, edits/reverts during writes, retry pauses, and late results.
JSDOM is a development-only dependency; npm and pnpm lockfiles are synchronized.

These are local PostgreSQL, component, and HTTP tests, not a live authenticated browser
round-trip against production. Step 2's live foundation remains installed; this step
changed no live account content and did not publish application code. Real hosted
save/reload and cross-session checks remain in Step 8. The previously recorded Sites
`project_not_found` connection issue remains a publication dependency.

Independent widget notes and stable widget identities remain Step 4. Courses and
dashboard saves still use separate operations until Step 5 connects the installed
transactional save function; this checkpoint does not claim academic/import form
recovery is finished. File storage, complete export, and search remain Step 7.
