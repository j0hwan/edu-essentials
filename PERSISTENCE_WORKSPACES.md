# Step 4: workspaces, widget configuration, and independent notes

Completed locally on September 6, 2026. Awaiting permission for Step 5.

Reviewed the Step 2 ownership/revision safeguards and Step 3 loading, autosave,
retry, draft protection, and settings changes. Those protections remain in place.
No installed SQL migration was changed or reapplied. No live user content was edited.

## Completed surfaces

| Where | What now persists |
|---|---|
| Home → workspace tabs / Add workspace | New workspace, tab order, selected workspace |
| Home → Workspace options | Rename, duplicate, move left/right, confirmed deletion |
| Home → Add widget / Browse widgets | All 18 existing widget types and workspace membership |
| Widget options | Small/medium/large size, move earlier/later, duplicate, remove |
| Widget drag handle | Reorder on drop, using the persistent widget ID |
| Each Quick notes widget | Independent text, including empty/cleared text |
| Search → Notes | Each note's text and workspace label; result opens its workspace and focuses that note |
| Home → recovered shared-note notice | Restore legacy text when no notes widget remains, or download it |
| Save/retry bar and Settings → Export data | Current independent notes travel with the workspace document; unsaved-work downloads include readable widget objects |

Widget design remains the site's existing responsive grid, with the three supported
sizes, ordering, type-specific colors, and type-specific content. There is no custom
color/style or arbitrary x/y positioning editor to connect. Timer settings, goals,
grades, and calculated widget content remain Step 6.

Duplicating a workspace copies its widget configuration and note content with fresh
widget IDs. Duplicating a notes widget also creates an independent copy. Later edits,
clear actions, or deletion do not alter the original. Removing a note with text,
clearing text, and deleting a workspace require confirmation; the last workspace
cannot be deleted. Dragging uses a dedicated handle so editing/selecting note text
does not start a layout drag. Keyboard users retain the earlier/later controls.

The UI enforces 20 workspaces, 100 widgets per workspace, 80-character workspace
names, and 20,000 characters per note. Copy names remain within the name limit.
The complete candidate document is checked before accepting workspace/widget/note
changes, including a 1,000,000-byte UTF-8 limit with room for the API envelope.
Limit failures retain the previous valid state and explain why the change was
rejected. They do not leave all subsequent autosaves stuck on an oversized edit.

## Storage and migration

The same authenticated `GET/PUT /api/workspace` path stores the layout in
`dashboard_state.payload`, scoped by the verified profile ID and guarded by the
loaded revision. No new table or live SQL migration is required.

`lib/workspace-codec.ts` reads v1 and v2; all new writes are canonical v2:

- `v: 2`, `a`: active workspace ID, `w`: ordered workspace tuples.
- Workspace tuple: `[workspaceId, name, widgets]`.
- Standard widget tuple: `[typeCode, sizeCode, instanceId]`.
- Notes widget tuple: `[typeCode, sizeCode, instanceId, noteIndex]`.
- `t`: note strings referenced by the note index. Identical strings are packed once
  per save, then decoded into independent widget values. Editing one copy creates a
  separate value on the next save; it never changes another widget through an index.
- `n`: preserved legacy text only when it has no widget to receive it.
- `d`: existing assignment/event/view data, preserved through the format upgrade.

V1 loading assigns deterministic IDs and copies the original shared text to every
existing notes widget. If there are no notes widgets, it preserves the text for the
Home recovery action. Migration runs in memory on load and is persisted with the
next ordinary edit/save. Loading alone issues no write. Deduplicating packed strings
lets even a maximum legacy layout retain all 2,000 copies of a 20,000-character note
without multiplying its stored text beyond the request limit.

The API validates and canonicalizes submitted layouts. A v1 write can upgrade a v1
record once. An older client attempting a v1 write against a v2 record receives 426
with reload/copy guidance, even if it supplies the current revision. The actual
update still uses an atomic revision comparison, so a concurrent upgrade or another
session's edit cannot be overwritten. Missing revisions, stale writes, account
switches, and malformed/duplicate widget identities remain rejected.

Once an account has saved v2 data, do not roll application code back to a v1-only
reader/writer. Any later deployment must keep this backward-compatible v2 support.
Future feature steps should extend this format deliberately and preserve widget IDs.

## Validation

Passed on the final application source:

- `npm test`: production build and all 65 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.

The PostgreSQL suite runs the actual API handlers and SQL operations against isolated
PGlite. It verifies v1 upgrade/readback, v2 independent notes and layout changes,
downgrade rejection, revisions, and two-account isolation, alongside the earlier
schema/RLS/auth/transaction checks.

Codec tests cover all 18 types, deterministic legacy IDs, repeated reloads, copied
notes, clear/delete/reorder behavior, orphaned shared-note recovery, maximum legacy
layouts, malformed references, duplicate identities, and UTF-8 size rejection.

JSDOM component tests exercise the actual React controls for workspace creation,
rename, copy, both order directions, active selection, confirmed deletion, all 18
widget types, size changes, keyboard reorder, drag/drop, independent note edits and
clearing, exact-note search, recovery, offline retry, and limit controls. Existing
settings/navigation/session/conflict tests still pass. JSDOM does not establish real
browser layout or a live production session.

No new dependencies were needed. These local tests do not claim authenticated live
save/reload or cross-device verification. Publication and those checks remain Step 8;
the earlier Sites connection issue is still recorded in the foundation report.

Steps 5–7 retain their existing scopes: academic transactions and syllabus review;
timers/goals/grades/statistics; then private files, complete search, and complete export.
