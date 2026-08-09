# CRM Commercial Phase 1 Acceptance Checklist

Date: 2026-06-30

Owner: QA / commercial acceptance

Scope: Phase 1 commercial demo for Kaypal CRM Lite, Kaypal Closer, MIGO safe import, connector contracts, readiness gate, and Windows regression boundary.

Evidence reviewed:

- `docs/kaypal-crm-closer-migo-commercial-development-plan-2026-06-27.md`
- `docs/ai-employee-commercial-closed-loop-six-person-development-plan-2026-06-25.md`
- `docs/redfox-growth-crm-first-batch-intake-2026-06-29.md`
- `backend/src/modules/crm/crm.controller.ts`
- `backend/src/modules/crm/crm.service.ts`
- `backend/src/modules/commercial-readiness/commercial-readiness.service.ts`
- `frontend/src/lib/api/crm.ts`
- `frontend/src/lib/api/commercial-readiness.ts`

## Commercial Posture

Phase 1 may be accepted only as a local deliverable demo / PoC. It must not be described as GA SaaS, production external CRM sync, or production write-back.

Accepted statement:

- "CRM Lite + Closer + MIGO proof + Connector Center are ready for a controlled commercial demo."

Rejected statements:

- "External CRM production sync is live."
- "MIGO import can write customer data without a future production write gate."
- "The Windows installer is fully GA-ready only because the web routes load locally."

## Status Legend

| Status | Meaning |
| --- | --- |
| Pass | Meets demo acceptance with evidence. |
| Warn | Demo can continue, but the item must be disclosed in the customer-readiness note. |
| Blocker | Cannot sign Phase 1 commercial demo until fixed. |
| Out of scope | Not required for Phase 1, but must be bounded explicitly. |

## Demo Data Precondition

Before running acceptance, prepare one deterministic demo tenant/user with:

- CRM app purchased and installed through App Market.
- At least 5 customers or contacts.
- At least 2 companies.
- At least 2 open opportunities.
- At least 3 open tasks, including one due today and one overdue.
- At least 5 timeline events or notes.
- One CSV-like sample with company, contact, phone, email, WeChat, opportunity, and note fields.

If the demo data is absent, `/crm/closer` may still pass route/API smoke, but the commercial demo cannot pass the Closer business-output gate.

## `/crm/import` Acceptance

### Route And Access

| Check | Pass criteria | Status |
| --- | --- | --- |
| Route availability | `/crm/import` loads in frontend without 404 or unhandled error. | Blocker if missing |
| App gate | Not purchased/not installed CRM users see the App Market/install path, not a broken page. | Blocker if broken |
| API contract | `POST /crm/import/preview`, `POST /crm/import/dry-run`, and gated `POST /crm/import/commit` are reachable behind normal auth/CRM install gate. | Blocker if 404/405 |
| Safe default | Preview and dry-run perform no writes; commit requires the explicit local CRM gate. | Blocker if violated |

### Preview And Mapping

| Check | Pass criteria | Status |
| --- | --- | --- |
| CSV/manual row input | Accepts pasted or uploaded CSV-like rows for preview. | Pass |
| Field recognition | Suggests mappings for company, contact/name, phone, email, WeChat, opportunity, and note-like fields. | Pass |
| Manual override | User can see and adjust field mappings before any commit path. | Pass |
| PII flags | Phone, email, and WeChat fields are flagged as PII. | Pass |
| Quality report | Empty required fields, duplicate rows, malformed phone/email, and suspicious values are surfaced. | Pass |
| Row counts | Displays total rows, preview rows, valid rows, invalid rows, duplicate count, and warnings. | Pass |

### Dry-Run Proof

