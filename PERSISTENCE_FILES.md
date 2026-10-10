# Step 7 — private files, attachments, images, search and export

Completed September 7, 2026. Steps 1–6 were reviewed and regression-tested.
Publication and authenticated hosted acceptance checks remain Step 8.

The batch sections below describe their implementation-time behavior. The
October 10 hosted schema repair applied all missing redesign migrations; earlier
local-only validation notes do not require historical migration replay. The new
Files browser is now enabled by default during local development, with an explicit
`FILES_BROWSER_ENABLED=false` override available. Production defaults to disabled
until hosted acceptance passes.

## Files redesign — batch 1 foundation

The additive migration `20261008010000_file_organization.sql` introduces owned
`file_folders`, PostgreSQL `native_file_documents`, and independent file/folder
activity records. Existing uploads retain their IDs, object paths, hashes,
academic associations, pending/deleting states, and permanent `deleted_at`
tombstones. This migration was applied to the connected hosted prototype on
October 10, 2026; see the batch 11 application record below.

Folder location is independent of course/assignment associations. Folder
archives store their semester label and course name/color snapshots without
changing academic data. Metadata and content have separate numeric revisions;
opening or starring an item only updates its activity record. Native bodies
are limited to 1 MiB of UTF-8 content, and share the existing 1,000-file cap
with uploaded, pending, and recoverably trashed files.

The service-only `mutate_account_folder`, `mutate_account_document`, and
`mutate_account_file_location` functions take the same profile lock as file and
workspace writes. Owned references, hierarchy cycles, and trashed destinations
are validated. Native bodies, sizes, digests, and content revisions commit
together. Direct service-role writes to file and organization tables are
revoked; service-role reads and the existing mutation RPCs remain available.

Recoverable `trashed_at`, operation IDs, and original-location fields are
separate from permanent tombstones. This batch provides single-file and
empty-folder persistence operations; recursive Trash, missing-parent recovery,
and permanent-removal user flows remain later batches. Existing `/api/files`
deletion behavior remains unchanged until batch 2 implements its recoverable
deletion contract.

No redesigned interface or native-document endpoint is enabled. Native rows
are excluded from the current object-storage AI ingestion trigger. Before
exposing documents, batch 2 must add the shared content reader, compatible
downloads/export snapshots, and document/Trash-aware AI ingestion. Do not
remove these tables or clear their fields when disabling the future interface.
Hosted isolation, concurrent-transaction, and real-storage acceptance remain
part of the unchecked release gate in `PLAN.md`.

## Files redesign — batch 2 APIs and compatibility

The additive `20261008020000_file_content_api.sql` and
`20261008030000_file_content_ai.sql` migrations extend the batch 1 foundation.
Apply all three migrations in order before deploying the dependent APIs. These
migrations were applied to the connected hosted prototype on October 10, 2026.

Authenticated `/api/file-folders`, `/api/file-documents`, and
`/api/files/actions` expose owned folder/document mutations and atomic batch
actions with numeric revisions. Existing `/api/files` upload, edit, preview,
and download consumers remain supported. Omitted organization fields in older
metadata requests preserve the saved location, backend, and content revision.
Native text bodies are transactional and download as `.txt` files.

Ordinary deletion of a ready file now moves it to recoverable Trash and keeps
its bytes or document body. Active listings and academic attachments hide it
without removing its associations. Restore preserves those links. Cancelling
pending uploads and retrying older physical-deletion intents retains the
existing cleanup/tombstone workflow. Explicit `permanent-delete` actions must
start from Trash, record intent, remove object bytes, and finalize the tombstone;
native bodies are purged on finalization. Failed removal remains retryable.
An identical permanent-delete batch may be retried after partial completion;
finalized tombstones are no-ops and unfinished intents continue cleanup. Restore
without `destinationId` uses the original location; explicit `destinationId: null`
selects the Files root for both files and folders.
Referenced syllabus files must be detached or replaced first; workspace writes
also reject references that became trashed before that transaction committed.

