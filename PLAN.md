# Files redesign: implementation plan and batch checklist

## Goal and confirmed decisions

Replace the flat Files page with a polished folder browser that matches the existing Home page and borrows familiar organization patterns from Google Drive. Preserve existing files, private ownership, academic associations, uploads, previews, downloads, and account exports.

Confirmed product decisions:

- **Plain-text editor:** autosaving text documents with `.txt` downloads.
- **Files-only archives:** archiving folders does not change schedules, grades, assignments, or course visibility elsewhere.
- **Attach-only syllabus flow:** adding a syllabus to an existing course does not import or modify assignments.
- **Independent organization:** moving a file does not change its course or assignment links.

The implementation extends the existing authenticated file APIs and transactional PostgreSQL persistence. It does not replace the working storage system.

## Execution and completion rules

Implement batches in order. Each batch must leave the application buildable and existing functionality usable.

For every batch:

1. Use `astra-orchestrator` for exploration, bounded implementation, testing, and appropriate independent review.
2. Assign one implementation owner per file or subsystem.
3. Run the batch’s acceptance checks and relevant regression tests.
4. Record changed areas, verification results, unresolved issues, and the next batch in the implementation handoff.
5. Check off the batch only when its acceptance criteria pass. A partially completed batch remains unchecked.

During implementation, save this checklist as the persistent handoff document. Keep the redesigned interface behind a feature flag until final acceptance. Database changes must remain additive; disabling the interface must not discard new data.

---

## Batch checklist

### Batch 1 — Persistent folders, documents, and recoverable state

- [x] **Batch 1 complete**

**Implement**

- [x] Add account-owned folder records with stable IDs, parent IDs, names, revisions, and a distinction between managed course folders and custom folders.
- [x] Add file location independently of existing course and assignment associations.
- [x] Add archive metadata to folders, including a stored semester label and course name/color snapshots.
- [x] Add native text-document storage linked to file metadata. Store content transactionally in PostgreSQL; retain object storage for existing uploads.
- [x] Add separate metadata and content revisions, plus an explicit content backend.
- [x] Add recoverable Trash metadata independently of existing permanent-deletion tombstones.
- [x] Store starred and last-opened information without changing content revisions or modified dates merely because an item was opened.

**Rules**

- [x] Validate ownership for every parent, destination, file, and document reference.
- [x] Prevent cycles, self-parenting, and placement beneath trashed ancestors.
- [x] Serialize hierarchy mutations using the account lock already used by file/workspace transactions.
- [x] Preserve existing upload limits. Native documents have a 1 MiB UTF-8 content limit and count toward the existing file-record limit. Recoverable trashed files still count.
- [x] Allow duplicate display names; IDs determine identity. Never overwrite another item because its name matches.

**Acceptance**

Migration tests preserve existing IDs, bytes, associations, pending uploads, and deletion tombstones. Cross-account references, cycles, and invalid destinations are rejected.

### Batch 2 — APIs, content access, export, and AI compatibility

- [x] **Batch 2 complete**

**Implement**

- [x] Extend existing file responses with location, content backend, revisions, and recoverable state.
- [x] Add authenticated folder, text-document, and batch-action endpoints:
  - `/api/file-folders`
  - `/api/file-documents`
  - `/api/files/actions`
- [x] Continue using `/api/files` for existing upload, metadata, preview, and download consumers.
- [x] Introduce one server-side content reader that handles uploaded bytes and native documents.
- [x] Use that reader for previews, downloads, ZIP exports, and AI ingestion.
- [x] Extend account export with folders, archive labels, document bodies, and recoverable Trash. Snapshot document content together with its revision.
- [x] Update AI indexing for native documents and content changes. Exclude trashed content immediately; reject publication from stale ingestion jobs. Preserve the user’s source-enabled preference across trash/restore.
- [x] Preserve newly added fields when older clients omit them.

**Deletion contract**

For ready files, ordinary deletion—including legacy `/api/files` DELETE calls—must become recoverable Trash. Physical deletion remains available only through explicit permanent-delete operations. Cancelling an unfinished upload retains its existing cleanup workflow.

**Acceptance**

Existing upload/download consumers work. Document exports match their snapshot revisions. Old clients cannot bypass Trash. Edited documents are reindexed, and trashed or outdated content cannot be republished into AI results.

### Batch 3 — Managed course folders and lifecycle reconciliation

- [x] **Batch 3 complete**

**Implement**

- [x] Backfill exactly one managed folder for every existing course.
- [x] Place existing course-associated files in their course folders; keep unassociated files at the Files root.
- [x] Create course folders in the same transaction as course creation, including manual creation and syllabus-based creation.
- [x] Reconcile by course ID, never by course name. Renaming a course updates its folder label; show the course code as secondary information.
- [x] Preserve user-selected locations after initial migration. Subsequent reconciliation must not move files back into course folders.
- [x] Support folder archive/unarchive without altering academic data.
- [x] On academic course deletion, retain its folder and contents as a detached custom folder under `Archives > Deleted courses`.

**Syllabus preservation**

- [x] Before deleting course data, read the previous committed workspace and preserve any pasted syllabus text as a readable document. Keep uploaded source files. Use an idempotent identity so retries do not produce duplicate preserved documents.

- [x] Apply reconciliation to all course-writing paths, including workspace replacement and AI-applied changes.

**Acceptance**

Existing/new courses receive one folder each. Renames preserve identity. Deleting a course preserves its uploaded files and pasted syllabus. Repeated or lost-response saves do not duplicate folders or documents.

### Batch 4 — Home-aligned folder browser

- [x] **Batch 4 complete**

**Implement**

- [x] Extract the Files experience into focused components rather than expanding the workspace component indefinitely.
- [x] Inspect the actual Home rendering in [workspace-client.tsx](/Users/gbc/Code/edu-essentials/app/workspace-client.tsx) and reuse the applied styling from [reference-ui.css](/Users/gbc/Code/edu-essentials/app/reference-ui.css).
- [x] Match Home’s typography, spacing, theme colors, buttons, and course identity colors.
- [x] Build:
  - [x] Files navigation for My files, Recent, Starred, Archives, and Trash.
  - [x] Breadcrumbs.
  - [x] A visible New button.
  - [x] List/grid switching.
  - [x] Item three-dot menus and right-click context menus.
- [x] Show course folders and custom folders together at the root, distinguished by icons and course colors.
- [x] In list view, show name, course association, modified date, and size. Grid view uses the same data and actions.
- [x] Persist view preference and folder navigation; use folder IDs in navigation state so refresh and browser Back/Forward work.
- [x] Add loading, empty, error, and unavailable-folder states.

