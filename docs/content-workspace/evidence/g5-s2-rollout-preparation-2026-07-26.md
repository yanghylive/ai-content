# G5 S2 Rollout Preparation

- Date: 2026-07-26 (America/Los_Angeles)
- Scope: `CW-G5-S2-FLAG-ROLLBACK`, `UX-15`, `CW-D009`
- Status: in progress; this is preparation evidence, not a 48-hour rollout acceptance

## Drift gate

- `kaypal-commercial-ux-prototype.html`, `kaypal-content-workspace-prototype.html`,
  and `kaypal-content-workspace-development-plan.html` all match the frozen
  SHA-256 values in `docs/content-workspace/contract.json`.
- S1 `UX-01` remains `accepted`; S1 result-entry and legacy-route behavior are
  not reimplemented in this slice.
- Contract guard, Astryx Doctor, Astryx migration guard and navigation zero-loss
  guard passed before S2 work began.

## Implemented preparation

- `NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED` is a strict boolean and
  defaults to `false`.
- `NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT` accepts only an
  integer from 0 to 100 and defaults to `0`; malformed values fail closed.
- Stable cohorts use the authenticated `/auth/me` user id only in memory with a
  flag-specific FNV bucket. The user id, tenant id, brand id, goal, article id,
  material id and citation id are absent from metric payloads and draft input.
- When the flag is off, the result entry is hidden and valid `intent` deep links
  fall back to the existing `ContentWorkspaceClient`. Existing `articleId` and
  `step` deep links remain on the legacy path.
- The fixed event dictionary is:
  `result_entry_viewed`, `intent_form_viewed`, `intent_submitted`,
  `draft_created`, `draft_create_failed`.
- Events are exposed through `CustomEvent` and a bounded current-tab
  `sessionStorage` buffer. Storage or dispatch errors cannot block content work.

## Rollback boundary

`NEXT_PUBLIC_*` values are compiled into the Next.js frontend. A rollback is a
new build/deploy with the flag set to `false` or the rollout percentage set to
`0`; this is not an instant remote kill switch. The current slice does not claim
the required live 10%/48-hour observation, production metrics panel, or a
completed rollback drill.

## Verification

- S2 rollout and S1 entry contract tests: `16/16` passed.
- TypeScript and targeted ESLint: passed.

Remaining acceptance work is to connect an approved production metrics sink,
run the 10% cohort for 48 hours, capture closed/gray/rollback runtime evidence,
and only then consider `UX-15` for acceptance.
