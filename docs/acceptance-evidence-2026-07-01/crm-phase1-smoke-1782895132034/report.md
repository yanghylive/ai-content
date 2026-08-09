# CRM Commercial Phase 1 Smoke Evidence

- Generated at: 2026-07-01T08:38:52.260Z
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
| PASS | api:destructive commit | committed=2; customers=2; proof=e35fecffd5b8a0df56b9d6df347aafdd01837950844de1cb2dddaf0392a4b3f6; externalCrmTouched=false |  |
| PASS | api:destructive rollback | archived=2; proof=0e678c4bbe6d9c3cbd7a3c619c80921a30b0e4b01e7c398caada273b6b847b68; externalCrmTouched=false |  |
| PASS | api:destructive audit timeline | events=9; requiredEvents=customer_created,crm_import_committed,crm_import_rollback_archived,crm_import_rollback_completed; proofHashesLinked=true |  |

