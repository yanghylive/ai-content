# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-08-23T08:50:40.484Z
- Frontend: http://127.0.0.1:3015
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=16; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=40; companies=17; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_44dd32016f0d49bf |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_0882db6c6ad646b7; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=12; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=12; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_527b66de0617ec7b_3da99e09; proof=527b66de0617ec7b974a0bcfd336ce7d4222014313dec462a09ffd0fef3cd768; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=066761feb6388d9893b18108b01640ba190a2be16a3ad66673de7b732b794240; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=96; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_527b66de0617ec7b_3da99e09; status=rolled_back; commitProof=527b66de0617ec7b974a0bcfd336ce7d4222014313dec462a09ffd0fef3cd768; rollbackProof=066761feb6388d9893b18108b01640ba190a2be16a3ad66673de7b732b794240 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

