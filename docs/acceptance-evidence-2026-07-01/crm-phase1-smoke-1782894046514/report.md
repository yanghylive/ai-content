# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-01T08:20:46.737Z
- Frontend: http://127.0.0.1:3010
- API: http://127.0.0.1:3011/api
- Destructive local CRM write: yes
- Result: FAIL
- Counts: PASS=10 SKIP=0 FAIL=1 BLOCKED=0

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | api:GET /commercial-readiness/summary | overallStatus=blocked; checks=14; crmGate=true |  |
| PASS | api:GET /crm/summary | customers=1; companies=0; opportunities=0; openTasks=0 |  |
| PASS | api:POST /crm/import/preview | rows=2; previewRows=2; proof=proof_95a716742d851e56 |  |
| PASS | api:POST /crm/import/dry-run | rows=2; previewRows=2; proof=proof_b8f15188c9942f21; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:GET /crm/closer/summary | adviceCount=1; humanReview=false |  |
| FAIL | api:POST /crm/closer/advice | Closer advice response does not prove read-only/no-write safety. | Fix /crm/closer/advice response contract. |
| PASS | api:GET /crm/connectors/readiness | connectors=5; contractOnly=true; writeTables=[] |  |
| PASS | api:POST /crm/connectors/contract | connector=hubspot; writeTables=[]; requiredFutureGate=11G |  |
| PASS | api:destructive commit | committed=2; customers=2; proof=6720831f775644a050d4ddce8328a00064242318403460e92515572c7e03e476; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=d7dcb5b66e84185e7f17c2b26b1411ee611143586ed9c4de714900785aaf2980; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=9; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |

