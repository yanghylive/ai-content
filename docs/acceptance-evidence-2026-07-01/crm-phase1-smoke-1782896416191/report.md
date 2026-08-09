# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-01T09:00:16.417Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: PASS
- Counts: PASS=11 SKIP=0 FAIL=0 BLOCKED=0

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
| PASS | api:destructive commit | committed=2; customers=2; proof=5bc7b789f4e391fb30ddcb666e53c715cbc81db75ad5cbd91f416794fbbaf2cb; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=97c5bc6fcf952a433d074ee991b55f6d056214def60fb12d2579e2226e251fd4; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=9; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |

