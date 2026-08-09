# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-03T11:16:56.503Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=13 SKIP=0 FAIL=0 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=15; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=2; companies=0; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_95a716742d851e56 |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_b8f15188c9942f21; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=2; humanReview=false |  |
| PASS | api:POST /crm/closer/advice | advice=2; readOnly=true |  |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; batch=crm_import_9e14afa045907dd1; proof=9e14afa045907dd1089abbe2db07f0c7e8900a369f21fab895429b0802d49161; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=2196781ab49e2ada0ab859d1c0166aa8a050d28ef8249157e181ab5a2aedaba4; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=10; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |
| PASS | api:destructive import batch ledger | batch=crm_import_9e14afa045907dd1; status=rolled_back; commitProof=9e14afa045907dd1089abbe2db07f0c7e8900a369f21fab895429b0802d49161; rollbackProof=2196781ab49e2ada0ab859d1c0166aa8a050d28ef8249157e181ab5a2aedaba4 |  |
| PASS | api:destructive audit event ledger | auditEvents=2; requiredEvents=crm_import_committed,crm_import_rollback_completed; proofHashesLinked=true |  |