| Check | Pass criteria | Status |
| --- | --- | --- |
| Proof ID/hash | Dry-run returns a proof object with stable id/hash, row count, timestamp, mapping, and warnings. | Blocker if absent |
| Audit boundary | Response includes an audit/proof boundary showing dry-run, no external network, no production writes. | Blocker if absent |
| Write boundary | `writeTables` is empty and `requiredFutureGate` is `11G` or stricter. | Blocker if violated |
| Export/copy proof | User can copy or export proof content for demo evidence. | Warn if UI-only gap |
| No commit shortcut | `commit=true` without `MIGO_LOCAL_CRM_IMPORT_APPROVED` is rejected and writes nothing. | Blocker if write occurs |

### Controlled Local Commit

| Check | Pass criteria | Status |
| --- | --- | --- |
| Gate required | `POST /crm/import/commit` requires `commit: true` and `confirmationGate: MIGO_LOCAL_CRM_IMPORT_APPROVED`. | Pass |
| Local CRM only | Approved commit writes only local CRM customer/company/timeline tables; external CRM/network/token remains untouched. | Pass |
| Proof and rollback | Response returns commit proof hash, write tables, customer ids, and rollback token/plan. | Pass |
| Import batch ledger | Approved commit creates a persisted `crm_import_batches` row with commit proof, customer ids, write tables, and rollback token. | Pass |
| Audit event ledger | Approved commit creates a persisted `crm_audit_events` row linked to the import batch and commit proof. | Pass |
| Quality block | Rows with blocking quality errors are rejected before any write. | Blocker if partial write occurs |
| Executable rollback | `POST /crm/import/rollback` validates rollback token, archives only matching imported customers, writes rollback timeline, and returns rollback proof. | Pass |
| Rollback ledger | Rollback updates the import batch status/proof and writes a second `crm_audit_events` record. | Pass |
| Existing customer safety | Rollback skips customers that pre-existed before the import batch; it only archives customers created by that batch. | Pass |

### Negative Cases

These must be tested and captured:

- Empty input returns a safe preview/dry-run structure, not a crash.
- Duplicate contact/phone/email rows are marked, not silently merged.
- Malformed PII is warned, not normalized into false confidence.
- Missing CRM install blocks API access.
- No preview/dry-run path writes `crm_customers`, `crm_companies`, or `crm_opportunities`.
- Commit without `MIGO_LOCAL_CRM_IMPORT_APPROVED` writes nothing.
- Rollback with an invalid token writes nothing.
- Rollback skips customer ids that do not belong to the import commit.

## `/crm/closer` Acceptance

### Route And API

| Check | Pass criteria | Status |
| --- | --- | --- |
| Route availability | `/crm/closer` loads without 404 or unhandled error. | Blocker if missing |
| API availability | Closer advice API is reachable, for example `/crm/closer/summary` or `/crm/closer/advice`. | Blocker if frontend calls a missing backend route |
| Data source | Advice is generated from CRM customers, opportunities, tasks, timeline, and notes. | Blocker if source is opaque |
| Read-only mode | Advice generation does not auto-send, auto-write, or call external CRM. | Blocker if violated |

### Business Output

| Check | Pass criteria | Status |
| --- | --- | --- |
| Advice volume | With demo data loaded, returns at least 5 actionable follow-up suggestions. | Blocker for demo |
| Traceability | Every suggestion links to at least one customer, opportunity, task, timeline event, or note. | Blocker if missing |
| Reason | Each suggestion explains why the customer/opportunity should be followed up now. | Pass |
| Suggested action | Each suggestion includes how to follow up and the next step. | Pass |
| Talk track | Each suggestion includes a sales script/talk track suitable for human review. | Pass |
| Risk points | Risk or caution is surfaced for stale opportunities, overdue tasks, low evidence, or sensitive outreach. | Pass |
| Dormant wakeup | Dormant or long-idle customers are represented when present in data. | Warn if no dormant demo data |
| Daily report | Provides a manager-style daily summary: new leads, pending follow-ups, risky opportunities, recommended actions. | Pass |

### Safety And Disclosure

| Check | Pass criteria | Status |
| --- | --- | --- |
| Human review label | UI clearly states AI advice requires human judgment. | Blocker if hidden |
| No external send | No button can send messages directly from Closer without an existing interaction gate. | Blocker if violated |
| Audit/proof | Advice generation has an audit/proof hash or deterministic evidence snapshot. | Warn if not persisted |
| Failure behavior | Empty CRM data shows a clear "load demo data / add CRM data" path, not fake advice. | Blocker if fake |

## `/crm/connectors` Acceptance

### Route And Readiness

| Check | Pass criteria | Status |
| --- | --- | --- |
| Route availability | `/crm/connectors` loads without 404 or unhandled error. | Blocker if missing |
| Readiness API | Connector readiness endpoint is reachable, for example `/crm/connectors/readiness`. | Blocker if frontend calls a missing backend route |
| Contract generation | Contract endpoint can generate or return a connector contract without requiring real credentials. | Blocker if missing |

### Connector Cards

Phase 1 must show at least:

- CSV / Excel-like dry-run.
- Twenty.
- HubSpot.
- Salesforce.
- Feishu.

Notion and Airtable may be included as additional contract-only cards.

Each connector card must show:

- Current mode: `contract-only`, `dry-run-only`, or `read-only`.
- Field mapping target.
- Read scopes, if applicable.
- Safety boundary.
- Current status.
- Required future gate.
- Next action.

### Safety Boundary

| Check | Pass criteria | Status |
| --- | --- | --- |
| No token | Connector Center can render contracts without OAuth, API key, token paste, or webhook setup. | Blocker if token required |
| No network | Contract-only connectors do not call external CRM services. | Blocker if violated |
| No write | `writeTables=[]` and safety boundary says no production write. | Blocker if violated |
| Future gate | Production write requires 11G or stricter gate, human confirmation, rollback plan, and post-write verification. | Blocker if absent |
| Audit/proof | Contract read/generation returns or records proof/audit evidence. | Warn if not persisted |

## Commercial Readiness Gate

`/commercial-readiness` and `/commercial-readiness/summary` must represent CRM Phase 1 honestly.

Required checks:

| Gate key | Expected Phase 1 status | Pass criteria |
| --- | --- | --- |
| `app-market.crm` | Pass | CRM is purchased and installed for demo account. |
| `crm.data-closed-loop` | Pass or Warn | CRM has real/demo customers and timeline; warn allowed if only model exists. |
| `crm.import.safe-dry-run` | Pass | Import preview/dry-run proof exists, `writeTables=[]`, `requiredFutureGate=11G`. |
| `crm.closer.read-only-advice` | Pass | Closer advice is generated from CRM data and marked human-review/read-only. |
| `crm.connectors.contract-only` | Pass | Connector contracts are no-token, no-network, no-write. |
| `external-crm.integration` | Warn or Blocker | It must not imply production external CRM sync is ready. |
| `tenant.isolation` | Warn acceptable | Tenant/user boundary must be disclosed if not fully migrated. |
| `auth.entitlement` | Pass for commercial demo | Demo account has a valid entitlement or explicitly accepted local commercial mode. |
| `ops.backup` | Warn acceptable | Local backup evidence exists or is listed as a Phase 2/3 risk. |
| `windows.package-regression` | Warn acceptable | Phase 1 requires regression boundary evidence, not full GA signoff. |

Readiness must be a blocker if any of these are true:

- `/commercial-readiness` says "ready" while import/connector still allow ungated writes.
- External CRM connector requires real token to display contract-only readiness.
- Closer advice cannot show source evidence.
- CRM app is not installed and the UI still claims CRM demo is ready.

## Windows Regression Boundary

Phase 1 Windows regression is a boundary check, not a full GA release certification.

### Must Cover

| Area | Pass criteria |
| --- | --- |
| Installer launch | Current Windows package installs and opens without first-run crash. |
| Backend service | Packaged backend starts and exposes `/api` health/auth routes. |
| Frontend routes | `/crm`, `/crm/import`, `/crm/closer`, `/crm/connectors`, and `/commercial-readiness` load inside the packaged app or bundled frontend. |
| API base | Frontend points to the packaged/local backend, not stale localhost from a dev machine. |
| SQLite/Prisma | Existing CRM schema can be read after install; migration/bootstrap does not wipe local data. |
| Auth/session | Login or local auth bootstrap works for the demo account. |
| Existing interaction regression | Existing Windows WeChat/native-command acceptance scripts remain in their previous pass/warn state; CRM work must not regress them. |
| Evidence | Capture screenshots/logs for installer, first run, route load, readiness summary, and at least one CRM API smoke. |

### Explicitly Out Of Scope For Phase 1

- Production HubSpot/Salesforce/Feishu OAuth.
- Production external CRM write-back.
- Paid SaaS billing/webhook closeout.
- SSO/SAML.
- SLA/status page.
- Full Windows GA security certification.

## End-To-End Demo Flows

### Flow A: Customer Without CRM

1. Install CRM app from App Market.
2. Open `/crm` and verify companies, customers, opportunities, tasks, notes, and timeline.
3. Load or create demo CRM data.
4. Open `/crm/closer`.
5. Verify at least 5 follow-up suggestions, each with reason, script, risk, next step, and source evidence.
6. Verify daily report summary.
7. Confirm no suggestion auto-sends or writes external systems.

### Flow B: Customer With Existing CRM

1. Open `/crm/connectors`.
2. Show HubSpot/Salesforce/Twenty/Feishu contract-only cards.
3. Confirm no token/OAuth/network is required.
4. Open `/crm/import`.
5. Run sample CSV preview.
6. Confirm mapping, PII flags, quality report, and proof.
7. Run dry-run.
8. Confirm `writeTables=[]`, `requiredFutureGate=11G`, and proof/audit output.
9. Use the imported preview/demo CRM data to show Closer advice.

### Flow C: Readiness Disclosure

1. Open `/commercial-readiness`.
2. Confirm CRM app install and CRM data gate.
3. Confirm import/connector gates state dry-run/contract-only boundaries.
4. Confirm external CRM integration is warn/blocker unless a true read-only connector has landed.
5. Confirm Windows regression evidence is linked or listed as pending.

## Hard Fail Conditions

Phase 1 cannot be accepted if any item below is true:

- `/crm/import`, `/crm/closer`, or `/crm/connectors` returns 404 in the demo frontend.
- Frontend API calls exist for Closer/Connector but backend routes return 404/405.
- Import dry-run writes to production CRM tables.
- Connector Center requires real external CRM token just to show contract readiness.
- Connector contract calls external CRM networks during contract-only mode.
- Closer advice has no source references.
- Closer suggests external sending without a human gate.
- `/commercial-readiness` claims ready while safety gates are missing.
- Windows package cannot launch, cannot reach backend, or cannot load the CRM routes.

## Minimal Smoke Script

Use:

```bash
node scripts/crm-commercial-phase1-smoke.mjs
```

Common environment:

```bash
BASE_URL=http://127.0.0.1:3010 \
API_BASE=http://127.0.0.1:3011/api \
TOKEN='...' \
node scripts/crm-commercial-phase1-smoke.mjs
```

Auth options:

- `TOKEN`: sent as `Authorization: Bearer <TOKEN>`.
- `COOKIE_HEADER`: sent as raw Cookie header.
- `SESSION_TOKEN`: sent as `ai_content_session=<SESSION_TOKEN>` unless `AUTH_COOKIE_NAME` overrides the cookie name.
- `SKIP_AUTH=1`: treats 401/403 as skipped for protected API checks. It still fails route 404/405 and unsafe payloads.

Useful flags:

