# Step 2: database and account foundation

## Review and scope

Reviewed the Step 1 audit against the existing auth helpers, both APIs, validators,
client save/load handlers, migrations, and account tests. The only prior uncommitted
change was the inventory document. The current changes implement the foundation;
they do not claim that the remaining feature work in Steps 3–8 is complete.

Continue using the existing Supabase project and Google account identity. Do not
introduce a second database or replace the Sites project identifier.

## Live verification and completed installation

The read-only probe confirmed:

- Supabase REST metadata is reachable with the configured server key.
- `app_profiles`, `courses`, and `dashboard_state` exist, with all current profile
  fields and `updated_at` revision columns.
- `initialize_account_workspace` is installed.
- Google authentication is enabled.
- Anonymous table requests return 401 for each of the three installed app tables.
- Before installation, `user_files` and the named private bucket were missing.
- After installation, `user_files` and `save_account_workspace` are present;
  anonymous access to `user_files` returns 401; the bucket is private with a
  26,214,400-byte file limit.

No existing user content was read, changed, or deleted. In addition to the metadata
probe, all six read-only live SQL catalog checks passed: RLS on all four app tables,
no app table grants to browser/public roles, service-only snapshot execution, the
restrictive private-bucket policy, five installed foundation triggers, and profile
ownership's foreign key to Supabase Auth. These checks do not establish a real
Google consent flow, a user save round trip, or actual file transfers. Those remain
part of the later feature checkpoints.

The available local `.env` has Supabase app API keys, not a SQL connection or
management credential. A signed-in Supabase dashboard was available, and its project
was verified to match the configured Supabase URL. The exact tested migration text
was applied through that project's SQL editor on September 5, 2026. Supabase reported
success, followed by the independent API and catalog checks above. This manual SQL
editor installation does not populate Supabase CLI migration history; do not blindly
run `supabase db push` against this project without reconciling migration history.

The Sites environment lookup for the unchanged ID in `.openai/hosting.json` returns
`project_not_found`; hosted runtime variables and publication cannot be verified
through that connection. No site was created, replaced, or deployed.

## Implemented safeguards

- Profile and dashboard APIs require `baseRevision`, the exact saved `updated_at`
  timestamp returned with the loaded record. Each update filters by both the
  authenticated owner's ID and that revision in one SQL update. A stale request
  receives HTTP 409; missing revision receives 428. A null dashboard revision is
  only for insertion when no dashboard row exists; a concurrent insert conflicts.
- Both clients send revision tokens and use the returned token after saving. The
  workspace hydrates the latest full profile as well, so first-run initialization
  does not leave Settings holding an outdated profile token.
- The workspace displays a persistent conflict message and points to its existing
  export feature. Local edits are retained. No automatic overwrite or merge occurs.
  Profile errors retain the form draft; copy those draft fields before reloading.
- Profile bodies are capped at 16 KiB; workspace bodies at 1 MiB. Limits apply to
  actual streamed UTF-8 bytes even without a Content-Length header. Invalid JSON
  and content types fail before a write.
- Duplicate workspace, assignment, and event IDs are rejected. Existing v1 layouts,
  all 18 widget types, sizes, ordering, and shared notes continue to round-trip.

Conditional saves work against the existing schema. Until the new code is deployed,
the currently hosted application retains its previous save behavior. Current course
POST/DELETE calls remain separate from dashboard saves until Step 5 switches them
to the transaction below; this checkpoint does not claim to fix that entire flow.

## Installed migration

`supabase/migrations/20260905000000_persistence_foundation.sql` is already applied
to the connected project. For a different clean environment, apply it once after
the two existing migrations. The
whole file runs inside a transaction. It does not update or delete existing user
content or rewrite dashboard documents.

It adds:

1. Monotonic timestamp triggers on profiles, courses, dashboard state, and file
   metadata. Direct SQL changes and Google email/avatar synchronization advance
   revisions too; timestamps are preserved when the migration is installed.
2. `user_files`, with a composite account/file primary key, same-account course
   foreign key, private bucket restriction, file sizes up to 25 MiB, and a strict
   `<profile UUID>/<file UUID>` object path. Upload lifecycle is pending/ready/deleting.
   Anonymous and authenticated browser roles have no table access.
3. The private `eduessentials-private` storage bucket and a restrictive browser-role
   policy that protects it even when unrelated permissive policies exist. A bucket
   with this name but incompatible settings aborts the migration rather than changing it.
4. `save_account_workspace(profile ID, verified auth user ID, expected revision,
   course rows, dashboard document)`. This service-only function locks and verifies
   the account, rejects stale revisions, checks course references, and saves course
   changes and the document in one transaction. An error rolls back every change.

Files remain accessible as personal resources if their class is removed. Both the
existing course deletion path and the new transaction clear the obsolete assignment
association. Removing a class does not silently delete its uploaded bytes. Step 7
must implement authorized file deletion and upload failure cleanup using Storage's API.

The transaction expects API-validated canonical course rows and a validated layout.
It is a database integrity boundary, not a replacement for field/date/size validation
in the endpoint. Its identity arguments must always come from `requireProfile()`.

To recheck installation metadata without changing data, run:

```powershell
node --env-file=.env scripts/verify-database.mjs
```

Expect `user_files` and `save_account_workspace` to be present, anonymous reads to
be denied, and the named bucket to be private with a 26,214,400-byte file limit.
This verifies installation metadata; authenticated feature and actual upload checks
remain part of later checkpoints. Do not reapply already installed migrations or
delete stored records to recover from an installation issue.

## Data choices for later steps

- Keep profile/settings in `app_profiles`; use the same revision protocol.
- Extend the versioned dashboard document for stable widget identities, independent
  notes/configuration, numeric goals, timer state, study-session history, and grade
  inputs. Add each typed format and migration when its feature is implemented.
  Compute counts, charts, streaks, and progress from saved records.
- Keep courses relational; use the snapshot transaction for related course and
  document changes. Personal items use an empty course ID.
- Store file bytes in private Storage and relational metadata in `user_files`.
  Future endpoints must look up the authenticated owner's metadata before signing,
  downloading, deleting, or associating an object; never trust a supplied path.
- Do not automatically retry a conflict with a newer revision: doing so would turn
  a rejected stale save into an overwrite. Step 3 provides fuller recovery UX.

## Review and validation

The PostgreSQL tests execute all three migrations, including a failed-install rollback,
legacy-data preservation, conditional profile/dashboard writes, two-account ownership,
stale revision rejection, transaction rollback after partial course processing, file
ownership and size constraints, course/file detachment, Google identity synchronization,
and anonymous/authenticated database and Storage-policy restrictions.

Validation passed: production build, TypeScript, lint, 11 account/API tests,
13 foundation tests (including PostgreSQL subtests), and 7 HTTP route integration
tests. The final additional rollback test was run after the full build/test run;
the application source did not change afterward.

PGlite is a test-only dependency; no runtime database or new production dependency
was introduced. Both npm and pnpm lockfiles were updated. Real account round trips,
actual object storage transfers, and publication of the local application changes
remain pending and are not implied by local tests or the completed live migration.

Primary technical references: [PostgreSQL conditional UPDATE](https://www.postgresql.org/docs/current/sql-update.html),
[PostgreSQL row locking](https://www.postgresql.org/docs/18/explicit-locking.html),
[Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits),
and [PGlite PostgreSQL testing runtime](https://pglite.dev/docs/).