Use Google Drive’s [organization](https://support.google.com/drive/answer/2375091?hl=en) and [search](https://support.google.com/drive/answer/2375114?hl=en) patterns as interaction references while retaining the app’s visual identity.

**Acceptance**

List/grid show identical contents. Navigation survives refresh. Desktop, tablet, and mobile layouts remain usable. Every context-menu action also has a visible keyboard/touch-accessible route.

### Batch 5 — Syllabus entries and existing-course attachment

- [x] **Batch 5 complete**

**Implement**

Display a pinned syllabus entry in every managed course folder:

| State | Display and action |
|---|---|
| Uploaded source exists | Open the existing preview/download flow. |
| Pasted text only | Open a read-only syllabus document with `.txt` download. |
| Neither exists | Show a muted but readable “Upload syllabus” action. |

- [x] Pass an explicit existing-course ID into the syllabus attachment screen.
- [x] Merge only syllabus fields into that course’s details. Preserve course identity, assignments, meetings, office hours, and other settings.
- [x] Allow upload or pasted text without forcing assignment extraction.
- [x] Keep the existing new-course syllabus workflow separate.
- [x] On replacement, preserve the previous uploaded source as an ordinary file. Preserve replaced pasted text as a document.
- [x] If both source bytes and pasted text exist, make the uploaded file the primary action and provide a separate text view.
- [x] Avoid duplicate rendering when the pinned source already occupies that folder. If moved elsewhere, the pinned entry remains a reference to the same file.

**Protection rule**

Referenced syllabus sources cannot be trashed directly or through a containing folder until explicitly detached or replaced. Apply this to saved courses and syllabus drafts. Virtual placeholders and text views are not ordinary movable files.

**Acceptance**

Test all three states, replacement, failed saves, and refresh. Attaching to an existing course never creates another course or changes assignments.

### Batch 6 — Plain-text creation and autosaving editor

- [x] **Batch 6 complete**

**Implement**

- Add New text file to New, folder menus, and background right-click menus.
- Create a durable empty document in the selected location, then immediately open its editor.
- Default to `Untitled.txt`, incrementing the suggested name when needed.
- Provide naming, plain-text editing, `.txt` download, and visible Saving / Saved / Failed to save states.
- Debounce saves by approximately 750 ms; flush on explicit Save and Ctrl/⌘+S.
- Allow only one content save in flight per document, then save the newest pending draft.
- Use content revisions and idempotent request IDs to handle conflicts and lost responses.
- Preserve the unsaved draft on failure. Offer Retry and Download draft.
- On conflict, offer to save the local draft as a new document or discard it and load the current saved version.
- Prevent silent loss on editor close/navigation; use the existing save-protection pattern.

Uploaded text files retain their current preview behavior. This batch introduces editing for native documents, without silently converting uploads.

**Acceptance**

Test rapid typing, Unicode, empty documents, rename during autosave, failures, retries, reload, multiple tabs, and account changes. Older save responses must never overwrite newer content.

### Batch 7 — Folder creation, nesting, and moving

- [x] **Batch 7 complete**

**Implement**

- [x] Allow custom folders at the Files root and inside custom/course folders.
- [x] Add rename, drag-and-drop moving, and an accessible Move to… dialog.
- [x] Keep course and assignment associations unchanged during moves; show association badges when location differs.
- [x] For newly created/uploaded items inside a course folder, default their association to that course. Custom root folders default to Personal.
- [x] Prevent ordinary renaming, moving, or trashing of managed course roots. Their names follow courses; archiving uses the dedicated action.
- [x] Execute multi-item moves atomically with revision checks.
- [x] Deduplicate selections containing both a folder and its descendants.

**Acceptance**

Test deep navigation, moving between courses and custom folders, duplicate names, invalid destinations, cycles, stale revisions, and simultaneous move/trash operations.

### Batch 8 — Trash, restore, undo, and permanent deletion

- [x] **Batch 8 complete**

**Implement**

- Trash files and custom-folder subtrees without removing their content.
- Record each recursive trash operation so restoring a folder restores only descendants trashed by that operation.
- Preserve children that were already independently trashed.
- Show Trash with original location and deletion time.
- Restore to the original location when available; otherwise use a visible `Restored files` folder at the root.
- Provide an Undo notification after trashing.
- Add explicit permanent-delete and Empty Trash confirmations. No automatic expiration in this release.
- Reuse existing physical-delete retry/tombstone protections for permanent removal.
- Reject an entire recursive operation if it contains a protected syllabus reference; identify the blocking item.
- Hide trashed attachments and class images from active academic surfaces without removing their associations, allowing restoration to recover them.

**Acceptance**

Test nested restoration, missing parents, independently trashed children, protected references, interrupted permanent deletion, and stale requests. Previously permanently deleted files must not become recoverable.

### Batch 9 — Search, sorting, Recent, Starred, and semester archives

- [x] **Batch 9 complete**

**Implement**

- Search names within the current folder or across active files.
- Add course and file-type filters.
- Support name and last-modified sorting, ascending/descending, with folders first.
- Show result locations and provide Open containing folder.
- Persist view, sort, and filter preferences; keep search text temporary.
- Record Recent when a file is successfully opened or edited.
- Support starring files and folders.
- Provide Archive / Unarchive for top-level custom folders and managed course folders.
- Group archived roots under a stored semester label. Default the label from the current account term; otherwise use `Archived`. Let the user edit it before archiving.
- Exclude archives from normal browsing and search unless Include archived is selected. Trash remains a separate view.
- Unarchive roots back to My files.

Archives preserve access to their contents and never alter academic records.

**Acceptance**

Preferences survive refresh. Recent ordering reflects actual opens. Archive labels do not change when the account term changes. Archive/unarchive leaves course schedules, assignments, grades, and links untouched.

### Batch 10 — Upload experience and bulk actions

- [x] **Batch 10 complete**

**Implement**

- Upload through New or drag-and-drop into the current folder.
- Distinguish external file drops from internal move drags.
- Show per-file upload progress, completion, errors, and Retry.
- Retain selected files and stable upload IDs across failed retries.
- Support keyboard/touch multi-selection with a clear selection toolbar.
- Provide bulk move, trash, restore, and download.
- Generate selected-item ZIP downloads server-side with recursive folder contents and safe relative paths.
- Deduplicate overlapping folder/file selections. Disambiguate duplicate ZIP entry names without changing stored names.
- Treat uploads independently so one failure does not discard successful files. Keep database batch moves/trash/restore atomic.
- Exclude virtual syllabus placeholders from bulk file operations.

**Acceptance**

Test mixed successful/failed uploads, lost responses, limits, drop destinations, overlapping selections, ZIP contents, and interrupted downloads. Existing class/assignment upload controls remain functional.

### Batch 11 — Final verification and rollout

- [ ] **Batch 11 complete**

**Automated checks**

- [x] Run focused tests during each batch, extending the existing file, workspace-persistence, UI, and AI suites.
- Run final validation:
  - [x] `npm run lint`
  - [x] `npx tsc --noEmit`
  - [x] `npm test` — production build and 497/497 tests pass on Node 22.22.2.
- [x] Exercise real SQL migrations/functions through the existing PGlite test infrastructure.
- [x] Add integration coverage for ownership, revisions, recursive operations, migration, export snapshots, and AI indexing.

**Required end-to-end scenario**

1. [x] Create a course and open its automatically created folder.
2. [x] Select its missing-syllabus entry and attach a syllabus.
3. [x] Confirm that the course and assignments were not duplicated.
4. [x] Create and edit a text document.
5. [x] Reload and confirm its contents and location.
6. [x] Create a custom folder and move the document into it.
7. [x] Confirm the academic link remains unchanged.
8. [x] Trash and restore the document.
9. [x] Archive and unarchive the course folder.
10. [x] Export the account and verify documents, uploaded bytes, folders, and recoverable Trash.

These scenario checks are verified locally through actual PGlite SQL, compiled
account APIs and React/Chrome fixtures with synthetic auth/storage. Repeating the
complete scenario against the deployed app with real identities/storage remains
part of the unchecked release gate below.

- [x] Also verify keyboard-only use, mobile menus, focus restoration, contrast, screen-reader labels, and save-status announcements locally in Chrome. Actual screen-reader interoperability and hosted browser acceptance remain outstanding.

**Release gate**

- [ ] Test authenticated isolation with two accounts and real private storage in the deployment environment.
- [ ] Apply additive migrations before deploying dependent APIs.
- [ ] Deploy compatible APIs before enabling the new interface.
- [x] Complete an independent review of data preservation, authorization, concurrency, and accessibility. All four material local findings are resolved; hosted contention remains an acceptance gate.
- [x] Update [PERSISTENCE_FILES.md](PERSISTENCE_FILES.md) with the new behavior and recovery procedures, including [the rollout runbook](docs/files-release.md).
- [ ] Enable the interface only after acceptance passes. If hosted checks cannot be performed, record them as outstanding and leave the release gate unchecked.

## Explicit boundaries

This release does not add rich-text editing, collaborative editing, sharing permissions, offline synchronization, OCR, Google Drive integration, or automatic assignment import from an existing course’s syllabus.

Existing account privacy and file validation remain mandatory. No batch may silently delete original files, discard pasted syllabi, change academic links during moves, or replace recoverable Trash with immediate physical deletion.

## Implementation handoff — October 8, 2026

The full source plan was read before starting batch 1. This repository copy is the persistent checklist; the supplied Downloads document remains the reference.

### Batch 1 changed areas

- `supabase/migrations/20261008010000_file_organization.sql`: additive folder records, independent file locations, archive snapshots, native PostgreSQL text bodies, metadata/content revisions, recoverable Trash metadata, and separate activity records. Account-locked, service-only RPCs enforce owned references, active destinations, hierarchy validity, and limits. Existing permanent tombstones remain distinct.
- `lib/file-organization.ts`: internal persistence types and limits for later API/browser work. Existing file responses remain compatible.
- `tests/file-organization.test.mjs`: actual-PGlite migration and storage acceptance coverage.
- `tests/persistence-foundation.test.mjs` and `tests/ai-database.test.mjs`: existing regressions execute against the new migration; upload indexing is preserved and native indexing is deferred until compatible readers exist.
- `PERSISTENCE_FILES.md`: storage, recovery, compatibility, and rollout boundaries.

### Verification

- [x] Batch 1 migration/storage acceptance: 12/12 tests pass.
- [x] Existing file/workspace persistence regression: 31/31 tests pass.
- [x] AI database compatibility: 10/10 tests pass.
- [x] Production build.
- [x] Lint.
- [x] TypeScript (`tsc --noEmit`).
- [x] Independent review; all material findings resolved. Regression coverage includes academic association cleanup on trashed files, restore-before-move for trashed folders, and same-ID native-create retries at capacity.
- [x] Final full-suite run: `npm test` passes 266/266 tests, including the production build. Rendered-page tests reused the existing local server through `TEST_BASE_URL`; the final run used local network access because the sandbox blocked loopback connections.

### Batch 1 scope and remaining work at completion

The existing Files interface remains active; no redesigned interface is enabled. Native-document endpoints, shared content reading, document exports, and document/Trash-aware AI ingestion are batch 2 work. Ordinary `/api/files` deletion still uses the legacy permanent-delete workflow until batch 2 changes that contract. Batch 1 supplies single-file and empty-folder Trash persistence; recursive operations and missing-parent restore UI belong to later batches.

The new migration has not been applied to a hosted database. Authenticated two-account tests against real private storage and multi-session PostgreSQL lock contention remain part of the unchecked release gate. PGlite runs real SQL but uses one connection; lock order is verified by inspecting the functions.

Next: batch 2 — APIs, content access, export, and AI compatibility. Keep new UI disabled until final acceptance and retain new persisted data if that UI is disabled.

### Batch 2 changed areas

- `20261008020000_file_content_api.sql`: compatible file mutations, consistent document reads, atomic batch actions, recoverable legacy deletion, explicit permanent deletion, export snapshots, and transaction-level protection against attaching trashed syllabus sources.
- `/api/file-folders`, `/api/file-documents`, and `/api/files/actions`: authenticated, same-origin endpoints with owned references and revision checks. Existing `/api/files` callers retain uploads, metadata edits, previews, and downloads; ordinary ready-file deletion now moves content to Trash.
- `lib/file-content.ts`: one verified content reader for object bytes and native text, used by file downloads/previews, document reads, account ZIP export, and AI ingestion. Exports include folder archive labels, activity, recoverable Trash, and native content captured with its revision.
- `20261008030000_file_content_ai.sql`, `worker/ai-ingestion.ts`, and AI server/retrieval helpers: native indexing, content-change requeueing, immediate Trash exclusion, stale version/lease publication fences, and independent source-enabled preferences.
- File, content, persistence, ingestion, and AI regression suites cover the new API and database contracts. The existing Files control labels now describe Trash and pending-upload cancellation accurately.

### Batch 2 verification

- [x] Shared content-reader acceptance.
- [x] AI database and ingestion checks, including stale leases and disabled-source restore.
- [x] Final API/SQL regression run: 37/37 focused file/API checks pass, including explicit root restore, file/folder moves, and partial permanent-delete retry.
- [x] Production build, lint, and TypeScript (`tsc --noEmit`).
- [x] AI worker bundle (`npm run ai:worker:check`, dry run).
- [x] Final full suite: `npm test` passes 278/278 tests. Rendered tests reuse the existing local server through `TEST_BASE_URL` with local network access.
- [x] Independent review findings resolved and rechecked; export ownership callbacks, explicit-root restore, and partial permanent-delete retries are covered. An additional folder-move regression exposed a SQL alias ambiguity, now fixed and passing.

The final independent persistence review passes 34/34 tests with no material findings. The testing agent reached its usage limit after adding the final regressions; the root completed focused and full-suite verification.

The new migrations remain unapplied to the hosted database. The redesigned interface remains disabled. Recursive folder Trash, missing-parent recovery UI, selected-item ZIPs, and course lifecycle reconciliation belong to later batches. Hosted two-account/private-storage isolation and multi-session PostgreSQL concurrency remain unchecked release gates.

Next: batch 3 — managed course folders and lifecycle reconciliation.

### Batch 3 handoff

Changed areas:

- `20261008040000_managed_course_folders.sql`: one-time folder/file backfill, course lifecycle triggers, stable syllabus preservation, course-code revisions, source-preference locking, and service-role mutation restrictions.
- `lib/file-organization.ts` and `lib/private-files-server.ts`: public secondary course-code metadata.
- `app/api/workspace/route.ts` and `lib/ai/server.ts`: actionable preservation conflicts; source preferences use the account-locked RPC.
- `tests/course-folder-lifecycle.test.mjs`, persistence/private-file tests, and the AI database suite: actual-SQL lifecycle, export/API metadata, preservation limits, cascades, owned source preferences, and AI receipt retries.
- `PERSISTENCE_FILES.md`: migration order, retention, conflict recovery, and account/source lock behavior.

Reconciliation runs at the course-table transaction boundary, covering initialization, manual creation, syllabus approval, workspace replacement, and AI proposal application. Course IDs determine folder identity. Secondary course-code metadata is exposed by the folder API and retained on detached folders for the later browser.

Initial placement only moves nondeleted, untrashed course-associated files that still have a null location. Existing custom locations, permanent tombstones, and recoverable Trash history are preserved. Subsequent reconciliation never changes file locations.

Deleted managed folders become custom archived roots with the stored group label `Deleted courses`, representing `Archives > Deleted courses`. The previous committed workspace supplies pasted syllabus text before replacement; preservation must succeed transactionally under native-document limits and the shared file cap. Existing source files retain their bytes and locations. Archived folders remain independent of academic data, and old AI source-exclusion preferences carry into preserved text documents.

- [x] Actual-SQL migration and lifecycle acceptance, including retries, rollback, and account cascades with committed syllabus, uploads, and Trash.
- [x] Existing persistence/API and AI regressions: 53/53 focused tests pass. SQL is also verified without the optional AI tables.
- [x] Independent review; the concurrent source-exclusion race is resolved by profile-first preference mutations and a locked transfer. No material findings remain.
- [x] Lint and TypeScript (`tsc --noEmit`).
- [x] Final production build and full suite: `npm test` passes 286/286 tests. Rendered tests reuse the existing local server through `TEST_BASE_URL` with local network access.

No hosted migration or redesigned interface is enabled by this batch. Hosted two-account/private-storage isolation and multi-session PostgreSQL lock contention remain unchecked release gates; PGlite executes the real SQL using one connection.

Next: batch 4 — the Home-aligned folder browser, kept behind a feature flag until final acceptance.

### Batch 4 handoff

- [x] Review Home's actual rendering, applied styles, folder APIs, and later-batch boundaries.
- [x] Add a default-off, server-controlled `FILES_BROWSER_ENABLED` preview flag; retain the existing Files page as the fallback.
- [x] Build focused browser data/navigation and presentation components.
- [x] Verify list/grid parity, stable-ID navigation, recovery states, accessible menus, and responsive layouts.
- [x] Independent review and final build, lint, TypeScript, and regression suite.

The browsing shell uses the persisted folder and activity data from earlier batches. Recent and Starred display existing activity; recording opens and starring controls remain Batch 9 work. Archives retain existing file actions with new uploads disabled. Trash allows folder navigation and metadata details only. New uses the existing single-file upload dialog. Folder creation, text editing, moving, recursive Trash/restore, search/sorting, and bulk upload remain in their planned batches.

Changed areas:

- `lib/files-browser.ts`: one shared item derivation for list/grid, active/archive/Trash hierarchy boundaries, activity views, and missing/cyclic-folder recovery.
- `app/use-files-browser.ts`: five account-scoped metadata reads, request timeouts and generation fences, and URL navigation using stable folder IDs and layout state.
- `app/files-browser.tsx` and its scoped stylesheet: Home-aligned navigation, breadcrumbs, upload entry point, item menus and details, and responsive layouts.
- The workspace layout/client and `.env.example`: a strict default-off server flag with the existing Files page retained as the fallback. Existing academic attachment surfaces and dialogs remain shared.
- Browser model/UI tests, the navigation test shim, and the opt-in Chrome fixture/verifier.

Verification:

- [x] Model and React acceptance: 11/11 focused tests, including account changes, request failures/retry, stable-ID rename navigation, unavailable folders, menu action parity, and default-off/enabled workspace integration.
- [x] Real Chrome with synthetic metadata and production shell/styles at 1440, 1024, 820, and 390 px: list/grid content parity, breadcrumbs, refresh, Back/Forward, menus, dialog bounds, and no page overflow or console errors. Screenshots were inspected in `.vinext/verify-files-browser`.
- [x] Resolve the compact-desktop filename collapse using the workspace container width. Resolve mobile menus closing on a queued auto-scroll; unchanged anchors and internal menu scrolling keep the menu open, while actual anchor movement dismisses it. Regression coverage verifies this behavior.
- [x] Independent review and follow-up: all material findings resolved, including keeping clipped keyboard targets visible within scrollable overlays.
- [x] Final lint, TypeScript (`tsc --noEmit`), and `git diff --check`.
- [x] Final production build and full regression run: `npm test` passes 297/297 tests, reusing the existing local server through `TEST_BASE_URL` with local network access.

The new interface remains disabled by default. No hosted migration or application publication was performed. Browser fixtures use mocked authentication/data and navigation hooks; authenticated navigation through the deployed Vinext runtime, Firefox/Safari, real private storage, and the existing hosted/concurrency gates remain release acceptance work. Keep Batch 11 unchecked until those checks pass.

Next: batch 5 — pinned syllabus entries and attachment to an existing course.

### Batch 5 handoff

- [x] Review existing course saves, syllabus references, file protection, and the later-batch boundaries.
- [x] Add pinned syllabus entries and a separate attachment dialog bound to an explicit existing course ID.
- [x] Merge only syllabus fields and await a durable workspace save; retain failed drafts for retry/download.
- [x] Preserve replaced text transactionally as native files, retain uploaded sources, and return actionable preservation failures.
- [x] Verify SQL/API protection and replacement rollback, UI state/refresh/retry, and desktop/mobile rendering.
- [x] Complete independent review and final build, lint, TypeScript, and regression suite.

Changed areas:

- `app/course-syllabus.tsx` and its scoped styles: the three pinned states, explicit existing-course attachment, retained local drafts, uploaded-source replacement/detachment, read-only Unicode text/download, and keyboard management for the topmost dialog.
- `app/files-browser.tsx` and `app/workspace-client.tsx`: stable source references, duplicate suppression, syllabus-only merging, durable save acknowledgement, and a separate preview path that does not offer new-course extraction.
- `lib/autosave.ts`: await the latest queued snapshot, end on failure, allow explicit retries, and abandon old acknowledgements after reload/unmount. Preservation errors remain retryable instead of being misclassified as concurrent edits.
- `20261008050000_syllabus_replacement.sql`: preserve each replaced committed text as a distinct native document in the managed course folder under the existing workspace transaction, file limits, and revision fence. Uploaded sources retain their bytes, IDs, and locations. Copy optional AI source preferences and restrict dashboard writes to the profile-locking RPCs.
- Workspace/AI error mapping, SQL/API and UI acceptance tests, the full workspace save harness, autosave regressions, and the opt-in Chrome verifier/fixture.

Verification:

- [x] Real SQL/API acceptance: 9/9 tests covering first attachment, repeated text replacements, unchanged-text edits, stale retries, uploaded-source replacement, saved-course/review protection, cross-account/inactive references, capacity rollback including Trash, and operation without optional AI tables.
- [x] Focused UI: 5/5 tests covering retained drafts/source IDs, Unicode `.txt` download, moved/duplicate source rendering, cached Personal source metadata, focus stability, nested keyboard navigation, and dirty-upload close confirmation.
- [x] Workspace academic acceptance group: 9/9 tests, including syllabus-only changes preserving course IDs, assignments, meetings, office hours, events, preferences, and profile through reload, failed-save retry, lost-response readback, and actionable preservation errors.
- [x] Autosave: 15/15 tests, including queued latest writes, explicit retries, generation changes, and stale acknowledgements.
- [x] Chrome at 1440, 1024, 820, and 390 px: all three pins, source/text preview and attachment, opacity/topmost/bounds checks, and settled-animation screenshots in `.vinext/verify-files-browser`. Root inspected desktop/mobile dialogs and representative pins across the four widths.
- [x] Independent review: resolve focus churn, cached source association assumptions, and nested-dialog keyboard escape; no material findings remain.
- [x] Final lint, TypeScript (`tsc --noEmit`), and `git diff --check`.
- [x] Production build and full regression suite: `npm test` passes 318/318 tests using the existing local server through `TEST_BASE_URL`.

The acceptance agent completed its checks before reaching its usage limit; root completed final type checking, screenshot inspection, and the handoff. No hosted migration, live content mutation, or application publication was performed. `FILES_BROWSER_ENABLED` remains disabled by default. Real PostgreSQL multi-session contention, hosted private storage/account isolation, authenticated deployed navigation, and Firefox/Safari remain unchecked release gates for Batch 11.

Next: batch 6 — plain-text creation and the autosaving editor.

### Batch 6 handoff

- [x] Review native create/read/save APIs, independent revisions, lost responses, browser menus, and navigation protection.
- [x] Add compact transactional save receipts and native naming with numeric metadata revisions while retaining legacy content callers.
- [x] Add a native editor with serialized debounced saves, retained retries, conflict recovery, downloads, and save protection.
- [x] Add New text file to New, folder menus, and background/keyboard menus with location-aware naming.
- [x] Verify rapid edits, Unicode/empty documents, rename/save races, failures, retries, account changes, conflict copies, and refresh.
- [x] Complete independent review, Chrome visual checks, production build, lint, TypeScript, and full regressions.

Changed areas:

- `20261008060000_document_save_requests.sql` and `/api/file-documents`: compact account-scoped receipts, exact lost-response retries, current-content replay, and atomic name/content writes with separate numeric revisions. Legacy body-only callers remain compatible.
- `lib/native-documents.ts` and `lib/document-autosave.ts`: captured account/file identity, UTF-8 limits, 750 ms coalescing, one immutable writer with the newest pending draft, retry UUID retention, revision acknowledgement, and late-response fencing.
- `app/native-document-editor.tsx` and its styles: durable empty creation before typing, naming/plain text, explicit and keyboard save, status, saved/draft `.txt` download, conflict copy/discard, retained retry drafts, focus, and close/unload protection.
- `app/files-browser.tsx`: location-aware creation through New, folder actions, background right-click, and an accessible keyboard location action. Native files open as Edit text; uploaded text keeps Preview.
- `app/workspace-client.tsx`: preserve native drafts through SPA navigation and account changes, fence old-account writes, guard reload/assistant/account actions, include native drafts in recovery downloads, and refresh canonical file metadata after acknowledgements.
- Real SQL/API tests, autosave/editor/browser acceptance, full-workspace create/retry/reload/account coverage, and a dedicated Chrome fixture/verifier.

Verification:

- [x] Actual SQL and compiled API: 6/6 tests, including five acceptance groups for empty create/idempotency/capacity, UTF-8 bounds, receipt replay and UUID reuse, stale/atomic revision checks, Trash, cross-account access, cascades, RLS, and service-only execution.
- [x] Autosave and React acceptance: 23/23 tests (5 controller, 9 editor, 9 browser), including local and external renames during a held PUT, latest pending text, intermediate saved downloads, lost copy responses, confirmed discard, close/focus, account changes, and creation menu scope.
- [x] Full workspace acceptance: durable empty creation in the selected course folder, failure/retry with the same request UUID, Unicode/name readback after reload, unchanged academic/workspace data, SPA draft retention, guarded export/sign-out, and retained/downloadable old-account drafts without queued writes.
- [x] Chrome at 1440 and 390 px: all three creation entry points, Unicode rename/save/reopen, uploaded read-only text, focus return/tab cycling, topmost/bounds/overflow checks, and screenshots in `.vinext/verify-native-documents`. Root inspected desktop/mobile editor images.
- [x] Independent review: resolve remote-rename reversal, parent account-change draft loss, and saved downloads lagging intermediate acknowledgements. No material findings remain.
- [x] Production build, TypeScript (`tsc --noEmit`), lint, and `git diff --check`.
- [x] Full regression suite with finalized fixtures: 341/341 tests pass (`node --test tests/*.test.mjs` after the successful production build), using the existing local server through `TEST_BASE_URL`.

All required agents completed and the review fixes were integrated. The first full run exposed a conflict-copy test mock that also rejected writes to the recovered copy; correcting that fixture and adding the separate local-rename regression produced the clean final run. No hosted migration, live content mutation, or application publication was performed. `FILES_BROWSER_ENABLED` remains disabled by default. Real PostgreSQL multi-session contention, hosted private storage/account isolation, authenticated deployed navigation, and Firefox/Safari remain unchecked release gates for Batch 11.

Next: batch 7 — custom folders, nesting, and moving.

### Batch 7 handoff

- [x] Review existing folder and atomic move persistence, hierarchy guards, UI boundaries, and later-batch scope.
- [x] Validate raw move revisions before deduplicating selected folder descendants transactionally; add independent numeric file rename.
- [x] Add custom-folder creation/rename, move selection, drag-and-drop, and an accessible destination dialog.
- [x] Preserve academic associations, show mismatched-location badges, and retain protected managed course roots.
- [x] Verify deep/duplicate-name navigation, mixed moves, cycles, stale revisions, failures, profile changes, and move/Trash ordering.
- [x] Complete independent review, Chrome layout checks, production build, lint, TypeScript, and full regression checks.

Archive/Unarchive controls remain Batch 9 work. Recursive Trash remains Batch 8 work. Batch 7 adds the selection controls needed for atomic moves; other bulk actions and external file drops remain Batch 10 work.

Changed areas:

- `20261008070000_folder_moves.sql`: validate and lock every raw selection before deriving covered descendants from the original hierarchy. Move only the effective roots, preserving their contents. Add a service-only file-name mutation using numeric metadata revisions.
- `/api/files` and `lib/files-browser-operations.ts`: explicit metadata-only rename, captured-profile organization requests, destination/course helpers, and complete move acknowledgements matched against the captured hierarchy.
- `app/files-browser.tsx` and `app/file-organization-dialogs.tsx` with their scoped styles: create/rename, selection and destination browsing, internal drag moves, cycle guidance, protected course roots, location labels and academic association badges.
- `app/workspace-client.tsx`: retain open organization drafts across SPA navigation/account hydration, fence previous-account writes, include drafts in recovery downloads, guard reload/assistant/account actions, and refresh canonical file metadata after saves.
- SQL/API, operation-helper, React and workspace tests; Chrome fixtures/verifiers; persistence documentation and checklist.

Verification:

- [x] Actual SQL and compiled API: 7/7 checks covering deep/duplicate folders and stable create IDs, selection-order-independent ancestor deduplication, raw stale-descendant rollback, invalid/cyclic/foreign/trashed destinations, protected managed roots, numeric rename isolation, service-only grants, and both move/Trash serial orders under the shared profile lock.
- [x] Operations and React: 22/22 checks covering immutable revisions, complete effective-root acknowledgements, an unselected intermediate ancestor, duplicate-name navigation, rename/move/drag parity, retained stale drafts, keyboard focus, account fences, and late acknowledgements.
- [x] Full workspace acceptance: lost create response/retry with the same ID/name/parent, retained downloadable drafts through Settings navigation, hidden-dialog keyboard isolation, guarded export/sign-out, file moves preserving Unicode bodies and academic links through reload, and retained old-account drafts without new writes.
- [x] Chrome at 1440, 1024, 820, and 390 px, plus desktop organization and mobile Move flows: nested folders, duplicate names, rename, mixed moves, association/body preservation, internal drops on folder/root, external-file exclusion, managed-root restrictions, keyboard/topmost/bounds/overflow checks. Both organization and legacy browser verifiers pass. Fourteen organization screenshots are in `.vinext/verify-file-organization`; root inspected representative desktop/mobile roots and dialogs.
- [x] Independent review: resolve incomplete move acknowledgements, full-hierarchy validation, immutable create attempts, hidden-page keyboard handling, aborted-write busy state, and accurate rename conflict recovery. No material findings remain.
- [x] Production build, TypeScript (`tsc --noEmit`), lint, and `git diff --check`.
- [x] Final full regression suite: 362/362 tests pass (`node --test tests/*.test.mjs` after the successful production build), using the existing local server through `TEST_BASE_URL`.

All required agents completed. An operations-agent follow-up could not start because of the agent thread limit; root implemented the acknowledgement fix and the testing agent added its regressions. The initial full run passed 360/362 tests; the two syllabus UI failures came from the missing `MutationObserver` test global. The corrected syllabus tests pass 5/5 and the finalized full suite passes 362/362.

No hosted migration, live content mutation, or application publication was performed. `FILES_BROWSER_ENABLED` remains disabled by default. True PostgreSQL multi-session contention, hosted account/private-storage isolation, authenticated deployed navigation and Firefox/Safari remain unchecked Batch 11 release gates; local SQL tests exercise serialized operation orders in PGlite.

Next: batch 8 — recursive Trash, restore, undo and explicit permanent deletion.

### Batch 8 handoff

- [x] Review recursive hierarchy, original locations, protected references, AI visibility, cleanup retries and browser recovery paths.
- [x] Add atomic recursive Trash and operation-scoped restore with a visible Restored files fallback.
- [x] Add Trash actions, original-location/deletion-time display, Undo and explicit permanent-delete/Empty Trash confirmations.
- [x] Preserve independently trashed descendants, academic associations and permanent tombstones; fence stale/account-changing requests.
- [x] Verify nested restore, missing parents, protected references, interrupted cleanup and stale requests with actual SQL/API and UI acceptance.
- [x] Complete independent review, Chrome checks, build, lint, TypeScript and full regression suite.

Archive/search/activity controls remain Batch 9 work. General bulk trash/restore and selected ZIPs remain Batch 10 work; Empty Trash is the explicit Batch 8 exception. No automatic Trash expiration or hosted rollout is introduced.

Changed areas:

- `20261008080000_recursive_trash.sql`: account-locked subtree preflight, original paths, operation-scoped restore, mapped recovery roots, frozen purge manifests, native-body cleanup and permanent folder tombstones. Legacy file/folder location RPCs use the same tree protections.
- `/api/files/actions`, `/api/file-folders` and shared projections/types: recursive actions and request-scoped permanent deletion/Empty Trash, canonical subtree acknowledgements, recovery-folder responses, excluded finalized folders and captured legacy Trash locations.
- `lib/files-trash-operations.ts` and browser dialogs/styles: strict captured-profile/revision acknowledgements, full confirmation counts, original locations/deletion times, exact UUID retries, retained downloadable requests, refresh-only retry after an acknowledged mutation, and account/keyboard fences.
- Workspace and academic file controls: navigation-persistent Undo, unchanged academic links, cached Trash visibility guards, retained dialog recovery through Settings/account changes, and protected reload/export/sign-out/assistant actions.
- Actual SQL/compiled API, helper/React/workspace regressions, Chrome fixture/verifier and persistence documentation.

Verification:

- [x] Actual SQL and compiled API: 7/7 checks covering Unicode/native/uploaded subtree content, independently trashed descendants, scoped nested restores, stale selections and whole-tree syllabus blockers, deleted-parent/duplicate-name recovery, renamed/moved recovery-root replacement, six-argument move/activity compatibility, partial cleanup, frozen Empty Trash retries, irreversible tombstones, AI availability/lease fences and service-only privileges with/without AI migrations.
- [x] Trash helper/React: 21/21 checks covering complete subtree/root acknowledgements, rejected unrelated rows, academic/content revision preservation, independent selected restore roots, recovery paths, exact purge UUIDs, complete confirmation counts including archived descendants, held/account-changing requests, hidden focus handling, cached academic visibility and refresh-only recovery after a saved mutation.
- [x] Full workspace acceptance: Undo survives Settings navigation, preserves academic links without workspace writes, retries only a failed refresh, rejects late A–B–A acknowledgements, and retains downloadable Trash/purge requests with guarded account actions across SPA/account changes.
- [x] Chrome Trash, organization and legacy browser verifiers at 1440, 1024, 820 and 390 px: confirmation/cancel, recursive Trash/Undo, independent children, fallback restore, physical-cleanup failure/exact retry, all-Trash count, keyboard focus, topmost/bounds/overflow and no automatic deletion. All 14 Trash screenshots are in `.vinext/verify-files-trash`; agent inspected all and root inspected representative desktop/mobile trees and permanent/Empty Trash confirmations.
- [x] Independent review: fix independent restore selection deduplication, permanent confirmation undercounts, permissive restore acknowledgements, swallowed refresh failures, late local acknowledgements, interrupted strict refreshes and focus restoration. No material findings remain.
- [x] Final production build, TypeScript, lint, `git diff --check` and full regression suite: 392/392 tests pass (`node --test tests/*.test.mjs` after the successful production build), using the existing local server through `TEST_BASE_URL`.

All required agents completed and material review findings were integrated. The first full run passed 389/391 tests; the two failures were older assertions expecting a Details-only Trash menu. Updated recovery/cleanup expectations pass. A final archived-descendant confirmation regression passes, and the rebuilt final suite passes 392/392. All three Chrome verifiers pass, including the corrected narrow-screen Empty Trash heading.

No hosted migration, live content mutation or application publication was performed. `FILES_BROWSER_ENABLED` remains disabled by default. True PostgreSQL multi-session contention, hosted account/private-storage isolation, authenticated deployed navigation and Firefox/Safari remain unchecked Batch 11 release gates; SQL tests use PGlite and browser storage/API failures use deterministic fixtures.

Next: batch 9 — search, sorting, Recent, Starred and semester archives.

### Batch 9 handoff

- [x] Review name search, preference persistence, activity acknowledgements and archive lifecycle/snapshots.
- [x] Add folder/all-active name search, course/type filters, folders-first name/modified sorting and containing-folder navigation.
- [x] Persist layout/sort/filter preferences while keeping search text temporary.
- [x] Record successful file opens/edits in Recent and add file/folder star controls without changing modified/content revisions.
- [x] Add top-level Archive/Unarchive, editable stored term labels, archive grouping and explicit Include archived behavior without academic changes.
- [x] Complete SQL/API and UI/workspace acceptance, independent review, Chrome, build, lint, TypeScript and full regressions.

Batch 10 upload progress/external drops, further bulk actions and selected ZIP downloads remain future work. The feature flag stays disabled by default; hosted rollout remains Batch 11.

Changed areas:

- `lib/files-browser.ts`: metadata-only name search, course/format filters, folders-first stable sorting, stored-label archive groups and guarded containing-folder paths. Missing original Trash locations stay recoverable; Recent includes archived opens only when explicitly requested.
- Workspace preferences, `use-file-activity.ts` and preview/editor callbacks: saved layout/filter/sort settings, temporary search, successful read/save/rename activity and canonical refreshes. The serial activity queue preserves actual open order through coalescing and failures, with captured account generations and explicit write/refresh retries.
- Browser toolbar, star actions and archive dialog: root-only Archive/Unarchive, editable captured labels, archive snapshots, read-only descendant navigation, stored group labels and downloadable requests. A saved mutation followed by a read failure retries only reads.
- `20261008090000_archive_integrity.sql` and folder API: account/revision guards, authoritative course snapshots, archived source/destination organization and native-content protections, private legacy RPCs, and retained recursive Trash/restore behavior.
- SQL/API, helper/React/workspace acceptance, Chrome fixture/verifier and persistence documentation. Existing migration harnesses now exercise the complete chain through Batch 9.

Verification:

- [x] Actual SQL/compiled API: 7/7 dedicated archive checks cover service-only privileges, stale activity revisions, root/state eligibility, spoofed snapshots, organization/content guards, immutable term labels, unchanged academic data and archived-descendant Trash/restore. Earlier SQL/API regressions pass against the final migration chain.
- [x] Discovery/activity/browser React: 30/30 checks cover names-only scopes, association-based filters, type/sort behavior, guarded archive/Trash paths, stored groups, strict captured acknowledgements, preview success/failure, background-image exclusion, held account changes, refresh-only retries, and queued/retried open chronology. The final text MIME partition and immutable archive-request construction also pass their focused regressions.
- [x] Real Workspace acceptance: 50/50 tests pass, including preference save/reload with temporary search, successful upload preview/native read/save/rename versus failed attempts, captured archive term changes/retry/unarchive and unchanged academic associations/content revisions. Activity fixtures use verified UUID identities; older course-folder expectations explicitly select All courses.
- [x] Chrome discovery at 1440, 1024, 820 and 390 px: search/filter/sort, locations, stars, actual uploaded/native opens and saves, archive inclusion, stored labels, read-only access, unarchive and exact refresh retries. All 12 screenshots in `.vinext/verify-files-discovery` were inspected; root additionally inspected desktop/mobile roots and the mobile archive dialog. Existing legacy browser, folder organization and recursive Trash Chrome verifiers also pass at all four widths.
- [x] Independent review: fix queued duplicate order, older-event retry chronology, archived descendant creation controls and the rename/activity refresh race. No material findings remain.
- [x] Final production build, full lint, TypeScript, `git diff --check` and full regression suite: 433/433 tests pass. The final MIME-filter and immutable archive-request changes also pass focused regressions and the final rebuild/type/lint checks.

All required agents completed and material review findings were integrated.

No hosted migration, live account/content mutation or publication is performed. `FILES_BROWSER_ENABLED` remains disabled by default. Actual PostgreSQL multi-session contention, hosted private-storage/account isolation, deployed authenticated navigation and Firefox/Safari remain Batch 11 release gates; local SQL uses PGlite and Chrome uses deterministic APIs.

Next: batch 10 — upload experience and bulk actions.

### Batch 10 handoff — October 9, 2026

- [x] Review upload retry/progress, browser selection, atomic actions and verified ZIP content paths.
- [x] Add independent multi-file upload progress and retained stable-ID retries through New and external current-folder drops.
- [x] Add keyboard/touch selection and bulk move, Trash, restore and download without virtual placeholders.
- [x] Add authenticated recursive selected ZIP snapshots, overlap deduplication and safe duplicate paths.
- [x] Verify mixed failures/lost responses, limits, destinations, atomic selections, ZIP bytes and interrupted downloads.
- [x] Complete independent review, Chrome, build, lint, TypeScript and full regressions.

The interface remains disabled by default. Hosted migrations, deployment and release acceptance remain Batch 11 work.

Changed areas:

- Upload transport, private-file store, root queue and upload dialog: independent serial uploads, byte progress, immutable selected files/metadata/IDs, canonical acknowledgements, refresh-only recovery, per-file errors and account-generation fences. Class/assignment upload controls retain their existing single-file API.
- Browser selection and Trash dialog: keyboard/touch checkboxes, action-specific eligibility, managed-root download selection, plural confirmations, overlap-aware counts, external current-folder uploads and distinct internal moves. The root queue and download recovery remain available through page navigation.
- `20261009100000_selected_file_download.sql`, `/api/files/download` and ZIP planning: authenticated account-locked recursive snapshots, all raw revisions checked before ancestor deduplication, native body/revision capture, archive access, safe duplicate paths and empty folders.
- Shared content/ZIP streaming cancellation, completed-download validation, SQL/API and UI/workspace acceptance, Chrome fixtures and persistence documentation. Earlier SQL harnesses include the full migration chain through Batch 10.

Verification:

- [x] Upload queue/transport and store: 8/8 checks covering independent failures, stable-ID retries, refresh-only recovery, progress, limits, legacy fetch and late-account isolation.
- [x] Actual selected ZIP SQL/compiled API: 8/8 checks covering recursive overlapping selections in both orders, snapshots, bytes, collisions, archive/Trash/pending states, ownership, service-only privileges and cancellation. Shared content/persistence regressions pass 37/37.
- [x] Real Workspace: 53/53 checks pass, including mixed upload results, retained queue/navigation/drafts, guarded account actions, legacy class/assignment uploads, Recent after a successful preview and late A–B–A responses.
- [x] Browser bulk action and drop acceptance: 36 browser/organization/Trash UI checks pass, including 10 dedicated bulk checks for selection, destinations, overlap counts, interrupted downloads and recovery through empty/unavailable locations. Node 22 review regressions pass 26/26 across bulk UI, Trash helpers and recursive SQL/API. The final bulk suite passes 11/11 after adding the Chrome-discovered toolbar focus regression.
- [x] Independent review: submit every captured Trash/restore revision before server overlap deduplication, reject conflicting duplicate revisions, and retain ZIP progress/recovery controls through navigation. The helper-to-API-to-SQL regressions verify stale descendant rollback. Restore focus to the current matching toolbar action when a dialog remounts its original trigger; the new Escape regression and follow-up review pass. No material findings remain.
- [x] Chrome at 1440, 1024, 820 and 390 px: keyboard/touch selection, independent upload progress/failure/exact retries, current-folder external drops versus internal moves, bulk move/Trash/restore, virtual syllabus exclusion, managed-course download eligibility, recursive ZIP bytes/duplicates/overlaps and interrupted-download recovery. A–B–A upload/download checks reject stale results; oversized and invalid-name rows make no requests. All 21 screenshots in `.vinext/verify-files-bulk` were inspected, with root additionally inspecting desktop upload recovery and mobile selection/upload/Trash confirmations. The legacy Files, folder organization and recursive Trash Chrome verifiers also pass at all four widths, including focus on the replacement mobile Move trigger.
- [x] Final production build, full lint, TypeScript (`tsc --noEmit`), `git diff --check` and full regression suite: 464/464 tests pass after the focus fix. These checks include the new Chrome fixture/verifier.

The final full regression run passes 464/464 tests under Node 22.22.2
(`node --test --test-concurrency=1 tests/*.test.mjs`), after the successful final
production build, with an isolated local server for route checks. An earlier
unbounded run passed 457/459; its two older wall-clock UI failures passed 2/2 in
isolation and in a 463/463 bounded run. The first post-focus-fix run passed 463/464
while Chrome was running; the older menu-animation test passes in the final
serial run. No unrelated product or test changes were made for these timing failures.

All required agents completed, material findings were integrated and the final
focus fix passed independent review and actual Chrome verification.

No hosted migration, live account/content mutation or publication was performed.
`FILES_BROWSER_ENABLED` remains disabled by default. Hosted PostgreSQL contention,
private-storage/account isolation, authenticated deployed navigation, Firefox/Safari
and large-ZIP memory/load checks remain unchecked Batch 11 release gates.

Next: batch 11 — final verification and rollout.

### Batch 11 handoff — October 9, 2026 (local verification complete; hosted rollout pending)

Changed areas: `20261009110000_file_release_integrity.sql`,
`20261009120000_ai_file_result_fence.sql`, the folder GET API, Files Trash
classification/recovery, native-editor description and status contrast, integrated
release/preflight/AI tests, Chrome verifiers and persistence/rollout documentation.
`npm test` now runs the unchanged cases serially after the production build to
avoid older SQL/DOM timing assertions failing under parallel CPU contention.

- [x] Review the complete release scope and run the integrated ten-step scenario
  with compiled account APIs, real PGlite migrations and synthetic private bytes.
  Focused scenario and syllabus UI checks pass 16/16 on Node 22.
- [x] Fix folder listings beyond PostgREST's default row cap with a profile-locked
  JSON snapshot, including complete activity and archive ancestry.
- [x] Preserve replaced/cleared pasted syllabi inside archived managed folders
  through the revoked internal document path; retain public archive guards,
  source preferences, limits and academic rollback.
- [x] Keep unfinished non-deleted folder purges visible only in Trash as Cleanup
  pending. Retry uses current revisions; true tombstones remain hidden, and
  restore/open remain blocked after purge intent. Actual SQL/API recovery and
  UI/model regressions pass. Independent backend re-review closes all three
  findings; integrity and preflight checks pass locally.
- [x] Verify Chrome keyboard/mobile menus, dialog labels/descriptions, focus
  traps/return and native save live regions at 1440/390 px. Measured text contrast
  passes in normal/high-contrast modes (minimum 7.00:1 desktop, 7.07:1 mobile).
  Add the status high-contrast border/weight cue and linked native-editor help.
  Native browser flow also passes after including the actual Files toolbar CSS.
  Worker inspected all screenshots; root inspected desktop save and mobile purge
  recovery. Firefox/Safari and actual screen-reader interoperability remain
  outstanding.
- [x] Add the read-only Files release preflight, optional AI structural checks
  and explicit deployment/recovery runbook. Preflight regression passes 5/5 and
  always reports `releaseReady: false`. Independent documentation review passes.
- [x] Finish the profile-locked AI result publication fence and its regression,
  including document Trash/content changes and note/syllabus source exclusion.
  Focused AI SQL checks pass 22/22 on Node 22, including rollback, foreign sources,
  optional absent-AI and rejected partial-AI schemas. Earlier full-chain harnesses
  now include both final migrations.
- [x] Complete final independent AI re-review. All four material release findings
  are resolved, including the record-source exclusion interleaving. Profile-first
  locks and service-only grants retain the existing running-message contract.
- [x] Complete the final full build/lint/types/tests. `npm test` passes the
  production build and 497/497 tests on Node 22.22.2 with an isolated local route
  server. Fresh `npm run lint`, `npx tsc --noEmit` and `git diff --check` pass;
  new release scripts/tests/migrations also have no trailing whitespace. The
  integrated scenario and latest SQL harnesses execute all 20 migrations.
- [ ] Apply hosted migrations, deploy compatible APIs, verify real two-account
  private-storage isolation and concurrent PostgreSQL sessions, and complete
  supported-browser/deployed large-ZIP acceptance before production enablement.

Hosted read-only evidence: existing Supabase schema/bucket metadata is reachable,
but redesigned folder/native fields and dependent RPCs are absent. Existing file
anonymous reads return 401, absent redesign tables return 404, anonymous OpenAPI
returns 401, and the private bucket retains its 26,214,400-byte limit. The new
preflight correctly exits 2 (`metadata-blocked`). SQL migration bodies and grants
cannot be established from OpenAPI. No configured database migration access is
available. The saved Sites project returns 404 and this connection lists no
accessible Sites; a deployment/staging origin and two Google test sessions have
not been supplied. No hosted migrations, live content writes, uploads or
publication were performed. `FILES_BROWSER_ENABLED` remains disabled by default.

Batch 11 and the release gate remain unchecked until the outstanding hosted
acceptance passes. Follow [the rollout runbook](docs/files-release.md) from the
existing environment rather than creating a replacement project or discarding
retained persistence to bypass these gates.

All required agents completed, all four material findings were integrated and
independently re-reviewed, and final local verification passed. Remaining work
requires an accessible staging/deployment target, configured database migration
access and two real Google-backed test sessions. Then apply missing migrations,
deploy compatible APIs with production disabled, complete hosted acceptance and
enable the interface only after the recorded gates pass.
