# Workspace presentation boundaries

`app/workspace-client.tsx` coordinates the workspace. Feature components receive
typed data and actions; they do not own canonical workspace state or persistence.
Keep changes to lifecycle and cross-page coordination in that file.

## Feature ownership

All paths in this table are relative to `app/`.

| Feature | Components | Feature styles |
| --- | --- | --- |
| Navigation | `workspace-navigation.tsx` | `workspace-shell.css` |
| Search and quick results | `workspace-search.tsx` | `workspace-search.css` |
| Home, workspace controls, picker, naming dialog | `workspace-home.tsx` | `workspace-home.css` |
| Widget frames, bodies, Today presentation | `workspace-widget.tsx` | `workspace-widget.css` |
| Widget templates and initial workspaces | `workspace-widget-catalog.ts` | — |
| Dashboard | `workspace-dashboard.tsx` | `workspace-dashboard.css` |
| Expanded course | `course-detail.tsx` | `course-detail.css` |
| Shared course artwork | `course-visual.tsx` | `course-visual.css` |
| Assignment rows and status badges | `assignment-table.tsx` | `assignment-table.css` |
| Assignment details | `assignment-detail-dialog.tsx` | Existing shared modal styles |
| Files, including the legacy list | `workspace-files.tsx` | `workspace-files.css` |
| Profile and account settings | `workspace-settings.tsx` | `workspace-settings.css` |
| Academic dialog composition | `workspace-academic-dialogs.tsx` | Existing dialog styles |
| File dialog composition | `workspace-file-dialogs.tsx` | Existing dialog styles |

Existing specialized components remain authoritative for their own rendering,
interaction, and styles. In particular, keep using `StudyWidget`, `TodaySection`,
`ReorderableWidgetGrid`, `FilesBrowser`, and the existing academic/file dialogs.
Tasks, the calendar adapter, the page-heading helper, and `AcademicAssistant` do
not need additional wrapper modules.

## Coordinator invariants

- Navigation callbacks preserve modified clicks and same-dashboard course
  closing. Mobile bottom links remain ordinary links. Native-document drafts
  can block programmatic navigation.
- Files remains mounted inside its hidden wrapper while organization work is
  open, even after navigation. Settings retains its hidden, reload-keyed wrapper.
- Cross-page dialog selections, drafts, account/session guards, and action
  callbacks stay in the coordinator. Dialog groups receive keyed prop entries;
  academic presence keys and exit flags are supplied by the coordinator.
- Course expansion remains suspended while nested tools or dialogs are open.
  Preserve its close-control ref, context provider, and per-account/course key.
- Autosave hydration, serialization, conflict/retry handling, account reset,
  upload queues, pending confirmation preferences, Undo, and assistant
  application remain coordinated centrally. Do not move these into page views.
- The study clock runs across pages. Ordinary ticks update the clock and settle
  completed timers, but do not independently enqueue saves.
- Home loading, measurement refs, geometry caching, and persisted preferences
  remain coordinator-owned. Keep the picker and naming dialog at their existing
  root positions rather than making them depend on Home being mounted.

## Stylesheet loading

Styles remain globally scoped, not CSS Modules. `globals.css` has an explicit
feature import list and retains shared foundations, legacy calendar selectors,
modal frames/scroll locks, and global reduced-motion rules. The coordinator
explicitly imports existing component styles in their original dependency order
before importing the extracted components. Preserve that list: moving component
imports must not reorder existing overrides, particularly `reference-ui.css`,
`dashboard.css`, and widget appearance/layout/reorder styles.

Feature styles include their responsive and feature-specific motion rules.
Shared selector groups remain shared rather than being duplicated. Removing
legacy rules or redesigning the cascade is separate work.
The widget-menu minimum width stays after the shared popover rule, and the
side-panel backdrop stays after the shared modal backdrop, so their fallback
declarations retain the original cascade even outside current consumers.

## Verification

Use `tests/helpers/workspace-presentation.mjs` when a test needs an owning
feature's source or an assembled stylesheet. It follows local stylesheet imports
and runtime component imports instead of assuming all presentation lives inline
in the coordinator or `globals.css`.

Run `npx tsc --noEmit`, `npm run lint`, and `npm test`. For browser verification,
run `npm run verify:navigation`, `node scripts/verify-home-skeleton.mjs`, and
`node scripts/verify-class-modal-exit.mjs`. Browser scripts accept
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` for installations outside this repo.
Compare desktop/narrow layouts, both themes, reduced motion, loading boundaries,
widget customization, and overlays when changing shared styles or DOM structure.