One server-side reader validates backend, account, state, revision, size, and
digest for downloads, previews, ZIP exports, and AI ingestion. Account ZIPs now
include folders and stored archive labels, activity records, recoverable Trash,
and native text content. Native bodies and their revisions are captured in the
same database snapshot, so an edit after the snapshot cannot change the exported
document. Pending uploads/deletion intents still block a complete export.

AI indexes both uploads and native text. Content changes invalidate old chunks
and requeue ingestion. Trash immediately removes content from retrieval and
invalidates outstanding jobs; restore requeues available content while retaining
the user's enabled/disabled preference. Publication and worker failure updates
are fenced by source version and claim lease.

The existing interface remains active. Course-folder reconciliation, the new
folder browser/editor, recursive Trash, and user-facing recovery controls remain
later batches. Hosted two-account/private-storage checks and concurrent database
sessions remain outstanding release gates in `PLAN.md`.

Local batch 2 verification passes the production build, lint, TypeScript, worker
dry-run bundle, and all 278 tests. Tests execute the actual SQL through PGlite
and simulate private storage/auth transport. Independent review findings are
resolved, including export projection, explicit-root restore, folder moves,
and permanent-delete retries after partial completion.

## Files redesign — batch 3 course lifecycle

The additive `20261008040000_managed_course_folders.sql` migration backfills
one managed folder per course and keeps its name and secondary `course_code`
in sync by course ID. Existing associated files at the root enter their course
folder once. Custom locations, tombstones, and recoverable Trash history stay
intact; later academic saves never move files back. Course-folder archive and
unarchive remain independent of academic records.

Course-table triggers cover initialization, manual and syllabus-based creation,
workspace replacement, and AI proposal application in the same transaction.
Direct service-role course writes are revoked; server writes use the existing
profile-locking RPCs. This retains the common account lock order.

Before deleting a course, the trigger reads its previous committed syllabus
text and saves a native `.txt` document in the retained folder. It then detaches
the folder as a custom archived root in the stored `Deleted courses` group,
keeping the course name/color snapshots and code. Existing source files and
their locations remain intact; deleted academic links become Personal as before.
Preservation uses the folder lifecycle for its stable file ID, so retries cannot
duplicate the document and a later recreation of the same course ID receives
a separate folder and preservation identity. The old AI source's enabled or
disabled preference carries into the preserved document source.

AI source include/exclude/retry actions use `mutate_account_ai_source`, which
locks the verified account before the owned source. Deletion locks the original
syllabus source before transferring its preference. A successful exclusion
cannot be lost during course deletion; requests for an already removed source
return unavailable so the client can refresh its source list.

The shared 1,000-file cap and 1 MiB native-content limit still apply. If the
syllabus cannot be preserved, the entire academic transaction rolls back;
workspace saves and AI application return a specific conflict response. Free
file capacity through explicit permanent removal before retrying. Account
deletion cascades remove account data without creating preserved documents.

Apply this migration after the batch 1/2 migrations and before deploying APIs
that select `course_code`. Hosted validation and the redesigned interface remain
part of the later release gate.

Local batch 3 verification passes all 53 focused lifecycle/persistence/AI tests,
lint, TypeScript, the production build, and the full 286-test suite. Independent
review found and resolved the concurrent source-exclusion race. Actual SQL was
also checked with the optional AI tables absent. Multi-session lock contention
and real hosted storage still require deployment-environment acceptance.

## Files redesign — batch 4 browser preview

`FILES_BROWSER_ENABLED` is a server-only flag, disabled by default. Set it to
`true` in the local server environment and restart the dev server to review the
folder browser after applying the batch 1–3 migrations. Cloudflare bindings take
precedence over the process environment. Leaving the flag unset or setting it to
`false` retains the existing Files page and all persisted organization data.

The focused browser joins account-scoped file, folder, and activity metadata.
My files shows active roots and direct folder contents; Archives and Trash have
separate views. Recent records successful opens/edits; Starred uses persisted file
and folder activity. Creating
activity, archive controls, and Trash recovery controls remain in later batches.
The browser reuses the existing upload, preview, download, and metadata dialogs.
It does not modify academic associations during navigation.

