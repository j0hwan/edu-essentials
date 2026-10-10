# October 10, 2026 database CPU incident

The connected Supabase project `vvejyvjsogrwungkivhu` ran PostgREST 14.5. Its
Postgres error stream repeatedly reported `Workspace changed in another session`
from `save_account_workspace`. The 353,246 errors shown in the screenshot were
repeated database transactions inside PostgREST; the dashboard showed only 632
PostgREST API events in the inspected hour.

The application raised SQLSTATE `40001` for optimistic revision conflicts.
PostgREST 14 treats that code as retryable and can retry indefinitely. Supabase
[documents this exact failure and the PT409 fix](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
The large `set_config` count was a consequence of repeatedly establishing request
context during those retries. Adding indexes would not resolve that loop.

## Applied database fixes

Both migrations were applied through the authenticated SQL editor on October 10,
around 09:02 UTC:

- `20261010000000_nonretryable_conflicts.sql` converts application-owned logical
  conflicts to `PT409` (HTTP 409). It preserves the installed function bodies,
  signatures, owners, permissions, defaults, and security settings. Optional AI
  functions are skipped if absent; 17 installed functions were converted.
- `20261010010000_workspace_save_efficiency.sql` validates canonical lowercase
  UUID references before comparing directly to indexed `user_files.id`, and
  skips course updates whose stored fields are unchanged. Account, revision,
  readiness, deletion, duplicate-syllabus, and ownership checks remain enforced.

Schema reload was requested after both migrations. Previously looping connections
had disappeared on recheck, so no backend termination or project restart was
needed. These changes did not edit saved user content or add indexes.

Application handlers now accept both `PT409` and legacy `40001`, preserving the
existing workspace/file/AI conflict responses and upload cleanup behavior. The
application has not been deployed anywhere, as confirmed by the project owner.
These handler changes will be included in its first deployment. The database
mitigation is already live and does not depend on an application release to stop
PostgREST retries.

## Production evidence

| UTC time | Transaction rollbacks | Observation |
| --- | ---: | --- |
| 08:59:58 | 351,385,498 | Before the hotfix |
| 09:01:58 | 351,506,759 | Roughly 1,013 rollbacks/second in the preceding interval |
| 09:04:42 | 351,506,760 | Only one additional rollback: the deliberate conflict probe |
| 09:11:15 | 351,506,760 | No further rollbacks; zero active workspace RPCs |
| 20:33:28 | — | Zero active workspace RPCs and zero manually raised `40001` conflicts |
| 20:35:29 | 351,506,760 | Counter still unchanged more than 11 hours after the probe |

The live conflict probe returned HTTP **409**, code **PT409**, in **122 ms**. It
supplied a null expected revision, which is rejected before content mutations.
The dashboard CPU graph initially failed to load and its high-CPU banner remained
visible. The documented Metrics API subsequently returned advancing
`node_cpu_seconds_total` counters. Samples at 09:10:51 and 20:33:12 UTC showed
roughly **2.1% non-idle CPU** across both cores over that interval (about **1.5%**
excluding I/O wait). This is an interval estimate from cumulative counters, not
an instantaneous dashboard reading. A separate 20:33:12–20:34:16 UTC sample
showed about **1.1% non-idle CPU**, confirming low activity in the latest minute.

## Verification and future changes

Local database tests cover both migration paths with and without AI, idempotence,
permission preservation, conflict rollback, unchanged course/folder revisions,
changed-course synchronization, and invalid or foreign syllabus references.
API tests verify both conflict codes return 409 after one RPC call. Final validation:
`node --test --test-concurrency=1 tests/*.test.mjs` passed **532/532** tests;
changed-file ESLint, `npx tsc --noEmit`, and `npm run build` passed.
The full test run required permission for its local rendered-HTML server to bind
a port; it did not contact production Supabase.

Do not raise `40001` for application revision checks in new RPCs. Use `PT409` and
map it to the corresponding conflict response. Actual PostgreSQL serialization
failures are different and should not be globally rewritten.

A live probe can be repeated when diagnosing this incident:

```sh
node --env-file=.env scripts/verify-cpu-fix.mjs
```

It requires server configuration, reads initialized account metadata, and performs
one intentionally rejected RPC. It prints only status, error code, and duration;
it is not part of the local test suite. Do not run mutating RPCs with
`EXPLAIN (ANALYZE)` in production. For read-only application queries, inspect
representative plans before deciding to add an index.
