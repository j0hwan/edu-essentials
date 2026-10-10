# Files redesign release and recovery

Batch 11 acceptance is incomplete. Keep production `FILES_BROWSER_ENABLED=false`
until every hosted gate below passes. An isolated staging deployment may enable
the flag for acceptance with test accounts after its migrations and compatible
APIs are installed; it is not a public release. Disabling this server-only flag
retains saved folders, native documents, archive labels, activity and recoverable Trash. It does not
revert compatible file APIs or erase the new persistence fields.

Local `npm run dev` enables the Files browser by default for team review against
the migrated database. An explicit server-only `FILES_BROWSER_ENABLED=false`
overrides that development default. Production, test and other runtimes remain
disabled unless explicitly configured with `true`; local enablement does not
complete the hosted acceptance gates below.

## Local evidence

The release scenario executes the actual additive SQL and compiled account APIs
in PGlite, with synthetic authentication and storage. It creates a course and its
managed folder, attaches a missing syllabus without duplicating academics,
creates/edits/reloads a native document, moves it while retaining academic links,
trashes/restores it, archives/unarchives the course folder and verifies account
ZIP contents, including uploaded bytes and recoverable Trash. It also checks a
second profile's ownership guards and stale content writes.

The Chrome accessibility verifier uses real components with deterministic API
fixtures at 1440 and 390 px. It checks keyboard actions, selection announcements,
dialog names/descriptions, trapped focus, Escape and focus return, native save
live regions and rendered text contrast in normal/high-contrast modes. This does
not establish screen-reader interoperability or authenticated hosted behavior.

Run local checks with Node 22:

```powershell
npm run lint
npx tsc --noEmit
npm test
node scripts/verify-files-accessibility.mjs
node scripts/verify-native-document-browser.mjs
```

Browser scripts require Playwright and Chrome; see the existing validation
environment variables in README. `npm test` includes a production build and runs
test files serially to avoid SQL/DOM contention affecting timing assertions.

## Deployment order and acceptance

1. Obtain the intended staging/deployment origin and confirm the existing Sites
   project, Supabase project and Google callback allow list match that target.
   Obtain authorized database migration access and two Google-backed test
   sessions. Do not create a replacement Site to bypass an unavailable saved
   project.
2. Review the database's applied migration history, take the normal recoverable
   backup and apply only missing migrations in filename order. Existing base
   migrations precede `20261008010000_file_organization.sql` through
   `20261009120000_ai_file_result_fence.sql`. The last two migrations supply
   coherent folder reads, archived syllabus preservation and atomic AI result
   validation. The final AI migration safely skips an installation without AI;
   installations with AI must apply its fence. Do not reapply historical scripts
   or drop retained data to make the history match.
3. Verify service-only SQL grants and private helpers, exact RPC signatures,
   table constraints and migration versions using database inspection. Check
   that `eduessentials-private` remains private with the 26,214,400-byte limit.
   Run the read-only structural probe:

   ```powershell
   node --env-file=.env scripts/verify-files-release.mjs
   ```

   It prints fixed schema/bucket metadata, never keys or user rows. Exit 0 means
   structural metadata passed, 2 means it is blocked, and 1 means the probe could
   not finish. `releaseReady` always stays false: OpenAPI presence cannot prove
   migration bodies, SQL grants, lock behavior or authenticated acceptance. An
   anonymous schema 401/403 is acceptable; verify role privileges through SQL
   rather than weakening anonymous discovery.
4. Deploy compatible APIs and the default-off interface together. Confirm the
   existing Files, class/assignment attachments and export continue to work
   before making the new browser available in controlled staging.
5. In staging, run the ten-step scenario above with account A and real private
   storage. Account B must be denied A's folder/document reads, mutations,
   previews, downloads, selection snapshots and exports. Also verify anonymous
   denial, wrong-account URL guards, sign-out and A–B–A delayed-response fences.
   Never reuse an account's signed/private content URL in another account.
6. Use independent PostgreSQL sessions to contend workspace, file, folder,
   archive, Trash/purge and AI source/result writes. Confirm the profile-first
   lock order, stale revisions, atomic rollback and no newly completed AI answer
   from a source trashed/excluded/changed before finalization. Local PGlite uses
   one connection and cannot prove concurrent lock behavior.
