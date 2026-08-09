# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-08T22:21:51.144Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=20; companies=19; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=4; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=4; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_9c8d8162a1c21721; proof=9c8d8162a1c21721700aced8d8078fd0e8361df5e3653a7912da8e78e2923617; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=1ac821a227b55477f56e6442d9e47db43849c51825f2d8ea9b80f32b9c572b16; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=80; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_9c8d8162a1c21721; status=rolled_back; commitProof=9c8d8162a1c21721700aced8d8078fd0e8361df5e3653a7912da8e78e2923617; rollbackProof=1ac821a227b55477f56e6442d9e47db43849c51825f2d8ea9b80f32b9c572b16 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

