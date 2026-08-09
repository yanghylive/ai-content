# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-01T17:27:21.277Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=14; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=1; companies=0; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_95a716742d851e56 |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_b8f15188c9942f21; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=1; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=1; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_cf02b0af8d8f2520; proof=cf02b0af8d8f2520e20443589aef8285fcb5f0e0366bd969c5f833635b35c0d6; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=080c15725a600c0ec54e5f892028a67538b1a18bd55c0b014e7f929b91e2a15c; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=9; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_cf02b0af8d8f2520; status=rolled_back; commitProof=cf02b0af8d8f2520e20443589aef8285fcb5f0e0366bd969c5f833635b35c0d6; rollbackProof=080c15725a600c0ec54e5f892028a67538b1a18bd55c0b014e7f929b91e2a15c |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

