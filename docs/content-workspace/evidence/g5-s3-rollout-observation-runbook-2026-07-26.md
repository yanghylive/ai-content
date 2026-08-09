# G5 S3 Rollout Observation and Rollback Runbook

- Date: 2026-07-26 (America/Los_Angeles)
- Scope: `CW-G5-S3-ROLLOUT-OBSERVATION`, `UX-15`, `CW-D010`
- Status: runnable; the 48-hour observation is not complete

## Preconditions

1. Confirm the three baseline HTML hashes match `contract.json`.
2. Run the content-workspace contract tests, Astryx Doctor, migration guard and
   navigation zero-loss guard.
3. Confirm S1 `UX-01` remains `accepted` and S3 is the active work item.
4. Use an isolated QA account. Do not use customer, brand, material or
   publishing data.

## State A: closed

Build or start the frontend with:

```bash
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=false
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=0
```

Verify:

- The home page does not expose the result-entry panel.
- `/content/workspace?intent=create` falls back to the existing workspace.
- Existing `/content/optimization`, `articleId` and `step` deep links work.
- No S1 rollout event is required while the treatment is closed.

## State B: 10% observation

Build or start the frontend with:

```bash
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=true
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=10
```

The authenticated `/auth/me` user id is used only in memory to produce a stable
0-99 bucket. Users in buckets 0-9 receive the treatment. Do not export the user
id or bucket with the event buffer.

In the browser, export the current-tab event buffer as JSON:

```js
JSON.parse(sessionStorage.getItem("kaypal:content-workspace-metrics:v1") || "[]")
```

Save only the returned event array to a QA evidence JSON file. Validate it:

```bash
node frontend/scripts/content-workspace-rollout-report.mjs \
  --input /path/to/events.json --json --strict
```

The report must reject payloads containing user, tenant, brand, goal, article,
material or citation fields.

## 48-hour observation

Record the real timestamps below. Do not pre-fill or simulate completion.

| Field | Value |
| --- | --- |
| Observation started | pending |
| Observation ends no earlier than | pending |
| Build/version | pending |
| Rollout percent | 10 |
| P0 count | pending |
| P1 count | pending |
| Result-entry views | pending |
| Intent submissions | pending |
| Draft created | pending |
| Draft create failed | pending |

Acceptance requires a real elapsed 48-hour window with no P0/P1 issue. A local
smoke run or deterministic cohort test cannot satisfy this row.

## State C: rollback

Because `NEXT_PUBLIC_*` values are compiled into this Next.js frontend, rollback
requires a rebuild/deploy with the flag disabled or percentage set to 0:

```bash
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED=false
NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT=0
```

After restart, repeat State A verification and preserve a screenshot, runtime
snapshot and report. Rollback is complete only when the legacy workspace is
visible for the intent URL and the protected old routes remain available.

## Stop conditions

Immediately rollback for any P0/P1 issue, authentication or tenancy leak,
duplicate draft creation, loss of an old route, publishing-boundary change, or
metrics payload containing a forbidden identity/content field.

## Cleanup

- Restore the default closed configuration.
- Remove temporary QA users, sessions and drafts.
- Confirm `users=0`, `sessions=0`, and QA article count `0` when the test
  database was initially empty.
- Keep `UX-15` as `in_progress` until the real observation and rollback evidence
  are complete.