The `/files` URL stores the selected view, folder ID, and list/grid layout.
Breadcrumb labels come from current folder metadata, so renaming does not break
saved folder links. The URL supports refresh and browser Back/Forward; selecting
a layout also saves the existing account workspace preference. Missing or
unavailable folders provide a route back to the selected view's root. Failed
reads offer Retry, and older requests cannot replace newer account data.

The default-off flag remains in place until Batch 11 release acceptance. No
hosted migration, application publication, or live private-file mutation is
performed by this preview work.

Local batch 4 verification passes 11 focused model/React checks, lint,
TypeScript, the production build, and all 297 regression tests. Real Chrome
checks use synthetic metadata and the actual workspace shell/styles at 1440,
1024, 820, and 390 px, covering layout parity, stable-ID navigation, refresh,
Back/Forward, menu access, and viewport-sized dialogs. Compact-desktop filenames
remain readable through container-aware navigation, and queued auto-scrolls no
longer close newly opened mobile menus. Independent review findings are resolved.
Authenticated deployed navigation, Firefox/Safari, and the existing hosted
private-storage/concurrency checks remain part of release acceptance.

## Files redesign — batch 5 course syllabi

The default-off browser displays one pinned syllabus entry in each managed course
folder. Uploaded sources use the existing preview/download, pasted text opens a
read-only view with a UTF-8 `.txt` download, and missing sources offer attachment.
When both exist, the upload is primary and text has a separate action. A source
in the same folder appears once; a moved source remains referenced by file ID.
These virtual entries do not participate in ordinary file operations.

Attachment carries an explicit existing-course ID and merges only syllabus text,
name, and source-file ID. Course identity, assignments, meetings, office hours,
and other settings survive. The dialog awaits the workspace save acknowledgement;
failed saves retain the draft and source ID for retry or download. The existing
new-course review and assignment extraction workflow remains separate.

Apply `20261008050000_syllabus_replacement.sql` after the earlier migrations.
Its dashboard trigger retains every changed, nonempty committed syllabus text as
a native document in the managed course folder. Retention and replacement commit
together under the profile lock, revision fence, 1 MiB document limit, and shared
1,000-file cap. Stale retries and name-only edits do not add history. Existing
uploads retain their bytes, IDs, and locations. Saved course and review references
continue to prevent direct or batch Trash until detached or replaced. Retained
text inherits the existing AI source preference when the optional AI tables exist.
Raw service-role dashboard mutations are revoked; the workspace/AI RPCs remain
the supported write boundary. The supporting hosted migration was applied on
October 10, 2026.

Local batch 5 verification passes lint, TypeScript, the production build, and all
318 regression tests. Focused checks execute the real replacement/protection SQL
with and without optional AI tables and cover rollback at the shared file cap.
React checks preserve the full academic snapshot through retry, lost responses,
and reload. Chrome verifies the pins and dialogs at 1440, 1024, 820, and 390 px;
settled-animation screenshots are inspected, and topmost/bounds checks protect
the captures. Independent review findings are resolved. Authenticated deployed
navigation, other browsers, hosted storage isolation, and multi-session database
contention remain release acceptance work; the preview remains default-off.

## Files redesign — batch 6 native text editor

The default-off Files preview can create an empty native document from New,
folder actions, or the location/background menu. Creation uses a stable file ID
and the selected folder/course, and must commit before editing begins. Names
start at `Untitled.txt` and increment against the visible location's siblings.
Uploaded text continues to open in its read-only preview.

Native name and body drafts save after 750 ms of quiet typing. Save and Ctrl/⌘+S
flush the queue. One immutable attempt runs at a time; newer typing remains
editable and queues behind it. Content and optional name revisions are checked
independently, with a transactional rename/content update. Independent remote
renames are adopted when the user has not queued a local rename.

The additive `20261008060000_document_save_requests.sql` migration provides
service-only save receipts containing an account/request UUID, payload digest,
file ID, and acknowledged content revision. Receipts hold no document body.
Exact retries acknowledge a committed attempt without repeating it; reuse with
different data is rejected. Replays return current content as well as the original
acknowledged revision, allowing the client to detect later writes. File/account
deletion cascades remove their receipts. Apply all six redesign migrations in
order before using the dependent API; the connected hosted prototype received
this migration on October 10, 2026.