7. Verify keyboard/mobile menus, focus return, contrast, save announcements and
   screen-reader output against the deployed app. Check Chrome, Firefox and
   Safari on supported devices. Test large account/selected ZIPs under deployed
   memory and load limits, interrupted storage/downloads and retry. The browser
   buffers the complete selected ZIP; server per-file streaming alone does not
   establish a safe maximum selection size.
8. Record independent review and every acceptance result in PLAN.md. Enable
   `FILES_BROWSER_ENABLED=true` only after the gates pass, then perform the same
   deployment smoke checks. If any gate fails, keep or reset the flag to false
   while retaining the compatible schema and APIs.

## Recovery

- Refresh after a stale revision conflict. Preserve unsaved document drafts and
  upload selections; retry only the failed operation with the current revision.
- Restore recoverable Trash before editing or moving it. The Restore UI uses
  its original location, falling back to Restored files if that location is
  unavailable. Move the restored item to another active folder if desired.
  The API also supports an explicit owned destination or Files root. Moves and
  restoration retain course/assignment associations.
- A permanent purge first commits intent, removes object bytes and then commits
  tombstones. If cleanup or finalization fails, reload Trash and retry Permanent
  delete or Empty Trash using its current revisions. A non-deleted folder with
  `purge_pending_at` remains visible as **Cleanup pending**, including an empty
  folder whose bytes were already removed. It cannot be opened or restored.
  True tombstones stay hidden; retry does not resurrect them.
- Archived course folders reject user content/organization writes, but replacing
  or clearing pasted syllabus text still preserves its previous body through a
  private trigger path. If file capacity or the body limit prevents preservation,
  the academic save rolls back. Free capacity explicitly before retrying.
- A conflicting AI finalization returns 409 without publishing the new answer
  or proposal. Request a new answer against current sources. Previously completed
  conversation history is retained; citation opening still revalidates access.
- Cancel incomplete ZIP downloads and request a fresh complete snapshot. Do not
  deliver a partially streamed archive as a successful export. There is no
  account import/restore feature or background orphan-byte garbage collector.

## Historical hosted evidence — October 9, 2026

The October 10 schema repair below supersedes the missing-schema observations
in this dated record.

The configured Supabase read-only probe succeeds for the older foundation, but
the redesigned folder/native schema and dependent RPCs are absent. No linked
database migration access is configured. The existing file table denies anonymous
zero-row reads (401); absent redesign tables return 404. The existing bucket is
private at the expected limit. These observations do not satisfy the release gate.

The saved Sites project in `.openai/hosting.json` returns 404 and the current
connection lists no accessible Sites. The deployment URL, two real Google
sessions, real private-storage checks, multi-session contention, Firefox/Safari
and deployed large-ZIP acceptance remain outstanding. No hosted migrations,
user-content writes, uploads, publication or interface enablement were performed.

## Hosted schema repair — October 10, 2026

Authenticated dashboard inspection confirmed the configured EduEssentials
prototype project. All 13 missing repository migrations, from
`20261008000000_onboarding_details.sql` through
`20261009120000_ai_file_result_fence.sql`, completed unchanged in filename order
through the SQL Editor. Historical foundation/AI migrations already represented
in the schema were skipped. The user waived the pre-change backup requirement;
no backup was established. [PLAN.md](../PLAN.md#hosted-schema-repair--october-10-2026)
contains the exact application list and verified catalog checks.

The read-only structural probe now exits 0 (`metadata-passed`), with required
columns/RPCs present and the private bucket retaining its 26,214,400-byte limit.
RLS and selected RPC grants/receipt foreign keys were inspected. The authenticated
local legacy Files page loads without the missing-column error. SQL Editor
execution did not populate migration-ledger versions; comprehensive independent
catalog/grant/version verification remains outstanding.

This schema repair does not complete hosted rollout. A confirmed deployment
target, compatible API deployment, two-account/private-storage acceptance,
concurrent PostgreSQL sessions, deployed browser/screen-reader checks and large-ZIP
load/interruption acceptance are still required. `releaseReady` remains false.

## Local team review — October 10, 2026

The user authorized local interface enablement and a team-visible Git push,
without application deployment/publication. The new browser was verified against
the repaired hosted database through the local authenticated app: a dedicated
synthetic folder/native document was created, edited, saved, reloaded and
downloaded; an existing private upload also previewed and downloaded successfully.
The verification folder/document remain available for review. Existing content
and academic records were preserved. Desktop/mobile Chrome fixture checks pass.

This one-account local verification does not replace the hosted acceptance gates.
Production remains disabled by default, and Batch 11's hosted rollout is open.
