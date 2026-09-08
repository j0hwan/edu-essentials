# Step 7 — private files, attachments, images, search and export

Completed September 7, 2026. Steps 1–6 were reviewed and regression-tested.
Publication and authenticated hosted acceptance checks remain Step 8.

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