Failed or ambiguous saves retain the full local draft and exact attempt for
explicit Retry and `.txt` download. Conflicts pause writes and offer a durable
copy with a new ID or confirmed discard/readback. A failed copy keeps its stable
ID for retry and subsequently saves newer local typing onto that copy. Close
confirms unsaved text, unload/sign-out protection covers drafts, and an account
change fences writes while retaining the old editor for download or explicit
close. Workspace reload and assistant application require closing the editor.

Local SQL/API, autosave, React and full-workspace acceptance verify revisions,
retry receipts, atomic rollback, UTF-8/empty content, profile fences, queued
rename/body edits, and draft recovery. Production build, lint, TypeScript, and
all 341 regression tests pass; Chrome desktop/mobile checks pass with inspected
screenshots. Real multi-session PostgreSQL contention,
hosted sessions/private storage, and Firefox/Safari remain Batch 11 gates.

## Files redesign — batch 7 folder organization

The Files preview creates custom folders at the root or inside custom/course
folders, renames active custom folders and ready files, and moves a selection
through an accessible destination dialog or an internal drag. Stable IDs keep
duplicate names distinct. Managed course roots follow course names and have no
ordinary rename, move, or Trash action.

The additive `20261008070000_folder_moves.sql` migration validates every raw
selection and numeric revision under the profile lock before deriving which
items are covered by selected ancestor folders. Only the effective roots move;
nested descendants stay inside them, regardless of selection order. Any stale
raw descendant or invalid destination rolls back the whole move. Course and
assignment associations remain independent of location, and the browser shows
their badges where they differ. New uploads/text use the nearest managed course
ancestor; root custom locations default to Personal.

Service-only `rename_account_file` checks the independent metadata revision and
updates only the name. `PUT /api/files?id=...` accepts the explicit rename action
with `baseMetadataRevision`; legacy metadata callers keep their existing contract.
Document bodies, object bytes, hashes and academic links are untouched. Apply
all seven redesign migrations in order before using the dependent APIs. The
connected hosted prototype received this migration on October 10, 2026.

Folder creates freeze the first submitted ID/name/parent for exact retries.
Rename and move dialogs retain their captured revisions on failure rather than
silently adopting external edits. Draft JSON is downloadable; a conflict requires
refreshing and reopening the latest selection. Open drafts survive navigation
and account hydration, while old-account writes and late acknowledgements are
fenced. Unload, export, sign-out, assistant application and workspace reload
respect pending folder drafts. Internal drags ignore external file payloads.

Recursive Trash/restore and explicit archive controls are implemented in Batches
8–9; external file drops and bulk actions are implemented in Batch 10. Real PostgreSQL multi-session
contention, hosted account/storage isolation and other-browser acceptance remain
Batch 11 gates. The redesigned interface remains disabled by default.

Local verification passes the actual SQL/API checks, operation/React and full
workspace acceptance, production build, lint, TypeScript and all 362 regression
tests. Both Chrome verifiers pass at 1440, 1024, 820 and 390 px, including mobile
Move controls, with inspected screenshots and no page/console errors. Independent
review has no remaining material findings.

## Files redesign — batch 8 recursive Trash and permanent deletion

Apply `20261008080000_recursive_trash.sql` after the batch 1–7 migrations before
deploying these APIs. It adds original-path snapshots, folder purge state,
profile-owned recovery-folder mappings and durable purge manifests. This migration
has only been verified locally. `FILES_BROWSER_ENABLED` remains disabled by default.

Recursive Trash locks the account, validates every submitted revision, and checks
the entire active custom-folder tree for protected saved/draft syllabus references
before moving anything. The error identifies the blocking file. Files detach before
their folders; content, academic links and content revisions remain intact. Each
recursive root receives an operation ID. Restore follows original descendant links
only within that operation, so independently trashed children remain in Trash.
Original location and deletion time are displayed from retained metadata; legacy
ready-file DELETE also captures its original path and preserves stored content.

