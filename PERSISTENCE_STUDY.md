# Step 6: timers, study goals/history, grades, and calculated statistics

Completed locally on September 7, 2026. Awaiting permission for Step 7.

Reviewed the earlier account-owned snapshot/revision path, settings recovery,
workspace and independent-note persistence, and academic editing. Their regression
tests pass with the new study features. No installed migration was changed or
reapplied, no live user content was edited, and no application publication occurred.

## Completed surfaces

| Where | Persistence or calculation |
|---|---|
| Sidebar → Study & grades; Dashboard → Study goals, history & grades; study widget links | One account-owned panel for timers, settings, recorded sessions, and grade inputs |
| Pomodoro / Focus widgets and study panel | Start, pause, resume, finish early, confirmed reset; configured duration and class; running/paused state survives reload |
| Study panel → Goals and timer settings | Daily and weekly minute targets; per-type duration and class selection; zero target means no target; saved profile study-goal text is displayed |
| Study panel → Study history | Actual study intervals, timer kind, class or Personal, dates, and durations; download, confirmed individual deletion, and confirmed clear history |
| Study panel → Grades | Course, term, scale, numeric grade, and explicit maximum for Custom; create/update/delete and draft download |
| Daily / weekly study-goal widgets | Recorded time, target, percentage, and actual daily bars for the user's saved week start/time zone |
| Study streak widget / sidebar | Current and longest streak from recorded local study dates, current-week indicators, daily target progress and remaining time |
| GPA widget / class panel | Actual matching course grades and credit-weighted current-term average using the saved GPA system |
| Task completion / assignment pie / stoplight / red-light widgets | Actual complete/open totals, course and Personal workload slices, overdue/due-today counts |
| Upcoming exams widget | Actual future Exam assignments and Exam calendar events, sorted by date, with working detail links |
| Today widget | Next open assignment and today's actual deadlines, events, and recurring class meetings |
| Dashboard summary / sidebar class badge / class panel | Completed-this-week count, weekly study progress, course count, course study time and assignment completion |

## Timer behavior

Each timer type is shared by its widget copies. The account has one active timer,
so Pomodoro and Focus cannot independently double-count the same time. Default
durations remain 25 and 45 minutes and can be changed; both are study countdowns,
without an invented automatic break cycle. Configuration changes apply to the next
session, leaving an active session's captured duration/class intact.

The active record contains a stable ID, type, class, planned seconds, completed
study intervals, and a nullable running-start timestamp. The countdown derives
from elapsed time, so paused time, browser throttling, a suspended tab, and a
closed page do not turn into inaccurate tick counts. Running timers continue
while the page is closed, capped at their planned duration.

Automatic completion consumes the active record and appends one history record
with the same ID in a single account snapshot. It runs on ticks, browser focus /
visibility changes, and hydration after returning. This needs no background job:
an expired timer is finalized when the app next runs. Finishing early records only
elapsed work; resetting discards the active work after confirmation. Empty sessions
are not added. Merely updating the countdown display does not write to the database.

The same conditional database transaction prevents two tabs from committing
duplicate completions or overwriting each other's timers. A lost response can be
acknowledged by exact snapshot readback; a genuine conflict retains local edits
and requires the existing recovery flow. There is no claim of realtime push
synchronization between devices; a new load reads the saved timer and conflicts
protect concurrent edits.

## Storage, safeguards, and compatibility

`dashboard_state.payload.d.study` contains `dailyMinutes`, `weeklyMinutes`, `timers`,
`active`, `sessions`, and `grades`. It travels with all existing workspace/academic
records through authenticated `GET/PUT /api/workspace` and the previously installed
`save_account_workspace` transaction. Client-supplied ownership IDs grant no access.
No additional SQL migration is needed.

The codec and API validate study data and every course reference. They reject
invalid timestamps, backwards or overlapping intervals, duplicate IDs, overlapping
sessions, invalid durations/targets, out-of-range grades, mismatched grade scales,
and duplicate course/term/scale grades. Limits are:

- Daily target: 0–1,440 minutes; weekly target: 0–10,080 minutes.
- Timer duration: 1–480 whole minutes; up to 100 intervals per session.
- Up to 1,000 recorded sessions and 1,000 grades, subject to existing overall
  workspace size limits. History can be downloaded before clearing older records.

Older documents without study data receive empty history/grades and unset goals
in memory. Loading alone does not write these defaults. A previously running timer
that has expired is an intentional exception: completion becomes a pending save.
Once study data exists, an older client's PUT that omits it returns 426 instead of
silently erasing it. Existing revision, v1/v2, account-switch, and request-size
protections remain active.

Removing a class also removes its grades and reassigns its recorded sessions,
active timer, and timer configuration to Personal. Recorded intervals are retained.
This joins the existing single-save class/assignment/schedule/event cleanup.

Goal and grade forms retain unapplied drafts after errors, offer draft downloads,
warn before discarding, and block leaving/sign-out with unsaved work. Applied
changes use the existing autosave, accurate save status, offline retry, expired
session recovery, and conflict/download controls. General JSON exports and unsaved
workspace downloads include study data; complete file export remains Step 7.

## Calculation rules

Recorded intervals are split at local midnight using the saved time zone (device
time zone when unset), including daylight-saving transitions. Daily/weekly totals
exclude paused time and unfinished work. Week boundaries follow Settings. Streaks
count consecutive days with recorded work; a streak through yesterday stays
current until today ends. Longest streak and weekly dots use the same dates.

Task totals derive from assignment records. Completed-this-week uses the saved
completion timestamp and local week; old completed assignments without a timestamp
remain complete but are not given invented completion dates. Reopening removes
them from the completed count. Pie slices include all classes with open work plus
Personal; no fixed slice counts remain.

Grade averages filter by the saved current-term string and GPA system, then weight
matching course grades by course credits. An unset term means the explicitly
unlabelled term, not every historical term. Zero earned grades count; ungraded and
zero-credit courses are excluded from the average. A zero-credit course's entered
grade is still shown in its own class panel. Percentage and 4.0 grades retain their
original scales. Custom grades require an explicit maximum and matching maxima
for an aggregate. No letter conversion or historical trend is invented. Changing
Settings changes the displayed selection without rewriting saved grade records.

## Verification

- `npm test`: production Worker build and **all 95 tests passed**.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.

`tests/study.test.mjs` verifies timestamp-based resume/completion, pause exclusion,
early finish/reset, duplicate/overlap rejection, midnight/DST splitting, streaks,
grade weighting/scales/terms, class-removal retention, and weekly completion dates.

The React tests exercise actual controls in JSDOM: offline goal/configuration
retry, dirty form retention, timer pause/resume/reload, no writes from display
ticks, reset confirmation, completion on load with lost-response retry, history
deletion, grade CRUD/scales, and matching populated statistics across widgets,
sidebar, dashboard, and class panel. Previous settings, workspaces, notes,
academics, and save-recovery tests remain passing.

The isolated PostgreSQL tests execute the actual migrations and API transaction:
study settings, an active timer, completion and grades round-trip; concurrent
completion has one successful writer; forged references fail; older clients cannot
erase study data; class removal preserves personal history; another account remains
unchanged. HTTP route tests continue to verify authentication and origin checks.

These are local automated checks, not a live authenticated/cross-device browser
claim. Hosted and visual verification remains Step 8. Existing build deprecation
notices are non-failing. Private files, real attachments/images/search, file-storage
usage, and complete export remain Step 7; their remaining placeholders are outside
this completion claim.