```bash
node scripts/crm-commercial-phase1-smoke.mjs --frontend-only
node scripts/crm-commercial-phase1-smoke.mjs --api-only
node scripts/crm-commercial-phase1-smoke.mjs --json
node scripts/crm-commercial-phase1-smoke.mjs --api-only --evidence-dir docs/acceptance-evidence-2026-07-01/crm-phase1
COOKIE_HEADER='ai_content_session=...' node scripts/crm-commercial-phase1-smoke.mjs --api-only --destructive --confirm-local-crm-write --evidence-dir docs/acceptance-evidence-2026-07-01/crm-phase1-write
```

Default mode is intentionally non-destructive. It checks frontend route availability and uses import preview/dry-run payloads only. It does not call CRM create/update/archive endpoints.

`--destructive --confirm-local-crm-write` is reserved for a test tenant/user. It writes sample rows to local CRM through `POST /crm/import/commit`, immediately calls `POST /crm/import/rollback`, and verifies:

- persisted timeline event types for `customer_created`, `crm_import_committed`, `crm_import_rollback_archived`, and `crm_import_rollback_completed`;
- persisted import batch ledger via `GET /crm/import/batches`;
- persisted audit event ledger via `GET /crm/audit/events?importBatchId=...`;
- commit and rollback proof hashes linked across response, timeline, import batch, and audit event records.

Latest local destructive smoke evidence:

- `docs/acceptance-evidence-2026-07-01/crm-phase1-smoke-1782926840827/report.md`
- Result: `PASS=13 SKIP=0 FAIL=0 BLOCKED=0`
- Additional gate check on 2026-07-01: authenticated local commercial entitlement can purchase/install CRM; trial entitlement is blocked from CRM purchase with HTTP 403.
- `docs/acceptance-evidence-2026-07-01/crm-phase1-smoke-1782924945202/report.md`
- Result: `PASS=13 SKIP=0 FAIL=0 BLOCKED=0`

## Current Source Alignment Notes

As of 2026-06-30 local source inspection:

- Frontend route files are present for `/crm`, `/crm/import`, `/crm/closer`, and `/crm/connectors`.
- Frontend API client contains calls for `/crm/import/*`, `/crm/closer/*`, and `/crm/connectors/*`.
- Backend controller source exposes `/crm/import/preview`, `/crm/import/dry-run`, `/crm/import/commit`, `/crm/import/rollback`, `/crm/import/batches`, `/crm/audit/events`, `/crm/closer`, `/crm/closer/summary`, `/crm/closer/advice`, `/crm/connectors`, `/crm/connectors/readiness`, and connector contract routes.
- If a running local backend still returns 404 for Closer/Connector routes, treat it as a stale-process or build/restart risk until rerun against the latest backend process.
- Commercial readiness contains broad CRM app/data, external CRM, backup, entitlement, Windows packaging checks, plus CRM-specific gates for safe import dry-run, Closer read-only advice, and connector contract-only boundary.

If another worker lands or rewires routes after this document, restart the relevant dev process and rerun the smoke rather than weakening the gate.

## Risk Register

| Risk | Severity | Acceptance handling |
| --- | --- | --- |
| Running backend process stale after parallel route changes | High | Restart/rebuild backend, then rerun smoke; commercial demo blocks on live 404/405. |
| Import response shape differs from frontend type expectations | Medium | Smoke validates safety/proof semantics; UI acceptance must verify displayed proof fields. |
| Readiness summary too broad for Phase 1 CRM specifics | Medium | CRM import/Closer/connector-specific checks exist; attach latest smoke evidence before signoff. |
| Demo data absent | Medium | Route/API smoke can pass, but Closer business-output gate remains blocked. |
| Windows package evidence stale | Medium | Treat as warn/blocker according to current package run, not historical evidence. |
| External CRM wording overclaims production sync | High | Customer-facing demo script must say contract-only/dry-run-only until Phase 2/3 gates land. |