Restore uses the original active location when available. An unavailable parent
recovers into a visible custom root named `Restored files`, selected by an owned
mapping rather than by its name. A moved, renamed or unavailable mapped folder is
replaced with a fresh recovery root, preserving the user's folder choices. Explicit
legacy restore destinations remain supported. Restored class images and assignment
attachments reappear with their original associations; active academic views hide
cached Trash rows as well as filtering the canonical list.

Permanent deletion requires an explicit confirmation. A folder's confirmation
counts all original descendants, including children trashed in earlier operations.
Empty Trash confirms the entire Trash, without automatic expiration. A captured
UUID identifies a frozen purge manifest; an exact retry cannot absorb newly trashed
items. Cleanup marks files deleting and folders purge-pending before object removal,
then finalizes permanent tombstones only after all manifest files are removed.
Native bodies are purged, restore/recreation is denied, and finalized folders are
excluded from browsing/export. Existing AI availability and lease fences observe
the file transitions while preserving user preferences.

Undo is available across workspace navigation. Dialogs retain captured profiles,
revisions and purge UUIDs through failures and offer downloadable recovery requests.
Account changes abort/fence late acknowledgements. A saved mutation followed by a
failed list refresh retries only the refresh; it does not repeat the mutation.
Open requests and in-flight Undo guard reload, export, sign-out and assistant writes.
The selection toolbar adds bulk move, Trash, restore and selected ZIP download
in batch 10; explicit permanent deletion keeps its separate confirmation flow.

Local verification includes actual migrated PostgreSQL functions and compiled API
routes in PGlite, React/workspace recovery tests and Chrome at 1440, 1024, 820 and
390 px. Hosted PostgreSQL concurrency, live storage/account isolation, authenticated
deployment navigation and Firefox/Safari remain batch 11 release checks.

## File discovery, activity and semester archives

The Files browser searches saved file and folder names in the current folder or
across active locations. Course filters use academic associations independently
of where a file is stored; format filters use metadata without loading document
bodies. Name/modified sorting keeps folders first in both directions. Search
results show their saved locations and can open the containing folder. Archives
are excluded unless Include archived is selected; Trash remains separate.

Layout, course/type filters, sort field/direction and Include archived persist in
the account workspace's `filePreferences`. Older layout/filter preferences remain
valid. Search text and search scope stay temporary and are never saved with the
workspace. Discovery changes do not rewrite document contents or academic links.

Recent records a successful private preview read, native document read/save or
file edit. Background image loading, attempted reads and downloads do not record
opens. Activity updates use captured account identity and item revisions; server
acknowledgements cannot alter content, modified dates or item revisions. Failed
activity writes retain a retry control and later successful events in order until
retry or dismissal; an acknowledged update with a failed
refresh retries only the refresh. Account generations fence late A–B–A responses.
File and folder stars use the same persisted, revision-checked activity API.

Top-level custom and managed course folders can be archived with an editable term
label defaulted from the account's current term, or `Archived`. Archives group by
that stored label, which does not follow later account term changes. Managed
course name/color snapshots come from authoritative course data. Archived
contents remain accessible; user organization and content mutations reject
archived source/destination paths. Unarchive returns a root to My files without
changing courses, schedules, assignments, grades or syllabus/file links. Trash
and permanent-deletion recovery retain their existing protections.

## Upload queues and selected downloads

Apply `20261009100000_selected_file_download.sql` after the batch 1–9 migrations
before deploying the selected-download API. It adds a service-only, account-locked
selection snapshot function. This migration was applied to the connected hosted
prototype on October 10, 2026; the production interface remains disabled by default.

The redesigned Files browser accepts multiple files through New or an external
drop into the current active folder. Internal browser drags remain moves. Each
selected file retains its original bytes, immutable destination/association
metadata and UUID, with independent progress, completion, failure and retry.
Retries reuse the existing upload reservation and verified-byte contract; a
confirmed upload followed by a failed metadata refresh retries only the refresh.
The root upload queue survives dialog close and page navigation. Pending or
failed selections protect reload, export, sign-out and assistant writes; recovery
includes the original selected file and JSON request details. Account generations
abort and fence older attempts; returning to the original account requires an
explicit retry. Existing class and assignment single-file controls stay available.
Dismiss removes the local queue row; it does not delete a server reservation or
confirmed file. Refresh Files to inspect a pending upload and use its existing
Cancel upload action if that reservation should be removed.

Bulk move, Trash and restore reuse account-locked transactional actions and
captured item revisions. Virtual syllabus placeholders are excluded. Selected
ZIP downloads use an authenticated server snapshot of recursively expanded,
owned active or archived items. Every raw selected revision is validated before
overlap deduplication. Native document bodies and content revisions are captured
together, and the shared content reader verifies uploaded bytes. ZIP paths are
relative, sanitized and disambiguated without renaming saved items; empty folders
are retained. Trash and unfinished selected uploads require recovery first.

Selected downloads retain the selection on failure and do not publish a partial
or late-account download. The server streams one file at a time; the browser
collects the complete ZIP before saving it. Large selected downloads need memory
and deployment load checks as part of batch 11 acceptance.

## Files redesign — batch 11 release verification

Apply the additive `20261009110000_file_release_integrity.sql` and, when AI is
installed, `20261009120000_ai_file_result_fence.sql` after the preceding Files
migrations and before dependent API deployment. Both were applied to the
configured hosted prototype database on October 10, 2026, with the preceding
missing migrations; see the application record in [PLAN.md](PLAN.md#hosted-schema-repair--october-10-2026).
The AI fence migration safely skips absent AI tables.

Folder listings now use a service-only profile-locked JSON snapshot rather than
PostgREST row-limited table reads. This retains all owned folders and activity,
including archive ancestry above 1,000 folders. Non-deleted purge-pending folders
remain visible only in Trash as Cleanup pending. Retry Permanent delete or Empty
Trash with their fresh revisions after a cleanup/finalization failure; opening
and restoration are unavailable once purge intent is committed. Tombstones remain
hidden and cannot be resurrected.

Replacing or clearing a pasted syllabus in an archived managed course folder
preserves the old text through a revoked internal document mutator. Public writes
to archived folders stay blocked. Account locking, original source preferences,
the 1,000-file cap, 1 MiB body limit and full academic rollback still apply.

AI completion revalidates the workspace revision and citation availability in
the final database transaction. It takes the same account lock as source
exclusion, document edits and Trash so a stale new answer/proposal cannot commit
after those changes. A conflict requires a new answer; already completed
conversation history remains retained and citation opening rechecks availability.

The integrated PGlite/API release scenario and focused Chrome accessibility
checks use synthetic auth/storage. The read-only structural release probe never
marks a release ready, even when schema metadata passes. See
[the release and recovery runbook](docs/files-release.md) for deployment order,
two-account/private-storage acceptance, concurrent-session checks, browser/load
gates and recovery. Keep production `FILES_BROWSER_ENABLED=false` until those
hosted gates pass. Local development enables the browser by default; an explicit
false override retains the legacy interface. Disabling the interface retains all
persisted data and compatible APIs.

## Connected surfaces

| Where | Saved behavior |
| --- | --- |
| Files | Upload original bytes; list, rename, associate with a class or Personal, classify, preview, download, delete, and retry failed operations. Class filter and list/grid preference persist in the account workspace. |
| Class details | Add class resources and class images, edit file associations, and access the original syllabus. The newest ready class image appears on the class card. |
| Assignment details | Attach private files to class assignments or Personal assignments; preview/download/edit/delete through the same account-owned API. |
| Syllabus review | Upload and retain a private source file, open it again, detach it, and save its ID with the review. Approval associates the original file with the new class in the same transaction as the class and assignments. |
| Search | Searches actual assignment text/notes, classes, file metadata, events, syllabus text/reviews, grades, study history, and independent widget notes. Results open their corresponding editors or previews. |
| Settings → Account & data | Export saved account as ZIP: complete profile, courses, workspace, file metadata and original bytes. Current unsaved workspace/settings drafts remain separately downloadable as JSON. |

Search queries and open previews are temporary UI state. PDF/image contents are
not indexed or OCR-processed; syllabus text can be pasted or read from a text file.
The text-import control explicitly imports text; the private-source uploader saves
the original bytes. Custom profile-avatar upload is not an existing site feature;
Google avatar identity remains saved by the existing auth/profile integration.

## Database and storage

Applied `supabase/migrations/20260907000000_private_files.sql` to the connected
Supabase project `vvejyvjsogrwungkivhu`. It adds content hashes and deletion
tombstones, supports Personal assignment attachments, and installs service-only
file mutation/export functions. The original foundation migration is unchanged.
The workspace transaction validates owned ready syllabus references, updates their
class association on approval, and retains files when classes/assignments are removed.

The private `eduessentials-private` bucket uses account/file UUID paths generated
only by the server. Browser roles cannot read metadata or invoke the file/export
functions directly. API requests verify the Google-backed profile and the expected
account; native download/export URLs also carry an expected-account guard.
Uploaded bytes are MIME-sniffed; HTML/SVG and unknown formats download as inert
bytes. Image previews accept PNG/JPEG/GIF/WebP; PDFs have sandboxed previews and an
open/download alternative. Responses are private, non-cacheable, and attachment-only.

## Recovery and limits

- Stable upload IDs, immutable object keys and SHA-256 readback prevent duplicate
  files on lost-response retries. Failed uploads retain the file selection and
  details in the open editor, protect unload, and can resume from pending metadata.
  Once an upload begins, its reserved details stay fixed for retries; edit them
  after completion or explicitly remove the pending upload and start again.
- Edits use exact file revisions. Stale edits/deletions cannot overwrite newer
  metadata. Refresh loads the latest version; older list responses cannot undo a
  successful local mutation.
- Deletion records intent before removing bytes and retains a tombstone after
  success. Failed removal stays visible with Retry deletion. Tombstones prevent
  delayed uploads from resurrecting deleted files. A late upload detects deletion
  and attempts byte cleanup; if its worker dies or that cleanup fails, an operator
  must reconcile inaccessible orphan bytes using the retained tombstones. There is
  no background garbage collector in this step.
- Syllabus files must be detached from saved reviews/classes before deletion or
  reassignment. Removing a class keeps its other files available as Personal files.
- Maximum 25 MiB per file and 1,000 active file records per account. Failed pending
  uploads count toward the limit and can be removed. Existing workspace limits apply.
- Export takes one consistent database snapshot, then streams a ZIP64 archive with
  original bytes. Pending uploads/deletions block export. Missing/corrupt bytes or a
  concurrent deletion fail the archive stream, requiring a fresh complete download.
  Export holds one file at a time; very large account exports still need hosted
  runtime/download testing in Step 8. No restore/import workflow is claimed.

## Verification

- Production build, TypeScript, lint, and 103 tests pass, including previous steps.
- Actual PostgreSQL migrations/functions execute in PGlite. Tests cover verified
  ownership, browser-role denial, cross-account reads/edits, revision conflicts,
  retries, pending/deleting recovery, Personal attachments, syllabus ownership and
  atomic approval, safe detachment, export manifests/bytes and corrupted streams.
  Object-storage transport and auth identities are simulated in these tests.
- React/JSDOM exercises the actual file controls: failed upload retains the original
  selection, retry reuses the same ID, saved filters/view survive reload, search
  finds uploaded metadata, and the preview/download exposes the original content.
- MIME/path/size/hash tests verify unsafe format handling and actual streamed limits.
- An independent .NET ZipArchive reader opened the produced ZIP64 archive and
  recovered both its account manifest and original Unicode-named file exactly.
- Live read-only REST metadata probe confirms both new columns/RPCs, all four
  account tables rejecting anonymous reads (401), and the existing private bucket
  retaining its 26,214,400-byte limit. Live SQL privilege inspection verifies the
  mutation/export/workspace functions remain restricted to service_role.

No live user content was uploaded or changed, and no application publication was
performed. Real Google sessions, second-account hosted file isolation, private
image/PDF rendering and deployed export downloads remain Step 8 acceptance work.
